/**
 * The `viewport` feature slot (plan §6 WP-09).
 *
 * React's job here is small and deliberate: mount a `<div>`, hand it to
 * `createViewport()`, keep the object list and the per-rep mode toggles in
 * step, and render a HUD. Every pixel inside the div — both canvases, the
 * pointer handling, the camera, the resize handshake — belongs to
 * `@tenmol/viewport`, which is framework-free precisely so that React never
 * gets between a `pointermove` and `PyMOL_Drag`.
 *
 * The viewport is created ONCE and survives re-renders and StrictMode's double
 * mount; the effect has no dependencies for that reason.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Rep,
  createViewport,
  repName,
  withFallback,
  createStreamPixelSource,
  type RenderMode,
  type RepRenderState,
  type ViewportHandle,
  type ViewportStats,
} from '@tenmol/viewport';

import { useSession, useShallowStore } from '../../app';
import { FileDropTarget } from '../files/FileDropTarget';
import { createDevPullSource, pullSourceAvailable } from './devFrames';
import {
  NULL_PIXEL_SOURCE,
  fixtureGeometrySource,
  handleExposed,
  modePDisabled,
  pullDisabled,
} from './devFixtures';
import { createSessionTransport } from './transport';
import './viewport.css';

/** The reps worth a toggle in v1: everything Mode G can express today. */
const TOGGLE_REPS: readonly number[] = [
  Rep.Cartoon,
  Rep.Cyl,
  Rep.Sphere,
  Rep.Surface,
  Rep.Line,
  Rep.Ribbon,
];

