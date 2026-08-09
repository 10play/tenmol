/**
 * The render-only harness: mounts ONLY the WebGL canvas (no menubar, panels,
 * console, HUD), loads a corpus scene, fixes the camera and size, and signals
 * when the render has settled — so a headless browser can screenshot the render
 * for the visual/perf regression suites. Reuses the same local-mode viewport
 * config as `ViewportPanel`, minus all UI.
 */

import { useEffect, useRef } from 'react';
import { createViewport, Rep, type LabelPoint, type ViewportHandle } from '@tenmol/viewport';
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
  stats: unknown;
}

function setReady(v: RenderReady): void {
  (window as unknown as { __tenmolRenderReady?: RenderReady }).__tenmolRenderReady = v;
}

/** Resolve once the geometry stream has quiesced (or after a hard timeout). */
function settle(viewport: ViewportHandle): Promise<void> {
  return new Promise((resolve) => {
    let last = -1;
    let stable = 0;
    let ticks = 0;
    const check = (): void => {
      const s = viewport.stats;
      const frames = s.geometryFrames ?? 0;
      if (frames === last) stable += 1;
      else {
        stable = 0;
        last = frames;
      }
      ticks += 1;
      const hasGeometry = (s.geometryTriangles ?? 0) > 0 || (s.geometryInstances ?? 0) > 0;
      // Settle = geometry has ARRIVED and the frame count has been stable for a
      // beat. The engine can be slow to build/push (the perf problem this suite
      // exists to fix), so wait for real geometry rather than a short timeout.
      // The long hard cap only guards a genuinely stuck/empty scene.
      if ((stable >= 12 && hasGeometry) || ticks > 1200) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

async function runScene(session: Session, viewport: ViewportHandle, scene: Scene): Promise<void> {
  const conn = session.conn;
  const obj = scene.obj ?? scene.pdb.replace(/\.pdb$/, '');
  const pdb = await (await fetch(`/visual/${scene.pdb}`)).text();
  await conn.call('delete', ['all']);
  await conn.call('read_pdbstr', [pdb, obj]);
  for (const [method, ...args] of scene.ops) await conn.call(method, args);
  for (const [name, value] of scene.settings ?? []) await conn.call('set', [name, value]);
  await conn.call('bg_color', [scene.bg]);
  if (scene.view && scene.view.length === 18) await conn.call('set_view', [scene.view]);
  else {
    await conn.call('orient', []);
    await conn.call('zoom', []);
  }
  // Mirror the object into the viewport and pull every rep it might draw.
  viewport.objects.clear();
  viewport.objects.add(obj);
  for (const rep of RENDER_REPS) viewport.requestGeometry(obj, rep, -1);
  if (scene.labels) {
    const labels = await conn.call('get_labels', ['all']);
    if (Array.isArray(labels)) viewport.setLabels(labels as unknown as LabelPoint[]);
  }
  viewport.refreshView();
  await settle(viewport);
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
    const viewport = createViewport({
      container: host,
      transport,
      pixelSource: NULL_PIXEL_SOURCE,
      policy: { default: 'geometry' as const, perRep: [] },
      maxDpr: dpr,
      onError: (error) => console.warn('[render]', error.message),
    });
    w.__tenmolViewport = viewport;

    const id = renderSceneId();
    const scene = sceneById(id);
    if (!scene) {
      setReady({ ok: false, err: `unknown scene '${id}'`, scene: id, stats: viewport.stats });
    } else {
      runScene(session, viewport, scene)
        .then(() => setReady({ ok: true, err: null, scene: id, stats: viewport.stats }))
        .catch((e: unknown) =>
          setReady({ ok: false, err: e instanceof Error ? e.message : String(e), scene: id, stats: viewport.stats }),
        );
    }

    return () => {
      viewport.destroy();
      w.__renderStageMounted = false;
    };
    // The viewport is created once and owns its lifetime; no deps by design.
  }, []);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0, background: '#000' }} />;
}

export { isRenderMode };
