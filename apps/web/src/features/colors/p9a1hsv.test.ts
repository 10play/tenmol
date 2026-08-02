/**
 * The HSV picker's colour space is PyMOL's — parity row 72.
 *
 * Row 72's last open item was "the plan's HSV/RGB picker replacing the three
 * sliders and three spinboxes is absent". A picker is only worth having if it
 * agrees with the program it edits, so `hsv.ts` is a transcription of
 * `Lib/colorsys.py` — the module `modules/pymol/viewing.py:1971` imports for
 * `spectrum … interpolation=hsv`.
 *
 * THE VECTORS ARE NOT WRITTEN IN THIS FILE. `__fixtures__/p9a1hsv.json` is
 * shared with `bridge/tests/test_p9_shell.py`, which asserts that `colorsys`
 * INSIDE the running engine produces exactly these numbers. Breaking either
 * implementation turns one of the two suites red; there is no private copy of
 * the answers here to keep both green.
 */

import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/p9a1hsv.json';
import { displayToHsv, hsvToDisplay, hsvToRgb, hueStripCss, rgbToHsv } from './hsv';
import { quantiseChannels, type Rgb } from './palette';

type Triple = readonly [number, number, number];

const triple = (values: number[]): Triple => [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];

describe('rgbToHsv / hsvToRgb agree with the colorsys PyMOL imports', () => {
  it('reproduces every rgb -> hsv vector to 1e-12', () => {
    for (const row of fixture.roundTrip) {
      const got = rgbToHsv(triple(row.rgb));
      for (let i = 0; i < 3; i += 1) {
        expect(got[i], `${JSON.stringify(row.rgb)}[${i}]`).toBeCloseTo(row.hsv[i] ?? 0, 12);
      }
    }
  });

  it('reproduces every hsv -> rgb vector to 1e-12', () => {
    for (const row of fixture.forward) {
      const got = hsvToRgb(triple(row.hsv));
      for (let i = 0; i < 3; i += 1) {
        expect(got[i], `${JSON.stringify(row.hsv)}[${i}]`).toBeCloseTo(row.rgb[i] ?? 0, 12);
      }
    }
  });

  it('round-trips back to the same rgb, as colorsys does', () => {
    for (const row of fixture.roundTrip) {
      const back = hsvToRgb(rgbToHsv(triple(row.rgb)));
      for (let i = 0; i < 3; i += 1) {
        expect(back[i], JSON.stringify(row.rgb)).toBeCloseTo(row.back[i] ?? 0, 12);
      }
    }
  });

  it('magenta keeps a POSITIVE hue: Python % and JavaScript % differ', () => {
    // `h = (bc - gc) / 6` is -1/6 here, and a bare `% 1` in JavaScript leaves
    // it negative. Every downstream slider would then sit at its minimum.
    const [h] = rgbToHsv([1, 0, 1]);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeCloseTo(5 / 6, 12);
  });

  it('grey has hue 0 and saturation 0, decided by minc === maxc', () => {
    expect(rgbToHsv([0.5, 0.5, 0.5])).toEqual([0, 0, 0.5]);
    expect(rgbToHsv([0, 0, 0])).toEqual([0, 0, 0]);
    // …and s === 0 short-circuits the way back, so v lands on all three.
    expect(hsvToRgb([0.42, 0, 0.33])).toEqual([0.33, 0.33, 0.33]);
  });
});

describe('the editor units', () => {
  it('H is degrees and wraps; S and V are per cent and clamp', () => {
    expect(hsvToDisplay([5 / 6, 1, 1])).toEqual([300, 100, 100]);
    expect(displayToHsv([360, 50, 50])[0]).toBe(0);
    expect(displayToHsv([-30, 50, 50])[0]).toBeCloseTo(330 / 360, 12);
    expect(displayToHsv([0, 999, -12])).toEqual([0, 1, 0]);
  });

  it('a display round trip is stable on the grid the swatch shows', () => {
    // The editor writes RGB through `quantiseChannels`, so what matters is that
    // dragging H and reading it back does not creep.
    for (let degrees = 0; degrees < 360; degrees += 7) {
      const hsv = displayToHsv([degrees, 100, 100]);
      const rgb: Rgb = quantiseChannels(hsvToRgb(hsv));
      const shown = hsvToDisplay(rgbToHsv(rgb));
      // Within one degree: 2-decimal RGB cannot resolve a full 360-step hue.
      const drift = Math.min(Math.abs(shown[0] - degrees), 360 - Math.abs(shown[0] - degrees));
      expect(drift, `${degrees}deg -> ${JSON.stringify(rgb)} -> ${shown[0]}deg`).toBeLessThanOrEqual(1);
    }
  });

  it('the hue strip is generated from the conversion, not hand-written', () => {
    const css = hueStripCss();
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true);
    // Six primaries plus the wrap back to red.
    expect(css).toContain('rgb(255, 0, 0) 0%');
    expect(css).toContain('rgb(0, 255, 0) 33%');
    expect(css).toContain('rgb(0, 0, 255) 67%');
    expect(css).toContain('100%');
  });
});
