/**
 * The sequence viewer — PyMOL's `CSeq` block (`layer1/Seq.cpp:259` `CSeq::draw`)
 * as real DOM.
 *
 * PyMOL draws this INSIDE the GL viewport, so it lives in the `viewport` region
 * and is positioned by `seq_view_location` (0 = top, 1 = bottom) and
 * `seq_view_overlay` (draw over the scene instead of reserving space). It
 * renders nothing at all when no enabled object has `seq_view` on, which is the
 * default — exactly like the C++ block.
 *
 * Metrics are PyMOL's (`layer1/Seq.h:84-88`): `LineHeight 13`, `CharWidth 8`,
 * `CharMargin 2`. A cell is `text.length * CharWidth` wide, so the grid lines
 * up with the character offsets the bridge computed with Seeker's own maths.
 *
 * VIRTUALISED, because it has to be: `codes == 2` on 1tii is 6,058 columns and
 * a JSON frame caps at 1 MiB. The component asks for the window it is showing
 * and the row reports `nCols` so the scrollbar is the right size. The scrollbar
 * doubles as the selection mini-map, as it does in the C (`:564-696`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeqviewCell, SeqviewPayload, SeqviewRow } from '@tenmol/protocol';
import { useSession, useStore } from '../../app';
import { createSeqviewSource, type SeqviewSource } from './source';
import { Button, click, move, wheel, type Mods, type SeqAction, type SeqDrag } from './grammar';
import { selectionRuns } from './minimap';
import { clampFirst, widestRow } from './window';
import './seqview.css';

/** `layer1/Seq.h:84-88`. */
const CHAR_WIDTH = 8;
const LINE_HEIGHT = 13;

/** The viewer only changes on a structure/selection/setting change. */
const POLL_HZ = 4;
const HIDDEN_HZ = 0.5;

/** Columns fetched per frame; must not exceed the bridge's own window cap. */
const WINDOW = 1200;

const EMPTY: SeqviewPayload = {
  visible: false,
  location: 0,
  overlay: false,
  format: 0,
  labelMode: 2,
  gapMode: 1,
  fillColor: 104,
  activeSele: '',
  seleMode: 'byresi',
  rows: [],
  colors: {},
  window: { first: 0, count: WINDOW, max: WINDOW },
};

