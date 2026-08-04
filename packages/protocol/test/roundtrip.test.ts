/**
 * WP-01 acceptance test: encode in Python, decode in TypeScript, zero copy.
 *
 * `packages/engine/test/make_fixtures.py` writes five binary frames using
 * `python/tenmol_wire.py` — the normative producer-side implementation the
 * bridge will use. This file decodes them with `@tenmol/protocol` and asserts:
 *
 *   1. every header round-trips with its values intact;
 *   2. `zeroCopyPos === true` — the position buffer view ALIASES the frame's
 *      ArrayBuffer rather than being a memcpy. This is the whole point of the
 *      4-byte header alignment; regressing it costs ~93 MB of memcpy per pull
 *      on a 1AON cartoon (spike 03 §8);
 *   3. re-encoding the same header+payload in TypeScript produces a
 *      BYTE-IDENTICAL frame, so the two implementations cannot drift;
 *   4. sphere/cylinder reps arrive as INSTANCE buffers, never tessellated;
 *   5. `viewOf(frame, ref)` — passing the frame instead of the payload — is a
 *      supported overload rather than `TypeError: payload.slice is not a
 *      function` at runtime;
 *   6. a misaligned producer degrades in SPEED, not correctness, and
 *      `geometryFrameProblems()` names the problem.
 *
 * The Python half runs as part of this file: `make_fixtures.py` is invoked with
 * `execFileSync` into a fresh temp dir at module load, so `pnpm test` at the
 * repo root really does exercise the cross-language contract, not a checked-in
 * blob that could rot.
 *
 * Run: `pnpm test` (repo root) or `pnpm --filter @tenmol/protocol test`.
 * Override the interpreter with `TENMOL_PYTHON=/path/to/python`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  BINARY_FRAME_ALIGNMENT,
  ERROR_KINDS,
  GEOMETRY_KEY_SEP,
  GLMode,
  INSTANCE_ITEM_SIZE,
  PROTOCOL_VERSION,
  Rep,
  TOPICS,
  TOPIC_META,
  cgoArraysLayout,
  cgoNarrays,
  cgoSubArrayView,
  decodeBinaryFrame,
  decodeGeometryFrame,
  decodePixelFrame,
  encodeBinaryFrame,
  geometryFrameProblems,
  geometryKey,
  isErrMessage,
  isModeGCapable,
  isTopic,
  isZeroCopyView,
  kindForPythonException,
  parseGeometryKey,
  resolveRenderMode,
  viewOf,
  type BufferRef,
  type CgoDrawArraysHeader,
  type IndexedMeshHeader,
  type RenderModePolicy,
} from '../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Encode the fixtures IN PYTHON, right now, with `python/tenmol_wire.py`.
 * `execFileSync` with an argument array — no shell, so nothing here can be
 * injected through an environment variable.
 */
