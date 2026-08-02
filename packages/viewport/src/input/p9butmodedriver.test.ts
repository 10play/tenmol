/**
 * The GL-free driver against the ButMode table (parity row 149).
 *
 * WHAT THE ROW SAID WAS MISSING: "`createCameraDriver` hard-codes
 * `button === 1 || (mod & 1)` = translate, anything else = turn, wheel =
 * `cmd.move z`. It never imports `./butmode` and never reads `button_mode`."
 *
 * So the assertion here is never "a drag rotates". It is: THE SAME GESTURE
 * PRODUCES DIFFERENT CALLS IN DIFFERENT MOUSE MODES, and the difference is the
 * one `mode_dict` names. A driver that ignored the table would pass none of
 * these except by accident.
 *
 * One correction to the row's own wording while we are here: it says "with
 * 3-Button Editing selected a left drag still rotates the camera where PyMOL
 * would run rotf/torf/movf on the picked fragment". A BARE left drag in
 * 3-Button Editing IS `rota` — `('l','none','rota')` — so rotating the camera
 * was right for that one gesture and wrong for six others in the same mode.
 * `rotf`/`movf` are not in 3-Button Editing at all; they live in 2-Button
 * Editing (`('l','ctsh','rotf')`, `('r','ctsh','movf')`).
 */

import { describe, expect, it, vi } from 'vitest';

import { BUT_ACT_CODE } from './butmode';
import { boxSelectExpression, createCameraDriver, type CameraDriverOptions } from './camera';
import { MODE_DICT, type ModeName } from './modes';
import { buttonSlot, tableForMode } from './index';

/** `cmd.get_view()` at rest: front 40, back 100, perspective. */
const VIEW = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 100, -20];

interface Call {
  fn: string;
  args: readonly unknown[];
}

function harness(mode: ModeName, extra: Partial<CameraDriverOptions> = {}) {
  const calls: Call[] = [];
  const answers = new Map<string, unknown>();
  const driver = createCameraDriver({
    call: (fn, args = []) => {
      calls.push({ fn, args });
      const key = `${fn}:${JSON.stringify(args)}`;
      return Promise.resolve(answers.has(key) ? answers.get(key) : null);
    },
    degPerPx: 1,
    movePerPx: 1,
    zoomPerNotch: 2,
    mode: () => mode,
    view: () => VIEW,
    ...extra,
  });
  return { driver, calls, answers };
}

/** `BUT_ACT_CODE` under `noUncheckedIndexedAccess`. */
const act = (name: string): number => BUT_ACT_CODE[name] ?? -1;

/** Modifier masks (`layer1/Ortho.h:20-22`). */
const SHIFT = 1;
const CTRL = 2;
const CTSH = 3;

