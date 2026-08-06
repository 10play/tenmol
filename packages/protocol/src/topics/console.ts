/**
 * `console` — the shared vocabulary of PyMOL's own console.  OWNER: WP-11.
 *
 * NOT A TRANSPORT TOPIC. `topics/_registry.ts` and `topics/index.ts` are frozen
 * (written once by WP-01) and `console` is not one of the 19 topic names, so
 * nothing here is re-exported from `@tenmol/protocol`. It is reached by its
 * subpath, which `package.json` already resolves:
 *
 *     import { stripAnsiEscapes } from '@tenmol/protocol/topics/console';
 *
 * Console output rides the `feedback` topic (WP-03). What lives here is the
 * part of the console that is *protocol* rather than *state*: the setting
 * indices the console reads, and the two text transformations PyMOL applies to
 * a line between `print()` and the glyphs on screen — ANSI handling and
 * `wrap_output`. Both are needed by the client and by any future bridge-side
 * producer, and neither belongs to a React component.
 *
 * ---------------------------------------------------------------------------
 * MEASURED AGAINST THE RUNNING BRIDGE (127.0.0.1:8802, PyMOL 3.2.0a) — read
 * this before "fixing" the client to wrap or to strip:
 *
 *  1. `wrap_output` IS APPLIED SERVER-SIDE, BEFORE THE LINE IS QUEUED.
 *     `OrthoAddOutput` (`packages/engine/layer1/Ortho.cpp:1080-1118`) splits into `I->Line[]`
 *     and `OrthoNewLine` pushes each piece to the feedback queue
 *     (`:1139`). So the client receives lines ALREADY WRAPPED and must not
 *     wrap again. Verified:
 *
 *         set wrap_output, 20
 *         print("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij")
 *       -> feedback lines: "A","BC","DE","FG","HI",... (2 chars each)
 *
 *     Two characters, not twenty: `wrap_output` is declared `REC_b`
 *     (`packages/engine/layer1/SettingInfo.h:276`), so `SettingGetGlobal_b` collapses 20 to 1
 *     and the `cc > wrap` test fires on every second character. That is an
 *     upstream quirk, it is what the Qt console shows, and {@link wrapOutput}
 *     reproduces it exactly so a client-origin line wraps the same way.
 *
 *  2. `colored_feedback` DECIDES WHETHER ANSI SURVIVES THE QUEUE.
 *     `OrthoFeedbackOut` (`packages/engine/layer1/Ortho.cpp:1148-1150`) calls
 *     `UtilStripANSIEscapes` unless `colored_feedback` is on. Verified with
 *     `print("\033[31mRED\033[0m plain")`:
 *
 *         colored_feedback=0 -> "RED plain"
 *         colored_feedback=1 -> "ESC[31mREDESC[0m plain"
 *
 *     So the renderer needs a real SGR parser for the on case, and this build
 *     also prints " Setting-Warning: colored_feedback is not supported in
 *     Open-Source version of PyMOL" when you turn it on — the setting still
 *     changes the queue behaviour, only Schrodinger's own colouring is absent.
 * ---------------------------------------------------------------------------
 *
 * @notATopic  NOT A TRANSPORT TOPIC — deliberately not re-exported by the
 * frozen `topics/index.ts` barrel. Reached by its subpath
 * (`@tenmol/protocol/topics/console`); its events, if any, ride an existing
 * topic. `packages/bridge/tests/test_dispatch.py` looks for this tag.
 */

/* ------------------------------------------------------------------ *
 * The ring geometry
 * ------------------------------------------------------------------ */

/** `#define OrthoSaveLines 0xFF` (`packages/engine/layer1/Ortho.cpp:62`) — 256 lines. */
export const ORTHO_SAVE_LINES = 256;

/** `#define OrthoHistoryLines 0xFF` (`packages/engine/layer1/Ortho.cpp:63`) — 256 entries. */
export const ORTHO_HISTORY_LINES = 256;

/** `OrthoLineType` is `char[1024]` (`packages/engine/layer0/os_python.h` / `packages/engine/layer1/Ortho.h`). */
export const ORTHO_LINE_LENGTH = 1024;

/** The prompt `OrthoRestorePrompt` writes, compared with `strncmp(..., 6)`. */
export const ORTHO_PROMPT = 'PyMOL>';

