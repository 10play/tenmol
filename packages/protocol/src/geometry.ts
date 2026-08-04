/**
 * @tenmol/protocol — binary frames: Mode G geometry and Mode P pixels.
 *
 * WP-01, plan §6. Migrated and extended from the pre-WP `src/geometry.ts`.
 *
 * PRODUCT DECISION (overrides plan §4's "no C++ on the critical path"): BOTH
 * render modes ship from the start.
 *
 *   Mode P — the bridge renders with PyMOL's own shaders into an offscreen FBO,
 *            reads the framebuffer back and streams encoded bitmaps.
 *            Measured 3.4 ms/frame at 1280x960 on 1AON (plan §1.3). This is the
 *            correctness baseline and the fallback for every rep Mode G cannot
 *            express.
 *   Mode G — `packages/engine/layer4/CmdWebGeometry.cpp` (plan §4 Task 1) hands PyMOL's own
 *            CPU-side buffers to three.js. Enabled PER REP with automatic
 *            fallback to Mode P.
 *
 * ---------------------------------------------------------------------------
 * WIRE FORMAT (server -> client, WebSocket BINARY frame) — unchanged from the
 * verified pre-WP implementation, including the 4-byte header alignment:
 *
 *   [ 0 .. 3 ]                       uint32 little-endian  headerLength
 *   [ 4 .. 4+headerLength )          UTF-8 JSON            BinaryFrameHeader
 *   [ 4+headerLength .. end )        raw bytes             payload
 *
 * `headerLength` is space-padded (0x20 inside the JSON text, which JSON
 * tolerates) to a multiple of `BINARY_FRAME_ALIGNMENT` = 4, so the payload
 * starts at a 4-byte-aligned offset from the frame start. A WebSocket binary
 * frame arrives as an ArrayBuffer at byteOffset 0, so the ABSOLUTE offset of
 * every 4-aligned BufferRef is also 4-aligned and `viewOf()` is ZERO COPY.
 * DO NOT REGRESS THIS: dropping the padding forces a memcpy of every buffer
 * (`viewOf` degrades to `payload.slice`), which on 1AON is ~93 MB per pull.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE MODE-G PAYLOAD CONTAINS, and why (all from `spikes/geometry.md`
 * and plan §1.3 — three constraints, each from a MEASURED failure of the
 * existing exporters):
 *
 *  1. Sphere and cylinder primitives are emitted as INSTANCE BUFFERS, never
 *     tessellated. `CGO_SPHERE` (`packages/engine/layer1/CGO.h:99`), `CGO_SHADER_CYLINDER`
 *     (`:197`), `CGO_SHADER_CYLINDER_WITH_2ND_COLOR` (`:200`). Tessellating is
 *     exactly how the exporters destroy `mesh`/`dots`/`lines`: a 660-atom 1UBQ
 *     `mesh` became 31,710 cylinders + 63,420 spheres = 31.9 MB `.wrl` /
 *     133.7 MB `.dae`; `dots` became a 658 MB `.dae` (spike 03 §4).
 *  2. Payloads are keyed PER OBJECT, PER REP, PER STATE and carry ATOM INDICES
 *     (`RepSurface::AT`, `packages/engine/layer2/RepSurface.cpp:84`; `CGO_PICK_COLOR`,
 *     `packages/engine/layer1/CGO.h:150-151`). Without that there is no per-rep update, no
 *     recolour-only update, and every change forces a full scene re-pull —
 *     measured: one `cmd.color` on 1AON cost a fresh 1.92 s + 246 MB through
 *     `get_vrml` (spike 03 §3.1).
 *  3. `CGO_DRAW_ARRAYS` blocks (`packages/engine/layer1/CGO.h:167`, struct at `:338-355`) are
 *     passed VERBATIM — the heap block laid out by `CGOCombineBeginEnd`
 *     (`packages/engine/layer1/CGO.cpp:1645-1672`) is a three.js BufferGeometry with zero
 *     conversion. The accessor never reads back a VBO (`packages/engine/layer1/CGO.h:183-186`
 *     documents that the CPU copy is deliberately destroyed after upload).
 *
 * Zero runtime dependencies; only pure functions live here.
 */

/* ------------------------------------------------------------------ *
 * Rep identity
 * ------------------------------------------------------------------ */

/** `enum cRep_t`, `packages/engine/layer1/Rep.h:48-74`. Values are session-stable. */
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

export const REP_COUNT = 21; // cRepCnt, packages/engine/layer1/Rep.h:73

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

export function repName(rep: RepId): string {
  return REP_NAMES[rep] ?? `rep${rep}`;
}

/** `cRepInv_t` ladder, `packages/engine/layer1/Rep.h:133-184`. Higher = more invalidated. */
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

/**
 * At or below `RepInv.Color` only the colour attributes changed, so a Mode-G
 * client re-pulls the colour buffer and keeps positions/indices
 * (plan §1.3 constraint 2, and WP-26's acceptance: "`cmd.color` re-ships only
 * the colour attribute").
 */
export function isColorOnlyInvalidation(level: RepInvalidationLevel): boolean {
  return level > RepInv.None && level <= RepInv.Color;
}

/* ------------------------------------------------------------------ *
 * Per object / per rep / per state keying
 * ------------------------------------------------------------------ */

/**
 * The identity of one Mode-G payload. Plan §1.3 constraint 2: the accessor is
 * keyed per object, per rep, per state — a scene-flattened feed (which is all
 * every existing exporter produces: "VRML2 Shape count: 1, 'DEF' occurrences:
 * 0", spike 03 §4.2) cannot express a per-rep toggle or a recolour.
 */
