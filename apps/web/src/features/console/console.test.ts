/**
 * WP-11 console: the pure half.
 *
 * Every expectation here is a line of C++ or Python in this tree, or a value
 * MEASURED against the bridge on 127.0.0.1:8802 (PyMOL 3.2.0a) and quoted in
 * the test name. Nothing is asserted because "it seemed right".
 */

import { describe, expect, it } from 'vitest';
import {
  ANSI_PALETTE,
  CONSOLE_SETTING_DEFAULTS,
  CONSOLE_SETTING_NAMES,
  ORTHO_SAVE_LINES,
  consoleSettingByIndex,
  hasAnsiEscapes,
  parseAnsi,
  stripAnsiEscapes,
  wrapOutput,
} from '@tenmol/protocol/topics/console';
import {
  backspace,
  createConsoleStore,
  cursorLeft,
  cursorRight,
  deleteForward,
  end,
  home,
  insertChar,
  numberOverlayLines,
  orthoLineColor,
  orthoLineKind,
  showLineCount,
  textVisible,
  truncate,
  visibleOrthoLines,
  type ConsoleState,
} from '@tenmol/stores/console';
import { mapOrthoKey, movieKeyframeCommand } from './orthoKeys';
import {
  dragEnterPreview,
  dragLeaveRestore,
  dropNeedsUpload,
  droppedText,
  NO_PREVIEW,
} from './dragPreview';
import { adoptSettings, BRIDGE_ZEROED } from './settingsAdopt';

const ESC = '\u001b';

