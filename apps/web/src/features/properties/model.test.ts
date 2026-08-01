/**
 * The properties inspector's formatting and type coercion.
 *
 * These two are where the Qt dialog actually lives: `strfunctions`
 * (`properties_dialog.py:11-16`) decides what a value LOOKS like, and
 * `get_new_value` (`:202-213`) decides what an edit MEANS. Both had to move to
 * the client because `get_new_value` is a closure passed through `cmd.alter`'s
 * `space=`, and a closure cannot cross a WebSocket.
 */

import { describe, expect, it } from 'vitest';
import {
  KEYS,
  coerceToPythonLiteral,
  emptyTree,
  formatValue,
  inferOldKind,
  oneLetter,
  parseIntBase0,
  pythonString,
} from './model';
import { editExpression } from './service';

describe('the fixed tree (properties_dialog.py:69-117)', () => {
  it('has the four levels and every branch, in upstream order', () => {
    const tree = emptyTree();
    expect(tree.map((s) => s.label)).toEqual([
      'Object-Level',
      'Object-State-Level',
      'Atom-Level',
      'Atom-State-Level',
    ]);
    expect(tree[0]!.groups.map((g) => g.label)).toEqual(['TTT Matrix', 'Settings']);
    expect(tree[1]!.groups.map((g) => g.label)).toEqual(['Title', 'State Matrix', 'Settings']);
    /*
     * The Incentive-only branch is PRESENT upstream (`properties_dialog.py`
     * lists it in the fixed tree) and hidden in open-source Qt builds. `p.all`
     * works in this build — measured in `bridge/tests/test_properties.py` —
     * so it is shown, between the built-ins and Settings as upstream orders it.
     */
    expect(tree[2]!.groups.map((g) => g.label)).toEqual([
      'Identifiers',
      'Properties (built-in)',
      'Properties (custom)',
      'Settings',
    ]);
    expect(tree[3]!.groups.map((g) => g.label)).toEqual(['Properties (built-in)', 'Settings']);
  });

  it('carries 11 identifiers, 19 atom builtins and 4 atom-state builtins', () => {
    expect(KEYS.identifiers.length).toBe(11);
    expect(KEYS.atomBuiltins.length).toBe(19);
    expect(KEYS.astateBuiltins.length).toBe(4);
  });

  it('omits `stereo` deliberately, as upstream does', () => {
    expect([...KEYS.atomBuiltins]).not.toContain('stereo');
  });
});

describe('strfunctions (properties_dialog.py:11-16)', () => {
  it('renders color as hex only at or above 0x40000000', () => {
    expect(formatValue('color', 0x40000001)).toBe('0x40000001');
    expect(formatValue('color', 5)).toBe('5');
  });

  it('renders reps and flags in binary', () => {
    expect(formatValue('reps', 5)).toBe('0b101');
    expect(formatValue('flags', 0b1000000000000000000000000001000000)).toBe(
      '0b' + (0b1000000000000000000000000001000000 >>> 0).toString(2),
    );
  });

  it('leaves everything else alone', () => {
    expect(formatValue('b', 20)).toBe('20');
    expect(formatValue('name', 'CA')).toBe('CA');
    expect(formatValue('', [1, 0, 0, 0])).toBe('[1, 0, 0, 0]');
    expect(formatValue('x', null)).toBe('');
  });
});

describe("get_new_value's cast (properties_dialog.py:202-213)", () => {
  it('reads hex and binary literals for an int old value, like int(x, 0)', () => {
    expect(parseIntBase0('0x1f')).toBe(31);
    expect(parseIntBase0('0b1010')).toBe(10);
    expect(parseIntBase0('0o17')).toBe(15);
    expect(parseIntBase0('-12')).toBe(-12);
    expect(parseIntBase0('1.5')).toBeNull();
    expect(parseIntBase0('CA')).toBeNull();
  });

  it('infers the old type from the RENDERED text, so 1.0 stays a float', () => {
    expect(inferOldKind('20')).toBe('int');
    expect(inferOldKind('0b101')).toBe('int');
    expect(inferOldKind('1.0')).toBe('float');
    expect(inferOldKind('True')).toBe('literal');
    expect(inferOldKind('[1, 0, 0]')).toBe('literal');
    expect(inferOldKind('CA')).toBe('str');
  });

  it('casts to the OLD value type, which is why resv = "3" works', () => {
    expect(coerceToPythonLiteral('int', '0x1f')).toEqual({ literal: '31', needsSafeEval: false });
    expect(coerceToPythonLiteral('float', '2.75')).toEqual({
      literal: '2.75',
      needsSafeEval: false,
    });
    expect(coerceToPythonLiteral('str', 'CB')).toEqual({ literal: "'CB'", needsSafeEval: false });
  });

  it('safe_evals tuples, lists and bools', () => {
    expect(coerceToPythonLiteral('literal', '[3, 4]')).toEqual({
      literal: '[3, 4]',
      needsSafeEval: true,
    });
    expect(coerceToPythonLiteral('literal', 'False')).toEqual({
      literal: 'False',
      needsSafeEval: true,
    });
  });

  it('falls back to the raw string when the cast fails', () => {
    expect(coerceToPythonLiteral('int', 'not a number')).toEqual({
      literal: "'not a number'",
      needsSafeEval: false,
    });
  });

  it('escapes quotes and backslashes in a Python string literal', () => {
    expect(pythonString("it's")).toBe("'it\\'s'");
    expect(pythonString('a\\b')).toBe("'a\\\\b'");
  });
});

describe('the alter expression an edit sends', () => {
  it('is `key = <literal>` for a built-in', () => {
    expect(editExpression('b', '20', '25')).toBe('b = 25');
    expect(editExpression('resn', 'HIS', 'ALA')).toBe("resn = 'ALA'");
  });

  it('prefixes atom settings with s. and keeps a float a float', () => {
    // The bug this test caught: JS cannot tell 1.0 from 1, so a float setting
    // was being coerced through the INT branch and quoted as a string.
    expect(editExpression('s.sphere_scale', '1.0', '0.5')).toBe('s.sphere_scale = 0.5');
  });

  it('keeps a hex reps edit as the decimal int PyMOL expects', () => {
    expect(editExpression('reps', '0b101', '0b1010')).toBe('reps = 10');
  });
});

describe('oneletter', () => {
  it('derives the read-only oneletter column from resn', () => {
    expect(oneLetter('HIS')).toBe('H');
    expect(oneLetter('ala')).toBe('A');
    expect(oneLetter('LIG')).toBe('?');
  });
});
