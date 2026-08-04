/**
 * Row 106, the last three unverified gestures of the scene-button strip.
 *
 * Wave 9 ported `SceneDrawButtons`' geometry and wave 9's tests pin it. What no
 * test had ever driven — and what the panel got WRONG — is the mouse machine
 * around it (`packages/engine/layer1/SceneMouse.cpp:178`, `:1076`, `:1233`):
 *
 *   left    recall on RELEASE, and only if the release is over the same button
 *   middle  recall on the PRESS and on every button dragged across (Ctrl = 0)
 *   right   DRAG to reorder; released without moving, `pymol.menu.scene_menu`
 *
 * The strip used to start its drag on the LEFT button and answer the right one
 * with a rename/update/delete popup written in the panel. Both buttons did the
 * other's job and the menu was invented rather than fetched.
 *
 * Every `cmd.scene_order` asserted here is the literal string PyMOL's own drag
 * would have PParse'd (`SceneMouse.cpp:1287-1291`), including the
 * `location='top'` special case for the first slot.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneRecord, ScenePanelPayload } from '@tenmol/protocol/topics/movie';

import { ScenePanel } from './ScenePanel';
import { dragOrder, encodeMenu, sceneActions } from './sceneActions';

interface Call {
  fn: string;
  args: readonly unknown[];
  kwargs?: Record<string, unknown>;
  echo?: string;
}

const acted: Call[] = [];
const called: Call[] = [];
const ran: string[] = [];

let payload: ScenePanelPayload = { scenes: [], current: null, order: [] };
const settings: Record<string, boolean> = { scene_buttons: true };
const ints: Record<string, number> = { internal_gui_control_size: 18, display_scale_factor: 1 };
let viewport: [number, number] = [800, 600];

/** `pymol.menu.scene_menu(None, 'beta')`, verbatim from `menu.py:1842-1849`. */
const SCENE_MENU = [
  [2, 'Scene beta', ''],
  [1, 'rename', 'cmd.wizard("renaming","beta",mode="scene")'],
  [0, '', ''],
  [1, 'update', 'cmd.scene("beta","update")'],
  [0, '', ''],
  [1, '\\933delete', 'cmd.scene("beta","delete")'],
];

let menuFails = false;

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    called.push({ fn, args });
    if (fn === 'cmd.get_scene_panel') return payload;
    if (fn === 'cmd.get_scene_thumbnail_png') return { name: '', ready: false, data: null };
    if (fn === 'cmd.get_movie_status') return { frame: 1 };
    if (fn === 'cmd.get_setting_boolean') return settings[String(args[0])] ?? false;
    if (fn === 'cmd.get_setting_int') return ints[String(args[0])] ?? 0;
    if (fn === 'cmd.get_viewport') return viewport;
    if (fn === 'menu.scene_menu') {
      if (menuFails) throw new Error('NotAllowed: menu.scene_menu');
      return SCENE_MENU;
    }
    return null;
  }),
  act: vi.fn(async (action: Call) => {
    acted.push(action);
  }),
  run: vi.fn(async (line: string) => {
    ran.push(line);
  }),
  stores: { feedback: { appendClient: vi.fn() } },
};

vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function scene(name: string, current = false): SceneRecord {
  return { name, message: '', storemask: 63, stores: ['view'], current };
}

function withScenes(names: string[], current = names[0] ?? null): void {
  payload = {
    order: names,
    current,
    scenes: names.map((name) => scene(name, name === current)),
  };
}

beforeEach(() => {
  acted.length = 0;
  called.length = 0;
  ran.length = 0;
  menuFails = false;
  settings.scene_buttons = true;
  ints.internal_gui_control_size = 18;
  ints.display_scale_factor = 1;
  viewport = [800, 600];
  withScenes(['alpha', 'beta', 'gamma', 'delta']);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(<ScenePanel />);
  });
  await act(async () => {});
  await act(async () => {});
}

const btns = () => [...container.querySelectorAll('.scbar__btn')] as HTMLElement[];
const at = (name: string) => {
  const found = btns().find((b) => b.dataset.fullName === name);
  if (!found) throw new Error(`no strip button for ${name}`);
  return found;
};

function mouse(el: HTMLElement, type: 'mousedown' | 'mouseup', init: MouseEventInit = {}) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
  });
}

/**
 * `onMouseEnter`, the way React actually produces it.
 *
 * A native `mouseenter` DOES NOT reach a React handler: React has no listener
 * for it and synthesises enter/leave from the delegated `mouseover`/`mouseout`
 * pair (`EnterLeaveEventPlugin`). Dispatching `mouseenter` in a test is a
 * no-op that looks like a passing gesture — six assertions here were green
 * against a strip that had received nothing at all.
 *
 * `relatedTarget` is left NULL on purpose too: with a related target that is
 * itself inside a React root, `EnterLeaveEventPlugin` returns early from the
 * `mouseover` and waits for the matching `mouseout` to do the work. Two of
 * these tests passed their first hover and silently dropped every one after it.
 */
function enter(el: HTMLElement, init: MouseEventInit = {}) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ...init }));
  });
}

