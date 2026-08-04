/**
 * Defect **D1**, client side: the Mode-G geometry cache and its lifecycle.
 *
 * The bridge half is proved in `packages/bridge/tests/test_modeg.py` against a real
 * PyMOL. This file proves the other half without a browser: that a version
 * table turns into the right DROPs and REFETCHes, that a drop really disposes
 * (via `renderer.apply` on a tombstone), and — the requirement that is easiest
 * to break — that an idle table produces nothing at all, hundreds of times over.
 */

import { describe, expect, it, vi } from 'vitest';

import { Rep, type GeometryFrame } from '@tenmol/protocol';

import {
  createGeometryCache,
  parseVersionTable,
  resolvedKey,
  tombstoneFrame,
  type VersionTable,
} from './cache';
import { buildGeometry, isEmptyGeometryFrame } from './frames';
import { createInvalidationPoller } from './invalidation';
import { createStreamGeometrySource } from './sources';
import type { GeometrySink } from '../types';

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

type Row = [string, number, number, number, number];

function statsPayload(rows: Row[], epoch = 1, exact = true): unknown {
  return {
    modeG: {
      versions: {
        exact,
        epoch,
        rowFormat: ['object', 'state', 'rep', 'version', 'active'],
        reps: rows,
      },
    },
  };
}

function table(rows: Row[], epoch = 1): VersionTable {
  const parsed = parseVersionTable(statsPayload(rows, epoch));
  if (parsed === null) throw new Error('unparseable');
  return parsed;
}

/** A transport that records calls and answers with scripted pull results. */
function fakeTransport(answers: Record<string, unknown>, rows: () => Row[]) {
  const calls: { fn: string; args: readonly unknown[]; kwargs: Record<string, unknown> }[] = [];
  let epoch = 1;
  return {
    calls,
    bumpEpoch(): void {
      epoch++;
    },
    input(): void {},
    call(fn: string, args: readonly unknown[] = [], kwargs: Record<string, unknown> = {}) {
      calls.push({ fn, args, kwargs });
      if (fn === '_bridge.render_stats') return Promise.resolve(statsPayload(rows(), epoch));
      const rep = String(args[1] ?? '');
      return Promise.resolve(answers[rep] ?? { status: 'ok', state: 0, hash: 'h', bytes: 10 });
    },
    isConnected: () => true,
  };
}

