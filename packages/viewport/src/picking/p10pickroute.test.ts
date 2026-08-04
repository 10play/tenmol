/**
 * Parity row 418, the client half: a viewport click has to be able to name a
 * BOND (two atom indices) and to reach something other than `cmd.select`.
 *
 * Both halves were missing and they are one gap, not two. `PickHit` carried
 * `{index, bond}` — one atom plus PyMOL's bond INDEX, which is -1
 * (`cPickableAtom`) on every instance a stick rep emits — so nothing a click
 * produced could be handed to `cmd.builder_pick(..., mode='bond')`, whose
 * signature is `(object, index, index2, mode)` and which does
 * `cmd.edit(a, b, pkbond=1)`. And `viewport.ts` turned every hit into
 * `cmd.select('sele', ...)` with no seam, so even an atom pick could not reach
 * the Builder.
 *
 * What is asserted here:
 *   * a stick cylinder's two ends come back as `index` + `index2`, and which is
 *     which depends on WHICH HALF was hit (PyMOL splits a half-bond at the
 *     midpoint — `RepCylBond` colours it the same way);
 *   * a sphere hit reports `index2: null`, so "this is a bond" is decidable;
 *   * the route registry consumes, orders, unregisters and survives a throw.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { toViewMatrix } from '@tenmol/protocol';

import { createPickIndex, type PickHit } from './pick';
import { screenPoint } from './ray';
import {
  dispatchViewportPick,
  pickRouteCount,
  pickSelectionName,
  registerPickRoute,
  resetPickRoutes,
  routeViewportPick,
} from './route';

const view = toViewMatrix([
  1, 0, 0, 0, 1, 0, 0, 0, 1, // identity rotation
  0, 0, -100, // camera 100 units back
  0, 0, 0, // origin
  80, 120, -20, // perspective
]);

const rect = { width: 800, height: 600 };

/**
 * One stick: a cylinder instance `[x, y, z, ax, ay, az, r]` carrying BOTH atom
 * ids, which is what `RepCylBond` emits per half-bond (`atom` = `pick`,
 * `atom2` = `pick2`).
 */
function stick(
  v1: [number, number, number],
  axis: [number, number, number],
  radius: number,
  a: number,
  b: number,
  object = 'eth',
) {
  const data = new Float32Array([...v1, ...axis, radius, 0]);
  const atom = new Int32Array([a]);
  const atom2 = new Int32Array([b]);
  const bond = new Int32Array([-1]);
  const bytes = new Uint8Array(
    data.byteLength + atom.byteLength + atom2.byteLength + bond.byteLength,
  );
  let at = 0;
  bytes.set(new Uint8Array(data.buffer), at);
  const dataAt = at;
  at += data.byteLength;
  bytes.set(new Uint8Array(atom.buffer), at);
  const atomAt = at;
  at += atom.byteLength;
  bytes.set(new Uint8Array(atom2.buffer), at);
  const atom2At = at;
  at += atom2.byteLength;
  bytes.set(new Uint8Array(bond.buffer), at);
  const bondAt = at;
  return {
    header: {
      v: 1 as const,
      kind: 'cgo-draw-arrays' as const,
      object,
      rep: 5,
      state: 0,
      blocks: [],
      instances: [
        {
          kind: 'cylinder' as const,
          count: 1,
          itemSize: 8,
          data: { byteOffset: dataAt, byteLength: data.byteLength, dtype: 'f32' as const, itemSize: 8 },
          atom: { byteOffset: atomAt, byteLength: atom.byteLength, dtype: 'i32' as const, itemSize: 1 },
          atom2: {
            byteOffset: atom2At,
            byteLength: atom2.byteLength,
            dtype: 'i32' as const,
            itemSize: 1,
          },
          bond: { byteOffset: bondAt, byteLength: bond.byteLength, dtype: 'i32' as const, itemSize: 1 },
        },
      ],
    },
    payload: bytes,
  } as never;
}

