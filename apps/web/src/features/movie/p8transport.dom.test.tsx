/**
 * Wave 8 — the last two buttons of the nine-button control bar.
 *
 * Seven of `CControl::release`'s nine cases had been clicked against a live
 * engine; `seq_view` (case 6) and `full_screen` (case 8) had not. Case 8 is
 * the interesting one:
 *
 *   MEASURED over the bridge — `cmd.full_screen()`, `cmd.full_screen(0)` and
 *   `cmd.full_screen(1)` ALL raise `CmdException: ' Error: '` from
 *   `_cmd.full_screen` (`viewing.py:1356`), because `ExecutiveFullScreen`
 *   wants a window and a GL-free engine has none.
 *
 * So dispatching the call the C logs would give the user a red console line
 * and no full screen. The browser is the window here: the button drives the
 * Fullscreen API and echoes the command line, which is what these tests pin.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MovieSettings, MovieStatus } from '@tenmol/protocol/topics/movie';

import { TransportBar } from './TransportBar';
import type { MovieAction } from './movieSource';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function status(settings: Partial<MovieSettings> = {}): MovieStatus {
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
    settings: settings as MovieSettings,
  };
}

let container: HTMLDivElement;
let root: Root;
let actions: MovieAction[];
let logs: string[];
let requested: number;
let exited: number;
let fullscreenElement: Element | null;

function render(value: MovieStatus): void {
  act(() => {
    root.render(
      <TransportBar
        status={value}
        run={async (action) => {
          actions.push(action);
        }}
        onLog={(line) => logs.push(line)}
      />,
    );
  });
}

function click(testid: string): void {
  const button = container.querySelector(`[data-testid="${testid}"]`);
  if (!button) throw new Error(`no ${testid}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  actions = [];
  logs = [];
  requested = 0;
  exited = 0;
  fullscreenElement = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom implements neither half of the Fullscreen API.
  (document.documentElement as unknown as { requestFullscreen: () => Promise<void> }).
    requestFullscreen = vi.fn(async () => {
    requested += 1;
  });
  (document as unknown as { exitFullscreen: () => Promise<void> }).exitFullscreen = vi.fn(
    async () => {
      exited += 1;
    },
  );
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('button 6 — the seq_view toggle', () => {
  it('turns it on when it is off, with the command line the C logs', () => {
    render(status({ seq_view: false }));
    click('mv-seq');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.fn).toBe('cmd.set');
    expect(actions[0]?.args).toEqual(['seq_view', 1]);
    expect(actions[0]?.echo).toBe("cmd.set('seq_view',1)");
  });

  it('turns it off when it is on, and shows the pressed state', () => {
    render(status({ seq_view: true }));
    const button = container.querySelector('[data-testid="mv-seq"]');
    expect(button?.className).toContain('is-on');
    click('mv-seq');
    expect(actions[0]?.args).toEqual(['seq_view', 0]);
    expect(actions[0]?.echo).toBe("cmd.set('seq_view',0)");
  });
});

describe('button 8 — full screen', () => {
  it('asks the BROWSER, not the engine, and echoes the command line', () => {
    render(status());
    click('mv-full');
    expect(requested).toBe(1);
    expect(exited).toBe(0);
    expect(logs).toEqual(['cmd.full_screen()']);
    // Nothing goes out over the wire: `cmd.full_screen` can only fail here.
    expect(actions).toEqual([]);
  });

  it('exits when the document is already full screen', () => {
    render(status());
    fullscreenElement = document.documentElement;
    click('mv-full');
    expect(exited).toBe(1);
    expect(requested).toBe(0);
    expect(logs).toEqual(['cmd.full_screen()']);
  });

  it('survives a browser that refuses outside a user gesture', () => {
    (document.documentElement as unknown as { requestFullscreen: () => Promise<void> }).
      requestFullscreen = vi.fn(async () => {
      throw new Error('Failed to execute requestFullscreen: API can only be initiated by a user gesture');
    });
    render(status());
    expect(() => click('mv-full')).not.toThrow();
    expect(logs).toEqual(['cmd.full_screen()']);
  });
});