/** `#define cOrthoLineHeight DIP2PIXEL(12)` (`packages/engine/layer1/Ortho.h:26`). */
export const ORTHO_LINE_HEIGHT = 12;
/** `#define cOrthoCharWidth DIP2PIXEL(8)` (`packages/engine/layer1/Ortho.cpp:65`). */
export const ORTHO_CHAR_WIDTH = 8;
/** `#define cOrthoLeftMargin DIP2PIXEL(3)` (`packages/engine/layer1/Ortho.cpp:66`). */
export const ORTHO_LEFT_MARGIN = 3;
/** `#define cOrthoBottomMargin DIP2PIXEL(5)` (`packages/engine/layer1/Ortho.cpp:67`). */
export const ORTHO_BOTTOM_MARGIN = 5;

/* ------------------------------------------------------------------ *
 * The settings the console reads
 * ------------------------------------------------------------------ */

/**
 * Every setting `OrthoDrawText` / `OrthoGetNumberOverlayLines` /
 * `OrthoAddOutput` / `OrthoFeedbackOut` consults, with its real index from
 * `packages/engine/layer1/SettingInfo.h`. The indices matter because `cmd.get_setting_updates()`
 * reports indices, not names (`packages/engine/modules/pymol/setting.py:440`).
 */
export const CONSOLE_SETTING_INDEX = {
  /** `REC_i(128, internal_feedback, global, 1)` — lines always shown. */
  internal_feedback: 128,
  /** `REC_b(191, wrap_output, global, 0)` — boolean, see the note above. */
  wrap_output: 191,
  /** `REC_i(311, overlay_lines, global, 5)`. */
  overlay_lines: 311,
  /** `REC_b(313, internal_prompt, global, 1)` — 0 hides the prompt line. */
  internal_prompt: 313,
  /** `REC_i(61, overlay, global, 0)`. */
  overlay: 61,
  /** `REC_b(62, text, global, 0)` — full-height scrollback over the scene. */
  text: 62,
  /** `REC_i(603, auto_overlay, global, 0)`. */
  auto_overlay: 603,
  /** `REC_b(764, colored_feedback, global, 0)`. */
  colored_feedback: 764,
} as const;

/**
 * Two settings that are not console settings but that `OrthoKey` branches on
 * (`packages/engine/layer1/Ortho.cpp:855-874`, `:986-999`), so the in-viewport prompt cannot
 * dispatch a key without them:
 *
 *   presentation — SPACE runs `cmd.scene('','next')` instead of `mtoggle`, and
 *                  ESC runs `_quit` instead of toggling `text`.
 *   movie_panel  — with a movie loaded, ENTER on an EMPTY line toggles mview
 *                  keyframes instead of doing nothing.
 */
export const ORTHO_KEY_SETTING_INDEX = {
  /** `REC_b(397, presentation, global, 0)`. */
  presentation: 397,
  /** `REC_i(618, movie_panel, global, 1)`. */
  movie_panel: 618,
} as const;

/** The name of any setting the console reads or the ortho keys drive. */
export type ConsoleSettingName =
  keyof typeof CONSOLE_SETTING_INDEX | keyof typeof ORTHO_KEY_SETTING_INDEX;

/** Every index the console cares about, by name. */
export const ALL_CONSOLE_SETTING_INDEX: Readonly<Record<ConsoleSettingName, number>> = {
  ...CONSOLE_SETTING_INDEX,
  ...ORTHO_KEY_SETTING_INDEX,
};

/** Stable order, so the poller always sends the same argument list. */
export const CONSOLE_SETTING_NAMES = Object.keys(
  ALL_CONSOLE_SETTING_INDEX,
) as readonly ConsoleSettingName[];

/** Current numeric value of every console-relevant setting, keyed by name. */
export type ConsoleSettings = Record<ConsoleSettingName, number>;

/** The `packages/engine/layer1/SettingInfo.h` defaults, verbatim. */
export const CONSOLE_SETTING_DEFAULTS: ConsoleSettings = {
  internal_feedback: 1,
  wrap_output: 0,
  overlay_lines: 5,
  internal_prompt: 1,
  overlay: 0,
  text: 0,
  auto_overlay: 0,
  colored_feedback: 0,
  presentation: 0,
  movie_panel: 1,
};

