/**
 * @tenmol/protocol — the message envelope.
 *
 * WP-01, plan §6. Migrated from the pre-WP `src/messages.ts`.
 *
 * ONE WebSocket at `ws://127.0.0.1:8765/ws` (loopback only, plan §A6):
 *
 *   * TEXT frames   — JSON control envelope, defined here.
 *                     client -> server: call | do | input | sub | unsub | ack
 *                     server -> client: hello | ok | err | event | feedback
 *   * BINARY frames — geometry (Mode G) and pixels (Mode P), `./geometry.ts`.
 *
 * The envelope is deliberately small and closed. Adding a message type is a
 * `PROTOCOL_VERSION` bump plus a bridge change in the same commit. Adding a
 * *topic* is not — topics are the extension point (`./topics/`).
 *
 * Zero runtime dependencies. Types, consts and pure functions only.
 */

import type { WireError } from './errors';
import { isWireError } from './errors';
import type { Topic, TopicPayloads } from './topics';
import { isTopic } from './topics';

/** Bumped whenever an envelope frame shape changes incompatibly. Echoed in `hello`. */
export const PROTOCOL_VERSION = 1;

/** Loopback only, never 0.0.0.0 (plan §A6: the boundary is the transport). */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8765;
export const WS_PATH = '/ws';
export const DEFAULT_WS_URL = `ws://${DEFAULT_HOST}:${DEFAULT_PORT}${WS_PATH}`;

/** Blob upload/download endpoints (plan §B8: sessions and volumes are never inline). */
export const UPLOAD_PATH = '/upload';
export const BLOB_PATH = '/blob';
export const HEALTH_PATH = '/healthz';

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

export type JsonPrimitive = null | boolean | number | string;
export type Json = JsonPrimitive | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/* ------------------------------------------------------------------ *
 * Input constants
 *
 * Mirrors of the values the PyMOL C core expects through
 * `_cmd._button(COb, button, state, x, y, mod)` and
 * `_cmd._drag(COb, x, y, mod)` (`modules/pymol2/__init__.py:46-50`).
 * ------------------------------------------------------------------ */

/** `layer0/os_gl_glut_pretend.h:24-26`, `layer0/os_gl_glut.h:21-22`. */
export const MouseButton = {
  Left: 0,
  Middle: 1,
  Right: 2,
  ScrollForward: 3,
  ScrollBackward: 4,
} as const;
export type MouseButtonValue = (typeof MouseButton)[keyof typeof MouseButton];

/** `layer0/os_gl_glut_pretend.h:11-12` (P_GLUT_DOWN / P_GLUT_UP). */
export const ButtonState = {
  Down: 0,
  Up: 1,
} as const;
export type ButtonStateValue = (typeof ButtonState)[keyof typeof ButtonState];

/**
 * PyMOL modifier bitmask, exactly as the Qt front-end builds it in
 * `modules/pmg_qt/keymapping.py:50-54` (shift 0x1, ctrl/meta 0x2, alt 0x4).
 */
export const Modifier = {
  None: 0x0,
  Shift: 0x1,
  Ctrl: 0x2,
  Alt: 0x4,
} as const;
export type ModifierValue = (typeof Modifier)[keyof typeof Modifier];

/** Build a PyMOL modifier mask from a DOM-ish event. */
export function modifierMask(ev: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): number {
  let mod = 0;
  if (ev.shiftKey) mod |= Modifier.Shift;
  // metaKey is CTRL on Mac in PyMOL's own mapping (keymapping.py:52).
  if (ev.ctrlKey || ev.metaKey) mod |= Modifier.Ctrl;
  if (ev.altKey) mod |= Modifier.Alt;
  return mod;
}

/* ------------------------------------------------------------------ *
 * Client -> Server
 * ------------------------------------------------------------------ */

/**
 * Invoke a PyMOL API symbol.
 *
 * `fn` is a dotted path resolved against the `cmd` namespace by the bridge:
 * `'fragment'`, `'util.cbc'`, `'movie.produce'` — the same namespace modules
 * exported at `modules/pymol/api.py:487-489`.
 *
 * `quiet` is NOT forced (plan §A6 / critique C4): several parity rows depend on
 * `quiet=0` output reaching the console.
 */
export interface CallMessage {
  id: number;
  t: 'call';
  fn: string;
  args: readonly unknown[];
  kwargs: Readonly<Record<string, unknown>>;
}

