/**
 * Inventory row 275 — the Draw/Ray panel's **Draw (fast)** path.
 *
 * Wave 4 opened the panel and used "Ray (slow)" + "Save Image to File", and
 * left the Draw button annotated UNVERIFIED because `draw 886, 314` was
 * recorded as having killed the bridge once.
 *
 * `packages/bridge/tests/test_p8_a6.py::TestDrawPath` refutes that on the engine side:
 * `draw 400, 300` AND `draw 886, 314` both answer ok, leave the viewport at
 * 800x600, and leave a prior image of exactly the requested size for
 * `cmd.png(prior=1)` to save. This is the other half — that the button really
 * emits those numbers, that it hands over to page 2, and that page 2's two
 * buttons are the `prior=1` save and the clipboard copy.
 *
 * `pymol_qt_gui.py:673-790`.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RenderPanel } from './ImageDialogs';
import { drawCommand, rayCommands } from './commands';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** What `files.render_info` answers for the test bridge's 800x600 viewport. */
const INFO = {
  width: 800,
  height: 600,
  dpi: 0,
  dpiChoices: [300, 150, 90],
  units: ['cm', 'inch'],
  // Added to `RenderInfo` by the wave-8 opaque-background work; the dialog
  // seeds its transparency checkbox from it.
  opaqueBackground: true,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function buttons() {
  return [...container.querySelectorAll('button')];
}

function click(label: string) {
  const button = buttons().find((b) => b.textContent === label);
  expect(button, `no button labelled ${label}`).toBeTruthy();
  act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function typeInto(index: number, value: string) {
  const input = container.querySelectorAll('input[type="number"]')[index] as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Draw (fast)', () => {
  it('emits the viewport size and turns the page', () => {
    const onDraw = vi.fn();
    act(() =>
      root.render(
        <RenderPanel
          info={INFO}
          onDraw={onDraw}
          onRay={vi.fn()}
          onSave={vi.fn()}
          onClipboard={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );

    click('Draw (fast)');
    expect(onDraw).toHaveBeenCalledWith(800, 600);
    // …and that pair becomes the command the engine was measured to accept.
    expect(drawCommand(800, 600)).toBe('draw 800, 600');

    // Page 2 is the two ways to get the image out (`:764-786`).
    expect(buttons().map((b) => b.textContent)).toEqual([
      '×',
      '< Back',
      'Copy Image to Clipboard',
      'Save Image to File',
    ]);
    expect(container.textContent).toContain('prior=1');
  });

  it('emits an edited, aspect-locked size — the 886x314 case', () => {
    const onDraw = vi.fn();
    act(() =>
      root.render(
        <RenderPanel
          info={{ ...INFO, width: 886, height: 314 }}
          onDraw={onDraw}
          onRay={vi.fn()}
          onSave={vi.fn()}
          onClipboard={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    click('Draw (fast)');
    expect(onDraw).toHaveBeenCalledWith(886, 314);
    expect(drawCommand(886, 314)).toBe('draw 886, 314');
  });

  it('keeps the aspect ratio when the width changes, and Reset undoes it', () => {
    const onDraw = vi.fn();
    act(() =>
      root.render(
        <RenderPanel
          info={INFO}
          onDraw={onDraw}
          onRay={vi.fn()}
          onSave={vi.fn()}
          onClipboard={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );

    typeInto(0, '400');
    click('Draw (fast)');
    expect(onDraw).toHaveBeenLastCalledWith(400, 300); // 4:3 preserved

    click('< Back');
    click('Reset');
    click('Draw (fast)');
    expect(onDraw).toHaveBeenLastCalledWith(800, 600);
  });

  it('converts px to physical units with the DPI, the way the label claims', () => {
    act(() =>
      root.render(
        <RenderPanel
          info={INFO}
          onDraw={vi.fn()}
          onRay={vi.fn()}
          onSave={vi.fn()}
          onClipboard={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    // dpi seeds to 300 when `image_dots_per_inch` is 0 (measured: it is).
    const units = [...container.querySelectorAll('.fdlg__unit')].map((n) => n.textContent);
    expect(units[0]).toBe('6.77 cm'); // 800 px / 300 dpi * 2.54
    expect(units[1]).toBe('5.08 cm');
  });

  it('Ray (slow) is the other button, and it carries the background flag', () => {
    const onRay = vi.fn();
    act(() =>
      root.render(
        <RenderPanel
          info={INFO}
          onDraw={vi.fn()}
          onRay={onRay}
          onSave={vi.fn()}
          onClipboard={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    click('Ray (slow)');
    expect(onRay).toHaveBeenCalledWith(800, 600, true);
    expect(rayCommands(800, 600, true)).toEqual([
      'set opaque_background, 0',
      'ray 800, 600, async=1',
    ]);
  });

  it('Save Image to File passes the DPI that page 1 was showing', () => {
    const onSave = vi.fn();
    act(() =>
      root.render(
        <RenderPanel
          info={INFO}
          onDraw={vi.fn()}
          onRay={vi.fn()}
          onSave={onSave}
          onClipboard={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    // width, height, at DPI — 'Units' is a <select>, so DPI is index 2.
    typeInto(2, '150');
    click('Draw (fast)');
    click('Save Image to File');
    expect(onSave).toHaveBeenCalledWith(150);
  });
});
