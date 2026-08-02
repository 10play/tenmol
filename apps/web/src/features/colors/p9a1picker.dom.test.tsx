/**
 * The HSV picker — parity row 72's last open item.
 *
 * Row 72 was downgraded to partial in wave 6 for three things; wave 8 closed
 * the entry point and left one: "the plan's HSV/RGB picker replacing the three
 * sliders and three spinboxes is absent, and that is inside features/colors".
 * This file is that picker, mounted.
 *
 * The conversion itself is pinned against PyMOL's own `colorsys` in
 * `p9a1hsv.test.ts` (TypeScript side) and `packages/bridge/tests/test_p9_shell.py`
 * (in-engine side) through one shared fixture. What is pinned HERE is the
 * wiring: that the trio really is replaced, that the swatch and the RGB
 * spinboxes follow the H slider, that Apply writes what HSV produced, and the
 * one behaviour a naive picker gets wrong — a hue surviving a trip through
 * black.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColorEntry } from '@tenmol/protocol';
import { SessionContext, type Session } from '../../app';
import { ColorEditor } from './ColorEditor';
import { EMPTY_PALETTE, type PaletteState } from './palette';
import { resetPaletteStore } from './usePalette';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REAL: Record<number, ColorEntry> = {
  0: { index: 0, name: 'white', rgb: [1, 1, 1] },
  1: { index: 1, name: 'black', rgb: [0, 0, 0] },
  2: { index: 2, name: 'blue', rgb: [0, 0, 1] },
  4: { index: 4, name: 'red', rgb: [1, 0, 0] },
};

function palette(): PaletteState {
  const entries: ColorEntry[] = [];
  for (let i = 0; i <= 20; i++) {
    entries.push(REAL[i] ?? { index: i, name: `s${String(i).padStart(4, '0')}`, rgb: [0, 0, 0] });
  }
  const named = [0, 1, 2, 4].map((i) => entries[i]) as ColorEntry[];
  return { ...EMPTY_PALETTE, status: 'ready', entries, named, revision: 1 };
}

const INDEX_OF: Record<string, number> = { red: 4, blue: 2, black: 1, white: 0 };
const lines: string[] = [];

const call = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
  if (fn === 'get_color_index') return INDEX_OF[String(args[0])] ?? -1;
  if (fn === 'get_color_tuple') return palette().entries[Number(args[0])]?.rgb ?? null;
  if (fn === 'get_color_indices') return [['red', 4]];
  if (fn === 'get_names') return [];
  if (fn === 'do') {
    lines.push(String(args[0]));
    return null;
  }
  return null;
});

const session = {
  call,
  stores: { feedback: { appendClient: vi.fn() } },
  objectsSource: { invalidate: vi.fn() },
  poller: { kick: vi.fn() },
} as unknown as Session;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  call.mockClear();
  lines.length = 0;
  resetPaletteStore();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(): void {
  act(() => {
    root.render(
      <SessionContext.Provider value={session}>
        <ColorEditor palette={palette()} />
      </SessionContext.Provider>,
    );
  });
}

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, 'value')?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const q = <T extends Element>(selector: string): T | null => container.querySelector<T>(selector);
const need = <T extends Element>(selector: string): T => {
  const found = q<T>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};

const slider = (ch: string) => need<HTMLInputElement>(`input[aria-label="slider_${ch}"]`);
const spin = (ch: string) => need<HTMLInputElement>(`input[aria-label="input_${ch}"]`);
const nameBox = () => need<HTMLInputElement>('input[aria-label="input_name"]');
const swatch = () => need<HTMLElement>('[data-testid="frame_color"]');
const space = (which: 'rgb' | 'hsv') => need<HTMLButtonElement>(`[aria-label="space_${which}"]`);

async function toHsv(): Promise<void> {
  act(() => space('hsv').click());
  await settle();
}

describe('the H S V trio REPLACES the R G B trio (row 72)', () => {
  it('shows RGB by default — colors.ui is the parity target', async () => {
    mount();
    await settle();
    expect(q('input[aria-label="slider_R"]')).toBeTruthy();
    expect(q('input[aria-label="slider_H"]')).toBeNull();
    expect(space('rgb').getAttribute('aria-checked')).toBe('true');
  });

  it('swaps the three rows, and swaps them back', async () => {
    mount();
    await settle();
    await toHsv();
    // Replaced, not added: six widgets on screen, not twelve.
    expect(q('input[aria-label="slider_R"]')).toBeNull();
    expect(q('input[aria-label="input_G"]')).toBeNull();
    for (const channel of ['H', 'S', 'V']) {
      expect(slider(channel)).toBeTruthy();
      expect(spin(channel)).toBeTruthy();
    }
    expect(space('hsv').getAttribute('aria-checked')).toBe('true');

    act(() => space('rgb').click());
    expect(q('input[aria-label="slider_H"]')).toBeNull();
    expect(slider('R')).toBeTruthy();
  });

  it('opens on the current colour: red is 0°, 100%, 100%', async () => {
    mount();
    await settle();
    await toHsv();
    expect(slider('H').value).toBe('0');
    expect(slider('S').value).toBe('100');
    expect(slider('V').value).toBe('100');

    // The name field drives it, exactly as it drives the RGB rows.
    type(nameBox(), 'blue');
    await settle();
    expect(slider('H').value).toBe('240');
  });
});

describe('the picker writes the same colour the rest of the dialog shows', () => {
  it('a hue drag moves the swatch, the RGB spinboxes and the Apply line', async () => {
    mount();
    await settle();
    await toHsv();

    type(slider('H'), '120'); // pure green
    expect(swatch().style.background).toBe('rgb(0, 255, 0)');

    act(() => space('rgb').click());
    expect(spin('R').value).toBe('0');
    expect(spin('G').value).toBe('1');
    expect(spin('B').value).toBe('0');

    type(nameBox(), 'p9a1_green');
    await settle();
    act(() => need<HTMLButtonElement>('.cedit__apply').click());
    await settle();
    // `%.2f` per channel, and `recolor` in the same submission
    // (`pymol_qt_gui.py:589-590`).
    expect(lines).toEqual(['set_color p9a1_green, [0.00, 1.00, 0.00]\nrecolor']);
  });

  it('S and V land on the 2-decimal grid the swatch and Apply share', async () => {
    mount();
    await settle();
    await toHsv();
    type(slider('H'), '210');
    type(slider('S'), '50');
    type(slider('V'), '80');

    act(() => space('rgb').click());
    // hsv(0.5833, 0.5, 0.8) = (0.4, 0.6, 0.8) exactly on this grid.
    expect([spin('R').value, spin('G').value, spin('B').value]).toEqual(['0.4', '0.6', '0.8']);
    expect(swatch().style.background).toBe('rgb(102, 153, 204)');
  });
});

describe('the hue is HELD while the picker is open', () => {
  it('survives a trip to black and back — rgbToHsv would report hue 0', async () => {
    mount();
    await settle();
    await toHsv();
    type(slider('H'), '240');
    type(slider('V'), '0');
    expect(swatch().style.background).toBe('rgb(0, 0, 0)');
    // Everything is grey at V=0, so a picker that re-derives H from RGB shows
    // 0 here and pulls the colour to RED on the way back up.
    expect(slider('H').value).toBe('240');

    type(slider('V'), '100');
    expect(swatch().style.background).toBe('rgb(0, 0, 255)');
  });

  it('is dropped when the colour arrives from somewhere else', async () => {
    mount();
    await settle();
    await toHsv();
    type(slider('H'), '300');
    expect(slider('H').value).toBe('300');

    // The list/name field is "somewhere else": holding 300 here would show a
    // hue the swatch does not have.
    type(nameBox(), 'blue');
    await settle();
    expect(slider('H').value).toBe('240');
    expect(swatch().style.background).toBe('rgb(0, 0, 255)');

    // …and so is the hex box.
    type(need<HTMLInputElement>('input[aria-label="input_hex"]'), '#ff0000');
    await settle();
    expect(slider('H').value).toBe('0');
  });
});
