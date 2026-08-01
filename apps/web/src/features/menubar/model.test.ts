/**
 * Model tests, run against the REAL generated tree — not a fixture. If the
 * harvest changes, these move with it, and the bridge suite
 * (`bridge/tests/test_menus.py`) already guarantees the tree matches upstream.
 */

import { describe as suite, expect, it } from 'vitest';
import { truncateRecentLabel, walkMenu, type MenuNode } from '@tenmol/protocol/topics/menus';
import { MENU_DATA } from './generated/menudata';
import {
  HOOK_OWNERS,
  UNAVAILABLE_HOOKS,
  baseLabel,
  describe,
  isCheckable,
  isChecked,
  isRadioActive,
  settingsIn,
  valueEquals,
} from './model';

const all = [...walkMenu(MENU_DATA.menus)];

suite('the generated tree', () => {
  it('carries the eleven PyMOL menus in order', () => {
    expect(MENU_DATA.menus.map((m) => (m.kind === 'submenu' ? m.label : m.kind))).toEqual([
      'File',
      'Edit',
      'Build',
      'Movie',
      'Display',
      'Setting',
      'Scene',
      'Mouse',
      'Wizard',
      'Plugin',
      'Help',
    ]);
    expect(MENU_DATA.schema).toBe(1);
  });

  it('has no unresolved leaf', () => {
    const dropped = all.filter((n) => n.kind === 'command' && n.action.type === 'dropped');
    const errors = all.filter((n) => n.kind === 'error');
    expect(dropped).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('is big enough that nobody could have typed it', () => {
    expect(all.length).toBe(854);
    expect(all.filter((n) => n.kind === 'command').length).toBe(388);
    expect(all.filter((n) => n.kind === 'radio').length).toBe(205);
    expect(all.filter((n) => n.kind === 'check').length).toBe(68);
  });

  it('names every hook it emits, so no item is silently dead', () => {
    const local = new Set(['show_about', 'confirm_quit', 'mvprg', 'mvprg_remove_last']);
    const unknown = new Set<string>();
    for (const node of all) {
      if (node.kind !== 'command' || node.action.type !== 'hook') continue;
      const hook = node.action.hook;
      if (local.has(hook) || HOOK_OWNERS[hook] || UNAVAILABLE_HOOKS[hook]) continue;
      unknown.add(hook);
    }
    expect([...unknown]).toEqual([]);
  });
});

suite('settingsIn', () => {
  it('collects every distinct check/radio setting of a subtree', () => {
    const names = settingsIn(MENU_DATA.menus);
    expect(names).toEqual(MENU_DATA.settings);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('bg_rgb');
    expect(names).toContain('assembly');
  });

  it('scopes to one menu', () => {
    const mouse = MENU_DATA.menus.find((m) => m.kind === 'submenu' && m.label === 'Mouse')!;
    expect(settingsIn([mouse])).toEqual([
      'mouse_selection_mode',
      'virtual_trackball',
      'mouse_grid',
      'roving_origin',
    ]);
  });
});

suite('check state', () => {
  const node = (over: Partial<Extract<MenuNode, { kind: 'check' }>> = {}) =>
    ({
      kind: 'check' as const,
      label: 'x',
      setting: 's',
      trueValue: 1,
      falseValue: 0,
      ...over,
    }) as Extract<MenuNode, { kind: 'check' }>;

  it('is "not the off value", as SettingAction registers it', () => {
    expect(isChecked(node(), { type: 1, value: 1 })).toBe(true);
    expect(isChecked(node(), { type: 1, value: 0 })).toBe(false);
    // specular is a float whose on value is 1.0
    expect(isChecked(node(), { type: 3, value: 0.5 })).toBe(true);
  });

  it('handles the non-boolean pairs', () => {
    const highlight = node({ trueValue: 104, falseValue: -1 });
    expect(isChecked(highlight, { type: 5, value: 104 })).toBe(true);
    expect(isChecked(highlight, { type: 5, value: -1 })).toBe(false);
    // assembly is a STRING setting: '1' on, '' off
    const assembly = node({ trueValue: '1', falseValue: '' });
    expect(isChecked(assembly, { type: 6, value: '1' })).toBe(true);
    expect(isChecked(assembly, { type: 6, value: '' })).toBe(false);
    // auto_show_classified inverts: -1 on, 0 off
    const classified = node({ trueValue: -1, falseValue: 0 });
    expect(isChecked(classified, { type: 2, value: -1 })).toBe(true);
    expect(isChecked(classified, { type: 2, value: 0 })).toBe(false);
  });

  it('is false while the value is unknown', () => {
    expect(isChecked(node(), undefined)).toBe(false);
  });

  it('only ticks the setting types SettingAction makes checkable', () => {
    for (const type of [1, 2, 3, 5, 6]) expect(isCheckable({ type, value: 1 })).toBe(true);
    expect(isCheckable({ type: 4, value: 1 })).toBe(false); // float3
    expect(isCheckable(undefined)).toBe(false);
  });
});

suite('radio state', () => {
  const radio = (value: number | string) =>
    ({ kind: 'radio' as const, label: 'x', setting: 's', value }) as Extract<
      MenuNode,
      { kind: 'radio' }
    >;

  it('ticks on values[0] == value', () => {
    expect(isRadioActive(radio(2), { type: 2, value: 2 })).toBe(true);
    expect(isRadioActive(radio(2), { type: 2, value: 3 })).toBe(false);
  });

  it('tolerates float32 round-trip, which Qt does not', () => {
    // `stick_radius` 0.1 comes back from C float as 0.10000000149011612;
    // Qt's `values[0] == value` fails and its own radio never ticks.
    expect(isRadioActive(radio(0.1), { type: 3, value: 0.10000000149011612 })).toBe(true);
    expect(isRadioActive(radio(0.1), { type: 3, value: 0.2 })).toBe(false);
    expect(isRadioActive(radio(1.49), { type: 3, value: 1.4900000095367432 })).toBe(true);
  });

  it('compares large sculpt masks exactly', () => {
    expect(valueEquals(-97, -97)).toBe(true);
    expect(valueEquals(-97, -193)).toBe(false);
    expect(valueEquals(255, 255)).toBe(true);
  });
});

suite('labels', () => {
  it('strips the bracketed accelerator PyMOL writes into the text', () => {
    expect(baseLabel('Acetylene [Alt-J]', 'Alt-J')).toBe('Acetylene');
    expect(baseLabel('Undo [Ctrl-Z]', 'Ctrl-Z')).toBe('Undo');
    expect(baseLabel('Show Text (Esc)')).toBe('Show Text (Esc)');
  });

  it('parses an accel for every bracketed label in the tree', () => {
    const bracketed = all.filter(
      (n) => 'label' in n && /\[[^[\]]+\]$/.test((n as { label: string }).label),
    );
    expect(bracketed.length).toBeGreaterThan(40);
    for (const node of bracketed) expect((node as { accel?: string }).accel).toBeTruthy();
  });
});

suite('describe', () => {
  it('shows the command line for a do-leaf', () => {
    const frag = all.find(
      (n) => n.kind === 'command' && n.label.startsWith('Acetylene'),
    ) as Extract<MenuNode, { kind: 'command' }>;
    expect(describe(frag)).toBe("PyMOL> editor.attach_fragment('pk1','acetylene',2,0)");
  });

  it('shows the call signature for a call-leaf', () => {
    const zoom = all.find(
      (n) => n.kind === 'command' && n.label === '4 Angstrom Sphere',
    ) as Extract<MenuNode, { kind: 'command' }>;
    expect(describe(zoom)).toBe('cmd.zoom("center", 4, animate=-1)');
  });
});

suite('truncateRecentLabel', () => {
  it('matches the Qt rule exactly', () => {
    expect(truncateRecentLabel('/tmp/x.pdb')).toBe('/tmp/x.pdb');
    const at127 = '/' + 'a'.repeat(126);
    expect(truncateRecentLabel(at127)).toBe(at127);
    const at128 = '/' + 'a'.repeat(127);
    expect(truncateRecentLabel(at128)).toBe('...' + at128.slice(-120));
    expect(truncateRecentLabel(at128).length).toBe(123);
  });
});
