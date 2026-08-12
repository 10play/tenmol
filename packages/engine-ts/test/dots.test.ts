import { describe, it, expect } from 'vitest';
import {
  Rep,
  INSTANCE_ITEM_SIZE,
  decodeGeometryFrame,
  geometryFrameProblems,
  isCgoDrawArraysHeader,
  viewOf,
  type CgoDrawArraysHeader,
} from '@tenmol/protocol';
import { parsePdb } from '../src/model/pdb';
import { repBit } from '../src/model/atom';
import { buildDotsFrame, dotsForDensity } from '../src/geometry/dots';

// ---------------------------------------------------------------------------
// Minimal PDB emitter: place a few atoms at chosen coordinates & elements.
// ---------------------------------------------------------------------------

function put(cols: string[], start1: number, s: string): void {
  for (let i = 0; i < s.length; i++) cols[start1 - 1 + i] = s[i]!;
}

function atomLine(o: {
  serial: number;
  name: string;
  x: number;
  y: number;
  z: number;
  elem: string;
}): string {
  const cols = new Array<string>(80).fill(' ');
  put(cols, 1, 'ATOM  ');
  put(cols, 7, String(o.serial).padStart(5));
  put(cols, 13, o.name.padEnd(3));
  put(cols, 18, 'ALA');
  put(cols, 22, 'A');
  put(cols, 23, String(o.serial).padStart(4));
  put(cols, 31, o.x.toFixed(3).padStart(8));
  put(cols, 39, o.y.toFixed(3).padStart(8));
  put(cols, 47, o.z.toFixed(3).padStart(8));
  put(cols, 77, o.elem.padStart(2));
  return cols.join('');
}

function pdbFromAtoms(
  atoms: Array<{ x: number; y: number; z: number; elem: string }>,
): string {
  const lines = atoms.map((a, i) =>
    atomLine({ serial: i + 1, name: a.elem, x: a.x, y: a.y, z: a.z, elem: a.elem }),
  );
  lines.push('END');
  return lines.join('\n');
}

function ctx(
  mol: ReturnType<typeof parsePdb>,
  settings: Record<string, number> = {},
) {
  return {
    mol,
    state: 1,
    seq: 11,
    getSettingFloat: (name: string) => settings[name] ?? 0,
  };
}

/** Flip the dots rep bit on for every atom. */
function enableDots(mol: ReturnType<typeof parsePdb>): void {
  for (const a of mol.atoms) a.visRep |= repBit(Rep.Dot);
}

/** Decode a dots frame and hand back its cgo-draw-arrays header + sphere buffers. */
function decode(buf: ArrayBuffer) {
  const frame = decodeGeometryFrame(buf);
  expect(isCgoDrawArraysHeader(frame.header)).toBe(true);
  const h = frame.header as CgoDrawArraysHeader;
  const inst = h.instances[0]!;
  const data = viewOf(frame, inst.data) as Float32Array;
  const atom = viewOf(frame, inst.atom!) as Int32Array;
  return { frame, h, inst, data, atom };
}

