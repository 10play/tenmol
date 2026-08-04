/**
 * Parity row 131, the dots half: `RepDot::VN` reaches the shader.
 *
 * The row has said "dots ... UNLIT because the wire buffer carries no normal"
 * since wave 2. The accessor always returned one per dot; the `sphere` instance
 * record is 8 floats and has no slot for it, and widening that record would
 * break every size check on the wire. So the normal rides as an OPTIONAL
 * SUB-BUFFER on the instance — the same shape `atom`, `bond` and `atom2`
 * already use — and this file pins the three things that makes true:
 *
 *   1. a frame that carries `normal` produces a lit point cloud;
 *   2. a frame that does not is byte-for-byte the old flat one;
 *   3. a normal buffer that is too short is IGNORED rather than half-applied
 *      (three would otherwise read past the end and light the tail of the
 *      cloud with whatever follows it in the payload).
 *
 * The bridge half is `packages/bridge/tests/test_p10_viewport.py`, which measured 647
 * unit normals on a real `dots` frame.
 */

import {
  INSTANCE_ITEM_SIZE,
  decodeGeometryFrame,
  encodeGeometryFrame,
  type InstanceBuffer,
} from '@tenmol/protocol';
import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import { buildGeometry } from './builder';
import { buildInstancedDraw } from './instances';

type PointObject = { geometry: BufferGeometry };
type UniformMaterial = { uniforms: Record<string, { value: unknown }>; fragmentShader: string; vertexShader: string };

const ref = { byteOffset: 0, byteLength: 0, dtype: 'f32' as const, itemSize: 1 };

/** Radius 0 == "screen-space point of `dot_width` pixels" (`RepDot`). */
function dotBuffer(count: number): InstanceBuffer {
  return { kind: 'sphere', count, itemSize: INSTANCE_ITEM_SIZE.sphere, data: ref };
}

/** `count` dots at x = i, radius 0, opaque white. */
function dotData(count: number): Float32Array {
  const data = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    data[i * 8] = i;
    data[i * 8 + 3] = 0; // radius: this is what makes it a POINT
    data.set([1, 1, 1, 1], i * 8 + 4);
  }
  return data;
}

describe('a dots frame with normals is lit', () => {
  it('binds the normal attribute and turns the shader branch on', () => {
    const normal = new Float32Array([0, 0, 1, 0, 1, 0]);
    const draw = buildInstancedDraw(dotBuffer(2), dotData(2), { normal });
    expect(draw).not.toBeNull();
    expect(draw!.points).toBe(true);

    const geometry = (draw!.object as unknown as PointObject).geometry;
    expect(Array.from(geometry.getAttribute('normal').array as Float32Array)).toEqual([
      0, 0, 1, 0, 1, 0,
    ]);
    const material = draw!.material as unknown as UniformMaterial;
    expect(material.uniforms['u_hasNormal']?.value).toBe(true);
    // The branch it enables is PyMOL's own `ApplyLighting`, not a second model.
    expect(material.fragmentShader).toContain('if (u_hasNormal) color = ApplyLighting');
    expect(material.vertexShader).toContain('normalMatrix * normal');
  });

  it('is still flat when the frame carries no normal', () => {
    const draw = buildInstancedDraw(dotBuffer(2), dotData(2));
    const geometry = (draw!.object as unknown as PointObject).geometry;
    expect(geometry.getAttribute('normal')).toBeUndefined();
    expect((draw!.material as unknown as UniformMaterial).uniforms['u_hasNormal']?.value).toBe(
      false,
    );
  });

  it('ignores a normal buffer that is shorter than the cloud', () => {
    // 3 dots, 2 normals: binding it would light dot 2 from memory past the end.
    const draw = buildInstancedDraw(dotBuffer(3), dotData(3), {
      normal: new Float32Array([0, 0, 1, 0, 1, 0]),
    });
    const geometry = (draw!.object as unknown as PointObject).geometry;
    expect(geometry.getAttribute('normal')).toBeUndefined();
    expect((draw!.material as unknown as UniformMaterial).uniforms['u_hasNormal']?.value).toBe(
      false,
    );
  });
});

describe('the sub-buffer survives a real encode/decode round trip', () => {
  /** The frame the bridge's `_dots` packer produces, built here by hand. */
  function dotsFrame(count: number, withNormal: boolean) {
    const data = dotData(count);
    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) normals.set([0, 0, 1], i * 3);
    const payload = new Uint8Array(data.byteLength + normals.byteLength);
    payload.set(new Uint8Array(data.buffer), 0);
    payload.set(new Uint8Array(normals.buffer), data.byteLength);
    const instance: Record<string, unknown> = {
      kind: 'sphere',
      count,
      itemSize: 8,
      data: { byteOffset: 0, byteLength: data.byteLength, dtype: 'f32', itemSize: 8 },
    };
    if (withNormal) {
      instance['normal'] = {
        byteOffset: data.byteLength,
        byteLength: normals.byteLength,
        dtype: 'f32',
        itemSize: 3,
      };
    }
    return {
      header: {
        v: 1 as const,
        kind: 'cgo-draw-arrays' as const,
        object: 'm',
        rep: 8, // dots
        state: 0,
        blocks: [],
        instances: [instance],
        pointSize: 2,
        dotSize: 0,
      },
      payload,
    } as never;
  }

  /** Encode and decode for real: the offsets must survive the wire, not a cast. */
  function roundTrip(count: number, withNormal: boolean) {
    const frame = dotsFrame(count, withNormal) as unknown as {
      header: never;
      payload: Uint8Array;
    };
    return decodeGeometryFrame(encodeGeometryFrame(frame.header, frame.payload));
  }

  it('lights the cloud built from an encoded-then-decoded frame', () => {
    const decoded = roundTrip(4, true);
    // The optional ref survived the JSON header ...
    const instance = (decoded.header as unknown as { instances: Array<Record<string, unknown>> })
      .instances[0];
    expect(instance?.['normal']).toEqual({
      byteOffset: 4 * 8 * 4,
      byteLength: 4 * 3 * 4,
      dtype: 'f32',
      itemSize: 3,
    });
    // ... and the draw built from it is lit.
    const built = buildGeometry(decoded);
    expect(built.problems).toEqual([]);
    expect(built.stats.instances).toBe(4);
    const material = built.materials[0] as unknown as UniformMaterial;
    expect(material.uniforms['u_hasNormal']?.value).toBe(true);
  });

  it('draws the same frame flat when the sub-buffer is absent', () => {
    const built = buildGeometry(roundTrip(4, false));
    expect(built.problems).toEqual([]);
    const material = built.materials[0] as unknown as UniformMaterial;
    expect(material.uniforms['u_hasNormal']?.value).toBe(false);
  });
});
