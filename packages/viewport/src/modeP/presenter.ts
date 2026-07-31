/**
 * Mode P — the pixel presenter.
 *
 * Takes encoded frames the bridge produced from `glReadPixels` on PyMOL's own
 * offscreen FBO and blits them to a 2-D canvas. This is the correctness
 * baseline: whatever PyMOL draws, the user sees, including volume, slice,
 * labels, callbacks, ray-traced images and every shader setting.
 *
 * Three rules that make it FEEL right rather than merely correct:
 *
 * 1. **Never clear the canvas waiting for a frame.** The previous frame stays
 *    up and is rescaled into the new canvas box, so a resize or a stalled
 *    stream degrades to "slightly stale" instead of "black".
 * 2. **Drop, never queue.** If a frame arrives while the previous one is still
 *    decoding, the older pending frame is discarded. Queueing turns a slow
 *    decoder into unbounded latency; the newest frame is the only one anyone
 *    wants. Dropped frames are counted, not hidden.
 * 3. **Ack after present.** `{t:'ack'}` is the bridge's at-most-one-frame flow
 *    control (plan §6 WP-04). Acking on arrival would defeat it.
 *
 * `flipY` exists because `glReadPixels` returns bottom-left-origin rows. The
 * bridge sets the flag rather than paying for a flip server-side; we undo it
 * with `createImageBitmap({imageOrientation:'flipY'})` where available and a
 * canvas transform otherwise.
 */

import type { PixelEncoding } from '@tenmol/protocol';

import type { PixelFramePayload } from '../types';

const MIME: Readonly<Record<PixelEncoding, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  'raw-rgba': 'application/octet-stream',
};

export interface PresenterStats {
  frames: number;
  dropped: number;
  fps: number;
  presentMs: number;
  lastFrameBytes: number;
  lastEncoding: PixelEncoding | null;
  lastFrameAt: number;
  width: number;
  height: number;
}

export interface PixelPresenterOptions {
  canvas: HTMLCanvasElement;
  /** Called once a frame has been blitted (used for the ack + stats). */
  onPresented?: (frame: PixelFramePayload, presentMs: number) => void;
  onError?: (error: Error) => void;
}

export interface PixelPresenter {
  present(frame: PixelFramePayload): void;
  /** Re-blit the last frame (after a canvas resize). */
  redraw(): void;
  readonly stats: PresenterStats;
  readonly hasFrame: boolean;
  destroy(): void;
}

