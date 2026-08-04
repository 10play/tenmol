import { describe, expect, it, vi } from 'vitest';

import { createCameraDriver, type CameraCall } from './camera';

/** `cmd.get_view()` at rest: front 40, back 100. */
const VIEW = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 100, -20];

function driver(extra: Partial<Parameters<typeof createCameraDriver>[0]> = {}) {
  const calls: Array<{ fn: string; args: readonly unknown[] }> = [];
  const spy: CameraCall = (fn, args = []) => {
    calls.push({ fn, args });
    return Promise.resolve(null);
  };
  return {
    d: createCameraDriver({
      call: spy,
      degPerPx: 1,
      movePerPx: 1,
      zoomPerNotch: 2,
      // Pin the mode: without this the driver reads `button_mode_name` from
      // the backend, which these tests do not have.
      mode: () => 'three_button_viewing',
      ...extra,
    }),
    calls,
  };
}

describe('camera driver', () => {
  it('rotates about the axis PERPENDICULAR to the motion', () => {
    // A trackball that turns about the axis you drag along feels broken.
    const { d, calls } = driver();
    d.drag({ dx: 10, dy: 0, button: 0, mod: 0 });
    expect(calls).toEqual([{ fn: 'cmd.turn', args: ['y', 10] }]);
    calls.length = 0;
    d.drag({ dx: 0, dy: 10, button: 0, mod: 0 });
    expect(calls).toEqual([{ fn: 'cmd.turn', args: ['x', 10] }]);
  });

  it('translates on the middle button', () => {
    const { d, calls } = driver();
    d.drag({ dx: 3, dy: 0, button: 1, mod: 0 });
    expect(calls).toEqual([{ fn: 'cmd.move', args: ['x', 3] }]);
  });

  /*
   * CORRECTED IN WAVE 9, and the old expectation is kept here as a comment
   * because it is the bug the parity row named. This used to read
   *
   *     it('translates when SHIFT is held, whatever the button', ...)
   *
   * and assert `cmd.move`. PyMOL binds Shift+left to `+Box` in 3-Button
   * Viewing (`controlling.py` mode_dict) and to `RotO` in 3-Button Editing.
   * It is NEVER a translate. The driver now resolves through the same table
   * the C core does, so Shift+left starts a rubber band and writes nothing
   * until the release.
   */
  it('does NOT translate on Shift+left: the table says +Box', () => {
    const { d, calls } = driver();
    d.press({ x: 0, y: 0, button: 0, mod: 1 });
    d.drag({ dx: 3, dy: 0, button: 0, mod: 1 });
    expect(calls).toEqual([]);
    expect(d.band).toEqual({ left: 0, top: 0, right: 3, bottom: 0 });
  });

  it('negates dy when translating, or a drag down moves the model up', () => {
    const { d, calls } = driver();
    d.drag({ dx: 0, dy: 5, button: 1, mod: 0 });
    expect(calls).toEqual([{ fn: 'cmd.move', args: ['y', -5] }]);
  });

  it('emits nothing for a zero-delta sample', () => {
    const { d, calls } = driver();
    d.drag({ dx: 0, dy: 0, button: 0, mod: 0 });
    d.wheel(0);
    expect(calls).toEqual([]);
  });

  /*
   * ALSO CORRECTED. The bare wheel used to dolly (`cmd.move z`); the default
   * mode binds `('w','none','slab')`, so PyMOL SCALES THE SLAB and only
   * Ctrl+Shift+wheel dollies. `dollies on the wheel` is still true — of the
   * gesture the table actually binds to `MovZ`.
   */
  it('scales the slab on a bare wheel, because that is what the table says', () => {
    const { d, calls } = driver({ view: () => VIEW });
    d.wheel(-1);
    // front 40, back 100 -> thickness 60, expanded by 1 + 0.2.
    expect(calls).toEqual([{ fn: 'cmd.clip', args: ['slab', 72] }]);
  });

  it('dollies on Ctrl+Shift+wheel, which is where MovZ lives', () => {
    const { d, calls } = driver({ view: () => VIEW });
    d.wheel(-2, 3);
    // `SceneMouse.cpp:752`: -( (front + back) / 2 ) * 0.1 = -7, not a constant.
    expect(calls).toEqual([{ fn: 'cmd.move', args: ['z', -7] }]);
  });

  it('counts what it issued', () => {
    const { d } = driver({ view: () => VIEW });
    d.drag({ dx: 1, dy: 1, button: 0, mod: 0 });
    d.drag({ dx: 1, dy: 0, button: 1, mod: 0 });
    d.wheel(1, 3);
    expect(d.counters).toMatchObject({ turns: 2, moves: 1, zooms: 1 });
  });

  it('reports a failing call without throwing at the caller', async () => {
    const onError = vi.fn();
    const d = createCameraDriver({
      call: () => Promise.reject(new Error('NotAllowed')),
      onError,
    });
    d.drag({ dx: 1, dy: 0, button: 0, mod: 0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledOnce();
    expect(d.counters.errors).toBe(1);
  });
});
