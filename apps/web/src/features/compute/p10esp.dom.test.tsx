/**
 * Wave 10 — inventory row 503, the second half of `util.protein_vacuum_esp`.
 *
 * The first half (a confirm step that interposes before the mutation) has been
 * closed since wave 4, and wave 8 measured the mutation itself against a live
 * engine. What stayed open was this: PyMOL's diagnostics —
 *
 *     " Util: Fixing termini and assigning formal charges..."
 *     " util.sum_partial_charges: sum = -0.4638"
 *     " SelectorMapCoulomb: Total charge is -0.464 for 10 points (10 atoms)."
 *
 * — arrived on the socket and landed in the GENERIC console feed, nowhere near
 * the button that caused them. A user who has just confirmed a destructive
 * dialog got no account of what was destroyed.
 *
 * The lines used here are the ones wave 8 measured off the wire
 * (`bridge/tests/test_p8_a34.py`), replayed through the real feedback store, so
 * this asserts against PyMOL's actual wording rather than a paraphrase.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedbackStore } from '@tenmol/stores';

import { ComputePanel, DIAGNOSTIC_WINDOW_MS, diagnosticsSince } from './ComputePanel';

/** Verbatim from the wave-8 bridge run. */
const ESP_LINES = [
  ' Util: Fixing termini and assigning formal charges...',
  ' Util: Assigning Amber 99 charges and radii...',
  ' util.sum_partial_charges: sum = -0.4638',
  ' SelectorMapCoulomb: Total charge is -0.464 for 10 points (10 atoms).',
];

const feedback = createFeedbackStore();
const calls: Array<{ fn: string; args: readonly unknown[] }> = [];
/** Lines the fake bridge pushes when the call is made, as PyMOL would. */
let onCall: (fn: string) => void = () => {};

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    calls.push({ fn, args });
    onCall(fn);
    return null;
  }),
  act: vi.fn(async () => {}),
  run: vi.fn(async () => {}),
  stores: { feedback },
};

vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls.length = 0;
  onCall = () => {};
  feedback.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render() {
  act(() => root.render(<ComputePanel />));
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found as HTMLButtonElement;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('the filter (row 503)', () => {
  it('keeps server output after the mark and drops the client and the prompt', () => {
    const lines = [
      { seq: 1, text: ' before the call', origin: 'server' as const, kind: 'info' },
      { seq: 2, text: 'PyMOL>util.protein_vacuum_esp("polymer")', origin: 'server' as const, kind: 'prompt' },
      { seq: 3, text: 'cmd.scene("x")', origin: 'client' as const, kind: 'client' },
      { seq: 4, text: '   ', origin: 'server' as const, kind: 'info' },
      { seq: 5, text: ESP_LINES[2]!, origin: 'server' as const, kind: 'info' },
    ];
    expect(diagnosticsSince(lines, 2)).toEqual([ESP_LINES[2]]);
    // The mark is inclusive, so seq 1 is kept at mark 1 and dropped at mark 2.
    expect(diagnosticsSince(lines, 1)).toEqual([' before the call', ESP_LINES[2]]);
    // Nothing before the mark leaks in even when it is the same text.
    expect(diagnosticsSince(lines, 6)).toEqual([]);
  });

  it('keeps the LAST 40 lines when a run floods, not the first', () => {
    const lines = Array.from({ length: 100 }, (_, i) => ({
      seq: i + 1,
      text: `line ${i}`,
      origin: 'server' as const,
      kind: 'info',
    }));
    const kept = diagnosticsSince(lines, 1);
    expect(kept).toHaveLength(40);
    expect(kept[0]).toBe('line 60');
    expect(kept[39]).toBe('line 99');
  });
});

describe('the destructive helper (row 503)', () => {
  it('confirms, runs, and shows what PyMOL printed next to the button', async () => {
    vi.useFakeTimers();
    render();

    // The dialog still interposes: pressing the button runs nothing.
    click(button('Protein vacuum ESP'));
    expect(calls).toHaveLength(0);
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('MODIFIES the structure');

    // PyMOL prints its diagnostics while the call is in flight.
    onCall = (fn) => {
      if (fn === 'util.protein_vacuum_esp') feedback.appendServer(ESP_LINES);
    };
    click(button('Modify structure and run'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.map((c) => c.fn)).toEqual(['util.protein_vacuum_esp']);

    // Before the window closes there is nothing yet — the capture is real, not
    // a synchronous copy of whatever happened to be in the store.
    expect(container.querySelector('[data-diagnostics="esp"]')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(DIAGNOSTIC_WINDOW_MS + 10);
      await Promise.resolve();
    });

    const block = container.querySelector('[data-diagnostics="esp"]');
    expect(block).not.toBeNull();
    expect(block?.querySelector('summary')?.textContent).toContain('4 lines');
    const shown = block?.querySelector('pre')?.textContent ?? '';
    for (const line of ESP_LINES) expect(shown).toContain(line.trim());
    // And it is attached to the ESP row, not to the panel: the cell holding it
    // is the same cell as that button's result.
    const row = block?.closest('tr');
    expect(row?.textContent).toContain('Protein vacuum ESP');
  });

  it('does not attribute another helper output to this one', async () => {
    vi.useFakeTimers();
    render();
    feedback.appendServer([' left over from an earlier command']);

    onCall = () => feedback.appendServer([' cmd.get_area: 123.4 square Angstroms.']);
    click(button('Molecular surface area'));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(DIAGNOSTIC_WINDOW_MS + 10);
      await Promise.resolve();
    });

    const text = container.querySelector('[data-diagnostics="area"]')?.textContent ?? '';
    expect(text).toContain('123.4 square Angstroms');
    expect(text).not.toContain('left over from an earlier command');
  });
});
