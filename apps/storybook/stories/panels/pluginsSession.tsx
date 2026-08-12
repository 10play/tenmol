/**
 * A per-story session that answers every read the {@link PluginManager} and its
 * {@link LegacyPlugins} tab issue on mount, so the panel renders POPULATED — a
 * real list of discovered plugins, live preferences, an editable startup-path
 * list, and a registered legacy-plugin menu tree — instead of the hollow
 * "no plugins found" shell the empty stub session produces.
 *
 * Nothing here reaches a bridge. Every payload is the exact shape an idle engine
 * would return after `plugins.initialize(-2)`:
 *   - `plugins.get_startup_path` / `[true]`  -> the search path, user slice first
 *   - `plugins.findPlugins`                  -> `{name: filename}` for each file
 *   - `plugins.pref_get`                     -> the two writable preferences
 *   - `plugins.autoload.copy`                -> the per-plugin enabled map
 *   - `cmd.tenmol_plugins.hello` / `.menu`   -> the recorded `addmenuitem` tree
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** The user-editable slice of the startup path: two lab-managed directories. */
const USER_PATHS = ['/home/rna-lab/pymol/plugins', '/opt/shared/pymol-plugins'];

/** The fixed installation tail `set_startup_path` may never cross. */
const INSTALL_PATHS = [
  '/usr/lib/python3.11/site-packages/pmg_tk/startup',
  '/usr/share/pymol/data/startup',
];

/** `findPlugins` returns `{name: filename}` — the files discovered on the path. */
const FOUND: Record<string, string> = {
  apbs_gui: '/usr/lib/python3.11/site-packages/pmg_tk/startup/apbs_gui/__init__.py',
  lightingsettings_gui:
    '/usr/lib/python3.11/site-packages/pmg_tk/startup/lightingsettings_gui.py',
  pymolprobity: '/home/rna-lab/pymol/plugins/pymolprobity/__init__.py',
  contact_map_visualizer: '/opt/shared/pymol-plugins/contact_map_visualizer/__init__.py',
  psico: '/opt/shared/pymol-plugins/psico/__init__.py',
  pymol2glmol: '/home/rna-lab/pymol/plugins/pymol2glmol.py',
  msms_plugin: '/home/rna-lab/pymol/plugins/msms_plugin.py',
  cheshift: '/opt/shared/pymol-plugins/cheshift/__init__.py',
};

/** `plugins.autoload` — a MISSING key means enabled, so only the off ones appear. */
const AUTOLOAD: Record<string, boolean> = {
  msms_plugin: false,
  cheshift: false,
};

/** The two preferences the Settings tab writes; PyMOL's own defaults. */
const PREFS: Record<string, boolean> = { verbose: false, instantsave: true };

/**
 * The recorded `plugins.addmenuitem` tree the Legacy Plugins tab reads. A `|` in
 * a label makes a submenu and a bare `-` makes a separator, exactly as upstream.
 */
const LEGACY_MENU = {
  ok: true,
  keys: ['Plugin', 'Plugin|psico'],
  menus: [
    {
      key: 'Plugin',
      label: 'Plugin',
      items: [
        { kind: 'command', index: 0, label: 'PyMOLProbity: run MolProbity' },
        { kind: 'command', index: 1, label: 'Contact Map Visualizer' },
        { kind: 'separator', index: 2, label: '-' },
        {
          kind: 'menu',
          index: 3,
          label: 'psico',
          key: 'Plugin|psico',
          items: [
            { kind: 'command', index: 0, label: 'Fetch and align (fetch_align)' },
            { kind: 'command', index: 1, label: 'Save current session' },
            { kind: 'separator', index: 2, label: '-' },
            { kind: 'command', index: 3, label: 'About psico…' },
          ],
        },
        { kind: 'command', index: 4, label: 'MSMS molecular surface' },
      ],
    },
  ],
};

/** Answer every plugin-manager read; anything unrecognised falls to null. */
function pluginsCall(fn: string, args?: readonly unknown[]): unknown {
  switch (fn) {
    case 'plugins.initialize':
      return null;
    case 'plugins.get_startup_path':
      return args?.[0] === true ? USER_PATHS : [...USER_PATHS, ...INSTALL_PATHS];
    case 'plugins.findPlugins':
      return FOUND;
    case 'plugins.pref_get': {
      const key = args?.[0] as string;
      return PREFS[key] ?? false;
    }
    case 'plugins.autoload.copy':
      return AUTOLOAD;
    // --- Legacy Plugins tab (cmd.tenmol_plugins.*) ---
    case 'cmd.tenmol_plugins.hello':
      return { ok: true };
    case 'cmd.tenmol_plugins.menu':
      return LEGACY_MENU;
    case 'cmd.tenmol_plugins.invoke':
      return { ok: true, label: 'plugin action' };
    default:
      return null;
  }
}

/** Wrap a story in a session that reports a populated plugin registry. */
export const withPlugins: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string, args?: readonly unknown[]) =>
      Promise.resolve(pluginsCall(fn, args))) as Session['call'],
    // LegacyPlugins kicks the poller after invoking a leaf; the stub poller only
    // has `stats`, so add an inert `kick` to keep a click from throwing.
    poller: { ...base.poller, kick: () => undefined },
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
