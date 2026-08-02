/**
 * The bootstrap and the wire calls.
 *
 * The bootstrap is the whole reason this feature works without a policy grant
 * or an edit to `server.py`, so it is worth pinning exactly: one silent
 * `cmd.do`, one probe, and never again — plus a retry after a failure, because
 * a reconnect can be a different bridge process.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  SEL_MODE_KEYWORDS,
  SEQ_TEMP_SELE,
  seqSelectExpression,
} from '@tenmol/protocol';
import { BOOTSTRAP_LINE, ENTRY_POINT, createSeqviewSource } from './source';
import { selectionRuns } from './minimap';

interface Recorded {
  fn: string;
  args: readonly unknown[];
}

function harness(behaviour?: (fn: string, args: readonly unknown[]) => unknown) {
  const calls: Recorded[] = [];
  const call = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    calls.push({ fn, args });
    if (behaviour) return behaviour(fn, args);
    if (fn === ENTRY_POINT && args[0] === 'install') return { installed: true };
    return {};
  });
  return { calls, source: createSeqviewSource(call as never) };
}

describe('bootstrap', () => {
  it('installs the panel with one silent cmd.do, then probes it', async () => {
    const { calls, source } = harness();
    await source.rows(0, 1200);

    expect(calls[0]).toEqual({ fn: 'cmd.do', args: [BOOTSTRAP_LINE, 0, 0] });
    // log=0, echo=0: the bootstrap must not appear in the user's console.
    expect(calls[0]?.args.slice(1)).toEqual([0, 0]);
    expect(calls[1]).toEqual({ fn: ENTRY_POINT, args: ['install'] });
    expect(calls[2]).toEqual({ fn: ENTRY_POINT, args: ['rows', -1, 0, 1200] });
  });

  it('runs exactly once across many calls', async () => {
    const { calls, source } = harness();
    await source.rows(0, 10);
    await source.rows(10, 10);
    await source.clear();
    expect(calls.filter((entry) => entry.fn === 'cmd.do')).toHaveLength(1);
  });

  it('fails loudly when cmd.do runs but nothing installs', async () => {
    const { source } = harness((fn, args) =>
      fn === ENTRY_POINT && args[0] === 'install' ? {} : {},
    );
    await expect(source.rows(0, 10)).rejects.toThrow(/did not install/);
  });

  it('is retried after a failure — a reconnect is a new process', async () => {
    let ok = false;
    const { calls, source } = harness((fn, args) => {
      if (fn === ENTRY_POINT && args[0] === 'install') return ok ? { installed: true } : {};
      return {};
    });
    await expect(source.rows(0, 10)).rejects.toThrow();
    ok = true;
    await source.rows(0, 10);
    expect(calls.filter((entry) => entry.fn === 'cmd.do')).toHaveLength(2);
  });

  it('forgets the install on reset()', async () => {
    const { calls, source } = harness();
    await source.rows(0, 10);
    source.reset();
    await source.rows(0, 10);
    expect(calls.filter((entry) => entry.fn === 'cmd.do')).toHaveLength(2);
  });
});

describe('the writes', () => {
  it('sends a single column as its atom list', async () => {
    const { calls, source } = harness();
    await source.select('m', [3, 4, 5], true, false);
    expect(calls.at(-1)).toEqual({
      fn: ENTRY_POINT,
      args: ['select', 'm', [3, 4, 5], 1, 0],
    });
  });

  it('sends a DRAG as two column indices, not thousands of atom ids', async () => {
    const { calls, source } = harness();
    await source.selectRange('m', 12, 900, false, true);
    expect(calls.at(-1)).toEqual({
      fn: ENTRY_POINT,
      args: ['select_range', 'm', 12, 900, 0, 1],
    });
  });

  it('maps ctrl+middle onto zoom', async () => {
    const { calls, source } = harness();
    await source.center('m', [1], true);
    expect(calls.at(-1)?.args).toEqual(['center', 'm', [1], 1]);
  });

  it('sets an object state', async () => {
    const { calls, source } = harness();
    await source.setState('m', 4);
    expect(calls.at(-1)?.args).toEqual(['set_state', 'm', 4]);
  });
});

describe('the selection algebra shipped in the protocol package', () => {
  it('matches SeekerSelectionToggle (`packages/engine/layer3/Seeker.cpp:203-221`)', () => {
    expect(seqSelectExpression('byresi', 'sel01', true, false)).toBe(
      '((byresi(?sel01)) or byresi(_seeker))',
    );
    expect(seqSelectExpression('byresi', 'sel01', false, false)).toBe(
      '((byresi(?sel01)) and not byresi(_seeker))',
    );
    expect(seqSelectExpression('byresi', 'sel01', true, true)).toBe('byresi(_seeker)');
  });

  it('carries the SelModeKW table (`packages/engine/layer1/Scene.cpp:459-467`)', () => {
    expect([...SEL_MODE_KEYWORDS]).toEqual([
      '',
      'byresi',
      'bychain',
      'bysegi',
      'byobject',
      'bymol',
      'bca.',
    ]);
    expect(SEQ_TEMP_SELE).toBe('_seeker');
  });
});

describe('the scrollbar mini-map', () => {
  it('collapses contiguous selected columns into runs (`packages/engine/layer1/Seq.cpp:564-696`)', () => {
    const cells = [
      {},
      { selected: true },
      { selected: true },
      {},
      { selected: true },
      { selected: true },
      { selected: true },
    ];
    expect(selectionRuns(cells)).toEqual([
      { from: 1, length: 2 },
      { from: 4, length: 3 },
    ]);
  });

  it('closes a run that reaches the end of the row', () => {
    expect(selectionRuns([{ selected: true }])).toEqual([{ from: 0, length: 1 }]);
    expect(selectionRuns([{}, {}])).toEqual([]);
  });
});
