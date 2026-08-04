/**
 * Parity row 131, the mesh half: `mesh_width` is honoured.
 *
 * The row has said since wave 2 that "`mesh_width` [is] not honoured", and
 * waves 8, 9 and 10 all restated the same blocker: WebGL2 core clamps
 * `gl.lineWidth` to 1.0, so nothing in the `LineSegments` path can express a
 * width. PyMOL hit that wall first and answered it with `trilines`; the mesh
 * strips now go through the same expansion (`./quadlines.ts`).
 *
 * Four things are pinned here, and the first is the one that matters:
 *
 *   1. THE QUAD IS `width` PIXELS WIDE. The vertex shader's own algebra is
 *      re-run in JS on a real projection and the two sides of one quad are
 *      measured apart in pixels — not "a uniform was set".
 *   2. the width is PyMOL's, not the raw setting: `dynamic_width` is on by
 *      default, so `SceneGetDynamicLineWidth` scales it by the camera, and
 *      that factor is recomputed on every draw from the projection matrix.
 *   3. `vertexScaleOf` recovers `SceneGetScreenVertexScale` from the
 *      projection matrix alone, cross-checked against `camera.ts`'s own
 *      `cameraDistance * fovWidth / height`, in both projections.
 *   4. a frame from a bridge that does not send `meshWidth` still draws, at
 *      PyMOL's default of 1.
 *
 * The bridge half — `RepMesh::Width` reaching the header at all — is
 * `packages/bridge/tests/test_p11_mesh.py`.
 */

