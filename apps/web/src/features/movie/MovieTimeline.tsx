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
import { classifyGesture, drawRow, frameToX, xToFrame, type PanelRect } from './timeline';
import { mview, range, transport, type MovieAction } from './movieSource';

const ROW_H = 15;
const GAP = 2;

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
  travel: number;
}

export function MovieTimeline({ panel, frame, run, onSelectFrame, onContextMenu }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const rows = panel?.rows ?? [];
  const frames = panel?.nframes ?? 0;
  const height = Math.max(ROW_H, rows.length * (ROW_H + GAP));

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
        top: index * (ROW_H + GAP),
        bottom: index * (ROW_H + GAP) + ROW_H,
      };
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(rect.left, rect.top, rect.right - rect.left, ROW_H);
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
  }, [rows, frames, frame, height]);

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
    return { left: 0, right: width, top: row * (ROW_H + GAP), bottom: row * (ROW_H + GAP) + ROW_H };
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
    return Math.min(rows.length - 1, Math.max(0, Math.floor(y / (ROW_H + GAP))));
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
      travel: 0,
    };
    if (event.button === 0 && !event.ctrlKey && !event.metaKey) {
      onSelectFrame(dragRef.current.from + 1);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    setHover(frames > 0 ? frameAt(event) + 1 : null);
    const drag = dragRef.current;
    if (!drag) return;
    drag.travel = Math.max(drag.travel, Math.abs(event.clientX - drag.startX));
    if (drag.button === 0 && !drag.ctrl) {
      // Live scrollbar: SceneSetFrame(G,7,v) on every move, like MovieDrag.
      const next = frameAt(event, drag.row) + 1;
      if (next !== frame) void run(transport.seek(next));
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || frames <= 0) return;
    const to = frameAt(event, drag.row);
    const object = rows[drag.row]?.object ?? '';
    const gesture = classifyGesture({
      button: drag.button,
      shift: drag.shift,
      ctrl: drag.ctrl,
      from: drag.from,
      to,
      travel: drag.travel,
    });
    if (!gesture) return;
    switch (gesture.kind) {
      case 'move':
        void run(range.mmove(gesture.target, gesture.source, gesture.count, object));
        break;
      case 'copy':
        void run(range.mcopy(gesture.target, gesture.source, gesture.count, object));
        break;
      case 'insert':
        void run(range.minsert(gesture.count, gesture.frame, object));
        break;
      case 'delete':
        void run(range.mdelete(gesture.count, gesture.frame, object));
        break;
      case 'clear':
        void run(
          mview('clear', {
            first: gesture.first,
            last: gesture.last,
            ...(object ? { object } : {}),
          }),
        );
        break;
      case 'seek':
        void run(transport.seek(gesture.frame));
        break;
      case 'menu':
        onContextMenu(gesture.frame + 1, object, { x: event.clientX, y: event.clientY });
        break;
    }
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (frames <= 0) return;
    void run(event.deltaY > 0 ? transport.forward() : transport.backward());
  };

  return (
    <div className="mvtl">
      <div className="mvtl__labels" style={{ height }}>
        {rows.map((row) => (
          <div className="mvtl__label" key={row.object || '(camera)'} style={{ height: ROW_H }}>
            {row.object || 'camera'}
          </div>
        ))}
      </div>
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
                ctrl+M = mview clear
              </span>
            </>
          ) : (
            <span>no movie — define one with mset below</span>
          )}
        </div>
      </div>
    </div>
  );
}
