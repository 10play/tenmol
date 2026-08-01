/**
 * WP-15 client tests.
 *
 * `__fixtures__/catalogue.json` is not invented: it is the output of
 * `setting.tenmol_settings_catalogue()` on this build, captured through the
 * bridge. It is what lets the Setting-menu transcription be checked name by
 * name against the real setting table — a typo in one of the 71 setting names
 * copied out of `modules/pymol/_gui.py` would otherwise show up as a menu entry
 * that silently does nothing.
 */

import { describe, expect, it, vi } from 'vitest';
import { BOND_LEVEL_SETTINGS, type SettingCatalogue, type SettingMeta } from '@tenmol/protocol';
import {
  SETTINGS_BOOTSTRAP,
  canWriteAt,
  coerceSettingValue,
  createSettingsSource,
  createSettingsStore,
  filterSettings,
  formatSettingValue,
  isDefaultValue,
  rangeHint,
  resolveSettingName,
  scopesForLevel,
  valueKey,
} from '@tenmol/stores/settings';

import fixture from './__fixtures__/catalogue.json';
import { SETTING_MENU, menuSettingNames, type MenuItem } from './menuData';
import { valuesEqual } from './SettingMenu';
import { LIGHTING_PRESETS, LIGHTING_SECTIONS } from './LightingPanel';

const GUI_MENU_SETTINGS: readonly string[] = [
  'antialias',
  'antialias_shader',
  'assembly',
  'auto_hide_selections',
  'auto_remove_hydrogens',
  'auto_show_classified',
  'auto_show_lines',
  'auto_show_nonbonded',
  'auto_show_selections',
  'auto_show_spheres',
  'auto_zoom',
  'backface_cull',
  'cartoon_cylindrical_helices',
  'cartoon_discrete_colors',
  'cartoon_fancy_helices',
  'cartoon_fancy_sheets',
  'cartoon_flat_sheets',
  'cartoon_gap_cutoff',
  'cartoon_highlight_color',
  'cartoon_ring_finder',
  'cartoon_ring_mode',
  'cartoon_ring_transparency',
  'cartoon_round_helices',
  'cartoon_sampling',
  'cartoon_side_chain_helper',
  'cartoon_smooth_loops',
  'cartoon_transparency',
  'cif_use_auth',
  'connect_mode',
  'hash_max',
  'ignore_pdb_segi',
  'label_bg_color',
  'label_color',
  'label_connector',
  'label_font_id',
  'label_size',
  'line_as_cylinders',
  'line_width',
  'normalize_ccp4_maps',
  'normalize_o_maps',
  'overlay',
  'ray_interior_color',
  'ray_interior_texture',
  'ray_texture',
  'ray_transparency_oblique',
  'ribbon_as_cylinders',
  'ribbon_radius',
  'ribbon_side_chain_helper',
  'ribbon_trace_atoms',
  'sphere_transparency',
  'stick_ball',
  'stick_ball_ratio',
  'stick_h_scale',
  'stick_radius',
  'stick_transparency',
  'surface_cavity_cutoff',
  'surface_cavity_mode',
  'surface_cavity_radius',
  'surface_color',
  'surface_mode',
  'surface_proximity',
  'surface_smooth_edges',
  'surface_solvent',
  'surface_type',
  'text',
  'transparency',
  'use_shaders',
  'valence_zero_mode',
  'valence_zero_scale',
  'volume_layers',
  'volume_mode',
];

const NAMES: string[] = fixture.names;
const LEVELS: Record<string, string> = fixture.levels;
const KINDS: Record<string, string> = fixture.kinds;

function meta(partial: Partial<SettingMeta> & { name: string }): SettingMeta {
  return {
    index: 1,
    kind: 'float',
    level: 'global',
    scopes: ['global'],
    ...partial,
  } as SettingMeta;
}

function catalogueOf(settings: SettingMeta[]): SettingCatalogue {
  return {
    version: 1,
    count: settings.length,
    settings,
    aliases: { ray_shadows: 195 },
    counts: {},
    levelCounts: {},
    meta: {
      cSettingInit: 798,
      indexDictSize: settings.length + 1,
      nameListSize: settings.length,
      defaultsSource: 'layer1/SettingInfo.h',
      defaultsNote: '',
      minMaxEnforced: false,
      minMaxNote: '',
      helpSource: null,
      helpRows: 0,
    },
  };
}

