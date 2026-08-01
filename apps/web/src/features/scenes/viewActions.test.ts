/**
 * Named camera views — the command strings, and the listing parser.
 *
 * Every fixture message below is a LITERAL capture from a live bridge, asserted
 * on the backend side in `bridge/tests/test_wf_camera.py`
 * (`test_the_only_machine_readable_listing_is_a_failed_lookup`). If PyMOL's
 * `Shortcut.auto_err` ever changes shape, that test fails first and this one
 * follows, instead of the panel quietly showing an empty list forever.
 */

import { describe, expect, it } from 'vitest';
import {
  parseViewNames,
  VIEW_PROBE_KEY,
  viewActions,
  viewNameProblem,
} from './viewActions';

const probeMsg = (block: string) =>
  `Error: unknown view: '${VIEW_PROBE_KEY}'. Choices:\n${block}`;

describe('viewActions', () => {
  it('store/recall/clear are cmd.view with the documented action', () => {
    expect(viewActions.store('alpha')).toMatchObject({
      fn: 'cmd.view',
      args: ['alpha', 'store'],
    });
    expect(viewActions.clear('alpha')).toMatchObject({ args: ['alpha', 'clear'] });
    expect(viewActions.clearAll()).toMatchObject({ args: ['*', 'clear'] });
  });

  it('recall carries animate=-1, the server-side sweep, and 0 for ctrl-click', () => {
    // -1 is PyMOL's own default and means "ask the `animation` setting".
    // The client never interpolates: doing both is the failure mode the
    // inventory row 00:330 calls out by name.
    expect(viewActions.recall('alpha').kwargs).toEqual({ animate: -1 });
    expect(viewActions.recall('alpha', 0).kwargs).toEqual({ animate: 0 });
    expect(viewActions.recallInstant('alpha').kwargs).toEqual({ animate: 0 });
  });

  it('there is no update action, because upstream cannot reach it', () => {
    // `view_sc = Shortcut(['store','recall','clear'])` (`viewing.py:64`) rejects
    // 'update' before the branch that handles it ever runs. Anything offering
    // an "update" button here would be sending a call that always errors.
    expect(Object.keys(viewActions)).not.toContain('update');
  });

  it('the probe is a recall, so it must never match a real view', () => {
    expect(viewActions.probe().args).toEqual([VIEW_PROBE_KEY, 'recall']);
    // A prefix of a real name would RECALL it and move the camera; the key is
    // deliberately not a prefix of anything a user would type.
    expect(VIEW_PROBE_KEY.startsWith('__')).toBe(true);
  });
});

describe('parseViewNames', () => {
  it('reads the column block a live bridge returns', () => {
    expect(parseViewNames(probeMsg('  alpha  beta   mu   '))).toEqual([
      'alpha',
      'beta',
      'mu',
    ]);
  });

  it('an empty dict is an empty Choices block, not a missing one', () => {
    // MEASURED: "Error: unknown view: 'X'. Choices:\n" -- the header is always
    // printed, the block is not. A parser that keyed on the block being absent
    // would report "cannot read the list" for the ordinary empty case.
    expect(parseViewNames(probeMsg(''))).toEqual([]);
  });

  it('multi-line column output collapses to names', () => {
    // `list_to_str_list` wraps at 77 columns, so a long list arrives as
    // several lines inside one message.
    expect(parseViewNames(probeMsg('  a    b    c  \n  d    e  '))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('returns null for anything that is not a view listing', () => {
    // A disconnect or a policy refusal must NOT be read as "zero views" and
    // blank the panel.
    expect(parseViewNames('socket closed')).toBeNull();
    expect(parseViewNames('NotAllowed: cmd.view: no such symbol')).toBeNull();
    expect(parseViewNames("Error: unknown action: 'list'. Choices:\n  clear ")).toBeNull();
  });
});

describe('viewNameProblem', () => {
  it('refuses the three names PyMOL loses instead of rejecting', () => {
    expect(viewNameProblem('')).toMatch(/blank/);
    expect(viewNameProblem('   ')).toMatch(/blank/);
    expect(viewNameProblem('two words')).toMatch(/spaces/);
    // `Shortcut(keys)` drops `_`-prefixed keywords on the next rebuild, so the
    // view survives in the dict and becomes permanently unrecallable.
    expect(viewNameProblem('_hidden')).toMatch(/underscore|"_"/);
    expect(viewNameProblem('*')).toMatch(/all views/);
  });

  it('accepts what PyMOL can actually round-trip', () => {
    for (const name of ['alpha', 'F1', 'view-2', 'a.b', 'front_view']) {
      expect(viewNameProblem(name)).toBeNull();
    }
  });
});
