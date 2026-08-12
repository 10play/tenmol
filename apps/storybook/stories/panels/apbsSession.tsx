/**
 * A per-story session for the APBS panel whose `call()` answers the probe's
 * four endpoints as a machine that HAS the toolchain: `apbs` and `pdb2pqr`
 * resolve to real paths, and the `apbs_gui` plugin is on the startup path.
 *
 * The panel ({@link ApbsPanel}) mounts and immediately runs {@link probeApbs},
 * which fans out to `plugins.get_startup_path`, `plugins.findPlugins`,
 * `cmd.exp_path` and `subproc.which`. The global `withSession` decorator returns
 * `null` for every call, so the probe resolves to "not found" for both programs
 * and the panel renders its honest empty state. This decorator instead returns
 * the shapes a fully-provisioned engine host would — so the panel shows its
 * POPULATED, runnable state: resolved binary paths, "both installed", and the
 * plugin located on the startup path.
 *
 * The paths mirror a normal conda/system install so the content reads as real
 * output rather than a placeholder. Not a `*.stories.tsx` file, so Storybook
 * does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** Where each located program resolves to, keyed by the name `subproc.which` is asked. */
const WHICH: Record<string, string> = {
  apbs: '/opt/conda/envs/tenmol/bin/apbs',
  pdb2pqr: '/opt/conda/envs/tenmol/bin/pdb2pqr30',
  pdb2pqr30: '/opt/conda/envs/tenmol/bin/pdb2pqr30',
  pdb2pqr_cli: '/opt/conda/envs/tenmol/bin/pdb2pqr30',
};

/** The startup directories PyMOL scans for autoloading plugins. */
const STARTUP_PATH = [
  '/opt/conda/envs/tenmol/lib/python3.11/site-packages/pmg_tk/startup',
  '/home/tenmol/.pymol/startup',
];

/** The answer for one probe RPC, standing in for a provisioned engine host. */
function apbsPayload(fn: string, args?: readonly unknown[]): unknown {
  switch (fn) {
    /* the directories scanned for autoloading plugins */
    case 'plugins.get_startup_path':
      return STARTUP_PATH;

    /* the plugin scan sees apbs_gui on that path */
    case 'plugins.findPlugins':
      return {
        apbs_gui: `${STARTUP_PATH[0]}/apbs_gui`,
        pymolscript: `${STARTUP_PATH[0]}/pymolscript`,
      };

    /* $SCHRODINGER is unset here, so exp_path returns the string unchanged */
    case 'cmd.exp_path':
      return (args?.[0] as string) ?? '';

    /* resolve real binaries for the known program names, null otherwise */
    case 'subproc.which': {
      const target = String(args?.[0] ?? '');
      return WHICH[target] ?? null;
    }

    default:
      return null;
  }
}

/**
 * Wrap a story in a session that answers the APBS probe as a host with the full
 * toolchain installed, so the panel renders its populated runnable state.
 */
export const withApbsInstalled: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string, args?: readonly unknown[]) =>
      Promise.resolve(apbsPayload(fn, args))) as Session['call'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
