/**
 * Wave 13 — the two Properties Inspector rows that were standing on a `†`
 * citation: the 4-level tree (row 448) and the Delete-key unset semantics
 * (row 450).
 *
 * WHAT THE FALLBACK CITATIONS WERE WORTH, measured:
 *
 *   row 448 cited `packages/bridge/tests/test_properties.py` and
 *   `p8followPick.dom.test.tsx`. Neither reads the tree. The row's real
 *   coverage turned out to be `model.test.ts`, which DOES go red when a group
 *   is deleted from `emptyTree()` or `stereo` is added back — but which checks
 *   the three key lists only by LENGTH. Swapping `segi` and `chain`, or
 *   renaming `elec_radius`, left the whole web suite green. A key list that is
 *   the right length and the wrong contents renders a tree full of blanks.
 *
 *   row 450 cited `packages/bridge/tests/test_properties.py`. That file is
 *   honest about the BACKEND CONTRACT — it drives `cmd.matrix_reset(mode=1)`,
 *   `cmd.set_title(m, s, '')`, `cmd.unset` and the two `alter ... = None` forms
 *   against a live engine and asserts each outcome. What it cannot see is the
 *   DISPATCH: which tree branch chooses which of those calls. `applyUnset` had
 *   no test at all, so routing `object-ttt` to `set_title` would have shipped.
 *
 * So: this file pins the three key lists and the disabled set against
 * `properties_dialog.py` itself (the technique `builder.test.ts` uses for the
 * builder's button tables), and drives every branch of `applyUnset` through a
 * recording session.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASTATE_BUILTIN_KEYS,
  ATOM_BUILTIN_KEYS,
  ATOM_IDENTIFIER_KEYS,
  PROPERTY_READONLY_KEYS,
  type PropertyBranch,
  type PropertyRow,
} from '@tenmol/protocol/topics/dialogs';
import { KEYS, READONLY } from './model';
import { applyUnset, atomRows } from './service';
import type { Session } from '../../app';

const REPO = join(import.meta.dirname, '../../../../..');
const QT_PROPS = join(REPO, 'packages/engine/modules/pmg_qt/properties_dialog.py');
const qtSource = readFileSync(QT_PROPS, 'utf8');

/**
 * A `self.keys_* = [...]` list out of `properties_dialog.py:99-111`.
 *
 * Comments are stripped BEFORE the strings are pulled, which is the whole
 * subtlety: upstream carries `# 'stereo',` inside the builtin list with the
 * reason above it, and a naive string scan would silently re-add it.
 */
