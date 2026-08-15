import { describe, expect, it } from 'vitest';

import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerMovie2 } from '../src/cmd/movie2';
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

/**
 * A two-atom, two-state object. State 1 puts the atoms at x = 0 and 10; state 2
 * shifts them to x = 4 and 20. The morph midpoint is therefore x = 2 and 15.
 */
function twoStatePdb(): string {
  return [
    'MODEL        1',
    atomLine(1, 'N', 'ALA', 'A', 1, 0, 0, 0, 'N'),
    atomLine(2, 'CA', 'ALA', 'A', 1, 10, 0, 0, 'C'),
    'ENDMDL',
    'MODEL        2',
    atomLine(1, 'N', 'ALA', 'A', 1, 4, 2, 6, 'N'),
    atomLine(2, 'CA', 'ALA', 'A', 1, 20, 8, 4, 'C'),
    'ENDMDL',
  ].join('\n');
}

/* ------------------------------ harness -------------------------------- */

function harness(pdb: string): {
  handlers: Map<string, CommandHandler>;
  ex: Executive;
} {
  const ex = new Executive();
  ex.addMolecule(parsePdb(pdb, 'm'));
  const handlers = new Map<string, CommandHandler>();
  const ctx = {
    command: (n: string, f: CommandHandler) => handlers.set(n, f),
    executive: ex,
    publish() {},
    emitView() {},
    str: (v: unknown, d = '') => (v == null ? d : String(v)),
  };
  registerMovie2(ctx);
  return { handlers, ex };
}

/** A view whose rotation is `deg` degrees about +Z, positioned at `pos`. */
function zRotView(deg: number, pos: [number, number, number]): number[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Column-major Rz: [c, s, 0, -s, c, 0, 0, 0, 1].
  return [
    c, s, 0,
    -s, c, 0,
    0, 0, 1,
    pos[0], pos[1], pos[2],
    0, 0, 0,
    30, 50,
    -20,
  ];
}

/** Dot product of two 3-vectors. */
function dot3(a: number[], off: number): number {
  return a[off]! * a[off]! + a[off + 1]! * a[off + 1]! + a[off + 2]! * a[off + 2]!;
}

describe('mview / get_movie_view', () => {
  it('interpolates halfway between two keyframes (position linear, rotation SLERP)', () => {
    const { handlers, ex } = harness(twoStatePdb());
    const mview = handlers.get('mview')!;
    const getView = handlers.get('get_movie_view')!;

    // Keyframe 1: 0deg about Z at origin. Keyframe 30: 90deg about Z at (30,0,-90).
    ex.view.set(zRotView(0, [0, 0, -40]));
    mview(['store', 1], {});
    ex.view.set(zRotView(90, [30, 60, -90]));
    mview(['store', 30], {});
    mview(['interpolate'], {});

    const mid = getView([15], {}) as number[];
    expect(mid).toHaveLength(18);

    // The raw frame fraction (15-1)/(30-1) = 14/29 is eased through PyMOL's
    // default movie curve (power=1.4, parabolic) before being applied to every
    // channel — real PyMOL does NOT lerp straight between key frames
    // (ViewElemInterpolate, layer1/View.cpp). Both position AND rotation ride
    // the SAME eased fraction.
    const raw = (15 - 1) / (30 - 1);
    // power=1.4, parabolic, bias=1: raw < 0.5 -> pow(raw*2, 1.4)*0.5
    const t = Math.pow(raw * 2, 1.4) * 0.5;
    // Position channel (indices 9-11) is linear in the eased fraction.
    expect(mid[9]!).toBeCloseTo(0 + (30 - 0) * t, 5);
    expect(mid[10]!).toBeCloseTo(0 + (60 - 0) * t, 5);
    expect(mid[11]!).toBeCloseTo(-40 + (-90 - -40) * t, 5);

    // Rotation SLERP of 0deg -> 90deg about Z lands at t*90 degrees about Z.
    const ang = t * 90 * (Math.PI / 180);
    expect(mid[0]!).toBeCloseTo(Math.cos(ang), 5);
    expect(mid[1]!).toBeCloseTo(Math.sin(ang), 5);
    expect(mid[3]!).toBeCloseTo(-Math.sin(ang), 5);
    expect(mid[4]!).toBeCloseTo(Math.cos(ang), 5);

    // The interpolated rotation stays orthonormal: columns are unit length.
    expect(dot3(mid, 0)).toBeCloseTo(1, 6);
    expect(dot3(mid, 3)).toBeCloseTo(1, 6);
    expect(dot3(mid, 6)).toBeCloseTo(1, 6);
    // Columns 0 and 1 are orthogonal.
    const c01 = mid[0]! * mid[3]! + mid[1]! * mid[4]! + mid[2]! * mid[5]!;
    expect(c01).toBeCloseTo(0, 6);
  });

  it('returns the endpoint keyframes exactly and clamps outside the range', () => {
    const { handlers, ex } = harness(twoStatePdb());
    const mview = handlers.get('mview')!;
    const getView = handlers.get('get_movie_view')!;

    const v1 = zRotView(0, [1, 2, 3]);
    const v30 = zRotView(90, [7, 8, 9]);
    ex.view.set(v1);
    mview(['store', 1], {});
    ex.view.set(v30);
    mview(['store', 30], {});

    expect((getView([1], {}) as number[])[9]).toBeCloseTo(1, 6);
    expect((getView([30], {}) as number[])[9]).toBeCloseTo(7, 6);
    // Clamp below the first and above the last keyframe.
    expect((getView([-5], {}) as number[])[9]).toBeCloseTo(1, 6);
    expect((getView([100], {}) as number[])[9]).toBeCloseTo(7, 6);
  });

  it('clear removes a keyframe and reset drops all', () => {
    const { handlers, ex } = harness(twoStatePdb());
    const mview = handlers.get('mview')!;
    const getView = handlers.get('get_movie_view')!;

    ex.view.set(zRotView(0, [5, 0, 0]));
    mview(['store', 1], {});
    ex.view.set(zRotView(0, [9, 0, 0]));
    mview(['store', 30], {});
    mview(['clear', 30], {});
    // With frame 30 gone, everything clamps to the frame-1 keyframe.
    expect((getView([15], {}) as number[])[9]).toBeCloseTo(5, 6);

    mview(['reset'], {});
    // No keyframes: get_movie_view returns the current camera view.
    ex.view.set(zRotView(0, [42, 0, 0]));
    expect((getView([15], {}) as number[])[9]).toBeCloseTo(42, 6);
  });
});

