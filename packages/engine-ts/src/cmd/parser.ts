/**
 * A minimal command-line parser — the `cmd.do` path for the covered verbs.
 *
 * PyMOL's real parser (`packages/engine/modules/pymol/parser.py`) is far larger;
 * this handles the one shape the slice needs: `keyword arg1, arg2, ...`, with
 * commands split on newlines and `;` (`parsing.py:split`). Arguments are
 * comma-separated and trimmed. Anything richer (python escapes `/expr`,
 * `@script`, `=` kwargs) is out of scope and reported, never silently dropped.
 */

export interface ParsedCommand {
  keyword: string;
  args: string[];
}

/** Split a command line into individual commands (newlines and `;`). */
export function splitCommands(line: string): string[] {
  const out: string[] = [];
  for (const part of line.split(/\n/)) {
    for (const piece of part.split(';')) {
      const t = piece.trim();
      if (t !== '') out.push(t);
    }
  }
  return out;
}

/** Parse one command into `{keyword, args}`. */
export function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim();
  const space = trimmed.search(/\s/);
  if (space < 0) return { keyword: trimmed.toLowerCase(), args: [] };
  const keyword = trimmed.slice(0, space).toLowerCase();
  const rest = trimmed.slice(space + 1).trim();
  const args = rest === '' ? [] : rest.split(',').map((a) => a.trim());
  return { keyword, args };
}
