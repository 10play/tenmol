/**
 * @tenmol/protocol — binary geometry frames.
 *
 * WIRE FORMAT (server -> client, WebSocket binary frame):
 *
 *   [ 0 .. 3 ]                       uint32 little-endian  headerLength
 *   [ 4 .. 4+headerLength )          UTF-8 JSON            GeometryFrameHeader
 *   [ 4+headerLength .. end )        raw bytes             typed-array payload
 *
 * `headerLength` is always padded (with 0x20 spaces inside the JSON text) to a
 * multiple of GEOMETRY_HEADER_ALIGNMENT so the payload starts 4-byte aligned
 * and Float32Array/Int32Array views over it are zero-copy.
 *
 * WHAT THE PAYLOAD CONTAINS is dictated by what PyMOL actually has in memory,
 * per docs/webclient/geometry-extraction.md §3 and §6b:
 *
 *  * "indexed-mesh"     — the RepSurface arrays, memcpy'd:
 *                         V/VN/VC/VA/VAO/T/AT/Vis (§6b, RepSurface.cpp:59-101).
 *  * "cgo-draw-arrays"  — one or more `cgo::draw::arrays` heap blocks
 *                         (layer1/CGO.h:338-355) exactly as
 *                         CGOCombineBeginEnd lays them out
 *                         (layer1/CGO.cpp:1645-1672), plus optional impostor
 *                         instance buffers for spheres and shader cylinders.
 *
 * No transformation is applied server-side: a `cgo::draw::arrays` block is a
 * three.js BufferGeometry with zero conversion (geometry-extraction.md:215).
 *
 * Zero runtime dependencies; only pure functions live here.
 */

/* ------------------------------------------------------------------ *
 * Rep identity
 * ------------------------------------------------------------------ */

/** `enum cRep_t`, `layer1/Rep.h:48-74`. Values are session-stable. */
export const Rep = {
  None: -2,
  All: -1,
  Cyl: 0,
  Sphere: 1,
  Surface: 2,
  Label: 3,
  NonbondedSphere: 4,
  Cartoon: 5,
  Ribbon: 6,
  Line: 7,
  Mesh: 8,
  Dot: 9,
  Dash: 10,
  Nonbonded: 11,
  Cell: 12,
  CGO: 13,
  Callback: 14,
  Extent: 15,
  Slice: 16,
  Angle: 17,
  Dihedral: 18,
  Ellipsoid: 19,
  Volume: 20,
} as const;

export const REP_COUNT = 21; // cRepCnt, layer1/Rep.h:73

/** A `cRep_t` value. Kept as `number`: upstream may add reps. */
export type RepId = number;

export const REP_NAMES: Readonly<Record<number, string>> = {
  [Rep.Cyl]: 'sticks',
  [Rep.Sphere]: 'spheres',
  [Rep.Surface]: 'surface',
  [Rep.Label]: 'labels',
  [Rep.NonbondedSphere]: 'nb_spheres',
  [Rep.Cartoon]: 'cartoon',
  [Rep.Ribbon]: 'ribbon',
  [Rep.Line]: 'lines',
  [Rep.Mesh]: 'mesh',
  [Rep.Dot]: 'dots',
  [Rep.Dash]: 'dashes',
  [Rep.Nonbonded]: 'nonbonded',
  [Rep.Cell]: 'cell',
  [Rep.CGO]: 'cgo',
  [Rep.Callback]: 'callback',
  [Rep.Extent]: 'extent',
  [Rep.Slice]: 'slice',
  [Rep.Angle]: 'angles',
  [Rep.Dihedral]: 'dihedrals',
  [Rep.Ellipsoid]: 'ellipsoids',
  [Rep.Volume]: 'volume',
};

/** `cRepInv_t` ladder, `layer1/Rep.h:133-184`. Higher = more invalidated. */
export const RepInv = {
  None: 0,
  Display: 1,
  Extents: 5,
  Pick: 9,
  ExtColor: 10,
  Color: 15,
  Text: 16,
  Visib: 20,
  Prop: 22,
  Coord: 30,
  Rep: 35,
  BondsNoNonbonded: 38,
  Bonds: 40,
  All: 100,
} as const;

