/**
 * Parity row 372: an `isomesh`/`isodot` OBJECT now arrives as a mesh frame, and
 * the two mean DIFFERENT primitives by the same buffers.
 *
 * The C++ side (`layer4/CmdWebGeometry.cpp`) serves `ObjectMeshState::N` / `::V`
 * through the envelope `RepMesh` already used, so `buildIndexedMesh` draws an
 * isomesh with no change at all. `isodot` is the trap: it carries the identical
 * `strip` buffer and `ObjectMesh::render` opens GL_POINTS for it
 * (`layer2/ObjectMesh.cpp:768,803`), so expanding the runs as line strips draws
 * a polyline through the whole dot cloud.
 *
 * MEASURED on a real gaussian map of `test/dat/pept.pdb` (the bridge half is
 * `bridge/tests/test_p11_geom.py`):
 *   isomesh 1.0 sigma -> 12,536 vertices in 212 runs
 *   isodot  1.0 sigma ->  6,162 vertices in ONE run
 * so the isodot frame is exactly the shape that goes most wrong.
 */

import type { BufferGeometry, Object3D } from 'three';
import { describe, expect, it } from 'vitest';

import type { GeometryFrame, IndexedMeshHeader } from '@tenmol/protocol';

import { buildIndexedMesh, isDotMesh, stripLineIndices } from './mesh';

/** `InstancedBufferGeometry` narrowed to what these assertions read. */
type Instanced = BufferGeometry & { instanceCount?: number };

/**
 * A mesh frame with `position` + `strip`, laid out exactly as the bridge's
 * `_strip_mesh` packs it (4-byte aligned, position first).
 */
function meshFrame(
  runs: readonly number[],
  meshType: number | undefined,
): GeometryFrame<IndexedMeshHeader> {
  const verts = runs.reduce((a, b) => a + b, 0);
  const payload = new Uint8Array(verts * 12 + runs.length * 4);
  const xyz = new Float32Array(payload.buffer, 0, verts * 3);
  for (let i = 0; i < verts; i++) {
    xyz[i * 3] = i * 0.5;
    xyz[i * 3 + 1] = (i % 7) * 0.25;
    xyz[i * 3 + 2] = (i % 3) * 0.125;
  }
  new Int32Array(payload.buffer, verts * 12, runs.length).set(runs);

  const header = {
    v: 1,
    kind: 'indexed-mesh',
    object: 'w1_map',
    state: 0,
    rep: 8,
    seq: 1,
    payloadBytes: payload.byteLength,
    counts: { verts, tris: 0 },
    buffers: {
      position: { byteOffset: 0, byteLength: verts * 12, dtype: 'f32', itemSize: 3 },
      strip: {
        byteOffset: verts * 12,
        byteLength: runs.length * 4,
        dtype: 'i32',
        itemSize: 1,
      },
    },
    proximity: false,
    oneColor: [1, 1, 1],
    nStrip: runs.length,
    ...(meshType === undefined ? {} : { meshType }),
  } as unknown as IndexedMeshHeader;

  return { header, payload };
}

function geometryOf(object: Object3D): Instanced {
  return (object as unknown as { geometry: Instanced }).geometry;
}

describe('isDotMesh', () => {
  it('is true only for cIsomeshMode::isodot', () => {
    expect(isDotMesh(meshFrame([4], 1).header)).toBe(true);
    expect(isDotMesh(meshFrame([4], 0).header)).toBe(false);
    expect(isDotMesh(meshFrame([4], 3).header)).toBe(false); // gradient
    expect(isDotMesh(meshFrame([4], undefined).header)).toBe(false);
  });
});

describe('an isomesh frame draws line segments', () => {
  it('expands 212 runs of 12,536 vertices into the segments PyMOL would draw', () => {
    // The measured shape of `isomesh w1, map, 1.0`: one huge run plus 211 small
    // ones. Reproduced here at 1/1000 scale so the test stays instant, with the
    // same property that matters: segments = verts - runs.
    const runs = [200, ...Array.from({ length: 11 }, (_, i) => i + 2)];
    const verts = runs.reduce((a, b) => a + b, 0);
    const built = buildIndexedMesh(meshFrame(runs, 0));

    expect(built.problems).toEqual([]);
    expect(built.vertices).toBe(verts);
    // Not a point cloud: the quad-line path, one instance per segment.
    expect(built.object.type).not.toBe('Points');
    expect(geometryOf(built.object).instanceCount).toBe(verts - runs.length);
    expect(stripLineIndices(runs, verts)).toHaveLength((verts - runs.length) * 2);
  });

  it('still draws lines when the bridge sends no meshType at all', () => {
    const built = buildIndexedMesh(meshFrame([5, 5], undefined));
    expect(built.object.type).not.toBe('Points');
    expect(geometryOf(built.object).instanceCount).toBe(8);
  });
});

describe('an isodot frame draws points', () => {
  it('keeps every dot and connects none of them', () => {
    // The real isodot shape: ONE run over the whole cloud.
    const built = buildIndexedMesh(meshFrame([64], 1));

    expect(built.object.type).toBe('Points');
    expect(built.problems).toEqual([]);
    expect(built.vertices).toBe(64);
    expect(built.triangles).toBe(0);

    const geometry = geometryOf(built.object);
    expect(geometry.getAttribute('position').count).toBe(64);
    // The trap: as a line strip this same buffer is 63 segments of nonsense.
    expect(geometry.getIndex()).toBeNull();
    expect(stripLineIndices([64], 64)).toHaveLength(63 * 2);
  });

  it('draws points even when the dots arrive in many runs', () => {
    const built = buildIndexedMesh(meshFrame([3, 3, 3], 1));
    expect(built.object.type).toBe('Points');
    expect(geometryOf(built.object).getAttribute('position').count).toBe(9);
  });
});
