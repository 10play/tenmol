/**
 * Parity row 110, the one clause left open: **Ctrl-V paste, exercised for real**.
 *
 * Wave 9 corrected the row to say the product already had a clipboard handler
 * and only a test was missing. Writing that test found a DEFECT, which is the
 * point of writing it: `onKeyDown` called `event.preventDefault()` for every
 * mapped key, and `preventDefault()` on a Ctrl-V keydown is precisely how a
 * page BLOCKS pasting — the browser then never dispatches the `paste` event, so
 * the handler that reads `clipboardData` could never run and the only thing
 * left was `cmd.paste()`, which returns nothing in a GUI-less engine
 * (`externing.py:152-175` needs `pymol.machine_get_clipboard`, measured absent
 * on this bridge in wave 8). Ctrl-V was a guaranteed no-op.
 *
 * Wave 9 also had the CONDITION backwards: it wrote that `cmd.paste` is reached
 * "only for the Ctrl-V chord on an EMPTY line". `layer1/Ortho.cpp:1015` is
 * `if (I->CurChar != I->PromptChar)` — i.e. paste when text HAS been typed, and
 * the CHORD on an empty line. `orthoKeys.ts:183-186` already had it right.
 *
 * What is asserted here, against the real portalled `.ortho` element:
 *   1. a real `paste` event puts its text on the line, newlines collapsed;
 *   2. a Ctrl-V keydown does NOT preventDefault, so that event can happen;
 *   3. with no clipboard event, the `cmd.paste()` fallback still runs;
 *   4. Ctrl-V on an EMPTY line is the `cmd._ctrl('V')` chord and never
 *      `cmd.paste`.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedbackStore } from '@tenmol/stores';
import { createConsoleStore, type ConsoleStore } from '@tenmol/stores/console';
import { SessionContext, type Session } from '../../app';

// The band measures its host (`I->ShowLines`, `layer1/Ortho.cpp:2380`); jsdom
// has no ResizeObserver.
class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;

let consoleStore: ConsoleStore;
const refreshSettings = vi.fn(async () => undefined);
vi.mock('./consoleSource', () => ({
  getConsoleSource: () => ({
    store: consoleStore,
    refreshSettings,
    stop: () => undefined,
  }),
}));

const { OrthoConsole } = await import('./OrthoConsole');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let viewport: HTMLDivElement;
let root: Root;
const call = vi.fn(async () => null);
const run = vi.fn(async () => undefined);

function session(): Session {
  return {
    call,
    run,
    stores: { feedback: createFeedbackStore() },
  } as unknown as Session;
}

/** The portalled console element, which is where the events have to land. */
function ortho(): HTMLElement {
  const node = viewport.querySelector<HTMLElement>('[data-testid="ortho-console"]');
  expect(node, 'the ortho console did not portal into .shell__viewport').not.toBeNull();
  return node as HTMLElement;
}

/**
 * A real `paste` event carrying text.
 *
 * `ClipboardEvent` is not constructible with a `DataTransfer` in jsdom, so the
 * event is built the way React reads it: `SyntheticClipboardEvent` takes
 * `clipboardData` straight off the native event.
 */
function pasteEvent(text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (kind: string) => (kind === 'text/plain' ? text : '') },
  });
  return event;
}

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** One macrotask, which is what the `cmd.paste` fallback waits for. */
async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
  });
}

beforeEach(async () => {
  call.mockClear();
  run.mockClear();
  consoleStore = createConsoleStore();
  container = document.createElement('div');
  viewport = document.createElement('div');
  viewport.className = 'shell__viewport';
  document.body.append(container, viewport);
  root = createRoot(container);
  await act(async () => {
    root.render(<SessionContext.Provider value={session()}>{<OrthoConsole />}</SessionContext.Provider>);
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  viewport.remove();
});

describe('pasting into the in-viewport prompt', () => {
  it('puts the clipboard text on the line, newlines collapsed to spaces', async () => {
    act(() => {
      for (const ch of 'zo') ortho().dispatchEvent(keydown(ch));
    });
    expect(consoleStore.get().line.text).toBe('zo');

    const event = pasteEvent('om\nselect all\r\nshow spheres');
    act(() => {
      ortho().dispatchEvent(event);
    });
    expect(consoleStore.get().line.text).toBe('zoom select all show spheres');
    // The default is prevented HERE, so the browser does not also insert it.
    expect(event.defaultPrevented).toBe(true);
    // The engine was never asked: the text was already in the event.
    expect(call).not.toHaveBeenCalledWith('cmd.paste');
  });

  it('inserts at the cursor, not at the end', async () => {
    act(() => {
      for (const ch of 'zoom') ortho().dispatchEvent(keydown(ch));
      ortho().dispatchEvent(keydown('ArrowLeft'));
      ortho().dispatchEvent(keydown('ArrowLeft'));
    });
    act(() => {
      ortho().dispatchEvent(pasteEvent('XY'));
    });
    expect(consoleStore.get().line.text).toBe('zoXYom');
  });

  it('leaves the Ctrl-V keydown UNPREVENTED, which is what lets a paste happen', async () => {
    act(() => {
      for (const ch of 'zoom') ortho().dispatchEvent(keydown(ch));
    });
    const event = keydown('v', { ctrlKey: true });
    act(() => {
      ortho().dispatchEvent(event);
    });
    // THE DEFECT THIS TEST EXISTS FOR. preventDefault() here cancels the
    // clipboard read and no `paste` event is ever dispatched.
    expect(event.defaultPrevented).toBe(false);

    // ... and the browser event that follows is what actually pastes.
    act(() => {
      ortho().dispatchEvent(pasteEvent(' polar_contacts'));
    });
    await tick();
    expect(consoleStore.get().line.text).toBe('zoom polar_contacts');
    // The fallback saw the paste land and did not double up.
    expect(call).not.toHaveBeenCalledWith('cmd.paste');
  });

  it('falls back to cmd.paste when no clipboard event follows the chord', async () => {
    act(() => {
      for (const ch of 'zoom') ortho().dispatchEvent(keydown(ch));
    });
    act(() => {
      ortho().dispatchEvent(keydown('v', { ctrlKey: true }));
    });
    expect(call).not.toHaveBeenCalledWith('cmd.paste'); // not synchronously
    await tick();
    expect(call).toHaveBeenCalledWith('cmd.paste');
    expect(consoleStore.get().line.text).toBe('zoom');
  });

  it('takes the CHORD path on an empty line and never calls cmd.paste', async () => {
    expect(consoleStore.get().line.text).toBe('');
    const event = keydown('v', { ctrlKey: true });
    act(() => {
      ortho().dispatchEvent(event);
    });
    await tick();
    // `layer1/Ortho.cpp:1015-1021`: an empty line is OrthoKeyControl, i.e. the
    // user's own CTRL-V binding, not a clipboard read.
    expect(call).toHaveBeenCalledWith('cmd._ctrl', ['V']);
    expect(call).not.toHaveBeenCalledWith('cmd.paste');
    // A chord is a key the app consumed: this one IS prevented.
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a paste event that carries no text at all', async () => {
    act(() => {
      for (const ch of 'zo') ortho().dispatchEvent(keydown(ch));
    });
    const event = pasteEvent('');
    act(() => {
      ortho().dispatchEvent(event);
    });
    expect(consoleStore.get().line.text).toBe('zo');
    expect(event.defaultPrevented).toBe(false);
  });
});
