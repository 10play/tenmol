/**
 * The `settings` overlay slot: the Setting menu, the advanced settings table
 * and the lighting panel, plus the one launcher that opens them.
 *
 * The launcher exists because WP-14's menu bar is not installed yet and an
 * overlay nobody can open is an overlay nobody can test. When the menu bar
 * lands, its `Setting ▸ Edit All...` entry can open the same windows: the state
 * is in the module-level service (`./service.ts`), not in this component.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { SettingMeta } from '@tenmol/protocol';
import type { MenuCommandNode, MenuValue } from '@tenmol/protocol/topics/menus';
import { valueKey } from '@tenmol/stores/settings';
import { isLocal, useSession, useStore } from '../../app';
import { FloatingWindow } from '../../ui';
import { menuHooks, subscribeMenuHooks } from '../../shell/panelHooks';
import { HOOK_OWNERS, UNAVAILABLE_HOOKS } from '../menubar/model';
import { runAction, type MenuRuntime } from '../menubar/actions';
import { AdvancedSettingsTable } from './AdvancedSettingsTable';
import { LightingPanel } from './LightingPanel';
import { MenuDataRenderer, type MenuContext } from './SettingMenu';
import {
  MENUDATA_SOURCE,
  menuSubtree,
  menuValue,
  PANEL_MENUS,
  type PanelMenuName,
} from './menuTree';
import { getSettingsService } from './service';
import './settings.css';

type Window = 'menu' | 'table' | 'lighting';

/**
 * Per-variant window geometry. The three settings surfaces are logically
 * distinct windows, so each keeps its OWN `persistKey` — moving or resizing the
 * table must not drag the menu and lighting panels along with it — and its own
 * size. The Setting menu is a narrow column (Qt's `.setwin[data-window='menu']`
 * was 380px); the table and lighting panels want the full width. Keys match
 * `FloatingWindow` prop names so this spreads straight in.
 */
const WINDOW_GEOMETRY: Record<
  Window,
  {
    persistKey: string;
    defaultWidth: number;
    defaultHeight: number;
    minWidth: number;
    minHeight: number;
  }
> = {
  menu: {
    persistKey: 'settings-menu',
    defaultWidth: 380,
    defaultHeight: 560,
    minWidth: 300,
    minHeight: 320,
  },
  table: {
    persistKey: 'settings-table',
    defaultWidth: 620,
    defaultHeight: 560,
    minWidth: 400,
    minHeight: 400,
  },
  lighting: {
    persistKey: 'settings-lighting',
    defaultWidth: 620,
    defaultHeight: 560,
    minWidth: 400,
    minHeight: 400,
  },
};