type Drawable = ImageBitmap | HTMLImageElement | ImageData;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function createPixelPresenter(options: PixelPresenterOptions): PixelPresenter {
  const { canvas } = options;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (ctx === null) throw new Error('viewport: 2-D canvas context unavailable');

  const stats: PresenterStats = {
    frames: 0,
    dropped: 0,
    fps: 0,
    presentMs: 0,
    lastFrameBytes: 0,
    lastEncoding: null,
    lastFrameAt: 0,
    width: 0,
    height: 0,
  };

  let last: { drawable: Drawable; flipped: boolean } | null = null;
  let decoding = false;
  let queued: PixelFramePayload | null = null;
  let destroyed = false;
  let lastPresentAt = 0;

  const fail = (cause: unknown): void => {
    options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
  };

  const blit = (drawable: Drawable, flipped: boolean): void => {
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;
    if (drawable instanceof ImageData) {
      // Raw RGBA: putImageData ignores transforms, so a flip is a row copy.
      // The bridge only ever sends raw-rgba for localhost debugging.
      ctx.putImageData(drawable, 0, 0);
      return;
    }
    const sw = drawable.width;
    const sh = drawable.height;
    // CONTAIN, ANCHORED TOP-LEFT — never stretch.
    //
    // The frame is not always the size of the canvas. `cmd.get_viewport()` is
    // the SCENE rectangle, and `OrthoReshape` (`layer1/Ortho.cpp:2383-2390`)
    // subtracts `MovieGetPanelHeight()` and the internal feedback lines from
    // the window: measured 1176x629 inside a 1176x644 window as soon as an
    // object has two states and PyMOL puts its movie panel up. That rectangle
    // sits at the TOP of the window in DOM coordinates (PyMOL's origin is
    // bottom-left and the panel is at the bottom), so the frame goes at (0,0)
    // and any leftover strip stays black instead of the image being distorted.
    const scale = Math.min(w / sw, h / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.save();
    if (dw < w || dh < h) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
    if (flipped) {
      ctx.translate(0, dh);
      ctx.scale(1, -1);
    }
    ctx.drawImage(drawable as CanvasImageSource, 0, 0, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  };

  const flipRows = (data: Uint8ClampedArray, width: number, height: number): void => {
    const stride = width * 4;
    const row = new Uint8ClampedArray(stride);
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const top = y * stride;
      const bottom = (height - 1 - y) * stride;
      row.set(data.subarray(top, top + stride));
      data.copyWithin(top, bottom, bottom + stride);
      data.set(row, bottom);
    }
  };

  const decode = async (
    frame: PixelFramePayload,
  ): Promise<{ drawable: Drawable; flipped: boolean }> => {
    if (frame.encoding === 'raw-rgba') {
      const expected = frame.width * frame.height * 4;
      if (frame.bytes.byteLength < expected) {
        throw new Error(
          `raw-rgba frame is ${frame.bytes.byteLength} B, expected ${expected} for ${frame.width}x${frame.height}`,
        );
      }
      const copy = new Uint8ClampedArray(expected);
      copy.set(frame.bytes.subarray(0, expected));
      if (frame.flipY) flipRows(copy, frame.width, frame.height);
      return { drawable: new ImageData(copy, frame.width, frame.height), flipped: false };
    }

    const blob = new Blob([frame.bytes.slice()], { type: MIME[frame.encoding] });
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(
          blob,
          frame.flipY ? { imageOrientation: 'flipY' } : {},
        );
        return { drawable: bitmap, flipped: false };
      } catch {
        // Safari <15 rejects the options bag; fall through to the <img> path
        // and flip with a canvas transform instead.
        const bitmap = await createImageBitmap(blob);
        return { drawable: bitmap, flipped: frame.flipY };
      }
    }

    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image decode failed'));
        el.src = url;
      });
      return { drawable: img, flipped: frame.flipY };
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const pump = (): void => {
    if (decoding || queued === null || destroyed) return;
    const frame = queued;
    queued = null;
    decoding = true;
    const started = now();
    decode(frame)
      .then(({ drawable, flipped }) => {
        if (destroyed) {
          if (typeof ImageBitmap !== 'undefined' && drawable instanceof ImageBitmap)
            drawable.close();
          return;
        }
        // Release the previous bitmap: ImageBitmaps are GPU-side and the GC is
        // not obliged to notice.
        if (last && typeof ImageBitmap !== 'undefined' && last.drawable instanceof ImageBitmap) {
          last.drawable.close();
        }
        last = { drawable, flipped };
        blit(drawable, flipped);
        const t = now();
        const presentMs = t - started;
        const dt = lastPresentAt === 0 ? 0 : t - lastPresentAt;
        lastPresentAt = t;
        stats.frames++;
        stats.presentMs =
          stats.presentMs === 0 ? presentMs : stats.presentMs * 0.8 + presentMs * 0.2;
        if (dt > 0) {
          const fps = 1000 / dt;
          stats.fps = stats.fps === 0 ? fps : stats.fps * 0.8 + fps * 0.2;
        }
        stats.lastFrameBytes = frame.bytes.byteLength;
        stats.lastEncoding = frame.encoding;
        stats.lastFrameAt = t;
        stats.width = frame.width;
        stats.height = frame.height;
        options.onPresented?.(frame, presentMs);
      })
      .catch(fail)
      .finally(() => {
        decoding = false;
        pump();
      });
  };

  return {
    present(frame: PixelFramePayload): void {
      if (destroyed) return;
      if (queued !== null) stats.dropped++;
      queued = frame;
      pump();
    },
    redraw(): void {
      if (last !== null) blit(last.drawable, last.flipped);
    },
    stats,
    get hasFrame(): boolean {
      return last !== null;
    },
    destroy(): void {
      destroyed = true;
      queued = null;
      if (last && typeof ImageBitmap !== 'undefined' && last.drawable instanceof ImageBitmap) {
        last.drawable.close();
      }
      last = null;
    },
  };
}