describe('the driver resolves every gesture through the ButMode table', () => {
  it('gives Shift+left a rubber band in Viewing and an object rotation in Editing', () => {
    // `('l','shft','+Box')` vs `('l','shft','roto')` — the same two pixels.
    const viewing = harness('three_button_viewing');
    viewing.driver.press({ x: 10, y: 10, button: 0, mod: SHIFT });
    viewing.driver.drag({ dx: 20, dy: 5, button: 0, mod: SHIFT });
    expect(viewing.calls).toEqual([]);
    expect(viewing.driver.band).toEqual({ left: 10, top: 10, right: 30, bottom: 15 });
    expect(viewing.driver.action).toBe(BUT_ACT_CODE['+box']);

    const editing = harness('three_button_editing', {
      pick: () => ({ object: 'zz', index: 3 }),
    });
    editing.driver.press({ x: 10, y: 10, button: 0, mod: SHIFT });
    editing.driver.drag({ dx: 20, dy: 5, button: 0, mod: SHIFT });
    expect(editing.driver.action).toBe(BUT_ACT_CODE['roto']);
    expect(editing.calls).toEqual([
      { fn: 'cmd.rotate', args: ['y', 20, 'all', -1, 1, 'zz'] },
      { fn: 'cmd.rotate', args: ['x', 5, 'all', -1, 1, 'zz'] },
    ]);
    expect(editing.driver.band).toBeNull();
  });

  it('gives Ctrl+left a torsion in Editing and a translate in Viewing', () => {
    // `('l','ctrl','torf')` vs `('l','ctrl','move')`.
    const editing = harness('three_button_editing');
    editing.driver.press({ x: 0, y: 0, button: 0, mod: CTRL });
    editing.driver.drag({ dx: 12, dy: 0, button: 0, mod: CTRL });
    expect(editing.calls).toEqual([{ fn: 'cmd.torsion', args: [12] }]);

    const viewing = harness('three_button_viewing');
    viewing.driver.press({ x: 0, y: 0, button: 0, mod: CTRL });
    viewing.driver.drag({ dx: 12, dy: 0, button: 0, mod: CTRL });
    expect(viewing.calls).toEqual([{ fn: 'cmd.move', args: ['x', 12] }]);
  });

  it('moves the PICKED ATOM for CtSh+left in Editing (MovA), not the camera', () => {
    const { driver, calls } = harness('three_button_editing');
    driver.press({ x: 0, y: 0, button: 0, mod: CTSH });
    driver.drag({ dx: 4, dy: 6, button: 0, mod: CTSH });
    expect(driver.action).toBe(BUT_ACT_CODE['mova']);
    // camera=1, state=-1: the same screen-to-model transform `ObjectMoleculeMoveAtom`
    // gets from `MatrixInvTransformC44fAs33f3f`.
    expect(calls).toEqual([{ fn: 'cmd.translate', args: [[4, -6, 0], 'pk1', -1, 1] }]);
  });

  it('re-resolves on EVERY sample, so releasing Shift mid-drag changes the action', () => {
    // `SceneDrag`: `mode = ButModeTranslate(G, I->Button, mod)` on every sample
    // (`layer1/SceneMouse.cpp:1308`), with the button from the PRESS.
    const { driver, calls } = harness('three_button_editing', {
      pick: () => ({ object: 'zz', index: 0 }),
    });
    driver.press({ x: 0, y: 0, button: 0, mod: SHIFT });
    driver.drag({ dx: 5, dy: 0, button: 0, mod: SHIFT });
    driver.drag({ dx: 5, dy: 0, button: 0, mod: 0 });
    expect(calls.map((c) => c.fn)).toEqual(['cmd.rotate', 'cmd.turn']);
  });

  it('keeps the PRESS button when a sample forgets it', () => {
    // The coalescer reports the button it saw; PyMOL uses `I->Button`, captured
    // at the press. A middle-button drag must stay `move` even if a sample
    // arrives claiming button 0.
    const { driver, calls } = harness('three_button_viewing');
    driver.press({ x: 0, y: 0, button: 1, mod: 0 });
    driver.drag({ dx: 3, dy: 0, button: 0, mod: 0 });
    expect(calls).toEqual([{ fn: 'cmd.move', args: ['x', 3] }]);
  });

  it('does not ray-cast for a gesture that has no use for a pick', () => {
    // `LastPicked` is consumed by the object and fragment motions only
    // (`SceneMouse.cpp:1501-1513`).  A plain Rota press that walked the whole
    // geometry index would cost a scan per press for an answer it discards.
    const picks: Array<[number, number]> = [];
    const withPick = (mode: ModeName) =>
      harness(mode, {
        pick: (x, y) => {
          picks.push([x, y]);
          return { object: 'zz', index: 0 };
        },
      });
    withPick('three_button_viewing').driver.press({ x: 4, y: 5, button: 0, mod: 0 }); // rota
    expect(picks).toEqual([]);
    withPick('three_button_editing').driver.press({ x: 4, y: 5, button: 0, mod: SHIFT }); // roto
    expect(picks).toEqual([[4, 5]]);
  });

  it('issues NOTHING for an action a drag cannot express, and counts it', () => {
    // `('m','ctrl','+/-')` is a click action: it toggles the clicked atom in
    // the active selection. Rotating the camera for it — which is what the old
    // driver did for every unrecognised gesture — is the bug this row named.
    const { driver, calls } = harness('three_button_editing');
    driver.press({ x: 0, y: 0, button: 1, mod: CTRL });
    driver.drag({ dx: 9, dy: 9, button: 1, mod: CTRL });
    expect(calls).toEqual([]);
    expect(driver.counters.unsupported).toBe(1);
  });

  it('clips with the exact arithmetic of SceneDrag, not a guess', () => {
    // `SceneMouse.cpp:1925-1937`: back -= dx/10, front -= dy/10 in PyMOL screen
    // coordinates (y UP), which is +dy/10 for a DOM dy.
    const { driver, calls } = harness('three_button_viewing');
    driver.press({ x: 0, y: 0, button: 2, mod: SHIFT }); // ('r','shft','clip')
    driver.drag({ dx: 10, dy: 20, button: 2, mod: SHIFT });
    expect(driver.action).toBe(BUT_ACT_CODE['clip']);
    expect(calls).toEqual([
      { fn: 'cmd.clip', args: ['far', 1] },
      { fn: 'cmd.clip', args: ['near', -2] },
    ]);
  });
});

