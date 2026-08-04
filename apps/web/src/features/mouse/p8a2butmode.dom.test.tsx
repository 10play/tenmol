/**
 * Wave 8 — the three ButMode behaviours the inventory listed as unverified:
 * right-click opening `mouse_config`, REVERSE cycling (Shift / right button /
 * wheel-back), and the `mouse_grid` matrix toggle.
 *
 * All three come straight out of `CButMode::click` (`packages/engine/layer1/ButMode.cpp:149-
 * 188`), and one of them was WRONG before this test existed: the `dy < 2`
 * branch — the bottom two lines — has no right-button case at all, so a right
 * click there cycles the selection level BACKWARD. The component opened the
 * `mouse_config` menu instead, which only the `else` branch does.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext, type Session } from '../../app';
import { ButModeBlock } from './ButModeBlock';
import { PopupMenu } from '../pymol-menu/PopupMenu';
import { pymolMenu } from '../pymol-menu/menuStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let acted: Array<{ fn: string; args: readonly unknown[]; echo?: string }>;
let settings: Record<string, string | number>;

function makeSession(): Session {
  return {
    conn: { isOpen: true } as unknown as Session['conn'],
    run: vi.fn(async () => undefined),
    act: vi.fn(async (action: { fn: string; args: readonly unknown[]; echo?: string }) => {
      acted.push(action);
    }),
    call: vi.fn(async (fn: string, args: readonly unknown[] = []) => {
      const key = String(args[0]);
      if (fn === 'get_setting_text') return settings[key] ?? '';
      return settings[key] ?? 0;
    }),
  } as unknown as Session;
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <SessionContext.Provider value={makeSession()}>
        <ButModeBlock />
        <PopupMenu />
      </SessionContext.Provider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  acted = [];
  settings = {
    button_mode_name: '3-Button Viewing',
    button_mode: 2,
    mouse_selection_mode: 1,
    mouse_grid: 0,
  };
  pymolMenu.close();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const modeLine = () => container.querySelector<HTMLElement>('[data-testid="butmode-mode"]')!;
const seleLine = () => container.querySelector<HTMLElement>('[data-testid="butmode-selection"]')!;

function mouseDown(el: HTMLElement, init: MouseEventInit): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init }));
  });
}

const actions = () => acted.map((a) => a.args[0]);

describe('cycling direction (ButMode.cpp:158-162)', () => {
  it('a plain left click on the mode line goes FORWARD', async () => {
    await mount();
    mouseDown(modeLine(), { button: 0 });
    expect(actions()).toEqual(['forward']);
    expect(acted[0]?.echo).toBe("cmd.mouse('forward')");
  });

  it('Shift inverts it', async () => {
    await mount();
    mouseDown(modeLine(), { button: 0, shiftKey: true });
    expect(actions()).toEqual(['backward']);
  });

  it('the right button inverts it — and opens mouse_config INSTEAD of cycling', async () => {
    await mount();
    mouseDown(modeLine(), { button: 2 });
    // `else { if(button == RIGHT) MenuActivate0Arg(..., "mouse_config") }`
    expect(actions()).toEqual([]);
    expect(container.querySelector('[data-testid="pymol-menu"]')).not.toBeNull();
    expect(container.textContent).toContain('3-Button Motions');
  });

  it('a wheel notch backward reverses, forward does not', async () => {
    await mount();
    const block = container.querySelector<HTMLElement>('[data-testid="butmode"]')!;
    act(() => {
      block.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    });
    expect(actions()).toEqual(['backward']);
    act(() => {
      block.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    });
    expect(actions()).toEqual(['backward', 'forward']);
  });

  it('Shift AND wheel-back cancel out — each inversion is independent', async () => {
    await mount();
    const block = container.querySelector<HTMLElement>('[data-testid="butmode"]')!;
    act(() => {
      block.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, shiftKey: true, bubbles: true }));
    });
    expect(actions()).toEqual(['forward']);
  });
});

describe('the selection line (ButMode.cpp:163-173)', () => {
  it('left cycles select_forward', async () => {
    await mount();
    mouseDown(seleLine(), { button: 0 });
    expect(actions()).toEqual(['select_forward']);
  });

  it('right cycles select_BACKWARD and does NOT open mouse_config', async () => {
    await mount();
    mouseDown(seleLine(), { button: 2 });
    expect(actions()).toEqual(['select_backward']);
    expect(container.querySelector('[data-testid="pymol-menu"]')).toBeNull();
  });

  it('Shift cycles backward too', async () => {
    await mount();
    mouseDown(seleLine(), { button: 0, shiftKey: true });
    expect(actions()).toEqual(['select_backward']);
  });

  it('one right click is ONE cycle, not two (mousedown + contextmenu)', async () => {
    await mount();
    mouseDown(seleLine(), { button: 2 });
    act(() => {
      seleLine().dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
      );
    });
    expect(actions()).toEqual(['select_backward']);
  });

  it('does not cycle at all while single-left is bound to PkAt', async () => {
    settings.button_mode_name = '3-Button Editing';
    await mount();
    expect(container.textContent).toContain('Picking');
    mouseDown(seleLine(), { button: 0 });
    expect(actions()).toEqual([]);
  });
});

describe('the mouse_grid matrix', () => {
  it('is absent with mouse_grid 0 and present with mouse_grid 1', async () => {
    await mount();
    expect(container.querySelector('[data-testid="butmode-grid"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    settings.mouse_grid = 1;
    await mount();

    const grid = container.querySelector<HTMLElement>('[data-testid="butmode-grid"]');
    expect(grid).not.toBeNull();
    const rows = [...grid!.querySelectorAll('.butmode__row')].map((el) =>
      [...el.children].map((cell) => cell.textContent?.trim()),
    );
    // `Buttons L M R Wheel` then the six rows of 5-char codes for
    // 3-Button Viewing (`packages/engine/modules/pymol/controlling.py:mode_dict`).
    expect(rows[0]).toEqual(['Buttons', 'L', 'M', 'R', 'Wheel']);
    expect(rows[1]).toEqual(['& Keys', 'Rota', 'Move', 'MovZ', 'Slab']);
    expect(rows[2]).toEqual(['Shft', '+Box', '-Box', 'Clip', 'MovS']);
  });

  it('clicking the grid cycles the ring, like every line above the last two', async () => {
    settings.mouse_grid = 1;
    await mount();
    const grid = container.querySelector<HTMLElement>('[data-testid="butmode-grid"]')!;
    mouseDown(grid, { button: 0 });
    expect(actions()).toEqual(['forward']);
  });
});
