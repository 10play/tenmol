/**
 * RED parity tests for the export / session slice.
 *
 * These pin what REAL PyMOL does for session round-tripping (`get_session` /
 * `set_session`), multi-entry saves (`multisave`), and the string exporters for
 * formats beyond pdb/fasta/xyz that PyMOL supports (`get_str` for mol / sdf /
 * mol2 — see `get_bytes` docstring `format = str: pdb|cif|sdf|mol|mol2|mae|pqr|xyz`).
 *
 * Ground truth: packages/engine/modules/pymol/exporting.py.
 * Current port: packages/engine-ts/src/cmd/exporters.ts (get_str handles only
 * pdb/fasta/xyz/cif; get_session emits a bespoke `tenmol-session` shape).
 *
 * Every assertion targets the desired real-PyMOL observable, so each test is
 * RED today. Molecular surface *mesh* export is deliberately out of scope.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

async function boot() {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [SMALL_PDB, 'm']);
  return b;
}

/** get_str that never throws at the call site, so the test reaches its assert. */
async function tryGetStr(b: LocalBackend, format: string, sel: string): Promise<string> {
  try {
    const s = await b.call('get_str', [format, sel]);
    return typeof s === 'string' ? s : '';
  } catch {
    return '';
  }
}

describe('parity: export / session', () => {
  it('get_session: names is a per-object spec list (name[4]==1 for a molecule)', async () => {
    const b = await boot();
    // PyMOL ref: exporting.py `_session_convert_legacy` iterates `session['names']`
    // where each non-None entry is a LIST describing one object — `name[0]` is the
    // object name, `name[1]` the spec type (0 = object), and `name[4]` the object
    // type code (line 345: `if name[4] == 1: # molecule`). A None sentinel is also
    // present (line 321: `if name is None: continue`).
    const session = (await b.call('get_session')) as { names: unknown[] };
    const spec = (session.names ?? []).find(
      (n) => Array.isArray(n) && (n as unknown[])[0] === 'm',
    ) as unknown[] | undefined;
    // Real PyMOL: the 'm' molecule entry carries type code 1 at index 4.
    expect(spec?.[4]).toBe(1); // RED today: TS names === ['m'] (bare strings)
  });

  it('get_session -> set_session: round-trips the object back with 9 atoms', async () => {
    const b = await boot();
    // PyMOL ref: exporting.py get_session / importing.py set_session — a session
    // captures the loaded objects so a delete + restore reproduces every atom.
    const session = await b.call('get_session');
    await b.call('delete', ['all']);
    expect(await b.call('count_atoms', ['all'])).toBe(0);
    await b.call('set_session', [session]);
    expect(await b.call('count_atoms', ['all'])).toBe(9); // restore contract
    // And the restored session must expose the real names-spec shape, not the
    // bespoke `tenmol-session` dict, so this is RED today.
    const restored = (await b.call('get_session')) as { names: unknown[] };
    expect((restored.names ?? []).some((n) => Array.isArray(n))).toBe(true);
  });

  it('multisave: writes a multi-entry PDB with one HEADER per object', async () => {
    const b = await boot();
    await b.call('read_pdbstr', [SMALL_PDB, 'm2']); // a second object
    // PyMOL ref: exporting.py multisave docstring (lines 609-618) — "Every object
    // in the given selection (pattern) will have a HEADER and a CRYST (if symmetry
    // is defined) record, and is terminated with END. Loading such a multi-entry
    // PDB file into PyMOL will load each entry as a separate object."
    // multisave writes the file to disk (returns success, not the string) — read
    // it back and count the per-object HEADER records.
    const dir = mkdtempSync(join(tmpdir(), 'tenmol-ms-'));
    let s: string;
    try {
      await b.call('multisave', [join(dir, 'out.pdb'), 'all']);
      s = readFileSync(join(dir, 'out.pdb'), 'utf8');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const headers = (s.match(/^HEADER/gm) ?? []).length;
    expect(headers).toBe(2); // one HEADER per object
  });

  it('get_str("mol"): emits an MDL molfile that re-reads to 9 atoms', async () => {
    const b = await boot();
    // PyMOL ref: exporting.py get_bytes (line 689) lists `mol` among supported
    // formats. A valid MDL V2000 molfile round-trips through read_molstr.
    const mol = await tryGetStr(b, 'mol', 'all');
    await b.call('read_molstr', [mol, 'rt']);
    expect(await b.call('count_atoms', ['rt'])).toBe(9); // RED: get_str('mol') unsupported
  });

  it('get_str("sdf"): emits an SDF record that re-reads to 9 atoms', async () => {
    const b = await boot();
    // PyMOL ref: exporting.py get_bytes (line 689) lists `sdf` among supported
    // formats. A single-record SDF (MOL block + `$$$$`) round-trips via read_sdfstr.
    const sdf = await tryGetStr(b, 'sdf', 'all');
    await b.call('read_sdfstr', [sdf, 'rt']);
    expect(await b.call('count_atoms', ['rt'])).toBe(9); // RED: get_str('sdf') unsupported
  });

  it('get_str("mol2"): emits a Tripos MOL2 that re-reads to 9 atoms', async () => {
    const b = await boot();
    // PyMOL ref: exporting.py get_bytes (line 689) lists `mol2` among supported
    // formats. A valid @<TRIPOS> block round-trips through read_mol2str.
    const mol2 = await tryGetStr(b, 'mol2', 'all');
    await b.call('read_mol2str', [mol2, 'rt']);
    expect(await b.call('count_atoms', ['rt'])).toBe(9); // RED: get_str('mol2') unsupported
  });
});
