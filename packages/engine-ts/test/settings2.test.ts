/**
 * Tests for the `settings2` subsystem (packages/engine-ts/src/cmd/settings2.ts):
 * `set` (global + per-object), `unset`, `toggle`, `set_bond`/`unset_bond`,
 * `get_object_settings`, `get_setting_legacy`, `get_clip`, `viewport`,
 * `window`, `full_screen`.
 *
 * Isolated: builds a RegistrarCtx over a bare Executive so no other in-progress
 * subsystem is pulled in. Expected values are derived by hand from PyMOL's
 * SettingInfo defaults, the default 18-float view, and the fixture's
 * distance-bonded ALA/GLY connectivity.
 */

import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { repBit } from '../src/model/atom';
import { Rep } from '@tenmol/protocol';
import { registerSettings2 } from '../src/cmd/settings2';
import { SETTING_INFO_DEFAULTS } from '../src/cmd/setting-defaults';
import type { CommandHandler } from '../src/cmd/registrar';
import { SMALL_PDB } from './fixture';

interface Harness {
  ex: Executive;
  call(name: string, args?: unknown[], kwargs?: Record<string, unknown>): unknown;
  publishCount(): number;
}

function makeHarness(): Harness {
  const ex = new Executive();
  ex.addMolecule(parsePdb(SMALL_PDB, 'm'));
  const handlers = new Map<string, CommandHandler>();
  let published = 0;
  const ctx = {
    command: (n: string, f: CommandHandler) => void handlers.set(n, f),
    executive: ex,
    publish: () => void (published += 1),
    emitView: () => {},
    str: (v: unknown, d = '') => (v === undefined || v === null ? d : String(v)),
  };
  registerSettings2(ctx);
  return {
    ex,
    call: (name, args = [], kwargs = {}) => {
      const h = handlers.get(name);
      if (!h) throw new Error(`no handler '${name}'`);
      return h(args, kwargs);
    },
    publishCount: () => published,
  };
}

describe('setting-defaults: generated compiled-in defaults (SettingInfo.h table)', () => {
  it('applies the open-source volume_mode override (0, not the incentive header 1)', () => {
    // The vendored SettingInfo.h ships the incentive default (1); open-source
    // PyMOL — the verification oracle — ships 0. scripts/gen-setting-defaults.mjs
    // reconciles this via its OVERRIDES map. Verified against the real oracle
    // (packages/graph/verify/probes/setting__volume_mode.json).
    expect(SETTING_INFO_DEFAULTS['volume_mode']).toBe(0);
    const h = makeHarness();
    expect(h.ex.getSettingFloat('volume_mode')).toBe(0);
    expect(h.call('get_setting_int', ['volume_mode'])).toBe(0);
  });

  it('locks representative compiled-in defaults across every REC_* value type', () => {
    // Regenerated deterministically by scripts/gen-setting-defaults.mjs; these pin
    // the parse of each macro shape so a generator change can't silently drift a
    // default. Values verified against real PyMOL during the feature-verify grind.
    expect(SETTING_INFO_DEFAULTS['sphere_scale']).toBe(1); // REC_f float
    expect(SETTING_INFO_DEFAULTS['surface_quality']).toBe(0); // REC_i int
    expect(SETTING_INFO_DEFAULTS['two_sided_lighting']).toBe(-1); // REC_i, negative default
    expect(SETTING_INFO_DEFAULTS['valence']).toBe(1); // REC_b boolean -> 1
    expect(SETTING_INFO_DEFAULTS['swap_dsn6_bytes']).toBe(1); // REC_b boolean
    expect(SETTING_INFO_DEFAULTS['wildcard']).toBe('*'); // REC_s string
    expect(SETTING_INFO_DEFAULTS['surface_color']).toEqual({ color: '-1' }); // REC_c colour ref
    expect(SETTING_INFO_DEFAULTS['label_position']).toEqual([0, 0, 1.75]); // REC_3 float3 vector
  });
});

