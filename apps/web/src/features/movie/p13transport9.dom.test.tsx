/**
 * Row 186 — the movie control bar, the SEVEN buttons nothing was checking.
 *
 * The row: "0-8: rewind, back, stop (also clears sculpting and rock),
 * play/pause (Ctrl -> rewind+play), forward, ending (Ctrl -> middle), toggle
 * `seq_view` ('S'), toggle rock, full_screen ('F'). Buttons 3/6/7 render active
 * when engaged." (`packages/engine/layer1/Control.cpp:62,243-255,288-385`.)
 *
 * WHY THIS FILE EXISTS. `p8transport.dom.test.tsx` covers exactly two of the
 * nine — case 6 (`seq_view`) and case 8 (full screen) — and says so in its own
 * header. Measured while auditing the row's citations: deleting the rock and
 * sculpting writes from the Stop handler, and deleting the Ctrl branch from
 * Ending, both left the whole 1,906-test web suite green. The three cases the
 * C spends the most lines on were the three nobody tested.
 *
 * The three that matter, and why each is a real bug and not a detail:
 *
 *  * STOP IS NOT `mstop`. `CControl::release` case 2 writes `sculpting = 0`
 *    and `rock = false` BEFORE it logs `cmd.mstop()` (`Control.cpp:301-311`).
 *    A Stop that only calls `mstop` leaves the scene still rocking, which
 *    reads to a user as "the stop button is broken".
 *  * CTRL+PLAY REWINDS FIRST (`Control.cpp:316-323`) — the "play from the
 *    top" gesture. Without it Ctrl+Play resumes mid-movie.
 *  * CTRL+ENDING IS `middle`, NOT `ending` (`Control.cpp:352-360`) — two
 *    different frames, and the wrong one is silently plausible.
 *
 * Every assertion names the `cmd` call and the string `CControl` PLogs, so a
 * rename on either side fails here rather than in the console.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MovieSettings, MovieStatus } from '@tenmol/protocol/topics/movie';

import { TransportBar } from './TransportBar';
import type { MovieAction } from './movieSource';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function status(over: Partial<MovieStatus> = {}, settings: Partial<MovieSettings> = {}): MovieStatus {
  return {
    frame: 3,
    state: 3,
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
        onLog={() => undefined}
      />,
    );
  });
}

function button(testid: string): HTMLButtonElement {
  const element = container.querySelector(`[data-testid="${testid}"]`);
  if (!element) throw new Error(`no ${testid}`);
  return element as HTMLButtonElement;
}

/**
 * Click and let the handler finish.
 *
 * `TransportBar`'s handlers are `async` and `await run(...)` between steps, so
 * the second and third calls of a multi-step case (Stop, Ctrl+Play) land in a
 * later microtask. A synchronous `act` sees only the first one — which is the
 * shape a green-but-blind test would take here.
 */
async function click(testid: string, init: MouseEventInit = {}): Promise<void> {
  await act(async () => {
    button(testid).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
    );
  });
}

/** `[fn, ...args]` per action, which is what actually reaches the bridge. */
const dispatched = (): unknown[][] => actions.map((a) => [a.fn, ...a.args]);

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

describe('the nine control-bar buttons are nine distinct engine calls', () => {
  it('renders exactly nine buttons, in CControl::draw order', async () => {
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

  it('maps 0/1/4 to rewind / backward / forward with the logged command line', async () => {
    render(status());
    await click('mv-rewind');
    await click('mv-back');
    await click('mv-forward');
    expect(dispatched()).toEqual([['cmd.rewind'], ['cmd.backward'], ['cmd.forward']]);
    // `CControl` PLogs `cmd.back()` for button 1, NOT `cmd.backward()`.
    expect(actions.map((a) => a.echo)).toEqual(['cmd.rewind()', 'cmd.back()', 'cmd.forward()']);
  });
});

describe('button 2 — Stop is not an alias for mstop', () => {
  it('clears rock and sculpting after stopping, in CControl::release order', async () => {
    render(status({ rocking: true }, { rock: true }));
    await click('mv-stop');
    expect(dispatched()).toEqual([
      ['cmd.mstop'],
      ['cmd.rock', 0],
      ['cmd.set', 'sculpting', 0],
    ]);
  });

  it('still clears sculpting when nothing is rocking', async () => {
    // `rock` is only written when it is on; `sculpting` is written either way,
    // so a stop always ends an interactive sculpt.
    render(status());
    await click('mv-stop');
    expect(dispatched()).toEqual([['cmd.mstop'], ['cmd.set', 'sculpting', 0]]);
  });
});

describe('button 3 — play / pause, and the Ctrl variant', () => {
  it('plays when stopped and stops when playing', async () => {
    render(status());
    await click('mv-play');
    expect(dispatched()).toEqual([['cmd.mplay']]);

    actions = [];
    render(status({ playing: true }));
    await click('mv-play');
    expect(dispatched()).toEqual([['cmd.mstop']]);
  });

  it('REWINDS FIRST with Ctrl held, so Ctrl+Play starts from frame 1', async () => {
    render(status());
    await click('mv-play', { ctrlKey: true });
    expect(dispatched()).toEqual([['cmd.rewind'], ['cmd.mplay']]);
  });

  it('ignores Ctrl while already playing — Ctrl+Play does not restart a movie', async () => {
    // `Control.cpp:316`: the rewind branch is inside `if (!playing)`. A client
    // that rewound unconditionally would jump the user back to frame 1 when
    // they meant to pause.
    render(status({ playing: true }));
    await click('mv-play', { ctrlKey: true });
    expect(dispatched()).toEqual([['cmd.mstop']]);
  });

  it('renders active while playing (buttons 3/6/7 show state)', async () => {
    render(status({ playing: true }));
    expect(button('mv-play').className).toContain('is-on');
    render(status({ playing: false }));
    expect(button('mv-play').className).not.toContain('is-on');
  });
});

describe('button 5 — ending, and the Ctrl variant that is a DIFFERENT frame', () => {
  it('is cmd.ending() bare and cmd.middle() with Ctrl', async () => {
    render(status());
    await click('mv-ending');
    await click('mv-ending', { ctrlKey: true });
    expect(dispatched()).toEqual([['cmd.ending'], ['cmd.middle']]);
  });

  it('treats macOS Cmd as Ctrl, the way keymapping.py:52 folds Meta', async () => {
    render(status());
    await click('mv-ending', { metaKey: true });
    expect(dispatched()).toEqual([['cmd.middle']]);
  });
});

describe('button 7 — rock toggles, and shows that it is engaged', () => {
  it('turns rocking on with cmd.rock(1) and off with cmd.rock(0)', async () => {
    render(status());
    await click('mv-rock');
    expect(dispatched()).toEqual([['cmd.rock', 1]]);

    actions = [];
    render(status({ rocking: true }));
    await click('mv-rock');
    expect(dispatched()).toEqual([['cmd.rock', 0]]);
  });

  it('reads the rock SETTING as well as the live rocking flag', async () => {
    // `movie_rock`/`rock` survives a reload where the transient flag does not,
    // so a bar that only watched `rocking` would offer to start a rock that is
    // already running.
    render(status({ rocking: false }, { rock: true }));
    expect(button('mv-rock').className).toContain('is-on');
    await click('mv-rock');
    expect(dispatched()).toEqual([['cmd.rock', 0]]);
  });
});