/** The viewport feature slot: mounts `@tenmol/viewport`, keeps rep toggles in step, renders the HUD. */
export function ViewportPanel(): React.JSX.Element {
  const session = useSession();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<ViewportHandle | null>(null);
  const [stats, setStats] = useState<ViewportStats | null>(null);
  const [hudOpen, setHudOpen] = useState(true);

  const objectNames = useShallowStore(session.stores.objects, (state) =>
    state.rows.filter((row) => !row.isAll && !row.isGroup).map((row) => row.name),
  );

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || viewportRef.current !== null) return;

    const transport = createSessionTransport(session);
    const stream = createStreamPixelSource({
      transport,
      // `_bridge.set_pixel_stream` does not exist yet; listening costs nothing
      // and the moment the producer lands this becomes the primary source.
      onUnavailable: () => {},
    });
    const pull = pullDisabled() ? null : createDevPullSource(transport);
    const fixtures = fixtureGeometrySource();

    const viewport = createViewport({
      container: host,
      transport,
      // 1.5 s of no pixel frames and we drop to the pull source rather than
      // showing a black canvas.
      pixelSource: modePDisabled()
        ? NULL_PIXEL_SOURCE
        : pull === null
          ? stream
          : withFallback(stream, pull, 1500),
      ...(fixtures === null ? {} : { geometrySource: fixtures }),
      maxDpr: 2,
      onError: (error) => console.warn('[viewport]', error.message),
    });
    viewportRef.current = viewport;
    // `?viewportHandle=1` only; see devFixtures.ts.
    if (handleExposed()) {
      (window as unknown as { __tenmolViewport?: ViewportHandle }).__tenmolViewport = viewport;
    }

    // The HUD does not need 60 Hz; React re-rendering at 60 Hz would be the
    // most expensive thing on the page.
    const timer = setInterval(() => setStats({ ...viewport.stats }), 250);

    return () => {
      clearInterval(timer);
      viewport.destroy();
      viewportRef.current = null;
    };
    // Intentionally no dependencies: the viewport is created once and owns
    // its own lifetime. Re-creating it on a re-render would drop the WebGL
    // context and the last Mode-P frame.
  }, []);

  // Keep the Mode-G object list in step with the object panel.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    viewport.objects.clear();
    for (const name of objectNames) viewport.objects.add(name);
    const geometryReps = viewport.stats.modes
      .filter((mode) => mode.effective === 'geometry')
      .map((mode) => mode.rep);
    for (const name of objectNames) {
      for (const rep of geometryReps) viewport.requestGeometry(name, rep, -1);
    }
  }, [objectNames]);

  const setMode = useCallback((rep: number, mode: RenderMode) => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    viewport.setRepMode(rep, mode);
    setStats({ ...viewport.stats });
  }, []);

  const modeOf = (rep: number): RepRenderState | undefined =>
    stats?.modes.find((state) => state.rep === rep);

  return (
    <div className="viewport">
      {/*
        * Window-level drag & drop (`pymol_gl_widget.py:256-270`). It lives
        * here because the viewport slot is ALWAYS mounted; it previously lived
        * inside `FilesPanel`, an overlay panel, so drops were silently ignored
        * whenever that panel was closed — which is almost always.
        */}
      <FileDropTarget />
      <div className="viewport__host" ref={hostRef} data-tenmol-viewport="true" />

      <div className={`viewport__hud${hudOpen ? '' : ' viewport__hud--closed'}`}>
        <button
          type="button"
          className="viewport__hud-toggle"
          onClick={() => setHudOpen((open) => !open)}
          title="Toggle viewport diagnostics"
        >
          {hudOpen ? '×' : 'i'}
        </button>
        {hudOpen && stats !== null && (
          <>
            <div className="viewport__hud-line">
              {stats.width}×{stats.height} @{stats.dpr}x · {stats.fps.toFixed(0)} fps ·{' '}
              {stats.presentMs.toFixed(1)} ms present
            </div>
            <div className="viewport__hud-line">
              Mode P: {stats.pixelFrames} frames
              {stats.pixelFramesDropped > 0 ? ` (${stats.pixelFramesDropped} dropped)` : ''}
              {stats.lastEncoding === null
                ? ' — waiting for the first frame'
                : ` · ${stats.lastEncoding} ${(stats.lastFrameBytes / 1024).toFixed(0)} kB`}
              {stats.inputToFrameMs > 0
                ? ` · input→frame ${stats.inputToFrameMs.toFixed(0)} ms`
                : ''}
            </div>
            <div className="viewport__hud-line">
              Mode G: {stats.geometryFrames} frames · {stats.geometryDrawCalls} draws ·{' '}
              {stats.geometryInstances} instances · {stats.geometryTriangles} tris
              {stats.awaitingAccessor ? ' — awaiting accessor' : ''}
            </div>
            {stats.paused && (
              <div className="viewport__hud-line">
                Mode P PAUSED (this client only) — {stats.pauseReasons.join(', ')}
              </div>
            )}
            {stats.geometryWarnings.length > 0 && (
              <div className="viewport__hud-line viewport__hud-line--warn">
                Mode G drawn with a known divergence: {stats.geometryWarnings.join('; ')}
              </div>
            )}
            <div className="viewport__hud-reps">
              {TOGGLE_REPS.map((rep) => {
                const state = modeOf(rep);
                const effective = state?.effective ?? 'pixel';
                return (
                  <span key={rep} className="viewport__hud-rep">
                    <span className="viewport__hud-rep-name">{repName(rep)}</span>
                    <button
                      type="button"
                      className={effective === 'pixel' ? 'is-active' : ''}
                      onClick={() => setMode(rep, 'pixel')}
                      title="Server-rendered (Mode P)"
                    >
                      P
                    </button>
                    <button
                      type="button"
                      className={effective === 'geometry' ? 'is-active' : ''}
                      onClick={() => setMode(rep, 'geometry')}
                      title="Client-side three.js from PyMOL's own geometry (Mode G)"
                    >
                      G
                    </button>
                    {state?.fallbackReason !== undefined && (
                      <span className="viewport__hud-fallback" title="Automatic fallback to Mode P">
                        {state.fallbackReason}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
            {!pullSourceAvailable() && (
              <div className="viewport__hud-line viewport__hud-line--warn">
                no pull-mode fallback in this build
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ViewportPanel;
