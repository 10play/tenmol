/**
 * Tests for the remaining `util.*` helpers (packages/engine-ts/src/cmd/util2.ts):
 * the colouring wrappers (`cnc`, `cba`, `cbh`, `cbss`, `chainbow`, `color_carbon`,
 * the `cb*` element variants, `color_objs`, `color_deep`, `ss`), the analysis
 * verbs (`get_area`, `get_sasa`, `compute_mass`, `find_surface_*`, `phipsi`,
 * `mass_align`) and the labellers (`label_chains`, `label_segments`).
 *
 * Driven through the full {@link LocalBackend} so the composed verbs
 * (`spectrum`, `dss`, `label`, `align`, `color`) are all present, exactly as the
 * wire uses them. Assertions check real effects (per-atom colour counts, SS
 * mapping, positive areas), read back via `count_atoms`/`get_label`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB, EXPECTED } from './fixture';

const PEPT_PDB = readFileSync(
  new URL('../../../apps/web/public/visual/pept.pdb', import.meta.url),
  'utf8',
);

/** Boot a backend with one object read from `pdb` (name 'm'). */
async function boot(pdb = SMALL_PDB, name = 'm'): Promise<LocalBackend> {
  const backend = new LocalBackend();
  await backend.connect();
  await backend.call('read_pdbstr', [pdb, name]);
  return backend;
}

const count = (b: LocalBackend, sel: string): Promise<number> =>
  b.call<number>('count_atoms', [sel]);

/* ------------------------------- colouring ------------------------------- */

describe('util.cnc (colour by element, keep carbon)', () => {
  it('recolours N and O but leaves carbons untouched', async () => {
    const b = await boot();
    await b.call('util.cnc', ['all']);
    expect(await count(b, 'color nitrogen')).toBe(EXPECTED.elemN);
    expect(await count(b, 'color oxygen')).toBe(EXPECTED.elemO);
    // Carbons stay at their loaded colour (index 0 = white), not a carbon colour.
    expect(await count(b, 'elem C and color nitrogen')).toBe(0);
    expect(await count(b, 'elem C and not color white')).toBe(0);
  });
});

describe('util.cba / util.cbh / util.color_carbon', () => {
  it('cba colours carbons with the given colour and non-carbons by element', async () => {
    const b = await boot();
    await b.call('util.cba', ['marine', 'all']);
    expect(await count(b, 'elem C and color marine')).toBe(EXPECTED.elemC);
    expect(await count(b, 'color nitrogen')).toBe(EXPECTED.elemN);
  });

  it('color_carbon only touches carbons', async () => {
    const b = await boot();
    const n = await b.call<number>('util.color_carbon', ['purple', 'all']);
    expect(n).toBe(EXPECTED.elemC);
    expect(await count(b, 'color purple')).toBe(EXPECTED.elemC);
    // Nitrogens still at their loaded colour.
    expect(await count(b, 'color nitrogen')).toBe(0);
  });

  it('cbh colours hydrogens with the given colour (none here → carbons via element)', async () => {
    const b = await boot();
    // No hydrogens in the fixture, so cbh just element-colours everything.
    await b.call('util.cbh', ['white', 'all']);
    expect(await count(b, 'color carbon')).toBe(EXPECTED.elemC);
    expect(await count(b, 'color nitrogen')).toBe(EXPECTED.elemN);
  });
});

describe('util element carbon variants (cbab/cbao/cbak/cbam)', () => {
  it('each colours carbons its own colour and non-carbons by element', async () => {
    for (const [verb, col] of [
      ['util.cbab', 'slate'],
      ['util.cbao', 'brightorange'],
      ['util.cbak', 'pink'],
      ['util.cbam', 'lightmagenta'],
    ] as const) {
      const b = await boot();
      await b.call(verb, ['all']);
      expect(await count(b, `elem C and color ${col}`)).toBe(EXPECTED.elemC);
      expect(await count(b, 'color oxygen')).toBe(EXPECTED.elemO);
    }
  });
});

describe('util.chainbow', () => {
  it('spectrum-colours residues per chain (recolours all atoms)', async () => {
    const b = await boot();
    await b.call('util.chainbow', ['all']);
    // Every atom moved off the loaded white (index 0) onto a spectrum colour.
    expect(await count(b, 'not color white')).toBe(EXPECTED.total);
  });
});

describe('util.color_objs', () => {
  it('gives each object a distinct cycle colour', async () => {
    const b = await boot();
    await b.call('read_pdbstr', [SMALL_PDB, 'n']);
    const n = await b.call<number>('util.color_objs', ['all']);
    expect(n).toBe(2);
    // First object → carbon (cycle[0]); second → cyan (cycle[1]).
    expect(await count(b, 'm and color carbon')).toBe(EXPECTED.total);
    expect(await count(b, 'n and color cyan')).toBe(EXPECTED.total);
  });
});

