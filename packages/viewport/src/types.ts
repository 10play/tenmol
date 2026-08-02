/**
 * @tenmol/viewport — the public contract.
 *
 * The viewport is deliberately framework-free: it takes a DOM element and a
 * {@link ViewportTransport} and owns everything inside that element. React (or
 * anything else) wraps it; nothing in here imports React.
 *
 * TWO RENDER MODES, ONE COMPONENT API (product decision, overriding plan §4's
 * "Mode G is post-v1"):
 *
 *   Mode P  the bridge renders with PyMOL's own renderer into an offscreen FBO
 *           and streams encoded bitmaps. Correctness baseline, default, and the
 *           automatic fallback for every rep Mode G cannot draw.
 *   Mode G  three.js draws PyMOL's OWN geometry, pulled through
 *           `layer4/CmdWebGeometry.cpp`: `cgo::draw::arrays` blocks used
 *           verbatim, spheres/cylinders as INSTANCED impostor draws (never
 *           tessellated client-side), `RepSurface` as an indexed mesh.
 *
 * The two composite: Mode-P pixels are blitted to a 2-D canvas, Mode-G draws
 * into a transparent WebGL canvas stacked on top, and the bridge is told which
 * reps it may stop drawing server-side (`PixelFrameHeader.reps`).
 */

import type {
  BinaryFrame,
  GeometryFrame,
  InputMessage,
  PixelEncoding,
  PixelFrame,
  RenderMode,
  RenderModePolicy,
  RepId,
  RepRenderState,
} from '@tenmol/protocol';

import type { BandBox, CameraCounters } from './input/camera';

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

/**
 * The narrow slice of the bridge connection the viewport needs.
 *
 * `@tenmol/client`'s `PymolConnection` satisfies `input`/`call`; the binary
 * hook is separate because that package currently routes every binary frame
 * through `decodeGeometryFrame` (which throws on a Mode-P pixel frame) — see
 * `bindConnection()` in `./transport.ts`.
 */
export interface ViewportTransport {
  /** Fire-and-forget `{t:'input'}`. MUST preserve submission order. */
  input(message: InputMessage): void;
  /** `{t:'call'}` — resolves with the decoded result, rejects on `{t:'err'}`. */
  call(fn: string, args?: readonly unknown[], kwargs?: Record<string, unknown>): Promise<unknown>;
  /**
   * Subscribe to decoded server->client binary frames (pixels AND geometry).
   * Returns an unsubscribe function. Optional: without it the viewport can
   * still run from a pull-mode source (see `./modeP/sources.ts`).
   */
  onBinaryFrame?(listener: (frame: BinaryFrame) => void): () => void;
  /**
   * Mode-P flow control: `{t:'ack', what:'pixels', frameId}`. The bridge keeps
   * at most one unacked frame in flight (plan §6 WP-04), so failing to ack
   * stalls the stream — the presenter acks the instant a frame is decoded.
   */
  ack?(frameId: number): void;
  /** True when the socket is up. Input frames are dropped while it is down. */
  isConnected?(): boolean;
}

/* ------------------------------------------------------------------ *
 * Frame sources
 * ------------------------------------------------------------------ */

/** A Mode-P bitmap frame, already separated from its transport. */
export interface PixelFramePayload {
  /** Encoded image bytes, or raw RGBA when `encoding === 'raw-rgba'`. */
  bytes: Uint8Array;
  encoding: PixelEncoding;
  /** Framebuffer pixels (CSS px * dpr). */
  width: number;
  height: number;
  dpr: number;
  /** True when row 0 of the payload is the BOTTOM row (glReadPixels order). */
  flipY: boolean;
  /** Monotonic; echoed back as `{t:'ack'}`. */
  frameId: number;
  /** `performance.now()` when the frame reached the client. */
  receivedAt: number;
  /** Reps PyMOL drew into this bitmap; absent means "the whole scene". */
  reps?: readonly RepId[];
}

/**
 * Anything that can produce Mode-P frames: the WebSocket stream (WP-04), or a
 * pull-mode fallback that asks PyMOL for one image at a time.
 */
