/**
 * @tenmol/protocol — codec configuration.
 *
 * WP-01, plan §6 and §B8. The TypeScript half of the contract that
 * `packages/bridge/tenmol_bridge/codec.py` (WP-02) implements.
 *
 * PRINCIPLE (plan §B8): the codec table is EXPLICIT and CLOSED. Anything not in
 * it is a `{kind:'NotSerializable'}` error, never a silent `repr()`.
 *
 * | Return                              | Wire form                            |
 * |-------------------------------------|--------------------------------------|
 * | `cmd.get_model()` -> chempy Indexed | `{atom:[...], bond:[...]}`, whitelisted |
 * | `cmd.get_session()`                 | NEVER inline — a blob id / path      |
 * | `cmd.get_coords` / `get_coordset`   | `NdArray`: bin + {shape,dtype}       |
 * | `cmd.get_volume_field`              | blob id + header, never inline       |
 * | `cmd.get_raw_alignment`             | list of tuples -> array of arrays    |
 * | everything else                     | JSON/msgpack scalars, lists, dicts   |
 *
 * HARD RULE the bridge must honour and this file documents so nobody forgets:
 * `cmd.get_coordset(..., copy=0)` returns a LIVE VIEW onto C++ memory
 * (`packages/engine/layer2/CoordSet.cpp:326-361`; measured as a `(4779,3)` float32 view in
 * 0.021 s). The codec COPIES BEFORE RELEASING THE API LOCK, always. A view that
 * escapes the lock is a use-after-free.
 *
 * Zero runtime dependencies: this module never imports `@msgpack/msgpack`. It
 * describes the configuration; the transport package applies it.
 */

import type { Json } from './envelope';

/* ------------------------------------------------------------------ *
 * Frame encodings
 * ------------------------------------------------------------------ */

/**
 * TEXT frames are JSON. BINARY frames are either a `BinaryFrameHeader` frame
 * (`./geometry.ts`) or, when negotiated, a msgpack-encoded envelope.
 *
 * v1 default is `'json'`: the envelope is tiny and every measured payload that
 * is large enough for msgpack to matter (geometry, pixels, numpy) already has a
 * dedicated binary path. msgpack exists for `call` results that contain numpy.
 */
export const WIRE_ENCODINGS = ['json', 'msgpack'] as const;
export type WireEncoding = (typeof WIRE_ENCODINGS)[number];

export const DEFAULT_WIRE_ENCODING: WireEncoding = 'json';

/* ------------------------------------------------------------------ *
 * msgpack configuration
 * ------------------------------------------------------------------ */

/**
 * msgpack extension type codes. Reserved range 0x00-0x7f is application
 * defined; we use 0x10..0x1f. These MUST match `tenmol_bridge/codec.py`.
 */
export const MsgpackExtType = {
  /** A dense numeric array: `[shapeArray, dtypeString, rawBytes]`. */
  NdArray: 0x10,
  /** A blob handle: `[blobId, byteLength, mimeType]`. */
  Blob: 0x11,
} as const;
export type MsgpackExtTypeValue = (typeof MsgpackExtType)[keyof typeof MsgpackExtType];

/**
 * Options to pass to `@msgpack/msgpack`'s `encode`/`decode`. Structurally typed
 * so this package keeps zero dependencies; `@tenmol/client` spreads it.
 */
export interface MsgpackCodecConfig {
  /** Never emit msgpack `float32` for JS numbers — PyMOL settings are float64. */
  forceFloat32: false;
  /** Reject cyclic structures rather than looping forever. */
  ignoreUndefined: true;
  /** Maximum decode depth; PyMOL structures are shallow. */
  maxDepth: number;
  /** Hard cap on a single decoded value, mirroring the bridge's own cap. */
  maxBinLength: number;
  maxStrLength: number;
  maxArrayLength: number;
  maxMapLength: number;
}

/**
 * 64 MB caps. Rationale: the largest legitimate inline value in the table above
 * is a `get_coords` on a very large structure (1AON = 58,870 atoms ->
 * 58,870 * 3 * 4 = 706 KB), two orders of magnitude below the cap; anything
 * approaching it is a bug or a `get_session` that should have been a blob.
 */
export const MSGPACK_CONFIG: MsgpackCodecConfig = {
  forceFloat32: false,
  ignoreUndefined: true,
  maxDepth: 64,
  maxBinLength: 64 * 1024 * 1024,
  maxStrLength: 64 * 1024 * 1024,
  maxArrayLength: 16 * 1024 * 1024,
  maxMapLength: 1024 * 1024,
};

/* ------------------------------------------------------------------ *
 * NdArray — the numpy wire form (plan §B8 row 3)
 * ------------------------------------------------------------------ */

export const ND_DTYPES = ['float32', 'float64', 'int32', 'int64', 'uint8', 'bool'] as const;
export type NdDType = (typeof ND_DTYPES)[number];

export const ND_DTYPE_BYTES: Readonly<Record<NdDType, number>> = {
  float32: 4,
  float64: 8,
  int32: 4,
  int64: 8,
  uint8: 1,
  bool: 1,
};

export function isNdDType(v: unknown): v is NdDType {
  return typeof v === 'string' && (ND_DTYPES as readonly string[]).includes(v);
}

/**
 * A numpy array on the wire. C-contiguous, little-endian, always a COPY (see
 * the `copy=0` hard rule above).
 */
export interface NdArray {
  /** Discriminator, present in the JSON encoding as well as the msgpack ext. */
  __nd: 1;
  shape: readonly number[];
  dtype: NdDType;
  /** Raw little-endian bytes. */
  data: Uint8Array;
}

