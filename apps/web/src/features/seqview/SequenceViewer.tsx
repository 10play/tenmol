/**
 * The sequence viewer — PyMOL's `CSeq` block (`packages/engine/layer1/Seq.cpp:259` `CSeq::draw`)
 * as real DOM.
 *
 * PyMOL draws this INSIDE the GL viewport, so it lives in the `viewport` region
 * and is positioned by `seq_view_location` (0 = top, 1 = bottom) and
 * `seq_view_overlay` (draw over the scene instead of reserving space). It
 * renders nothing at all when no enabled object has `seq_view` on, which is the
 * default — exactly like the C++ block.
 *
 * Metrics are PyMOL's (`packages/engine/layer1/Seq.h:84-88`): `LineHeight 13`, `CharWidth 8`,
 * `CharMargin 2`. A cell is `text.length * CharWidth` wide, so the grid lines
 * up with the character offsets the bridge computed with Seeker's own maths.
 *
 * VIRTUALISED, because it has to be: `codes == 2` on 1tii is 6,058 columns and
 * a JSON frame caps at 1 MiB. The component asks for the window it is showing
 * and the row reports `nCols` so the scrollbar is the right size. The scrollbar
 * doubles as the selection mini-map, as it does in the C (`:564-696`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PanelMenuNode, SeqviewCell, SeqviewPayload, SeqviewRow } from '@tenmol/protocol';
import { useSession, useStore } from '../../app';
import { RowMenu } from '../objects/RowMenu';
import { createSeqviewSource, type SeqviewMenuPayload, type SeqviewSource } from './source';
import { Button, click, move, wheel, type Mods, type SeqAction, type SeqDrag } from './grammar';
import { selectionRuns } from './minimap';
import { clampFirst, widestRow } from './window';
import { applyReservation } from './reserve';
import { columnRgb, isAligned, rgbCss, windowBase } from './alignment';
import './seqview.css';

/** `packages/engine/layer1/Seq.h:84-88`. */
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
  alignment: '',
  unalignedMode: 0,
  unalignedColor: 104,
  fillChar: '-',
  bgColor: [0, 0, 0],
  rows: [],
  colors: {},
  window: { first: 0, count: WINDOW, max: WINDOW },
};

