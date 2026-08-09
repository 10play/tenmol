/**
 * The GL-free view-sync decisions, in isolation.
 *
 * These pin the exact race the reviewer called out: a `get_view()` reply that
 * lands AFTER the client advanced the view locally must be rejected, or a
 * remote drag rubber-bands. `createViewport` needs a real WebGL2 context (only
 * reachable in e2e), so the logic lives here where it can be tested directly.
 */

import { describe, expect, it } from 'vitest';

import { serverRasterisesNothing, viewReplyIsFresh } from './viewSync';

describe('viewReplyIsFresh', () => {
  it('accepts a reply only when no local move happened since it was requested', () => {
    expect(viewReplyIsFresh(7, 7)).toBe(true);
  });

  it('rejects a reply that a single local turn moved past', () => {
    const requested = 3;
    const afterOneTurn = requested + 1;
    expect(viewReplyIsFresh(requested, afterOneTurn)).toBe(false);
  });

  it('rejects a reply that SEVERAL local turns moved past (the real race)', () => {
    // Request get_view at epoch 5, then the drag fires four more optimistic
    // turns (epoch -> 9) before the reply arrives. The stale reply is dropped.
    const requestedAtEpoch = 5;
    let epoch = requestedAtEpoch;
    for (let i = 0; i < 4; i++) epoch++; // four more local turns land first
    expect(viewReplyIsFresh(requestedAtEpoch, epoch)).toBe(false);
  });
});

describe('serverRasterisesNothing', () => {
  it('is true when the active source declares it (GL-free primary)', () => {
    expect(serverRasterisesNothing(false, undefined)).toBe(true);
  });

  it('is true when the raw source declares it (fallback masks the active one)', () => {
    expect(serverRasterisesNothing(undefined, false)).toBe(true);
  });

  it('treats undefined as "a stream is still expected", not a negative verdict', () => {
    expect(serverRasterisesNothing(undefined, undefined)).toBe(false);
  });

  it('is false when a source actively rasterises', () => {
    expect(serverRasterisesNothing(true, true)).toBe(false);
  });
});
