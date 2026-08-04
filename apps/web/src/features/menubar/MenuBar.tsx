/**
 * The menu bar: File, Edit, Build, Movie, Display, Setting, Scene, Mouse,
 * Wizard, Plugin, Help.
 *
 * Qt builds these by walking `get_menudata` in `_addmenu`
 * (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:295-352`) and then appending two things
 * imperatively afterwards: `Display ▸ External GUI` (`:373-381`) and
 * `Plugin ▸ Initialize Plugin System` (`:396-397`). Both are reproduced here as
 * *appended* items, in the same order, so the data-driven part stays pure.
 *
 * What is deliberately NOT reproduced, and why:
 *   - the macOS `Edit` -> `Edit_` -> `Edit` rename (`:360-364`) exists only to
 *     hide the OS-injected "Start Dictation" item from a native menu bar
 *     (QTBUG-43217). There is no native menu bar here.
 *   - `setTearOffEnabled(True)`: a tear-off menu is a top-level X11/Win32
 *     window. Not achievable, and nothing depends on it.
 *   - `self.menudict`, the registry legacy Tk plugins mutate, is Qt-object
 *     valued and belongs to WP-25's plugin surface, not here.
 *
 * Setting-bound state is read when a menu OPENS, which is when Qt reads it too:
 * `_addmenu` calls `cmd.get_setting_tuple` while BUILDING each check/radio
 * (`pymol_qt_gui.py:337`) and only then registers `setting_callbacks[index]`.
 * A menu here is unmounted while closed, so "build" happens per open.
 *
 * The PUSH half is `shell/settingsTap.ts`, and it is the same shape as Qt's:
 * the bridge's tap says WHICH INDICES changed, this file re-reads the open
 * menu's settings when any of them is one of its own. That is what makes a
 * radio dot move under `set orthoscopic, 1` typed at the prompt, or under a
 * `util.performance(0)` that writes a dozen settings — with the menu already
 * open and nobody touching it. `cmd.get_setting_updates` itself is destructive
 * and owned by the bridge status thread (plan §1.2); the tap is the cumulative,
 * cursor-addressed log of what that thread saw, and two consumers with two
 * cursors do not split it (measured).
 *
 * The 120 ms re-read after a click is the FALLBACK for a bridge whose settings
 * panel will not install: while the tap is live the click's own write comes
 * back through it, and the timer is not armed.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MenuNode, MenuSettingValue, MenusPayload } from '@tenmol/protocol/topics/menus';
import { truncateRecentLabel } from '@tenmol/protocol/topics/menus';
import { useSession } from '../../app';
import { menuHooks, subscribeMenuHooks } from '../../shell/panelHooks';
import { getSettingsTap } from '../../shell/settingsTap';
import { ToolkitDialogHost, useToolkitHooks } from './toolkitHooks';
import { MENU_DATA } from './generated/menudata';
import { createMenuSource } from './menuSource';
import { DynamicList, MenuList } from './MenuList';
import { AboutDialog } from './AboutDialog';
import { HOOK_OWNERS, UNAVAILABLE_COMMANDS, UNAVAILABLE_HOOKS, settingsIn } from './model';
import {
  RENDER_STATS_FN,
  clientRepsFrom,
  hasStereoLeaves,
  stereoLeaf,
  stereoNote,
  stereoTooltip,
  type ClientReps,
} from './stereo';
import {
  removeLastMovieProgram,
  runAction,
  runMovieProgram,
  setSetting,
  type MenuRuntime,
} from './actions';
import './menubar.css';

/** `Display ▸ External GUI` and `Plugin ▸ Initialize Plugin System` (`:373-397`). */
const APPENDED: Readonly<Record<string, MenuNode[]>> = {
  Display: [
    { kind: 'separator' },
    {
      kind: 'submenu',
      label: 'External GUI',
      items: [
        {
          kind: 'command',
          label: 'Toggle dockable [Ctrl-E]',
          accel: 'Ctrl-E',
          action: { type: 'hook', hook: 'toggle_ext_window_dockable' },
        },
        {
          kind: 'command',
          label: 'Visible',
          action: { type: 'hook', hook: 'toggle_ext_window_visible' },
        },
      ],
    },
  ],
  Plugin: [
    {
      kind: 'command',
      label: 'Initialize Plugin System',
      action: { type: 'hook', hook: 'initializePlugins' },
    },
  ],
};

