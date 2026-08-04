/**
 * The text editor's "do the bridge file endpoints exist?" probe.
 *
 * This is the one decision in the editor that must not be optimistic: getting
 * it wrong makes the panel claim it wrote to the PyMOL host when the bytes
 * actually went to ~/Downloads. The strings below are the bridge's real ones,
 * captured from this tree.
 */

import { describe, expect, it } from 'vitest';
import {
  MISSING_ROUTE,
  PROBE_ATTEMPTS,
  PROBE_DELAY_MS,
  PROBE_MAX_DELAY_MS,
  RECHECK,
  probeServerFiles,
} from './files';
import type { Session } from '../../app';

/**
 * `conn.do` is the bootstrap hop: `probeServerFiles` installs
 * `cmd.tenmol_files` and re-asks before concluding the route is absent
 * (nothing in the app runs `FILES_BOOTSTRAP` at startup). The default here
 * resolves, so `behaviour` alone decides the answer.
 */
const fakeSession = (behaviour: () => Promise<unknown>, bootstrap?: () => Promise<unknown>): Session =>
  ({
    call: () => behaviour(),
    conn: { do: bootstrap ?? (() => Promise.resolve()) },
  }) as unknown as Session;

const notRouted = () =>
  Promise.reject(new Error("'cmd.tenmol_files' is not an addressable namespace"));

describe('MISSING_ROUTE', () => {
  it('recognises the bridge answers that mean "the endpoint does not exist"', () => {
    // measured: `{t:'call', fn:'_bridge.read_text_file'}` on this tree
    expect(MISSING_ROUTE.test("no render route for '_bridge.read_text_file'")).toBe(true);
    // policy/base.py, for an un-granted namespace
    expect(MISSING_ROUTE.test("'_bridge' is not an addressable namespace")).toBe(true);
    expect(MISSING_ROUTE.test('cmd.foo: no such symbol (bar)')).toBe(true);
  });

  it('does NOT swallow a real path error, which means the route is there', () => {
    expect(MISSING_ROUTE.test('[Errno 2] No such file or directory: /tmp/x')).toBe(false);
    expect(MISSING_ROUTE.test('IsADirectoryError: /tmp')).toBe(false);
    expect(MISSING_ROUTE.test('PermissionError: /etc/shadow')).toBe(false);
  });
});

