/**
 * A decoded geometry frame -> three.js objects.
 *
 * The rule that governs this whole file: PyMOL's buffers are used AS THEY
 * ARRIVE. A `cgo::draw::arrays` block is uploaded verbatim (its sub-arrays are
 * consecutive views onto the same payload, `cgoArraysLayout`), a `RepSurface`
 * mesh is uploaded verbatim, and instance buffers go to impostor shaders. The
 * only geometry this file generates is index arrays for GL_TRIANGLE_STRIP and
 * GL_TRIANGLE_FAN blocks, because three.js draws GL_TRIANGLES only — that is a
 * re-INDEXING of the same vertices, not a re-tessellation, and it produces
 * exactly the triangles PyMOL would have rasterised.
 *
 * Everything is keyed `object|rep|state` so a per-rep toggle and an incremental
 * recolour (`isColorOnlyInvalidation`) are both expressible.
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

import { buildInstancedDraw, isDrawableInstanceKind } from './instances';
import { createCylinderMaterial } from './materials/cylinder';
import { createSphereMaterial } from './materials/sphere';
import { createVertexMaterial } from './materials/vertex';

export interface BuiltGeometry {
  key: string;
  object: Object3D;
  /** Every material this build owns, so the renderer can push uniforms. */
  materials: Material[];
  stats: { drawCalls: number; instances: number; triangles: number; vertices: number };
  /** Non-fatal gaps: anything in the frame we could not draw. */
  problems: string[];
  dispose(): void;
}

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

  const position = cgoSubArrayView(frame.payload, block, layout.vertex);
  geometry.setAttribute('position', new BufferAttribute(position, 3));

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
 * Indexed mesh (RepSurface)
 * ------------------------------------------------------------------ */

function buildIndexedMesh(frame: GeometryFrame<IndexedMeshHeader>): {
  object: Object3D;
  material: Material;
  triangles: number;
  vertices: number;
} {
  const header = frame.header;
  const geometry = new BufferGeometry();
  const position = viewOf(frame, header.buffers.position) as Float32Array;
  geometry.setAttribute('position', new BufferAttribute(position, 3));

  if (header.buffers.normal) {
    geometry.setAttribute(
      'normal',
      new BufferAttribute(viewOf(frame, header.buffers.normal) as Float32Array, 3),
    );
  }
  if (header.buffers.color) {
    // RepSurface::VC is RGB (3 floats); the material wants RGBA.
    const rgb = viewOf(frame, header.buffers.color) as Float32Array;
    const n = header.counts.verts;
    const rgba = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = rgb[i * 3] ?? 1;
      rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 1;
      rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 1;
      rgba[i * 4 + 3] = 1;
    }
    geometry.setAttribute('color', new BufferAttribute(rgba, 4));
  }
  if (header.buffers.alpha) {
    geometry.setAttribute(
      'alpha',
      new BufferAttribute(viewOf(frame, header.buffers.alpha) as Float32Array, 1),
    );
  }
  if (header.buffers.ao) {
    geometry.setAttribute(
      'ao',
      new BufferAttribute(viewOf(frame, header.buffers.ao) as Float32Array, 1),
    );
  }

  let triangles = 0;
  if (header.buffers.index) {
    const index = viewOf(frame, header.buffers.index) as Int32Array;
    geometry.setIndex(
      new BufferAttribute(new Uint32Array(index.buffer, index.byteOffset, index.length), 1),
    );
    triangles = header.counts.tris;
  }

  const oneColor = header.oneColor;
  const material = createVertexMaterial({
    hasColor: header.buffers.color !== undefined,
    hasNormal: header.buffers.normal !== undefined,
    hasAlpha: header.buffers.alpha !== undefined,
    hasAo: header.buffers.ao !== undefined,
    ...(oneColor === null ? {} : { color: [oneColor[0], oneColor[1], oneColor[2], 1] as const }),
  });

  const object: Object3D = header.buffers.index
    ? new Mesh(geometry, material)
    : new Points(geometry, material);
  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  return { object, material, triangles, vertices: header.counts.verts };
}

/* ------------------------------------------------------------------ *
 * The entry point
 * ------------------------------------------------------------------ */

export function buildGeometry(frame: GeometryFrame): BuiltGeometry {
  const header = frame.header;
  const key = geometryKey(header);
  const group = new Group();
  group.matrixAutoUpdate = false;
  group.name = `${header.object}/${repName(header.rep)}/${header.state}`;
  const materials: Material[] = [];
  const problems: string[] = [];
  const stats = { drawCalls: 0, instances: 0, triangles: 0, vertices: 0 };

  if (header.matrix && header.matrix.length === 16) {
    // `cmd.get_object_matrix` when `matrix_mode != 0`
    // (`layer2/ObjectMolecule.cpp:11265-11269`). Column-major, as GL wants it.
    group.matrix.fromArray(header.matrix as number[]);
    group.matrixAutoUpdate = false;
  }

  if (isIndexedMeshHeader(header)) {
    const built = buildIndexedMesh(frame as GeometryFrame<IndexedMeshHeader>);
    group.add(built.object);
    materials.push(built.material);
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
    for (const buffer of header.instances) {
      if (!isDrawableInstanceKind(buffer.kind)) {
        problems.push(`instance kind '${buffer.kind}' has no impostor material yet`);
        continue;
      }
      const data = viewOf(frame, buffer.data) as Float32Array;
      const material = buffer.kind === 'sphere' ? createSphereMaterial() : createCylinderMaterial();
      const draw = buildInstancedDraw(buffer, data, material);
      if (draw === null) {
        material.dispose();
        problems.push(`instance buffer '${buffer.kind}' is malformed`);
        continue;
      }
      group.add(draw.mesh);
      materials.push(material);
      stats.drawCalls++;
      stats.instances += draw.count;
    }
  } else {
    problems.push(`unknown geometry frame kind`);
  }

  return {
    key,
    object: group,
    materials,
    stats,
    problems,
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
