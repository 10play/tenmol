/**
 * Gather ray-traceable primitives from the executive's enabled objects, mirroring
 * `Engine.emitGeometry` (`engine.ts`): for each enabled molecule, emit spheres
 * (atoms), cylinders (sticks + lines-as-thin-cylinders + nonbonded crosses) and,
 * later, triangle meshes (surface/cartoon). Honours each atom's `visRep` bits and
 * the same colours/radii the WebGL builders use.
 */
import { Rep, type RepId, decodeGeometryFrame, viewOf } from '@tenmol/protocol';

import { repBit } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import type { Executive } from '../exec/executive';
import { rgbForIndex } from '../exec/color';
import { REP_BUILDERS } from '../geometry/registry';
import { applyMat4Dir, applyMat4Point, cross, norm, sub, type Vec3 } from './vec';
import type { Color, Cylinder, Primitive, Sphere, Triangle } from './primitives';

/** Radius used to render the `lines` rep as thin cylinders in ray mode. */
const LINE_RADIUS = 0.06;

/** Reps whose builder emits an `indexed-mesh` frame we can ray-trace as triangles. */
const MESH_REPS: readonly RepId[] = [Rep.Surface, Rep.Cartoon];

function cyl(p0: Vec3, p1: Vec3, r: number, c0: Color, c1: Color): Cylinder {
  return { kind: 'cylinder', p0, p1, r, color0: c0, color1: c1, caps: true };
}

/** Three short thin cylinders forming an axis-aligned cross at `p` (nonbonded). */
function crossPrims(p: Vec3, r: number, color: Color): Cylinder[] {
  const d = 0.25;
  return [
    cyl([p[0] - d, p[1], p[2]], [p[0] + d, p[1], p[2]], r, color, color),
    cyl([p[0], p[1] - d, p[2]], [p[0], p[1] + d, p[2]], r, color, color),
    cyl([p[0], p[1], p[2] - d], [p[0], p[1], p[2] + d], r, color, color),
  ];
}

function bondedSet(mol: ObjectMolecule): Set<number> {
  const s = new Set<number>();
  for (const [i, j] of mol.bonds) {
    s.add(i);
    s.add(j);
  }
  return s;
}

/**
 * Decode a rep's `indexed-mesh` builder frame into ray-traceable triangles.
 * Mirrors the WebGL path (`engine.emitGeometry`): run the registered builder,
 * decode the frame, then read position/normal/color/index. `oneColor` (a flat
 * mesh colour) and a missing normal buffer (→ face normal) are both honoured.
 * `M` is the object matrix applied to the raw model-space vertices/normals.
 */
function meshTriangles(
  ex: Executive,
  mol: ObjectMolecule,
  rep: RepId,
  state: number,
  M: readonly number[] | null,
): Triangle[] {
  const builder = REP_BUILDERS[rep];
  if (!builder) return [];
  const buf = builder({ mol, state, seq: 0, getSettingFloat: (n) => ex.getSettingFloat(n) });
  if (!buf) return [];

  const frame = decodeGeometryFrame(buf);
  const header = frame.header;
  if (header.kind !== 'indexed-mesh') return [];
  const { position, normal, color, index } = header.buffers;
  if (!index) return [];

  const pos = viewOf(frame, position) as Float32Array;
  const nrm = normal ? (viewOf(frame, normal) as Float32Array) : null;
  const col = color ? (viewOf(frame, color) as Float32Array) : null;
  const colItem = color ? color.itemSize : 0; // rgb(3) or rgba(4)
  const idx = viewOf(frame, index) as Uint32Array | Int32Array;
  const flat: Color | null = header.oneColor
    ? [header.oneColor[0], header.oneColor[1], header.oneColor[2]]
    : null;

  const vAt = (v: number): Vec3 => {
    const p: Vec3 = [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
    return M ? applyMat4Point(M, p) : p;
  };
  const nAt = (v: number): Vec3 | null => {
    if (!nrm) return null;
    const n: Vec3 = [nrm[v * 3]!, nrm[v * 3 + 1]!, nrm[v * 3 + 2]!];
    return M ? applyMat4Dir(M, n) : n;
  };
  const cAt = (v: number): Color => {
    if (flat) return flat;
    if (!col) return [1, 1, 1];
    const o = v * colItem;
    return [col[o]!, col[o + 1]!, col[o + 2]!];
  };

  const out: Triangle[] = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t]!;
    const b = idx[t + 1]!;
    const c = idx[t + 2]!;
    const v0 = vAt(a);
    const v1 = vAt(b);
    const v2 = vAt(c);
    const fn = faceNormal(v0, v1, v2);
    out.push({
      kind: 'triangle',
      v0,
      v1,
      v2,
      n0: nAt(a) ?? fn,
      n1: nAt(b) ?? fn,
      n2: nAt(c) ?? fn,
      c0: cAt(a),
      c1: cAt(b),
      c2: cAt(c),
    });
  }
  return out;
}

