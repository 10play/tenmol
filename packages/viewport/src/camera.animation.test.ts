/**
 * The camera ANIMATION contract — `00-parity-inventory.md:337`.
 *
 * `test/camera.test.ts` is the golden test for the view MATRIX; this is the
 * golden test for the view's CLOCK. Every constant asserted here was measured
 * over the WebSocket against a real PyMOL in `bridge/tests/test_f7_camera.py`:
 *
 *   * `int(duration * 30) + 1` distinct `get_view()[11]` values during a sweep
 *     — 4 / 16 / 31 for 0.1 / 0.5 / 1.0 s, polling at ~4 kHz
 *   * `animation_duration` 0.75 s by default, 0.3 s -> settles in 0.30 s,
 *     1.5 s -> 1.51 s
 *   * `animation off` + `animate=-1` -> the command lands before the reply
 *   * a two-sample settle detector fires on its FIRST poll, 161 A early
 */

import { describe, expect, it } from 'vitest';

import {
  ANI_ELEM_HZ,
  DEFAULT_ANIMATION_DURATION,
  KEY_FRAME_MS,
  MAX_ANI_ELEM,
  animationKeyFrames,
  createSettleDetector,
  resolveAnimate,
  type ViewMatrix,
} from './camera';

/** `cmd.get_view()` on il2.pdb straight after `cmd.reset()`, measured. */
const HOME = [
  1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -287.6255, 16.2829, -3.616, 20.8824, 226.7661, 348.4848, -20,
] as unknown as ViewMatrix;

/** The same scene after `cmd.zoom("resi 20", animate=0)`, measured. */
const ZOOMED = [
  1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -16.646, 10.129, -1.825, 17.918, 13.124, 20.168, -20,
] as unknown as ViewMatrix;

const at = (v: ViewMatrix, z: number): ViewMatrix => {
  const next = [...(v as unknown as number[])];
  next[11] = z;
  return next as unknown as ViewMatrix;
};

describe('animation key frames', () => {
  it('is 30 key frames per second, floored, at least one', () => {
    expect(ANI_ELEM_HZ).toBe(30);
    expect(KEY_FRAME_MS).toBeCloseTo(33.333, 3);
    // The three durations measured on the bridge: 3 / 15 / 30 intervals, which
    // is 4 / 16 / 31 distinct camera positions counting the starting one.
    expect(animationKeyFrames(0.1)).toBe(3);
    expect(animationKeyFrames(0.5)).toBe(15);
    expect(animationKeyFrames(1.0)).toBe(30);
    // `if (target < 1) target = 1` (`layer1/Scene.cpp:406`): a 10 ms sweep is
    // one jump, not zero.
    expect(animationKeyFrames(0.01)).toBe(1);
    expect(animationKeyFrames(0)).toBe(0);
    expect(animationKeyFrames(-1)).toBe(0);
  });

  it('clamps at MAX_ANI_ELEM, so a long sweep gets coarser and not longer', () => {
    expect(MAX_ANI_ELEM).toBe(300);
    expect(animationKeyFrames(10)).toBe(300);
    expect(animationKeyFrames(60)).toBe(300);
  });
});

describe('resolveAnimate', () => {
  it('animate < 0 asks the settings, and `animation off` means instant', () => {
    expect(DEFAULT_ANIMATION_DURATION).toBe(0.75);
    expect(resolveAnimate(-1, true)).toBe(0.75);
    expect(resolveAnimate(-1, true, 0.3)).toBe(0.3);
    expect(resolveAnimate(-1, true, 1.5)).toBe(1.5);
    expect(resolveAnimate(-1, false, 1.5)).toBe(0);
    // any negative value, not just -1 (`animate < 0.0F`)
    expect(resolveAnimate(-0.25, true)).toBe(0.75);
  });

  it('a positive animate overrides the settings, 0 means no sweep', () => {
    expect(resolveAnimate(1.0, false)).toBe(1.0);
    expect(resolveAnimate(0, true)).toBe(0);
  });
});

describe('createSettleDetector', () => {
  it('refuses a quiet window that cannot outlast one key frame', () => {
    // This is the whole point: 0 ms, 1 ms and even 33 ms are the broken
    // "two consecutive reads agree" detector wearing a hat.
    expect(() => createSettleDetector(0)).toThrow(RangeError);
    expect(() => createSettleDetector(KEY_FRAME_MS)).toThrow(RangeError);
    expect(() => createSettleDetector(KEY_FRAME_MS + 1)).not.toThrow();
  });

  it('does NOT settle on two equal samples taken inside one key frame', () => {
    // Measured: a get_view round trip is 0.24 ms, so the client sees the same
    // key frame twice long before the sweep has moved anywhere.
    const d = createSettleDetector();
    expect(d.push(HOME, 0)).toBe(false);
    expect(d.push(HOME, 0.24)).toBe(false);
    expect(d.push(HOME, 0.48)).toBe(false);
    expect(d.push(HOME, 30)).toBe(false);
    // the sweep moves on at the next key frame, exactly as on the bridge
    expect(d.push(at(HOME, -282.21), 34)).toBe(false);
  });

  it('settles only after the view holds still for longer than a key frame', () => {
    const d = createSettleDetector();
    let t = 0;
    // 30 key frames of a 1 s sweep, sampled every 5 ms.
    for (let frame = 0; frame <= 30; frame++) {
      const z = HOME[11] + ((ZOOMED[11] - HOME[11]) * frame) / 30;
      for (let s = 0; s < KEY_FRAME_MS; s += 5) {
        expect(d.push(at(HOME, z), t)).toBe(false);
        t += 5;
      }
    }
    // now it stops. Still not settled until a key frame has gone by unchanged.
    expect(d.push(ZOOMED, t)).toBe(false);
    expect(d.push(ZOOMED, t + KEY_FRAME_MS)).toBe(false);
    expect(d.push(ZOOMED, t + KEY_FRAME_MS * 2)).toBe(true);
  });

  it('a null sample (nothing read yet) never settles, and reset re-arms', () => {
    const d = createSettleDetector();
    expect(d.push(null, 0)).toBe(false);
    expect(d.push(null, 1000)).toBe(false);
    expect(d.push(HOME, 1000)).toBe(false);
    expect(d.push(HOME, 1100)).toBe(true);
    d.reset();
    expect(d.push(HOME, 1200)).toBe(false);
    expect(d.push(HOME, 1300)).toBe(true);
  });

  it('compares all 18 floats exactly, not just the camera distance', () => {
    // The clipping planes move on their own during a `zoom` sweep; a detector
    // that only watched view[11] would settle while the slab was still closing.
    const d = createSettleDetector();
    const slab = [...(ZOOMED as unknown as number[])];
    slab[15] = 20;
    slab[16] = 30;
    expect(d.push(ZOOMED, 0)).toBe(false);
    expect(d.push(slab as unknown as ViewMatrix, 100)).toBe(false);
    expect(d.push(slab as unknown as ViewMatrix, 200)).toBe(true);
  });
});
