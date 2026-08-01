/**
 * WP-12 unit tests: everything the object panel decides without a DOM.
 *
 * The fixtures are VERBATIM from a `cmd.tenmol_objects('snapshot')` transcript
 * against the running bridge (see `bridge/tests/test_objects.py`), so a change
 * in the Python shape breaks these too instead of drifting silently.
 */

import { describe, expect, test, vi } from 'vitest';
import type { PanelMenuNode, PanelSnapshot } from '@tenmol/protocol';
import {
  createObjectsStore,
  displayName,
  menuKey,
  parseColorCodes,
  replaceAtPath,
  rowsFromSnapshot,
  stripColorCodes,
  swatchFromCode,
  type PanelRow,
} from '@tenmol/stores/objects';
import { isChildOf, planDrop, rowActions, type DragRow } from './actions';
import { menuNameFor, OPS, rowKind } from './menus';
import { createPanelSource, BOOTSTRAP, PANEL_SYMBOL } from './panelSource';
import { cssColor, inBand, isOpen, nodeAtPath } from './ObjectPanel';

/* ------------------------------------------------------------------ *
 * fixtures
 * ------------------------------------------------------------------ */

function row(over: Partial<PanelSnapshot['rows'][number]>): PanelSnapshot['rows'][number] {
  return {
    name: 'x',
    type: 'object:molecule',
    enabled: true,
    group: '',
    nest: 0,
    isGroup: false,
    isOpen: false,
    isAll: false,
    reps: 0,
    repIndices: [],
    color: null,
    caption: '',
    ...over,
  };
}

/** `fragment ala` + `fragment trp` + `group grp, ala trp` + `select sel`. */
const SNAPSHOT: PanelSnapshot = {
  rows: [
    row({ name: 'all', type: 'all', isAll: true }),
    row({ name: 'grp', type: 'object:group', isGroup: true, isOpen: true, enabled: false }),
    row({ name: 'ala', group: 'grp', nest: 1, caption: '1/1', reps: 3 }),
    row({ name: 'trp', group: 'grp', nest: 1, enabled: false }),
    row({ name: 'sel', type: 'selection', enabled: false }),
  ],
  opCount: 5,
  buttonMode: '',
  ops: ['A', 'S', 'H', 'L', 'C'],
  settings: {
    group_full_member_names: 0,
    group_arrow_prefix: 0,
    internal_gui_name_color_mode: 0,
    internal_gui_control_size: 18,
    internal_gui_width: 220,
    hide_underscore_names: 1,
  },
};

/* ------------------------------------------------------------------ *
 * rows
 * ------------------------------------------------------------------ */

describe('snapshot -> rows', () => {
  test('keeps PanelListGroup order, nest levels and open state', () => {
    const rows = rowsFromSnapshot(SNAPSHOT);
    expect(rows.map((r) => r.name)).toEqual(['all', 'grp', 'ala', 'trp', 'sel']);
    expect(rows[1]?.isOpen).toBe(true);
    expect(rows[2]?.nest).toBe(1);
    expect(rows[2]?.group).toBe('grp');
    expect(rows[2]?.nestInferred).toBe(false); // read from PyMOL, not guessed
    expect(rows[2]?.caption).toBe('1/1');
  });

  test('cloaked follows the real group chain, not the dotted name', () => {
    // `cmd.group('grp','ala trp')` leaves member names UNDOTTED, which is
    // exactly the case name inference cannot see.
    const rows = rowsFromSnapshot(SNAPSHOT);
    expect(rows.find((r) => r.name === 'ala')?.cloaked).toBe(true);
    expect(rows.find((r) => r.name === 'trp')?.cloaked).toBe(false); // disabled anyway
  });

  test('displayName only strips a prefix that is really there', () => {
    const rows = rowsFromSnapshot(SNAPSHOT);
    const ala = rows.find((r) => r.name === 'ala') as PanelRow;
    expect(displayName(ala)).toBe('ala');
    expect(displayName(rows.find((r) => r.name === 'sel') as PanelRow)).toBe('(sel)');

    const dotted: PanelRow = { ...ala, name: 'grp.a', group: 'grp' };
    expect(displayName(dotted)).toBe('a');
    expect(displayName(dotted, { group_full_member_names: 1 })).toBe('grp.a');
    expect(displayName(dotted, { group_arrow_prefix: 1 })).toBe('^|a');
  });
});

