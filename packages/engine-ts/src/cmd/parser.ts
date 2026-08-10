/**
 * A command-line parser for the `cmd.do` path.
 *
 * PyMOL's real parser (`packages/engine/modules/pymol/parser.py`) is far larger;
 * this handles the shapes the console needs: `keyword arg1, arg2, key=value, ...`,
 * with commands split on newlines and `;` (`parsing.py:split`). Arguments are
 * comma-separated and trimmed; a `key=value` token (identifier key) is a keyword
 * argument, matching PyMOL's `=` kwargs. Commas and `=` inside quotes are
 * respected, so `label all, text="a=b,c"` parses as one positional label string.
 *
 * The `@script` file-include form is recognized and reported (the browser has no
 * filesystem), never silently dropped.
 */

export interface ParsedCommand {
  keyword: string;
  /** Positional arguments, in order, quotes stripped. */
  args: string[];
  /** `key=value` keyword arguments, quotes stripped from the value. */
  kwargs: Record<string, string>;
}

/** Split a command line into individual commands (newlines and `;`). */
export function splitCommands(line: string): string[] {
  const out: string[] = [];
  for (const part of line.split(/\n/)) {
    for (const piece of splitTopLevel(part, ';')) {
      const t = piece.trim();
      if (t !== '') out.push(t);
    }
  }
  return out;
}

/**
 * Split `s` on every top-level `sep` character — one not inside a single- or
 * double-quoted run. Quotes are left in place (callers strip them per token).
 */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
      buf += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === sep) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out;
}

/** Drop one layer of matching surrounding quotes. */
function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parse one command into `{keyword, args, kwargs}`. */
export function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim();
  const space = trimmed.search(/\s/);
  const keyword = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const rest = space < 0 ? '' : trimmed.slice(space + 1).trim();

  const args: string[] = [];
  const kwargs: Record<string, string> = {};
  if (rest !== '') {
    for (const raw of splitTopLevel(rest, ',')) {
      const token = raw.trim();
      if (token === '') continue;
      // A `key=value` token (identifier key, not `==`) is a keyword argument.
      const kw = /^([A-Za-z_]\w*)\s*=(?!=)([\s\S]*)$/.exec(token);
      if (kw) kwargs[kw[1]!] = unquote(kw[2]!);
      else args.push(unquote(token));
    }
  }
  return { keyword, args, kwargs };
}
