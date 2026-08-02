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
  readStartupPaths,
  setAutoload,
  setPreference,
  setStartupPaths,
  type CallFn,
  type PreferenceKey,
  type StartupPaths,
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
  /** Scan order, user entries first. Kept for the read-only overview. */
  startupPaths: string[];
  /** The same list, split at the boundary `set_startup_path` may not cross. */
  paths: StartupPaths;
  preferences: { verbose: boolean; instantsave: boolean };
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Flip one plugin's enabled-at-startup flag. Rejects if the scan failed. */
  setAutoload: (name: string, enabled: boolean) => Promise<void>;
  /** Write one plugin preference. Rejects if the scan failed. */
  setPreference: (key: PreferenceKey, value: boolean) => Promise<void>;
  /** Replace the USER slice of the startup path. Rejects if the scan failed. */
  setStartupPaths: (paths: readonly string[], autosave: boolean) => Promise<void>;
  /** Name of the plugin whose checkbox is mid-flight, or null. */
  saving: string | null;
  /** Last write failure, shown next to the control that caused it. */
  writeError: string | null;
}

type Derived = Omit<
  PluginRegistry,
  'refresh' | 'setAutoload' | 'setPreference' | 'setStartupPaths' | 'saving' | 'writeError'
>;

const EMPTY: Derived = {
  plugins: [],
  startupPaths: [],
  paths: { user: [], installation: [] },
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
): Promise<Omit<Derived, 'loading' | 'error'>> {
  await initializePluginSystem(call);

  const paths = await readStartupPaths(call);
  const startupPaths = [...paths.user, ...paths.installation];
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
    paths,
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

  const [writeError, setWriteError] = useState<string | null>(null);

  /**
   * Every write in this panel lands in `~/.pymolpluginsrc.py`, so they all go
   * through the same guard: the registry must have initialized, or the
   * in-memory dicts do not reflect the file and saving them DESTROYS it.
   */
  const guarded = useCallback(async (label: string, body: () => Promise<void>) => {
    if (!ready.current) {
      // Surface it AND reject. Rejecting alone made the refusal invisible:
      // every caller in `PluginManager` swallows the rejection (it has
      // already been reported), so the user clicked Apply and nothing at all
      // happened. Found by the test that asserts the banner, not by reading.
      const message = 'plugin registry not initialized; refusing to write ~/.pymolpluginsrc.py';
      setWriteError(message);
      throw new Error(message);
    }
    setSaving(label);
    setWriteError(null);
    try {
      await body();
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(null);
    }
  }, []);

  const toggle = useCallback(
    (name: string, enabled: boolean) =>
      guarded(name, async () => {
        await setAutoload((fn, args) => session.call(fn, args), name, enabled);
        setState((s) => ({
          ...s,
          plugins: s.plugins.map((p) => (p.name === name ? { ...p, autoload: enabled } : p)),
        }));
      }),
    [session, guarded],
  );

  const writePreference = useCallback(
    (key: PreferenceKey, value: boolean) =>
      guarded(`pref:${key}`, async () => {
        await setPreference((fn, args) => session.call(fn, args), key, value);
        setState((s) => ({ ...s, preferences: { ...s.preferences, [key]: value } }));
      }),
    [session, guarded],
  );

  const writeStartupPaths = useCallback(
    (next: readonly string[], autosave: boolean) =>
      guarded('paths', async () => {
        const applied = await setStartupPaths((fn, args) => session.call(fn, args), next, autosave);
        setState((s) => ({
          ...s,
          paths: { ...s.paths, user: applied },
          startupPaths: [...applied, ...s.paths.installation],
        }));
      }),
    [session, guarded],
  );

  return {
    ...state,
    refresh,
    setAutoload: toggle,
    setPreference: writePreference,
    setStartupPaths: writeStartupPaths,
    saving,
    writeError,
  };
}