import { decodeGeometryFrame, encodeGeometryFrame } from '@tenmol/protocol';
import { Matrix4 } from 'three';
import type {
  BufferGeometry,
  InstancedBufferGeometry,
  Vector4,
  WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';

import { cameraDistance, fovWidth, projectionMatrix, type ViewMatrix } from '../camera';
import { buildIndexedMesh, meshWidthOf } from './mesh';
import {
  DYNAMIC_WIDTH_FACTOR,
  DYNAMIC_WIDTH_MAX,
  DYNAMIC_WIDTH_MIN,
  QUADLINE_ITEM_SIZE,
  buildQuadLines,
  dynamicLineWidth,
  quadLineRecords,
  vertexScaleOf,
} from './quadlines';

type UniformMaterial = { uniforms: Record<string, { value: unknown }> };

const WIDTH_PX = 800;
const HEIGHT_PX = 600;

/**
 * A camera 100 A from the origin of rotation with SYMMETRIC clipping, which is
 * what `zoom`/`orient` produce (`SceneWindowSphere`: front = dist - radius,
 * back = dist + radius).
 */
function view(ortho: boolean): ViewMatrix {
  const v = new Array<number>(18).fill(0);
  v[0] = 1;
  v[4] = 1;
  v[8] = 1; // identity rotation
  v[11] = -100; // camera distance
  v[15] = 80; // front
  v[16] = 120; // back
  v[17] = ortho ? 20 : -20; // sign IS the ortho flag (camera.ts)
  return v as unknown as ViewMatrix;
}

/** PyMOL's own formula, from the view rather than from the matrix. */
function pymolVertexScale(v: ViewMatrix, heightPx: number): number {
  return (cameraDistance(v) * fovWidth(v)) / heightPx;
}

function projection(v: ViewMatrix): Matrix4 {
  return new Matrix4().fromArray(projectionMatrix(v, WIDTH_PX / HEIGHT_PX));
}

/** A three renderer, reduced to the two calls `onBeforeRender` makes. */
function fakeRenderer(w = WIDTH_PX, h = HEIGHT_PX, ratio = 1): WebGLRenderer {
  return {
    getViewport: (target: Vector4) => target.set(0, 0, w, h),
    getPixelRatio: () => ratio,
  } as unknown as WebGLRenderer;
}

/** One render of `object`: exactly what three does before it draws. */
function draw(
  object: { onBeforeRender?: unknown },
  v: ViewMatrix,
  renderer = fakeRenderer(),
): void {
  const camera = { projectionMatrix: projection(v) };
  (
    object.onBeforeRender as (r: WebGLRenderer, s: unknown, c: unknown) => void
  )(renderer, null, camera);
}

/* ------------------------------------------------------------------ *
 * 1. the quad really is `width` pixels wide
 * ------------------------------------------------------------------ */

/**
 * `../shaders/quadline.ts`'s `main()`, re-run in JS. Returns the corner's
 * position in DEVICE PIXELS, origin at the centre of the viewport.
 *
 * Kept deliberately literal — every line has a counterpart in the GLSL — so
 * that a change to the shader that this test does not follow shows up as a
 * disagreement between two implementations rather than as silence.
 */
function projectCorner(
  proj: Matrix4,
  v1: readonly [number, number, number],
  v2: readonly [number, number, number],
  corner: readonly [number, number],
  lineWidth: number,
): [number, number] {
  const invDim: [number, number] = [1 / WIDTH_PX, 1 / HEIGHT_PX];
  const self = corner[0] === 0 ? v1 : v2;
  const other = corner[0] === 0 ? v2 : v1;
  const clip = (p: readonly [number, number, number]): [number, number] => {
    const e = proj.elements;
    // modelViewMatrix is identity in this fixture, so proj alone.
    const x = (e[0] ?? 0) * p[0];
    const y = (e[5] ?? 0) * p[1];
    const w = -p[2]; // m[11] == -1 for the perspective projection
    return [x / Math.abs(w), y / Math.abs(w)];
  };
  const a = clip(self);
  const b = clip(other);
  const d: [number, number] = [(a[1] - b[1]) * invDim[0], (a[0] - b[0]) * invDim[1]];
  const len = Math.hypot(d[0], d[1]);
  const perp: [number, number] = len > 0 ? [d[0] / len, -(d[1] / len)] : [0, 0];
  const width = Math.max(1, lineWidth);
  const ndc: [number, number] = [
    a[0] + width * perp[0] * corner[1] * invDim[0],
    a[1] + width * perp[1] * corner[1] * invDim[1],
  ];
  // NDC -> pixels.
  return [(ndc[0] * WIDTH_PX) / 2, (ndc[1] * HEIGHT_PX) / 2];
}

describe('the quad is exactly `width` pixels wide, in pixels', () => {
  const proj = projection(view(false));
  // A segment at the depth of the origin of rotation, deliberately NOT axis
  // aligned: the mixed-metric `perp` in trilines.vs is only interesting when
  // the segment is oblique and the viewport is not square.
  const v1: [number, number, number] = [-8, -3, -100];
  const v2: [number, number, number] = [5, 9, -100];

  /** The four corners, in the order `cornerGeometry()` lists them. */
  function quad(width: number): Array<[number, number]> {
    return (
      [
        [0, 1],
        [1, 1],
        [1, -1],
        [0, -1],
      ] as Array<[number, number]>
    ).map((c) => projectCorner(proj, v1, v2, c, width));
  }
  const sub = (a: [number, number], b: [number, number]): [number, number] => [
    a[0] - b[0],
    a[1] - b[1],
  ];

  it.each([1, 2, 3, 7.5])('separates the two sides by %s px at BOTH ends', (width) => {
    const [c0, c1, c2, c3] = quad(width) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    // c0/c3 are the two sides at v1, c2/c1 the two sides at v2.
    expect(Math.hypot(...sub(c0, c3))).toBeCloseTo(width, 6);
    expect(Math.hypot(...sub(c2, c1))).toBeCloseTo(width, 6);
  });

  it('is a rectangle, not the bow tie the obvious corner order gives', () => {
    const [c0, c1, c2, c3] = quad(4) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    // Opposite edges equal and parallel == a parallelogram; with the two side
    // edges equal to the width and perpendicular below, a rectangle.
    const e02 = sub(c2, c0);
    const e31 = sub(c1, c3);
    expect(e02[0]).toBeCloseTo(e31[0], 6);
    expect(e02[1]).toBeCloseTo(e31[1], 6);
    // ... and it runs along the segment: same vector as the unoffset endpoints.
    const along = sub(
      projectCorner(proj, v1, v2, [1, 0], 4),
      projectCorner(proj, v1, v2, [0, 0], 4),
    );
    expect(e02[0]).toBeCloseTo(along[0], 6);
    expect(e02[1]).toBeCloseTo(along[1], 6);

    const across = sub(c0, c3);
    const cos =
      (across[0] * along[0] + across[1] * along[1]) /
      (Math.hypot(...across) * Math.hypot(...along));
    expect(Math.abs(cos)).toBeLessThan(1e-9);
  });

  it('is at least one pixel however small the setting, as trilines.vs is', () => {
    const [c0, , , c3] = quad(0.2) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    expect(Math.hypot(...sub(c0, c3))).toBeCloseTo(1, 6);
  });

  /**
   * THE COVERAGE TEST, and the reason it is not just a look at the corners:
   * the two triangles are picked by the INDEX BUFFER, and the wrong index
   * order still puts all six vertices on rectangle corners — it just makes
   * them overlap over one half and leave the other half blank. So the real
   * geometry is read out of the draw and sample points are counted.
   */
  it('covers every point of the rectangle with exactly one triangle', () => {
    const built = buildQuadLines(
      new Float32Array([...v1, ...v2, 1, 1, 1, 1, 1, 1, 1, 1]),
      1,
      4,
    );
    const geometry = built.object.geometry as InstancedBufferGeometry;
    const corner = geometry.getAttribute('corner').array as ArrayLike<number>;
    const index = geometry.getIndex()?.array as ArrayLike<number>;
    expect(index).toHaveLength(6);

    const at = (i: number): [number, number] =>
      projectCorner(
        proj,
        v1,
        v2,
        [corner[i * 2] ?? 0, corner[i * 2 + 1] ?? 0] as [number, number],
        4,
      );
    const tri = [0, 1].map((t) =>
      [0, 1, 2].map((k) => at(index[t * 3 + k] ?? 0)),
    ) as Array<Array<[number, number]>>;

    const inside = (t: Array<[number, number]>, p: [number, number]): boolean => {
      const sign = (a: [number, number], b: [number, number], c: [number, number]): number =>
        (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
      const d1 = sign(p, t[0] as [number, number], t[1] as [number, number]);
      const d2 = sign(p, t[1] as [number, number], t[2] as [number, number]);
      const d3 = sign(p, t[2] as [number, number], t[0] as [number, number]);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(neg && pos);
    };

    // Bilinear over the four rectangle corners, in (along, across).
    const [k0, k1, k2, k3] = quad(4) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    // k0 = A+p, k3 = A-p, k2 = B+p, k1 = B-p.
    const point = (u: number, v: number): [number, number] => [
      (k3[0] + (k1[0] - k3[0]) * u) * (1 - v) + (k0[0] + (k2[0] - k0[0]) * u) * v,
      (k3[1] + (k1[1] - k3[1]) * u) * (1 - v) + (k0[1] + (k2[1] - k0[1]) * u) * v,
    ];

    let checked = 0;
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const v of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        // Skip the two diagonals: a point ON the shared edge is in both.
        if (Math.abs(u - v) < 1e-9 || Math.abs(u + v - 1) < 1e-9) continue;
        const covered = tri.filter((t) => inside(t, point(u, v))).length;
        expect([u, v, covered]).toEqual([u, v, 1]);
        checked++;
      }
    }
    // 25 grid points less the 9 that sit on one of the two diagonals.
    expect(checked).toBe(16);
  });
});

