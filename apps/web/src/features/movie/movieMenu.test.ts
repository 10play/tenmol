/**
 * The Movie menu tree, checked against the enumeration in
 * `00-parity-inventory.md` §7 and against `packages/engine/modules/pymol/_gui.py:234-375`.
 *
 * The inventory states the counts explicitly — "Append (14 durations),
 * Program > Camera Loop (Nutate 10 entries, X-Rock/Y-Rock 15 each, X-Roll/
 * Y-Roll 4 each), Scene Loop (Nutate/X-Rock/Y-Rock x 12 entries each + Steady
 * 7), State Loop and State Sweep (6 speeds x 4 pauses each) ... Frame Rate
 * (5 radios ... ) and 8 checkboxes" — so this test is a literal transcription
 * of that row. If the port drifts, this is what says so.
 */

import { describe, expect, it } from 'vitest';
import { countLeaves, flattenMenu, MOVIE_MENU, type MovieMenuNode } from './movieMenu';

function submenu(nodes: readonly MovieMenuNode[], ...path: string[]): readonly MovieMenuNode[] {
  let current = nodes;
  for (const label of path) {
    const found = current.find(
      (node): node is Extract<MovieMenuNode, { kind: 'menu' }> =>
        node.kind === 'menu' && node.label === label,
    );
    if (!found) throw new Error(`no submenu ${path.join(' > ')} (missing ${label})`);
    current = found.items;
  }
  return current;
}

describe('Movie menu shape', () => {
  it('Append has the 14 durations of _gui.py:235-238', () => {
    const items = submenu(MOVIE_MENU, 'Append');
    expect(countLeaves(items)).toBe(14);
    expect(items[0]).toEqual({
      kind: 'call',
      label: '0.25 second',
      fn: 'movie.add_blank',
      args: [0.25],
    });
    expect(items[13]).toMatchObject({ label: '60 second', args: [60] });
  });

  it('Camera Loop: Nutate 11, X/Y-Rock 15 each, X/Y-Roll 4 each', () => {
    const loop = submenu(MOVIE_MENU, 'Program', 'Camera Loop');
    // INVENTORY CORRECTION: §7 says "Nutate 10 entries". `_gui.py:242-255` has
    // ELEVEN — 15 deg. over 4/8/12 (3), 30 deg. over 4/8/12/16 (4) and 60 deg.
    // over 8/16/24/32 (4). Counted in the source, not in the inventory.
    expect(countLeaves(submenu(loop, 'Nutate'))).toBe(11);
    expect(countLeaves(submenu(loop, 'X-Rock'))).toBe(15);
    expect(countLeaves(submenu(loop, 'Y-Rock'))).toBe(15);
    expect(countLeaves(submenu(loop, 'X-Roll'))).toBe(4);
    expect(countLeaves(submenu(loop, 'Y-Roll'))).toBe(4);
  });

  it('keeps the literal 179.99 that stands in for 180 degrees', () => {
    const xrock = submenu(MOVIE_MENU, 'Program', 'Camera Loop', 'X-Rock');
    const last = flattenMenu(xrock).at(-1);
    expect(last?.node).toEqual({
      kind: 'program',
      label: '180 deg. over 48 sec.',
      template: "movie.add_rock(48,179.99,axis='x',start=%d)",
    });
  });

  it('Scene Loop: three 12-entry rock modes plus Steady 7', () => {
    const sceneLoop = submenu(MOVIE_MENU, 'Program', 'Scene Loop');
    for (const label of ['Nutate', 'X-Rock', 'Y-Rock']) {
      expect(countLeaves(submenu(sceneLoop, label))).toBe(12);
    }
    expect(countLeaves(submenu(sceneLoop, 'Steady'))).toBe(7);
    // rock=4 / 2 / 1 for Nutate / X-Rock / Y-Rock (_gui.py:331-335).
    const nutate = flattenMenu(submenu(sceneLoop, 'Nutate'))[0]?.node;
    expect(nutate).toMatchObject({
      template: 'set sweep_angle,30;cmd.movie.add_scenes(None, 2, rock=4, start=%d)',
    });
  });

  it('State Loop and State Sweep are 6 speeds x 4 pauses', () => {
    for (const [label, fn] of [
      ['State Loop', 'movie.add_state_loop'],
      ['State Sweep', 'movie.add_state_sweep'],
    ] as const) {
      const node = submenu(MOVIE_MENU, 'Program', label);
      expect(countLeaves(node)).toBe(24);
      expect(submenu(node, 'Full Speed').length).toBe(4);
      expect(flattenMenu(submenu(node, '1/16 Speed')).at(-1)?.node).toMatchObject({
        label: '4 second pause',
        template: `${fn}(16, 4, start=%d)`,
      });
    }
  });

  it('Frame Rate has 5 radios on movie_fps plus the meter', () => {
    const rate = submenu(MOVIE_MENU, 'Frame Rate');
    const radios = flattenMenu(rate).filter((entry) => entry.node.kind === 'radio');
    expect(radios.map((entry) => (entry.node as { value: number }).value)).toEqual([
      30, 15, 5, 1, 0.3,
    ]);
    expect(radios.every((entry) => (entry.node as { setting: string }).setting === 'movie_fps')).toBe(
      true,
    );
    expect(flattenMenu(rate).some((entry) => entry.node.label === 'Reset Meter')).toBe(true);
  });

  it('has exactly the 8 checkboxes the inventory lists', () => {
    const checks = flattenMenu(MOVIE_MENU)
      .filter((entry) => entry.node.kind === 'check')
      .map((entry) => entry.node.label);
    expect(checks).toEqual([
      'Show Frame Rate',
      'Auto Interpolate',
      'Show Panel',
      'Loop Frames',
      'Draw Frames',
      'Ray Trace Frames',
      'Cache Frame Images',
      'Static Singletons',
      'Show All States',
    ]);
    // Eight top-level checkboxes; "Show Frame Rate" lives inside Frame Rate.
    expect(checks.filter((label) => label !== 'Show Frame Rate')).toHaveLength(8);
  });

  it('carries Reset, Clear Image Cache and the two last-program entries', () => {
    const labels = flattenMenu(MOVIE_MENU).map((entry) => entry.node.label);
    expect(labels).toContain('Reset');
    expect(labels).toContain('Clear Image Cache');
    expect(labels).toContain('Update Last Program');
    expect(labels).toContain('Remove Last Program');
    const reset = MOVIE_MENU.find((node) => node.kind === 'command' && node.label === 'Reset');
    expect(reset).toEqual({ kind: 'command', label: 'Reset', command: 'mset;rewind' });
  });

  it('every program template carries exactly one %d for mvprg', () => {
    for (const { node } of flattenMenu(MOVIE_MENU)) {
      if (node.kind !== 'program') continue;
      expect(node.template.match(/%d/g)).toHaveLength(1);
    }
  });
});
