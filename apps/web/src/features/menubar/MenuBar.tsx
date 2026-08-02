/**
 * The menu bar: File, Edit, Build, Movie, Display, Setting, Scene, Mouse,
 * Wizard, Plugin, Help.
 *
 * Qt builds these by walking `get_menudata` in `_addmenu`
 * (`modules/pmg_qt/pymol_qt_gui.py:295-352`) and then appending two things
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
 * Setting-bound state is fetched when a menu OPENS (`cmd.get_setting_tuple` per
 * distinct setting in that menu's subtree, in parallel) and again after any
 * click that could have changed it. That is the same contract as Qt's
 * `setting_callbacks`, minus the push channel — `cmd.get_setting_updates` is
 * owned exclusively by the bridge status thread (plan §1.2) and a second
 * consumer would split the stream.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MenuNode, MenuSettingValue, MenusPayload } from '@tenmol/protocol/topics/menus';
import { truncateRecentLabel } from '@tenmol/protocol/topics/menus';
import { useSession } from '../../app';
import { menuHooks, subscribeMenuHooks } from '../../shell/panelHooks';
import { ToolkitDialogHost, useToolkitHooks } from './toolkitHooks';
import { MENU_DATA } from './generated/menudata';
import { createMenuSource } from './menuSource';
import { DynamicList, MenuList } from './MenuList';
import { AboutDialog } from './AboutDialog';
import { HOOK_OWNERS, UNAVAILABLE_HOOKS, settingsIn } from './model';
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
  const [tree, setTree] = useState<MenusPayload>(MENU_DATA);
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
    if (open === null) setRecent(null);
  }, [open, refresh]);

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

  const pick = useCallback(
    (node: MenuNode) => {
      setOpen(null);
      if (node.kind === 'command') {
        void runAction(runtime, node.action);
      } else if (node.kind === 'check') {
        const current = values[node.setting];
        const on = current ? String(current.value) !== String(node.falseValue) : false;
        void setSetting(runtime, node.setting, on ? node.falseValue : node.trueValue);
      } else if (node.kind === 'radio') {
        void setSetting(runtime, node.setting, node.value);
      }
      // Anything at all may have changed a setting (`util.performance` sets a
      // dozen), so re-read this menu's settings after the click lands.
      window.setTimeout(() => void refresh(open), 120);
    },
    [runtime, values, refresh, open],
  );

  /* ---------------- Open Recent ---------------- */

  // Qt clears and rebuilds this submenu on EVERY `aboutToShow`
  // (`pymol_qt_gui.py:341-347`), so it is fetched on open and never cached
  // across opens. The DB is server-side (`~/.pymol/recent.db`, `_gui.py:975`)
  // precisely so it survives a browser-storage clear.
  const loadRecent = useCallback(async () => {
    if (recent) return;
    try {
      const files = await source.recent();
      setRecent({ files: Array.isArray(files) ? files : [], error: null });
    } catch (error) {
      setRecent({
        files: [],
        error: `recent files unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
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
            // Qt calls `load_dialog(fname)`, which additionally routes .mtz,
            // .pse and multi-object formats through their own importers
            // (WP-18). Until that lands this runs the plain command line, which
            // is what `load_dialog` does for every ordinary structure file —
            // and it goes out as `{t:'do'}` so the console echoes it.
            void session.run(`load ${file}`);
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