/* ------------------------------------------------------------------ *
 * 2. vertex scale and the dynamic factor
 * ------------------------------------------------------------------ */

describe('vertexScaleOf recovers SceneGetScreenVertexScale from the matrix', () => {
  it('agrees with cameraDistance * fovWidth / height under perspective', () => {
    const v = view(false);
    const expected = pymolVertexScale(v, HEIGHT_PX);
    // 100 A * 2 tan(10 deg) / 600 px
    expect(expected).toBeCloseTo(0.0587757, 7);
    expect(vertexScaleOf(projection(v).elements, HEIGHT_PX)).toBeCloseTo(expected, 8);
  });

  it('agrees under an orthoscopic projection too', () => {
    const v = view(true);
    // 8 digits, not more: `projectionMatrix()` returns float32.
    expect(vertexScaleOf(projection(v).elements, HEIGHT_PX)).toBeCloseTo(
      pymolVertexScale(v, HEIGHT_PX),
      8,
    );
  });

  it('halves when the viewport doubles, which is what makes lines widen', () => {
    const e = projection(view(false)).elements;
    expect(vertexScaleOf(e, 2 * HEIGHT_PX)).toBeCloseTo(
      vertexScaleOf(e, HEIGHT_PX) / 2,
      9,
    );
  });
});

describe('dynamicLineWidth is SceneGetDynamicLineWidth', () => {
  it('scales by dynamic_width_factor / vertex_scale inside the clamp', () => {
    // 0.06 / 0.058775 = 1.0208, inside [0.75, 2.5].
    expect(dynamicLineWidth(0.058775, 1)).toBeCloseTo(1.0208, 4);
    expect(dynamicLineWidth(0.058775, 3)).toBeCloseTo(3.0625, 4);
  });

  it('clamps at dynamic_width_min when the camera is far out', () => {
    // 0.06 / 0.5 = 0.12 -> 0.75
    expect(dynamicLineWidth(0.5, 2)).toBeCloseTo(DYNAMIC_WIDTH_MIN * 2, 9);
  });

  it('clamps at dynamic_width_max when the camera is right on top', () => {
    expect(dynamicLineWidth(DYNAMIC_WIDTH_FACTOR / 100, 2)).toBeCloseTo(
      DYNAMIC_WIDTH_MAX * 2,
      9,
    );
    // A degenerate (zero) scale takes the max branch, not a division by zero.
    expect(dynamicLineWidth(0, 2)).toBe(DYNAMIC_WIDTH_MAX * 2);
  });
});

