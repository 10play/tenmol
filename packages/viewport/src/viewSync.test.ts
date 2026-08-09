/**
 * The GL-free view-sync decisions, in isolation.
 *
 * These pin the exact race the reviewer called out: a `get_view()` reply that
 * lands AFTER the client advanced the view locally must be rejected, or a
 * remote drag rubber-bands. `createViewport` needs a real WebGL2 context (only
 * reachable in e2e), so the logic lives here where it can be tested directly.
 */

import { MODE_G_CAPABLE_REPS } from '@tenmol/protocol';
import { describe, expect, it } from 'vitest';

import { createRenderPolicy } from './renderPolicy';
import {
  handOffSceneToModeG,
  serverRasterisesNothing,
  shouldHandOffToModeG,
  viewReplyIsFresh,
} from './viewSync';

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

describe('handOffSceneToModeG', () => {
  it('flips every capable rep to Mode G on a GL-free bridge (real policy)', () => {
    // A GL-free bridge as seen by the client: WebGL is available locally, but
    // the accessor has not been proven yet and the boot default is Mode P.
    const policy = createRenderPolicy({ caps: { webgl: true, accessor: false } });
    const rep = MODE_G_CAPABLE_REPS[0]!;

    // Before the hand-off nothing is drawn client-side (no accessor + pixel
    // default) — this is exactly the deadlock that left the viewport frozen.
    expect(policy.state(rep).effective).not.toBe('geometry');

    handOffSceneToModeG(policy);

    // After it, the rep resolves to Mode G and will pull its geometry.
    expect(policy.state(rep).effective).toBe('geometry');
    expect(policy.caps.accessor).toBe(true);
  });

  it('never leaves a rep waiting on a no-accessor fallback once handed off', () => {
    const policy = createRenderPolicy({ caps: { webgl: true, accessor: false } });
    handOffSceneToModeG(policy);
    for (const rep of MODE_G_CAPABLE_REPS) {
      expect(policy.state(rep).fallbackReason).toBeUndefined();
      expect(policy.state(rep).effective).toBe('geometry');
    }
  });
});

describe('shouldHandOffToModeG', () => {
  it('runs once, only when the client can render, and never twice', () => {
    expect(shouldHandOffToModeG(true, false)).toBe(true); // WebGL, not yet done
    expect(shouldHandOffToModeG(true, true)).toBe(false); // already handed off
    expect(shouldHandOffToModeG(false, false)).toBe(false); // no client WebGL -> can't help
  });
});
