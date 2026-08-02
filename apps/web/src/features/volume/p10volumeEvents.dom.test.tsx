/**
 * `volume_ramp_changed`, and `cmd.volume_panel` as a real entry point.
 *
 * WHAT THE ROW ASKED FOR: "subscribe to a `volume_ramp_changed` event keyed by
 * object name (replacing the direct `setColors()` callback at
 * `colorramping.py:170-179`)". Upstream's callback exists because the Qt panel
 * REGISTERS ITSELF in `_volume_windows_qt[name]`, so anything that calls
 * `cmd.volume_color(name, ramp)` — the prompt, a script, the `A > volume` menu
 * — redraws the open editor. Here the same three facts are:
 *
 *   1. the panel registers on mount (`cmd.tenmol_volume.watch`) and
 *      deregisters on unmount, keyed by NAME;
 *   2. an event for that name reloads it, and an event for another name does
 *      not;
 *   3. the panel's own writes never come back, because they carry
 *      `_guiupdate: 0` and the shim filters on it (asserted server-side in
 *      `bridge/tests/test_p10_volume.py`, and asserted here as "the reload
 *      pushed nothing").
 *
 * The wire format is not invented either: the marker strings below are the
 * exact bytes `panels/volume.py` prints, and the bridge test asserts the same
 * literal (`TENMOL_VOLUME panel <name> 0`) arriving on the feedback topic.
 *
 * NOTHING IS MOCKED BELOW `useSession`: `./service` and `./menuBridge` are the
 * real modules, so the `_guiupdate: 0` kwarg, the bootstrap sequence and the
 * leaf regex are all under test.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import fixture from './__fixtures__/engine-volume.json';
import { SessionContext } from '../../app';
import type { Session } from '../../app';
import { VolumePanel } from './VolumePanel';
import { dialogsStore, type DialogWindowSpec } from '../dialogs/store';
import { isPanelOpen, resetPanelHooks } from '../../shell/panelHooks';
import { resetLeafHooks } from '../pymol-menu/leafHooks';
import {
  VOLUME_BOOTSTRAP,
  installVolumeMenuBridge,
  openVolumeWindow,
  parseVolumeEvent,
  resetVolumeBridge,
  volumePanelLeafName,
} from './menuBridge';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAME = 'p10vol';

/* ------------------------------------------------------------ the socket */

interface Recorded {
  fn: string;
  args: readonly unknown[];
  kwargs?: unknown;
}

const calls: Recorded[] = [];
/** Swapped by one test so the ramp really changes under the panel. */
let ramp: number[] = fixture.ramp as number[];
/**
 * Which bridge this socket is pretending to be.
 *
 *   ready            `cmd.tenmol_volume` already attached (a reconnect)
 *   needs-bootstrap  the module imports, but nothing has installed it yet
 *   absent           no such module at all — an older bridge
 */
let bridgeMode: 'ready' | 'needs-bootstrap' | 'absent' = 'ready';
let bootstrapped = false;

const feedbackListeners = new Set<(payload: { lines: string[] }) => void>();
const openListeners = new Set<() => void>();

const conn = {
  isOpen: true,
  on(event: string, listener: (payload: never) => void) {
    if (event === 'feedback') {
      const l = listener as unknown as (payload: { lines: string[] }) => void;
      feedbackListeners.add(l);
      return () => feedbackListeners.delete(l);
    }
    if (event === 'connection:open') {
      const l = listener as unknown as () => void;
      openListeners.add(l);
      return () => openListeners.delete(l);
    }
    return () => undefined;
  },
};