function makeFixtures(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tenmol-protocol-'));
  const python = process.env['TENMOL_PYTHON'] ?? 'python3';
  const out = execFileSync(python, [join(HERE, 'make_fixtures.py'), dir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!out.includes('self-decode of all 5 frames OK')) {
    throw new Error(`make_fixtures.py did not complete:\n${out}`);
  }
  return dir;
}

const FIXTURES: string = makeFixtures();

interface Expected {
  surface: {
    bytes: number;
    headerLength: number;
    position: number[];
    atom: number[];
    vis: number[];
    index: number[];
    alpha: number[];
  };
  cartoon: {
    bytes: number;
    nverts: number;
    arraybits: number;
    narrays: number;
    vertex: number[];
    normal: number[];
    color: number[];
    pickIndex: number[];
  };
  spheres: { bytes: number; items: number[]; atoms: number[] };
  pixels: {
    bytes: number;
    payloadBytes: number;
    soi: number[];
    width: number;
    height: number;
    frameId: number;
  };
  misaligned: { bytes: number; position: number[] };
}

const expected: Expected = JSON.parse(
  readFileSync(join(FIXTURES, 'expected.json'), 'utf8'),
) as Expected;

/**
 * Read a fixture the way a browser receives a WebSocket binary frame: a FRESH
 * ArrayBuffer starting at byteOffset 0. Node's `readFileSync` returns a Buffer
 * backed by a shared, arbitrarily-offset pool, which would make the zero-copy
 * assertion meaningless.
 */
function readFrame(name: string): ArrayBuffer {
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function near(actual: ArrayLike<number>, want: readonly number[], eps = 1e-6): void {
  assert.equal(actual.length, want.length, `length ${actual.length} != ${want.length}`);
  for (let i = 0; i < want.length; i++) {
    assert.ok(
      Math.abs((actual[i] as number) - (want[i] as number)) <= eps,
      `element ${i}: ${actual[i]} != ${want[i]}`,
    );
  }
}

/* ================================================================== *
 * 1. indexed-mesh (RepSurface)
 * ================================================================== */

test('indexed-mesh: python -> ts round trip, zero copy', () => {
  const raw = readFrame('surface.bin');
  assert.equal(raw.byteLength, expected.surface.bytes);

  // The alignment contract, checked on the wire bytes themselves.
  const headerLength = new DataView(raw).getUint32(0, true);
  assert.equal(headerLength, expected.surface.headerLength);
  assert.equal(
    headerLength % BINARY_FRAME_ALIGNMENT,
    0,
    'header length must be 4-byte padded so the payload starts aligned',
  );
  assert.equal((4 + headerLength) % BINARY_FRAME_ALIGNMENT, 0);

  const frame = decodeGeometryFrame(raw);
  const header = frame.header as IndexedMeshHeader;

  assert.equal(header.kind, 'indexed-mesh');
  assert.equal(header.object, '1ubq');
  assert.equal(header.state, 1);
  assert.equal(header.rep, Rep.Surface);
  assert.equal(header.seq, 41);
  assert.equal(header.level, 35);
  assert.equal(header.proximity, true);
  assert.equal(header.oneColor, null);
  assert.deepEqual(header.counts, { verts: 4, tris: 2 });
  assert.equal(header.payloadBytes, frame.payload.byteLength);

  assert.deepEqual(geometryFrameProblems(header), []);

  // --- THE ACCEPTANCE ASSERTION ------------------------------------
  // viewOf(FRAME, ref): the overload added by WP-01. Before it, this line
  // threw `TypeError: payload.slice is not a function`.
  const pos = viewOf(frame, header.buffers.position) as Float32Array;
  const zeroCopyPos = isZeroCopyView(frame.payload, pos);
  console.log(
    `headerLength=${headerLength} (mod 4 == ${headerLength % 4}) ` +
      `payloadStart=${4 + headerLength} posByteOffset=${pos.byteOffset} ` +
      `zeroCopyPos === ${zeroCopyPos}`,
  );
  assert.equal(zeroCopyPos, true, 'position view must alias the frame buffer, not copy it');
  // -----------------------------------------------------------------

  near(pos, expected.surface.position);
  assert.equal(pos.byteOffset % 4, 0);

  // The payload overload must produce an identical view.
  const pos2 = viewOf(frame.payload, header.buffers.position) as Float32Array;
  assert.equal(isZeroCopyView(frame.payload, pos2), true);
  assert.equal(pos2.byteOffset, pos.byteOffset);

  const atom = viewOf(frame, header.buffers.atom as BufferRef) as Int32Array;
  assert.deepEqual([...atom], expected.surface.atom);
  assert.equal(isZeroCopyView(frame.payload, atom), true, 'AT must be zero-copy too');

  const vis = viewOf(frame, header.buffers.vis as BufferRef) as Int32Array;
  assert.deepEqual([...vis], expected.surface.vis);

  const index = viewOf(frame, header.buffers.index as BufferRef) as Int32Array;
  assert.deepEqual([...index], expected.surface.index);

  const alpha = viewOf(frame, header.buffers.alpha as BufferRef) as Float32Array;
  near(alpha, expected.surface.alpha);

  // Per object / per rep / per state keying (plan §1.3 constraint 2).
  const key = geometryKey(header);
  assert.equal(key, `1ubq${GEOMETRY_KEY_SEP}1${GEOMETRY_KEY_SEP}2`);
  assert.deepEqual(parseGeometryKey(key), { object: '1ubq', state: 1, rep: 2 });
  // The separator must survive an object name containing spaces and slashes.
  assert.deepEqual(parseGeometryKey(geometryKey({ object: 'my obj/1', state: 0, rep: 5 })), {
    object: 'my obj/1',
    state: 0,
    rep: 5,
  });
});

test('indexed-mesh: ts re-encode is byte-identical to the python frame', () => {
  const raw = readFrame('surface.bin');
  const frame = decodeGeometryFrame(raw);
  const reencoded = encodeBinaryFrame(frame.header, frame.payload);
  assert.deepEqual(
    [...new Uint8Array(reencoded)],
    [...new Uint8Array(raw)],
    'tenmol_wire.py and geometry.ts must produce identical bytes',
  );
});

/* ================================================================== *
 * 2. CGO_DRAW_ARRAYS, passed verbatim
 * ================================================================== */

test('cgo-draw-arrays: block is verbatim and sub-arrays are consecutive', () => {
  const raw = readFrame('cartoon.bin');
  const frame = decodeGeometryFrame(raw);
  const header = frame.header as CgoDrawArraysHeader;

  assert.equal(header.kind, 'cgo-draw-arrays');
  assert.equal(header.rep, Rep.Cartoon);
  assert.equal(header.blocks.length, 1);
  assert.equal(header.instances.length, 0);
  assert.deepEqual(geometryFrameProblems(header), []);

  const block = header.blocks[0]!;
  assert.equal(block.mode, GLMode.TriangleStrip);
  assert.equal(block.nverts, expected.cartoon.nverts);
  assert.equal(block.arraybits, expected.cartoon.arraybits);

  // The TS and Python computations of `narrays` must agree.
  assert.equal(cgoNarrays(block.arraybits), expected.cartoon.narrays);
  assert.equal(block.data.byteLength, expected.cartoon.narrays * block.nverts * 4);

  const layout = cgoArraysLayout(block.arraybits, block.nverts);
  assert.equal(layout.totalFloats, expected.cartoon.narrays * block.nverts);
  assert.equal(layout.vertex.offset, 0);
  assert.equal(layout.normal?.offset, 9);
  assert.equal(layout.color?.offset, 18);
  assert.equal(layout.pickColorRgba?.offset, 30);
  assert.equal(layout.pickColorIndex?.offset, 33);

  const vertex = cgoSubArrayView(frame.payload, block, layout.vertex);
  near(vertex, expected.cartoon.vertex);
  assert.equal(isZeroCopyView(frame.payload, vertex), true);

  near(cgoSubArrayView(frame.payload, block, layout.normal!), expected.cartoon.normal);
  near(cgoSubArrayView(frame.payload, block, layout.color!), expected.cartoon.color);

  // The per-vertex atom mapping required by plan §1.3 constraint 2.
  const pick = cgoSubArrayView(frame.payload, block, layout.pickColorIndex!);
  near(pick, expected.cartoon.pickIndex);
  assert.equal(isZeroCopyView(frame.payload, pick), true);

  const reencoded = encodeBinaryFrame(frame.header, frame.payload);
  assert.deepEqual([...new Uint8Array(reencoded)], [...new Uint8Array(raw)]);
});

/* ================================================================== *
 * 3. Instance buffers — never tessellated
 * ================================================================== */

test('spheres arrive as INSTANCE buffers, never tessellated', () => {
  const raw = readFrame('spheres.bin');
  const frame = decodeGeometryFrame(raw);
  const header = frame.header as CgoDrawArraysHeader;

  assert.equal(header.rep, Rep.Sphere);
  assert.equal(header.blocks.length, 0, 'a sphere rep must not carry triangles');
  assert.equal(header.instances.length, 1);
  assert.deepEqual(geometryFrameProblems(header), []);

  const inst = header.instances[0]!;
  assert.equal(inst.kind, 'sphere');
  assert.equal(inst.count, 3);
  assert.equal(inst.itemSize, INSTANCE_ITEM_SIZE.sphere);
  assert.equal(inst.data.byteLength, 3 * INSTANCE_ITEM_SIZE.sphere * 4);

  const items = viewOf(frame, inst.data) as Float32Array;
  near(items, expected.spheres.items);
  assert.equal(isZeroCopyView(frame.payload, items), true);

  const atoms = viewOf(frame, inst.atom!) as Int32Array;
  assert.deepEqual([...atoms], expected.spheres.atoms);

  const reencoded = encodeBinaryFrame(frame.header, frame.payload);
  assert.deepEqual([...new Uint8Array(reencoded)], [...new Uint8Array(raw)]);
});

test('a tessellated sphere rep is reported as a problem', () => {
  const raw = readFrame('spheres.bin');
  const frame = decodeGeometryFrame(raw);
  const header = frame.header as CgoDrawArraysHeader;

  const tessellated: CgoDrawArraysHeader = {
    ...header,
    instances: [],
    blocks: [
      { mode: GLMode.Triangles, arraybits: 0x01, nverts: 3, data: header.instances[0]!.data },
    ],
  };
  const problems = geometryFrameProblems(tessellated);
  assert.ok(
    problems.some((p) => p.includes('TESSELLATED')),
    `expected a tessellation complaint, got ${JSON.stringify(problems)}`,
  );
});

/* ================================================================== *
 * 4. Mode P
 * ================================================================== */

test('pixels: Mode P bitmap frame decodes', () => {
  const raw = readFrame('pixels.bin');
  const frame = decodePixelFrame(raw);

  assert.equal(frame.header.kind, 'pixels');
  assert.equal(frame.header.width, expected.pixels.width);
  assert.equal(frame.header.height, expected.pixels.height);
  assert.equal(frame.header.encoding, 'jpeg');
  assert.equal(frame.header.quality, 80);
  assert.equal(frame.header.lossless, false);
  assert.equal(frame.header.flipY, true, 'glReadPixels is bottom-left origin');
  assert.equal(frame.header.frameId, expected.pixels.frameId);
  assert.deepEqual(frame.header.reps, [Rep.Cartoon, Rep.Surface]);
  assert.equal(frame.payload.byteLength, expected.pixels.payloadBytes);
  assert.deepEqual([...frame.payload.subarray(0, 4)], expected.pixels.soi);

  assert.throws(() => decodeGeometryFrame(raw), /expected a geometry frame/);
});

/* ================================================================== *
 * 5. Alignment regression guard
 * ================================================================== */

test('a misaligned producer is correct but NOT zero copy, and is reported', () => {
  const raw = readFrame('misaligned.bin');
  const frame = decodeGeometryFrame(raw);
  const header = frame.header as IndexedMeshHeader;

  assert.equal(header.buffers.position.byteOffset, 2);

  const pos = viewOf(frame, header.buffers.position) as Float32Array;
  near(pos, expected.misaligned.position); // still CORRECT
  assert.equal(
    isZeroCopyView(frame.payload, pos),
    false,
    'a 2-mod-4 offset must fall back to a copy',
  );

  const problems = geometryFrameProblems(header);
  assert.ok(
    problems.some((p) => p.includes('aligned')),
    `expected an alignment complaint, got ${JSON.stringify(problems)}`,
  );
});

/* ================================================================== *
 * 6. viewOf() guard — the reported bug
 * ================================================================== */

test('viewOf() rejects a non-payload with a TYPE-level error, not payload.slice', () => {
  const ref: BufferRef = { byteOffset: 0, byteLength: 4, dtype: 'f32', itemSize: 1 };

  // Simulates a JS caller / an `any`-typed bridge handing over the wrong thing.
  const bad = viewOf as unknown as (s: unknown, r: BufferRef) => unknown;

  for (const wrong of [{}, null, undefined, 42, 'nope', new ArrayBuffer(8), [1, 2, 3]]) {
    let caught: unknown;
    try {
      bad(wrong, ref);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof TypeError, `expected TypeError for ${String(wrong)}`);
    const msg = (caught as Error).message;
    assert.ok(msg.includes('BinaryFrame'), `unhelpful message: ${msg}`);
    assert.ok(
      !msg.includes('payload.slice is not a function'),
      'the old runtime failure mode is back',
    );
  }

  // A decoded frame is accepted, which is the point of the overload.
  const frame = decodeGeometryFrame(readFrame('surface.bin'));
  assert.ok(viewOf(frame, ref) instanceof Float32Array);
});

/* ================================================================== *
 * 7. The frozen topic barrel
 * ================================================================== */

test('topic barrel: 19 modules, registry and payload map agree', () => {
  assert.equal(TOPICS.length, 19);
  assert.equal(new Set(TOPICS).size, 19, 'no duplicate topic names');

  for (const t of TOPICS) {
    assert.ok(isTopic(t));
    const meta = TOPIC_META[t];
    assert.equal(meta.topic, t);
    assert.match(meta.owner, /^WP-\d\d$/);
    assert.ok(meta.note.length > 0, `${t} has no note`);
  }

  assert.equal(isTopic('nope'), false);
  assert.equal(TOPIC_META.feedback.destructiveDrain, true);
  assert.equal(TOPIC_META.settings.destructiveDrain, true);
  assert.equal(TOPIC_META.pixels.binarySidecar, true);
  assert.equal(TOPIC_META.geometry.binarySidecar, true);
  assert.equal(TOPIC_META.plugin.owner, 'WP-25');
});

/* ================================================================== *
 * 8. Errors and envelope
 * ================================================================== */

test('the six error kinds', () => {
  assert.deepEqual([...ERROR_KINDS].sort(), [
    'CmdException',
    'IncentiveOnly',
    'NotAllowed',
    'NotSerializable',
    'PythonError',
    'QuietException',
  ]);
  // IncentiveOnlyException subclasses CmdException — it must classify first.
  assert.equal(kindForPythonException('IncentiveOnlyException'), 'IncentiveOnly');
  assert.equal(kindForPythonException('CmdException'), 'CmdException');
  assert.equal(kindForPythonException('QuietException'), 'QuietException');
  assert.equal(kindForPythonException('ZeroDivisionError'), 'PythonError');

  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(
    isErrMessage({
      id: 1,
      t: 'err',
      error: { kind: 'NotAllowed', type: 'NotAllowed', message: 'no', traceback: '' },
    }),
    true,
  );
  assert.equal(
    isErrMessage({ id: 1, t: 'err', error: { type: 'X', message: 'no', traceback: '' } }),
    false,
    'an error without a `kind` is not a valid v1 error frame',
  );
});

/* ================================================================== *
 * 9. The per-rep mode toggle
 * ================================================================== */

test('per-rep render mode resolves with automatic Mode-P fallback', () => {
  const policy: RenderModePolicy = { default: 'geometry', perRep: [] };

  assert.equal(resolveRenderMode(Rep.Cartoon, policy).effective, 'geometry');
  assert.equal(resolveRenderMode(Rep.Surface, policy).effective, 'geometry');

  // Labels have no Mode-G expression (0 bytes in every exporter, spike 03 §4).
  const labels = resolveRenderMode(Rep.Label, policy);
  assert.equal(labels.effective, 'pixel');
  assert.equal(labels.fallbackReason, 'unsupported-rep');
  assert.equal(isModeGCapable(Rep.Label), false);
  assert.equal(isModeGCapable(Rep.Volume), false);
  assert.equal(isModeGCapable(Rep.Callback), false);
  assert.equal(isModeGCapable(Rep.Mesh), true);

  // A build without the C++ accessor stays in Mode P for everything.
  const noAccessor = resolveRenderMode(Rep.Cartoon, policy, { accessor: false, webgl: true });
  assert.equal(noAccessor.effective, 'pixel');
  assert.equal(noAccessor.fallbackReason, 'no-accessor');

  // The measured RepCartoon hazard of plan §1.3.
  const disposed = resolveRenderMode(Rep.Cartoon, {
    default: 'geometry',
    perRep: [
      {
        rep: Rep.Cartoon,
        requested: 'geometry',
        effective: 'pixel',
        fallbackReason: 'preshader-disposed',
      },
    ],
  });
  assert.equal(disposed.effective, 'pixel');
  assert.equal(disposed.fallbackReason, 'preshader-disposed');

  // An explicit per-rep pin wins over the default.
  const pinned = resolveRenderMode(Rep.Surface, {
    default: 'geometry',
    perRep: [{ rep: Rep.Surface, requested: 'pixel', effective: 'pixel' }],
  });
  assert.equal(pinned.effective, 'pixel');
});

/* ================================================================== *
 * 10. Frame-level sanity
 * ================================================================== */

test('decodeBinaryFrame rejects an unaligned header length', () => {
  const raw = readFrame('surface.bin');
  const bad = raw.slice(0);
  new DataView(bad).setUint32(0, new DataView(raw).getUint32(0, true) + 1, true);
  assert.throws(() => decodeBinaryFrame(bad), /not 4-byte aligned/);
});

test('decodeBinaryFrame rejects a truncated frame', () => {
  const raw = readFrame('surface.bin');
  assert.throws(() => decodeBinaryFrame(raw.slice(0, 8)), /exceeds frame/);
  assert.throws(() => decodeBinaryFrame(new ArrayBuffer(2)), /too short/);
});
