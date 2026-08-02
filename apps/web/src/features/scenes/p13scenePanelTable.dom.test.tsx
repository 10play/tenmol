/**
 * Wave 13 — the Scene PANEL table (rows 451/452/454), as opposed to the scene
 * BUTTON STRIP that `p10sceneBar.dom.test.tsx` already drives.
 *
 * The three rows all carried `†` citations, and the citations pointed at real
 * tests — for the wrong half of each row. Measured, with the whole
 * `features/scenes` + `features/movie` suite running (203 tests):
 *
 *   `onClick={() => void run(sceneActions.store('new'))}` -> `{}`   GREEN
 *   `onClick={() => void run(sceneActions.update(name))}` -> `{}`   GREEN
 *   `onClick={() => void run(sceneActions.clear(name))}`  -> `{}`   GREEN
 *   deleting the `scene_order` call out of `commitDrag`            GREEN
 *   never rendering the `<img>` at all                             GREEN
 *
 * `sceneActions.test.ts` proves the ACTION BUILDERS are right — mutating
 * `store` to `update` or the `scene_order` separator to a comma does go red —
 * and `test_movie.py` proves the engine end of `cmd.scene`/`scene_order`/
 * `get_scene_thumbnail`. Nothing connected the panel's controls to either. So
 * every button in the table was dead code as far as the suite was concerned.
 *
 * Everything below is a real DOM event on the real `<ScenePanel>`, with only
 * `useSession` doubled, so what is asserted is the exact `PanelAction` the
 * bridge would receive.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneRecord, ScenePanelPayload, SceneThumbnail } from '@tenmol/protocol/topics/movie';

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
/** Keyed by scene name; `null` stands for "the C call answered nothing". */
let thumbs: Record<string, SceneThumbnail | null> = {};
const settings: Record<string, boolean> = { scene_buttons: true };

/** A 1x1 PNG, base64 — enough for `src` to be asserted exactly. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function thumb(name: string, ready: boolean): SceneThumbnail {
  return {
    name,
    encoding: ready ? 'png' : 'rgba',
    width: 220,
    height: 124,
    // 220*124*4 — the raw buffer `SceneDeferImage` has not replaced yet.
    bytes: ready ? 96 : 109120,
    ready,
    data: ready ? PNG_B64 : '',
  };
}

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = [], kwargs = {}) => {
    called.push({ fn, args, kwargs: kwargs as Record<string, unknown> });
    if (fn === 'cmd.get_scene_panel') return payload;
    if (fn === 'cmd.get_scene_thumbnail_png') return thumbs[String(args[0])] ?? null;
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
  thumbs = {};
  payload = {
    order: ['alpha', 'beta', 'gamma'],
    current: 'alpha',
    scenes: [scene('alpha', true), scene('beta'), scene('gamma')],
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
  // The thumbnail effect is one promise deep, and it re-runs once `thumbs`
  // state lands, so two flushes.
  await act(async () => {});
  await act(async () => {});
}

const rows = (): HTMLElement[] => [...container.querySelectorAll('.scrow')] as HTMLElement[];
const scenes = () => acted.filter((a) => a.fn === 'cmd.scene');
const orders = () => acted.filter((a) => a.fn === 'cmd.scene_order');
const panelReads = () => called.filter((c) => c.fn === 'cmd.get_scene_panel');

function fire(node: Element | Window, type: string, init: MouseEventInit = {}): void {
  act(() => {
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error('nothing to click');
  act(() => {
    (node as HTMLElement).click();
  });
}

/** The `upd` / `del` button of a row, by its title (which names the call). */
function opButton(index: number, title: string): HTMLButtonElement {
  const found = rows()[index]?.querySelector(`.scrow__ops button[title="${title}"]`);
  if (!found) throw new Error(`row ${index} has no ${title} button`);
  return found as HTMLButtonElement;
}

/* ====================================================================== 451 */

describe('row 451 — the table: one row per scene, name plus preview', () => {
  it('renders a row per scene with a name and a preview cell', async () => {
    await render();
    expect(rows()).toHaveLength(3);
    for (const [index, name] of ['alpha', 'beta', 'gamma'].entries()) {
      expect(rows()[index]!.querySelector('.scrow__name')!.textContent).toBe(name);
      expect(rows()[index]!.querySelector('.scrow__thumb')).not.toBeNull();
    }
  });

  it('carries the instruction line scene_bin_gui.py:150 puts under the table', async () => {
    await render();
    const hint = container.querySelector('.scpanel__hint');
    expect(hint).not.toBeNull();
    // Upstream says "Double click selected thumbnail to load into Workspace.";
    // the two load-bearing facts are the gesture and the effect.
    expect(hint!.textContent!.toLowerCase()).toContain('double-click');
    expect(hint!.textContent!.toLowerCase()).toContain('recall');
  });

  it('asks the engine for a thumbnail once per scene name', async () => {
    await render();
    const asked = called
      .filter((c) => c.fn === 'cmd.get_scene_thumbnail_png')
      .map((c) => c.args[0]);
    expect(new Set(asked)).toEqual(new Set(['alpha', 'beta', 'gamma']));
  });

  it('draws the PNG the bridge returned, as a data: URL', async () => {
    thumbs = {
      alpha: thumb('alpha', true),
      beta: thumb('beta', true),
      gamma: thumb('gamma', true),
    };
    await render();

    const images = [...container.querySelectorAll('.scrow__thumb img')] as HTMLImageElement[];
    expect(images).toHaveLength(3);
    expect(images[0]!.getAttribute('src')).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(images[0]!.getAttribute('alt')).toBe('alpha preview');
    expect(container.querySelector('.scrow__nothumb')).toBeNull();
  });

  it('shows "no preview" — never a black rectangle — while the capture is deferred', async () => {
    // `MovieSceneStore` hands the buffer to `SceneDeferImage`
    // (`MovieScene.cpp:225-232`), so a read before the draw lands answers
    // 109,120 raw zero bytes with `ready:false`. Rendering those as an image
    // is a black box the user cannot tell from a broken scene.
    thumbs = {
      alpha: thumb('alpha', false),
      beta: thumb('beta', false),
      gamma: thumb('gamma', false),
    };
    await render();

    expect(container.querySelectorAll('.scrow__thumb img')).toHaveLength(0);
    expect(container.querySelectorAll('.scrow__nothumb')).toHaveLength(3);
  });

  it('mixes: the resolved scene shows its PNG and the pending one does not', async () => {
    thumbs = { alpha: thumb('alpha', true), beta: thumb('beta', false), gamma: null };
    await render();

    expect(rows()[0]!.querySelector('img')).not.toBeNull();
    expect(rows()[1]!.querySelector('img')).toBeNull();
    expect(rows()[2]!.querySelector('img')).toBeNull();
  });
});

