# `@tenmol/protocol` — the wire contract

WP-01 (plan `docs/03-implementation-plan.md` §6, wave 0).

Pure types, constants and pure functions. **Zero runtime dependencies**, no I/O,
importable from the browser, from Node, from a worker and from a test.

## Layout

| File                      | Contents                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/envelope.ts`         | TEXT frames: `call \| do \| input \| sub \| unsub \| ack` up, `hello \| ok \| err \| event \| feedback` down. `PROTOCOL_VERSION`, the loopback URL, the mouse/modifier constants. |
| `src/errors.ts`           | The six error kinds: `CmdException \| QuietException \| IncentiveOnly \| NotAllowed \| NotSerializable \| PythonError`.                                                           |
| `src/codec.ts`            | The msgpack config, the `NdArray` numpy wire form, `BlobRef`, and the whitelists of plan §B8.                                                                                     |
| `src/geometry.ts`         | BINARY frames: Mode G geometry **and** Mode P pixels.                                                                                                                             |
| `src/topics/_registry.ts` | `TOPICS`, `Topic`, `TOPIC_META`. **Frozen.**                                                                                                                                      |
| `src/topics/index.ts`     | The barrel + `TopicPayloads`. **Frozen.**                                                                                                                                         |
| `src/topics/<name>.ts`    | 19 modules, one owner each.                                                                                                                                                       |
| `python/tenmol_wire.py`   | Reference **producer** implementation of the binary-frame codec, for the bridge.                                                                                                  |
| `packages/engine/test/roundtrip.test.ts`  | Encodes in Python, decodes here, asserts `zeroCopyPos === true`.                                                                                                                  |

## Two rules that are not negotiable

**1. `topics/index.ts` and `topics/_registry.ts` are FROZEN.**
Plan §A8 resolves the twelve file collisions structurally: every would-be shared
file becomes a directory of one-file-per-owner modules behind a barrel written
once in wave 0 and never touched again. A later work package fills in _its own_
`topics/<name>.ts` and edits nothing shared. The contract each owner honours is
one line long: keep exporting a type named `<Name>Payload`. `topics/index.ts`
carries a compile-time assertion that `TOPICS` and `TopicPayloads` still agree,
so drift is a build failure rather than a runtime surprise.

**2. The binary frame header is 4-byte padded.**

```
[ 0 .. 3 ]                uint32 LE  headerLength   (always a multiple of 4)
[ 4 .. 4+headerLength )   UTF-8      JSON header    (space-padded)
[ 4+headerLength .. end ) bytes      payload        (starts 4-byte aligned)
```

A WebSocket binary frame reaches the browser as an `ArrayBuffer` at byteOffset 0,
so every 4-aligned `BufferRef.byteOffset` is _absolutely_ 4-aligned and
`viewOf()` returns a view, not a copy. Drop the padding and `viewOf()` falls back
to `payload.slice()` — a memcpy of every buffer, which is ~93 MB per pull on a
1AON cartoon (`spikes/03-geometry.md` §8). `geometryFrameProblems()` reports any
producer that violates it, and `decodeBinaryFrame()` rejects an unaligned header
length outright.

## Mode G payload semantics

Three constraints, each from a measured failure of PyMOL's existing exporters
(plan §1.3, `spikes/03-geometry.md`):

1. **Spheres and cylinders are INSTANCE buffers, never tessellated.** Tessellating
   is exactly how the exporters destroy `mesh`/`dots`/`lines`: 1UBQ `mesh` became
   31,710 cylinders + 63,420 spheres = 31.9 MB `.wrl` / 133.7 MB `.dae`.
   `INSTANCE_ITEM_SIZE` fixes the wire layout; `geometryFrameProblems()` fails a
   sphere rep that arrives with triangles and no instances.
2. **Keyed per object, per rep, per state, and carrying atom indices**
   (`RepSurface::AT`, `CGO_PICK_COLOR`). Without it there is no per-rep update and
   no recolour-only update — one `cmd.color` on 1AON costs a full 1.92 s / 246 MB
   re-export through `get_vrml`.
3. **`CGO_DRAW_ARRAYS` blocks are passed VERBATIM.** `cgoArraysLayout()`
   reproduces `CGOCombineBeginEnd`'s consecutive (not interleaved) sub-array
   layout so a block is a three.js `BufferGeometry` with zero conversion.

## Mode P

`PixelFrameHeader` types the server-rendered bitmap stream (jpeg during motion,
png on settle, `flipY` because `glReadPixels` is bottom-left origin, `frameId`
for the at-most-one-unacked-frame flow control). `RenderModePolicy` /
`resolveRenderMode()` are the per-rep Mode G/Mode P toggle with automatic
fallback; `MODE_G_CAPABLE_REPS` excludes `labels`, `volume` and `callback`.

## Commands

```bash
pnpm --filter @tenmol/protocol typecheck   # src + test
pnpm --filter @tenmol/protocol test        # python encode -> ts decode round trip
```

The test shells out to `python3` (override with `TENMOL_PYTHON`) to run
`packages/engine/test/make_fixtures.py`, which encodes five frames with `python/tenmol_wire.py`.
No fixtures are checked in, so the two implementations cannot silently drift.
