/**
 * A per-story session whose `call()` answers the aggregate panel endpoints with
 * VALID EMPTY payloads instead of the base stub's blanket `null`.
 *
 * Several internal-gui panels bootstrap by reading a snapshot the moment they
 * mount — `get_movie_status`, `get_scene_panel`, `wizards.probe` — and pipe the
 * answer straight into render. The global `withSession` decorator returns `null`
 * for every call (there is no bridge in Storybook), so those panels dereference
 * `null` and crash. This decorator supplies the same shapes an idle engine would
 * return: a zero-frame movie, an empty scene bin, a wizard stack of depth 0. The
 * panels then render their genuine EMPTY state — chrome, controls and all — with
 * nothing faked beyond "the engine is up and holds nothing".
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** `WIZARD_RPC.probe` from `@tenmol/protocol` — inlined so this helper needs no
 * dependency on the protocol package, which the storybook stories dir cannot
 * resolve (only `@tenmol/stores` and the `@web` alias are on its path). */
const WIZARD_PROBE_RPC = 'wizards.probe';

/** The shape each aggregate endpoint returns for an up-but-empty engine. */
function idlePayload(fn: string): unknown {
  switch (fn) {
    /* movie — a zero-frame, stopped movie */
    case 'cmd.get_movie_status':
      return {
        frame: 1,
        state: 1,
        nframes: 0,
        length: 0,
        playing: false,
        locked: false,
        rocking: false,
        fps: null,
        sceneCurrent: null,
        settings: {},
      };
    case 'cmd.get_movie_panel':
      return null;

    /* scenes — an empty scene bin */
    case 'cmd.get_scene_panel':
      return { order: [], current: null, scenes: [] };
    case 'cmd.get_scene_list':
      return [];

    /* wizards — nothing on the stack */
    case WIZARD_PROBE_RPC:
      return { version: 0, depth: 0, cls: null, module: null };

    default:
      return null;
  }
}

/**
 * Wrap a story in a session that returns idle-but-valid payloads, so panels
 * that read a bootstrap snapshot on mount render instead of crashing.
 */
export const withPanelData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string) => Promise.resolve(idlePayload(fn))) as Session['call'],
    // `useViews` reads the named-view list from the MESSAGE of a deliberately
    // failing `cmd.view` probe (there is no getter upstream). Reject with the
    // "unknown view" listing shape but no `Choices:` block, which `parseViewNames`
    // reads as "zero views" — so the embedded Views list shows its clean empty
    // state instead of "session.conn.call is not a function".
    conn: {
      ...base.conn,
      call: () => Promise.reject(new Error('unknown view: __tenmol_view_probe__')),
    },
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
