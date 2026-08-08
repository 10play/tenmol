/**
 * Syntax tokenisers for the text editor's three modes.
 *
 * `packages/engine/modules/pmg_qt/TextEditor.py:47-58` imports `pmg_qt.syntax.<filetype>` and
 * uses its `Highlighter`. There are only two such modules in this tree —
 * `syntax/python.py` and `syntax/pml.py` — so **"Plain Text" silently means no
 * highlighting**, and that is reproduced here rather than fixed.
 *
 * The PML tokeniser follows `syntax/pml.py`'s categories exactly (comment /
 * keyword / argument / skipped, plus the `python|embed|skip` … `end` multiline
 * blocks and backslash continuation). It does NOT reproduce
 * `pmlparser.parse_pml`'s full argument split, because that one consults
 * `cmd.kwhash` and `cmd.keyword` — live Python dictionaries with no `cmd` getter
 * — to decide whether a line is a command or a Python statement. Rather than
 * invent an API, the first word of a line is treated as the command, which is
 * what the highlighter shows for every real PML line anyway.
 *
 * Pure functions over one line at a time plus a carried state, which is exactly
 * `QSyntaxHighlighter`'s `previousBlockState` contract.
 */

import type { SyntaxMode } from '@tenmol/protocol/topics/dialogs';

/** The highlight category a token is drawn in. */
export type TokenKind = 'comment' | 'keyword' | 'argument' | 'skipped' | 'string' | 'plain';

/** One highlighted run of text on a line. */
export interface Token {
  kind: TokenKind;
  text: string;
}

/** `pml.py:14-17` block states, kept as a small discriminated value. */
export type BlockState = 'none' | 'python' | 'embed' | 'skip' | 'continued';

/** One line's tokens plus the block state carried into the next line. */
export interface LineResult {
  tokens: Token[];
  next: BlockState;
}

/** `multiline_command` (`pml.py:20-24`). */
const BLOCK_OPENERS: Record<string, Exclude<BlockState, 'none' | 'continued'>> = {
  python: 'python',
  embed: 'embed',
  skip: 'skip',
};

/**
 * One PML line.
 *
 * `_ ` is the quiet prefix (`pmlparser.py:76`); `#` is a comment; `@` runs a
 * script; a trailing `\` continues the line; `<block> end` closes a multiline
 * block and is drawn as a keyword.
 */
export function highlightPmlLine(line: string, state: BlockState): LineResult {
  if (state === 'python' || state === 'embed' || state === 'skip') {
    if (new RegExp(`^(_ )?[ \\t]*${state} end\\b`).test(line)) {
      return { tokens: [{ kind: 'keyword', text: line }], next: 'none' };
    }
    return {
      tokens: [{ kind: state === 'python' ? 'argument' : 'skipped', text: line }],
      next: state,
    };
  }

  if (state === 'continued') {
    return {
      tokens: [{ kind: 'argument', text: line }],
      next: line.endsWith('\\') ? 'continued' : 'none',
    };
  }

  const tokens: Token[] = [];
  const leading = /^(?:_ )?[ \t]*/.exec(line)?.[0] ?? '';
  if (leading) tokens.push({ kind: 'plain', text: leading });
  const rest = line.slice(leading.length);

  if (rest === '') return { tokens, next: 'none' };

  if (rest.startsWith('#')) {
    tokens.push({ kind: 'comment', text: rest });
    return { tokens, next: 'none' };
  }

  const wordMatch = /^[^\s;]+/.exec(rest);
  const word = wordMatch ? wordMatch[0] : '';
  const after = rest.slice(word.length);

  tokens.push({ kind: 'keyword', text: word });
  if (after) tokens.push({ kind: 'argument', text: after });

  const opener = BLOCK_OPENERS[word];
  if (opener && after.trim() === '') return { tokens, next: opener };
  if (line.endsWith('\\')) return { tokens, next: 'continued' };
  return { tokens, next: 'none' };
}

/**
 * One Python line. `syntax/python.py` is a regex highlighter over keywords,
 * strings and `#` comments; the same three categories are produced here.
 */
const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

/** Tokenise one Python line into string, comment and keyword runs. */
export function highlightPythonLine(line: string): LineResult {
  const tokens: Token[] = [];
  // One pass: strings, then comments, then identifiers.
  const pattern = /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#.*$)|([A-Za-z_]\w*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) tokens.push({ kind: 'plain', text: line.slice(last, match.index) });
    if (match[1]) tokens.push({ kind: 'string', text: match[1] });
    else if (match[2]) tokens.push({ kind: 'comment', text: match[2] });
    else if (match[3]) {
      tokens.push({ kind: PYTHON_KEYWORDS.has(match[3]) ? 'keyword' : 'plain', text: match[3] });
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) tokens.push({ kind: 'plain', text: line.slice(last) });
  return { tokens, next: 'none' };
}

/** Whole-document tokenisation. `plain` is genuinely untouched — see the header. */
export function highlight(text: string, mode: SyntaxMode): Token[][] {
  const lines = text.split('\n');
  if (mode === 'plain') return lines.map((line) => [{ kind: 'plain' as const, text: line }]);
  if (mode === 'python') return lines.map((line) => highlightPythonLine(line).tokens);

  const out: Token[][] = [];
  let state: BlockState = 'none';
  for (const line of lines) {
    const result = highlightPmlLine(line, state);
    out.push(result.tokens);
    state = result.next;
  }
  return out;
}

/**
 * `TextEditor._open` (`TextEditor.py:36-42`): `.py` -> python, `.pml` or a name
 * ending in `pymolrc` -> pml, anything else -> plain.
 */
export function syntaxForFilename(filename: string): SyntaxMode {
  if (filename.endsWith('.py')) return 'python';
  if (filename.endsWith('.pml') || filename.endsWith('pymolrc')) return 'pml';
  return 'plain';
}

/** `'%s (%s)' % (basename, dirname)` (`TextEditor.py:43-45`). */
export function editorTitle(path: string): string {
  if (!path) return 'Text Editor';
  const cut = path.lastIndexOf('/');
  const base = cut < 0 ? path : path.slice(cut + 1);
  const dir = cut < 0 ? '' : path.slice(0, cut);
  return `${base} (${dir})`;
}

/**
 * `_edit_pymolrc`'s default when no rc file is active (`TextEditor.py:170-174`).
 * The Windows branch is kept for completeness even though the bridge is local.
 */
export function defaultPymolrcPath(platform: string, home: string): string {
  if (platform.startsWith('win')) return `${home}\\pymolrc.pml`;
  return `${home}/.pymolrc`;
}

/**
 * Is this path one of PyMOL's startup rc files?
 *
 * Matches what `invocation.get_user_config()` looks for: a basename that is or
 * ends with `pymolrc`, optionally with a `.pml`/`.py`/`.pym` extension —
 * `.pymolrc`, `pymolrc.pml`, `~/.pymolrc.py`.
 *
 * Used to gate the "restart to apply" note. pymolrc is consumed before the GUI
 * exists, so editing it changes nothing in the running session; an editor that
 * saves a file and visibly does nothing reads as broken. Matching too narrowly
 * hides the warning on a real rc file, too broadly puts a restart banner on
 * ordinary scripts — hence the tests either side of the line.
 */
export function isPymolrc(path: string): boolean {
  const base = (path.split(/[\\/]/).pop() ?? '').toLowerCase();
  return /(^|\.)pymolrc(\.(pml|py|pym))?$/.test(base);
}
