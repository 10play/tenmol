/**
 * Wave 8 — the shipped default-shortcut table, diffed against PyMOL's own.
 *
 * The parity row for "Default keyboard shortcut table (100+ bindings)" said:
 *
 *   NOT verified: the other ~100 bindings, F-keys, and the ctrl/alt chord
 *   fallbacks.
 *
 * `shortcuts.ts` claimed in its header that "`shortcuts.test.ts` diffs this
 * table against `packages/engine/modules/pymol/shortcut_dict.py`". THAT FILE DID NOT EXIST —
 * the claim was stale, and nothing checked the table. This is that diff, and
 * it is stronger than the promised one: `__fixtures__/p8a34-keys.json` is
 * `pymol.shortcut_dict.shortcut_dict_ref` read out of a LIVE engine
 * (`packages/bridge/tests/test_p8_a34.py`, which also asserts every row is present in
 * `cmd.key_mappings` and fails if the file drifts), not the source file
 * re-parsed.
 *
 * The chord entry points (`_ctrl`/`_alt`/`_ctsh`) are exercised on the bridge
 * side; only the DATA can be checked here.
 */

import { describe, expect, it } from 'vitest';

import { MODIFIER_KEYS, SPECIAL_KEY_NAMES, SPECIAL_MAP } from './keys';
import { DEFAULT_SHORTCUTS, DEFAULT_SHORTCUT_BY_KEY } from './shortcuts';
import fixture from './__fixtures__/p8a34-keys.json';

const REF: Record<string, string[]> = fixture.ref;
const SPECIAL_CODES = fixture.special_key_codes as Record<string, string>;

describe('DEFAULT_SHORTCUTS vs pymol.shortcut_dict.shortcut_dict_ref', () => {
  it('ships every key PyMOL binds, and no key it does not', () => {
    const ours = DEFAULT_SHORTCUTS.map((s) => s.key).sort();
    expect(ours).toEqual(Object.keys(REF).sort());
    expect(ours).toHaveLength(125);
  });

  it('has no duplicate keys', () => {
    expect(DEFAULT_SHORTCUT_BY_KEY.size).toBe(DEFAULT_SHORTCUTS.length);
  });

  it('carries the same command string for every one of the 125 rows', () => {
    const diff: string[] = [];
    for (const shortcut of DEFAULT_SHORTCUTS) {
      const row = REF[shortcut.key];
      if (!row) continue; // reported by the key-set test above
      if (row[0] !== shortcut.command) {
        diff.push(`${shortcut.key}: ours ${JSON.stringify(shortcut.command)}, PyMOL ${JSON.stringify(row[0])}`);
      }
    }
    expect(diff).toEqual([]);
  });

  it('carries the same description for every one of the 125 rows', () => {
    const diff: string[] = [];
    for (const shortcut of DEFAULT_SHORTCUTS) {
      const row = REF[shortcut.key];
      if (!row) continue;
      if (row[1] !== shortcut.description) {
        diff.push(`${shortcut.key}: ours ${JSON.stringify(shortcut.description)}, PyMOL ${JSON.stringify(row[1])}`);
      }
    }
    expect(diff).toEqual([]);
  });
});

describe('the F-key rows', () => {
  it('binds CTRL-Fn and CTSH-Fn to a scene store, for all twelve', () => {
    for (let n = 1; n <= 12; n += 1) {
      expect(DEFAULT_SHORTCUT_BY_KEY.get(`CTRL-F${n}`)?.command).toBe(`scene F${n}, store`);
      expect(DEFAULT_SHORTCUT_BY_KEY.get(`CTSH-F${n}`)?.command).toBe(`scene SHFT-F${n}, store`);
    }
  });

  it('leaves bare Fn and SHFT-Fn unbound, so they fall through to scene/view lookup', () => {
    for (let n = 1; n <= 12; n += 1) {
      expect(DEFAULT_SHORTCUT_BY_KEY.has(`F${n}`)).toBe(false);
      expect(DEFAULT_SHORTCUT_BY_KEY.has(`SHFT-F${n}`)).toBe(false);
      // ... but the key still has to be FORWARDABLE, or the fallback is dead.
      expect(SPECIAL_MAP[`F${n}`]).toBe(n);
    }
  });
});

describe('the names a forwarded key resolves to', () => {
  it('SPECIAL_KEY_NAMES is internal.special_key_codes, code for code', () => {
    const ours = Object.fromEntries(
      Object.entries(SPECIAL_KEY_NAMES).map(([code, name]) => [String(code), name]),
    );
    expect(ours).toEqual(SPECIAL_CODES);
  });

  it('MODIFIER_KEYS is internal.modifier_keys, index for index', () => {
    expect(MODIFIER_KEYS).toEqual(fixture.modifier_keys);
  });

  it('every modified default key is spelled `<MODIFIER_KEYS[m]>-<special name>`', () => {
    // `_special` builds `modifier_keys[m] + '-' + special_key_codes[k]`
    // (internal.py:455-460). Every default row with a modifier must therefore
    // be reachable that way, or the binding can never fire.
    const specialNames = new Set(Object.values(SPECIAL_CODES));
    const prefixes = MODIFIER_KEYS.filter((m) => m !== '');
    const unreachable = Object.keys(REF).filter((key) => {
      const dash = key.indexOf('-');
      if (dash < 0) return !specialNames.has(key);
      const prefix = key.slice(0, dash);
      const rest = key.slice(dash + 1);
      if (!prefixes.includes(prefix)) return true;
      // single letters and digits come through the ascii chord path instead
      if (rest.length === 1) return false;
      return !specialNames.has(rest);
    });
    expect(unreachable).toEqual([]);
  });
});
