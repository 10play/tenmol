import { describe, expect, it } from 'vitest';
import { clampFirst, widestRow } from './window';

describe('clampFirst — CSeq::NSkip clamping (layer1/Seq.cpp:290-333)', () => {
  it('leaves an offset inside the row alone', () => {
    expect(clampFirst(6, 5684)).toBe(6);
  });

  it('never goes below zero', () => {
    expect(clampFirst(-4, 100)).toBe(0);
    expect(clampFirst(0, 100)).toBe(0);
  });

  it('pulls an offset back when the row shrinks under it', () => {
    // The exact browser-run failure: scrolled to column 6 of a 5,684-column
    // atom-name row, then `seq_view_format = 4` left three columns.
    expect(clampFirst(6, 3)).toBe(2);
  });

  it('collapses to 0 for an empty or one-column row', () => {
    expect(clampFirst(6, 1)).toBe(0);
    expect(clampFirst(6, 0)).toBe(0);
  });

  it('ignores a non-finite offset', () => {
    expect(clampFirst(Number.NaN, 100)).toBe(0);
  });
});

describe('widestRow', () => {
  it('is 1 for no rows, so the clamp ceiling is never zero-width', () => {
    expect(widestRow([])).toBe(1);
  });

  it('takes the widest row, not the first', () => {
    expect(widestRow([{ nCols: 13 }, { nCols: 5684 }, { nCols: 40 }])).toBe(5684);
  });
});