export function isNdArray(v: unknown): v is NdArray {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { __nd?: unknown }).__nd === 1 &&
    Array.isArray((v as { shape?: unknown }).shape) &&
    isNdDType((v as { dtype?: unknown }).dtype) &&
    (v as { data?: unknown }).data instanceof Uint8Array
  );
}

export function ndArrayElementCount(a: Pick<NdArray, 'shape'>): number {
  return a.shape.reduce((n, d) => n * d, 1);
}

/** Byte length an `NdArray` of this shape/dtype must have. */
export function ndArrayByteLength(a: Pick<NdArray, 'shape' | 'dtype'>): number {
  return ndArrayElementCount(a) * ND_DTYPE_BYTES[a.dtype];
}

/** Structural check that `data` matches `shape`/`dtype`. Returns [] when sound. */
export function ndArrayProblems(a: NdArray): string[] {
  const out: string[] = [];
  if (a.shape.some((d) => !Number.isInteger(d) || d < 0)) {
    out.push(`shape ${JSON.stringify(a.shape)} has a non-integer or negative dimension`);
  }
  const want = ndArrayByteLength(a);
  if (a.data.byteLength !== want) {
    out.push(`data is ${a.data.byteLength} B, shape/dtype require ${want} B`);
  }
  return out;
}

/**
 * `Float32Array` view over an `NdArray`. Zero copy when the bytes are aligned,
 * which msgpack `bin` decoding does not guarantee — unlike the geometry frame,
 * this path is allowed to copy because the volumes involved are ~700 KB, not
 * ~93 MB.
 */
export function ndArrayAsFloat32(a: NdArray): Float32Array {
  if (a.dtype !== 'float32') {
    throw new TypeError(`ndArrayAsFloat32: dtype is '${a.dtype}', not 'float32'`);
  }
  const { buffer, byteOffset, byteLength } = a.data;
  if (byteOffset % 4 === 0) return new Float32Array(buffer, byteOffset, byteLength / 4);
  return new Float32Array(a.data.slice().buffer);
}

/* ------------------------------------------------------------------ *
 * Blob handles (plan §B8 rows 2 and 4)
 * ------------------------------------------------------------------ */

/**
 * `cmd.get_session()` and `cmd.get_volume_field()` are NEVER returned inline.
 * The bridge writes them out and hands back a handle the client fetches from
 * `GET /blob/<id>` (see `BLOB_PATH` in `./envelope.ts`).
 *
 * Measured justification: a 4HHB session is 1,356,363 B and is byte-identical
 * across every rep set (spike 03 §5.2) — it is state, not something a UI reads.
 */
export interface BlobRef {
  __blob: 1;
  id: string;
  byteLength: number;
  mime: string;
  /** Server-side path when the value was written to a real file. */
  path?: string;
}

export function isBlobRef(v: unknown): v is BlobRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { __blob?: unknown }).__blob === 1 &&
    typeof (v as { id?: unknown }).id === 'string' &&
    typeof (v as { byteLength?: unknown }).byteLength === 'number'
  );
}

/** API symbols whose result is ALWAYS a `BlobRef`, never inline. */
export const BLOB_ONLY_SYMBOLS: readonly string[] = [
  'get_session',
  'get_volume_field',
  'get_vrml',
  'get_collada',
  'get_povray',
  'get_idtf',
  'get_mtl_obj',
  'png',
  'ray',
];

export function isBlobOnly(fn: string): boolean {
  return BLOB_ONLY_SYMBOLS.includes(fn);
}

/* ------------------------------------------------------------------ *
 * chempy models (plan §B8 row 1)
 * ------------------------------------------------------------------ */

/**
 * Whitelisted `chempy.Atom` fields. Anything outside this list is DROPPED, not
 * `repr()`'d — an unwhitelisted attribute is how a `get_model()` result grows a
 * Python object the client cannot read.
 */
export const CHEMPY_ATOM_FIELDS: readonly string[] = [
  'index',
  'name',
  'symbol',
  'elem',
  'resn',
  'resi',
  'resi_number',
  'chain',
  'segi',
  'alt',
  'coord',
  'b',
  'q',
  'vdw',
  'formal_charge',
  'partial_charge',
  'numeric_type',
  'text_type',
  'ss',
  'hetatm',
  'flags',
  'color',
  'rank',
  'id',
];

export const CHEMPY_BOND_FIELDS: readonly string[] = ['index', 'order', 'stereo', 'id'];

export interface ChempyModel {
  atom: Json[];
  bond: Json[];
}

/* ------------------------------------------------------------------ *
 * The value union
 * ------------------------------------------------------------------ */

/** Everything a `{t:'ok'}` result may legally be after decoding. */
export type WireValue = Json | NdArray | BlobRef;

/**
 * Returns the reason a value is NOT serializable, or null when it is. Mirrors
 * the bridge's table so a JS-side mock bridge cannot drift from it.
 */
export function unserializableReason(v: unknown): string | null {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return null;
  if (t === 'undefined') return 'undefined has no wire form (Python None maps to null)';
  if (t === 'function') return 'functions have no wire form';
  if (t === 'bigint') return 'bigint exceeds the JSON number range';
  if (t === 'symbol') return 'symbols have no wire form';
  if (Array.isArray(v)) return null;
  if (isNdArray(v) || isBlobRef(v)) return null;
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
    return 'raw bytes must be wrapped in an NdArray or a BlobRef';
  }
  if (t === 'object') return null;
  return `unsupported value of type ${t}`;
}
