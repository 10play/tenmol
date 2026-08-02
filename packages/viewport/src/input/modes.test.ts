/**
 * Diff the mirrored mouse-mode tables against the real
 * `packages/engine/modules/pymol/controlling.py` (imported in the bridge venv). Plan §A9 makes
 * the Python table authoritative; this is the test that keeps the mirror
 * honest.
 */

import { describe, expect, it } from 'vitest';

import {
  MODE_DICT,
  MODE_NAME_DICT,
  MODE_NAME_LIST,
  RING_DICT,
  type ModeName,
} from './modes';
import {
  MOUSE_CONFIG_MENU,
  displayName,
  modeForButtonMode,
  stepButtonMode,
  stepSelectionMode,
  tableForMode,
} from './mouseConfig';
import { hasPython, pyJson } from './butmode.test';

interface PythonTables {
  mode_dict: Record<string, [string, string, string][]>;
  ring_dict: Record<string, string[]>;
  mode_name_dict: Record<string, string>;
  mode_name_list: string[];
}

function tables(): PythonTables {
  return pyJson<PythonTables>(
    'import json;from pymol import controlling as c;' +
      'print(json.dumps({"mode_dict":c.mode_dict,"ring_dict":c.ring_dict,' +
      '"mode_name_dict":c.mode_name_dict,"mode_name_list":c.mode_name_list}))',
  );
}

describe('mirror of packages/engine/modules/pymol/controlling.py', () => {
  it('has all eleven mode matrices, row for row and in order', () => {
    if (!hasPython) return;
    const python = tables();
    expect(Object.keys(python.mode_dict).sort()).toEqual(Object.keys(MODE_DICT).sort());
    for (const [mode, rows] of Object.entries(python.mode_dict)) {
      expect(MODE_DICT[mode as ModeName], `mode ${mode}`).toEqual(rows);
    }
    // one_button_viewing is the only mode using alsh/ctal/ctas.
    const exotic = new Set<string>();
    for (const [mode, rows] of Object.entries(MODE_DICT)) {
      for (const [, modifier] of rows) {
        if (['alsh', 'ctal', 'ctas'].includes(modifier)) exotic.add(mode);
      }
    }
    expect([...exotic]).toEqual(['one_button_viewing']);
  });

  it('has the same rings, display names and mode_name_list order', () => {
    if (!hasPython) return;
    const python = tables();
    expect(RING_DICT).toEqual(python.ring_dict);
    expect(MODE_NAME_DICT).toEqual(python.mode_name_dict);
    expect(MODE_NAME_LIST).toEqual(python.mode_name_list);
  });

  it('renders the ten display names the ButMode block prints', () => {
    expect(Object.values(MODE_NAME_DICT)).toEqual([
      '3-Button Lights',
      '3-Button Maestro',
      '3-Button Viewing',
      '3-Button Editing',
      '3-Button Motions',
      '2-Button Viewing',
      '2-Btn. Selecting',
      '2-Button Editing',
      '2-Button Lights',
      '1-Button Viewing',
    ]);
    // `default` has no display name; cmd.mouse falls back to the raw key.
    expect(displayName('default')).toBe('default');
  });
});

describe('ring cycling (controlling.py:609-686)', () => {
  it('steps forward and backward modulo the ring length', () => {
    expect(stepButtonMode(0, 'three_button', true)).toBe(1);
    expect(stepButtonMode(1, 'three_button', true)).toBe(0);
    expect(stepButtonMode(0, 'three_button', false)).toBe(1);
    expect(stepButtonMode(0, 'three_button_all_modes', false)).toBe(3);
    expect(stepButtonMode(3, 'three_button_all_modes', true)).toBe(0);
  });

  it('resolves button_mode against the ring, and negatives against mode_name_list', () => {
    expect(modeForButtonMode(0, 'three_button')).toBe('three_button_viewing');
    expect(modeForButtonMode(1, 'three_button')).toBe('three_button_editing');
    // -1 - index(mode_name_list) is how cmd.mouse(name) stores an off-ring mode
    for (let index = 0; index < MODE_NAME_LIST.length; index++) {
      expect(modeForButtonMode(-1 - index, 'three_button')).toBe(MODE_NAME_LIST[index]);
    }
    expect(modeForButtonMode(-1 - MODE_NAME_LIST.indexOf('two_button_lights'), 'one_button')).toBe(
      'two_button_lights',
    );
  });

  it('wraps the selection level 0..6 in both directions', () => {
    expect(stepSelectionMode(6, true)).toBe(0);
    expect(stepSelectionMode(0, false)).toBe(6);
    expect(stepSelectionMode(1, true)).toBe(2);
    expect(stepSelectionMode(1, false)).toBe(0);
  });
});

describe('mouse_config context menu (packages/engine/modules/pymol/menu.py:82-101)', () => {
  it('is nine entries in upstream order, with the separator in the middle', () => {
    expect(MOUSE_CONFIG_MENU.map((item) => item.label)).toEqual([
      '3-Button Motions',
      '3-Button Editing',
      '3-Button Viewing',
      '3-Button Lights',
      '3-Button All Modes',
      '',
      '2-Button Editing',
      '2-Button Viewing',
      '2-Button Lights',
    ]);
    expect(MOUSE_CONFIG_MENU[5]?.kind).toBe(0);
  });

  it('matches menu.mouse_config() byte for byte', () => {
    if (!hasPython) return;
    const python = pyJson<[number, string, string][]>(
      'import json;from pymol import menu;print(json.dumps(menu.mouse_config(None)))',
    );
    expect(MOUSE_CONFIG_MENU.map((item) => [item.kind, item.label, item.command])).toEqual(
      python,
    );
  });
});

describe('tableForMode', () => {
  it('produces an 80-slot table for every mode', () => {
    for (const mode of Object.keys(MODE_DICT) as ModeName[]) {
      expect(tableForMode(mode)).toHaveLength(80);
    }
  });

  it('leaves the alt-modified L/M/R slots of one_button_viewing bound', () => {
    const table = tableForMode('one_button_viewing');
    // l/alsh -> slot 71, l/ctal -> 74, l/ctas -> 77
    expect(table[71]).toBeGreaterThanOrEqual(0);
    expect(table[74]).toBeGreaterThanOrEqual(0);
    expect(table[77]).toBeGreaterThanOrEqual(0);
  });
});
