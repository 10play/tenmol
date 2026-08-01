/**
 * The `mset` preview parser, checked against PyMOL's own loop.
 *
 * The expectations below are not invented: every one is the output of
 * `modules/pymol/moving.py:731-763` executed on the same string (and the
 * 90-frame case is additionally verified end to end against a live engine in
 * `bridge/tests/test_movie.py::test_mset_program_matches_client_preview`, which
 * asserts `count_frames()` and the real frame->state table).
 */

import { describe, expect, it } from 'vitest';
import { previewMset, tokenizeMset } from './msetParser';

describe('tokenizeMset', () => {
  it('joins a separated x and - onto their operand', () => {
    expect(tokenizeMset('1 x 10')).toEqual(['1', 'x10']);
    expect(tokenizeMset('1x10')).toEqual(['1', 'x10']);
    expect(tokenizeMset('15 - 1')).toEqual(['15', '-1']);
    expect(tokenizeMset('  1\t x30   1 -15 ')).toEqual(['1', 'x30', '1', '-15']);
  });
});

describe('previewMset', () => {
  it('a bare number is one frame of that state', () => {
    expect(previewMset('1').states).toEqual([1]);
    expect(previewMset('7').states).toEqual([7]);
  });

  it('xN repeats the previous state to N frames TOTAL', () => {
    expect(previewMset('1 x10').states).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('a leading xN seeds from the current state and repeats N times', () => {
    // `last < 0` -> `last = cur_state`, `cnt = N` (not N-1).
    expect(previewMset('x5').states).toEqual([1, 1, 1, 1, 1]);
    expect(previewMset('x3', 4).states).toEqual([4, 4, 4]);
  });

  it('-N ramps to N inclusive, upward', () => {
    expect(previewMset('1 x3 -5').states).toEqual([1, 1, 1, 2, 3, 4, 5]);
  });

  it('-N ramps downward when the target is lower', () => {
    expect(previewMset('5 -1').states).toEqual([5, 4, 3, 2, 1]);
  });

  it("reproduces the docstring's own example, 90 frames", () => {
    const preview = previewMset('1 x30 1 -15 15 x30 15 -1');
    expect(preview.states).toHaveLength(90);
    // `1` + `x30` is 30 ones; the second literal `1` makes 31.
    expect(preview.states.slice(0, 31)).toEqual(Array.from({ length: 31 }, () => 1));
    // `-15` ramps 2..15 (14 frames), so 31..44.
    expect(preview.states.slice(31, 45)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    // `15 x30 15` is 31 more fifteens, 45..75.
    expect(preview.states.slice(45, 76)).toEqual(Array.from({ length: 31 }, () => 15));
    // `-1` ramps 14..1.
    expect(preview.states.slice(76)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('reports the tokens it understood', () => {
    expect(previewMset('1 x3 -5').tokens).toEqual([
      { kind: 'state', state: 1 },
      { kind: 'repeat', total: 3 },
      { kind: 'ramp', to: 5 },
    ]);
  });

  it('stops at the first token it cannot read, keeping what it had', () => {
    const preview = previewMset('1 x3 zz 9');
    expect(preview.error).toMatch(/unexpected token: zz/);
    expect(preview.states).toEqual([1, 1, 1]);
  });

  it('is empty for an empty specification', () => {
    expect(previewMset('').states).toEqual([]);
    expect(previewMset('   ').error).toBeNull();
  });
});
