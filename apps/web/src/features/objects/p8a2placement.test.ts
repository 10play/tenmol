/**
 * Wave 8 — `PopPlaceChild`'s side-flip (`packages/engine/layer1/Pop.cpp:111-150`).
 *
 * The numbers below are the C ones: the child overlaps its parent by 2 px on
 * whichever side it lands, `PopFitBlock` keeps a 3 px margin, and the flip is
 * triggered by "the clamp moved me", not by a width comparison written here.
 */

import { describe, expect, it } from 'vitest';
import { POP_MARGIN, POP_SCROLL_PX, placeChild } from './placement';

const parent = { parentLeft: 100, parentRight: 300 };

describe('placeChild', () => {
  it('opens on the right by default, overlapping by 2 px', () => {
    const placed = placeChild({ ...parent, width: 180, viewportWidth: 1000 });
    expect(placed).toEqual({ left: 298, affinity: 'right', clamped: false });
  });

  it('flips to the left when the right side would be clamped', () => {
    // right target 498 + 180 + 3 = 681 > 520, so the right side does not fit;
    // the left target 300 - 180 + 2 = 122 does, and is taken unmodified.
    const placed = placeChild({
      parentLeft: 300,
      parentRight: 500,
      width: 180,
      viewportWidth: 520,
    });
    expect(placed).toEqual({ left: 122, affinity: 'left', clamped: false });
  });

  it('flips ONCE — a clamped left side is kept, not flipped back', () => {
    // `PopPlaceChild` only re-tests after the FIRST placement, so a child that
    // fits on neither side ends up clamped on the second side it tried.
    const placed = placeChild({ ...parent, width: 180, viewportWidth: 400 });
    expect(placed).toEqual({ left: POP_MARGIN, affinity: 'left', clamped: true });
  });

  it('inherits the parent side and only flips back when it has to', () => {
    // Affinity `left` fits at 100-180+2 = -78? no: that is below the margin,
    // so it is clamped, and PopPlaceChild goes back to the right.
    const placed = placeChild({ ...parent, width: 180, viewportWidth: 1000, affinity: 'left' });
    expect(placed.affinity).toBe('right');
    expect(placed.left).toBe(298);

    // With room on the left, `left` is kept even though `right` would fit too:
    // that is the whole point of PlacementAffinity being returned and reused.
    const kept = placeChild({
      parentLeft: 500,
      parentRight: 700,
      width: 180,
      viewportWidth: 1000,
      affinity: 'left',
    });
    expect(kept).toEqual({ left: 322, affinity: 'left', clamped: false });
  });

  it('clamps rather than looping when neither side fits', () => {
    const placed = placeChild({
      parentLeft: 10,
      parentRight: 90,
      width: 200,
      viewportWidth: 120,
    });
    // `PopFitBlock` clamps the right edge first and the LEFT edge second, so
    // the left margin wins and the menu simply overflows to the right — which
    // is what PyMOL does with a menu wider than the window.
    expect(placed).toEqual({ left: POP_MARGIN, affinity: 'left', clamped: true });
  });

  it('carries PyMOL’s own constants', () => {
    expect(POP_MARGIN).toBe(3);
    expect(POP_SCROLL_PX).toBe(10);
  });
});