/* ------------------------------------------------------------------ */

describe('the fixture is the real setting table', () => {
  it('has the 779 settings Python can see', () => {
    expect(fixture.count).toBe(779);
    expect(NAMES).toHaveLength(779);
    expect(new Set(NAMES).size).toBe(779);
  });
});

describe('Setting menu transcription', () => {
  it('binds only settings that exist in this build', () => {
    const unknown = menuSettingNames().filter((name) => !NAMES.includes(name));
    expect(unknown).toEqual([]);
  });

  it('binds EXACTLY the settings `_gui.py`\'s Setting menu binds', () => {
    // Extracted from `modules/pymol/_gui.py:491-773` by matching every
    // ('check'|'radio', label, setting, ...) node and every
    // transparency_menu(setting) call, minus `transparency_mode` and
    // `two_sided_lighting`, which appear only inside the composite preset
    // COMMANDS and so are not menu-bound settings.
    expect(menuSettingNames().sort()).toEqual([...GUI_MENU_SETTINGS].sort());
  });

  it('keeps the non-1/0 check values `_gui.py` uses', () => {
    const checks = new Map<string, MenuItem & { kind: 'check' }>();
    const walk = (items: readonly MenuItem[]): void => {
      for (const item of items) {
        if (item.kind === 'menu') walk(item.items);
        else if (item.kind === 'check') checks.set(item.setting, item);
      }
    };
    walk(SETTING_MENU);

    // `assembly` is a STRING setting driven as a toggle.
    expect(KINDS['assembly']).toBe('string');
    expect(checks.get('assembly')?.on).toBe('1');
    expect(checks.get('assembly')?.off).toBe('');
    // check-with-a-colour-index
    expect(checks.get('cartoon_highlight_color')?.on).toBe(104);
    expect(checks.get('cartoon_highlight_color')?.off).toBe(-1);
    expect(checks.get('ray_interior_color')?.on).toBe(74);
    // -1/0, not 1/0
    expect(checks.get('auto_show_classified')?.on).toBe(-1);
    expect(checks.get('connect_mode')?.on).toBe(4);
  });

  it('carries the four transparency presets as three cmd.set calls each', () => {
    const transparency = SETTING_MENU.find(
      (item): item is MenuItem & { kind: 'menu' } =>
        item.kind === 'menu' && item.label === 'Transparency',
    );
    const commands = (transparency?.items ?? []).filter((i) => i.kind === 'command');
    expect(commands.map((c) => (c.kind === 'command' ? c.label : ''))).toEqual([
      'Uni-Layer',
      'Multi-Layer',
      'Multi-Layer (Real-time OIT)',
      'Fast and Ugly',
    ]);
    for (const command of commands) {
      if (command.kind !== 'command') continue;
      expect(command.calls).toHaveLength(3);
      expect(command.calls.map((c) => c.args[0])).toEqual([
        'transparency_mode',
        'backface_cull',
        'two_sided_lighting',
      ]);
    }
  });

  it('marks radio items on with a tolerant numeric comparison', () => {
    expect(valuesEqual(0.5, 0.5)).toBe(true);
    expect(valuesEqual(0.5000001, 0.5)).toBe(true);
    expect(valuesEqual(0.6, 0.5)).toBe(false);
    expect(valuesEqual(undefined, 0)).toBe(false);
    expect(valuesEqual('1', '1')).toBe(true);
    expect(valuesEqual('', '')).toBe(true);
  });
});

describe('lighting panel data', () => {
  it('binds only real settings', () => {
    const used = new Set<string>();
    for (const section of LIGHTING_SECTIONS) {
      for (const slider of section.sliders) used.add(slider.setting);
    }
    for (const preset of LIGHTING_PRESETS) {
      for (const [name] of preset.sets) used.add(name);
    }
    expect([...used].filter((name) => !NAMES.includes(name))).toEqual([]);
  });

  it('strips the parentheticals the plugin puts in its labels', () => {
    const direct = LIGHTING_SECTIONS[1]?.sliders[0];
    expect(direct?.label).toBe('direct (+reflect)');
    expect(direct?.setting).toBe('direct');
  });

  it('uses the plugin resolution rule, not SettingInfo min/max', () => {
    const ambient = LIGHTING_SECTIONS[0]?.sliders[0];
    expect(ambient).toMatchObject({ setting: 'ambient', min: 0, max: 1, step: 0.01 });
  });
});

