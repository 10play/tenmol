/**
 * The interactive 2D ramp canvas — the browser half of
 * `packages/engine/modules/pmg_qt/volume.py`'s `VolumeEditorWidget`.
 *
 * All arithmetic is in `ramp.ts` and all drawing is in `paint.ts`; this file is
 * only the event model. Qt's mouse vocabulary maps onto pointer events like
 * this, and the differences are the interesting part:
 *
 *   Qt                                   browser
 *   ----------------------------------   -------------------------------------
 *   event.button() Left/Middle/Right     PointerEvent.button 0 / 1 / 2
 *   event.modifiers() == Control         EXACT match on a mask, not `&`
 *   QToolTip.showText                    an absolutely positioned div
 *   QColorDialog (modal, live preview)   <input type="color"> + onChange
 *   QInputDialog.getDouble (modal)       <NumberPrompt>, resolved async
 *   wheelEvent                           a NON-PASSIVE 'wheel' listener, added
 *                                        with addEventListener because React's
 *                                        onWheel is passive and cannot
 *                                        preventDefault the page scroll
 *   middle click                         needs preventDefault on pointerdown
 *                                        AND on auxclick, or Chrome starts
 *                                        autoscroll and never sends pointerup
 *
 * Qt's `QInputDialog` blocks inside the release handler. A browser modal cannot,
 * so the release handler captures what the prompt will need, hands it to the
 * panel, and the answer is applied when it arrives — which is why
 * `onPrompt` carries the point index with it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VolumeRampPoint } from '@tenmol/protocol/topics/dialogs';
import { paint, boxContains, type ValueBoxes, type ValueBoxKey } from './paint';
import {
  DEFAULT_COLORS,
  addPoint,
  convertX,
  dragTooltip,
  findPoint,
  inPlotArea,
  movePoints,
  nudgeValueBox,
  removePoints,
  scaleAlphas,
  xToData,
  type DragConstraint,
  type RampView,
} from './ramp';

/** Qt modifier equality: `event.modifiers() == ControlModifier` is EXACT. */
const MOD_SHIFT = 1;
const MOD_CTRL = 2;

function maskOf(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): number {
  // metaKey counts as ctrl, exactly as `pmg_qt/keymapping.py:52` does for the
  // viewport, so a Mac user gets the ctrl bindings from the Command key.
  return (e.shiftKey ? MOD_SHIFT : 0) | (e.ctrlKey || e.metaKey ? MOD_CTRL : 0);
}

/** A deferred numeric-input request for a ramp point's value or alpha. */
export interface PointPromptRequest {
  point: number;
  which: 'value' | 'alpha';
}

/** A deferred colour-picker request for one ramp point (or its whole triple). */
export interface ColorPickRequest {
  point: number;
  triple: boolean;
}

/** Props for `VolumeCanvas`: the ramp view, its points, and the edit callbacks. */
export interface VolumeCanvasProps {
  view: RampView;
  points: readonly VolumeRampPoint[];
  path: readonly (readonly [number, number])[];
  originalVmin: number;
  originalVmax: number;
  realTime: boolean;
  colorIndex: number;

  onSize(width: number, height: number): void;
  /** `push` mirrors `updateVolumeColors()` — call the setter now. */
  onPoints(points: VolumeRampPoint[], push: boolean): void;
  onView(patch: Partial<RampView>): void;
  onColorIndex(next: number): void;
  /** Unconditional `updateVolumeColors()` at the end of a release. */
  onRelease(): void;
  onPrompt(request: PointPromptRequest): void;
  onValueBoxPrompt(key: ValueBoxKey): void;
  onColorPick(request: ColorPickRequest): void;
}

