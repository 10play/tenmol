/**
 * The wire form of a numpy array, and how to read it.
 *
 * `packages/bridge/tenmol_bridge/codec.py` encodes `cmd.get_coords` and
 * `cmd.get_coordset` — the zero-copy coordinate path — as
 * `{__ndarray__, shape, dtype, encoding, data}`.
 *
 * WHY `encoding` EXISTS. The encoder was originally written against msgpack,
 * which has a `bin` type, and put raw `bytes` in `data`. RPC replies actually
 * go out through `ws.send_json`, which cannot encode `bytes` at all, so every
 * call to `get_coords` failed on the wire from the day it was written. The
 * payload is base64 on the JSON transport; the field is explicit so a future
 * binary transport can send `bin` again and this decoder can tell which it got
 * rather than sniffing the type.
 *
 * NOT ZERO-COPY ON THIS SIDE, deliberately stated: the C++ end hands numpy a
 * view, but the bridge copies before releasing the API lock (a view onto
 * PyMOL's memory must not outlive it), and base64 copies again. What survives
 * the trip is the SHAPE of the primitive, not its zero-copy property. The
 * geometry topic's binary frames are where zero-copy actually lives.
 */

export interface WireNdarray {
  __ndarray__: true;
  /** Row-major dimensions, e.g. `[natoms, 3]` for coordinates. */
  shape: number[];
  /** A numpy dtype string: `float32`, `float64`, `int32`, `uint8`. */
  dtype: string;
  encoding?: 'base64';
  data: string;
}

export function isWireNdarray(value: unknown): value is WireNdarray {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __ndarray__?: unknown }).__ndarray__ === true &&
    typeof (value as { data?: unknown }).data === 'string'
  );
}

const VIEWS: Record<string, (b: ArrayBuffer) => ArrayBufferView & { length: number }> = {
  float32: (b) => new Float32Array(b),
  float64: (b) => new Float64Array(b),
  int32: (b) => new Int32Array(b),
  uint32: (b) => new Uint32Array(b),
  uint8: (b) => new Uint8Array(b),
  int8: (b) => new Int8Array(b),
};

export class UnsupportedDtype extends Error {
  constructor(readonly dtype: string) {
    super(`unsupported ndarray dtype "${dtype}"`);
  }
}

/**
 * Decode to a typed array plus its shape.
 *
 * Throws on an unknown dtype rather than guessing a width — reading float64
 * data as float32 produces numbers, not an error, and the numbers are wrong.
 */
export function decodeNdarray(value: WireNdarray): {
  data: ArrayBufferView & { length: number };
  shape: number[];
} {
  const view = VIEWS[value.dtype];
  if (!view) throw new UnsupportedDtype(value.dtype);

  const binary = atob(value.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const expected = value.shape.reduce((a, b) => a * b, 1);
  const decoded = view(bytes.buffer);
  if (decoded.length !== expected) {
    throw new Error(
      `ndarray payload has ${decoded.length} elements, shape ${value.shape.join('x')} needs ${expected}`,
    );
  }
  return { data: decoded, shape: [...value.shape] };
}

/** Coordinates as `[x,y,z]` triples. Throws if the shape is not `[n, 3]`. */
export function decodeCoords(value: WireNdarray): Float32Array {
  if (value.shape.length !== 2 || value.shape[1] !== 3) {
    throw new Error(`expected an [n,3] coordinate array, got ${value.shape.join('x')}`);
  }
  const { data } = decodeNdarray(value);
  return data instanceof Float32Array ? data : Float32Array.from(data as unknown as number[]);
}
