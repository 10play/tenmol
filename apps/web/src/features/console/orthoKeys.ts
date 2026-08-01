/**
 * `OrthoKey` / `OrthoSpecial` as a pure function.
 *
 * `layer1/Ortho.cpp:841-1031` (`OrthoKey`) and `:1063-1118` (`OrthoSpecial`)
 * are one big switch over an ASCII code plus a GLUT modifier mask. This module
 * translates a browser `KeyboardEvent` into the same decisions and returns an
 * {@link OrthoAction} for the component to perform — so every branch is
 * testable without a DOM, a bridge or a React tree.
 *
 * THE MODIFIER MAPPING. GLUT gives PyMOL `mod` as a bitmask
 * (`cOrthoSHIFT=1, cOrthoCTRL=2, cOrthoALT=4`) AND a pre-translated `k`: with
 * Ctrl held, the terminal has already turned `A` into 1, `D` into 4, `I` into
 * 9. That is why `OrthoKey`'s cases are control codes and why
 * `OrthoKeyControl` adds 64 to get the letter back. The browser does the
 * opposite — `event.key` stays `'a'` and `event.ctrlKey` is set — so this
 * module re-derives the control code with `charCodeAt(0) - 64` and then follows
 * `OrthoKey` case for case.
 *
 * TWO DELIBERATE DEPARTURES, both because the browser is not GLUT:
 *
 *  1. macOS Cmd is NOT mapped to `cmd._cmmd`. `OrthoKeyCmmd` exists
 *     (`layer1/Ortho.cpp:775-787`) but nothing in this tree ever calls it —
 *     `OrthoKey` has no `mod` branch for it — and Cmd+R / Cmd+W / Cmd+Q are the
 *     browser's, not ours. Cmd is left alone.
 *  2. ALT is only claimed when the key produces no printable character.
 *     On a Mac, Option-G really does produce `@`, which is the exact case
 *     `OrthoKeyAlt` special-cases (`:810-813`); browsers hand us the composed
 *     character, so honouring `event.key` when it is printable IS that
 *     special case, generalised to every layout.
 */

import type { ConsoleSettings } from '@tenmol/protocol/topics/console';
import { arrowsGrabbed, textVisible, type ConsoleState } from '@tenmol/stores/console';

export type OrthoAction =
  /** Printable character insert (`add_normal_char`). */
  | { kind: 'insert'; ch: string }
  /** ENTER with text: `OrthoParseCurrentLine`. */
  | { kind: 'submit' }
  | { kind: 'backspace' }
  /** DEL / Ctrl-D with the cursor inside the line. */
  | { kind: 'deleteForward' }
  | { kind: 'home' }
  | { kind: 'end' }
  | { kind: 'truncate' }
  | { kind: 'left' }
  | { kind: 'right' }
  | { kind: 'historyBack' }
  | { kind: 'historyForward' }
  /** TAB: `PComplete`, and APPLY the completed line. */
  | { kind: 'complete' }
  /** Ctrl-D at the end of a line: `PComplete` "just print, don't complete". */
  | { kind: 'completePrint' }
  /** Ctrl-V with text on the line: `cmd.paste()`. */
  | { kind: 'paste' }
  /** `OrthoCommandIn(...)` / `PParse(...)` — a literal command line. */
  | { kind: 'command'; line: string }
  /** ENTER on an empty line with a movie: needs `count_frames` first. */
  | { kind: 'movieKeyframe'; shift: boolean; ctrl: boolean }
  /** ESC: splash, then `text` / `overlay`, or `_quit` in presentation mode. */
  | { kind: 'escape'; shift: boolean }
  /** The chord fallback: `cmd._ctrl` / `cmd._alt` / `cmd._ctsh`. */
  | { kind: 'chord'; fn: '_ctrl' | '_alt' | '_ctsh'; key: string }
  /** Not ours — let the browser have it. */
  | { kind: 'none' };

/** Just enough of a `KeyboardEvent` to decide, so tests need no DOM. */
export interface OrthoKeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** `OrthoKeyControl(G, k + 64)` — the control code back to a capital letter. */
export function controlChordKey(key: string): string {
  return key.toUpperCase();
}

