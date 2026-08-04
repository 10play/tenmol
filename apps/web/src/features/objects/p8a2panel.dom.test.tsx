/**
 * Wave 8 — the object panel rendered and clicked, not just its helpers.
 *
 * Three inventory gaps are closed here, all of them "the pure function is
 * tested but the COMPONENT is not":
 *
 *  * the pressed 0.7 fill and `getNameColor`'s within-0.1 fallback are read off
 *    the real elements, so a row whose colour matches its own button really
 *    does drop back to the default;
 *  * the M button's tint follows `specLevels` from the snapshot;
 *  * every modifier combination `CExecutive::click` distinguishes is dispatched
 *    as a real `PointerEvent` on the real row button and the resulting `cmd.*`
 *    calls are compared against `Executive.cpp:15260-15332`.
 *
 * The snapshot fixture is the shape `cmd.tenmol_objects('snapshot')` answers.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectionStore, createObjectsStore } from '@tenmol/stores';
import type { PanelAction } from '@tenmol/stores';
import { SessionContext, type Session } from '../../app';
import { ObjectPanel } from './ObjectPanel';
import { SPEC_FILL_CSS } from './specLevel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let acted: PanelAction[];
let snapshot: Record<string, unknown>;

function row(over: Record<string, unknown> = {}) {
  return {
    name: 'ala',
    type: 'object:molecule',
    enabled: true,
    group: '',
    nest: 0,
    isGroup: false,
    isOpen: false,
    isAll: false,
    reps: 1 << 7,
    repIndices: [7],
    color: 5,
    caption: '',
    ...over,
  };
}

/** `panels/objects.py:rows` always emits the synthetic `all` row first. */
const ALL_ROW = {
  name: 'all',
  type: 'all',
  enabled: true,
  group: '',
  nest: 0,
  isGroup: false,
  isOpen: false,
  isAll: true,
  reps: 0,
  repIndices: [],
  color: null,
  caption: '',
};

function baseSnapshot(rows: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    rows: [ALL_ROW, ...rows],
    opCount: 6,
    buttonMode: '3-Button Motions',
    ops: ['A', 'S', 'H', 'L', 'C', 'M'],
    settings: {
      group_full_member_names: 0,
      group_arrow_prefix: 0,
      internal_gui_name_color_mode: 0,
      internal_gui_control_size: 18,
      internal_gui_width: 220,
      hide_underscore_names: 1,
    },
    ...extra,
  };
}

function makeSession(): Session {
  const stores = {
    connection: createConnectionStore('ws://test/ws', true),
    objects: createObjectsStore(),
  };
  stores.connection.setPhase?.('open');
  return {
    conn: { do: vi.fn(async () => undefined), isOpen: true } as unknown as Session['conn'],
    stores,
    run: vi.fn(async () => undefined),
    act: vi.fn(async (action: PanelAction) => {
      acted.push(action);
    }),
    call: vi.fn(async (fn: string, args: readonly unknown[] = []) => {
      if (fn === 'tenmol_objects' && args[0] === 'snapshot') return snapshot;
      return null;
    }),
  } as unknown as Session;
}

let session: Session;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <SessionContext.Provider value={session}>
        <ObjectPanel />
      </SessionContext.Provider>,
    );
  });
  // let the snapshot poll resolve
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  acted = [];
  snapshot = baseSnapshot([row()]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  session = makeSession();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function rows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.objrow')];
}

function nameButton(index: number): HTMLElement {
  const el = rows()[index]?.querySelector<HTMLElement>('.objrow__name');
  if (!el) throw new Error(`no name button at row ${index}`);
  return el;
}

/**
 * jsdom has no `PointerEvent` constructor. React's synthetic pointer events
 * read only the `MouseEvent` fields plus `pointerId`, so a `MouseEvent` with
 * `pointerId` defined IS the event the component sees (the same shape
 * `features/volume/rangeZoom.dom.test.tsx` and `packages/viewport` use).
 */
