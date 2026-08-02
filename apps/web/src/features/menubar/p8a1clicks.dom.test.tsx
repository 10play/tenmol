/**
 * The leaves that were harvested and asserted, but never CLICKED.
 *
 * Parity rows 63 and 68 both ended with the same complaint: the Build ▸
 * Sculpting submenu, the valence/charge command strings and the nine Mouse
 * "ring" commands were proved to resolve in the engine by pytest, and proved to
 * render by the tree tests, but nothing had ever pressed them — so the wiring
 * between the two (does `onPick` route a `do` to `session.run` and a `call` to
 * `session.call`? does a radio become `cmd.set(name, value, log=1, quiet=0)`?)
 * was untested for exactly these items.
 *
 * Every label and every command string below comes from the harvested tree
 * (`generated/menudata.ts` <- `packages/engine/modules/pymol/_gui.py:196-233` and `:806-829`),
 * looked up rather than retyped, so this cannot drift from upstream silently.
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
import type { MenuNode } from '@tenmol/protocol/topics/menus';
import { SessionContext, type Session } from '../../app';
import { resetPanelHooks } from '../../shell/panelHooks';
import { MENU_DATA } from './generated/menudata';
import { MenuBar } from './MenuBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let ran: string[];
let calls: Array<{ fn: string; args: readonly unknown[]; kwargs: Record<string, unknown> }>;

function makeSession(): Session {
  const stores = {
    connection: createConnectionStore('ws://test/ws', true),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    ui: createUiStore(null),
  };
  return {
    config: {} as Session['config'],
    conn: { sendInput: vi.fn(), isOpen: true, do: () => Promise.reject(new Error('offline')) },
    stores,
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: (line: string) => {
      ran.push(line);
      return Promise.resolve();
    },
    act: vi.fn(),
    call: (fn: string, args: readonly unknown[] = [], kwargs: Record<string, unknown> = {}) => {
      calls.push({ fn, args, kwargs });
      // `tenmol_menus` is the settings batch the menu fetches on open; refusing
      // it keeps the fixture offline and exercises the per-setting fallback.
      return Promise.reject(new Error('offline'));
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

/* --------------------------------------------------------------- helpers */

function mount(): void {
  act(() =>
    root.render(
      <SessionContext.Provider value={makeSession()}>
        <MenuBar />
      </SessionContext.Provider>,
    ),
  );
}

