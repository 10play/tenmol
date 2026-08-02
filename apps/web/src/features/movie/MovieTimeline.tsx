/**
 * The movie panel: one row per motion track, drawn with PyMOL's own palette.
 *
 * Rows come from `get_movie_panel()`, which reproduces `ExecutiveMotionDraw`
 * (`layer3/Executive.cpp:692`): row 0 is the camera (`cExecAll`), then one row
 * per object whose `ViewElem` is non-null. Cells are drawn by
 * `timeline.ts:drawRow`, a port of `ViewElemDraw`.
 *
 * The mouse grammar is `MovieClick`/`MovieDrag` (`layer1/Movie.cpp:1488-1690`)
 * and it emits the identical command strings that the C panel emits through
 * `PParse`, so a log file cannot tell the two apart:
 *
 *   right-drag           `cmd.mmove(target, source, count)`
 *   shift+right-drag     `cmd.mcopy(...)`
 *   ctrl+left-drag       `cmd.minsert(n, frame)` / `cmd.mdelete(n, frame)`
 *   ctrl+middle-drag     `cmd.mview('clear', first, last)`
 *   left-drag            scrollbar -> `cmd.set_frame(v, 7)`
 *   wheel                +/- 1 frame
 *   right-click (<5 px)  the motion context menu
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MoviePanel } from '@tenmol/protocol/topics/movie';
import {
  classifyGesture,
  classifyWheel,
  dragBoxes,
  dragInRange,
  drawDragBoxes,
  drawRow,
  frameToX,
  xToFrame,
  type PanelRect,
} from './timeline';
import { panelGesture, transport, type MovieAction } from './movieSource';

/**
 * `movie_panel_row_height`'s default (`layer1/SettingInfo.h`), used only until
 * the first `get_movie_panel()` payload lands. After that the row height is the
 * SETTING, because `MovieGetPanelHeight` (`layer1/Movie.cpp:1714`) is
 * `row_height * ExecutiveCountMotions()` and the Ctrl+Shift wheel
 * (`MovieClick:1561`) writes that setting — a DOM panel with a hard-coded row
 * height accepts the gesture and then does not move.
 */
const ROW_H = 15;
const GAP = 2;

/**
 * `CMovie::LabelIndent = DIP2PIXEL(8 * 8)` (`layer1/Movie.cpp:1867`) — the
 * right-hand gutter that holds the row label. It is not decoration: every hit
 * test in `MovieClick`/`MovieDrag` runs `tmpRect.right -= I->LabelIndent`
 * first (`:1495`), so the strip that maps to frames is 64 px narrower than the
 * block. Presentation mode sets it to 0 (`:1865`).
 *
 * Here the gutter is a SIBLING of the canvas rather than a slice of it, so the
 * canvas's own width already is the C's `tmpRect` and `xToFrame` needs no
 * subtraction — the layout does what the arithmetic does in the C. The
 * fallback value only matters before the first `get_movie_panel()` lands.
 */
const LABEL_INDENT = 64;

interface Props {
  panel: MoviePanel | null;
  frame: number;
  run: (action: MovieAction) => Promise<void>;
  onSelectFrame: (frame: number) => void;
  onContextMenu: (frame: number, object: string, at: { x: number; y: number }) => void;
}

interface DragState {
  button: 0 | 1 | 2;
  shift: boolean;
  ctrl: boolean;
  from: number;
  row: number;
  startX: number;
  startY: number;
  travel: number;
  /** `|dy|`, which kills the context menu at 5 px (`CMovie::drag:1588`). */
  travelY: number;
  /** `CMovie::DragDraw` — inside the block +/- 50 px (`CMovie::drag:1580`). */
  inRange: boolean;
}