describe('buildDotsFrame', () => {
  it('returns null when no atom carries the dots rep bit', () => {
    const mol = parsePdb(pdbFromAtoms([{ x: 0, y: 0, z: 0, elem: 'C' }]), 'm');
    expect(buildDotsFrame(ctx(mol))).toBeNull();
  });

  it('samples the full sphere for an isolated atom (no burial)', () => {
    const mol = parsePdb(pdbFromAtoms([{ x: 0, y: 0, z: 0, elem: 'C' }]), 'm');
    enableDots(mol);

    // Default dot_density is 2 -> 162 dots. Nothing to bury, so all survive.
    const N = dotsForDensity(2);
    expect(N).toBe(162);

    const buf = buildDotsFrame(ctx(mol))!;
    expect(buf).not.toBeNull();
    const { h, inst, data, atom } = decode(buf);

    expect(h.rep).toBe(Rep.Dot);
    expect(h.object).toBe('m');
    expect(h.seq).toBe(11);
    expect(geometryFrameProblems(h)).toEqual([]);

    expect(inst.kind).toBe('sphere');
    expect(inst.count).toBe(N);
    expect(inst.itemSize).toBe(INSTANCE_ITEM_SIZE.sphere);
    expect(atom.length).toBe(N);

    // vdw(C) = 1.7, dot_solvent off -> every dot sits at radius 1.7 from centre,
    // every instance radius is 0, colour is opaque carbon, atom id is 1.
    const R = 1.7;
    for (let k = 0; k < inst.count; k++) {
      const o = k * INSTANCE_ITEM_SIZE.sphere;
      const dist = Math.hypot(data[o]!, data[o + 1]!, data[o + 2]!);
      expect(dist).toBeCloseTo(R, 4);
      expect(data[o + 3]).toBe(0); // radius-0 => point cloud
      expect(data[o + 7]).toBe(1); // opaque
      expect(atom[k]).toBe(1);
    }
  });

  it('culls buried dots between two overlapping atoms', () => {
    // Two carbons 2.0 Å apart: vdw 1.7 each, so their spheres interpenetrate
    // (2.0 < 1.7 + 1.7). Dots in the overlap lens are buried and removed.
    const mol = parsePdb(
      pdbFromAtoms([
        { x: 0, y: 0, z: 0, elem: 'C' },
        { x: 2, y: 0, z: 0, elem: 'C' },
      ]),
      'm',
    );
    enableDots(mol);

    const N = dotsForDensity(2);
    const buf = buildDotsFrame(ctx(mol))!;
    const { h, inst, data, atom } = decode(buf);

    expect(geometryFrameProblems(h)).toEqual([]);

    // Buried dots gone: strictly fewer than the full 2*N, but plenty survive.
    expect(inst.count).toBeGreaterThan(0);
    expect(inst.count).toBeLessThan(2 * N);

    // Both atoms contribute exposed dots.
    const ids = new Set<number>();
    const R = 1.7;
    const centres: Record<number, [number, number, number]> = {
      1: [0, 0, 0],
      2: [2, 0, 0],
    };
    for (let k = 0; k < inst.count; k++) {
      const o = k * INSTANCE_ITEM_SIZE.sphere;
      const px = data[o]!;
      const py = data[o + 1]!;
      const pz = data[o + 2]!;
      const id = atom[k]!;
      ids.add(id);

      expect(data[o + 3]).toBe(0); // still all radius 0

      // On its own atom's surface...
      const own = centres[id]!;
      expect(Math.hypot(px - own[0], py - own[1], pz - own[2])).toBeCloseTo(R, 4);

      // ...and NOT inside the other atom's sphere (that's the survivor invariant).
      const otherId = id === 1 ? 2 : 1;
      const oth = centres[otherId]!;
      const d = Math.hypot(px - oth[0], py - oth[1], pz - oth[2]);
      expect(d).toBeGreaterThan(R - 1e-3);
    }
    expect(ids).toEqual(new Set([1, 2]));

    // The overlap is (near-)symmetric: each atom loses about the same count.
    // The Fibonacci point set isn't centrally symmetric, so allow a 1-dot skew.
    let c1 = 0;
    let c2 = 0;
    for (let k = 0; k < inst.count; k++) {
      if (atom[k] === 1) c1++;
      else c2++;
    }
    expect(Math.abs(c1 - c2)).toBeLessThanOrEqual(2);
    expect(c1).toBeLessThan(N); // some were buried
    expect(c2).toBeLessThan(N);
  });

  it('dot_solvent expands each sphere by solvent_radius', () => {
    const mol = parsePdb(pdbFromAtoms([{ x: 0, y: 0, z: 0, elem: 'C' }]), 'm');
    enableDots(mol);

    const buf = buildDotsFrame(
      ctx(mol, { dot_solvent: 1, solvent_radius: 1.4 }),
    )!;
    const { inst, data } = decode(buf);

    // Isolated atom, solvent-accessible surface: radius = vdw(1.7) + probe(1.4).
    const R = 1.7 + 1.4;
    for (let k = 0; k < inst.count; k++) {
      const o = k * INSTANCE_ITEM_SIZE.sphere;
      expect(Math.hypot(data[o]!, data[o + 1]!, data[o + 2]!)).toBeCloseTo(R, 4);
    }
  });

  it('dot_density controls the sample count', () => {
    const mol = parsePdb(pdbFromAtoms([{ x: 0, y: 0, z: 0, elem: 'C' }]), 'm');
    enableDots(mol);

    // dot_density 1 -> 42 dots, 4 -> 2562 (PyMOL's icosahedral Sphere_nDot). (0 is
    // the codebase's "unset" sentinel, which falls through to the PyMOL default of
    // 2 via the `|| 2` idiom.)
    const sparse = decode(buildDotsFrame(ctx(mol, { dot_density: 1 }))!);
    const dense = decode(buildDotsFrame(ctx(mol, { dot_density: 4 }))!);

    expect(sparse.inst.count).toBe(dotsForDensity(1)); // 42
    expect(dense.inst.count).toBe(dotsForDensity(4)); // 2562
    expect(dense.inst.count).toBeGreaterThan(sparse.inst.count);
  });
});