describe('settings2: set / unset global round-trip', () => {
  it('resets a numeric setting to its compiled default', () => {
    const h = makeHarness();
    expect(h.ex.getSettingFloat('sphere_scale')).toBe(1.0);
    h.call('set', ['sphere_scale', '2.5']);
    expect(h.ex.getSettingFloat('sphere_scale')).toBe(2.5);
    h.call('unset', ['sphere_scale']);
    expect(h.ex.getSettingFloat('sphere_scale')).toBe(1.0);
  });

  it('restores the executive-captured default for a string setting', () => {
    const h = makeHarness();
    // button_mode_name is a string default only the executive knows.
    expect(h.ex.getSetting('button_mode_name')).toBe('3-Button Viewing');
    h.call('set', ['button_mode_name', 'Custom']);
    expect(h.ex.getSetting('button_mode_name')).toBe('Custom');
    h.call('unset', ['button_mode_name']);
    expect(h.ex.getSetting('button_mode_name')).toBe('3-Button Viewing');
  });

  it('unset of an unknown setting falls back to 0', () => {
    const h = makeHarness();
    h.ex.set('made_up_setting', 7);
    h.call('unset', ['made_up_setting']);
    expect(h.ex.getSettingFloat('made_up_setting')).toBe(0);
  });

  it('set coerces numeric strings but keeps non-numeric text', () => {
    const h = makeHarness();
    h.call('set', ['line_width', '3']);
    expect(h.ex.getSetting('line_width')).toBe(3);
    h.call('set', ['button_mode_name', 'abc']);
    expect(h.ex.getSetting('button_mode_name')).toBe('abc');
  });
});

describe('settings2: per-object settings', () => {
  it('scopes set to an object and reads it back, then unsets it', () => {
    const h = makeHarness();
    const n = h.call('set', ['sphere_scale', '0.7', 'm']);
    expect(n).toBe(1);
    // Global stays at its default — per-object override is separate.
    expect(h.ex.getSettingFloat('sphere_scale')).toBe(1.0);
    // PyMOL's get_object_settings serializes the object-level setting handle as
    // a list of [index, type, value] tuples (SettingAsPyList). sphere_scale is
    // index 155, type 3 (cSetting_float). Verified against real PyMOL.
    expect(h.call('get_object_settings', ['m'])).toEqual([[155, 3, 0.7]]);

    const removed = h.call('unset', ['sphere_scale', 'm']);
    expect(removed).toBe(1);
    expect(h.call('get_object_settings', ['m'])).toBeNull();
  });

  it('returns null for an object with no overrides', () => {
    const h = makeHarness();
    // No settings handle -> C-layer null -> Python None. Verified against real PyMOL.
    expect(h.call('get_object_settings', ['m'])).toBeNull();
    expect(h.call('get_object_settings', ['nope'])).toBeNull();
  });
});

describe('settings2: toggle', () => {
  it('flips a boolean-ish global setting 0<->1', () => {
    const h = makeHarness();
    expect(h.ex.getSettingFloat('orthoscopic')).toBe(0);
    expect(h.call('toggle', ['orthoscopic'])).toBe(1);
    expect(h.ex.getSettingFloat('orthoscopic')).toBe(1);
    expect(h.call('toggle', ['orthoscopic'])).toBe(0);
    expect(h.ex.getSettingFloat('orthoscopic')).toBe(0);
  });

  it('toggles a representation across a selection', () => {
    const h = makeHarness();
    const sphereBit = repBit(Rep.Sphere);
    const caShown = () =>
      h.ex.atomsMatching('name CA').filter((ua) => (ua.atom.visRep & sphereBit) !== 0).length;
    expect(caShown()).toBe(0);
    // Two CA atoms; none show spheres -> toggle turns them on.
    expect(h.call('toggle', ['spheres', 'name CA'])).toBe(1);
    expect(caShown()).toBe(2);
    // Now shown -> toggle hides them.
    expect(h.call('toggle', ['spheres', 'name CA'])).toBe(0);
    expect(caShown()).toBe(0);
  });
});

