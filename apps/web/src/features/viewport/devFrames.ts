/**
 * The Mode-P pull-mode fallback, wired to the dev server's frame endpoint.
 *
 * WHY THIS EXISTS. Mode P's real transport is a WebSocket binary stream the
 * bridge produces from `glReadPixels` (3.4 ms/frame at 1280x960, plan §1.3).
 * That producer is a different work package and is not on disk yet. Rather than
 * ship a viewport that cannot show a picture — or, worse, fake one — the
 * viewport carries a second source built only from primitives that exist today:
 *
 *     cmd.png(<path>)          PyMOL renders and writes a PNG   (bridge side)
 *     GET /__tenmol/frame      the dev server hands it back     (vite side)
 *
 * It is slower and has no flow control, and the HUD says so. It is also the
 * honest degradation path if the pixel stream ever stalls: a real, if stale,
 * image beats a black canvas.
 *
 * `__TENMOL_FRAME_DIR__` is injected by `apps/web/vite.config.ts` and is empty
 * in a production build, which disables this source entirely.
 */

import { createPngPullSource, type PixelSource, type ViewportTransport } from '@tenmol/viewport';

declare const __TENMOL_FRAME_DIR__: string;
declare const __TENMOL_FRAME_ENDPOINT__: string;

export const FRAME_DIR: string =
  typeof __TENMOL_FRAME_DIR__ === 'string' ? __TENMOL_FRAME_DIR__ : '';
export const FRAME_ENDPOINT: string =
  typeof __TENMOL_FRAME_ENDPOINT__ === 'string' ? __TENMOL_FRAME_ENDPOINT__ : '/__tenmol/frame';

export function pullSourceAvailable(): boolean {
  return FRAME_DIR.length > 0;
}

export function createDevPullSource(transport: ViewportTransport): PixelSource | null {
  if (!pullSourceAvailable()) return null;
  const sep = FRAME_DIR.includes('\\') ? '\\' : '/';
  return createPngPullSource({
    transport,
    // Two slots, alternated, so a GET of frame N never observes the partial
    // bytes of frame N+1.
    paths: [`${FRAME_DIR}${sep}frame-a.png`, `${FRAME_DIR}${sep}frame-b.png`],
    urlFor: (path, seq) =>
      `${FRAME_ENDPOINT}?path=${encodeURIComponent(path.slice(FRAME_DIR.length + 1))}&v=${seq}`,
    maxFps: 30,
    idleFps: 1,
  });
}
