import { describe, it, expect } from 'vitest';

import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerExtras } from '../src/cmd/extras';
import type { CommandHandler } from '../src/cmd/registrar';

/* ------------------------------------------------------------------------ */
/* A tiny two-residue peptide (with a CA per residue) plus a HETATM MSE      */
/* residue carrying a selenium (SE), spread across TWO models (states) so    */
/* state ops have something to chew on.                                      */
/* ------------------------------------------------------------------------ */

const PDB = [
  'MODEL        1',
  'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 10.00           N',
  'ATOM      2  CA  ALA A   1       1.500   0.000   0.000  1.00 11.00           C',
  'ATOM      3  C   ALA A   1       2.000   1.400   0.000  1.00 12.00           C',
  'ATOM      4  N   GLY A   2       3.300   1.400   0.000  1.00 20.00           N',
  'ATOM      5  CA  GLY A   2       4.000   2.600   0.000  1.00 21.00           C',
  'HETATM    6  SE  MSE B   1      10.000  10.000  10.000  1.00 30.00          Se',
  'HETATM    7  CA  MSE B   1      11.000  10.000  10.000  1.00 31.00           C',
  'ENDMDL',
  'MODEL        2',
  'ATOM      1  N   ALA A   1       0.500   0.000   0.000  1.00 10.00           N',
  'ATOM      2  CA  ALA A   1       2.000   0.000   0.000  1.00 11.00           C',
  'ATOM      3  C   ALA A   1       2.500   1.400   0.000  1.00 12.00           C',
  'ATOM      4  N   GLY A   2       3.800   1.400   0.000  1.00 20.00           N',
  'ATOM      5  CA  GLY A   2       4.500   2.600   0.000  1.00 21.00           C',
  'HETATM    6  SE  MSE B   1      10.500  10.000  10.000  1.00 30.00          Se',
  'HETATM    7  CA  MSE B   1      11.500  10.000  10.000  1.00 31.00           C',
  'ENDMDL',
  'END',
].join('\n');