/** One radius-1 sphere at the origin, with a pick identity and no second end. */
function sphere(index: number, object = 'eth') {
  const data = new Float32Array([0, 0, 0, 1]);
  const atom = new Int32Array([index]);
  const bond = new Int32Array([-1]);
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
          count: 1,
          itemSize: 4,
          data: { byteOffset: 0, byteLength: data.byteLength, dtype: 'f32' as const, itemSize: 4 },
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

describe('a picked stick names BOTH of its atoms', () => {
  it('gives the near half as index and the far half as index2, and swaps', () => {
    const pick = createPickIndex();
    // A bond from x = -4 to x = +4 at the model origin: the left half belongs
    // to atom 3, the right half to atom 9.
    pick.apply(stick([-4, 0, 0], [8, 0, 0], 0.25, 3, 9));

    const left = screenPoint(view, rect, [-2.5, 0, -100]);
    const right = screenPoint(view, rect, [2.5, 0, -100]);
    const leftHit = pick.pick(view, rect, left.x, left.y);
    const rightHit = pick.pick(view, rect, right.x, right.y);

    expect(leftHit?.kind).toBe('cylinder');
    expect([leftHit?.index, leftHit?.index2]).toEqual([3, 9]);
    // The same bond from the other side: the ids swap, so `index` is always
    // the atom the user actually clicked and `index2` is always the other end.
    expect([rightHit?.index, rightHit?.index2]).toEqual([9, 3]);
    // Both name the same PAIR, which is what a bond pick needs.
    expect([leftHit?.index, leftHit?.index2].sort()).toEqual(
      [rightHit?.index, rightHit?.index2].sort(),
    );
    // And PyMOL's bond index is NOT it: -1 on both, i.e. `cPickableAtom`.
    expect([leftHit?.bond, rightHit?.bond]).toEqual([-1, -1]);
  });

  it('reports index2 null for a hit that identifies a single atom', () => {
    const pick = createPickIndex();
    pick.apply(sphere(11));
    const centre = screenPoint(view, rect, [0, 0, -100]);
    const hit = pick.pick(view, rect, centre.x, centre.y);
    expect(hit?.kind).toBe('sphere');
    expect(hit?.index).toBe(11);
    expect(hit?.index2).toBeNull();
  });
});

describe('the pick route registry', () => {
  const hit: PickHit = {
    object: 'eth',
    rep: 5,
    state: 0,
    index: 3,
    index2: 9,
    bond: -1,
    distance: 12,
    kind: 'cylinder',
    ringRadius: 0,
  };

  beforeEach(() => resetPickRoutes());

  it('reports false with nothing registered, so the default selection runs', () => {
    expect(pickRouteCount()).toBe(0);
    expect(routeViewportPick(hit)).toBe(false);
  });

  it('offers the hit most-recently-registered first and stops at the taker', () => {
    const seen: string[] = [];
    registerPickRoute(() => {
      seen.push('first');
      return false;
    });
    registerPickRoute(() => {
      seen.push('second');
      return true;
    });
    registerPickRoute(() => {
      seen.push('third');
      return false;
    });
    expect(routeViewportPick(hit)).toBe(true);
    expect(seen).toEqual(['third', 'second']);
  });

  it('unregisters exactly the route it was given', () => {
    const off = registerPickRoute(() => true);
    registerPickRoute(() => false);
    expect(pickRouteCount()).toBe(2);
    off();
    expect(pickRouteCount()).toBe(1);
    expect(routeViewportPick(hit)).toBe(false);
  });

  it('skips a route that throws instead of losing the click', () => {
    const taken: PickHit[] = [];
    registerPickRoute((h) => {
      taken.push(h);
      return true;
    });
    registerPickRoute(() => {
      throw new Error('panel exploded');
    });
    expect(routeViewportPick(hit)).toBe(true);
    expect(taken).toEqual([hit]);
  });

  it('passes the hit through untouched, both atom ids included', () => {
    let got: PickHit | null = null;
    registerPickRoute((h) => {
      got = h;
      return true;
    });
    routeViewportPick(hit);
    expect(got).toEqual(hit);
  });
});

/**
 * `viewport.ts`'s onPick is `dispatchViewportPick(hit, select)` and nothing
 * else, because that file cannot be constructed without a WebGL2 context. What
 * has to hold is the ORDER: a route that ran AFTER `cmd.select` would leave an
 * editor pick and a rewritten `sele` fighting over one click.
 */
describe('dispatchViewportPick — what viewport.ts does with a hit', () => {
  const hit: PickHit = {
    object: 'eth',
    rep: 5,
    state: 0,
    index: 3,
    index2: null,
    bond: -1,
    distance: 12,
    kind: 'sphere',
    ringRadius: 0,
  };

  beforeEach(() => resetPickRoutes());

  it('selects when nothing is registered, 0-based index -> 1-based name', () => {
    const selected: string[] = [];
    expect(dispatchViewportPick(hit, (name) => selected.push(name))).toBe('selected');
    expect(selected).toEqual(['eth`4']);
    expect(pickSelectionName(hit)).toBe('eth`4');
  });

  it('does NOT select when a route consumed the hit', () => {
    const selected: string[] = [];
    registerPickRoute(() => true);
    expect(dispatchViewportPick(hit, (name) => selected.push(name))).toBe('routed');
    expect(selected).toEqual([]);
  });

  it('still selects when the only route declined', () => {
    const selected: string[] = [];
    registerPickRoute(() => false);
    expect(dispatchViewportPick(hit, (name) => selected.push(name))).toBe('selected');
    expect(selected).toEqual(['eth`4']);
  });

  it('quotes an object name with a backtick-worthy character verbatim', () => {
    expect(pickSelectionName({ ...hit, object: 'my obj', index: 0 })).toBe('my obj`1');
  });
});
