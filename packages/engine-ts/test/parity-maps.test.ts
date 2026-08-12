/**
 * RED parity tests — maps / isosurface geometry (marching-cubes objects), NOT
 * volume raymarch rendering.
 *
 * Each test pins what REAL PyMOL does when a map / ramp / isosurface object is
 * created in-engine, and FAILS against the current TS port. The port stores
 * maps, ramps and iso objects in command-local `Map`s (see
 * `src/cmd/maps.ts`, `src/cmd/ramps.ts`) but never registers them with the
 * executive, so they do not appear in `get_names`, and `get_type` is a stub
 * that always answers `'object:molecule'` (see `src/engine.ts` ~line 633).
 * Real PyMOL registers each of these as a first-class object in `CExecutive`.
 */
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

async function boot() {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [SMALL_PDB, 'm']);
  return b;
}

describe('parity: maps / isosurface geometry', () => {
  it("map_new: registers an object of type 'object:map' visible in get_names", async () => {
    const b = await boot();
    // PyMOL ref: creating.py:291 `map_new(name, type='gaussian', ...)` calls
    // `_cmd.map_new`, which creates a named ObjectMap in CExecutive. querying.py:1206
    // `get_type` returns "object:map" for a map object (docstring lines 1221-1225),
    // and get_names lists it among the objects.
    await b.call('map_new', ['gmap', 'gaussian', 0.5, 'all']);
    const names = (await b.call('get_names', ['objects'])) as string[];
    const type = (await b.call('get_type', ['gmap'])) as string;
    expect(names).toContain('gmap'); // RED today: map not registered as object
    expect(type).toBe('object:map'); // RED today: get_type stub returns object:molecule
  });

  it("ramp_new: registers a color-ramp gadget of type 'object:ramp' in get_names", async () => {
    const b = await boot();
    // PyMOL ref: creating.py:374 `ramp_new(name, map_name, range, color, ...)`
    // creates an ObjectGadgetRamp registered in CExecutive. get_type -> "object:ramp"
    // (menu.py:36 `n for n in names if cmd.get_type(n) == 'object:ramp'`;
    // completing.py:81 get_names_of_type('object:ramp')).
    await b.call('map_new', ['pmap', 'gaussian', 0.5, 'all']);
    await b.call('ramp_new', ['ramp1', 'pmap', [-1.0, 0.0, 1.0], ['red', 'white', 'blue']]);
    const names = (await b.call('get_names', ['objects'])) as string[];
    const type = (await b.call('get_type', ['ramp1'])) as string;
    expect(names).toContain('ramp1'); // RED today: ramp kept in module-local map only
    expect(type).toBe('object:ramp'); // RED today: get_type stub returns object:molecule
  });

  it('isosurface: creates a named surface object in get_names with non-empty geometry', async () => {
    const b = await boot();
    // PyMOL ref: creating.py:719 `isosurface(name, map, level=1.0, ...)` calls
    // `_cmd.isosurface`, creating an ObjectSurface registered in CExecutive
    // (get_type -> "object:surface", querying.py:1224). The marching-cubes pass at
    // the contour level yields triangle vertices, so the object has >0 vertices.
    await b.call('map_new', ['dmap', 'gaussian', 0.4, 'all']);
    await b.call('isosurface', ['surf', 'dmap', 0.5]);
    const names = (await b.call('get_names', ['objects'])) as string[];
    const stats = (await b.call('get_isosurface_stats', ['surf'])) as { verts: number };
    expect(names).toContain('surf'); // RED today: iso object not in executive get_names
    expect(stats.verts).toBeGreaterThan(0);
  });

  it('isomesh: creates a named mesh object in get_names with non-empty geometry', async () => {
    const b = await boot();
    // PyMOL ref: creating.py:514 `isomesh(name, map, level=1.0, ...)` calls
    // `_cmd.isomesh`, creating an ObjectMesh registered in CExecutive
    // (get_type -> "object:mesh", querying.py:1223). Marching cubes at the level
    // produces mesh line/triangle vertices, so vertex count > 0.
    await b.call('map_new', ['mmap', 'gaussian', 0.4, 'all']);
    await b.call('isomesh', ['mesh1', 'mmap', 0.5]);
    const names = (await b.call('get_names', ['objects'])) as string[];
    const type = (await b.call('get_type', ['mesh1'])) as string;
    const stats = (await b.call('get_isosurface_stats', ['mesh1'])) as { verts: number };
    expect(names).toContain('mesh1'); // RED today: mesh object not in executive get_names
    expect(type).toBe('object:mesh'); // RED today: get_type stub returns object:molecule
    expect(stats.verts).toBeGreaterThan(0);
  });

  it('set_name renames a map gadget cleanly (old name gone, new name resolves)', async () => {
    // Regression for the Executive.rename() gadget bug: renaming a gadget must
    // move it in `order` AND the gadgets registry, so both get_names and get_type
    // follow the new name and the old name fully disappears.
    const b = await boot();
    await b.call('map_new', ['gmap', 'gaussian', 0.5, 'all']);
    expect(await b.call('set_name', ['gmap', 'gmap2'])).toBe(1);
    const names = (await b.call('get_names', ['objects'])) as string[];
    expect(names).toContain('gmap2');
    expect(names).not.toContain('gmap');
    expect(await b.call('get_type', ['gmap2'])).toBe('object:map');
  });

  it("gradient: creates a gradient mesh object of type 'object:mesh' in get_names", async () => {
    const b = await boot();
    // PyMOL ref: creating.py:843 `gradient(name, map, ...)` internally calls
    // `_cmd.isomesh(..., mode=3, ...)` (creating.py:875) building an ObjectMesh
    // gradient registered in CExecutive -> get_type "object:mesh" and listed in
    // get_names.
    await b.call('map_new', ['gradmap', 'gaussian', 0.4, 'all']);
    await b.call('gradient', ['grad1', 'gradmap']);
    const names = (await b.call('get_names', ['objects'])) as string[];
    const type = (await b.call('get_type', ['grad1'])) as string;
    expect(names).toContain('grad1'); // RED today: gradient kept in module-local ramp store
    expect(type).toBe('object:mesh'); // RED today: get_type stub returns object:molecule
  });
});
