/**
 * Wave 8 — the two Scene Panel gestures that had never been driven.
 *
 * `scene_bin_gui.py:150` says "double-click a row to load it into the
 * Workspace", i.e. `cmd.scene(name,'recall')`, and `:360-377` renames through
 * an inline cell editor that REJECTS blanks and names containing spaces by
 * silently reverting. Both were built and neither had ever been clicked, so
 * this drives them as real DOM events:
 *
 *   double-click a row            -> cmd.scene(name, 'recall')
 *   double-click the name button  -> the inline editor
 *   Enter                         -> cmd.scene(name, 'rename', new_key=...)
 *   Enter on 'a b' / ''           -> NO call, and a visible reason
 *   Escape                        -> no call, editor closed
 *
 * The session is mocked at `useSession`, so what is asserted is the exact
 * `PanelAction` the panel hands the bridge.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneRecord, ScenePanelPayload } from '@tenmol/protocol/topics/movie';

import { ScenePanel } from './ScenePanel';

interface Call {
  fn: string;
  args: readonly unknown[];
  kwargs?: Record<string, unknown>;
  echo?: string;
}

const acted: Call[] = [];
const called: Call[] = [];

let payload: ScenePanelPayload = { scenes: [], current: null, order: [] };
/** Engine-side settings the panel reads back with `cmd.get_setting_boolean`. */
const settings: Record<string, boolean> = { scene_buttons: true };

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = [], kwargs = {}) => {
    called.push({ fn, args, kwargs: kwargs as Record<string, unknown> });
    if (fn === 'cmd.get_scene_panel') return payload;
    if (fn === 'cmd.get_scene_thumbnail_png') return { name: '', ready: false, data: null };
    if (fn === 'cmd.get_movie_status') return { frame: 1 };
    if (fn === 'cmd.get_setting_boolean') return settings[String(args[0])] ?? false;
    return null;
  }),
  act: vi.fn(async (action: Call) => {
    acted.push(action);
  }),
  run: vi.fn(async () => {}),
  stores: { feedback: { appendClient: vi.fn() } },
};

vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function scene(name: string, current = false): SceneRecord {
  return { name, message: '', storemask: 63, stores: ['view'], current };
}

beforeEach(() => {
  acted.length = 0;
  called.length = 0;
  settings.scene_buttons = true;
  payload = {
    order: ['alpha', 'beta'],
    current: 'alpha',
    scenes: [scene('alpha', true), scene('beta')],
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<ScenePanel />);
  });
  // One more tick for the thumbnail effect's promises.
  await act(async () => {});
}

function rows(): HTMLElement[] {
  return [...container.querySelectorAll('.scrow')] as HTMLElement[];
}