function pointer(el: HTMLElement, type: string, init: MouseEventInit): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    el.dispatchEvent(event);
  });
}

/** `cmd.<fn>(<args>)` for every action the panel dispatched, in order. */
function emitted(): string[] {
  return acted.map((action) => `${action.fn}(${(action.args ?? []).join(',')})`);
}

/* ------------------------------------------------------------------ *
 * fills and name colour (Executive.cpp:16443-16469)
 * ------------------------------------------------------------------ */

describe('row fills', () => {
  it('reports its state as a data attribute, disabled/enabled/cloaked', async () => {
    snapshot = baseSnapshot([
      row({ name: 'grp', type: 'object:group', isGroup: true, isOpen: true, enabled: false }),
      row({ name: 'inside', group: 'grp', nest: 1, enabled: true }),
      row({ name: 'off', enabled: false }),
      row({ name: 'on', enabled: true }),
    ]);
    await mount();
    const byName = Object.fromEntries(
      rows().map((el) => [
        el.querySelector('.objrow__name-text')?.textContent,
        el.getAttribute('data-fill'),
      ]),
    );
    expect(byName).toMatchObject({
      all: 'enabled',
      grp: 'disabled',
      inside: 'cloaked',
      off: 'disabled',
      on: 'enabled',
    });
  });

  it('a left press marks the whole band pressed (0.7), and release clears it', async () => {
    snapshot = baseSnapshot([row({ name: 'a' }), row({ name: 'b' })]);
    await mount();
    expect(rows()[1]?.getAttribute('data-fill')).toBe('enabled');
    pointer(nameButton(1), 'pointerdown', { button: 0 });
    expect(rows()[1]?.getAttribute('data-fill')).toBe('pressed');
    expect(rows()[1]?.className).toContain('is-pressed');
    pointer(nameButton(1), 'pointerup', { button: 0 });
    expect(rows()[1]?.getAttribute('data-fill')).toBe('enabled');
  });
});

describe('internal_gui_name_color_mode', () => {
  it('uses the object colour when it is far from the row fill', async () => {
    snapshot = baseSnapshot([row({ name: 'red', nameColor: [1, 0, 0] })]);
    await mount();
    expect(nameButton(1).style.color).toBe('rgb(255, 0, 0)');
  });

  it('drops back to the default when the colour is within 0.1 of the fill', async () => {
    // grey50 on an ENABLED row: the fill is also {0.5,0.5,0.5}, so PyMOL draws
    // the name in TextColor and not in the object colour.
    snapshot = baseSnapshot([row({ name: 'grey', nameColor: [0.5, 0.5, 0.5] })]);
    await mount();
    expect(nameButton(1).style.color).toBe('');
  });

  it('the same grey IS used on a disabled row', async () => {
    snapshot = baseSnapshot([row({ name: 'grey', enabled: false, nameColor: [0.5, 0.5, 0.5] })]);
    await mount();
    expect(nameButton(1).style.color).toBe('rgb(128, 128, 128)');
  });
});

/* ------------------------------------------------------------------ *
 * the M button's motion tint (Executive.cpp:16362-16381)
 * ------------------------------------------------------------------ */

describe('M button spec level', () => {
  const mButton = (index: number) =>
    rows()[index]?.querySelector<HTMLElement>('.objrow__op--m') as HTMLElement;

  it('is untinted with no motion at all', async () => {
    snapshot = baseSnapshot([row({ name: 'ala' })], { specLevels: { ala: -1 } });
    await mount();
    expect(mButton(1).getAttribute('data-spec')).toBe('none');
  });

  it('level 1 (interpolated) and level 2 (key frame) are different classes', async () => {
    snapshot = baseSnapshot([row({ name: 'ala' }), row({ name: 'trp' })], {
      specLevels: { ala: 1, trp: 2 },
    });
    await mount();
    expect(mButton(1).getAttribute('data-spec')).toBe('interp');
    expect(mButton(2).getAttribute('data-spec')).toBe('key');
    expect(mButton(2).className).toContain('is-spec-key');
    expect(mButton(2).title).toContain('spec level 2 (key frame)');
    // the three fills PyMOL uses, for the record
    expect(SPEC_FILL_CSS.key).toBe('rgb(230, 230, 255)');
  });

  it('only the M button is tinted', async () => {
    snapshot = baseSnapshot([row({ name: 'ala' })], { specLevels: { ala: 2 } });
    await mount();
    const tinted = [...container.querySelectorAll('[data-spec]')].map((el) => el.textContent);
    expect(tinted).toEqual(['M', 'M']); // the `all` row and `ala`
  });
});

