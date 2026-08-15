import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerTransforms } from '../src/cmd/transforms';
import type { CommandHandler } from '../src/cmd/registrar';

/* --------------------------- test PDB builder --------------------------- */

/** Format one ATOM record into the exact PDB fixed columns. */
function atomLine(
  serial: number,
  name: string,
  resn: string,
  chain: string,
  resi: number,
  x: number,
  y: number,
  z: number,
  elem: string,
): string {
  const buf = ' '.repeat(80).split('');
  const put = (start: number, s: string): void => {
    for (let i = 0; i < s.length; i++) buf[start - 1 + i] = s[i]!;
  };
  put(1, 'ATOM');
  put(7, serial.toString().padStart(5));
  // Atom names <4 chars begin in column 14.
  put(name.length >= 4 ? 13 : 14, name);
  put(18, resn.padStart(3));
  put(22, chain);
  put(23, resi.toString().padStart(4));
  put(31, x.toFixed(3).padStart(8));
  put(39, y.toFixed(3).padStart(8));
  put(47, z.toFixed(3).padStart(8));
  put(55, '1.00');
  put(61, '0.00');
  put(77, elem.padStart(2));
  return buf.join('').replace(/\s+$/, '');
}

// Three atoms whose bounding box is [0,0,0]..[2,4,6] => bbox centre (1,2,3).
const PDB = [
  atomLine(1, 'N', 'ALA', 'A', 1, 0, 0, 0, 'N'),
  atomLine(2, 'CA', 'ALA', 'A', 1, 2, 4, 6, 'C'),
  atomLine(3, 'C', 'ALA', 'A', 1, 1, 2, 3, 'C'),
].join('\n');

/* ------------------------------ harness -------------------------------- */

const IDENTITY_VIEW = [
  1, 0, 0, //
  0, 1, 0, //
  0, 0, 1, //
  0, 0, -40, // camera-space origin (Pos)
  0, 0, 0, // model-space origin (Origin)
  20, // front
  60, // back
  -20, // signed fov
];