export function MovieTimeline({ panel, frame, run, onSelectFrame, onContextMenu }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // `CMovie::DragDraw` — the live drag overlay. Held in state, not in the ref,
  // because it has to repaint on every pointer move.
  const [ghost, setGhost] = useState<{ row: number; to: number } | null>(null);

  const rows = panel?.rows ?? [];
  const frames = panel?.nframes ?? 0;
  // `movie_panel_row_height`, clamped: the C has no floor and `MovieClick`
  // will happily walk it to 0 or below (see `classifyWheel`).
  const rowH = Math.max(1, panel?.rowHeight || ROW_H);
  const height = Math.max(rowH, rows.length * (rowH + GAP));

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 1;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, height);

    if (frames <= 0) return;

    rows.forEach((row, index) => {
      const rect: PanelRect = {
        left: 0,
        right: cssWidth,
        top: index * (rowH + GAP),
        bottom: index * (rowH + GAP) + rowH,
      };
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rowH);
      drawRow(ctx, rect, frames, row.spec);
      // Scene pins: the C draws these as part of the same strip; here a 2 px
      // tick is enough to see where `mview store, scene=` landed.
      ctx.fillStyle = 'rgb(77,204,77)';
      row.scenes.forEach((scene, f) => {
        if (!scene) return;
        ctx.fillRect(frameToX(rect, frames, f), rect.top, 2, 3);
      });
    });

    // Playhead.
    const head: PanelRect = { left: 0, right: cssWidth, top: 0, bottom: height };
    const x = frameToX(head, frames, Math.max(0, frame - 1));
    ctx.fillStyle = '#eef1f4';
    ctx.fillRect(x, 0, 1, height);

    // The drag ghosts, last, so they sit over the cells like the C's overlay.
    const drag = dragRef.current;
    // `CMovie::draw:1793` paints the overlay only `if(I->DragDraw)`, so pulling
    // away from the panel makes the ghost vanish — which is the only feedback
    // the user gets that letting go now will do nothing.
    if (drag && ghost && drag.inRange) {
      // `MoviePrepareDrag:1477` stretches DragRect over the whole block in
      // column mode, which is what makes a Ctrl+Shift drag show one tall box.
      const column = drag.ctrl && drag.shift;
      const rect: PanelRect = column
        ? { left: 0, right: cssWidth, top: 0, bottom: height }
        : {
            left: 0,
            right: cssWidth,
            top: ghost.row * (rowH + GAP),
            bottom: ghost.row * (rowH + GAP) + rowH,
          };
      drawDragBoxes(
        ctx,
        rect,
        frames,
        dragBoxes({ button: drag.button, ctrl: drag.ctrl, from: drag.from, to: ghost.to, frames }),
      );
    }
  }, [rows, frames, frame, height, rowH, ghost]);

  useEffect(() => {
    paint();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => paint());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  const rectFor = (row: number): PanelRect => {
    const canvas = canvasRef.current;
    const width = canvas?.clientWidth ?? 1;
    return { left: 0, right: width, top: row * (rowH + GAP), bottom: row * (rowH + GAP) + rowH };
  };

  const frameAt = (event: React.PointerEvent | React.WheelEvent, row = 0): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const box = canvas.getBoundingClientRect();
    return xToFrame(rectFor(row), Math.max(1, frames), event.clientX - box.left, true);
  };

  const rowAt = (event: React.PointerEvent): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const box = canvas.getBoundingClientRect();
    const y = event.clientY - box.top;
    return Math.min(rows.length - 1, Math.max(0, Math.floor(y / (rowH + GAP))));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (frames <= 0) return;
    event.preventDefault();
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
    const row = rowAt(event);
    dragRef.current = {
      button: (event.button === 1 ? 1 : event.button === 2 ? 2 : 0) as 0 | 1 | 2,
      shift: event.shiftKey,
      ctrl: event.ctrlKey || event.metaKey,
      from: frameAt(event, row),
      row,
      startX: event.clientX,
      startY: event.clientY,
      travel: 0,
      travelY: 0,
      inRange: true,
    };
    setGhost({ row, to: dragRef.current.from });
    if (event.button === 0 && !event.ctrlKey && !event.metaKey) {
      onSelectFrame(dragRef.current.from + 1);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    setHover(frames > 0 ? frameAt(event) + 1 : null);
    const drag = dragRef.current;
    if (!drag) return;
    drag.travel = Math.max(drag.travel, Math.abs(event.clientX - drag.startX));
    drag.travelY = Math.max(drag.travelY, Math.abs(event.clientY - drag.startY));
    // `CMovie::drag:1580` recomputes `DragDraw` on EVERY move, so a drag that
    // leaves the block and comes back is live again.
    const box = canvasRef.current?.getBoundingClientRect();
    drag.inRange = box ? dragInRange(event.clientY, { top: box.top, bottom: box.bottom }) : true;
    setGhost({ row: drag.row, to: frameAt(event, drag.row) });
    if (drag.button === 0 && !drag.ctrl) {
      // Live scrollbar: SceneSetFrame(G,7,v) on every move, like MovieDrag.
      const next = frameAt(event, drag.row) + 1;
      if (next !== frame) void run(transport.seek(next));
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    if (!drag || frames <= 0) return;
    const to = frameAt(event, drag.row);
    const gesture = classifyGesture({
      button: drag.button,
      shift: drag.shift,
      ctrl: drag.ctrl,
      from: drag.from,
      to,
      travel: drag.travel,
      travelY: drag.travelY,
      inRange: drag.inRange,
      object: rows[drag.row]?.object ?? '',
      frames,
    });
    if (!gesture) return;
    switch (gesture.kind) {
      case 'move':
        void run(panelGesture.mmove(gesture.target, gesture.source, gesture.count, gesture.object));
        break;
      case 'copy':
        void run(panelGesture.mcopy(gesture.target, gesture.source, gesture.count, gesture.object));
        break;
      case 'insert':
        void run(panelGesture.minsert(gesture.count, gesture.frame, gesture.object));
        break;
      case 'delete':
        void run(panelGesture.mdelete(gesture.count, gesture.frame, gesture.object));
        break;
      case 'clear':
        void run(panelGesture.clear(gesture.first, gesture.last, gesture.object));
        break;
      case 'seek':
        void run(transport.seek(gesture.frame));
        break;
      case 'menu':
        // `ExecutiveMotionMenuActivate(..., same=DragColumn)` (`:1735`): column
        // mode opens `obj_motion` for `cKeywordSame`, i.e. every row at once.
        onContextMenu(gesture.frame + 1, gesture.column ? 'same' : gesture.object, {
          x: event.clientX,
          y: event.clientY,
        });
        break;
    }
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (frames <= 0) return;
    const wheel = classifyWheel({
      deltaY: event.deltaY,
      ctrl: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
      rowHeight: rowH,
    });
    if (wheel.kind === 'rowHeight') {
      void run(panelGesture.rowHeight(wheel.value));
      return;
    }
    void run(wheel.delta > 0 ? transport.forward() : transport.backward());
  };

  // `CMovie::reshape` zeroes the gutter in presentation mode (`:1863-1868`).
  const gutter = panel?.presentation ? 0 : (panel?.labelIndent ?? LABEL_INDENT);

  return (
    <div className="mvtl">
      <div className="mvtl__strip">
        <canvas
          ref={canvasRef}
          className="mvtl__canvas"
          style={{ height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onWheel={onWheel}
          onContextMenu={(event) => event.preventDefault()}
        />
        <div className="mvtl__foot">
          {frames > 0 ? (
            <>
              <span>
                {frames} frame{frames === 1 ? '' : 's'}
              </span>
              {hover !== null && <span>· hover {hover}</span>}
              <span className="mvtl__hint">
                L drag = seek · R drag = mmove · shift+R = mcopy · ctrl+L = minsert/mdelete ·
                ctrl+M = mview clear · ctrl+shift = all rows · ctrl+shift wheel = row height
              </span>
            </>
          ) : (
            <span>no movie — define one with mset below</span>
          )}
        </div>
      </div>
      <div className="mvtl__labels" style={{ height, width: gutter, flexBasis: gutter }}>
        {rows.map((row, index) => (
          <div className="mvtl__label" key={`${index}:${row.label}`} style={{ height: rowH }}>
            {row.label}
          </div>
        ))}
      </div>
    </div>
  );
}
