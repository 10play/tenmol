/**
 * The `indexed-mesh` frame kind: `RepSurface` (triangles) and `RepMesh`
 * (line strips), both memcpy'd out of PyMOL.
 *
 * TWO DEFECTS THIS FILE FIXES, both found by photographing Mode G against
 * Mode P in a browser (see `docs/webclient/screenshots/modeg/`):
 *
 * D6-vis  `buffers.vis` was ignored, so Mode G drew the WHOLE surface while
 *         PyMOL drew only the visible part. `show surface, resi 1-30` on 1UBQ:
 *         Mode P covered 20.1% of the frame, Mode G 26.0%, IoU 0.774. PyMOL's
 *         rule is `visibility_test()` (`layer2/RepSurface.cpp:209-216`): a
 *         triangle survives if ALL three of its vertices are visible, or ANY of
 *         them when `proximity` is set — which is exactly the header's
 *         `proximity` flag. Filtering the index buffer by that rule is the
 *         whole fix; no vertex is moved and no buffer is rebuilt.
 *
 * D6-mesh a mesh frame has `strip` and NO `index`, so the previous build fell
 *         through to `Points` and drew the 21,222 line-strip vertices as
 *         21,222 dots — the right silhouette made of the wrong primitive
 *         (IoU 0.484 against Mode P). `RepMesh::N` is a zero-terminated list of
 *         GL_LINE_STRIP run lengths (`layer2/RepMesh.cpp:422-431`), so the
 *         strips expand to LINE indices: run of n vertices -> n-1 segments.
 *         That is a re-INDEXING of PyMOL's own vertices, not a tessellation.
 */

import { BufferAttribute, BufferGeometry, LineSegments, Mesh, Points } from 'three';
import type { Material, Object3D } from 'three';

import { viewOf, type GeometryFrame, type IndexedMeshHeader } from '@tenmol/protocol';

import { createVertexMaterial } from '../modeG/materials/vertex';

export interface BuiltMesh {
  object: Object3D;
  material: Material;
  triangles: number;
  vertices: number;
  /** Reasons the rep is NOT drawable and must fall back to Mode P. */
  problems: string[];
  /**
   * Reasons the rep IS drawn but diverges from Mode P in a known, bounded way.
   * A warning must NOT trigger a fallback: doing so hands the rep back to the
   * server, which keeps the backend's GL context load-bearing for a case the
   * client very nearly handles. Surfaced in the HUD instead.
   */
  warnings: string[];
}

/**
 * `RepMesh::N` -> GL_LINES indices.
 *
 * @param strips run lengths, in vertex order
 * @param nverts total vertices, used to refuse a run that overruns the buffer
 */
export function stripLineIndices(strips: ArrayLike<number>, nverts: number): Uint32Array {
  let segments = 0;
  let cursor = 0;
  for (let i = 0; i < strips.length; i++) {
    const n = strips[i] ?? 0;
    if (n < 2 || cursor + n > nverts) {
      cursor += Math.max(0, n);
      continue;
    }
    segments += n - 1;
    cursor += n;
  }
  const out = new Uint32Array(segments * 2);
  let w = 0;
  cursor = 0;
  for (let i = 0; i < strips.length; i++) {
    const n = strips[i] ?? 0;
    if (n < 2 || cursor + n > nverts) {
      cursor += Math.max(0, n);
      continue;
    }
    for (let k = 0; k < n - 1; k++) {
      out[w++] = cursor + k;
      out[w++] = cursor + k + 1;
    }
    cursor += n;
  }
  return out;
}

/**
 * `RepSurface::T` filtered by `RepSurface::Vis`.
 *
 * Returns the ORIGINAL array when every triangle survives, so the common
 * "everything is visible" case costs one pass and no allocation.
 */
export function visibleTriangleIndices(
  index: Int32Array,
  vis: Int32Array | null,
  proximity: boolean,
): { index: Uint32Array; kept: number; total: number } {
  const total = Math.floor(index.length / 3);
  const asU32 = new Uint32Array(index.buffer, index.byteOffset, index.length);
  if (vis === null || vis.length === 0) return { index: asU32, kept: total, total };

  const keep = new Uint8Array(total);
  let kept = 0;
  for (let t = 0; t < total; t++) {
    const a = index[t * 3] ?? 0;
    const b = index[t * 3 + 1] ?? 0;
    const c = index[t * 3 + 2] ?? 0;
    // layer2/RepSurface.cpp:209-216
    const ok = proximity
      ? (vis[a] ?? 0) !== 0 || (vis[b] ?? 0) !== 0 || (vis[c] ?? 0) !== 0
      : (vis[a] ?? 0) !== 0 && (vis[b] ?? 0) !== 0 && (vis[c] ?? 0) !== 0;
    if (ok) {
      keep[t] = 1;
      kept++;
    }
  }
  if (kept === total) return { index: asU32, kept, total };

  const out = new Uint32Array(kept * 3);
  let w = 0;
  for (let t = 0; t < total; t++) {
    if (keep[t] === 0) continue;
    out[w++] = index[t * 3] ?? 0;
    out[w++] = index[t * 3 + 1] ?? 0;
    out[w++] = index[t * 3 + 2] ?? 0;
  }
  return { index: out, kept, total };
}

