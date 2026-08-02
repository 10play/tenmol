/**
 * The alignment half of the sequence viewer, as pure functions.
 *
 * The BRIDGE owns the geometry: `panels/seqview.py::align_rows` is
 * `SeekerUpdate`'s second pass (`packages/engine/layer3/Seeker.cpp:1583-1793`) and it has
 * already put every column at the character offset its tag earns, and emitted
 * `row.fill` for the runs the C stores in `row->fill`. What is left on this
 * side is exactly what `CSeq::draw` does at paint time (`packages/engine/layer1/Seq.cpp:322-449`,
 * `:488-504`): pick the colour for an unaligned column, and repeat
 * `seq_view_fill_char` across a fill run.
 */

import type { SeqviewCell, SeqviewPayload } from '@tenmol/protocol';

/** `average3f` (`packages/engine/layer0/Vector.h`) — the blend both dim modes use. */
export function average3f(a: readonly number[], b: readonly number[]): number[] {
  return [0, 1, 2].map((i) => ((a[i] ?? 0) + (b[i] ?? 0)) * 0.5);
}

/** 0..1 RGB triple -> a CSS colour, or undefined when the triple is missing. */
export function rgbCss(triple: readonly number[] | undefined): string | undefined {
  if (!triple || triple.length < 3) return undefined;
  const to255 = (value: number | undefined) =>
    Math.round(Math.max(0, Math.min(1, value ?? 0)) * 255);
  return `rgb(${to255(triple[0])},${to255(triple[1])},${to255(triple[2])})`;
}

/**
 * The 0..1 RGB a column is drawn in — `packages/engine/layer1/Seq.cpp:420-449`.
 *
 * An unaligned column only deviates when `seq_view_unaligned_color` resolved to
 * a real index (it does NOT in mode 3 at the default, `:323-332`), and then:
 * modes 1/4 average the column's own colour with the background, 2/5 average it
 * with the unaligned colour, and everything else paints the unaligned colour
 * flat. Returns `undefined` when the payload carries no RGB for the index,
 * which is the same "leave it to CSS" the non-aligned path uses.
 */
export function columnRgb(
  cell: SeqviewCell,
  payload: SeqviewPayload,
): number[] | undefined {
  const own = payload.colors[String(cell.color)];
  if (!cell.unaligned) return own;
  const index = payload.unalignedColor;
  if (index === undefined || index < 0) return own;
  const unaligned = payload.colors[String(index)];
  if (!unaligned) return own;
  switch (payload.unalignedMode) {
    case 1:
    case 4:
      return own ? average3f(own, payload.bgColor ?? [0, 0, 0]) : unaligned;
    case 2:
    case 5:
      return own ? average3f(own, unaligned) : unaligned;
    default:
      return unaligned;
  }
}

/** True when the bridge says an alignment is driving the layout. */
export function isAligned(payload: SeqviewPayload): boolean {
  return Boolean(payload.alignment);
}

/**
 * The character offset column 0 of the WINDOW sits at, shared by every row.
 *
 * Outside alignment mode each row is rebased on its own first cell, which is
 * what the flow layout already does. Inside it, rebasing per row would undo the
 * very thing the alignment pass computed — two rows whose windows start at
 * different offsets must keep that difference — so the base is the smallest
 * first-cell offset across the rows.
 */
export function windowBase(payload: SeqviewPayload): number {
  let base: number | null = null;
  for (const row of payload.rows) {
    const head = row.cells[0];
    if (!head) continue;
    base = base === null ? head.offset : Math.min(base, head.offset);
  }
  return base ?? 0;
}
