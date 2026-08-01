/**
 * Scene writes and the motion menus — the exact command strings PyMOL emits.
 *
 * These matter more than they look: `layer4/PopUp.cpp:471-475` executes menu
 * leaves as *command strings*, and `SceneClickButton` / `MovieClick` PLog the
 * same strings. If the DOM version emits something else, a `.pml` log recorded
 * through the web client stops replaying in the Qt client.
 */

import { describe, expect, it } from 'vitest';
import { F_KEYS, renameProblem, reorder, sceneActions } from './sceneActions';
import {
  cameraMotionMenu,
  cameraStoreWithScene,
  objectMotionMenu,
  storeWithState,
} from '../movie/motionMenu';

describe('sceneActions', () => {
  it('store/recall/update/clear are cmd.scene with the documented action', () => {
    expect(sceneActions.store('new')).toMatchObject({
      fn: 'cmd.scene',
      args: ['new', 'store'],
      kwargs: { quiet: 0 },
    });
    expect(sceneActions.recall('F1')).toMatchObject({ args: ['F1', 'recall'], kwargs: { animate: -1 } });
    expect(sceneActions.update()).toMatchObject({ args: ['auto', 'update'] });
    expect(sceneActions.clear('F1')).toMatchObject({ args: ['F1', 'clear'] });
  });

  it('the Append> submenu sets exactly the flags _gui.py:782-785 sets', () => {
    expect(sceneActions.storeCameraOnly().kwargs).toEqual({ color: 0, rep: 0 });
    expect(sceneActions.storeColorOnly().kwargs).toEqual({ view: 0, rep: 0 });
    expect(sceneActions.storeRepsOnly().kwargs).toEqual({ view: 0, color: 0 });
    expect(sceneActions.storeRepsColor().kwargs).toEqual({ view: 0 });
  });

  it('middle-drag browse forces animate=0', () => {
    expect(sceneActions.browse('S1').kwargs).toEqual({ animate: 0 });
  });

  it('rename needs new_key, as viewing.py:1034 requires', () => {
    expect(sceneActions.rename('F1', 'F5')).toMatchObject({
      args: ['F1', 'rename'],
      kwargs: { new_key: 'F5' },
    });
  });

  it('scene_order sends a space-separated string and an optional location', () => {
    expect(sceneActions.order(['b', 'a'])).toMatchObject({
      fn: 'cmd.scene_order',
      args: ['b a'],
      kwargs: {},
    });
    expect(sceneActions.order(['a'], 'top').kwargs).toEqual({ location: 'top' });
    expect(sceneActions.sort()).toMatchObject({ args: ['*'], kwargs: { sort: 1 } });
  });

  it('F1..F12 is the list the Recall/Store/Clear submenus use', () => {
    expect(F_KEYS).toHaveLength(12);
    expect(F_KEYS[0]).toBe('F1');
    expect(F_KEYS[11]).toBe('F12');
  });
});

