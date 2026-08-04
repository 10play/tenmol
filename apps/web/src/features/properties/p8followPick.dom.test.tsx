/**
 * Wave 8 — inventory row 447, "Properties Inspector: header controls".
 *
 * Gap clause: *"no pk1-changed subscription exists, so viewport picks are only
 * picked up on Refresh/open."*
 *
 * There is still no subscription and this file does not pretend otherwise. The
 * `selection` topic accepts a subscription and NOTHING publishes to it —
 * asserted over a live socket in
 * `packages/bridge/tests/test_p8_a10.py::test_the_selection_topic_publishes_nothing_when_pk1_moves`.
 * So the panel polls `cmd.index('?pk1')`, and the three things that make a poll
 * either work or be a disaster are what this file measures:
 *
 *  1. it ADOPTS a pk1 the panel did not set (a viewport pick), with no Refresh;
 *  2. it does NOT adopt the pk1 the panel itself just wrote — `reload()` ends
 *     in `cmd.edit` (upstream's `update_pk1`), so without the `ownPick` guard
 *     the panel would re-read its own write forever, reloading the whole tree
 *     every 600 ms;
 *  3. the checkbox really stops it, and the interval is really torn down on
 *     unmount, because a timer that outlives its panel is a leak that only
 *     shows up as a busy socket.
 *
 * Timers are faked. A real 600 ms wait per assertion would put ~5 s of sleep in
 * the suite and would still be racy.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PropertiesPanel } from './PropertiesPanel';
import type { DialogWindowSpec } from '../dialogs/store';

const SESSION = { call: vi.fn() };
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SPEC: DialogWindowSpec = {
  key: 'properties',
  kind: 'properties',
  arg: '',
  title: 'Properties',
  x: 0,
  y: 0,
  width: 480,
  height: 400,
  z: 1,
  minimised: false,
};

/**
 * A backend with a real pk1: `cmd.edit` moves it and `cmd.index('?pk1')`
 * reports it, which is exactly what the engine does (measured in the bridge
 * test named in the header). Everything else answers the smallest shape the
 * panel accepts.
 */
function engine(initial: { model: string; index: number } | null, objects = ['ala', 'benzene']) {
  const state = { pk1: initial, objects: [...objects] };
  const impl = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    switch (fn) {
      case 'index':
        return state.pk1 ? [[state.pk1.model, state.pk1.index]] : [];
      case 'edit': {
        const [model, index] = String(args[0]).split('`');
        state.pk1 = { model: model!, index: Number(index) };
        return null;
      }
      case 'get_object_list':
        return state.objects;
      case 'get_state':
        return 1;
      case 'get_names':
        return state.pk1 ? ['pk1'] : [];
      case 'get_model':
        return { atom: state.pk1 ? [{ index: state.pk1.index }] : [] };
      case 'count_atoms':
        return 10;
      case 'count_states':
        return 1;
      case 'setting.get_name_list':
      case 'setting.get_index_list':
        return [];
      case 'get_object_ttt':
        return null;
      case 'get_title':
        return '';
      case 'get_object_matrix':
        return null;
      case 'get_object_settings':
        return [];
      case 'tenmol_props.atom_extras':
        return {};
      default:
        return null;
    }
  });
  return { state, impl };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  SESSION.call.mockReset();
  vi.useRealTimers();
});

/** Flush microtasks without letting a timer fire. */
async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Advance past the 120 ms reload debounce and settle. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(130);
  });
  await flush();
}

/** One 600 ms poll tick. */
async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(610);
  });
  await flush();
  // adopting a pick re-arms the 120 ms reload debounce
  await settle();
}

async function mount(back: ReturnType<typeof engine>) {
  SESSION.call.mockImplementation(back.impl);
  await act(async () => {
    root.render(<PropertiesPanel spec={SPEC} />);
  });
  await flush();
  await settle();
  return back;
}