/** Collect primitives for all enabled molecules in load order. */
export function gatherScene(ex: Executive, state = 1): Primitive[] {
  const prims: Primitive[] = [];
  const sphereScale = ex.getSettingFloat('sphere_scale') || 1;
  const stickRadius = ex.getSettingFloat('stick_radius') || 0.25;
  const nbSize = ex.getSettingFloat('nb_spheres_size') || 0.25;
  const dotRadius = 0.05;

  for (const mol of ex.moleculesInOrder()) {
    if (!mol.enabled) continue;
    const M = mol.objectMatrix;
    const at = (i: number): Vec3 => {
      const c = mol.coord(i, state);
      return M ? applyMat4Point(M, c) : c;
    };
    const bonded = bondedSet(mol);

    for (let i = 0; i < mol.natom; i++) {
      const a = mol.atoms[i]!;
      const rep = a.visRep;
      const col = rgbForIndex(a.color) as Color;
      if (rep & repBit(Rep.Sphere)) {
        prims.push({ kind: 'sphere', c: at(i), r: mol.vdw(i) * sphereScale, color: col } as Sphere);
      }
      if (!bonded.has(i)) {
        if (rep & repBit(Rep.NonbondedSphere)) {
          prims.push({ kind: 'sphere', c: at(i), r: nbSize, color: col } as Sphere);
        }
        if (rep & repBit(Rep.Nonbonded)) {
          prims.push(...crossPrims(at(i), LINE_RADIUS, col));
        }
      }
      if (rep & repBit(Rep.Dot)) {
        prims.push({ kind: 'sphere', c: at(i), r: dotRadius, color: col } as Sphere);
      }
    }

    for (const [i, j] of mol.bonds) {
      const ai = mol.atoms[i]!;
      const aj = mol.atoms[j]!;
      const bothCyl = ai.visRep & repBit(Rep.Cyl) && aj.visRep & repBit(Rep.Cyl);
      const bothLine = ai.visRep & repBit(Rep.Line) && aj.visRep & repBit(Rep.Line);
      const c0 = rgbForIndex(ai.color) as Color;
      const c1 = rgbForIndex(aj.color) as Color;
      if (bothCyl) prims.push(cyl(at(i), at(j), stickRadius, c0, c1));
      else if (bothLine) prims.push(cyl(at(i), at(j), LINE_RADIUS, c0, c1));
    }

    // Triangle-mesh reps (surface, cartoon): only build when an atom carries the
    // bit — the builders (esp. the surface marching cubes) are expensive.
    for (const rep of MESH_REPS) {
      const bit = repBit(rep);
      let any = false;
      for (let i = 0; i < mol.natom; i++) {
        if (mol.atoms[i]!.visRep & bit) {
          any = true;
          break;
        }
      }
      if (any) prims.push(...meshTriangles(ex, mol, rep, state, M ?? null));
    }
  }
  return prims;
}

/** Face normal of a triangle (used as a fallback when a mesh lacks normals). */
export function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return norm(cross(sub(b, a), sub(c, a)));
}
