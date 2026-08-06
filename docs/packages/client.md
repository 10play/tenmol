---
title: "@tenmol/client"
description: "The browser side of the transport: one WebSocket to the PyMOL bridge, request/response correlation, topic events, binary frame decoding, and a Proxy-based…"
---

# @tenmol/client

The browser side of the transport: one WebSocket to the PyMOL bridge,
request/response correlation, topic events, binary frame decoding, and a
Proxy-based `cmd` facade. ~1,270 lines, one dependency (`@tenmol/protocol`).

```ts
import { connect } from '@tenmol/client';

const { conn, cmd } = await connect(); // ws://127.0.0.1:8765/ws
conn.on('feedback', ({ lines }) => console.log(lines.join('\n')));
await conn.sub('view');
await cmd.fragment('ala');
const view = await cmd.get_view();
```

## What it exports

| Module              | Contents                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/connection.ts` | `PymolConnection` — the socket. Reconnect with backoff, a promise map for ids, re-subscription, input helpers, binary decode. Plus `PymolError`, `DisconnectedError`, `RequestTimeoutError`. |
| `src/cmd.ts`        | `createCmd(conn)` — the Proxy. `isKwargs` / `splitArgs` are exported so the sniffing rule is testable.                                                                                       |
| `src/events.ts`     | `TypedEmitter` and `ClientEvents = TopicPayloads & ConnectionEvents`. Deliberately not `eventemitter3` or Node `events`: this has to run in a browser, a worker and vitest with no shim.     |
| `src/index.ts`      | `createClient()` (no socket yet), `connect()` (awaits open), and `export * from '@tenmol/protocol'` so an app needs one dependency for wire types.                                           |

Subpath exports: `.` `./connection` `./cmd` `./events`.

## Five behaviours that are not obvious from the types

**1. `cmd` is a Proxy, so any symbol is callable without a declaration.**
`cmd.util.cbc()` becomes `fn: 'util.cbc'`. A **trailing plain object** is sent as
Python `**kwargs`; arrays, typed arrays, `Date` and class instances stay
positional, which matters because `cmd.set_view([...18 floats])` and
`cmd.load_cgo([...])` take list arguments. Use `cmd.$call<T>(fn, args, kwargs)`
when you want to bypass the sniffing or type the result, and `cmd.$any` for the
untyped surface. About 15 commands have hand-written signatures; the rest are
`any`, because `noUncheckedIndexedAccess` would otherwise make every dynamic
call "possibly undefined".

**2. Requests are queued while the socket is down; input frames are not.**
`call`/`do`/`sub`/`unsub` buffer into an outbox (cap 256, then reject) and flush
on open. `sendInput()` returns `false` and drops the frame — replaying stale
mouse events after a reconnect would make the camera jump. Anything that sends
input has to re-send its state on reconnect; `reshape` is the example.

**3. `requestTimeoutMs` defaults to 0, i.e. no timeout.** PyMOL calls can be
genuinely slow (`cmd.ray`, a large `load`). A hung request therefore hangs
forever unless you opt in.

**4. Re-subscription is automatic and de-duplicated.** Live topics are re-`sub`ed
after a reconnect. A `sub` issued _while_ the socket was down is both remembered
and queued, and the queued frame wins — because it carries the id the caller is
awaiting. Without that check, four topics produced eight sub frames on first
connect.

**5. `EventMessage.seq` is dropped.** `handleText()` emits `message.payload` and
not `message.seq`, so the sequence-gap detection in `@tenmol/stores`'s
`bridgeBinding.ts` is inert and reports `seqAvailable: false`. Forwarding `seq`
here is a one-line change that turns that machinery on; nothing downstream needs
to move.

## Binary frames

Every binary frame is decoded once with `decodeBinaryFrame` and emitted three
ways: `binary:frame` (all of them, in arrival order — what the viewport
subscribes to), then `pixels:frame` or `geometry:frame`. Using
`decodeGeometryFrame` here instead is a known trap: it throws on a Mode-P pixel
frame by design, which turned every streamed frame into a connection error.

## Tests

This package has **no test files of its own**. It is covered indirectly by
`apps/web/e2e` (which drives a real socket against a real bridge) and by the
app's feature tests, which inject a fake connection. Only typecheck runs here:

```bash
pnpm --filter @tenmol/client typecheck
```

If you change reconnect, correlation or kwargs behaviour, the cheapest real
proof is `node apps/web/e2e/run.mjs -t "the app loads and connects"`.
