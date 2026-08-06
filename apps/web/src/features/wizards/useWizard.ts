/**
 * The wizard snapshot, kept live.
 *
 * PyMOL has no "wizard changed" callback to subscribe to — the direction is C
 * pulling from Python (`WizardRefresh`, `packages/engine/layer1/Wizard.cpp:195`), and there is
 * no observer hook anywhere in `packages/engine/layer1/Wizard.cpp` or `packages/engine/modules/pymol/wizarding.py`.
 * So the bridge wraps `cmd.refresh_wizard` / `set_wizard` / `set_wizard_stack` /
 * `dirty_wizard` and publishes a version counter, and this hook does:
 *
 *     poll `wizards.probe`   (cheap, side-effect free)
 *     -> version/depth/class changed?  pull `wizards.snapshot`
 *
 * The two-step matters because `snapshot` is NOT free of side effects:
 * `get_panel()` forces `mouse_selection_mode` in `mutagenesis.py:278` and
 * rebuilds menus in `density.py:160` / `filter.py:236`, and `get_prompt()` runs
 * `cmd.iterate` in `charge.py:124-128`. Polling the full snapshot at 30 Hz
 * would run an `iterate` over a residue thirty times a second.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WizardProbe, WizardSnapshot } from '@tenmol/protocol';
import { EMPTY_SNAPSHOT, probeChanged, type WizardService } from './service';

/** 6 Hz. A wizard panel changes on user actions, which also `kick()` directly. */
export const PROBE_INTERVAL_MS = 160;

/** The reactive state a wizard panel reads: latest snapshot, error, loading flag, and a manual refresh. */
export interface WizardState {
  snapshot: WizardSnapshot;
  /** Transport / policy failure, e.g. the bridge has no WP-16 grant loaded. */
  error: string | null;
  /** True until the first probe answers. */
  loading: boolean;
  /** Force a probe + snapshot right now (after exec, after an event). */
  kick(): void;
}

/** Options for useWizard: the service to poll, when polling is allowed, and callbacks. */
export interface UseWizardOptions {
  service: WizardService;
  /** Poll only while the socket is open. */
  isEnabled(): boolean;
  intervalMs?: number;
  /** Called once per NEW error message, not once per failed poll. */
  onError?(message: string): void;
}

/** React hook that polls a wizard service and exposes its snapshot, error, and loading state. */
export function useWizard(options: UseWizardOptions): WizardState {
  const { service, isEnabled } = options;
  const intervalMs = options.intervalMs ?? PROBE_INTERVAL_MS;

  const [snapshot, setSnapshot] = useState<WizardSnapshot>(EMPTY_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Refs, not state: none of these may re-trigger the effect that owns the
  // interval, or the poll restarts on every answer.
  const enabledRef = useRef(isEnabled);
  const errorHandlerRef = useRef(options.onError);
  const lastProbe = useRef<WizardProbe | null>(null);
  const lastError = useRef<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const kickRef = useRef<() => void>(() => {});

  enabledRef.current = isEnabled;
  errorHandlerRef.current = options.onError;

  const tick = useCallback(
    async (force: boolean) => {
      if (inFlight.current) return;
      if (!force && !enabledRef.current()) return;
      inFlight.current = true;
      try {
        const probe = await service.probe();
        if (!alive.current) return;
        if (lastError.current !== null) {
          lastError.current = null;
          setError(null);
        }
        setLoading(false);

        const changed = force || probeChanged(lastProbe.current, probe);
        lastProbe.current = probe;
        if (!changed) return;

        if (probe.depth === 0) {
          // Nothing on the stack: no snapshot round trip at all, and no
          // `get_panel()` call — which is the side-effecting one.
          setSnapshot({ ...EMPTY_SNAPSHOT, version: probe.version });
          return;
        }
        const full = await service.snapshot();
        if (!alive.current) return;
        setSnapshot(full);
      } catch (caught) {
        if (!alive.current) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        setLoading(false);
        // A policy refusal answers identically every 160 ms forever; report the
        // message once, then stay quiet until it changes.
        if (lastError.current !== message) {
          lastError.current = message;
          setError(message);
          errorHandlerRef.current?.(message);
        }
        lastProbe.current = null;
      } finally {
        inFlight.current = false;
      }
    },
    [service],
  );

  kickRef.current = () => {
    void tick(true);
  };

  useEffect(() => {
    alive.current = true;
    void tick(true);
    const timer = setInterval(() => {
      void tick(false);
    }, intervalMs);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [tick, intervalMs]);

  const kick = useCallback(() => {
    kickRef.current();
  }, []);

  return { snapshot, error, loading, kick };
}
