/**
 * The settings PUSH channel, and the window title riding on it — parity row 57.
 *
 * The row's gap sentence for two waves was "the setting-sync half — draining
 * `cmd.get_setting_updates()` into menu checkables and the window title — is not
 * done here", corrected in wave 8 to the narrower and accurate "the two
 * consumers do not subscribe to that tap: … `shell/AppShell.tsx` polls
 * `cmd.get('session_file')` at 1 Hz for `document.title` instead of reacting to
 * index 440". This file is that half, from the shell side.
 *
 * The bridge fake below answers `panels/settings.py`'s three calls the way the
 * REAL bridge answered them over a socket while this was written
 * (`bridge/tests/test_p9_shell.py`): `tenmol_settings_status` raises
 * `no such symbol` until the module is imported, `tenmol_settings_drain(cursor)`
 * takes the cursor as an ARGUMENT and answers "everything since", and
 * `tenmol_settings_values` resolves setting NAMES as well as indices and
 * silently drops the ones it cannot resolve.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsStore,
  createUiStore,
} from '@tenmol/stores';

import { SessionContext, type Session } from '../app';
import { AppShell } from './AppShell';
import { SESSION_FILE_INDEX, getSettingsTap, resetSettingsTap } from './settingsTap';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The shell's contract is the frame; features test themselves. */
vi.mock('../features/registry', () => ({
  FEATURE_SLOTS: [],
  UNDECLARED_FEATURES: [],
  getSlot: () => undefined,
  isInstalled: () => false,
  loadFeature: () => undefined,
  installedFeatureIds: () => [],
  slotsForRegion: () => [],
}));

/* ------------------------------------------------------------------ *
 * A fake of `bridge/tenmol_bridge/panels/settings.py`
 * ------------------------------------------------------------------ */

interface FakeBridge {
  /** Setting index -> value, exactly `get_setting_tuple(i)[1][0]`. */
  values: Map<number, number | string>;
  /** name -> index, as `_resolve_index` resolves it. */
  names: Map<string, number>;
  installed: boolean;
  /** Refuse the import, to prove every consumer degrades. */
  refuseInstall: boolean;
  /** The accumulating tap: one entry per batch the status thread saw. */
  log: Array<{ indices: number[]; full: boolean }>;
  calls: Array<{ fn: string; args: readonly unknown[] }>;
  /** Change a setting the way anything outside the browser would. */
  change(index: number, value: number | string, full?: boolean): void;
}

function makeBridge(): FakeBridge {
  const bridge: FakeBridge = {
    values: new Map<number, number | string>([[SESSION_FILE_INDEX, '']]),
    names: new Map([['session_file', SESSION_FILE_INDEX]]),
    installed: false,
    refuseInstall: false,
    log: [],
    calls: [],
    change(index, value, full = false) {
      bridge.values.set(index, value);
      bridge.log.push({ indices: [index], full });
    },
  };
  return bridge;
}

function bridgeCall(bridge: FakeBridge, fn: string, args: readonly unknown[]): Promise<unknown> {
  bridge.calls.push({ fn, args });
  if (fn === 'setting.tenmol_settings_status') {
    if (!bridge.installed) {
      // MEASURED: the dispatcher answers `NotAllowed: no such symbol` before
      // the module binds itself onto `pymol.setting`.
      return Promise.reject(new Error('setting.tenmol_settings_status: no such symbol'));
    }
    return Promise.resolve({ installed: true, cursor: bridge.log.length });
  }
  if (fn === 'cmd.do') {
    if (bridge.refuseInstall) return Promise.reject(new Error('offline'));
    bridge.installed = true;
    return Promise.resolve(null);
  }
  if (fn === 'setting.tenmol_settings_drain') {
    if (!bridge.installed) return Promise.reject(new Error('no such symbol'));
    const cursor = Number(args[0] ?? 0);
    const since = bridge.log.slice(cursor);
    return Promise.resolve({
      cursor: bridge.log.length,
      indices: [...new Set(since.flatMap((batch) => batch.indices))],
      full: since.some((batch) => batch.full),
      lost: false,
    });
  }
  if (fn === 'setting.tenmol_settings_values') {
    if (!bridge.installed) return Promise.reject(new Error('no such symbol'));
    const wanted = (args[0] as unknown[]) ?? [];
    const rows: Array<[number, unknown, string]> = [];
    for (const item of wanted) {
      const index = typeof item === 'number' ? item : bridge.names.get(String(item));
      // `_resolve_index` returns None for an unknown name and the row is
      // silently dropped — the reason the resolver has a per-name fallback.
      if (index === undefined) continue;
      const value = bridge.values.get(index);
      if (value === undefined) continue;
      rows.push([index, value, String(value)]);
    }
    return Promise.resolve({ object: '', state: 0, values: rows, failed: [] });
  }
  return Promise.resolve(null);
}

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

