/**
 * Row 341, item (1) — the client half of alignment mode, as pure functions.
 *
 * The geometry belongs to the bridge (`bridge/tests/test_p11_seqview.py` pins
 * `align_rows` against `layer3/Seeker.cpp:1583-1793`). What is decided HERE is
 * what `CSeq::draw` decides at paint time:
 *
 *   - the colour of an unaligned column, which is `seq_view_unaligned_mode`'s
 *     OTHER job (`layer1/Seq.cpp:322-338` resolves the colour, `:420-449`
 *     blends it), and
 *   - the shared base every row is positioned against, without which two rows
 *     whose windows start at different offsets slide back on top of each other.
 */

import { describe, expect, it } from 'vitest';
import type { SeqviewCell, SeqviewPayload } from '@tenmol/protocol';
import { seqUnalignedStagger } from '@tenmol/protocol';

import { average3f, columnRgb, isAligned, rgbCss, windowBase } from './alignment';

/** Red at index 4, the fill grey at 104, on a black background. */
function payload(over: Partial<SeqviewPayload> = {}): SeqviewPayload {
  return {
    visible: true,
    location: 0,
    overlay: false,
    format: 0,
    labelMode: 2,
    gapMode: 1,
    fillColor: 104,
    activeSele: '',
    seleMode: 'byresi',
    alignment: 'aln',
    unalignedMode: 0,
    unalignedColor: 104,
    fillChar: '-',
    bgColor: [0, 0, 0],
    colors: { '4': [1, 0, 0], '104': [0.5, 0.5, 0.5] },
    rows: [],
    window: { first: 0, count: 1200, max: 1200 },
    ...over,
  } as SeqviewPayload;
}

function cell(over: Partial<SeqviewCell> = {}): SeqviewCell {
  return { text: 'A', color: 4, offset: 0, atoms: [1], ...over };
}

describe('seqUnalignedStagger — layer3/Seeker.cpp:1590-1596', () => {
  it('is false for 0/1/2 and true for 3/4/5', () => {
    expect([0, 1, 2, 3, 4, 5].map(seqUnalignedStagger)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});

describe('columnRgb — layer1/Seq.cpp:420-449', () => {
  it('leaves an ALIGNED column its own colour in every mode', () => {
    for (const unalignedMode of [0, 1, 2, 3, 4, 5]) {
      expect(columnRgb(cell({ tag: 7 }), payload({ unalignedMode }))).toEqual([1, 0, 0]);
    }
  });

  it('paints an unaligned column the unaligned colour flat in mode 0', () => {
    expect(columnRgb(cell({ unaligned: true }), payload({ unalignedMode: 0 }))).toEqual([
      0.5, 0.5, 0.5,
    ]);
  });

  it('averages with the BACKGROUND in modes 1 and 4', () => {
    for (const unalignedMode of [1, 4]) {
      expect(
        columnRgb(cell({ unaligned: true }), payload({ unalignedMode })),
      ).toEqual([0.5, 0, 0]);
    }
  });

  it('averages with the UNALIGNED colour in modes 2 and 5', () => {
    for (const unalignedMode of [2, 5]) {
      expect(
        columnRgb(cell({ unaligned: true }), payload({ unalignedMode })),
      ).toEqual([0.75, 0.25, 0.25]);
    }
  });

  it('keeps the column`s own colour in mode 3, where the index stays -1', () => {
    // `case 3: unaligned_color_index = -1;` (`layer1/Seq.cpp:325-327`) — the
    // bridge has already resolved it, so this is the -1 arriving.
    expect(
      columnRgb(
        cell({ unaligned: true }),
        payload({ unalignedMode: 3, unalignedColor: -1 }),
      ),
    ).toEqual([1, 0, 0]);
  });

  it('treats -1 as "no colour" even if the map happens to have a "-1" key', () => {
    // `if(unaligned_color_index < 0) unaligned_color = nullptr;` (`:335-338`)
    // is a test on the INDEX, not a failed lookup, and the two only coincide
    // because `build()` never emits a negative key. Pin the index test.
    expect(
      columnRgb(
        cell({ unaligned: true }),
        payload({
          unalignedMode: 3,
          unalignedColor: -1,
          colors: { '4': [1, 0, 0], '-1': [0, 0, 1] },
        }),
      ),
    ).toEqual([1, 0, 0]);
  });

  it('follows a non-black background into the dim blend', () => {
    expect(
      columnRgb(
        cell({ unaligned: true }),
        payload({ unalignedMode: 1, bgColor: [1, 1, 1] }),
      ),
    ).toEqual([1, 0.5, 0.5]);
  });

  it('is undefined when the payload carries no RGB for the index', () => {
    expect(columnRgb(cell({ color: 999 }), payload())).toBeUndefined();
  });
});

describe('average3f and rgbCss', () => {
  it('halves each channel', () => {
    expect(average3f([1, 0, 0.5], [0, 1, 0.5])).toEqual([0.5, 0.5, 0.5]);
  });

  it('scales 0..1 to 0..255 and clamps', () => {
    expect(rgbCss([0, 0.5, 1])).toBe('rgb(0,128,255)');
    expect(rgbCss([-1, 2, 0])).toBe('rgb(0,255,0)');
    expect(rgbCss(undefined)).toBeUndefined();
    expect(rgbCss([1, 1])).toBeUndefined();
  });
});

describe('isAligned', () => {
  it('is exactly "the bridge named an alignment"', () => {
    expect(isAligned(payload({ alignment: 'aln' }))).toBe(true);
    expect(isAligned(payload({ alignment: '' }))).toBe(false);
  });
});

describe('windowBase', () => {
  const row = (offsets: number[]) =>
    ({
      object: 'o',
      objectColor: 0,
      codes: 0,
      selectable: true,
      discrete: false,
      extLen: 0,
      nCols: offsets.length,
      first: 0,
      truncated: false,
      fill: [],
      labels: [],
      breadcrumbs: [],
      cells: offsets.map((offset) => cell({ offset })),
    }) as unknown as SeqviewPayload['rows'][number];

  it('is the SMALLEST first-cell offset, not each row`s own', () => {
    // A row whose window starts later must KEEP that head start; rebasing it on
    // its own first cell is what would undo the alignment.
    expect(windowBase(payload({ rows: [row([12, 13]), row([9, 10])] }))).toBe(9);
  });

  it('is 0 when no row has a cell', () => {
    expect(windowBase(payload({ rows: [] }))).toBe(0);
    expect(windowBase(payload({ rows: [row([])] }))).toBe(0);
  });
});