describe('settings2: bond settings', () => {
  // Read the per-bond override of a single bond spanning two selections,
  // directly off the executive store (get_bond lives in a different subsystem
  // not registered by this harness).
  const bondValue = (h: Harness, name: string, sel1: string, sel2: string): number | string | undefined => {
    const a = new Set(h.ex.atomsMatching(sel1).map((u) => u.index));
    const b = new Set(h.ex.atomsMatching(sel2).map((u) => u.index));
    const mol = h.ex.molecule('m')!;
    for (const [i, j] of mol.bonds) {
      if ((a.has(i) && b.has(j)) || (a.has(j) && b.has(i))) return h.ex.getBondSetting(name, 'm', i, j);
    }
    return undefined;
  };

  it('set_bond overrides the CA-CB bond and unset_bond removes it', () => {
    const h = makeHarness();
    // In ALA, CA (idx1) is distance-bonded to CB (idx4); GLY has no CB.
    // Real PyMOL's set_bond/unset_bond return None (the count is not surfaced
    // to Python); the effect is observed on the stored per-bond override.
    expect(h.call('set_bond', ['stick_radius', '0.5', 'name CA', 'name CB'])).toBeNull();
    expect(bondValue(h, 'stick_radius', 'name CA', 'name CB')).toBe(0.5);
    // Idempotent selection order does not create duplicates; unset clears it.
    expect(h.call('unset_bond', ['stick_radius', 'name CB', 'name CA'])).toBeNull();
    expect(bondValue(h, 'stick_radius', 'name CA', 'name CB')).toBeUndefined();
    // Nothing left to remove — still None.
    expect(h.call('unset_bond', ['stick_radius', 'name CA', 'name CB'])).toBeNull();
  });

  it('set_bond over the backbone marks each consecutive bond', () => {
    const h = makeHarness();
    // Within-ALA backbone bonds among {N,CA,C}: N-CA and CA-C => 2 bonds.
    // set_bond returns None; each bond carries the override.
    expect(
      h.call('set_bond', ['stick_radius', '0.4', 'name N+CA+C and chain A', 'name N+CA+C and chain A']),
    ).toBeNull();
    expect(bondValue(h, 'stick_radius', 'name N', 'name CA')).toBe(0.4);
    expect(bondValue(h, 'stick_radius', 'name CA', 'name C')).toBe(0.4);
  });
});

describe('settings2: view extras', () => {
  it('get_clip reads front/back from the default view', () => {
    const h = makeHarness();
    // defaultView() matches PyMOL SceneSetDefaultView: front=40, back=100.
    expect(h.call('get_clip')).toEqual([40, 100]);
    // A set_view moves the clip planes; get_clip tracks them.
    const v = h.ex.view.get();
    v[15] = 5;
    v[16] = 99;
    h.ex.view.set(v);
    expect(h.call('get_clip')).toEqual([5, 99]);
  });

  it('viewport stores and returns the size; -1 leaves it unchanged', () => {
    const h = makeHarness();
    expect(h.call('viewport')).toEqual([640, 480]);
    expect(h.call('viewport', ['800', '600'])).toEqual([800, 600]);
    // A -1 query returns the stored size without mutating it.
    expect(h.call('viewport', [-1, -1])).toEqual([800, 600]);
    // Height only.
    expect(h.call('viewport', [-1, 720])).toEqual([800, 720]);
  });

  it('window is a no-op returning null (matches the oracle)', () => {
    const h = makeHarness();
    expect(h.call('window', ['hide'])).toBeNull();
    expect(h.call('window', ['show'])).toBeNull();
    // `reference` is no longer a settings2 no-op: it moved to the `editing`
    // subsystem as a real per-atom reference-state command (store/recall/
    // validate/swap), verified against real PyMOL by the oracle differential.
  });

  it('full_screen raises the oracle bare CmdException (GUI-thread bound)', () => {
    // Off the GUI thread (always, in the headless oracle) `viewing.py` re-`_do`s
    // the line and it surfaces as a bare `pymol.CmdException`. Verified against
    // the real-PyMOL oracle; the browser full-screen is a separate UI path.
    const h = makeHarness();
    expect(() => h.call('full_screen', [1])).toThrow(/Error:/);
    expect(() => h.call('full_screen', [-1])).toThrow();
  });

  it('get_setting_legacy is an exact alias of get_setting_float', () => {
    // `modules/pymol/api.py`: `get_setting_float as get_setting_legacy`. It
    // reads a setting as a float and honours the per-object `object` argument,
    // returning the same value get_setting_float would (verified vs real PyMOL).
    const h = makeHarness();
    expect(h.call('get_setting_legacy', ['sphere_scale'])).toBe(1.0);
    // Per-object override resolves like get_setting_float, not the global.
    h.call('set', ['sphere_scale', 0.25, 'ala']);
    expect(h.call('get_setting_legacy', ['sphere_scale', 'ala'])).toBe(
      h.call('get_setting_float', ['sphere_scale', 'ala']),
    );
    // Unknown setting matches get_setting_float exactly (both 0 in this port).
    expect(h.call('get_setting_legacy', ['nonexistent_setting'])).toBe(
      h.call('get_setting_float', ['nonexistent_setting']),
    );
  });
});