describe('coerceSettingValue mirrors setting._validate_value', () => {
  it('accepts any float as a boolean, non-zero being true', () => {
    expect(coerceSettingValue('boolean', '2.5')).toBe(1);
    expect(coerceSettingValue('boolean', 0)).toBe(0);
    expect(coerceSettingValue('boolean', -1)).toBe(1);
  });

  it('accepts boolean_dict words and their unique abbreviations', () => {
    expect(coerceSettingValue('boolean', 'on')).toBe(1);
    expect(coerceSettingValue('boolean', 'off')).toBe(0);
    expect(coerceSettingValue('boolean', 'f')).toBe(0);
    expect(coerceSettingValue('boolean', 'tr')).toBe(1);
    expect(() => coerceSettingValue('boolean', 'maybe')).toThrow();
  });

  it('converts boolean-looking strings before int()/float()', () => {
    expect(coerceSettingValue('int', 'on')).toBe(1);
    expect(coerceSettingValue('int', '7')).toBe(7);
    expect(coerceSettingValue('int', '7.9')).toBe(7);
    expect(coerceSettingValue('float', '0.25')).toBeCloseTo(0.25);
    expect(() => coerceSettingValue('float', 'blue')).toThrow();
  });

  it('takes float3 as a list, a comma string or whitespace', () => {
    expect(coerceSettingValue('float3', [1, 2, 3])).toEqual([1, 2, 3]);
    expect(coerceSettingValue('float3', '1,2,3')).toEqual([1, 2, 3]);
    expect(coerceSettingValue('float3', '1 2 3')).toEqual([1, 2, 3]);
    expect(coerceSettingValue('float3', '[0.1, 0.2, 0.3]')).toEqual([0.1, 0.2, 0.3]);
    expect(() => coerceSettingValue('float3', '1 2')).toThrow();
  });

  it('stringifies colours and strips outermost quotes from strings', () => {
    expect(coerceSettingValue('color', 25)).toBe('25');
    expect(coerceSettingValue('string', '"quoted"')).toBe('quoted');
    expect(coerceSettingValue('string', "'quoted'")).toBe('quoted');
    expect(coerceSettingValue('string', 'un"quoted')).toBe('un"quoted');
  });
});

describe('text rendering (SettingGetTextPtr)', () => {
  it('matches PyMOL formats', () => {
    expect(formatSettingValue('boolean', 1)).toBe('on');
    expect(formatSettingValue('boolean', 0)).toBe('off');
    expect(formatSettingValue('int', 12)).toBe('12');
    expect(formatSettingValue('float', 0.14)).toBe('0.14000');
    expect(formatSettingValue('float3', [-0.4, -0.4, -1])).toBe(
      '[ -0.40000, -0.40000, -1.00000 ]',
    );
  });
});

describe('levels gate scopes', () => {
  it('models the lattice, not a chain', () => {
    expect(scopesForLevel('global')).toEqual(['global']);
    expect(scopesForLevel('bond')).toEqual(['global', 'object', 'object-state', 'bond']);
    expect(scopesForLevel('atom-state')).toContain('atom');
    expect(scopesForLevel('unused')).toEqual([]);
  });

  it('refuses a write at a scope the level does not reach', () => {
    // Real levels from this build: ambient is global-only, sphere_scale is atom.
    expect(LEVELS['ambient']).toBe('global');
    expect(LEVELS['sphere_scale']).toBe('atom');
    expect(canWriteAt(meta({ name: 'ambient', level: 'global' }), 'object')).toBe(false);
    expect(canWriteAt(meta({ name: 'sphere_scale', level: 'atom' }), 'object')).toBe(true);
    expect(canWriteAt(meta({ name: 'stick_radius', level: 'bond' }), 'atom')).toBe(false);
  });
});

describe('range hints are hints', () => {
  it('says so for everything PyMOL does not actually clamp', () => {
    const int = meta({ name: 'stick_quality', kind: 'int', min: 3, max: 100 });
    expect(rangeHint(int, 'global')).toBe('3–100');
    expect(rangeHint(int, 'object')).toBe('3–100 (not enforced)');
    const float = meta({ name: 'openvr_gui_fov', kind: 'float', min: 0, max: 89 });
    expect(rangeHint(float, 'global')).toBe('0–89 (not enforced)');
    expect(rangeHint(meta({ name: 'ambient' }), 'global')).toBeNull();
  });
});

