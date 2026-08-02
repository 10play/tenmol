/**
 * Mode G: frame -> three.js objects.
 *
 * Two kinds of case here:
 *
 *  1. hand-built frames encoded with `@tenmol/protocol`'s OWN encoder, so the
 *     decode path is exercised against the normative layout;
 *  2. the real accessor output, if it has been generated
 *     (`packages/viewport/tools/pull_geometry.py --out <dir>` and
 *     `TENMOL_GEOMETRY_FIXTURES=<dir>`), which is skipped rather than faked
 *     when absent -- a fixture nobody can regenerate is worse than no fixture.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'vitest';

import {
  BINARY_FRAME_ALIGNMENT,
  CGOArrayBit,
  GLMode,
  Rep,
  alignUp,
  decodeGeometryFrame,
  encodeBinaryFrame,
  geometryKey,
  type CgoDrawArraysHeader,
  type IndexedMeshHeader,
} from '@tenmol/protocol';

import { buildGeometry, fanIndices, stripIndices } from '../src/modeG/frames';

describe('strip / fan re-indexing', () => {
  test('a triangle strip becomes the same triangles GL would rasterise', () => {
    // 5 verts -> 3 triangles, winding alternating (GL_TRIANGLE_STRIP).
    assert.deepEqual([...stripIndices(5)], [0, 1, 2, 2, 1, 3, 2, 3, 4]);
    assert.equal(stripIndices(2).length, 0);
    assert.equal(stripIndices(72).length, (72 - 2) * 3);
  });

  test('a triangle fan becomes triangles around vertex 0', () => {
    assert.deepEqual([...fanIndices(5)], [0, 1, 2, 0, 2, 3, 0, 3, 4]);
    assert.equal(fanIndices(1).length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * Hand-built frames
 * ------------------------------------------------------------------ */

function cgoFrameWithBlock(): Uint8Array {
  const nverts = 4;
  const arraybits = CGOArrayBit.Normal | CGOArrayBit.Color;
  // [vertex 3N][normal 3N][color 4N], CONSECUTIVE (packages/engine/layer1/CGO.cpp:1650-1671)
  const floats = new Float32Array(3 * nverts + 3 * nverts + 4 * nverts);
  for (let i = 0; i < nverts; i++) {
    floats[i * 3] = i;
    floats[3 * nverts + i * 3 + 2] = 1; // normals = +z
    floats.set([1, 0, 0, 1], 6 * nverts + i * 4);
  }
  const payload = new Uint8Array(floats.buffer);
  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    object: 'm',
    state: 0,
    rep: Rep.Cartoon,
    seq: 1,
    payloadBytes: payload.byteLength,
    blocks: [
      {
        mode: GLMode.TriangleStrip,
        arraybits,
        nverts,
        data: { byteOffset: 0, byteLength: payload.byteLength, dtype: 'f32', itemSize: 1 },
      },
    ],
    instances: [],
  };
  return new Uint8Array(encodeBinaryFrame(header, payload));
}

function sphereInstanceFrame(count: number): Uint8Array {
  const data = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    data.set([i, 0, 0, 1.5, 1, 0.5, 0.25, 1], i * 8);
  }
  const atoms = new Int32Array(count).map((_, i) => i);
  const dataBytes = new Uint8Array(data.buffer);
  const atomOffset = alignUp(dataBytes.byteLength, BINARY_FRAME_ALIGNMENT);
  const payload = new Uint8Array(atomOffset + atoms.byteLength);
  payload.set(dataBytes, 0);
  payload.set(new Uint8Array(atoms.buffer), atomOffset);
  const header: CgoDrawArraysHeader = {
    v: 1,
    kind: 'cgo-draw-arrays',
    object: 'm',
    state: 0,
    rep: Rep.Sphere,
    seq: 2,
    payloadBytes: payload.byteLength,
    blocks: [],
    instances: [
      {
        kind: 'sphere',
        count,
        itemSize: 8,
        data: { byteOffset: 0, byteLength: dataBytes.byteLength, dtype: 'f32', itemSize: 8 },
        atom: { byteOffset: atomOffset, byteLength: atoms.byteLength, dtype: 'i32', itemSize: 1 },
      },
    ],
  };
  return new Uint8Array(encodeBinaryFrame(header, payload));
}

function meshFrame(verts: number, tris: number): Uint8Array {
  const position = new Float32Array(verts * 3);
  const index = new Int32Array(tris * 3);
  for (let i = 0; i < tris * 3; i++) index[i] = i % verts;
  const payload = new Uint8Array(position.byteLength + index.byteLength);
  payload.set(new Uint8Array(position.buffer), 0);
  payload.set(new Uint8Array(index.buffer), position.byteLength);
  const header: IndexedMeshHeader = {
    v: 1,
    kind: 'indexed-mesh',
    object: 'm',
    state: 0,
    rep: Rep.Surface,
    seq: 3,
    payloadBytes: payload.byteLength,
    counts: { verts, tris },
    buffers: {
      position: { byteOffset: 0, byteLength: position.byteLength, dtype: 'f32', itemSize: 3 },
      index: {
        byteOffset: position.byteLength,
        byteLength: index.byteLength,
        dtype: 'i32',
        itemSize: 3,
      },
    },
    proximity: false,
    oneColor: [0.2, 0.4, 1],
  };
  return new Uint8Array(encodeBinaryFrame(header, payload));
}

