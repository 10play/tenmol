/**
 * `apps/web/src/app` — the application layer: configuration, the session, the
 * React context and the store hooks.
 *
 * A feature imports from here and from `@tenmol/stores`, never from
 * `@tenmol/client` directly. There is exactly one socket and one set of stores
 * in the process; that invariant is only enforceable if the transport has one
 * entry point.
 */

export { default as App } from './App';
export { BridgeProvider, SessionContext } from './BridgeProvider';
export { getSession, isLocal, errorText, type Session, type SessionStores } from './session';
export { resolveBridgeConfig, withToken, type BridgeConfig } from './config';
export { useSession, useStore, useShallowStore, useStoreState } from './hooks';
