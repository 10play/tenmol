/**
 * The imperative half of the D2 compositor: declare, listen, switch.
 *
 * It owns exactly three side effects and nothing else, so it can be unit
 * tested with three stubs and no browser:
 *
 *   1. tells the bridge which reps this client draws
 *      (`_bridge.set_pixel_stream {geometryReps}`);
 *   2. calls `draw(rep)` when a rep becomes ours — the caller re-requests its
 *      geometry, because the Mode-G renderer's only "stop drawing this" verb
 *      is `removeRep`, which frees the buffers (see `needsFromOthers`);
 *   3. calls `suppress(rep)` when the bridge takes a rep back.
 *
 * WHY THE DECLARATION RIDES `set_pixel_stream` AND NOT A NEW ROUTE. A route of
 * its own would have to be per SESSION to be meaningful, and the dispatcher
 * does not thread the session into `_bridge.*` handlers yet — the same missing
 * plumbing defect D4 is about. `set_pixel_stream` already exists, already
 * carries process-wide stream parameters, and merges the keys it is given, so
 * this needed no server route work and no protocol version bump. The moment
 * the session is threaded, the bridge intersects per-subscriber declarations
 * and this client changes not at all.
 */

import type { RepId, RepRenderState } from '@tenmol/protocol';

import {
  EMPTY_COMPOSITION,
  compose,
  compositionChanged,
  declaration,
  declarationChanged,
  type CompositionFrame,
  type CompositionState,
} from './composition';

/** The one transport verb this needs. Structurally satisfied by `ViewportTransport`. */
export interface CompositorTransport {
  call(fn: string, args?: unknown[], kwargs?: Record<string, unknown>): Promise<unknown>;
  isConnected?(): boolean;
}

/** Construction options for {@link createCompositor}. */
export interface CompositorOptions {
  transport: CompositorTransport;
  /** Start drawing `rep` in Mode G (the caller re-requests its geometry). */
  draw(rep: RepId): void;
  /** Stop drawing `rep`: the server is rasterising it and we would double-draw. */
  suppress(rep: RepId): void;
  onChange?(state: CompositionState): void;
  onError?(error: Error): void;
  /** Set false to never talk to the bridge (tests, and a read-only viewport). */
  declare?: boolean;
}

/** Decides per rep whether the client draws it (Mode G) or the server does. */
export interface Compositor {
  readonly state: CompositionState;
  /** True when this rep is ours to draw right now. Gate `renderer.apply` on it. */
  shouldDraw(rep: RepId): boolean;
  /** The render policy changed. */
  setPolicy(states: readonly RepRenderState[]): void;
  /** A pixel frame arrived. Returns true when the composition changed. */
  observeFrame(frame: CompositionFrame): boolean;
  /**
   * There is no Mode-P stream at all (the bridge has no pixel producer, or no
   * GL context to run one). Without this the viewport would wait forever for a
   * header that is never coming and draw nothing — which is exactly the
   * GL-free backend the product is aiming at, so it must not be the broken
   * case. `false` is equivalent to a permanent `reps: []`.
   */
  setStreamAvailable(available: boolean): void;
  /** Diagnostics for the HUD. */
  stats(): {
    declared: readonly RepId[];
    drawing: readonly RepId[];
    suppressed: readonly RepId[];
    rasterizing: boolean;
    declarations: number;
    declarationFailures: number;
    supported: boolean | null;
  };
  destroy(): void;
}

/** The bridge symbol that toggles the Mode-P pixel producer. */
export const PIXEL_STREAM_FN = '_bridge.set_pixel_stream';

/** "the server rasterises nothing", used when there is no Mode-P stream. */
const NO_STREAM: CompositionFrame = { reps: [] };

