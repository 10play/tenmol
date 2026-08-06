/**
 * Browser coordinates -> PyMOL window coordinates.
 *
 * `PyMOLGLWidget._event_x_y_mod` (`packages/engine/modules/pmg_qt/pymol_gl_widget.py:169-176`):
 *
 *     (int(fb_scale * pos.x()),
 *      int(fb_scale * (self.height() - pos.y())),
 *      get_modifiers(ev))
 *
 * Three things that are easy to get wrong and expensive to debug:
 *
 * 1. **Origin.** PyMOL windows are BOTTOM-LEFT origin. The DOM is top-left.
 * 2. **The flip happens in LOGICAL pixels, before the dpr multiply.** Doing it
 *    the other way round is off by up to `dpr - 1` px on a fractional dpr,
 *    which lands on the wrong atom at the edge of a 15x15 px pick tolerance.
 * 3. **`int()` truncates, it does not round.** Qt truncates; we truncate.
 *
 * The offsets come from `getBoundingClientRect()` rather than `offsetX`,
 * because `offsetX` is relative to whichever descendant the event hit — an
 * overlay child would silently shift every coordinate.
 */

export interface SurfaceGeometry {
  /** CSS pixels. */
  cssWidth: number;
  cssHeight: number;
  /** Clamped devicePixelRatio; the framebuffer is `cssWidth * dpr` wide. */
  dpr: number;
}

export interface PointerLike {
  clientX: number;
  clientY: number;
}

/** PyMOL window coordinates (device pixels, bottom-left origin). */
export interface PymolPoint {
  x: number;
  y: number;
}

/**
 * Convert a pointer event to PyMOL window coordinates.
 *
 * @param ev the pointer event, in CSS client coordinates
 * @param rect the canvas' bounding client rect
 * @param geom the surface geometry (CSS size and device-pixel ratio)
 */
export function toPymolPoint(
  ev: PointerLike,
  rect: { left: number; top: number },
  geom: SurfaceGeometry,
): PymolPoint {
  const cssX = ev.clientX - rect.left;
  const cssY = ev.clientY - rect.top;
  return {
    x: Math.trunc(geom.dpr * cssX),
    y: Math.trunc(geom.dpr * (geom.cssHeight - cssY)),
  };
}

/**
 * Epoch seconds for the `when` field, derived from the EVENT timestamp rather
 * than `Date.now()` at send time.
 *
 * PyMOL measures double-click (0.35 s), single-click (0.25 s / the 0.15 s
 * `SingleClickDelay` floor) and the 4 px / 10 px drag thresholds backend-side
 * against `UtilGetSeconds` at the moment the event is *enqueued*
 * (`packages/engine/layer1/Scene.cpp:4113-4155`). Any queueing we do on the client shows up as
 * jitter in those measurements unless `when` carries the real event time.
 *
 * `event.timeStamp` is relative to `performance.timeOrigin` in every modern
 * browser; if a synthetic event has none we fall back to now.
 */
export function whenOf(ev: { timeStamp?: number }): number {
  const nowMs = Date.now();
  const ts = typeof ev.timeStamp === 'number' && ev.timeStamp > 0 ? ev.timeStamp : undefined;
  if (ts === undefined) return nowMs / 1000;

  const origin =
    typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number'
      ? performance.timeOrigin
      : nowMs;

  // Sanity-clamp, because `timeStamp` is not universally relative: real
  // browsers give ms since `timeOrigin`, but jsdom (and some synthetic events)
  // hand back an absolute epoch value, and adding `timeOrigin` to that puts
  // `when` 50-odd years in the future -- which the backend would read as a
  // click that never times out.
  const MINUTE = 60_000;
  const relative = origin + ts;
  if (Math.abs(relative - nowMs) < MINUTE) return relative / 1000;
  if (Math.abs(ts - nowMs) < MINUTE) return ts / 1000;
  return nowMs / 1000;
}