describe('objects store', () => {
  test('a snapshot idles the two-call poll and a poll cannot clobber it', () => {
    const store = createObjectsStore();
    store.applySnapshot(SNAPSHOT);
    expect(store.get().feed).toBe('panel');
    // `objectsSource.poll()` returns early on source === 'topic'.
    expect(store.get().source).toBe('topic');
    expect(store.get().panel.opCount).toBe(5);

    const before = store.get().rows;
    store.applyRows([], 'poll');
    expect(store.get().rows).toBe(before);

    store.releasePanelFeed();
    store.applyRows([], 'poll');
    expect(store.get().rows).toEqual([]);
    expect(store.get().feed).toBe('poll');
  });

  test('menu cache is keyed by (name, op) and expands in place', () => {
    const store = createObjectsStore();
    const items: PanelMenuNode[] = [
      { code: 2, text: 'Action:', path: [0], command: '' },
      { code: 1, text: 'group', path: [1], lazy: true },
    ];
    store.cacheMenu({ name: 'ala', kind: 'object:molecule', op: 'A', menu: 'mol_action', items });
    expect(store.get().menus[menuKey('ala', 'a')]?.menu).toBe('mol_action');

    store.expandMenu('ala', 'A', [1], [
      { code: 2, text: 'Move to Group:', path: [1, 0], command: '' },
      { code: 1, text: 'ungroup', path: [1, 1], command: 'cmd.ungroup("ala")' },
    ]);
    const node = store.get().menus[menuKey('ala', 'A')]?.items[1];
    expect(node?.lazy).toBe(false);
    expect(node?.items?.[1]?.command).toBe('cmd.ungroup("ala")');

    store.clearMenus();
    expect(store.get().menus).toEqual({});
  });

  test('replaceAtPath reaches a nested submenu', () => {
    const tree: PanelMenuNode[] = [
      { code: 1, text: 'a', path: [0], items: [{ code: 1, text: 'b', path: [0, 0], lazy: true }] },
    ];
    const out = replaceAtPath(tree, [0, 0], [{ code: 1, text: 'c', path: [0, 0, 0], command: 'x' }]);
    expect(out[0]?.items?.[0]?.items?.[0]?.text).toBe('c');
    expect(tree[0]?.items?.[0]?.items).toBeUndefined(); // input untouched
  });
});

/* ------------------------------------------------------------------ *
 * `\RGB`
 * ------------------------------------------------------------------ */

describe('\\RGB colour codes (layer1/Text.cpp:507-548)', () => {
  test('three digits set a colour, \\--- resets it', () => {
    expect(parseColorCodes('\\933delete object')).toEqual([
      { text: 'delete object', color: 'rgb(255, 85, 85)' },
    ]);
    expect(parseColorCodes('\\900s\\090p')).toEqual([
      { text: 's', color: 'rgb(255, 0, 0)' },
      { text: 'p', color: 'rgb(0, 255, 0)' },
    ]);
    expect(parseColorCodes('a\\---b')).toEqual([
      { text: 'a', color: null },
      { text: 'b', color: null },
    ]);
  });

  test('a backslash that is not a colour code is literal text', () => {
    // menu.py:1560 emits cmd.label("x","'%1.2f'%b") — no escape in sight, but
    // `\\n` style backslashes must survive too.
    const text = 'cmd.label("sele","\\zzz")';
    expect(stripColorCodes(text)).toBe(text);
  });

  test('swatchFromCode scales each digit by 1/9', () => {
    expect(swatchFromCode('999')).toBe('rgb(255, 255, 255)');
    expect(swatchFromCode('000')).toBe('rgb(0, 0, 0)');
    expect(swatchFromCode('090')).toBe('rgb(0, 255, 0)');
  });

  test('cssColor maps PyMOL 0..1 floats', () => {
    expect(cssColor([1, 0, 0])).toBe('rgb(255, 0, 0)');
    expect(cssColor([0.5, 0.5, 0.5])).toBe('rgb(128, 128, 128)');
  });
});

