/**
 * `createViewport()` — one component API, both render modes.
 *
 * What it wires together:
 *
 *   surface.ts        the two canvases + the overlay
 *   resize.ts         ResizeObserver -> `_reshape` + `display_scale_factor`
 *   input/mouse.ts    pointer/wheel/pinch -> `{t:'input'}`, 1:1, ordered
 *   modeP/*           streamed bitmaps -> 2-D canvas
 *   modeG/*           PyMOL's own geometry -> three.js on the GL canvas
 *   renderPolicy.ts   per-rep toggle + automatic fallback to Mode P
 *   camera.ts         `get_view()` -> the same two matrices PyMOL builds
 *
 * The camera is polled, not pushed: `cmd.get_view()` costs 2.0 us backend-side
 * (spike 05 §3) and the client cannot compute it itself, because the mouse
 * bindings that produce it live in the C core (plan §1.4). One request is in
 * flight at a time and the next is issued as soon as an input is forwarded, so
 * during a drag the Mode-G camera tracks at loopback round-trip rate.
 */

import type {
  GeometryFrame,
  PixelFrame,
  RenderMode,
  RenderModePolicy,
  RepId,
  RepRenderState,
} from '@tenmol/protocol';

import { pinchZoom, viewFromResult, type ViewMatrix } from './camera';
import { createInputController } from './input/mouse';
import { createGeometryRenderer, isWebGL2Available } from './modeG/renderer';
import { createStreamGeometrySource } from './modeG/sources';
import { createPixelPresenter } from './modeP/presenter';
import { createStreamPixelSource } from './modeP/sources';
import { DEFAULT_POLICY, createRenderPolicy } from './renderPolicy';
import { createResizeNegotiator } from './resize';
import { createSurface } from './surface';
import type { PixelFramePayload, ViewportHandle, ViewportOptions, ViewportStats } from './types';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function asPayload(frame: PixelFramePayload | PixelFrame): PixelFramePayload {
  if ('bytes' in frame) return frame;
  const h = frame.header;
  return {
    bytes: frame.payload,
    encoding: h.encoding,
    width: h.width,
    height: h.height,
    dpr: h.dpr,
    flipY: h.flipY,
    frameId: h.frameId,
    receivedAt: now(),
    ...(h.reps === undefined ? {} : { reps: h.reps }),
  };
}

