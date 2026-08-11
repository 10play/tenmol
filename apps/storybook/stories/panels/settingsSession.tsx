/**
 * A per-story session whose `conn` carries the topic-subscription surface the
 * settings service reaches for the moment it is constructed.
 *
 * `getSettingsService(session)` (the module that both {@link SettingsPanel} and
 * {@link LightingPanel}'s store come from) subscribes on creation:
 * `session.conn.on('settings', …)`, `session.conn.sub('settings')`, and it reads
 * `session.conn.do` / `.isOpen` plus `session.poller.kick`. The base stub `conn`
 * has none of those, so the panels crash with "session.conn.on is not a
 * function". This decorator supplies inert versions — `on` returns an
 * unsubscribe, `sub`/`do` resolve, `kick` no-ops — so the service builds and the
 * panels render their genuine, catalogue-less state. Nothing here reaches a
 * bridge; the engine simply holds nothing.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** Wrap a story in a session whose `conn` answers the settings-service seams. */
export const withSettingsData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    conn: {
      ...base.conn,
      isOpen: true,
      on: () => () => undefined,
      sub: () => Promise.resolve(),
      do: () => Promise.resolve(null),
    },
    poller: { ...base.poller, kick: () => undefined },
  } as unknown as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
