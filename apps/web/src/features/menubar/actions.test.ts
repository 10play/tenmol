/**
 * Action tests: what a click actually sends.
 *
 * The `MenuRuntime` is a recorder, so every assertion here is "clicking X emits
 * exactly this on the wire" — the acceptance criterion the plan states for
 * WP-14 ("command-trace equivalence against Qt").
 */

import { beforeEach, describe as suite, expect, it, vi } from 'vitest';
import { walkMenu, type MenuNode } from '@tenmol/protocol/topics/menus';
import { MENU_DATA } from './generated/menudata';
import {
  formatMovieCommand,
  movieProgram,
  removeLastMovieProgram,
  resetMovieProgram,
  runAction,
  setSetting,
  type MenuRuntime,
} from './actions';

interface Trace {
  rt: MenuRuntime;
  did: string[];
  called: [string, unknown[], Record<string, unknown>][];
  notes: string[];
  urls: string[];
}

function trace(over: Partial<MenuRuntime> = {}, callResult: unknown = 0): Trace {
  const did: string[] = [];
  const called: [string, unknown[], Record<string, unknown>][] = [];
  const notes: string[] = [];
  const urls: string[] = [];
  const rt: MenuRuntime = {
    run: async (line) => {
      did.push(line);
    },
    call: async (fn, args, kwargs) => {
      called.push([fn, [...(args ?? [])], { ...(kwargs ?? {}) }]);
      return callResult as never;
    },
    note: (text) => notes.push(text),
    openUrl: (url) => urls.push(url),
    hooks: {},
    ...over,
  };
  return { rt, did, called, notes, urls };
}

const node = (label: string): Extract<MenuNode, { kind: 'command' }> => {
  for (const n of walkMenu(MENU_DATA.menus)) {
    if (n.kind === 'command' && n.label === label) return n;
  }
  throw new Error(`no menu item labelled ${label}`);
};

beforeEach(() => resetMovieProgram());

suite('command strings', () => {
  it('go out as {t:do} so PyMOL produces the echo', async () => {
    const t = trace();
    await runAction(t.rt, node('Acetylene [Alt-J]').action);
    expect(t.did).toEqual(["editor.attach_fragment('pk1','acetylene',2,0)"]);
    expect(t.called).toEqual([]);
  });

  it('cover the whole Wizard menu', async () => {
    const t = trace();
    await runAction(t.rt, node('Appearance').action);
    await runAction(t.rt, node('Measurement').action);
    expect(t.did).toEqual(['wizard appearance', 'wizard measurement']);
  });
});

suite('callables', () => {
  it('go out as {t:call}, silently, as Qt does', async () => {
    const t = trace();
    await runAction(t.rt, node('Undo [Ctrl-Z]').action);
    expect(t.called).toEqual([['cmd.undo', [], {}]]);
    expect(t.did).toEqual([]);
  });

  it('keep argument order and keywords', async () => {
    const t = trace();
    await runAction(t.rt, node('4 Angstrom Sphere').action);
    expect(t.called).toEqual([['cmd.zoom', ['center', 4], { animate: -1 }]]);
  });

  it('fire a composite in order', async () => {
    const t = trace();
    await runAction(t.rt, node('Uni-Layer').action);
    expect(t.called).toEqual([
      ['cmd.set', ['transparency_mode', 2], { quiet: 0 }],
      ['cmd.set', ['backface_cull', 1], { quiet: 0 }],
      ['cmd.set', ['two_sided_lighting', 0], { quiet: 0 }],
    ]);
  });

  it('drives the F-key scene submenus', async () => {
    const t = trace();
    for (const n of walkMenu(MENU_DATA.menus)) {
      if (n.kind === 'command' && n.label === 'F7') await runAction(t.rt, n.action);
    }
    expect(t.called).toEqual([
      ['cmd.scene', ['F7', 'recall'], {}],
      ['cmd.scene', ['F7', 'store'], {}],
      ['cmd.scene', ['F7', 'clear'], {}],
    ]);
  });

  it('reports a failure instead of failing silently', async () => {
    const t = trace({
      call: async () => {
        throw new Error('NotAllowed: nope');
      },
    });
    await runAction(t.rt, node('Undo [Ctrl-Z]').action);
    expect(t.notes.join('')).toContain('NotAllowed: nope');
  });
});

suite('urls', () => {
  it('open the Help targets', async () => {
    const t = trace();
    await runAction(t.rt, node('PyMOL Home Page').action);
    await runAction(t.rt, node('Selection Algebra').action);
    expect(t.urls).toEqual([
      'http://www.pymol.org',
      'https://pymolwiki.org/index.php/Selection_Algebra',
    ]);
  });
});

