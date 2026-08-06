/**
 * The global keyboard bridge: a document-level `keydown` -> `_button(k, -1|-2,
 * 0, 0, mod)`.
 *
 * WHY DOCUMENT-LEVEL. Qt sends keys from the WINDOW, not from the GL widget
 * (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:50-54`); the widget only takes focus on
 * click. So `home`, `pgup`, `ALT-A` and friends work wherever the pointer is.
 * We match that, with one gate Qt does not need: if focus is inside a text
 * field, the keystroke belongs to that field. Without the gate the console's
 * command line and PyMOL's internal line editor fight over every character
 * (`docs/input-mouse-keyboard.md §16.2`).
 *
 * WHAT THIS DOES NOT DO: decide anything. Translation is
 * `@tenmol/viewport/input`'s `keyEventToButtonArgs`, a port of
 * `packages/engine/modules/pmg_qt/keymapping.py:61-97`; the MEANING of a key is
 * `PyMOL_Key`/`PyMOL_Special` -> `OrthoKey`/`OrthoSpecial` ->
 * `cmd._ctrl`/`_alt`/`_ctsh`/`_special` -> `cmd.key_mappings`, entirely
 * server-side. No shortcut is ever executed in the browser.
 *
 * `keydown` only, never `keyup` (Qt sends on `keyPressEvent`), and auto-repeat
 * is forwarded because Qt forwards it too.
 */

import { useEffect } from 'react';
import { keyEventToButtonArgs } from '../mouse/tables';
import { useSession } from '../../app';

/**
 * Keystrokes we refuse to swallow, because the browser cannot give them back.
 *
 * `preventDefault()` recovers most collisions, but reload and the devtools
 * chords are the difference between a usable application and a trapped tab.
 * PyMOL binds none of these (`packages/engine/modules/pymol/shortcut_dict.py`), so nothing is
 * lost; CTRL-T (`bond;unpick`) and CTRL-F (`wizard find`) ARE bound and ARE
 * forwarded — Chrome still steals CTRL-T, which is the known, documented
 * browser-hijack risk (`input-mouse-keyboard.md §16.2`), not a bug here.
 */
function isBrowserReserved(ev: KeyboardEvent): boolean {
  const cmdKey = ev.ctrlKey || ev.metaKey;
  if (cmdKey && !ev.altKey && ev.key.toLowerCase() === 'r') return true; // reload
  if (cmdKey && ev.shiftKey && ['i', 'j', 'c'].includes(ev.key.toLowerCase())) return true;
  return ev.key === 'F5' || ev.key === 'F11' || ev.key === 'F12';
}

/** Focus is in something that owns its own text editing. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    // Checkboxes and buttons do not consume printable keys.
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return false;
}

/** Headless service that forwards document-level keydowns to the bridge as `_button` calls; renders nothing. */
export function KeyboardService() {
  const session = useSession();

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.defaultPrevented) return;
      if (isTextEntry(ev.target)) return;
      if (isBrowserReserved(ev)) return;

      const args = keyEventToButtonArgs(ev);
      if (args === null) return;

      // Tab must NOT move focus: PyMOL's command line uses it for completion,
      // and Qt installs an event filter to steal it (`pymol_qt_gui.py:440-455`).
      ev.preventDefault();

      session.conn.sendInput({
        t: 'input',
        kind: 'button',
        button: args.k,
        state: args.state,
        x: 0,
        y: 0,
        mod: args.mod,
        // The backend measures nothing on key timing, but the field is part of
        // the input envelope and the bridge logs it; send the real event time.
        when: Date.now() / 1000,
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);

  return null;
}
