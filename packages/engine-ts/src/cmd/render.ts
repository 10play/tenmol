/**
 * `ray` / `draw` / `get_image` — the CPU ray-tracing render path. Gathers the
 * scene the engine would draw, ray-traces it headlessly, and caches the RGBA
 * image (per executive) so `get_image` / `png` can read it back. Mirrors real
 * PyMOL: `ray` renders into an internal image buffer and returns nothing.
 */
import type { Json } from '@tenmol/protocol';

import { rgbForIndex } from '../exec/color';
import type { Executive } from '../exec/executive';
import { makeCamera } from '../render/camera';
import type { Color } from '../render/primitives';
import { primitiveBounds } from '../render/primitives';
import { bvhScene, DEFAULT_LIGHTS, render } from '../render/raytrace';
import { gatherScene } from '../render/scene';
import { encodePng } from '../render/png';
import type { RegistrarCtx } from './registrar';

export interface RayImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** Last-rendered image, keyed by executive (no state stored on Executive). */
const IMAGES = new WeakMap<Executive, RayImage>();

/** Read the cached image for an executive (used by png/get_bytes). */
export function lastImage(ex: Executive): RayImage | undefined {
  return IMAGES.get(ex);
}

function pick(args: unknown[], kwargs: Record<string, unknown>, i: number, name: string): unknown {
  const a = args[i];
  return a !== undefined && a !== null && a !== '' ? a : kwargs[name];
}

export function registerRender(ctx: RegistrarCtx): void {
  const ex = ctx.executive;

  const bgColor = (): Color => {
    // `bg_rgb` is stored as a colour INDEX (engine.ts bg_color); default black.
    const raw = ex.getSetting('bg_rgb');
    const idx = raw === undefined ? 1 : Number(raw);
    const rgb = rgbForIndex(Number.isFinite(idx) ? idx : 1);
    return [rgb[0], rgb[1], rgb[2]];
  };

  const viewport = (): [number, number] => {
    const vp = ctx.call('get_viewport') as number[] | undefined;
    return [Math.max(1, Math.round(vp?.[0] ?? 640)), Math.max(1, Math.round(vp?.[1] ?? 480))];
  };

  const renderInto = (args: unknown[], kwargs: Record<string, unknown>, shadows: boolean): void => {
    const [vw, vh] = viewport();
    const wArg = Math.round(Number(pick(args, kwargs, 0, 'width')) || 0);
    const hArg = Math.round(Number(pick(args, kwargs, 1, 'height')) || 0);
    const width = wArg > 0 ? wArg : vw;
    const height = hArg > 0 ? hArg : vh;

    const prims = gatherScene(ex, 1);
    const scene = bvhScene(prims);
    const cam = makeCamera(ex.view.get(), width, height);

    // Scene diameter → generous shadow-ray length.
    let dia = 1e3;
    if (prims.length) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const p of prims) {
        const b = primitiveBounds(p);
        for (let k = 0; k < 3; k++) {
          if (b.min[k]! < min[k]!) min[k] = b.min[k]!;
          if (b.max[k]! > max[k]!) max[k] = b.max[k]!;
        }
      }
      dia = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) || 1e3;
    }

    // antialias: default (arg -1) → 2× supersample (PyMOL antialias 1); 0 → off.
    const aaArg = Number(pick(args, kwargs, 2, 'antialias') ?? -1);
    const antialias = aaArg < 0 ? 2 : aaArg >= 2 ? 3 : aaArg >= 1 ? 2 : 1;

    // Depth-cue fog: PyMOL `depth_cue`/`fog` default on (getSettingFloat returns
    // 0 for absent settings, so fall back to PyMOL's 1). Only fogs when the view
    // carries real near/far clip planes (set by zoom); a bare view leaves it off.
    const depthCue = ex.getSetting('depth_cue') === undefined ? 1 : ex.getSettingFloat('depth_cue');
    const fogAmt = ex.getSetting('fog') === undefined ? 1 : ex.getSettingFloat('fog');
    const fogStart = ex.getSetting('fog_start') === undefined ? 0.45 : ex.getSettingFloat('fog_start');
    const fog =
      depthCue && fogAmt > 0 && cam.far > cam.near
        ? { near: cam.near, far: cam.far, start: fogStart, amount: fogAmt }
        : null;

    const rgba = render(scene, cam, {
      bg: bgColor(),
      lights: { ...DEFAULT_LIGHTS, shadows },
      antialias,
      fog,
      shadowLen: dia * 2,
    });
    IMAGES.set(ex, { width, height, rgba });
  };

  // ray(width=0, height=0, antialias=-1, ...) — CPU ray trace into the buffer.
  ctx.command('ray', (args, kwargs): Json => {
    renderInto(args, kwargs, true);
    return null;
  });

  // draw(width=0, height=0, ...) — a fast raster (no shadows), same buffer.
  ctx.command('draw', (args, kwargs): Json => {
    renderInto(args, kwargs, false);
    return null;
  });

  // get_image() — the last render as flat RGBA (Json-safe number[]; length w*h*4).
  ctx.command('get_image', (): Json => {
    const img = IMAGES.get(ex);
    return img ? (Array.from(img.rgba) as number[]) : [];
  });

  // png(filename='', width=0, height=0, dpi=-1, ray=0, ...) — encode the frame as
  // real PNG bytes (signature 137,80,78,71). Disk writes stay headless-no-ops, but
  // the bytes are returned so the web app can download them. `ray=1` renders first.
  ctx.command('png', (args, kwargs): Json => {
    const doRay = Number(pick(args, kwargs, 4, 'ray') ?? 0);
    if (doRay || !IMAGES.get(ex)) {
      // png(filename, width, height, ...) → renderInto reads width/height at 0/1.
      const w = pick(args, kwargs, 1, 'width');
      const h = pick(args, kwargs, 2, 'height');
      renderInto([w, h], {}, true);
    }
    const img = IMAGES.get(ex);
    if (!img) return [];
    return Array.from(encodePng(img.rgba, img.width, img.height)) as number[];
  });
}