/**
 * Execute a raw PyMOL command line through `cmd.do`.
 *
 * `cmd.do` returns None and prints exceptions instead of raising
 * (`modules/pymol/commanding.py:441-461`), so `ok.result` is always null.
 * Allowed from the UI (plan §A6): every `pymol.menu` popup leaf and every
 * wizard button returns a *command string* (`layer4/PopUp.cpp:471-475`).
 */
export interface DoMessage {
  id: number;
  t: 'do';
  cmd: string;
}

/** Mouse button press/release. Fire-and-forget: no id, no response. */
export interface InputButtonMessage {
  t: 'input';
  kind: 'button';
  button: number;
  state: number;
  /** Viewport pixels, BOTTOM-LEFT origin (plan §1.4 — the client flips Y). */
  x: number;
  y: number;
  mod: number;
  /** Epoch seconds (float) taken on the client; feeds SceneDeferClickWhen. */
  when: number;
}

/** Mouse motion while a button is held. */
export interface InputDragMessage {
  t: 'input';
  kind: 'drag';
  x: number;
  y: number;
  mod: number;
  when: number;
}

/** Viewport resize; maps to `_cmd._reshape(COb, width, height, force)`. */
export interface InputReshapeMessage {
  t: 'input';
  kind: 'reshape';
  width: number;
  height: number;
  force: boolean;
}

export type InputMessage = InputButtonMessage | InputDragMessage | InputReshapeMessage;

export type InputKind = InputMessage['kind'];

/** Start receiving `event` frames for a topic. Acknowledged with ok/err. */
export interface SubMessage {
  id: number;
  t: 'sub';
  topic: Topic;
}

/** Stop receiving `event` frames for a topic. Acknowledged with ok/err. */
export interface UnsubMessage {
  id: number;
  t: 'unsub';
  topic: Topic;
}

/**
 * Flow control for Mode P (plan §6 WP-04: "at-most-one-unacked-frame").
 * Fire-and-forget; `frameId` echoes `PixelFrameHeader.frameId`.
 */
export interface AckMessage {
  t: 'ack';
  what: 'pixels';
  frameId: number;
}

export type ClientMessage =
  CallMessage | DoMessage | InputMessage | SubMessage | UnsubMessage | AckMessage;

/** Client messages that carry an id and get exactly one terminal ok/err. */
export type ClientRequest = CallMessage | DoMessage | SubMessage | UnsubMessage;

export type ClientMessageType = ClientMessage['t'];

/* ------------------------------------------------------------------ *
 * Server -> Client
 * ------------------------------------------------------------------ */

/** Terminal success for request `id`. */
export interface OkMessage {
  id: number;
  t: 'ok';
  result: Json;
  /**
   * Command-echo invalidation classes (plan §1.5). The ONLY mechanism that
   * covers per-atom colour, per-atom reps, `alter` and coordinate edits —
   * polling cannot see them (`cmd.get_vis()` is object-level only, measured).
   */
  inval?: readonly InvalidationClass[];
}

/**
 * Plan §1.5. `resync` is emitted for `cmd.do`, `cmd.run` and `@script`, whose
 * effects the bridge cannot classify.
 */
export const INVALIDATION_CLASSES = [
  'color',
  'reps',
  'geometry',
  'coords',
  'names',
  'resync',
] as const;
export type InvalidationClass = (typeof INVALIDATION_CLASSES)[number];

/** Terminal failure for request `id`. */
export interface ErrMessage {
  id: number;
  t: 'err';
  error: WireError;
}

/**
 * Topic push. `seq` is monotonic per topic so a client can detect a gap and
 * force a resync (plan §6 WP-08).
 */
export interface EventMessage<T extends Topic = Topic> {
  t: 'event';
  topic: T;
  seq: number;
  payload: TopicPayloads[T];
}

/** Distributive form: narrowing on `.topic` narrows `.payload`. */
export type AnyEventMessage = { [K in Topic]: EventMessage<K> }[Topic];

/**
 * Console output drained from `cmd._get_feedback()`
 * (`modules/pymol/internal.py:596-606`). Append-only, never coalesced: reading
 * the queue destroys it, so a dropped frame is a permanently lost line.
 */
export interface FeedbackMessage {
  t: 'feedback';
  lines: string[];
}

/** First frame on every connection. */
export interface HelloMessage {
  t: 'hello';
  pymolVersion: string;
  protocolVersion: number;
  /**
   * Whether this bridge build has the Mode-G geometry accessor
   * (`layer4/CmdWebGeometry.cpp`, plan §4 Task 1). When false the client must
   * stay in Mode P for every rep.
   */
  modeG?: boolean;
}