function key(
  k: string,
  mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {},
) {
  return { key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}

/* ------------------------------------------------------------------ *
 * ANSI  (packages/engine/layer0/Util.cpp:238-250, packages/engine/layer1/Ortho.cpp:1148-1150)
 * ------------------------------------------------------------------ */

describe('ANSI escapes', () => {
  it('strips exactly what UtilStripANSIEscapes strips', () => {
    // The measured colored_feedback=1 line, verbatim off the wire.
    expect(stripAnsiEscapes(`${ESC}[31mRED${ESC}[0m plain`)).toBe('RED plain');
    expect(stripAnsiEscapes('no escapes here')).toBe('no escapes here');
    expect(stripAnsiEscapes(`a${ESC}[1;32mb`)).toBe('ab');
    // Multi-parameter sequences: every byte in [0x20,0x40) is consumed.
    expect(stripAnsiEscapes(`${ESC}[38;5;208mX`)).toBe('X');
  });

  it('detects escapes, so the common line allocates nothing', () => {
    expect(hasAnsiEscapes(' Executive: object "ala" created.')).toBe(false);
    expect(hasAnsiEscapes(`${ESC}[31mRED`)).toBe(true);
  });

  it('splits a coloured line into runs with the xterm palette', () => {
    const spans = parseAnsi(`${ESC}[31mRED${ESC}[0m plain`);
    expect(spans.map((s) => s.text)).toEqual(['RED', ' plain']);
    expect(spans[0]?.fg).toBe(1);
    expect(ANSI_PALETTE[1]).toBe('#cd0000');
    expect(spans[1]?.fg).toBe(null);
  });

  it('handles bold/underline, 256-colour and reset-to-default', () => {
    const spans = parseAnsi(`${ESC}[1;4;38;5;208mX${ESC}[mY`);
    expect(spans[0]?.bold).toBe(true);
    expect(spans[0]?.underline).toBe(true);
    expect(spans[0]?.fg).toBe(208);
    expect(spans[1]?.text).toBe('Y');
    expect(spans[1]?.bold).toBe(false);
  });

  it('returns one span for a plain line', () => {
    expect(parseAnsi('hello')).toEqual([
      expect.objectContaining({ text: 'hello', fg: null, bg: null }),
    ]);
  });

  it('drops a non-SGR sequence instead of printing it', () => {
    expect(parseAnsi(`a${ESC}[2Jb`).map((s) => s.text)).toEqual(['ab']);
  });
});

/* ------------------------------------------------------------------ *
 * wrap_output  (packages/engine/layer1/Ortho.cpp:1080-1118)
 * ------------------------------------------------------------------ */

describe('wrapOutput', () => {
  it('reproduces the measured 2-character wrap (wrap_output is REC_b)', () => {
    // set wrap_output, 20; print("ABCDEFGH") gave "A","BC","DE","FG","H".
    expect(wrapOutput('ABCDEFGH', 1)).toEqual(['A', 'BC', 'DE', 'FG', 'H']);
  });

  it('does not wrap when wrap_output is 0', () => {
    expect(wrapOutput('ABCDEFGH', 0)).toEqual(['ABCDEFGH']);
  });

  it('breaks on \\n and \\r whatever wrap_output says', () => {
    expect(wrapOutput('a\nb\r\nc', 0)).toEqual(['a', 'b', '', 'c']);
  });

  it('applies the OrthoLineLength - 6 fail-safe even with wrapping off', () => {
    const parts = wrapOutput('x'.repeat(40), 0, 12);
    expect(parts.every((p) => p.length <= 6)).toBe(true);
    expect(parts.join('')).toBe('x'.repeat(40));
  });
});

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

describe('console settings', () => {
  it('carries the real SettingInfo.h indices', () => {
    expect(consoleSettingByIndex(191)).toBe('wrap_output');
    expect(consoleSettingByIndex(313)).toBe('internal_prompt');
    expect(consoleSettingByIndex(764)).toBe('colored_feedback');
    expect(consoleSettingByIndex(61)).toBe('overlay');
    expect(consoleSettingByIndex(62)).toBe('text');
    expect(consoleSettingByIndex(999999)).toBe(null);
  });

  it('has a default for every polled name', () => {
    for (const name of CONSOLE_SETTING_NAMES) {
      expect(CONSOLE_SETTING_DEFAULTS[name]).toBeTypeOf('number');
    }
  });
});

/* ------------------------------------------------------------------ *
 * The 256-line ring
 * ------------------------------------------------------------------ */

describe('the ortho scrollback ring', () => {
  it('holds exactly OrthoSaveLines entries and drops the oldest', () => {
    const store = createConsoleStore();
    store.addOutput(Array.from({ length: 300 }, (_, i) => `line ${i}`));
    const state = store.get();
    expect(ORTHO_SAVE_LINES).toBe(256);
    expect(state.lines).toHaveLength(256);
    expect(state.lines[0]?.text).toBe('line 44');
    expect(state.lines[255]?.text).toBe('line 299');
    // CurLine keeps counting past the ring, because auto_overlay is computed
    // from the difference (packages/engine/layer1/Ortho.cpp:1596-1600).
    expect(state.curLine).toBe(300);
  });

  it('classifies a line the way OrthoDrawText does: prompt vs everything else', () => {
    expect(orthoLineKind('PyMOL>fragment ala')).toBe('prompt');
    expect(orthoLineKind(' Executive: object "ala" created.')).toBe('output');
    expect(orthoLineKind(' Error: Invalid selection name "x".')).toBe('output');
  });

  it('wraps a client-origin line with the current wrap_output', () => {
    const store = createConsoleStore();
    store.setSettings({ wrap_output: 1 });
    store.addLocalOutput('ABCDE');
    expect(store.get().lines.map((l) => l.text)).toEqual(['A', 'BC', 'DE']);
  });
});

/* ------------------------------------------------------------------ *
 * Overlay arithmetic  (packages/engine/layer1/Ortho.cpp:1591-1642)
 * ------------------------------------------------------------------ */

function stateWith(patch: Partial<ConsoleState>): ConsoleState {
  const store = createConsoleStore();
  store.set(patch);
  return store.get();
}

describe('overlay / auto_overlay / text', () => {
  it('draws internal_feedback lines and nothing else by default', () => {
    const state = stateWith({});
    expect(showLineCount(state)).toBe(1);
    expect(numberOverlayLines(state)).toBe(0);
  });

  it('overlay=1 means "overlay_lines lines"', () => {
    const state = stateWith({
      settings: { ...CONSOLE_SETTING_DEFAULTS, overlay: 1, overlay_lines: 5 },
    });
    expect(numberOverlayLines(state)).toBe(5);
    expect(showLineCount(state)).toBe(6);
  });

  it('overlay=N (N>1) is used literally', () => {
    const state = stateWith({ settings: { ...CONSOLE_SETTING_DEFAULTS, overlay: 9 } });
    expect(numberOverlayLines(state)).toBe(9);
  });

  it('text=1 forces the full ShowLines and zero overlay lines', () => {
    const state = stateWith({
      showLines: 40,
      settings: { ...CONSOLE_SETTING_DEFAULTS, text: 1, overlay: 1 },
    });
    expect(numberOverlayLines(state)).toBe(0);
    expect(showLineCount(state)).toBe(40);
  });

  it('auto_overlay shows exactly the lines printed since the last click', () => {
    const store = createConsoleStore();
    store.set({ splash: false });
    store.setSettings({ auto_overlay: 1, internal_feedback: 1 });
    store.removeAutoOverlay();
    store.addOutput(['a', 'b', 'c']);
    expect(numberOverlayLines(store.get())).toBe(3);
    // `OrthoRemoveAutoOverlay` from `OrthoButton` (packages/engine/layer1/Ortho.cpp:2524).
    store.removeAutoOverlay();
    expect(numberOverlayLines(store.get())).toBe(0);
  });

  it('auto_overlay subtracts internal_feedback - 1 (the upstream asymmetry)', () => {
    const store = createConsoleStore();
    store.set({ splash: false });
    store.setSettings({ auto_overlay: 1, internal_feedback: 3 });
    store.removeAutoOverlay();
    store.addOutput(['a', 'b', 'c', 'd']);
    expect(numberOverlayLines(store.get())).toBe(2);
  });

  it('the splash forces the whole scrollback visible until it is removed', () => {
    // The store starts with `splash: false` on purpose (see its doc comment):
    // the bridge has already drained PyMOL's banner before a browser connects,
    // so a `true` default would just bury the viewport on every page load.
    // The flag itself still behaves exactly as `packages/engine/layer1/Ortho.cpp:1638` does.
    const store = createConsoleStore();
    store.setShowLines(30);
    expect(showLineCount(store.get())).toBe(1);
    store.set({ splash: true });
    expect(showLineCount(store.get())).toBe(30);
    store.removeSplash();
    expect(showLineCount(store.get())).toBe(1);
  });

  it('OrthoTextVisible is the OR of internal_feedback, text and overlay', () => {
    expect(textVisible({ ...CONSOLE_SETTING_DEFAULTS })).toBe(true);
    expect(textVisible({ ...CONSOLE_SETTING_DEFAULTS, internal_feedback: 0 })).toBe(false);
    expect(textVisible({ ...CONSOLE_SETTING_DEFAULTS, internal_feedback: 0, overlay: 1 })).toBe(
      true,
    );
  });
});

describe('visibleOrthoLines', () => {
  it('walks back from the prompt line, newest first', () => {
    const store = createConsoleStore();
    store.set({ splash: false });
    store.setSettings({ internal_feedback: 4 });
    store.addOutput(['one', 'two', 'three']);
    store.setLine({ text: 'zoom', cursor: -1 });
    const lines = visibleOrthoLines(store.get());
    expect(lines.map((l) => l.text)).toEqual(['PyMOL>zoom', 'three', 'two', 'one']);
    expect(lines[0]?.isInput).toBe(true);
  });

  it('internal_prompt=0 hides the input line entirely', () => {
    const store = createConsoleStore();
    store.set({ splash: false });
    store.setSettings({ internal_feedback: 3, internal_prompt: 0 });
    store.addOutput(['one', 'two', 'three']);
    store.setLine({ text: 'zoom', cursor: -1 });
    const lines = visibleOrthoLines(store.get());
    expect(lines.map((l) => l.text)).toEqual(['three', 'two', 'one']);
    expect(lines.every((l) => !l.isInput)).toBe(true);
  });

  it('draws nothing when internal_feedback, text and overlay are all 0', () => {
    const store = createConsoleStore();
    store.set({ splash: false });
    store.setSettings({ internal_feedback: 0 });
    store.addOutput(['one']);
    expect(visibleOrthoLines(store.get())).toEqual([]);
  });

  it('colours the prompt line TextColor and output OverlayColor', () => {
    const settings = { ...CONSOLE_SETTING_DEFAULTS, internal_feedback: 1 };
    expect(orthoLineColor({ kind: 'prompt', lcount: 1 }, settings, false)).toBe('text');
    expect(orthoLineColor({ kind: 'output', lcount: 2 }, settings, false)).toBe('overlay');
    // A prompt line ABOVE the internal-feedback band on a light background
    // falls back to the overlay colour (`packages/engine/layer1/Ortho.cpp:1666-1671`).
    expect(orthoLineColor({ kind: 'prompt', lcount: 3 }, settings, true)).toBe('overlay');
    // internal_gui_mode != Default paints everything in OverlayColor (`:1659`).
    expect(orthoLineColor({ kind: 'prompt', lcount: 1 }, settings, false, false)).toBe('overlay');
  });
});

/* ------------------------------------------------------------------ *
 * The line editor  (packages/engine/layer1/Ortho.cpp:822-1031)
 * ------------------------------------------------------------------ */

describe('the ortho line editor', () => {
  it('inserts at the end when the cursor is unpinned', () => {
    expect(insertChar({ text: 'zoo', cursor: -1 }, 'm')).toEqual({ text: 'zoom', cursor: -1 });
  });

  it('inserts at the cursor and advances it', () => {
    expect(insertChar({ text: 'zom', cursor: 2 }, 'o')).toEqual({ text: 'zoom', cursor: 3 });
  });

  it('never backspaces past the prompt', () => {
    expect(backspace({ text: '', cursor: -1 })).toEqual({ text: '', cursor: -1 });
    expect(backspace({ text: 'ab', cursor: 0 })).toEqual({ text: 'ab', cursor: 0 });
    expect(backspace({ text: 'ab', cursor: -1 })).toEqual({ text: 'a', cursor: -1 });
    expect(backspace({ text: 'abc', cursor: 2 })).toEqual({ text: 'ac', cursor: 1 });
  });

  it('delete-forward is a no-op at the end of the line (as in PyMOL)', () => {
    expect(deleteForward({ text: 'abc', cursor: -1 })).toEqual({ text: 'abc', cursor: -1 });
    expect(deleteForward({ text: 'abc', cursor: 1 })).toEqual({ text: 'ac', cursor: 1 });
  });

  it('Ctrl-A only moves when there is text; Ctrl-E always unpins', () => {
    expect(home({ text: '', cursor: -1 })).toEqual({ text: '', cursor: -1 });
    expect(home({ text: 'abc', cursor: 2 })).toEqual({ text: 'abc', cursor: 0 });
    expect(end({ text: 'abc', cursor: 0 })).toEqual({ text: 'abc', cursor: -1 });
  });

  it('Ctrl-K truncates at the cursor and unpins it', () => {
    expect(truncate({ text: 'abcdef', cursor: 3 })).toEqual({ text: 'abc', cursor: -1 });
    expect(truncate({ text: 'abcdef', cursor: -1 })).toEqual({ text: 'abcdef', cursor: -1 });
  });

  it('reproduces the RIGHT-arrow quirk: from "at end" it moves LEFT', () => {
    // `case P_GLUT_KEY_RIGHT` takes the same `CursorChar = CurChar - 1` branch
    // as LEFT when the cursor is unpinned (packages/engine/layer1/Ortho.cpp:1105-1113).
    expect(cursorRight({ text: 'abcd', cursor: -1 })).toEqual({ text: 'abcd', cursor: 3 });
    expect(cursorRight({ text: 'abcd', cursor: 3 })).toEqual({ text: 'abcd', cursor: 4 });
    expect(cursorRight({ text: 'abcd', cursor: 4 })).toEqual({ text: 'abcd', cursor: 4 });
    expect(cursorLeft({ text: 'abcd', cursor: -1 })).toEqual({ text: 'abcd', cursor: 3 });
    expect(cursorLeft({ text: 'abcd', cursor: 0 })).toEqual({ text: 'abcd', cursor: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * History  (packages/engine/layer1/Ortho.cpp:1035-1094)
 * ------------------------------------------------------------------ */

describe('the ortho history ring', () => {
  it('pushes on submit, recalls with UP and returns with DOWN', () => {
    const store = createConsoleStore();
    store.setLine({ text: 'fragment ala', cursor: -1 });
    expect(store.submit()).toBe('fragment ala');
    store.setLine({ text: 'zoom', cursor: -1 });
    store.submit();

    store.setLine({ text: 'half typed', cursor: -1 });
    store.historyBack();
    expect(store.get().line.text).toBe('zoom');
    store.historyBack();
    expect(store.get().line.text).toBe('fragment ala');
    store.historyBack();
    expect(store.get().line.text).toBe('fragment ala'); // clamped
    store.historyForward();
    expect(store.get().line.text).toBe('zoom');
    store.historyForward();
    expect(store.get().line.text).toBe('half typed'); // the scratch slot
  });

  it('does not push an empty line', () => {
    const store = createConsoleStore();
    store.setLine({ text: '', cursor: -1 });
    expect(store.submit()).toBe('');
    expect(store.get().history).toEqual([]);
  });

  it('is capped at OrthoHistoryLines entries', () => {
    const store = createConsoleStore({ historyCapacity: 4 });
    for (const cmd of ['a', 'b', 'c', 'd', 'e', 'f']) {
      store.setLine({ text: cmd, cursor: -1 });
      store.submit();
    }
    expect(store.get().history).toEqual(['c', 'd', 'e', 'f']);
  });

  it('submitting cancels the auto-overlay (OrthoParseCurrentLine:1039)', () => {
    const store = createConsoleStore();
    store.set({ splash: false });
    store.setSettings({ auto_overlay: 1 });
    store.addOutput(['noise', 'more noise']);
    expect(numberOverlayLines(store.get())).toBe(2);
    store.setLine({ text: 'zoom', cursor: -1 });
    store.submit();
    expect(numberOverlayLines(store.get())).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Key dispatch  (packages/engine/layer1/Ortho.cpp:841-1031, packages/engine/layer5/PyMOL.cpp:2371-2383)
 * ------------------------------------------------------------------ */

describe('mapOrthoKey', () => {
  const withLine = (text: string, patch: Partial<ConsoleState> = {}) => {
    const store = createConsoleStore();
    store.set({ splash: false, line: { text, cursor: -1 }, ...patch });
    return store.get();
  };

  it('inserts printable characters', () => {
    expect(mapOrthoKey(key('z'), withLine(''))).toEqual({ kind: 'insert', ch: 'z' });
    expect(mapOrthoKey(key('?'), withLine(''))).toEqual({ kind: 'insert', ch: '?' });
  });

  it('Tab completes, Ctrl-Tab is the CTRL-I chord', () => {
    expect(mapOrthoKey(key('Tab'), withLine('frag'))).toEqual({ kind: 'complete' });
    expect(mapOrthoKey(key('Tab', { ctrlKey: true }), withLine('frag'))).toEqual({
      kind: 'chord',
      fn: '_ctrl',
      key: 'I',
    });
  });

  it('Enter submits a non-empty line', () => {
    expect(mapOrthoKey(key('Enter'), withLine('zoom'))).toEqual({ kind: 'submit' });
  });

  it('Enter on an empty line with a movie panel goes to the mview branch', () => {
    const state = withLine('', {
      settings: { ...CONSOLE_SETTING_DEFAULTS, movie_panel: 1 },
    });
    expect(mapOrthoKey(key('Enter'), state)).toEqual({
      kind: 'movieKeyframe',
      shift: false,
      ctrl: false,
    });
    const settings = { ...CONSOLE_SETTING_DEFAULTS };
    expect(
      movieKeyframeCommand({ kind: 'movieKeyframe', shift: false, ctrl: false }, settings),
    ).toBe('mview toggle,quiet=1');
    expect(
      movieKeyframeCommand({ kind: 'movieKeyframe', shift: false, ctrl: true }, settings),
    ).toBe('mview toggle,freeze=1,quiet=1');
    expect(
      movieKeyframeCommand({ kind: 'movieKeyframe', shift: true, ctrl: false }, settings),
    ).toBe('mview toggle_interp,quiet=1');
    expect(movieKeyframeCommand({ kind: 'movieKeyframe', shift: true, ctrl: true }, settings)).toBe(
      'mview toggle_interp,quiet=1,object=same',
    );
    expect(
      movieKeyframeCommand(
        { kind: 'movieKeyframe', shift: false, ctrl: false },
        {
          ...settings,
          presentation: 1,
        },
      ),
    ).toBe('mtoggle');
  });

  it('Space on an empty line runs mtoggle, Shift-Space rewind;mplay', () => {
    expect(mapOrthoKey(key(' '), withLine(''))).toEqual({ kind: 'command', line: 'mtoggle' });
    expect(mapOrthoKey(key(' ', { shiftKey: true }), withLine(''))).toEqual({
      kind: 'command',
      line: 'rewind;mplay',
    });
    // In presentation mode it is `cmd.scene('','next')` (packages/engine/layer1/Ortho.cpp:860).
    const pres = withLine('', { settings: { ...CONSOLE_SETTING_DEFAULTS, presentation: 1 } });
    expect(mapOrthoKey(key(' '), pres)).toEqual({ kind: 'command', line: "scene '', next" });
    // With text on the line it is just a space.
    expect(mapOrthoKey(key(' '), withLine('zoom'))).toEqual({ kind: 'insert', ch: ' ' });
  });

  it('UP/DOWN are always grabbed; LEFT/RIGHT only when text is entered', () => {
    expect(mapOrthoKey(key('ArrowUp'), withLine(''))).toEqual({ kind: 'historyBack' });
    expect(mapOrthoKey(key('ArrowDown'), withLine(''))).toEqual({ kind: 'historyForward' });
    expect(mapOrthoKey(key('ArrowLeft'), withLine(''))).toEqual({ kind: 'none' });
    expect(mapOrthoKey(key('ArrowLeft'), withLine('zoom'))).toEqual({ kind: 'left' });
    const hidden = withLine('zoom', {
      settings: { ...CONSOLE_SETTING_DEFAULTS, internal_feedback: 0 },
    });
    expect(mapOrthoKey(key('ArrowRight'), hidden)).toEqual({ kind: 'none' });
  });

  it('Ctrl-A/E edit while text is entered and are chords otherwise', () => {
    expect(mapOrthoKey(key('a', { ctrlKey: true }), withLine('zoom'))).toEqual({ kind: 'home' });
    expect(mapOrthoKey(key('e', { ctrlKey: true }), withLine('zoom'))).toEqual({ kind: 'end' });
    expect(mapOrthoKey(key('a', { ctrlKey: true }), withLine(''))).toEqual({
      kind: 'chord',
      fn: '_ctrl',
      key: 'A',
    });
  });

  it('Ctrl-D deletes forward inside the line and prints candidates at the end', () => {
    const inside = withLine('zoom', { line: { text: 'zoom', cursor: 1 } });
    expect(mapOrthoKey(key('d', { ctrlKey: true }), inside)).toEqual({ kind: 'deleteForward' });
    expect(mapOrthoKey(key('d', { ctrlKey: true }), withLine('zoom'))).toEqual({
      kind: 'completePrint',
    });
    expect(mapOrthoKey(key('d', { ctrlKey: true }), withLine(''))).toEqual({
      kind: 'chord',
      fn: '_ctrl',
      key: 'D',
    });
  });

  it('Ctrl-V pastes with text on the line and is the CTRL-V chord without', () => {
    expect(mapOrthoKey(key('v', { ctrlKey: true }), withLine('zoom'))).toEqual({ kind: 'paste' });
    expect(mapOrthoKey(key('v', { ctrlKey: true }), withLine(''))).toEqual({
      kind: 'chord',
      fn: '_ctrl',
      key: 'V',
    });
  });

  it('falls back to _ctrl / _alt / _ctsh for everything else', () => {
    expect(mapOrthoKey(key('z', { ctrlKey: true }), withLine(''))).toEqual({
      kind: 'chord',
      fn: '_ctrl',
      key: 'Z',
    });
    expect(mapOrthoKey(key('F5', { altKey: true }), withLine(''))).toEqual({ kind: 'none' });
    expect(mapOrthoKey(key('q', { ctrlKey: true, shiftKey: true }), withLine(''))).toEqual({
      kind: 'chord',
      fn: '_ctsh',
      key: 'Q',
    });
    // Option-G composes '@' on a Mac; OrthoKeyAlt inserts it (`:810-813`).
    expect(mapOrthoKey(key('@', { altKey: true }), withLine(''))).toEqual({
      kind: 'insert',
      ch: '@',
    });
  });

  it('leaves Cmd chords to the browser', () => {
    expect(mapOrthoKey(key('r', { metaKey: true }), withLine(''))).toEqual({ kind: 'none' });
  });

  it('Escape carries the shift bit for the overlay/text split', () => {
    expect(mapOrthoKey(key('Escape'), withLine(''))).toEqual({ kind: 'escape', shift: false });
    expect(mapOrthoKey(key('Escape', { shiftKey: true }), withLine(''))).toEqual({
      kind: 'escape',
      shift: true,
    });
  });

  /* ---- the cases the inventory row lists that were not yet covered ---- */

  it('Ctrl-K truncates the line, and is a chord when nothing is typed', () => {
    // `OrthoKey case 11`. The split is the same one Ctrl-A/E use: the ortho
    // CLI only owns the key once the arrows are grabbed, i.e. once the user
    // has actually started a line.
    expect(mapOrthoKey(key('k', { ctrlKey: true }), withLine('color re'))).toEqual({
      kind: 'truncate',
    });
    expect(mapOrthoKey(key('k', { ctrlKey: true }), withLine(''))).toEqual({
      kind: 'chord',
      fn: '_ctrl',
      key: 'K',
    });
  });

  it('Backspace edits the line', () => {
    expect(mapOrthoKey(key('Backspace'), withLine('color'))).toEqual({ kind: 'backspace' });
  });

  it('Ctrl-M IS carriage return, not a chord', () => {
    /*
     * `case 13`. Easy to get wrong: every other Ctrl-<letter> that the CLI
     * does not claim falls through to `_ctrl`, but Ctrl-M is literally the
     * same code point as Enter, so it must submit instead.
     */
    expect(mapOrthoKey(key('m', { ctrlKey: true }), withLine('color red'))).toEqual({
      kind: 'submit',
    });
    expect(mapOrthoKey(key('m', { ctrlKey: true }), withLine(''))).toEqual({ kind: 'none' });
  });

  it('Space advances the SCENE under presentation instead of toggling the movie', () => {
    // Same key, different command, decided by a setting — a client that
    // hard-coded `mtoggle` would break presentation mode silently.
    const presenting = withLine('', { settings: { presentation: 1 } as never });
    expect(mapOrthoKey(key(' '), presenting)).toEqual({
      kind: 'command',
      line: "scene '', next",
    });
  });

  it('DEL is the CTRL-D chord on an empty line', () => {
    expect(mapOrthoKey(key('Delete'), withLine(''))).toEqual({
      kind: 'chord',
      fn: '_ctrl',
      key: 'D',
    });
    const inside = withLine('zoom', { line: { text: 'zoom', cursor: 1 } });
    expect(mapOrthoKey(key('Delete'), inside)).toEqual({ kind: 'deleteForward' });
  });
});

/* ------------------------------------------------------------------ *
 * Drag-enter preview  (packages/engine/modules/pmg_qt/pymol_qt_gui.py:1085-1122)
 * ------------------------------------------------------------------ */

describe('command-line drag preview', () => {
  it('inserts at the cursor and selects exactly the inserted run', () => {
    const result = dragEnterPreview('load ', 5, '1ubq.pdb');
    expect(result).toEqual({
      text: 'load 1ubq.pdb',
      selectionStart: 5,
      selectionEnd: 13,
      saved: { savedPos: 5, savedText: 'load ' },
    });
  });

  it('restores the original text and cursor on drag-leave', () => {
    const result = dragEnterPreview('load ', 5, '1ubq.pdb');
    expect(dragLeaveRestore(result?.saved ?? NO_PREVIEW)).toEqual({ text: 'load ', cursor: 5 });
    expect(dragLeaveRestore(NO_PREVIEW)).toBe(null);
  });

  it('prefers the first URL as a local PATH, exactly like toLocalFile()', () => {
    expect(
      droppedText({ uriList: 'file:///tmp/my%20file.pdb\r\n', plain: 'file:///tmp/my%20file.pdb' }),
    ).toBe('/tmp/my file.pdb');
    // A non-local URL falls through to the plain text (`:1104-1107`).
    expect(droppedText({ uriList: 'https://x/y.pdb', plain: 'https://x/y.pdb' })).toBe(
      'https://x/y.pdb',
    );
    expect(droppedText({ uriList: '', plain: 'select foo, name CA' })).toBe('select foo, name CA');
    expect(droppedText({ uriList: '', plain: '' })).toBe(null);
  });

  it('does nothing when the payload is unreadable (browser protected mode)', () => {
    expect(dragEnterPreview('load ', 5, null)).toBe(null);
  });
});

/* ------------------------------------------------------------------ *
 * Which polled values the console believes
 * (packages/bridge/tenmol_bridge/engine.py:129-130, :175-183)
 * ------------------------------------------------------------------ */

describe('adoptSettings', () => {
  it('adopts every ordinary setting on every poll', () => {
    const { patch } = adoptSettings({}, [
      ['overlay', 1],
      ['text', 0],
      ['overlay_lines', 7],
    ]);
    expect(patch).toEqual({ overlay: 1, text: 0, overlay_lines: 7 });
  });

  it('ignores the bridge boot-time 0 for internal_feedback and movie_panel', () => {
    expect(BRIDGE_ZEROED).toEqual(['internal_feedback', 'movie_panel']);
    const { patch, remote } = adoptSettings({}, [
      ['internal_feedback', 0],
      ['movie_panel', 0],
      ['overlay', 0],
    ]);
    expect(patch).toEqual({ overlay: 0 });
    expect(remote).toEqual({ internal_feedback: 0, movie_panel: 0, overlay: 0 });
  });

  it('keeps ignoring an UNCHANGED 0 on later polls — the bug that blacked out the console', () => {
    const first = adoptSettings({}, [['internal_feedback', 0]]);
    const second = adoptSettings(first.remote, [['internal_feedback', 0]]);
    expect(second.patch).toEqual({});
  });

  it('adopts the moment the user changes it, in either direction', () => {
    const first = adoptSettings({}, [['internal_feedback', 0]]);
    const set3 = adoptSettings(first.remote, [['internal_feedback', 3]]);
    expect(set3.patch).toEqual({ internal_feedback: 3 });
    const back0 = adoptSettings(set3.remote, [['internal_feedback', 0]]);
    expect(back0.patch).toEqual({ internal_feedback: 0 });
  });

  it('honours a non-zero first sample (a .pymolrc set it)', () => {
    expect(adoptSettings({}, [['internal_feedback', 4]]).patch).toEqual({ internal_feedback: 4 });
  });

  it('treats a failed call as no answer, not as zero', () => {
    const { patch, remote } = adoptSettings({ overlay: 1 }, [
      ['overlay', null],
      ['text', 1],
    ]);
    expect(patch).toEqual({ text: 1 });
    expect(remote.overlay).toBe(1);
  });
});

describe('dropNeedsUpload', () => {
  /*
   * The command line accepts two very different drops. Text (a URI or a path)
   * is inserted directly, as Qt does with `toLocalFile()`. A browser File has
   * no readable path, so its bytes must be uploaded before there is anything
   * to insert — which is why this predicate exists at all.
   */
  it('uploads when the drop is nothing but files', () => {
    expect(dropNeedsUpload({ fileCount: 1, uriList: '', plain: '' })).toBe(true);
    expect(dropNeedsUpload({ fileCount: 3, uriList: '', plain: '' })).toBe(true);
  });

  it('prefers text when a drag carries BOTH', () => {
    // A file-manager drag usually supplies both. The URI is already a usable
    // string, and uploading a copy would insert a different path than the one
    // the user dragged.
    expect(dropNeedsUpload({ fileCount: 1, uriList: 'file:///a/b.pdb', plain: '' })).toBe(false);
    expect(dropNeedsUpload({ fileCount: 1, uriList: '', plain: '/a/b.pdb' })).toBe(false);
  });

  it('does nothing when there are no files', () => {
    expect(dropNeedsUpload({ fileCount: 0, uriList: '', plain: '' })).toBe(false);
    expect(dropNeedsUpload({ fileCount: 0, uriList: 'https://a/1.pdb', plain: '' })).toBe(false);
  });
});
