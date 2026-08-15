/**
 * @tenmol/protocol — the tenmol web-client wire contract.
 *
 * WP-01 (plan §6, wave 0). Pure types, constants and pure functions — zero
 * runtime dependencies, no I/O, importable from the browser, from Node, from a
 * worker, or from a test.
 *
 * Transport: ONE WebSocket at `ws://127.0.0.1:8765/ws`.
 *
 *   ./envelope.ts   TEXT frames: call | do | input | sub | unsub | ack
 *                              -- hello | ok | err | event | feedback
 *   ./errors.ts     the six error kinds:
 *                   CmdException | QuietException | IncentiveOnly
 *                   | NotAllowed | NotSerializable | PythonError
 *   ./codec.ts      the msgpack / NdArray / blob configuration (plan §B8)
 *   ./geometry.ts   BINARY frames: Mode G geometry AND Mode P pixels, with a
 *                   4-byte-aligned header so `viewOf()` is zero-copy
 *   ./topics/       19 one-owner-each topic modules behind a FROZEN barrel
 *
 * The envelope is closed: adding a message type is a `PROTOCOL_VERSION` bump.
 * Topics are the extension point, and `topics/index.ts` is frozen — a work
 * package fills in its own module and edits nothing shared.
 *
 * A Python reference implementation of the binary-frame codec lives in
 * `python/tenmol_wire.py` in this package; `packages/engine/test/roundtrip.test.ts` encodes
 * with it and decodes here.
 */

export * from './errors';
export * from './envelope';
export * from './codec';
export * from './geometry';
export * from './ndarray';
export * from './topics';
