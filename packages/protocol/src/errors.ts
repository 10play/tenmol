/**
 * @tenmol/protocol — error kinds.
 *
 * WP-01, plan §6 / §2 (A6, B7, B8).
 *
 * Six kinds, closed. The bridge classifies every failure into exactly one of
 * them before it reaches the wire; the client switches on `kind`, never on the
 * free-form `type` string.
 *
 *   CmdException    `pymol.CmdException`            packages/engine/modules/pymol/__init__.py:468
 *   QuietException  `pymol.parsing.QuietException`  packages/engine/modules/pymol/parsing.py:71
 *   IncentiveOnly   `pymol.IncentiveOnlyException`  packages/engine/modules/pymol/__init__.py:482
 *                   (subclass of CmdException — classify it FIRST, plan §B7)
 *   NotAllowed      bridge capability-policy rejection            plan §A6
 *   NotSerializable return value not in the codec table           plan §B8
 *   PythonError     any other Python exception that escaped       fallback
 *
 * Zero runtime dependencies. Types, consts and pure functions only.
 */

/* ------------------------------------------------------------------ *
 * Kinds
 * ------------------------------------------------------------------ */

/** The closed set, in classification order (most specific first). */
export const ERROR_KINDS = [
  'IncentiveOnly',
  'QuietException',
  'CmdException',
  'NotAllowed',
  'NotSerializable',
  'PythonError',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

const ERROR_KIND_SET: ReadonlySet<string> = new Set<string>(ERROR_KINDS);

export function isErrorKind(v: unknown): v is ErrorKind {
  return typeof v === 'string' && ERROR_KIND_SET.has(v);
}

/**
 * Python exception class name -> kind. Anything not listed is `PythonError`.
 *
 * `IncentiveOnlyException` extends `CmdException`, so an `isinstance` ladder in
 * the bridge must test it first; this table makes the same ordering explicit.
 */
export const PYTHON_EXCEPTION_TO_KIND: Readonly<Record<string, ErrorKind>> = {
  IncentiveOnlyException: 'IncentiveOnly',
  QuietException: 'QuietException',
  CmdException: 'CmdException',
};

/** Classify a Python exception class name. Never throws. */
export function kindForPythonException(typeName: string): ErrorKind {
  return PYTHON_EXCEPTION_TO_KIND[typeName] ?? 'PythonError';
}

/**
 * True when the failure is the user's own expected control flow rather than a
 * defect: `QuietException` is how PyMOL's parser aborts a command *silently*
 * (`packages/engine/modules/pymol/parsing.py:71`). The console must not raise a toast for it.
 */
export function isQuiet(kind: ErrorKind): boolean {
  return kind === 'QuietException';
}

/**
 * True when the control that produced the error should be permanently
 * disabled/annotated rather than retried — the `IncentiveOnly` manifest of
 * plan §B7 (`cmd.clean`, `assign_stereo`, `morph`, `find_pi_interactions`, …).
 */
export function isPermanentlyUnavailable(kind: ErrorKind): boolean {
  return kind === 'IncentiveOnly';
}

/* ------------------------------------------------------------------ *
 * Wire shape
 * ------------------------------------------------------------------ */

/**
 * The raw Python exception class name (or a bridge-level label). Kept open —
 * `kind` is the closed discriminant, `type` is diagnostic detail only.
 */
export type WireErrorType =
  | 'CmdException'
  | 'QuietException'
  | 'IncentiveOnlyException'
  | 'NotAllowed'
  | 'NotSerializable'
  | 'TypeError'
  | 'ValueError'
  | (string & {});

/** The payload of a `{t:'err'}` frame. */
export interface WireError {
  /** Closed discriminant. Switch on this. */
  kind: ErrorKind;
  /** Python exception class name, or a bridge label. Diagnostic only. */
  type: WireErrorType;
  message: string;
  /** Full Python traceback as one string; '' when unavailable. */
  traceback: string;
  /**
   * For `NotAllowed` / `IncentiveOnly` / `NotSerializable`: the dotted API
   * symbol that was refused, e.g. `'clean'`, `'get_session'`. Absent otherwise.
   */
  symbol?: string;
  /**
   * For `NotSerializable`: the Python type name that had no codec entry
   * (plan §B8). Absent otherwise.
   */
  pyType?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isWireError(v: unknown): v is WireError {
  return (
    isRecord(v) &&
    isErrorKind(v['kind']) &&
    typeof v['type'] === 'string' &&
    typeof v['message'] === 'string' &&
    typeof v['traceback'] === 'string'
  );
}

/* ------------------------------------------------------------------ *
 * Constructors (pure) — used by tests, mocks and the JS-side mock bridge
 * ------------------------------------------------------------------ */

export function wireError(
  kind: ErrorKind,
  message: string,
  extra: Partial<Omit<WireError, 'kind' | 'message'>> = {},
): WireError {
  return {
    kind,
    type: extra.type ?? kind,
    message,
    traceback: extra.traceback ?? '',
    ...(extra.symbol !== undefined ? { symbol: extra.symbol } : {}),
    ...(extra.pyType !== undefined ? { pyType: extra.pyType } : {}),
  };
}

export function notAllowed(symbol: string, message?: string): WireError {
  return wireError('NotAllowed', message ?? `'${symbol}' is not permitted by the bridge policy`, {
    type: 'NotAllowed',
    symbol,
  });
}

export function incentiveOnly(symbol: string, message?: string): WireError {
  return wireError(
    'IncentiveOnly',
    message ?? `'${symbol}' is not supported by this open-source PyMOL build`,
    { type: 'IncentiveOnlyException', symbol },
  );
}

export function notSerializable(symbol: string, pyType: string): WireError {
  return wireError(
    'NotSerializable',
    `'${symbol}' returned a ${pyType}, which has no entry in the codec table`,
    { type: 'NotSerializable', symbol, pyType },
  );
}

/* ------------------------------------------------------------------ *
 * Presentation
 * ------------------------------------------------------------------ */

/** One-line human form, for consoles and toasts. */
export function formatWireError(e: WireError): string {
  const head = e.message ? `${e.type}: ${e.message}` : e.type;
  return e.symbol ? `${head} (${e.symbol})` : head;
}

/** A malformed or unparseable frame. Local to the client; never on the wire. */
export class ProtocolError extends Error {
  override name = 'ProtocolError';
}