/** Only the scene writes; the panel also polls, and polls are not gestures. */
const writes = () => acted.filter((a) => a.fn === 'cmd.scene' || a.fn === 'cmd.scene_order');

describe('dragOrder — SceneMouse.cpp:1274-1298 as arithmetic', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('sends location=top when the pointer is over the first slot', () => {
    expect(dragOrder(order, 2, 0)).toMatchObject({
      fn: 'cmd.scene_order',
      args: ['c'],
      kwargs: { location: 'top' },
    });
  });

  it('anchors on the row ABOVE the pointer when dragging up', () => {
    // c dragged onto b: first = elem-1 = a, second = c -> [a, c] puts c after a.
    expect(dragOrder(order, 2, 1)).toMatchObject({ args: ['a c'] });
  });

  it('anchors on the row UNDER the pointer when dragging down', () => {
    // a dragged onto c: elem-1 = b >= pressed(a), so first = elem = c -> [c, a].
    expect(dragOrder(order, 0, 2)).toMatchObject({ args: ['c a'] });
    // The adjacent case, where elem-1 IS the pressed row.
    expect(dragOrder(order, 0, 1)).toMatchObject({ args: ['b a'] });
  });

  it('sends nothing for the same row or an index off the list', () => {
    expect(dragOrder(order, 1, 1)).toBeNull();
    expect(dragOrder(order, 1, 9)).toBeNull();
    expect(dragOrder(order, 9, 1)).toBeNull();
  });
});

describe('encodeMenu', () => {
  it('turns menu.py rows into popup nodes and keeps the colour escape', () => {
    const nodes = encodeMenu(SCENE_MENU);
    expect(nodes).toHaveLength(6);
    expect(nodes[0]).toEqual({ code: 2, text: 'Scene beta', path: [0], command: '' });
    expect(nodes[3]).toEqual({
      code: 1,
      text: 'update',
      path: [3],
      command: 'cmd.scene("beta","update")',
    });
    expect(nodes[5]?.text).toBe('\\933delete');
  });

  it('drops anything that is not [code, text, command] rather than guessing', () => {
    expect(encodeMenu(null)).toEqual([]);
    expect(encodeMenu([[7, 'weird', '']])).toEqual([]);
    expect(encodeMenu([['nope'], [1, 'ok', 'cmd.x()']])).toEqual([
      { code: 1, text: 'ok', path: [1], command: 'cmd.x()' },
    ]);
  });
});

describe('left button', () => {
  it('recalls on the RELEASE, not the press', async () => {
    await render();
    mouse(at('beta'), 'mousedown', { button: 0 });
    expect(writes()).toHaveLength(0);
    mouse(at('beta'), 'mouseup', { button: 0 });
    expect(writes()).toEqual([
      expect.objectContaining({ fn: 'cmd.scene', args: ['beta', 'recall'] }),
    ]);
  });

  it('recalls NOTHING when the release lands on a different button', async () => {
    await render();
    mouse(at('beta'), 'mousedown', { button: 0 });
    enter(at('delta'), {});
    mouse(at('delta'), 'mouseup', { button: 0 });
    expect(writes()).toEqual([]);
  });

  it('never reorders — dragging is the RIGHT button', async () => {
    await render();
    mouse(at('delta'), 'mousedown', { button: 0 });
    enter(at('alpha'), {});
    mouse(at('alpha'), 'mouseup', { button: 0 });
    expect(acted.filter((a) => a.fn === 'cmd.scene_order')).toEqual([]);
  });
});

describe('middle button — rapid browse', () => {
  it('recalls on the press and again on each button crossed', async () => {
    await render();
    mouse(at('beta'), 'mousedown', { button: 1 });
    expect(writes()).toEqual([
      expect.objectContaining({ args: ['beta', 'recall'], kwargs: { animate: -1 } }),
    ]);
    enter(at('gamma'), {});
    enter(at('delta'), {});
    expect(writes().map((a) => a.args[0])).toEqual(['beta', 'gamma', 'delta']);
  });

  it('forces animate=0 with Ctrl held', async () => {
    await render();
    mouse(at('beta'), 'mousedown', { button: 1, ctrlKey: true });
    enter(at('gamma'), { ctrlKey: true });
    expect(writes().map((a) => a.kwargs?.['animate'])).toEqual([0, 0]);
  });

  it('does not recall the scene that is already current', async () => {
    withScenes(['alpha', 'beta', 'gamma', 'delta'], 'beta');
    await render();
    mouse(at('beta'), 'mousedown', { button: 1 });
    expect(writes()).toEqual([]);
    // ...and the release is guarded the same way (`SceneRelease` case 2).
    mouse(at('beta'), 'mouseup', { button: 1 });
    expect(writes()).toEqual([]);
  });

  it('never promotes to a drag — the C falls through with Pressed == Over', async () => {
    await render();
    mouse(at('alpha'), 'mousedown', { button: 1 });
    enter(at('gamma'), {});
    expect(acted.filter((a) => a.fn === 'cmd.scene_order')).toEqual([]);
  });
});

