/**
 * Row 213 — the declarative menu-data renderer is now fed by DATA, and the data
 * is `get_menudata` itself.
 *
 * Two independent descriptions of the same Python literal exist in this tree:
 *
 *  * `features/menubar/generated/menudata.ts` — HARVESTED. `panels/menus.py`
 *    walks the real `PyMOLDesktopGUI.get_menudata` against a recording `cmd`
 *    proxy; `bridge/tests/test_menus.py` fails if the file drifts.
 *  * `features/settings/menuData.ts` — TRANSCRIBED by hand from
 *    `modules/pymol/_gui.py:491-773` in wave 4, and until this wave the thing
 *    the panel actually rendered.
 *
 * The panel renders the harvest now. The transcription survives here as an
 * ORACLE, because a harvester that is merely stale is caught by
 * `test_menus.py`, and a harvester that is WRONG is caught by nothing else.
 * 202 nodes are compared node-for-node; the four that differ are a defect in
 * the TRANSCRIPTION and are pinned as such below.
 */

import { describe, expect, it } from 'vitest';
import type { MenuNode } from '@tenmol/protocol/topics/menus';
import { SETTING_MENU, type MenuItem } from './menuData';
import { groupRadios, menuSubtree, menuValue, PANEL_MENUS, settingsUnder } from './menuTree';
import catalogueFixture from './__fixtures__/catalogue.json';

/** The live 779-name table, dumped from this build (see `settings.test.ts`). */
const NAMES: string[] = catalogueFixture.names;

/** `label>path|kind|setting|values` for one leaf of the harvested tree. */
function harvestLeaves(nodes: readonly MenuNode[], path: string[] = []): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'separator') continue;
    const here = [...path, 'label' in node ? node.label : node.kind];
    if (node.kind === 'submenu') out.push(...harvestLeaves(node.items, here));
    else if (node.kind === 'check')
      out.push(`${here.join('>')}|check|${node.setting}|${node.trueValue}|${node.falseValue}`);
    else if (node.kind === 'radio')
      out.push(`${here.join('>')}|radio|${node.setting}|${node.value}`);
    else if (node.kind === 'command') out.push(`${here.join('>')}|command:${node.action.type}`);
    else out.push(`${here.join('>')}|${node.kind}`);
  }
  return out;
}

/** The same shape, from the hand transcription. */
function transcribedLeaves(items: readonly MenuItem[], path: string[] = []): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.kind === 'separator') continue;
    const here = [...path, item.label];
    if (item.kind === 'menu') out.push(...transcribedLeaves(item.items, here));
    else if (item.kind === 'check')
      out.push(`${here.join('>')}|check|${item.setting}|${item.on}|${item.off}`);
    else if (item.kind === 'radio')
      out.push(`${here.join('>')}|radio|${item.setting}|${item.value}`);
    else out.push(`${here.join('>')}|command:call`);
  }
  return out;
}

/**
 * `('radio', str(val), 'line_width', val) for val in [1.0, 1.49, 3.0]`
 * (`_gui.py:576-579`, and the same idiom at `:562` and `:571`).
 *
 * Python's `str(1.0)` is `'1.0'`; the transcription used JavaScript's
 * `String(1.0)`, which is `'1'`. Four labels in PyMOL's own menu therefore read
 * one character short in the hand-written copy — a real, if small, defect, and
 * exactly the class of thing rendering the harvest removes. Kept as an explicit
 * expectation rather than filtered away, so that the day the harvester starts
 * producing '1' the diff is loud.
 */
const STR_FLOAT_LABELS: readonly [string, string][] = [
  ['Lines & Sticks>Zero Order Stick Scale>1.0|radio|valence_zero_scale|1', 'Lines & Sticks>Zero Order Stick Scale>1|radio|valence_zero_scale|1'],
  ['Lines & Sticks>Stick Hydrogen Scale>1.0|radio|stick_h_scale|1', 'Lines & Sticks>Stick Hydrogen Scale>1|radio|stick_h_scale|1'],
  ['Lines & Sticks>Line Width>1.0|radio|line_width|1', 'Lines & Sticks>Line Width>1|radio|line_width|1'],
  ['Lines & Sticks>Line Width>3.0|radio|line_width|3', 'Lines & Sticks>Line Width>3|radio|line_width|3'],
];

/** The three windows `_gui.py:493-497` puts at the top of the Setting menu. */
const DIALOG_LEAVES = [
  'Edit All...|command:hook',
  'Keyboard Shortcuts...|command:hook',
  'Colors...|command:hook',
];

describe('the Setting menu is harvested, not transcribed', () => {
  it('agrees with the wave-4 transcription on every node but the four str(float) labels', () => {
    const harvested = harvestLeaves(menuSubtree('Setting'));
    const transcribed = transcribedLeaves(SETTING_MENU);

    // The transcription deliberately dropped the three dialog entries; the
    // harvest carries them as `hook` commands, which is how they become live.
    expect(harvested.filter((leaf) => DIALOG_LEAVES.includes(leaf))).toEqual(DIALOG_LEAVES);

    const onlyHarvested = harvested.filter(
      (leaf) => !transcribed.includes(leaf) && !DIALOG_LEAVES.includes(leaf),
    );
    const onlyTranscribed = transcribed.filter((leaf) => !harvested.includes(leaf));

    expect(onlyHarvested.sort()).toEqual(STR_FLOAT_LABELS.map(([h]) => h).sort());
    expect(onlyTranscribed.sort()).toEqual(STR_FLOAT_LABELS.map(([, t]) => t).sort());

    // …and everything else is identical, in the same order.
    const strip = (leaves: string[], drop: string[]) => leaves.filter((l) => !drop.includes(l));
    expect(
      strip(harvested, [...DIALOG_LEAVES, ...STR_FLOAT_LABELS.map(([h]) => h)]),
    ).toEqual(strip(transcribed, STR_FLOAT_LABELS.map(([, t]) => t)));
  });

  it('is 202 shared nodes, so the comparison above is not vacuous', () => {
    const harvested = harvestLeaves(menuSubtree('Setting'));
    expect(harvested).toHaveLength(205);
    expect(transcribedLeaves(SETTING_MENU)).toHaveLength(202);
  });
});

