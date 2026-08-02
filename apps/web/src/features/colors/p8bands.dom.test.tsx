/**
 * `<BandGrid>` — the advanced band browser row 223 asks for.
 *
 * The row's plan: "`<ColorPicker>` shows the 178 named colors by default with
 * generated bands behind an 'advanced' toggle". Wave 4 cached and SAMPLED the
 * bands; nothing could browse them. What is pinned here is that every one of
 * the 5388 built-in slots is reachable in a bounded number of clicks, that the
 * region table matches the live engine (that half lives in
 * `bridge/tests/test_p8_a5.py::test_the_twelve_colour_regions_are_where_ColorReset_puts_them`,
 * which reads THIS table out of `palette.ts`), and that a tile is
 * `cmd.color_deep`, not `cmd.color`.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColorEntry } from '@tenmol/protocol';
import { SessionContext, type Session } from '../../app';
import { BandGrid, PER_PAGE } from './BandGrid';
import { COLOR_REGIONS, EMPTY_PALETTE, regionPages, type PaletteState } from './palette';
import { resetPaletteStore } from './usePalette';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A stand-in for the real table with the same SHAPE: 5388 dense slots, and the
 * generated names PyMOL builds (`s000`.. etc) at the indices the region table
 * claims. The names at the landmark slots are the real ones, checked live in
 * the bridge test named above.
 */
function palette(): PaletteState {
  const entries: ColorEntry[] = [];
  for (const region of COLOR_REGIONS) {
    for (let i = 0; i < region.count; i++) {
      const index = region.first + i;
      const name =
        region.id.length === 1
          ? `${region.id}${String(i).padStart(3, '0')}`
          : `${region.id}-${index}`;
      entries.push({ index, name, rgb: [i / 999, 0.5, 1 - i / 999] });
    }
  }
  return { ...EMPTY_PALETTE, status: 'ready', entries, revision: 1 };
}

const call = vi.fn(async () => null);
const appendClient = vi.fn();
const session = {
  call,
  stores: { feedback: { appendClient } },
  objectsSource: { invalidate: vi.fn() },
  poller: { kick: vi.fn() },
} as unknown as Session;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  call.mockClear();
  appendClient.mockClear();
  resetPaletteStore();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(state: PaletteState = palette(), sele = '(all)'): void {
  act(() => {
    root.render(
      <SessionContext.Provider value={session}>
        <BandGrid palette={state} sele={sele} />
      </SessionContext.Provider>,
    );
  });
}

const tiles = () => [...container.querySelectorAll<HTMLElement>('.cbands__tile')];
const regionButton = (label: string) =>
  [...container.querySelectorAll<HTMLElement>('.cbands__region')].find((el) =>
    el.textContent?.startsWith(label),
  );

describe('the region table', () => {
  it('tiles 0..5387 with no gap and no overlap', () => {
    const covered = new Set<number>();
    for (const region of COLOR_REGIONS) {
      for (let i = region.first; i < region.first + region.count; i++) {
        expect(covered.has(i)).toBe(false);
        covered.add(i);
      }
    }
    expect(covered.size).toBe(5388);
    expect(Math.max(...covered)).toBe(5387);
  });

  it('needs 5 clicks at most to reach any slot in a 1000-wide band', () => {
    const band = COLOR_REGIONS.find((r) => r.id === 'o');
    expect(band).toBeDefined();
    expect(regionPages(band!, PER_PAGE)).toBe(5);
    // and a one-slot region is still one page, not zero
    expect(
      regionPages(
        COLOR_REGIONS.find((r) => r.id === 'density')!,
        PER_PAGE,
      ),
    ).toBe(1);
  });
});

describe('<BandGrid>', () => {
  it('opens on the first region and shows a bounded page, not 5388 tiles', () => {
    mount();
    expect(tiles()).toHaveLength(COLOR_REGIONS[0]!.count);
    expect(tiles().length).toBeLessThanOrEqual(PER_PAGE);
  });

  it('pages a 1000-slot band 200 at a time, in index order', () => {
    mount();
    act(() => regionButton('s000-999')?.click());
    expect(tiles()).toHaveLength(PER_PAGE);
    expect(tiles()[0]?.textContent).toBe('s000');
    expect(tiles()[199]?.textContent).toBe('s199');
    expect(container.querySelector('[data-testid="cbands-page"]')?.textContent).toBe('page 1 / 5');

    const next = [...container.querySelectorAll<HTMLButtonElement>('.cbands__pages button')][1];
    act(() => next?.click());
    expect(tiles()[0]?.textContent).toBe('s200');
    expect(container.querySelector('[data-testid="cbands-page"]')?.textContent).toBe('page 2 / 5');
  });

  it('jumps to the region AND the page a raw slot number lands in', () => {
    mount();
    const box = container.querySelector<HTMLInputElement>('input[aria-label="jump to slot"]')!;
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(box) as object,
      'value',
    )?.set;
    // 4700 is inside o000-999 (first 4256), offset 444 -> page 3
    setter?.call(box, '4700');
    act(() => box.dispatchEvent(new Event('input', { bubbles: true })));
    expect(container.querySelector('[data-testid="cbands-page"]')?.textContent).toBe('page 3 / 5');
    expect(tiles()[0]?.textContent).toBe('o400');
    expect(tiles().some((t) => t.textContent === 'o444')).toBe(true);
  });

  it('colours with color_deep and the tile’s NAME, honouring the selection', () => {
    mount(palette(), 'chain A');
    act(() => regionButton('s000-999')?.click());
    act(() => tiles()[7]?.click());
    expect(call).toHaveBeenCalledWith('color_deep', ['s007', 'chain A'], { quiet: 0 });
    expect(appendClient).toHaveBeenCalledWith('cmd.color_deep("s007", "chain A", 0)');
  });

  it('says so instead of drawing 200 black squares when the palette is empty', () => {
    mount(EMPTY_PALETTE);
    expect(container.textContent).toContain('palette not loaded');
    expect(tiles().every((t) => t.classList.contains('is-missing'))).toBe(true);
  });
});
