/**
 * Parity area 2, rows 112-113 — the busy box, the marquee and the splash, as
 * mounted components.
 *
 * All three are portalled onto `.shell__viewport`, so every test here creates
 * that element; a missing host must render nothing rather than throw.
 *
 * The engine facts behind them are measured in `packages/bridge/tests/test_wf_ortho.py`:
 * a live 0.7 s ray pushed `progress` frames of 0.35 -> 0.45 -> 0.53 and then
 * -1.0, `show_progress, 0` made every frame -1.0, and neither `LoopRect` nor
 * `SplashFlag` is readable from Python.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectionStore } from '@tenmol/stores';
import { createConsoleStore } from '@tenmol/stores/console';
import { SessionContext, type Session } from '../../app';
import { BusyOverlay } from './BusyOverlay';
import { OrthoLoopRect } from './OrthoLoopRect';
import { BUSY_BAR_WIDTH, showSplash } from './orthoOverlays';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ *
 * harness
 * ------------------------------------------------------------------ */

let container: HTMLDivElement;
let viewport: HTMLDivElement;
let root: Root;
let connection: ReturnType<typeof createConnectionStore>;

/** `cmd.get_setting_int('show_progress')` / `get_setting_text(...)`. */
let settings: Record<string, unknown>;
const call = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
  if (fn === 'cmd.get_setting_int' || fn === 'cmd.get_setting_text') {
    return settings[String(args[0])];
  }
  return null;
});

function session(): Session {
  return { call, stores: { connection } } as unknown as Session;
}

beforeEach(() => {
  call.mockClear();
  settings = { show_progress: 1, button_mode_name: '3-Button Viewing' };
  connection = createConnectionStore('ws://test/ws', false);
  container = document.createElement('div');
  viewport = document.createElement('div');
  viewport.className = 'shell__viewport';
  // jsdom gives every element a zero rect; the marquee is measured against
  // `getBoundingClientRect`, so pin one that is not at the origin — an overlay
  // that forgot to subtract it would still pass at (0,0).
  viewport.getBoundingClientRect = () =>
    ({ left: 40, top: 25, width: 800, height: 600, right: 840, bottom: 625 }) as DOMRect;
  document.body.append(container, viewport);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  viewport.remove();
});

function mount(node: React.ReactNode): void {
  act(() => {
    root.render(<SessionContext.Provider value={session()}>{node}</SessionContext.Provider>);
  });
}

/** Let the `show_progress` / `button_mode_name` promise settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function busy(): HTMLElement | null {
  return viewport.querySelector<HTMLElement>('[data-testid="ortho-busy"]');
}

function loop(): HTMLElement | null {
  return viewport.querySelector<HTMLElement>('[data-testid="ortho-loop"]');
}

function pointer(type: string, x: number, y: number, init: PointerEventInit = {}): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    ...init,
  });
  // jsdom has no PointerEvent; the component only reads MouseEvent fields plus
  // `pointerType`, which is undefined here and must not be treated as touch.
  const target = type === 'pointerdown' ? viewport : window;
  act(() => {
    target.dispatchEvent(event);
  });
}

/* ------------------------------------------------------------------ *
 * row 112 — the busy box
 * ------------------------------------------------------------------ */

