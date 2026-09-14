/**
 * Row 341, item (1) — the sequence viewer RENDERING an alignment.
 *
 * The bridge now sends a tag per column, an offset that lines equal tags up,
 * an `unaligned` flag and `row.fill` (`packages/bridge/tests/test_p11_seqview.py`). The
 * thing this file pins is that the component STOPS packing the cells edge to
 * edge the moment that arrives: a flex row would close every hole the alignment
 * opened and put two unrelated residues in the same column.
 *
 * jsdom lays nothing out, so these assertions are on the STYLE the component
 * asks for — `left` in pixels off a shared base — not on a measured box.
 *
 * THE MEASURED-BOX HALF was a real Chromium at 1280x900 (fab ACDFG / ACDKKFG,
 * `align ... object=p11aln`), and it is recorded here because no test in this
 * tree can reproduce it:
 *
 *   mob  cells x = 0, 8, 16, 40, 48      fills x = 24 (w 8), 32 (w 8)
 *   tgt  cells x = 0, 8, 16, 24, 32, 40, 48
 *
 * i.e. both F columns at x = 40 while they are column 3 and column 5 by index.
 * `document.elementFromPoint` at the centre of all 12 cells returned the cell
 * itself — REACHABILITY, not visibility — and clicking tgt's column 5 selected
 * 20 atoms of PHE. With the alignment disabled mob's F fell back to x = 24.
 * The unaligned lysines came back `rgb(129,129,129)` (the fill grey) in mode 0
 * and `rgb(229,229,229)` (their own colour) in mode 3, which is
 * `packages/engine/layer1/Seq.cpp:325-327` visible on screen.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeqviewPayload } from '@tenmol/protocol';

import { SequenceViewer } from './SequenceViewer';

let payload: SeqviewPayload;
const selectCalls: unknown[][] = [];

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (fn === 'cmd.do') return null;
    if (fn === 'cmd.tenmol_seqview') {
      const [action, ...rest] = args as [string, ...unknown[]];
      if (action === 'install') return { installed: true };
      if (action === 'rows') return payload;
      if (action === 'select') selectCalls.push(rest);
      return { log: '', name: '', expression: '', count: 0 };
    }
    return null;
  }),
  run: vi.fn(async () => {}),
  poller: { kick: vi.fn() },
  stores: {
    connection: { get: () => ({ phase: 'open' }), subscribe: () => () => {} },
    ui: { get: () => ({ echoActions: false }), subscribe: () => () => {} },
    feedback: { appendClient: vi.fn() },
  },
};

vi.mock('../../app', () => ({
  useSession: () => SESSION,
  // These tests exercise the working (bridge) path, so the viewer is NOT gated.
  isLocal: () => false,
  useStore: (store: { get: () => unknown }, pick: (s: unknown) => unknown) =>
    pick(store.get()),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

/** `ACD--FG` over `ACDKKFG` — the exact geometry the bridge test measures. */
function aligned(over: Partial<SeqviewPayload> = {}): SeqviewPayload {
  const cellsOf = (spec: [string, number, number, boolean][]) =>
    spec.map(([text, offset, tag, unaligned]) => ({
      text,
      offset,
      color: tag ? 4 : 104,
      atoms: [offset + 1],
      resn: 'XXX',
      resi: String(offset + 1),
      ...(tag ? { tag } : {}),
      ...(unaligned ? { unaligned: true } : {}),
    }));
  return {
    visible: true,
    location: 0,
    overlay: false,
    format: 0,
    labelMode: 3,
    gapMode: 1,
    fillColor: 104,
    activeSele: '',
    seleMode: 'byresi',
    alignment: 'p11aln',
    unalignedMode: 0,
    unalignedColor: 104,
    fillChar: '-',
    bgColor: [0, 0, 0],
    colors: { '4': [1, 0, 0], '104': [0.5, 0.5, 0.5] },
    window: { first: 0, count: 1200, max: 1200 },
    rows: [
      {
        object: 'mob',
        objectColor: 0,
        codes: 0,
        selectable: true,
        discrete: false,
        extLen: 5,
        nCols: 5,
        first: 0,
        truncated: false,
        labels: [],
        breadcrumbs: [],
        fill: [
          { offset: 3, width: 1 },
          { offset: 4, width: 1 },
        ],
        cells: cellsOf([
          ['A', 0, 2, false],
          ['C', 1, 12, false],
          ['D', 2, 23, false],
          ['F', 5, 35, false],
          ['G', 6, 55, false],
        ]),
      },
      {
        object: 'tgt',
        objectColor: 0,
        codes: 0,
        selectable: true,
        discrete: false,
        extLen: 7,
        nCols: 7,
        first: 0,
        truncated: false,
        labels: [],
        breadcrumbs: [],
        fill: [],
        cells: cellsOf([
          ['A', 0, 2, false],
          ['C', 1, 12, false],
          ['D', 2, 23, false],
          ['K', 3, 0, true],
          ['K', 4, 0, true],
          ['F', 5, 35, false],
          ['G', 6, 55, false],
        ]),
      },
    ],
    ...over,
  } as unknown as SeqviewPayload;
}

beforeEach(() => {
  selectCalls.length = 0;
  payload = aligned();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(<SequenceViewer />);
  });
  for (let i = 0; i < 4; i++) await act(async () => {});
}

const lines = () => [...container.querySelectorAll('.seqrow__line')] as HTMLElement[];
const cellsIn = (line: HTMLElement) =>
  [...line.querySelectorAll('.seqcell')] as HTMLElement[];
const fillsIn = (line: HTMLElement) =>
  [...line.querySelectorAll('.seqfill')] as HTMLElement[];

