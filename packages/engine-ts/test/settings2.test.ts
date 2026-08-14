/**
 * Tests for the `settings2` subsystem (packages/engine-ts/src/cmd/settings2.ts):
 * `set` (global + per-object), `unset`, `toggle`, `set_bond`/`unset_bond`,
 * `get_object_settings`, `get_setting_legacy`, `get_clip`, `viewport`,
 * `window`, `full_screen`, `reference`.
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
  it('set_bond counts the CA-CB bond and unset_bond removes it', () => {
    const h = makeHarness();
    // In ALA, CA (idx1) is distance-bonded to CB (idx4); GLY has no CB.
    const n = h.call('set_bond', ['stick_radius', '0.5', 'name CA', 'name CB']);
    expect(n).toBe(1);
    // Idempotent selection order does not create duplicates.
    const removed = h.call('unset_bond', ['stick_radius', 'name CB', 'name CA']);
    expect(removed).toBe(1);
    // Nothing left to remove.
    expect(h.call('unset_bond', ['stick_radius', 'name CA', 'name CB'])).toBe(0);
  });

  it('set_bond over the backbone marks each consecutive bond once', () => {
    const h = makeHarness();
    // Within-ALA backbone bonds among {N,CA,C}: N-CA and CA-C => 2 bonds.
    const n = h.call('set_bond', ['stick_radius', '0.4', 'name N+CA+C and chain A', 'name N+CA+C and chain A']);
    expect(n).toBe(2);
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

  it('window / full_screen / reference are no-ops returning null', () => {
    const h = makeHarness();
    expect(h.call('window', ['hide'])).toBeNull();
    expect(h.call('full_screen', [1])).toBeNull();
    expect(h.call('full_screen', [-1])).toBeNull();
    expect(h.call('reference')).toBeNull();
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
