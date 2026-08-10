/**
 * The two decorators every story runs through.
 *
 *  - `withTheme` mounts the app's real {@link ThemeProvider} so `useTheme()`
 *    returns the toolbar's `theme` (classic ⇄ shadcn) and stamps
 *    `data-ui-theme` / `data-appearance` on the preview's `<html>`, exactly as
 *    the app does — so a story is styled by the same CSS the app ships.
 *  - `withSession` puts a stub {@link Session} on React context, so feature
 *    bundles that call `useSession()` / `useStore()` render without a bridge.
 */

import { useEffect, type ReactNode } from 'react';
import type { Decorator } from '@storybook/react-vite';

import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsStore,
  createUiStore,
} from '@tenmol/stores';
import { ThemeProvider, type UiTheme, type UiAppearance } from '@web/ui/theme';
import { SessionContext } from '@web/app/BridgeProvider';
import { type Session } from '@web/app/session';

/** Reflects the toolbar globals onto `<html>` and provides the theme context. */
function ThemeHost({
  theme,
  appearance,
  children,
}: {
  theme: UiTheme;
  appearance: UiAppearance;
  children: ReactNode;
}) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-ui-theme', theme);
    root.setAttribute('data-appearance', appearance);
  }, [theme, appearance]);
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

/** Wraps a story in the real ThemeProvider, driven by the `theme`/`appearance` globals. */
export const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals['theme'] as UiTheme) ?? 'classic';
  const appearance = (context.globals['appearance'] as UiAppearance) ?? 'dark';
  return (
    <ThemeHost theme={theme} appearance={appearance}>
      <div
        data-sb-canvas=""
        style={{
          minHeight: '100%',
          padding: '24px',
          background: 'var(--pm-bg)',
          color: 'var(--pm-text)',
          fontFamily: 'var(--pm-font-ui)',
        }}
      >
        <Story />
      </div>
    </ThemeHost>
  );
};

/**
 * A stub {@link Session}: real stores from `@tenmol/stores` so components that
 * read `session.stores.*` behave, and inert async stubs for the command surface
 * (`run` / `act` / `call`) so a click in a story never reaches a bridge.
 */
export function mockSession(): Session {
  const stores = {
    connection: createConnectionStore('ws://storybook/ws', true),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    ui: createUiStore(null),
  };
  const noop = () => Promise.resolve();
  return {
    config: {} as Session['config'],
    conn: { sendInput: () => undefined, isOpen: true },
    stores,
    objectsSource: { poll: () => Promise.resolve(), invalidate: () => undefined },
    poller: { stats: () => ({ hz: 30 }) },
    run: noop,
    act: noop,
    call: () => Promise.resolve(null),
    reconnect: () => undefined,
    disconnect: () => undefined,
    useToken: () => undefined,
    probeHealth: () => Promise.resolve({}),
  } as unknown as Session;
}

const SESSION = mockSession();

/** Provides the stub session so `useSession()`-based feature bundles render. */
export const withSession: Decorator = (Story) => (
  <SessionContext.Provider value={SESSION}>
    <Story />
  </SessionContext.Provider>
);
