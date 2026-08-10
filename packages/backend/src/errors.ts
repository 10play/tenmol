/**
 * @tenmol/backend — the errors a backend rejects with.
 *
 * Moved here from `@tenmol/client`'s connection (which re-exports them) so both
 * backends reject with the SAME error classes. Error parity is part of the
 * 1-to-1 contract: an unported or refused call must look identical whether it
 * came back from real PyMOL over the wire or from the in-browser engine.
 */

import type { WireError } from '@tenmol/protocol';

/**
 * A PyMOL-side failure: the backend answered `{t:'err'}`. Carries the Python
 * exception class name (or a bridge rejection like 'NotAllowed'), so the
 * TypeScript engine can reproduce the exact `type` a symbol raises.
 */
export class PymolError extends Error {
  override name = 'PymolError';
  /** Python exception class name, or a bridge rejection like 'NotAllowed'. */
  readonly type: string;
  readonly traceback: string;
  /** The `fn`/`cmd` that failed, for context in logs. */
  readonly request: string | undefined;

  constructor(error: WireError, request?: string) {
    super(error.message || error.type);
    this.type = error.type;
    this.traceback = error.traceback;
    this.request = request;
  }
}

/** The transport went away (or was never up) before a reply arrived. */
export class DisconnectedError extends Error {
  override name = 'DisconnectedError';
}

/** No reply within the configured timeout. */
export class RequestTimeoutError extends Error {
  override name = 'RequestTimeoutError';
}
