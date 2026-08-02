/**
 * The pop-up host, driven by the REAL `pymol.menu.mouse_config()` payload.
 *
 * The rows are not hand-written here: they come from
 * `MOUSE_CONFIG_MENU`, which `packages/viewport/src/input/modes.test.ts` diffs
 * against `packages/engine/modules/pymol/menu.py` in this tree. So this test is checking the
 * rendering and the dispatch, and the other test is checking the data.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOUSE_CONFIG_MENU } from '../mouse/tables';

import { SessionContext } from '../../app';
import type { Session } from '../../app';
import { PopupMenu } from './PopupMenu';
import { pymolMenu } from './menuStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const run = vi.fn(async () => undefined);

function mount(): void {
  act(() => {
    root.render(
      <SessionContext.Provider value={{ run } as unknown as Session}>
        <PopupMenu />
      </SessionContext.Provider>,
    );
  });
}

beforeEach(() => {
  run.mockClear();
  pymolMenu.close();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const rows = MOUSE_CONFIG_MENU.map((item) => [item.kind, item.label, item.command] as const);

describe('PopupMenu', () => {
  it('renders nothing until a menu is opened', () => {
    mount();
    expect(container.querySelector('[data-testid="pymol-menu"]')).toBeNull();
  });

  it('renders the nine mouse_config entries with the separator in place', () => {
    mount();
    act(() => pymolMenu.openAt(100, 100, rows, 'Mouse Config'));
    const menu = container.querySelector('[data-testid="pymol-menu"]');
    expect(menu).not.toBeNull();
    const labels = [...(menu as HTMLElement).children].map((node) =>
      node.className.includes('sep') ? '---' : node.textContent,
    );
    expect(labels).toEqual([
      'Mouse Config',
      '3-Button Motions',
      '3-Button Editing',
      '3-Button Viewing',
      '3-Button Lights',
      '3-Button All Modes',
      '---',
      '2-Button Editing',
      '2-Button Viewing',
      '2-Button Lights',
    ]);
    // A separator is not clickable (packages/engine/layer4/PopUp.cpp:270-300).
    expect((menu as HTMLElement).querySelectorAll('button')).toHaveLength(8);
  });

  it('executes the leaf command string verbatim and closes', () => {
    mount();
    act(() => pymolMenu.openAt(10, 10, rows));
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === '3-Button All Modes',
    );
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(run).toHaveBeenCalledWith('cmd.config_mouse("three_button_all_modes")');
    expect(container.querySelector('[data-testid="pymol-menu"]')).toBeNull();
  });

  it('closes on Escape and on a click outside', () => {
    mount();
    act(() => pymolMenu.openAt(10, 10, rows));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('[data-testid="pymol-menu"]')).toBeNull();

    act(() => pymolMenu.openAt(10, 10, rows));
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="pymol-menu"]')).toBeNull();

    // A mousedown with no Element target (dispatched at `window`) must close
    // it too, and must not throw inside Node.contains.
    act(() => pymolMenu.openAt(10, 10, rows));
    act(() => {
      window.dispatchEvent(new MouseEvent('mousedown'));
    });
    expect(container.querySelector('[data-testid="pymol-menu"]')).toBeNull();
  });

  it('keeps exactly one pop-up: opening a second replaces the first', () => {
    mount();
    act(() => pymolMenu.openAt(10, 10, rows, 'first'));
    act(() => pymolMenu.openAt(20, 20, [[1, 'only', 'cmd.nothing()']], 'second'));
    expect(container.querySelectorAll('[data-testid="pymol-menu"]')).toHaveLength(1);
    expect(container.textContent).toContain('second');
    expect(container.textContent).not.toContain('3-Button Motions');
  });
});
