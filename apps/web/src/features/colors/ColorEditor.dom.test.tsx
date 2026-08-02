/**
 * `<ColorEditor>` — the browser's `edit_colors_dialog`
 * (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:547-611`, `pmg_qt/forms/colors.ui`).
 *
 * What is pinned here is the WIRING the Qt dialog gets from its nine
 * `connect()` calls: list -> name, name -> RGB, slider <-> spinbox, spinbox ->
 * swatch, and Apply -> `cmd.do`. The engine-side facts those depend on
 * (`get_color_index('re') == 4`, `get_color_tuple(-6) is None`, a `cmd.do` with
 * an embedded newline running both commands) are measured live in
 * `packages/bridge/tests/test_wf_colors.py`.
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

/* ---------------------------------------------------------------- *
 * a palette with the real slots, and a session that answers like the
 * engine did when this was measured
 * ---------------------------------------------------------------- */

const REAL: Record<number, ColorEntry> = {
  0: { index: 0, name: 'white', rgb: [1, 1, 1] },
  1: { index: 1, name: 'black', rgb: [0, 0, 0] },
  2: { index: 2, name: 'blue', rgb: [0, 0, 1] },
  3: { index: 3, name: 'green', rgb: [0, 1, 0] },
  4: { index: 4, name: 'red', rgb: [1, 0, 0] },
  104: {
    index: 104,
    name: 'grey50',
    rgb: [0.5050504803657532, 0.5050504803657532, 0.5050504803657532],
  },
  5388: { index: 5388, name: 'tenmol_wf_dlg', rgb: [0.12, 0.34, 0.56] },
};

function palette(): PaletteState {
  const entries: ColorEntry[] = [];
  for (let i = 0; i <= 5388; i++) {
    entries.push(REAL[i] ?? { index: i, name: `s${String(i).padStart(4, '0')}`, rgb: [0, 0, 0] });
  }
  const named = [0, 1, 2, 3, 4, 5388].map((i) => entries[i]) as ColorEntry[];
  return { ...EMPTY_PALETTE, status: 'ready', entries, named, revision: 1 };
}

/** `get_color_index`, exactly as the engine answered it (measured). */
const INDEX_OF: Record<string, number> = {
  red: 4,
  RED: 4,
  re: 4,
  r: 4,
  gr: 3,
  '': 1,
  zzz: -1,
  front: -6,
  '0xff8800': 1090488320,
};

const call = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
  if (fn === 'get_color_index') {
    const key = String(args[0]);
    return key in INDEX_OF ? INDEX_OF[key] : -1;
  }
  if (fn === 'get_color_tuple') {
    if (args[0] === 1090488320) return [1.0, 0.5333333611488342, 0.0];
    const entry = palette().entries[Number(args[0])];
    return entry ? entry.rgb : null;
  }
  // The refetch `apply` triggers. Kept minimal on purpose: this test is about
  // the dialog, and `loadPalette` has its own coverage in palette.test.ts.
  if (fn === 'get_color_indices') return [['red', 4]];
  if (fn === 'get_names') return [];
  if (fn === 'do') return null;
  return null;
});

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

function mount(state: PaletteState = palette()): void {
  act(() => {
    root.render(
      <SessionContext.Provider value={session}>
        <ColorEditor palette={state} />
      </SessionContext.Provider>,
    );
  });
}

/** React listens on 'input'; the value has to go through the native setter. */
function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, 'value')?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Let the `resolveColorName` promise chain settle inside an act() scope. */
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

const nameBox = () => q<HTMLInputElement>('input[aria-label="input_name"]');
const slider = (ch: string) => q<HTMLInputElement>(`input[aria-label="slider_${ch}"]`);
const spin = (ch: string) => q<HTMLInputElement>(`input[aria-label="input_${ch}"]`);
const swatch = () => q<HTMLElement>('[data-testid="frame_color"]');

/* ---------------------------------------------------------------- */

describe('list_colors', () => {
  it('lists the digit-free names and the session’s own colours, Qt-sorted', async () => {
    mount();
    await settle();
    const items = [...container.querySelectorAll('[role="option"]')].map((el) =>
      el.textContent?.trim(),
    );
    expect(items).toEqual(['black', 'blue', 'green', 'red', 'tenmol_wf_dlg', 'white']);
  });

  it('writes the NAME box on click, which is what loads the colour', async () => {
    mount();
    const green = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (el) => el.textContent?.trim() === 'green',
    );
    act(() => green?.click());
    await settle();
    expect(nameBox().value).toBe('green');
    expect(slider('G').value).toBe('100');
    expect(slider('R').value).toBe('0');
    // An exact name is in the cached table, so the click costs no round trip.
    expect(call).not.toHaveBeenCalled();
  });

  it('filters without changing the order', async () => {
    mount();
    await settle();
    type(q<HTMLInputElement>('.cedit__filter'), 'e');
    const items = [...container.querySelectorAll('[role="option"]')].map((el) =>
      el.textContent?.trim(),
    );
    expect(items).toEqual(['blue', 'green', 'red', 'tenmol_wf_dlg', 'white']);
  });
});