export interface GeometryKey {
  /** PyMOL object name, e.g. '1ubq'. Never a selection. */
  object: string;
  /** PyMOL state; 0 means "the current state" (`cmd` state convention). */
  state: number;
  rep: RepId;
}

/**
 * Separator for {@link geometryKey}. A PyMOL object name may legally contain
 * spaces, slashes and dots (`cmd.set_name` accepts anything the parser can
 * quote), so the separator must be a character a name cannot contain: U+0000.
 */
export const GEOMETRY_KEY_SEP = '\u0000';

/** Stable per-object/per-rep/per-state cache key. */
export function geometryKey(k: GeometryKey): string {
  return [k.object, k.state, k.rep].join(GEOMETRY_KEY_SEP);
}

export function parseGeometryKey(s: string): GeometryKey | null {
  const parts = s.split(GEOMETRY_KEY_SEP);
  if (parts.length !== 3) return null;
  const [object, state, rep] = parts as [string, string, string];
  const st = Number(state);
  const rp = Number(rep);
  if (!Number.isFinite(st) || !Number.isFinite(rp)) return null;
  return { object, state: st, rep: rp };
}

export function sameGeometryKey(a: GeometryKey, b: GeometryKey): boolean {
  return a.object === b.object && a.state === b.state && a.rep === b.rep;
}

/* ------------------------------------------------------------------ *
 * Render mode: the per-rep toggle
 * ------------------------------------------------------------------ */

/** `'pixel'` = Mode P (server-rendered bitmap), `'geometry'` = Mode G (three.js). */
export const RENDER_MODES = ['pixel', 'geometry'] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

export function isRenderMode(v: unknown): v is RenderMode {
  return v === 'pixel' || v === 'geometry';
}

/**
 * Why a rep that was REQUESTED in Mode G is being served in Mode P instead.
 * The client must surface this (a silently-empty screen is exactly the failure
 * the exporters produce: ellipsoids/labels/volume emit 0 bytes with no error,
 * spike 03 §4.1).
 */
export const MODE_G_FALLBACK_REASONS = [
  /** The rep has no Mode-G expression at all (labels, volume, callback). */
  'unsupported-rep',
  /** This bridge build has no `CmdGetRepGeometry` (plan §4 Task 1 not present). */
  'no-accessor',
  /** The accessor raised, or the rep produced zero buffers. */
  'extraction-failed',
  /**
   * `RepCartoon::disposePreshaderCGO` (`packages/engine/layer2/RepCartoon.cpp:83-89,240`) fired
   * because Mode P renders for real, so the preshader was gone. Plan §1.3:
   * WP-26 must extract from `primitiveCGO` or rebuild — until it does, fall back.
   */
  'preshader-disposed',
  /** Payload exceeded the client's budget for a single rep. */
  'payload-too-large',
  /** No WebGL2 context available in this browser/tab. */
  'webgl-unavailable',
  /** The user pinned this rep to Mode P. */
  'user-preference',
] as const;
export type ModeGFallbackReason = (typeof MODE_G_FALLBACK_REASONS)[number];

/** The effective mode for one rep of one object, with the reason if degraded. */
export interface RepRenderState {
  rep: RepId;
  requested: RenderMode;
  effective: RenderMode;
  /** Present iff `requested === 'geometry' && effective === 'pixel'`. */
  fallbackReason?: ModeGFallbackReason;
}

/** The client's whole-scene mode policy. Sent to the bridge, echoed back. */
export interface RenderModePolicy {
  /** Applied to any rep with no explicit entry. */
  default: RenderMode;
  /** Explicit per-rep overrides. */
  perRep: readonly RepRenderState[];
}

/**
 * Reps that Mode G can express at all, given plan §4 Task 1's two extraction
 * paths. Everything else falls back to Mode P with `'unsupported-rep'`.
 *
 *   surface / slice        -> `RepSurface`-style indexed mesh (spike 03 §4:
 *                             `slice` exports 27,328 real triangles; `volume`
 *                             exports 0 bytes — they are NOT the same category).
 *   cartoon / sticks / spheres / ribbon / lines / mesh / dots / nonbonded /
 *   nb_spheres / dashes / ellipsoids / cell / cgo / extent / angles / dihedrals
 *                          -> CGO walk (draw-arrays blocks + instance buffers).
 *
 * Excluded, deliberately:
 *   labels   — text, needs a DOM/atlas overlay, not geometry (0 bytes in every
 *              exporter, spike 03 §4).
 *   volume   — a 3-D scalar field, served through `get_volume_field` as a blob.
 *   callback — "requires a real GL context to even construct" (spike 03 §4).
 */
export const MODE_G_CAPABLE_REPS: readonly RepId[] = [
  Rep.Cyl,
  Rep.Sphere,
  Rep.Surface,
  Rep.NonbondedSphere,
  Rep.Cartoon,
  Rep.Ribbon,
  Rep.Line,
  Rep.Mesh,
  Rep.Dot,
  Rep.Dash,
  Rep.Nonbonded,
  Rep.Cell,
  Rep.CGO,
  Rep.Extent,
  Rep.Slice,
  Rep.Angle,
  Rep.Dihedral,
  Rep.Ellipsoid,
];

const MODE_G_CAPABLE_SET: ReadonlySet<RepId> = new Set(MODE_G_CAPABLE_REPS);

export function isModeGCapable(rep: RepId): boolean {
  return MODE_G_CAPABLE_SET.has(rep);
}

