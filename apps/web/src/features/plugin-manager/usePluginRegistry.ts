/**
 * Read-only view of PyMOL's plugin registry.
 *
 * SCOPE DECISION (product owner, wave 3): v1 ships the Plugin Manager
 * READ-ONLY — list, preferences, startup paths. Install-from-file,
 * install-from-URL and repository browse are cut, because those paths download
 * and execute arbitrary Python from the network into the user's interpreter,
 * guarded only by `confirm_network_access()` (`modules/pymol/plugins/
 * managergui_qt.py:11`). Exposing that through a localhost web service is a
 * materially worse posture than the desktop app has.
 *
 * No bridge panel is involved: `panels/__init__.py` is a frozen barrel and
 * `plugins` is not in it. Everything here goes through the ordinary dispatcher,
 * whose default rule resolves an unlisted root to `pymol.<root>`
 * (`bridge/tenmol_bridge/dispatch.py:56-59`), so `plugins.findPlugins` is
 * literally `pymol.plugins.findPlugins`. Verified over the wire.
 */

import { useCallback, useEffect, useState } from 'react';

import { useSession } from '../../app';

/** One discovered plugin. `findPlugins` returns `{name: filename}` and nothing more. */
export interface DiscoveredPlugin {
  name: string;
  filename: string;
  /** Which entry of `get_startup_path()` this file came from. */
  startupPath: string;
}

export interface PluginRegistry {
  plugins: DiscoveredPlugin[];
  startupPaths: string[];
  preferences: { verbose: boolean; instantsave: boolean };
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const EMPTY: Omit<PluginRegistry, 'refresh'> = {
  plugins: [],
  startupPaths: [],
  preferences: { verbose: false, instantsave: true },
  loading: true,
  error: null,
};

export function longestOwningPath(filename: string, paths: readonly string[]): string {
  // A plugin directory nested under another startup path must attribute to the
  // deepest match, not the first.
  let best = '';
  for (const p of paths) {
    if (filename.startsWith(p) && p.length > best.length) best = p;
  }
  return best;
}

/** Minimal slice of `Session` this feature needs; keeps the loader React-free. */
export type CallFn = <T>(fn: string, args?: readonly unknown[]) => Promise<T>;

/**
 * The whole data load, as a plain async function so it is testable without a
 * renderer. The hook below is a thin wrapper over this.
 */
export async function loadPluginRegistry(
  call: CallFn,
): Promise<Omit<PluginRegistry, 'refresh' | 'loading' | 'error'>> {
  const startupPaths = (await call<string[]>('plugins.get_startup_path')) ?? [];
  const found = (await call<Record<string, string>>('plugins.findPlugins', [startupPaths])) ?? {};
  // pref_get is one call per key; there are only two and they are cheap.
  const [verbose, instantsave] = await Promise.all([
    call<boolean>('plugins.pref_get', ['verbose', false]),
    call<boolean>('plugins.pref_get', ['instantsave', true]),
  ]);

  const plugins = Object.entries(found)
    .map(([name, filename]) => ({
      name,
      filename,
      startupPath: longestOwningPath(filename, startupPaths),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    plugins,
    startupPaths,
    preferences: { verbose: Boolean(verbose), instantsave: Boolean(instantsave) },
  };
}

export function usePluginRegistry(): PluginRegistry {
  const session = useSession();
  const [state, setState] = useState(EMPTY);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    void (async () => {
      try {
        const loaded = await loadPluginRegistry((fn, args) => session.call(fn, args));
        if (cancelled) return;
        setState({ ...loaded, loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        // session.call already reported this in the console; surface it here too
        // rather than rendering an empty list that looks like "no plugins".
        setState({ ...EMPTY, loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, nonce]);

  return { ...state, refresh };
}