/** The interactive 2D volume ramp canvas — drag, zoom, and edit transfer-function points. */
export function VolumeCanvas(props: VolumeCanvasProps) {
  const { view, points } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxesRef = useRef<ValueBoxes>({});

  const [hoverPoint, setHoverPoint] = useState(-1);
  const [zoomFrom, setZoomFrom] = useState<number | null>(null);
  const [zoomTo, setZoomTo] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  /** Transient drag state. A ref, not state: it changes every pointermove. */
  const drag = useRef({
    point: -1,
    dragged: false,
    constraint: null as DragConstraint,
    /**
     * `self.init_pos` — null until a press is ACCEPTED, i.e. lands inside the
     * plot rect grown by DOT_RADIUS (`volume.py:311-316`). Upstream leaves the
     * previous press in `init_pos` forever, so a ctrl+R-drag that begins
     * outside the rect zooms from a stale anchor; that is an upstream bug and
     * is not reproduced. What IS reproduced is upstream's behaviour before any
     * press has ever been accepted (`init_pos is None` -> `mouseReleaseEvent`'s
     * `if self.init_pos and self.zoom_pos` is false): no band, no zoom.
     */
    initX: null as number | null,
    initY: 0,
    button: -1,
    mods: 0,
  });

  /* ------------------------------------------------------------ measuring */

  const { onSize } = props;
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const report = () => {
      const rect = host.getBoundingClientRect();
      onSize(Math.max(120, Math.round(rect.width)), Math.max(80, Math.round(rect.height)));
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(host);
    return () => observer.disconnect();
  }, [onSize]);

  /* ------------------------------------------------------------- painting */

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(view.width * dpr);
    canvas.height = Math.round(view.height * dpr);
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${view.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boxesRef.current = paint(ctx, {
      view,
      points,
      path: props.path,
      originalVmin: props.originalVmin,
      originalVmax: props.originalVmax,
      hoverPoint,
      zoomFrom,
      zoomTo,
      lineColor: '#8a8a8a',
      font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
      boxFill: '#ffffff',
      textColor: '#333333',
    });
  }, [
    view,
    points,
    props.path,
    props.originalVmin,
    props.originalVmax,
    hoverPoint,
    zoomFrom,
    zoomTo,
  ]);

  /* --------------------------------------------------------------- wheel */

  const onWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      // Qt: `delta = angleDelta().y(); delta /= -1000.0`. DOM deltaY has the
      // opposite sign to Qt's angleDelta, so the two minus signs cancel.
      const delta = event.deltaY / 1000.0;

      for (const key of ['vmin', 'vmax', 'amax'] as ValueBoxKey[]) {
        if (boxContains(boxesRef.current[key], x, y)) {
          // Value-box nudges are view-only and NEVER push to PyMOL (volume.py:533-545).
          props.onView(nudgeValueBox(view, key, delta));
          return;
        }
      }

      // Wheel over the plot scales every alpha and pushes REGARDLESS of the
      // real-time checkbox (volume.py:547-554).
      props.onPoints(scaleAlphas(points, delta), true);
    },
    [props, view, points],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  /* ------------------------------------------------------------- pointer */

  const localPos = (event: React.PointerEvent | PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Middle-button autoscroll and the right-button context menu both have to go.
    event.preventDefault();
    const { x, y } = localPos(event);
    const mods = maskOf(event);

    if (event.button === 0) {
      for (const key of ['vmin', 'vmax', 'amax'] as ValueBoxKey[]) {
        if (boxContains(boxesRef.current[key], x, y)) {
          props.onValueBoxPrompt(key);
          return;
        }
      }
    }

    if (!inPlotArea(view, x, y)) {
      // The press never became a drag: forget the anchor, or the next
      // ctrl+R-drag would paint its band from wherever the LAST accepted press
      // happened to be. (Measured before this guard: pressing at x=10, left of
      // the axis, then ctrl+R-dragging to x=300 zoomed from the ref's initial
      // 0 — a band the user never saw.)
      drag.current.initX = null;
      drag.current.point = -1;
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = findPoint(view, points, x, y);
    drag.current = {
      point,
      dragged: false,
      constraint: null,
      initX: x,
      initY: y,
      button: event.button,
      mods,
    };
    setZoomFrom(null);
    setZoomTo(null);

    if (point < 0 && event.button === 0) {
      const color = DEFAULT_COLORS[props.colorIndex % DEFAULT_COLORS.length]!;
      const result = addPoint(view, points, x, y, mods === MOD_CTRL, color);
      props.onColorIndex(props.colorIndex + result.colorAdvance);
      drag.current.point = result.index;
      // `dragged = True` suppresses the colour picker on release (volume.py:319).
      drag.current.dragged = true;
      props.onPoints(result.points, true);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localPos(event);
    const state = drag.current;
    const buttons = event.buttons;
    const leftOnly = buttons === 1;
    const rightOnly = buttons === 2;

    if (leftOnly || rightOnly) {
      const mods = maskOf(event);
      if (rightOnly && mods === MOD_CTRL) {
        if (state.initX === null) return; // no accepted press: no anchor
        setZoomFrom(state.initX);
        setZoomTo(x);
        return;
      }
      if (state.point >= 0) {
        state.dragged = true;
        if (rightOnly && !state.constraint) {
          const dx = x - (state.initX ?? x);
          const dy = y - state.initY;
          state.constraint = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        }
        const moved = movePoints(
          view,
          points,
          state.point,
          x,
          y,
          mods === MOD_CTRL,
          state.constraint,
        );
        setTooltip({ x: x + 12, y: y + 12, text: dragTooltip(moved.value, moved.alpha) });
        props.onPoints(moved.points, props.realTime);
      }
      return;
    }

    const next = inPlotArea(view, x, y) ? findPoint(view, points, x, y) : -1;
    if (next !== hoverPoint) setHoverPoint(next);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const state = drag.current;
    const mods = maskOf(event);
    setTooltip(null);

    if (!state.dragged && state.point >= 0) {
      if (event.button === 2) {
        // In 2.0 the help says NoModifier and the code accepts Control too.
        if (mods === MOD_CTRL || mods === 0) {
          props.onPrompt({ point: state.point, which: 'value' });
        } else if (mods === MOD_SHIFT) {
          props.onPrompt({ point: state.point, which: 'alpha' });
        }
      }
      if (event.button === 1 || (event.button === 0 && (mods & MOD_SHIFT) !== 0)) {
        props.onPoints(removePoints(points, state.point, (mods & MOD_CTRL) !== 0), true);
      } else if (event.button === 0) {
        props.onColorPick({ point: state.point, triple: mods === MOD_CTRL });
      }
    }

    state.point = -1;
    state.constraint = null;
    // Qt keeps `init_pos` forever and gets away with it because a QWidget has
    // an implicit mouse grab: after a release, no further move events reach the
    // widget unless a new press did. The DOM has no such rule — a button
    // pressed on another element and dragged across this canvas delivers
    // pointermove here — so the anchor is dropped with the grab.
    state.initX = null;
    setHoverPoint(-1);

    // `if self.init_pos.x() != self.zoom_pos.x()` (volume.py:358-362): the
    // comparison is ANCHOR vs LAST MOVE, not anchor vs the release coordinate.
    // Reading the release x instead threw away a real band whenever pointerup
    // happened to arrive back at the anchor with no pointermove there (the
    // browser is free to deliver a fresh coordinate on pointerup alone), and
    // Qt in that case zooms to the band the user actually saw painted.
    if (zoomFrom !== null && zoomTo !== null && zoomFrom !== zoomTo) {
      const a = xToData(view, convertX(view, zoomFrom));
      const b = xToData(view, convertX(view, zoomTo));
      const [vmin, vmax] = a <= b ? [a, b] : [b, a];
      props.onView({ vmin, vmax });
    }
    setZoomFrom(null);
    setZoomTo(null);
    // `self.updateVolumeColors()` at the end of mouseReleaseEvent is
    // unconditional — it ignores the real-time checkbox (volume.py:365).
    props.onRelease();
  };

  return (
    <div className="volcanvas" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="volcanvas__c"
        data-volcanvas=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onAuxClick={(e) => e.preventDefault()}
      />
      {tooltip && (
        <div className="volcanvas__tip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