/** Resolve the effective mode for one rep against a policy. Pure. */
export function resolveRenderMode(
  rep: RepId,
  policy: RenderModePolicy,
  caps: { accessor: boolean; webgl: boolean } = { accessor: true, webgl: true },
): RepRenderState {
  const override = policy.perRep.find((e) => e.rep === rep);
  const requested: RenderMode = override?.requested ?? policy.default;
  if (requested === 'pixel') return { rep, requested, effective: 'pixel' };

  let reason: ModeGFallbackReason | undefined;
  if (!caps.webgl) reason = 'webgl-unavailable';
  else if (!caps.accessor) reason = 'no-accessor';
  else if (!isModeGCapable(rep)) reason = 'unsupported-rep';
  else if (override?.fallbackReason !== undefined) reason = override.fallbackReason;

  return reason === undefined
    ? { rep, requested, effective: 'geometry' }
    : { rep, requested, effective: 'pixel', fallbackReason: reason };
}

/* ------------------------------------------------------------------ *
 * CGO constants (mirrors of the C headers)
 * ------------------------------------------------------------------ */

/** GL primitive modes accepted by CGO_BEGIN, `packages/engine/layer1/CGO.h:68-72` and
 *  `packages/engine/modules/pymol/cgo.py:21-27`. These are the *only* legal `mode` values. */
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

/** `arraybits` flags, `packages/engine/layer1/CGO.h:272-277`. */
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
 *   VERTEX_POS_SIZE 3 / VERTEX_COLOR_SIZE 4   (packages/engine/layer0/ShaderMgr.h:430-431)
 *   VERTEX_NORMAL_SIZE 3                      (packages/engine/layer1/CGO.cpp:54)
 *   VERTEX_PICKCOLOR_SIZE = 1 (rgba) + 2 (index, bond)  (packages/engine/layer1/CGO.cpp:60-64)
 *   VERTEX_ACCESSIBILITY_SIZE 1               (packages/engine/layer1/CGO.cpp:65)
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

/** Opcodes referenced by the geometry feed, `packages/engine/layer1/CGO.h:82-270`. */
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
  Cone: 0x1b,
  DrawArrays: 0x1c,
  PickColor: 0x1f,
  BoundingBox: 0x22,
  ShaderCylinder: 0x26,
  ShaderCylinderWith2ndColor: 0x27,
  Accessibility: 0x29,
  CustomCylinderAlpha: 0x41,
} as const;

/**
 * `*_SZ` operand counts straight from `packages/engine/layer1/CGO.h`. These describe the C op
 * as stored in the CGO buffer — NOT the wire layout. The wire instance layouts
 * are `INSTANCE_ITEM_SIZE` below, which additionally carry colour (the C ops
 * inherit colour from the preceding `CGO_COLOR`, which a GPU instance buffer
 * cannot).
 *
 * NOT A CONTRADICTION: `CGO_OP_SIZE.cone` is 16 and `INSTANCE_ITEM_SIZE.cone`
 * is 18. Different things — 16 is `CGO_CONE_SZ`, the operand count of the C
 * opcode; 18 is the wire instance, which carries both end colours explicitly.
 * Reconciling them by making one match the other would corrupt one of the two.
 */
export const CGO_OP_SIZE: Readonly<Record<string, number>> = {
  sphere: 4, // CGO_SPHERE_SZ,                       packages/engine/layer1/CGO.h:100
  ellipsoid: 13, // CGO_ELLIPSOID_SZ,                packages/engine/layer1/CGO.h:126
  cone: 16, // CGO_CONE_SZ,                          packages/engine/layer1/CGO.h:147
  pickColor: 2, // CGO_PICK_COLOR_SZ,                packages/engine/layer1/CGO.h:151
  shaderCylinder: 8, // CGO_SHADER_CYLINDER_SZ,      packages/engine/layer1/CGO.h:198
  shaderCylinder2ndColor: 13, // ..._WITH_2ND_COLOR_SZ, packages/engine/layer1/CGO.h:201
};

/* ------------------------------------------------------------------ *
 * Instance buffers — NEVER tessellated (plan §1.3 constraint 1)
 * ------------------------------------------------------------------ */

export const INSTANCE_KINDS = [
  'sphere',
  'cylinder',
  'cylinder2',
  'cone',
  'ellipsoid',
  'line',
  'cross',
] as const;
export type InstanceKind = (typeof INSTANCE_KINDS)[number];

/**
 * float32 items per instance, ON THE WIRE. Fixed here so the C++ accessor
 * (WP-26) and the three.js impostor materials (WP-26) cannot disagree.
 *
 *   sphere    8: cx,cy,cz, radius, r,g,b,a
 *                (`geometry-extraction.md:413` — "cx,cy,cz,r,rr,gg,bb,aa")
 *   cylinder 12: ox,oy,oz, ax,ay,az, radius, capbits, r,g,b,a
 *                (`cgo::draw::shadercylinder` = origin[3], axis[3], tube_size,
 *                 cap; `packages/engine/layer1/CGO.h:635-644` — colour appended)
 *   cylinder2 16: ox,oy,oz, ax,ay,az, radius, capbits, r1,g1,b1,a1, r2,g2,b2,a2
 *                (`cgo::draw::shadercylinder2ndcolor`, `packages/engine/layer1/CGO.h:646-658`)
 *   cone     18: v1[3], v2[3], radius1, radius2, cap1, cap2, rgba1[4], rgba2[4]
 *                (`cgo::draw::cone`, `packages/engine/layer1/CGO.h:719-731`)
 *   ellipsoid 16: center[3], m[9] (column-major 3x3), r,g,b,a
 *                (`CGO_ELLIPSOID`, `packages/engine/layer1/CGO.h:125-126`)
 *   line     14: v1[3], v2[3], rgba1[4], rgba2[4]
 *                (`CGO_LINE` / `CGO_SPLITLINE`, `packages/engine/layer1/CGO.h:212-216`. The
 *                 accessor funnels lines, ribbon, nonbonded, cell, extent,
 *                 dashes, angles and dihedrals through this one bucket, so a
 *                 single line primitive covers eight reps.)
 *   cross     7: center[3], rgba[4]
 *                (`CGO_VERTEX_CROSS`. Centre only — the client expands it into
 *                 three axis-aligned segments of length `nonbondedSize`, which
 *                 is what `RepNonbonded` draws. Expanding server-side would
 *                 triple the wire cost for data the GPU can generate.)
 */
