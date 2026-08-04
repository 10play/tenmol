/**
 * The ButMode mirror is only worth having if it is provably the same table the
 * C core and `controlling.py` have. These tests read the ACTUAL PyMOL sources
 * in this repository — `packages/engine/layer1/ButMode.h`, `packages/engine/layer1/ButMode.cpp` and (through
 * the bridge venv) `packages/engine/modules/pymol/controlling.py` — and diff them against the
 * TypeScript. A drift upstream fails the build instead of quietly producing a
 * wrong grid.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ACTION_LABEL,
  BLANK_LABEL,
  BUT_ACT_CODE,
  BUT_MODE_COUNT,
  BUT_MODE_INPUT_COUNT,
  BUT_MODE_NOTHING,
  BUT_MOD_CODE,
  BUTTON_CODE,
  GlutButton,
  WheelAction,
  butModeTranslate,
  buttonSlot,
  checkPossibleSingleClick,
  emptyButModeTable,
  selectionLine,
  slotLabel,
} from './butmode';
import { tableForMode } from './mouseConfig';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * The GIT root — four levels up from `packages/viewport/src/input/`.
 *
 * It must be the git root and not `web/`, because the assertions below read
 * BOTH trees against it: `packages/engine/layer1/ButMode.h` (upstream) and
 * `packages/bridge/.venv/...` (ours). Upstream is `packages/engine/`, ours is `packages/`; only the git root
 * is above both.
 */
export const REPO = resolve(HERE, '../../../..');
export const PYTHON = resolve(REPO, 'packages/bridge/.venv/bin/python');

/** Run a snippet in the bridge venv and parse its stdout as JSON. */
export function pyJson<T>(snippet: string): T {
  const out = execFileSync(PYTHON, ['-c', snippet], { encoding: 'utf8', cwd: REPO });
  return JSON.parse(out) as T;
}

export const hasPython = existsSync(PYTHON);

/* ------------------------------------------------------------------ */

describe('action codes', () => {
  it('matches but_act_code in packages/engine/modules/pymol/controlling.py', () => {
    if (!hasPython) return;
    const python = pyJson<Record<string, number>>(
      'import json;from pymol import controlling as c;print(json.dumps(c.but_act_code))',
    );
    expect(BUT_ACT_CODE).toEqual(python);
    // 56 named actions + code 48 (cButModePotentialClick), which has no Python
    // name, accounts for cButModeCount = 57.
    expect(Object.keys(python)).toHaveLength(BUT_MODE_COUNT - 1);
  });

  it('matches button_code and but_mod_code', () => {
    if (!hasPython) return;
    const python = pyJson<{ button: Record<string, number>; mod: Record<string, number> }>(
      'import json;from pymol import controlling as c;' +
        'print(json.dumps({"button":c.button_code,"mod":c.but_mod_code}))',
    );
    expect(BUTTON_CODE).toEqual(python.button);
    expect(BUT_MOD_CODE).toEqual(python.mod);
  });

  it('reproduces every 5-char label ButModeInit writes in packages/engine/layer1/ButMode.cpp', () => {
    const header = readFileSync(resolve(REPO, 'packages/engine/layer1/ButMode.h'), 'utf8');
    const source = readFileSync(resolve(REPO, 'packages/engine/layer1/ButMode.cpp'), 'utf8');

    const codeOf = new Map<string, number>();
    for (const match of header.matchAll(/^#define\s+(cButMode\w+)\s+(-?\d+)\s*$/gm)) {
      codeOf.set(match[1] as string, Number(match[2]));
    }
    expect(codeOf.get('cButModeCount')).toBe(BUT_MODE_COUNT);
    expect(codeOf.get('cButModeNothing')).toBe(BUT_MODE_NOTHING);

    const labels = new Map<number, string>();
    for (const match of source.matchAll(
      /strcpy\(I->Code\[(cButMode\w+)\],\s*"([^"]*)"\s*\)/g,
    )) {
      const code = codeOf.get(match[1] as string);
      expect(code, `unknown constant ${match[1]}`).toBeTypeOf('number');
      labels.set(code as number, match[2] as string);
    }

    // 56 of the 57 codes get a label; 48 (PotentialClick) never does.
    expect(labels.size).toBe(56);
    for (const [code, label] of labels) {
      expect(ACTION_LABEL[code], `label for code ${code}`).toBe(label);
    }
    expect(ACTION_LABEL[48]).toBe(BLANK_LABEL);
    expect(ACTION_LABEL).toHaveLength(BUT_MODE_COUNT);
  });
});

