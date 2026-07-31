/**
 * Per-client pause (defect D3c) and the visibility wiring (D3b), headless.
 *
 * The assertions that matter:
 *   * a pause NEVER reaches the bridge unless the bridge said it can pause one
 *     client (or we are the only client), because `StreamParams.paused` is
 *     process-wide;
 *   * a paused client stops acking, which is what makes the throttle
 *     per-client;
 *   * a controller mounted in an ALREADY hidden document is paused at once.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'vitest';

import type { PixelFramePayload, PixelSink, PixelSource } from '../types';
import { createPauseCoordinator, createStreamPauseController, perClientPause } from './pause';
import { createVisibilityController } from './visibility';

/* ------------------------------------------------------------------ fakes */

function fakeSource(): PixelSource & { sink: PixelSink | null; globalPaused: boolean | null } {
  const state = {
    name: 'fake',
    sink: null as PixelSink | null,
    globalPaused: null as boolean | null,
    start(sink: PixelSink): void {
      state.sink = sink;
    },
    stop(): void {
      state.sink = null;
    },
    setPaused(paused: boolean): void {
      state.globalPaused = paused;
    },
  };
  return state;
}

const frame = (frameId: number): PixelFramePayload => ({
  bytes: new Uint8Array(1),
  encoding: 'jpeg',
  width: 4,
  height: 4,
  dpr: 1,
  flipY: false,
  frameId,
  receivedAt: 0,
});

/** Presenter stand-in: acks exactly what it is given, like the real one. */
function presenter(): { acks: number[]; sink: PixelSink } {
  const acks: number[] = [];
  return {
    acks,
    sink: {
      frame: (f) => acks.push(f.frameId),
      error: () => {},
    },
  };
}

function fakeDocument(state: { visibilityState: string }): {
  doc: {
    visibilityState: string;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  };
  fire(type: string): void;
} {
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    get visibilityState(): string {
      return state.visibilityState;
    },
    addEventListener(type: string, listener: () => void): void {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void): void {
      listeners.get(type)?.delete(listener);
    },
  };
  return { doc, fire: (type: string) => listeners.get(type)?.forEach((l) => l()) };
}

/* ------------------------------------------------------------------ tests */

describe('pause coordinator', () => {
  test('several reasons; the stream resumes only when the LAST one clears', () => {
    const seen: boolean[] = [];
    const c = createPauseCoordinator((paused) => seen.push(paused));
    c.set('hidden', true);
    c.set('mode-g', true);
    c.set('hidden', false);
    assert.equal(c.paused, true, 'still paused: mode-g holds it');
    c.set('mode-g', false);
    assert.deepEqual(seen, [true, false]);
    assert.deepEqual(c.reasons, []);
  });
});

