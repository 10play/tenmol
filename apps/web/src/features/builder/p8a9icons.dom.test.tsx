/**
 * Wave 8, parity area 9: a ring button really RENDERS the shipped bitmap.
 *
 * `p8a9icons.test.ts` proves the bytes in `ringIcons.ts` are the bytes of
 * `$PYMOL_DATA/pmg_tk/bitmaps/builder/*.gif`; this proves the button puts them
 * on screen — an `<img>` with that data URL at the GIF's own pixel size, which
 * is what `QIcon.actualSize(QSize(48,48))` resolves to for a 20 px bitmap.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RingGlyph } from './BuilderPanel';
import { RINGS } from './tables';
import { RING_ICONS } from './ringIcons';

let container: HTMLDivElement;
let root: Root;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('<RingGlyph/>', () => {
  it('renders every ring as its shipped GIF at its natural size', () => {
    act(() => {
      root.render(
        <div>
          {RINGS.map((ring) => (
            <RingGlyph key={ring.icon} ring={ring} />
          ))}
        </div>,
      );
    });

    const images = Array.from(container.querySelectorAll('img.bbtn__icon'));
    expect(images).toHaveLength(10);
    // No SVG left over from the drawn-glyph version.
    expect(container.querySelector('svg')).toBeNull();

    images.forEach((node, index) => {
      const ring = RINGS[index]!;
      const icon = RING_ICONS[ring.icon]!;
      const img = node as HTMLImageElement;
      expect(img.getAttribute('src')).toBe(icon.src);
      expect(img.getAttribute('src')?.startsWith('data:image/gif;base64,')).toBe(true);
      expect(img.getAttribute('width')).toBe(String(icon.width));
      expect(img.getAttribute('height')).toBe('20');
      // Decorative: the button carries the accessible name (its aria-label is
      // the tooltip), so the image must not add a second one.
      expect(img.getAttribute('alt')).toBe('');
    });
  });
});
