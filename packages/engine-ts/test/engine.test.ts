import { describe, expect, it } from 'vitest';
import {
  isCgoDrawArraysHeader,
  geometryFrameProblems,
  viewOf,
  INSTANCE_ITEM_SIZE,
  Rep,
  type BinaryFrame,
} from '@tenmol/protocol';
import { PymolError } from '@tenmol/backend';
import { Executive, LocalBackend, parsePdb, selectAtoms, getColorIndex } from '@tenmol/engine-ts';
import { SMALL_PDB, EXPECTED, FIXTURE_ATOMS } from './fixture';

function loaded(): Executive {
  const ex = new Executive();
  ex.addMolecule(parsePdb(SMALL_PDB, 'm'));
  return ex;
}

describe('PDB reader', () => {
  it('parses every atom with float32 coordinates', () => {
    const mol = parsePdb(SMALL_PDB, 'm');
    expect(mol.natom).toBe(EXPECTED.total);
    expect(mol.states.length).toBe(1);
    expect(mol.states[0]).toBeInstanceOf(Float32Array);
    // Coordinates match the fixture to float32 precision.
    const [x, y, z] = mol.coord(1, 1); // atom 2 (CA), 0-based index 1
    expect(x).toBeCloseTo(1.458, 3);
    expect(y).toBeCloseTo(0, 3);
    expect(z).toBeCloseTo(0, 3);
  });

  it('assigns names, elements, chains and residues', () => {
    const mol = parsePdb(SMALL_PDB, 'm');
    expect(mol.atoms[0]!.name).toBe('N');
    expect(mol.atoms[1]!.name).toBe('CA');
    expect(mol.atoms[1]!.elem).toBe('C');
    expect(mol.atoms[0]!.chain).toBe('A');
    expect(mol.atoms[5]!.chain).toBe('B');
    expect(mol.atoms[0]!.resn).toBe('ALA');
    expect(mol.atoms[5]!.resn).toBe('GLY');
    expect(mol.atoms[0]!.id).toBe(1);
  });
});

describe('selection algebra', () => {
  const ex = loaded();
  const ctx = ex.selectorContext;
  const count = (s: string): number => selectAtoms(s, ctx).length;

  it('matches PyMOL selection semantics for the covered operators', () => {
    expect(count('all')).toBe(EXPECTED.total);
    expect(count('none')).toBe(0);
    expect(count('name CA')).toBe(EXPECTED.ca);
    expect(count('chain A')).toBe(EXPECTED.chainA);
    expect(count('chain B')).toBe(EXPECTED.chainB);
    expect(count('elem C')).toBe(EXPECTED.elemC);
    expect(count('elem N')).toBe(EXPECTED.elemN);
    expect(count('elem O')).toBe(EXPECTED.elemO);
    expect(count('resi 1')).toBe(EXPECTED.resi1);
    expect(count('name CB')).toBe(EXPECTED.cb);
  });

  it('composes and / or / not with correct precedence', () => {
    expect(count('chain A and name CA')).toBe(1);
    expect(count('chain A or chain B')).toBe(EXPECTED.total);
    expect(count('not chain A')).toBe(EXPECTED.chainB);
    expect(count('chain A and not name CA')).toBe(EXPECTED.chainA - 1);
    expect(count('name CA+CB')).toBe(EXPECTED.ca + EXPECTED.cb);
    expect(count('resi 1-2')).toBe(EXPECTED.total);
    expect(count('(chain A or chain B) and elem C')).toBe(EXPECTED.elemC);
  });

  it('resolves a bare object name and named selections', () => {
    expect(count('m')).toBe(EXPECTED.total);
    ex.select('cas', 'name CA');
    expect(count('cas')).toBe(EXPECTED.ca);
    expect(count('cas and chain A')).toBe(1);
  });
});

describe('colour', () => {
  it('resolves names and recolours atoms', () => {
    const ex = loaded();
    expect(getColorIndex('cyan')).toBeGreaterThanOrEqual(0);
    const n = ex.color('cyan', 'chain A');
    expect(n).toBe(EXPECTED.chainA);
    for (const ua of ex.atomsMatching('chain A')) {
      expect(ua.atom.color).toBe(getColorIndex('cyan'));
    }
    // chain B untouched.
    for (const ua of ex.atomsMatching('chain B')) {
      expect(ua.atom.color).not.toBe(getColorIndex('cyan'));
    }
  });
});

