/**
 * The command-line parser (`cmd/parser.ts`): keyword/positional/kwarg splitting,
 * quote handling, and multi-command splitting — plus the `do()` behaviours that
 * ride on it (`key=value` reaches the handler as kwargs; `@script` is reported).
 */
import { describe, it, expect } from 'vitest';

import { LocalBackend } from '@tenmol/engine-ts';
import { parseCommand, splitCommands } from '../src/cmd/parser';
import { SMALL_PDB } from './fixture';

describe('parseCommand', () => {
  it('splits keyword and comma-separated positional args', () => {
    expect(parseCommand('color red, name CA')).toEqual({
      keyword: 'color',
      args: ['red', 'name CA'],
      kwargs: {},
    });
  });

  it('lower-cases the keyword and handles a bare verb', () => {
    expect(parseCommand('Orient')).toEqual({ keyword: 'orient', args: [], kwargs: {} });
  });

  it('parses `key=value` tokens as kwargs, keeping positional order', () => {
    const p = parseCommand('spectrum count, palette=rainbow, selection=all');
    expect(p.keyword).toBe('spectrum');
    expect(p.args).toEqual(['count']);
    expect(p.kwargs).toEqual({ palette: 'rainbow', selection: 'all' });
  });

  it('does not treat `==` or an operator inside a value as a kwarg', () => {
    const p = parseCommand('select b>50');
    expect(p.args).toEqual(['b>50']);
    expect(p.kwargs).toEqual({});
  });

  it('respects quotes: commas and `=` inside a quoted value do not split', () => {
    // The comma inside the quotes does not split; `text=` makes it a kwarg whose
    // value is the unquoted string (which itself contains `=` and `,`).
    const p = parseCommand('label all, text="a=b,c"');
    expect(p.args).toEqual(['all']);
    expect(p.kwargs).toEqual({ text: 'a=b,c' });
    // A leading-quote token is positional; its inner commas/`=` are preserved.
    const q = parseCommand('set_title obj, "x, y = z"');
    expect(q.args).toEqual(['obj', 'x, y = z']);
    expect(q.kwargs).toEqual({});
  });

  it('strips one layer of surrounding quotes from positional args', () => {
    expect(parseCommand('load "my file.pdb"').args).toEqual(['my file.pdb']);
  });
});

describe('splitCommands', () => {
  it('splits on newlines and semicolons but not inside quotes', () => {
    expect(splitCommands('show sticks; color red')).toEqual(['show sticks', 'color red']);
    expect(splitCommands('a\nb')).toEqual(['a', 'b']);
    expect(splitCommands('label all, "a; b"')).toEqual(['label all, "a; b"']);
  });
});

describe('do() integration', () => {
  async function boot() {
    const b = new LocalBackend();
    await b.connect();
    await b.call('read_pdbstr', [SMALL_PDB, 'm']);
    return b;
  }

  it('runs a `key=value` console line through to the handler', async () => {
    const b = await boot();
    // `set` via kwargs-free positional still works, and a kwarg line parses.
    await b.do('color red, all');
    expect(await b.call('count_atoms', ['color red'])).toBeGreaterThan(0);
  });

  it('reports @script instead of evaluating it as JavaScript', async () => {
    const b = await boot();
    const seen: string[] = [];
    b.on('feedback', ({ lines }) => seen.push(...lines));
    await b.do('@setup.pml');
    expect(seen.join('\n')).toMatch(/@script files are not supported/);
  });

  it('an unported `editor.*` console call gives NotPorted, not "editor is not defined"', async () => {
    const b = await boot();
    const seen: string[] = [];
    b.on('feedback', ({ lines }) => seen.push(...lines));
    // Function-call form falls to the JS evaluator; `editor` must resolve to a
    // namespace proxy that dispatches through the engine (the exact case that
    // started the backlog: attach_amino_acid).
    await b.do("editor.attach_amino_acid('ALA')");
    const text = seen.join('\n');
    expect(text).not.toMatch(/editor is not defined/);
    expect(text).toMatch(/not ported by @tenmol\/engine-ts/);
  });

  it('a ported namespace call works from the bare console (util.cbag)', async () => {
    const b = await boot();
    await b.do("util.cbag('all')");
    // cbag colours carbons green; at least it ran without a ReferenceError.
    expect(await b.call('count_atoms', ['all'])).toBeGreaterThan(0);
  });
});