const SESSION = {
  config: { httpOrigin: 'http://127.0.0.1:0' },
  conn,
  call: async (fn: string, args: readonly unknown[] = [], kwargs?: unknown) => {
    calls.push({ fn, args, kwargs });
    if (fn === 'volume_color') return args.length === 1 ? ramp : 0;
    if (fn === 'get_volume_histogram') return fixture.histogram;
    if (fn === 'get_volume_field') throw new Error('no blob store in this test');
    if (fn === 'menu.vol_color') return [];
    if (fn === 'cmd.tenmol_volume.status') {
      if (bridgeMode === 'absent') throw new Error("NotAllowed: no such symbol 'tenmol_volume'");
      if (bridgeMode === 'needs-bootstrap' && !bootstrapped) {
        throw new Error("NotAllowed: no such symbol 'tenmol_volume'");
      }
      return { ok: true, attr: 'tenmol_volume', tag: 'TENMOL_VOLUME', watching: [] };
    }
    if (fn === 'cmd.tenmol_volume.ramps') {
      if (bridgeMode !== 'ready') throw new Error("NotAllowed: no such symbol 'tenmol_volume'");
      // `sorted(namedramps)`, exactly as `panels/volume.py` answers it — with
      // one `volume_ramp_new` registration sorted into place, which is the only
      // difference this tier can see and `menu.vol_color` cannot.
      return {
        ok: true,
        names: ['2fofc', 'esp', 'fofc', 'p10extra', 'rainbow', 'rainbow2'],
        builtin: ['2fofc', 'esp', 'fofc', 'rainbow', 'rainbow2'],
        extra: ['p10extra'],
      };
    }
    if (fn === 'cmd.tenmol_volume.watch') return { ok: true, watching: [args[0]] };
    if (fn === 'cmd.tenmol_volume.unwatch') return { ok: true, watching: [] };
    if (fn === 'cmd.do') {
      if (bridgeMode === 'absent') throw new Error('ImportError: no module tenmol_bridge');
      bootstrapped = true;
      return null;
    }
    throw new Error(`unexpected bridge call ${fn}`);
  },
} as unknown as Session;

/** Deliver console lines exactly as `conn.on('feedback')` would. */
function feedback(...lines: string[]): void {
  act(() => {
    for (const listener of [...feedbackListeners]) listener({ lines });
  });
}

const fns = () => calls.map((c) => c.fn);
const pushes = () => calls.filter((c) => c.fn === 'volume_color' && c.args.length === 2);

/* ------------------------------------------------------------ the canvas */

let container: HTMLDivElement;
let root: Root;
const REAL_CONTEXT = HTMLCanvasElement.prototype.getContext;

const SPEC: DialogWindowSpec = {
  key: `volume:${NAME}`,
  kind: 'volume',
  arg: NAME,
  title: `${NAME} - Volume Color Map Editor`,
  x: 0,
  y: 0,
  width: 640,
  height: 260,
  z: 1,
  minimised: false,
};

