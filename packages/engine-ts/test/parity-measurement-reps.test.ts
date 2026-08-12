/**
 * RED parity tests — measurement + label geometry.
 *
 * These pin what REAL PyMOL does for the distance / angle / dihedral
 * measurement objects, atom labels, and the dashes rep. Each assertion targets
 * the real-PyMOL observable, so the test is RED against today's port and
 * documents the parity target for a later implementation wave.
 *
 * Ground-truth references (vendored real-PyMOL source under
 * packages/engine/...):
 *   - modules/pymol/querying.py  distance()/angle()/dihedral() (create objects),
 *     get_distance()/get_angle()/get_dihedral() (numeric readback), get_type().
 *   - layer3/Executive.cpp       ExecutiveDistance (returns the *average* of the
 *     measured distances), ExecutiveGetType -> "object:measurement".
 *   - layer0/Vector.cpp          get_dihedral3f — the signed-torsion convention.
 *   - modules/pymol/viewing.py   label() — stores per-atom label text.
 *   - modules/pymol/editing.py   set_name() — renames an object.
 */

import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { Rep } from '@tenmol/protocol';
import { SMALL_PDB } from './fixture';

async function boot(): Promise<LocalBackend> {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [SMALL_PDB, 'm']);
  return b;
}

/** Chain-A atom selector for the di-peptide fixture. */
const A = (name: string): string => `m and chain A and name ${name}`;

describe('parity: measurement + label reps', () => {
  it('distance: creates an "object:measurement" named d, with the exact length', async () => {
    const b = await boot();
    // PyMOL ref: querying.py distance() creates a distance object (default
    // name dist01); Executive.cpp ExecutiveDistance returns the average of the
    // measured distances. get_type() (Executive.cpp:9011-9012) reports a
    // distance object as "object:measurement". Fixture: N=(0,0,0),
    // CA=(1.458,0,0) -> 1.458 A exactly.
    const ret = (await b.call('distance', ['d', A('N'), A('CA')])) as number;

    // The object is registered and measurable.
    expect(await b.call('get_names', ['objects'])).toContain('d');
    expect(ret).toBeCloseTo(1.458, 3);
    expect(await b.call('get_distance', [A('N'), A('CA')])).toBeCloseTo(1.458, 3);

    // A distance object is a measurement object, NOT a molecule. (RED: the port
    // stubs get_type to always answer "object:molecule".)
    expect(await b.call('get_type', ['d'])).toBe('object:measurement');
  });

  it('angle: creates an "object:measurement" named a, with the exact angle', async () => {
    const b = await boot();
    // PyMOL ref: querying.py angle() creates an angle object; get_angle()
    // returns the vertex angle at atom2. Fixture chain A: N=(0,0,0),
    // CA=(1.458,0,0), C=(2,1.42,0) -> N-CA-C = 110.891 deg.
    const ret = (await b.call('angle', ['a', A('N'), A('CA'), A('C')])) as number;

    expect(await b.call('get_names', ['objects'])).toContain('a');
    expect(ret).toBeCloseTo(110.891, 2);
    expect(await b.call('get_angle', [A('N'), A('CA'), A('C')])).toBeCloseTo(110.891, 2);

    // An angle object is a measurement object. (RED: get_type stub -> molecule.)
    expect(await b.call('get_type', ['a'])).toBe('object:measurement');
  });

  it('dihedral: object value matches get_dihedral (signed) and is a measurement', async () => {
    const b = await boot();
    // PyMOL ref: querying.py dihedral() creates a dihedral object whose value is
    // the signed torsion of the same four atoms that get_dihedral() reports
    // (get_dihedral3f, layer0/Vector.cpp: positive is right-handed looking down
    // the atom2->atom3 axis). Fixture chain A, non-planar via CB (z=1.2):
    // CB=(2,-0.77,1.2), CA=(1.458,0,0), C=(2,1.42,0), O=(1.25,2.39,0)
    // -> get_dihedral = -123.056 deg.
    const gd = (await b.call('get_dihedral', [A('CB'), A('CA'), A('C'), A('O')])) as number;
    expect(gd).toBeCloseTo(-123.056, 2); // the real, faithful readback

    const ret = (await b.call('dihedral', ['di', A('CB'), A('CA'), A('C'), A('O')])) as number;
    expect(await b.call('get_names', ['objects'])).toContain('di');

    // The dihedral OBJECT must carry the SAME signed value get_dihedral reports.
    // (RED: the port's dihedral builder uses the opposite sign convention, so it
    // returns +123.056 instead of -123.056.)
    expect(ret).toBeCloseTo(-123.056, 2);
    expect(ret).toBeCloseTo(gd, 3);

    // A dihedral object is a measurement object. (RED: get_type stub.)
    expect(await b.call('get_type', ['di'])).toBe('object:measurement');
  });

  it('label: the stored text is readable through get_model .label', async () => {
    const b = await boot();
    // PyMOL ref: viewing.py label() evaluates the expression per atom and stores
    // the result as that atom's label; get_model() (querying.py) returns a
    // chempy Indexed model whose atoms expose .label. A quoted literal is stored
    // verbatim.
    await b.call('label', [A('CA'), '"tag"']);

    const model = (await b.call('get_model', [A('CA')])) as { atom: Array<{ label?: string }> };
    expect(model.atom.length).toBe(1);
    // RED: the port's get_model omits the .label field entirely.
    expect(model.atom[0]!.label).toBe('tag');
  });

  it('dashes: a distance object is listed with the Dash rep bit enabled', async () => {
    const b = await boot();
    // PyMOL ref: a distance/angle/dihedral object renders through cRepDash, so
    // it appears in the object list carrying the dashes rep. Rep.Dash (=10) ->
    // bit 1<<10. (RED: the port never surfaces measurement objects in the
    // objects topic, so no row named 'd' exists and the Dash bit is absent.)
    let objects: Array<{ name: string; reps: number }> = [];
    b.on('objects', (p: { objects: Array<{ name: string; reps: number }> }) => {
      objects = p.objects;
    });
    await b.call('distance', ['d', A('N'), A('CA')]);

    const row = objects.find((o) => o.name === 'd');
    const dashBit = 1 << Rep.Dash;
    expect((row?.reps ?? 0) & dashBit).toBe(dashBit);
  });

  it('set_name: renames a measurement object', async () => {
    const b = await boot();
    // PyMOL ref: editing.py set_name(old, new) renames the object; afterwards the
    // old name is gone and the new name resolves. (RED: the port's set_name is a
    // no-op returning 0, so the distance object keeps its original name.)
    await b.call('distance', ['d', A('N'), A('CA')]);
    await b.call('set_name', ['d', 'dd']);

    const names = (await b.call('get_names', ['objects'])) as string[];
    expect(names).toContain('dd');
    expect(names).not.toContain('d');
  });
});
