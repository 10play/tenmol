/**
 * The in-viewport console — PyMOL's OWN console, not the Qt one.
 *
 * `packages/stores/src/feedback.ts` models the External GUI pane (Qt's
 * `feedback_browser`: a big, scrollable, 5,000-line client-side scrollback).
 * THIS file models the other console, the one `layer1/Ortho.cpp` draws over the
 * scene: a 256-line ring, a 256-entry history ring, a line editor with PyMOL's
 * exact cursor semantics, and the overlay arithmetic that decides how many of
 * those 256 lines are visible at any moment.
 *
 * They are genuinely two different widgets with different rules, and a user of
 * the Qt build sees both at once. Sharing one store would have meant picking
 * one widget's cap (256 or 5,000) and one widget's visibility rule; instead the
 * ortho ring is fed FROM the feedback stream and keeps its own.
 *
 * Everything below is a port with a `layer1/Ortho.cpp` line number. The parts
 * that look wrong are wrong upstream, and are marked:
 *
 *  - `OrthoGetNumberOverlayLines` subtracts `internal_feedback - 1` from the
 *    auto-overlay count but not from the explicit one (`:1594-1613`).
 *  - `OrthoSpecial`'s RIGHT arrow, from "cursor at end" (`CursorChar == -1`),
 *    jumps to `CurChar - 1` — i.e. one character BACKWARDS (`:1105-1113`).
 *  - `OrthoKey` treats DEL and Ctrl-D identically when the line is empty or the
 *    text is hidden: both become the `CTRL-D` chord (`:882-885`, `:919-923`).
 *
 * NOTHING HERE TALKS TO THE BRIDGE. The store is a pure state machine over
 * plain data so every rule above is testable under node with no DOM and no
 * socket; the wiring lives in `apps/web/src/features/console/consoleSource.ts`.
 */

import {
  CONSOLE_SETTING_DEFAULTS,
  ORTHO_HISTORY_LINES,
  ORTHO_PROMPT,
  ORTHO_SAVE_LINES,
  wrapOutput,
  type ConsoleSettings,
} from '@tenmol/protocol/topics/console';
import { createStore, type Store } from './createStore';

export type { ConsoleSettings };

/* ------------------------------------------------------------------ *
 * Lines
 * ------------------------------------------------------------------ */

/**
 * How `OrthoDrawText` colours a line (`layer1/Ortho.cpp:1658-1673`).
 *
 *   prompt  — starts with `PyMOL>` (`strncmp(str, I->Prompt, 6) == 0`).
 *             Drawn in `TextColor`.
 *   output  — everything else. Drawn in `OverlayColor`, the inverse of the
 *             background (`:1876-1880`).
 *
 * That is the WHOLE of PyMOL's in-viewport classification: there is no error
 * colour in the ortho console, because severity is gone before the string ever
 * reaches the queue (`modules/pymol/colorprinting.py` — `error`, `warning`,
 * `suggest` and `parrot` are all bare `print`).
 */
export type OrthoLineKind = 'prompt' | 'output';

export interface OrthoLine {
  /** Monotonic; equals the `I->CurLine` value the line was written at. */
  seq: number;
  text: string;
  kind: OrthoLineKind;
}

/** `strncmp(str, I->Prompt, 6) == 0` (`layer1/Ortho.cpp:1661`). */
export function orthoLineKind(text: string): OrthoLineKind {
  return text.startsWith(ORTHO_PROMPT) ? 'prompt' : 'output';
}

/* ------------------------------------------------------------------ *
 * The line editor
 * ------------------------------------------------------------------ */

/**
 * The typed line, in PROMPT-RELATIVE coordinates.
 *
 * PyMOL stores the prompt and the typed text in one buffer and keeps
 * `PromptChar` as the offset of the first typed character; every bound in
 * `OrthoKey` is written against that offset. Here `text` is the typed part
 * only, so `PromptChar` is 0 and every comparison simplifies by exactly that
 * constant — the behaviour is identical and the arithmetic is readable.
 *
 * `cursor` is `I->CursorChar`: `-1` means "at the end of the line", which is
 * both the initial state and what Ctrl-E, Tab and history recall restore.
 */