/* ====================================================================== 452 */

describe('row 452 — Add / Update / Delete from the panel controls', () => {
  it('Add Scene sends cmd.scene("new","store",quiet=0) — append aliases to store', async () => {
    await render();
    click(container.querySelector('.scpanel__btn[title*="append"]'));

    expect(scenes()).toHaveLength(1);
    expect(scenes()[0]!.args).toEqual(['new', 'store']);
    expect(scenes()[0]!.kwargs).toEqual({ quiet: 0 });
  });

  it('Update sends cmd.scene(name,"update") for THAT row, not the current scene', async () => {
    await render();
    // Row 2 is `gamma`; the current scene is `alpha`. Sending the current name
    // would look right on the first row and be wrong on every other one.
    click(opButton(2, "cmd.scene(name,'update')"));

    expect(scenes()).toHaveLength(1);
    expect(scenes()[0]!.args).toEqual(['gamma', 'update']);
  });

  it('Delete sends cmd.scene(name,"clear"), the action that actually deletes', async () => {
    await render();
    click(opButton(1, "cmd.scene(name,'clear')"));

    expect(scenes()).toHaveLength(1);
    // `clear` is MovieSceneDelete; there is no `delete` action in
    // `viewing.py:1034`'s vocabulary, and an unknown action is a silent no-op.
    expect(scenes()[0]!.args).toEqual(['beta', 'clear']);
  });

  it('re-reads the scene list after every write, so the table cannot go stale', async () => {
    await render();
    const before = panelReads().length;

    click(opButton(0, "cmd.scene(name,'update')"));
    await act(async () => {});

    expect(panelReads().length).toBeGreaterThan(before);
  });

  it('the ‹ / › buttons walk the order with cmd.scene("","previous"/"next")', async () => {
    await render();
    click(container.querySelector('.scpanel__btn[title*="previous"]'));
    click(container.querySelector('.scpanel__btn[title*="next"]'));

    expect(scenes().map((a) => a.args)).toEqual([
      ['', 'previous'],
      ['', 'next'],
    ]);
  });
});

/* ====================================================================== 454 */

describe('row 454 — dragging a row handle reorders through cmd.scene_order', () => {
  const handle = (index: number) =>
    rows()[index]!.querySelector('.scrow__handle') as HTMLButtonElement;

  it('issues ONE scene_order for the whole gesture, with the full new order', async () => {
    await render();

    fire(handle(2), 'pointerdown');
    fire(rows()[1]!, 'pointerenter');
    fire(rows()[0]!, 'pointerenter');
    fire(rows()[0]!, 'pointerup');

    // Upstream polls the table and diffs positions; one gesture, one call.
    expect(orders()).toHaveLength(1);
    expect(orders()[0]!.args).toEqual(['gamma alpha beta']);
    expect(orders()[0]!.echo).toBe('cmd.scene_order("gamma alpha beta")');
  });

  it('dropping a row back on itself sends nothing', async () => {
    await render();

    fire(handle(1), 'pointerdown');
    fire(rows()[1]!, 'pointerup');

    expect(orders()).toEqual([]);
  });

  it('releasing off the list cancels: no order is sent and the drag ends', async () => {
    await render();

    fire(handle(2), 'pointerdown');
    fire(rows()[0]!, 'pointerenter');
    // A release that misses every row — the window-level cancel.
    fire(document.body, 'pointerup');
    expect(orders()).toEqual([]);

    // and the machine is disarmed: hovering a row afterwards reorders nothing.
    fire(rows()[0]!, 'pointerenter');
    fire(rows()[0]!, 'pointerup');
    expect(orders()).toEqual([]);
  });

  it('a drag that never entered another row still lands on the row it is released over', async () => {
    await render();

    fire(handle(0), 'pointerdown');
    fire(rows()[2]!, 'pointerup');

    expect(orders()).toHaveLength(1);
    expect(orders()[0]!.args).toEqual(['beta gamma alpha']);
  });

  it('ArrowUp / ArrowDown on the handle move the row one slot, for keyboard users', async () => {
    await render();

    act(() => {
      handle(2).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
      );
    });
    expect(orders()).toHaveLength(1);
    expect(orders()[0]!.args).toEqual(['alpha gamma beta']);

    act(() => {
      handle(0).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
      );
    });
    // Already at the top: clamped, so nothing more is sent.
    expect(orders()).toHaveLength(1);
  });
});
