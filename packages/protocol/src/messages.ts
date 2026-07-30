/**
 * @tenmol/protocol — wire message types.
 *
 * v1 of the tenmol web-client wire protocol. ONE WebSocket at
 * `ws://127.0.0.1:8765/ws`, JSON text frames for control, binary frames for
 * geometry (see ./geometry.ts).
 *
 * This file is the single normative TypeScript encoding of the protocol. It is
 * intentionally minimal: do not add message types or fields without bumping
 * PROTOCOL_VERSION and updating the bridge in lockstep.
 *
 * Zero runtime dependencies. Everything exported here is either a type, a
 * `const`, or a pure function.
 */

import type { Topic, TopicPayloads } from './topics';
import { isTopic } from './topics';

/** Bumped whenever a frame shape changes incompatibly. Server echoes it in `hello`. */
export const PROTOCOL_VERSION = 1;

/** Loopback only, never 0.0.0.0 (01-architecture.md:303). */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8765;
export const WS_PATH = '/ws';
export const DEFAULT_WS_URL = `ws://${DEFAULT_HOST}:${DEFAULT_PORT}${WS_PATH}`;

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

export type JsonPrimitive = null | boolean | number | string;
export type Json = JsonPrimitive | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/* ------------------------------------------------------------------ *
 * Input constants
 *
 * These mirror the values the PyMOL C core expects through
 * `_cmd._button(COb, button, state, x, y, mod)` and
 * `_cmd._drag(COb, x, y, mod)` (modules/pymol2/__init__.py:46-50).
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
 * Needed by the console AND by every `pymol.menu` leaf, which returns command
 * *strings* (`layer4/PopUp.cpp:471-475`) — see 02-completeness-critique.md:114.
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

export type ClientMessage = CallMessage | DoMessage | InputMessage | SubMessage | UnsubMessage;

/** Client messages that carry an id and get exactly one terminal ok/err. */
export type ClientRequest = CallMessage | DoMessage | SubMessage | UnsubMessage;

export type ClientMessageType = ClientMessage['t'];

/* ------------------------------------------------------------------ *
 * Server -> Client
 * ------------------------------------------------------------------ */

/**
 * Error payload. `type` is the Python exception class name, e.g.
 * `CmdException` (`modules/pymol/__init__.py:468`),
 * `IncentiveOnlyException` (`:482`),
 * `QuietException` (`modules/pymol/parsing.py:71`),
 * or a bridge-level rejection such as `NotAllowed`.
 * The `(string & {})` member keeps the known names as completions without
 * closing the union — the bridge may surface any Python exception type.
 */
export type WireErrorType =
  | 'CmdException'
  | 'QuietException'
  | 'IncentiveOnlyException'
  | 'NotAllowed'
  | 'TypeError'
  | 'ValueError'
  | (string & {});

export interface WireError {
  type: WireErrorType;
  message: string;
  /** Full Python traceback as one string; may be '' when unavailable. */
  traceback: string;
}

/** Terminal success for request `id`. */
export interface OkMessage {
  id: number;
  t: 'ok';
  result: Json;
}

/** Terminal failure for request `id`. */
export interface ErrMessage {
  id: number;
  t: 'err';
  error: WireError;
}

/**
 * Topic push. `seq` is monotonic per topic so a client can detect a gap and
 * force a resync.
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
 * (`modules/pymol/internal.py:593-606`). Append-only, never coalesced.
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

export function isWireError(v: unknown): v is WireError {
  return (
    isRecord(v) &&
    typeof v['type'] === 'string' &&
    typeof v['message'] === 'string' &&
    typeof v['traceback'] === 'string'
  );
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

export function isClientMessage(v: unknown): v is ClientMessage {
  return (
    isCallMessage(v) || isDoMessage(v) || isInputMessage(v) || isSubMessage(v) || isUnsubMessage(v)
  );
}

/** True for client messages that expect exactly one terminal ok/err. */
export function isClientRequest(v: unknown): v is ClientRequest {
  return isCallMessage(v) || isDoMessage(v) || isSubMessage(v) || isUnsubMessage(v);
}

/* ------------------------------------------------------------------ *
 * Small helpers (pure)
 * ------------------------------------------------------------------ */

/** One-line human form of a WireError, for consoles and toasts. */
export function formatWireError(e: WireError): string {
  return e.message ? `${e.type}: ${e.message}` : e.type;
}

/** Epoch seconds as a float — the `when` field of input messages. */
export function nowEpochSeconds(): number {
  return Date.now() / 1000;
}
