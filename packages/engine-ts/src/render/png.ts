/**
 * Dependency-free PNG encoder (RGBA → PNG bytes). Browser-safe: no Node `zlib`
 * or `canvas`. The IDAT payload is a zlib stream built from DEFLATE **stored**
 * (uncompressed) blocks — no compression, but a fully valid PNG that every
 * decoder reads. Used by `png`/`get_bytes` so the ray tracer's frame round-trips
 * as real PNG bytes (signature `137 80 78 71`).
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** CRC-32 (PNG polynomial 0xEDB88320), computed over a byte range. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 checksum of the raw (uncompressed) zlib data. */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wrap raw bytes as a zlib stream of DEFLATE stored blocks (no compression). */
function zlibStored(raw: Uint8Array): Uint8Array {
  const MAX = 0xffff;
  const nBlocks = Math.max(1, Math.ceil(raw.length / MAX));
  const out = new Uint8Array(2 + raw.length + nBlocks * 5 + 4);
  let p = 0;
  out[p++] = 0x78; // CMF: deflate, 32K window
  out[p++] = 0x01; // FLG: no dict, fastest
  let off = 0;
  do {
    const len = Math.min(MAX, raw.length - off);
    const final = off + len >= raw.length ? 1 : 0;
    out[p++] = final; // BFINAL bit; BTYPE=00 (stored)
    out[p++] = len & 0xff;
    out[p++] = (len >>> 8) & 0xff;
    out[p++] = ~len & 0xff;
    out[p++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(off, off + len), p);
    p += len;
    off += len;
  } while (off < raw.length);
  const ad = adler32(raw);
  out[p++] = (ad >>> 24) & 0xff;
  out[p++] = (ad >>> 16) & 0xff;
  out[p++] = (ad >>> 8) & 0xff;
  out[p++] = ad & 0xff;
  return out.subarray(0, p);
}

/** Emit one PNG chunk (length, type, data, CRC) into `parts`. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length), false);
  return out;
}

/**
 * Encode an RGBA pixel buffer (row-major, top row first, 4 bytes/pixel) into a
 * PNG byte stream. `rgba.length` must be `width * height * 4`.
 */
export function encodePng(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  // Filtered scanlines: each row is prefixed with filter byte 0 (None).
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const chunks = [
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = SIGNATURE.length + chunks.reduce((n, c) => n + c.length, 0);
  const png = new Uint8Array(total);
  png.set(SIGNATURE, 0);
  let p = SIGNATURE.length;
  for (const c of chunks) {
    png.set(c, p);
    p += c.length;
  }
  return png;
}
