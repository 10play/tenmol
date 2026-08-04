/**
 * Defect D2 — Mode P and Mode G must not both draw the same rep.
 *
 * The invariant every test here checks is one sentence: **a rep is drawn by
 * exactly one renderer**. `drawing` is what three.js paints and
 * `PixelFrameHeader.reps` is what the bitmap already contains, so the property
 * to hold is `drawing INTERSECT reps === []` in every state, including the
 * transitional ones (declaration in flight, old bridge, ray still on screen).
 */

import { describe, expect, it, vi } from 'vitest';

import { Rep, type RepRenderState } from '@tenmol/protocol';

import { compose, declaration } from './composition';
import { createCompositor, PIXEL_STREAM_FN, type CompositorTransport } from './wiring';

function state(
  rep: number,
  effective: 'pixel' | 'geometry',
  requested = effective,
): RepRenderState {
  return { rep, requested, effective };
}

const CARTOON = Rep.Cartoon; // 5
const STICKS = Rep.Cyl; // 0
const SURFACE = Rep.Surface; // 2

function fakeTransport(): CompositorTransport & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    call(fn: string, args?: unknown[], kwargs?: Record<string, unknown>) {
      calls.push([fn, args, kwargs]);
      return Promise.resolve({});
    },
  };
}

describe('declaration', () => {
  it('declares only reps that are EFFECTIVELY Mode G', () => {
    // A rep that fell back is one three.js will not draw. Declaring it would
    // ask the bridge to stop drawing something nobody then draws — a hole,
    // which is worse than the double draw this is fixing.
    const states = [
      state(CARTOON, 'geometry'),
      state(SURFACE, 'pixel', 'geometry'), // requested but fell back
      state(STICKS, 'pixel'),
    ];
    expect(declaration(states)).toEqual([CARTOON]);
  });

  it('is sorted and de-duplicated so change detection is a plain compare', () => {
    expect(declaration([state(CARTOON, 'geometry'), state(STICKS, 'geometry')])).toEqual([
      STICKS,
      CARTOON,
    ]);
  });
});

describe('compose — the no-double-draw invariant', () => {
  const states = [state(CARTOON, 'geometry'), state(STICKS, 'pixel')];

  it('draws NOTHING before the first frame: the server is assumed to draw all', () => {
    const c = compose(states, null);
    expect(c.drawing).toEqual([]);
    expect(c.suppressed).toEqual([CARTOON]);
    expect(c.awaitingFirstFrame).toBe(true);
  });

  it('draws NOTHING when `reps` is absent — that is the pre-D2 bridge', () => {
    // This is the actual defect: the old bridge never set `reps`, and the old
    // client drew anyway.
    const c = compose(states, {});
    expect(c.drawing).toEqual([]);
    expect(c.rasterizing).toBe(true);
  });

  it('draws the declared rep once the bitmap says it is not in it', () => {
    const c = compose(states, { reps: [STICKS] });
    expect(c.drawing).toEqual([CARTOON]);
    expect(c.suppressed).toEqual([]);
    expect(c.rasterizing).toBe(true);
  });

  it('suppresses a declared rep the bridge could not stop drawing', () => {
    // Mixed on ONE object: cartoon and sticks live on the same object, so
    // `cmd.disable` cannot mask one without the other and the bridge keeps
    // both. The client must back off, or the cartoon is drawn twice.
    const c = compose(states, { reps: [STICKS, CARTOON] });
    expect(c.drawing).toEqual([]);
    expect(c.suppressed).toEqual([CARTOON]);
  });

  it('recognises the GL-free state: reps [] means the bitmap is background only', () => {
    const c = compose([state(CARTOON, 'geometry')], { reps: [] });
    expect(c.drawing).toEqual([CARTOON]);
    expect(c.rasterizing).toBe(false);
  });

  it('backs off completely for a ray still, which is always the full scene', () => {
    const all = { reps: [STICKS, CARTOON, SURFACE] };
    const c = compose([state(CARTOON, 'geometry'), state(SURFACE, 'geometry')], all);
    expect(c.drawing).toEqual([]);
  });

  it('never lets drawing and reps intersect, over every subset', () => {
    const declared: number[] = [STICKS, SURFACE, CARTOON];
    const ds = declared.map((r) => state(r, 'geometry'));
    for (let mask = 0; mask < 8; mask++) {
      const reps = declared.filter((_, i) => (mask >> i) & 1);
      const c = compose(ds, { reps });
      expect(c.drawing.filter((r) => reps.includes(r))).toEqual([]);
      expect([...c.drawing, ...c.suppressed].sort((a, b) => a - b)).toEqual(
        [...declared].sort((a, b) => a - b),
      );
    }
  });
});

