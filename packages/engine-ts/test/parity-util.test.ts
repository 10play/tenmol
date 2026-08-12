/**
 * RED parity tests for the `util.*` charge / area / analysis helpers that the
 * TS port either does not register (charges, ESP machinery) or approximates with
 * the wrong algorithm (get_sasa_relative uses a fixed Tien-et-al. lookup table
 * instead of PyMOL's per-residue isolated-context reference).
 *
 * Every expected value is derived from the vendored real-PyMOL source, cited per
 * test:
 *   packages/engine/modules/pymol/util.py
 *   packages/engine/modules/chempy/protein_amber99.py  (Amber-99 charges)
 *
 * These assertions describe what REAL PyMOL produces, so they FAIL against the
 * current port (TDD red). A later implementation wave must make them green.
 *
 * NOTE on idioms: verbs the port has not ported throw NotPorted; we wrap those
 * calls in try/catch so the test still reaches its post-condition assertion
 * (asserting `.rejects.toThrow(NotPorted)` would pass today and defeat the
 * purpose). The observable is always read back through the shared public API.
 */
import { describe, expect, it } from 'vitest';

import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB, FIXTURE_ATOMS, makePdb, type FixtureAtom } from './fixture';

async function boot(pdb = SMALL_PDB, name = 'm'): Promise<LocalBackend> {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [pdb, name]);
  return b;
}

/** Swallow a NotPorted / CmdException so the test can still assert the effect. */
async function trySilently(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    /* verb throws today; the assertion on the observable is what makes it red */
  }
}