describe('representations (visRep)', () => {
  it('show / hide / as toggle the right rep bit per atom', () => {
    const ex = loaded();
    ex.showAs('spheres', 'all');
    for (const ua of ex.atomsMatching('all')) {
      expect(ua.atom.visRep & (1 << Rep.Sphere)).toBeTruthy();
      expect(ua.atom.visRep & (1 << Rep.Line)).toBeFalsy();
    }
    ex.show('lines', 'chain A');
    for (const ua of ex.atomsMatching('chain A')) {
      expect(ua.atom.visRep & (1 << Rep.Line)).toBeTruthy();
    }
    ex.hide('spheres', 'chain A');
    for (const ua of ex.atomsMatching('chain A')) {
      expect(ua.atom.visRep & (1 << Rep.Sphere)).toBeFalsy();
    }
  });
});

describe('camera', () => {
  it('round-trips set_view / get_view exactly', () => {
    const ex = loaded();
    const view = [0.5, 0, 0.866, 0, 1, 0, -0.866, 0, 0.5, 0, 0, -30, 1, 2, 3, 10, 50, -20];
    ex.view.set(view);
    expect(ex.view.get()).toEqual(view);
  });

  it('turn 360 degrees is the identity rotation', () => {
    const ex = loaded();
    ex.view.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -30, 0, 0, 0, 10, 50, -20]);
    ex.view.turn('y', 120);
    ex.view.turn('y', 120);
    ex.view.turn('y', 120);
    const rot = ex.view.get().slice(0, 9);
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let i = 0; i < 9; i++) expect(rot[i]!).toBeCloseTo(identity[i]!, 5);
  });
});

describe('Mode-G geometry frames', () => {
  it('emits a valid, decodable spheres instance frame', async () => {
    const backend = new LocalBackend();
    await backend.connect();
    await backend.call('read_pdbstr', [SMALL_PDB, 'm']);
    const frames: ArrayBuffer[] = [];
    backend.on('binary:frame', () => {
      /* frames arrive via emitter; capture below via geometry:frame */
    });
    const geometry: unknown[] = [];
    backend.on('geometry:frame', (f) => geometry.push(f));
    await backend.call('show_as', ['spheres', 'all']);

    const sphereFrames = (geometry as { header: { rep: number } }[]).filter(
      (f) => f.header.rep === Rep.Sphere,
    );
    expect(sphereFrames.length).toBe(1);
    const frame = sphereFrames[0]! as BinaryFrame;
    expect(isCgoDrawArraysHeader(frame.header)).toBe(true);
    expect(geometryFrameProblems(frame.header as never)).toEqual([]);

    const header = frame.header as never as {
      instances: { kind: string; count: number; data: { byteOffset: number; byteLength: number; dtype: string; itemSize: number } }[];
    };
    const inst = header.instances[0]!;
    expect(inst.kind).toBe('sphere');
    expect(inst.count).toBe(EXPECTED.total);
    expect(inst.itemSize).toBe(INSTANCE_ITEM_SIZE.sphere);
    const data = viewOf(frame as never, inst.data as never) as Float32Array;
    // First instance centre == first atom coordinate.
    expect(data[0]).toBeCloseTo(FIXTURE_ATOMS[0]!.x, 3);
    expect(data[1]).toBeCloseTo(FIXTURE_ATOMS[0]!.y, 3);
    expect(data[2]).toBeCloseTo(FIXTURE_ATOMS[0]!.z, 3);
    void frames;
    void frame;
  });
});

