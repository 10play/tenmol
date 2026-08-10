/**
 * Mode-G geometry — build the binary frames the existing three.js renderer
 * (`packages/viewport/src/modeG`) already draws, so the TypeScript engine gets
 * rendering "for free" by emitting the same wire format the C++ accessor does.
 *
 * This slice emits two reps as INSTANCE buffers (never tessellated — plan §1.3
 * constraint 1):
 *
 *   spheres  -> `sphere` instances, 8 floats  cx,cy,cz, radius, r,g,b,a
 *   lines    -> `line`   instances, 14 floats v1[3], v2[3], rgba1[4], rgba2[4]
 *
 * Layout, alignment and item sizes come straight from `@tenmol/protocol`'s
 * `geometry.ts` (`INSTANCE_ITEM_SIZE`, `BINARY_FRAME_ALIGNMENT`), which is what
 * makes the frames byte-compatible with the decoder and the renderer.
 */

import {
  Rep,
  INSTANCE_ITEM_SIZE,
  alignUp,
  encodeBinaryFrame,
  type BufferRef,
  type CgoDrawArraysHeader,
  type InstanceBuffer,
} from '@tenmol/protocol';
import { repBit } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import { rgbForIndex } from '../exec/color';

/** A pending buffer to place into the payload. */
interface Pending {
  bytes: Uint8Array;
  dtype: BufferRef['dtype'];
  itemSize: number;
  assign: (ref: BufferRef) => void;
}

class PayloadBuilder {
  private readonly pending: Pending[] = [];

  addF32(data: Float32Array, itemSize: number, assign: (ref: BufferRef) => void): void {
    this.pending.push({
      bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      dtype: 'f32',
      itemSize,
      assign,
    });
  }

  addI32(data: Int32Array, itemSize: number, assign: (ref: BufferRef) => void): void {
    this.pending.push({
      bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      dtype: 'i32',
      itemSize,
      assign,
    });
  }

  /** Pack every buffer 4-byte aligned; returns the concatenated payload. */
  build(): Uint8Array {
    let offset = 0;
    for (const p of this.pending) offset = alignUp(offset) + p.bytes.byteLength;
    const out = new Uint8Array(offset);
    let cursor = 0;
    for (const p of this.pending) {
      cursor = alignUp(cursor);
      out.set(p.bytes, cursor);
      p.assign({
        byteOffset: cursor,
        byteLength: p.bytes.byteLength,
        dtype: p.dtype,
        itemSize: p.itemSize,
      });
      cursor += p.bytes.byteLength;
    }
    return out;
  }
}

function encode(header: CgoDrawArraysHeader, payload: Uint8Array): ArrayBuffer {
  return encodeBinaryFrame(header, payload);
}

/**
 * Build the `spheres` frame for one object/state, or `null` if no atom carries
 * the spheres rep. Radius is `vdw * sphere_scale`; colour is the atom's colour
 * index resolved to RGB.
 */
export function buildSpheresFrame(
  mol: ObjectMolecule,
  state: number,
  seq: number,
  sphereScale: number,
): ArrayBuffer | null {
  const idx: number[] = [];
  for (let i = 0; i < mol.natom; i++) {
    if (mol.atoms[i]!.visRep & repBit(Rep.Sphere)) idx.push(i);
  }
  if (idx.length === 0) return null;

  const data = new Float32Array(idx.length * INSTANCE_ITEM_SIZE.sphere);
  const atom = new Int32Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    const [x, y, z] = mol.coord(i, state);
    const [r, g, b] = rgbForIndex(mol.atoms[i]!.color);
    const o = k * INSTANCE_ITEM_SIZE.sphere;
    data[o] = x; data[o + 1] = y; data[o + 2] = z;
    data[o + 3] = mol.vdw(i) * sphereScale;
    data[o + 4] = r; data[o + 5] = g; data[o + 6] = b; data[o + 7] = 1;
    atom[k] = mol.atoms[i]!.id;
  }

  const builder = new PayloadBuilder();
  const inst: InstanceBuffer = {
    kind: 'sphere',
    count: idx.length,
    itemSize: INSTANCE_ITEM_SIZE.sphere,
    data: PLACEHOLDER,
  };
  builder.addF32(data, INSTANCE_ITEM_SIZE.sphere, (ref) => (inst.data = ref));
  builder.addI32(atom, 1, (ref) => (inst.atom = ref));
  const payload = builder.build();

  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.Sphere,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
}