const APPENDED_OWNERS: Readonly<Record<string, string>> = {
  toggle_ext_window_dockable: 'WP-07 (shell owns the External GUI dock)',
  toggle_ext_window_visible: 'WP-07 (shell owns the External GUI dock)',
  initializePlugins: 'WP-25 (plugin surface)',
};

export function MenuBar() {
  const session = useSession();
  const [open, setOpen] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, MenuSettingValue>>({});
  const [about, setAbout] = useState<string[] | null>(null);
  const [recent, setRecent] = useState<{ files: string[]; error: string | null } | null>(null);
  /**
   * The `recent()` fetch that is in the air.
   *
   * `renderDynamic` kicks the fetch off FROM RENDER, and one open renders the
   * submenu more than once (the hover, then the settings refresh that lands a
   * few ms later). MEASURED without this: two `tenmol_menus('recent')` round
   * trips per open, because `recent` is still null when the second render
   * runs. Qt reads a property and pays nothing; here it is an RPC.
   */
  const recentFetch = useRef<Promise<void> | null>(null);
  const [tree, setTree] = useState<MenusPayload>(MENU_DATA);
  /**
   * Which reps this browser is drawing itself — `null` until the bridge says.
   *
   * Read when a menu carrying `Stereo Mode` opens, and only then. See
   * `stereo.ts`: a server-side stereo setting is invisible for every rep the
   * client has taken over, and the menu is the only place that can say so
   * before the user clicks. `_bridge.render_stats` is documented read-only
   * (`packages/viewport/src/stream/pause.ts:186`) and costs one call per open.
   */
  const [clientReps, setClientReps] = useState<ClientReps>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const source = useMemo(
    () =>
      createMenuSource({
        call: (fn, args) => session.call(fn, args ?? []),
        do: async (line) => {
          await session.conn.do(line);
        },
      }),
    [session],
  );

  const menus = useMemo(
    () =>
      tree.menus.map((menu) => {
        if (menu.kind !== 'submenu') return menu;
        const extra = APPENDED[menu.label];
        return extra ? { ...menu, items: [...menu.items, ...extra] } : menu;
      }),
    [tree],
  );

  const note = useCallback(
    (text: string, kind?: 'error' | 'warning') =>
      session.stores.feedback.appendClient(text, kind ?? 'client'),
    [session],
  );

  /* ---------------- the live tree ---------------- */

  // The generated copy renders immediately; the live one replaces it when the
  // bridge answers. They are the same bytes when nobody's tree is stale, and
  // when they are not, the live one is right.
  useEffect(() => {
    let cancelled = false;
    void source
      .menus()
      .then((payload) => {
        if (cancelled || !payload || !Array.isArray(payload.menus)) return;
        setTree(payload);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [source]);

  /* ---------------- live setting values ---------------- */

  const refresh = useCallback(
    async (index: number | null) => {
      if (index === null) return;
      const menu = menus[index];
      if (!menu) return;
      const names = settingsIn([menu]);
      if (names.length === 0) return;
      try {
        // ONE round trip for the whole menu. The fallback below is 1 per
        // setting, which is 60+ frames for the Setting menu — correct, but only
        // acceptable as a fallback.
        const batch = await source.settings(names);
        setValues((previous) => ({ ...previous, ...batch }));
        return;
      } catch {
        /* fall through to the per-setting path */
      }
      const pairs = await Promise.all(
        names.map(async (name) => {
          try {
            // `(type, values)`; `values` is a 1-tuple except float3, and Qt
            // compares `values[0]` in both cases (`pymol_qt_gui.py:337`).
            const tuple = await session.call<[number, unknown[]]>('cmd.get_setting_tuple', [name]);
            const list = Array.isArray(tuple?.[1]) ? tuple[1] : [];
            const raw = list.length > 0 ? list[0] : null;
            const value = typeof raw === 'number' || typeof raw === 'string' ? raw : null;
            return [name, { type: Number(tuple?.[0] ?? 0), value }] as const;
          } catch {
            return null;
          }
        }),
      );
      const next: Record<string, MenuSettingValue> = {};
      for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
      setValues((previous) => ({ ...previous, ...next }));
    },
    [menus, session, source],
  );

  useEffect(() => {
    void refresh(open);
    // Qt rebuilds Open Recent on every `aboutToShow`; dropping the cache when
    // the menu closes is the same contract.
    if (open === null) {
      setRecent(null);
      recentFetch.current = null;
    }
  }, [open, refresh]);

  /* ---------------- who is drawing what (row 65) ---------------- */

  // Read on OPEN, like every other piece of live state here, and only for the
  // menu that has stereo leaves in it. A stale answer would be worse than none:
  // the user can flip a rep between P and G in the viewport HUD at any moment.
  useEffect(() => {
    if (open === null) return;
    const menu = menus[open];
    if (!menu || menu.kind !== 'submenu' || !hasStereoLeaves(menu.items)) return;
    let cancelled = false;
    void session
      .call<unknown>(RENDER_STATS_FN, [])
      .then((stats) => {
        if (!cancelled) setClientReps(clientRepsFrom(stats));
      })
      // An older bridge with no such route, or an offline session: `null` means
      // "not asked", which `stereoScope` reports as such rather than as "none".
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, menus, session]);

  /* ---------------- the push channel (`setting_callbacks`) ---------------- */

  const tap = useMemo(() => getSettingsTap(session), [session]);

  // `refresh` and `open` are read by a subscription that must not be torn down
  // and rebuilt every time either changes — that would drop batches between
  // renders and re-issue the index resolution.
  const latest = useRef({ open, refresh });
  latest.current = { open, refresh };

  useEffect(() => {
    const detach = tap.attach();
    // One call resolves every setting name the whole tree binds to, so the
    // batch filter below is index arithmetic and never another round trip.
    let byName: ReadonlyMap<string, number> = new Map();
    void tap
      .indices(tree.settings)
      .then((map) => {
        byName = map;
      })
      .catch(() => undefined);

    const unsubscribe = tap.subscribe(({ indices, full }) => {
      const { open: current, refresh: read } = latest.current;
      if (current === null) return; // nothing on screen to update
      if (!full) {
        const menu = menus[current];
        if (!menu) return;
        const mine = new Set(
          settingsIn([menu])
            .map((name) => byName.get(name))
            .filter((index): index is number => index !== undefined),
        );
        // An empty map means the tap could not resolve names (no settings panel
        // on this bridge); refusing to filter is better than refusing to update.
        if (mine.size > 0 && !indices.some((index) => mine.has(index))) return;
      }
      void read(current);
    });

    return () => {
      unsubscribe();
      detach();
    };
  }, [tap, tree.settings, menus]);

  /* ---------------- runtime ---------------- */

  // `mvprg` needs the runtime it lives inside (it calls `run` and `call`), so
  // the object is reached through a ref rather than closing over a half-built
  // literal. One indirection, no cycle, no stale capture.
  const runtimeRef = useRef<MenuRuntime | null>(null);

  // The dialogs this feature can open itself (Colors…, Keyboard Shortcuts…,
  // Scenes…, Edit All…) — `toolkitHooks.tsx`.
  const toolkit = useToolkitHooks(note);

  /**
   * Hooks registered by OTHER features, from their own directories
   * (`shell/panelHooks.ts`). This is what stops `runtime.hooks` being a
   * hard-coded literal that only WP-14 can extend: a work package that owns a
   * dialog calls `registerMenuHook('file_open', …)` and the leaf goes live —
   * no edit to this file, no shared file two agents both touch.
   *
   * `useSyncExternalStore` rather than an effect: a registration that happens
   * while the menu is OPEN must re-render it, or the item stays disabled until
   * the next click.
   */
  const external = useSyncExternalStore(subscribeMenuHooks, menuHooks, menuHooks);

  const runtime: MenuRuntime = useMemo(
    () => ({
      run: (line) => session.run(line),
      call: (fn, args, kwargs) => session.call(fn, args ?? [], kwargs ?? {}),
      note,
      openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
      hooks: {
        show_about: async () => {
          // `pymol_qt_gui.py:899-916`, verbatim, including the unconditional
          // "Open-Source Build" line.
          let version = '?';
          try {
            const info = await session.call<unknown[]>('cmd.get_version');
            version = String(info?.[0] ?? '?');
          } catch (error) {
            version = `unavailable (${error instanceof Error ? error.message : String(error)})`;
          }
          setAbout([
            'The PyMOL Molecular Graphics System',
            '',
            `Version ${version}`,
            'Copyright (C) Schrödinger, LLC.',
            'All rights reserved.',
            '',
            'License information:',
            'Open-Source Build',
            '',
            'For more information:',
            'https://pymol.org',
            'sales@schrodinger.com',
          ]);
        },
        confirm_quit: async () => {
          // Named `confirm_quit`, confirms nothing (`pymol_qt_gui.py`), and Qt
          // just calls `QApplication.quit()`. Here `cmd.quit` is ROUTED to the
          // bridge's own shutdown instead of PyMOL's C `exit()`
          // (`policy/base.py: ROUTED`, spike 00 §6.2).
          await session.call('cmd.quit');
          note('-- quit requested: the bridge is shutting down --', 'warning');
        },
        mvprg: (args) =>
          runMovieProgram(runtimeRef.current as MenuRuntime, args[0] as string | null),
        mvprg_remove_last: () => removeLastMovieProgram(runtimeRef.current as MenuRuntime),
        ...toolkit.hooks,
        // Last, so a feature that owns a surface can override the menu bar's
        // stand-in for it — the way Qt's `execapp` overwrites
        // `pymol.gui.createlegacypmgapp` after the window is built.
        ...external,
      },
    }),
    [session, note, toolkit.hooks, external],
  );
  runtimeRef.current = runtime;

  /* ---------------- open / close ---------------- */

  useEffect(() => {
    if (open === null) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
      if (event.key === 'ArrowRight') setOpen((i) => ((i ?? 0) + 1) % menus.length);
      if (event.key === 'ArrowLeft') setOpen((i) => ((i ?? 0) + menus.length - 1) % menus.length);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, menus.length]);

  const unavailable = useCallback(
    (node: MenuNode): string | null => {
      if (node.kind !== 'command') return null;
      const action = node.action;
      if (action.type === 'dropped') return action.reason;
      // A command line this client can never honour — `UNAVAILABLE_COMMANDS`.
      if (action.type === 'do') return UNAVAILABLE_COMMANDS[action.command] ?? null;
      if (action.type !== 'hook') return null;
      const impossible = UNAVAILABLE_HOOKS[action.hook];
      if (impossible) return impossible;
      if (runtime.hooks[action.hook]) return null;
      const owner = HOOK_OWNERS[action.hook];
      if (owner) return `not built yet — ${owner.owner} owns it (${owner.note})`;
      const appended = APPENDED_OWNERS[action.hook];
      if (appended) return `not built yet — ${appended}`;
      return 'no handler in this client';
    },
    [runtime],
  );

  /** Live truth for a leaf that IS usable — see `MenuListProps.annotate`. */
  const annotate = useCallback(
    (node: MenuNode): string | null => {
      if (node.kind !== 'command' || node.action.type !== 'do') return null;
      return stereoTooltip(node.action.command, clientReps);
    },
    [clientReps],
  );

  /**
   * `Display ▸ Stereo Mode ▸ …` ran — say what actually happened.
   *
   * `{t:'do'}` answers `ok` even when PyMOL rejected the line (MEASURED: both
   * `stereo quadbuffer` and `stereo openvr` reply ok and only print an error),
   * and three of the leaves do something their label does not say. So the state
   * is read BACK and turned into one console line. `stereoNote` returns null
   * when the label was already the whole truth, so this is not chatter.
   */
  const noteStereo = useCallback(
    async (command: string) => {
      try {
        const [stereo, stereoMode] = await Promise.all([
          session.call<string>('cmd.get', ['stereo']),
          session.call<string>('cmd.get', ['stereo_mode']),
        ]);
        const line = stereoNote(command, { stereo: String(stereo), stereoMode: String(stereoMode) }, clientReps);
        if (line) note(line);
      } catch {
        /* offline: PyMOL's own echo is still in the console */
      }
    },
    [session, clientReps, note],
  );

  const pick = useCallback(
    (node: MenuNode) => {
      setOpen(null);
      if (node.kind === 'command') {
        const action = node.action;
        void runAction(runtime, action).then(() => {
          if (action.type === 'do' && stereoLeaf(action.command)) void noteStereo(action.command);
        });
      } else if (node.kind === 'check') {
        const current = values[node.setting];
        const on = current ? String(current.value) !== String(node.falseValue) : false;
        void setSetting(runtime, node.setting, on ? node.falseValue : node.trueValue);
      } else if (node.kind === 'radio') {
        void setSetting(runtime, node.setting, node.value);
      }
      // Anything at all may have changed a setting (`util.performance` sets a
      // dozen). While the tap is live that write comes back as a batch of
      // indices and the subscription above re-reads; this timer is the fallback
      // for a bridge that has no tap.
      if (!tap.live) window.setTimeout(() => void refresh(open), 120);
    },
    [runtime, values, refresh, open, tap, noteStereo],
  );

  /* ---------------- Open Recent ---------------- */

  // Qt clears and rebuilds this submenu on EVERY `aboutToShow`
  // (`pymol_qt_gui.py:341-347`), so it is fetched on open and never cached
  // across opens. The DB is server-side (`~/.pymol/recent.db`, `_gui.py:975`)
  // precisely so it survives a browser-storage clear.
  const loadRecent = useCallback(async () => {
    // …once per open: `recent` for the reads that already landed,
    // `recentFetch` for the one still in the air (see the ref's own note).
    if (recent || recentFetch.current) return;
    const fetching = (async () => {
      try {
        const files = await source.recent();
        setRecent({ files: Array.isArray(files) ? files : [], error: null });
      } catch (error) {
        setRecent({
          files: [],
          error: `recent files unavailable: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    })();
    recentFetch.current = fetching;
    await fetching;
  }, [recent, source]);

  const renderDynamic = useCallback(
    (node: Extract<MenuNode, { kind: 'dynamic' }>) => {
      void node;
      void loadRecent();
      return (
        <DynamicList
          items={(recent?.files ?? []).map((file) => ({
            label: truncateRecentLabel(file),
            value: file,
          }))}
          empty={recent?.error ?? 'no recent files'}
          onPick={(file) => {
            setOpen(null);
            // Qt calls `load_dialog(fname)` (`pymol_qt_gui.py:367-375`), i.e.
            // the FULL dispatcher: a `.pse` asks the partial question, a `.mtz`
            // opens the reflection dialog, a `.dcd` the trajectory one. That
            // pipeline is `features/files`, which publishes `requestFilesOpen`
            // for exactly this call site. Loaded on CLICK, like the Qt handler's
            // own deferred import, so the menu bar does not pull the file
            // feature into its bundle to render a submenu.
            void (async () => {
              try {
                const { requestFilesOpen } = await import('../files/menuHooks');
                requestFilesOpen([file]);
              } catch {
                // No file feature in this build: the bare line is still what
                // `load_dialog` does for every ordinary structure file, and it
                // goes out as `{t:'do'}` so the console echoes it.
                await session.run(`load ${file}`);
              }
            })();
          }}
        />
      );
    },
    [loadRecent, recent, session],
  );

  /* ---------------- render ---------------- */

  return (
    <>
      <div className="menubar__menus" ref={rootRef}>
        {menus.map((menu, index) =>
          menu.kind !== 'submenu' ? null : (
            <div className="menubar__item-wrap" key={menu.label}>
              <button
                type="button"
                className={'menubar__item' + (open === index ? ' is-open' : '')}
                aria-haspopup="menu"
                aria-expanded={open === index}
                onClick={() => setOpen(open === index ? null : index)}
                onMouseEnter={() => open !== null && setOpen(index)}
              >
                {menu.label}
              </button>
              {open === index && (
                <MenuList
                  nodes={menu.items}
                  values={values}
                  onPick={pick}
                  renderDynamic={renderDynamic}
                  unavailable={unavailable}
                  annotate={annotate}
                />
              )}
            </div>
          ),
        )}
      </div>
      <span className="menubar__spacer" />
      <span className="menubar__note" title={MENU_DATA.source}>
        {MENU_DATA.menus.length} menus · {MENU_DATA.settings.length} settings
      </span>
      {about && <AboutDialog lines={about} onClose={() => setAbout(null)} />}
      <ToolkitDialogHost dialog={toolkit.dialog} onClose={toolkit.close} />
    </>
  );
}
