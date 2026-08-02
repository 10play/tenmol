/**
 * Wave 8 — inventory rows 461 (plugin preferences) and 462 (startup paths).
 *
 * Both rows read "PARTIAL: ... is NOT wired", and row 461 named the reason: a
 * write "rewrites the user's interpreter startup file, which needs a
 * confirmation flow this panel does not have yet". So this file is about the
 * FLOW as much as the call: a click must stage, not write; the staged banner
 * must say correctly whether the file will be touched; and Cancel must leave
 * the engine alone.
 *
 * Three engine behaviours drive the assertions, and all three are measured over
 * a live socket in `packages/bridge/tests/test_p8_a10.py` rather than read off the
 * source:
 *
 *  1. `pref_set` ends in `set_pref_changed()`, which tests `instantsave` AFTER
 *     the assignment. Turning `instantsave` OFF is therefore the one write that
 *     never reaches `~/.pymolpluginsrc.py`.
 *  2. `set_startup_path` replaces only `__path__[:-N_NON_USER_PATHS]`. On this
 *     build `get_startup_path()` has 2 entries and `get_startup_path(True)` has
 *     ZERO, so both visible rows are installation paths no edit can remove.
 *  3. `set_startup_path` FAILS SILENTLY on anything that is not a list — it
 *     prints and returns the same `None` a success returns. The only way to
 *     know is to read back, which is what `setStartupPaths` does.
 *
 * The backend double below is a small state machine rather than a table,
 * because 3 cannot be expressed by a table: it has to be possible for the
 * engine to accept a call and not apply it.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginManager } from './PluginManager';

const SESSION = { call: vi.fn() };
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PMG = '/x/pmg_tk/startup';
const DATA = '/x/pymol/pymol_path/data/startup';
/** The two entries `set_startup_path` may never replace. */
const INSTALLATION = [PMG, DATA];

interface Engine {
  user: string[];
  preferences: { verbose: boolean; instantsave: boolean };
  /** Accept `set_startup_path` and do nothing — the silent-failure branch. */
  deaf: boolean;
  initFails: boolean;
}

function backend(patch: Partial<Engine> = {}) {
  const engine: Engine = {
    user: [],
    preferences: { verbose: false, instantsave: true },
    deaf: false,
    initFails: false,
    ...patch,
  };
  const impl = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (fn === 'plugins.initialize') {
      if (engine.initFails) throw new Error("NotAllowed: 'plugins.initialize'");
      return null;
    }
    if (fn === 'plugins.get_startup_path') {
      return args[0] === true ? [...engine.user] : [...engine.user, ...INSTALLATION];
    }
    if (fn === 'plugins.findPlugins') {
      return { apbs_gui: `${DATA}/apbs_gui/__init__.py` };
    }
    if (fn === 'plugins.pref_get') {
      return engine.preferences[args[0] as 'verbose' | 'instantsave'];
    }
    if (fn === 'plugins.pref_set') {
      engine.preferences[args[0] as 'verbose' | 'instantsave'] = Boolean(args[1]);
      return null; // pref_set returns None whether or not the save worked
    }
    if (fn === 'plugins.autoload.copy') return {};
    if (fn === 'plugins.autoload.update') return null;
    if (fn === 'plugins.set_pref_changed') return null;
    if (fn === 'plugins.set_startup_path') {
      if (!engine.deaf && Array.isArray(args[0])) engine.user = [...(args[0] as string[])];
      return null;
    }
    throw new Error(`unexpected ${fn}`);
  });
  return { engine, impl };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  SESSION.call.mockReset();
});

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(patch: Partial<Engine> = {}) {
  const b = backend(patch);
  SESSION.call.mockImplementation(b.impl);
  await act(async () => {
    root.render(<PluginManager />);
  });
  await settle();
  return b;
}

function tab(label: string) {
  const found = Array.from(container.querySelectorAll('button[role="tab"]')).find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
  act(() => found.click());
}

const $ = (selector: string) => container.querySelector(selector) as HTMLElement | null;
const $$ = (selector: string) => Array.from(container.querySelectorAll(selector)) as HTMLElement[];