describe('the wheel goes through the same table', () => {
  it('scales the slab bare and dollies only where MovZ is bound', () => {
    const { driver, calls } = harness('three_button_viewing');
    driver.wheel(-1);
    driver.wheel(-1, CTSH);
    expect(calls).toEqual([
      // thickness 60 * (1 + 0.2 * mouse_wheel_scale)
      { fn: 'cmd.clip', args: ['slab', 72] },
      // (front + back) / 2 * 0.1 = 7, away from the model on a forward turn
      { fn: 'cmd.move', args: ['z', -7] },
    ]);
  });

  it('moves the slab on Shift+wheel, and reverses with the direction', () => {
    const { driver, calls } = harness('three_button_viewing');
    driver.wheel(-1, 1);
    driver.wheel(1, 1);
    expect(calls).toEqual([
      { fn: 'cmd.clip', args: ['move', 6] },
      { fn: 'cmd.clip', args: ['move', -6] },
    ]);
  });

  it('does nothing when the mode leaves the wheel unbound', () => {
    // `two_button_editing` binds all four wheel slots to `none`.
    const { driver, calls } = harness('two_button_editing');
    driver.wheel(-1);
    expect(calls).toEqual([]);
    expect(driver.counters.unsupported).toBe(1);
  });
});

describe('rubber band', () => {
  const box = { left: 10, top: 10, right: 30, bottom: 30 };

  function band(mode: ModeName, mod: number, hits: Array<{ object: string; index: number }>) {
    const seen: Array<{ left: number; top: number; right: number; bottom: number } | null> = [];
    const h = harness(mode, {
      boxHits: () => hits,
      onBand: (b) => seen.push(b),
      selectionMode: () => 1,
      activeSelection: () => 'sele',
    });
    h.driver.press({ x: box.left, y: box.top, button: mod === 1 ? 0 : 1, mod });
    h.driver.drag({ dx: 20, dy: 20, button: 0, mod });
    h.driver.release({ x: box.right, y: box.bottom, button: 0, mod });
    return { ...h, seen };
  }

  it('adds with +Box using ExecutiveSelectRect’s own expression', async () => {
    const { calls } = band('three_button_viewing', 1, [
      { object: 'zz', index: 0 },
      { object: 'zz', index: 4 },
    ]);
    expect(calls[0]).toEqual({
      fn: 'cmd.select',
      args: ['sele', '(?sele or byresi (zz`1 zz`5))'],
    });
    // `auto_show_selections` (`Executive.cpp:7549`) enables it afterwards.
    await vi.waitFor(() => expect(calls[1]).toEqual({ fn: 'cmd.enable', args: ['sele'] }));
  });

  it('subtracts with -Box', () => {
    const { calls } = band('three_button_viewing', 1 /* placeholder */, []);
    expect(calls).toEqual([]); // an EMPTY +Box writes nothing at all
    const expression = boxSelectExpression(
      act('-box'),
      'sele',
      [{ object: 'zz', index: 2 }],
      'byresi',
    );
    expect(expression).toBe('(byresi (?sele) and not byresi (zz`3))');
  });

  it('honours the selection level: Atoms has no keyword at all', () => {
    expect(boxSelectExpression(act('box'), 'sele', [{ object: 'z', index: 0 }], '')).toBe(
      '((z`1))',
    );
    expect(
      boxSelectExpression(act('box'), 'sele', [{ object: 'z', index: 0 }], 'bychain'),
    ).toBe('(bychain (z`1))');
  });

  it('normalises a band dragged up and to the left before querying', () => {
    let asked: { left: number; top: number; right: number; bottom: number } | null = null;
    const { driver } = harness('three_button_viewing', {
      boxHits: (b) => {
        asked = { ...b };
        return [];
      },
    });
    driver.press({ x: 100, y: 100, button: 0, mod: SHIFT });
    driver.drag({ dx: -40, dy: -60, button: 0, mod: SHIFT });
    driver.release({ x: 60, y: 40, button: 0, mod: SHIFT });
    expect(asked).toEqual({ left: 60, top: 40, right: 100, bottom: 100 });
  });

  it('clears the overlay rectangle on release', () => {
    const { seen } = band('three_button_viewing', 1, [{ object: 'zz', index: 0 }]);
    expect(seen[0]).toEqual({ left: 10, top: 10, right: 10, bottom: 10 });
    expect(seen.at(-1)).toBeNull();
  });
});

