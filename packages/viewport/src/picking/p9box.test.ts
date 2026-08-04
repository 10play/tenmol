/**
 * The rubber-band box query (parity row 149: "rubber band would be a box query
 * over the existing `picking/pick.ts` index").
 *
 * The band and the click MUST share a projection, or a user sees a click and a
 * band disagree about which atom is where. `screenPoint` is asserted here to be
 * the exact inverse of `screenRay` rather than a second implementation of the
 * same arithmetic.
 */

import { describe, expect, it } from 'vitest';

import { toViewMatrix } from '@tenmol/protocol';

import { createPickIndex } from './pick';
import { screenPoint, screenRay } from './ray';

const perspective = toViewMatrix([
  1, 0, 0, 0, 1, 0, 0, 0, 1, // identity rotation
  0, 0, -100, // camera position
  0, 0, 0, // model origin
  80, 120, -20, // front / back / NEGATIVE == perspective
]);

const ortho = toViewMatrix([
  1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -100, 0, 0, 0, 80, 120, 20,
]);

const rect = { width: 800, height: 600 };

/** A sphere-instance frame: `[x, y, z, r]` per atom, with pick identities. */
function spheres(points: Array<[number, number, number]>, object = 'zz') {
  const data = new Float32Array(points.flatMap(([x, y, z]) => [x, y, z, 1]));
  const atom = new Int32Array(points.map((_, i) => i));
  const bond = new Int32Array(points.map(() => -1));
  const bytes = new Uint8Array(data.byteLength + atom.byteLength + bond.byteLength);
  bytes.set(new Uint8Array(data.buffer), 0);
  bytes.set(new Uint8Array(atom.buffer), data.byteLength);
  bytes.set(new Uint8Array(bond.buffer), data.byteLength + atom.byteLength);
  return {
    header: {
      v: 1 as const,
      kind: 'cgo-draw-arrays' as const,
      object,
      rep: 7,
      state: 0,
      blocks: [],
      instances: [
        {
          kind: 'sphere' as const,
          count: points.length,
          itemSize: 4,
          data: {
            byteOffset: 0,
            byteLength: data.byteLength,
            dtype: 'f32' as const,
            itemSize: 4,
          },
          atom: {
            byteOffset: data.byteLength,
            byteLength: atom.byteLength,
            dtype: 'i32' as const,
            itemSize: 1,
          },
          bond: {
            byteOffset: data.byteLength + atom.byteLength,
            byteLength: bond.byteLength,
            dtype: 'i32' as const,
            itemSize: 1,
          },
        },
      ],
    },
    payload: bytes,
  } as never;
}

describe('screenPoint is the inverse of screenRay', () => {
  it('round-trips a pixel through the perspective projection', () => {
    for (const [x, y] of [
      [400, 300],
      [10, 10],
      [799, 599],
      [123, 456],
    ]) {
      const ray = screenRay(perspective, rect, x!, y!);
      // Walk 60 units down the ray, which is inside the slab.
      const depth = 60;
      const t = depth / -ray.direction[2];
      const p: [number, number, number] = [
        ray.origin[0] + ray.direction[0] * t,
        ray.origin[1] + ray.direction[1] * t,
        ray.origin[2] + ray.direction[2] * t,
      ];
      const back = screenPoint(perspective, rect, p);
      expect(back.x).toBeCloseTo(x!, 4);
      expect(back.y).toBeCloseTo(y!, 4);
      expect(back.behind).toBe(false);
    }
  });

  it('round-trips under an orthoscopic projection too', () => {
    const ray = screenRay(ortho, rect, 250, 175);
    const back = screenPoint(ortho, rect, ray.origin);
    expect(back.x).toBeCloseTo(250, 4);
    expect(back.y).toBeCloseTo(175, 4);
  });

  it('reports a point behind the eye rather than projecting it in front', () => {
    expect(screenPoint(perspective, rect, [0, 0, 10]).behind).toBe(true);
  });
});

describe('pickIndex.box', () => {
  it('takes exactly the atoms whose projection lands inside the rectangle', () => {
    const index = createPickIndex();
    // At z = -100 in EYE space the model sits 100 units away; the three atoms
    // are spread horizontally so their projections are far apart.
    index.apply(spheres([
      [0, 0, 0], // dead centre
      [12, 0, 0], // right, but inside the ~20 degree frustum
      [-12, 0, 0], // left
    ]));

    const centre = screenPoint(perspective, rect, [0, 0, -100]);
    const right = screenPoint(perspective, rect, [12, 0, -100]);
    expect(right.x).toBeGreaterThan(centre.x + 50);

    const tight = index.box(perspective, rect, {
      left: centre.x - 5,
      top: centre.y - 5,
      right: centre.x + 5,
      bottom: centre.y + 5,
    });
    expect(tight).toEqual([{ object: 'zz', index: 0 }]);

    const wide = index.box(perspective, rect, {
      left: 0,
      top: 0,
      right: rect.width,
      bottom: rect.height,
    });
    expect(wide.map((h) => h.index).sort()).toEqual([0, 1, 2]);

    const empty = index.box(perspective, rect, { left: 0, top: 0, right: 1, bottom: 1 });
    expect(empty).toEqual([]);
  });

  it('keeps objects apart and never repeats an atom', () => {
    const index = createPickIndex();
    index.apply(spheres([[0, 0, 0]], 'aa'));
    index.apply(spheres([[0, 0, 0]], 'bb'));
    const all = index.box(perspective, rect, {
      left: 0,
      top: 0,
      right: rect.width,
      bottom: rect.height,
    });
    expect(all).toEqual([
      { object: 'aa', index: 0 },
      { object: 'bb', index: 0 },
    ]);
  });

  it('honours a rep filter, so a band can be scoped the way a pick is', () => {
    const index = createPickIndex();
    index.apply(spheres([[0, 0, 0]]));
    const band = { left: 0, top: 0, right: rect.width, bottom: rect.height };
    expect(index.box(perspective, rect, band, { reps: [7] })).toHaveLength(1);
    expect(index.box(perspective, rect, band, { reps: [5] })).toHaveLength(0);
  });

  it('agrees with the ray cast: an atom the band takes is one a click hits', () => {
    const index = createPickIndex();
    index.apply(spheres([
      [0, 0, 0],
      [12, 0, 0],
    ]));
    const target = screenPoint(perspective, rect, [12, 0, -100]);
    const hit = index.pick(perspective, rect, target.x, target.y);
    expect(hit?.index).toBe(1);
    const band = index.box(perspective, rect, {
      left: target.x - 2,
      top: target.y - 2,
      right: target.x + 2,
      bottom: target.y + 2,
    });
    expect(band).toEqual([{ object: 'zz', index: 1 }]);
  });
});