describe('morph', () => {
  it('builds an N-state object whose middle state is the endpoint midpoint', () => {
    const { handlers, ex } = harness(twoStatePdb());
    const morph = handlers.get('morph')!;

    // 5 states over the two source states: middle (state 3, t=0.5) is the midpoint.
    const frames = morph(['morphed', 'm'], { steps: 5 });
    expect(frames).toBe(5);

    const out = ex.molecule('morphed')!;
    expect(out.nstate).toBe(5);
    expect(out.natom).toBe(2);

    // State 1 == source state 1.
    expect(out.coord(0, 1)).toEqual([0, 0, 0]);
    expect(out.coord(1, 1)).toEqual([10, 0, 0]);
    // State 5 == source state 2.
    expect(out.coord(0, 5)[0]).toBeCloseTo(4, 5);
    expect(out.coord(1, 5)[0]).toBeCloseTo(20, 5);
    // State 3 (t=0.5) == coordinate midpoint of the two endpoints.
    const midA = out.coord(0, 3);
    const midB = out.coord(1, 3);
    expect(midA[0]).toBeCloseTo(2, 5);
    expect(midA[1]).toBeCloseTo(1, 5);
    expect(midA[2]).toBeCloseTo(3, 5);
    expect(midB[0]).toBeCloseTo(15, 5);
    expect(midB[1]).toBeCloseTo(4, 5);
    expect(midB[2]).toBeCloseTo(2, 5);
  });

  it('returns null for an unknown source object', () => {
    const { handlers } = harness(twoStatePdb());
    const morph = handlers.get('morph')!;
    expect(morph(['x', 'nope'], {})).toBeNull();
  });
});

describe('rock / get_rock_angle', () => {
  it('toggles the rocking flag and yields a sinusoidal angle', () => {
    const { handlers } = harness(twoStatePdb());
    const rock = handlers.get('rock')!;
    const angle = handlers.get('get_rock_angle')!;

    // Disabled by default: zero at every frame.
    expect(angle([0], {})).toBe(0);
    expect(angle([15], {})).toBe(0);

    // Toggle on (mode -1 default).
    expect(rock([], {})).toBe(1);
    // Frame 0 -> sin(0) = 0.
    expect(angle([0], {}) as number).toBeCloseTo(0, 6);
    // Quarter period (15 of 60 frames) -> peak amplitude 15 deg.
    expect(angle([15], {}) as number).toBeCloseTo(15, 6);
    // The angle is bounded by the amplitude.
    for (let f = 0; f < 60; f++) {
      expect(Math.abs(angle([f], {}) as number)).toBeLessThanOrEqual(15 + 1e-9);
    }

    // Toggle off again.
    expect(rock([], {})).toBe(0);
    expect(angle([15], {})).toBe(0);
  });
});

describe('mmatrix / curves / file-io stubs', () => {
  it('stores and interpolates an object matrix', () => {
    const { handlers } = harness(twoStatePdb());
    const mmatrix = handlers.get('mmatrix')!;
    const getMat = handlers.get('get_movie_matrix')!;

    // No keyframes: identity.
    expect(getMat([0], {})).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    const m1 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const m2 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
    mmatrix(['store', 0, m1], {});
    mmatrix(['store', 10, m2], {});
    const mid = getMat([5], {}) as number[];
    // Translation column interpolates halfway.
    expect(mid[12]).toBeCloseTo(5, 6);
    expect(mid[13]).toBeCloseTo(10, 6);
    expect(mid[14]).toBeCloseTo(15, 6);
  });

  it('curve_new + move_on_curve set the object TTT to the curve position', () => {
    const { handlers, ex } = harness(twoStatePdb());
    const curveNew = handlers.get('curve_new')!;
    const moveOn = handlers.get('move_on_curve')!;

    curveNew(['c'], {});
    // The default bezier spline evaluated at t=0.5 is (5, 0, -7.5) — verified
    // against real PyMOL (cmd.move_on_curve then cmd.get_object_ttt). move_on_curve
    // writes that into the mobile object's TTT translation (indices 3/7/11) and
    // returns null (ExecutiveMoveObjectOnCurve).
    expect(moveOn(['m', 'c', 0.5], {})).toBeNull();
    const ttt = ex.molecule('m')!.ttt!;
    expect(ttt[3]).toBeCloseTo(5, 6);
    expect(ttt[7]).toBeCloseTo(0, 6);
    expect(ttt[11]).toBeCloseTo(-7.5, 6);
    // Unknown curve or unknown object -> null, no TTT change.
    expect(moveOn(['m', 'missing', 0.5], {})).toBeNull();
    expect(moveOn(['nope', 'c', 0.5], {})).toBeNull();
  });

  it('mpng / mdump are no-ops', () => {
    const { handlers } = harness(twoStatePdb());
    expect(handlers.get('mpng')!([], {})).toBeNull();
    expect(handlers.get('mdump')!([], {})).toBeNull();
  });
});
