/**
 * Shared visual-parity scoring — used by BOTH the gallery viewer (gallery.mjs)
 * and the visual regression suite (visual.e2e.mjs) so the two never drift.
 *
 * Two complementary metrics, because "how close to PyMOL" has two axes:
 *
 *   coverage%  — pixelmatch (YIQ, threshold 0.12). Counts pixels that differ in
 *                SHAPE/coverage. YIQ weights luminance ~2-3x over chroma, so this
 *                is largely a silhouette metric and UNDER-penalises colour: a
 *                surface rendered the wrong hue, or b-factor colour that reads as
 *                speckle instead of smooth bands, barely moves it.
 *
 *   color%     — foreground-restricted perceptual colour fidelity. Over every
 *                pixel that is FOREGROUND in either image (non-background), the
 *                mean "redmean" colour distance (a cheap perceptual RGB metric).
 *                This is the axis coverage% is blind to: it directly scores
 *                whether the colours match where there is actually content.
 *
 *   score%     — the headline: the mean of the two, so a render is only "close"
 *                to PyMOL when BOTH its shape AND its colours match.
 *
 * The colour diff (a heatmap of per-pixel colour distance over the foreground)
 * is a THIRD view in the gallery, so a hue/shade mismatch is visible even when
 * the silhouettes line up and the plain pixelmatch diff looks clean.
 */

import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/** Pixel is "foreground" if either image is brighter than this (bg is black). */
const FG_THRESHOLD = 16;

/** Crop both decoded PNGs to their shared top-left box; returns raw RGBA + size. */
export function cropShared(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const crop = (p) => {
    if (p.width === width && p.height === height) return p.data;
    const c = new PNG({ width, height });
    PNG.bitblt(p, c, 0, 0, width, height, 0, 0);
    return c.data;
  };
  return {
    aData: crop(a),
    bData: crop(b),
    width,
    height,
    sizeMismatch: a.width !== b.width || a.height !== b.height,
  };
}

/** SHAPE/coverage: pixelmatch diff count + diff PNG (unchanged from before). */
export function coverage(aData, bData, width, height) {
  const out = new PNG({ width, height });
  const n = pixelmatch(aData, bData, out.data, width, height, { threshold: 0.12 });
  return { n, total: width * height, out, pct: 100 * (1 - n / (width * height)) };
}

/**
 * "redmean" perceptual colour distance between two RGB triples, normalised to
 * [0,1]. https://en.wikipedia.org/wiki/Color_difference#sRGB — cheap, no LAB
 * conversion, and noticeably closer to human perception than plain Euclidean.
 */
function redmean(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const d = Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
  return d / MAX_REDMEAN;
}
const MAX_REDMEAN = Math.sqrt((2 + 255 / 256) * 255 * 255 + 4 * 255 * 255 + (2 + 255 / 256) * 255 * 255);

/**
 * COLOUR fidelity over the foreground. Returns the colour-similarity % plus a
 * heatmap PNG (red intensity = colour distance) restricted to foreground pixels.
 */
export function colorFidelity(aData, bData, width, height) {
  const heat = new PNG({ width, height });
  let sum = 0;
  let fg = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const ar = aData[o], ag = aData[o + 1], ab = aData[o + 2];
    const br = bData[o], bg = bData[o + 1], bb = bData[o + 2];
    const isFg = Math.max(ar, ag, ab) > FG_THRESHOLD || Math.max(br, bg, bb) > FG_THRESHOLD;
    const ho = o;
    if (isFg) {
      const d = redmean(ar, ag, ab, br, bg, bb); // [0,1]
      sum += d;
      fg++;
      const v = Math.min(255, Math.round(d * 255 * 1.6)); // *1.6 so mid diffs are visible
      heat.data[ho] = v;
      heat.data[ho + 1] = Math.round(v * 0.15);
      heat.data[ho + 2] = Math.round(v * 0.15);
      heat.data[ho + 3] = 255;
    } else {
      heat.data[ho] = heat.data[ho + 1] = heat.data[ho + 2] = 0;
      heat.data[ho + 3] = 255;
    }
  }
  const pct = fg === 0 ? 100 : 100 * (1 - sum / fg);
  return { pct, fg, heat };
}

/** The headline colour-AWARE similarity: shape and colour must BOTH match. */
export function combinedScore(coveragePct, colorPct) {
  return (coveragePct + colorPct) / 2;
}

/** One call: both metrics + both diff PNGs, from two PNG buffers. */
export function score(aBuf, bBuf) {
  const { aData, bData, width, height, sizeMismatch } = cropShared(aBuf, bBuf);
  const cov = coverage(aData, bData, width, height);
  const col = colorFidelity(aData, bData, width, height);
  return {
    width,
    height,
    sizeMismatch,
    coveragePct: cov.pct,
    colorPct: col.pct,
    scorePct: combinedScore(cov.pct, col.pct),
    coverageN: cov.n,
    total: cov.total,
    diff: cov.out, // pixelmatch shape diff PNG
    colorDiff: col.heat, // colour-distance heatmap PNG
  };
}
