import { describe, it, expect } from 'vitest';
import {
  Rep,
  decodeGeometryFrame,
  geometryFrameProblems,
  isIndexedMeshHeader,
  viewOf,
  type IndexedMeshHeader,
} from '@tenmol/protocol';
import { parsePdb } from '../src/model/pdb';
import { repBit } from '../src/model/atom';
import { buildCartoonFrame } from '../src/geometry/cartoon';

// ---------------------------------------------------------------------------
// Synthetic PDB: a single chain of Cα atoms (cartoon only ever reads CAs).
// ---------------------------------------------------------------------------

function put(cols: string[], start1: number, s: string): void {
  // 1-based inclusive column placement into an 80-char buffer.
  for (let i = 0; i < s.length; i++) cols[start1 - 1 + i] = s[i]!;
}

function atomLine(o: {
  serial: number;
  name: string;
  resn: string;
  chain: string;
  resi: number;
  x: number;
  y: number;
  z: number;
  elem: string;
}): string {
  const cols = new Array<string>(80).fill(' ');
  put(cols, 1, 'ATOM  ');
  put(cols, 7, String(o.serial).padStart(5));
  put(cols, 13, o.name.padEnd(3)); // CA -> "CA " at 13-15
  put(cols, 18, o.resn.padStart(3));
  put(cols, 22, o.chain);
  put(cols, 23, String(o.resi).padStart(4));
  put(cols, 31, o.x.toFixed(3).padStart(8));
  put(cols, 39, o.y.toFixed(3).padStart(8));
  put(cols, 47, o.z.toFixed(3).padStart(8));
  put(cols, 77, o.elem.padStart(2));
  return cols.join('');
}

/** A curved Cα-only chain so tangents actually vary along the spline. */
function caChainPdb(nRes: number, chain = 'A'): string {
  const lines: string[] = [];
  for (let i = 0; i < nRes; i++) {
    lines.push(
      atomLine({
        serial: i + 1,
        name: 'CA',
        resn: 'ALA',
        chain,
        resi: i + 1,
        x: i * 3.8,
        y: Math.sin(i * 0.6) * 2.5,
        z: Math.cos(i * 0.6) * 1.5,
        elem: 'C',
      }),
    );
  }
  lines.push('END');
  return lines.join('\n');
}

function ctx(mol: ReturnType<typeof parsePdb>) {
  return { mol, state: 1, seq: 7, getSettingFloat: () => 0 };
}

/** Turn every CA's cartoon rep bit on, and assign per-residue ss. */
function enableCartoon(mol: ReturnType<typeof parsePdb>, ss?: string[]): void {
  let r = 0;
  for (const a of mol.atoms) {
    if (a.name !== 'CA') continue;
    a.visRep |= repBit(Rep.Cartoon);
    if (ss) a.ss = ss[r] ?? '';
    r++;
  }
}

