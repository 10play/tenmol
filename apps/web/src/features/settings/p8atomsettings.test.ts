/**
 * `atomSettings.ts` — the `cmd.alter` / `cmd.alter_state` write path.
 *
 * Row 211's gap clause: "NOT done: alter/alter_state writes and the atom-STATE
 * level (no cmd.set path exists)". This file pins the expression builder; the
 * engine end is `bridge/tests/test_p8_a5.py`, which sends these exact strings
 * over the WebSocket and reads the result back with `cmd.iterate_state`:
 *
 *     alter_state 1, sel, s['label_screen_point']=(1.0, 2.0, 3.0)   -> (1,2,3)
 *     alter_state 1, sel, s['label_multiline_spacing']=0.5          -> 0.5
 *     alter_state 1, sel, s['label_relative_mode']=2                -> 2
 *     alter_state 1, sel, s['label_bg_outline']=1                   -> 1
 *     alter_state 1, sel, s['label_bg_color']='tv_red'              -> 32
 *
 * The literal builder is the security boundary as well as the correctness one:
 * `alter` evaluates whatever it is handed, per atom, and the bridge marks both
 * verbs dangerous. A value box must never become a Python fragment.
 */

import { describe, expect, it } from 'vitest';
import type { SettingKind, SettingMeta } from '@tenmol/protocol';
import {
  atomSettingDelete,
  atomSettingWrite,
  describeAtomWriteResult,
  pythonLiteral,
} from './atomSettings';

function meta(name: string, kind: SettingKind, index = 728): SettingMeta {
  return { name, index, kind, level: 'atom-state' } as SettingMeta;
}

describe('pythonLiteral', () => {
  it('writes a float3 as a tuple, however the user typed it', () => {
    expect(pythonLiteral('float3', '1 2 3')).toBe('(1.0, 2.0, 3.0)');
    expect(pythonLiteral('float3', '[1, 2, 3]')).toBe('(1.0, 2.0, 3.0)');
    expect(pythonLiteral('float3', [0.5, 0, -1])).toBe('(0.5, 0.0, -1.0)');
    expect(() => pythonLiteral('float3', '1 2')).toThrow(/three numbers/);
  });

  it('keeps a float looking like a float and truncates an int', () => {
    expect(pythonLiteral('float', '0.5')).toBe('0.5');
    expect(pythonLiteral('float', '1')).toBe('1.0');
    expect(pythonLiteral('int', '2.9')).toBe('2');
    expect(() => pythonLiteral('float', 'nope')).toThrow(/not a number/);
  });

  it('turns PyMOL’s boolean words into 1 and 0', () => {
    expect(pythonLiteral('boolean', 'on')).toBe('1');
    expect(pythonLiteral('boolean', true)).toBe('1');
    expect(pythonLiteral('boolean', '1')).toBe('1');
    expect(pythonLiteral('boolean', 'off')).toBe('0');
    expect(pythonLiteral('boolean', '0')).toBe('0');
    expect(pythonLiteral('boolean', false)).toBe('0');
  });

  it('sends a colour NAME as a string and a colour INDEX as a number', () => {
    // `SettingSetFromPyObject` resolves a string through ColorGetIndex —
    // measured: s['label_bg_color']='tv_red' reads back as 32.
    expect(pythonLiteral('color', 'tv_red')).toBe("'tv_red'");
    expect(pythonLiteral('color', '32')).toBe('32');
    expect(pythonLiteral('color', -1)).toBe('-1');
  });

  it('escapes a string so the value cannot close the quote', () => {
    expect(pythonLiteral('string', "it's")).toBe("'it\\'s'");
    expect(pythonLiteral('string', "a'); import os; ('")).toBe("'a\\'); import os; (\\''");
    expect(pythonLiteral('string', 'back\\slash')).toBe("'back\\\\slash'");
  });
});

describe('atomSettingWrite', () => {
  it('atom-state goes through alter_state, with the state first', () => {
    const write = atomSettingWrite(meta('label_screen_point', 'float3'), '1 2 3', 'atom-state', {
      selection: 'elem C',
      state: 1,
    });
    expect(write.fn).toBe('alter_state');
    expect(write.args).toEqual([1, 'elem C', "s['label_screen_point']=(1.0, 2.0, 3.0)"]);
  });

  it('atom goes through alter, with no state at all', () => {
    const write = atomSettingWrite(meta('sphere_scale', 'float', 155), '3.5', 'atom', {
      selection: 'name CA',
      state: 4,
    });
    expect(write.fn).toBe('alter');
    expect(write.args).toEqual(['name CA', "s['sphere_scale']=3.5"]);
  });

  it('never lets state 0 through — alter_state is 1-based', () => {
    const write = atomSettingWrite(meta('label_bg_outline', 'boolean'), 'on', 'atom-state', {
      selection: 'all',
      state: 0,
    });
    expect(write.args[0]).toBe(1);
  });

  it('deletes with `del s[...]`, the hatch cmd.unset cannot reach', () => {
    const del = atomSettingDelete(meta('label_screen_point', 'float3'), 'atom-state', {
      selection: '*',
      state: 1,
    });
    expect(del.args).toEqual([1, '*', "del s['label_screen_point']"]);
    expect(
      atomSettingDelete(meta('sphere_scale', 'float', 155), 'atom', {
        selection: '*',
        state: 1,
      }).args,
    ).toEqual(['*', "del s['sphere_scale']"]);
  });

  it('echoes the line a user could have typed', () => {
    const write = atomSettingWrite(meta('label_bg_color', 'color'), 'tv_red', 'atom-state', {
      selection: 'name CB',
      state: 2,
    });
    expect(write.echo).toBe('cmd.alter_state(2, "name CB", "s[\'label_bg_color\']=\'tv_red\'")');
  });
});

describe('describeAtomWriteResult', () => {
  const write = atomSettingWrite(meta('label_bg_outline', 'boolean'), 'on', 'atom-state', {
    selection: 'x',
    state: 1,
  });

  it('reports the atom count, because that is all the reply carries', () => {
    expect(describeAtomWriteResult(write, 1)).toBe('alter_state: 1 atom');
    expect(describeAtomWriteResult(write, 12)).toBe('alter_state: 12 atoms');
  });

  it('calls 0 out as a silent no-op rather than a success', () => {
    expect(describeAtomWriteResult(write, 0)).toMatch(/matched nothing/);
  });
});
