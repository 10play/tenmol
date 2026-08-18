/**
 * The FloatingWindow contract, pinned.
 *
 * This is the frame every migrated popup (builder, colours, settings, compute,
 * apbs, plugin manager) now renders in, so the promises it makes — it is a
 * labelled dialog, it closes, it shades, it drags, and Esc from inside closes
 * it but Esc from a text field does not — are asserted here once rather than in
 * each feature's suite.
 */

import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FloatingWindow } from './FloatingWindow';
import { resetWindowZ } from './windowZ';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetWindowZ();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactNode): void {
  act(() => root.render(node));
}

function win(): HTMLElement {
  const el = container.querySelector<HTMLElement>('.flwin');
  if (!el) throw new Error('no .flwin rendered');
  return el;
}

/** Fire a native pointer-typed MouseEvent (jsdom has no PointerEvent constructor). */
function pointer(type: string, target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
}

describe('FloatingWindow', () => {
  it('renders a labelled dialog with a draggable title bar and a close button', () => {
    render(
      <FloatingWindow title="Builder" defaultWidth={400} defaultHeight={300}>
        <p>body</p>
      </FloatingWindow>,
    );
    const el = win();
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-label')).toBe('Builder');
    expect(el.querySelector('.flwin__label')?.textContent).toBe('Builder');
    expect(el.querySelector('.flwin__grip')).not.toBeNull();
    // Positioned off the viewport centre, not over it (anchor 'right').
    expect(parseInt(el.style.left, 10)).toBeGreaterThan(300);
  });

  it('calls onClose from the × button', () => {
    const onClose = vi.fn();
    render(
      <FloatingWindow title="X" onClose={onClose} defaultWidth={400} defaultHeight={300}>
        <p>body</p>
      </FloatingWindow>,
    );
    const close = win().querySelector<HTMLButtonElement>('[data-close]');
    act(() => close?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shades (hides the body) and restores on the shade button', () => {
    render(
      <FloatingWindow title="X" defaultWidth={400} defaultHeight={300}>
        <p data-testid="content">body</p>
      </FloatingWindow>,
    );
    const shade = win().querySelector<HTMLButtonElement>('[aria-label="shade"]');
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    act(() => shade?.click());
    expect(container.querySelector('[data-testid="content"]')).toBeNull();
    const restore = win().querySelector<HTMLButtonElement>('[aria-label="restore"]');
    act(() => restore?.click());
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
  });

  it('moves when the title bar is dragged, clamped to stay on-screen', () => {
    render(
      <FloatingWindow title="X" defaultWidth={400} defaultHeight={300}>
        <p>body</p>
      </FloatingWindow>,
    );
    const el = win();
    const title = el.querySelector('.flwin__title')!;
    const left0 = parseInt(el.style.left, 10);
    const top0 = parseInt(el.style.top, 10);
    act(() => {
      pointer('pointerdown', title, 200, 200);
      pointer('pointermove', window, 140, 230);
      pointer('pointerup', window, 140, 230);
    });
    expect(parseInt(el.style.left, 10)).toBe(left0 - 60);
    expect(parseInt(el.style.top, 10)).toBe(top0 + 30);
  });

  it('closes on Esc from the body but not from a text field', () => {
    const onClose = vi.fn();
    render(
      <FloatingWindow title="X" onClose={onClose} defaultWidth={400} defaultHeight={300}>
        <input data-testid="field" />
        <span data-testid="plain">plain</span>
      </FloatingWindow>,
    );
    const esc = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      container.querySelector('[data-testid="field"]')!.dispatchEvent(esc());
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      container.querySelector('[data-testid="plain"]')!.dispatchEvent(esc());
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('remembers geometry across remounts when given a persistKey', () => {
    function Harness() {
      const [n, setN] = useState(0);
      return (
        <>
          <button data-testid="remount" onClick={() => setN((x) => x + 1)} />
          <FloatingWindow key={n} title="P" persistKey="test-key" defaultWidth={400} defaultHeight={300}>
            <p>body</p>
          </FloatingWindow>
        </>
      );
    }
    try {
      window.localStorage.removeItem('flwin:test-key');
    } catch {
      return; // no storage in this environment — skip
    }
    render(<Harness />);
    const title = win().querySelector('.flwin__title')!;
    act(() => {
      pointer('pointerdown', title, 200, 200);
      pointer('pointermove', window, 170, 170);
      pointer('pointerup', window, 170, 170);
    });
    const movedLeft = win().style.left;
    // Remount the window: persisted geometry should be restored.
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="remount"]')!.click());
    expect(win().style.left).toBe(movedLeft);
  });
});