describe('per-client pause', () => {
  test('a paused client drops frames BEFORE the presenter, so it never acks', () => {
    const source = fakeSource();
    const gated = perClientPause(source, {});
    const p = presenter();
    gated.start(p.sink);

    source.sink?.frame(frame(1));
    gated.setPaused(true);
    for (let id = 2; id <= 61; id++) source.sink?.frame(frame(id));
    gated.setPaused(false);
    source.sink?.frame(frame(62));

    assert.deepEqual(p.acks, [1, 62], `acked ${JSON.stringify(p.acks)}`);
    assert.equal(gated.pauseStats.suppressed, 60);
    assert.equal(gated.pauseStats.delivered, 2);
  });

  test('WITHOUT a per-client capability the global flag is never sent', async () => {
    const source = fakeSource();
    // A bridge with two clients and no `perClientPause` support: pausing
    // globally here would blank the OTHER user.
    const gated = perClientPause(source, {
      transport: {
        input: () => {},
        call: () => Promise.resolve({ modeP: { clients: 2, params: { paused: false } } }),
      },
    });
    gated.start(presenter().sink);
    gated.setPaused(true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(source.globalPaused, null, 'the bridge was told to pause everyone');
    assert.equal(gated.pauseStats.globalPauseAllowed, false);
    assert.equal(gated.pauseStats.clients, 2);
    assert.equal(gated.pauseStats.paused, true, 'but this client IS paused');
  });

  test('a bridge that reports perClientPause DOES get the flag', async () => {
    const source = fakeSource();
    const gated = perClientPause(source, {
      transport: {
        input: () => {},
        call: () => Promise.resolve({ modeP: { clients: 3, params: { perClientPause: true } } }),
      },
    });
    gated.start(presenter().sink);
    gated.setPaused(true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(source.globalPaused, true);
    assert.equal(gated.pauseStats.globalPauses, 1);
  });

  test('sole subscriber: global == per-client, so the flag is allowed', async () => {
    const source = fakeSource();
    const gated = perClientPause(source, {
      transport: {
        input: () => {},
        call: () => Promise.resolve({ modeP: { clients: 1, params: {} } }),
      },
    });
    gated.start(presenter().sink);
    gated.setPaused(true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(source.globalPaused, true);
  });

  test('permission is NOT cached: a second client joining takes it away again', async () => {
    const source = fakeSource();
    let clients = 1; // we are alone at first, so global == per-client
    const calls: string[] = [];
    const gated = perClientPause(source, {
      transport: {
        input: () => {},
        call: (fn) => {
          calls.push(fn);
          return Promise.resolve({ modeP: { clients, params: {} } });
        },
      },
    });
    gated.start(presenter().sink);

    gated.setPaused(true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(source.globalPaused, true, 'sole client: the flag is legitimate');
    gated.setPaused(false);
    await new Promise((r) => setTimeout(r, 0));

    // Somebody else opened the app in between.
    clients = 2;
    source.globalPaused = null;
    gated.setPaused(true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(source.globalPaused, null, 'the second client was blanked by our pause');
    assert.equal(gated.pauseStats.globalPauseAllowed, false);
    assert.equal(gated.pauseStats.clients, 2);
    assert.equal(gated.pauseStats.paused, true, 'and we are still locally paused');
    assert.equal(
      calls.filter((fn) => fn === '_bridge.render_stats').length,
      2,
      'the subscriber count was re-read on the second pause',
    );
  });

  test('a missing route is asked for ONCE, not on every pause', async () => {
    const source = fakeSource();
    let calls = 0;
    const gated = perClientPause(source, {
      transport: {
        input: () => {},
        call: () => {
          calls++;
          return Promise.reject(new Error('NotAllowed'));
        },
      },
    });
    gated.start(presenter().sink);
    for (let i = 0; i < 3; i++) {
      gated.setPaused(true);
      await new Promise((r) => setTimeout(r, 0));
      gated.setPaused(false);
      await new Promise((r) => setTimeout(r, 0));
    }
    assert.equal(calls, 1 + 3, 'render_stats once + one request_frame per resume');
    assert.equal(source.globalPaused, null);
  });

  test('resume asks for a fresh frame, because the canvas is stale', async () => {
    const calls: string[] = [];
    const source = fakeSource();
    const gated = perClientPause(source, {
      transport: {
        input: () => {},
        call: (fn) => {
          calls.push(fn);
          return Promise.resolve({ modeP: { clients: 2, params: {} } });
        },
      },
    });
    gated.start(presenter().sink);
    gated.setPaused(true);
    await new Promise((r) => setTimeout(r, 0));
    gated.setPaused(false);
    assert.ok(calls.includes('_bridge.request_frame'), calls.join(','));
  });

  test('an older bridge with no render_stats route stays local-only, silently', async () => {
    const source = fakeSource();
    const gated = perClientPause(source, {
      transport: {
        input: () => {},
        call: () => Promise.reject(new Error('NotAllowed: _bridge.render_stats')),
      },
    });
    gated.start(presenter().sink);
    gated.setPaused(true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(source.globalPaused, null);
    assert.equal(gated.pauseStats.paused, true);
  });
});

describe('visibility', () => {
  test('MOUNTING IN A HIDDEN DOCUMENT pauses immediately (defect D3b)', () => {
    const state = { visibilityState: 'hidden' };
    const { doc } = fakeDocument(state);
    const source = fakeSource();
    const controller = createStreamPauseController({
      source,
      document: doc,
      window: null,
    });
    // No `visibilitychange` event has fired and none ever will: the tab was
    // hidden before this code ran. The old implementation stayed unpaused.
    assert.equal(controller.paused, true);
    assert.deepEqual(controller.reasons, ['hidden']);
    assert.equal(controller.stats.paused, true);
    controller.destroy();
  });

  test('visible at mount -> hidden -> visible tracks the event', () => {
    const state = { visibilityState: 'visible' };
    const { doc, fire } = fakeDocument(state);
    const source = fakeSource();
    const controller = createStreamPauseController({ source, document: doc, window: null });
    assert.equal(controller.paused, false);
    state.visibilityState = 'hidden';
    fire('visibilitychange');
    assert.equal(controller.paused, true);
    state.visibilityState = 'visible';
    fire('visibilitychange');
    assert.equal(controller.paused, false);
    controller.destroy();
  });

  test('freeze/pagehide count as hidden; resume re-reads the state', () => {
    const state = { visibilityState: 'visible' };
    const { doc, fire } = fakeDocument(state);
    const seen: boolean[] = [];
    const controller = createVisibilityController({
      onChange: (hidden) => seen.push(hidden),
      document: doc,
      window: null,
    });
    fire('freeze');
    assert.equal(controller.hidden, true);
    fire('resume'); // still `visible` in the document
    assert.equal(controller.hidden, false);
    assert.deepEqual(seen, [false, true, false]);
    controller.destroy();
  });

  test('destroy() unsubscribes', () => {
    const state = { visibilityState: 'visible' };
    const { doc, fire } = fakeDocument(state);
    const seen: boolean[] = [];
    const controller = createVisibilityController({
      onChange: (hidden) => seen.push(hidden),
      document: doc,
      window: null,
    });
    controller.destroy();
    state.visibilityState = 'hidden';
    fire('visibilitychange');
    assert.deepEqual(seen, [false]);
  });
});
