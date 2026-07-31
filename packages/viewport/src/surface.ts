/**
 * The DOM the viewport owns: two stacked canvases and an overlay.
 *
 *   pixel canvas (2-D)     Mode P frames, bottom of the stack, opaque
 *   gl canvas (WebGL2)     Mode G, transparent, on top, and the POINTER TARGET
 *   overlay (div)          HUD / status, `pointer-events: none`
 *
 * The GL canvas is the pointer target even in pure Mode P because it is the
 * topmost full-bleed element; putting the listeners on the container instead
 * would let a stray child element eat events, and `offsetX` on a child would
 * silently shift every coordinate (see `input/coords.ts`).
 *
 * `touch-action: none` is required or the browser eats the second finger for
 * scrolling before we ever see a `pointermove`.
 */

export interface ViewportSurface {
  container: HTMLElement;
  pixelCanvas: HTMLCanvasElement;
  glCanvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  /** Set both canvases to a device-pixel size with a CSS-pixel box. */
  resize(deviceWidth: number, deviceHeight: number): void;
  destroy(): void;
}

const LAYER_STYLE = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

export function createSurface(container: HTMLElement): ViewportSurface {
  const previousPosition = container.style.position;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.style.overflow = 'hidden';

  const pixelCanvas = container.ownerDocument.createElement('canvas');
  pixelCanvas.dataset['tenmolLayer'] = 'pixel';
  pixelCanvas.setAttribute('style', `${LAYER_STYLE}z-index:0;`);

  const glCanvas = container.ownerDocument.createElement('canvas');
  glCanvas.dataset['tenmolLayer'] = 'gl';
  glCanvas.setAttribute('style', `${LAYER_STYLE}z-index:1;touch-action:none;outline:none;`);
  glCanvas.tabIndex = 0;

  const overlay = container.ownerDocument.createElement('div');
  overlay.dataset['tenmolLayer'] = 'overlay';
  overlay.setAttribute('style', `${LAYER_STYLE}z-index:2;pointer-events:none;`);

  container.appendChild(pixelCanvas);
  container.appendChild(glCanvas);
  container.appendChild(overlay);

  return {
    container,
    pixelCanvas,
    glCanvas,
    overlay,
    resize(deviceWidth: number, deviceHeight: number): void {
      const w = Math.max(1, Math.round(deviceWidth));
      const h = Math.max(1, Math.round(deviceHeight));
      if (pixelCanvas.width !== w || pixelCanvas.height !== h) {
        pixelCanvas.width = w;
        pixelCanvas.height = h;
      }
      if (glCanvas.width !== w || glCanvas.height !== h) {
        glCanvas.width = w;
        glCanvas.height = h;
      }
    },
    destroy(): void {
      pixelCanvas.remove();
      glCanvas.remove();
      overlay.remove();
      container.style.position = previousPosition;
    },
  };
}
