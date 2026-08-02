/**
 * The `indexed-mesh` frame kind: `RepSurface` (triangles) and `RepMesh`
 * (line strips), both memcpy'd out of PyMOL.
 *
 * TWO DEFECTS THIS FILE FIXES, both found by photographing Mode G against
 * Mode P in a browser (see `docs/screenshots/modeg/`):
 *
 * D6-vis  `buffers.vis` was ignored, so Mode G drew the WHOLE surface while
 *         PyMOL drew only the visible part. `show surface, resi 1-30` on 1UBQ:
 *         Mode P covered 20.1% of the frame, Mode G 26.0%, IoU 0.774. PyMOL's
 *         rule is `visibility_test()` (`packages/engine/layer2/RepSurface.cpp:209-216`): a
 *         triangle survives if ALL three of its vertices are visible, or ANY of
 *         them when `proximity` is set — which is exactly the header's
 *         `proximity` flag. Filtering the index buffer by that rule is the
 *         whole fix; no vertex is moved and no buffer is rebuilt.
 *
 * D6-mesh a mesh frame has `strip` and NO `index`, so the previous build fell
 *         through to `Points` and drew the 21,222 line-strip vertices as
 *         21,222 dots — the right silhouette made of the wrong primitive
 *         (IoU 0.484 against Mode P). `RepMesh::N` is a zero-terminated list of
 *         GL_LINE_STRIP run lengths (`packages/engine/layer2/RepMesh.cpp:422-431`), so the
 *         strips expand to LINE indices: run of n vertices -> n-1 segments.
 *         That is a re-INDEXING of PyMOL's own vertices, not a tessellation.
 *
 * A THIRD, LATER (parity row 131): those segments went to `LineSegments`, and
 * WebGL2 core clamps `gl.lineWidth` to 1.0, so `mesh_width` did nothing at all.
 * They now go through `./quadlines.ts` — PyMOL's own `trilines` expansion —
 * which is the only primitive in WebGL2 that can be more than one pixel wide.
 */

import { BufferAttribute, BufferGeometry, Mesh, Points } from 'three';
import type { Material, Object3D } from 'three';

import { viewOf, type GeometryFrame, type IndexedMeshHeader } from '@tenmol/protocol';

import { createVertexMaterial } from '../modeG/materials/vertex';
import { buildQuadLines, quadLineRecords } from './quadlines';

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
    // packages/engine/layer2/RepSurface.cpp:209-216
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

  const positions = viewOf(frame, header.buffers.position) as Float32Array;
  geometry.setAttribute('position', new BufferAttribute(positions, 3));

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

  // Kept for the quad-line path below, which needs a colour per ENDPOINT and
  // cannot read it out of a vertex attribute.
  let rgbaColor: Float32Array | null = null;
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
    rgbaColor = rgba;
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
  /** The material the RENDERER must push camera/fog uniforms into. */
  let drawMaterial: Material = material;
  let triangles = 0;

  if (header.buffers.index) {
    const raw = viewOf(frame, header.buffers.index) as Int32Array;
    const vis = header.buffers.vis ? (viewOf(frame, header.buffers.vis) as Int32Array) : null;
    const filtered = visibleTriangleIndices(raw, vis, header.proximity);
    geometry.setIndex(new BufferAttribute(filtered.index, 1));
    triangles = filtered.kept;
    object = new Mesh(geometry, material);
  } else if (header.buffers.strip && isDotMesh(header)) {
    // An `isodot` OBJECT carries the SAME strip layout as an `isomesh` one and
    // means something completely different by it: `ObjectMesh::render` opens
    // GL_POINTS, not GL_LINE_STRIP, when `MeshMode` is `isodot`
    // (`packages/engine/layer2/ObjectMesh.cpp:768,803`). Measured on a real `isodot` of a
    // gaussian map: 6,162 vertices in ONE run — so expanding the run as a line
    // strip would draw a single 6,161-segment polyline right through the cloud.
    object = new Points(geometry, material);
  } else if (header.buffers.strip) {
    const strips = viewOf(frame, header.buffers.strip) as Int32Array;
    const index = stripLineIndices(strips, nverts);
    if (index.length === 0) {
      problems.push(
        `mesh strip list produced no segments (${strips.length} runs, ${nverts} verts)`,
      );
      object = new Points(geometry, material);
    } else {
      // `RepMesh::Width` (`meshWidth` on the header) is `mesh_width`, and
      // WebGL2 cannot draw a line wider than one pixel — so the segments go to
      // screen-space quads, PyMOL's own answer to the same limit. The vertex
      // material and its geometry are dropped here: neither was ever drawn,
      // and keeping them would leave a second, silently unused program.
      const draw = buildQuadLines(
        quadLineRecords(positions, index, rgbaColor, [
          oneColor?.[0] ?? 1,
          oneColor?.[1] ?? 1,
          oneColor?.[2] ?? 1,
          defaultAlpha,
        ]),
        index.length / 2,
        meshWidthOf(header),
      );
      geometry.dispose();
      material.dispose();
      object = draw.object;
      drawMaterial = draw.material;
    }
  } else {
    // A dot-surface (`SurfaceType::DotDefault`) really is a point cloud.
    object = new Points(geometry, material);
  }

  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  return { object, material: drawMaterial, triangles, vertices: nverts, problems, warnings };
}

/**
 * `mesh_width` off the header, or PyMOL's default when the bridge is older
 * than the packer that sends it (`cSetting_mesh_width` is 1.0,
 * `packages/engine/layer1/SettingInfo.h`). A non-positive width would make the mesh vanish, so
 * it falls back too.
 */
export function meshWidthOf(header: IndexedMeshHeader): number {
  const raw = (header as unknown as { meshWidth?: unknown }).meshWidth;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** `cIsomeshMode::isodot` (`packages/engine/layer0/PyMOLEnums.h:9-13`). */
export const MESH_TYPE_ISODOT = 1;

/**
 * Does this frame's strip list mean POINTS rather than a line strip?
 *
 * `meshType` is `cIsomeshMode` — `RepMesh::mesh_type` for a molecular `mesh`
 * rep, `ObjectMeshState::MeshMode` for an `isomesh`/`isodot` object. Only
 * `isodot` (1) changes the primitive; `isomesh` (0) and `gradient` (3) are line
 * strips. A frame from a bridge that does not send the field at all keeps the
 * old behaviour.
 */
export function isDotMesh(header: IndexedMeshHeader): boolean {
  const raw = (header as unknown as { meshType?: unknown }).meshType;
  return raw === MESH_TYPE_ISODOT;
}
