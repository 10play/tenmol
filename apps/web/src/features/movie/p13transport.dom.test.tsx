/**
 * Row 102 — the nine-button movie/frame control bar, buttons 0-5 and 7.
 *
 * `p8transport.dom.test.tsx` pinned buttons 6 (`seq_view`) and 8 (full screen)
 * only, so the seven remaining cases of `CControl::release`
 * (`packages/engine/layer1/Control.cpp:298-376`) had no test at all: MEASURED
 * this wave, dropping the Ctrl branch from `>|`, dropping the `rock(0)` from
 * Stop and dropping the Ctrl-rewind from Play all left the whole web suite
 * green.  This file is that missing half.
 *
 * What the C actually does, case by case:
 *
 *   0  |<    `SceneSetFrame(G, 4, 0)`                       -> `cmd.rewind()`
 *   1  <     `SceneSetFrame(G, 5, -1)`                      -> `cmd.back()`
 *   2  []    `SettingSetGlobal_b(cSetting_sculpting, 0)`,
 *            `SettingSetGlobal_b(cSetting_rock, 0)`, MovieStop -> `cmd.mstop()`
 *   3  >/||  MoviePlaying ? stop : play; Ctrl rewinds first
 *   4  >     `SceneSetFrame(G, 5, 1)`                       -> `cmd.forward()`
 *   5  >|    `SceneSetFrame(G, 6, 0)`, Ctrl -> mode 3       -> `cmd.middle()`
 *   7  rock  toggles `rock`; turning it on restarts the sweep timer
 *
 * and buttons 3/6/7 render "lit" while playing / seq_view / rock.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MovieSettings, MovieStatus } from '@tenmol/protocol/topics/movie';

import { TransportBar } from './TransportBar';
import type { MovieAction } from './movieSource';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function status(
  over: Partial<MovieStatus> = {},
  settings: Partial<MovieSettings> = {},
): MovieStatus {
  return {
    frame: 1,
    state: 1,
    nframes: 6,
    length: 6,
    playing: false,
    locked: false,
    rocking: false,
    fps: 30,
    sceneCurrent: null,
    ...over,
    settings: settings as MovieSettings,
  };
}

let container: HTMLDivElement;
let root: Root;
let actions: MovieAction[];

function render(value: MovieStatus): void {
  act(() => {
    root.render(
      <TransportBar
        status={value}
        run={async (action) => {
          actions.push(action);
        }}
      />,
    );
  });
}

function button(testid: string): HTMLButtonElement {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`no ${testid}`);
  return el as HTMLButtonElement;
}

/**
 * The handlers are `async` and `await` between dispatches, so a synchronous
 * `act` returns after only the FIRST call. Awaiting an async `act` drains the
 * microtask queue and is the difference between seeing `[mstop]` and seeing
 * `[mstop, rock, set]`.
 */
async function click(testid: string, init: MouseEventInit = {}): Promise<void> {
  const el = button(testid);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
}

const fns = (): string[] => actions.map((a) => a.fn);

beforeEach(() => {
  actions = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('row 102 — the frame buttons (0, 1, 4)', () => {
  it('send rewind / backward / forward, with the command lines the C logs', async () => {
    render(status());
    await click('mv-rewind');
    await click('mv-back');
    await click('mv-forward');
    expect(fns()).toEqual(['cmd.rewind', 'cmd.backward', 'cmd.forward']);
    // `CControl::release` PLogs `cmd.back()`, not `cmd.backward()`.
    expect(actions.map((a) => a.echo)).toEqual(['cmd.rewind()', 'cmd.back()', 'cmd.forward()']);
  });
});

describe('row 102 — button 2 (stop) clears sculpting and rock too', () => {
  it('is mstop, then rock(0), then sculpting=0 — Control.cpp order', async () => {
    render(status({ rocking: true }, { rock: true }));
    await click('mv-stop');
    expect(fns()).toEqual(['cmd.mstop', 'cmd.rock', 'cmd.set']);
    expect(actions[1]?.args).toEqual([0]);
    expect(actions[2]?.args).toEqual(['sculpting', 0]);
  });

  it('skips the rock(0) when nothing is rocking, but always clears sculpting', async () => {
    render(status());
    await click('mv-stop');
    expect(fns()).toEqual(['cmd.mstop', 'cmd.set']);
    expect(actions[1]?.args).toEqual(['sculpting', 0]);
  });
});

describe('row 102 — button 3 (play/pause)', () => {
  it('plays when stopped and stops when playing', async () => {
    render(status());
    await click('mv-play');
    expect(fns()).toEqual(['cmd.mplay']);

    actions = [];
    render(status({ playing: true }));
    await click('mv-play');
    expect(fns()).toEqual(['cmd.mstop']);
  });

  it('rewinds FIRST when Ctrl is held, and only while stopped', async () => {
    render(status());
    await click('mv-play', { ctrlKey: true });
    expect(fns()).toEqual(['cmd.rewind', 'cmd.mplay']);

    // Ctrl while already playing is still a plain stop: the C only takes the
    // rewind branch on the `!MoviePlaying` side of the `if`.
    actions = [];
    render(status({ playing: true }));
    await click('mv-play', { ctrlKey: true });
    expect(fns()).toEqual(['cmd.mstop']);
  });

  it('renders lit while playing and unlit otherwise', async () => {
    render(status());
    expect(button('mv-play').className).not.toContain('is-on');
    expect(button('mv-play').textContent).toBe('>');

    render(status({ playing: true }));
    expect(button('mv-play').className).toContain('is-on');
    expect(button('mv-play').textContent).toBe('||');
  });
});

describe('row 102 — button 5 (ending) and its Ctrl variant', () => {
  it('is ending, and middle when Ctrl is held', async () => {
    render(status());
    await click('mv-ending');
    expect(fns()).toEqual(['cmd.ending']);

    actions = [];
    await click('mv-ending', { ctrlKey: true });
    expect(fns()).toEqual(['cmd.middle']);

    // macOS sends metaKey for the same gesture.
    actions = [];
    await click('mv-ending', { metaKey: true });
    expect(fns()).toEqual(['cmd.middle']);
  });
});

describe('row 102 — button 7 (rock)', () => {
  it('turns rocking on with rock(1) and off with rock(0)', async () => {
    render(status());
    await click('mv-rock');
    expect(actions[0]?.fn).toBe('cmd.rock');
    expect(actions[0]?.args).toEqual([1]);

    actions = [];
    render(status({ rocking: true }));
    await click('mv-rock');
    expect(actions[0]?.args).toEqual([0]);
  });

  it('reads lit from EITHER the rocking flag or the `rock` setting', async () => {
    render(status());
    expect(button('mv-rock').className).not.toContain('is-on');

    render(status({ rocking: true }));
    expect(button('mv-rock').className).toContain('is-on');

    render(status({ rocking: false }, { rock: true }));
    expect(button('mv-rock').className).toContain('is-on');
  });
});

describe('row 102 — the bar is nine buttons', () => {
  it('renders all nine, in Control.cpp order', async () => {
    render(status());
    const ids = [...container.querySelectorAll('[data-testid^="mv-"]')].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(ids).toEqual([
      'mv-rewind',
      'mv-back',
      'mv-stop',
      'mv-play',
      'mv-forward',
      'mv-ending',
      'mv-seq',
      'mv-rock',
      'mv-full',
    ]);
  });
});