describe('reorder', () => {
  it('moves a name to an index without duplicating it', () => {
    expect(reorder(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(reorder(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
  });

  it('clamps out-of-range targets', () => {
    expect(reorder(['a', 'b'], 'a', 99)).toEqual(['b', 'a']);
    expect(reorder(['a', 'b'], 'b', -5)).toEqual(['b', 'a']);
  });
});

describe('motion menus (menu.py)', () => {
  it('camera_motion is the 12-entry list of menu.py:108', () => {
    const items = cameraMotionMenu(['S1'], 3, '4');
    const labels = items.filter((i) => !i.separator && !i.header).map((i) => i.label);
    expect(labels).toEqual([
      'store',
      'store with scene',
      'store with state',
      'clear',
      'reset camera motions',
      'purge entire movie',
      'smooth key frames',
      'interpolate',
      'reinterpolate',
      'uninterpolate',
    ]);
    expect(items[1]?.command).toBe('cmd.mview("store",first=4)');
    expect(items.find((i) => i.label === 'purge entire movie')?.command).toBe('cmd.mset()');
  });

  it('store with scene lists at most 40 names, with the exact command', () => {
    const many = Array.from({ length: 60 }, (_, i) => `S${i}`);
    const items = cameraStoreWithScene(many, '0');
    expect(items).toHaveLength(41); // 1 header + 40
    expect(items[1]?.command).toBe('cmd.mview("store",scene="S0",first=0)');
  });

  it('store with state samples current/1/n plus the interior points', () => {
    // n_state = 10 -> n_show = 8 -> interior = (10*i)//8 for i in 2..7
    const items = storeWithState(10, '', '0').filter((i) => !i.header && !i.separator);
    expect(items.map((i) => i.label)).toEqual([
      'current',
      '1',
      '10',
      '2',
      '3',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(items[0]?.command).toBe('cmd.mview("store",object="",state=-1,first=0)');
  });

  it('a single-state object offers only current and 1', () => {
    const items = storeWithState(1, 'm', '0').filter((i) => !i.header && !i.separator);
    expect(items.map((i) => i.label)).toEqual(['current', '1']);
  });

  it('obj_motion adds drag/reset/purge and passes object= everywhere', () => {
    const items = objectMotionMenu('m2', 1, '0');
    const labels = items.filter((i) => !i.separator && !i.header).map((i) => i.label);
    expect(labels).toEqual([
      'drag',
      'store',
      'store with state',
      'reset',
      'clear',
      'reset object motions',
      'purge object motions',
      'smooth key frames',
      'interpolate',
      'reinterpolate',
      'uninterpolate',
    ]);
    expect(items[1]?.command).toBe('cmd.drag("m2")');
    expect(items.find((i) => i.label === 'reset')?.command).toBe(';cmd.reset(object="m2");');
    expect(items.find((i) => i.label === 'purge object motions')?.command).toBe(
      'cmd.mview("purge",object="m2")',
    );
    // The smooth submenu carries the window=15/30 variants with object=.
    const smooth = items.find((i) => i.label === 'smooth key frames')?.items ?? [];
    expect(smooth.map((i) => i.command)).toEqual([
      'cmd.mview("smooth",object="m2")',
      'cmd.mview("smooth",window=15,object="m2")',
      'cmd.mview("smooth",window=30,object="m2")',
    ]);
  });
});

/* -------------------------------------------------------------------------- *
 * Rename validation.
 *
 * `scene_bin_gui.py:360-377` refuses a blank or space-containing name by
 * printing to the console while the cell reverts, which reads as the edit
 * simply not working. Same refusals, visible reason.
 * -------------------------------------------------------------------------- */

describe('renameProblem', () => {
  const existing = ['one', 'two', 'three'];

  it('accepts an ordinary new name', () => {
    expect(renameProblem('four', 'one', existing)).toBeNull();
  });

  it('accepts the unchanged name, so committing without editing is not an error', () => {
    expect(renameProblem('one', 'one', existing)).toBeNull();
  });

  it('refuses blank and whitespace-only names', () => {
    expect(renameProblem('', 'one', existing)).toMatch(/blank/);
    expect(renameProblem('   ', 'one', existing)).toMatch(/blank/);
  });

  it('refuses spaces ANYWHERE, not just at the edges', () => {
    // `cmd.scene_order` takes a space-separated list, so a name with a space
    // in it could never be ordered again.
    expect(renameProblem('a b', 'one', existing)).toMatch(/spaces/);
    expect(renameProblem(' a', 'one', existing)).toMatch(/spaces/);
    expect(renameProblem('a\t b', 'one', existing)).toMatch(/spaces/);
  });

  it('refuses a name already in use', () => {
    // Not upstream's check: `rename` to an existing key OVERWRITES it, so the
    // panel would silently show one fewer scene.
    expect(renameProblem('two', 'one', existing)).toMatch(/already exists/);
  });
});