function setup() {
  const ex = new Executive();
  ex.addMolecule(parsePdb(PDB, 'm'));
  const handlers = new Map<string, CommandHandler>();
  let views = 0;
  let publishes = 0;
  const ctx = {
    command: (n: string, f: CommandHandler) => handlers.set(n, f),
    executive: ex,
    publish() {
      publishes++;
    },
    emitView() {
      views++;
    },
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerTransforms(ctx);
  ex.view.set(IDENTITY_VIEW);
  return {
    ex,
    call: (name: string, args: unknown[], kw: Record<string, unknown> = {}) =>
      handlers.get(name)!(args, kw),
    view: () => ex.view.get(),
    counts: () => ({ views, publishes }),
  };
}

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

/* PDB coords are stored float32; assert the bbox centre to float32 tolerance. */
function expectVec(v: number[], slice: number, exp: [number, number, number], eps = 1e-5) {
  close(v[slice]!, exp[0], eps);
  close(v[slice + 1]!, exp[1], eps);
  close(v[slice + 2]!, exp[2], eps);
}

/* -------------------------------- tests -------------------------------- */

// `rotate`/`translate` are OBJECT transforms in PyMOL: they move the atoms'
// coordinates about the origin and leave the camera (get_view) untouched. Under
// the identity view a camera-space axis IS the model-space axis, so the results
// are hand-derivable. (Validated against real PyMOL by the live differential.)
const coord = (t: ReturnType<typeof setup>, i: number): [number, number, number] =>
  t.ex.molecule('m')!.coord(i, 1);
const expectCoord = (t: ReturnType<typeof setup>, i: number, e: [number, number, number]) => {
  const c = coord(t, i);
  close(c[0], e[0], 1e-4);
  close(c[1], e[1], 1e-4);
  close(c[2], e[2], 1e-4);
};

describe('rotate (object)', () => {
  it('rotate("y", 90) rotates coords about the origin; the camera is unchanged', () => {
    const t = setup();
    t.call('rotate', ['y', 90]);
    // N sits on the origin (0,0,0) and does not move; CA (2,4,6) -> (6,4,-2).
    expectCoord(t, 0, [0, 0, 0]);
    expectCoord(t, 1, [6, 4, -2]);
    expectCoord(t, 2, [3, 2, -1]);
    // The view is untouched (rotate moves the object, not the camera).
    const v = t.view();
    for (let i = 0; i < 9; i++) close(v[i]!, IDENTITY_VIEW[i]!);
    expectVec(v, 9, [0, 0, -40]);
    expect(t.counts().publishes).toBe(1);
  });

  it('an arbitrary [0,1,0] axis equals the "y" shorthand', () => {
    const a = setup();
    const b = setup();
    a.call('rotate', ['y', 37]);
    b.call('rotate', [[0, 1, 0], 37]);
    for (let i = 0; i < 3; i++) {
      const ca = coord(a, i);
      const cb = coord(b, i);
      for (let k = 0; k < 3; k++) close(ca[k]!, cb[k]!, 1e-5);
    }
  });

  it('rotate 360 about any axis returns coords to the original', () => {
    for (const axis of ['x', 'y', 'z']) {
      const t = setup();
      t.call('rotate', [axis, 360]);
      expectCoord(t, 1, [2, 4, 6]);
    }
  });

  it('four 90-degree rotations compose back to the original coords', () => {
    const t = setup();
    for (let i = 0; i < 4; i++) t.call('rotate', ['x', 90]);
    expectCoord(t, 1, [2, 4, 6]);
  });

  it('a rotation is rigid: distance from the origin is preserved', () => {
    const t = setup();
    const before = coord(t, 1); // CA (2,4,6)
    const r0 = Math.hypot(before[0], before[1], before[2]);
    t.call('rotate', [[1, 1, 1], 120]);
    const after = coord(t, 1);
    close(Math.hypot(after[0], after[1], after[2]), r0, 1e-4);
    // The camera stays put.
    const v = t.view();
    for (let i = 0; i < 9; i++) close(v[i]!, IDENTITY_VIEW[i]!);
  });
});

describe('move (camera translate)', () => {
  it('move("z", d) shifts Pos.z and both clip planes', () => {
    const t = setup();
    t.call('move', ['z', 5]);
    const v = t.view();
    close(v[11]!, -35); // -40 + 5
    close(v[15]!, 15); // 20 - 5
    close(v[16]!, 55); // 60 - 5
    expect(t.counts().views).toBe(1);
  });

  it('move("x") and move("y") shift Pos.x / Pos.y only', () => {
    const t = setup();
    t.call('move', ['x', 3]);
    t.call('move', ['y', -2]);
    const v = t.view();
    close(v[9]!, 3);
    close(v[10]!, -2);
    close(v[11]!, -40); // unchanged
  });
});

describe('translate', () => {
  it('shifts the object coordinates; the camera is unchanged', () => {
    const t = setup();
    t.call('translate', [[1, 2, 3]]); // identity view => model vector == [1,2,3]
    // Every atom moved by (1,2,3).
    expectCoord(t, 0, [1, 2, 3]); // N: (0,0,0) -> (1,2,3)
    expectCoord(t, 1, [3, 6, 9]); // CA: (2,4,6) -> (3,6,9)
    // The camera (Pos and clip planes) is untouched.
    const v = t.view();
    expectVec(v, 9, [0, 0, -40]);
    close(v[15]!, 20);
    close(v[16]!, 60);
    expect(t.counts().publishes).toBe(1);
  });

  it('camera=0 treats the vector as model-space', () => {
    const t = setup();
    t.call('translate', [[10, 0, 0]], { camera: 0 });
    // N atom moved from x=0 to x=10.
    expect(t.ex.molecule('m')!.coord(0, 1)[0]).toBeCloseTo(10, 5);
    expect(t.counts().publishes).toBe(1);
  });
});

describe('center / origin', () => {
  it('center sets the model-space origin to the selection centroid', () => {
    const t = setup();
    t.call('center', ['all']);
    const v = t.view();
    expectVec(v, 12, [1, 2, 3]); // bbox centre of the fixture
    close(v[9]!, 0); // recentred on screen
    close(v[10]!, 0);
    expect(t.counts().views).toBe(1);
  });

  it('center on a subselection uses that atom range', () => {
    const t = setup();
    t.call('center', ['name N']); // single atom at origin
    expectVec(t.view(), 12, [0, 0, 0]);
  });

  it('origin sets the pivot and compensates Pos to preserve the view', () => {
    const t = setup();
    t.call('origin', ['all']);
    const v = t.view();
    expectVec(v, 12, [1, 2, 3]);
    // identity rotation => camDelta == delta == centroid; SceneOriginSet
    // (preserve=1) does Pos += R*(origin-oldOrigin), so Pos += centroid.
    // Verified against real PyMOL (origin position=... shifts Pos by +delta).
    expectVec(v, 9, [1, 2, -37]);
  });
});

describe('clip', () => {
  it('near moves the front plane only', () => {
    const t = setup();
    t.call('clip', ['near', 4]);
    const v = t.view();
    close(v[15]!, 16); // 20 - 4
    close(v[16]!, 60);
  });

  it('far moves the back plane only', () => {
    const t = setup();
    t.call('clip', ['far', 5]);
    const v = t.view();
    close(v[15]!, 20);
    close(v[16]!, 55); // 60 - 5
  });

  it('move shifts both planes together', () => {
    const t = setup();
    t.call('clip', ['move', 3]);
    const v = t.view();
    close(v[15]!, 17);
    close(v[16]!, 57);
  });

  it('slab sets a symmetric slab about the current midpoint', () => {
    const t = setup();
    t.call('clip', ['slab', 10]);
    const v = t.view();
    // midpoint (20+60)/2 = 40 => [35, 45]
    close(v[15]!, 35);
    close(v[16]!, 45);
  });
});
