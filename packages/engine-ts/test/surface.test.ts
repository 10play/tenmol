/**
 * Tests for the `surface`/`mesh` reps and their shared molecular-surface
 * generator (`geometry/surface_gen.ts`, `geometry/surface.ts`, `geometry/mesh.ts`).
 *
 * Isolated on purpose: imports only the surface modules, the PDB parser and the
 * protocol codec — NOT the full Engine/LocalBackend (concurrently edited).
 */

import { describe, it, expect } from 'vitest';
import { buildSurfaceFrame } from '../src/geometry/surface';
import { buildMeshFrame } from '../src/geometry/mesh';
import { generateSurface } from '../src/geometry/surface_gen';
import { parsePdb } from '../src/model/pdb';
import { repBit } from '../src/model/atom';
import type { ObjectMolecule } from '../src/model/molecule';
import {
  Rep,
  decodeGeometryFrame,
  geometryFrameProblems,
  viewOf,
  itemCount,
  INSTANCE_ITEM_SIZE,
  type IndexedMeshHeader,
  type CgoDrawArraysHeader,
} from '@tenmol/protocol';

/** One right-column-correct ATOM record (element inferred from the name/col 77). */
function atomLine(
  serial: number,
  name: string,
  resi: number,
  xyz: [number, number, number],
  elem = 'C',
): string {
  const [x, y, z] = xyz;
  const f = (v: number): string => v.toFixed(3).padStart(8, ' ');
  return (
    'ATOM  ' +
    String(serial).padStart(5, ' ') +
    ' ' +
    name.padEnd(4, ' ') +
    ' ' +
    'ALA' +
    ' A' +
    String(resi).padStart(4, ' ') +
    '    ' +
    f(x) +
    f(y) +
    f(z) +
    '  1.00  0.00' +
    '          ' +
    elem.padStart(2, ' ')
  );
}

function pdbOf(atoms: Array<[string, [number, number, number]]>): string {
  return atoms.map(([name, xyz], i) => atomLine(i + 1, name, 1, xyz)).join('\n') + '\n';
}

function show(mol: ObjectMolecule, rep: number): void {
  const bit = repBit(rep);
  for (const a of mol.atoms) a.visRep |= bit;
}

const CTX = (mol: ObjectMolecule) => ({
  mol,
  state: 1,
  seq: 11,
  getSettingFloat: () => 0, // → generator falls back to probe 1.4, spacing 0.6
});