describe('buildGeometry', () => {
  test('a CGO_DRAW_ARRAYS strip block becomes ONE indexed mesh, buffers unmodified', () => {
    const frame = decodeGeometryFrame(cgoFrameWithBlock());
    const built = buildGeometry(frame);
    assert.deepEqual(built.problems, []);
    assert.equal(built.stats.drawCalls, 1);
    assert.equal(built.stats.triangles, 2); // 4 verts in a strip
    assert.equal(built.stats.vertices, 4);
    assert.equal(built.key, geometryKey({ object: 'm', state: 0, rep: Rep.Cartoon }));

    const mesh = built.object.children[0] as unknown as {
      geometry: {
        getAttribute(name: string): { array: Float32Array; itemSize: number } | undefined;
      };
    };
    const position = mesh.geometry.getAttribute('position');
    assert.equal(position?.itemSize, 3);
    // Zero copy: the attribute is a view onto the frame payload.
    assert.equal(position?.array.buffer, frame.payload.buffer);
    assert.deepEqual([...position!.array.slice(0, 3)], [0, 0, 0]);
    assert.deepEqual([...position!.array.slice(3, 6)], [1, 0, 0]);
    const normal = mesh.geometry.getAttribute('normal');
    assert.deepEqual([...normal!.array.slice(0, 3)], [0, 0, 1]);
    const color = mesh.geometry.getAttribute('color');
    assert.equal(color?.itemSize, 4);
    built.dispose();
  });

  test('spheres are ONE instanced draw, never tessellated', () => {
    const frame = decodeGeometryFrame(sphereInstanceFrame(660));
    const built = buildGeometry(frame);
    assert.deepEqual(built.problems, []);
    assert.equal(built.stats.drawCalls, 1);
    assert.equal(built.stats.instances, 660);
    assert.equal(built.stats.triangles, 0); // no triangles were generated

    const mesh = built.object.children[0] as unknown as {
      geometry: {
        instanceCount: number;
        getAttribute(
          name: string,
        ): { itemSize: number; offset?: number; count: number } | undefined;
        index: { count: number } | null;
      };
    };
    assert.equal(mesh.geometry.instanceCount, 660);
    // The quad is 4 vertices / 2 triangles TOTAL, shared by all 660 spheres.
    assert.equal(mesh.geometry.index?.count, 6);
    const centre = mesh.geometry.getAttribute('a_centerRadius');
    const colour = mesh.geometry.getAttribute('a_color');
    assert.equal(centre?.itemSize, 4);
    assert.equal(centre?.offset, 0);
    assert.equal(colour?.offset, 4); // interleaved, stride 8
    built.dispose();
  });

  test('an indexed mesh becomes one draw with the triangle count it declares', () => {
    const frame = decodeGeometryFrame(meshFrame(5235, 10472));
    const built = buildGeometry(frame);
    assert.deepEqual(built.problems, []);
    assert.equal(built.stats.drawCalls, 1);
    assert.equal(built.stats.triangles, 10472);
    assert.equal(built.stats.vertices, 5235);
    built.dispose();
  });

  test('an instance kind with no impostor is REPORTED, not silently dropped', () => {
    const frame = decodeGeometryFrame(sphereInstanceFrame(2));
    // Rewrite the kind to one we cannot draw yet.
    (frame.header as CgoDrawArraysHeader).instances[0]!.kind = 'cone';
    const built = buildGeometry(frame);
    assert.equal(built.stats.drawCalls, 0);
    assert.equal(built.problems.length, 1);
    assert.match(built.problems[0]!, /cone/);
    built.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * Real accessor output, when it has been generated
 * ------------------------------------------------------------------ */

const FIXTURES = process.env['TENMOL_GEOMETRY_FIXTURES'];

describe.skipIf(FIXTURES === undefined || !existsSync(FIXTURES ?? ''))(
  'real _cmd.web_get_rep_geometry output',
  () => {
    test('every generated frame decodes and builds', () => {
      const dir = FIXTURES as string;
      const files = readdirSync(dir).filter((name) => name.endsWith('.bin'));
      assert.ok(files.length > 0, 'no .bin fixtures in ' + dir);
      for (const file of files) {
        const bytes = new Uint8Array(readFileSync(join(dir, file)));
        const frame = decodeGeometryFrame(bytes);
        const built = buildGeometry(frame);
        assert.deepEqual(built.problems, [], `${file}: ${built.problems.join('; ')}`);
        assert.ok(
          built.stats.drawCalls > 0,
          `${file} produced no draw calls (${JSON.stringify(built.stats)})`,
        );
        built.dispose();
      }
    });
  },
);
