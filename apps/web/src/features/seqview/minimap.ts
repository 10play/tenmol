/**
 * The scrollbar mini-map.
 *
 * `CSeq::draw` paints the scrollbar strip with one coloured tick per contiguous
 * run of `col->inverse`, one horizontal band per non-label row
 * (`layer1/Seq.cpp:564-696`) — so the scrollbar tells you where in a 6,000
 * column row your selection actually is. Same idea here, and it is the only
 * navigation aid a virtualised row has.
 */

export interface SelectionRun {
  /** Index of the first selected column, relative to the array given. */
  from: number;
  length: number;
}

export function selectionRuns(
  cells: readonly { selected?: boolean; spacer?: boolean }[],
): SelectionRun[] {
  const runs: SelectionRun[] = [];
  let start = -1;
  cells.forEach((cell, index) => {
    if (cell.selected) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      runs.push({ from: start, length: index - start });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ from: start, length: cells.length - start });
  return runs;
}
