/**
 * Wave 8, parity area 9: the Chemical tab's ten ring buttons ship the REAL
 * `$PYMOL_DATA/pmg_tk/bitmaps/builder/*.gif` bitmaps, not a lookalike.
 *
 * The point of reading the files off disk is that a hand-copied base64 blob is
 * exactly the kind of thing that silently rots: this compares bytes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RINGS } from './tables';
import { RING_ICONS } from './ringIcons';

const REPO = join(import.meta.dirname, '../../../../..');
const BITMAPS = join(REPO, 'packages/engine/data/pmg_tk/bitmaps/builder');
const QT_BUILDER = join(REPO, 'packages/engine/modules/pmg_qt/builder.py');

const decode = (dataUrl: string): Buffer => {
  const marker = 'data:image/gif;base64,';
  expect(dataUrl.startsWith(marker)).toBe(true);
  return Buffer.from(dataUrl.slice(marker.length), 'base64');
};

describe('the ring icons are the shipped GIFs', () => {
  it('has one icon per ring button and no strays', () => {
    expect(RINGS.map((r) => r.icon)).toEqual([
      'cyc3', 'cyc4', 'cyc5', 'cyc6', 'cyc7', 'aro5', 'aro6', 'aro65', 'aro66', 'aro67',
    ]);
    expect(Object.keys(RING_ICONS).sort()).toEqual(RINGS.map((r) => r.icon).sort());
  });

  it.each(
    RINGS.map((ring) => [ring.icon] as const),
  )('%s is byte-identical to packages/engine/data/pmg_tk/bitmaps/builder/%s.gif', (icon) => {
    const onDisk = readFileSync(join(BITMAPS, `${icon}.gif`));
    const inlined = decode(RING_ICONS[icon]!.src);
    expect(inlined.equals(onDisk)).toBe(true);
  });

  it('records the natural size out of each GIF header', () => {
    for (const ring of RINGS) {
      const bytes = decode(RING_ICONS[ring.icon]!.src);
      // GIF89a: magic, then two little-endian uint16 for the logical screen.
      expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
      expect(RING_ICONS[ring.icon]!.width).toBe(bytes.readUInt16LE(6));
      expect(RING_ICONS[ring.icon]!.height).toBe(bytes.readUInt16LE(8));
      expect(RING_ICONS[ring.icon]!.height).toBe(20);
      // 20x20 for the three-ring, 22x20 for the single rings, 34x20 fused.
      expect([20, 22, 34]).toContain(RING_ICONS[ring.icon]!.width);
    }
  });

  it('is the same file set the Qt builder loads, inverted copy included', () => {
    const qt = readFileSync(QT_BUILDER, 'utf8');
    // builder.py:1323-1335 — the directory, the glob and the inverted copy
    // that only ever supplies `actualSize()` (`:1124`).
    expect(qt).toContain('pmg_tk/bitmaps/builder');
    expect(qt).toContain('glob("%s/aro*.gif" % imgDir) + glob("%s/cyc*.gif" % imgDir)');
    expect(qt).toContain('image.invertPixels()');
    for (const ring of RINGS) {
      // The button labels are "#<icon>", which is how Qt marks "this one is a
      // bitmap, not text" (builder.py:1116-1120).
      expect(qt, `${ring.icon} is not named by the Qt builder`).toContain(`"#${ring.icon}"`);
    }
  });
});