describe('createCompositor', () => {
  it('declares to the bridge exactly once per distinct declaration', async () => {
    const transport = fakeTransport();
    const c = createCompositor({ transport, draw: vi.fn(), suppress: vi.fn() });
    c.setPolicy([state(CARTOON, 'geometry'), state(STICKS, 'pixel')]);
    c.setPolicy([state(CARTOON, 'geometry'), state(STICKS, 'pixel')]); // no change
    await Promise.resolve();
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.[0]).toBe(PIXEL_STREAM_FN);
    expect(transport.calls[0]?.[2]).toEqual({ geometryReps: [CARTOON] });
    c.setPolicy([state(CARTOON, 'geometry'), state(STICKS, 'geometry')]);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.[2]).toEqual({ geometryReps: [STICKS, CARTOON] });
  });

  it('switches the renderer exactly on the transitions, not on every frame', () => {
    const draw = vi.fn();
    const suppress = vi.fn();
    const c = createCompositor({ transport: fakeTransport(), draw, suppress });
    c.setPolicy([state(CARTOON, 'geometry'), state(STICKS, 'pixel')]);
    expect(draw).not.toHaveBeenCalled();

    expect(c.observeFrame({ reps: [STICKS] })).toBe(true);
    expect(draw).toHaveBeenCalledWith(CARTOON);
    expect(c.shouldDraw(CARTOON)).toBe(true);

    // Ten more identical frames must not re-request anything.
    for (let i = 0; i < 10; i++) expect(c.observeFrame({ reps: [STICKS] })).toBe(false);
    expect(draw).toHaveBeenCalledTimes(1);

    // The user shows cartoon on a second, unmaskable object: the bridge takes
    // it back and we must stop drawing it.
    expect(c.observeFrame({ reps: [STICKS, CARTOON] })).toBe(true);
    expect(suppress).toHaveBeenCalledWith(CARTOON);
    expect(c.shouldDraw(CARTOON)).toBe(false);
  });

  it('a bridge with no pixel stream at all is the GL-free case, not a broken one', () => {
    const draw = vi.fn();
    const c = createCompositor({ transport: fakeTransport(), draw, suppress: vi.fn() });
    c.setPolicy([state(CARTOON, 'geometry')]);
    expect(c.shouldDraw(CARTOON)).toBe(false); // still waiting
    c.setStreamAvailable(false);
    expect(draw).toHaveBeenCalledWith(CARTOON);
    expect(c.shouldDraw(CARTOON)).toBe(true);
    expect(c.state.rasterizing).toBe(false);
  });

  it('reports once, and stops asking, when the bridge rejects geometryReps', async () => {
    const onError = vi.fn();
    const transport: CompositorTransport = {
      call: () => Promise.reject(new Error('unknown pixel stream parameter')),
    };
    const c = createCompositor({ transport, draw: vi.fn(), suppress: vi.fn(), onError });
    c.setPolicy([state(CARTOON, 'geometry')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    c.setPolicy([state(CARTOON, 'geometry'), state(STICKS, 'geometry')]);
    expect(c.stats().supported).toBe(false);
    // And the fallback is safe: the header stays absent, so nothing is drawn
    // twice — Mode G simply does not run.
    expect(c.observeFrame({})).toBe(false);
    expect(c.shouldDraw(CARTOON)).toBe(false);
  });

  it('stops declaring after destroy()', () => {
    const transport = fakeTransport();
    const c = createCompositor({ transport, draw: vi.fn(), suppress: vi.fn() });
    c.destroy();
    c.setPolicy([state(CARTOON, 'geometry')]);
    expect(transport.calls).toHaveLength(0);
  });
});
