/**
 * Mode G — the three.js renderer.
 *
 * It owns a WebGL2 canvas, PyMOL's camera (`../camera.ts` — the same 18 floats
 * `cmd.set_view` takes, turned into the same two matrices
 * `ScenePrepareMatrix`/`SceneProjectionMatrix` build), and a keyed table of
 * built geometry: one entry per `object|rep|state`, replaced wholesale when a
 * new frame for that key arrives.
 *
 * Nothing here decides WHAT to draw. The renderer draws the frames it is
 * given; the per-rep policy and the automatic fallback live in
 * `../renderPolicy.ts` and `../viewport.ts`.
 */

import { Camera, Color, Matrix4, Scene, WebGLRenderer } from 'three';
import type { Material, Object3D } from 'three';

import {
  geometryKey,
  parseGeometryKey,
  type GeometryFrame,
  type GeometryKey,
  type RepId,
} from '@tenmol/protocol';

import { isOrthoscopic, modelViewMatrix, projectionMatrix, type ViewMatrix } from '../camera';
// D6. `../webgl/builder.ts` is a drop-in replacement for `./frames.ts`'s
// `buildGeometry` — same signature, same `BuiltGeometry` — and is the one that
// honours the surface `Vis` buffer, expands `RepMesh` line strips, draws
// radius-0 dots as screen-space points, and has cone/ellipsoid impostors.
// `./frames.ts` keeps `isEmptyGeometryFrame` and the shared types.
import { buildGeometry, unmappedCensus } from '../webgl';
import { isEmptyGeometryFrame, type BuiltGeometry } from './frames';

/** `cSetting_fog_start` default (`layer1/SettingInfo.h`). */
export const FOG_START = 0.45;

export interface GeometryRendererOptions {
  canvas: HTMLCanvasElement;
  /** Clear colour. `null` = transparent, for compositing over Mode P. */
  background?: readonly [number, number, number] | null;
  antialias?: boolean;
  onError?: (error: Error) => void;
}

export interface GeometryRendererStats {
  keys: number;
  drawCalls: number;
  instances: number;
  triangles: number;
  vertices: number;
  frames: number;
  lastBuildMs: number;
  lastRenderMs: number;
}

