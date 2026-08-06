---
title: "@tenmol/protocol"
description: "The wire contract between the browser and the Python bridge. Pure types, constants and pure functions: zero runtime dependencies, no I/O, importable from…"
---

# @tenmol/protocol

The wire contract between the browser and the Python bridge. Pure types,
constants and pure functions: **zero runtime dependencies**, no I/O, importable
from the browser, from Node, from a worker and from a test.

`packages/bridge/tenmol_bridge/session.py` is the Python mirror of this package.
The strings must match exactly on both sides.

## What it exports

`import { ... } from '@tenmol/protocol'` re-exports `errors`, `envelope`,
`codec`, `geometry` and `topics`. Everything else is reached by subpath.

| Module                  | Contents                                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/envelope.ts`       | TEXT frames. Up: `call \| do \| input \| sub \| unsub \| ack`. Down: `hello \| ok \| err \| event \| feedback`. Plus `PROTOCOL_VERSION`, the loopback URL and HTTP paths, the mouse/modifier constants, the type guards.                                                                                 |
| `src/errors.ts`         | `ERROR_KINDS` — six: `IncentiveOnly \| QuietException \| CmdException \| NotAllowed \| NotSerializable \| PythonError` — and `kindForPythonException()`.                                                                                                                                                 |
| `src/codec.ts`          | msgpack config, `NdArray`, `BlobRef`, the blob-only symbol list, the chempy field lists, `unserializableReason()`.                                                                                                                                                                                       |
| `src/geometry.ts`       | BINARY frames: Mode G geometry **and** Mode P pixels. Also the rep table (`Rep`, `REP_NAMES`), the CGO constants, and `RenderModePolicy` / `resolveRenderMode()` / `MODE_G_CAPABLE_REPS`.                                                                                                                |
| `src/ndarray.ts`        | The `{__ndarray__, shape, dtype, encoding, data}` reply shape for `get_coords` / `get_coordset`, and `decodeNdarray` / `decodeCoords`. Reachable from **neither** the index barrel nor the export map today, so only its own test imports it; wiring it up means adding `"./ndarray"` to `package.json`. |
| `src/topics/`           | 19 wire topics behind a frozen barrel, plus 7 shared panel-payload modules. See below.                                                                                                                                                                                                                   |
| `src/generated/api.ts`  | 424 `cmd.*` signatures introspected from a live PyMOL by `tools/gen-api/`. Reference only: nothing imports it, and `**/generated/**` is excluded from vitest.                                                                                                                                            |
| `python/tenmol_wire.py` | Reference **producer** for the binary-frame codec. Used by the round-trip fixtures and by `packages/viewport/tools/pull_geometry.py`.                                                                                                                                                                    |

### `src/topics/` holds two different things

**19 wire topics** — the `TOPICS` tuple in `_registry.ts`, re-exported through
the barrel: `feedback` `progress` `redisplay` `pixels` `view` `selection`
`objects` `menu` `settings` `wizard` `editor` `dialog` `frame` `scenes`
`movie_panel` `seqview` `colors` `plugin` `geometry`. These are the only strings
a client may `sub` to.

**7 shared payload modules that are not topics** and are deliberately absent
from the barrel: `builder` `compute` `console` `dialogs` `files` `menus`
`movie`. They type the request/reply shapes of panels that answer over ordinary
`call` frames, and are imported by subpath only —
`import { ... } from '@tenmol/protocol/topics/files'`. Adding one of those is
not a protocol change; adding a wire topic is.

## Three rules that are not negotiable

**1. `topics/index.ts` and `topics/_registry.ts` are FROZEN.** Every would-be
shared file in this repo is a directory of one-file-per-owner modules behind a
barrel that was written once. A package fills in its own `topics/<name>.ts` and
edits nothing shared. The contract each owner honours is one line: keep
exporting a type named `<Name>Payload`. `topics/index.ts` carries a compile-time
assertion that `TOPICS` and `TopicPayloads` still agree, so drift is a build
failure rather than a runtime surprise.

**2. The binary frame header is 4-byte padded.**

```
[ 0 .. 3 ]                uint32 LE  headerLength   (always a multiple of 4)
[ 4 .. 4+headerLength )   UTF-8      JSON header    (space-padded)
[ 4+headerLength .. end ) bytes      payload        (starts 4-byte aligned)
```

A WebSocket binary frame reaches the browser as an `ArrayBuffer` at byteOffset 0,
so every 4-aligned `BufferRef.byteOffset` is _absolutely_ 4-aligned and
`viewOf()` returns a view, not a copy. Drop the padding and `viewOf()` falls back
to `payload.slice()` — a memcpy of every buffer, ~93 MB per pull on a 1AON
cartoon (`docs/spikes/geometry.md` §8). `geometryFrameProblems()` reports any
producer that violates it, and `decodeBinaryFrame()` rejects an unaligned header
length outright. The round-trip test asserts `zeroCopyPos === true` and prints
the offsets it measured.

**3. Spheres and cylinders are INSTANCE buffers, never tessellated.**
Tessellating is exactly how PyMOL's own exporters destroy `mesh`/`dots`/`lines`:
1UBQ `mesh` became 31,710 cylinders + 63,420 spheres = 31.9 MB `.wrl` /
133.7 MB `.dae`. `INSTANCE_ITEM_SIZE` fixes the wire layout and
`geometryFrameProblems()` fails an `INSTANCED_ONLY_REPS` frame that arrives with
triangles and no instances. Two related constraints ride along: frames are keyed
per object / per rep / per state and carry atom indices (`RepSurface::AT`,
`CGO_PICK_COLOR`), which is what makes a per-rep or recolour-only update
possible at all; and `CGO_DRAW_ARRAYS` blocks travel verbatim in
`CGOCombineBeginEnd`'s consecutive (not interleaved) sub-array order, so a block
becomes a three.js `BufferGeometry` with zero conversion.

## Mode P and the mode split

`PixelFrameHeader` types the server-rendered bitmap stream: jpeg during motion,
png on settle, `flipY` because `glReadPixels` is bottom-left origin, `frameId`
for the at-most-one-unacked-frame flow control, and `reps` — which reps are IN
this bitmap. `reps` is authoritative and `pixelFrameDrawsRep()` is how it is
read: the client draws a rep client-side only if the last pixel frame says the
server did not. `undefined` means the whole scene.

`MODE_G_CAPABLE_REPS` lists 18 of the 21 reps. `labels` (text — needs an
atlas overlay, and every exporter emits 0 bytes for it), `volume` (a 3-D scalar
field, served as a blob) and `callback` (needs a real GL context to construct)
are excluded, and `MODE_G_FALLBACK_REASONS` names the seven reasons a capable
rep can still degrade back to Mode P.

## Commands

```bash
pnpm --filter @tenmol/protocol typecheck   # tsc over src and test
pnpm --filter @tenmol/protocol test        # 20 tests
```

The round-trip test shells out to `python3` (override with `TENMOL_PYTHON`) to
run `test/make_fixtures.py`, which encodes five frames with
`python/tenmol_wire.py`. No fixtures are checked in, precisely so the Python
producer and the TypeScript decoder cannot silently drift.

## Before you change anything here

The envelope is closed: adding or removing a message type, an input kind or a
wire topic is a `PROTOCOL_VERSION` bump, and `session.py` has to move in the same
commit. Note that the bridge already accepts two frames this package does not
type — `{t:'confirm'}` (the one-time `cmd.system` confirmation) and `{t:'ping'}`
— and five `input` kinds where the TypeScript union has three (`button`, `drag`,
`reshape`). If the browser ever needs those, type them here first instead of
sending an untyped frame.