/* ------------------------------------------------------------------ *
 * click / drag semantics (Executive.cpp:15260-15332)
 * ------------------------------------------------------------------ */

describe('modifier matrix on a real row button', () => {
  beforeEach(() => {
    snapshot = baseSnapshot([row({ name: 'a', enabled: false }), row({ name: 'b' })]);
  });

  it('plain left is DEFERRED — nothing happens until the release', async () => {
    await mount();
    pointer(nameButton(1), 'pointerdown', { button: 0 });
    expect(emitted()).toEqual([]);
    pointer(nameButton(1), 'pointerup', { button: 0 });
    expect(emitted()).toEqual(['enable(a)']);
  });

  it('shift+left is IMMEDIATE — it lands on the press', async () => {
    await mount();
    pointer(nameButton(1), 'pointerdown', { button: 0, shiftKey: true });
    expect(emitted()).toEqual(['enable(a)']);
    pointer(nameButton(1), 'pointerup', { button: 0, shiftKey: true });
    expect(emitted()).toEqual(['enable(a)']); // and NOT a second time on release
  });

  it('ctrl+left hover-activates: enable only, no zoom', async () => {
    await mount();
    pointer(nameButton(1), 'pointerdown', { button: 0, ctrlKey: true });
    expect(emitted()).toEqual(['enable(a)']);
  });

  it('ctrl+shift+left hover-activates AND zooms', async () => {
    await mount();
    pointer(nameButton(1), 'pointerdown', { button: 0, ctrlKey: true, shiftKey: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(emitted()).toEqual(['enable(a)', 'zoom(a)']);
  });

  it('middle centers and activates', async () => {
    await mount();
    pointer(nameButton(1), 'pointerdown', { button: 1 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(emitted()).toEqual(['center(a)', 'enable(a)']);
  });

  it('ctrl+middle zooms and activates', async () => {
    await mount();
    pointer(nameButton(1), 'pointerdown', { button: 1, ctrlKey: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(emitted()).toEqual(['zoom(a)', 'enable(a)']);
  });

  it('ctrl+shift+middle disables everything then enables only this row', async () => {
    await mount();
    pointer(nameButton(1), 'pointerdown', { button: 1, ctrlKey: true, shiftKey: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(emitted()).toEqual(['disable(all)', 'enable(a)', 'zoom(a)']);
  });

  it('an already-enabled row is not enabled a second time by the middle button', async () => {
    await mount();
    pointer(nameButton(2), 'pointerdown', { button: 1 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(emitted()).toEqual(['center(b)']);
  });

  it('right-drag emits `order`, never a visibility change', async () => {
    await mount();
    const list = container.querySelector('.objpanel__rows') as HTMLElement;
    list.getBoundingClientRect = () =>
      ({ top: 0, left: 0, bottom: 100, right: 200, width: 200, height: 100 }) as DOMRect;
    pointer(nameButton(1), 'pointerdown', { button: 2 });
    pointer(list, 'pointermove', { button: 2, clientY: 2 * 18 + 4 });
    pointer(list, 'pointerup', { button: 2 });
    expect(emitted()).toEqual(['order(b a)']);
    expect(acted[0]?.kwargs).toEqual({ location: 'current' });
  });
});