export function createViewport(options: ViewportOptions): ViewportHandle {
  const { container, transport } = options;
  const onError = options.onError ?? ((error: Error) => console.warn('[tenmol/viewport]', error));

  const surface = createSurface(container);
  const webgl = isWebGL2Available();

  /** Objects Mode G may ask for. Fed by the app from the `objects` topic. */
  const objects = new Set<string>();

  /* ------------------------------------------------------------ state */

  const stats: ViewportStats = {
    width: 1,
    height: 1,
    dpr: 1,
    sceneWidth: 1,
    sceneHeight: 1,
    pixelFrames: 0,
    pixelFramesDropped: 0,
    fps: 0,
    presentMs: 0,
    inputToFrameMs: 0,
    lastFrameBytes: 0,
    lastEncoding: null,
    geometryFrames: 0,
    geometryDrawCalls: 0,
    geometryInstances: 0,
    geometryTriangles: 0,
    modes: [],
    awaitingAccessor: false,
  };

  let size = { width: 1, height: 1, dpr: 1 };
  const cssSize = { width: 1, height: 1 };
  let view: ViewMatrix | null = null;
  let viewInFlight = false;
  let viewWanted = false;
  let lastInputAt = 0;
  let dirty = true;
  let destroyed = false;

  /* ----------------------------------------------------------- Mode P */

  const presenter = createPixelPresenter({
    canvas: surface.pixelCanvas,
    onPresented: (frame) => {
      transport.ack?.(frame.frameId);
      if (lastInputAt > 0 && frame.receivedAt >= lastInputAt) {
        stats.inputToFrameMs = now() - lastInputAt;
        lastInputAt = 0;
      }
    },
    onError,
  });

  const pixelSource =
    options.pixelSource ??
    createStreamPixelSource({
      transport,
      onUnavailable: (error) => onError(new Error(`Mode P stream unavailable: ${error.message}`)),
    });

  /* ----------------------------------------------------------- Mode G */

  const renderer = createGeometryRenderer({
    canvas: surface.glCanvas,
    background: null, // composite over the Mode-P canvas
    onError,
  });

  const geometrySource =
    options.geometrySource ??
    createStreamGeometrySource({
      transport,
      onUnavailable: () => policy.setCaps({ accessor: false }),
    });

  const requestGeometryFor = (reps: readonly RepId[]): void => {
    if (!geometrySource.request) return;
    for (const object of objects) {
      for (const rep of reps) geometrySource.request(object, rep, -1);
    }
  };

  /* ---------------------------------------------------------- policy */

  const policy = createRenderPolicy({
    initial: options.policy ?? DEFAULT_POLICY,
    caps: { webgl: webgl && renderer.available, accessor: false },
    onChange: (states) => {
      stats.modes = states;
      stats.awaitingAccessor = states.some((s) => s.fallbackReason === 'no-accessor');
      options.onModeChange?.(states);
      // Tell the bridge which reps it no longer has to draw server-side. WP-04
      // honours this through `PixelFrameHeader.reps`; a bridge that does not
      // simply keeps drawing everything, which is correct, only redundant.
      pixelSource.resize?.(size.width, size.height, size.dpr);
    },
  });

  /* ------------------------------------------------------------ view */

  /**
   * `cmd.get_viewport()` is the SCENE rectangle, which is NOT always the window:
   * `OrthoReshape` (`layer1/Ortho.cpp:2383-2390`) subtracts the movie panel and
   * the internal feedback lines. Measured on this bridge: a window of 1176x644
   * with `internal_gui 0` and `internal_feedback 0` still reports a viewport of
   * 1176x629 as soon as an object has two states, because `movie_panel` is on.
   * Both modes must draw into that rectangle or they disagree by the panel
   * height.
   */
  const refreshViewport = (): void => {
    if (destroyed) return;
    void transport
      .call('get_viewport')
      .then((result) => {
        if (!Array.isArray(result) || result.length < 2) return;
        const w = Number(result[0]);
        const h = Number(result[1]);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return;
        if (w === stats.sceneWidth && h === stats.sceneHeight) return;
        stats.sceneWidth = w;
        stats.sceneHeight = h;
        renderer.setSceneSize(w, h);
        dirty = true;
      })
      .catch(() => {
        /* a closed socket; the next resize will ask again */
      });
  };

  const refreshView = (): void => {
    if (destroyed) return;
    if (viewInFlight) {
      viewWanted = true;
      return;
    }
    viewInFlight = true;
    void transport
      .call('get_view')
      .then((result) => {
        view = viewFromResult(result);
        renderer.setView(view);
        dirty = true;
      })
      .catch((cause: unknown) => {
        // A closed socket is a normal state for a desktop app, not an error.
        if (transport.isConnected?.() !== false) {
          onError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      })
      .finally(() => {
        viewInFlight = false;
        if (viewWanted) {
          viewWanted = false;
          refreshView();
        }
      });
  };

  /* ------------------------------------------------------------ input */

  let pinchStartZ: number | null = null;
  const input = createInputController({
    element: surface.glCanvas,
    transport,
    geometry: () => ({ cssWidth: cssSize.width, cssHeight: cssSize.height, dpr: size.dpr }),
    onActivity: () => {
      lastInputAt = now();
      pixelSource.invalidate?.();
      refreshView();
    },
    pinch: {
      begin: () => {
        pinchStartZ = view === null ? null : view[11];
        if (view === null) refreshView();
      },
      update: (totalScaleFactor: number) => {
        if (view === null || pinchStartZ === null) return;
        const next = pinchZoom(view, pinchStartZ, totalScaleFactor);
        view = next;
        renderer.setView(next);
        dirty = true;
        // The backend stays authoritative: we round-trip through set_view
        // rather than keeping a client-only camera.
        void transport.call('set_view', [next as unknown as number[]]).catch(onError);
        pixelSource.invalidate?.();
      },
      end: () => {
        pinchStartZ = null;
        refreshView();
      },
    },
    onError,
  });

  /* ----------------------------------------------------------- resize */

  const resizer = createResizeNegotiator({
    host: container,
    transport,
    ...(options.maxDpr === undefined ? {} : { maxDpr: options.maxDpr }),
    ...(options.resizeDebounceMs === undefined ? {} : { debounceMs: options.resizeDebounceMs }),
    ...(options.ownsReshape === undefined ? {} : { ownsReshape: options.ownsReshape }),
    onResize: (next) => {
      size = { width: next.width, height: next.height, dpr: next.dpr };
      cssSize.width = next.cssWidth;
      cssSize.height = next.cssHeight;
      stats.width = next.width;
      stats.height = next.height;
      stats.dpr = next.dpr;
      surface.resize(next.width, next.height);
      renderer.setSize(next.width, next.height);
      if (view !== null) renderer.setView(view);
      presenter.redraw();
      pixelSource.resize?.(next.width, next.height, next.dpr);
      // The engine answers the reshape asynchronously; ask what it actually
      // gave the scene once the round trip has had a chance to land.
      setTimeout(refreshViewport, 120);
      dirty = true;
    },
    onError,
  });

  /* ---------------------------------------------------------- sources */

  pixelSource.start({
    frame: (frame) => presenter.present(frame),
    error: onError,
  });

  geometrySource.start({
    frame: (frame: GeometryFrame) => {
      // `geometry` is a fan-out TOPIC: the bridge pushes a frame to every
      // subscribed session, not just the one that asked. Applying it blindly
      // draws another client's geometry over our Mode-P image — measured, with
      // a second tab open: an unrequested cyan cartoon composited on top of the
      // rainbow pixel stream. A frame for a rep this viewport is not running in
      // Mode G is therefore evidence the accessor works, and nothing else.
      const requested = policy.state(frame.header.rep).requested;
      policy.setCaps({ accessor: true });
      if (requested !== 'geometry') {
        renderer.removeRep(frame.header.rep);
        return;
      }
      const problems = renderer.apply(frame);
      stats.geometryFrames++;
      policy.clear(frame.header.rep);
      if (problems.length > 0) {
        // Partially drawable is still a fallback: the user must not be shown
        // half a rep and told nothing about the other half.
        policy.degrade(frame.header.rep, 'extraction-failed');
        onError(new Error(`Mode G (${frame.header.object}): ${problems.join('; ')}`));
      }
      dirty = true;
    },
    unavailable: (key, reason) => {
      policy.degrade(key.rep, reason === 'no-accessor' ? 'no-accessor' : 'extraction-failed');
    },
    error: onError,
  });

  /* -------------------------------------------------------- the loop */

  let raf: number | null = null;
  const loop = (): void => {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    if (dirty && renderer.available) {
      renderer.render();
      dirty = false;
    }
    stats.pixelFrames = presenter.stats.frames;
    stats.pixelFramesDropped = presenter.stats.dropped;
    stats.fps = presenter.stats.fps;
    stats.presentMs = presenter.stats.presentMs;
    stats.lastFrameBytes = presenter.stats.lastFrameBytes;
    stats.lastEncoding = presenter.stats.lastEncoding;
    stats.geometryDrawCalls = renderer.stats.drawCalls;
    stats.geometryInstances = renderer.stats.instances;
    stats.geometryTriangles = renderer.stats.triangles;
    options.onStats?.(stats);
  };
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop);

  const onVisibility = (): void => {
    pixelSource.setPaused?.(typeof document !== 'undefined' && document.hidden);
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  // First measurement + the initial reshape, then the first camera read.
  stats.modes = policy.states();
  resizer.sync(true);
  refreshView();
  refreshViewport();

  return {
    stats,
    canvases: { pixel: surface.pixelCanvas, gl: surface.glCanvas },
    objects,
    setRepMode(rep: RepId, mode: RenderMode): RepRenderState {
      const state = policy.setRep(rep, mode);
      // `caps.accessor` starts false and is only flipped true when a geometry
      // frame arrives — which cannot happen unless we ask. Gating the request
      // on `effective === 'geometry'` therefore deadlocks the first Mode-G
      // request of a session at `no-accessor` forever. So an explicit user
      // request PROBES: if the bridge serves it the frame flips the cap and
      // the rep upgrades; if it does not, `unavailable` degrades the rep with
      // the reason, exactly as before.
      if (state.effective === 'geometry' || state.fallbackReason === 'no-accessor') {
        requestGeometryFor([rep]);
      } else {
        renderer.removeRep(rep);
      }
      if (mode === 'pixel') renderer.removeRep(rep);
      dirty = true;
      return state;
    },
    setPolicy(next: RenderModePolicy): void {
      policy.setDefault(next.default);
      for (const entry of next.perRep) policy.setRep(entry.rep, entry.requested);
    },
    get policy(): RenderModePolicy {
      return policy.policy;
    },
    requestGeometry(object: string, rep: RepId, state = -1): void {
      objects.add(object);
      geometrySource.request?.(object, rep, state);
    },
    syncSize(force = false): void {
      resizer.sync(force);
      setTimeout(refreshViewport, 120);
    },
    refreshView,
    pushPixelFrame(frame: PixelFramePayload | PixelFrame): void {
      presenter.present(asPayload(frame));
    },
    pushGeometryFrame(frame: GeometryFrame): void {
      renderer.apply(frame);
      stats.geometryFrames++;
      stats.geometryDrawCalls = renderer.stats.drawCalls;
      stats.geometryInstances = renderer.stats.instances;
      stats.geometryTriangles = renderer.stats.triangles;
      dirty = true;
    },
    setBackground(background: readonly [number, number, number] | null): void {
      renderer.setBackground(background);
      dirty = true;
    },
    redraw(): void {
      presenter.redraw();
      dirty = true;
    },
    get inputStats(): { buttons: number; drags: number; wheels: number; coalesced: number } {
      return input.stats;
    },
    destroy(): void {
      destroyed = true;
      if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      input.destroy();
      resizer.destroy();
      pixelSource.stop();
      geometrySource.stop();
      presenter.destroy();
      renderer.dispose();
      surface.destroy();
    },
  };
}