describe('generateSurface', () => {
  it('returns null when no atom carries the requested bit', () => {
    const mol = parsePdb(pdbOf([['C1', [0, 0, 0]]]), 'one');
    // Default visRep is lines only.
    expect(generateSurface(mol, 1, repBit(Rep.Surface), {})).toBeNull();
  });

  it('accepts a UNION bit mask (surface OR mesh)', () => {
    const mol = parsePdb(pdbOf([['C1', [0, 0, 0]]]), 'one');
    // Flag with the MESH bit only …
    show(mol, Rep.Mesh);
    const mask = repBit(Rep.Surface) | repBit(Rep.Mesh);
    // … a surface-only mask sees nothing, but the union mask includes it.
    expect(generateSurface(mol, 1, repBit(Rep.Surface), {})).toBeNull();
    expect(generateSurface(mol, 1, mask, {})).not.toBeNull();
  });

  it('a single atom yields a roughly spherical, closed shell', () => {
    const mol = parsePdb(pdbOf([['C1', [0, 0, 0]]]), 'one');
    show(mol, Rep.Surface);
    const mesh = generateSurface(mol, 1, repBit(Rep.Surface), { spacing: 0.6 })!;
    expect(mesh).not.toBeNull();

    const verts = mesh.atoms.length;
    const tris = mesh.indices.length / 3;
    expect(verts).toBeGreaterThan(0);
    // A C (vdw 1.7) sphere at 0.6 spacing tessellates to hundreds of triangles.
    expect(tris).toBeGreaterThan(100);

    // Radius: the SAS 3.1 Å sphere (vdw 1.7 + probe 1.4) is shifted inward by the
    // SES approximation (~0.9·probe) toward the vdW surface, so the shell sits at
    // ≈ 1.7 + 0.1·1.4 = 1.84 Å; every vertex sits near it.
    const R = 1.7 + 1.4 * 0.1;
    for (let v = 0; v < verts; v++) {
      const x = mesh.positions[v * 3]!;
      const y = mesh.positions[v * 3 + 1]!;
      const z = mesh.positions[v * 3 + 2]!;
      const r = Math.hypot(x, y, z);
      // Within half a grid cell of the analytic radius.
      expect(Math.abs(r - R)).toBeLessThan(0.5);
    }

    // Normals are unit length and point radially outward.
    for (let v = 0; v < verts; v++) {
      const px = mesh.positions[v * 3]!;
      const py = mesh.positions[v * 3 + 1]!;
      const pz = mesh.positions[v * 3 + 2]!;
      const nx = mesh.normals[v * 3]!;
      const ny = mesh.normals[v * 3 + 1]!;
      const nz = mesh.normals[v * 3 + 2]!;
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 4);
      const pr = Math.hypot(px, py, pz) || 1;
      const radialDot = (nx * px + ny * py + nz * pz) / pr;
      expect(radialDot).toBeGreaterThan(0.9);
    }

    // Every vertex maps to the one atom's id (1-based).
    for (const id of mesh.atoms) expect(id).toBe(1);

    // A closed shell: every edge is shared by an even number of triangles, so
    // each undirected edge appears an even number of times across triangles.
    const count = new Map<number, number>();
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const tri = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
      for (let e = 0; e < 3; e++) {
        const u = tri[e]!;
        const w = tri[(e + 1) % 3]!;
        const key = Math.min(u, w) * verts + Math.max(u, w);
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    }
    let boundaryEdges = 0;
    for (const c of count.values()) if (c % 2 !== 0) boundaryEdges++;
    expect(boundaryEdges).toBe(0);
  });

  it('coarsens the spacing rather than exploding when the box is huge', () => {
    // Two far-apart atoms would need a large grid at 0.6 Å; a tiny cell cap
    // forces the generator to coarsen instead.
    const mol = parsePdb(
      pdbOf([
        ['C1', [0, 0, 0]],
        ['C2', [20, 0, 0]],
      ]),
      'far',
    );
    show(mol, Rep.Surface);
    const mesh = generateSurface(mol, 1, repBit(Rep.Surface), { maxCells: 4000 })!;
    expect(mesh).not.toBeNull();
    expect(mesh.spacing).toBeGreaterThan(0.6);
    expect(mesh.indices.length).toBeGreaterThan(0);
  });
});

