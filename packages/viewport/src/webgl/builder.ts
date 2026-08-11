/**
 * A decoded geometry frame -> three.js objects. Drop-in replacement for
 * `../modeG/frames.ts`'s `buildGeometry` (same signature, same
 * `BuiltGeometry`), so wiring it in is one import line in
 * `../modeG/renderer.ts`.
 *
 * Same governing rule as before: PyMOL's buffers are used AS THEY ARRIVE. The
 * only geometry generated here is INDEX data — strip/fan -> triangles, mesh
 * strips -> line segments, surface triangles filtered by `Vis`. Positions,
 * normals and colours are never touched.
 *
 * WHAT IS NEW, AND WHY (all three found by photographing Mode G against
 * Mode P in a real browser; see `docs/screenshots/modeg/`):
 *
 *  1. Cone and ellipsoid instances are DRAWN (`./instances.ts`), so the two
 *     kinds the previous build reported as a fallback reason no longer force a
 *     rep back to Mode P.
 *  2. Radius-0 sphere instances are drawn as screen-space points, which is what
 *     `dots` actually is at the default `dot_radius 0`.
 *  3. AN EMPTY FRAME IS NOW A PROBLEM. `lines`, `ribbon`, `nonbonded`,
 *     `extent`, `dashes`, `angles` and `dihedrals` all arrive today with
 *     `payloadBytes: 0`, no blocks, no instances and an `unmapped` census
 *     ({"lines": 718} for `lines` on 1UBQ, {"crosses": 58} for `nonbonded`) —
 *     the accessor extracted the geometry and the BRIDGE has no packer for the
 *     `lines`/`crosses` buckets yet. The old builder returned zero problems for
 *     those frames, so the render policy kept the rep in Mode G and the user
 *     got a blank screen with a green "Mode G" badge. Reporting it makes
 *     `renderPolicy.degrade()` fall the rep back to Mode P, which is the whole
 *     point of the fallback machinery.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineLoop,
  LineSegments,
  Mesh,
  Points,
} from 'three';
import type { Material, Object3D } from 'three';

import {
  GLMode,
  cgoArraysLayout,
  cgoSubArrayView,
  geometryKey,
  isCgoDrawArraysHeader,
  isIndexedMeshHeader,
  repName,
  viewOf,
  type CgoDrawArraysBlock,
  type GeometryFrame,
  type IndexedMeshHeader,
} from '@tenmol/protocol';

import { createVertexMaterial } from '../modeG/materials/vertex';
import type { BuiltGeometry } from '../modeG/frames';
import { buildInstancedDraw, isDrawableInstanceKind } from './instances';
import { buildIndexedMesh } from './mesh';

/* ------------------------------------------------------------------ *
 * Strip / fan -> triangle index
 * ------------------------------------------------------------------ */

/** GL_TRIANGLE_STRIP -> GL_TRIANGLES indices, preserving winding. */
export function stripIndices(n: number): Uint32Array {
  if (n < 3) return new Uint32Array(0);
  const out = new Uint32Array((n - 2) * 3);
  for (let i = 0; i < n - 2; i++) {
    if (i % 2 === 0) {
      out[i * 3] = i;
      out[i * 3 + 1] = i + 1;
      out[i * 3 + 2] = i + 2;
    } else {
      out[i * 3] = i + 1;
      out[i * 3 + 1] = i;
      out[i * 3 + 2] = i + 2;
    }
  }
  return out;
}