export const INSTANCE_ITEM_SIZE: Readonly<Record<InstanceKind, number>> = {
  sphere: 8,
  cylinder: 12,
  cylinder2: 16,
  cone: 18,
  ellipsoid: 16,
  line: 14,
  cross: 7,
};

/**
 * Reps whose Mode-G payload MUST contain at least one instance buffer. If the
 * accessor ever emits only draw-arrays blocks for one of these it has
 * tessellated, which is the exact regression that turned 1UBQ `mesh` into
 * 31,710 cylinders + 63,420 spheres in the exporters (spike 03 §4).
 * `geometryFrameProblems()` checks this.
 */
export const INSTANCED_ONLY_REPS: readonly RepId[] = [
  Rep.Sphere,
  Rep.NonbondedSphere,
  Rep.Dot,
  Rep.Ellipsoid,
];

/** One instance buffer. `count * itemSize * 4 === data.byteLength`. */
export interface InstanceBuffer {
  kind: InstanceKind;
  count: number;
  /** Always `INSTANCE_ITEM_SIZE[kind]`; carried so a client can validate. */
  itemSize: number;
  /** float32, `count * itemSize` elements. */
  data: BufferRef;
  /**
   * int32, one atom index per instance (`CGO_PICK_COLOR` operand 0,
   * `packages/engine/layer1/CGO.h:150-151`). Required for picking and for per-atom recolour.
   */
  atom?: BufferRef;
  /**
   * int32, one bond index per instance (`CGO_PICK_COLOR` operand 1). -1 for
   * atom-level primitives. Sentinels: `packages/engine/modules/pymol/cgo.py:73-77`.
   */
  bond?: BufferRef;
}

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

export function isGeometryDType(v: unknown): v is GeometryDType {
  return v === 'f32' || v === 'i32' || v === 'u32' || v === 'u8';
}

/**
 * A slice of the frame payload. `byteOffset` is relative to the START of the
 * payload (i.e. after the header), never to the start of the frame.
 *
 * Producers MUST place every non-`u8` ref at a `BINARY_FRAME_ALIGNMENT`-aligned
 * `byteOffset` (use `alignUp`). That, plus the padded header, is what keeps
 * `viewOf()` zero-copy.
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

export type GeometryTypedArray = Float32Array | Int32Array | Uint32Array | Uint8Array;

/* ------------------------------------------------------------------ *
 * Frame headers
 * ------------------------------------------------------------------ */

export type BinaryFrameKind = 'indexed-mesh' | 'cgo-draw-arrays' | 'pixels';

/** Mode-G kinds only. */
export type GeometryKind = 'indexed-mesh' | 'cgo-draw-arrays';

export interface BinaryFrameCommon {
  /** Binary-frame payload version; independent of PROTOCOL_VERSION. */
  v: 1;
  kind: BinaryFrameKind;
  /** Monotonic per connection; matches the topic event that announced it. */
  seq: number;
  /** Total payload byte length, for sanity checking. */
  payloadBytes: number;
}

export interface GeometryFrameCommon extends BinaryFrameCommon, GeometryKey {
  kind: GeometryKind;
  /**
   * Optional 4x4 column-major object matrix (`cmd.get_object_matrix`), needed
   * when `matrix_mode != 0` because ObjectMolecule::render applies it
   * (`packages/engine/layer2/ObjectMolecule.cpp:11265-11269`). Absent means identity.
   */
  matrix?: readonly number[];
  /**
   * The `cRepInv_t` level that caused this pull. When
   * `isColorOnlyInvalidation(level)` the frame is allowed to carry ONLY the
   * colour buffers and the client keeps its cached positions/indices.
   */
  level?: RepInvalidationLevel;
  /** True when this frame replaces only the buffers it carries. */
  partial?: boolean;
}

/**
 * `RepSurface`, memcpy'd. Field names map 1:1 onto `struct RepSurface`
 * (`packages/engine/layer2/RepSurface.cpp:59-101`):
 *
 *   position <- V   (3N float)   normal <- VN  (3N float)
 *   color    <- VC  (3N float)   alpha  <- VA  (N float)
 *   ao       <- VAO (N float)    index  <- T   (3*NT int)
 *   strip    <- S   (int)        vis    <- Vis (N int)
 *   atom     <- AT  (N int, "closest atom for vertices", `:84`)
 *
 * `AT` is the ONLY per-vertex atom mapping PyMOL has for a surface, and it is
 * absent from every exporter and from `pymol._cache` (spike 03 §7: the cache
 * tuple has exactly 6 elements, "no VC, no VA, no VAO, no Vis, no AT").
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
    strip?: BufferRef;
    atom?: BufferRef;
    vis?: BufferRef;
  };
  /** `RepSurface::proximity` (`cSetting_surface_proximity`). */
  proximity: boolean;
  /**
   * `RepSurface::oneColorFlag ? oneColor : null` — a single flat colour for the
   * whole mesh, in which case `buffers.color` is absent.
   */
  oneColor: readonly [number, number, number] | null;
}

/**
 * One `cgo::draw::arrays` block (`packages/engine/layer1/CGO.h:338-355`), VERBATIM.
 *
 * `data` points at the heap block whose sub-arrays are laid out CONSECUTIVELY
 * (not interleaved) in this order, per `packages/engine/layer1/CGO.cpp:1650-1671`:
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
  /** May be empty when the rep is purely instanced (spheres, dots). */
  blocks: CgoDrawArraysBlock[];
  /**
   * Impostor instances. NEVER tessellated (plan §1.3 constraint 1).
   * May be empty when the rep is purely triangulated (cartoon, surface).
   */
  instances: InstanceBuffer[];
}

