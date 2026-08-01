/**
 * View of PyMOL's plugin registry.
 *
 * SCOPE DECISION (product owner, wave 3): v1 ships the Plugin Manager
 * READ-ONLY — list, preferences, startup paths — with ONE exception added in
 * wave 6, the per-plugin `autoload` checkbox (inventory row 463), which writes
 * only PyMOL's own `~/.pymolpluginsrc.py`. Install-from-file,
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

import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '../../app';
import {
  initializePluginSystem,
  isAutoloadEnabled,
  readAutoload,
  setAutoload,
  type CallFn,
} from './pluginSystem';

/** One discovered plugin. `findPlugins` returns `{name: filename}` and nothing more. */
export interface DiscoveredPlugin {
  name: string;
  filename: string;
  /** Which entry of `get_startup_path()` this file came from. */
  startupPath: string;
  /**
   * `PluginInfo.autoload` — enabled at startup. Absent from the `autoload` dict
   * means enabled, which is why this is resolved here and not left nullable.
   */
  autoload: boolean;
}

export interface PluginRegistry {
  plugins: DiscoveredPlugin[];
  startupPaths: string[];
  preferences: { verbose: boolean; instantsave: boolean };
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Flip one plugin's enabled-at-startup flag. Rejects if the scan failed. */
  setAutoload: (name: string, enabled: boolean) => Promise<void>;
  /** Name of the plugin whose checkbox is mid-flight, or null. */
  saving: string | null;
}

const EMPTY: Omit<PluginRegistry, 'refresh' | 'setAutoload' | 'saving'> = {
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

export type { CallFn } from './pluginSystem';

/**
 * The whole data load, as a plain async function so it is testable without a
 * renderer. The hook below is a thin wrapper over this.
 *
 * ORDER MATTERS. `plugins.initialize(-2)` comes FIRST because it is what reads
 * `~/.pymolpluginsrc.py`; the bridge never calls it, so without this line
 * `autoload` and the preferences are always PyMOL's compiled-in defaults and
 * any later write silently discards the user's saved choices (measured in
 * `bridge/tests/test_wf_plugins.py`). It imports no plugin code.
 */
export async function loadPluginRegistry(
  call: CallFn,
): Promise<Omit<PluginRegistry, 'refresh' | 'loading' | 'error' | 'setAutoload' | 'saving'>> {
  await initializePluginSystem(call);

  const startupPaths = (await call<string[]>('plugins.get_startup_path')) ?? [];
  const found = (await call<Record<string, string>>('plugins.findPlugins', [startupPaths])) ?? {};
  // pref_get is one call per key; there are only two and they are cheap.
  const [verbose, instantsave, autoload] = await Promise.all([
    call<boolean>('plugins.pref_get', ['verbose', false]),
    call<boolean>('plugins.pref_get', ['instantsave', true]),
    readAutoload(call),
  ]);

  const plugins = Object.entries(found)
    .map(([name, filename]) => ({
      name,
      filename,
      startupPath: longestOwningPath(filename, startupPaths),
      autoload: isAutoloadEnabled(name, autoload),
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
  const [saving, setSaving] = useState<string | null>(null);
  /**
   * The checkbox writes `~/.pymolpluginsrc.py`, so it must never run against a
   * registry that failed to initialize — that is exactly the case where the
   * in-memory `autoload` dict does not reflect the file and a save would
   * destroy it.
   */
  const ready = useRef(false);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    ready.current = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    void (async () => {
      try {
        const loaded = await loadPluginRegistry((fn, args) => session.call(fn, args));
        if (cancelled) return;
        ready.current = true;
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

  const toggle = useCallback(
    async (name: string, enabled: boolean) => {
      if (!ready.current) {
        throw new Error(
          'plugin registry not initialized; refusing to write ~/.pymolpluginsrc.py',
        );
      }
      setSaving(name);
      try {
        await setAutoload((fn, args) => session.call(fn, args), name, enabled);
        setState((s) => ({
          ...s,
          plugins: s.plugins.map((p) => (p.name === name ? { ...p, autoload: enabled } : p)),
        }));
      } finally {
        setSaving(null);
      }
    },
    [session],
  );

  return { ...state, refresh, setAutoload: toggle, saving };
}