export function SequenceViewer(): React.JSX.Element | null {
  const session = useSession();
  const phase = useStore(session.stores.connection, (s) => s.phase);
  const echo = useStore(session.stores.ui, (s) => s.echoActions);

  const [payload, setPayload] = useState<SeqviewPayload>(EMPTY);
  const [first, setFirst] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const source = useMemo<SeqviewSource>(
    () => createSeqviewSource((fn, args, kwargs) => session.call(fn, args, kwargs)),
    [session],
  );

  const dragRef = useRef<SeqDrag | null>(null);
  const lastClickRef = useRef(0);
  const firstRef = useRef(0);
  firstRef.current = first;
  /** The widest row we have seen — the ceiling `clampFirst` measures against. */
  const widestRef = useRef(1);

  /**
   * Adopt a payload and re-clamp the window against it (`clampFirst`). The row
   * under the offset changes shape whenever `seq_view_format`, a load or a
   * delete lands, and an offset past the new end asks for a legal but empty
   * window — a viewer that has gone blank with no way back.
   */
  const adopt = useCallback((next: SeqviewPayload) => {
    setPayload(next);
    widestRef.current = widestRow(next.rows);
    setFirst((value) => clampFirst(value, widestRef.current));
  }, []);

  /** Every write to `first` goes through the same clamp. */
  const scrollBy = useCallback((delta: number) => {
    setFirst((value) => clampFirst(value + delta, widestRef.current));
  }, []);

  const scrollTo = useCallback((column: number) => {
    setFirst(clampFirst(column, widestRef.current));
  }, []);

  /* ------------------------------------------------------------------ *
   * the poll
   * ------------------------------------------------------------------ */
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopped) return;
      if (phase === 'open') {
        try {
          const next = await source.rows(firstRef.current, WINDOW);
          if (!stopped) {
            adopt(next);
            setError(null);
          }
        } catch (fault) {
          if (!stopped) setError(describe(fault));
        }
      }
      const hz = document.visibilityState === 'hidden' ? HIDDEN_HZ : POLL_HZ;
      timer = setTimeout(() => void tick(), 1000 / hz);
    };

    void tick();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [adopt, source, phase]);

  // A reconnect may be a different bridge process: the panel is not installed
  // there until we bootstrap it again.
  useEffect(() => {
    if (phase !== 'open') {
      source.reset();
      setPayload(EMPTY);
    }
  }, [phase, source]);

  /* ------------------------------------------------------------------ *
   * actions -> the bridge
   * ------------------------------------------------------------------ */
  const refresh = useCallback(async () => {
    try {
      adopt(await source.rows(firstRef.current, WINDOW));
    } catch (fault) {
      setError(describe(fault));
    }
  }, [adopt, source]);

  const perform = useCallback(
    async (actions: readonly SeqAction[], rows: readonly SeqviewRow[]) => {
      for (const action of actions) {
        const row = action.type === 'clear' || action.type === 'scroll' ? null : rows[rowIndex(action)];
        try {
          switch (action.type) {
            case 'toggle': {
              if (!row) break;
              const cell = row.cells[action.col - row.first];
              if (!cell) break;
              const result = await source.select(
                row.object,
                cell.atoms,
                action.include,
                action.startOver,
              );
              if (echo && result.log) session.stores.feedback.appendClient(result.log);
              break;
            }
            case 'range': {
              if (!row) break;
              const result = await source.selectRange(
                row.object,
                action.first,
                action.last,
                action.include,
                action.startOver,
              );
              if (echo && result.log) session.stores.feedback.appendClient(result.log);
              break;
            }
            case 'browse': {
              if (!row) break;
              const atoms: number[] = [];
              for (let col = action.first; col <= action.last; col++) {
                const cell = row.cells[col - row.first];
                if (cell && !cell.spacer) atoms.push(...cell.atoms);
              }
              if (atoms.length === 0) break;
              const result = await source.center(row.object, atoms, action.zoom);
              if (echo && result.log) session.stores.feedback.appendClient(result.log);
              break;
            }
            case 'centerSelection': {
              // `SeekerSelectionCenter(G, 2)` centres on the ACTIVE selection,
              // which on this side is an ordinary `cmd.center` on its name.
              if (!payload.activeSele) break;
              await session.call('cmd.center', [payload.activeSele], { animate: -1 });
              break;
            }
            case 'setState': {
              if (!row) break;
              const result = await source.setState(row.object, action.state);
              if (echo && result.log) session.stores.feedback.appendClient(result.log);
              break;
            }
            case 'clear': {
              const result = await source.clear();
              if (echo && result.log) session.stores.feedback.appendClient(result.log);
              break;
            }
            case 'scroll': {
              scrollBy(action.delta);
              break;
            }
            case 'menu': {
              // `MenuActivate2Arg(..., "pick_sele"|"seq_option", ...)` is WP-13's
              // popup service; say so rather than silently doing nothing.
              session.stores.feedback.appendClient(
                ` sequence viewer: the "${action.menu}" popup is WP-13 (pymol-menu)`,
                'warning',
              );
              break;
            }
          }
        } catch (fault) {
          setError(describe(fault));
        }
      }
      if (actions.some((action) => action.type !== 'scroll')) await refresh();
      session.poller.kick();
    },
    [echo, payload.activeSele, refresh, session, source],
  );

  /* ------------------------------------------------------------------ *
   * pointer
   * ------------------------------------------------------------------ */
  const onPointerDown = useCallback(
    (rowIndexValue: number, col: number, cell: SeqviewCell | null, event: React.PointerEvent) => {
      event.preventDefault();
      const row = payload.rows[rowIndexValue];
      const button = (event.button === 1 ? Button.Middle : event.button === 2 ? Button.Right : Button.Left);
      const mods: Mods = { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey };
      const now = performance.now();
      const outcome = click({
        button,
        row: rowIndexValue,
        col,
        mods,
        spacer: Boolean(cell?.spacer),
        selected: Boolean(cell?.selected),
        state: cell?.state ?? 0,
        selectable: row?.selectable ?? false,
        hasActiveSele: payload.activeSele !== '',
        sinceLastClickMs: now - lastClickRef.current,
        drag: dragRef.current,
      });
      lastClickRef.current = now;
      dragRef.current = outcome.drag;
      if (outcome.actions.length) void perform(outcome.actions, payload.rows);
    },
    [payload.activeSele, payload.rows, perform],
  );

  const onPointerEnterCell = useCallback(
    (rowIndexValue: number, col: number, event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.buttons === 0) {
        if (event.buttons === 0) dragRef.current = null;
        return;
      }
      const mods: Mods = { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey };
      const outcome = move(drag, rowIndexValue, col, mods);
      dragRef.current = outcome.drag;
      if (outcome.actions.length) void perform(outcome.actions, payload.rows);
    },
    [payload.rows, perform],
  );

  const onBackgroundDown = useCallback(
    (event: React.PointerEvent) => {
      // "Outside a cell" is everything in the block that is not a column and not
      // the scrollbar — the header, a label row, the empty tail of a short row.
      // `SeekerClick` gets `row/col == -1` for all of it (`layer1/Seq.cpp:150`
      // resolves the column and only then dispatches), so an identity test
      // against the container would have made the clear-on-double-click
      // reachable only in the few pixels the container itself paints.
      const target = event.target as HTMLElement | null;
      if (target?.closest('.seqcell, .seqview__scroll')) return;
      const button = event.button === 1 ? Button.Middle : event.button === 2 ? Button.Right : Button.Left;
      const now = performance.now();
      const outcome = click({
        button,
        row: -1,
        col: -1,
        mods: { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey },
        spacer: false,
        selected: false,
        state: 0,
        selectable: false,
        hasActiveSele: payload.activeSele !== '',
        sinceLastClickMs: now - lastClickRef.current,
        drag: dragRef.current,
      });
      lastClickRef.current = now;
      if (outcome.actions.length) void perform(outcome.actions, payload.rows);
    },
    [payload.activeSele, payload.rows, perform],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      const action = wheel(event.deltaY);
      scrollBy(action.delta);
    },
    [scrollBy],
  );

  /* ------------------------------------------------------------------ */

  if (!payload.visible || payload.rows.length === 0) return null;

  const maxCols = Math.max(...payload.rows.map((row) => row.nCols), 1);
  const showLabelRow = (index: number) =>
    payload.labelMode === 2 || (payload.labelMode === 1 && index === 0);

  return (
    <div
      className={
        'seqview' +
        (payload.location === 1 ? ' seqview--bottom' : ' seqview--top') +
        (payload.overlay ? ' seqview--overlay' : '')
      }
      onPointerDown={onBackgroundDown}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={onWheel}
    >
      <div className="seqview__head">
        <span title="seq_view_format">{FORMAT_NAMES[payload.format] ?? `format ${payload.format}`}</span>
        <span title="the active selection (ExecutiveGetActiveSeleName)">
          {payload.activeSele ? `${payload.seleMode || 'none'} → ${payload.activeSele}` : 'no selection'}
        </span>
        <span className="seqview__spacer" />
        {error && <span className="seqview__error">{error}</span>}
        <span title="horizontal scroll — the wheel moves one column, as in layer1/Seq.cpp:218">
          {first + 1}–{Math.min(first + WINDOW, maxCols)} / {maxCols}
        </span>
      </div>

      <div className="seqview__rows">
        {payload.rows.map((row, index) => (
          <div className="seqrow" key={row.object}>
            {showLabelRow(index) && (
              <div className="seqrow__labels" style={{ height: LINE_HEIGHT }}>
                {row.breadcrumbs.map((mark) => (
                  <span
                    className="seqrow__crumb"
                    key={`c${mark.col}`}
                    style={{ left: (mark.offset - offsetOf(row, first)) * CHAR_WIDTH }}
                  >
                    {mark.text}
                  </span>
                ))}
                {row.labels.map((label) => (
                  <span
                    className="seqrow__num"
                    key={`n${label.col}`}
                    style={{ left: (label.offset - offsetOf(row, first)) * CHAR_WIDTH }}
                  >
                    {label.text}
                  </span>
                ))}
              </div>
            )}

            <div className="seqrow__line" style={{ height: LINE_HEIGHT }}>
              {payload.labelMode === 0 && (
                <span className="seqrow__name" title={row.object}>
                  /{row.object}
                </span>
              )}
              {row.cells.map((cell, cellIndex) => {
                const col = row.first + cellIndex;
                // `col->inverse` is INVERTED VIDEO in the C (`layer1/Seq.cpp:465-482`):
                // the column's own colour becomes the background and the glyph
                // goes black. It has to be done here, inline, from the colour
                // the bridge sent — CSS cannot express it, because
                // `background: currentcolor` resolves against this element's
                // own `color`, which the same rule has just forced to black,
                // and every selected cell renders black-on-black.
                const tint = rgb(payload.colors[String(cell.color)]);
                return (
                  <span
                    key={col}
                    className={
                      'seqcell' +
                      (cell.selected ? ' is-selected' : '') +
                      (cell.spacer ? ' is-spacer' : '') +
                      (row.selectable ? '' : ' is-locked')
                    }
                    style={
                      cell.selected
                        ? {
                            width: cell.text.length * CHAR_WIDTH,
                            background: tint,
                            color: '#000',
                          }
                        : { width: cell.text.length * CHAR_WIDTH, color: tint }
                    }
                    title={cellTitle(row, cell)}
                    onPointerDown={(event) => onPointerDown(index, col, cell, event)}
                    onPointerEnter={(event) => onPointerEnterCell(index, col, event)}
                  >
                    {cell.text}
                  </span>
                );
              })}
              {row.truncated && (
                <span className="seqrow__more" title={`${row.nCols} columns; scroll with the wheel`}>
                  …
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* The scrollbar doubles as the selection mini-map (`layer1/Seq.cpp:564-696`). */}
      <div
        className="seqview__scroll"
        role="scrollbar"
        aria-controls="seqview-rows"
        aria-valuenow={first}
        tabIndex={-1}
        onPointerDown={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const fraction = (event.clientX - box.left) / Math.max(box.width, 1);
          scrollTo(Math.round(fraction * maxCols));
          event.stopPropagation();
        }}
      >
        {payload.rows.map((row) => (
          <div className="seqview__minimap" key={row.object}>
            {selectionRuns(row.cells).map((run) => (
              <span
                key={run.from}
                className="seqview__tick"
                style={{
                  left: `${(((row.first + run.from) / Math.max(row.nCols, 1)) * 100).toFixed(3)}%`,
                  width: `${((run.length / Math.max(row.nCols, 1)) * 100).toFixed(3)}%`,
                }}
              />
            ))}
          </div>
        ))}
        <div
          className="seqview__thumb"
          style={{
            left: `${((first / Math.max(maxCols, 1)) * 100).toFixed(3)}%`,
            width: `${Math.min(100, (WINDOW / Math.max(maxCols, 1)) * 100).toFixed(3)}%`,
          }}
        />
      </div>
    </div>
  );
}

/** Menu labels — `modules/pymol/_gui.py:379-387`. */
const FORMAT_NAMES: Record<number, string> = {
  0: 'Residue Codes',
  1: 'Residue Names',
  2: 'Atom Names',
  3: 'Chain Identifiers',
  4: 'States',
  5: 'Movie Frames',
};

/** The character offset the window starts at, so labels line up with cells. */
function offsetOf(row: SeqviewRow, _first: number): number {
  return row.cells[0]?.offset ?? 0;
}

function rowIndex(action: SeqAction): number {
  return 'row' in action ? action.row : -1;
}

function rgb(triple: number[] | undefined): string | undefined {
  if (!triple || triple.length < 3) return undefined;
  const to255 = (value: number | undefined) =>
    Math.round(Math.max(0, Math.min(1, value ?? 0)) * 255);
  return `rgb(${to255(triple[0])},${to255(triple[1])},${to255(triple[2])})`;
}

function cellTitle(row: SeqviewRow, cell: SeqviewCell): string {
  if (cell.spacer) return 'gap (seq_view_gap_mode)';
  const bits = [row.object];
  if (cell.chain) bits.push(`chain ${cell.chain}`);
  if (cell.resn) bits.push(cell.resn);
  if (cell.resi) bits.push(cell.resi);
  if (cell.state) bits.push(`state ${cell.state}`);
  bits.push(`${cell.atoms.length} atom${cell.atoms.length === 1 ? '' : 's'}`);
  if (!row.selectable) bits.push('not selectable (non-discrete states)');
  return bits.join(' · ');
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const type = (error as { type?: string }).type;
    return type && type !== error.name ? `${type}: ${error.message}` : error.message;
  }
  return String(error);
}