let container: HTMLDivElement;
let root: Root;
let bridge: FakeBridge;
let session: Session;
/** `cmd.get('session_file')` — the poll this row says must stop. */
let titlePolls: number;
let sessionFile: string;

function makeSession(): Session {
  const stores = {
    connection: createConnectionStore('ws://test/ws', true),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    ui: createUiStore(null),
  };
  return {
    config: {} as Session['config'],
    conn: { sendInput: vi.fn(), isOpen: true } as unknown as Session['conn'],
    stores,
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() } as unknown as Session['objectsSource'],
    poller: { stats: () => ({ hz: 30 }) } as unknown as Session['poller'],
    run: vi.fn(),
    act: vi.fn(),
    call: (fn: string, args: readonly unknown[] = []) => {
      if (fn === 'cmd.get' && args[0] === 'session_file') {
        titlePolls += 1;
        return Promise.resolve(sessionFile);
      }
      if (fn === 'cmd.get_setting_int') return Promise.resolve(0);
      if (fn.startsWith('setting.') || fn === 'cmd.do') return bridgeCall(bridge, fn, args);
      return Promise.resolve(null);
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <SessionContext.Provider value={session}>
        <AppShell />
      </SessionContext.Provider>,
    );
  });
}

/** Real timers: the tap is a poller wrapping an async body. */
async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  expect(check()).toBe(true);
}

