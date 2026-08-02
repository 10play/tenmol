/**
 * The headless half of PyMOL's plugin engine, reachable over the bridge.
 *
 * Inventory rows 76 / 77 / 463. Everything here is measured against a live
 * bridge in `bridge/tests/test_wf_plugins.py`; the numbers quoted in the
 * comments are from that run, not from reading the source.
 *
 * WHAT DOES NOT EXIST HERE, AND WHY
 * ---------------------------------
 * `execapp` calls `window.initializePlugins()` at startup, which builds a Tk
 * `PMGApp` behind a `PmwMenuBar` and sets `plugins.HAVE_QT = True`. The bridge
 * fills that seam with a refusal (`shims.Shims._create_legacy_pmgapp` returns
 * None), so `pymol.gui.get_pmgapp()` is None and:
 *
 *   - `plugins.addmenuitem(label, fn)` — the ONLY entry point a legacy plugin
 *     has — returns None and registers nothing. Measured: ok/None for every
 *     label shape, including the `a|b|c` path form and the `-` separator.
 *   - `plugins.addmenuitemqt(...)` raises `QtNotAvailableError`, because
 *     `HAVE_QT` stays False. Nothing sets it here on purpose: a plugin that
 *     opened a PyQt window would open it on the SERVER's display.
 *   - `plugins.get_tk_root()` / `get_tk_focused()` raise `AttributeError`
 *     ('NoneType' object has no attribute 'root') in milliseconds instead of
 *     blocking on a hidden Tk root.
 *   - `pmg_qt.mimic_tk` is never imported, so its `sys.meta_path` hook for
 *     `tkinter.messagebox` / `tkinter.filedialog` never exists.
 *
 * So the MENU half of the plugin system is gone, and gone quietly. Of the two
 * plugins this build ships on the startup path, `apbs_gui` cannot even import
 * without PyQt and `lightingsettings_gui` imports fine but its entire
 * `__init_plugin__` is one `addmenuitemqt` call. Both are replaced by native
 * React features rather than ported.
 *
 * WHAT DOES EXIST
 * ---------------
 * The REGISTRY half is fully usable headlessly, and nothing in the bridge was
 * calling it. `invocation.options.plugins == 2` — the desktop app would
 * autoload at startup — but `SingletonPyMOL.start()` does not initialize
 * plugins and the bridge never did either, so `plugins.plugins` was empty for
 * the life of the process and `~/.pymolpluginsrc.py` was NEVER READ. That is
 * what {@link initializePluginSystem} fixes, from the client.
 */

/** Minimal slice of `Session` this feature needs; keeps the loader React-free. */
export type CallFn = <T>(fn: string, args?: readonly unknown[]) => Promise<T>;

/**
 * `plugins.initialize(-2)` — register every discovered plugin, load none.
 *
 * `autoload = (pmgapp != -2)` in `modules/pymol/plugins/__init__.py`, so `-2`
 * is the one mode that reads `~/.pymolpluginsrc.py` and builds a `PluginInfo`
 * per file **without importing any plugin module**. Verified: after the call,
 * `sorted(plugins.plugins)` is `['apbs_gui', 'lightingsettings_gui']`, both
 * `loaded=False`, and `sys.modules` contains no `pmg_tk.startup.*`, no
 * `tkinter` and no `pmg_qt`.
 *
 * Upstream uses the same idiom: `plugin_load` opens with
 * `if len(plugins) == 0: initialize(-2)`.
 *
 * DELIBERATELY NOT `-1` OR `initialize(app)`. Those import every plugin module
 * — arbitrary Python off the startup path — and buy nothing, because the menu
 * entry point they would register is a no-op here. Measured in a throwaway
 * interpreter: `initialize(-1)` printed `Unable to initialize plugin
 * 'apbs_gui'` and left `lightingsettings_gui` loaded but unreachable.
 *
 * SIDE EFFECT, stated plainly: this executes `~/.pymolpluginsrc.py` (via
 * `parsing.run_file`). That is PyMOL's own startup behaviour, which the bridge
 * has been skipping.
 */
export async function initializePluginSystem(call: CallFn): Promise<void> {
  await call<null>('plugins.initialize', [-2]);
}

/**
 * The `autoload` map, straight off the module global.
 *
 * Row 463 says autoload state "is not reachable from the client today" because
 * `PluginInfo` is not JSON-serialisable. It is right about `PluginInfo` — the
 * codec refuses it with `NotSerializable: no codec entry for
 * pymol.plugins.PluginInfo`, and `codec.py` is frozen — but no new bridge
 * surface is needed: `plugins.autoload` is a plain `dict`, three dotted
 * segments, inside an allowed root, so `plugins.autoload.copy` resolves through
 * the ordinary dispatcher.
 *
 * A MISSING KEY MEANS ENABLED: `PluginInfo.autoload` is
 * `autoload.get(self.name, True)`.
 */
export async function readAutoload(call: CallFn): Promise<Record<string, boolean>> {
  const raw = (await call<Record<string, unknown>>('plugins.autoload.copy')) ?? {};
  const out: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(raw)) out[name] = Boolean(value);
  return out;
}

export function isAutoloadEnabled(name: string, map: Readonly<Record<string, boolean>>): boolean {
  return map[name] ?? true;
}