describe('util.color_deep', () => {
  it('recolours the whole selection', async () => {
    const b = await boot();
    const n = await b.call<number>('util.color_deep', ['red', 'all']);
    expect(n).toBe(EXPECTED.total);
    expect(await count(b, 'color red')).toBe(EXPECTED.total);
  });
});

/* --------------------------- SS-dependent verbs -------------------------- */

describe('util.ss + util.cbss (real peptide)', () => {
  it('assigns SS then maps helix→red, sheet→yellow, loop→green', async () => {
    const b = await boot(PEPT_PDB, 'p');
    await b.call('util.ss', ['all', 1]); // delegates to dss
    await b.call('util.cbss', ['all']);

    const total = await count(b, 'all');
    const h = await count(b, 'ss H');
    const s = await count(b, 'ss S');
    const loop = await count(b, 'not (ss S+H)');
    expect(h + s + loop).toBe(total);

    // cbss maps each SS class to its colour exactly.
    expect(await count(b, 'color red')).toBe(h);
    expect(await count(b, 'color yellow')).toBe(s);
    expect(await count(b, 'color green')).toBe(loop);
    // A real peptide has at least some loop.
    expect(loop).toBeGreaterThan(0);
  });
});

/* ------------------------------- analysis -------------------------------- */

describe('util.get_area / util.get_sasa / util.compute_mass', () => {
  it('returns positive areas, with SASA larger than the vdw surface', async () => {
    const b = await boot();
    const vdw = await b.call<number>('util.get_area', ['all']);
    const sasa = await b.call<number>('util.get_sasa', ['all']);
    expect(vdw).toBeGreaterThan(0);
    expect(sasa).toBeGreaterThan(0);
    // The solvent-accessible surface (vdw+probe spheres) exceeds the vdw surface.
    expect(sasa).toBeGreaterThan(vdw);
  });

  it('compute_mass returns a plausible positive mass', async () => {
    const b = await boot();
    const m = await b.call<number>('util.compute_mass', ['all']);
    // 5 C + 2 N + 2 O ≈ 60 + 28 + 32 = 120 u.
    expect(m).toBeGreaterThan(100);
    expect(m).toBeLessThan(140);
  });
});

describe('util.find_surface_atoms / util.find_surface_residues', () => {
  it('creates a selection of exposed atoms and residues', async () => {
    const b = await boot(PEPT_PDB, 'p');
    const atomsSel = await b.call<string>('util.find_surface_atoms', ['all', 'exp_a']);
    const resSel = await b.call<string>('util.find_surface_residues', ['all', 'exp_r']);
    expect(atomsSel).toBe('exp_a');
    expect(resSel).toBe('exp_r');
    // Both selections are non-empty for a solvated peptide, and residues ⊇ atoms.
    const nAtoms = await count(b, 'exp_a');
    const nRes = await count(b, 'exp_r');
    expect(nAtoms).toBeGreaterThan(0);
    expect(nRes).toBeGreaterThanOrEqual(nAtoms);
  });
});

describe('util.phipsi', () => {
  it('returns finite (phi, psi) for a mid-chain residue', async () => {
    const b = await boot(PEPT_PDB, 'p');
    const [phi, psi] = await b.call<[number | null, number | null]>('util.phipsi', ['resi 3']);
    expect(typeof phi).toBe('number');
    expect(typeof psi).toBe('number');
    expect(phi).toBeGreaterThanOrEqual(-180);
    expect(phi).toBeLessThanOrEqual(180);
    expect(psi).toBeGreaterThanOrEqual(-180);
    expect(psi).toBeLessThanOrEqual(180);
  });

  it('returns nulls when there is no preceding/following residue', async () => {
    const b = await boot();
    // Fixture chain A has a single residue, so neither phi nor psi is defined.
    const [phi, psi] = await b.call<[number | null, number | null]>('util.phipsi', ['chain A']);
    expect(phi).toBeNull();
    expect(psi).toBeNull();
  });
});

describe('util.mass_align', () => {
  it('aligns a second copy of an object onto the first without throwing', async () => {
    const b = await boot(PEPT_PDB, 'a');
    await b.call('read_pdbstr', [PEPT_PDB, 'bb']);
    const n = await b.call<number>('util.mass_align', ['a']);
    // One other object was aligned onto target 'a'.
    expect(n).toBe(1);
  });
});

/* ------------------------------- labelling ------------------------------- */

describe('util.label_chains / util.label_segments', () => {
  it('labels the first atom of each chain with "chain <id>"', async () => {
    const b = await boot();
    await b.call('util.label_chains', ['all']);
    const labels = await b.call<Array<[string, number, string]>>('get_label', ['all']);
    const texts = labels.map((l) => l[2]).sort();
    expect(texts).toEqual(['chain A', 'chain B']);
  });

  it('label_segments is callable (no segments in the fixture → no labels)', async () => {
    const b = await boot();
    await b.call('util.label_segments', ['all']);
    const labels = await b.call<Array<[string, number, string]>>('get_label', ['all']);
    expect(labels.length).toBe(0);
  });
});