async function mountPanel(spec: DialogWindowSpec = SPEC) {
  await act(async () => {
    root.render(
      <SessionContext.Provider value={SESSION}>
        <VolumePanel spec={spec} />
      </SessionContext.Provider>,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => {});
}

const watchState = () =>
  document.querySelector('[data-volume-watch]')?.getAttribute('data-volume-watch');
const remoteCount = () =>
  Number(document.querySelector('[data-volume-watch]')?.getAttribute('data-volume-remote'));
const stopCount = () =>
  Number(document.querySelector('[data-volume-count]')?.getAttribute('data-volume-count'));

beforeEach(() => {
  calls.length = 0;
  ramp = fixture.ramp as number[];
  bridgeMode = 'ready';
  bootstrapped = false;
  feedbackListeners.clear();
  openListeners.clear();
  resetVolumeBridge(SESSION);
  resetLeafHooks();
  resetPanelHooks();
  for (const window of dialogsStore.get().windows) dialogsStore.close(window.key);

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // jsdom has no 2D context at all, and `paint()` bails on null. The panel's
  // state is what this file measures, so a no-op context is enough.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLCanvasElement.prototype.getContext = REAL_CONTEXT;
  resetLeafHooks();
  resetPanelHooks();
  for (const window of dialogsStore.get().windows) dialogsStore.close(window.key);
});

/* ====================================================== the wire format */

describe('the leaf and the marker are parsed exactly, and nothing else is', () => {
  it('reads the name out of the leaf `menu.py:648` builds', () => {
    expect(volumePanelLeafName(`cmd.volume_panel('${NAME}')`)).toBe(NAME);
    expect(volumePanelLeafName(`  cmd.volume_panel( "${NAME}" ) `)).toBe(NAME);
    expect(volumePanelLeafName("cmd.volume_panel('a b')")).toBe('a b');
  });

  it('claims nothing it is not sure about', () => {
    for (const command of [
      'cmd.volume_panel(name)',
      'cmd.volume_panel()',
      "cmd.volume_panel('a', 'b')",
      "cmd.volume_color('vol', \"2fofc\")",
      "cmd.volume_panelx('vol')",
      "xcmd.volume_panel('vol')",
    ]) {
      expect(volumePanelLeafName(command)).toBeNull();
    }
  });

  it('parses the marker `panels/volume.py` prints, and rejects near misses', () => {
    expect(parseVolumeEvent('TENMOL_VOLUME panel p10vol 0')).toEqual({
      kind: 'panel',
      name: 'p10vol',
      stops: 0,
    });
    expect(parseVolumeEvent(' TENMOL_VOLUME ramp p10vol 18 ')).toEqual({
      kind: 'ramp',
      name: 'p10vol',
      stops: 18,
    });
    for (const line of [
      'TENMOL_VOLUME ramp p10vol',
      'TENMOL_VOLUME nonsense p10vol 3',
      'TENMOL_VOLUME ramp p10vol x',
      'PyMOL>print("TENMOL_VOLUME ramp p10vol 3")',
      ' Executive: object "vol" created.',
      '',
    ]) {
      expect(parseVolumeEvent(line)).toBeNull();
    }
  });
});

/* ============================================== cmd.volume_panel, engine side */

describe('cmd.volume_panel(name) opens the React window from anywhere', () => {
  it('a marker on the feedback topic opens the editor', () => {
    const off = installVolumeMenuBridge(SESSION);
    expect(dialogsStore.get().windows).toEqual([]);

    feedback(` TENMOL_VOLUME panel ${NAME} 0`);

    const windows = dialogsStore.get().windows;
    expect(windows.map((w) => w.key)).toEqual([`volume:${NAME}`]);
    expect(windows[0]!.title).toBe(`${NAME} - Volume Color Map Editor`);
    expect(isPanelOpen('volume')).toBe(true);
    off();
  });

  it('a second marker for the same name raises the cached window', () => {
    const off = installVolumeMenuBridge(SESSION);
    feedback(`TENMOL_VOLUME panel ${NAME} 0`);
    const first = dialogsStore.get().windows[0]!.z;
    feedback(`TENMOL_VOLUME panel ${NAME} 0`);
    expect(dialogsStore.get().windows).toHaveLength(1);
    expect(dialogsStore.get().windows[0]!.z).toBeGreaterThan(first);
    off();
  });

  it('PROBES before it bootstraps, so a reconnect costs one call', async () => {
    const off = installVolumeMenuBridge(SESSION);
    await act(async () => {});
    // `cmd.tenmol_volume` is already attached (the PyMOL process survived a
    // socket drop), so nothing is imported a second time.
    expect(fns()).toEqual(['cmd.tenmol_volume.status']);

    calls.length = 0;
    for (const listener of [...openListeners]) listener();
    await act(async () => {});
    // A bridge RESTART loses the shim and a socket drop does not, and this side
    // cannot tell them apart — so it re-probes rather than assuming either.
    expect(fns()).toEqual(['cmd.tenmol_volume.status']);
    off();
  });

  it('bootstraps with echo on when the probe says nothing is installed', async () => {
    bridgeMode = 'needs-bootstrap';
    const off = installVolumeMenuBridge(SESSION);
    await act(async () => {});
    expect(fns()).toEqual(['cmd.tenmol_volume.status', 'cmd.do', 'cmd.tenmol_volume.status']);
    expect(calls[1]!.args).toEqual([VOLUME_BOOTSTRAP]);
    // `echo=1` is what turns the marker this module listens for ON; it is a
    // flag rather than a constant because the marker is visible in the user's
    // console and a client that prefers to poll `drain` should not pay for it.
    expect(VOLUME_BOOTSTRAP).toContain('echo=1');
    // `cmd.do(..., echo=0)`: the IMPORT must not appear in the console.
    expect(calls[1]!.kwargs).toEqual({ echo: 0 });

    // ...and it is not attempted again once it worked.
    calls.length = 0;
    const window = await import('./menuBridge');
    expect(await window.ensureVolumeBridge(SESSION)).toBe(true);
    expect(fns()).toEqual([]);
    off();
  });

  it('gives up after three attempts on a bridge that has no module', async () => {
    bridgeMode = 'absent';
    const { ensureVolumeBridge } = await import('./menuBridge');
    for (let i = 0; i < 5; i++) expect(await ensureVolumeBridge(SESSION)).toBe(false);
    // Three tries, each a probe and a failed import, then silence — the rule
    // `shell/settingsTap.ts` established for a bridge that will never answer.
    expect(calls.filter((c) => c.fn === 'cmd.tenmol_volume.status')).toHaveLength(3);
    expect(calls.filter((c) => c.fn === 'cmd.do')).toHaveLength(3);
  });

  it('detaches everything on teardown', () => {
    const off = installVolumeMenuBridge(SESSION);
    off();
    feedback(`TENMOL_VOLUME panel ${NAME} 0`);
    expect(dialogsStore.get().windows).toEqual([]);
  });

  it('opens the panel slot as well as the window, or nothing would draw it', () => {
    expect(isPanelOpen('volume')).toBe(false);
    openVolumeWindow(NAME);
    expect(isPanelOpen('volume')).toBe(true);
  });
});

/* ================================================ volume_ramp_changed */

describe('the open editor tracks changes made outside it', () => {
  it('registers by name on mount and deregisters on unmount', async () => {
    await mountPanel();
    expect(watchState()).toBe('live');
    const watch = calls.find((c) => c.fn === 'cmd.tenmol_volume.watch');
    expect(watch?.args).toEqual([NAME]);
    expect(calls.filter((c) => c.fn === 'cmd.tenmol_volume.unwatch')).toHaveLength(0);

    await act(async () => root.unmount());
    const unwatch = calls.filter((c) => c.fn === 'cmd.tenmol_volume.unwatch');
    expect(unwatch).toHaveLength(1);
    expect(unwatch[0]!.args).toEqual([NAME]);

    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('reloads on an event for ITS name and ignores every other one', async () => {
    const off = installVolumeMenuBridge(SESSION);
    await mountPanel();
    expect(stopCount()).toBe((fixture.ramp as number[]).length / 5);
    expect(remoteCount()).toBe(0);

    // The engine now holds a different ramp — `volume_color vol, rainbow2`
    // typed at the prompt, which is the case `setColors` exists for.
    ramp = [1, 0, 0, 1, 0, 2, 1, 0, 0, 0.3];
    calls.length = 0;

    feedback(`TENMOL_VOLUME ramp ${NAME} 2`);
    for (let i = 0; i < 5; i++) await act(async () => {});

    expect(remoteCount()).toBe(1);
    expect(stopCount()).toBe(2);
    // A reload READS; it must never write, or the panel would fight the engine.
    expect(pushes()).toEqual([]);
    expect(fns()).toContain('volume_color');

    // Another volume's event is not ours.
    calls.length = 0;
    feedback('TENMOL_VOLUME ramp some_other_volume 9');
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(remoteCount()).toBe(1);
    expect(fns()).toEqual([]);

    off();
  });

  it('stops listening once the window is gone', async () => {
    const off = installVolumeMenuBridge(SESSION);
    await mountPanel();
    await act(async () => root.unmount());

    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    calls.length = 0;
    feedback(`TENMOL_VOLUME ramp ${NAME} 2`);
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(fns()).toEqual([]);
    off();
  });

  it('says "untracked" rather than pretending, when the bridge has no module', async () => {
    bridgeMode = 'absent';
    await mountPanel();
    expect(watchState()).toBe('off');
    // It tried, twice, and gave up: probe then bootstrap.
    expect(calls.filter((c) => c.fn === 'cmd.tenmol_volume.status')).toHaveLength(1);
    expect(calls.filter((c) => c.fn === 'cmd.do')).toHaveLength(1);
    expect(calls.filter((c) => c.fn === 'cmd.tenmol_volume.watch')).toHaveLength(0);
    // ...and the editor itself still works: the ramp is loaded and drawn.
    expect(stopCount()).toBe((fixture.ramp as number[]).length / 5);
    expect(document.querySelector('.volpanel__error')).toBeNull();
  });

  it('keys the subscription by name: two windows track independently', async () => {
    const off = installVolumeMenuBridge(SESSION);
    const other = { ...SPEC, key: 'volume:p10other', arg: 'p10other' };
    await mountPanel(other);
    calls.length = 0;

    feedback(`TENMOL_VOLUME ramp ${NAME} 4`);
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(fns()).toEqual([]);
    expect(remoteCount()).toBe(0);

    feedback('TENMOL_VOLUME ramp p10other 4');
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(remoteCount()).toBe(1);
    off();
  });
});

/* ======================================== the loop the shim has to prevent */

describe('the editor does not fight itself', () => {
  it('every push carries _guiupdate: 0, which is what the shim filters on', async () => {
    await mountPanel();
    calls.length = 0;
    // `Reset Data Range` pushes unconditionally (`volume.py:739-746`).
    const reset = document.querySelector('[data-volume-reset]') as HTMLButtonElement;
    await act(async () => reset.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const sent = pushes();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.kwargs).toEqual({ _guiupdate: 0 });
  });
});

/* ================================== the preset list, read from namedramps */

describe('the preset dropdown prefers the direct namedramps getter', () => {
  it('reads cmd.tenmol_volume.ramps and marks what volume_ramp_new added', async () => {
    await mountPanel();
    const select = document.querySelector('[data-volume-preset]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      '',
      '2fofc',
      'esp',
      'fofc',
      'p10extra',
      'rainbow',
      'rainbow2',
    ]);
    // `menu.vol_color` cannot distinguish these; this tier can, and shows it.
    expect([...select.options].map((o) => o.textContent)).toContain('p10extra *');
    const marker = document.querySelector('[data-volume-preset-source]');
    expect(marker?.getAttribute('data-volume-preset-source')).toBe('tenmol_volume.ramps');
    expect(marker?.getAttribute('data-volume-preset-extra')).toBe('1');
    // tier 1 answered, so tier 2 was never called
    expect(fns()).not.toContain('menu.vol_color');
  });

  it('falls back to menu.vol_color, and says which one answered', async () => {
    bridgeMode = 'absent';
    await mountPanel();
    // this double answers `menu.vol_color` with [], so the honest end state is
    // the compiled-in constant — and it is labelled as such.
    expect(fns()).toContain('menu.vol_color');
    expect(
      document
        .querySelector('[data-volume-preset-source]')
        ?.getAttribute('data-volume-preset-source'),
    ).toBe('constant');
    expect(document.querySelector('.volpanel__error')).toBeNull();
  });
});

/* --------------------------------------------------------------------- */

it('the panel never renders the marker as content', async () => {
  await mountPanel();
  expect(document.body.textContent).not.toContain('TENMOL_VOLUME');
});