async function idle(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

beforeEach(() => {
  bridge = makeBridge();
  titlePolls = 0;
  sessionFile = '';
  document.title = 'PyMOL';
  session = makeSession();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetSettingsTap(session);
  document.title = 'PyMOL';
});

describe('the shell-owned settings tap (row 57)', () => {
  it('installs the bridge module with cmd.do(echo=0), not a `do` frame', async () => {
    const tap = getSettingsTap(session);
    const detach = tap.attach();
    await waitFor(() => tap.live);

    const install = bridge.calls.find((call) => call.fn === 'cmd.do');
    expect(install?.args[0]).toBe('/import tenmol_bridge.panels.settings as _s;_s.install()');
    // MEASURED over the socket: the same import sent as `{t:'do'}` prints
    // `PyMOL>/import …` into the console; `cmd.do(line, echo=0)` prints nothing.
    // The kwarg is the third argument of `session.call(fn, args, kwargs)`.
    expect(install?.args).toHaveLength(1);
    detach();
  });

  it('reports which indices changed and reads only those back', async () => {
    const tap = getSettingsTap(session);
    const detach = tap.attach();
    const seen: Array<{ indices: readonly number[]; full: boolean }> = [];
    tap.subscribe((batch) => seen.push(batch));
    const watched: Array<number | string | null> = [];
    tap.watch(23, (value) => watched.push(value));
    bridge.values.set(23, 0);
    await waitFor(() => tap.live && watched.length > 0);
    expect(watched).toEqual([0]); // the read `_addmenu` does at BUILD time

    bridge.change(23, 1);
    bridge.change(64, 7);
    await waitFor(() => watched.length > 1);
    expect(watched.at(-1)).toBe(1);
    // 64 is nobody's business here: it is reported as changed and NOT read.
    const reads = bridge.calls
      .filter((call) => call.fn === 'setting.tenmol_settings_values')
      .flatMap((call) => (call.args[0] as unknown[]) ?? []);
    expect(reads).not.toContain(64);
    expect(seen.some((batch) => batch.indices.includes(64))).toBe(true);
    detach();
  });

  it('resolves setting names to indices in one call, and one-by-one when a name is unknown', async () => {
    bridge.names.set('orthoscopic', 23);
    bridge.names.set('valence', 64);
    bridge.values.set(23, 0);
    bridge.values.set(64, 1);
    const tap = getSettingsTap(session);
    tap.attach();

    const both = await tap.indices(['orthoscopic', 'valence']);
    expect([...both]).toEqual([
      ['orthoscopic', 23],
      ['valence', 64],
    ]);
    const batched = bridge.calls.filter((call) => call.fn === 'setting.tenmol_settings_values');
    expect(batched).toHaveLength(1);

    // A name the bridge cannot resolve makes the batch SHORT, and a short batch
    // is ambiguous — the fallback asks per name so the survivors stay correct.
    const mixed = await tap.indices(['orthoscopic', 'nonexistent_setting', 'valence']);
    expect(mixed.get('orthoscopic')).toBe(23);
    expect(mixed.get('valence')).toBe(64);
    expect(mixed.has('nonexistent_setting')).toBe(false);
  });

  it('is reference-counted: one consumer leaving does not blind the other', async () => {
    const tap = getSettingsTap(session);
    const first = tap.attach();
    const second = tap.attach();
    await waitFor(() => tap.live);
    const passes = tap.stats().passes;
    first();
    await idle(400);
    expect(tap.stats().passes).toBeGreaterThan(passes);
    second();
    const stopped = tap.stats().passes;
    await idle(400);
    expect(tap.stats().passes).toBe(stopped);
  });

  it('gives up after three failed installs instead of hammering the bridge', async () => {
    bridge.refuseInstall = true;
    const tap = getSettingsTap(session);
    const detach = tap.attach();
    await waitFor(() => tap.stats().installAttempts >= 3, 2000);
    await idle(500);
    expect(tap.live).toBe(false);
    expect(tap.stats().installAttempts).toBe(3);
    detach();
  });
});

describe('document.title <- setting 440 (row 57)', () => {
  it('follows the tap, with no cmd.get poll once the tap is live', async () => {
    await mount();
    await waitFor(() => getSettingsTap(session).live);
    const pollsWhenLive = titlePolls;

    // Nobody typed anything in the browser: this is `cmd.save` on the server,
    // or a `.pse` load, or another client.
    bridge.change(SESSION_FILE_INDEX, '/tmp/wave9/alanine.pse');
    await waitFor(() => document.title === 'PyMOL (alanine.pse)');

    // The 1 Hz `cmd.get('session_file')` this row named is over: two whole
    // seconds of the shell's interval fire and issue nothing.
    await idle(2200);
    expect(titlePolls).toBe(pollsWhenLive);
    expect(document.title).toBe('PyMOL (alanine.pse)');

    // …and it keeps following, including back to the bare title.
    bridge.change(SESSION_FILE_INDEX, '');
    await waitFor(() => document.title === 'PyMOL');
    expect(titlePolls).toBe(pollsWhenLive);
  });

  it('a full batch re-reads 440 even though the tap did not name it', async () => {
    await mount();
    await waitFor(() => getSettingsTap(session).live);
    bridge.values.set(SESSION_FILE_INDEX, '/data/loaded.pse');
    // A session load: `full`, the batch the store is told never to diff.
    bridge.log.push({ indices: [6, 23], full: true });
    await waitFor(() => document.title === 'PyMOL (loaded.pse)');
  });

  it('degrades to the 1 Hz poll when the settings module will not install', async () => {
    bridge.refuseInstall = true;
    sessionFile = '/tmp/polled.pse';
    await mount();
    await waitFor(() => document.title === 'PyMOL (polled.pse)');
    expect(getSettingsTap(session).live).toBe(false);
    expect(titlePolls).toBeGreaterThan(0);
    // Still polling, because that is the only channel left.
    const before = titlePolls;
    await idle(1400);
    expect(titlePolls).toBeGreaterThan(before);
  });
});