/* ------------------------------------------------------------------ *
 * 3. the draw
 * ------------------------------------------------------------------ */

describe('quadLineRecords', () => {
  it('gives every corner both endpoints and both colours', () => {
    const position = new Float32Array([0, 0, 0, 1, 2, 3]);
    const color = new Float32Array([1, 0, 0, 1, 0, 0, 1, 1]);
    const out = quadLineRecords(position, [0, 1], color, [0, 0, 0, 1]);
    expect(out).toHaveLength(QUADLINE_ITEM_SIZE);
    expect(Array.from(out.subarray(0, 6))).toEqual([0, 0, 0, 1, 2, 3]);
    expect(Array.from(out.subarray(6, 10))).toEqual([1, 0, 0, 1]);
    expect(Array.from(out.subarray(10, 14))).toEqual([0, 0, 1, 1]);
  });

  it('falls back to the flat colour for an oneColorFlag mesh', () => {
    const out = quadLineRecords(new Float32Array(6), [0, 1], null, [0.2, 0.4, 0.6, 1]);
    // float32, so compare against the same rounding the buffer applies.
    expect(Array.from(out.subarray(6, 14))).toEqual(
      Array.from(new Float32Array([0.2, 0.4, 0.6, 1, 0.2, 0.4, 0.6, 1])),
    );
  });
});

describe('buildQuadLines', () => {
  const data = new Float32Array(QUADLINE_ITEM_SIZE * 2);

  it('is one INSTANCE per segment, not six vertices', () => {
    const built = buildQuadLines(data, 2, 3);
    const geometry = built.object.geometry as InstancedBufferGeometry;
    expect(built.segments).toBe(2);
    expect(geometry.instanceCount).toBe(2);
    // Four corners and six indices, shared by every segment.
    expect(geometry.getAttribute('corner').count).toBe(4);
    expect(geometry.getIndex()?.count).toBe(6);
    expect(geometry.getAttribute('a_v1').count).toBe(2);
    expect(geometry.getAttribute('a_color2').count).toBe(2);
  });

  it('recomputes the width from the camera on every draw', () => {
    const built = buildQuadLines(data, 2, 3);
    const material = built.material as unknown as UniformMaterial;

    draw(built.object, view(false));
    expect(material.uniforms['u_lineWidth']?.value).toBeCloseTo(3.0625, 4);

    // Same scene, taller viewport: PyMOL's factor rises with the pixel count,
    // which is why a mesh is NOT `mesh_width` pixels wide at every size.
    draw(built.object, view(false), fakeRenderer(WIDTH_PX, 1200));
    expect(material.uniforms['u_lineWidth']?.value).toBeCloseTo(6.125, 4);
  });

  it('follows the device pixel ratio through the viewport', () => {
    const built = buildQuadLines(data, 2, 1);
    const material = built.material as unknown as UniformMaterial;
    draw(built.object, view(false), fakeRenderer(WIDTH_PX, HEIGHT_PX, 2));
    // dpr 2 == twice the pixels for the same scene: 2 * 1.0208, still clamped
    // below dynamic_width_max.
    expect(material.uniforms['u_lineWidth']?.value).toBeCloseTo(2.0417, 4);
    const invDim = material.uniforms['u_invDim']?.value as { x: number; y: number };
    expect(invDim.x).toBeCloseTo(1 / 1600, 9);
    expect(invDim.y).toBeCloseTo(1 / 1200, 9);
  });
});

/* ------------------------------------------------------------------ *
 * 4. end to end, through a real encode/decode
 * ------------------------------------------------------------------ */

/** The frame `render/modeg.py`'s `_strip_mesh` produces, built by hand. */
function meshFrame(meshWidth: number | undefined) {
  // Three vertices, one strip of 3 -> two segments.
  const position = new Float32Array([-1, 0, -100, 0, 1, -100, 1, 0, -100]);
  const strip = new Int32Array([3]);
  const payload = new Uint8Array(position.byteLength + strip.byteLength);
  payload.set(new Uint8Array(position.buffer), 0);
  payload.set(new Uint8Array(strip.buffer), position.byteLength);
  const header: Record<string, unknown> = {
    v: 1,
    kind: 'indexed-mesh',
    object: 'm',
    rep: 9,
    state: 0,
    counts: { verts: 3, tris: 0 },
    buffers: {
      position: {
        byteOffset: 0,
        byteLength: position.byteLength,
        dtype: 'f32',
        itemSize: 3,
      },
      strip: {
        byteOffset: position.byteLength,
        byteLength: strip.byteLength,
        dtype: 'i32',
        itemSize: 1,
      },
    },
    proximity: false,
    oneColor: [1, 1, 1],
    nStrip: 1,
  };
  if (meshWidth !== undefined) header['meshWidth'] = meshWidth;
  return decodeGeometryFrame(encodeGeometryFrame(header as never, payload));
}

