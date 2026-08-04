/**
 * Wave 8 — the client's 80-slot ButMode table, diffed against PyMOL's own.
 *
 * The parity row for "Mouse configuration rings and cycling" said:
 *
 *   NOT verified: that each ring's 80-slot table matches PyMOL's own for that
 *   mode, slot by slot.
 *
 * and the row for "`cmd.button` bit-packing" said:
 *
 *   NOT verified: the packed integer a `cmd.button` write actually sends.
 *
 * `__fixtures__/p8a34-butmode.json` is not hand-written. It is what PyMOL's own
 * `cmd.button` handed to `_cmd.button` for every row of every `mode_dict`
 * entry, captured by spying on the C entry point in a live engine
 * (`packages/bridge/tests/test_p8_a34.py`, which fails if the file drifts). So this file
 * is a genuine cross-language diff, not a mirror checked against itself.
 */

import { describe, expect, it } from 'vitest';

import { BUT_ACT_CODE, BUT_MOD_CODE, BUTTON_CODE, buttonSlot, canonicalButton } from './butmode';
import { MODE_DICT } from './modes';
import { tableForMode } from './mouseConfig';
import fixture from './__fixtures__/p8a34-butmode.json';

const TABLES = fixture.tables as Record<string, number[]>;
const PAIRS = fixture.pairs as Record<string, number>;

describe('cmd.button bit-packing, against the integers PyMOL really sent', () => {
  it('covers all 80 button x modifier pairs', () => {
    expect(Object.keys(PAIRS)).toHaveLength(80);
  });

  it('packs every pair to the same slot PyMOL packed it to', () => {
    const mismatches: string[] = [];
    for (const [key, expected] of Object.entries(PAIRS)) {
      const [button, modifier] = key.split('/') as [string, string];
      const got = buttonSlot(button, modifier);
      if (got !== expected) mismatches.push(`${key}: got ${got}, PyMOL sent ${expected}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('knows the same button and modifier names PyMOL does', () => {
    const names = new Set(Object.keys(PAIRS).map((k) => k.split('/')[0] as string));
    expect([...names].sort()).toEqual(Object.keys(BUTTON_CODE).sort());
    const mods = new Set(Object.keys(PAIRS).map((k) => k.split('/')[1] as string));
    expect([...mods].sort()).toEqual(Object.keys(BUT_MOD_CODE).sort());
  });

  it('resolves the `l`/`m`/`r`/`w` aliases `mode_dict` writes', () => {
    // mode_dict spells buttons as single letters; PAIRS uses the long names.
    expect(buttonSlot('l', 'shft')).toBe(PAIRS['left/shft']);
    expect(canonicalButton('W')).toBe('wheel');
    expect(buttonSlot('w', 'ctrl')).toBe(PAIRS['wheel/ctrl']);
  });
});

describe('the 80-slot table of every mouse mode, slot by slot', () => {
  it('has an entry for each of PyMOL`s eleven modes and no more', () => {
    expect(Object.keys(TABLES).sort()).toEqual(Object.keys(MODE_DICT).sort());
  });

  for (const mode of Object.keys(TABLES).sort()) {
    it(`${mode} matches PyMOL slot for slot`, () => {
      const expected = TABLES[mode] as number[];
      const got = tableForMode(mode as keyof typeof MODE_DICT);
      expect(got).toHaveLength(80);
      const diff: string[] = [];
      for (let slot = 0; slot < 80; slot += 1) {
        if (got[slot] !== expected[slot]) {
          diff.push(`slot ${slot}: got ${got[slot]}, PyMOL has ${expected[slot]}`);
        }
      }
      expect(diff).toEqual([]);
    });
  }

  it('the tables are not all the same table', () => {
    // Guards the diff above from passing because every mode is identical.
    const serialised = new Set(Object.values(TABLES).map((t) => t.join(',')));
    expect(serialised.size).toBe(Object.keys(TABLES).length);
  });

  it('every bound slot carries a `cButMode*` action code, never a row index', () => {
    const valid = new Set(Object.values(BUT_ACT_CODE));
    for (const [mode, table] of Object.entries(TABLES)) {
      for (const code of table) {
        if (code === -1) continue;
        expect(valid.has(code), `${mode} has unknown action code ${code}`).toBe(true);
      }
    }
  });
});
