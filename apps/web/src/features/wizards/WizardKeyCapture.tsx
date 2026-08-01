/**
 * `do_key` / `do_special` input for the wizards that implement a hand-rolled
 * line editor.
 *
 * `WizardDoKey(k,x,y,mod)` (`layer5/PyMOL.cpp:2356` -> `layer1/Wizard.cpp:328`)
 * passes an **ASCII int**, and the implementers compare against exactly these:
 * 8/127 backspace, 10/13 enter, 27 escape, 32 space, `> 32` printable
 * (`pseudoatom.py:20-36`, `renaming.py:20-39`, `box.py:423-437`,
 * `command.py:166-178`). `x`/`y` are cursor coordinates and every implementer
 * ignores them. `mod` is the cOrtho bitmask SHIFT=1 CTRL=2 ALT=4.
 *
 * No wizard in the tree implements `do_special` (verified), so the special
 * bit (8) is honoured but nothing is sent unless a wizard asks for it.
 *
 * This only mounts while the wizard's event mask actually has the key bit —
 * which is state-dependent: `box.py:398-403` adds it only while renaming, and
 * `command.py:149-152` returns 0 unless text is being entered. Grabbing the
 * keyboard unconditionally would steal every keystroke from the command line.
 */

import { useEffect, useRef } from 'react';
import { WIZARD_EVENT_BITS } from '@tenmol/protocol';

/** Browser `KeyboardEvent` -> the ASCII int PyMOL's wizards compare against. */
export function asciiFor(event: {
  key: string;
  ctrlKey?: boolean;
}): number | null {
  switch (event.key) {
    case 'Backspace':
      return 8;
    case 'Enter':
      return 13;
    case 'Escape':
      return 27;
    case 'Tab':
      return null; // Tab is the command line's completion key, never a wizard's
    default:
      break;
  }
  if (event.key.length !== 1) return null;
  const code = event.key.charCodeAt(0);
  if (event.ctrlKey) {
    // Control characters, the way a terminal produces them.
    const upper = event.key.toUpperCase().charCodeAt(0);
    if (upper >= 64 && upper < 96) return upper - 64;
  }
  return code;
}

/** cOrtho modifier bitmask (`layer0/os_gl_glut_pretend.h`): SHIFT 1 CTRL 2 ALT 4. */
export function modifiersFor(event: {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): number {
  return (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.altKey ? 4 : 0);
}

export interface WizardKeyCaptureProps {
  eventMask: number;
  onKey(k: number, mod: number): void;
}

export function WizardKeyCapture({ eventMask, onKey }: WizardKeyCaptureProps) {
  const wantsKeys = (eventMask & WIZARD_EVENT_BITS.key) !== 0;
  const ref = useRef<HTMLInputElement>(null);
  const handler = useRef(onKey);
  handler.current = onKey;

  useEffect(() => {
    if (!wantsKeys) return;
    ref.current?.focus();
  }, [wantsKeys]);

  if (!wantsKeys) return null;

  return (
    <div className="wizkeys" data-testid="wizard-keys">
      <label className="wizkeys__label" htmlFor="wizard-key-capture">
        this wizard is reading the keyboard (event_mask_key)
      </label>
      <input
        id="wizard-key-capture"
        ref={ref}
        className="wizkeys__input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="type here"
        // The value lives in the wizard, not here: `get_prompt()` renders the
        // text plus its own fake caret (`pseudoatom.py:38-40`).
        value=""
        onChange={() => {}}
        onKeyDown={(event) => {
          const k = asciiFor(event);
          if (k === null) return;
          event.preventDefault();
          handler.current(k, modifiersFor(event));
        }}
      />
    </div>
  );
}
