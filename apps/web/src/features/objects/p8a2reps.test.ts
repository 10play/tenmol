/**
 * Wave 8 — "which reps are already on" for the S/H menus.
 *
 * The command strings below are the literal ones `pymol.menu.rep_action`
 * (`modules/pymol/menu.py:145-176`) builds, whitespace included, and the rep
 * numbers are `pymol.constants.repres`. `bridge/tests/test_p8_a2.py` re-checks
 * the mask table against the LIVE `pymol.constants.repmasks` so this file
 * cannot drift from the engine unnoticed.
 */

import { describe, expect, it } from 'vitest';
import { REP_MASKS, repCheck, repMaskOfCommand } from './reps';

/** `cmd.get_vis()[name][2]` -> the bitmask `panels/objects.py` ships. */
function mask(...indices: number[]): number {
  return indices.reduce((acc, index) => acc | (1 << index), 0);
}

describe('repMaskOfCommand', () => {
  it('reads the rep out of a rep_action leaf, spacing and all', () => {
    expect(repMaskOfCommand('cmd.show("lines"     ,"ala")')).toBe(REP_MASKS.lines);
    expect(repMaskOfCommand('cmd.hide("cartoon"   ,"ala")')).toBe(REP_MASKS.cartoon);
    expect(repMaskOfCommand('cmd.show_as("sticks"    ,"ala")')).toBe(REP_MASKS.sticks);
    expect(repMaskOfCommand('cmd.toggle("surface"   ,"ala")')).toBe(REP_MASKS.surface);
  });

  it('expands the two COMBINATIONS the way constants.py does', () => {
    expect(repMaskOfCommand('cmd.show("wire"      ,"ala")')).toBe(
      mask(7 /* lines */, 11 /* nonbonded */),
    );
    expect(repMaskOfCommand('cmd.show("licorice"  ,"ala")')).toBe(
      mask(0 /* sticks */, 4 /* nb_spheres */),
    );
  });

  it('is 0 for anything that is not a plain rep call', () => {
    expect(repMaskOfCommand(undefined)).toBe(0);
    expect(repMaskOfCommand('')).toBe(0);
    expect(repMaskOfCommand('cmd.color("red","ala")')).toBe(0);
    expect(repMaskOfCommand('cmd.zoom("ala",animate=-1)')).toBe(0);
    // the `flag ignore` leaf is two statements and a rebuild, not a toggle
    expect(
      repMaskOfCommand("cmd.flag(\"ignore\",'ala','clear');cmd.rebuild('ala')"),
    ).toBe(0);
    expect(repMaskOfCommand('cmd.show("not_a_rep","ala")')).toBe(0);
  });
});

describe('repCheck against a live rep list', () => {
  it('ticks exactly the reps in cmd.get_vis()[name][2]', () => {
    // `fragment ala` then `show sticks`: get_vis reports [0, 7] -> lines+sticks
    const reps = mask(0, 7);
    expect(repCheck('cmd.show("sticks"    ,"ala")', reps)).toBe('on');
    expect(repCheck('cmd.show("lines"     ,"ala")', reps)).toBe('on');
    expect(repCheck('cmd.show("cartoon"   ,"ala")', reps)).toBe('off');
    expect(repCheck('cmd.show("spheres"   ,"ala")', reps)).toBe('off');
  });

  it('a combination is `on` only when BOTH of its bits are set', () => {
    const linesOnly = mask(7);
    expect(repCheck('cmd.show("wire"      ,"ala")', linesOnly)).toBe('partial');
    expect(repCheck('cmd.show("wire"      ,"ala")', mask(7, 11))).toBe('on');
    expect(repCheck('cmd.show("wire"      ,"ala")', mask(5))).toBe('off');
  });

  it('never ticks `everything`, which is an action and not a state', () => {
    expect(repCheck('cmd.hide("everything","ala")', mask(0, 7))).toBe('none');
  });

  it('is `none`, not `off`, for a leaf that is not a rep at all', () => {
    expect(repCheck('cmd.color("red","ala")', mask(0))).toBe('none');
  });
});