export function mapOrthoKey(event: OrthoKeyEvent, state: ConsoleState): OrthoAction {
  const { key, ctrlKey, shiftKey, altKey, metaKey } = event;
  const settings = state.settings;
  const empty = state.line.text.length === 0;

  // Cmd/Meta is the browser's. See the header.
  if (metaKey) return { kind: 'none' };

  /* ---- OrthoSpecial: the arrow keys ------------------------------------
   * The gate is in `PyMOL_Special` (`layer5/PyMOL.cpp:2371-2383`), NOT in
   * `OrthoSpecial`, and it is asymmetric: UP/DOWN are grabbed
   * UNCONDITIONALLY, LEFT/RIGHT only when `OrthoArrowsGrabbed`
   * (`layer1/Ortho.cpp:401-407` — text entered AND text visible). An ungrabbed
   * arrow falls through to `_special`, i.e. the movie/scene key bindings
   * (`modules/pymol/shortcut_dict.py`: 'left' -> `_ backward`), which is
   * WP-23's surface — so this module returns `none` and does not eat them.
   *
   * The inventory row summarises this as "Up/Down recall history, Left/Right
   * move the cursor, but only while text is entered and text is visible"; the
   * qualifier only holds for LEFT/RIGHT, and the source wins. */
  if (key === 'ArrowUp') return { kind: 'historyBack' };
  if (key === 'ArrowDown') return { kind: 'historyForward' };
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (!arrowsGrabbed(state)) return { kind: 'none' };
    return key === 'ArrowLeft' ? { kind: 'left' } : { kind: 'right' };
  }

  /* ---- mod == 4 (alt) -> OrthoKeyAlt (`:851-852`) ---------------------- */
  if (altKey && !ctrlKey) {
    // A printable composed character is Option-G producing '@': insert it.
    if (key.length === 1 && key > ' ') return { kind: 'insert', ch: key };
    if (key.length === 1) return { kind: 'chord', fn: '_alt', key };
    return { kind: 'none' };
  }

  /* ---- mod == 3 (ctrl|shift) -> OrthoKeyCtSh (`:853-854`) --------------
   * `OrthoKeyCtSh(G, k + 64)`: with Ctrl+Shift held GLUT still delivers the
   * control code, so `k + 64` is the capital letter. */
  if (ctrlKey && shiftKey) {
    if (key.length === 1) return { kind: 'chord', fn: '_ctsh', key: controlChordKey(key) };
    return { kind: 'none' };
  }

  /* ---- ENTER (`case 13`, `:964-985`) ---------------------------------- */
  if (key === 'Enter') {
    if (!empty) return { kind: 'submit' };
    if (settings.movie_panel || settings.presentation) {
      return { kind: 'movieKeyframe', shift: shiftKey, ctrl: ctrlKey };
    }
    return { kind: 'none' };
  }

  /* ---- ESCAPE (`case 27`, `:955-963` in the switch, `:942-954`) -------- */
  if (key === 'Escape') return { kind: 'escape', shift: shiftKey };

  /* ---- TAB (`case 9`, `:933-948`) ------------------------------------- */
  if (key === 'Tab') {
    // `if (mod & cOrthoCTRL) OrthoKeyControl(k + 64)` -> Ctrl-I is the chord.
    if (ctrlKey) return { kind: 'chord', fn: '_ctrl', key: 'I' };
    return { kind: 'complete' };
  }

  /* ---- BACKSPACE (`case 8`, `:892-908`) ------------------------------- */
  if (key === 'Backspace') return { kind: 'backspace' };

  /* ---- DELETE (`case 127`, `:876-891`) --------------------------------
   * "if the line is empty or the text is hidden, this is the CTRL-D chord". */
  if (key === 'Delete') {
    if (empty || !textVisible(settings)) return { kind: 'chord', fn: '_ctrl', key: 'D' };
    return { kind: 'deleteForward' };
  }

  /* ---- SPACE (`case 32`, `:855-875`) ----------------------------------
   * Only when nothing has been typed AND the arrows are not grabbed. */
  if (key === ' ' && !ctrlKey) {
    if (!arrowsGrabbed(state) && empty) {
      if (shiftKey) return { kind: 'command', line: 'rewind;mplay' };
      return { kind: 'command', line: settings.presentation ? "scene '', next" : 'mtoggle' };
    }
    return { kind: 'insert', ch: ' ' };
  }

  /* ---- the Ctrl-<letter> cases ---------------------------------------- */
  if (ctrlKey && key.length === 1) {
    const upper = controlChordKey(key);
    switch (upper) {
      case 'A': // `case 1` (`:911-917`)
        return arrowsGrabbed(state) ? { kind: 'home' } : { kind: 'chord', fn: '_ctrl', key: 'A' };
      case 'E': // `case 5` (`:904-910`)
        return arrowsGrabbed(state) ? { kind: 'end' } : { kind: 'chord', fn: '_ctrl', key: 'E' };
      case 'D': // `case 4` (`:919-931`)
        if (empty || !textVisible(settings)) return { kind: 'chord', fn: '_ctrl', key: 'D' };
        // Inside the line: delete forward. At the end: print the candidates.
        if (state.line.cursor >= 0 && state.line.cursor < state.line.text.length) {
          return { kind: 'deleteForward' };
        }
        return { kind: 'completePrint' };
      case 'K': // `case 11` (`:1000-1012`)
        if (arrowsGrabbed(state)) return { kind: 'truncate' };
        return { kind: 'chord', fn: '_ctrl', key: 'K' };
      case 'M': // `case 13` — Ctrl-M IS carriage return
        return empty ? { kind: 'none' } : { kind: 'submit' };
      case 'V': // `case 22` (`:1013-1024`)
        // NOTE THE DIRECTION: paste only when something has been typed;
        // on an EMPTY line Ctrl-V is the `editing_ring paste` chord.
        return empty ? { kind: 'chord', fn: '_ctrl', key: 'V' } : { kind: 'paste' };
      case 'I': // `case 9` with cOrthoCTRL
        return { kind: 'chord', fn: '_ctrl', key: 'I' };
      default:
        // `default: OrthoKeyControl(G, k + 64)` (`:1025-1027`).
        return { kind: 'chord', fn: '_ctrl', key: upper };
    }
  }

  /* ---- printable (`(k > 32) && (k != 127)`, `:855`) -------------------- */
  if (key.length === 1 && key > ' ') return { kind: 'insert', ch: key };

  return { kind: 'none' };
}

/**
 * `case 13` on an empty line with a movie (`layer1/Ortho.cpp:966-984`).
 * Split out because the component must ask `cmd.count_frames()` first —
 * `MovieGetLength(G)` guards the whole branch.
 */
export function movieKeyframeCommand(
  action: Extract<OrthoAction, { kind: 'movieKeyframe' }>,
  settings: ConsoleSettings,
): string {
  if (action.shift) {
    return action.ctrl ? 'mview toggle_interp,quiet=1,object=same' : 'mview toggle_interp,quiet=1';
  }
  if (action.ctrl) return 'mview toggle,freeze=1,quiet=1';
  return settings.presentation ? 'mtoggle' : 'mview toggle,quiet=1';
}