describe('buildCartoonFrame', () => {
  it('returns null when no atom carries the cartoon rep bit', () => {
    const mol = parsePdb(caChainPdb(6), 'm'); // default visRep is lines only
    expect(buildCartoonFrame(ctx(mol))).toBeNull();
  });

  it('returns null when a chain has fewer than two visible CAs', () => {
    const mol = parsePdb(caChainPdb(1), 'm');
    enableCartoon(mol);
    expect(buildCartoonFrame(ctx(mol))).toBeNull();
  });

  it('builds a well-formed indexed-mesh with the expected counts and shapes', () => {
    const mol = parsePdb(caChainPdb(6), 'm');
    // Exercise all three cross-sections: helix, strand (arrow at the S->loop edge), loop.
    enableCartoon(mol, ['H', 'H', 'H', 'S', 'S', '']);

    const buf = buildCartoonFrame(ctx(mol));
    expect(buf).not.toBeNull();

    const frame = decodeGeometryFrame(buf!);
    expect(frame.header.kind).toBe('indexed-mesh');
    expect(isIndexedMeshHeader(frame.header)).toBe(true);
    const h = frame.header as IndexedMeshHeader;

    expect(h.object).toBe('m');
    expect(h.state).toBe(1);
    expect(h.rep).toBe(Rep.Cartoon);
    expect(h.seq).toBe(7);
    expect(h.proximity).toBe(false);
    expect(h.oneColor).toBeNull();

    // Structural soundness: alignment, itemSizes, atom mapping, colour presence.
    expect(geometryFrameProblems(h)).toEqual([]);

    // Deterministic geometry: samples = (nRes-1)*K + 1, verts = samples*C.
    const K = 8;
    const C = 8;
    const samples = (6 - 1) * K + 1; // 41
    const expectVerts = samples * C; // 328
    const expectTris = (samples - 1) * C * 2; // 640
    expect(h.counts.verts).toBe(expectVerts);
    expect(h.counts.tris).toBe(expectTris);

    // Buffers are all present and the right length.
    expect(h.buffers.position).toBeDefined();
    expect(h.buffers.normal).toBeDefined();
    expect(h.buffers.color).toBeDefined();
    expect(h.buffers.index).toBeDefined();
    expect(h.buffers.atom).toBeDefined();

    const pos = viewOf(frame, h.buffers.position!);
    const nrm = viewOf(frame, h.buffers.normal!);
    const col = viewOf(frame, h.buffers.color!);
    const idx = viewOf(frame, h.buffers.index!);
    const atom = viewOf(frame, h.buffers.atom!);

    expect(pos.length).toBe(expectVerts * 3);
    expect(nrm.length).toBe(expectVerts * 3);
    expect(col.length).toBe(expectVerts * 4);
    expect(idx.length).toBe(expectTris * 3);
    expect(atom.length).toBe(expectVerts);

    // Positions and normals are finite; normals are unit length.
    for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i]!)).toBe(true);
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i]!, nrm[i + 1]!, nrm[i + 2]!);
      expect(l).toBeGreaterThan(0.99);
      expect(l).toBeLessThan(1.01);
    }

    // Colours are opaque and in [0,1].
    for (let i = 0; i < col.length; i += 4) {
      expect(col[i + 3]).toBe(1);
      for (let k = 0; k < 3; k++) {
        expect(col[i + k]!).toBeGreaterThanOrEqual(0);
        expect(col[i + k]!).toBeLessThanOrEqual(1);
      }
    }

    // Indices are in range.
    for (let i = 0; i < idx.length; i++) {
      expect(idx[i]!).toBeGreaterThanOrEqual(0);
      expect(idx[i]!).toBeLessThan(expectVerts);
    }

    // Every vertex is tagged with a real CA atom id; all six residues contribute.
    const ids = new Set<number>();
    for (let i = 0; i < atom.length; i++) {
      expect(atom[i]!).toBeGreaterThanOrEqual(1);
      expect(atom[i]!).toBeLessThanOrEqual(6);
      ids.add(atom[i]!);
    }
    expect(ids.size).toBe(6);
  });

  it('scales vertex count with the number of residues', () => {
    const small = parsePdb(caChainPdb(4), 'm');
    enableCartoon(small);
    const large = parsePdb(caChainPdb(9), 'm');
    enableCartoon(large);

    const hs = decodeGeometryFrame(buildCartoonFrame(ctx(small))!).header as IndexedMeshHeader;
    const hl = decodeGeometryFrame(buildCartoonFrame(ctx(large))!).header as IndexedMeshHeader;

    expect(hl.counts.verts).toBeGreaterThan(hs.counts.verts);
    expect(hl.counts.tris).toBeGreaterThan(hs.counts.tris);
    // Loop tube (all ss='') is the default when ss is left unassigned; still valid.
    expect(geometryFrameProblems(hs)).toEqual([]);
    expect(geometryFrameProblems(hl)).toEqual([]);
  });

  it('handles multiple chains and only splines cartoon-visible CAs', () => {
    const pdb = caChainPdb(5, 'A') + '\n' + caChainPdb(5, 'B');
    const mol = parsePdb(pdb, 'm');
    enableCartoon(mol);
    const two = decodeGeometryFrame(buildCartoonFrame(ctx(mol))!).header as IndexedMeshHeader;

    const one = parsePdb(caChainPdb(5, 'A'), 'm');
    enableCartoon(one);
    const single = decodeGeometryFrame(buildCartoonFrame(ctx(one))!).header as IndexedMeshHeader;

    // Two identical chains => exactly twice the geometry of one.
    expect(two.counts.verts).toBe(single.counts.verts * 2);
    expect(two.counts.tris).toBe(single.counts.tris * 2);
    expect(geometryFrameProblems(two)).toEqual([]);
  });
});
