/**
 * The headless plugin-engine accessors (inventory rows 76 / 463).
 *
 * Every fixture here is a shape MEASURED over the wire against a live bridge in
 * `bridge/tests/test_wf_plugins.py` — the symbol names, the argument shapes and
 * the error kinds are the real ones, so a rename on the Python side breaks this
 * file instead of silently breaking the panel.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  initializePluginSystem,
  isAutoloadEnabled,
  readAutoload,
  setAutoload,
  type CallFn,
} from './pluginSystem';

function recorder(answers: Record<string, unknown> = {}) {
  const calls: Array<[string, readonly unknown[] | undefined]> = [];
  const call = (async (fn: string, args?: readonly unknown[]) => {
    calls.push([fn, args]);
    if (fn in answers) return answers[fn];
    return null;
  }) as CallFn;
  return { call, calls };
}

describe('initializePluginSystem', () => {
  it('calls initialize(-2), the mode that loads NO plugin code', async () => {
    // -1 or a pmgapp would `__import__` every file on the startup path.
    // Measured: `initialize(-1)` fails apbs_gui outright (no PyQt) and leaves
    // lightingsettings_gui imported but unreachable.
    const { call, calls } = recorder();
    await initializePluginSystem(call);
    expect(calls).toEqual([['plugins.initialize', [-2]]]);
  });
});

describe('readAutoload', () => {
  it('reads the module dict, not PluginInfo', async () => {
    // `plugins.plugins.copy` is refused by the codec: `NotSerializable: no
    // codec entry for pymol.plugins.PluginInfo`, and codec.py is frozen.
    const { call, calls } = recorder({ 'plugins.autoload.copy': { apbs_gui: false } });
    expect(await readAutoload(call)).toEqual({ apbs_gui: false });
    expect(calls).toEqual([['plugins.autoload.copy', undefined]]);
  });

  it('tolerates a backend that answers nothing', async () => {
    const call = (async () => undefined) as CallFn;
    expect(await readAutoload(call)).toEqual({});
  });

  it('coerces to boolean, because the rc file is user-written Python', async () => {
    // `~/.pymolpluginsrc.py` is arbitrary Python; `autoload` can hold anything
    // the user typed. `PluginInfo.autoload`'s setter is `bool(value)`.
    const { call } = recorder({ 'plugins.autoload.copy': { a: 0, b: 1, c: '' } });
    expect(await readAutoload(call)).toEqual({ a: false, b: true, c: false });
  });
});

describe('isAutoloadEnabled', () => {
  it('treats a missing key as enabled, like autoload.get(name, True)', () => {
    expect(isAutoloadEnabled('never_seen', {})).toBe(true);
    expect(isAutoloadEnabled('off', { off: false })).toBe(false);
    expect(isAutoloadEnabled('on', { on: true })).toBe(true);
  });
});

describe('setAutoload', () => {
  it('reproduces the property setter: update then set_pref_changed', async () => {
    // `autoload[self.name] = bool(value); set_pref_changed()`
    // (modules/pymol/plugins/__init__.py). Both halves, in that order — the
    // save serialises the dict, so it has to come second.
    const { call, calls } = recorder();
    await setAutoload(call, 'apbs_gui', false);
    expect(calls).toEqual([
      ['plugins.autoload.update', [{ apbs_gui: false }]],
      ['plugins.set_pref_changed', []],
    ]);
  });

  it('does not save when the update was refused', async () => {
    // set_pref_changed rewrites ~/.pymolpluginsrc.py from the in-memory dict.
    // Saving after a failed update would persist state the user never asked for.
    const save = vi.fn();
    const call = (async (fn: string) => {
      if (fn === 'plugins.autoload.update') throw new Error('NotAllowed');
      save();
      return null;
    }) as CallFn;
    await expect(setAutoload(call, 'x', true)).rejects.toThrow('NotAllowed');
    expect(save).not.toHaveBeenCalled();
  });
});
