/**
 * The menu-leaf interception seam.
 *
 * WHAT A LEAF IS. A PyMOL pop-up row of kind 1 carries a COMMAND STRING and
 * choosing it executes that string verbatim (`layer4/PopUp.cpp:471-475`). This
 * client honours that literally: `PopupMenu` sends the string through
 * `session.run(command)`, i.e. a `{t:'do'}` frame, and PyMOL echoes it into the
 * console itself. That is right for the ~99 % of leaves that are ordinary
 * commands, and it is exactly wrong for the handful that name a Qt entry point
 * the web client implements in the browser instead.
 *
 * THE ONE THAT FORCED THIS. `modules/pymol/menu.py:648` builds
 *
 *     [1, 'panel', 'cmd.volume_panel(%s)' % rsele]
 *
 * for every volume object. `cmd.volume_panel` opens `pmg_qt.volume`, which
 * cannot exist here; the React editor is the thing that should open. Before
 * this module there was nowhere to say so — `shell/panelHooks.ts`'s
 * `registerMenuHook` binds `_gui.py`'s named `= None` seams, which the MENU BAR
 * consults, and a pop-up leaf has no name, only a command string.
 *
 * THE SHAPE. A hook is `(command) => boolean`: it returns true if it HANDLED
 * the command, and the leaf then never reaches the engine. Hooks are tried in
 * registration order and the first claimer wins, so a hook that does not
 * recognise a string must return false rather than throwing. A throw is
 * contained here and treated as "not handled" — a broken hook must not make
 * every menu in the application dead.
 *
 * WHAT ELSE THIS NOW MAKES POSSIBLE, since the seam is not volume-shaped:
 *   * `cmd.edit_pymolrc` / text-editor leaves, if PyMOL ever emits one;
 *   * intercepting `cmd.quit()` to ask the browser first;
 *   * a client-side implementation of any leaf whose command assumes a desktop
 *     toolkit, without editing `modules/pymol/menu.py` and so without diverging
 *     from upstream's menu data.
 *
 * WHERE IT IS *NOT* CONSULTED, and this is a live gap rather than an omission:
 * the object panel's `A`/`S`/`H`/`L`/`C`/`M` row menus are a SECOND dispatch
 * site — `features/objects/ObjectPanel.tsx:527-530` runs `session.run(command)`
 * on its own `RowMenu` — and `C > volume` is where `menu.vol_color`'s `panel`
 * leaf actually appears. That file belongs to another work package. The
 * volume panel is reachable from it anyway, because the ENGINE-side shim
 * (`bridge/tenmol_bridge/panels/volume.py`) turns the executed command into an
 * event the browser acts on; this seam is the local, zero-round-trip path and
 * the general facility, not the only route.
 */

/** Returns true when the hook has handled the command itself. */
export type LeafHook = (command: string) => boolean;

const hooks = new Map<string, LeafHook>();

/**
 * Claim leaf commands. Returns an unregister function.
 *
 * Keyed by id and last-registration-wins, like `registerMenuHook`, so a hot
 * reload re-binding the same id replaces rather than duplicates.
 */
export function registerLeafHook(id: string, hook: LeafHook): () => void {
  hooks.set(id, hook);
  return () => {
    if (hooks.get(id) === hook) hooks.delete(id);
  };
}

/** Ids registered right now, in registration order. For tests and diagnostics. */
export function leafHookIds(): readonly string[] {
  return [...hooks.keys()];
}

/**
 * Run a leaf: give every hook a chance, then fall back to the engine.
 *
 * Returns the id of the hook that claimed it, or `null` when the command went
 * to `fallback`. Callers use the return value only for diagnostics; the point
 * is that `fallback` runs exactly once and only when nothing claimed it.
 */
export function dispatchLeaf(
  command: string,
  fallback: (command: string) => void,
): string | null {
  for (const [id, hook] of hooks) {
    let claimed = false;
    try {
      claimed = hook(command) === true;
    } catch {
      // A hook that throws is a hook that did not handle it. Swallowing here
      // rather than at each call site is what keeps one broken feature from
      // making every PyMOL menu in the application inert.
      claimed = false;
    }
    if (claimed) return id;
  }
  fallback(command);
  return null;
}

/** Exported for tests only: forget every registration. */
export function resetLeafHooks(): void {
  hooks.clear();
}
