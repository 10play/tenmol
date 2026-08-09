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

import { repName } from '@tenmol/protocol';

import { pinchZoom, viewFromResult, type ViewMatrix } from './camera';
import {
  createLocalViewTracker,
  handOffSceneToModeG,
  serverRasterisesNothing,
  shouldHandOffToModeG,
} from './viewSync';
import { createCompositor } from './compositor';
import { createCameraDriver, type BandBox, type CameraCounters } from './input/camera';
import { createPickIndex, dispatchViewportPick } from './picking';
import { createInputController } from './input/mouse';
import type { GeometryCache } from './modeG/cache';
import { isEmptyGeometryFrame } from './modeG/frames';
import { createGeometryRenderer, isWebGL2Available } from './modeG/renderer';
import { createStreamGeometrySource } from './modeG/sources';
import { createPixelPresenter } from './modeP/presenter';
import { createStreamPixelSource } from './modeP/sources';
import { DEFAULT_POLICY, createRenderPolicy } from './renderPolicy';
import { createResizeNegotiator } from './resize';
import { createStreamPauseController } from './stream';
import { createSurface } from './surface';
import type {
  LocalPickStats,
  PixelFramePayload,
  ViewportHandle,
  ViewportOptions,
  ViewportStats,
} from './types';

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

/** Create the viewport: mounts the render surface and drives both render modes. */
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
    paused: false,
    pauseReasons: [],
    geometryWarnings: [],
    composition: { declared: [], drawing: [], suppressed: [], rasterizing: true },
  };

  let size = { width: 1, height: 1, dpr: 1 };
  const cssSize = { width: 1, height: 1 };
  let view: ViewMatrix | null = null;
  let viewInFlight = false;
  let viewWanted = false;
  // Advanced whenever the client moves the view locally (optimistic rotation OR
  // pinch-zoom). A `get_view` reply requested BEFORE the last local move is
  // stale and must not clobber the newer client view, or the camera rubber-bands
  // on a remote link. EVERY local view change must go through `localView.advance`.
  const localView = createLocalViewTracker();
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

  const rawPixelSource =
    options.pixelSource ??
    createStreamPixelSource({
      transport,
      onUnavailable: (error) => {
        // No pixel producer at all. That is the GL-free backend, not a broken
        // one: route through `syncStreamAvailability` (NOT a bare
        // `setStreamAvailable(false)`) so the same Mode-G scene hand-off a
        // caller-supplied source gets also runs on the built-in default source,
        // or Mode G waits forever for a `reps` header that will never arrive.
        syncStreamAvailability();
        onError(new Error(`Mode P stream unavailable: ${error.message}`));
      },
    });

  // D3b/D3c. The gate sits IN FRONT of the presenter and therefore in front of
  // the ack, so a paused client stops acking and self-throttles through the
  // bridge's existing per-subscriber flow control — without touching the
  // process-wide `StreamParams.paused` flag unless it is provably safe.
  // Constructing the controller reads `document.visibilityState` synchronously,
  // which is the half of D3b that an `addEventListener` can never cover: a tab
  // that was ALREADY hidden at mount never fires a `visibilitychange`.
  const pause = createStreamPauseController({
    source: rawPixelSource,
    transport,
    onChange: (paused, reasons) => {
      stats.paused = paused;
      stats.pauseReasons = [...reasons];
    },
  });
  const pixelSource = pause.source;

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

  /**
   * Forget everything the Mode-G source thinks we hold for `rep`.
   *
   * MEASURED, IN A BROWSER: without this, flipping `surface` to Mode G left the
   * viewport BLANK. The sequence is a trap and it is worth spelling out.
   * `sources.ts` sends the cached content hash as `have`, and the bridge answers
   * an unchanged rep with `status:'unchanged'` and NO payload. So when the
   * compositor suppressed a rep we dropped its GPU buffers with `removeRep`,
   * the source's cache still believed we had them, and the re-pull that was
   * supposed to bring them back was answered "you already have it" — for ever.
   * Mode P had stopped drawing the rep, Mode G never started, and the user got
   * a black canvas. Dropping the cache entries too makes the re-pull a full one.
   */
  const forgetGeometryFor = (rep: RepId): void => {
    const cache = (geometrySource as { cache?: GeometryCache }).cache;
    if (cache === undefined) return;
    for (const entry of cache.entries()) {
      if (entry.rep !== rep) continue;
      const state = entry.resolvedState ?? entry.requestedState;
      cache.dropped({ object: entry.object, state, rep: entry.rep });
    }
  };

  /* ------------------------------------------------------ D2 composition */

  /** Reps that currently have live Mode-G buffers. Drives the watchdog below. */
  const drawnReps = new Set<RepId>();
  const drawWatch = new Map<RepId, ReturnType<typeof setTimeout>>();
  /** Long enough for a loopback pull of a 20k-triangle surface, short enough to feel like a glitch rather than a hang. */
  const GEOMETRY_GRACE_MS = 800;
  const GEOMETRY_TRIES = 4;

  /**
   * NEVER LEAVE THE VIEWPORT BLANK.
   *
   * Once the bridge stops rasterising a rep, this client is the only thing
   * drawing it — so "we asked for the geometry and nothing came" is no longer a
   * cosmetic miss, it is an empty screen. Seen in a browser: after a
   * `delete all` + reload the pull raced the compositor and the surface never
   * arrived, leaving Mode P showing sticks and Mode G showing nothing. Retry a
   * few times, then hand the rep back to the server, which re-declares and
   * restarts the raster. Slower is fine; blank is not.
   */
  const watchDraw = (rep: RepId, tries = 0): void => {
    const existing = drawWatch.get(rep);
    if (existing !== undefined) clearTimeout(existing);
    drawWatch.set(
      rep,
      setTimeout(() => {
        drawWatch.delete(rep);
        if (destroyed || drawnReps.has(rep) || !compositor.shouldDraw(rep)) return;
        if (tries + 1 >= GEOMETRY_TRIES) {
          policy.degrade(rep, 'extraction-failed');
          onError(
            new Error(
              `Mode G (${repName(rep)}): no geometry arrived after ${GEOMETRY_TRIES} pulls; ` +
                'handing the rep back to Mode P',
            ),
          );
          return;
        }
        forgetGeometryFor(rep);
        requestGeometryFor([rep]);
        watchDraw(rep, tries + 1);
      }, GEOMETRY_GRACE_MS),
    );
  };

  /**
   * The double-draw fix. `PixelFrameHeader.reps` says what is already in the
   * bitmap; the compositor turns that into "draw this rep / do not". Every
   * `renderer.apply` below is gated on it, so nothing can be drawn twice even
   * while a declaration is in flight or against a bridge that ignores it.
   */
  const compositor = createCompositor({
    transport,
    draw: (rep) => {
      // The renderer has no non-destructive hide, so a rep that comes back has
      // to be re-fetched — and it has to be a FULL fetch, or the `have` hash
      // gets it answered `unchanged` and nothing is ever drawn.
      forgetGeometryFor(rep);
      requestGeometryFor([rep]);
      watchDraw(rep);
      dirty = true;
    },
    suppress: (rep) => {
      renderer.removeRep(rep);
      forgetGeometryFor(rep);
      drawnReps.delete(rep);
      const timer = drawWatch.get(rep);
      if (timer !== undefined) clearTimeout(timer);
      drawWatch.delete(rep);
      dirty = true;
    },
    onChange: () => {
      dirty = true;
    },
    onError,
  });

  /* ---------------------------------------------------------- policy */

  const policy = createRenderPolicy({
    initial: options.policy ?? DEFAULT_POLICY,
    caps: { webgl: webgl && renderer.available, accessor: false },
    onChange: (states) => {
      stats.modes = states;
      stats.awaitingAccessor = states.some((s) => s.fallbackReason === 'no-accessor');
      options.onModeChange?.(states);
      // D2: tell the bridge which reps it no longer has to draw server-side,
      // and re-derive who draws what. Before this the only thing sent was a
      // `resize`, which told the bridge nothing at all — which is why
      // `PixelFrameHeader.reps` was always absent and both modes drew.
      compositor.setPolicy(states);
    },
  });

  // A source that says up front it will never rasterise (a null source, or a
  // bridge with no GL context) must not leave the compositor waiting for a
  // `PixelFrameHeader.reps` that is never coming: `currentFrame()` returns null
  // until either a frame arrives or this is called, and a null frame means
  // "assume the server draws everything", i.e. Mode G draws nothing. Without
  // this, `?viewportModeP=off` — and every GL-free backend — is a black
  // viewport with a green Mode-G badge. MEASURED: Mode G reported 0 frames and
  // 0 draws with `_bridge.pull_geometry` answered ok, because every frame was
  // dropped by `compositor.shouldDraw`.
  let modeGOwnsScene = false;
  const syncStreamAvailability = (): void => {
    if (!serverRasterisesNothing(pixelSource.rasterizes, rawPixelSource.rasterizes)) return;
    compositor.setStreamAvailable(false);
    // The bridge rasterises NOTHING (a `--no-gl` backend): Mode G is the only
    // path to a picture, so hand it the whole scene. This runs the instant
    // `rasterizing` flips false — BEFORE any geometry is pulled — so the frames
    // the compositor now requests are drawn, not dropped, and the draw watchdog
    // never degrades a rep that was about to appear. `accessor` is trusted here:
    // a GL-free build that also lacked the accessor could draw nothing at all,
    // and each rep still degrades honestly with `no-accessor` if a pull says so.
    // On a normal GL backend this never runs, so the faithful Mode-P input,
    // picking and per-rep-toggle behaviour is left exactly as it was.
    if (shouldHandOffToModeG(webgl && renderer.available, modeGOwnsScene)) {
      modeGOwnsScene = true;
      handOffSceneToModeG(policy);
    }
  };
  syncStreamAvailability();

  /* ------------------------------------------------------------ view */

  /**
   * `cmd.get_viewport()` is the SCENE rectangle, which is NOT always the window:
   * `OrthoReshape` (`packages/engine/layer1/Ortho.cpp:2383-2390`) subtracts the movie panel and
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
    const requestedAtEpoch = localView.epoch;
    void transport
      .call('get_view')
      .then((result) => {
        // Drop a reply the client has already moved past: the optimistic view
        // is newer and correct, and this stale server sample would snap it back.
        if (!localView.accepts(requestedAtEpoch)) return;
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
  /**
   * GL-free camera. Raw `{t:'input'}` is accepted and silently never applied
   * when the backend has no context: `OrthoDefer`'s queue is drained by
   * `ExecutiveDrawNow`, which needs a flag only `PyMOL_Draw` sets. Measured on
   * `--no-gl` — a 20-step drag left `get_view()` unchanged while `cmd.turn`
   * moved it at once.
   *
   * Created eagerly but only CONSULTED when the compositor has been told the
   * server rasterises nothing, so a normal GL backend keeps the faithful input
   * path (which can pick, and which honours the ButMode table).
   */
  const gateSamples: boolean[] = [];
  const pickIndex = createPickIndex();
  const pickStats = { attempts: 0, hits: 0, misses: 0 };
  /** The scene rectangle, in CSS pixels — NOT the canvas (see `./picking/ray`). */
  const sceneRect = (): { width: number; height: number } => ({
    width: stats.sceneWidth || cssSize.width,
    height: stats.sceneHeight || cssSize.height,
  });
  /** The live rubber band, in DOM CSS pixels. Read by the overlay. */
  let bandBox: BandBox | null = null;
  const cameraDriver = createCameraDriver({
    call: (fn, args = []) => transport.call(fn, [...args]),
    onError,
    view: () => view,
    // tenmol-only: optimistic rotation. PyMOL is the source of truth for the
    // view, but on a GL-free bridge waiting for `cmd.turn`+`get_view` per drag
    // sample caps rotation at ~1 fps/RTT. We render the turn locally NOW and let
    // `get_view` reconcile once the drag pauses — a transient, self-correcting
    // divergence, and only on the GL-free path (the driver is consulted solely
    // when `compositor.state.rasterizing === false`). The epoch guard in
    // `refreshView` keeps a stale reply from snapping the picture back mid-drag.
    onView: (next) => {
      view = next;
      localView.advance();
      renderer.setView(next);
      dirty = true;
    },
    /**
     * The object under the press, for the object and view actions — PyMOL
     * takes the same thing from `LastPicked` (`SceneMouse.cpp:1512`).
     */
    pick: (x, y) => {
      if (view === null) return null;
      const hit = pickIndex.pick(view, sceneRect(), x, y, { pixelRatio: size.dpr });
      return hit === null ? null : { object: hit.object, index: hit.index };
    },
    /** The rubber band, resolved against the same index the click uses. */
    boxHits: (band) => (view === null ? [] : pickIndex.box(view, sceneRect(), band)),
    onBand: (band) => {
      bandBox = band;
      dirty = true;
    },
  });

  const input = createInputController({
    element: surface.glCanvas,
    get cameraDriver() {
      // Sampled at FLUSH time. Do NOT move this into `stats`: that object is
      // rebuilt only when the render path runs, so a drag that moves nothing
      // leaves it stale — which is what made this look like "the gate was
      // never consulted" for two rounds.
      gateSamples.push(compositor.state.rasterizing);
      return compositor.state.rasterizing ? undefined : cameraDriver;
    },
    transport,
    geometry: () => ({ cssWidth: cssSize.width, cssHeight: cssSize.height, dpr: size.dpr }),
    /**
     * CLIENT-SIDE PICK, only when the backend cannot pick for itself.
     *
     * PyMOL's pick renders a colour buffer and reads pixels
     * (`packages/engine/layer1/ScenePicking.cpp`), so a bridge with no GL context cannot do it
     * at all — a click there selects nothing, silently. This resolves the click
     * against the same geometry Mode G is drawing and issues a real selection.
     *
     * NOT enabled against a GL backend on purpose: measured agreement with
     * PyMOL's own pick is ~93.5%, i.e. about one click in fifteen lands on a
     * neighbouring atom. That is not good enough to replace an authoritative
     * pick, but it is far better than the alternative here, which is nothing.
     */
    onPick: (_point, ev) => {
      if (compositor.state.rasterizing) return; // the server will pick; leave it alone
      if (view === null) return;
      // The index wants DOM coordinates in CSS pixels against the SCENE
      // rectangle, not the PyMOL-space point the input path produces (that is
      // already y-flipped and dpr-scaled, and would pick the mirrored atom).
      const box = surface.glCanvas.getBoundingClientRect();
      const hit = pickIndex.pick(view, sceneRect(), ev.clientX - box.left, ev.clientY - box.top, {
        pixelRatio: size.dpr,
      });
      pickStats.attempts++;
      if (hit === null) {
        pickStats.misses++;
        return;
      }
      pickStats.hits++;
      // WHO GETS THE CLICK. `SceneClick` dispatches on the ButMode action, so
      // the same pixel means "select" in viewing mode and "fill pk1..pk4" in
      // editing mode (`packages/engine/layer1/SceneMouse.cpp:404-470`). A registered route is
      // the client's editing branch — the Builder registers one while it is
      // open — and when it takes the hit the default selection must NOT also
      // run, or every editor pick would rewrite `sele` behind the user's back.
      // The order is asserted in `picking/p10pickroute.test.ts`.
      dispatchViewportPick(hit, (selection) => {
        void transport
          .call('cmd.select', ['sele', selection])
          .catch((cause: unknown) =>
            onError(cause instanceof Error ? cause : new Error(String(cause))),
          );
      });
    },
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
        // Same epoch invariant as optimistic rotation: a `get_view` reply in
        // flight when this pinch lands is now stale and must be rejected, or it
        // snaps the zoom back mid-gesture.
        localView.advance();
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
      renderer.setPixelRatio(next.dpr);
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
    frame: (frame) => {
      // D2: the header is the authority on who draws what. Observe it BEFORE
      // presenting, so the bitmap and the Mode-G scene never disagree for even
      // one composited frame.
      compositor.observeFrame(frame);
      presenter.present(frame);
    },
    error: (error) => {
      // A source error is also how "this bridge has no pixel producer" reaches
      // us. It has to be checked HERE and not only at construction, because
      // the answer is one round trip away and because an app is free to supply
      // its own `pixelSource` with its own `onUnavailable` — the shipping one
      // passes a no-op, and that is exactly how a GL-free bridge ended up with
      // a black viewport: Mode G had 4 pulls answered `ok` and dropped every
      // frame, because the compositor was still waiting to be told what the
      // server was drawing.
      syncStreamAvailability();
      onError(error);
    },
  });

  geometrySource.start({
    frame: (frame: GeometryFrame) => {
      // `geometry` is a fan-out TOPIC: the bridge pushes a frame to every
      // subscribed session, not just the one that asked. Applying it blindly
      // draws another client's geometry over our Mode-P image — measured, with
      // a second tab open: an unrequested cyan cartoon composited on top of the
      // rainbow pixel stream. A frame for a rep this viewport is not running in
      // Mode G is therefore evidence the accessor works, and nothing else.
      const rep = frame.header.rep;
      const requested = policy.state(rep).requested;
      policy.setCaps({ accessor: true });
      if (requested !== 'geometry') {
        renderer.removeRep(rep);
        return;
      }

      // DRAWABLE GEOMETRY ARRIVING IS PROOF THAT AN `extraction-failed`
      // FALLBACK IS STALE, so clear it BEFORE asking the compositor.
      //
      // MEASURED, IN A BROWSER, AND IT IS WHY THIS IS HERE. Toggle sticks to
      // Mode G while sticks is HIDDEN: every pull is legitimately answered
      // `not-built`, the watchdog below counts four of those as "no geometry
      // arrived", and degrades the rep permanently. Then `show sticks` pulls,
      // the bridge sends a perfectly good 718-cylinder frame — and it was
      // dropped, because `shouldDraw` is derived from the EFFECTIVE mode and
      // the rep had been handed back to Mode P. HUD read
      // `sticks P G extraction-failed` with 0 draws for ever.
      if (!isEmptyGeometryFrame(frame.header) && policy.state(rep).effective !== 'geometry') {
        policy.clear(rep);
      }

      // D2: the server is still rasterising this rep, so drawing it here is
      // the double draw. Drop the frame rather than build buffers we must not
      // show; `compositor.draw()` re-requests it the moment that changes.
      if (!compositor.shouldDraw(rep)) {
        renderer.removeRep(frame.header.rep);
        pickIndex.removeRep(frame.header.rep);
        forgetGeometryFor(frame.header.rep);
        return;
      }
      const problems = renderer.apply(frame);
      // The pick index shadows the renderer exactly: same frames in, same reps
      // out. A GL-free backend cannot run PyMOL's pick pass (it renders a
      // colour buffer and reads pixels), so this is the only way a click can
      // become a selection there.
      pickIndex.apply(frame);
      stats.geometryFrames++;
      drawnReps.add(frame.header.rep);
      const watching = drawWatch.get(frame.header.rep);
      if (watching !== undefined) clearTimeout(watching);
      drawWatch.delete(frame.header.rep);
      policy.clear(frame.header.rep);
      if (problems.length > 0) {
        // Partially drawable is still a fallback: the user must not be shown
        // half a rep and told nothing about the other half.
        policy.degrade(frame.header.rep, 'extraction-failed');
        onError(new Error(`Mode G (${frame.header.object}): ${problems.join('; ')}`));
      }
      // A WARNING IS NOT A FALLBACK. Measured: a 50%-transparent surface is
      // drawn with order-dependent alpha where PyMOL uses OIT — IoU 0.998 and
      // mean colour error 11.6 against Mode P. Degrading on that handed every
      // transparent surface straight back to the server, which is precisely the
      // GL dependency this design exists to remove. Reported, kept on screen.
      stats.geometryWarnings = [...renderer.lastWarnings];
      // Camera-driver counters: the only way to tell "GL-free camera engaged"
      // from "raw input forwarded and silently dropped" from outside.
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
    // Read every tick rather than on the compositor's `onChange`: that only
    // fires when `drawing`/`rasterizing` move, so `declared` (which changes on
    // its own whenever a declaration is in flight) was reported as permanently
    // empty. A HUD that lies about the composition is worse than no HUD.
    const composition = compositor.state;
    stats.composition = {
      declared: composition.declared,
      drawing: composition.drawing,
      suppressed: composition.suppressed,
      rasterizing: composition.rasterizing,
    };
    options.onStats?.(stats);
  };
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop);

  /**
   * KEEP THE MODE-G CAMERA ALIVE WHEN NOTHING ELSE DOES.
   *
   * `refreshView()` is otherwise driven by input, by a resize and by one call
   * at construction. That was survivable only because Mode P was always on and
   * a server-rendered image already carried PyMOL's camera. With Mode P off —
   * `?viewportModeP=off`, and every GL-free backend — nothing re-polls it, so a
   * `zoom`/`orient`/`turn` typed at the command line moves PyMOL's camera and
   * the client never hears about it.
   *
   * MEASURED: `?viewportModeP=off`, load 1UBQ, `show cartoon` in Mode G. The
   * HUD read `135 draws · 6454 tris` and the canvas was BLACK, because the
   * camera was still the empty-scene view from before the load and the whole
   * molecule was off-screen.
   *
   * A LIVE MODE-P STREAM IS NOT A SUBSTITUTE, and assuming it was cost an hour:
   * Mode-P frames carry the camera baked into PIXELS, not as numbers, so they
   * update the server image and tell this client nothing. MEASURED with Mode P
   * streaming happily at 30 fps: `show surface, skin` in Mode G reported
   * `1 draws · 10472 tris` and the Mode-G canvas was ENTIRELY BLACK, because
   * `view` was still the empty-scene matrix captured before the structure was
   * loaded. The only real condition is "we have Mode-G content on screen".
   *
   * `cmd.get_view()` is 2.0 us backend-side and touches no GL, so 4 Hz is
   * close to free; it does not run at all for a Mode-P-only viewport.
   */
  const VIEW_POLL_MS = 250;
  const viewPoll = setInterval(() => {
    if (destroyed) return;
    if (renderer.keys().length === 0) return; // nothing of ours on screen
    refreshView();
  }, VIEW_POLL_MS);

  // NOTE: the Page-Visibility wiring used to live here as a bare
  // `document.addEventListener('visibilitychange', ...)` that forwarded
  // `document.hidden` straight to the PROCESS-WIDE `StreamParams.paused`.
  // That was both halves of D3b/D3c. It is now `createStreamPauseController`
  // above, constructed with the pixel source so it can read the mount-time
  // visibility state and gate locally.

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
      const payload = asPayload(frame);
      compositor.observeFrame(payload);
      presenter.present(payload);
    },
    pushGeometryFrame(frame: GeometryFrame): void {
      // Deliberately NOT gated on the compositor: this is the explicit
      // "draw exactly this" escape hatch used by tests and by an app driving
      // the renderer by hand. The stream path above is the gated one.
      renderer.apply(frame);
      // Keep the pick index in step on this path too — a frame pushed here is
      // still geometry the user can click.
      pickIndex.apply(frame);
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
    /**
     * GL-free camera diagnostics, read LIVE.
     *
     * Deliberately not folded into `stats`: that object is rebuilt only when
     * the render path runs, so a drag that fails to move anything leaves it
     * stale and the counters read zero — which is indistinguishable from the
     * driver never being consulted. That cost two rounds of wrong diagnosis.
     */
    get cameraRpc(): CameraCounters {
      return { ...cameraDriver.counters };
    },
    /** The ButMode action the last gesture resolved to, and the mode it used. */
    get cameraAction(): { action: number; mode: string } {
      return { action: cameraDriver.action, mode: cameraDriver.mode };
    },
    /** The live rubber band in DOM CSS pixels, or null. */
    get selectionBand(): BandBox | null {
      return bandBox;
    },
    /** `rasterizing` as the drag gate saw it, most recent last. */
    get cameraGate(): readonly boolean[] {
      return gateSamples.slice(-16);
    },
    /** Client-side pick counters. Zero unless the backend cannot pick. */
    get localPick(): LocalPickStats {
      return { ...pickStats, index: { ...pickIndex.stats } };
    },
    get inputStats(): {
      buttons: number;
      drags: number;
      wheels: number;
      coalesced: number;
      dropped: number;
      brokenGestures: number;
    } {
      return input.stats;
    },
    destroy(): void {
      destroyed = true;
      if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      pause.destroy();
      clearInterval(viewPoll);
      for (const timer of drawWatch.values()) clearTimeout(timer);
      drawWatch.clear();
      compositor.destroy();
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