/** A `cRepInv_t` value. */
export type RepInvalidationLevel = number;

/* ------------------------------------------------------------------ *
 * CGO constants (mirrors of the C headers)
 * ------------------------------------------------------------------ */

/** GL primitive modes accepted by CGO_BEGIN, `layer1/CGO.h:68-72` and
 *  `modules/pymol/cgo.py:21-27`. These are the *only* legal `mode` values. */
export const GLMode = {
  Points: 0,
  Lines: 1,
  LineLoop: 2,
  LineStrip: 3,
  Triangles: 4,
  TriangleStrip: 5,
  TriangleFan: 6,
} as const;
export type GLModeValue = (typeof GLMode)[keyof typeof GLMode];

export function isGLMode(v: unknown): v is GLModeValue {
  return typeof v === 'number' && v >= 0 && v <= 6 && Number.isInteger(v);
}

/** `arraybits` flags, `layer1/CGO.h:272-277`. */
export const CGOArrayBit = {
  Vertex: 0x01,
  Normal: 0x02,
  Color: 0x04,
  PickColor: 0x08,
  Accessibility: 0x10,
  TexCoord: 0x20,
} as const;

/**
 * Components per vertex, per sub-array:
 *   VERTEX_POS_SIZE 3 / VERTEX_COLOR_SIZE 4   (layer0/ShaderMgr.h:430-431)
 *   VERTEX_NORMAL_SIZE 3                      (layer1/CGO.cpp:54)
 *   VERTEX_PICKCOLOR_SIZE = 1 (rgba) + 2 (index, bond)  (layer1/CGO.cpp:60-64)
 *   VERTEX_ACCESSIBILITY_SIZE 1               (layer1/CGO.cpp:65)
 */
export const CGO_VERTEX_POS_SIZE = 3;
export const CGO_VERTEX_NORMAL_SIZE = 3;
export const CGO_VERTEX_COLOR_SIZE = 4;
export const CGO_VERTEX_PICKCOLOR_RGBA_SIZE = 1;
export const CGO_VERTEX_PICKCOLOR_INDEX_SIZE = 2;
export const CGO_VERTEX_PICKCOLOR_SIZE =
  CGO_VERTEX_PICKCOLOR_RGBA_SIZE + CGO_VERTEX_PICKCOLOR_INDEX_SIZE;
export const CGO_VERTEX_ACCESSIBILITY_SIZE = 1;
export const CGO_VERTEX_TEXCOORD_SIZE = 3;

/** Opcodes referenced by the geometry feed, `layer1/CGO.h:82-270`. */
export const CGOOp = {
  Stop: 0x00,
  Null: 0x01,
  Begin: 0x02,
  End: 0x03,
  Vertex: 0x04,
  Normal: 0x05,
  Color: 0x06,
  Sphere: 0x07,
  Cylinder: 0x09,
  Sausage: 0x0e,
  CustomCylinder: 0x0f,
  Ellipsoid: 0x12,
  Alpha: 0x19,
  DrawArrays: 0x1c,
  Cone: 0x1b,
  PickColor: 0x1f,
  BoundingBox: 0x22,
  ShaderCylinder: 0x26,
  ShaderCylinderWith2ndColor: 0x27,
  Accessibility: 0x29,
  CustomCylinderAlpha: 0x41,
} as const;

/** Impostor instance strides (floats per instance). */
/** cx,cy,cz,r,rr,gg,bb,aa — geometry-extraction.md:413. */
export const SPHERE_ITEM_SIZE = 8;
/** origin(3), axis(3), radius(1), capbits(1) — CGO_SHADER_CYLINDER, size 8. */
export const SHADER_CYLINDER_ITEM_SIZE = 8;
/** CGO_SHADER_CYLINDER_WITH_2ND_COLOR, size 13 (`layer1/CGO.h`). */
export const SHADER_CYLINDER_2ND_COLOR_ITEM_SIZE = 13;

