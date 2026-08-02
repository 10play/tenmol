/**
 * Where a Tab keystroke goes (row 55).
 *
 * The row's gap sentence was: "eventFilter's routing of Tab from the GL widget
 * into `pymol.button` is not wired."  Qt has TWO Tab behaviours and one filter
 * that decides between them (`pymol_qt_gui.py:440-455`):
 *
 *   watched is the lineedit -> `lineeditKeyPressEventFilter` -> `self.complete()`
 *                              (the DOCK command line, `cmd._parser.complete`)
 *   anything else           -> `self.keyPressEvent(event)` -> `pymol.button(9,…)`
 *                              (PyMOL's INTERNAL prompt, `OrthoKey` case 9)
 *
 * and in both cases the KeyRelease is swallowed so focus never moves.
 *
 * This client makes the same split with a different mechanism: the command line
 * handles Tab itself and `preventDefault`s it, and `features/keyboard`'s
 * document-level forwarder skips text entries, so a Tab pressed anywhere else
 * goes out as ASCII 9.  Both halves are asserted here because they are only
 * correct TOGETHER — a Tab that did both would complete the dock line and type
 * into PyMOL's prompt at once.
 *
 * The other end of the second path is measured in
 * `packages/bridge/tests/test_p8_a1.py::test_tab_pressed_outside_the_command_line_completes_pymols_own_prompt`,
 * where ASCII 9 really does make PyMOL print " parser: matching commands:".
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsStore,
  createUiStore,
} from '@tenmol/stores';
import { SessionContext, type Session } from '../../app';
import { KeyboardService } from '../keyboard/KeyboardService';
import { CommandLine } from './CommandLine';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let session: Session;
let sent: Array<Record<string, unknown>>;
let calls: Array<{ fn: string; args: readonly unknown[] }>;

function makeSession(): Session {
  const connection = createConnectionStore('ws://test/ws', true);
  connection.set({ phase: 'open' });
  return {
    config: {} as Session['config'],
    conn: {
      isOpen: true,
      sendInput: (frame: Record<string, unknown>) => sent.push(frame),
      do: () => Promise.resolve(),
    },
    stores: {
      connection,
      feedback: createFeedbackStore(),
      objects: createObjectsStore(),
      ui: createUiStore(null),
    },
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: vi.fn(() => Promise.resolve()),
    act: vi.fn(),
    call: (fn: string, args: readonly unknown[] = []) => {
      calls.push({ fn, args });
      // `cmd._parser.complete('lo')` — the completed LINE, as PyMOL returns it.
      if (fn === 'cmd._parser.complete') return Promise.resolve('load ');
      return Promise.resolve(null);
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

function mount(): void {
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <>
          <KeyboardService />
          <CommandLine />
          <div data-testid="viewport" tabIndex={-1} />
        </>
      </SessionContext.Provider>,
    ),
  );
}

function input(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input');
  if (!el) throw new Error('no command line');
  return el;
}

/**
 * Type into a CONTROLLED input.
 *
 * `el.value = x` is invisible to React: its value tracker sees no change and
 * swallows the synthetic `input` event, so the component's state stays ''. The
 * native setter is the documented way round it.
 */
function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A Tab keydown dispatched at `target`, the way a browser dispatches it. */
function pressTab(target: Element): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    code: 'Tab',
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  sent = [];
  calls = [];
  session = makeSession();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Tab in the command line', () => {
  it('completes there and is NOT forwarded to PyMOL', async () => {
    mount();
    const line = input();
    act(() => {
      line.focus();
      type(line, 'lo');
    });

    const event = pressTab(line);
    await flush();

    // The dock line's own completion, one round trip.
    expect(calls.map((c) => c.fn)).toContain('cmd._parser.complete');
    expect(calls.find((c) => c.fn === 'cmd._parser.complete')?.args).toEqual(['lo']);
    // …and nothing went to `pymol.button`, or PyMOL's internal prompt would
    // have grown a tab of its own.
    expect(sent).toEqual([]);
    // Focus does not move: Qt returns `break` from its filter (`_gui.py:903`).
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(line);
  });

  it('is swallowed even with the bridge down, so focus still cannot escape', () => {
    session.stores.connection.set({ phase: 'closed' });
    mount();
    const line = input();
    act(() => line.focus());
    const event = pressTab(line);
    expect(event.defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
    expect(calls.some((c) => c.fn === 'cmd._parser.complete')).toBe(false);
  });
});

describe('Tab anywhere else', () => {
  it('goes to PyMOL as ASCII 9 — the GL widget path of Qt`s eventFilter', () => {
    mount();
    const viewport = container.querySelector('[data-testid="viewport"]');
    if (!viewport) throw new Error('no viewport');
    const event = pressTab(viewport);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      t: 'input',
      kind: 'button',
      button: 9, // `keymapping.py:12`: Qt.Key_Tab -> 9
      state: -1, // ASCII, not SPECIAL
      x: 0,
      y: 0,
      mod: 0,
    });
    // Focus must not move here either: Qt's filter eats the event whatever the
    // watched widget was.
    expect(event.defaultPrevented).toBe(true);
    // And the dock command line did not also complete.
    expect(calls.some((c) => c.fn === 'cmd._parser.complete')).toBe(false);
  });
});