/**
 * Write one plugin's autoload flag, exactly as `PluginInfo.autoload`'s setter does.
 *
 * The setter is two statements —
 * `autoload[self.name] = bool(value); set_pref_changed()` — and both halves are
 * reachable as callables, so this reproduces it without a new accessor.
 *
 * `set_pref_changed()` calls `pref_save()` when the `instantsave` preference is
 * on (PyMOL's default), which REWRITES `~/.pymolpluginsrc.py` with the whole
 * in-memory `autoload` dict. Two consequences the caller must respect:
 *
 *  1. {@link initializePluginSystem} MUST have run first. Measured: toggling
 *     without it wrote a file containing only the toggled entry and silently
 *     dropped every other choice the user had saved.
 *  2. With `instantsave` off the change is in-memory only and dies with the
 *     process — same as the desktop manager. The caller already reads that
 *     preference and is expected to say which of the two happened.
 */
export async function setAutoload(call: CallFn, name: string, enabled: boolean): Promise<void> {
  await call<null>('plugins.autoload.update', [{ [name]: enabled }]);
  await call<null>('plugins.set_pref_changed', []);
}

/* ------------------------------------------------------------------ *
 * Preferences (inventory row 461)
 * ------------------------------------------------------------------ */

export type PreferenceKey = 'verbose' | 'instantsave';

/**
 * Does writing `key = value` REWRITE `~/.pymolpluginsrc.py`?
 *
 * `pref_set` is `preferences[k] = v; set_pref_changed()`, and
 * `set_pref_changed` is `if pref_get('instantsave', True): pref_save()` — it
 * reads the preference AFTER the assignment. So turning `instantsave` OFF is
 * the one write in this panel that never reaches disk: the file goes on saying
 * `True` and the change dies with the process. Turning it back ON saves
 * immediately, including everything else that drifted in the meantime.
 *
 * Measured, not deduced, in `bridge/tests/test_p8_a10.py`.
 *
 * The panel has to say which of the two happened before it happens, which is
 * why this is a pure function and not a comment.
 */
export function writeReachesDisk(
  key: PreferenceKey,
  value: boolean,
  instantsave: boolean,
): boolean {
  return key === 'instantsave' ? value : instantsave;
}

/** `plugins.pref_set(k, v)`. Returns None whether or not the save worked. */
export async function setPreference(
  call: CallFn,
  key: PreferenceKey,
  value: boolean,
): Promise<void> {
  await call<null>('plugins.pref_set', [key, value]);
}

/* ------------------------------------------------------------------ *
 * Startup paths (inventory row 462)
 * ------------------------------------------------------------------ */

export interface StartupPaths {
  /** `get_startup_path(True)` — the slice `set_startup_path` may replace. */
  user: string[];
  /**
   * The tail `set_startup_path` can NEVER touch: the `pmg_tk.startup` package
   * directory and `$PYMOL_DATA/startup`. `set_startup_path` assigns to
   * `startup.__path__[:-N_NON_USER_PATHS]`, so these two survive every edit —
   * which is why they are listed apart instead of being offered a delete
   * button that would do nothing. Measured: 2 entries on this build, and
   * `get_startup_path(True)` is empty, so BOTH visible rows are of this kind.
   */
  installation: string[];
}

export async function readStartupPaths(call: CallFn): Promise<StartupPaths> {
  const all = (await call<string[]>('plugins.get_startup_path')) ?? [];
  const user = (await call<string[]>('plugins.get_startup_path', [true])) ?? [];
  return { user, installation: all.slice(user.length) };
}

/** Move `index` by `delta`, or return the list unchanged at the ends. */
export function movePath(paths: readonly string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= paths.length || target < 0 || target >= paths.length) {
    return [...paths];
  }
  const next = [...paths];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

export function removePath(paths: readonly string[], index: number): string[] {
  return paths.filter((_, i) => i !== index);
}

/**
 * Append, refusing a blank and refusing a duplicate.
 *
 * `findPlugins` walks the list in order and the FIRST match for a name wins
 * (`plugins/__init__.py:366-405`), so a duplicated entry is not merely untidy —
 * it is a second copy of a rule that already fired.
 */
export function addPath(paths: readonly string[], candidate: string): string[] {
  const trimmed = candidate.trim();
  if (trimmed === '' || paths.includes(trimmed)) return [...paths];
  return [...paths, trimmed];
}

/**
 * `plugins.set_startup_path(paths, autosave)`, then RE-READ.
 *
 * The re-read is not belt-and-braces. `set_startup_path` ends in
 * `else: print(' Error: set_startup_path failed')` for anything that is not a
 * list, so a bad argument answers `t: ok` with `result: null` — exactly what a
 * successful call answers. Measured in `bridge/tests/test_p8_a10.py`. The only
 * way to know is to ask again.
 */
export async function setStartupPaths(
  call: CallFn,
  paths: readonly string[],
  autosave: boolean,
): Promise<string[]> {
  await call<null>('plugins.set_startup_path', [[...paths], autosave]);
  const after = (await call<string[]>('plugins.get_startup_path', [true])) ?? [];
  if (after.length !== paths.length || after.some((p, i) => p !== paths[i])) {
    throw new Error(
      `set_startup_path did not apply: asked for [${paths.join(', ')}], engine has [${after.join(', ')}]`,
    );
  }
  return after;
}