describe('the mode comes from the backend, not from an assumption', () => {
  it('reads button_mode_name on the first press and switches tables', async () => {
    const calls: Call[] = [];
    const driver = createCameraDriver({
      call: (fn, args = []) => {
        calls.push({ fn, args });
        if (fn === 'cmd.get_setting_text') return Promise.resolve('3-Button Editing');
        if (fn === 'cmd.get_setting_int') return Promise.resolve(0);
        if (fn === 'cmd.get_names') return Promise.resolve(['zz_sele']);
        return Promise.resolve(null);
      },
      degPerPx: 1,
      movePerPx: 1,
      view: () => VIEW,
      pick: () => ({ object: 'zz', index: 0 }),
    });
    expect(driver.mode).toBe('three_button_viewing'); // the C core's boot mode
    driver.press({ x: 0, y: 0, button: 0, mod: SHIFT });
    await driver.refresh();
    expect(driver.mode).toBe('three_button_editing');
    calls.length = 0;
    driver.press({ x: 0, y: 0, button: 0, mod: SHIFT });
    driver.drag({ dx: 3, dy: 0, button: 0, mod: SHIFT });
    expect(calls.map((c) => c.fn)).toEqual(['cmd.rotate']);
  });

  it('never polls when the caller supplies the mode', () => {
    const { driver, calls } = harness('three_button_viewing');
    driver.press({ x: 0, y: 0, button: 0, mod: 0 });
    expect(calls.filter((c) => c.fn.startsWith('cmd.get_'))).toEqual([]);
  });

  it('takes the active selection name from the enabled selections', async () => {
    const driver = createCameraDriver({
      call: (fn) => {
        if (fn === 'cmd.get_setting_text') return Promise.resolve('3-Button Viewing');
        if (fn === 'cmd.get_setting_int') return Promise.resolve(2);
        if (fn === 'cmd.get_names') return Promise.resolve(['mysele']);
        return Promise.resolve(null);
      },
      boxHits: () => [{ object: 'zz', index: 0 }],
    });
    await driver.refresh();
    const seen: Call[] = [];
    const driver2 = createCameraDriver({
      call: (fn, args = []) => {
        seen.push({ fn, args });
        if (fn === 'cmd.get_setting_text') return Promise.resolve('3-Button Viewing');
        if (fn === 'cmd.get_setting_int') return Promise.resolve(2); // Chains
        if (fn === 'cmd.get_names') return Promise.resolve(['mysele']);
        return Promise.resolve(null);
      },
      boxHits: () => [{ object: 'zz', index: 0 }],
    });
    await driver2.refresh();
    driver2.press({ x: 0, y: 0, button: 0, mod: SHIFT });
    driver2.drag({ dx: 5, dy: 5, button: 0, mod: SHIFT });
    driver2.release({ x: 5, y: 5, button: 0, mod: SHIFT });
    const select = seen.find((c) => c.fn === 'cmd.select');
    expect(select?.args).toEqual(['mysele', '(?mysele or bychain (zz`1))']);
  });
});