/**
 * Build the `lines` frame (one `line` instance per bond whose endpoints both
 * carry the lines rep), or `null` when nothing is shown as lines.
 */
export function buildLinesFrame(
  mol: ObjectMolecule,
  state: number,
  seq: number,
): ArrayBuffer | null {
  const bit = repBit(Rep.Line);
  const bonds = mol.bonds.filter(
    ([a, b]) => (mol.atoms[a]!.visRep & bit) !== 0 && (mol.atoms[b]!.visRep & bit) !== 0,
  );
  if (bonds.length === 0) return null;

  const data = new Float32Array(bonds.length * INSTANCE_ITEM_SIZE.line);
  const atom = new Int32Array(bonds.length);
  for (let k = 0; k < bonds.length; k++) {
    const [a, b] = bonds[k]!;
    const [x1, y1, z1] = mol.coord(a, state);
    const [x2, y2, z2] = mol.coord(b, state);
    const [r1, g1, b1] = rgbForIndex(mol.atoms[a]!.color);
    const [r2, g2, b2] = rgbForIndex(mol.atoms[b]!.color);
    const o = k * INSTANCE_ITEM_SIZE.line;
    data[o] = x1; data[o + 1] = y1; data[o + 2] = z1;
    data[o + 3] = x2; data[o + 4] = y2; data[o + 5] = z2;
    data[o + 6] = r1; data[o + 7] = g1; data[o + 8] = b1; data[o + 9] = 1;
    data[o + 10] = r2; data[o + 11] = g2; data[o + 12] = b2; data[o + 13] = 1;
    atom[k] = mol.atoms[a]!.id;
  }

  const builder = new PayloadBuilder();
  const inst: InstanceBuffer = {
    kind: 'line',
    count: bonds.length,
    itemSize: INSTANCE_ITEM_SIZE.line,
    data: PLACEHOLDER,
  };
  builder.addF32(data, INSTANCE_ITEM_SIZE.line, (ref) => (inst.data = ref));
  builder.addI32(atom, 1, (ref) => (inst.atom = ref));
  const payload = builder.build();

  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.Line,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
}

/**
 * Build the `sticks` frame — one split-colour `cylinder2` instance per bond
 * whose endpoints both carry the sticks rep, or `null` if none. Each cylinder
 * spans atom1..atom2 and is coloured half by each atom (PyMOL's
 * `CGO_SHADER_CYLINDER_WITH_2ND_COLOR`), radius `stick_radius`.
 */
export function buildSticksFrame(
  mol: ObjectMolecule,
  state: number,
  seq: number,
  stickRadius: number,
): ArrayBuffer | null {
  const bit = repBit(Rep.Cyl);
  const bonds = mol.bonds.filter(
    ([a, b]) => (mol.atoms[a]!.visRep & bit) !== 0 && (mol.atoms[b]!.visRep & bit) !== 0,
  );
  if (bonds.length === 0) return null;

  const n = INSTANCE_ITEM_SIZE.cylinder2; // 16
  const data = new Float32Array(bonds.length * n);
  const atom = new Int32Array(bonds.length);
  for (let k = 0; k < bonds.length; k++) {
    const [a, b] = bonds[k]!;
    const [x1, y1, z1] = mol.coord(a, state);
    const [x2, y2, z2] = mol.coord(b, state);
    const [r1, g1, b1c] = rgbForIndex(mol.atoms[a]!.color);
    const [r2, g2, b2c] = rgbForIndex(mol.atoms[b]!.color);
    const o = k * n;
    // origin, axis (atom2 - atom1)
    data[o] = x1; data[o + 1] = y1; data[o + 2] = z1;
    data[o + 3] = x2 - x1; data[o + 4] = y2 - y1; data[o + 5] = z2 - z1;
    data[o + 6] = stickRadius;
    data[o + 7] = 1; // capbits: capped
    data[o + 8] = r1; data[o + 9] = g1; data[o + 10] = b1c; data[o + 11] = 1;
    data[o + 12] = r2; data[o + 13] = g2; data[o + 14] = b2c; data[o + 15] = 1;
    atom[k] = mol.atoms[a]!.id;
  }

  const builder = new PayloadBuilder();
  const inst: InstanceBuffer = {
    kind: 'cylinder2',
    count: bonds.length,
    itemSize: n,
    data: PLACEHOLDER,
  };
  builder.addF32(data, n, (ref) => (inst.data = ref));
  builder.addI32(atom, 1, (ref) => (inst.atom = ref));
  const payload = builder.build();

  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.Cyl,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
}