/* ------------------------------------------------------------------ *
 * Buffer references
 * ------------------------------------------------------------------ */

export type GeometryDType = 'f32' | 'i32' | 'u32' | 'u8';

export const DTYPE_BYTES: Readonly<Record<GeometryDType, number>> = {
  f32: 4,
  i32: 4,
  u32: 4,
  u8: 1,
};

/**
 * A slice of the frame payload. `byteOffset` is relative to the START of the
 * payload (i.e. after the header), never to the start of the frame.
 */
export interface BufferRef {
  byteOffset: number;
  byteLength: number;
  dtype: GeometryDType;
  /** Components per logical item (3 for xyz, 4 for rgba, 1 for scalars). */
  itemSize: number;
}

/** Number of scalars in the ref. */
export function elementCount(ref: BufferRef): number {
  return ref.byteLength / DTYPE_BYTES[ref.dtype];
}

/** Number of logical items (vertices, triangles, instances...). */
export function itemCount(ref: BufferRef): number {
  return elementCount(ref) / ref.itemSize;
}

export type TypedArrayFor<D extends GeometryDType> = D extends 'f32'
  ? Float32Array
  : D extends 'i32'
    ? Int32Array
    : D extends 'u32'
      ? Uint32Array
      : Uint8Array;

/**
 * Typed-array view over a payload slice.
 *
 * Zero copy when the absolute byte offset happens to be aligned to the element
 * size (which the encoder guarantees for the payload start, and which holds for
 * every ref the bridge emits at 4-byte-aligned offsets). Falls back to a copy
 * rather than throwing, so a mis-aligned producer degrades in speed, not
 * correctness.
 */
export function viewOf(
  payload: Uint8Array,
  ref: BufferRef,
): Float32Array | Int32Array | Uint32Array | Uint8Array {
  const bytes = DTYPE_BYTES[ref.dtype];
  if (ref.byteOffset < 0 || ref.byteOffset + ref.byteLength > payload.byteLength) {
    throw new RangeError(
      `BufferRef out of range: [${ref.byteOffset}, ${ref.byteOffset + ref.byteLength}) ` +
        `exceeds payload of ${payload.byteLength} bytes`,
    );
  }
  if (ref.byteLength % bytes !== 0) {
    throw new RangeError(
      `BufferRef byteLength ${ref.byteLength} is not a multiple of ${bytes} (${ref.dtype})`,
    );
  }

  const absolute = payload.byteOffset + ref.byteOffset;
  const count = ref.byteLength / bytes;

  let buffer: ArrayBufferLike = payload.buffer;
  let offset = absolute;
  if (bytes > 1 && absolute % bytes !== 0) {
    const copy = payload.slice(ref.byteOffset, ref.byteOffset + ref.byteLength);
    buffer = copy.buffer;
    offset = copy.byteOffset;
  }

  switch (ref.dtype) {
    case 'f32':
      return new Float32Array(buffer, offset, count);
    case 'i32':
      return new Int32Array(buffer, offset, count);
    case 'u32':
      return new Uint32Array(buffer, offset, count);
    case 'u8':
      return new Uint8Array(buffer, offset, count);
  }
}

/* ------------------------------------------------------------------ *
 * Frame headers
 * ------------------------------------------------------------------ */

export type GeometryKind = 'indexed-mesh' | 'cgo-draw-arrays';

export interface GeometryFrameCommon {
  /** Geometry payload version; independent of PROTOCOL_VERSION. */
  v: 1;
  kind: GeometryKind;
  /** Object name, e.g. '1ubq'. */
  object: string;
  /** PyMOL state (0 = current). */
  state: number;
  rep: RepId;
  /** Monotonic per connection; matches the `geometry` topic event that announced it. */
  seq: number;
  /**
   * Optional 4x4 column-major object matrix (`cmd.get_object_matrix`), needed
   * when `matrix_mode != 0` because ObjectMolecule::render applies it
   * (`layer2/ObjectMolecule.cpp:11265-11269`). Absent means identity.
   */
  matrix?: readonly number[];
  /** Total payload byte length, for sanity checking. */
  payloadBytes: number;
}