export type ServerMessage =
  OkMessage | ErrMessage | AnyEventMessage | FeedbackMessage | HelloMessage;

/** Server messages that terminate a request. */
export type ServerResponse = OkMessage | ErrMessage;

export type ServerMessageType = ServerMessage['t'];

/* ------------------------------------------------------------------ *
 * Type guards
 * ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

export function isOkMessage(v: unknown): v is OkMessage {
  return isRecord(v) && v['t'] === 'ok' && isInt(v['id']);
}

export function isErrMessage(v: unknown): v is ErrMessage {
  return isRecord(v) && v['t'] === 'err' && isInt(v['id']) && isWireError(v['error']);
}

export function isResponseMessage(v: unknown): v is ServerResponse {
  return isOkMessage(v) || isErrMessage(v);
}

export function isEventMessage(v: unknown): v is AnyEventMessage {
  return (
    isRecord(v) && v['t'] === 'event' && isTopic(v['topic']) && isInt(v['seq']) && 'payload' in v
  );
}

export function isFeedbackMessage(v: unknown): v is FeedbackMessage {
  return (
    isRecord(v) &&
    v['t'] === 'feedback' &&
    Array.isArray(v['lines']) &&
    v['lines'].every((l) => typeof l === 'string')
  );
}

export function isHelloMessage(v: unknown): v is HelloMessage {
  return (
    isRecord(v) &&
    v['t'] === 'hello' &&
    typeof v['pymolVersion'] === 'string' &&
    isInt(v['protocolVersion'])
  );
}

export function isServerMessage(v: unknown): v is ServerMessage {
  return (
    isOkMessage(v) ||
    isErrMessage(v) ||
    isEventMessage(v) ||
    isFeedbackMessage(v) ||
    isHelloMessage(v)
  );
}

export function isCallMessage(v: unknown): v is CallMessage {
  return (
    isRecord(v) &&
    v['t'] === 'call' &&
    isInt(v['id']) &&
    typeof v['fn'] === 'string' &&
    Array.isArray(v['args']) &&
    isRecord(v['kwargs'])
  );
}

export function isDoMessage(v: unknown): v is DoMessage {
  return isRecord(v) && v['t'] === 'do' && isInt(v['id']) && typeof v['cmd'] === 'string';
}

export function isInputMessage(v: unknown): v is InputMessage {
  if (!isRecord(v) || v['t'] !== 'input') return false;
  switch (v['kind']) {
    case 'button':
      return (
        isInt(v['button']) &&
        isInt(v['state']) &&
        isInt(v['x']) &&
        isInt(v['y']) &&
        isInt(v['mod']) &&
        typeof v['when'] === 'number'
      );
    case 'drag':
      return isInt(v['x']) && isInt(v['y']) && isInt(v['mod']) && typeof v['when'] === 'number';
    case 'reshape':
      return isInt(v['width']) && isInt(v['height']) && typeof v['force'] === 'boolean';
    default:
      return false;
  }
}

export function isSubMessage(v: unknown): v is SubMessage {
  return isRecord(v) && v['t'] === 'sub' && isInt(v['id']) && isTopic(v['topic']);
}

export function isUnsubMessage(v: unknown): v is UnsubMessage {
  return isRecord(v) && v['t'] === 'unsub' && isInt(v['id']) && isTopic(v['topic']);
}

export function isAckMessage(v: unknown): v is AckMessage {
  return isRecord(v) && v['t'] === 'ack' && v['what'] === 'pixels' && isInt(v['frameId']);
}

export function isClientMessage(v: unknown): v is ClientMessage {
  return (
    isCallMessage(v) ||
    isDoMessage(v) ||
    isInputMessage(v) ||
    isSubMessage(v) ||
    isUnsubMessage(v) ||
    isAckMessage(v)
  );
}

/** True for client messages that expect exactly one terminal ok/err. */
export function isClientRequest(v: unknown): v is ClientRequest {
  return isCallMessage(v) || isDoMessage(v) || isSubMessage(v) || isUnsubMessage(v);
}

/* ------------------------------------------------------------------ *
 * Small helpers (pure)
 * ------------------------------------------------------------------ */

/** Epoch seconds as a float — the `when` field of input messages. */
export function nowEpochSeconds(): number {
  return Date.now() / 1000;
}