describe('one renderer, four menus', () => {
  it('resolves all four subtrees out of the one harvested document', () => {
    for (const name of PANEL_MENUS) {
      expect(menuSubtree(name).length).toBeGreaterThan(0);
    }
    // Labels come from the DATA, so this is the harvest's own list.
    expect(PANEL_MENUS.map((name) => menuSubtree(name).length)).toEqual([23, 27, 15, 19]);
  });

  it('returns nothing for a menu that is not in the tree', () => {
    expect(menuSubtree('Nonexistent')).toEqual([]);
  });

  it('binds only settings this build has, in all four menus', () => {
    const bound = new Set(PANEL_MENUS.flatMap((name) => settingsUnder(name)));
    expect(bound.size).toBeGreaterThan(0);
    expect([...bound].filter((name) => !NAMES.includes(name))).toEqual([]);
  });

  it('reaches settings the Setting menu alone never binds', () => {
    const setting = new Set(settingsUnder('Setting'));
    const others = PANEL_MENUS.filter((name) => name !== 'Setting').flatMap((name) =>
      settingsUnder(name),
    );
    const extra = [...new Set(others)].filter((name) => !setting.has(name));
    // Display's `bg_rgb`/`grid_mode`/`seq_view`, Mouse's
    // `mouse_selection_mode`, Scene's `scene_buttons` … — the reuse is over
    // MORE data, not the same data rendered twice.
    expect(extra.length).toBeGreaterThan(20);
    expect(extra).toContain('seq_view');
    expect(extra).toContain('bg_rgb');
    expect(extra).toContain('grid_mode');
    expect(extra).toContain('mouse_selection_mode');
    expect(extra).toContain('scene_buttons');
  });
});

describe('radio groups are keyed by setting name', () => {
  it('joins non-adjacent siblings, as QActionGroup does', () => {
    // `Surface` has `surface_cavity_mode` radios at positions 5, 6 and 9 with
    // two submenus and a separator in between (`_gui.py:625-651`). Adjacency
    // grouping would make three groups of one.
    const surface = menuSubtree('Setting').find(
      (node) => node.kind === 'submenu' && node.label === 'Surface',
    );
    expect(surface?.kind).toBe('submenu');
    const groups = groupRadios(surface?.kind === 'submenu' ? surface.items : []);
    const cavity = groups.find((g) => g.kind === 'radios' && g.setting === 'surface_cavity_mode');
    expect(cavity?.kind).toBe('radios');
    expect(cavity?.kind === 'radios' ? cavity.nodes.length : 0).toBe(3);
    expect(
      cavity?.kind === 'radios' ? cavity.nodes.map((n) => ('value' in n ? n.value : null)) : [],
    ).toEqual([1, 2, 0]);
  });

  it('makes one group per setting and keeps everything else in place', () => {
    const groups = groupRadios([
      { kind: 'radio', label: 'a', setting: 's1', value: 0 },
      { kind: 'separator' },
      { kind: 'radio', label: 'b', setting: 's2', value: 1 },
      { kind: 'radio', label: 'c', setting: 's1', value: 2 },
      { kind: 'check', label: 'd', setting: 's3', trueValue: 1, falseValue: 0 },
    ]);
    expect(groups.map((g) => (g.kind === 'radios' ? `radios:${g.setting}` : g.node.kind))).toEqual([
      'radios:s1',
      'separator',
      'radios:s2',
      'check',
    ]);
    const first = groups[0];
    expect(first?.kind === 'radios' ? first.nodes.length : 0).toBe(2);
  });
});

describe('menuValue adapts WP-15 catalogue values to the menu model', () => {
  const meta = (kind: string) => ({ name: 'x', index: 1, kind, level: 'global' }) as never;

  it('maps the kind to the numeric type SettingAction switches on', () => {
    expect(menuValue(meta('boolean'), true)).toEqual({ type: 1, value: 1 });
    expect(menuValue(meta('int'), 3)).toEqual({ type: 2, value: 3 });
    expect(menuValue(meta('float'), 0.5)).toEqual({ type: 3, value: 0.5 });
    expect(menuValue(meta('color'), 104)).toEqual({ type: 5, value: 104 });
    expect(menuValue(meta('string'), '1')).toEqual({ type: 6, value: '1' });
  });

  it('reports a float3 as type 4 with no scalar — it is not comparable', () => {
    expect(menuValue(meta('float3'), [0, 0, 0])).toEqual({ type: 4, value: null });
  });

  it('is undefined while the value has not loaded', () => {
    expect(menuValue(meta('int'), undefined)).toBeUndefined();
    expect(menuValue(undefined, 1)).toBeUndefined();
  });
});
