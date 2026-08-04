/**
 * Row 341 item (2) — the reservation arithmetic.
 *
 * The pure half of `seq_view_overlay = 0`. The layout itself is asserted in
 * Chromium (`apps/web/e2e/smoke.e2e.mjs`), because jsdom lays nothing out and a
 * jsdom test claiming a canvas got shorter would be measuring nothing.
 *
 * What IS worth pinning here is the set of states that must reserve NOTHING,
 * since they are the ones an effect gets wrong: overlay on, an unmeasured strip,
 * a strip that is not mounted. A stale inset survives as a black band with no
 * visible cause.
 */

import { describe, expect, it } from 'vitest';

import { RESERVE_BOTTOM, RESERVE_TOP, applyReservation, reservationFor } from './reserve';

describe('reservationFor', () => {
  it('takes the height off the TOP at seq_view_location 0', () => {
    expect(reservationFor({ location: 0, overlay: false, height: 62 })).toEqual([
      '62px',
      '0px',
    ]);
  });

  it('takes it off the BOTTOM at seq_view_location 1', () => {
    // `sceneBottom += seqHeight` (Ortho.cpp:2419) against
    // `sceneTop = seqHeight` (:2433) — the two branches of the same block.
    expect(reservationFor({ location: 1, overlay: false, height: 62 })).toEqual([
      '0px',
      '62px',
    ]);
  });

  it('reserves nothing when seq_view_overlay is 1, at either location', () => {
    // This is the whole point of the setting: overlay DRAWS OVER the picture.
    for (const location of [0, 1]) {
      expect(reservationFor({ location, overlay: true, height: 62 })).toEqual(['0px', '0px']);
    }
  });

  it('reserves nothing for a strip that has not been measured', () => {
    expect(reservationFor({ location: 0, overlay: false, height: 0 })).toEqual(['0px', '0px']);
    expect(reservationFor({ location: 0, overlay: false, height: Number.NaN })).toEqual([
      '0px',
      '0px',
    ]);
  });

  it('never emits a negative inset', () => {
    expect(reservationFor({ location: 0, overlay: false, height: -20 })).toEqual([
      '0px',
      '0px',
    ]);
  });

  it('rounds to whole pixels — a fractional inset seams against the canvas', () => {
    expect(reservationFor({ location: 0, overlay: false, height: 61.6 })).toEqual([
      '62px',
      '0px',
    ]);
  });
});

describe('applyReservation', () => {
  it('writes both properties and clears both on dispose', () => {
    const container = document.createElement('div');
    const dispose = applyReservation(container, { location: 1, overlay: false, height: 46 });
    expect(container.style.getPropertyValue(RESERVE_BOTTOM)).toBe('46px');
    expect(container.style.getPropertyValue(RESERVE_TOP)).toBe('0px');

    // The CLEAR is the load-bearing half: the strip unmounts whenever
    // `seq_view` is turned off, and a leftover inset is a gap with no viewer.
    dispose();
    expect(container.style.getPropertyValue(RESERVE_TOP)).toBe('');
    expect(container.style.getPropertyValue(RESERVE_BOTTOM)).toBe('');
  });

  it('is a no-op without a container, and its disposer is safe to call', () => {
    // `offsetParent` is null while the strip is display:none or detached.
    expect(() => applyReservation(null, { location: 0, overlay: false, height: 62 })()).not.toThrow();
  });

  it('moves the reservation across when the location flips', () => {
    const container = document.createElement('div');
    applyReservation(container, { location: 0, overlay: false, height: 62 })();
    const dispose = applyReservation(container, { location: 1, overlay: false, height: 62 });
    expect(container.style.getPropertyValue(RESERVE_TOP)).toBe('0px');
    expect(container.style.getPropertyValue(RESERVE_BOTTOM)).toBe('62px');
    dispose();
  });
});