/** GL_TRIANGLE_FAN -> GL_TRIANGLES indices. */
export function fanIndices(n: number): Uint32Array {
  if (n < 3) return new Uint32Array(0);
  const out = new Uint32Array((n - 2) * 3);
  for (let i = 0; i < n - 2; i++) {
    out[i * 3] = 0;
    out[i * 3 + 1] = i + 1;
    out[i * 3 + 2] = i + 2;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * CGO draw-arrays blocks
 * ------------------------------------------------------------------ */

function buildBlock(
  frame: GeometryFrame,
  block: CgoDrawArraysBlock,
): { object: Object3D; material: Material; triangles: number; vertices: number } | null {
  const layout = cgoArraysLayout(block.arraybits, block.nverts);
  const geometry = new BufferGeometry();

  geometry.setAttribute(
    'position',
    new BufferAttribute(cgoSubArrayView(frame.payload, block, layout.vertex), 3),
  );

  const hasNormal = layout.normal !== undefined;
  if (layout.normal) {
    geometry.setAttribute(
      'normal',
      new BufferAttribute(cgoSubArrayView(frame.payload, block, layout.normal), 3),
    );
  }
  const hasColor = layout.color !== undefined;
  if (layout.color) {
    geometry.setAttribute(
      'color',
      new BufferAttribute(cgoSubArrayView(frame.payload, block, layout.color), 4),
    );
  }
  if (layout.accessibility) {
    geometry.setAttribute(
      'ao',
      new BufferAttribute(cgoSubArrayView(frame.payload, block, layout.accessibility), 1),
    );
  }

  const material = createVertexMaterial({
    hasColor,
    hasNormal,
    hasAo: layout.accessibility !== undefined,
  });

  let object: Object3D;
  let triangles = 0;
  switch (block.mode) {
    case GLMode.Triangles:
      object = new Mesh(geometry, material);
      triangles = Math.floor(block.nverts / 3);
      break;
    case GLMode.TriangleStrip: {
      geometry.setIndex(new BufferAttribute(stripIndices(block.nverts), 1));
      object = new Mesh(geometry, material);
      triangles = Math.max(0, block.nverts - 2);
      break;
    }
    case GLMode.TriangleFan: {
      geometry.setIndex(new BufferAttribute(fanIndices(block.nverts), 1));
      object = new Mesh(geometry, material);
      triangles = Math.max(0, block.nverts - 2);
      break;
    }
    case GLMode.Lines:
      object = new LineSegments(geometry, material);
      break;
    case GLMode.LineStrip:
      object = new Line(geometry, material);
      break;
    case GLMode.LineLoop:
      object = new LineLoop(geometry, material);
      break;
    case GLMode.Points:
      object = new Points(geometry, material);
      break;
    default:
      geometry.dispose();
      material.dispose();
      return null;
  }
  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  return { object, material, triangles, vertices: block.nverts };
}

/* ------------------------------------------------------------------ *
 * The entry point
 * ------------------------------------------------------------------ */

/** Options for `buildGeometry`, currently just the device pixel ratio. */
export interface BuildOptions {
  /** Framebuffer pixels per CSS pixel; only the point (dots) path uses it. */
  pixelRatio?: number;
}

/**
 * Buckets the accessor filled but the bridge has no wire packer for. The C++
 * side names them in `header.unmapped`; surfacing the census verbatim is what
 * turns "Mode G drew nothing" into an actionable line in the HUD.
 */
export function unmappedCensus(header: unknown): string | null {
  const u = (header as { unmapped?: Record<string, number> }).unmapped;
  if (!u || typeof u !== 'object') return null;
  const parts = Object.entries(u)
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .map(([k, n]) => `${k}=${n}`);
  return parts.length === 0 ? null : parts.join(', ');
}

/** Turn a decoded Mode-G geometry frame into a renderable Three.js group. */
export function buildGeometry(frame: GeometryFrame, options: BuildOptions = {}): BuiltGeometry {
  const header = frame.header;
  const key = geometryKey(header);
  const group = new Group();
  group.matrixAutoUpdate = false;
  group.name = `${header.object}/${repName(header.rep)}/${header.state}`;
  const materials: Material[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];
  const stats = { drawCalls: 0, instances: 0, triangles: 0, vertices: 0 };

  if (header.matrix && header.matrix.length === 16) {
    // `cmd.get_object_matrix` when `matrix_mode != 0`
    // (`packages/engine/layer2/ObjectMolecule.cpp:11265-11269`). Column-major, as GL wants it.
    group.matrix.fromArray(header.matrix as number[]);
    group.matrixAutoUpdate = false;
  }

  if (isIndexedMeshHeader(header)) {
    const built = buildIndexedMesh(frame as GeometryFrame<IndexedMeshHeader>);
    group.add(built.object);
    materials.push(built.material);
    problems.push(...built.problems);
    warnings.push(...built.warnings);
    stats.drawCalls++;
    stats.triangles += built.triangles;
    stats.vertices += built.vertices;
  } else if (isCgoDrawArraysHeader(header)) {
    for (const block of header.blocks) {
      const built = buildBlock(frame, block);
      if (built === null) {
        problems.push(`unsupported GL mode ${block.mode}`);
        continue;
      }
      group.add(built.object);
      materials.push(built.material);
      stats.drawCalls++;
      stats.triangles += built.triangles;
      stats.vertices += built.vertices;
    }
    const pointSize = (header as unknown as { pointSize?: number }).pointSize;
    const nonbondedSize = (header as unknown as { nonbondedSize?: number }).nonbondedSize;
    // `line`-kind reps (lines, ribbon) carry the raw PyMOL width setting so the
    // viewport can draw wide quad lines instead of the 1px GL_LINES clamp.
    const lineWidth = (header as unknown as { lineWidth?: number }).lineWidth;
    for (const buffer of header.instances) {
      if (!isDrawableInstanceKind(buffer.kind)) {
        problems.push(`instance kind '${buffer.kind}' has no impostor material yet`);
        continue;
      }
      const data = viewOf(frame, buffer.data) as Float32Array;
      // OPTIONAL SUB-BUFFERS are read off the raw record, exactly as `atom2`
      // is in `picking/pick.ts`: they are additive on the wire and deliberately
      // not part of the frozen `InstanceBuffer` type.
      const normalRef = (buffer as unknown as { normal?: unknown }).normal;
      let normal: Float32Array | undefined;
      if (normalRef !== undefined && normalRef !== null) {
        try {
          normal = viewOf(frame, normalRef as never) as Float32Array;
        } catch {
          normal = undefined; // a malformed ref must not cost us the whole rep
        }
      }
      const draw = buildInstancedDraw(buffer, data, {
        ...(pointSize === undefined ? {} : { pointSize }),
        ...(options.pixelRatio === undefined ? {} : { pixelRatio: options.pixelRatio }),
        ...(nonbondedSize === undefined ? {} : { nonbondedSize }),
        ...(normal === undefined ? {} : { normal }),
        ...(lineWidth === undefined ? {} : { lineWidth }),
      });
      if (draw === null) {
        problems.push(`instance buffer '${buffer.kind}' is malformed`);
        continue;
      }
      group.add(draw.object);
      materials.push(draw.material);
      stats.drawCalls++;
      stats.instances += draw.count;
    }
  } else {
    problems.push(`unknown geometry frame kind`);
  }

  // A frame that produced no draw at all is a FALLBACK, not a success. The
  // accessor's own census, when it is there, says which bucket was dropped.
  if (stats.drawCalls === 0) {
    const census = unmappedCensus(header);
    problems.push(
      census === null
        ? 'frame carried no drawable geometry (0 blocks, 0 instances)'
        : `frame carried no drawable geometry; the bridge did not pack: ${census}`,
    );
  }

  return {
    key,
    object: group,
    materials,
    stats,
    problems,
    warnings,
    dispose(): void {
      group.traverse((child) => {
        const geo = (child as Mesh).geometry as BufferGeometry | undefined;
        geo?.dispose();
      });
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