/** PyMOL's `CSeq` sequence viewer as virtualised DOM: renders the visible column window, or nothing when no object has `seq_view` on. */
export function SequenceViewer(): React.JSX.Element | null {
  const session = useSession();
  const phase = useStore(session.stores.connection, (s) => s.phase);
  const echo = useStore(session.stores.ui, (s) => s.echoActions);

  const [payload, setPayload] = useState<SeqviewPayload>(EMPTY);
  const [first, setFirst] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /**
   * The one open right-click popup, with the arguments that built it: a lazy
   * submenu is resolved by REBUILDING the menu on the bridge and walking the
   * path (`SubGetItem`), so the request has to be repeatable.
   */
  const [menu, setMenu] = useState<
    | (SeqviewMenuPayload & {
        at: { x: number; y: number };
        object: string;
        atoms: number[];
        selected: boolean;
      })
    | null
  >(null);
  /** Where the last pointer press landed — the popup's anchor. */
  const pointerRef = useRef({ x: 0, y: 0 });

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
              // `MenuActivate2Arg(G, x, y+16, x, y, false, "pick_sele"|
              // "seq_option", ...)` (`packages/engine/layer3/Seeker.cpp:364,388`). The grammar
              // has already decided WHICH of the two this is; the bridge builds
              // the same `pymol.menu` tree the C would have activated.
              const cell = row?.cells[(action as { col: number }).col - (row?.first ?? 0)];
              const atoms = cell && !cell.spacer ? [...cell.atoms] : [];
              const selected = action.menu === 'pick_sele';
              if (!selected && atoms.length === 0) break;
              const built = await source.menu(row?.object ?? '', atoms, selected);
              if (built.menu) {
                setMenu({
                  ...built,
                  at: { ...pointerRef.current },
                  object: row?.object ?? '',
                  atoms,
                  selected,
                });
              }
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
      pointerRef.current = { x: event.clientX, y: event.clientY };
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
      // `SeekerClick` gets `row/col == -1` for all of it (`packages/engine/layer1/Seq.cpp:150`
      // resolves the column and only then dispatches), so an identity test
      // against the container would have made the clear-on-double-click
      // reachable only in the few pixels the container itself paints.
      const target = event.target as HTMLElement | null;
      if (target?.closest('.seqcell, .seqview__scroll')) return;
      pointerRef.current = { x: event.clientX, y: event.clientY };
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

  /*
   * ROW 341 item (2) — `seq_view_overlay = 0` RESERVES SCENE SPACE.
   *
   * `OrthoReshape` gives the sequence viewer a band out of the scene rectangle
   * (`packages/engine/layer1/Ortho.cpp:2419,2433`); this strip is `position: absolute`, so it
   * took none, and the setting only changed the background's opacity. The
   * height is MEASURED rather than derived: `SeqGetHeight` is a row-count
   * formula in the C's own metrics, and re-deriving it here would mean keeping
   * a second copy of this component's CSS in arithmetic.
   *
   * A ResizeObserver rather than a layout effect alone: the strip's height
   * changes when rows appear, when the horizontal scrollbar comes and goes
   * (which is exactly `SeqGetHeight`'s `+ ScrollBarWidth` term) and when the
   * window is resized, none of which re-renders this component.
   */
  const stripRef = useRef<HTMLDivElement | null>(null);
  const { location, overlay } = payload;
  // `rendered` is in the DEPS, not just in the guard. The component survives
  // `seq_view 0` — only the `<div>` below unmounts — so without it the effect
  // would never re-run, its cleanup would never fire, and the scene would keep
  // a band reserved for a viewer that is no longer there.
  const rendered = payload.visible && payload.rows.length > 0;
  useEffect(() => {
    const strip = stripRef.current;
    if (strip === null) return;
    // The offset parent IS `.shell__viewport`: the strip is absolutely
    // positioned and that is the nearest positioned ancestor. Resolving it this
    // way rather than by selector keeps the feature from naming a shell class.
    const container = strip.offsetParent as HTMLElement | null;
    let dispose = applyReservation(container, {
      location,
      overlay,
      height: strip.getBoundingClientRect().height,
    });
    // jsdom has no ResizeObserver; the measurement above is the whole of the
    // behaviour there and the observer is a live-resize refinement.
    if (typeof ResizeObserver === 'undefined') return () => dispose();
    const observer = new ResizeObserver(() => {
      dispose();
      dispose = applyReservation(container, {
        location,
        overlay,
        height: strip.getBoundingClientRect().height,
      });
    });
    observer.observe(strip);
    return () => {
      observer.disconnect();
      dispose();
    };
  }, [location, overlay, rendered]);

  /* ------------------------------------------------------------------ */

  if (!rendered) return null;

  const maxCols = Math.max(...payload.rows.map((row) => row.nCols), 1);
  const showLabelRow = (index: number) =>
    payload.labelMode === 2 || (payload.labelMode === 1 && index === 0);

  /*
   * ALIGNMENT MODE IS AN ABSOLUTE LAYOUT, and it has to be.
   *
   * Outside it a row's columns are contiguous — `offset` advances by exactly
   * the width already drawn — so a flex row reproduces the C's geometry for
   * free. Under an alignment the whole point is that a row's columns are NOT
   * contiguous: `panels/seqview.py::align_rows` leaves holes where the other
   * rows have residues this one does not (`packages/engine/layer3/Seeker.cpp:1583-1793`), and
   * a flex row would close every one of them and destroy the line-up. So the
   * cells are placed at `offset * CHAR_WIDTH` and the holes are filled with
   * `row.fill`, which is what `CSeq::draw` paints (`packages/engine/layer1/Seq.cpp:488-504`).
   *
   * The base is SHARED (`windowBase`): rebasing each row on its own first cell,
   * which is what the non-aligned label path does, would slide the rows back on
   * top of each other.
   */
  const aligned = isAligned(payload);
  const base = aligned ? windowBase(payload) : 0;
  const rowBase = (row: SeqviewRow) => (aligned ? base : offsetOf(row, first));
  const fillTint = rgbCss(payload.colors[String(payload.fillColor)]);

  return (
    <div
      ref={stripRef}
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
        {aligned && (
          <span
            className="seqview__alignment"
            title="ExecutiveGetActiveAlignment — rows are lined up by tag and gaps are suppressed"
          >
            aligned by {payload.alignment}
            {UNALIGNED_NAMES[payload.unalignedMode]
              ? ` (${UNALIGNED_NAMES[payload.unalignedMode]})`
              : ''}
          </span>
        )}
        <span className="seqview__spacer" />
        {error && <span className="seqview__error">{error}</span>}
        <span title="horizontal scroll — the wheel moves one column, as in packages/engine/layer1/Seq.cpp:218">
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
                    style={{ left: (mark.offset - rowBase(row)) * CHAR_WIDTH }}
                  >
                    {mark.text}
                  </span>
                ))}
                {row.labels.map((label) => (
                  <span
                    className="seqrow__num"
                    key={`n${label.col}`}
                    style={{ left: (label.offset - rowBase(row)) * CHAR_WIDTH }}
                  >
                    {label.text}
                  </span>
                ))}
              </div>
            )}

            <div
              className={'seqrow__line' + (aligned ? ' seqrow__line--aligned' : '')}
              style={{ height: LINE_HEIGHT }}
            >
              {payload.labelMode === 0 && (
                <span className="seqrow__name" title={row.object}>
                  /{row.object}
                </span>
              )}
              {aligned &&
                payload.fillChar !== '' &&
                row.fill.map((run) => (
                  <span
                    className="seqfill"
                    key={`f${run.offset}-${run.width}`}
                    style={{
                      left: (run.offset - base) * CHAR_WIDTH,
                      width: run.width * CHAR_WIDTH,
                      color: fillTint,
                    }}
                  >
                    {payload.fillChar.repeat(run.width)}
                  </span>
                ))}
              {row.cells.map((cell, cellIndex) => {
                const col = row.first + cellIndex;
                // `col->inverse` is INVERTED VIDEO in the C (`packages/engine/layer1/Seq.cpp:465-482`):
                // the column's own colour becomes the background and the glyph
                // goes black. It has to be done here, inline, from the colour
                // the bridge sent — CSS cannot express it, because
                // `background: currentcolor` resolves against this element's
                // own `color`, which the same rule has just forced to black,
                // and every selected cell renders black-on-black.
                const tint = rgbCss(columnRgb(cell, payload));
                const place = aligned
                  ? { position: 'absolute' as const, left: (cell.offset - base) * CHAR_WIDTH }
                  : {};
                return (
                  <span
                    key={col}
                    className={
                      'seqcell' +
                      (cell.selected ? ' is-selected' : '') +
                      (cell.spacer ? ' is-spacer' : '') +
                      (cell.unaligned ? ' is-unaligned' : '') +
                      (row.selectable ? '' : ' is-locked')
                    }
                    style={
                      cell.selected
                        ? {
                            ...place,
                            width: cell.text.length * CHAR_WIDTH,
                            background: tint,
                            color: '#000',
                          }
                        : { ...place, width: cell.text.length * CHAR_WIDTH, color: tint }
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

      {menu && (
        /*
          * The SAME popup component the object panel uses
          * (`features/objects/RowMenu`): one `pymol.menu` renderer for every
          * surface that raises one, as `MenuActivate*` is one entry point in
          * the C. Nothing about this menu is seqview-specific — the leaves are
          * command strings PyMOL wrote.
          */
        <RowMenu
          title={menu.title}
          op="A"
          menuName={menu.menu}
          items={menu.items}
          anchor={menu.at}
          onPick={(command) => {
            setMenu(null);
            void session.run(command);
            void refresh();
          }}
          onExpand={(path) => {
            void source
              .menuExpand(path, menu.object, menu.atoms, menu.selected)
              .then((resolved) => {
                setMenu((open) =>
                  open ? { ...open, items: graftMenu(open.items, resolved.path, resolved.items) } : open,
                );
              })
              .catch((fault: unknown) => setError(describe(fault)));
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {/* The scrollbar doubles as the selection mini-map (`packages/engine/layer1/Seq.cpp:564-696`). */}
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

/** Menu labels — `packages/engine/modules/pymol/_gui.py:379-387`. */
const FORMAT_NAMES: Record<number, string> = {
  0: 'Residue Codes',
  1: 'Residue Names',
  2: 'Atom Names',
  3: 'Chain Identifiers',
  4: 'States',
  5: 'Movie Frames',
};

/** `seq_view_unaligned_mode`, for the header (`packages/engine/layer3/Seeker.cpp:1590-1596`). */
const UNALIGNED_NAMES: Record<number, string> = {
  0: 'packed',
  1: 'packed, dimmed',
  2: 'packed, blended',
  3: 'staggered',
  4: 'staggered, dimmed',
  5: 'staggered, blended',
};

/** The character offset the window starts at, so labels line up with cells. */
function offsetOf(row: SeqviewRow, _first: number): number {
  return row.cells[0]?.offset ?? 0;
}

function rowIndex(action: SeqAction): number {
  return 'row' in action ? action.row : -1;
}

function cellTitle(row: SeqviewRow, cell: SeqviewCell): string {
  if (cell.spacer) return 'gap (seq_view_gap_mode)';
  const bits = [row.object];
  if (cell.chain) bits.push(`chain ${cell.chain}`);
  if (cell.resn) bits.push(cell.resn);
  if (cell.resi) bits.push(cell.resi);
  if (cell.state) bits.push(`state ${cell.state}`);
  bits.push(`${cell.atoms.length} atom${cell.atoms.length === 1 ? '' : 's'}`);
  if (cell.unaligned) bits.push('unaligned');
  else if (cell.tag) bits.push(`alignment column ${cell.tag}`);
  if (!row.selectable) bits.push('not selectable (non-discrete states)');
  return bits.join(' · ');
}

/**
 * Replace the node at `path` with its resolved children — the client half of
 * `SubGetItem` (`packages/engine/layer4/PopUp.cpp:88-110`), which caches what it resolved.
 */
export function graftMenu(
  items: readonly PanelMenuNode[],
  path: readonly number[],
  resolved: readonly PanelMenuNode[],
): PanelMenuNode[] {
  if (path.length === 0) return [...resolved];
  const [head, ...rest] = path;
  return items.map((node, index) =>
    index !== head
      ? node
      : rest.length === 0
        ? { ...node, lazy: false, items: [...resolved] }
        : { ...node, items: graftMenu(node.items ?? [], rest, resolved) },
  );
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const type = (error as { type?: string }).type;
    return type && type !== error.name ? `${type}: ${error.message}` : error.message;
  }
  return String(error);
}
