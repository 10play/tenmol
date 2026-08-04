/**
 * Puts the session on the React context.
 *
 * That is all it does. The session is a module singleton created on first
 * import (`./session.ts`), so this provider has no effects, no cleanup and no
 * StrictMode double-mount hazard: mounting it twice in development opens exactly
 * one socket, subscribes exactly once and starts exactly one poll loop.
 */

import { createContext, type ReactNode } from 'react';
import { getSession, type Session } from './session';

export const SessionContext = createContext<Session | null>(null);

export function BridgeProvider({
  children,
  session = getSession(),
}: {
  children: ReactNode;
  /** Injectable for tests and for a future second window. */
  session?: Session;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