/**
 * RepSurface, memcpy'd — geometry-extraction.md §6b.
 * `position`/`normal`/`color` are 3N floats, `alpha`/`ao` are N floats,
 * `index` is 3*ntris int32, `atom`/`vis` are N int32.
 */
export interface IndexedMeshHeader extends GeometryFrameCommon {
  kind: 'indexed-mesh';
  counts: { verts: number; tris: number };
  buffers: {
    position: BufferRef;
    normal?: BufferRef;
    color?: BufferRef;
    alpha?: BufferRef;
    ao?: BufferRef;
    index?: BufferRef;
    atom?: BufferRef;
    vis?: BufferRef;
  };
  /** `RepSurface::proximity`. */
  proximity: boolean;
  /** Single flat colour for the whole mesh, or null when per-vertex. */
  oneColor: readonly [number, number, number] | null;
}

/**
 * One `cgo::draw::arrays` block (`layer1/CGO.h:338-355`).
 *
 * `data` points at the heap block whose sub-arrays are laid out CONSECUTIVELY
 * (not interleaved) in this order, per `layer1/CGO.cpp:1650-1671`:
 *   [vertex 3N][normal 3N]?[color 4N]?[pickcolor rgba N + index 2N]?[access N]?
 * Use `cgoArraysLayout()` to get the float offsets.
 */
export interface CgoDrawArraysBlock {
  /** GL primitive mode; one of GLMode. */
  mode: number;
  /** Bitwise OR of CGOArrayBit values. */
  arraybits: number;
  nverts: number;
  data: BufferRef;
}

export interface CgoDrawArraysHeader extends GeometryFrameCommon {
  kind: 'cgo-draw-arrays';
  blocks: CgoDrawArraysBlock[];
  /** Sphere impostor instances, SPHERE_ITEM_SIZE floats each. */
  spheres?: BufferRef;
  /**
   * Shader-cylinder impostor instances. `itemSize` distinguishes
   * SHADER_CYLINDER_ITEM_SIZE from SHADER_CYLINDER_2ND_COLOR_ITEM_SIZE.
   */
  cylinders?: BufferRef;
}

export type GeometryFrameHeader = IndexedMeshHeader | CgoDrawArraysHeader;

/** A decoded binary frame: parsed header + the raw payload view. */
export interface GeometryFrame<H extends GeometryFrameHeader = GeometryFrameHeader> {
  header: H;
  /** View onto the frame buffer; NOT copied when alignment allows. */
  payload: Uint8Array;
}

/* ------------------------------------------------------------------ *
 * Header guards
 * ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isBufferRef(v: unknown): v is BufferRef {
  return (
    isRecord(v) &&
    typeof v['byteOffset'] === 'number' &&
    typeof v['byteLength'] === 'number' &&
    typeof v['itemSize'] === 'number' &&
    typeof v['dtype'] === 'string' &&
    Object.prototype.hasOwnProperty.call(DTYPE_BYTES, v['dtype'])
  );
}

export function isIndexedMeshHeader(v: unknown): v is IndexedMeshHeader {
  if (!isRecord(v) || v['kind'] !== 'indexed-mesh') return false;
  const buffers = v['buffers'];
  return isRecord(buffers) && isBufferRef(buffers['position']);
}

export function isCgoDrawArraysHeader(v: unknown): v is CgoDrawArraysHeader {
  if (!isRecord(v) || v['kind'] !== 'cgo-draw-arrays') return false;
  const blocks = v['blocks'];
  return (
    Array.isArray(blocks) &&
    blocks.every(
      (b) =>
        isRecord(b) &&
        typeof b['mode'] === 'number' &&
        typeof b['arraybits'] === 'number' &&
        typeof b['nverts'] === 'number' &&
        isBufferRef(b['data']),
    )
  );
}

export function isGeometryFrameHeader(v: unknown): v is GeometryFrameHeader {
  if (!isRecord(v)) return false;
  if (v['v'] !== 1) return false;
  if (typeof v['object'] !== 'string') return false;
  if (typeof v['state'] !== 'number') return false;
  if (typeof v['rep'] !== 'number') return false;
  return isIndexedMeshHeader(v) || isCgoDrawArraysHeader(v);
}

/* ------------------------------------------------------------------ *
 * Frame codec
 * ------------------------------------------------------------------ */

