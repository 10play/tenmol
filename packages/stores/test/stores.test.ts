/**
 * Unit tests for the rules that are easy to get subtly wrong and impossible to
 * eyeball in a browser: the replay dedupe on reconnect, line classification
 * against the prefixes spike 02 §8 actually observed, the "cloaked" derivation,
 * and the poller's no-overlap guarantee.
 *
 * Node environment, no DOM, no React — that is why `@tenmol/stores` is
 * framework-free.
 */

import { describe, expect, test, vi } from 'vitest';

import {
  buildRows,
  bitmaskFromRepIndices,
  classifyLine,
  createFeedbackStore,
  createObjectsStore,
  createPoller,
  createStore,
  createTopicBinding,
  createUiStore,
  displayName,
  invalidationsOf,
  overlapLength,
  quoteName,
  shallowEqual,
  visibleRows,
  type PanelRow,
  type VisMap,
} from '../src/index';

/* ------------------------------------------------------------------ store */

describe('createStore', () => {
  test('snapshot identity is stable until something actually changes', () => {
    const store = createStore({ a: 1, b: 'x' });
    const first = store.get();
    store.set({ a: 1 });
    expect(store.get()).toBe(first); // no-op patch -> same object, no re-render
    store.set({ a: 2 });
    expect(store.get()).not.toBe(first);
    expect(store.get()).toEqual({ a: 2, b: 'x' });
  });

  test('a listener that unsubscribes during a notification is not called again', () => {
    const store = createStore({ n: 0 });
    const seen: number[] = [];
    const off = store.subscribe((s) => {
      seen.push(s.n);
      off();
    });
    store.set({ n: 1 });
    store.set({ n: 2 });
    expect(seen).toEqual([1]);
    expect(store.listenerCount()).toBe(0);
  });

  test('shallowEqual', () => {
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

/* --------------------------------------------------------------- feedback */

describe('feedback classification', () => {
  // Every string below is copied from spike 02 §8 (`e13.out`) or from this
  // session's own transcript against the running bridge.
  test.each([
    ['PyMOL>fragment ala', 'prompt'],
    [' Executive: object "ala" created.', 'info'],
    [' count_atoms: 10 atoms', 'info'],
    [' Ray: render time: 0.00 sec. = 0.0 frames/hour.', 'info'],
    [' Error: Unknown color.', 'error'],
    [' Selector-Error: Invalid selection name "nope".', 'error'],
    [' ScenePNG-Error: error writing "/nope/x.png".', 'error'],
    ["Error: unknown Setting: 'nonexistent_setting'.", 'error'],
    ['NameError: name "x" is not defined', 'error'],
    ['ZeroDivisionError: division by zero', 'error'],
    ['Traceback (most recent call last):', 'error'],
    [
      ' Setting-Warning: colored_feedback is not supported in Open-Source version of PyMOL',
      'warning',
    ],
  ])('%s -> %s', (line, kind) => {
    expect(classifyLine(line)).toBe(kind);
  });

  test('caret continuation lines stay with the error above them', () => {
    expect(classifyLine('nonexistent_object<--', 'error')).toBe('error');
    // ... but the same shape after an info line is not promoted to an error.
    expect(classifyLine('nonexistent_object<--', 'info')).toBe('info');
  });
});

describe('feedback store', () => {
  test('appends, classifies, sequences and caps', () => {
    const store = createFeedbackStore({ capacity: 3 });
    store.appendServer(['a', 'b']);
    store.appendServer(['PyMOL>fragment ala', ' Error: nope']);
    const { lines, evicted, nextSeq } = store.get();
    expect(lines.map((l) => l.text)).toEqual(['b', 'PyMOL>fragment ala', ' Error: nope']);
    expect(lines.map((l) => l.kind)).toEqual(['info', 'prompt', 'error']);
    expect(lines.map((l) => l.seq)).toEqual([2, 3, 4]);
    expect(evicted).toBe(1);
    expect(nextSeq).toBe(5);
  });

  test('client lines are marked, never inferred', () => {
    const store = createFeedbackStore();
    store.appendClient('show sticks, ala');
    const line = store.get().lines[0];
    expect(line?.origin).toBe('client');
    expect(line?.kind).toBe('client');
    expect(line?.inferred).toBe(false);
  });

  test('THE RECONNECT CASE: a replayed ring appends only what is new', () => {
    let clock = 1000;
    const store = createFeedbackStore({ now: () => clock });

    // First connect: the bridge replays its whole ring.
    store.beginReplayWindow(1000);
    store.appendServer([
      ' Detected OpenGL version 2.1. Shaders available.',
      ' Detected GLSL version 1.20.',
    ]);
    // Live output while we are connected.
    clock += 2000;
    store.appendServer(['PyMOL>fragment ala', ' Executive: object "ala" created.']);

    // Socket drops; PyMOL keeps talking; we reconnect and re-subscribe.
    store.beginReplayWindow(1000);
    store.appendServer([
      ' Detected OpenGL version 2.1. Shaders available.',
      ' Detected GLSL version 1.20.',
      'PyMOL>fragment ala',
      ' Executive: object "ala" created.',
      'PyMOL>count_atoms ala', // said while we were away
      ' count_atoms: 10 atoms',
    ]);

    expect(store.get().lines.map((l) => l.text)).toEqual([
      ' Detected OpenGL version 2.1. Shaders available.',
      ' Detected GLSL version 1.20.',
      'PyMOL>fragment ala',
      ' Executive: object "ala" created.',
      'PyMOL>count_atoms ala',
      ' count_atoms: 10 atoms',
    ]);
    expect(store.get().deduped).toBe(4);
  });

  test('outside the replay window an identical batch is NOT deduplicated', () => {
    let clock = 1000;
    const store = createFeedbackStore({ now: () => clock });
    store.appendServer(['PyMOL>fragment ala']);
    clock += 10_000;
    store.appendServer(['PyMOL>fragment ala']); // the user really did type it twice
    expect(store.get().lines).toHaveLength(2);
    expect(store.get().deduped).toBe(0);
  });

  test('overlapLength ignores client-origin lines when matching', () => {
    const store = createFeedbackStore();
    store.appendServer(['a', 'b']);
    store.appendClient('-- reconnected --');
    expect(overlapLength(store.get().lines, ['a', 'b', 'c'])).toBe(2);
  });
});

/* ---------------------------------------------------------------- objects */

describe('object rows', () => {
  // Verbatim from this session's transcript against the running bridge.
  const vis: VisMap = {
    all: [1, [], null, null],
    ala: [1, [], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17, 18, 19, 20], 26],
    mysel: [0, [], null, null],
    gly: [1, [], [0, 1], 5],
  };
  const types = new Map([
    ['ala', 'object:molecule'],
    ['mysel', 'selection'],
    ['gly', 'object:molecule'],
  ]);

  test('builds the synthetic "all" row plus one row per name, in panel order', () => {
    const rows = buildRows({ names: ['ala', 'mysel', 'gly'], vis, types });
    expect(rows.map((r) => r.name)).toEqual(['all', 'ala', 'mysel', 'gly']);
    expect(rows[0]?.isAll).toBe(true);
    expect(rows[2]?.type).toBe('selection');
    expect(rows[2]?.enabled).toBe(false);
    expect(rows[3]?.color).toBe(5);
    expect(displayName(rows[2] as PanelRow)).toBe('(mysel)');
  });

  test('rep index list -> bitmask', () => {
    expect(bitmaskFromRepIndices(null)).toBe(0);
    expect(bitmaskFromRepIndices([0, 1])).toBe(0b11);
    expect(bitmaskFromRepIndices([4])).toBe(16);
  });

  test('"cloaked" = enabled under a disabled group (Executive.cpp:16392-16406)', () => {
    const rows = buildRows({
      names: ['grp', 'grp.a', 'grp.b'],
      vis: {
        all: [1, [], null, null],
        grp: [0, [], null, null],
        'grp.a': [1, [], [0], 5],
        'grp.b': [0, [], [0], 5],
      },
      types: new Map([
        ['grp', 'object:group'],
        ['grp.a', 'object:molecule'],
        ['grp.b', 'object:molecule'],
      ]),
    });
    const a = rows.find((r) => r.name === 'grp.a');
    const b = rows.find((r) => r.name === 'grp.b');
    expect(a?.cloaked).toBe(true);
    expect(b?.cloaked).toBe(false); // not enabled at all -> plain disabled
    expect(a?.group).toBe('grp');
    expect(a?.nest).toBe(1);
    expect(a?.nestInferred).toBe(true);
    expect(displayName(a as PanelRow)).toBe('a');
    expect(visibleRows(rows, ['grp']).map((r) => r.name)).toEqual(['all', 'grp']);
  });

  test('a poll that finds nothing new keeps the array identity (no re-render)', () => {
    const store = createObjectsStore();
    store.applyRows(buildRows({ names: ['ala'], vis, types }), 'poll');
    const first = store.get().rows;
    const generation = store.get().generation;
    store.applyRows(buildRows({ names: ['ala'], vis, types }), 'poll');
    expect(store.get().rows).toBe(first);
    expect(store.get().generation).toBe(generation);
    store.applyRows(buildRows({ names: ['ala', 'gly'], vis, types }), 'poll');
    expect(store.get().rows).not.toBe(first);
    expect(store.get().generation).toBe(generation + 1);
  });

  test('quoteName quotes anything that is not a bare identifier', () => {
    expect(quoteName('ala')).toBe('ala');
    expect(quoteName('grp.a')).toBe('grp.a');
    expect(quoteName('my sel')).toBe('"my sel"');
    expect(quoteName('')).toBe('""');
  });
});

/* ----------------------------------------------------------------- poller */

describe('poller', () => {
  test('never overlaps and honours a kick issued mid-pass', async () => {
    let running = 0;
    let maxConcurrent = 0;
    let resolveFirst: (() => void) | undefined;

    const poller = createPoller({
      focusedHz: 1000,
      run: async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        if (!resolveFirst) {
          await new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
        running -= 1;
      },
    });

    poller.start();
    await tick(5);
    poller.kick(); // arrives while pass 1 is still awaiting
    resolveFirst?.();
    await tick(20);
    poller.stop();

    expect(maxConcurrent).toBe(1);
    expect(poller.stats().passes).toBeGreaterThan(1);
  });

  test('an error in a pass does not stop the loop', async () => {
    const errors: unknown[] = [];
    let passes = 0;
    const poller = createPoller({
      focusedHz: 500,
      run: async () => {
        passes += 1;
        throw new Error('boom');
      },
      onError: (e) => errors.push(e),
    });
    poller.start();
    await tick(20);
    poller.stop();
    expect(passes).toBeGreaterThan(1);
    expect(errors.length).toBe(passes);
  });

  test('does not call run while disabled', async () => {
    let passes = 0;
    const poller = createPoller({
      focusedHz: 500,
      isEnabled: () => false,
      run: async () => {
        passes += 1;
      },
    });
    poller.start();
    await tick(20);
    poller.stop();
    expect(passes).toBe(0);
  });
});

/* -------------------------------------------------------- topic binding */

describe('topic binding', () => {
  test('detects a sequence gap and reports seq availability honestly', () => {
    const applied: number[] = [];
    const gaps: unknown[] = [];
    const binding = createTopicBinding<number>({
      topic: 'objects',
      apply: (p) => applied.push(p),
      onGap: (g) => gaps.push(g),
    });

    binding.receive(1); // no seq: the client drops it today
    expect(binding.seqAvailable).toBe(false);
    expect(gaps).toHaveLength(0);

    binding.receive(2, 1);
    binding.receive(3, 2);
    binding.receive(4, 7); // gap
    expect(binding.seqAvailable).toBe(true);
    expect(gaps).toEqual([{ topic: 'objects', expected: 3, received: 7 }]);
    expect(applied).toEqual([1, 2, 3, 4]);

    binding.reset();
    expect(binding.lastSeq).toBe(0);
  });

  test('invalidationsOf accepts the bridge field AND the protocol field', () => {
    expect(invalidationsOf({ t: 'ok', invalidates: ['reps'] })).toEqual(['reps']);
    expect(invalidationsOf({ t: 'ok', inval: ['color', 'names'] })).toEqual(['color', 'names']);
    expect(invalidationsOf({ t: 'ok' })).toEqual([]);
    expect(invalidationsOf(null)).toEqual([]);
  });
});

/* --------------------------------------------------------------------- ui */

describe('ui store', () => {
  test('persists through a StorageLike and survives corrupt data', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
    };
    vi.useFakeTimers();
    const store = createUiStore(storage);
    store.set({ panelWidth: 300 });
    vi.advanceTimersByTime(500);
    vi.useRealTimers();
    expect([...backing.values()][0]).toContain('300');

    const reloaded = createUiStore(storage);
    expect(reloaded.get().panelWidth).toBe(300);

    backing.set('tenmol.ui.v1', '{{{not json');
    expect(createUiStore(storage).get().panelWidth).toBe(220);
  });

  test('works with storage unavailable', () => {
    const store = createUiStore(null);
    store.set({ panelWidth: 111 });
    expect(store.get().panelWidth).toBe(111);
  });
});

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