suite('hooks', () => {
  it('run a registered handler with the menu argument', async () => {
    const seen: unknown[][] = [];
    const t = trace({ hooks: { new_window: (args) => void seen.push(args) } });
    // `new_window` is declared unavailable, so it must NOT reach the handler.
    await runAction(t.rt, node('Default').action);
    expect(seen).toEqual([]);
    expect(t.notes.join('')).toContain('one PyMOL process per bridge');
  });

  it('name the owner of a hook nobody has built', async () => {
    const t = trace();
    await runAction(t.rt, node('Open...').action);
    expect(t.notes.join('')).toContain('WP-18');
    expect(t.notes.join('')).toContain('file_open');
  });
});

suite('mvprg — the stateful Movie helper', () => {
  it('substitutes get_movie_length()+1 and runs the command', async () => {
    const t = trace({}, 7);
    const handler = { mvprg: (args: unknown[]) => runMv(t.rt, args) };
    const rt = { ...t.rt, hooks: handler };
    await runAction(rt, node('15 deg. over 4 sec.').action);
    expect(t.called).toEqual([['cmd.get_movie_length', [], {}]]);
    expect(t.did).toEqual(['movie.add_nutate(4,15,start=8)']);
    expect(movieProgram).toEqual({ start: 8, command: 'movie.add_nutate(4,15,start=8)' });
  });

  it('re-runs the stored command for "Update Last Program"', async () => {
    const t = trace({}, 2);
    const rt = { ...t.rt, hooks: { mvprg: (args: unknown[]) => runMv(t.rt, args) } };
    await runAction(rt, node('4 seconds').action);
    expect(t.did).toEqual(["movie.add_roll(4.0,axis='x',start=3)"]);
    await runAction(rt, node('Update Last Program').action);
    expect(t.did).toEqual([
      "movie.add_roll(4.0,axis='x',start=3)",
      "movie.add_roll(4.0,axis='x',start=3)",
    ]);
    // and get_movie_length is NOT consulted the second time
    expect(t.called.filter(([fn]) => fn === 'cmd.get_movie_length')).toHaveLength(1);
  });

  it('says so when there is nothing to update', async () => {
    const t = trace();
    const rt = { ...t.rt, hooks: { mvprg: (args: unknown[]) => runMv(t.rt, args) } };
    await runAction(rt, node('Update Last Program').action);
    expect(t.did).toEqual([]);
    expect(t.notes.join('')).toContain('no program has been added');
  });

  it('removes the last program with mdelete(-1, movie_start)', async () => {
    const t = trace({}, 4);
    const rt = { ...t.rt, hooks: { mvprg: (args: unknown[]) => runMv(t.rt, args) } };
    await runAction(rt, node('8 seconds').action);
    expect(movieProgram.start).toBe(5);
    await removeLastMovieProgram(t.rt);
    expect(t.called.at(-1)).toEqual(['cmd.mdelete', [-1, 5], {}]);
  });

  it('substitutes exactly one %d', () => {
    expect(formatMovieCommand('movie.add_nutate(4,15,start=%d)', 12)).toBe(
      'movie.add_nutate(4,15,start=12)',
    );
    expect(
      formatMovieCommand('set sweep_angle,30;cmd.movie.add_scenes(None, 2, rock=4, start=%d)', 1),
    ).toBe('set sweep_angle,30;cmd.movie.add_scenes(None, 2, rock=4, start=1)');
  });
});

suite('check / radio clicks', () => {
  it('send cmd.set(name, value, log=1, quiet=0), as Qt does', async () => {
    const t = trace();
    await setSetting(t.rt, 'cartoon_fancy_helices', 1);
    expect(t.called).toEqual([['cmd.set', ['cartoon_fancy_helices', 1], { log: 1, quiet: 0 }]]);
  });

  it('reports a refusal', async () => {
    const t = trace({
      call: async () => {
        throw new Error('boom');
      },
    });
    await setSetting(t.rt, 'x', 1);
    expect(t.notes.join('')).toContain('boom');
  });
});

suite('coverage of the whole tree', () => {
  it('leaves nothing dead: all 388 command leaves emit traffic or explain', async () => {
    const t = trace({}, 0);
    const silent = vi.fn();
    const rt: MenuRuntime = {
      ...t.rt,
      note: silent,
      hooks: { mvprg: (args) => runMv({ ...t.rt, note: silent }, args) },
    };

    const dead: string[] = [];
    let handled = 0;
    for (const n of walkMenu(MENU_DATA.menus)) {
      if (n.kind !== 'command') continue;
      handled += 1;
      const before =
        t.did.length + t.called.length + t.urls.length + silent.mock.calls.length;
      await runAction(rt, n.action);
      const after = t.did.length + t.called.length + t.urls.length + silent.mock.calls.length;
      if (after === before) dead.push(n.label);
    }
    expect(handled).toBe(388);
    expect(dead).toEqual([]);
  });
});

/** The MenuBar wires `mvprg` to this; the test drives the same function. */
async function runMv(rt: MenuRuntime, args: unknown[]): Promise<void> {
  const { runMovieProgram } = await import('./actions');
  await runMovieProgram(rt, args[0] as string | null);
}