function fire(node: Element, type: string, init: MouseEventInit = {}): void {
  act(() => {
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

describe('double-click to recall', () => {
  it('sends cmd.scene(name, recall) for the row that was double-clicked', async () => {
    await render();
    expect(rows()).toHaveLength(2);

    fire(rows()[1]!, 'dblclick');
    const recalls = acted.filter((a) => a.fn === 'cmd.scene');
    expect(recalls).toHaveLength(1);
    expect(recalls[0]?.args).toEqual(['beta', 'recall']);
    // `animate=-1` is the API default (`viewing.py:1034`) and is sent
    // explicitly, so the echoed line reproduces exactly what ran.
    expect(recalls[0]?.echo).toBe('cmd.scene("beta", "recall", animate=-1)');
  });

  it('does not recall on a single click — that only selects', async () => {
    await render();
    fire(rows()[1]!, 'click');
    expect(acted.filter((a) => a.fn === 'cmd.scene')).toEqual([]);
    expect(rows()[1]?.className).toContain('is-selected');
  });
});

describe('committing a rename through the inline editor', () => {
  async function openEditor(index: number) {
    await render();
    const name = rows()[index]?.querySelector('.scrow__name');
    if (!name) throw new Error('no name button');
    fire(name, 'dblclick');
    const input = rows()[index]?.querySelector('.scrow__rename') as HTMLInputElement | null;
    if (!input) throw new Error('editor did not open');
    return input;
  }

  function type(input: HTMLInputElement, value: string) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function key(input: HTMLInputElement, name: string) {
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    });
  }

  it('Enter renames, with new_key and the full old name', async () => {
    const input = await openEditor(1);
    expect(input.value).toBe('beta');
    type(input, 'gamma');
    key(input, 'Enter');

    const renames = acted.filter((a) => a.fn === 'cmd.scene');
    expect(renames).toHaveLength(1);
    expect(renames[0]?.args).toEqual(['beta', 'rename']);
    expect(renames[0]?.kwargs).toEqual({ new_key: 'gamma' });
    // The editor closed.
    expect(rows()[1]?.querySelector('.scrow__rename')).toBeNull();
  });

  it('rejects a name with a space and says why, without calling the bridge', async () => {
    const input = await openEditor(1);
    type(input, 'a b');
    key(input, 'Enter');

    expect(acted.filter((a) => a.fn === 'cmd.scene')).toEqual([]);
    const error = rows()[1]?.querySelector('.scrow__renameerr');
    expect(error?.textContent ?? '').toMatch(/space/i);
    // Still editing: upstream reverts the cell silently, this keeps it open.
    expect(rows()[1]?.querySelector('.scrow__rename')).not.toBeNull();
  });

  it('rejects a blank name and a duplicate of an existing one', async () => {
    let input = await openEditor(1);
    type(input, '   ');
    key(input, 'Enter');
    expect(acted.filter((a) => a.fn === 'cmd.scene')).toEqual([]);

    input = rows()[1]?.querySelector('.scrow__rename') as HTMLInputElement;
    type(input, 'alpha');
    key(input, 'Enter');
    expect(acted.filter((a) => a.fn === 'cmd.scene')).toEqual([]);
    expect(rows()[1]?.querySelector('.scrow__renameerr')?.textContent ?? '').toMatch(/exist/i);
  });

  it('renaming to the same name closes the editor and sends nothing', async () => {
    const input = await openEditor(1);
    key(input, 'Enter');
    expect(acted.filter((a) => a.fn === 'cmd.scene')).toEqual([]);
    expect(rows()[1]?.querySelector('.scrow__rename')).toBeNull();
  });

  it('Escape abandons the edit', async () => {
    const input = await openEditor(1);
    type(input, 'gamma');
    key(input, 'Escape');
    expect(acted.filter((a) => a.fn === 'cmd.scene')).toEqual([]);
    expect(rows()[1]?.querySelector('.scrow__rename')).toBeNull();
    expect(rows()[1]?.querySelector('.scrow__name')?.textContent).toBe('beta');
  });
});

describe('the Scene menu items that had never been clicked', () => {
  function button(text: string): HTMLElement {
    const node = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    if (!node) throw new Error(`no button labelled ${text}`);
    return node as HTMLElement;
  }

  async function click(text: string) {
    await act(async () => {
      button(text).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
  }

  it('Cache > enable/optimize/read_only/disable each send cmd.cache', async () => {
    await render();
    await click('Cache…');
    for (const mode of ['enable', 'optimize', 'read_only', 'disable']) {
      await click(mode);
    }
    const cache = acted.filter((a) => a.fn === 'cmd.cache');
    expect(cache.map((a) => a.args[0])).toEqual(['enable', 'optimize', 'read_only', 'disable']);
    expect(cache[0]?.echo).toBe('cmd.cache("enable")');
  });

  it('the Buttons checkbox writes scene_buttons and hides the overlay', async () => {
    settings.scene_buttons = true;
    await render();
    expect(container.querySelector('.scbar')).not.toBeNull();

    const check = container.querySelector('.scmenu__check input') as HTMLInputElement;
    expect(check.checked).toBe(true);
    settings.scene_buttons = false;
    await act(async () => {
      check.click();
    });
    await act(async () => {});

    const sets = acted.filter((a) => a.fn === 'cmd.set');
    expect(sets).toHaveLength(1);
    expect(sets[0]?.args).toEqual(['scene_buttons', 0]);
    expect(sets[0]?.echo).toBe("cmd.set('scene_buttons', 0)");
    // `SceneDrawButtons` is gated on the same setting, so the overlay goes.
    expect(container.querySelector('.scbar')).toBeNull();
  });

  it('turns it back on from the unchecked state', async () => {
    settings.scene_buttons = false;
    await render();
    expect(container.querySelector('.scbar')).toBeNull();
    const check = container.querySelector('.scmenu__check input') as HTMLInputElement;
    expect(check.checked).toBe(false);

    settings.scene_buttons = true;
    await act(async () => {
      check.click();
    });
    await act(async () => {});
    expect(acted.filter((a) => a.fn === 'cmd.set')[0]?.args).toEqual(['scene_buttons', 1]);
    expect(container.querySelector('.scbar')).not.toBeNull();
  });
});

describe('the scene BUTTONS overlay — drag to reorder', () => {
  function buttons(): HTMLElement[] {
    return [...container.querySelectorAll('.scbar__btn')] as HTMLElement[];
  }

  function mouse(node: Element, type: string, init: MouseEventInit = {}): void {
    act(() => {
      node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
    });
  }

  /*
   * CORRECTED IN WAVE 10, and worth saying why rather than quietly editing.
   *
   * This test used to press the LEFT button on one row and release on another
   * and expect a `scene_order`. That is not what PyMOL does:
   * `SceneClickSceneButton` (`layer1/SceneMouse.cpp:186-218`) gives the left
   * button `PressMode = 1`, whose only outcome is a recall on a release over
   * the SAME button, and `SceneRelease` case 1 checks `I->Over == I->Pressed`.
   * Reordering is the RIGHT button (`PressMode = 3` promoted to 4 by
   * `SceneDrag`), and it is emitted per row crossed, not on release.
   *
   * The old assertion was pinning the panel's own invention. The full machine
   * is driven in `p10sceneBar.dom.test.tsx`; what stays here is the pair of
   * claims this file was really making — a left drag does NOT reorder, and a
   * right drag does.
   */
  it('a LEFT press released on another button does nothing at all', async () => {
    await render();
    const [alpha, beta] = buttons();
    expect(alpha?.textContent).toBe('alpha');

    mouse(alpha!, 'mousedown', { button: 0 });
    mouse(beta!, 'mouseup', { button: 0 });

    expect(acted.filter((a) => a.fn === 'cmd.scene_order')).toEqual([]);
    expect(acted.filter((a) => a.fn === 'cmd.scene')).toEqual([]);
  });

  it('a RIGHT press dragged onto another button reorders, and does not recall', async () => {
    await render();
    const [alpha, beta] = buttons();

    mouse(alpha!, 'mousedown', { button: 2 });
    // React synthesises `onMouseEnter` from the delegated `mouseover`; a
    // native `mouseenter` reaches no handler at all.
    mouse(beta!, 'mouseover');
    mouse(beta!, 'mouseup', { button: 2 });

    const orders = acted.filter((a) => a.fn === 'cmd.scene_order');
    expect(orders).toHaveLength(1);
    // alpha (0) dragged onto beta (1): `elem - 1` is alpha itself, which is
    // `>= pressed`, so the anchor becomes beta — `cmd.scene_order([beta, alpha])`.
    expect(orders[0]?.args).toEqual(['beta alpha']);
    expect(acted.filter((a) => a.fn === 'cmd.scene')).toEqual([]);
  });

  it('press and release on the same button is a recall, not a reorder', async () => {
    await render();
    const [, beta] = buttons();
    mouse(beta!, 'mousedown', { button: 0 });
    mouse(beta!, 'mouseup', { button: 0 });

    expect(acted.filter((a) => a.fn === 'cmd.scene_order')).toEqual([]);
    expect(acted.filter((a) => a.fn === 'cmd.scene')[0]?.args).toEqual(['beta', 'recall']);
  });

  it('middle press browses, and dragging across browses again (animate=0 with Ctrl)', async () => {
    await render();
    const [alpha, beta] = buttons();
    // `alpha` is the CURRENT scene here, and `SceneMouse.cpp:200-205` guards
    // the browse with `cur_name && elem.name != cur_name` — so the press that
    // browses has to be the press on `beta`. (This test used to press `alpha`
    // and expect a recall of the scene already loaded.)
    mouse(beta!, 'mousedown', { button: 1, ctrlKey: true });
    const recalls = acted.filter((a) => a.fn === 'cmd.scene');
    expect(recalls[0]?.args).toEqual(['beta', 'recall']);
    expect(recalls[0]?.kwargs).toEqual({ animate: 0 });

    // Dragging back across `alpha`, which IS current, browses nothing.
    mouse(alpha!, 'mouseover', { ctrlKey: true });
    expect(acted.filter((a) => a.fn === 'cmd.scene')).toHaveLength(1);
  });
});