function openMenu(label: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no menu ${label}`);
  act(() => button.click());
}

/**
 * Rows of the INNERMOST open list.
 *
 * `Build ▸ Sculpting` is a submenu row whose own body contains a check called
 * `Sculpting` too, so a document-wide search by label picks the wrong one — and
 * picks a `<div>`, which has no `disabled`. Qt has the same two items and the
 * user disambiguates them by depth; so does this.
 */
function rowsIn(scope: ParentNode): HTMLElement[] {
  const lists = [...scope.querySelectorAll<HTMLElement>('.menu')];
  const innermost = lists.at(-1) ?? scope;
  return [...innermost.querySelectorAll<HTMLElement>('.menu__row')];
}

function hover(label: string): void {
  const found = rowsIn(container).find(
    (el) => el.querySelector('.menu__label')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no submenu row ${label}`);
  act(() => {
    found.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
}

function click(label: string): void {
  const found = rowsIn(container).find(
    (el) => el.querySelector('.menu__label')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no leaf ${JSON.stringify(label)}`);
  expect((found as HTMLButtonElement).disabled, `${label} is disabled`).toBe(false);
  act(() => (found as HTMLButtonElement).click());
}

/** The harvested subtree, so expectations are read from the tree not retyped. */
function submenu(top: string, path: readonly string[]): MenuNode[] {
  const found = MENU_DATA.menus.find((m) => m.kind === 'submenu' && m.label === top);
  if (!found || found.kind !== 'submenu') throw new Error(`no menu ${top}`);
  let items: MenuNode[] = found.items;
  for (const step of path) {
    const next = items.find((n) => n.kind === 'submenu' && n.label === step);
    if (!next || next.kind !== 'submenu') throw new Error(`no submenu ${step}`);
    items = next.items;
  }
  return items;
}

function commandOf(items: readonly MenuNode[], label: string): string {
  const node = items.find((n) => n.kind === 'command' && n.label.startsWith(label));
  if (!node || node.kind !== 'command' || node.action.type !== 'do') {
    throw new Error(`${label} is not a command string`);
  }
  return node.action.command;
}

beforeEach(() => {
  ran = [];
  calls = [];
  resetPanelHooks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetPanelHooks();
});

/* ------------------------------------------------------------------ *
 * Row 63 — Build ▸ Sculpting, and the valence / charge strings
 * ------------------------------------------------------------------ */

describe('Build ▸ Sculpting (row 63)', () => {
  it('Activate and Deactivate send the literal command strings', () => {
    const items = submenu('Build', ['Sculpting']);
    mount();
    openMenu('Build');
    hover('Sculpting');
    click('Activate');
    expect(ran).toEqual(['sculpt_activate all']);
    expect(ran[0]).toBe(commandOf(items, 'Activate'));

    openMenu('Build');
    hover('Sculpting');
    click('Deactivate');
    expect(ran).toEqual(['sculpt_activate all', 'sculpt_deactivate all']);
  });

  it('Clear Memory is a CALLABLE upstream and goes out as a silent call', () => {
    // `('command', 'Clear Memory', cmd.sculpt_purge)` — a callable, so Qt
    // invokes it directly and PyMOL echoes nothing. It must not become a
    // command line, or the console would show a `PyMOL>` line Qt never shows.
    mount();
    openMenu('Build');
    hover('Sculpting');
    click('Clear Memory');
    expect(ran).toEqual([]);
    expect(calls.filter((c) => c.fn === 'cmd.sculpt_purge')).toHaveLength(1);
  });

  it('the two checks toggle their settings the way SettingAction does', () => {
    mount();
    openMenu('Build');
    hover('Sculpting');
    // No live value (the fixture is offline), so "checked" is false and the
    // click writes the TRUE value — `action.setChecked(v != false_value)`.
    click('Auto-Sculpting');
    expect(calls.filter((c) => c.fn === 'cmd.set')).toEqual([
      { fn: 'cmd.set', args: ['auto_sculpt', 1], kwargs: { log: 1, quiet: 0 } },
    ]);

    openMenu('Build');
    hover('Sculpting');
    click('Sculpting');
    expect(calls.filter((c) => c.fn === 'cmd.set').at(-1)).toEqual({
      fn: 'cmd.set',
      args: ['sculpting', 1],
      kwargs: { log: 1, quiet: 0 },
    });
  });

  it('every cycles radio writes its own value, 1..1000', () => {
    const radios = submenu('Build', ['Sculpting']).filter(
      (n) => n.kind === 'radio' && n.setting === 'sculpting_cycles',
    );
    expect(radios).toHaveLength(7);

    for (const node of radios) {
      if (node.kind !== 'radio') continue;
      mount();
      openMenu('Build');
      hover('Sculpting');
      click(node.label);
      expect(calls.filter((c) => c.fn === 'cmd.set').at(-1)).toEqual({
        fn: 'cmd.set',
        args: ['sculpting_cycles', node.value],
        kwargs: { log: 1, quiet: 0 },
      });
      act(() => root.unmount());
      root = createRoot(container);
    }
    expect(calls.filter((c) => c.fn === 'cmd.set').map((c) => c.args[1])).toEqual([
      1, 3, 10, 33, 100, 333, 1000,
    ]);
  });

  it('the field-mask radios keep the NEGATIVE values ~(0x20|0x40) produces', () => {
    // `~(0x20 | 0x40)` is -97 and `~(0x40 | 0x80)` is -193 in Python. A client
    // that "tidied" these into 0x9F / 0x3F would silently sculpt with a
    // different term set, so both are clicked and pinned.
    mount();
    openMenu('Build');
    hover('Sculpting');
    click('All Except VDW');
    expect(calls.filter((c) => c.fn === 'cmd.set').at(-1)?.args).toEqual([
      'sculpt_field_mask',
      -97,
    ]);

    openMenu('Build');
    hover('Sculpting');
    click('All Except 1-4 VDW and Torsions');
    expect(calls.filter((c) => c.fn === 'cmd.set').at(-1)?.args).toEqual([
      'sculpt_field_mask',
      -193,
    ]);

    openMenu('Build');
    hover('Sculpting');
    click('All Terms');
    expect(calls.filter((c) => c.fn === 'cmd.set').at(-1)?.args).toEqual([
      'sculpt_field_mask',
      255,
    ]);
  });
});

describe('Build ▸ the valence and charge commands (row 63)', () => {
  const build = () => submenu('Build', []);

  it('send exactly the upstream command strings', () => {
    const expected: Array<[string, string]> = [
      ['Cycle Bond Valence', 'cycle_valence'],
      ['Fill Hydrogens on (pk1)', 'h_fill'],
      ['Invert (pk2)-(pk1)-(pk3)', 'invert'],
      ['Create Bond (pk1)-(pk2)', 'bond'],
      ['Remove (pk1)', 'remove pk1'],
      ['Make (pk1) Positive', 'alter pk1, formal_charge=1'],
      ['Make (pk1) Negative', 'alter pk1, formal_charge=-1'],
      ['Make (pk1) Neutral', 'alter pk1, formal_charge=0'],
    ];

    mount();
    for (const [label] of expected) {
      openMenu('Build');
      // The accelerator is split out of the label, so the visible text is the
      // bare name (`baseLabel`).
      click(label);
    }
    expect(ran).toEqual(expected.map(([, command]) => command));
    // …and the same strings really are what the harvest holds.
    for (const [label, command] of expected) {
      expect(commandOf(build(), label), label).toBe(command);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Row 68 — the Mouse ring commands and the three checks
 * ------------------------------------------------------------------ */

describe('Mouse ▸ the nine ring commands (row 68)', () => {
  it('five go to cmd.config_mouse and four to the INTERNAL cmd.mouse', () => {
    const items = submenu('Mouse', []);
    const expected: Array<[label: string, fn: string, arg: string]> = [
      ['3 Button Motions', 'cmd.config_mouse', 'three_button_motions'],
      ['3 Button Editing', 'cmd.config_mouse', 'three_button_editing'],
      ['3 Button Viewing', 'cmd.mouse', 'three_button_viewing'],
      ['3 Button Lights', 'cmd.mouse', 'three_button_lights'],
      ['3 Button All Modes', 'cmd.config_mouse', 'three_button_all_modes'],
      ['2 Button Editing', 'cmd.config_mouse', 'two_button_editing'],
      ['2 Button Viewing', 'cmd.config_mouse', 'two_button'],
      ['1 Button Viewing Mode', 'cmd.mouse', 'one_button_viewing'],
      ['Emulate Maestro', 'cmd.mouse', 'three_button_maestro'],
    ];

    mount();
    for (const [label] of expected) {
      openMenu('Mouse');
      click(label);
    }

    expect(calls.filter((c) => c.fn === 'cmd.config_mouse' || c.fn === 'cmd.mouse')).toEqual(
      expected.map(([, fn, arg]) => ({ fn, args: [arg], kwargs: {} })),
    );
    expect(ran).toEqual([]); // callables upstream: silent, no `PyMOL>` echo

    // The labels above are looked up in the harvest too, so a renamed leaf
    // fails here rather than silently dropping a button.
    for (const [label] of expected) {
      expect(
        items.some((n) => n.kind === 'command' && n.label === label),
        label,
      ).toBe(true);
    }
  });

  it('the three checks write their settings', () => {
    mount();
    for (const setting of ['virtual_trackball', 'mouse_grid', 'roving_origin']) {
      const node = submenu('Mouse', []).find((n) => n.kind === 'check' && n.setting === setting);
      if (!node || node.kind !== 'check') throw new Error(`no check for ${setting}`);
      openMenu('Mouse');
      click(node.label);
      expect(calls.filter((c) => c.fn === 'cmd.set').at(-1)).toEqual({
        fn: 'cmd.set',
        args: [setting, node.trueValue],
        kwargs: { log: 1, quiet: 0 },
      });
    }
  });

  it('the selection-mode radios cover all seven modes', () => {
    const modes = submenu('Mouse', ['Selection Mode']);
    expect(modes).toHaveLength(7);
    mount();
    for (const node of modes) {
      if (node.kind !== 'radio') throw new Error('not a radio');
      openMenu('Mouse');
      hover('Selection Mode');
      click(node.label);
      expect(calls.filter((c) => c.fn === 'cmd.set').at(-1)).toEqual({
        fn: 'cmd.set',
        args: ['mouse_selection_mode', node.value],
        kwargs: { log: 1, quiet: 0 },
      });
    }
    expect(calls.filter((c) => c.fn === 'cmd.set').map((c) => c.args[1])).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });
});