/* ------------------------------------------------------------------ *
 * Mode P — server-rendered bitmap frames
 * ------------------------------------------------------------------ */

/**
 * Measured encode costs at 1280x960 on 1AON (plan §1.3):
 *   jpeg q80 1.9 ms / 209,186 B   <- during motion
 *   png  L1  10.5 ms / 746,205 B  <- lossless-on-settle
 *   webp q80 18.8 ms / 175,370 B  <- too slow to be the motion codec
 *   raw-rgba                      <- localhost debugging only, 4.9 MB/frame
 */
export const PIXEL_ENCODINGS = ['jpeg', 'png', 'webp', 'raw-rgba'] as const;
export type PixelEncoding = (typeof PIXEL_ENCODINGS)[number];

export function isPixelEncoding(v: unknown): v is PixelEncoding {
  return typeof v === 'string' && (PIXEL_ENCODINGS as readonly string[]).includes(v);
}

/** Lossless encodings, used once the scene settles. */
export const LOSSLESS_PIXEL_ENCODINGS: readonly PixelEncoding[] = ['png', 'raw-rgba'];

export function isLosslessEncoding(e: PixelEncoding): boolean {
  return LOSSLESS_PIXEL_ENCODINGS.includes(e);
}

/**
 * A Mode-P bitmap frame. The payload is the encoded image bytes (or raw RGBA
 * when `encoding === 'raw-rgba'`).
 */
export interface PixelFrameHeader extends BinaryFrameCommon {
  kind: 'pixels';
  /** Framebuffer pixels, i.e. CSS pixels * dpr. */
  width: number;
  height: number;
  /** Device pixel ratio this frame was rendered for. */
  dpr: number;
  encoding: PixelEncoding;
  /** 1..100 for lossy encodings; absent for lossless. */
  quality?: number;
  /**
   * True when row 0 of the payload is the BOTTOM row. `glReadPixels` returns
   * bottom-left origin, so an unflipped readback sets this and the client
   * flips at blit time (WP-04 owns the choice; the flag makes it explicit
   * rather than a silent convention).
   */
  flipY: boolean;
  /** True when the encoding is lossless — mirrors `isLosslessEncoding`. */
  lossless: boolean;
  /**
   * Monotonic frame id. The client answers with `{t:'ack', what:'pixels',
   * frameId}`; the bridge keeps at most one unacked frame in flight
   * (plan §6 WP-04).
   */
  frameId: number;
  /**
   * The 18 floats of `cmd.get_view()` this frame was rendered with, so the
   * client can detect and discard a frame that is already stale relative to
   * its own predicted camera. Optional.
   */
  view?: readonly number[];
  /**
   * THE COMPOSITION CONTRACT (defect D2). Reps that ARE in this bitmap.
   *
   *   draw a rep in Mode G  <=>  that rep is NOT in `reps`
   *
   * Use {@link pixelFrameDrawsRep} rather than testing by hand — the absent
   * case is the one that is easy to get wrong.
   *
   * - absent  — "the whole scene". Either the client never declared a Mode-G
   *             rep set, or the bridge predates D2. Mode G must draw NOTHING,
   *             because everything is already in the bitmap. Drawing anyway is
   *             precisely the double-draw defect: invisible on opaque cartoon,
   *             wrong on anything with alpha (two 50 %-alpha copies composite
   *             to 75 %), and a waste of the entire point of Mode G.
   * - `[]`    — the bitmap is background only: the bridge has stopped
   *             rasterising because the client declared every rep in the
   *             scene. Exactly one such frame is sent, and then no frames at
   *             all until the scene stops being fully covered. It is the
   *             correct background (PyMOL drew it, gradients and all), so
   *             leave it on the canvas rather than clearing to a guess.
   * - a list  — mixed mode. Those reps are the server's; the rest are yours.
   *
   * DEPTH. A Mode-P frame is flat: there is no depth buffer, so a client
   * cannot interleave its Mode-G geometry with the bitmap in Z. Composition is
   * painter's order — **every Mode-G object is in front of every Mode-P
   * object**. The bridge keeps that from being wrong by masking at OBJECT
   * granularity and guaranteeing the two rep sets are disjoint; the visible
   * consequence is that a Mode-P object can never occlude a Mode-G one. A
   * depth channel was measured (+0.67 ms readback and +3.0 to +7.9 ms compress
   * for +123 to +439 KB per frame at 1280x960, against a 3.4 ms colour frame)
   * and rejected.
   */
  reps?: readonly RepId[];
  /**
   * Objects the bridge disabled for this readback, purely diagnostic — the
   * composition decision is `reps`, which is already the union over everything
   * still in the picture.
   */
  maskedObjects?: readonly string[];
}

/**
 * Does this bitmap already contain `rep`? If it does, Mode G must not draw it.
 *
 * `header === null` (no frame yet) answers `true`: until the bridge has said
 * otherwise, assume it is drawing everything. Starting from "the server draws
 * nothing" would show an empty viewport against any bridge that never sends a
 * pixel frame at all.
 */
export function pixelFrameDrawsRep(
  header: { reps?: readonly RepId[] | undefined } | null | undefined,
  rep: RepId,
): boolean {
  if (header === null || header === undefined) return true;
  const reps = header.reps;
  if (reps === undefined) return true; // absent == the whole scene
  return reps.includes(rep);
}

