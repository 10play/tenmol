/**
 * The text editor's syntax modes and filename rules
 * (`modules/pmg_qt/TextEditor.py:36-58`, `modules/pmg_qt/syntax/pml.py`).
 */

import { describe, expect, it } from 'vitest';
import {
  defaultPymolrcPath,
  editorTitle,
  highlight,
  highlightPmlLine,
  highlightPythonLine,
  syntaxForFilename,
} from './syntax';

const kinds = (line: string, state: Parameters<typeof highlightPmlLine>[1] = 'none') =>
  highlightPmlLine(line, state).tokens.map((t) => `${t.kind}:${t.text}`);

describe('syntax auto-selection (TextEditor.py:36-42)', () => {
  it('.py is python, .pml and *pymolrc are pml, everything else is plain', () => {
    expect(syntaxForFilename('/tmp/a.py')).toBe('python');
    expect(syntaxForFilename('/tmp/a.pml')).toBe('pml');
    expect(syntaxForFilename('/home/me/.pymolrc')).toBe('pml');
    expect(syntaxForFilename('/home/me/pymolrc')).toBe('pml');
    expect(syntaxForFilename('/tmp/notes.txt')).toBe('plain');
    expect(syntaxForFilename('')).toBe('plain');
  });
});

describe('window title (TextEditor.py:43-45)', () => {
  it("is '%s (%s)' % (basename, dirname)", () => {
    expect(editorTitle('/home/me/.pymolrc')).toBe('.pymolrc (/home/me)');
    expect(editorTitle('')).toBe('Text Editor');
  });
});

describe('default pymolrc path (TextEditor.py:170-174)', () => {
  it('is $HOME/.pymolrc on posix and pymolrc.pml on windows', () => {
    expect(defaultPymolrcPath('darwin', '/Users/me')).toBe('/Users/me/.pymolrc');
    expect(defaultPymolrcPath('win32', 'C:\\Users\\me')).toBe('C:\\Users\\me\\pymolrc.pml');
  });
});

describe('PML highlighting', () => {
  it('marks a comment line', () => {
    expect(kinds('# a comment')).toEqual(['comment:# a comment']);
  });

  it('marks the first word as the command and the rest as arguments', () => {
    expect(kinds('show cartoon, polymer')).toEqual([
      'keyword:show',
      'argument: cartoon, polymer',
    ]);
  });

  it('keeps the quiet `_ ` prefix and leading whitespace out of the keyword', () => {
    expect(kinds('_ show sticks')).toEqual(['plain:_ ', 'keyword:show', 'argument: sticks']);
    expect(kinds('   hide all')).toEqual(['plain:   ', 'keyword:hide', 'argument: all']);
  });

  it('opens and closes a python block, skipping the body as python', () => {
    expect(highlightPmlLine('python', 'none').next).toBe('python');
    const body = highlightPmlLine('  x = 1', 'python');
    expect(body.next).toBe('python');
    const close = highlightPmlLine('python end', 'python');
    expect(close.next).toBe('none');
    expect(close.tokens[0]!.kind).toBe('keyword');
  });

  it('greys out a skip block until its end', () => {
    expect(highlightPmlLine('skip', 'none').next).toBe('skip');
    const inside = highlightPmlLine('anything at all', 'skip');
    expect(inside.tokens[0]!.kind).toBe('skipped');
    expect(highlightPmlLine('skip end', 'skip').next).toBe('none');
  });

  it('carries a backslash continuation to the next line', () => {
    expect(highlightPmlLine('set_color foo, \\', 'none').next).toBe('continued');
    expect(highlightPmlLine('  [1, 0, 0]', 'continued').next).toBe('none');
    expect(highlightPmlLine('  [1, 0, \\', 'continued').next).toBe('continued');
  });

  it('tokenises a whole document with the block state carried across lines', () => {
    const lines = highlight('# hi\npython\nprint(1)\npython end\nshow sticks', 'pml');
    expect(lines.length).toBe(5);
    expect(lines[0]![0]!.kind).toBe('comment');
    expect(lines[2]![0]!.kind).toBe('argument'); // inside the python block
    expect(lines[3]![0]!.kind).toBe('keyword'); // python end
    expect(lines[4]![0]!.kind).toBe('keyword'); // show
  });
});

describe('Python highlighting', () => {
  it('marks keywords, strings and comments', () => {
    const tokens = highlightPythonLine('from pymol import cmd  # go');
    const byKind = tokens.tokens.filter((t) => t.kind !== 'plain').map((t) => `${t.kind}:${t.text}`);
    expect(byKind).toContain('keyword:from');
    expect(byKind).toContain('keyword:import');
    expect(byKind).toContain('comment:# go');
    const strings = highlightPythonLine('cmd.load("a.pdb")').tokens.filter(
      (t) => t.kind === 'string',
    );
    expect(strings.map((t) => t.text)).toEqual(['"a.pdb"']);
  });
});

describe('Plain Text', () => {
  it('is genuinely unhighlighted — there is no syntax/plain.py upstream', () => {
    const lines = highlight('# not a comment here\nshow sticks', 'plain');
    expect(lines.every((tokens) => tokens.every((t) => t.kind === 'plain'))).toBe(true);
  });
});