/** Atoms that participate in no bond — what `nonbonded`/`nb_spheres` draw. */
function unbondedAtoms(mol: ObjectMolecule): number[] {
  const bonded = new Set<number>();
  for (const [a, b] of mol.bonds) {
    bonded.add(a);
    bonded.add(b);
  }
  const out: number[] = [];
  for (let i = 0; i < mol.natom; i++) if (!bonded.has(i)) out.push(i);
  return out;
}

/**
 * `nonbonded` — a `cross` instance (centre + rgba; the client expands it into
 * three axis segments of `nonbonded_size`) for each unbonded atom carrying the
 * rep, or `null` if none. Matches PyMOL, which crosses only atoms with no bond.
 */
export function buildNonbondedFrame(
  mol: ObjectMolecule,
  state: number,
  seq: number,
): ArrayBuffer | null {
  const bit = repBit(Rep.Nonbonded);
  const idx = unbondedAtoms(mol).filter((i) => mol.atoms[i]!.visRep & bit);
  if (idx.length === 0) return null;

  const n = INSTANCE_ITEM_SIZE.cross; // 7: center[3], rgba[4]
  const data = new Float32Array(idx.length * n);
  const atom = new Int32Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    const [x, y, z] = mol.coord(i, state);
    const [r, g, b] = rgbForIndex(mol.atoms[i]!.color);
    const o = k * n;
    data[o] = x; data[o + 1] = y; data[o + 2] = z;
    data[o + 3] = r; data[o + 4] = g; data[o + 5] = b; data[o + 6] = 1;
    atom[k] = mol.atoms[i]!.id;
  }

  const builder = new PayloadBuilder();
  const inst: InstanceBuffer = { kind: 'cross', count: idx.length, itemSize: n, data: PLACEHOLDER };
  builder.addF32(data, n, (ref) => (inst.data = ref));
  builder.addI32(atom, 1, (ref) => (inst.atom = ref));
  const payload = builder.build();

  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.Nonbonded,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
}

/**
 * `nb_spheres` — a small `sphere` instance per unbonded atom carrying the rep
 * (radius `nb_spheres_size`), or `null` if none.
 */
export function buildNbSpheresFrame(
  mol: ObjectMolecule,
  state: number,
  seq: number,
  size: number,
): ArrayBuffer | null {
  const bit = repBit(Rep.NonbondedSphere);
  const idx = unbondedAtoms(mol).filter((i) => mol.atoms[i]!.visRep & bit);
  if (idx.length === 0) return null;

  const n = INSTANCE_ITEM_SIZE.sphere; // 8
  const data = new Float32Array(idx.length * n);
  const atom = new Int32Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    const [x, y, z] = mol.coord(i, state);
    const [r, g, b] = rgbForIndex(mol.atoms[i]!.color);
    const o = k * n;
    data[o] = x; data[o + 1] = y; data[o + 2] = z;
    data[o + 3] = size;
    data[o + 4] = r; data[o + 5] = g; data[o + 6] = b; data[o + 7] = 1;
    atom[k] = mol.atoms[i]!.id;
  }

  const builder = new PayloadBuilder();
  const inst: InstanceBuffer = {
    kind: 'sphere',
    count: idx.length,
    itemSize: n,
    data: PLACEHOLDER,
  };
  builder.addF32(data, n, (ref) => (inst.data = ref));
  builder.addI32(atom, 1, (ref) => (inst.atom = ref));
  const payload = builder.build();

  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.NonbondedSphere,
    blocks: [],
    instances: [inst],
  };
  return encode(header, payload);
}

/** Filled in by the builder; never read before assignment. */
const PLACEHOLDER: BufferRef = { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 1 };