describe('buildSurfaceFrame', () => {
  it('returns null when no atom carries the surface rep', () => {
    const mol = parsePdb(pdbOf([['C1', [0, 0, 0]]]), 'one');
    expect(buildSurfaceFrame(CTX(mol))).toBeNull();
  });

  it('emits ONE well-formed indexed-mesh frame for a small molecule', () => {
    // Three overlapping atoms → one merged blob surface.
    const mol = parsePdb(
      pdbOf([
        ['C1', [0, 0, 0]],
        ['C2', [1.4, 0, 0]],
        ['C3', [0.7, 1.2, 0]],
      ]),
      'blob',
    );
    show(mol, Rep.Surface);

    const frame = buildSurfaceFrame(CTX(mol));
    expect(frame).not.toBeNull();

    const decoded = decodeGeometryFrame(frame!);
    expect(decoded.header.kind).toBe('indexed-mesh');
    const h = decoded.header as IndexedMeshHeader;

    expect(h.rep).toBe(Rep.Surface);
    expect(h.seq).toBe(11);
    expect(h.object).toBe('blob');
    expect(h.counts.verts).toBeGreaterThan(0);
    expect(h.counts.tris).toBeGreaterThan(0);

    // Buffers are consistent and the protocol's own checker is happy.
    expect(itemCount(h.buffers.position)).toBe(h.counts.verts);
    expect(itemCount(h.buffers.index!)).toBe(h.counts.tris);
    expect(h.buffers.normal).toBeDefined();
    expect(h.buffers.color).toBeDefined();
    expect(h.buffers.atom).toBeDefined();
    expect(geometryFrameProblems(h)).toEqual([]);

    // Per-vertex atom ids are real (1..natom) and colours are opaque.
    const atom = viewOf(decoded, h.buffers.atom!) as Int32Array;
    for (const id of atom) {
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(mol.natom);
    }
    const color = viewOf(decoded, h.buffers.color!) as Float32Array;
    for (let v = 0; v < h.counts.verts; v++) expect(color[v * 4 + 3]).toBeCloseTo(1, 6);
  });

  it('picks up the solvent_radius setting (larger probe → larger surface)', () => {
    const mk = (probe: number): IndexedMeshHeader => {
      const mol = parsePdb(pdbOf([['C1', [0, 0, 0]]]), 'one');
      show(mol, Rep.Surface);
      const frame = buildSurfaceFrame({
        mol,
        state: 1,
        seq: 1,
        getSettingFloat: (name) => (name === 'solvent_radius' ? probe : 0),
      })!;
      return decodeGeometryFrame(frame).header as IndexedMeshHeader;
    };
    const small = mk(0.5);
    const big = mk(2.5);
    // The 4.2 Å sphere (vdw 1.7 + probe 2.5) has more surface area, hence more
    // vertices/triangles, than the 2.2 Å one (probe 0.5).
    expect(big.counts.verts).toBeGreaterThan(small.counts.verts);
    expect(big.counts.tris).toBeGreaterThan(small.counts.tris);
  });
});

describe('buildMeshFrame', () => {
  it('returns null when no atom carries the mesh rep', () => {
    const mol = parsePdb(pdbOf([['C1', [0, 0, 0]]]), 'one');
    // Surface bit set, but NOT mesh — the mesh builder must ignore it.
    show(mol, Rep.Surface);
    expect(buildMeshFrame(CTX(mol))).toBeNull();
  });

  it('emits line instances over the same triangulation, deduped', () => {
    const mol = parsePdb(
      pdbOf([
        ['C1', [0, 0, 0]],
        ['C2', [1.4, 0, 0]],
      ]),
      'two',
    );
    show(mol, Rep.Mesh);

    const frame = buildMeshFrame(CTX(mol));
    expect(frame).not.toBeNull();
    const decoded = decodeGeometryFrame(frame!);
    expect(decoded.header.kind).toBe('cgo-draw-arrays');
    const h = decoded.header as CgoDrawArraysHeader;

    expect(h.rep).toBe(Rep.Mesh);
    expect(h.blocks).toEqual([]);
    expect(h.instances).toHaveLength(1);
    const inst = h.instances[0]!;
    expect(inst.kind).toBe('line');
    expect(inst.itemSize).toBe(INSTANCE_ITEM_SIZE.line);
    expect(inst.count).toBeGreaterThan(0);
    expect(itemCount(inst.data)).toBe(inst.count);
    expect(geometryFrameProblems(h)).toEqual([]);

    // Edge count is bounded: a closed triangle mesh has E = 3T/2 exactly, and
    // dedup must not exceed that.
    const surf = generateSurface(mol, 1, repBit(Rep.Mesh), {})!;
    const tris = surf.indices.length / 3;
    expect(inst.count).toBeLessThanOrEqual(tris * 3);
    // Deduping really happened: fewer than the naive 3 edges per triangle.
    expect(inst.count).toBeLessThan(tris * 3);

    // Each line carries an atom id and opaque endpoint colours.
    const atom = viewOf(decoded, inst.atom!) as Int32Array;
    expect(atom.length).toBe(inst.count);
    for (const id of atom) expect(id).toBeGreaterThanOrEqual(1);
    const data = viewOf(decoded, inst.data) as Float32Array;
    for (let e = 0; e < inst.count; e++) {
      expect(data[e * INSTANCE_ITEM_SIZE.line + 9]).toBeCloseTo(1, 6); // rgba1.a
      expect(data[e * INSTANCE_ITEM_SIZE.line + 13]).toBeCloseTo(1, 6); // rgba2.a
    }
  });
});