async function click(selector: string) {
  const el = $(selector);
  if (!el) throw new Error(`no ${selector}`);
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

/** `fn` names of every call since the last clear. */
const calls = () => SESSION.call.mock.calls.map((c) => String(c[0]));
const callsWith = (fn: string) =>
  SESSION.call.mock.calls.filter((c) => c[0] === fn).map((c) => c[1]);

/** Type into a CONTROLLED input: React's own value setter swallows a direct set. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/* ============================================================= row 461 */

describe('plugin preferences are editable, behind a confirmation', () => {
  it('a click STAGES the change: nothing reaches the engine yet', async () => {
    await mount();
    tab('Settings');
    SESSION.call.mockClear();

    act(() => ($('[data-plugin-pref="verbose"]') as HTMLInputElement).click());

    expect(calls()).not.toContain('plugins.pref_set');
    expect($('[data-plugin-confirm]')!.textContent).toContain('Set verbose to true.');
    // the checkbox is still driven by the ENGINE's value, not by the click
    expect(($('[data-plugin-pref="verbose"]') as HTMLInputElement).checked).toBe(false);
  });

  it('Cancel leaves the engine untouched', async () => {
    await mount();
    tab('Settings');
    act(() => ($('[data-plugin-pref="verbose"]') as HTMLInputElement).click());
    SESSION.call.mockClear();

    await click('[data-plugin-cancel]');

    expect(calls()).toEqual([]);
    expect($('[data-plugin-confirm]')).toBeNull();
  });

  it('Apply writes plugins.pref_set and the panel follows', async () => {
    const { engine } = await mount();
    tab('Settings');
    act(() => ($('[data-plugin-pref="verbose"]') as HTMLInputElement).click());
    SESSION.call.mockClear();

    await click('[data-plugin-apply]');

    expect(callsWith('plugins.pref_set')).toEqual([['verbose', true]]);
    expect(engine.preferences.verbose).toBe(true);
    expect(($('[data-plugin-pref="verbose"]') as HTMLInputElement).checked).toBe(true);
    expect($('[data-plugin-confirm]')).toBeNull();
  });

  it('says the file WILL be rewritten when instantsave is on', async () => {
    await mount({ preferences: { verbose: false, instantsave: true } });
    tab('Settings');
    act(() => ($('[data-plugin-pref="verbose"]') as HTMLInputElement).click());

    const text = $('[data-plugin-confirm]')!.textContent!;
    expect(text).toContain('rewrites ~/.pymolpluginsrc.py');
    expect($('[data-plugin-apply]')!.textContent).toBe('Apply and save');
  });

  it('says it will NOT when instantsave is off', async () => {
    await mount({ preferences: { verbose: false, instantsave: false } });
    tab('Settings');
    act(() => ($('[data-plugin-pref="verbose"]') as HTMLInputElement).click());

    const text = $('[data-plugin-confirm]')!.textContent!;
    expect(text).toContain('stays in memory for this session only');
    expect(text).not.toContain('rewrites');
    expect($('[data-plugin-apply]')!.textContent).toBe('Apply (session only)');
  });

  it('turning instantsave OFF is itself a session-only write — the asymmetry', async () => {
    // `set_pref_changed` reads `instantsave` AFTER the assignment, so this one
    // click changes the in-memory value and leaves the file saying `True`.
    // A panel that showed "Apply and save" here would be lying.
    await mount({ preferences: { verbose: false, instantsave: true } });
    tab('Settings');
    act(() => ($('[data-plugin-pref="instantsave"]') as HTMLInputElement).click());

    expect($('[data-plugin-confirm]')!.textContent).toContain(
      'stays in memory for this session only',
    );
  });

  it('turning instantsave back ON does reach the file', async () => {
    await mount({ preferences: { verbose: false, instantsave: false } });
    tab('Settings');
    act(() => ($('[data-plugin-pref="instantsave"]') as HTMLInputElement).click());

    expect($('[data-plugin-confirm]')!.textContent).toContain('rewrites ~/.pymolpluginsrc.py');
  });

  it('refuses every write when the registry failed to initialize', async () => {
    // Same guard the autoload checkbox has, for the same reason: an uninitialized
    // `preferences` dict saved over the file destroys the user's choices.
    await mount({ initFails: true });
    tab('Settings');
    expect($('.plugmgr__error')!.textContent).toContain('plugin scan failed');
    SESSION.call.mockClear();

    act(() => ($('[data-plugin-pref="verbose"]') as HTMLInputElement).click());
    await click('[data-plugin-apply]');

    expect(calls()).not.toContain('plugins.pref_set');
    expect($('[data-plugin-writeerror]')!.textContent).toContain(
      'refusing to write ~/.pymolpluginsrc.py',
    );
  });
});

/* ============================================================= row 462 */

describe('startup paths: add, remove, reorder', () => {
  const A = '/home/u/pymol-plugins';
  const B = '/opt/shared/plugins';

  it('separates the USER slice from the installation tail', async () => {
    await mount({ user: [A] });
    tab('Startup Paths');

    expect($$('[data-plugin-userpaths] li').map((li) => li.textContent)).toEqual([A + '↑↓✕']);
    expect($$('[data-plugin-fixedpaths] li').map((li) => li.textContent)).toEqual(INSTALLATION);
    // the fixed list has no buttons at all, which is the point of splitting it
    expect($$('[data-plugin-fixedpaths] button')).toHaveLength(0);
  });

  it('says so when there is no user slice at all — this build`s real state', async () => {
    await mount({ user: [] });
    tab('Startup Paths');
    expect($('[data-plugin-nouserpaths]')!.textContent).toContain(
      'every directory below is part of the installation',
    );
  });

  it('Add stages a path and Apply sends the whole list', async () => {
    const { engine } = await mount({ user: [A] });
    tab('Startup Paths');

    typeInto($('[data-plugin-path-input]') as HTMLInputElement, B);
    await click('[data-plugin-path-add]');
    expect($('[data-plugin-confirm]')!.textContent).toContain(
      'Replace the 1 user startup path(s) with 2.',
    );
    SESSION.call.mockClear();

    await click('[data-plugin-apply]');
    // `set_startup_path(list, autosave)` — the whole slice, never a delta
    expect(callsWith('plugins.set_startup_path')).toEqual([[[A, B], true]]);
    expect(engine.user).toEqual([A, B]);
    expect($('[data-plugin-confirm]')).toBeNull();
  });

  it('re-reads after the write, and CATCHES an engine that did not apply it', async () => {
    // `set_startup_path` prints ' Error: set_startup_path failed' and returns
    // the same None a success returns, so `t: ok` proves nothing.
    const { engine } = await mount({ user: [A], deaf: true });
    tab('Startup Paths');
    typeInto($('[data-plugin-path-input]') as HTMLInputElement, B);
    await click('[data-plugin-path-add]');
    await click('[data-plugin-apply]');

    expect(engine.user).toEqual([A]);
    expect($('[data-plugin-writeerror]')!.textContent).toContain('set_startup_path did not apply');
    // the draft survives, so the user can retry rather than losing the edit
    expect($('[data-plugin-confirm]')).not.toBeNull();
  });

  it('reorders with the arrows and applies the new order', async () => {
    const { engine } = await mount({ user: [A, B] });
    tab('Startup Paths');

    await click('[data-plugin-path-down="0"]');
    expect($$('[data-plugin-userpaths] .plugmgr__pathtext').map((s) => s.textContent)).toEqual([
      B,
      A,
    ]);
    await click('[data-plugin-apply]');
    expect(engine.user).toEqual([B, A]);
  });

  it('the end-of-list arrows are disabled, so a no-op cannot be staged', async () => {
    await mount({ user: [A, B] });
    tab('Startup Paths');
    expect(($('[data-plugin-path-up="0"]') as HTMLButtonElement).disabled).toBe(true);
    expect(($('[data-plugin-path-down="1"]') as HTMLButtonElement).disabled).toBe(true);
    expect($('[data-plugin-confirm]')).toBeNull();
  });

  it('removes a path', async () => {
    const { engine } = await mount({ user: [A, B] });
    tab('Startup Paths');
    await click('[data-plugin-path-remove="0"]');
    await click('[data-plugin-apply]');
    expect(engine.user).toEqual([B]);
  });

  it('refuses a duplicate: the first match wins, so a second copy is dead weight', async () => {
    await mount({ user: [A] });
    tab('Startup Paths');
    typeInto($('[data-plugin-path-input]') as HTMLInputElement, A);
    expect(($('[data-plugin-path-add]') as HTMLButtonElement).disabled).toBe(true);
    typeInto($('[data-plugin-path-input]') as HTMLInputElement, '   ');
    expect(($('[data-plugin-path-add]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Cancel discards the whole draft', async () => {
    const { engine } = await mount({ user: [A] });
    tab('Startup Paths');
    await click('[data-plugin-path-remove="0"]');
    SESSION.call.mockClear();
    await click('[data-plugin-cancel]');

    expect(calls()).toEqual([]);
    expect(engine.user).toEqual([A]);
    expect($$('[data-plugin-userpaths] .plugmgr__pathtext').map((s) => s.textContent)).toEqual([A]);
  });

  it('offers a session-only apply, which passes autosave=False', async () => {
    // `set_startup_path(p, autosave=True)` routes through `set_pref_changed`.
    // The second button is the difference between "change the search path" and
    // "change the search path in the file PyMOL runs at every startup".
    const { engine } = await mount({ user: [A] });
    tab('Startup Paths');
    await click('[data-plugin-path-remove="0"]');
    SESSION.call.mockClear();

    await click('[data-plugin-apply-session]');
    expect(callsWith('plugins.set_startup_path')).toEqual([[[], false]]);
    expect(engine.user).toEqual([]);
  });

  it('hides the session-only button when instantsave is already off', async () => {
    // With instantsave off, `autosave=True` writes nothing either, so two
    // buttons would offer the same thing under different names.
    await mount({ user: [A], preferences: { verbose: false, instantsave: false } });
    tab('Startup Paths');
    await click('[data-plugin-path-remove="0"]');
    expect($('[data-plugin-apply-session]')).toBeNull();
    expect($('[data-plugin-apply]')!.textContent).toBe('Apply (session only)');
  });
});