describe('input_name -> load_color', () => {
  it('loads a PREFIX through the engine (get_color_index("gr") == 3)', async () => {
    mount();
    type(nameBox(), 'gr');
    await settle();
    expect(call).toHaveBeenCalledWith('get_color_index', ['gr'], {});
    expect(slider('G').value).toBe('100');
    expect(spin('G').value).toBe('1');
  });

  it('leaves the sliders alone when the engine answers -1', async () => {
    mount();
    expect(slider('R').value).toBe('100'); // 'red' loaded at mount
    type(nameBox(), 'zzz');
    await settle();
    expect(slider('R').value).toBe('100');
    expect(spin('R').value).toBe('1');
  });

  it('leaves them alone for "front" too — the case the Qt dialog throws on', async () => {
    // `pymol_qt_gui.py:558` guards `index == -1`; front is -6 and
    // `get_color_tuple(-6)` is None, so the desktop handler raises TypeError.
    mount();
    type(nameBox(), 'front');
    await settle();
    expect(call).toHaveBeenCalledWith('get_color_index', ['front'], {});
    expect(call).not.toHaveBeenCalledWith('get_color_tuple', [-6], {});
    expect(slider('R').value).toBe('100');
  });

  it('accepts an inline 0xRRGGBB name and fetches its tuple', async () => {
    mount();
    type(nameBox(), '0xff8800');
    await settle();
    expect(call).toHaveBeenCalledWith('get_color_tuple', [1090488320], {});
    // 0x88/255 = 0.5333… on the 2-decimal spinbox grid.
    expect(spin('G').value).toBe('0.53');
    expect(slider('G').value).toBe('53');
  });

  it('lets the last name typed win, not the last reply to arrive', async () => {
    // Two keystrokes in flight; the FIRST resolves last. The Qt dialog cannot
    // have this bug (it is synchronous) and neither may this one.
    const gate: (() => void)[] = [];
    call.mockImplementation(
      (fn: string, args: readonly unknown[] = []) =>
        new Promise((resolve) => {
          gate.push(() => resolve(fn === 'get_color_index' ? INDEX_OF[String(args[0])] : null));
        }),
    );
    mount();
    type(nameBox(), 'gr');
    type(nameBox(), 'zzz'); // -1: must leave the sliders on whatever 'gr' is not
    await act(async () => {
      gate.reverse().forEach((release) => release());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(nameBox().value).toBe('zzz');
    expect(slider('R').value).toBe('100'); // still 'red', never became green
    expect(slider('G').value).toBe('0');
  });
});

describe('slider_X <-> input_X', () => {
  it('drives the spinbox as v / 100 and the swatch with it', async () => {
    mount();
    type(slider('R'), '42');
    await settle();
    expect(spin('R').value).toBe('0.42');
    // frame_color's `background-color: rgb(R*0xFF, …)`. PyMOL's `%d` truncates
    // (107) where `rgbToCss` rounds (0.42*255 = 107.1 -> 107, same here); the
    // two can differ by one 255th, which is the documented divergence.
    expect(swatch().style.background).toBe('rgb(107, 0, 0)');
  });

  it('drives the slider as round(v * 100), on the 2-decimal grid', async () => {
    mount();
    type(spin('G'), '0.336');
    await settle();
    expect(slider('G').value).toBe('34');
    expect(spin('G').value).toBe('0.34');
  });

  it('clamps outside 0..1, like a QDoubleSpinBox with maximum 1.0', async () => {
    mount();
    type(spin('B'), '7');
    await settle();
    expect(spin('B').value).toBe('1');
    expect(slider('B').value).toBe('100');
  });
});

describe('the hex box (not a Qt widget — this dialog has none)', () => {
  it('can be TYPED into one character at a time', async () => {
    // It could not before: the value was derived straight from `rgb`, so the
    // first keystroke produced a string `cssToRgb` rejects and React put the
    // old text back. Only a paste ever landed.
    mount();
    const hex = q<HTMLInputElement>('input[aria-label="input_hex"]');
    for (const partial of ['#', '#f', '#ff', '#ff8', '#ff88', '#ff880', '#ff8800']) {
      type(hex, partial);
      await settle();
      expect(hex.value).toBe(partial);
    }
    expect(spin('G').value).toBe('0.53');
  });

  it('snaps to the 2-decimal grid on blur, and says so', async () => {
    mount();
    const hex = q<HTMLInputElement>('input[aria-label="input_hex"]');
    type(hex, '#ff8800');
    await settle();
    // React 17+ delegates onBlur from the bubbling 'focusout', not 'blur'.
    act(() => hex.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    // 0x88/255 = 0.5333… -> 0.53 -> 0x87. One 255th, and it is the value Apply
    // writes, which is the point of quantising at all.
    expect(hex.value).toBe('#ff8700');
  });
});

describe('button_apply', () => {
  it('submits one cmd.do with set_color + recolor and no client echo', async () => {
    mount();
    type(nameBox(), 'red');
    await settle();
    type(spin('G'), '0.34');
    await settle();
    call.mockClear();

    await act(async () => {
      q<HTMLButtonElement>('.cedit__apply').click();
      await Promise.resolve();
    });
    await settle();

    const dos = call.mock.calls.filter(([fn]) => fn === 'do');
    expect(dos).toHaveLength(1);
    expect(dos[0]?.[1]).toEqual(['set_color red, [1.00, 0.34, 0.00]\nrecolor']);
    // PyMOL echoes a `do` itself; a client echo would double it.
    expect(appendClient).not.toHaveBeenCalled();
  });

  it('refuses an empty name instead of running `set_color , [...]`', async () => {
    mount();
    type(nameBox(), '');
    await settle();
    call.mockClear();
    await act(async () => {
      q<HTMLButtonElement>('.cedit__apply').click();
      await Promise.resolve();
    });
    expect(call.mock.calls.filter(([fn]) => fn === 'do')).toHaveLength(0);
    expect(q('.cedit__status').textContent).toContain('name is required');
  });

  it('says whether Apply will overwrite a slot or create one', async () => {
    mount();
    expect(q('.cedit__hint').textContent).toBe('overwrites index 4');
    type(nameBox(), 'brand_new');
    await settle();
    expect(q('.cedit__hint').textContent).toBe('creates a new colour');
  });
});