// `<DialogWindow>` does not render inside the container React was given, so
// every query here is document-scoped.
const indexInput = () => document.querySelector('[data-props-index]') as HTMLInputElement;
const modelSelect = () => document.querySelector('[data-props-model]') as HTMLSelectElement;
const followBox = () => document.querySelector('[data-props-follow]') as HTMLInputElement;
const pollCount = () => SESSION.call.mock.calls.filter((c) => c[0] === 'index').length;

describe('the Properties Inspector follows a viewport pick', () => {
  it('adopts a pk1 the panel did not set, with no Refresh', async () => {
    const back = await mount(engine({ model: 'ala', index: 3 }));
    expect(indexInput().value).toBe('3');
    expect(modelSelect().value).toBe('ala');

    // somebody clicked an atom in the viewport
    back.state.pk1 = { model: 'benzene', index: 7 };
    await poll();

    expect(modelSelect().value).toBe('benzene');
    expect(indexInput().value).toBe('7');
  });

  it('an unchanged pk1 costs one call and NOTHING else — no self-triggered reload', async () => {
    // `reload()` ends in `cmd.edit(model, index)` (upstream's `update_pk1`), so
    // every tick reads back a pk1 the panel itself set. That is only harmless
    // because `setModel`/`setIndex` with the value already in state is a React
    // bail-out. A poll that instead called `reload()`, or that re-read the
    // object list unconditionally, would reload the whole tree at 1.7 Hz
    // forever — so what is pinned is the TRAFFIC, not an internal flag.
    const back = await mount(engine({ model: 'ala', index: 3 }));
    SESSION.call.mockClear();

    await poll();
    await poll();
    await poll();

    expect(SESSION.call.mock.calls.map((c) => c[0])).toEqual(['index', 'index', 'index']);
    expect(back.state.pk1).toEqual({ model: 'ala', index: 3 });
  });

  it('costs ONE call per tick, and it is `index` with the ?-guarded selection', async () => {
    await mount(engine({ model: 'ala', index: 3 }));
    SESSION.call.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(610);
    });
    await flush();

    expect(SESSION.call.mock.calls).toHaveLength(1);
    // the `?` is load-bearing: bare `pk1` raises ' Error: invalid selection'
    // when nothing is picked, so every tick of an unpicked session would be an
    // error frame.
    expect(SESSION.call.mock.calls[0]).toEqual(['index', ['?pk1']]);
  });

  it('tolerates an unpicked session: [] is not an error and changes nothing', async () => {
    const back = await mount(engine(null));
    const model = modelSelect().value;
    await poll();
    await poll();
    expect(modelSelect().value).toBe(model);
    expect(document.querySelector('.props__error')).toBeNull();
    expect(back.state.pk1).not.toBeNull(); // reload() set it; the poll did not
  });

  it('unchecking the box stops the poll', async () => {
    const back = await mount(engine({ model: 'ala', index: 3 }));
    await act(async () => {
      followBox().click();
    });
    expect(followBox().checked).toBe(false);
    SESSION.call.mockClear();

    back.state.pk1 = { model: 'benzene', index: 7 };
    await poll();
    await poll();

    expect(pollCount()).toBe(0);
    expect(modelSelect().value).toBe('ala');
    expect(indexInput().value).toBe('3');

    // ...and re-checking it catches up on the next tick
    await act(async () => {
      followBox().click();
    });
    await poll();
    expect(indexInput().value).toBe('7');
  });

  it('clears the interval on unmount', async () => {
    await mount(engine({ model: 'ala', index: 3 }));
    await act(() => root.unmount());
    SESSION.call.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(SESSION.call).not.toHaveBeenCalled();

    // the afterEach unmount must not throw on an already-unmounted root
    root = createRoot(container);
  });

  it('a pick in an object created after the panel opened re-reads the object list', async () => {
    const back = await mount(engine({ model: 'ala', index: 3 }, ['ala']));
    expect(Array.from(modelSelect().options).map((o) => o.value)).toEqual(['ala']);

    back.state.objects = ['ala', 'newobj'];
    back.state.pk1 = { model: 'newobj', index: 2 };
    await poll();

    expect(Array.from(modelSelect().options).map((o) => o.value)).toEqual(['ala', 'newobj']);
    expect(modelSelect().value).toBe('newobj');
  });
});