export interface GeometryRenderer {
  readonly stats: GeometryRendererStats;
  readonly canvas: HTMLCanvasElement;
  readonly available: boolean;
  /**
   * Framebuffer pixels per CSS pixel. Only the dots rep uses it: `dot_width` is
   * a CSS-pixel setting, so without this a HiDPI dots rep draws at half size.
   */
  setPixelRatio(dpr: number): void;
  setSize(width: number, height: number): void;
  /**
   * The SCENE rectangle inside the canvas, in device pixels, anchored top-left
   * (`cmd.get_viewport()`; see `setSceneSize` below). Defaults to the whole
   * canvas.
   */
  setSceneSize(width: number, height: number): void;
  setView(view: ViewMatrix): void;
  setBackground(background: readonly [number, number, number] | null): void;
  /** Returns the problems the build reported (empty means fully drawn). */
  apply(frame: GeometryFrame): string[];
  /**
   * Warnings from the LAST `apply()`: drawn, but knowingly divergent from Mode
   * P. Deliberately not returned by `apply` so that no caller can mistake one
   * for a fallback trigger.
   */
  readonly lastWarnings: readonly string[];
  remove(key: GeometryKey | string): void;
  /** Drop every object/state built for one rep (the per-rep toggle went off). */
  removeRep(rep: RepId): void;
  /** Drop every rep/state built for one object (`delete`, `set_name`). */
  removeObject(object: string): void;
  /** The `object|state|rep` keys currently holding GPU buffers. */
  keys(): string[];
  clear(): void;
  render(): void;
  dispose(): void;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export function createGeometryRenderer(options: GeometryRendererOptions): GeometryRenderer {
  const { canvas } = options;

  let renderer: WebGLRenderer | null = null;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: options.antialias ?? true,
      premultipliedAlpha: false,
      // PyMOL writes final colours; three must not re-encode them.
      powerPreference: 'high-performance',
    });
  } catch (cause) {
    options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
  }

  const scene = new Scene();
  // A bare Camera: both matrices are supplied by hand from the PyMOL view, so
  // Perspective/OrthographicCamera's own maths would only fight us.
  const camera = new Camera();
  camera.matrixAutoUpdate = false;

  const built = new Map<string, BuiltGeometry>();
  const stats: GeometryRendererStats = {
    keys: 0,
    drawCalls: 0,
    instances: 0,
    triangles: 0,
    vertices: 0,
    frames: 0,
    lastBuildMs: 0,
    lastRenderMs: 0,
  };

  let size = { width: 1, height: 1 };
  /** The scene rectangle inside the canvas (`cmd.get_viewport()`). */
  let scene3d = { width: 1, height: 1 };
  let view: ViewMatrix | null = null;
  let background: readonly [number, number, number] | null = options.background ?? null;
  /**
   * Framebuffer pixels per CSS pixel. The renderer is handed DEVICE pixels
   * (`setPixelRatio(1)` below), so nothing else needs this — except the dots
   * rep, whose point size is a CSS-pixel setting (`dot_width`) that has to be
   * scaled up by hand or a HiDPI dots rep draws at half size.
   */
  let pixelRatio = 1;

  if (renderer) {
    renderer.setPixelRatio(1); // we hand it device pixels already
    renderer.autoClear = true;
    applyBackground();
  }

  /**
   * GL's viewport origin is bottom-left, so the scene rectangle — which is at
   * the TOP of the canvas in DOM terms — starts at `canvasHeight - sceneHeight`.
   */
  function applyViewport(): void {
    if (!renderer) return;
    renderer.setViewport(0, size.height - scene3d.height, scene3d.width, scene3d.height);
    renderer.setScissor(0, size.height - scene3d.height, scene3d.width, scene3d.height);
    renderer.setScissorTest(scene3d.width !== size.width || scene3d.height !== size.height);
  }

  function applyBackground(): void {
    if (!renderer) return;
    if (background === null) renderer.setClearColor(new Color(0, 0, 0), 0);
    else renderer.setClearColor(new Color(background[0], background[1], background[2]), 1);
  }

  function pushUniforms(materials: Material[]): void {
    if (view === null) return;
    const ortho = isOrthoscopic(view);
    const front = view[15];
    const back = view[16];
    // layer1/Scene.cpp:5131-5135
    const fogStart = (back - front) * FOG_START + front;
    const fogScale = 1 / Math.max(1e-6, back - fogStart);
    const bg = background ?? [0, 0, 0];
    for (const material of materials) {
      const uniforms = (material as unknown as { uniforms?: Record<string, { value: unknown }> })
        .uniforms;
      if (!uniforms) continue;
      if (uniforms['u_ortho']) uniforms['u_ortho'].value = ortho;
      if (uniforms['u_fogEnd']) uniforms['u_fogEnd'].value = back;
      if (uniforms['u_fogScale']) uniforms['u_fogScale'].value = fogScale;
      if (uniforms['u_bgColor']) uniforms['u_bgColor'].value = [bg[0], bg[1], bg[2]];
      if (uniforms['u_invHeight']) uniforms['u_invHeight'].value = 1 / Math.max(1, scene3d.height);
    }
  }

  /**
   * The single removal path: out of the scene graph, disposed, out of the map.
   * Both `remove()`/`removeRep()` and the tombstone branch of `apply()` go
   * through here so there is exactly one place that can leak a buffer.
   */
  function removeKey(id: string): boolean {
    const entry = built.get(id);
    if (!entry) return false;
    scene.remove(entry.object);
    entry.dispose();
    built.delete(id);
    return true;
  }

  function recount(): void {
    stats.keys = built.size;
    stats.drawCalls = 0;
    stats.instances = 0;
    stats.triangles = 0;
    stats.vertices = 0;
    for (const entry of built.values()) {
      stats.drawCalls += entry.stats.drawCalls;
      stats.instances += entry.stats.instances;
      stats.triangles += entry.stats.triangles;
      stats.vertices += entry.stats.vertices;
    }
  }

  let lastWarnings: readonly string[] = [];

  return {
    stats,
    canvas,
    get lastWarnings(): readonly string[] {
      return lastWarnings;
    },
    get available(): boolean {
      return renderer !== null;
    },

    setPixelRatio(dpr: number): void {
      pixelRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    },

    setSize(width: number, height: number): void {
      size = { width: Math.max(1, width), height: Math.max(1, height) };
      renderer?.setSize(size.width, size.height, false);
      if (scene3d.width > size.width || scene3d.height > size.height) {
        scene3d = { ...size };
      }
      applyViewport();
      if (view !== null) this.setView(view);
    },

    /**
     * PyMOL's scene is not always the whole window: `OrthoReshape`
     * (`layer1/Ortho.cpp:2383-2390`) subtracts the movie panel and the internal
     * feedback lines, so `get_viewport()` can be 1176x629 inside a 1176x644
     * window. Mode P letterboxes the bitmap into that rectangle; Mode G has to
     * draw into the SAME rectangle or the two modes disagree by exactly the
     * panel height, which is how this was found.
     */
    setSceneSize(width: number, height: number): void {
      scene3d = {
        width: Math.max(1, Math.min(width, size.width)),
        height: Math.max(1, Math.min(height, size.height)),
      };
      applyViewport();
      if (view !== null) this.setView(view);
    },

    setView(next: ViewMatrix): void {
      view = next;
      const aspect = scene3d.width / Math.max(1, scene3d.height);
      const mv = modelViewMatrix(next);
      const proj = projectionMatrix(next, aspect);
      // camera.matrix -> matrixWorld -> matrixWorldInverse = the modelview.
      const world = new Matrix4().fromArray(mv).invert();
      camera.matrix.copy(world);
      camera.matrixWorld.copy(world);
      camera.matrixWorldInverse.fromArray(mv);
      camera.matrixWorldNeedsUpdate = false;
      camera.projectionMatrix.fromArray(proj);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      for (const entry of built.values()) pushUniforms(entry.materials);
    },

    setBackground(next: readonly [number, number, number] | null): void {
      background = next;
      applyBackground();
      for (const entry of built.values()) pushUniforms(entry.materials);
    },

    apply(frame: GeometryFrame): string[] {
      const started = now();
      const key = geometryKey(frame.header);

      // A frame with nothing drawable is a REMOVAL, not an empty build. This is
      // the client half of defect D1: `hide everything` produces a tombstone
      // (`./cache.ts`) and the cartoon's buffers are disposed here. Building an
      // empty Group instead would leave the previous build on screen whenever
      // nothing else replaced it, and leak one dead node per key.
      if (isEmptyGeometryFrame(frame.header)) {
        removeKey(key);
        stats.frames++;
        stats.lastBuildMs = now() - started;
        recount();
        // D6. A tombstone and "the bridge filled a bucket it has no packer for"
        // are BOTH empty frames, and telling them apart is the difference
        // between a correct removal and a silently black viewport with a green
        // Mode-G badge. `lines`, `ribbon`, `nonbonded`, `extent`, `dashes` and
        // `angles` all arrive as payloadBytes 0 with a non-empty census; that
        // must degrade the rep, whereas a `hide` must not.
        const census = unmappedCensus(frame.header);
        return census === null
          ? []
          : [`frame carried no drawable geometry; the bridge did not pack: ${census}`];
      }

      lastWarnings = [];
      let entry: BuiltGeometry;
      try {
        entry = buildGeometry(frame, { pixelRatio });
      } catch (cause) {
        options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
        return [`build failed: ${String(cause)}`];
      }
      removeKey(key);
      built.set(key, entry);
      scene.add(entry.object);
      pushUniforms(entry.materials);
      stats.frames++;
      stats.lastBuildMs = now() - started;
      recount();
      lastWarnings = entry.warnings ?? [];
      return entry.problems;
    },

    remove(key: GeometryKey | string): void {
      if (removeKey(typeof key === 'string' ? key : geometryKey(key))) recount();
    },

    removeRep(rep: RepId): void {
      for (const id of [...built.keys()]) {
        const parsed = parseGeometryKey(id);
        if (parsed === null || parsed.rep !== rep) continue;
        removeKey(id);
      }
      recount();
    },

    /** Drop every state and rep built for one object (`delete`, rename). */
    removeObject(object: string): void {
      for (const id of [...built.keys()]) {
        const parsed = parseGeometryKey(id);
        if (parsed === null || parsed.object !== object) continue;
        removeKey(id);
      }
      recount();
    },

    keys(): string[] {
      return [...built.keys()];
    },

    clear(): void {
      for (const id of [...built.keys()]) removeKey(id);
      recount();
    },

    render(): void {
      if (!renderer) return;
      const started = now();
      renderer.render(scene, camera);
      stats.lastRenderMs = now() - started;
    },

    dispose(): void {
      this.clear();
      renderer?.dispose();
      renderer = null;
      const parent: Object3D = scene;
      parent.clear();
    },
  };
}