export const GEOMETRY_HEADER_LENGTH_BYTES = 4;
/** JSON header is space-padded so the payload starts 4-byte aligned. */
export const GEOMETRY_HEADER_ALIGNMENT = 4;

/** Thrown for malformed binary frames. */
export class GeometryFrameError extends Error {
  override name = 'GeometryFrameError';
}

/**
 * Read only the header length prefix. Cheap probe before committing to a parse.
 */
export function geometryHeaderLength(frame: ArrayBuffer | Uint8Array): number {
  const u8 = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (u8.byteLength < GEOMETRY_HEADER_LENGTH_BYTES) {
    throw new GeometryFrameError(`binary frame too short: ${u8.byteLength} bytes, need at least 4`);
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, GEOMETRY_HEADER_LENGTH_BYTES);
  return dv.getUint32(0, /* littleEndian */ true);
}

/**
 * Decode a binary geometry frame.
 *
 * The returned `payload` is a VIEW onto the input buffer (no copy). The header
 * is validated structurally; a header that does not match
 * `isGeometryFrameHeader` throws.
 */
export function decodeGeometryFrame(frame: ArrayBuffer | Uint8Array): GeometryFrame {
  const u8 = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  const headerLength = geometryHeaderLength(u8);
  const headerStart = GEOMETRY_HEADER_LENGTH_BYTES;
  const payloadStart = headerStart + headerLength;

  if (payloadStart > u8.byteLength) {
    throw new GeometryFrameError(
      `header length ${headerLength} exceeds frame of ${u8.byteLength} bytes`,
    );
  }

  const json = new TextDecoder().decode(u8.subarray(headerStart, payloadStart));
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new GeometryFrameError(`geometry header is not valid JSON: ${String(cause)}`);
  }
  if (!isGeometryFrameHeader(parsed)) {
    throw new GeometryFrameError(`geometry header failed validation: ${json.slice(0, 200)}`);
  }

  const payload = u8.subarray(payloadStart);
  if (typeof parsed.payloadBytes === 'number' && parsed.payloadBytes !== payload.byteLength) {
    throw new GeometryFrameError(
      `payloadBytes ${parsed.payloadBytes} != actual ${payload.byteLength}`,
    );
  }
  return { header: parsed, payload };
}

/**
 * Encode a binary geometry frame. Used by tests and by any JS-side producer
 * (fixtures, replay, the mock bridge); the real producer is the Python bridge,
 * which must implement the identical layout.
 */
export function encodeGeometryFrame(
  header: GeometryFrameHeader,
  payload: ArrayBuffer | ArrayBufferView,
): ArrayBuffer {
  const payloadU8 =
    payload instanceof ArrayBuffer
      ? new Uint8Array(payload)
      : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);

  const withLength: GeometryFrameHeader = {
    ...header,
    payloadBytes: payloadU8.byteLength,
  };

  const encoder = new TextEncoder();
  let json = JSON.stringify(withLength);
  let headerBytes = encoder.encode(json);
  const pad =
    (GEOMETRY_HEADER_ALIGNMENT - (headerBytes.byteLength % GEOMETRY_HEADER_ALIGNMENT)) %
    GEOMETRY_HEADER_ALIGNMENT;
  if (pad > 0) {
    // JSON tolerates trailing whitespace, so pad the text itself.
    json += ' '.repeat(pad);
    headerBytes = encoder.encode(json);
  }

  const total = GEOMETRY_HEADER_LENGTH_BYTES + headerBytes.byteLength + payloadU8.byteLength;
  const out = new ArrayBuffer(total);
  const outU8 = new Uint8Array(out);
  new DataView(out).setUint32(0, headerBytes.byteLength, /* littleEndian */ true);
  outU8.set(headerBytes, GEOMETRY_HEADER_LENGTH_BYTES);
  outU8.set(payloadU8, GEOMETRY_HEADER_LENGTH_BYTES + headerBytes.byteLength);
  return out;
}

