/**
 * Adversarial re-verification of row 72 (`Setting > Colors...`).
 *
 * `ColorEditor.dom.test.tsx` pins the nine `connect()` calls of
 * `edit_colors_dialog`. This file pins the one thing the Qt dialog gets for
 * free and a React port does not: `load_color` is bound to `textChanged`
 * ALONE (`pymol_qt_gui.py:609`), so nothing except a change to the name box may
 * ever move the three channels.
 *
 * The port's lookup effect used to depend on the palette object as well as the
 * name, and the palette object is replaced on every refetch — `refreshPalette`
 * bumps `revision` and hands out a new state (`usePalette.ts`), and the
 * Colours window's own "refetch" button sits in the title bar, visible while
 * the editor tab is open. Half-edited channels were silently reset to the named
 * colour. Measured before the fix: R dragged to 0.42, one refetch, R back at
 * 1.00.
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

/** The real slots this file names, measured over the bridge in this checkout. */
const REAL: Record<number, ColorEntry> = {
  0: { index: 0, name: 'white', rgb: [1, 1, 1] },
  1: { index: 1, name: 'black', rgb: [0, 0, 0] },
  3: { index: 3, name: 'green', rgb: [0, 1, 0] },
  4: { index: 4, name: 'red', rgb: [1, 0, 0] },
};

function palette(revision = 1): PaletteState {
  const entries: ColorEntry[] = [];
  for (let i = 0; i <= 200; i++) {
    entries.push(REAL[i] ?? { index: i, name: `s${String(i).padStart(4, '0')}`, rgb: [0, 0, 0] });
  }
  const named = [0, 1, 3, 4].map((i) => entries[i]) as ColorEntry[];
  return { ...EMPTY_PALETTE, status: 'ready', entries, named, revision };
}

const call = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
  if (fn === 'get_color_index') return String(args[0]) === 'red' ? 4 : -1;
  if (fn === 'get_color_tuple') return [1, 0, 0];
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
  resetPaletteStore();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(state: PaletteState): void {
  act(() => {
    root.render(
      <SessionContext.Provider value={session}>
        <ColorEditor palette={state} />
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

const q = <T extends Element>(selector: string): T => {
  const found = container.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};

const slider = (ch: string) => q<HTMLInputElement>(`input[aria-label="slider_${ch}"]`);
const spin = (ch: string) => q<HTMLInputElement>(`input[aria-label="input_${ch}"]`);

describe('load_color fires on the name box and on nothing else', () => {
  it('keeps a half-made colour across a palette refetch', async () => {
    render(palette(1));
    await settle();
    type(slider('R'), '42');
    type(spin('G'), '0.34');
    await settle();
    expect(spin('R').value).toBe('0.42');

    // `refreshPalette` -> a NEW state object with the same table in it.
    render(palette(2));
    await settle();

    expect(spin('R').value).toBe('0.42');
    expect(spin('G').value).toBe('0.34');
    expect(slider('R').value).toBe('42');
  });

  it('still re-reads the colour when the NAME changes', async () => {
    render(palette(1));
    await settle();
    type(slider('R'), '42');
    await settle();

    const box = q<HTMLInputElement>('input[aria-label="input_name"]');
    type(box, 'green');
    await settle();
    expect(spin('R').value).toBe('0');
    expect(spin('G').value).toBe('1');
  });

  it('resolves the name at mount even when the table has not loaded yet', async () => {
    // The panel renders the editor tab before `loadPalette` finishes; with an
    // empty table `resolveColorName` has to go to the wire, and the sliders must
    // still end up on red rather than black.
    render({ ...EMPTY_PALETTE, status: 'loading' });
    await settle();
    expect(call).toHaveBeenCalledWith('get_color_index', ['red'], {});
    expect(spin('R').value).toBe('1');
    expect(spin('G').value).toBe('0');
  });
});
