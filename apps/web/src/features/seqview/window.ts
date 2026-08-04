/**
 * The horizontal window — `CSeq::NSkip` (`packages/engine/layer1/Seq.cpp:290-333`).
 *
 * A virtualised row is addressed by a first-column offset, and that offset has
 * to survive the row underneath it changing shape. PyMOL clamps `NSkip` on
 * every draw (`:300`, `if(I->NSkip > max) I->NSkip = max`) precisely because
 * `seq_view_format`, a `delete`, a `load` or a state change can shorten the row
 * between one frame and the next.
 *
 * Without this the viewer goes BLANK rather than wrong, which is worse: the
 * WP-21 browser run scrolled a 5,684-column atom-name row to column 6, loaded a
 * 3-column `seq_view_format = 4` row over it, and the component asked the
 * bridge for columns 6..1205 of a row that has three — a legal, empty window
 * that renders as an empty strip with no way back except the wheel.
 */

/** Clamp a first-column offset to a row that is `nCols` wide. */
export function clampFirst(first: number, nCols: number): number {
  if (!Number.isFinite(first) || first <= 0) return 0;
  const last = Math.max(0, Math.floor(nCols) - 1);
  return Math.min(Math.floor(first), last);
}

/** The widest row in a payload — what the scrollbar and the clamp size against. */
export function widestRow(rows: readonly { nCols: number }[]): number {
  let widest = 1;
  for (const row of rows) if (row.nCols > widest) widest = row.nCols;
  return widest;
}