/** Index -> name, for a `get_setting_updates()` consumer. */
export function consoleSettingByIndex(index: number): ConsoleSettingName | null {
  for (const name of CONSOLE_SETTING_NAMES) {
    if (ALL_CONSOLE_SETTING_INDEX[name] === index) return name;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * ANSI
 * ------------------------------------------------------------------ */

/**
 * Port of `UtilStripANSIEscapes` (`packages/engine/layer0/Util.cpp:238-250`), character for
 * character: an escape run is `ESC [` followed by bytes in `[0x20,0x40)` and
 * then exactly one more byte. Note the C loop consumes the terminating byte
 * unconditionally, so a truncated `"\x1b["` at end of string eats nothing else
 * — reproduced here rather than "improved", because the client's job is to
 * agree with what PyMOL printed to the terminal.
 */
export function stripAnsiEscapes(input: string): string {
  let out = '';
  let i = 0;
  while (i < input.length) {
    if (input.charCodeAt(i) === 0x1b && input[i + 1] === '[') {
      let j = i + 2;
      while (j < input.length) {
        const c = input.charCodeAt(j);
        if (c >= 0x20 && c < 0x40) j++;
        else break;
      }
      i = j + 1; // the final byte of the sequence
      continue;
    }
    out += input[i];
    i++;
  }
  return out;
}

/** True when the line still carries escapes (i.e. `colored_feedback` is on). */
export function hasAnsiEscapes(input: string): boolean {
  return input.includes('\u001b[');
}

/** SGR state carried by a run of characters. */
export interface AnsiStyle {
  /** 0-255 for the 256-colour cube, or `null` for "default". */
  fg: number | null;
  bg: number | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

/** A run of text sharing one SGR style, the unit of ANSI-parsed output. */
export interface AnsiSpan extends AnsiStyle {
  text: string;
}

/** The reset SGR state a span starts from: default colours, no attributes. */
export const ANSI_DEFAULT_STYLE: AnsiStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
};

/**
 * The 16 xterm system colours, as CSS. Indices 0-7 normal, 8-15 bright.
 * Values are xterm's, not a designer's: a script that prints `\033[31m` expects
 * the terminal red it would get in a terminal.
 */
export const ANSI_PALETTE: readonly string[] = [
  '#000000',
  '#cd0000',
  '#00cd00',
  '#cdcd00',
  '#1e90ff',
  '#cd00cd',
  '#00cdcd',
  '#e5e5e5',
  '#4c4c4c',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#4682b4',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
];

/** CSS for an SGR colour number, including the 6x6x6 cube and the grey ramp. */
export function ansiColorCss(index: number): string | null {
  if (index < 0 || index > 255) return null;
  if (index < 16) return ANSI_PALETTE[index] ?? null;
  if (index < 232) {
    const n = index - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const r = levels[Math.floor(n / 36) % 6] ?? 0;
    const g = levels[Math.floor(n / 6) % 6] ?? 0;
    const b = levels[n % 6] ?? 0;
    return `rgb(${r},${g},${b})`;
  }
  const v = 8 + (index - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

const ESC = '\u001b';
const SGR_PARAMS = /^[0-9;]*$/;

/**
 * `ESC [ <params> m` at position 0, hand-matched.
 *
 * No regular expression: any pattern containing the ESC byte trips ESLint's
 * `no-control-regex`, and the ESC byte is the entire point of the pattern.
 * Returns the parameter string and the number of characters consumed.
 */
function matchSgr(s: string): { params: string; length: number } | null {
  if (s[0] !== ESC || s[1] !== '[') return null;
  const m = s.indexOf('m', 2);
  if (m < 0) return null;
  const params = s.slice(2, m);
  if (!SGR_PARAMS.test(params)) return null;
  return { params, length: m + 1 };
}

/**
 * Split a line into styled runs.
 *
 * Only SGR (`ESC [ ... m`) is interpreted, because that is the only sequence
 * that can survive `OrthoFeedbackOut` with meaning — cursor motion in a
 * scrollback pane is nonsense. Every other escape is dropped exactly as
 * {@link stripAnsiEscapes} would drop it, so a line is never rendered with a
 * stray `[2J` in it.
 *
 * A line with no escapes returns exactly one span, so callers do not need a
 * fast path.
 */
export function parseAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let style: AnsiStyle = { ...ANSI_DEFAULT_STYLE };
  let rest = input;
  let pending = '';

  const flush = () => {
    if (pending !== '') {
      spans.push({ ...style, text: pending });
      pending = '';
    }
  };

  while (rest.length > 0) {
    const esc = rest.indexOf('\u001b[');
    if (esc < 0) {
      pending += rest;
      break;
    }
    pending += rest.slice(0, esc);
    rest = rest.slice(esc);
    const m = matchSgr(rest);
    if (m) {
      flush();
      style = applySgr(style, m.params);
      rest = rest.slice(m.length);
    } else {
      // Not an SGR: strip it the way UtilStripANSIEscapes would.
      const stripped = stripAnsiEscapes(rest);
      const consumed = rest.length - stripped.length;
      rest = consumed > 0 ? rest.slice(consumed) : rest.slice(1);
    }
  }
  flush();
  if (spans.length === 0) spans.push({ ...ANSI_DEFAULT_STYLE, text: '' });
  return spans;
}

function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  // `ESC[m` is `ESC[0m`.
  const codes = (params === '' ? '0' : params).split(';').map((p) => Number(p || '0'));
  let next: AnsiStyle = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i] ?? 0;
    if (code === 0) next = { ...ANSI_DEFAULT_STYLE };
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) next = { ...next, bold: false, dim: false };
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 27) next.inverse = false;
    else if (code >= 30 && code <= 37) next.fg = code - 30;
    else if (code === 39) next.fg = null;
    else if (code >= 40 && code <= 47) next.bg = code - 40;
    else if (code === 49) next.bg = null;
    else if (code >= 90 && code <= 97) next.fg = code - 90 + 8;
    else if (code >= 100 && code <= 107) next.bg = code - 100 + 8;
    else if (code === 38 || code === 48) {
      // 38;5;N (256 colour) and 38;2;r;g;b (truecolour, mapped to the cube).
      const mode = codes[i + 1];
      if (mode === 5) {
        const value = codes[i + 2] ?? 0;
        if (code === 38) next.fg = value;
        else next.bg = value;
        i += 2;
      } else if (mode === 2) {
        const r = codes[i + 2] ?? 0;
        const g = codes[i + 3] ?? 0;
        const b = codes[i + 4] ?? 0;
        const cube = 16 + 36 * q6(r) + 6 * q6(g) + q6(b);
        if (code === 38) next.fg = cube;
        else next.bg = cube;
        i += 4;
      }
    }
  }
  return next;
}