describe('right button — drag to reorder', () => {
  it('emits one scene_order per row crossed, chaining from the new position', async () => {
    await render();
    mouse(at('delta'), 'mousedown', { button: 2 });
    expect(writes()).toEqual([]);
    // delta (3) dragged up onto gamma (2): anchor is the row above gamma.
    enter(at('gamma'), {});
    expect(acted.at(-1)).toMatchObject({ fn: 'cmd.scene_order', args: ['beta delta'] });
    // The engine's answer arrives on the next poll; the machine has already
    // moved its `Pressed` to 2, so the next hover is computed from there.
    withScenes(['alpha', 'beta', 'delta', 'gamma'], 'alpha');
    await act(async () => {});
    enter(at('beta'), {});
    expect(acted.at(-1)).toMatchObject({ fn: 'cmd.scene_order', args: ['alpha delta'] });
  });

  it('sends location=top on the first slot', async () => {
    await render();
    mouse(at('gamma'), 'mousedown', { button: 2 });
    enter(at('alpha'), {});
    expect(acted.at(-1)).toMatchObject({
      fn: 'cmd.scene_order',
      args: ['gamma'],
      kwargs: { location: 'top' },
    });
    expect(acted.at(-1)?.echo).toBe('cmd.scene_order("gamma", location="top")');
  });

  it('recalls nothing while reordering', async () => {
    await render();
    mouse(at('delta'), 'mousedown', { button: 2 });
    enter(at('alpha'), {});
    mouse(at('alpha'), 'mouseup', { button: 2 });
    expect(acted.filter((a) => a.fn === 'cmd.scene')).toEqual([]);
    // A drag ends in NO menu: `I->Pressed == I->Over` is false by then.
    expect(container.querySelector('.rowmenu')).toBeNull();
  });

  it('forgets the press when the release lands off the strip', async () => {
    await render();
    mouse(at('delta'), 'mousedown', { button: 2 });
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    });
    enter(at('alpha'), {});
    expect(acted.filter((a) => a.fn === 'cmd.scene_order')).toEqual([]);
  });
});

describe('right button — the no-drag menu', () => {
  it('opens pymol.menu.scene_menu, fetched rather than written here', async () => {
    await render();
    mouse(at('beta'), 'mousedown', { button: 2 });
    await act(async () => {
      at('beta').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2 }));
    });
    await act(async () => {});

    expect(called.filter((c) => c.fn === 'menu.scene_menu').map((c) => c.args)).toEqual([
      [null, 'beta'],
    ]);
    const menu = container.querySelector('.rowmenu');
    expect(menu).not.toBeNull();
    const text = menu?.textContent ?? '';
    for (const label of ['rename', 'update', 'delete']) expect(text).toContain(label);
  });

  it('runs the leaf PyMOL wrote, as a command line', async () => {
    await render();
    mouse(at('beta'), 'mousedown', { button: 2 });
    await act(async () => {
      at('beta').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2 }));
    });
    await act(async () => {});

    const leaf = [...container.querySelectorAll('.rowmenu button, .rowmenu [role="menuitem"]')].find(
      (el) => el.textContent?.trim() === 'update',
    ) as HTMLElement | undefined;
    expect(leaf).toBeDefined();
    await act(async () => {
      leaf!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(ran).toContain('cmd.scene("beta","update")');
    expect(container.querySelector('.rowmenu')).toBeNull();
  });

  it('says so when the menu cannot be fetched instead of showing an empty box', async () => {
    menuFails = true;
    await render();
    mouse(at('beta'), 'mousedown', { button: 2 });
    await act(async () => {
      at('beta').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2 }));
    });
    await act(async () => {});
    expect(container.querySelector('.rowmenu')?.textContent).toContain('menu.scene_menu');
  });
});

describe('the strip honours the scroll window', () => {
  it('reorders by SCENE ORDER index, not by on-screen position', async () => {
    // A block three rows tall makes n_disp 2, so four scenes need a scrollbar.
    viewport = [800, 3 * 18];
    withScenes(['alpha', 'beta', 'gamma', 'delta']);
    await render();
    const strip = container.querySelector('.scbar') as HTMLElement;
    act(() => {
      strip.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    });
    // `beta` is now the FIRST button drawn but the SECOND scene.
    expect(btns().map((b) => b.dataset.fullName)).toEqual(['beta', 'gamma']);
    mouse(at('gamma'), 'mousedown', { button: 2 });
    enter(at('beta'), {});
    // Order index 1, not screen index 0: an `alpha gamma` anchor. Had the strip
    // used the on-screen position, `beta` would have been slot 0 and this would
    // read `location: top`.
    expect(acted.at(-1)).toMatchObject({ fn: 'cmd.scene_order', args: ['alpha gamma'] });
    expect(acted.at(-1)?.kwargs).toEqual({});
  });
});

describe('sceneActions.order still renders the echo PyMOL logs', () => {
  it('is a space-separated list with an optional location', () => {
    expect(sceneActions.order(['a', 'b']).echo).toBe('cmd.scene_order("a b")');
  });
});
