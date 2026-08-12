/**
 * Parity tests for the CPU ray tracer (`ray` + `get_image`). Unlike the other
 * parity files these assert a *real* render — correct dimensions and a non-blank
 * frame — proving the headless tracer draws the scene, not just returns a buffer.
 * `ray` was previously pinned `it.fails` in parity-impossible.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

async function boot(): Promise<LocalBackend> {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [SMALL_PDB, 'm']);
  return b;
}

/** Count pixels whose RGB differs from a black background. */
function nonBackground(img: number[]): number {
  let n = 0;
  for (let i = 0; i < img.length; i += 4) {
    if (img[i] || img[i + 1] || img[i + 2]) n++;
  }
  return n;
}

describe('parity: ray — real CPU ray-traced render', () => {
  it('ray(64,64) renders the scene; get_image returns a non-blank RGBA buffer', async () => {
    const b = await boot();
    await b.call('show_as', ['sticks', 'm']);
    await b.call('zoom', ['m']);
    await b.call('ray', [64, 64]);
    const img = (await b.call('get_image', [])) as number[];
    expect(img.length).toBe(64 * 64 * 4); // RGBA
    expect(nonBackground(img)).toBeGreaterThan(0); // molecule actually rendered
    // Every alpha byte is opaque.
    for (let i = 3; i < img.length; i += 4) expect(img[i]).toBe(255);
  });

  it('surface rep ray-traces its triangle mesh (non-blank frame)', async () => {
    const b = await boot();
    await b.call('show_as', ['surface', 'm']);
    await b.call('zoom', ['m']);
    await b.call('ray', [48, 48]);
    const img = (await b.call('get_image', [])) as number[];
    expect(img.length).toBe(48 * 48 * 4);
    // A surface is a dense triangle mesh; it must cover a meaningful area.
    expect(nonBackground(img)).toBeGreaterThan(48); // > ~2% of the frame lit
  });

  it('a lone white sphere shades to a bright, near-neutral centre pixel', async () => {
    const b = new LocalBackend();
    await b.connect();
    // One carbon at the origin, shown as a sphere and coloured white.
    await b.call('read_pdbstr', [SMALL_PDB, 'm']);
    await b.call('show_as', ['spheres', 'm']);
    await b.call('color', ['white', 'm']);
    await b.call('zoom', ['m']);
    await b.call('ray', [64, 64]);
    const img = (await b.call('get_image', [])) as number[];
    const c = (32 * 64 + 32) * 4; // centre pixel
    const [r, g, bl] = [img[c]!, img[c + 1]!, img[c + 2]!];
    expect(r + g + bl).toBeGreaterThan(120); // lit, not background-black
    expect(Math.abs(r - g)).toBeLessThan(60); // white surface ⇒ near-neutral
  });

  it('_bridge.ray renders into the buffer the web UI reads back via png', async () => {
    const b = await boot();
    await b.call('show_as', ['sticks', 'm']);
    await b.call('zoom', ['m']);
    // The Ray button's exact call (features/render/RenderDialog.tsx).
    const rv = await b.call('_bridge.ray', [50, 40]);
    expect(rv).toBeNull(); // mirrors the bridge symbol: renders, returns nothing
    // The dialog then reads the render back with cmd.png(prior).
    const png = (await b.call('png', ['', 50, 40, -1, 0])) as number[];
    expect(png.slice(0, 4)).toEqual([137, 80, 78, 71]);
    // get_image sees the same buffer.
    const img = (await b.call('get_image', [])) as number[];
    expect(img.length).toBe(50 * 40 * 4);
    expect(nonBackground(img)).toBeGreaterThan(0);
  });

  it('png() returns real PNG bytes with a valid signature and IHDR', async () => {
    const b = await boot();
    await b.call('show_as', ['sticks', 'm']);
    await b.call('zoom', ['m']);
    // png(filename, width, height, dpi, ray) — ray=1 renders first.
    const bytes = (await b.call('png', ['out.png', 40, 30, -1, 1])) as number[];
    // PNG signature.
    expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // First chunk is IHDR ('I','H','D','R' at bytes 12..15) carrying the size.
    expect(String.fromCharCode(...bytes.slice(12, 16))).toBe('IHDR');
    const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
    const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
    expect([width, height]).toEqual([40, 30]);
    // Ends with the IEND chunk.
    expect(String.fromCharCode(...bytes.slice(-8, -4))).toBe('IEND');
  });
});