/* ------------------------------------------------------------------ *
 * CGO_DRAW_ARRAYS block layout
 * ------------------------------------------------------------------ */

/** Offsets/lengths in FLOATS inside one `cgo::draw::arrays` data block. */
export interface CgoSubArray {
  /** Offset in floats from the start of the block. */
  offset: number;
  /** Components per vertex. */
  itemSize: number;
  /** Total floats (itemSize * nverts). */
  length: number;
}

export interface CgoArraysLayout {
  nverts: number;
  arraybits: number;
  vertex: CgoSubArray;
  normal?: CgoSubArray;
  color?: CgoSubArray;
  /** Packed RGBA picking colour, 1 float per vertex. */
  pickColorRgba?: CgoSubArray;
  /** {atom index, bond index} pair per vertex. */
  pickColorIndex?: CgoSubArray;
  accessibility?: CgoSubArray;
  /** Total floats in the block — equals `narrays * nverts` in the C struct. */
  totalFloats: number;
}

/**
 * Reproduce the block layout of `CGOCombineBeginEnd`
 * (`layer1/CGO.cpp:1650-1671`). Sub-arrays are CONSECUTIVE, not interleaved.
 *
 * The pick-colour block is itself split: `[rgba: 1*nverts][index+bond: 2*nverts]`
 * (`layer1/CGO.cpp:1665-1668`).
 */
export function cgoArraysLayout(arraybits: number, nverts: number): CgoArraysLayout {
  let offset = 0;
  const take = (itemSize: number): CgoSubArray => {
    const sub: CgoSubArray = { offset, itemSize, length: itemSize * nverts };
    offset += sub.length;
    return sub;
  };

  // CGO_VERTEX_ARRAY is always present (assert at layer1/CGO.cpp:1651).
  const vertex = take(CGO_VERTEX_POS_SIZE);
  const layout: CgoArraysLayout = {
    nverts,
    arraybits,
    vertex,
    totalFloats: 0,
  };

  if (arraybits & CGOArrayBit.Normal) {
    layout.normal = take(CGO_VERTEX_NORMAL_SIZE);
  }
  if (arraybits & CGOArrayBit.Color) {
    layout.color = take(CGO_VERTEX_COLOR_SIZE);
  }
  if (arraybits & CGOArrayBit.PickColor) {
    layout.pickColorRgba = take(CGO_VERTEX_PICKCOLOR_RGBA_SIZE);
    layout.pickColorIndex = take(CGO_VERTEX_PICKCOLOR_INDEX_SIZE);
  }
  if (arraybits & CGOArrayBit.Accessibility) {
    layout.accessibility = take(CGO_VERTEX_ACCESSIBILITY_SIZE);
  }

  layout.totalFloats = offset;
  return layout;
}

/**
 * Floats per vertex across all sub-arrays of a block — the C struct's
 * `narrays` (`layer1/CGO.h:341-352`), recomputed here so a client can validate
 * `data.byteLength === narrays * nverts * 4` before uploading to the GPU.
 */
export function cgoNarrays(arraybits: number): number {
  let n = CGO_VERTEX_POS_SIZE;
  if (arraybits & CGOArrayBit.Normal) n += CGO_VERTEX_NORMAL_SIZE;
  if (arraybits & CGOArrayBit.Color) n += CGO_VERTEX_COLOR_SIZE;
  if (arraybits & CGOArrayBit.PickColor) n += CGO_VERTEX_PICKCOLOR_SIZE;
  if (arraybits & CGOArrayBit.Accessibility) n += CGO_VERTEX_ACCESSIBILITY_SIZE;
  return n;
}