export interface LineEdit {
  text: string;
  cursor: number;
}

export const EMPTY_LINE: LineEdit = { text: '', cursor: -1 };

/** Where the caret really is when `cursor` is the sentinel `-1`. */
export function caretIndex(line: LineEdit): number {
  return line.cursor < 0 ? line.text.length : line.cursor;
}

/** `add_normal_char` (`layer1/Ortho.cpp:822-838`). */
export function insertChar(line: LineEdit, ch: string): LineEdit {
  if (line.cursor >= 0) {
    const at = Math.min(line.cursor, line.text.length);
    return {
      text: line.text.slice(0, at) + ch + line.text.slice(at),
      cursor: line.cursor + ch.length,
    };
  }
  return { text: line.text + ch, cursor: -1 };
}

/** `case 8: backspace` (`layer1/Ortho.cpp:892-908`). Never past the prompt. */
export function backspace(line: LineEdit): LineEdit {
  if (line.text.length === 0) return line;
  if (line.cursor >= 0) {
    if (line.cursor <= 0) return line; // `if (I->CursorChar > I->PromptChar)`
    return {
      text: line.text.slice(0, line.cursor - 1) + line.text.slice(line.cursor),
      cursor: line.cursor - 1,
    };
  }
  return { text: line.text.slice(0, -1), cursor: -1 };
}

/**
 * Delete-forward, shared by DEL (`:876-891`) and Ctrl-D (`:919-931`).
 *
 * Both are guarded by `CursorChar >= 0 && CursorChar < CurChar`, so with the
 * cursor at the end (`-1`) NEITHER key deletes anything — DEL at the end of a
 * line is a no-op in PyMOL's console, which surprises people but is the
 * behaviour.
 */
export function deleteForward(line: LineEdit): LineEdit {
  if (line.cursor < 0 || line.cursor >= line.text.length) return line;
  return {
    text: line.text.slice(0, line.cursor) + line.text.slice(line.cursor + 1),
    cursor: line.cursor,
  };
}

/** Ctrl-A (`layer1/Ortho.cpp:911-917`): only moves when there IS text. */
export function home(line: LineEdit): LineEdit {
  if (line.text.length === 0) return line;
  return { ...line, cursor: 0 };
}

/** Ctrl-E (`layer1/Ortho.cpp:904-910`). */
export function end(line: LineEdit): LineEdit {
  return { ...line, cursor: -1 };
}

/** Ctrl-K (`layer1/Ortho.cpp:1000-1008`): truncate at the cursor, then unpin. */
export function truncate(line: LineEdit): LineEdit {
  if (line.cursor < 0) return line;
  return { text: line.text.slice(0, line.cursor), cursor: -1 };
}

/** LEFT (`OrthoSpecial`, `layer1/Ortho.cpp:1095-1104`). */
export function cursorLeft(line: LineEdit): LineEdit {
  let cursor = line.cursor >= 0 ? line.cursor - 1 : line.text.length - 1;
  if (cursor < 0) cursor = 0;
  return { ...line, cursor };
}

/**
 * RIGHT (`OrthoSpecial`, `layer1/Ortho.cpp:1105-1113`).
 *
 * UPSTREAM QUIRK, PRESERVED: from the "at end" sentinel the branch is the same
 * `CursorChar = CurChar - 1` as LEFT, so the first RIGHT press after typing
 * moves the caret one character LEFT. Only subsequent presses advance.
 */
