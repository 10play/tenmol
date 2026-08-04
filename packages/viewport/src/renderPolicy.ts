/**
 * The per-rep render-mode toggle, with AUTOMATIC fallback.
 *
 * Product decision: Mode G is developed in parallel with Mode P behind a
 * per-rep toggle, and any rep Mode G cannot draw falls back to Mode P by
 * itself. "Cannot draw" has seven named causes and the client must surface
 * which one it hit (`MODE_G_FALLBACK_REASONS` in `@tenmol/protocol`) — a
 * silently empty screen is exactly the failure mode the exporters have:
 * ellipsoids, labels and volume emit 0 bytes with no error (spike 03 §4.1).
 *
 * Degradations are STICKY per rep until something explicitly clears them, so a
 * rep that failed extraction does not thrash between modes frame by frame.
 */

import {
  MODE_G_CAPABLE_REPS,
  isModeGCapable,
  repName,
  resolveRenderMode,
  type ModeGFallbackReason,
  type RenderMode,
  type RenderModePolicy,
  type RepId,
  type RepRenderState,
} from '@tenmol/protocol';

export interface RenderPolicyCaps {
  /** The bridge advertised the Mode-G accessor in its `hello` frame. */
  accessor: boolean;
  /** A WebGL2 context could be created. */
  webgl: boolean;
}

export interface RenderPolicyController {
  readonly policy: RenderModePolicy;
  readonly caps: RenderPolicyCaps;
  /** Effective state for every rep with an opinion attached. */
  states(): RepRenderState[];
  state(rep: RepId): RepRenderState;
  /** Reps currently drawn client-side; the bridge may stop drawing these. */
  geometryReps(): RepId[];
  setDefault(mode: RenderMode): void;
  setRep(rep: RepId, mode: RenderMode): RepRenderState;
  /** Record a runtime failure; the rep drops to Mode P until `clear`. */
  degrade(rep: RepId, reason: ModeGFallbackReason): RepRenderState;
  clear(rep: RepId): void;
  setCaps(caps: Partial<RenderPolicyCaps>): void;
  /** Human-readable one-liner for the HUD. */
  describe(): string;
}

export interface RenderPolicyOptions {
  initial?: RenderModePolicy;
  caps?: Partial<RenderPolicyCaps>;
  onChange?: (states: RepRenderState[]) => void;
}

export const DEFAULT_POLICY: RenderModePolicy = { default: 'pixel', perRep: [] };

export function createRenderPolicy(options: RenderPolicyOptions = {}): RenderPolicyController {
  const caps: RenderPolicyCaps = {
    accessor: options.caps?.accessor ?? false,
    webgl: options.caps?.webgl ?? true,
  };
  let base: RenderModePolicy = options.initial ?? DEFAULT_POLICY;
  /** Explicit user requests, rep -> mode. */
  const requested = new Map<RepId, RenderMode>();
  /** Sticky runtime degradations, rep -> reason. */
  const degraded = new Map<RepId, ModeGFallbackReason>();

  for (const entry of base.perRep) requested.set(entry.rep, entry.requested);

  const compose = (): RenderModePolicy => ({
    default: base.default,
    perRep: [...requested.entries()].map(([rep, mode]) => {
      const reason = degraded.get(rep);
      return reason === undefined
        ? { rep, requested: mode, effective: mode }
        : { rep, requested: mode, effective: 'pixel' as const, fallbackReason: reason };
    }),
  });

  const stateOf = (rep: RepId): RepRenderState => {
    const policy = compose();
    return resolveRenderMode(rep, policy, caps);
  };

  const notify = (): void => {
    options.onChange?.(controller.states());
  };

  const controller: RenderPolicyController = {
    get policy(): RenderModePolicy {
      return compose();
    },
    caps,
    states(): RepRenderState[] {
      const reps = new Set<RepId>([...requested.keys(), ...degraded.keys()]);
      if (base.default === 'geometry') for (const rep of MODE_G_CAPABLE_REPS) reps.add(rep);
      return [...reps].sort((a, b) => a - b).map(stateOf);
    },
    state: stateOf,
    geometryReps(): RepId[] {
      return controller
        .states()
        .filter((s) => s.effective === 'geometry')
        .map((s) => s.rep);
    },
    setDefault(mode: RenderMode): void {
      base = { ...base, default: mode };
      notify();
    },
    setRep(rep: RepId, mode: RenderMode): RepRenderState {
      requested.set(rep, mode);
      // Asking for Mode G again is an explicit "try once more".
      if (mode === 'geometry') degraded.delete(rep);
      notify();
      return stateOf(rep);
    },
    degrade(rep: RepId, reason: ModeGFallbackReason): RepRenderState {
      if (degraded.get(rep) !== reason) {
        degraded.set(rep, reason);
        notify();
      }
      return stateOf(rep);
    },
    clear(rep: RepId): void {
      if (degraded.delete(rep)) notify();
    },
    setCaps(next: Partial<RenderPolicyCaps>): void {
      let changed = false;
      if (next.accessor !== undefined && next.accessor !== caps.accessor) {
        caps.accessor = next.accessor;
        changed = true;
      }
      if (next.webgl !== undefined && next.webgl !== caps.webgl) {
        caps.webgl = next.webgl;
        changed = true;
      }
      if (changed) notify();
    },
    describe(): string {
      const states = controller.states();
      const g = states.filter((s) => s.effective === 'geometry');
      if (g.length === 0) return 'Mode P (all reps server-rendered)';
      const fallen = states.filter((s) => s.fallbackReason !== undefined);
      const head = `Mode G: ${g.map((s) => repName(s.rep)).join(', ')}`;
      return fallen.length === 0
        ? head
        : `${head}; Mode P fallback: ${fallen
            .map((s) => `${repName(s.rep)} (${s.fallbackReason})`)
            .join(', ')}`;
    },
  };

  return controller;
}

/** Convenience: does this rep have any chance in Mode G? */
export { isModeGCapable };