describe('a real mesh frame honours mesh_width', () => {
  it('carries the header width all the way into the draw', () => {
    const frame = meshFrame(3);
    expect(meshWidthOf(frame.header as never)).toBe(3);

    const built = buildIndexedMesh(frame as never);
    expect(built.problems).toEqual([]);
    const geometry = built.object as unknown as { geometry: InstancedBufferGeometry };
    expect(geometry.geometry.instanceCount).toBe(2); // a run of 3 -> 2 segments

    const material = built.material as unknown as UniformMaterial;
    draw(built.object, view(false));
    expect(material.uniforms['u_lineWidth']?.value).toBeCloseTo(3.0625, 4);
  });

  it('draws at PyMOL default 1 when the bridge sends no width', () => {
    const frame = meshFrame(undefined);
    expect(meshWidthOf(frame.header as never)).toBe(1);
    const built = buildIndexedMesh(frame as never);
    const material = built.material as unknown as UniformMaterial;
    draw(built.object, view(false));
    expect(material.uniforms['u_lineWidth']?.value).toBeCloseTo(1.0208, 4);
  });

  it('refuses a nonsense width rather than making the mesh vanish', () => {
    expect(meshWidthOf({ meshWidth: 0 } as never)).toBe(1);
    expect(meshWidthOf({ meshWidth: -3 } as never)).toBe(1);
    expect(meshWidthOf({ meshWidth: Number.NaN } as never)).toBe(1);
    expect(meshWidthOf({ meshWidth: 'wide' } as never)).toBe(1);
  });

  it('still reports the strip problem when there is nothing to draw', () => {
    // One run of 1 vertex: no segment, so the old Points fallback and its
    // problem string must survive the quad path.
    const position = new Float32Array([0, 0, 0]);
    const strip = new Int32Array([1]);
    const payload = new Uint8Array(position.byteLength + strip.byteLength);
    payload.set(new Uint8Array(position.buffer), 0);
    payload.set(new Uint8Array(strip.buffer), position.byteLength);
    const built = buildIndexedMesh({
      header: {
        v: 1,
        kind: 'indexed-mesh',
        object: 'm',
        rep: 9,
        state: 0,
        counts: { verts: 1, tris: 0 },
        buffers: {
          position: { byteOffset: 0, byteLength: 12, dtype: 'f32', itemSize: 3 },
          strip: { byteOffset: 12, byteLength: 4, dtype: 'i32', itemSize: 1 },
        },
        proximity: false,
        oneColor: null,
        meshWidth: 3,
      },
      payload,
    } as never);
    expect(built.problems).toHaveLength(1);
    expect(built.problems[0]).toContain('no segments');
  });
});

/* ------------------------------------------------------------------ *
 * 5. the surface path is untouched
 * ------------------------------------------------------------------ */

describe('a triangle mesh is not affected', () => {
  it('still builds an indexed Mesh with the vertex material', () => {
    const position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const index = new Int32Array([0, 1, 2]);
    const payload = new Uint8Array(position.byteLength + index.byteLength);
    payload.set(new Uint8Array(position.buffer), 0);
    payload.set(new Uint8Array(index.buffer), position.byteLength);
    const built = buildIndexedMesh({
      header: {
        v: 1,
        kind: 'indexed-mesh',
        object: 'm',
        rep: 2,
        state: 0,
        counts: { verts: 3, tris: 1 },
        buffers: {
          position: { byteOffset: 0, byteLength: 36, dtype: 'f32', itemSize: 3 },
          index: { byteOffset: 36, byteLength: 12, dtype: 'i32', itemSize: 3 },
        },
        proximity: false,
        oneColor: null,
      },
      payload,
    } as never);
    expect(built.triangles).toBe(1);
    const geometry = (built.object as unknown as { geometry: BufferGeometry }).geometry;
    expect(geometry.getIndex()?.count).toBe(3);
    // The vertex material, which has no width uniform at all.
    expect((built.material as unknown as UniformMaterial).uniforms['u_lineWidth']).toBeUndefined();
  });
});