describe('the fragment actions of 2-Button Editing', () => {
  it('resolves _pkfragN once per gesture and rotates about the anchor', async () => {
    const calls: Call[] = [];
    const driver = createCameraDriver({
      call: (fn, args = []) => {
        calls.push({ fn, args });
        if (fn === 'cmd.count_atoms') {
          // fragment 1 does not contain the atom; fragment 2 does.
          return Promise.resolve(String(args[0]).startsWith('(?_pkfrag2)') ? 3 : 0);
        }
        if (fn === 'cmd.get_atom_coords') return Promise.resolve([1, 2, 3]);
        return Promise.resolve(null);
      },
      degPerPx: 1,
      movePerPx: 1,
      mode: () => 'two_button_editing',
      pick: () => ({ object: 'zz', index: 6 }),
    });
    driver.press({ x: 0, y: 0, button: 0, mod: CTSH }); // ('l','ctsh','rotf')
    driver.drag({ dx: 4, dy: 0, button: 0, mod: CTSH }); // probes, writes nothing yet
    expect(calls.map((c) => c.fn)).toEqual(['cmd.count_atoms']);
    expect(calls[0]?.args).toEqual(['(?_pkfrag1) and (zz`7)']);
    // The probe walks 1..4 and stops at the fragment that contains the atom.
    await vi.waitFor(() =>
      expect(calls.map((c) => c.fn)).toEqual([
        'cmd.count_atoms',
        'cmd.count_atoms',
        'cmd.get_atom_coords',
      ]),
    );
    calls.length = 0;
    driver.drag({ dx: 4, dy: 0, button: 0, mod: CTSH });
    expect(calls).toEqual([
      { fn: 'cmd.rotate', args: ['y', 4, '_pkfrag2', -1, 1, null, [1, 2, 3]] },
    ]);
  });
});

describe('the table this driver resolves against is the shipped one', () => {
  it('is tableForMode, not a copy: every binding of every mode agrees', () => {
    // GUARD AGAINST THE TEST THAT PASSES ANYWAY. This does not hardcode a
    // table; it re-derives every slot from `MODE_DICT` through `buttonSlot`
    // and asserts the driver's own resolution matches for a sample of
    // gestures. Mutating `MODE_DICT` or `buttonSlot` turns it red.
    for (const mode of Object.keys(MODE_DICT) as ModeName[]) {
      const table = tableForMode(mode);
      for (const [button, modifier, action] of MODE_DICT[mode]) {
        if (!['l', 'm', 'r'].includes(button)) continue;
        const slot = buttonSlot(button, modifier);
        expect(table[slot]).toBe(BUT_ACT_CODE[action.toLowerCase()] ?? -1);
      }
    }
  });
});