/* ------------------------------------------------------------------ *
 * menu dispatch
 * ------------------------------------------------------------------ */

describe('A/S/H/L/C/M dispatch (CExecutive::click)', () => {
  test('the six buttons exist in hit-column order', () => {
    expect(OPS).toEqual(['A', 'S', 'H', 'L', 'C', 'M']);
  });

  test('per-type menu names', () => {
    expect(menuNameFor('all', 'A')).toBe('all_action');
    expect(menuNameFor('selection', 'A')).toBe('sele_action');
    expect(menuNameFor('object:group', 'A')).toBe('group_action');
    expect(menuNameFor('object:ramp', 'C')).toBe('ramp_color');
    expect(menuNameFor('object:surface', 'C')).toBe('mesh_color');
    expect(menuNameFor('object:volume', 'S')).toBe('volume_show');
    expect(menuNameFor('object:measurement', 'H')).toBe('measurement_hide');
  });

  test('the buttons PyMOL draws but does not open', () => {
    for (const kind of [
      'object:map',
      'object:mesh',
      'object:surface',
      'object:slice',
      'object:measurement',
    ]) {
      expect(menuNameFor(kind, 'L')).toBeNull();
    }
    expect(menuNameFor('selection', 'M')).toBeNull();
  });

  test('rowKind sends the `all` row down the cExecAll branch', () => {
    expect(rowKind({ isAll: true, type: 'object:group' })).toBe('all');
    expect(rowKind({ isAll: false, type: 'selection' })).toBe('selection');
  });

  test('nodeAtPath walks a serialised path', () => {
    const items: PanelMenuNode[] = [
      { code: 1, text: 'a', path: [0], items: [{ code: 1, text: 'b', path: [0, 0], command: 'q' }] },
    ];
    expect(nodeAtPath(items, [0, 0])?.command).toBe('q');
    expect(nodeAtPath(items, [9])).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * drag / reorder
 * ------------------------------------------------------------------ */

describe('drag to reorder (Executive.cpp:15809-15935)', () => {
  const rows: DragRow[] = [
    { name: 'all', group: '', isGroup: false, isAll: true },
    { name: 'a', group: '', isGroup: false, isAll: false },
    { name: 'grp', group: '', isGroup: true, isOpen: true, isAll: false },
    { name: 'inner', group: 'grp', isGroup: false, isAll: false },
    { name: 'b', group: '', isGroup: false, isAll: false },
  ];

  test('downward drag orders <target> <moved> at the current location', () => {
    expect(planDrop(rows, 1, 4)).toEqual({
      kind: 'order',
      names: ['b', 'a'],
      location: 'current',
    });
  });

  test('upward drag orders <moved> <target> at the upper location', () => {
    expect(planDrop(rows, 4, 1)).toEqual({
      kind: 'order',
      names: ['b', 'a'],
      location: 'upper',
    });
  });

  test('dropping onto an OPEN group moves the row into it, with no order', () => {
    expect(planDrop(rows, 1, 2)).toEqual({ kind: 'group', parent: 'grp', child: 'a' });
  });

  test('dragging a group onto its own member is a no-op', () => {
    expect(planDrop(rows, 2, 3).kind).toBe('none');
    expect(isChildOf(rows, rows[3] as DragRow, rows[2] as DragRow)).toBe(true);
  });

  test('dragging past the last row pops out one group level', () => {
    expect(planDrop(rows, 3, rows.length)).toEqual({ kind: 'ungroup', child: 'inner' });
  });

  test('the `all` row never moves', () => {
    expect(planDrop(rows, 0, 3).kind).toBe('none');
    expect(planDrop(rows, 3, 0).kind).toBe('none');
  });

  test('the emitted command lines are the ones PyMOL logs', () => {
    expect(rowActions.order(['b', 'a'], 'upper')).toMatchObject({
      fn: 'order',
      args: ['b a'],
      kwargs: { location: 'upper' },
      echo: 'order b a, location=upper',
    });
    expect(rowActions.groupAdd('grp', 'a').echo).toBe('group grp, a');
    expect(rowActions.ungroup('a').echo).toBe('ungroup a');
    expect(rowActions.groupOpen('grp', true)).toMatchObject({
      fn: 'group',
      args: ['grp'],
      kwargs: { action: 'open' },
    });
  });
});

describe('visibility drag band', () => {
  test('inBand covers press..over inclusive, in either direction', () => {
    expect(inBand({ pressed: 1, over: 3, mode: 'visibility' }, 2)).toBe(true);
    expect(inBand({ pressed: 3, over: 1, mode: 'visibility' }, 1)).toBe(true);
    expect(inBand({ pressed: 1, over: 3, mode: 'visibility' }, 4)).toBe(false);
    expect(inBand({ pressed: 1, over: 3, mode: 'reorder' }, 2)).toBe(false);
  });

  test('isOpen prefers the server flag and falls back to the local list', () => {
    const rows = rowsFromSnapshot(SNAPSHOT);
    const grp = rows.find((r) => r.name === 'grp') as PanelRow;
    expect(isOpen(grp, ['grp'])).toBe(true); // server says open, list ignored
    const legacy: PanelRow = { ...grp };
    delete legacy.isOpen;
    expect(isOpen(legacy, ['grp'])).toBe(false);
    expect(isOpen(legacy, [])).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * the endpoint client
 * ------------------------------------------------------------------ */

describe('panelSource bootstrap', () => {
  test('calls the symbol first and only bootstraps when that fails', async () => {
    const calls: unknown[][] = [];
    let installed = false;
    const source = createPanelSource({
      call: async (fn, args) => {
        calls.push([fn, args]);
        if (!installed) throw new Error(`${fn}: no such symbol`);
        return { rows: [] } as never;
      },
      do: async (line) => {
        expect(line).toBe(BOOTSTRAP);
        installed = true;
        return null;
      },
    });

    await source.snapshot();
    expect(calls).toEqual([
      [PANEL_SYMBOL, ['snapshot']],
      [PANEL_SYMBOL, ['snapshot']],
    ]);
    expect(source.ready).toBe(true);

    // Already installed: no second bootstrap, and a failure now propagates.
    const bootstrap = vi.fn();
    const strict = createPanelSource({
      call: async () => {
        throw new Error('boom');
      },
      do: bootstrap,
    });
    await expect(strict.snapshot()).rejects.toThrow('boom');
    expect(bootstrap).toHaveBeenCalledTimes(1); // one attempt, then it gives up
  });

  test('menu and expand pass the row kind and the path positionally', async () => {
    const calls: unknown[][] = [];
    const source = createPanelSource({
      call: async (fn, args) => {
        calls.push([fn, args]);
        return { items: [] } as never;
      },
      do: async () => null,
    });
    await source.menu('ala', 'S', 'object:molecule');
    await source.expand('ala', 'A', [21], 'object:molecule');
    expect(calls).toEqual([
      [PANEL_SYMBOL, ['menu', 'ala', 'S', 'object:molecule']],
      [PANEL_SYMBOL, ['expand', 'ala', 'A', [21], 'object:molecule']],
    ]);
  });
});