/** True when the bridge has stopped rasterising: the bitmap is background only. */
export function isBackgroundOnlyFrame(
  header: { reps?: readonly RepId[] | undefined } | null | undefined,
): boolean {
  return header !== null && header !== undefined && header.reps?.length === 0;
}

/* ------------------------------------------------------------------ *
 * Frame unions
 * ------------------------------------------------------------------ */

export type GeometryFrameHeader = IndexedMeshHeader | CgoDrawArraysHeader;
export type BinaryFrameHeader = GeometryFrameHeader | PixelFrameHeader;

/** A decoded binary frame: parsed header + a VIEW onto the payload. */
export interface BinaryFrame<H extends BinaryFrameHeader = BinaryFrameHeader> {
  header: H;
  /** View onto the frame buffer; NOT copied. */
  payload: Uint8Array;
}

export type GeometryFrame<H extends GeometryFrameHeader = GeometryFrameHeader> = BinaryFrame<H>;
export type PixelFrame = BinaryFrame<PixelFrameHeader>;

export function isGeometryFrame(f: BinaryFrame): f is GeometryFrame {
  return f.header.kind !== 'pixels';
}

export function isPixelFrame(f: BinaryFrame): f is PixelFrame {
  return f.header.kind === 'pixels';
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
    isGeometryDType(v['dtype'])
  );
}