describe('probeServerFiles', () => {
  it('is true when the endpoint answers', async () => {
    expect(await probeServerFiles(fakeSession(() => Promise.resolve({ text: '' })))).toBe(true);
  });

  it('is false when the endpoint is not routed', async () => {
    const session = fakeSession(() =>
      Promise.reject(new Error("no render route for '_bridge.read_text_file'")),
    );
    expect(await probeServerFiles(session, { attempts: 3, delayMs: 0 })).toBe(false);
  });

  it('is TRUE when the endpoint exists and only the path was bad', async () => {
    const session = fakeSession(() =>
      Promise.reject(new Error('[Errno 2] No such file or directory: ')),
    );
    expect(await probeServerFiles(session)).toBe(true);
  });

  /*
   * THE CI DEFECT. `{t:'do'}` is acknowledged when the command is ENQUEUED,
   * not when it runs: `cmd.do` -> `PParse` -> `OrthoCommandIn`
   * (`packages/engine/layer1/P.cpp:2200-2203`), drained by `PFlush` inside
   * `PyMOL_Idle` — which opens with `PYMOL_API_TRYLOCK`
   * (`packages/engine/layer5/PyMOL.cpp:2407,:95`) and therefore flushes
   * NOTHING on a tick that loses the API lock. One bootstrap-and-ask was a
   * coin flip on a loaded host, and losing it downgraded the editor to the
   * browser filesystem permanently.
   */
  it('keeps bootstrapping until the install actually takes effect', async () => {
    let asks = 0;
    let bootstraps = 0;
    const session = fakeSession(
      () => {
        asks += 1;
        // The install lands during the third round trip and not before.
        return asks >= 3 ? Promise.resolve({ ok: false, error: 'no path' }) : notRouted();
      },
      () => {
        bootstraps += 1;
        return Promise.resolve();
      },
    );
    expect(await probeServerFiles(session)).toBe(true);
    expect(bootstraps).toBeGreaterThan(1);
  });

  it('gives up after a BOUNDED number of rounds — it must not poll forever', async () => {
    let bootstraps = 0;
    const session = fakeSession(notRouted, () => {
      bootstraps += 1;
      return Promise.resolve();
    });
    expect(await probeServerFiles(session, { delayMs: 0 })).toBe(false);
    expect(bootstraps).toBe(PROBE_ATTEMPTS);
  });

  it('stops as soon as the caller is gone, so an unmounted panel goes quiet', async () => {
    let bootstraps = 0;
    const session = fakeSession(notRouted, () => {
      bootstraps += 1;
      return Promise.resolve();
    });
    expect(await probeServerFiles(session, { delayMs: 0, alive: () => false })).toBe(false);
    expect(bootstraps).toBe(0);
  });

  it('survives a bootstrap that throws — a failed `do` says nothing about the route', async () => {
    let asks = 0;
    const session = fakeSession(
      () => {
        asks += 1;
        return asks >= 2 ? Promise.resolve({ ok: true, text: '' }) : notRouted();
      },
      () => Promise.reject(new Error('socket is reconnecting')),
    );
    expect(await probeServerFiles(session, { delayMs: 0 })).toBe(true);
  });

  /**
   * THE PAUSE BELONGS AFTER THE BOOTSTRAP, NOT AFTER THE ASK.
   *
   * `{t:'do'}` is acknowledged when the line is ENQUEUED, so the ask that
   * judges a bootstrap has to be given a moment. With the pause at the END of
   * the round, every ask but the first inherited its settling time from the
   * PREVIOUS round and the last one — the ask whose answer becomes the verdict
   * — got none at all. `attempts: 1` isolates exactly that round: the install
   * lands 20 ms after the `do`, which is one tick's worth of PyMOL_Idle losing
   * its try-lock, and the probe must still see it.
   */
  it('gives the ask that decides the same settling time as the others', async () => {
    let installed = false;
    const session = fakeSession(
      () => (installed ? Promise.resolve({ ok: false, error: 'no path' }) : notRouted()),
      () => {
        setTimeout(() => {
          installed = true;
        }, 20);
        return Promise.resolve();
      },
    );
    expect(await probeServerFiles(session, { attempts: 1, delayMs: 60 })).toBe(true);
  });

  it('does not wait longer and longer for ever — the back-off is capped', async () => {
    const started = Date.now();
    const session = fakeSession(notRouted);
    expect(await probeServerFiles(session)).toBe(false);
    // 250 + 500 * 4 with the cap; without it the fifth pause alone is 1250 ms.
    expect(Date.now() - started).toBeLessThan(
      PROBE_DELAY_MS + PROBE_MAX_DELAY_MS * (PROBE_ATTEMPTS - 1) + 500,
    );
  });

  /**
   * The re-check an ACTION does before it accepts the browser fallback: one
   * bootstrap-and-ask, no schedule. It exists because `cmd.tenmol_files` turns
   * up LATE on a loaded host — the app installs it itself — and the panel used
   * to latch the browser filesystem for the rest of the window's life.
   */
  it('RECHECK is a single cheap round, not the whole schedule again', async () => {
    let bootstraps = 0;
    const session = fakeSession(notRouted, () => {
      bootstraps += 1;
      return Promise.resolve();
    });
    expect(await probeServerFiles(session, RECHECK)).toBe(false);
    expect(bootstraps).toBe(1);
  });

  it('RECHECK still notices a namespace that installed since', async () => {
    let installed = false;
    const session = fakeSession(
      () => (installed ? Promise.resolve({ ok: false, error: 'no path' }) : notRouted()),
      () => {
        installed = true;
        return Promise.resolve();
      },
    );
    expect(await probeServerFiles(session, RECHECK)).toBe(true);
  });
});
