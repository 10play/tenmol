/**
 * The render-only harness: mounts ONLY the WebGL canvas (no menubar, panels,
 * console, HUD), loads a corpus scene, fixes the camera and size, and signals
 * when the render has settled — so a headless browser can screenshot the render
 * for the visual/perf regression suites. Reuses the same local-mode viewport
 * config as `ViewportPanel`, minus all UI.
 */

import { useEffect, useRef } from 'react';
import {
  createStreamPixelSource,
  createViewport,
  Rep,
  type LabelPoint,
  type ViewportHandle,
} from '@tenmol/viewport';
import { sceneById, type Scene } from '@tenmol/visual';

import { useSession, type Session } from '../../app';
import { createSessionTransport } from '../viewport/transport';
import { NULL_PIXEL_SOURCE } from '../viewport/devFixtures';
import { isRenderMode, renderSceneId, renderSize } from './renderMode';

/** Reps the harness asks the engine to draw (everything the corpus can show). */
const RENDER_REPS: readonly number[] = [
  Rep.Cartoon, Rep.Cyl, Rep.Sphere, Rep.Surface, Rep.Line, Rep.Ribbon,
  Rep.Mesh, Rep.Dot, Rep.Nonbonded, Rep.NonbondedSphere, Rep.Ellipsoid,
  Rep.Dash, Rep.Cell, Rep.Extent,
];

interface RenderReady {
  ok: boolean;
  err: string | null;
  scene: string;
  /** ms from scene start to render-settled — the geometry build + first paint cost. */
  buildMs: number;
  stats: unknown;
}

function setReady(v: RenderReady): void {
  (window as unknown as { __tenmolRenderReady?: RenderReady }).__tenmolRenderReady = v;
}

/**
 * Resolve once the render has quiesced. In local mode that means the Mode-G
 * geometry stream stopped arriving with real geometry present; in remote mode it
 * means PyMOL's Mode-P pixel stream settled (its lossless PNG "still" has landed).
 * A long hard cap guards a genuinely stuck/empty scene.
 */
function settle(viewport: ViewportHandle, remote: boolean): Promise<void> {
  return new Promise((resolve) => {
    let last = -1;
    let stable = 0;
    let ticks = 0;
    const check = (): void => {
      const s = viewport.stats;
      const frames = remote ? (s.pixelFrames ?? 0) : (s.geometryFrames ?? 0);
      if (frames === last) stable += 1;
      else {
        stable = 0;
        last = frames;
      }
      ticks += 1;
      const has = remote
        ? (s.pixelFrames ?? 0) > 0
        : (s.geometryTriangles ?? 0) > 0 || (s.geometryInstances ?? 0) > 0;
      if ((stable >= 12 && has) || ticks > 1200) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

async function runScene(
  session: Session,
  viewport: ViewportHandle,
  scene: Scene,
  remote: boolean,
): Promise<void> {
  const conn = session.conn;
  const obj = scene.obj ?? scene.pdb.replace(/\.pdb$/, '');
  const pdb = await (await fetch(`/visual/${scene.pdb}`)).text();
  await conn.call('delete', ['all']);
  await conn.call('read_pdbstr', [pdb, obj]);
  for (const [method, ...args] of scene.ops) await conn.call(method, args);
  for (const [name, value] of scene.settings ?? []) await conn.call('set', [name, value]);
  await conn.call('bg_color', [scene.bg]);
  // Frame with the EXACT camera the PyMOL reference used (views.json, written by
  // the reference generator), so the TS render lines up pixel-for-pixel. Fall
  // back to orient+zoom when no committed view exists yet (dev / new scene).
  let view = scene.view;
  if (!view || view.length !== 18) {
    try {
      const views = (await (await fetch('/visual/views.json')).json()) as Record<string, number[]>;
      const v = views[scene.id];
      if (Array.isArray(v) && v.length === 18) view = v;
    } catch {
      /* no committed views yet */
    }
  }
  if (view && view.length === 18) await conn.call('set_view', [view]);
  else {
    await conn.call('orient', []);
    await conn.call('zoom', []);
  }
  // Local (Mode-G): mirror the object + pull every rep the scene might draw.
  // Remote (Mode-P): PyMOL rasterises server-side, so this is a harmless no-op.
  viewport.objects.clear();
  viewport.objects.add(obj);
  if (!remote) for (const rep of RENDER_REPS) viewport.requestGeometry(obj, rep, -1);
  if (scene.labels && !remote) {
    const labels = await conn.call('get_labels', ['all']);
    if (Array.isArray(labels)) viewport.setLabels(labels as unknown as LabelPoint[]);
  }
  viewport.refreshView();
  await settle(viewport, remote);
}

export function RenderStage(): React.JSX.Element {
  const session = useSession();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const w = window as unknown as { __renderStageMounted?: boolean; __tenmolViewport?: ViewportHandle };
    if (host === null || w.__renderStageMounted) return;
    w.__renderStageMounted = true;

    const { w: width, h: height, dpr } = renderSize();
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;

    const transport = createSessionTransport(session);
    // Remote backend: capture PyMOL's own Mode-P render (real-time GL) as the
    // reference. Local backend: our Mode-G three.js render. Same harness, same
    // scene, same size/camera -> directly comparable.
    const remote = session.config.backend === 'remote';
    const viewport = createViewport({
      container: host,
      transport,
      pixelSource: remote ? createStreamPixelSource({ transport, onUnavailable: () => {} }) : NULL_PIXEL_SOURCE,
      policy: remote
        ? { default: 'pixel' as const, perRep: [] }
        : { default: 'geometry' as const, perRep: [] },
      maxDpr: dpr,
      onError: (error) => console.warn('[render]', error.message),
    });
    w.__tenmolViewport = viewport;

    const id = renderSceneId();
    const scene = sceneById(id);
    const t0 = performance.now();
    if (!scene) {
      setReady({ ok: false, err: `unknown scene '${id}'`, scene: id, buildMs: 0, stats: viewport.stats });
    } else {
      runScene(session, viewport, scene, remote)
        .then(() =>
          setReady({ ok: true, err: null, scene: id, buildMs: performance.now() - t0, stats: viewport.stats }),
        )
        .catch((e: unknown) =>
          setReady({
            ok: false,
            err: e instanceof Error ? e.message : String(e),
            scene: id,
            buildMs: performance.now() - t0,
            stats: viewport.stats,
          }),
        );
    }

    return () => {
      viewport.destroy();
      w.__renderStageMounted = false;
    };
    // The viewport is created once and owns its lifetime; no deps by design.
  }, []);

  return <div ref={hostRef} data-render-stage="" style={{ position: 'absolute', top: 0, left: 0, background: '#000' }} />;
}

export { isRenderMode };
