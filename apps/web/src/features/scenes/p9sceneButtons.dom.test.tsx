/**
 * Row 333 — the ported geometry, in the panel.
 *
 * `p9sceneButtons.test.ts` pins the arithmetic; this drives the strip that uses
 * it, because a layout function nothing renders is not a scrollbar.
 *
 * The session is mocked, so `cmd.get_viewport` is what decides the block —
 * which is the point: PyMOL lays these buttons out in the SCENE's rect
 * (`Scene.cpp:2946-2990`), not in a CSS box, so the client asks the engine how
 * big that rect is instead of measuring a `<div>` that jsdom never lays out.
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
let payload: ScenePanelPayload = { scenes: [], current: null, order: [] };
const settings: Record<string, boolean> = { scene_buttons: true };
const ints: Record<string, number> = {
  internal_gui_control_size: 18,
  display_scale_factor: 1,
};
let viewport: [number, number] | null = [800, 600];

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (fn === 'cmd.get_scene_panel') return payload;
    if (fn === 'cmd.get_scene_thumbnail_png') return { name: '', ready: false, data: null };
    if (fn === 'cmd.get_movie_status') return { frame: 1 };
    if (fn === 'cmd.get_setting_boolean') return settings[String(args[0])] ?? false;
    if (fn === 'cmd.get_setting_int') return ints[String(args[0])] ?? 0;
    if (fn === 'cmd.get_viewport') return viewport;
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

function withScenes(names: string[]): void {
  payload = {
    order: names,
    current: names[0] ?? null,
    scenes: names.map((name, i) => scene(name, i === 0)),
  };
}

beforeEach(() => {
  acted.length = 0;
  settings.scene_buttons = true;
  ints.internal_gui_control_size = 18;
  ints.display_scale_factor = 1;
  viewport = [800, 600];
  withScenes(['alpha', 'beta']);
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

const strip = () => container.querySelector('.scbar') as HTMLElement;
const btns = () => [...container.querySelectorAll('.scbar__btn')] as HTMLElement[];

describe('the strip lays itself out with SceneDrawButtons` numbers', () => {
  it('sizes each button by its name at 8 dip per character', async () => {
    await render();
    expect(strip().classList.contains('scbar--laid')).toBe(true);
    // `alpha` is 5 characters: 5*8 + DIP2PIXEL(6).
    expect(btns()[0]?.style.width).toBe(`${5 * 8 + 6}px`);
    expect(btns()[1]?.style.width).toBe(`${4 * 8 + 6}px`);
    // One `internal_gui_control_size` row each, stacked.
    expect(btns()[0]?.style.height).toBe('18px');
    expect(Number.parseInt(btns()[1]!.style.top, 10) - Number.parseInt(btns()[0]!.style.top, 10)).toBe(
      18,
    );
  });

  it('follows internal_gui_control_size and display_scale_factor', async () => {
    ints.internal_gui_control_size = 30;
    ints.display_scale_factor = 2;
    await render();
    expect(btns()[0]?.style.height).toBe('60px');
    expect(btns()[0]?.style.width).toBe(`${5 * 16 + 12}px`);
  });

  it('cuts a long name to max_char and keeps the full one in the title', async () => {
    viewport = [8 * 12 + 5 + 17, 600]; // max_char = 12
    withScenes(['a_very_long_scene_name']);
    await render();
    expect(btns()[0]?.textContent).toBe('a_very_long_');
    expect(btns()[0]?.dataset.fullName).toBe('a_very_long_scene_name');
    expect(btns()[0]?.classList.contains('is-truncated')).toBe(true);
  });

  it('still recalls the FULL name it truncated', async () => {
    viewport = [8 * 6 + 5 + 17, 600];
    withScenes(['scene_number_one']);
    await render();
    const button = btns()[0]!;
    expect(button.textContent).not.toBe('scene_number_one');
    act(() => {
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    const recall = acted.find((a) => a.fn === 'cmd.scene');
    expect(recall?.args).toEqual(['scene_number_one', 'recall']);
  });
});

describe('the vertical scrollbar', () => {
  it('appears when the list is longer than n_disp and windows the strip', async () => {
    viewport = [800, 3 * 18]; // n_disp = 2
    withScenes(['a', 'b', 'c', 'd']);
    await render();

    const bar = container.querySelector('[role="scrollbar"]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe('13px');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    // Two of four rows drawn — the rest are behind the bar.
    expect(btns().map((b) => b.dataset.fullName)).toEqual(['a', 'b']);
  });

  it('scrolls with the wheel, and stops at the ends', async () => {
    viewport = [800, 3 * 18];
    withScenes(['a', 'b', 'c', 'd']);
    await render();

    const down = () =>
      act(() => {
        strip().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
      });
    const up = () =>
      act(() => {
        strip().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
      });

    down();
    expect(btns().map((b) => b.dataset.fullName)).toEqual(['b', 'c']);
    down();
    expect(btns().map((b) => b.dataset.fullName)).toEqual(['c', 'd']);
    down(); // clamped: NSkip cannot pass n_ent - n_disp
    expect(btns().map((b) => b.dataset.fullName)).toEqual(['c', 'd']);
    up();
    up();
    up();
    expect(btns().map((b) => b.dataset.fullName)).toEqual(['a', 'b']);
  });

  it('is absent while every scene fits', async () => {
    await render();
    expect(container.querySelector('[role="scrollbar"]')).toBeNull();
    expect(btns()).toHaveLength(2);
  });
});

describe('the strip contains its own buttons', () => {
  /*
   * THE BUG THIS PINS. The first cut positioned each button at `topOffset`,
   * which is PyMOL's distance from the top of the SCENE BLOCK — and the scene
   * block is the viewport, 600 px tall, while the strip in the panel is one
   * `internal_gui_control_size` row per scene. So `alpha` was placed 579 px
   * below the strip: clipped away by `overflow: hidden`, and sitting on top of
   * the panel's own table, where it swallowed the click meant for the row
   * underneath. The e2e scene-recall spec caught it as
   * "<p class=\"scpanel__hint\"> intercepts pointer events"; nothing in this
   * file did, because every assertion here was on a width, a height or a
   * DIFFERENCE between two tops.
   */
  it('places the first button at the top of the strip, not at the bottom of the viewport', async () => {
    await render();
    expect(btns()[0]?.style.top).toBe('0px');
    expect(btns()[1]?.style.top).toBe('18px');
  });

  it('is exactly as tall as the rows it drew', async () => {
    await render();
    expect(strip().style.height).toBe('36px'); // two scenes, 18 px each
  });

  it('does not reserve n_disp rows it never drew', async () => {
    // A 600 px viewport fits 32 rows; reserving all 32 for one scene would put
    // ~560 px of empty, click-swallowing strip over the table.
    withScenes(['only_one']);
    await render();
    expect(strip().style.height).toBe('18px');
  });

  it('keeps every button inside the strip once the scrollbar windows it', async () => {
    viewport = [800, 3 * 18];
    withScenes(['a', 'b', 'c', 'd']);
    await render();
    const height = Number.parseInt(strip().style.height, 10);
    for (const button of btns()) {
      const top = Number.parseInt(button.style.top, 10);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + Number.parseInt(button.style.height, 10)).toBeLessThanOrEqual(height);
    }
  });
});

describe('degradation', () => {
  it('renders every name in full when the engine will not say how big the block is', async () => {
    viewport = null;
    withScenes(['a_very_long_scene_name', 'another_long_one']);
    await render();
    expect(strip().classList.contains('scbar--laid')).toBe(false);
    expect(btns().map((b) => b.textContent)).toEqual([
      'a_very_long_scene_name',
      'another_long_one',
    ]);
  });
});