/** The settings overlay: Setting menu, advanced settings table, lighting panel, and launcher. */
export function SettingsPanel() {
  const session = useSession();
  // The setting catalogue and its live values are bridge-served
  // (`setting.tenmol_settings_*`), which the in-browser engine has not ported.
  // The windows still OPEN and CLOSE in the browser-only build — that is a shell
  // affordance — but their contents are gated to a neutral note instead of the
  // "settings service unavailable" error the failing bootstrap would show.
  const local = isLocal(session);
  const service = useMemo(() => getSettingsService(session), [session]);
  const { store, source, poller } = service;

  const phase = useStore(store, (s) => s.phase);
  const error = useStore(store, (s) => s.lastError);
  const catalogue = useStore(store, (s) => s.catalogue);
  const entries = useStore(store, (s) => s.entries);
  const connection = useStore(session.stores.connection, (s) => s.phase);
  const objectRows = useStore(session.stores.objects, (s) => s.rows);
  const [open, setOpen] = useState<Window | null>(null);
  /** Which of the four data-driven menus the renderer is showing. */
  const [which, setWhich] = useState<PanelMenuName>('Setting');
  const external = useSyncExternalStore(subscribeMenuHooks, menuHooks, menuHooks);

  useEffect(() => {
    if (local || connection !== 'open') return;
    void service.ensure();
    poller.start();
    return () => poller.stop();
  }, [local, service, poller, connection]);

  const byName = useMemo(() => {
    const map = new Map<string, SettingMeta>();
    for (const meta of catalogue?.settings ?? []) map.set(meta.name, meta);
    return map;
  }, [catalogue]);

  const objects = useMemo(
    () => objectRows.filter((row) => !row.isAll).map((row) => row.name),
    [objectRows],
  );

  const write = useCallback(
    (setting: string, value: MenuValue) => {
      const meta = byName.get(setting);
      if (!meta) return;
      void source.write(meta, value).catch(() => undefined);
    },
    [byName, source],
  );

  /**
   * The seams this panel fills itself. `Setting ▸ Edit All...` is a `= None`
   * attribute of `PyMOLDesktopGUI` (`_gui.py:26`) that Qt binds to its own
   * settings dialog (`pymol_qt_gui.py:880`); the dialog it should open is two
   * lines below, so it is bound here rather than registered globally — the
   * menu bar's copy of the same leaf goes through `toolkitHooks.tsx`.
   */
  const localHooks = useMemo(
    () => ({
      settings_edit_all_dialog: () => setOpen('table'),
    }),
    [],
  );

  const runtime: MenuRuntime = useMemo(
    () => ({
      run: (line: string) => session.run(line),
      call: (fn: string, args?: unknown[], kwargs?: Record<string, unknown>) =>
        session.call(fn, args ?? [], kwargs ?? {}),
      note: (line: string, kind?: 'warning' | 'error') =>
        session.stores.feedback.appendClient(line, kind),
      openUrl: (url: string) => window.open(url, '_blank', 'noopener,noreferrer'),
      // A feature that owns a dialog wins over this panel's stand-in, exactly
      // as in `MenuBar`.
      hooks: { ...localHooks, ...external },
    }),
    [session, localHooks, external],
  );

  const run = useCallback(
    (node: MenuCommandNode) => {
      void (async () => {
        await runAction(runtime, node.action);
        // A command node may write many settings at once (the Transparency
        // presets write three, `util.performance` a dozen); the 5 Hz tap will
        // report them, but a kick moves the check marks immediately.
        await source.poll().catch(() => undefined);
      })();
    },
    [runtime, source],
  );

  const ctx: MenuContext = useMemo(
    () => ({
      valueOf: (name: string) => {
        const meta = byName.get(name);
        return menuValue(meta, meta ? entries[valueKey(meta.index)]?.value : undefined);
      },
      write,
      run,
      hook: (name: string) => (UNAVAILABLE_HOOKS[name] ? undefined : runtime.hooks[name]),
      hookNote: (name: string) => {
        const impossible = UNAVAILABLE_HOOKS[name];
        if (impossible) return `${name}: ${impossible}`;
        const owner = HOOK_OWNERS[name];
        return owner
          ? `not built yet — ${owner.owner} owns it (${owner.note})`
          : `"${name}" has no handler in this client`;
      },
    }),
    [byName, entries, write, run, runtime],
  );

  return (
    <>
      <div
        className="setlaunch modern:rounded-md modern:border modern:border-line-strong modern:bg-[var(--sh-panel-frost)] modern:[backdrop-filter:var(--sh-blur)] modern:shadow-[var(--sh-pop)] modern:px-1 modern:py-0.5"
        role="group"
        aria-label="Settings"
      >
        <button
          type="button"
          className="modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text modern:transition-colors modern:hover:bg-btn-hover modern:hover:text-pm-text-bright"
          onClick={() => setOpen(open === 'menu' ? null : 'menu')}
        >
          Setting
        </button>
        <button
          type="button"
          className="modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text modern:transition-colors modern:hover:bg-btn-hover modern:hover:text-pm-text-bright"
          onClick={() => setOpen(open === 'table' ? null : 'table')}
        >
          Edit All…
        </button>
        <button
          type="button"
          className="modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text modern:transition-colors modern:hover:bg-btn-hover modern:hover:text-pm-text-bright"
          onClick={() => setOpen(open === 'lighting' ? null : 'lighting')}
        >
          Lighting
        </button>
        <span
          className={`setlaunch__state setlaunch__state--${local ? 'local' : phase}`}
          title={local ? '' : (error ?? '')}
        >
          {local ? 'browser-only' : phase === 'ready' ? `${catalogue?.count ?? 0} settings` : phase}
        </span>
      </div>

      {open && (
        <FloatingWindow
          // One <FloatingWindow> serves all three variants, but they are
          // logically distinct windows with their OWN geometry: `open` can go
          // straight from one truthy value to another (Edit All… while the
          // Setting menu is open is 'menu' -> 'table', never through null), and
          // without a changing key React would keep the same instance and its
          // one-shot geometry — so the table would inherit the menu's 380px
          // width and then persist it under `settings-table`. Keying on `open`
          // remounts per variant, so each reads its own default/persisted rect.
          key={open}
          title={
            open === 'menu'
              ? which
              : open === 'table'
                ? 'PyMOL Advanced Settings'
                : 'Lighting Settings'
          }
          onClose={() => setOpen(null)}
          anchor="right"
          {...WINDOW_GEOMETRY[open]}
          data-testid="settings-window"
          className="modern:bg-pm-panel modern:text-pm-text modern:border-line"
        >
          <div className="setwin__body">
            {local ? (
              <p className="setwin__status modern:text-pm-text-dim">
                The setting catalogue lives on the PyMOL bridge and is inactive in the browser-only
                build. Connect to a bridge to edit settings here.
              </p>
            ) : phase !== 'ready' ? (
              <p className="setwin__status modern:text-pm-text-dim">
                {phase === 'error'
                  ? `settings service unavailable: ${error ?? 'unknown error'}`
                  : 'loading the setting catalogue…'}
              </p>
            ) : open === 'menu' ? (
              <>
                {/*
                 * ONE renderer, four menus. `_gui.py`'s Setting, Display,
                 * Mouse and Scene menus are the four that are (almost)
                 * entirely check/radio over settings, and the whole point of
                 * `get_menudata` is that nothing about them is special-cased
                 * per menu — so the picker changes the DATA, not the code.
                 */}
                <div className="setmenu__tabs modern:border-line" role="tablist" aria-label="menu">
                  {PANEL_MENUS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      role="tab"
                      aria-selected={which === name}
                      className={`setmenu__tab modern:rounded modern:transition-colors${
                        which === name
                          ? ' is-on modern:bg-pm-accent modern:text-accent-text modern:border-transparent'
                          : ' modern:text-pm-text-dim modern:hover:text-pm-text-bright'
                      }`}
                      onClick={() => setWhich(name)}
                    >
                      {name}
                    </button>
                  ))}
                  <span
                    className="setmenu__source modern:text-pm-text-dim"
                    title={`${MENUDATA_SOURCE} — harvested by packages/bridge/tenmol_bridge/panels/menus.py`}
                  >
                    get_menudata
                  </span>
                </div>
                <MenuDataRenderer nodes={menuSubtree(which)} ctx={ctx} />
              </>
            ) : open === 'table' ? (
              <AdvancedSettingsTable
                store={store}
                source={source}
                objects={objects}
                call={(fn, args) => session.call(fn, args)}
              />
            ) : (
              <LightingPanel store={store} source={source} />
            )}
          </div>
        </FloatingWindow>
      )}
    </>
  );
}