describe('parity: util.* charge / area / analysis helpers', () => {
  /* ------------------------- protein_assign_charges_and_radii ------------- */

  it('protein_assign_charges_and_radii: assigns the Amber-99 backbone-O partial charge (-0.5679)', async () => {
    // PyMOL ref: util.py:335 protein_assign_charges_and_radii runs chempy.champ
    // assign.amber99, which sets partial_charge from protein_amber99.py. There
    // ('ALA','O') -> charge -0.5679 (protein_amber99.py:25, the internal/normal
    // residue table). So an internal ALA's backbone carbonyl O must read
    // partial_charge == -0.5679 afterwards.
    //
    // A single-chain tripeptide so residue 2 is unambiguously internal (terminal
    // residues get the separate N-/C-terminal charge sets).
    const tri: FixtureAtom[] = [];
    let serial = 1;
    for (let r = 1; r <= 3; r++) {
      const dx = (r - 1) * 3.8;
      const bb: Array<[string, number, number, number, string]> = [
        ['N', 0.0, 0.0, 0.0, 'N'],
        ['CA', 1.458, 0.0, 0.0, 'C'],
        ['C', 2.0, 1.42, 0.0, 'C'],
        ['O', 1.25, 2.39, 0.0, 'O'],
        ['CB', 2.0, -0.77, 1.2, 'C'],
      ];
      for (const [nm, x, y, z, el] of bb) {
        tri.push({ serial: serial++, name: nm, resn: 'ALA', chain: 'A', resi: r, x: x + dx, y, z, elem: el });
      }
    }
    const b = await boot(makePdb(tri), 'tri');

    await trySilently(() => b.call('util.protein_assign_charges_and_radii', ['tri']));

    // Read the assigned partial charge of residue-2's backbone O.
    const stored = { pc: null as number | null };
    await trySilently(() =>
      b.call('iterate', ['tri and resi 2 and name O', 'stored.pc = partial_charge'], { space: { stored } }),
    );
    expect(stored.pc).toBeCloseTo(-0.5679, 4); // RED: port has no partial_charge
  });

  /* ------------------------------ sum_formal_charges --------------------- */

  it('sum_formal_charges: totals the per-atom formal_charge over a selection', async () => {
    // PyMOL ref: util.py:269 sum_formal_charges iterates "sum += formal_charge".
    // With formal_charge = -1 assigned to the two carbonyl O atoms of the
    // di-peptide (name O -> 2 atoms), the total over (all) is exactly -2.
    const b = await boot();
    await b.call('alter', ['name O', 'formal_charge = -1']);

    let total: number | null = null;
    await trySilently(async () => {
      total = (await b.call('util.sum_formal_charges', ['all'])) as number;
    });
    expect(total).toBe(-2); // RED: verb unported + formal_charge not persisted
  });

  /* ------------------------------ sum_partial_charges -------------------- */

  it('sum_partial_charges: totals the per-atom partial_charge over a selection', async () => {
    // PyMOL ref: util.py:277 sum_partial_charges iterates "sum += partial_charge".
    // Assign partial_charge = 1.0 to the two CA atoms (name CA -> 2 atoms); the
    // total over (all) is exactly 2.0.
    const b = await boot();
    await b.call('alter', ['name CA', 'partial_charge = 1.0']);

    let total: number | null = null;
    await trySilently(async () => {
      total = (await b.call('util.sum_partial_charges', ['all'])) as number;
    });
    expect(total).toBeCloseTo(2.0, 6); // RED: verb unported + partial_charge dropped
  });

  /* -------------------------------- color_by_area ------------------------ */

  it.fails('color_by_area: paints the most-buried atom the blue (0,0,1) end of the rainbow', async () => {
    // PyMOL ref: util.py:80 color_by_area loads per-atom surface area into b then
    // spectrum("b", "rainbow", ...). PyMOL's "rainbow" palette maps the minimum
    // value to pure blue (0,0,1) and the maximum to pure red (1,0,0). In a small
    // all-carbon cluster the central atom, fully surrounded by four neighbours,
    // has the strict minimum molecular area, so it must become blue.
    const s = 1.54 / Math.sqrt(3); // tetrahedral bond projection
    const cluster: FixtureAtom[] = [
      { serial: 1, name: 'C1', resn: 'UNL', chain: 'A', resi: 1, x: 0, y: 0, z: 0, elem: 'C' },
      { serial: 2, name: 'C2', resn: 'UNL', chain: 'A', resi: 1, x: s, y: s, z: s, elem: 'C' },
      { serial: 3, name: 'C3', resn: 'UNL', chain: 'A', resi: 1, x: s, y: -s, z: -s, elem: 'C' },
      { serial: 4, name: 'C4', resn: 'UNL', chain: 'A', resi: 1, x: -s, y: s, z: -s, elem: 'C' },
      { serial: 5, name: 'C5', resn: 'UNL', chain: 'A', resi: 1, x: -s, y: -s, z: s, elem: 'C' },
    ];
    const b = await boot(makePdb(cluster), 'clu');

    await trySilently(() => b.call('util.color_by_area', ['clu']));

    // Read the central atom's colour index, then resolve it to an RGB tuple.
    const stored = { c: -1 };
    await b.call('iterate', ['clu and name C1', 'stored.c = color'], { space: { stored } });
    const rgb = (await b.call('get_color_tuple', [stored.c])) as [number, number, number] | null;
    expect(rgb).toEqual([0, 0, 1]); // RED: port leaves the central carbon its element colour
  });

  /* ------------------------------ get_sasa_relative ---------------------- */

  it('get_sasa_relative: a lone fully-exposed residue has relative SASA 1.0 (loaded into b)', async () => {
    // PyMOL ref: util.py:1064 get_sasa_relative divides each residue's area in
    // context by its area alone in the "byres extend 1" tripeptide, and alters
    // that ratio (0..1) into b (var default 'b', util.py:1161). For a single
    // isolated residue the two areas are identical, so the ratio is exactly 1.0
    // for every atom. (The port instead divides by a fixed Tien-2013 max-ASA
    // table and never loads b -> wrong value and b stays 0.)
    const ala = FIXTURE_ATOMS.filter((a) => a.chain === 'A'); // the 5 ALA atoms
    const b = await boot(makePdb(ala), 'one');

    await trySilently(() => b.call('get_sasa_relative', ['one'], { var: 'b' }));

    const stored = { bs: [] as number[] };
    await b.call('iterate', ['one', 'stored.bs.push(b)'], { space: { stored } });
    expect(stored.bs).toHaveLength(5);
    for (const bv of stored.bs) expect(bv).toBeCloseTo(1.0, 3); // RED: b stays 0
  });

  /* ------------------------------------ b2vdw --------------------------- */

  it('b2vdw: copies the B-factor into the vdw radius (rms = sqrt(b/78.9568))', async () => {
    // PyMOL ref: util.py:958 b2vdw sets vdw = (b/78.9568352087)**0.5. With
    // b = 78.9568352087 the vdw radius becomes exactly 1.0 A, so a lone atom's
    // van-der-Waals surface area (get_area with dot_solvent=0, probe 0) is
    // 4*pi*1^2 = 12.566 A^2. The port never ports b2vdw, so vdw stays the carbon
    // default (1.7 A) and the area is 4*pi*1.7^2 ~ 36.3 A^2.
    const lone: FixtureAtom[] = [
      { serial: 1, name: 'C', resn: 'UNL', chain: 'A', resi: 1, x: 0, y: 0, z: 0, elem: 'C' },
    ];
    const b = await boot(makePdb(lone), 'atom1');
    await b.call('alter', ['all', 'b = 78.9568352087']);

    await trySilently(() => b.call('util.b2vdw', ['all']));

    // dot_solvent=0 -> vdw surface (probe 0); a lone atom exposes its whole sphere.
    const area = (await b.call('util.get_area', ['atom1', -1, 0])) as number;
    expect(area).toBeCloseTo(4 * Math.PI, 0); // 12.566 A^2 — RED (port yields ~36.3)
  });

  /* -------------------------------- interchain_distances ----------------- */

  it('interchain_distances: creates an enabled distance object between the chains', async () => {
    // PyMOL ref: util.py:1043 interchain_distances loops chain pairs and calls
    // cmd.distance(name, chain A, chain B, ...), then cmd.enable(name). The
    // di-peptide has chains A and B, so a distance measurement object named 'd'
    // must exist afterwards (it shows up in cmd.get_names).
    const b = await boot();

    await trySilently(() => b.call('util.interchain_distances', ['d', 'm']));

    const names = (await b.call('get_names', ['objects'])) as string[];
    expect(names).toContain('d'); // RED: verb unported, no 'd' object created
  });

  /* ------------------------------------ ligand_zoom ---------------------- */

  it('ligand_zoom: moves the camera origin onto the organic ligand centroid', async () => {
    // PyMOL ref: util.py:1194 ligand_zoom picks the next organic residue and does
    // `zoom /obj/seg/chain & resi X, animate=1, buffer=2`, which sets the model-
    // space origin of rotation (get_view()[12..14]) to that selection's centre.
    // With a protein object framed first and a separate organic ligand centred at
    // (20,20,20), ligand_zoom must recentre the view onto (20,20,20).
    const b = await boot(); // di-peptide protein 'm'
    const lig: FixtureAtom[] = [
      { serial: 1, name: 'C1', resn: 'LIG', chain: 'L', resi: 1, x: 19, y: 20, z: 20, elem: 'C', hetatm: true },
      { serial: 2, name: 'C2', resn: 'LIG', chain: 'L', resi: 1, x: 21, y: 20, z: 20, elem: 'C', hetatm: true },
      { serial: 3, name: 'C3', resn: 'LIG', chain: 'L', resi: 1, x: 20, y: 19, z: 20, elem: 'C', hetatm: true },
      { serial: 4, name: 'C4', resn: 'LIG', chain: 'L', resi: 1, x: 20, y: 21, z: 20, elem: 'C', hetatm: true },
    ];
    await b.call('read_pdbstr', [makePdb(lig), 'lig']);
    await b.call('zoom', ['m']); // frame the protein, well away from (20,20,20)

    await trySilently(() => b.call('util.ligand_zoom', []));

    const view = (await b.call('get_view', [])) as number[];
    // get_view()[12..14] is the model-space origin of rotation (view/view.ts:11).
    expect(view[12]).toBeCloseTo(20, 3); // RED: view stays framed on the protein
    expect(view[13]).toBeCloseTo(20, 3);
    expect(view[14]).toBeCloseTo(20, 3);
  });
});