describe('defaults drive the reset button', () => {
  it('compares by type', () => {
    expect(isDefaultValue(meta({ name: 'ambient', default: 0.14 }), 0.14)).toBe(true);
    expect(isDefaultValue(meta({ name: 'ambient', default: 0.14 }), 0.2)).toBe(false);
    expect(
      isDefaultValue(meta({ name: 'light', kind: 'float3', default: [-0.4, -0.4, -1] }), [
        -0.4, -0.4, -1,
      ]),
    ).toBe(true);
    // No default known -> the button must not claim the value IS the default.
    expect(isDefaultValue(meta({ name: 'x' }), 1)).toBe(false);
  });
});

describe('name resolution and filtering', () => {
  const catalogue = catalogueOf([
    meta({ name: 'ray_shadow', index: 195 }),
    meta({ name: 'ray_shadow_decay_factor', index: 196 }),
    meta({ name: 'sphere_scale', index: 155 }),
  ]);

  it('accepts an index, a digit string, an exact name and the legacy alias', () => {
    expect(resolveSettingName(catalogue, 155)?.name).toBe('sphere_scale');
    expect(resolveSettingName(catalogue, '155')?.name).toBe('sphere_scale');
    expect(resolveSettingName(catalogue, 'sphere_scale')?.index).toBe(155);
    expect(resolveSettingName(catalogue, 'ray_shadows')?.name).toBe('ray_shadow');
  });

  it('resolves a unique prefix and refuses an ambiguous one', () => {
    expect(resolveSettingName(catalogue, 'sphere_sc')?.index).toBe(155);
    expect(resolveSettingName(catalogue, 'ray_shado')).toBeNull();
  });

  it('filters by regex, falling back to substring for invalid regex', () => {
    expect(filterSettings(catalogue.settings, 'sphere')).toHaveLength(1);
    expect(filterSettings(catalogue.settings, '^ray_.*factor$')).toHaveLength(1);
    expect(filterSettings(catalogue.settings, 'sphere_sc[')).toHaveLength(0);
    expect(filterSettings(catalogue.settings, '')).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

function fakeBackend() {
  let installed = false;
  const values = new Map<number, [unknown, string]>([
    [155, [1, '1.00000']],
    [279, [0, '0.00000']],
  ]);
  const drains: { cursor: number; indices: number[]; full: boolean }[] = [];
  const calls: { fn: string; args: readonly unknown[] }[] = [];
  const bonds: { index: number; model: string; atoms: [number, number]; value: number }[] = [];

  const call = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    calls.push({ fn, args });
    if (fn === 'setting.tenmol_settings_status') {
      if (!installed) throw new Error("setting.tenmol_settings_status: no such symbol");
      return { installed: true, cursor: 0, calls: 0, recorded: 0, catalogueBuilt: true, module: 'm' };
    }
    if (fn === 'setting.tenmol_settings_catalogue') {
      return catalogueOf([
        meta({ name: 'sphere_scale', index: 155, level: 'atom', default: 1 }),
        meta({ name: 'cartoon_transparency', index: 279, level: 'atom', default: 0 }),
      ]);
    }
    if (fn === 'setting.tenmol_settings_values') {
      const wanted = (args[0] as number[] | null) ?? [...values.keys()];
      return {
        object: (args[1] as string) ?? '',
        state: (args[2] as number) ?? 0,
        values: wanted.map((i) => [i, values.get(i)?.[0], values.get(i)?.[1]]),
        failed: [],
      };
    }
    if (fn === 'setting.tenmol_settings_drain') {
      const next = drains.shift();
      return next ?? { cursor: 0, indices: [], batches: 0, full: false, lost: false, observing: true };
    }
    if (fn === 'cmd.set') {
      const [index, value] = args as [number, number];
      values.set(index, [value, String(value)]);
      return null;
    }
    if (fn === 'cmd.unset') {
      values.set(args[0] as number, [1, '1.00000']);
      return null;
    }
    if (fn === 'cmd.set_bond') {
      const [index, value, sel] = args as [number, number, string];
      bonds.push({ index, model: sel, atoms: [1, 2] as [number, number], value });
      return null;
    }
    if (fn === 'cmd.unset_bond') {
      const [index] = args as [number];
      for (let i = bonds.length - 1; i >= 0; i--) if (bonds[i]?.index === index) bonds.splice(i, 1);
      return null;
    }
    if (fn === 'setting.tenmol_settings_bonds') {
      return {
        selection: args[0] as string,
        state: (args[2] as number) ?? 0,
        settings: [231],
        bonds: [...bonds],
        truncated: false,
      };
    }
    return null;
  });

  const run = vi.fn(async (line: string) => {
    if (line === SETTINGS_BOOTSTRAP) installed = true;
    return null;
  });

  return { call, run, calls, drains, values, bonds, isInstalled: () => installed };
}

describe('createSettingsSource', () => {
  it('bootstraps with one `do` line and then loads catalogue + values', async () => {
    const backend = fakeBackend();
    const store = createSettingsStore();
    const source = createSettingsSource({
      call: backend.call as never,
      do: backend.run,
      store,
    });

    await source.bootstrap();

    expect(backend.run).toHaveBeenCalledWith(SETTINGS_BOOTSTRAP);
    expect(backend.isInstalled()).toBe(true);
    expect(store.get().phase).toBe('ready');
    expect(store.get().catalogue?.count).toBe(2);
    expect(store.get().entries[valueKey(155)]).toEqual({ value: 1, text: '1.00000' });
  });

  it('does not re-run the bootstrap when the service is already installed', async () => {
    const backend = fakeBackend();
    await backend.run(SETTINGS_BOOTSTRAP);
    backend.run.mockClear();

    const store = createSettingsStore();
    const source = createSettingsSource({ call: backend.call as never, do: backend.run, store });
    await source.bootstrap();
    expect(backend.run).not.toHaveBeenCalled();
  });

  it('re-reads everything on a `full` drain and only the diff otherwise', async () => {
    const backend = fakeBackend();
    const store = createSettingsStore();
    const changed: number[][] = [];
    const source = createSettingsSource({
      call: backend.call as never,
      do: backend.run,
      store,
      onChanged: (indices) => changed.push([...indices]),
    });
    await source.bootstrap();

    backend.drains.push({ cursor: 5, indices: [279], full: false });
    await source.poll();
    expect(store.get().cursor).toBe(5);
    expect(changed).toEqual([[279]]);
    const diffCall = backend.calls.at(-1);
    expect(diffCall?.fn).toBe('setting.tenmol_settings_values');
    expect(diffCall?.args[0]).toEqual([279]);

    backend.drains.push({ cursor: 9, indices: [1, 2, 3], full: true });
    await source.poll();
    // full -> null index list, i.e. "read every setting"
    expect(backend.calls.at(-1)?.args[0]).toBeNull();
  });

  it('is not optimistic: it reports what PyMOL kept, not what was typed', async () => {
    const backend = fakeBackend();
    const store = createSettingsStore();
    const source = createSettingsSource({ call: backend.call as never, do: backend.run, store });
    await source.bootstrap();
    const target = store.get().catalogue?.settings[0] as SettingMeta;

    const entry = await source.write(target, '2.5');
    expect(entry).toEqual({ value: 2.5, text: '2.5' });
    expect(store.get().rejected[155]).toBeUndefined();

    // Simulate a clamp/no-op: the backend keeps a different value.
    backend.call.mockImplementationOnce(async () => null); // cmd.set, ignored
    backend.values.set(155, [100, '100']);
    await source.write(target, 500);
    expect(store.get().rejected[155]).toMatch(/PyMOL holds 100/);
  });

  it('resets through cmd.unset, which restores the DEFAULT', async () => {
    const backend = fakeBackend();
    const store = createSettingsStore();
    const source = createSettingsSource({ call: backend.call as never, do: backend.run, store });
    await source.bootstrap();
    const target = store.get().catalogue?.settings[0] as SettingMeta;

    await source.write(target, 9);
    expect(store.get().entries[valueKey(155)]?.value).toBe(9);
    await source.reset(target);
    expect(backend.calls.some((c) => c.fn === 'cmd.unset')).toBe(true);
    expect(store.get().entries[valueKey(155)]?.value).toBe(1);
  });

  it('keys values by scope, so an object override never overwrites the global', async () => {
    const backend = fakeBackend();
    const store = createSettingsStore();
    const source = createSettingsSource({ call: backend.call as never, do: backend.run, store });
    await source.bootstrap();

    await source.refresh([155], 'm1', 0);
    expect(store.get().entries[valueKey(155, 'm1', 0)]).toBeDefined();
    expect(store.get().entries[valueKey(155)]).toBeDefined();
    expect(valueKey(155, 'm1', 2)).toBe('155|m1|2');
  });

  it('does not cry "clamped" for a per-atom write it cannot read back', async () => {
    // `cmd.get_setting_tuple` takes an object, not a selection, so the read-back
    // after `cmd.set(index, v, 'elem C')` is the GLOBAL value and would look
    // like a rejection for every correct atom-level write.
    const backend = fakeBackend();
    const store = createSettingsStore();
    const source = createSettingsSource({ call: backend.call as never, do: backend.run, store });
    await source.bootstrap();

    const target = store.get().catalogue!.settings[0] as SettingMeta;
    await source.write(target, 9, { selection: 'elem C' });
    expect(store.get().rejected[target.index]).toBeUndefined();
  });

  it('clears stale rejection notices on a full resync, not on a diff', async () => {
    const backend = fakeBackend();
    const store = createSettingsStore();
    const source = createSettingsSource({ call: backend.call as never, do: backend.run, store });
    await source.bootstrap();

    store.noteRejected(155, 'PyMOL holds 3');
    backend.drains.push({ cursor: 6, indices: [155], full: false });
    await source.poll();
    expect(store.get().rejected[155]).toBe('PyMOL holds 3');

    // `reinitialize settings` -> a session-sized batch -> the notice is stale.
    backend.drains.push({ cursor: 7, indices: [155, 279], full: true });
    await source.poll();
    expect(store.get().rejected[155]).toBeUndefined();
  });

  it('routes a bond-level write to cmd.set_bond, never to cmd.set', async () => {
    const backend = fakeBackend();
    const store = createSettingsStore();
    const source = createSettingsSource({ call: backend.call as never, do: backend.run, store });
    await source.bootstrap();
    backend.calls.length = 0;

    const bondMeta = meta({
      name: 'stick_transparency',
      index: 231,
      kind: 'float',
      level: 'bond',
    });
    const reply = await source.setBond(bondMeta, '0.7', 'wp15 and name CA');

    // `cmd.set` here "will appear to take, but no change will be observed"
    // (`modules/pymol/setting.py:245-248`), so it must not be the call made.
    expect(backend.calls.some((c) => c.fn === 'cmd.set')).toBe(false);
    const wrote = backend.calls.find((c) => c.fn === 'cmd.set_bond');
    expect(wrote?.args).toEqual([231, 0.7, 'wp15 and name CA', null, 0]);
    expect(reply.bonds).toHaveLength(1);
    expect(reply.bonds[0]?.value).toBe(0.7);

    await source.unsetBond(bondMeta, 'wp15 and name CA');
    expect(backend.calls.some((c) => c.fn === 'cmd.unset_bond')).toBe(true);
    expect((await source.getBonds('wp15 and name CA')).bonds).toHaveLength(0);
  });

  it('coerces a bond value before sending it, like every other write', async () => {
    const backend = fakeBackend();
    const store = createSettingsStore();
    const source = createSettingsSource({ call: backend.call as never, do: backend.run, store });
    await source.bootstrap();

    const bondMeta = meta({ name: 'valence', index: 64, kind: 'boolean', level: 'bond' });
    await source.setBond(bondMeta, 'on', 'all');
    const wrote = backend.calls.find((c) => c.fn === 'cmd.set_bond');
    expect(wrote?.args[1]).toBe(1);
  });
});

describe('bond-level settings are the ones cmd.set cannot reach', () => {
  it('names exactly the six `setting.py:449-490` documents', () => {
    expect([...BOND_LEVEL_SETTINGS]).toEqual([
      'valence',
      'line_width',
      'line_color',
      'stick_radius',
      'stick_color',
      'stick_transparency',
    ]);
  });

  it('puts `bond` in their writable scopes, and never `atom`', () => {
    const bond = scopesForLevel('bond');
    expect(bond).toContain('bond');
    expect(bond).not.toContain('atom');
    expect(canWriteAt(meta({ name: 'stick_radius', level: 'bond' }), 'bond')).toBe(true);
    expect(canWriteAt(meta({ name: 'sphere_scale', level: 'atom' }), 'bond')).toBe(false);
  });
});