export interface PixelSource {
  /** Human-readable, shown in the HUD. */
  readonly name: string;
  start(sink: PixelSink): void;
  stop(): void;
  /**
   * Tell the source the framebuffer size changed. Push sources forward this to
   * the bridge; pull sources use it for their next request.
   */
  resize?(width: number, height: number, dpr: number): void;
  /**
   * Hint that the scene probably changed (an input was just forwarded). Pull
   * sources use it to schedule the next grab; push sources ignore it.
   */
  invalidate?(): void;
  /** Pause/resume (document.hidden, or every rep moved to Mode G). */
  setPaused?(paused: boolean): void;
  /**
   * False when this source will NEVER produce a frame — a null source, or a
   * backend with no GL context at all.
   *
   * It matters because the compositor waits for `PixelFrameHeader.reps` before
   * it lets Mode G draw anything (D2: without that header the server is still
   * rasterising everything and drawing on top would double-draw). A source that
   * never sends a header would leave Mode G waiting for ever, i.e. a black
   * viewport — which is exactly the GL-free configuration this whole design is
   * aiming at. Undefined means "a stream is expected", the historical default.
   */
  readonly rasterizes?: boolean;
}

export interface PixelSink {
  frame(frame: PixelFramePayload): void;
  error(error: Error): void;
}

/** Anything that can produce Mode-G geometry frames. */
export interface GeometrySource {
  readonly name: string;
  start(sink: GeometrySink): void;
  stop(): void;
  /** Ask for `rep` of `object` at `state` (-1 = current). */
  request?(object: string, rep: RepId, state: number): void;
}

export interface GeometrySink {
  frame(frame: GeometryFrame): void;
  /** The rep cannot be served in Mode G; fall back to Mode P with a reason. */
  unavailable(key: { object: string; rep: RepId; state: number }, reason: string): void;
  error(error: Error): void;
}

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

export interface ViewportOptions {
  /** The viewport creates and owns its canvases inside this element. */
  container: HTMLElement;
  transport: ViewportTransport;
  /** Default `{ default: 'pixel', perRep: [] }` — Mode P is the baseline. */
  policy?: RenderModePolicy;
  /** Overrides the default transport-driven pixel source. */
  pixelSource?: PixelSource;
  /** Overrides the default transport-driven geometry source. */
  geometrySource?: GeometrySource;
  /** Clamp `devicePixelRatio`. Default 2 — 3x on a phone quadruples the cost. */
  maxDpr?: number;
  /** Resize debounce in ms. Default 100. */
  resizeDebounceMs?: number;
  /** Emit `_reshape` + `display_scale_factor` on mount. Default true. */
  ownsReshape?: boolean;
  /** Called at most once per animation frame with fresh stats. */
  onStats?: (stats: ViewportStats) => void;
  /** Called whenever the effective per-rep mode table changes. */
  onModeChange?: (states: readonly RepRenderState[]) => void;
  /** Diagnostics. Default `console.warn`-ish; pass `() => {}` to silence. */
  onError?: (error: Error) => void;
}

/* ------------------------------------------------------------------ *
 * Stats / handle
 * ------------------------------------------------------------------ */

export interface ViewportStats {
  /** Framebuffer size in device pixels — what PyMOL is rendering at. */
  width: number;
  height: number;
  dpr: number;
  /**
   * `cmd.get_viewport()` — the SCENE rectangle inside the canvas. Equal to
   * width/height unless PyMOL is reserving room at the bottom of the window
   * (movie panel, internal feedback: `layer1/Ortho.cpp:2383-2390`).
   */
  sceneWidth: number;
  sceneHeight: number;
  /** Mode-P frames presented since mount. */
  pixelFrames: number;
  /** Mode-P frames dropped because a newer one arrived mid-decode. */
  pixelFramesDropped: number;
  /** Smoothed presented-frames-per-second. */
  fps: number;
  /** Smoothed ms from frame arrival to blit (decode + present). */
  presentMs: number;
  /** ms from the last input message to the next presented frame. */
  inputToFrameMs: number;
  /** Bytes of the last Mode-P frame. */
  lastFrameBytes: number;
  lastEncoding: PixelEncoding | null;
  /** Mode-G: geometry frames applied, and the live buffer count. */
  geometryFrames: number;
  geometryDrawCalls: number;
  geometryInstances: number;
  geometryTriangles: number;
  /** Per-rep effective mode. */
  modes: readonly RepRenderState[];
  /** Set when Mode G was requested but the bridge has no accessor. */
  awaitingAccessor: boolean;
  /**
   * D3b/D3c. True while THIS client is dropping Mode-P frames before the
   * presenter (and therefore before the ack). `pauseReasons` lists every reason
   * that currently holds — the stream resumes only when the last one clears.
   */
  paused: boolean;
  pauseReasons: readonly string[];
  /**
   * Mode G drew the rep, but knowingly differently from Mode P (order-dependent
   * surface alpha, today). NOT a fallback trigger — see `viewport.ts`.
   */
  geometryWarnings: readonly string[];
  /**
   * Camera RPCs issued by the GL-free driver. All zero on a normal backend —
   * and the only way to tell "the GL-free camera engaged" from "raw input was
   * forwarded and silently dropped", which look identical from outside.
   */