export function cursorRight(line: LineEdit): LineEdit {
  let cursor = line.cursor >= 0 ? line.cursor + 1 : line.text.length - 1;
  if (cursor > line.text.length) cursor = line.text.length;
  if (cursor < 0) cursor = 0;
  return { ...line, cursor };
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export interface ConsoleState {
  /** The 256-line ring, oldest first. */
  lines: readonly OrthoLine[];
  /** `I->CurLine`: monotonic, never wrapped. Compared with `AutoOverlayStopLine`. */
  curLine: number;
  /** `I->AutoOverlayStopLine` (`layer1/Ortho.cpp:85`). */
  autoOverlayStopLine: number;
  /**
   * `I->SplashFlag` (`layer1/Ortho.cpp:1638`) — forces the WHOLE scrollback
   * visible until the first click (`OrthoRemoveSplash` from `OrthoButton`,
   * `:2523`) or Esc (`:966-968`).
   *
   * DEFAULTS TO FALSE HERE, and that is a considered departure. PyMOL raises
   * the flag at startup so its banner is readable over an empty scene; by the
   * time a browser connects, that banner has already been drained out of
   * `cmd._get_feedback()` by the bridge and is sitting in the External GUI
   * pane. Starting at `true` would therefore not reproduce the splash — it
   * would just cover the viewport with 26 lines of history on every page load.
   * The flag and both ways of clearing it are kept, so a feature that really
   * does raise a splash gets the real behaviour.
   */
  splash: boolean;
  /** `I->ShowLines` = viewport height / cOrthoLineHeight (`:2380`). */
  showLines: number;
  /** The eight settings the console reads. */
  settings: ConsoleSettings;
  /** The line being typed. */
  line: LineEdit;
  /** `I->History[]`, oldest first, capped at 256. */
  history: readonly string[];
  /** `I->HistoryView` as an index into `history`; `history.length` = "new line". */
  historyView: number;
  /** Text stashed in the scratch slot when history browsing started. */
  historyScratch: string;
  /**
   * CLIENT-ONLY: whether the web client draws PyMOL's in-viewport console at
   * all. Not a PyMOL setting — PyMOL always draws it and hides it by driving
   * `internal_feedback`/`text`/`overlay` to 0. The web client needs a way to
   * get the whole overlay out of the way (it sits on top of the viewport's
   * pick surface) without writing settings that change `cmd.get_viewport()`.
   */
  visible: boolean;
}

export interface ConsoleStore extends Store<ConsoleState> {
  /** Lines drained from PyMOL. Already wrapped by `OrthoAddOutput`. */
  addOutput(lines: readonly string[]): void;
  /** A client-origin line, wrapped locally the way `OrthoAddOutput` would. */
  addLocalOutput(text: string): void;
  setSettings(settings: Partial<ConsoleSettings>): void;
  setShowLines(n: number): void;
  setVisible(visible: boolean): void;
  setLine(line: LineEdit): void;
  /**
   * `OrthoParseCurrentLine` (`layer1/Ortho.cpp:1035-1059`): push to history,
   * clear the line, and cancel the auto-overlay. Returns the submitted text.
   */
  submit(): string;
  /** UP (`OrthoSpecial`, `:1080-1094`). */
  historyBack(): void;
  /** DOWN (`OrthoSpecial`, `:1063-1079`). */
  historyForward(): void;
  /** `OrthoRemoveAutoOverlay` (`:1153`) — called from `OrthoButton`. */
  removeAutoOverlay(): void;
  /** `OrthoRemoveSplash` (`:1160`). */
  removeSplash(): void;
  clear(): void;
}

export interface ConsoleStoreOptions {
  /** Test seam; production leaves this at 256. */
  capacity?: number;
  historyCapacity?: number;
}

export function createConsoleStore(options: ConsoleStoreOptions = {}): ConsoleStore {
  const capacity = options.capacity ?? ORTHO_SAVE_LINES;
  const historyCapacity = options.historyCapacity ?? ORTHO_HISTORY_LINES;

  const store = createStore<ConsoleState>({
    lines: [],
    curLine: 0,
    autoOverlayStopLine: 0,
    splash: false,
    showLines: 24,
    settings: { ...CONSOLE_SETTING_DEFAULTS },
    line: EMPTY_LINE,
    history: [],
    historyView: 0,
    historyScratch: '',
    visible: true,
  });

  function push(state: ConsoleState, texts: readonly string[]): Partial<ConsoleState> {
    const lines = [...state.lines];
    let curLine = state.curLine;
    for (const text of texts) {
      lines.push({ seq: curLine, text, kind: orthoLineKind(text) });
      curLine++;
    }
    const overflow = Math.max(0, lines.length - capacity);
    return { lines: overflow > 0 ? lines.slice(overflow) : lines, curLine };
  }

  return {
    ...store,

    addOutput(incoming: readonly string[]): void {
      if (incoming.length === 0) return;
      store.set((state) => push(state, incoming));
    },

    addLocalOutput(text: string): void {
      store.set((state) => push(state, wrapOutput(text, state.settings.wrap_output)));
    },

    setSettings(settings: Partial<ConsoleSettings>): void {
      store.set((state) => ({ settings: { ...state.settings, ...settings } }));
    },

    setShowLines(n: number): void {
      store.set({ showLines: Math.max(1, Math.floor(n)) });
    },

    setVisible(visible: boolean): void {
      store.set({ visible });
    },

    setLine(line: LineEdit): void {
      store.set({ line });
    },

    submit(): string {
      const state = store.get();
      const text = state.line.text;
      // `if (buffer[0])` (`layer1/Ortho.cpp:1044`) — an empty line is not
      // pushed to history and does not scroll the console.
      if (text === '') {
        store.set({ line: EMPTY_LINE });
        return '';
      }
      const history = [...state.history, text];
      if (history.length > historyCapacity) history.splice(0, history.length - historyCapacity);
      store.set({
        line: EMPTY_LINE,
        history,
        historyView: history.length,
        historyScratch: '',
        // `OrthoRemoveAutoOverlay` at the top of `OrthoParseCurrentLine`.
        autoOverlayStopLine: state.curLine,
      });
      return text;
    },

    historyBack(): void {
      store.set((state) => {
        if (state.history.length === 0) return {};
        const atNewLine = state.historyView >= state.history.length;
        const scratch = atNewLine ? state.line.text : state.historyScratch;
        const view = Math.max(0, state.historyView - 1);
        return {
          historyView: view,
          historyScratch: scratch,
          line: { text: state.history[view] ?? '', cursor: -1 },
        };
      });
    },

    historyForward(): void {
      store.set((state) => {
        if (state.historyView >= state.history.length) return {};
        const view = state.historyView + 1;
        return {
          historyView: view,
          line: {
            text: view >= state.history.length ? state.historyScratch : (state.history[view] ?? ''),
            cursor: -1,
          },
        };
      });
    },

    removeAutoOverlay(): void {
      store.set((state) => ({ autoOverlayStopLine: state.curLine }));
    },

    removeSplash(): void {
      store.set({ splash: false });
    },

    clear(): void {
      // `OrthoClear` (`layer1/Ortho.cpp:479-489`) blanks the ring but keeps
      // `CurLine` and the history.
      store.set({ lines: [] });
    },
  };
}

/* ------------------------------------------------------------------ *
 * Visibility — the overlay arithmetic
 * ------------------------------------------------------------------ */

/** `OrthoTextVisible` (`layer1/Ortho.cpp:393-398`). */
export function textVisible(settings: ConsoleSettings): boolean {
  return Boolean(settings.internal_feedback || settings.text || settings.overlay);
}

/** `OrthoArrowsGrabbed` (`layer1/Ortho.cpp:401-407`). */
export function arrowsGrabbed(state: ConsoleState): boolean {
  return state.line.text.length > 0 && textVisible(state.settings);
}

/**
 * `OrthoGetOverlayStatus` (`layer1/Ortho.cpp:411-423`).
 * Returns the `overlay` setting, or `-1` meaning "auto overlay is active".
 */
export function overlayStatus(state: ConsoleState): number {
  const overlay = state.settings.overlay;
  if (!overlay && state.settings.auto_overlay > 0 && state.curLine !== state.autoOverlayStopLine) {
    return -1;
  }
  return overlay;
}

/** `OrthoGetNumberOverlayLines` (`layer1/Ortho.cpp:1591-1613`). */
export function numberOverlayLines(state: ConsoleState): number {
  let overlay = overlayStatus(state);
  const internalFeedback = state.settings.internal_feedback;
  if (overlay === -1) {
    overlay = state.curLine - state.autoOverlayStopLine;
    // `if (overlay < 0) overlay += (OrthoSaveLines + 1)` — the C counter is
    // masked into a 256-slot ring, so a wrap shows as a negative difference.
    if (overlay < 0) overlay += ORTHO_SAVE_LINES;
    if (internalFeedback > 1) overlay -= internalFeedback - 1;
    overlay = Math.max(overlay, 0);
  } else if (overlay === 1) {
    overlay = state.settings.overlay_lines;
  }
  return state.settings.text ? 0 : overlay;
}

/**
 * How many lines `OrthoDrawText` actually paints
 * (`layer1/Ortho.cpp:1637-1642`).
 */
export function showLineCount(state: ConsoleState): number {
  if (state.settings.text || state.splash) return state.showLines;
  return state.settings.internal_feedback + numberOverlayLines(state);
}

export interface VisibleOrthoLine extends OrthoLine {
  /**
   * `lcount` in `OrthoDrawText`, 1 = the bottom-most drawn line. Exposed
   * because the prompt-colour rule and the 4 px gap both key off it.
   */
  lcount: number;
  /** The `_` cursor is drawn on `lcount === 1` when `InputFlag` is set. */
  isInput: boolean;
  /** `if (lcount == adjust_at) y += 4` — the internal-feedback separator. */
  gapAbove: boolean;
}

/**
 * The exact set of lines `OrthoDrawText` would draw, bottom-most first.
 *
 * `skip_prompt` (`internal_prompt = 0`) drops the input line from the walk
 * entirely, which is why the count starts one slot higher up the ring
 * (`layer1/Ortho.cpp:1630-1631`, `:1646`).
 */
export function visibleOrthoLines(state: ConsoleState): VisibleOrthoLine[] {
  const skipPrompt = state.settings.internal_prompt ? 0 : 1;
  const adjustAt = state.settings.internal_feedback ? state.settings.internal_feedback + 1 : 0;
  const limit = showLineCount(state);

  // The store keeps the *output* ring; the line being typed is the live prompt
  // line that `OrthoRestorePrompt` writes into slot `CurLine` before drawing.
  const promptLine: OrthoLine = {
    seq: state.curLine,
    text: ORTHO_PROMPT + state.line.text,
    kind: 'prompt',
  };
  const all: OrthoLine[] = [...state.lines, promptLine];

  const out: VisibleOrthoLine[] = [];
  for (let lcount = 1; lcount <= limit; lcount++) {
    const index = all.length - (lcount + skipPrompt);
    if (index < 0) break;
    const line = all[index];
    if (!line) break;
    out.push({
      ...line,
      lcount,
      isInput: lcount === 1 && skipPrompt === 0,
      gapAbove: adjustAt > 0 && lcount === adjustAt,
    });
  }
  return out;
}

/**
 * Which of the two ortho colours a drawn line uses
 * (`layer1/Ortho.cpp:1656-1673`).
 *
 * `overlayIsDark` is `length3f(I->OverlayColor) < 0.5`, i.e. the inverse of the
 * background is itself dark — on a white background, where a prompt line above
 * the internal-feedback band would otherwise be unreadable.
 */
export function orthoLineColor(
  line: Pick<VisibleOrthoLine, 'kind' | 'lcount'>,
  settings: ConsoleSettings,
  overlayIsDark: boolean,
  internalGuiModeDefault = true,
): 'text' | 'overlay' {
  if (!internalGuiModeDefault) return 'overlay';
  if (line.kind !== 'prompt') return 'overlay';
  const adjustAt = settings.internal_feedback ? settings.internal_feedback + 1 : 0;
  if (line.lcount < adjustAt) return 'text';
  return overlayIsDark ? 'overlay' : 'text';
}