function upstreamKeys(name: string): string[] {
  const start = qtSource.indexOf(`self.keys_${name} = [`);
  if (start < 0) throw new Error(`no self.keys_${name} in properties_dialog.py`);
  const open = qtSource.indexOf('[', start);
  const close = qtSource.indexOf(']', open);
  const body = qtSource
    .slice(open + 1, close)
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** `self.items['x'].setDisabled(True)` — `properties_dialog.py:113-117`. */
function upstreamDisabled(): string[] {
  return [...qtSource.matchAll(/self\.items\['(\w+)'\]\.setDisabled\(True\)/g)].map((m) => m[1]!);
}

/* ====================================================================== 448 */

describe("row 448 — the fixed tree carries upstream's key lists, not just their length", () => {
  it('has the 11 identifiers of properties_dialog.py:99-102, in order', () => {
    const upstream = upstreamKeys('atom_identifiers');
    expect(upstream).toHaveLength(11);
    expect([...ATOM_IDENTIFIER_KEYS]).toEqual(upstream);
    expect([...KEYS.identifiers]).toEqual(upstream);
  });

  it('has the 19 atom built-ins of properties_dialog.py:103-110, in order', () => {
    const upstream = upstreamKeys('atom_builtins');
    expect(upstream).toHaveLength(19);
    expect([...ATOM_BUILTIN_KEYS]).toEqual(upstream);
    expect([...KEYS.atomBuiltins]).toEqual(upstream);
  });

  it('leaves `stereo` out because upstream commented it out, not by accident', () => {
    // The comment and the commented-out key are both still there upstream: if
    // someone uncomments it, `upstreamKeys` grows to 20 and the test above
    // fails rather than this one silently passing.
    expect(qtSource).toContain('# avoid stereo auto-assignment errors');
    expect(qtSource).toContain("# 'stereo',");
    expect([...ATOM_BUILTIN_KEYS]).not.toContain('stereo');
  });

  it('has the 4 atom-state built-ins of properties_dialog.py:111', () => {
    const upstream = upstreamKeys('astate_builtins');
    expect([...ASTATE_BUILTIN_KEYS]).toEqual(upstream);
    expect(upstream).toEqual(['state', 'x', 'y', 'z']);
  });

  it('disables exactly the four keys upstream calls setDisabled(True) on', () => {
    const upstream = upstreamDisabled();
    expect([...upstream].sort()).toEqual(['index', 'model', 'oneletter', 'state']);
    expect([...PROPERTY_READONLY_KEYS].sort()).toEqual([...upstream].sort());
    expect([...READONLY].sort()).toEqual([...upstream].sort());
  });

  it('marks those four — and only those four — read-only on the rows it builds', async () => {
    const rows = await atomRows(recordingSession(ATOM_REPLY), '1abc', 1, 1);
    const all = [...rows.identifiers, ...rows.builtins, ...rows.astate];
    expect(all.length).toBeGreaterThan(30);

    const readOnly = all.filter((r) => r.readOnly).map((r) => r.key);
    expect([...readOnly].sort()).toEqual(['index', 'model', 'oneletter', 'state']);

    // Not vacuous the other way either: an editable row really is editable.
    expect(all.find((r) => r.key === 'resn')!.readOnly).toBeFalsy();
    expect(all.find((r) => r.key === 'b')!.readOnly).toBeFalsy();
  });
});

/* ====================================================================== 450 */

interface Recorded {
  fn: string;
  args: readonly unknown[];
  kwargs: Readonly<Record<string, unknown>> | undefined;
}

function recordingSession(replies: Record<string, unknown> = {}, log: Recorded[] = []): Session {
  return {
    call: async (fn: string, args: readonly unknown[] = [], kwargs?: Record<string, unknown>) => {
      log.push({ fn, args, kwargs });
      if (fn in replies) return replies[fn];
      return null;
    },
    run: async () => {},
  } as unknown as Session;
}

/** Enough of a chempy model for `atomRows` to build every row. */
const ATOM_REPLY: Record<string, unknown> = {
  get_model: {
    atom: [
      {
        index: 3,
        id: 3,
        rank: 2,
        name: 'CA',
        symbol: 'C',
        resn: 'ALA',
        resi: '12',
        chain: 'A',
        segi: '',
        alt: '',
        ss: 'H',
        b: 21.5,
        q: 1.0,
        vdw: 1.7,
        elec_radius: 0,
        partial_charge: 0,
        formal_charge: 0,
        numeric_type: -9999,
        text_type: '',
        coord: [1.5, 2.5, 3.5],
        flags: 0,
        hetatm: 0,
      },
    ],
  },
  'cmd.tenmol_props.atom_extras': {
    ok: true,
    found: true,
    builtins: {
      color: 0x40000005,
      reps: 2,
      label: '',
      cartoon: 0,
      protons: 6,
      geom: 3,
      valence: 4,
    },
    properties: {},
  },
};

const row = (branch: PropertyBranch, key: string, text = 'something'): PropertyRow => ({
  branch,
  key,
  text,
});

describe('row 450 — Delete dispatches one specific call per tree branch', () => {
  it('TTT Matrix -> matrix_reset(model, mode=1)', async () => {
    const log: Recorded[] = [];
    const ok = await applyUnset(
      recordingSession({}, log),
      { model: 'm1', state: 2 },
      row('object-ttt', 'TTT Matrix'),
    );
    expect(ok).toBe(true);
    expect(log).toEqual([{ fn: 'matrix_reset', args: ['m1'], kwargs: { mode: 1 } }]);
  });

  it('Title -> an EMPTY set_title for that state', async () => {
    const log: Recorded[] = [];
    const ok = await applyUnset(
      recordingSession({}, log),
      { model: 'm1', state: 2 },
      row('ostate-title', 'Title'),
    );
    expect(ok).toBe(true);
    expect(log).toEqual([{ fn: 'set_title', args: ['m1', 2, ''], kwargs: undefined }]);
  });

  it('State Matrix -> matrix_reset(model, state, mode=2), NOT mode=1', async () => {
    const log: Recorded[] = [];
    const ok = await applyUnset(
      recordingSession({}, log),
      { model: 'm1', state: 2 },
      row('ostate-matrix', 'State Matrix'),
    );
    expect(ok).toBe(true);
    // mode 1 resets the TTT; mode 2 resets the state matrix. Sending the wrong
    // one silently clears the wrong transform (`editing.py`, `matrix_reset`).
    expect(log).toEqual([{ fn: 'matrix_reset', args: ['m1', 2], kwargs: { mode: 2 } }]);
  });

  it('an object setting -> cmd.unset(key, model, quiet=0) with NO state', async () => {
    const log: Recorded[] = [];
    const ok = await applyUnset(
      recordingSession({}, log),
      { model: 'm1', state: 2 },
      row('object-settings', 'sphere_scale'),
    );
    expect(ok).toBe(true);
    expect(log).toEqual([{ fn: 'unset', args: ['sphere_scale', 'm1'], kwargs: { quiet: 0 } }]);
  });

  it('an object-STATE setting -> cmd.unset(key, model, state, quiet=0)', async () => {
    const log: Recorded[] = [];
    const ok = await applyUnset(
      recordingSession({}, log),
      { model: 'm1', state: 2 },
      row('ostate-settings', 'sphere_scale'),
    );
    expect(ok).toBe(true);
    expect(log).toEqual([{ fn: 'unset', args: ['sphere_scale', 'm1', 2], kwargs: { quiet: 0 } }]);
  });

  it('an atom setting -> alter pk1, `s.key = None`', async () => {
    const log: Recorded[] = [];
    const ok = await applyUnset(
      recordingSession({}, log),
      { model: 'm1', state: 2 },
      row('atom-settings', 'sphere_scale'),
    );
    expect(ok).toBe(true);
    expect(log).toEqual([
      { fn: 'alter', args: ['pk1', 's.sphere_scale = None', 0], kwargs: undefined },
    ]);
  });

  it('an EMPTY value is a no-op on every branch (properties_dialog.py:243-246)', async () => {
    for (const branch of [
      'object-ttt',
      'ostate-title',
      'ostate-matrix',
      'object-settings',
      'ostate-settings',
      'atom-settings',
    ] as PropertyBranch[]) {
      const log: Recorded[] = [];
      const ok = await applyUnset(
        recordingSession({}, log),
        { model: 'm1', state: 2 },
        row(branch, 'k', ''),
      );
      expect(ok).toBe(false);
      expect(log).toEqual([]);
    }
  });

  it('identifiers, built-ins and atom-state rows have no unset: `else: unset_result = False`', async () => {
    for (const branch of [
      'atom-identifier',
      'atom-builtin',
      'astate-builtin',
      'astate-settings',
    ] as PropertyBranch[]) {
      const log: Recorded[] = [];
      const ok = await applyUnset(
        recordingSession({}, log),
        { model: 'm1', state: 2 },
        row(branch, 'resi'),
      );
      // False is load-bearing: the panel only reloads the tree when it is true
      // (`if unset_result: self.update_treewidget_model()`).
      expect(ok).toBe(false);
      expect(log).toEqual([]);
    }
  });
});