describe('<BusyOverlay>', () => {
  it('draws nothing at rest, because idle progress is NEGATIVE', async () => {
    mount(<BusyOverlay />);
    await settle();
    expect(connection.get().progress).toBe(-1);
    expect(busy()).toBeNull();
  });

  it('appears with the box PyMOL draws once a job reports', async () => {
    mount(<BusyOverlay />);
    await settle();
    act(() => connection.setProgress(0.3467)); // a real sample from a live ray
    await settle();

    const box = busy();
    expect(box).not.toBeNull();
    expect(box?.style.width).toBe('240px'); // cBusyWidth
    expect(box?.style.height).toBe('60px'); // cBusyHeight
    expect(box?.style.padding).toBe('10px'); // cBusyMargin
    expect(box?.getAttribute('aria-valuenow')).toBe('35');
    expect(box?.textContent).toContain('35%');

    const fill = box?.querySelector<HTMLElement>('.ortho-busy__fill');
    expect(fill?.style.width).toBe('76px'); // 0.3467 * 220
  });

  it('draws ONE bar, because the API folds the two counters into one number', async () => {
    // `CmdGetProgress` (`packages/engine/layer4/Cmd.cpp:4334-4348`) folds slow into fast; the
    // box's second bar cannot be reconstructed. Pinned so a future two-bar
    // rewrite has to add the binding first.
    mount(<BusyOverlay />);
    await settle();
    act(() => connection.setProgress(0.5));
    await settle();
    expect(busy()?.querySelectorAll('.ortho-busy__bar')).toHaveLength(1);
  });

  it('disappears again when the job ends', async () => {
    mount(<BusyOverlay />);
    await settle();
    act(() => connection.setProgress(0.9));
    await settle();
    expect(busy()).not.toBeNull();

    act(() => connection.setProgress(-1));
    await settle();
    expect(busy()).toBeNull();
  });

  it('honours show_progress, and never asks for it while the engine is busy', async () => {
    settings['show_progress'] = 0;
    mount(<BusyOverlay />);
    await settle();
    const askedAtRest = call.mock.calls.length;
    expect(askedAtRest).toBeGreaterThan(0);

    act(() => connection.setProgress(0.5));
    await settle();
    expect(busy()).toBeNull();
    // An ordinary RPC cannot answer while PyMOL holds `lock_api` (measured:
    // ~0.6 s inside a 0.7 s ray), so asking here would answer too late to be
    // of any use and would queue behind the job.
    expect(call.mock.calls.length).toBe(askedAtRest);

    // ... and it re-reads once the engine is idle again.
    act(() => connection.setProgress(-1));
    await settle();
    expect(call.mock.calls.length).toBeGreaterThan(askedAtRest);
  });

  it('clamps a nonsense value instead of overflowing the box', async () => {
    mount(<BusyOverlay />);
    await settle();
    act(() => connection.setProgress(4));
    await settle();
    expect(busy()?.querySelector<HTMLElement>('.ortho-busy__fill')?.style.width).toBe(
      `${BUSY_BAR_WIDTH}px`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * row 113 — the marquee
 * ------------------------------------------------------------------ */

describe('<OrthoLoopRect>', () => {
  it('draws nothing until a box drag starts', async () => {
    mount(<OrthoLoopRect />);
    await settle();
    expect(loop()).toBeNull();

    pointer('pointerdown', 100, 100); // plain left = Rota
    pointer('pointermove', 300, 400);
    expect(loop()).toBeNull();
  });

  it('draws the rect for a shift+left drag and follows the pointer', async () => {
    mount(<OrthoLoopRect />);
    await settle();

    pointer('pointerdown', 140, 125, { shiftKey: true }); // (100, 100) local
    // `SceneLoopClick` sets all four edges to the press point.
    expect(loop()?.style.width).toBe('0px');

    pointer('pointermove', 340, 425, { shiftKey: true }); // (300, 400) local
    const rect = loop();
    expect(rect).not.toBeNull();
    expect(rect?.dataset['kind']).toBe('add');
    expect([rect?.style.left, rect?.style.top]).toEqual(['100px', '100px']);
    expect([rect?.style.width, rect?.style.height]).toEqual(['200px', '300px']);
  });

  it('normalises a drag towards the top-left', async () => {
    mount(<OrthoLoopRect />);
    await settle();
    pointer('pointerdown', 340, 425, { shiftKey: true });
    pointer('pointermove', 140, 125, { shiftKey: true });
    const rect = loop();
    expect([rect?.style.left, rect?.style.top]).toEqual(['100px', '100px']);
    expect([rect?.style.width, rect?.style.height]).toEqual(['200px', '300px']);
  });

  it('marks a subtract drag differently from an add drag', async () => {
    mount(<OrthoLoopRect />);
    await settle();
    pointer('pointerdown', 140, 125, { shiftKey: true, button: 1 }); // shift+middle
    pointer('pointermove', 240, 225, { shiftKey: true, button: 1 });
    expect(loop()?.dataset['kind']).toBe('subtract');
  });

  it('clears on release, and re-reads the mouse mode afterwards', async () => {
    mount(<OrthoLoopRect />);
    await settle();
    const before = call.mock.calls.length;

    pointer('pointerdown', 140, 125, { shiftKey: true });
    pointer('pointermove', 240, 225, { shiftKey: true });
    expect(loop()).not.toBeNull();

    pointer('pointerup', 240, 225, { shiftKey: true });
    expect(loop()).toBeNull();
    expect(call.mock.calls.length).toBeGreaterThan(before);
  });

  it('clears on pointercancel, so a lost pointer cannot strand the rect', async () => {
    mount(<OrthoLoopRect />);
    await settle();
    pointer('pointerdown', 140, 125, { shiftKey: true });
    pointer('pointermove', 240, 225, { shiftKey: true });
    pointer('pointercancel', 240, 225);
    expect(loop()).toBeNull();
  });

  it('does not start on a press that landed on another ortho block', async () => {
    // `OrthoButton` hands the click to the block under the cursor
    // (`packages/engine/layer1/Ortho.cpp:2530-2600`); the console band eats it and the scene
    // never sees a press, so there is no rubber band to draw.
    mount(<OrthoLoopRect />);
    await settle();
    const band = document.createElement('div');
    band.className = 'ortho__lines';
    const ortho = document.createElement('div');
    ortho.className = 'ortho';
    ortho.append(band);
    viewport.append(ortho);

    act(() => {
      band.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: 140,
          clientY: 125,
          shiftKey: true,
        }),
      );
    });
    pointer('pointermove', 240, 225, { shiftKey: true });
    expect(loop()).toBeNull();
  });

  it('never consumes the event the viewport needs', async () => {
    // The whole gesture is also `@tenmol/viewport`'s: it is what produces the
    // selection. Listeners are passive and capture-only; nothing is prevented.
    mount(<OrthoLoopRect />);
    await settle();
    const down = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 140,
      clientY: 125,
      shiftKey: true,
    });
    let sawBubble = false;
    viewport.addEventListener('pointerdown', () => {
      sawBubble = true;
    });
    act(() => {
      viewport.dispatchEvent(down);
    });
    expect(sawBubble).toBe(true);
    expect(down.defaultPrevented).toBe(false);
  });

  it('follows the live mouse mode', async () => {
    // shift+right is `Clip` in 3-Button Viewing and `-Box` in 2-Button
    // Selecting; the component reads `button_mode_name` rather than assuming.
    settings['button_mode_name'] = 'two_button_selecting';
    mount(<OrthoLoopRect />);
    await settle();
    pointer('pointerdown', 140, 125, { shiftKey: true, button: 2 });
    pointer('pointermove', 240, 225, { shiftKey: true, button: 2 });
    expect(loop()?.dataset['kind']).toBe('subtract');
  });
});

/* ------------------------------------------------------------------ *
 * row 113 — the splash flag
 * ------------------------------------------------------------------ */

describe('the splash', () => {
  it('shows PyMOL’s OWN banner and raises the flag that displays it', () => {
    // The flag's effect (`showLineCount` 1 -> 30 -> 1) is pinned in
    // `console.test.ts`; what is new here is that the banner is reachable at
    // all. `cmd.splash(0)` runs `OrthoSplash` in the C, so the text is
    // PyMOL's rather than a copy — measured arriving on the feedback channel
    // in `test_wf_ortho.py::test_the_splash_FLAG_is_invisible_but_the_splash_TEXT_is_a_command`.
    const store = createConsoleStore();
    expect(store.get().splash).toBe(false); // the bridge boots show_splash=0
    store.setVisible(false);

    showSplash((fn, args) => call(fn, args ?? []), store);

    expect(call).toHaveBeenCalledWith('cmd.splash', [0]);
    expect(store.get().splash).toBe(true);
    // A raised flag with the overlay switched off would be invisible.
    expect(store.get().visible).toBe(true);

    store.removeSplash(); // `OrthoRemoveSplash` from a click or Esc
    expect(store.get().splash).toBe(false);
  });
});