function recordingSink() {
  const frames: GeometryFrame[] = [];
  const unavailable: { rep: number; reason: string }[] = [];
  const sink: GeometrySink = {
    frame: (frame) => frames.push(frame),
    unavailable: (key, reason) => unavailable.push({ rep: key.rep, reason }),
    error: () => {},
  };
  return { sink, frames, unavailable };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 * parsing
 * ------------------------------------------------------------------ */

describe('parseVersionTable', () => {
  it('reads the compact row form the bridge emits', () => {
    const parsed = parseVersionTable(statsPayload([['u', 0, Rep.Cartoon, 3, 1]], 7));
    expect(parsed).not.toBeNull();
    expect(parsed?.epoch).toBe(7);
    expect(parsed?.exact).toBe(true);
    const row = parsed?.rows.get(resolvedKey({ object: 'u', state: 0, rep: Rep.Cartoon }));
    expect(row).toEqual({ object: 'u', state: 0, rep: Rep.Cartoon, version: 3, active: true });
  });

  it('refuses a table whose rowFormat it does not recognise', () => {
    // A bridge that reorders or extends the columns must NOT be half-read:
    // acting on a misread table drops live geometry.
    expect(
      parseVersionTable({
        modeG: {
          versions: { rowFormat: ['object', 'rep', 'state', 'version', 'active'], reps: [] },
        },
      }),
    ).toBeNull();
    expect(parseVersionTable({ modeG: { versions: { reps: [] } } })).toBeNull();
    expect(parseVersionTable({ modeP: {} })).toBeNull();
    expect(parseVersionTable(null)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * the plan
 * ------------------------------------------------------------------ */

describe('geometry cache plan', () => {
  it('drops a rep the bridge says is no longer active', () => {
    const cache = createGeometryCache();
    const entry = cache.track('u', Rep.Cartoon);
    cache.answered(entry, { status: 'ok', state: 0, hash: 'a', bytes: 100 });

    const plan = cache.plan(table([['u', 0, Rep.Cartoon, 2, 0]]));
    expect(plan.refetch).toHaveLength(0);
    expect(plan.drop).toEqual([{ object: 'u', state: 0, rep: Rep.Cartoon }]);
  });

  it('refetches a rep that became active after we were told not-built', () => {
    // `hide everything; show sticks`: the client asked for sticks while they
    // were hidden and got `not-built`; nothing ever asked again before D1.
    const cache = createGeometryCache();
    const entry = cache.track('u', Rep.Cyl);
    cache.answered(entry, { status: 'not-built', state: 0 });
    entry.resolvedState = null;

    expect(cache.plan(table([])).refetch).toHaveLength(0);
    const plan = cache.plan(table([['u', 0, Rep.Cyl, 1, 1]]));
    expect(plan.refetch.map((e) => e.rep)).toEqual([Rep.Cyl]);
  });

  it('refetches on a version bump and NOT on an unchanged version', () => {
    const cache = createGeometryCache();
    const entry = cache.track('u', Rep.Cyl);
    const first = table([['u', 0, Rep.Cyl, 4, 1]]);
    cache.issued(entry, first);
    cache.answered(entry, { status: 'ok', state: 0, hash: 'a', bytes: 8 });

    expect(cache.plan(first).refetch).toHaveLength(0);
    expect(cache.plan(table([['u', 0, Rep.Cyl, 5, 1]])).refetch).toHaveLength(1);
  });

  it('drops every key of an object that left the table', () => {
    const cache = createGeometryCache();
    for (const rep of [Rep.Cartoon, Rep.Sphere]) {
      const entry = cache.track('u', rep);
      cache.answered(entry, { status: 'ok', state: 0, hash: 'a', bytes: 4 });
    }
    const plan = cache.plan(table([]));
    expect(plan.drop.map((k) => k.rep).sort()).toEqual([Rep.Cartoon, Rep.Sphere].sort());
  });

  it('forgets the content hash on a drop', () => {
    // Otherwise re-showing the rep is answered `unchanged` against buffers that
    // were disposed, and it is never drawn again.
    const cache = createGeometryCache();
    const entry = cache.track('u', Rep.Cartoon);
    cache.answered(entry, { status: 'ok', state: 0, hash: 'deadbeef', bytes: 100 });
    expect(entry.hash).toBe('deadbeef');
    cache.dropped({ object: 'u', state: 0, rep: Rep.Cartoon });
    expect(entry.hash).toBeNull();
    expect(entry.drawn).toBe(false);
    expect(entry.bytes).toBe(0);
  });

  it('produces nothing at all for 500 identical tables', () => {
    const cache = createGeometryCache();
    const entry = cache.track('u', Rep.Cartoon);
    const idle = table([['u', 0, Rep.Cartoon, 1, 1]]);
    cache.issued(entry, idle);
    cache.answered(entry, { status: 'ok', state: 0, hash: 'a', bytes: 100 });

    let asked = 0;
    for (let i = 0; i < 500; i++) {
      const plan = cache.plan(idle);
      asked += plan.refetch.length + plan.drop.length;
    }
    expect(asked).toBe(0);
    expect(cache.stats.quietPlans).toBe(500);
  });

  it('never plans anything for a pull that is still in flight', () => {
    const cache = createGeometryCache();
    const entry = cache.track('u', Rep.Cartoon);
    cache.issued(entry, table([['u', 0, Rep.Cartoon, 1, 1]]));
    expect(entry.pending).toBe(true);
    expect(cache.plan(table([['u', 0, Rep.Cartoon, 9, 1]])).refetch).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * tombstones
 * ------------------------------------------------------------------ */

describe('tombstones', () => {
  it('are valid, empty geometry frames', () => {
    const frame = tombstoneFrame({ object: 'u', state: 0, rep: Rep.Cartoon }, 3);
    expect(isEmptyGeometryFrame(frame.header)).toBe(true);
    // A client that has never heard of a tombstone builds an empty group and
    // reports ZERO problems, so it degrades to "draws nothing" and never to
    // "falls back to Mode P with an error".
    const built = buildGeometry(frame);
    expect(built.problems).toEqual([]);
    expect(built.stats.drawCalls).toBe(0);
    built.dispose();
  });

  it('are distinguished from a frame that really has geometry', () => {
    expect(
      isEmptyGeometryFrame({
        v: 1,
        kind: 'cgo-draw-arrays',
        seq: 1,
        payloadBytes: 48,
        object: 'u',
        state: 0,
        rep: Rep.Cyl,
        blocks: [],
        instances: [
          {
            kind: 'sphere',
            count: 1,
            itemSize: 8,
            data: { byteOffset: 0, byteLength: 32, dtype: 'f32', itemSize: 8 },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isEmptyGeometryFrame({
        v: 1,
        kind: 'indexed-mesh',
        seq: 1,
        payloadBytes: 0,
        object: 'u',
        state: 0,
        rep: Rep.Surface,
        counts: { verts: 0, tris: 0 },
        buffers: { position: { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 3 } },
        proximity: false,
        oneColor: null,
      }),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * the poller
 * ------------------------------------------------------------------ */

describe('invalidation poller', () => {
  it('calls back only when the epoch moves', async () => {
    let epoch = 1;
    const seen: number[] = [];
    const poller = createInvalidationPoller({
      transport: {
        call: () => Promise.resolve(statsPayload([['u', 0, Rep.Cartoon, 1, 1]], epoch)),
        isConnected: () => true,
      },
      onTable: (t) => seen.push(t.epoch),
      intervalMs: 10_000,
    });

    await poller.poll();
    await poller.poll();
    await poller.poll();
    expect(seen).toEqual([1]);

    epoch = 2;
    await poller.poll();
    expect(seen).toEqual([1, 2]);
    expect(poller.stats.polls).toBe(4);
    expect(poller.stats.epochChanges).toBe(2);
    poller.stop();
  });

  it('reports exact:false and changes nothing for a table it cannot read', async () => {
    const onTable = vi.fn();
    const poller = createInvalidationPoller({
      transport: { call: () => Promise.resolve({ modeG: {} }) },
      onTable,
      intervalMs: 10_000,
    });
    await poller.poll();
    expect(onTable).not.toHaveBeenCalled();
    expect(poller.stats.exact).toBe(false);
    poller.stop();
  });

  it('survives a rejected call without wedging', async () => {
    const poller = createInvalidationPoller({
      transport: { call: () => Promise.reject(new Error('socket closed')) },
      onTable: () => {},
      intervalMs: 10_000,
    });
    await poller.poll();
    await poller.poll();
    expect(poller.stats.errors).toBe(2);
    poller.stop();
  });
});

/* ------------------------------------------------------------------ *
 * the whole source: the D1 reproduction, without a browser
 * ------------------------------------------------------------------ */

describe('stream geometry source lifecycle', () => {
  it('THE DEFECT: with the lifecycle off, the cartoon stays and sticks never arrive', async () => {
    // `invalidate: false` is wave-1 behaviour exactly: subscribe to binary
    // frames, fire a pull, forget. This test exists so the fix cannot be
    // deleted without something going red.
    let rows: Row[] = [['u', 0, Rep.Cartoon, 1, 1]];
    const answers: Record<string, unknown> = {
      cartoon: { status: 'ok', state: 0, hash: 'c1', bytes: 100 },
      sticks: { status: 'not-built', state: 0 },
    };
    const transport = fakeTransport(answers, () => rows);
    const { sink, frames } = recordingSink();
    const source = createStreamGeometrySource({ transport, pollMs: 10_000, invalidate: false });
    source.start(sink);
    source.request('u', Rep.Cartoon, -1);
    source.request('u', Rep.Cyl, -1);
    await flush();

    rows = [
      ['u', 0, Rep.Cartoon, 2, 0],
      ['u', 0, Rep.Cyl, 1, 1],
    ];
    answers['sticks'] = { status: 'ok', state: 0, hash: 's1', bytes: 200 };
    await sleep(30);

    // No tombstone: the renderer still holds the cartoon's buffers.
    expect(frames.filter((f) => isEmptyGeometryFrame(f.header))).toHaveLength(0);
    expect(source.cache.get('u', Rep.Cartoon)?.drawn).toBe(true);
    // And sticks were never asked for again.
    expect(
      transport.calls.filter((c) => c.fn === '_bridge.pull_geometry').map((c) => c.args[1]),
    ).toEqual(['cartoon', 'sticks']);
    expect(source.poller.running).toBe(false);
    source.stop();
  });

  it('hide everything -> the cartoon is tombstoned; show sticks -> sticks are pulled', async () => {
    let rows: Row[] = [['u', 0, Rep.Cartoon, 1, 1]];
    const answers: Record<string, unknown> = {
      cartoon: { status: 'ok', state: 0, hash: 'c1', bytes: 100 },
      sticks: { status: 'not-built', state: 0 },
    };
    const transport = fakeTransport(answers, () => rows);
    const { sink, frames } = recordingSink();
    const source = createStreamGeometrySource({ transport, pollMs: 10_000 });
    source.start(sink);

    source.request('u', Rep.Cartoon, -1);
    source.request('u', Rep.Cyl, -1);
    // Two settling rounds. The first request also STARTS the poller, and the
    // first table it sees was captured before the answer landed, so each key
    // costs exactly one conservative re-pull at startup — see `issued()` in
    // ./cache.ts. It is answered `unchanged` with no payload and never repeats;
    // the idle test below is what proves "never repeats".
    await flush();
    await source.refresh();
    await flush();
    expect(source.cache.get('u', Rep.Cartoon)?.drawn).toBe(true);
    expect(source.cache.get('u', Rep.Cyl)?.drawn).toBe(false);
    expect(frames).toHaveLength(0); // real frames arrive over the binary channel
    const settled = transport.calls.filter((c) => c.fn === '_bridge.pull_geometry').length;

    // `hide everything; show sticks`
    rows = [
      ['u', 0, Rep.Cartoon, 2, 0],
      ['u', 0, Rep.Cyl, 1, 1],
    ];
    answers['sticks'] = { status: 'ok', state: 0, hash: 's1', bytes: 200 };
    transport.bumpEpoch();
    await source.refresh();
    await flush();

    const tombstones = frames.filter((f) => isEmptyGeometryFrame(f.header));
    expect(tombstones.map((f) => f.header.rep)).toEqual([Rep.Cartoon]);
    expect(tombstones[0]?.header.state).toBe(0);
    expect(source.cache.get('u', Rep.Cartoon)?.drawn).toBe(false);
    expect(source.cache.get('u', Rep.Cyl)?.drawn).toBe(true);

    // Exactly one new pull, and it is for sticks: the hidden cartoon is
    // dropped, never re-pulled.
    const pulls = transport.calls.filter((c) => c.fn === '_bridge.pull_geometry');
    expect(pulls.slice(settled).map((c) => c.args[1])).toEqual(['sticks']);
    source.stop();
  });

  it('tombstones a rep the bridge answers not-built, and does not degrade it', async () => {
    const transport = fakeTransport(
      { cartoon: { status: 'ok', state: 0, hash: 'c1', bytes: 100 } },
      () => [['u', 0, Rep.Cartoon, 1, 1]],
    );
    const { sink, frames, unavailable } = recordingSink();
    const source = createStreamGeometrySource({ transport, pollMs: 10_000 });
    source.start(sink);
    source.request('u', Rep.Cartoon, -1);
    await flush();

    (transport as unknown as { call: unknown }).call = (
      fn: string,
      args: readonly unknown[] = [],
    ) =>
      fn === '_bridge.pull_geometry'
        ? Promise.resolve({ status: 'not-built', state: 0, object: args[0] })
        : Promise.resolve(statsPayload([], 9));
    source.request('u', Rep.Cartoon, -1);
    await flush();

    expect(frames.filter((f) => isEmptyGeometryFrame(f.header))).toHaveLength(1);
    // `not-built` means "hidden", not "Mode G cannot do this": degrading here
    // would silently move the rep back to the pixel stream forever.
    expect(unavailable).toHaveLength(0);
    source.stop();
  });

  it('falls back with a reason when the rep is genuinely unsupported', async () => {
    const transport = fakeTransport(
      { labels: { status: 'unsupported', fallbackReason: 'unsupported-rep', state: 0 } },
      () => [],
    );
    const { sink, unavailable } = recordingSink();
    const source = createStreamGeometrySource({ transport, pollMs: 10_000 });
    source.start(sink);
    source.request('u', Rep.Label, -1);
    await flush();
    expect(unavailable).toEqual([{ rep: Rep.Label, reason: 'unsupported-rep' }]);
    source.stop();
  });

  it('an idle scene produces zero pulls over 400 polls', async () => {
    const transport = fakeTransport(
      { cartoon: { status: 'ok', state: 0, hash: 'c1', bytes: 100 } },
      () => [['u', 0, Rep.Cartoon, 1, 1]],
    );
    const { sink } = recordingSink();
    const source = createStreamGeometrySource({ transport, pollMs: 10_000 });
    source.start(sink);
    source.request('u', Rep.Cartoon, -1);
    await flush();

    await source.refresh(); // the one startup reconciliation
    await flush();

    const before = transport.calls.filter((c) => c.fn === '_bridge.pull_geometry').length;
    for (let i = 0; i < 400; i++) await source.refresh();
    const after = transport.calls.filter((c) => c.fn === '_bridge.pull_geometry').length;

    expect(after - before).toBe(0);
    expect(source.poller.stats.polls).toBeGreaterThanOrEqual(400);
    expect(source.poller.stats.epochChanges).toBe(1);
    source.stop();
  });

  it('sends the content hash so a conservative refetch costs no bytes', async () => {
    let rows: Row[] = [['u', 0, Rep.Cartoon, 1, 1]];
    const transport = fakeTransport(
      { cartoon: { status: 'ok', state: 0, hash: 'c1', bytes: 100 } },
      () => rows,
    );
    const { sink } = recordingSink();
    const source = createStreamGeometrySource({ transport, pollMs: 10_000 });
    source.start(sink);
    source.request('u', Rep.Cartoon, -1);
    await flush();
    await source.refresh();
    await flush();

    rows = [['u', 0, Rep.Cartoon, 2, 1]];
    transport.bumpEpoch();
    await source.refresh();
    await flush();

    const pulls = transport.calls.filter((c) => c.fn === '_bridge.pull_geometry');
    // The first pull has nothing to compare against; every later one carries
    // the hash, so a conservative re-pull is answered `unchanged` with no
    // payload at all.
    expect(pulls.length).toBeGreaterThanOrEqual(2);
    expect(pulls[0]?.kwargs).toEqual({});
    expect(pulls.slice(1).every((c) => c.kwargs['have'] === 'c1')).toBe(true);
    source.stop();
  });
});

/* ------------------------------------------------------------------ *
 * discovery: where the object list comes from
 * ------------------------------------------------------------------ */

describe('version-table discovery', () => {
  it('THE DEFECT: without discovery a measurement object is never pulled', () => {
    // A `distance` object is a measurement object whose ONLY rep is `dashes`.
    // It never appears in a viewport that builds its pull list from
    // (app object list x reps with a mode toggle), which is what the client
    // did before `cache.discover`.
    const cache = createGeometryCache();
    cache.track('u', Rep.Dash, -1);
    const plan = cache.plan(
      table([
        ['u', 0, Rep.Dash, 1, 1],
        ['dd', 0, Rep.Dash, 1, 1],
      ]),
    );
    expect(plan.refetch.map((e) => e.object)).toEqual(['u']);
  });

  it('adopts every active row for a rep this viewport already draws', () => {
    const cache = createGeometryCache();
    cache.track('u', Rep.Dash, -1);
    const added = cache.discover(
      table([
        ['u', 0, Rep.Dash, 1, 1],
        ['dd', 0, Rep.Dash, 1, 1],
        ['aa', 0, Rep.Angle, 1, 1],
        ['hh', 0, Rep.Dihedral, 1, 1],
      ]),
      (rep) => rep === Rep.Dash,
    );
    expect(added.map((e) => `${e.object}/${String(e.rep)}`)).toEqual(['dd/10']);
    expect(cache.stats.discovered).toBe(1);
    // Tracked at -1, like every other entry, so a state change does not fork
    // the key.
    expect(cache.get('dd', Rep.Dash)?.requestedState).toBe(-1);
    expect(cache.get('aa', Rep.Angle)).toBeUndefined();
  });

  it('never adopts an inactive row, and never adopts twice', () => {
    const cache = createGeometryCache();
    const rows = table([
      ['dd', 0, Rep.Dash, 1, 0],
      ['ee', 0, Rep.Dash, 1, 1],
    ]);
    expect(cache.discover(rows, () => true).map((e) => e.object)).toEqual(['ee']);
    expect(cache.discover(rows, () => true)).toEqual([]);
    expect(cache.stats.discovered).toBe(1);
  });

  it('pulls dashes/angles/dihedrals for objects nobody asked about', async () => {
    // The end-to-end shape of the fix: the viewport asks for the three
    // measurement reps on the ONE object it knows (`u`, which has none of
    // them); PyMOL's table names the three measurement objects; the source
    // pulls all three without another `request()`.
    const rows: Row[] = [
      ['u', 0, Rep.Cartoon, 1, 1],
      ['dd', 0, Rep.Dash, 1, 1],
      ['aa', 0, Rep.Angle, 1, 1],
      ['hh', 0, Rep.Dihedral, 1, 1],
    ];
    const transport = fakeTransport({ cartoon: { status: 'not-built', state: 0 } }, () => rows);
    const { sink } = recordingSink();
    const discovered: string[] = [];
    const source = createStreamGeometrySource({
      transport,
      pollMs: 10_000,
      onLifecycle: (action, key) => {
        if (action === 'discover') discovered.push(`${key.object}/${String(key.rep)}`);
      },
    });
    source.start(sink);
    source.request('u', Rep.Dash, -1);
    source.request('u', Rep.Angle, -1);
    source.request('u', Rep.Dihedral, -1);
    await flush();
    await source.refresh();
    await flush();

    expect(discovered.sort()).toEqual(['aa/17', 'dd/10', 'hh/18']);
    const pulled = new Set(
      transport.calls
        .filter((c) => c.fn === '_bridge.pull_geometry')
        .map((c) => `${String(c.args[0])}/${String(c.args[1])}`),
    );
    expect(pulled.has('dd/dashes')).toBe(true);
    expect(pulled.has('aa/angles')).toBe(true);
    expect(pulled.has('hh/dihedrals')).toBe(true);
    // Cartoon was never requested, so it is never discovered either: the gate
    // is "a rep this viewport draws", not "everything in the scene".
    expect(pulled.has('u/cartoon')).toBe(false);
    source.stop();
  });

  it('discover:false keeps the wave-2 behaviour', async () => {
    const rows: Row[] = [
      ['u', 0, Rep.Dash, 1, 1],
      ['dd', 0, Rep.Dash, 1, 1],
    ];
    const transport = fakeTransport({}, () => rows);
    const { sink } = recordingSink();
    const source = createStreamGeometrySource({ transport, pollMs: 10_000, discover: false });
    source.start(sink);
    source.request('u', Rep.Dash, -1);
    await flush();
    await source.refresh();
    await flush();
    expect(
      transport.calls.filter((c) => c.fn === '_bridge.pull_geometry').map((c) => c.args[0]),
    ).not.toContain('dd');
    expect(source.cache.stats.discovered).toBe(0);
    source.stop();
  });
});
