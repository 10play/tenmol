/**
 * The label text overlay — absolutely-positioned DOM text drawn over the canvas
 * at projected 3-D atom positions. Labels are model-space, so their screen
 * positions are recomputed from the camera every frame (the same
 * `modelViewMatrix` + `screenPoint` path the picker uses, `picking/pick.ts`).
 *
 * The overlay owns a pool of `<span>` elements inside the surface's z-index-2
 * overlay div (`surface.ts`), so it never fights the canvas for pointer events.
 */

import { modelViewMatrix, type ViewMatrix } from './camera';
import { screenPoint } from './picking/ray';

/** One label: a model-space position and its text. */
export interface LabelPoint {
  x: number;
  y: number;
  z: number;
  text: string;
}

interface Rect {
  width: number;
  height: number;
}

/**
 * A DOM overlay that draws atom labels as absolutely-positioned `<span>`s over
 * the WebGL canvas, reprojected to screen space for the current camera. Owns its
 * span pool and is driven by the viewport's render loop.
 */
export interface LabelOverlay {
  /** Replace the label set. */
  set(labels: readonly LabelPoint[]): void;
  /** Reproject and reposition all labels for the current camera. */
  render(view: ViewMatrix | null, rect: Rect): void;
  /** Number of labels currently held. */
  readonly count: number;
  destroy(): void;
}

/** Screen offset (px) matching PyMOL's label anchor (slightly right & below). */
const LABEL_DX = 5;
const LABEL_DY = 1.5;

const SPAN_CSS =
  'position:absolute;transform:translate(-50%,-50%);' +
  'color:#dcdcdc;font:11px ui-monospace,Menlo,monospace;white-space:nowrap;' +
  'pointer-events:none;user-select:none;';

/** Create a {@link LabelOverlay} that appends its label spans to `overlay`. */
export function createLabelOverlay(overlay: HTMLElement): LabelOverlay {
  const doc = overlay.ownerDocument;
  const spans: HTMLSpanElement[] = [];
  let labels: readonly LabelPoint[] = [];

  const ensure = (n: number): void => {
    while (spans.length < n) {
      const el = doc.createElement('span');
      el.style.cssText = SPAN_CSS;
      overlay.appendChild(el);
      spans.push(el);
    }
    // Hide surplus spans (kept in the pool for reuse).
    for (let i = n; i < spans.length; i++) spans[i]!.style.display = 'none';
  };

  const render = (view: ViewMatrix | null, rect: Rect): void => {
    if (view === null || labels.length === 0) {
      for (const s of spans) s.style.display = 'none';
      return;
    }
    ensure(labels.length);
    const m = modelViewMatrix(view);
    const mv = (i: number): number => m[i] ?? 0;
    for (let i = 0; i < labels.length; i++) {
      const lab = labels[i]!;
      const el = spans[i]!;
      const eye: [number, number, number] = [
        mv(0) * lab.x + mv(4) * lab.y + mv(8) * lab.z + mv(12),
        mv(1) * lab.x + mv(5) * lab.y + mv(9) * lab.z + mv(13),
        mv(2) * lab.x + mv(6) * lab.y + mv(10) * lab.z + mv(14),
      ];
      const p = screenPoint(view, rect, eye);
      if (p.behind) {
        el.style.display = 'none';
        continue;
      }
      if (el.textContent !== lab.text) el.textContent = lab.text;
      el.style.display = '';
      // PyMOL anchors the label to the right of the projected atom, so its text
      // centroid sits ~14px to the right of the atom centre; we match that.
      el.style.left = `${p.x + LABEL_DX}px`;
      el.style.top = `${p.y + LABEL_DY}px`;
    }
  };

  return {
    set(next) {
      labels = next.slice();
    },
    render,
    get count() {
      return labels.length;
    },
    destroy() {
      for (const s of spans) s.remove();
      spans.length = 0;
      labels = [];
    },
  };
}