/** Fresh executive + wired-up extras handlers, per the isolated harness. */
function setup() {
  const ex = new Executive();
  ex.addMolecule(parsePdb(PDB, 'm'));
  const handlers = new Map<string, CommandHandler>();
  let publishes = 0;
  let viewEmits = 0;
  const ctx = {
    command: (n: string, f: CommandHandler) => handlers.set(n, f),
    executive: ex,
    publish() {
      publishes++;
    },
    emitView() {
      viewEmits++;
    },
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerExtras(ctx);
  const call = (name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) =>
    handlers.get(name)!(args, kwargs);
  return { ex, handlers, call, stats: () => ({ publishes, viewEmits }) };
}

describe('extras — residual command sweep', () => {
  it('registers a handler for every claimed verb (no gaps, callable)', () => {
    const { handlers } = setup();
    const claimed = [
      // real
      'alphatoall', 'mse2met', 'mask', 'unmask', 'get_mask', 'delete_states',
      'split_states', 'join_states', 'copy_to', 'extract', 'overlap',
      // `middle` moved to cmd/system.ts (real movie set_frame mode 3 — jumps
      // the playhead to the middle frame, not a camera recentre).
      'intra_rms_cur', 'look_at', 'refresh',
      'transparency', 'stereo', 'edit_mode',
      // no-ops (representative sample across every batch). `load` is no longer
      // here — it is a real handler in cmd/fileio.ts (see load.test.ts); likewise
      // `fetch` moved to cmd/fileio.ts (loads the cached/local file);
      // `edit`/`remove_picked`/`unpick` moved to cmd/editing.ts, `fab` to
      // cmd/editor.ts, and the superposition family (intra_rms/alignto/extra_fit/
      // cealign/usalign/pair_fit) to cmd/align.ts (see parity-*.test.ts).
      // `save` moved to cmd/exporters.ts (real .pse session + structure exporter).
      'log', // ray/draw/png are real now (cmd/render.ts)
      // `map_set` moved to cmd/maps.ts (real elementwise map arithmetic).
      // `volume` moved to cmd/maps.ts (real object:volume gadget creator).
      'mcopy', 'cls', 'cache', 'quit',
      'alias', 'assign_stereo',
      'get_mtl_obj', 'get_povray', 'povray',
    ];
    for (const name of claimed) {
      expect(handlers.has(name), `missing handler: ${name}`).toBe(true);
    }
    // ~56 verbs registered overall (was >60 before `middle` moved to
    // cmd/system.ts as the real movie set_frame mode 3, and `minsert` moved to
    // cmd/system.ts as the real movie frame-insert; then `pbc_unwrap` and
    // `pbc_wrap` moved to cmd/symmetry.ts as real PBC-trajectory handlers; then
    // `unset_deep` moved to cmd/settings2.ts as the real bulk setting reset;
    // then `volume` moved to cmd/maps.ts as the real object:volume creator; then
    // `save` moved to cmd/exporters.ts as the real .pse session/structure writer).
    expect(handlers.size).toBeGreaterThanOrEqual(54);
  });

  /* --------------------------- REAL behaviours --------------------------- */

  it('mask / unmask / get_mask toggle the per-atom masked flag', () => {
    const { call } = setup();
    expect(call('get_mask', ['all'])).toBe(0);
    const n = call('mask', ['all']);
    expect(n).toBe(7);
    expect(call('get_mask', ['all'])).toBe(7);
    // Unmask only chain A; chain B (2 atoms) stays masked.
    call('unmask', ['chain A']);
    expect(call('get_mask', ['all'])).toBe(2);
    expect(call('get_mask', ['chain A'])).toBe(0);
  });

  it('alphatoall copies the CA b-factor to every atom of the residue', () => {
    const { ex, call } = setup();
    const changed = call('alphatoall', ['all', 'b']);
    expect(typeof changed).toBe('number');
    const mol = ex.molecule('m')!;
    // ALA residue: N(10) and C(12) should now match CA's 11.
    const ala = mol.atoms.filter((a) => a.resn === 'ALA');
    for (const a of ala) expect(a.b).toBe(11);
  });

  it('mse2met renames MSE→MET and converts SE→SD/sulfur', () => {
    const { ex, call } = setup();
    const changed = call('mse2met', ['all']);
    expect(changed).toBe(2);
    const mol = ex.molecule('m')!;
    const mse = mol.atoms.filter((a) => a.resi === '1' && a.chain === 'B');
    expect(mse.length).toBe(2);
    for (const a of mse) expect(a.resn).toBe('MET');
    const se = mse.find((a) => a.name === 'SD');
    expect(se).toBeTruthy();
    expect(se!.elem).toBe('S');
  });

  it('delete_states removes matching states from an object', () => {
    const { ex, call } = setup();
    expect(ex.molecule('m')!.nstate).toBe(2);
    const removed = call('delete_states', ['m', '2']);
    expect(removed).toBe(1);
    expect(ex.molecule('m')!.nstate).toBe(1);
  });

  it('split_states makes one single-state object per state', () => {
    const { ex, call } = setup();
    const created = call('split_states', ['m']) as string[];
    expect(Array.isArray(created)).toBe(true);
    expect(created.length).toBe(2);
    for (const name of created) {
      const mol = ex.molecule(name)!;
      expect(mol).toBeTruthy();
      expect(mol.nstate).toBe(1);
      expect(mol.natom).toBe(7);
    }
  });

  it('join_states builds a multi-state object from single-state objects', () => {
    const { ex, call } = setup();
    // Two single-state copies to fold back together.
    const created = call('split_states', ['m']) as string[];
    const sel = created.join(' or ');
    const nstate = call('join_states', ['joined', sel]);
    expect(nstate).toBe(2);
    expect(ex.molecule('joined')!.nstate).toBe(2);
  });

  it('copy_to copies a selection into a fresh object without touching source', () => {
    const { ex, call } = setup();
    const n = call('copy_to', ['justCA', 'name CA']);
    expect(n).toBe(3); // three CA atoms (ALA, GLY, MSE)
    expect(ex.molecule('justCA')!.natom).toBe(3);
    expect(ex.molecule('m')!.natom).toBe(7); // source unchanged
  });

  it('extract creates a new object AND removes the atoms from the source', () => {
    const { ex, call } = setup();
    const n = call('extract', ['chainB', 'chain B']);
    expect(n).toBe(2);
    expect(ex.molecule('chainB')!.natom).toBe(2);
    expect(ex.molecule('m')!.natom).toBe(5); // chain B removed from source
    expect(ex.countAtoms('chain B and m')).toBe(0);
  });

  it('overlap returns a non-negative clash total (>0 for a self-overlap)', () => {
    const { call } = setup();
    const total = call('overlap', ['chain A', 'chain A']);
    expect(typeof total).toBe('number');
    expect(total as number).toBeGreaterThan(0);
    // Chain A vs the far-away chain B: no clash.
    const none = call('overlap', ['chain A', 'chain B']);
    expect(none).toBe(0);
  });

  it('intra_rms_cur reports an UNsuperposed per-state list with a -1.0 reference', () => {
    // intra_rms_cur is the unfitted variant that stays in extras.ts; the fitted
    // intra_rms (mode 1) now lives in cmd/align.ts (parity-superposition.test.ts).
    const { call } = setup();
    const rms = call('intra_rms_cur', ['all']) as number[];
    expect(Array.isArray(rms)).toBe(true);
    expect(rms.length).toBe(2);
    expect(rms[0]).toBe(-1.0);
    expect(rms[1]).toBeGreaterThan(0); // models differ by +0.5 in x
  });

  it('look_at aims the camera forward axis at the target', () => {
    const { ex, call } = setup();
    // Known camera: identity rotation, 50 units in front, origin at 0.
    ex.view.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 60, -20]);
    // Reorient the camera to face object 'm' (default mobile_obj='_Camera').
    call('look_at', ['m']);
    const v = ex.view.get();
    // After look_at the target centre projects onto the camera's forward (-z)
    // axis: cameraCoords(center) = pos + R*(center - origin) = (0, 0, -dist).
    const c = ex.selectionSphere('m')!.center;
    const R = v.slice(0, 9); // column-major model -> camera
    const d = [c[0] - v[12]!, c[1] - v[13]!, c[2] - v[14]!];
    const camX = R[0]! * d[0]! + R[3]! * d[1]! + R[6]! * d[2]! + v[9]!;
    const camY = R[1]! * d[0]! + R[4]! * d[1]! + R[7]! * d[2]! + v[10]!;
    const camZ = R[2]! * d[0]! + R[5]! * d[1]! + R[8]! * d[2]! + v[11]!;
    expect(Math.abs(camX)).toBeLessThan(1e-3);
    expect(Math.abs(camY)).toBeLessThan(1e-3);
    expect(camZ).toBeLessThan(0); // target in front of the camera
    // `middle` no longer lives here — it moved to cmd/system.ts as the real
    // movie set_frame mode 3 (jump the playhead to the middle frame).
  });

  it('transparency / stereo / edit_mode land as observable settings', () => {
    const { ex, call } = setup();
    call('transparency', [0.4]);
    expect(ex.getSettingFloat('transparency')).toBeCloseTo(0.4);
    call('stereo', ['on']);
    expect(ex.getSettingFloat('stereo')).toBe(1);
    call('edit_mode', [0]);
    expect(ex.getSettingFloat('edit_mode')).toBe(0);
  });

  it('refresh triggers a publish and returns null', () => {
    const { call, stats } = setup();
    const before = stats().publishes;
    expect(call('refresh')).toBeNull();
    expect(stats().publishes).toBe(before + 1);
  });

  /* --------------------------- DOCUMENTED NO-OPS ------------------------- */

  it('environment-bound verbs are safe no-ops with the right shape', () => {
    const { ex, call } = setup();
    const before = ex.molecule('m')!.natom;
    // null-returning (`load` is a real verb now — cmd/fileio.ts, load.test.ts;
    // `save` is a real verb now — cmd/exporters.ts, .pse session exporter)
    for (const v of ['quit', 'cache', 'cls', 'log']) {
      expect(call(v), `${v} should return null`).toBeNull();
    }
    // shaped returns
    // alignto/cealign/pair_fit are real now (cmd/align.ts, parity-superposition)
    expect(call('get_povray')).toEqual(['', '']);
    expect(call('get_mtl_obj')).toBe('');
    // `remove_picked` is a real verb now (cmd/editing.ts, parity-noop-stubs.test.ts)
    // no side effects on the model
    expect(ex.molecule('m')!.natom).toBe(before);
  });
});
