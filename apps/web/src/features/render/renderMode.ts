/**
 * Query switches for the render-only harness.
 *
 *   ?render=1&scene=<id>&w=&h=&dpr=1
 *     Mount ONLY the WebGL canvas (no menubar/panels/console/HUD), load the
 *     named scene from the shared corpus (@tenmol/visual), fix the camera and
 *     size, and expose a deterministic "settled" signal — so a headless browser
 *     can screenshot the render for the visual/perf suites.
 */

function params(): URLSearchParams {
  return new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
}

/** `?render=1` — mount the bare render stage instead of the app shell. */
export function isRenderMode(): boolean {
  return params().get('render') === '1';
}

/** `?scene=<id>` — the corpus scene to render. */
export function renderSceneId(): string {
  return params().get('scene') ?? '';
}

/** `?w=&h=&dpr=` — fixed canvas size (defaults 640x480 @ dpr 1 for determinism). */
export function renderSize(): { w: number; h: number; dpr: number } {
  const p = params();
  return {
    w: Number(p.get('w')) || 640,
    h: Number(p.get('h')) || 480,
    dpr: Number(p.get('dpr')) || 1,
  };
}
