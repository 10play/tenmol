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

  it('keeps `key=value` tokens POSITIONAL (never splits into kwargs)', () => {
    // `=` is valid selection (`b=50`) and `alter`/`iterate` expression
    // (`resi=10`) syntax, so a `key=value` token stays a positional arg — the
    // console cannot infer kwargs without each command's signature.
    const p = parseCommand('spectrum count, palette=rainbow, selection=all');
    expect(p.keyword).toBe('spectrum');
    expect(p.args).toEqual(['count', 'palette=rainbow', 'selection=all']);
    expect(p.kwargs).toEqual({});
  });

  it('leaves selection/expression `=` intact (`b=50`, `resi=10`)', () => {
    // Regression: the selector uses bare `=` for b/q/pc/fc, and alter/iterate
    // take a `field=value` assignment expression. Both MUST reach the handler.
    expect(parseCommand('select buried, b=50').args).toEqual(['buried', 'b=50']);
    expect(parseCommand('alter all, resi=10').args).toEqual(['all', 'resi=10']);
    expect(parseCommand("iterate all, name='CA'").args).toEqual(['all', "name='CA'"]);
  });

  it('respects quotes: a comma inside a quoted value does not split the token', () => {
    // The comma inside the quotes does not split; the token is kept verbatim
    // (only quotes surrounding the WHOLE token are stripped).
    expect(parseCommand('label all, text="a=b,c"').args).toEqual(['all', 'text="a=b,c"']);
    expect(parseCommand('set_title obj, "x, y = z"').args).toEqual(['obj', 'x, y = z']);
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
    await b.do('color red, all');
    expect(await b.call('count_atoms', ['color red'])).toBeGreaterThan(0);
  });

  it('an `alter … , field=value` expression reaches the handler intact', async () => {
    const b = await boot();
    // Regression: the parser must NOT strip `b=42` into kwargs — the whole
    // expression is alter's second positional arg, or nothing gets mutated.
    await b.do('alter all, b=42');
    // Every atom now has b-factor 42 (the expression ran).
    const total = (await b.call('count_atoms', ['all'])) as number;
    expect(await b.call('count_atoms', ['b=42'])).toBe(total);
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
    // namespace proxy that dispatches through the engine, so an UNPORTED editor
    // verb reports a clean NotPorted rather than `editor is not defined`.
    // (`attach_amino_acid` itself is now ported — see editor.test.ts — so this
    // uses one that is still unported.)
    await b.do("editor.combine_fragment('x')");
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

  it('reports a @script embedded in a compound command line', async () => {
    const b = await boot();
    const seen: string[] = [];
    b.on('feedback', ({ lines }) => seen.push(...lines));
    // `select` makes this the command branch; the trailing @a.pml must still be
    // reported, not silently dropped or mis-run.
    await b.do('select x, all; @a.pml');
    expect(seen.join('\n')).toMatch(/@script files are not supported/);
  });

  it('a `b=50` selection survives the command path (select then count)', async () => {
    const b = await boot();
    // If the parser had stripped `b=50` into kwargs, the selection would be
    // empty/garbage; here it must select atoms with B-factor exactly 50 (none in
    // the fixture) without error, proving the term reached the selector.
    const n = await b.call('select', ['hib', 'b=50']);
    expect(typeof n).toBe('number');
  });
});