  /**
   * D2. Who is drawing what, right now: `declared` is what this client told the
   * bridge it would draw, `drawing` is what Mode G is actually allowed to draw
   * (they differ while a declaration is in flight), `suppressed` is what Mode G
   * is holding back because the server is still painting it, and `rasterizing`
   * is false when the backend has stopped rendering altogether — which is the
   * machine-readable form of "this process is not using GL right now".
   */
  composition: {
    declared: readonly RepId[];
    drawing: readonly RepId[];
    suppressed: readonly RepId[];
    rasterizing: boolean;
  };
}

/**
 * Client-side pick diagnostics. `index` is what the ray actually has to work
 * with — an empty index and a missed click look identical from the outside,
 * which is what made cartoon picking take three rounds to get right.
 */
export interface LocalPickStats {
  attempts: number;
  hits: number;
  misses: number;
  index: {
    keys: number;
    spheres: number;
    cylinders: number;
    ellipsoids: number;
    cones: number;
    triangles: number;
    points: number;
    keysWithoutPickData: number;
  };
}

export interface ViewportHandle {
  readonly stats: ViewportStats;
  /** The Mode-P canvas (2-D) and the Mode-G canvas (WebGL2). */
  readonly canvases: { pixel: HTMLCanvasElement; gl: HTMLCanvasElement };
  /**
   * Object names Mode G may pull. The app keeps this in step with the
   * `objects` topic; the viewport never invents names.
   */
  readonly objects: Set<string>;
  /** Request a mode for one rep. Falls back automatically; returns the truth. */
  setRepMode(rep: RepId, mode: RenderMode): RepRenderState;
  setPolicy(policy: RenderModePolicy): void;
  readonly policy: RenderModePolicy;
  /** Ask the geometry source for one object/rep/state. */
  requestGeometry(object: string, rep: RepId, state?: number): void;
  /** Force a reshape round-trip (after a layout change the observer missed). */
  syncSize(force?: boolean): void;
  /** Re-read `cmd.get_view()` (after a command that moved the camera). */
  refreshView(): void;
  /** Feed a frame in by hand (tests, and the dev harness). */
  pushPixelFrame(frame: PixelFramePayload | PixelFrame): void;
  pushGeometryFrame(frame: GeometryFrame): void;
  /** Mode-G clear colour; `null` composites over the Mode-P canvas. */
  setBackground(background: readonly [number, number, number] | null): void;
  /** Re-blit the last Mode-P frame and re-draw Mode G. */
  redraw(): void;
  /**
   * GL-free camera diagnostics, read live. Zero on a normal backend.
   *
   * Not part of `stats`: that object is rebuilt only when the render path
   * runs, so a drag that fails to move anything leaves it stale and these read
   * zero — indistinguishable from the driver never being consulted.
   */
  readonly cameraRpc: CameraCounters;
  /**
   * The ButMode action code the last GL-free gesture resolved to, and the
   * mouse mode it was resolved against. `-1` is `cButModeNothing`.
   */
  readonly cameraAction: { action: number; mode: string };
  /** The live rubber-band rectangle in DOM CSS pixels, or null. */
  readonly selectionBand: BandBox | null;
  /** `rasterizing` as the drag gate saw it, most recent last. */
  readonly cameraGate: readonly boolean[];
  /** Client-side pick counters. Zero unless the backend cannot pick for itself. */
  readonly localPick: LocalPickStats;
  readonly inputStats: { buttons: number; drags: number; wheels: number; coalesced: number };
  destroy(): void;
}