/** `packages/engine/layer1/Seq.h:84-88`. */
const CHAR_WIDTH = 8;

describe('alignment mode leaves the flow layout', () => {
  it('places every cell absolutely, at offset * CHAR_WIDTH', async () => {
    await render();
    const [mob, tgt] = lines();
    expect(mob!.className).toContain('seqrow__line--aligned');

    expect(cellsIn(mob!).map((c) => c.style.left)).toEqual([
      '0px',
      '8px',
      '16px',
      '40px',
      '48px',
    ]);
    expect(cellsIn(tgt!).map((c) => c.style.left)).toEqual([
      '0px',
      '8px',
      '16px',
      '24px',
      '32px',
      '40px',
      '48px',
    ]);
    for (const cell of cellsIn(mob!)) expect(cell.style.position).toBe('absolute');
  });

  it('puts the two F columns at the SAME x, which is the whole point', async () => {
    await render();
    const [mob, tgt] = lines();
    const mobF = cellsIn(mob!).find((c) => c.textContent === 'F')!;
    const tgtF = cellsIn(tgt!).find((c) => c.textContent === 'F')!;
    expect(mobF.style.left).toBe('40px');
    expect(tgtF.style.left).toBe(mobF.style.left);
    // ...and the columns are 3 and 5 counted by INDEX, so a flow layout would
    // have put them 16px apart.
    expect(cellsIn(mob!).indexOf(mobF)).toBe(3);
    expect(cellsIn(tgt!).indexOf(tgtF)).toBe(5);
  });

  it('draws seq_view_fill_char across each fill run, in the fill colour', async () => {
    await render();
    const [mob, tgt] = lines();
    const fills = fillsIn(mob!);
    expect(fills.map((f) => [f.textContent, f.style.left, f.style.width])).toEqual([
      ['-', '24px', `${CHAR_WIDTH}px`],
      ['-', '32px', `${CHAR_WIDTH}px`],
    ]);
    expect(fills[0]!.style.color).toBe('rgb(128, 128, 128)');
    expect(fillsIn(tgt!)).toHaveLength(0);
  });

  it('draws no fill at all when seq_view_fill_char is a space', async () => {
    payload = aligned({ fillChar: '' });
    await render();
    expect(fillsIn(lines()[0]!)).toHaveLength(0);
  });

  it('repeats the fill character across a wider run', async () => {
    const wide = aligned();
    wide.rows[0]!.fill = [{ offset: 3, width: 2 }];
    payload = wide;
    await render();
    const fills = fillsIn(lines()[0]!);
    expect(fills.map((f) => [f.textContent, f.style.width])).toEqual([['--', '16px']]);
  });
});

describe('the unaligned colour', () => {
  it('is the flat unaligned colour in mode 0', async () => {
    await render();
    const tgt = lines()[1]!;
    const k = cellsIn(tgt).filter((c) => c.textContent === 'K');
    expect(k.map((c) => c.style.color)).toEqual([
      'rgb(128, 128, 128)',
      'rgb(128, 128, 128)',
    ]);
    // The aligned cells keep the colour the bridge sent for them.
    expect(cellsIn(tgt)[0]!.style.color).toBe('rgb(255, 0, 0)');
  });

  it('is averaged with the background in mode 1', async () => {
    payload = aligned({ unalignedMode: 1 });
    await render();
    const k = cellsIn(lines()[1]!).find((c) => c.textContent === 'K')!;
    // colour 104 is 0.5 grey, the background is black -> 0.25 -> 64.
    expect(k.style.color).toBe('rgb(64, 64, 64)');
  });

  it('keeps the column`s own colour in mode 3, where the index is -1', async () => {
    payload = aligned({ unalignedMode: 3, unalignedColor: -1 });
    await render();
    const k = cellsIn(lines()[1]!).find((c) => c.textContent === 'K')!;
    expect(k.style.color).toBe('rgb(128, 128, 128)');
    expect(k.className).toContain('is-unaligned');
  });
});

describe('without an alignment nothing about the layout changes', () => {
  it('keeps the flow row and sets no left', async () => {
    payload = aligned({ alignment: '' });
    await render();
    const [mob] = lines();
    expect(mob!.className).not.toContain('seqrow__line--aligned');
    for (const cell of cellsIn(mob!)) {
      expect(cell.style.left).toBe('');
      expect(cell.style.position).toBe('');
    }
    expect(fillsIn(mob!)).toHaveLength(0);
  });
});

describe('the cells stay clickable under the absolute layout', () => {
  it('still routes a left press to the column`s own atoms', async () => {
    await render();
    const tgt = lines()[1]!;
    const k = cellsIn(tgt)[3]!;
    act(() => {
      k.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 30,
          clientY: 20,
        }),
      );
    });
    await act(async () => {});
    // ['tgt', the atoms of column 3, include=1, startOver=0] — a plain left
    // press toggles into the active selection (`grammar.ts:167`), and the
    // atoms are column 3's, not a neighbour's.
    expect(selectCalls).toEqual([['tgt', [4], 1, 0]]);
  });
});

describe('the header names the alignment', () => {
  it('says which object is driving the line-up and in which mode', async () => {
    payload = aligned({ unalignedMode: 4 });
    await render();
    const head = container.querySelector('.seqview__alignment') as HTMLElement;
    expect(head.textContent).toBe('aligned by p11aln (staggered, dimmed)');
  });

  it('says nothing when there is no alignment', async () => {
    payload = aligned({ alignment: '' });
    await render();
    expect(container.querySelector('.seqview__alignment')).toBeNull();
  });
});
