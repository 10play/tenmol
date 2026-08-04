import { describe, expect, it, vi } from 'vitest';
import { WIZARD_EVENT_BITS, WIZARD_RPC, wizardWants } from '@tenmol/protocol';
import { createWizardService, probeChanged, EMPTY_SNAPSHOT } from './service';
import { asciiFor, modifiersFor } from './WizardKeyCapture';

function recorder() {
  const calls: { fn: string; args: unknown[]; kwargs: Record<string, unknown> }[] = [];
  const call = vi.fn(async (fn: string, args: readonly unknown[] = [], kwargs = {}) => {
    calls.push({ fn, args: [...args], kwargs: { ...kwargs } });
    return null as never;
  });
  return { calls, call: call as never };
}

describe('createWizardService', () => {
  it('maps every call onto the granted bridge symbol', async () => {
    const { calls, call } = recorder();
    const service = createWizardService(call);

    await service.probe();
    await service.snapshot();
    await service.menu('mode');
    await service.exec('cmd.get_wizard().set_mode(2)');
    await service.launch('measurement');
    await service.replace('demo', ['reps']);
    await service.dismiss(true);
    await service.catalog();

    expect(calls.map((c) => c.fn)).toEqual([
      WIZARD_RPC.probe,
      WIZARD_RPC.snapshot,
      WIZARD_RPC.menu,
      WIZARD_RPC.exec,
      WIZARD_RPC.launch,
      WIZARD_RPC.replace,
      WIZARD_RPC.dismiss,
      WIZARD_RPC.catalog,
    ]);
    expect(calls[2]?.args).toEqual(['mode']);
    // The `code` string is passed through untouched — never parsed, never
    // evaluated (packages/engine/layer1/Wizard.cpp:573-577 runs it through PParse server-side).
    expect(calls[3]?.args).toEqual(['cmd.get_wizard().set_mode(2)']);
    expect(calls[5]?.args).toEqual(['demo', ['reps'], {}]);
    expect(calls[6]?.kwargs).toEqual({ all: true });
  });

  it('sends the event kind positionally and the payload as kwargs', async () => {
    const { calls, call } = recorder();
    const service = createWizardService(call);
    await service.event('pick', { selection: 'ala and name CA', bond: true });
    await service.event('key', { k: 13, mod: 0 });
    expect(calls[0]).toEqual({
      fn: WIZARD_RPC.event,
      args: ['pick'],
      kwargs: { selection: 'ala and name CA', bond: true },
    });
    expect(calls[1]?.kwargs).toEqual({ k: 13, mod: 0 });
  });
});

describe('probeChanged', () => {
  const base = { version: 3, depth: 1, cls: 'Measurement', module: 'pymol.wizard.measurement' };

  it('is true on the first probe', () => {
    expect(probeChanged(null, base)).toBe(true);
  });

  it('is false when nothing moved — no snapshot round trip, no side effects', () => {
    expect(probeChanged(base, { ...base })).toBe(false);
  });

  it('is true when refresh_wizard bumped the version', () => {
    expect(probeChanged(base, { ...base, version: 4 })).toBe(true);
  });

  it('is true when the stack was pushed or the top class swapped', () => {
    expect(probeChanged(base, { ...base, depth: 2 })).toBe(true);
    expect(probeChanged(base, { ...base, cls: 'Charge' })).toBe(true);
  });
});

describe('EMPTY_SNAPSHOT', () => {
  it('renders as "no wizard": depth 0, no rows, no prompt', () => {
    expect(EMPTY_SNAPSHOT.depth).toBe(0);
    expect(EMPTY_SNAPSHOT.panel).toEqual([]);
    expect(EMPTY_SNAPSHOT.prompt).toEqual([]);
  });
});

describe('event mask gating', () => {
  it('matches packages/engine/modules/pymol/wizard/__init__.py:6-15', () => {
    // measurement.py:101-106 -> pick | select | dirty
    const measurement = 1 + 2 + 128;
    expect(wizardWants(measurement, 'pick')).toBe(true);
    expect(wizardWants(measurement, 'dirty')).toBe(true);
    expect(wizardWants(measurement, 'scene')).toBe(false);
    // pseudoatom.py:17-18 -> key only
    expect(wizardWants(WIZARD_EVENT_BITS.key, 'key')).toBe(true);
    expect(wizardWants(WIZARD_EVENT_BITS.key, 'pick')).toBe(false);
    // annotation.py:7-8 -> scene | state | frame
    const annotation = 16 + 32 + 64;
    expect(wizardWants(annotation, 'pick')).toBe(false);
    expect(wizardWants(annotation, 'frame')).toBe(true);
  });
});

describe('keyboard -> do_key', () => {
  it('produces the ASCII ints the line-editor wizards compare against', () => {
    // pseudoatom.py:20-36 / renaming.py:20-39 / box.py:423-437
    expect(asciiFor({ key: 'Backspace' })).toBe(8);
    expect(asciiFor({ key: 'Enter' })).toBe(13);
    expect(asciiFor({ key: 'Escape' })).toBe(27);
    expect(asciiFor({ key: ' ' })).toBe(32);
    expect(asciiFor({ key: 'a' })).toBe(97);
    expect(asciiFor({ key: 'Z' })).toBe(90);
  });

  it('ignores keys with no ASCII meaning, and Tab (the console owns it)', () => {
    expect(asciiFor({ key: 'Tab' })).toBeNull();
    expect(asciiFor({ key: 'ArrowLeft' })).toBeNull();
    expect(asciiFor({ key: 'F1' })).toBeNull();
  });

  it('maps ctrl+letter to its control character', () => {
    expect(asciiFor({ key: 'a', ctrlKey: true })).toBe(1);
  });

  it('encodes modifiers as the cOrtho bitmask SHIFT=1 CTRL=2 ALT=4', () => {
    expect(modifiersFor({ shiftKey: false, ctrlKey: false, altKey: false })).toBe(0);
    expect(modifiersFor({ shiftKey: true, ctrlKey: false, altKey: false })).toBe(1);
    expect(modifiersFor({ shiftKey: true, ctrlKey: true, altKey: true })).toBe(7);
  });
});
