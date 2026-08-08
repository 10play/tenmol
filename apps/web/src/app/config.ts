/**
 * Where the bridge is, and how we are allowed to talk to it.
 *
 * The bridge mints a 256-bit session token at startup and requires it on `/ws`
 * and `/blob` (`packages/bridge/tenmol_bridge/config.py`, `server.py`). It writes that
 * token to stderr, or to a mode-0600 file with `--token-file`. A browser tab can
 * read neither, so the token has to be handed to the page. Three ways, in
 * priority order:
 *
 *   1. `?token=...` in the page URL — what a `pymol --web` launcher will do when
 *      it opens the browser. Consumed once, stashed, then STRIPPED from the
 *      address bar so it does not end up in history or a screenshot.
 *   2. `localStorage`, from step 1 on a previous load.
 *   3. `VITE_TENMOL_TOKEN` at build/dev time.
 *
 * With none of those the socket is still attempted: `python -m tenmol_bridge
 * --no-token` is the normal development configuration, and the bridge answers
 * `4401` if a token was in fact required — which the UI reports as exactly that
 * ("rejected: session token required") instead of retrying forever in silence.
 */

import { DEFAULT_WS_URL } from '@tenmol/protocol';

const TOKEN_KEY = 'tenmol.token';

/** Resolved bridge endpoint and the token used to reach it. */
export interface BridgeConfig {
  /** Full ws:// URL including the token query parameter, if any. */
  url: string;
  /** Base URL without credentials — what the status bar shows. */
  displayUrl: string;
  /** HTTP origin of the bridge, for `/healthz` and `/blob`. */
  httpOrigin: string;
  token: string | null;
  /** Where the token came from, for the connection panel. */
  tokenSource: 'url' | 'storage' | 'env' | 'none';
}

/** Resolve the bridge config, taking the token from URL, storage or env. */
export function resolveBridgeConfig(): BridgeConfig {
  const base = readEnv('VITE_TENMOL_WS_URL') ?? DEFAULT_WS_URL;
  const fromQuery = takeTokenFromLocation();
  const stored = readStoredToken();
  const fromEnv = readEnv('VITE_TENMOL_TOKEN');

  const token = fromQuery ?? stored ?? fromEnv ?? null;
  const tokenSource: BridgeConfig['tokenSource'] = fromQuery
    ? 'url'
    : stored
      ? 'storage'
      : fromEnv
        ? 'env'
        : 'none';

  return { ...buildUrls(base, token), token, tokenSource };
}

/** Rebuild the config with a different token (the connection panel's input). */
export function withToken(config: BridgeConfig, token: string | null): BridgeConfig {
  storeToken(token);
  return {
    ...buildUrls(config.displayUrl, token),
    token,
    tokenSource: token ? 'storage' : 'none',
  };
}

function buildUrls(base: string, token: string | null) {
  let url = base;
  let displayUrl = base;
  let httpOrigin = base.replace(/^ws/, 'http').replace(/\/ws$/, '');
  try {
    const parsed = new URL(base);
    parsed.searchParams.delete('token');
    displayUrl = parsed.toString();
    if (token) parsed.searchParams.set('token', token);
    url = parsed.toString();
    httpOrigin = `${parsed.protocol === 'wss:' ? 'https:' : 'http:'}//${parsed.host}`;
  } catch {
    // A malformed VITE_TENMOL_WS_URL should surface as a connection error, not
    // as a blank page.
    if (token) url = `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  }
  return { url, displayUrl, httpOrigin };
}

function readEnv(key: 'VITE_TENMOL_WS_URL' | 'VITE_TENMOL_TOKEN'): string | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key];
  return value && value.length > 0 ? value : null;
}

/** Read `?token=` and remove it from the address bar in the same breath. */
function takeTokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return null;
  storeToken(token);
  params.delete('token');
  const query = params.toString();
  const clean = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  try {
    window.history.replaceState(null, '', clean);
  } catch {
    /* file:// and sandboxed iframes forbid this; the token simply stays visible */
  }
  return token;
}

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage disabled: the token lives for this page load only */
  }
}