describe('buttonSlot — cmd.button bit packing (controlling.py:849-864)', () => {
  it('agrees with Python for all 80 button x modifier combinations', () => {
    if (!hasPython) return;
    const python = pyJson<Record<string, number>>(
      'import json;from pymol import controlling as c;out={};' +
        '\nfor b,bn in c.button_code.items():' +
        '\n for m,mn in c.but_mod_code.items():' +
        '\n  if bn<3: code = bn+3*mn if mn<4 else bn+68+3*(mn-4)' +
        '\n  elif bn<4: code = 12+mn if mn<4 else 64+mn-4' +
        '\n  else: code = (16+bn-4)+mn*6' +
        '\n  out[b+"/"+m]=code' +
        '\nprint(json.dumps(out))',
    );
    const mine: Record<string, number> = {};
    for (const button of Object.keys(BUTTON_CODE)) {
      for (const modifier of Object.keys(BUT_MOD_CODE)) {
        mine[`${button}/${modifier}`] = buttonSlot(button, modifier);
      }
    }
    expect(mine).toEqual(python);
  });

  it('places the documented slots where packages/engine/layer1/ButMode.h:118-214 says', () => {
    expect(buttonSlot('l', 'none')).toBe(0);
    expect(buttonSlot('r', 'none')).toBe(2);
    expect(buttonSlot('l', 'shft')).toBe(3);
    expect(buttonSlot('l', 'ctrl')).toBe(6);
    expect(buttonSlot('l', 'ctsh')).toBe(9);
    expect(buttonSlot('w', 'none')).toBe(12);
    expect(buttonSlot('w', 'ctsh')).toBe(15);
    expect(buttonSlot('double_left', 'none')).toBe(16);
    expect(buttonSlot('single_left', 'none')).toBe(19);
    expect(buttonSlot('single_right', 'none')).toBe(21);
    expect(buttonSlot('w', 'alt')).toBe(64);
    expect(buttonSlot('l', 'alt')).toBe(68);
    expect(buttonSlot('r', 'ctas')).toBe(79);
    // Nothing overflows the table.
    for (const button of Object.keys(BUTTON_CODE)) {
      for (const modifier of Object.keys(BUT_MOD_CODE)) {
        const slot = buttonSlot(button, modifier);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(BUT_MODE_INPUT_COUNT);
      }
    }
  });
});

describe('butModeTranslate (packages/engine/layer1/ButMode.cpp:603-757)', () => {
  const viewing = tableForMode('three_button_viewing');

  it('resolves L/M/R with every modifier offset', () => {
    expect(butModeTranslate(viewing, GlutButton.Left, 0)).toBe(BUT_ACT_CODE['rota']);
    expect(butModeTranslate(viewing, GlutButton.Left, 1)).toBe(BUT_ACT_CODE['+box']);
    expect(butModeTranslate(viewing, GlutButton.Left, 2)).toBe(BUT_ACT_CODE['move']);
    expect(butModeTranslate(viewing, GlutButton.Left, 3)).toBe(BUT_ACT_CODE['sele']);
    expect(butModeTranslate(viewing, GlutButton.Left, 4)).toBe(BUT_ACT_CODE['move']);
    expect(butModeTranslate(viewing, GlutButton.Middle, 0)).toBe(BUT_ACT_CODE['move']);
    expect(butModeTranslate(viewing, GlutButton.Right, 0)).toBe(BUT_ACT_CODE['movz']);
    expect(butModeTranslate(viewing, GlutButton.Right, 1)).toBe(BUT_ACT_CODE['clip']);
  });

  it('re-maps the wheel by scroll direction, not by slot', () => {
    // slab / movs / mvsz / movz on none / shft / ctrl / ctsh
    expect(butModeTranslate(viewing, GlutButton.ScrollForward, 0)).toBe(
      WheelAction.ScaleSlabExpand,
    );
    expect(butModeTranslate(viewing, GlutButton.ScrollBackward, 0)).toBe(
      WheelAction.ScaleSlabShrink,
    );
    expect(butModeTranslate(viewing, GlutButton.ScrollForward, 1)).toBe(
      WheelAction.MoveSlabForward,
    );
    expect(butModeTranslate(viewing, GlutButton.ScrollBackward, 1)).toBe(
      WheelAction.MoveSlabBackward,
    );
    expect(butModeTranslate(viewing, GlutButton.ScrollForward, 2)).toBe(
      WheelAction.MoveSlabAndZoomForward,
    );
    expect(butModeTranslate(viewing, GlutButton.ScrollForward, 3)).toBe(
      WheelAction.ZoomForward,
    );
    expect(butModeTranslate(viewing, GlutButton.ScrollBackward, 3)).toBe(
      WheelAction.ZoomBackward,
    );
  });

  it('inverts imsz and imvz', () => {
    const maestro = tableForMode('three_button_maestro');
    // maestro binds w/none = imvz -> forward scrolls BACKWARD
    expect(butModeTranslate(maestro, GlutButton.ScrollForward, 0)).toBe(
      WheelAction.ZoomBackward,
    );
    expect(butModeTranslate(maestro, GlutButton.ScrollBackward, 0)).toBe(
      WheelAction.ZoomForward,
    );
    // maestro deliberately leaves w/ctrl unbound ("disable since ctrl-middle is irtz")
    expect(butModeTranslate(maestro, GlutButton.ScrollForward, 2)).toBe(BUT_MODE_NOTHING);
  });

  it('returns -1 for a wheel slot bound to a non-wheel action', () => {
    const table = emptyButModeTable();
    table[12] = BUT_ACT_CODE['rota'] as number;
    expect(butModeTranslate(table, GlutButton.ScrollForward, 0)).toBe(BUT_MODE_NOTHING);
  });

  it('resolves single and double clicks with the +6/+12/+18/+24 ladder', () => {
    expect(butModeTranslate(viewing, GlutButton.SingleLeft, 0)).toBe(BUT_ACT_CODE['+/-']);
    expect(butModeTranslate(viewing, GlutButton.SingleMiddle, 0)).toBe(BUT_ACT_CODE['cent']);
    expect(butModeTranslate(viewing, GlutButton.SingleRight, 0)).toBe(BUT_ACT_CODE['menu']);
    expect(butModeTranslate(viewing, GlutButton.SingleLeft, 2)).toBe(BUT_ACT_CODE['cent']);
    expect(butModeTranslate(viewing, GlutButton.SingleLeft, 4)).toBe(BUT_ACT_CODE['cent']);
    expect(butModeTranslate(viewing, GlutButton.DoubleLeft, 0)).toBe(BUT_ACT_CODE['menu']);
    expect(butModeTranslate(viewing, GlutButton.DoubleRight, 0)).toBe(BUT_ACT_CODE['pkat']);
  });

  it('preserves the upstream duplicate-row precedence in three_button_motions', () => {
    // controlling.py:398-399 binds double_left twice: `menu` then `torf`.
    const motions = tableForMode('three_button_motions');
    expect(butModeTranslate(motions, GlutButton.DoubleLeft, 0)).toBe(BUT_ACT_CODE['torf']);
  });

  it('checkPossibleSingleClick follows the single slot', () => {
    expect(checkPossibleSingleClick(viewing, GlutButton.Left, 0)).toBe(true);
    // three_button_lights binds single_left to `none` (code 22), which is >= 0,
    // so upstream still calls it "possible" — reproduce that, do not "fix" it.
    const lights = tableForMode('three_button_lights');
    expect(checkPossibleSingleClick(lights, GlutButton.Left, 0)).toBe(true);
    // an unbound slot is -1
    expect(checkPossibleSingleClick(emptyButModeTable(), GlutButton.Left, 0)).toBe(false);
    expect(checkPossibleSingleClick(viewing, GlutButton.ScrollForward, 0)).toBe(false);
  });
});