export function buildIndexedMesh(frame: GeometryFrame<IndexedMeshHeader>): BuiltMesh {
  const header = frame.header;
  const problems: string[] = [];
  const warnings: string[] = [];
  const geometry = new BufferGeometry();
  const nverts = header.counts.verts;

  geometry.setAttribute(
    'position',
    new BufferAttribute(viewOf(frame, header.buffers.position) as Float32Array, 3),
  );

  if (header.buffers.normal) {
    geometry.setAttribute(
      'normal',
      new BufferAttribute(viewOf(frame, header.buffers.normal) as Float32Array, 3),
    );
  }
  // `RepSurface` carries `cSetting_transparency` as `defaultAlpha` (1 = opaque)
  // and only emits a per-vertex `alpha` buffer when transparency VARIES.
  // Ignoring it drew a 50%-transparent surface fully opaque — measured mean
  // per-pixel colour error 57.4 against Mode P versus 8.3 for the same scene
  // opaque. This applies the flat alpha. It is ORDER-DEPENDENT blending, not
  // the order-independent transparency PyMOL uses (`t_mode` / OIT), which is
  // out of scope; see the transparency note in the D6 screenshots.
  const rawAlpha = (header as unknown as { defaultAlpha?: number }).defaultAlpha;
  const defaultAlpha =
    typeof rawAlpha === 'number' && rawAlpha >= 0 && rawAlpha <= 1 ? rawAlpha : 1;
  const flatTransparent = defaultAlpha < 1 && header.buffers.alpha === undefined;
  if (flatTransparent) {
    // A WARNING, not a problem: measured against Mode P at transparency 0.5 the
    // whole-image IoU is 0.998 and the mean per-channel colour error 11.6 (it
    // was 57.4 when the alpha was ignored outright). Interior facets that
    // PyMOL's OIT resolves away are visible; that is a divergence worth saying
    // out loud, not a reason to stop drawing.
    warnings.push(
      `surface transparency ${(1 - defaultAlpha).toFixed(2)} is drawn with order-dependent ` +
        `alpha blending; PyMOL uses order-independent transparency`,
    );
  }

  if (header.buffers.color) {
    // RepSurface::VC / RepMesh::VC are RGB (3 floats); the material wants RGBA.
    const rgb = viewOf(frame, header.buffers.color) as Float32Array;
    const rgba = new Float32Array(nverts * 4);
    for (let i = 0; i < nverts; i++) {
      rgba[i * 4] = rgb[i * 3] ?? 1;
      rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 1;
      rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 1;
      rgba[i * 4 + 3] = defaultAlpha;
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

  const oneColor = header.oneColor;
  const hasNormal = header.buffers.normal !== undefined;
  const material = createVertexMaterial({
    hasColor: header.buffers.color !== undefined,
    hasNormal,
    hasAlpha: header.buffers.alpha !== undefined,
    hasAo: header.buffers.ao !== undefined,
    transparent: defaultAlpha < 1 || header.buffers.alpha !== undefined,
    ...(oneColor === null
      ? {}
      : { color: [oneColor[0], oneColor[1], oneColor[2], defaultAlpha] as const }),
  });

  let object: Object3D;
  let triangles = 0;

  if (header.buffers.index) {
    const raw = viewOf(frame, header.buffers.index) as Int32Array;
    const vis = header.buffers.vis ? (viewOf(frame, header.buffers.vis) as Int32Array) : null;
    const filtered = visibleTriangleIndices(raw, vis, header.proximity);
    geometry.setIndex(new BufferAttribute(filtered.index, 1));
    triangles = filtered.kept;
    object = new Mesh(geometry, material);
  } else if (header.buffers.strip) {
    const strips = viewOf(frame, header.buffers.strip) as Int32Array;
    const index = stripLineIndices(strips, nverts);
    if (index.length === 0) {
      problems.push(
        `mesh strip list produced no segments (${strips.length} runs, ${nverts} verts)`,
      );
      object = new Points(geometry, material);
    } else {
      geometry.setIndex(new BufferAttribute(index, 1));
      object = new LineSegments(geometry, material);
    }
  } else {
    // A dot-surface (`SurfaceType::DotDefault`) really is a point cloud.
    object = new Points(geometry, material);
  }

  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  return { object, material, triangles, vertices: nverts, problems, warnings };
}