function q6(v: number): number {
  const levels = [0, 95, 135, 175, 215, 255];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < levels.length; i++) {
    const d = Math.abs((levels[i] ?? 0) - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * wrap_output
 * ------------------------------------------------------------------ */

/**
 * Port of the wrapping loop in `OrthoAddOutput` (`packages/engine/layer1/Ortho.cpp:1080-1118`).
 *
 * `wrap` is what `SettingGetGlobal_b(cSetting_wrap_output)` returns, i.e. 0 or
 * 1 — see the file header. `\r`/`\n` always break a line. The
 * `OrthoLineLength - 6` fail-safe applies whatever `wrap` is, which is why one
 * feedback entry is not always one logical line even with wrapping off.
 *
 * The client does NOT call this on server lines (they arrive wrapped). It is
 * here for client-origin lines and for the tests that prove the two agree.
 */
export function wrapOutput(text: string, wrap: number, lineLength = ORTHO_LINE_LENGTH): string[] {
  const out: string[] = [];
  let current = '';
  let cc = 0;
  for (const ch of text) {
    if (ch === '\r' || ch === '\n') {
      out.push(current);
      current = '';
      cc = 0;
      continue;
    }
    cc++;
    if (wrap > 0 && cc > wrap) {
      out.push(current);
      current = '';
      cc = 0;
    }
    if (cc >= lineLength - 6) {
      out.push(current);
      current = '';
      cc = 0;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/* ------------------------------------------------------------------ *
 * Payload (unused by the frozen barrel; kept for symmetry)
 * ------------------------------------------------------------------ */

/**
 * What a future bridge-side console producer would push. Nothing emits this
 * today: console output rides `feedback`, and the settings above are polled
 * with `cmd.get_setting_int`.
 */
export interface ConsolePayload {
  settings?: Partial<ConsoleSettings>;
  lines?: string[];
}