export function isInstanceBuffer(v: unknown): v is InstanceBuffer {
  return (
    isRecord(v) &&
    typeof v['kind'] === 'string' &&
    (INSTANCE_KINDS as readonly string[]).includes(v['kind']) &&
    typeof v['count'] === 'number' &&
    typeof v['itemSize'] === 'number' &&
    isBufferRef(v['data'])
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
  const instances = v['instances'];
  if (!Array.isArray(blocks) || !Array.isArray(instances)) return false;
  return (
    blocks.every(
      (b) =>
        isRecord(b) &&
        typeof b['mode'] === 'number' &&
        typeof b['arraybits'] === 'number' &&
        typeof b['nverts'] === 'number' &&
        isBufferRef(b['data']),
    ) && instances.every(isInstanceBuffer)
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

export function isPixelFrameHeader(v: unknown): v is PixelFrameHeader {
  return (
    isRecord(v) &&
    v['v'] === 1 &&
    v['kind'] === 'pixels' &&
    typeof v['width'] === 'number' &&
    typeof v['height'] === 'number' &&
    typeof v['dpr'] === 'number' &&
    isPixelEncoding(v['encoding']) &&
    typeof v['flipY'] === 'boolean' &&
    typeof v['frameId'] === 'number'
  );
}

export function isBinaryFrameHeader(v: unknown): v is BinaryFrameHeader {
  return isGeometryFrameHeader(v) || isPixelFrameHeader(v);
}

/* ------------------------------------------------------------------ *
 * Semantic validation
 * ------------------------------------------------------------------ */

/**
 * Structural checks a well-formed header must pass but a type guard cannot
 * express. Returns [] when the frame is sound. Used by the round-trip test and
 * by WP-26's bridge tests; cheap enough to run behind a dev flag in the client.
 */
export function geometryFrameProblems(header: GeometryFrameHeader): string[] {
  const out: string[] = [];
  const push = (m: string): void => {
    out.push(m);
  };

  const checkRef = (name: string, ref: BufferRef): void => {
    const bytes = DTYPE_BYTES[ref.dtype];
    if (ref.byteLength % bytes !== 0) {
      push(`${name}: byteLength ${ref.byteLength} is not a multiple of ${bytes} (${ref.dtype})`);
    }
    if (bytes > 1 && ref.byteOffset % BINARY_FRAME_ALIGNMENT !== 0) {
      push(
        `${name}: byteOffset ${ref.byteOffset} is not ${BINARY_FRAME_ALIGNMENT}-byte aligned; ` +
          `viewOf() would have to memcpy`,
      );
    }
    if (ref.itemSize > 0 && elementCount(ref) % ref.itemSize !== 0) {
      push(`${name}: ${elementCount(ref)} elements is not a multiple of itemSize ${ref.itemSize}`);
    }
  };

  if (header.kind === 'indexed-mesh') {
    const b = header.buffers;
    checkRef('position', b.position);
    if (itemCount(b.position) !== header.counts.verts) {
      push(
        `position has ${itemCount(b.position)} vertices, counts.verts says ${header.counts.verts}`,
      );
    }
    for (const [name, ref] of Object.entries(b)) {
      if (ref && name !== 'position') checkRef(name, ref);
    }
    if (b.index && itemCount(b.index) !== header.counts.tris) {
      push(`index has ${itemCount(b.index)} triangles, counts.tris says ${header.counts.tris}`);
    }
    if (!b.color && header.oneColor === null) {
      push('no per-vertex colour and no oneColor: this mesh would render untinted');
    }
    if (!b.atom) {
      push('no atom buffer (RepSurface::AT): picking and per-atom recolour are impossible');
    }
  } else {
    for (const [i, blk] of header.blocks.entries()) {
      if (!isGLMode(blk.mode)) push(`blocks[${i}]: mode ${blk.mode} is not a legal CGO_BEGIN mode`);
      checkRef(`blocks[${i}].data`, blk.data);
      const expect = cgoNarrays(blk.arraybits) * blk.nverts * DTYPE_BYTES.f32;
      if (blk.data.byteLength !== expect) {
        push(
          `blocks[${i}]: data is ${blk.data.byteLength} B, ` +
            `narrays(${blk.arraybits}) * nverts(${blk.nverts}) * 4 = ${expect} B`,
        );
      }
    }
    for (const [i, inst] of header.instances.entries()) {
      const want = INSTANCE_ITEM_SIZE[inst.kind];
      if (inst.itemSize !== want) {
        push(`instances[${i}]: itemSize ${inst.itemSize} != ${want} for kind '${inst.kind}'`);
      }
      checkRef(`instances[${i}].data`, inst.data);
      if (itemCount(inst.data) !== inst.count) {
        push(`instances[${i}]: data holds ${itemCount(inst.data)} items, count says ${inst.count}`);
      }
      if (inst.atom) checkRef(`instances[${i}].atom`, inst.atom);
      if (inst.bond) checkRef(`instances[${i}].bond`, inst.bond);
    }
    if (INSTANCED_ONLY_REPS.includes(header.rep) && header.instances.length === 0) {
      push(
        `rep ${repName(header.rep)} carries no instance buffer — it has been TESSELLATED, ` +
          `which is the exporter failure plan §1.3 constraint 1 forbids`,
      );
    }
    if (header.blocks.length === 0 && header.instances.length === 0) {
      push('frame carries neither blocks nor instances: silent empty rep');
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Frame codec
 * ------------------------------------------------------------------ */

export const BINARY_FRAME_LENGTH_BYTES = 4;
/** JSON header is space-padded so the payload starts 4-byte aligned. */
export const BINARY_FRAME_ALIGNMENT = 4;

/** @deprecated pre-WP names, kept so no consumer breaks. */
export const GEOMETRY_HEADER_LENGTH_BYTES = BINARY_FRAME_LENGTH_BYTES;
/** @deprecated pre-WP names, kept so no consumer breaks. */
export const GEOMETRY_HEADER_ALIGNMENT = BINARY_FRAME_ALIGNMENT;

/** Round `n` up to the next multiple of `to` (default the frame alignment). */
export function alignUp(n: number, to: number = BINARY_FRAME_ALIGNMENT): number {
  const rem = n % to;
  return rem === 0 ? n : n + (to - rem);
}

/** Thrown for malformed binary frames. */
export class GeometryFrameError extends Error {
  override name = 'GeometryFrameError';
}

function asU8(frame: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (frame instanceof Uint8Array) return frame;
  if (ArrayBuffer.isView(frame)) {
    return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  }
  return new Uint8Array(frame);
}

/** Read only the header length prefix. Cheap probe before committing to a parse. */
export function binaryFrameHeaderLength(frame: ArrayBuffer | ArrayBufferView): number {
  const u8 = asU8(frame);
  if (u8.byteLength < BINARY_FRAME_LENGTH_BYTES) {
    throw new GeometryFrameError(`binary frame too short: ${u8.byteLength} bytes, need at least 4`);
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, BINARY_FRAME_LENGTH_BYTES);
  return dv.getUint32(0, /* littleEndian */ true);
}

/** @deprecated pre-WP name. */
export const geometryHeaderLength = binaryFrameHeaderLength;

/**
 * Decode a binary frame (geometry OR pixels).
 *
 * The returned `payload` is a VIEW onto the input buffer (no copy). The header
 * is validated structurally; a header that does not match
 * `isBinaryFrameHeader` throws.
 */
export function decodeBinaryFrame(frame: ArrayBuffer | ArrayBufferView): BinaryFrame {
  const u8 = asU8(frame);
  const headerLength = binaryFrameHeaderLength(u8);
  const headerStart = BINARY_FRAME_LENGTH_BYTES;
  const payloadStart = headerStart + headerLength;

  if (payloadStart > u8.byteLength) {
    throw new GeometryFrameError(
      `header length ${headerLength} exceeds frame of ${u8.byteLength} bytes`,
    );
  }
  if (headerLength % BINARY_FRAME_ALIGNMENT !== 0) {
    throw new GeometryFrameError(
      `header length ${headerLength} is not ${BINARY_FRAME_ALIGNMENT}-byte aligned; ` +
        `the payload would be misaligned and every view would need a memcpy`,
    );
  }

  const json = new TextDecoder().decode(u8.subarray(headerStart, payloadStart));
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new GeometryFrameError(`binary frame header is not valid JSON: ${String(cause)}`);
  }
  if (!isBinaryFrameHeader(parsed)) {
    throw new GeometryFrameError(`binary frame header failed validation: ${json.slice(0, 200)}`);
  }

  const payload = u8.subarray(payloadStart);
  if (typeof parsed.payloadBytes === 'number' && parsed.payloadBytes !== payload.byteLength) {
    throw new GeometryFrameError(
      `payloadBytes ${parsed.payloadBytes} != actual ${payload.byteLength}`,
    );
  }
  return { header: parsed, payload };
}

/** Decode and assert the frame is Mode G. */
export function decodeGeometryFrame(frame: ArrayBuffer | ArrayBufferView): GeometryFrame {
  const f = decodeBinaryFrame(frame);
  if (!isGeometryFrame(f)) {
    throw new GeometryFrameError(`expected a geometry frame, got kind '${f.header.kind}'`);
  }
  return f;
}

/** Decode and assert the frame is Mode P. */
export function decodePixelFrame(frame: ArrayBuffer | ArrayBufferView): PixelFrame {
  const f = decodeBinaryFrame(frame);
  if (!isPixelFrame(f)) {
    throw new GeometryFrameError(`expected a pixel frame, got kind '${f.header.kind}'`);
  }
  return f;
}

/**
 * Encode a binary frame. Used by tests and by any JS-side producer (fixtures,
 * replay, the mock bridge); the real producer is the Python bridge, which
 * implements the identical layout — see `packages/protocol/python/tenmol_wire.py`.
 */
export function encodeBinaryFrame(
  header: BinaryFrameHeader,
  payload: ArrayBuffer | ArrayBufferView,
): ArrayBuffer {
  const payloadU8 = asU8(payload);

  const withLength: BinaryFrameHeader = {
    ...header,
    payloadBytes: payloadU8.byteLength,
  };

  const encoder = new TextEncoder();
  let json = JSON.stringify(withLength);
  let headerBytes = encoder.encode(json);
  const pad =
    (BINARY_FRAME_ALIGNMENT - (headerBytes.byteLength % BINARY_FRAME_ALIGNMENT)) %
    BINARY_FRAME_ALIGNMENT;
  if (pad > 0) {
    // JSON tolerates trailing whitespace, so pad the text itself.
    json += ' '.repeat(pad);
    headerBytes = encoder.encode(json);
  }

  const total = BINARY_FRAME_LENGTH_BYTES + headerBytes.byteLength + payloadU8.byteLength;
  const out = new ArrayBuffer(total);
  const outU8 = new Uint8Array(out);
  new DataView(out).setUint32(0, headerBytes.byteLength, /* littleEndian */ true);
  outU8.set(headerBytes, BINARY_FRAME_LENGTH_BYTES);
  outU8.set(payloadU8, BINARY_FRAME_LENGTH_BYTES + headerBytes.byteLength);
  return out;
}

/** @deprecated pre-WP name; `encodeBinaryFrame` also takes pixel headers. */
export function encodeGeometryFrame(
  header: GeometryFrameHeader,
  payload: ArrayBuffer | ArrayBufferView,
): ArrayBuffer {
  return encodeBinaryFrame(header, payload);
}

/* ------------------------------------------------------------------ *
 * Typed-array views
 * ------------------------------------------------------------------ */

function viewOfPayload(payload: Uint8Array, ref: BufferRef): GeometryTypedArray {
  const bytes = DTYPE_BYTES[ref.dtype];
  if (!Number.isInteger(ref.byteOffset) || !Number.isInteger(ref.byteLength)) {
    throw new RangeError(
      `BufferRef offsets must be integers, got [${ref.byteOffset}, ${ref.byteLength}]`,
    );
  }
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
    // Misaligned producer: degrade in SPEED, not correctness. `geometryFrameProblems`
    // reports this so it is caught in a test rather than silently costing a memcpy.
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

/**
 * Typed-array view over a payload slice.
 *
 * Zero copy when the absolute byte offset is aligned to the element size, which
 * the 4-byte-padded header plus 4-aligned `BufferRef.byteOffset`s guarantee.
 * Use `isZeroCopyView()` to assert it in a test.
 *
 * ACCEPTS EITHER a payload `Uint8Array` OR a decoded `BinaryFrame`. The frame
 * overload exists because passing the frame used to be a *runtime* failure
 * (`TypeError: payload.slice is not a function`) rather than a type error —
 * WP-01 scope, plan §6.
 */
export function viewOf(payload: Uint8Array, ref: BufferRef): GeometryTypedArray;
export function viewOf(frame: BinaryFrame, ref: BufferRef): GeometryTypedArray;
export function viewOf(source: Uint8Array | BinaryFrame, ref: BufferRef): GeometryTypedArray {
  if (source instanceof Uint8Array) return viewOfPayload(source, ref);
  if (
    typeof source === 'object' &&
    source !== null &&
    'payload' in source &&
    (source as BinaryFrame).payload instanceof Uint8Array
  ) {
    return viewOfPayload((source as BinaryFrame).payload, ref);
  }
  // Defensive: JS callers, `any`-typed bridges and older code paths.
  throw new TypeError(
    'viewOf(source, ref): source must be a payload Uint8Array or a decoded BinaryFrame ' +
      `({header, payload}); got ${describe(source)}`,
  );
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'Array';
  if (ArrayBuffer.isView(v)) return v.constructor.name;
  if (v instanceof ArrayBuffer) return 'ArrayBuffer';
  if (typeof v !== 'object') return typeof v;
  const ctor = (v as { constructor?: { name?: string } }).constructor;
  return ctor?.name ?? 'object';
}

/**
 * True when `view` aliases `payload`'s ArrayBuffer instead of being a copy.
 * The acceptance assertion for the 4-byte header alignment.
 */
export function isZeroCopyView(payload: Uint8Array, view: ArrayBufferView): boolean {
  return view.buffer === payload.buffer;
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
 * (`packages/engine/layer1/CGO.cpp:1650-1671`). Sub-arrays are CONSECUTIVE, not interleaved.
 *
 * The pick-colour block is itself split: `[rgba: 1*nverts][index+bond: 2*nverts]`
 * (`packages/engine/layer1/CGO.cpp:1665-1668`). `pickColorIndex` is the per-vertex atom mapping
 * required by plan §1.3 constraint 2.
 */
export function cgoArraysLayout(arraybits: number, nverts: number): CgoArraysLayout {
  let offset = 0;
  const take = (itemSize: number): CgoSubArray => {
    const sub: CgoSubArray = { offset, itemSize, length: itemSize * nverts };
    offset += sub.length;
    return sub;
  };

  // CGO_VERTEX_ARRAY is always present (assert at packages/engine/layer1/CGO.cpp:1651).
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
 * `narrays` (`packages/engine/layer1/CGO.h:341-352`), recomputed here so a client can validate
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

/**
 * Sub-array of one block as a typed view onto the frame payload. Zero copy for
 * the same reason `viewOf` is.
 */
export function cgoSubArrayView(
  payload: Uint8Array,
  block: CgoDrawArraysBlock,
  sub: CgoSubArray,
): Float32Array {
  const ref: BufferRef = {
    byteOffset: block.data.byteOffset + sub.offset * DTYPE_BYTES.f32,
    byteLength: sub.length * DTYPE_BYTES.f32,
    dtype: 'f32',
    itemSize: sub.itemSize,
  };
  return viewOfPayload(payload, ref) as Float32Array;
}