/** Build a {@link Compositor} wired to the given transport and draw hooks. */
export function createCompositor(options: CompositorOptions): Compositor {
  const { transport } = options;
  let states: readonly RepRenderState[] = [];
  let lastFrame: CompositionFrame | null = null;
  /** Set false when the bridge has no pixel stream; see `setStreamAvailable`. */
  let streamAvailable = true;
  let state: CompositionState = EMPTY_COMPOSITION;
  let sent: readonly RepId[] = [];
  let destroyed = false;
  let declarations = 0;
  let declarationFailures = 0;
  /** null = not yet known; false = this bridge has no such parameter. */
  let supported: boolean | null = null;

  /** What the server last said it was drawing, or the no-stream stand-in. */
  const currentFrame = (): CompositionFrame | null =>
    lastFrame ?? (streamAvailable ? null : NO_STREAM);

  const apply = (next: CompositionState): boolean => {
    const previous = state;
    state = next;
    if (!compositionChanged(previous, next)) return false;
    const before = new Set(previous.drawing);
    const after = new Set(next.drawing);
    for (const rep of previous.drawing) if (!after.has(rep)) options.suppress(rep);
    for (const rep of next.drawing) if (!before.has(rep)) options.draw(rep);
    options.onChange?.(next);
    return true;
  };

  const declare = (): void => {
    if (destroyed || options.declare === false || supported === false) return;
    const wanted = declaration(states);
    if (!declarationChanged(sent, wanted)) return;
    sent = wanted;
    declarations++;
    void transport
      .call(PIXEL_STREAM_FN, [], { geometryReps: [...wanted] })
      .then((result: unknown) => {
        // The bridge has no GL context and will never rasterise anything, so
        // Mode G owns the whole scene. Answered as a VALUE, not an error --
        // see the note in packages/bridge/tenmol_bridge/render/__init__.py.
        if ((result as { available?: unknown } | null)?.available === false) {
          supported = false;
          if (streamAvailable) {
            streamAvailable = false;
            apply(compose(states, currentFrame()));
          }
          return;
        }
        supported = true;
      })
      .catch((cause: unknown) => {
        // NO GL AT ALL is a different answer from "an old bridge", and it must
        // not be conflated with one. `_bridge.set_pixel_stream` raising
        // `NoOffscreenGL` means the backend has no context and will NEVER
        // rasterise anything, so the correct conclusion is the exact opposite
        // of the one below: Mode G owns the whole scene.
        //
        // MEASURED, and the reason this is here: against a `--no-gl` bridge the
        // viewport pulled the cartoon four times, got `status: ok` and 360 KB
        // every time, and drew NOTHING, because the compositor was still
        // waiting to be told what the server was painting. Black viewport, no
        // error, every rep reporting `effective: geometry`.
        // The kind travels as `PymolError.type`, NOT in the message text --
        // `String(cause)` is "PymolError: this bridge has no GL context...",
        // which is why matching on the string alone silently did nothing.
        const kind = (cause as { type?: unknown } | null)?.type;
        if (kind === 'NoOffscreenGL' || /NoOffscreenGL/.test(String(cause))) {
          supported = false;
          if (streamAvailable) {
            streamAvailable = false;
            apply(compose(states, currentFrame()));
          }
          options.onError?.(
            new Error(
              'the bridge has no GL context: Mode P is unavailable and Mode G ' +
                'is now drawing the whole scene',
            ),
          );
          return;
        }
        // An older bridge rejects the unknown parameter. That is not an error
        // the user can act on: it degrades to "the server keeps drawing
        // everything", which the header then says, which this module already
        // handles by suppressing Mode G. Say it once and stop asking.
        declarationFailures++;
        if (supported === null) {
          supported = false;
          options.onError?.(
            new Error(
              `bridge does not accept geometryReps on ${PIXEL_STREAM_FN}; ` +
                `Mode P will keep drawing every rep (${String(cause)})`,
            ),
          );
        }
        // Let the next policy change try again if the socket simply blipped.
        if (transport.isConnected?.() === false) {
          supported = null;
          sent = [];
        }
      });
  };

  return {
    get state(): CompositionState {
      return state;
    },
    shouldDraw(rep: RepId): boolean {
      return state.drawing.includes(rep);
    },
    setPolicy(next: readonly RepRenderState[]): void {
      states = next;
      apply(compose(states, currentFrame()));
      declare();
    },
    observeFrame(frame: CompositionFrame): boolean {
      streamAvailable = true;
      lastFrame = frame;
      return apply(compose(states, frame));
    },
    setStreamAvailable(available: boolean): void {
      if (streamAvailable === available) return;
      streamAvailable = available;
      apply(compose(states, currentFrame()));
    },
    stats() {
      return {
        declared: state.declared,
        drawing: state.drawing,
        suppressed: state.suppressed,
        rasterizing: state.rasterizing,
        declarations,
        declarationFailures,
        supported,
      };
    },
    destroy(): void {
      destroyed = true;
    },
  };
}
