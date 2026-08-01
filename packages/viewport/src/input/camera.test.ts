import { describe, expect, it, vi } from 'vitest';

import { createCameraDriver, type CameraCall } from './camera';

function driver(call?: CameraCall) {
  const calls: Array<{ fn: string; args: readonly unknown[] }> = [];
  const spy: CameraCall = call ?? ((fn, args = []) => {
    calls.push({ fn, args });
    return Promise.resolve(null);
  });
  return { d: createCameraDriver({ call: spy, degPerPx: 1, movePerPx: 1, zoomPerNotch: 1 }), calls };
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

  it('translates when SHIFT is held, whatever the button', () => {
    const { d, calls } = driver();
    d.drag({ dx: 3, dy: 0, button: 0, mod: 1 });
    expect(calls[0]!.fn).toBe('cmd.move');
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

  it('dollies on the wheel', () => {
    const { d, calls } = driver();
    d.wheel(-2);
    expect(calls).toEqual([{ fn: 'cmd.move', args: ['z', -2] }]);
  });

  it('counts what it issued', () => {
    const { d } = driver();
    d.drag({ dx: 1, dy: 1, button: 0, mod: 0 });
    d.drag({ dx: 1, dy: 0, button: 1, mod: 0 });
    d.wheel(1);
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