describe('the on-screen grid', () => {
  it('labels three_button_viewing exactly as the block would draw it', () => {
    const table = tableForMode('three_button_viewing');
    expect([0, 1, 2, 12].map((slot) => slotLabel(table, slot))).toEqual([
      'Rota ',
      'Move ',
      'MovZ ',
      'Slab ',
    ]);
    expect([3, 4, 5, 13].map((slot) => slotLabel(table, slot))).toEqual([
      '+Box ',
      '-Box ',
      'Clip ',
      'MovS ',
    ]);
    expect([6, 7, 8, 14].map((slot) => slotLabel(table, slot))).toEqual([
      'Move ',
      'PkAt ',
      'Pk1  ',
      'MvSZ ',
    ]);
    expect([9, 10, 11, 15].map((slot) => slotLabel(table, slot))).toEqual([
      'Sele ',
      'Orig ',
      'Clip ',
      'MovZ ',
    ]);
    expect([19, 20, 21].map((slot) => slotLabel(table, slot))).toEqual([
      '+/-  ',
      'Cent ',
      'Menu ',
    ]);
    expect([16, 17, 18].map((slot) => slotLabel(table, slot))).toEqual([
      'Menu ',
      '  -  ',
      'PkAt ',
    ]);
  });

  it('blanks an unbound slot, as ButMode::draw does for Mode[a] < 0', () => {
    expect(slotLabel(emptyButModeTable(), 0)).toBe(BLANK_LABEL);
    // A slot nobody mentions is blank; a slot bound to the `none` ACTION is not
    // the same thing — two_button_viewing explicitly binds w/none to `none`, so
    // the block prints the "  -  " glyph there, not whitespace.
    expect(slotLabel(tableForMode('two_button_viewing'), 12)).toBe('  -  ');
    // slot 71 = left+Alt+Shift, which only one_button_viewing ever binds.
    expect(slotLabel(tableForMode('two_button_viewing'), 71)).toBe(BLANK_LABEL);
  });
});

describe('selection level line (packages/engine/layer1/ButMode.cpp:363-393)', () => {
  it('shows the level and cycles when single-left is not pkat', () => {
    const viewing = tableForMode('three_button_viewing');
    expect(selectionLine(viewing, 1)).toEqual({
      prefix: 'Selecting ',
      value: 'Residues',
      cycles: true,
    });
    expect(selectionLine(viewing, 6).value).toBe('C-alphas');
    expect(selectionLine(viewing, 0).value).toBe('Atoms');
  });

  it('shows "Picking Atoms (and Joints)" and refuses to cycle when it is', () => {
    const editing = tableForMode('three_button_editing');
    expect(selectionLine(editing, 1)).toEqual({
      prefix: 'Picking ',
      value: 'Atoms (and Joints)',
      cycles: false,
    });
  });
});