describe('LocalBackend', () => {
  it('connects, emits hello, and answers ported calls', async () => {
    const backend = new LocalBackend();
    const hellos: unknown[] = [];
    backend.on('server:hello', (h) => hellos.push(h));
    await backend.connect();
    expect(backend.isOpen).toBe(true);
    expect(hellos.length).toBe(1);

    await backend.call('read_pdbstr', [SMALL_PDB, 'm']);
    expect(await backend.call('get_names')).toEqual(['m']);
    expect(await backend.call('count_atoms', ['all'])).toBe(EXPECTED.total);
    expect(await backend.call('count_atoms', ['name CA'])).toBe(EXPECTED.ca);
  });

  it('rejects an unported symbol with a NotPorted PymolError', async () => {
    const backend = new LocalBackend();
    await backend.connect();
    await expect(backend.call('ray', [])).rejects.toBeInstanceOf(PymolError);
    await backend.call('ray', []).catch((e: PymolError) => {
      expect(e.type).toBe('NotPorted');
    });
  });

  it('loads a built-in fragment from the console and renders it', async () => {
    const backend = new LocalBackend();
    await backend.connect();
    await backend.do('fragment ala');
    expect(await backend.call('get_names', ['objects'])).toEqual(['ala']);
    expect(await backend.call('count_atoms', ['all'])).toBe(5);
    await backend.do('show spheres');
    expect(await backend.call('count_atoms', ['rep spheres'])).toBe(5);
  });

  it('answers the object-panel endpoint with a real snapshot', async () => {
    const backend = new LocalBackend();
    await backend.connect();
    await backend.do('fragment ala');
    const snap = (await backend.call('tenmol_objects', ['snapshot'])) as {
      rows: Array<{ name: string; isAll: boolean }>;
      ops: string[];
    };
    expect(snap.rows[0]!.isAll).toBe(true); // synthetic 'all' row
    expect(snap.rows.map((r) => r.name)).toContain('ala');
    expect(snap.ops).toEqual(['A', 'S', 'H', 'L', 'C', 'M']);
  });

  it('cmd.view stores/recalls, and an unknown recall lists names (views panel)', async () => {
    const backend = new LocalBackend();
    await backend.connect();
    await backend.call('view', ['front', 'store']);
    await backend.call('view', ['side', 'store']);
    await expect(backend.call('view', ['front', 'recall'])).resolves.toBeNull();
    // The panel provokes the listing with an unknown key; the error carries the
    // sorted names after "Choices:".
    const err = await backend.call('view', ['__probe__', 'recall']).catch((e: unknown) => e);
    expect(String((err as Error).message)).toMatch(/unknown view:.*Choices:[\s\S]*front[\s\S]*side/);
  });

  it('answers benign read symbols instead of NotPorted (clean panels)', async () => {
    const backend = new LocalBackend();
    await backend.connect();
    expect(await backend.call('get_scene_list', [])).toEqual([]);
    expect(await backend.call('get_frame', [])).toBe(1);
    expect(await backend.call('count_frames', [])).toBe(0);
    expect(await backend.call('get_setting_text', ['button_mode_name'])).toBe('3-Button Viewing');
    expect(await backend.call('get_movie_playing', [])).toBe(0);
  });

  it('stays silent for feature/plugin Python bootstrap lines', async () => {
    const backend = new LocalBackend();
    const lines: string[] = [];
    backend.on('feedback', ({ lines: l }) => lines.push(...l));
    await backend.connect();
    // The exact shapes the app's panels send (with and without the `/` escape).
    await backend.do('from tenmol_bridge.panels.objects import install;install()');
    await backend.do('/import tenmol_bridge.panels.settings as _s;_s.install()');
    await backend.do('import tenmol_bridge.panels.properties as _tp; _tp.install()');
    expect(lines).toEqual([]); // silent — no prompt echo, no error flood
  });

  it('gives feedback for a user-typed unrecognised command (never feels dead)', async () => {
    const backend = new LocalBackend();
    const lines: string[] = [];
    backend.on('feedback', ({ lines: l }) => lines.push(...l));
    await backend.connect();
    await backend.do('console.log("YO")');
    expect(lines.some((l) => l.startsWith('PyMOL>console.log'))).toBe(true);
    expect(lines.some((l) => l.includes('not a ported command'))).toBe(true);
  });

  it('echoes a typed command line on the feedback stream', async () => {
    const backend = new LocalBackend();
    const lines: string[] = [];
    backend.on('feedback', ({ lines: l }) => lines.push(...l));
    await backend.connect();
    await backend.call('read_pdbstr', [SMALL_PDB, 'm']);
    await backend.do('color cyan, chain A');
    expect(lines.some((l) => l.startsWith('PyMOL>color cyan'))).toBe(true);
  });
});
