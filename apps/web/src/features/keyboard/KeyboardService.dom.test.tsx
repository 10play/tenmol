/**
 * The global key bridge, exercised as a mounted component: what actually
 * reaches `sendInput`, and what deliberately does not.
 *
 * The translation itself is tested against `modules/pmg_qt/keymapping.py` in
 * `packages/viewport/src/input/keys.test.ts`; this file tests the wiring —
 * document-level listening, the text-field gate, the browser-reserved escape
 * hatch, and `preventDefault` on Tab.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext } from '../../app';
import type { Session } from '../../app';
import { KeyboardService, isTextEntry } from './KeyboardService';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const sendInput = vi.fn();

function mount(): void {
  act(() => {
    root.render(
      <SessionContext.Provider value={{ conn: { sendInput } } as unknown as Session}>
        <KeyboardService />
      </SessionContext.Provider>,
    );
  });
}

function press(init: KeyboardEventInit & { key: string }, target: EventTarget = window): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

beforeEach(() => {
  sendInput.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The last frame handed to the transport. */
function last(): Record<string, unknown> {
  return sendInput.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe('KeyboardService', () => {
  it('forwards a special key with state -2 and the modifier mask', () => {
    press({ key: 'PageUp', ctrlKey: true });
    expect(last()).toMatchObject({
      t: 'input',
      kind: 'button',
      button: 104,
      state: -2,
      x: 0,
      y: 0,
      mod: 2,
    });
  });

  it('forwards Ctrl-A as the control code, not as the letter', () => {
    press({ key: 'a', code: 'KeyA', ctrlKey: true });
    expect(last()).toMatchObject({ button: 1, state: -1, mod: 2 });
  });

  it('forwards Alt-3 as the raw uppercase code (ALT-3 attaches a sulfone)', () => {
    press({ key: '3', code: 'Digit3', altKey: true });
    expect(last()).toMatchObject({ button: 51, state: -1, mod: 4 });
  });

  it('preventDefaults Tab so it reaches PyMOL completion instead of moving focus', () => {
    expect(press({ key: 'Tab' })).toBe(true);
    expect(last()).toMatchObject({ button: 9, state: -1 });
  });

  it('does not forward a keystroke aimed at a text field', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press({ key: 'a', code: 'KeyA' }, input);
    expect(sendInput).not.toHaveBeenCalled();
    input.remove();
  });

  it('does forward from a checkbox, which does not consume printable keys', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.appendChild(box);
    press({ key: ' ', code: 'Space' }, box);
    expect(last()).toMatchObject({ button: 32, state: -1 });
    box.remove();
  });

  it('leaves reload and the devtools chords to the browser', () => {
    expect(press({ key: 'r', code: 'KeyR', ctrlKey: true })).toBe(false);
    expect(press({ key: 'F5' })).toBe(false);
    expect(press({ key: 'F12' })).toBe(false);
    expect(press({ key: 'i', code: 'KeyI', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(sendInput).not.toHaveBeenCalled();
    // but CTRL-T, which PyMOL binds to `bond;unpick`, IS forwarded
    press({ key: 't', code: 'KeyT', ctrlKey: true });
    expect(last()).toMatchObject({ button: 20, state: -1, mod: 2 });
  });

  it('ignores a bare modifier press and an already-handled event', () => {
    press({ key: 'Shift', shiftKey: true });
    press({ key: 'Control', ctrlKey: true });
    expect(sendInput).not.toHaveBeenCalled();

    const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(sendInput).not.toHaveBeenCalled();
  });

  it('stops listening when it unmounts', () => {
    act(() => root.unmount());
    press({ key: 'Home' });
    expect(sendInput).not.toHaveBeenCalled();
    // re-mount so afterEach's unmount is a no-op rather than an error
    root = createRoot(container);
    mount();
  });
});

describe('isTextEntry', () => {
  it('recognises the elements that own their own text editing', () => {
    const make = (html: string): HTMLElement => {
      const host = document.createElement('div');
      host.innerHTML = html;
      return host.firstElementChild as HTMLElement;
    };
    expect(isTextEntry(make('<input type="text">'))).toBe(true);
    expect(isTextEntry(make('<textarea></textarea>'))).toBe(true);
    expect(isTextEntry(make('<select></select>'))).toBe(true);
    expect(isTextEntry(make('<input type="checkbox">'))).toBe(false);
    expect(isTextEntry(make('<button></button>'))).toBe(false);
    expect(isTextEntry(make('<div></div>'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
