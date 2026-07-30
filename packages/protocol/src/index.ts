/**
 * @tenmol/protocol
 *
 * The tenmol web-client wire protocol, v1. Pure types, constants and pure
 * functions — zero runtime dependencies, no I/O, importable from the browser,
 * from Node, from a worker, or from a test.
 *
 * Transport: ONE WebSocket at ws://127.0.0.1:8765/ws.
 *   * JSON text frames      -> ./messages.ts  (call / do / input / sub / unsub
 *                                              -- ok / err / event / feedback / hello)
 *   * binary frames         -> ./geometry.ts  (uint32 LE header length + JSON
 *                                              header + typed-array payload)
 *   * topics                -> ./topics.ts    (objects, view, frame, selection,
 *                                              settings, feedback, geometry)
 *
 * v1 is intentionally minimal and CLOSED: no extra topics, no extra message
 * types. Anything else is a protocol version bump.
 */

export * from './messages';
export * from './topics';
export * from './geometry';
