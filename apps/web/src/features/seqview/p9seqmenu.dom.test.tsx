/**
 * Row 341, first open item — the two right-click popups.
 *
 * `SeekerClick` (`packages/engine/layer3/Seeker.cpp:357-395`) branches on ONE condition: is
 * there an active selection AND is this column in it (`col->inverse`)? If so,
 * `MenuActivate2Arg(..., "pick_sele", name, name)` on the SELECTION; otherwise
 * `_seeker` is built from the column's atoms and `seq_option` is raised on that.
 * A right click outside any cell takes the first branch (`:330-340`).
 *
 * Until this wave the viewer answered both with a console line saying the popup
 * belonged to WP-13. The popup is now real, and it is the object panel's
 * `RowMenu` — one `pymol.menu` renderer for every surface, as `MenuActivate*`
 * is one entry point in the C.
 *
 * The bridge half (which `pymol.menu` function, on which selection, with which
 * title) is `packages/bridge/tests/test_p9_rest.py`.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelMenuNode, SeqviewPayload } from '@tenmol/protocol';

import { SequenceViewer, graftMenu } from './SequenceViewer';

interface MenuCall {
  action: string;
  args: readonly unknown[];
}

const calls: MenuCall[] = [];
const ran: string[] = [];

let payload: SeqviewPayload;

const menuReply = {
  menu: 'seq_option',
  sele: '_seeker',
  title: '/mol///TRP`2/N',
  items: [
    { code: 2, text: '/mol///TRP`2/', path: [0] },
    { code: 1, text: 'color', path: [1], items: [{ code: 1, text: 'red', path: [1, 0], command: 'cmd.color("red","_seeker")' }] },
    { code: 0, text: '', path: [2] },
    { code: 1, text: 'zoom', path: [3], command: 'cmd.zoom("_seeker",animate=-1)' },
    { code: 1, text: 'lazy one', path: [4], lazy: true },
  ],
};

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (fn === 'cmd.do') return null;
    if (fn === 'cmd.tenmol_seqview') {
      const [action, ...rest] = args as [string, ...unknown[]];
      calls.push({ action, args: rest });
      if (action === 'install') return { installed: true };
      if (action === 'rows') return payload;
      if (action === 'menu') {
        const selected = rest[2] === 1;
        return selected
          ? { menu: 'pick_sele', sele: 'sele01', title: 'sele01', items: [{ code: 1, text: 'disable', path: [0], command: 'cmd.disable("sele01")' }] }
          : menuReply;
      }
      if (action === 'menu_expand') {
        return { path: [4], items: [{ code: 1, text: 'resolved', path: [4, 0], command: 'cmd.x()' }] };
      }
      return { log: '' };
    }
    return null;
  }),
  run: vi.fn(async (line: string) => {
    ran.push(line);
  }),
  poller: { kick: vi.fn() },
  stores: {
    connection: { get: () => ({ phase: 'open' }), subscribe: () => () => {} },
    ui: { get: () => ({ echoActions: false }), subscribe: () => () => {} },
    feedback: { appendClient: vi.fn() },
  },
};

vi.mock('../../app', () => ({
  useSession: () => SESSION,
  useStore: (store: { get: () => unknown }, pick: (s: unknown) => unknown) => pick(store.get()),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function makePayload(selected: boolean, activeSele: string): SeqviewPayload {
  return {
    visible: true,
    location: 0,
    overlay: true,
    format: 0,
    labelMode: 2,
    gapMode: 1,
    fillColor: 104,
    activeSele,
    seleMode: 'byresi',
    colors: { '104': [0.5, 0.5, 0.5] },
    window: { first: 0, count: 1200, max: 1200 },
    rows: [
      {
        object: 'mol',
        objectColor: 0,
        selectable: true,
        first: 0,
        nCols: 2,
        truncated: false,
        labels: [],
        breadcrumbs: [],
        cells: [
          { text: 'W', offset: 0, color: 104, selected, spacer: false, atoms: [1, 2, 3], resn: 'TRP', resi: '2', chain: '', state: 0 },
          { text: 'A', offset: 1, color: 104, selected: false, spacer: false, atoms: [4, 5], resn: 'ALA', resi: '3', chain: '', state: 0 },
        ],
      },
    ],
  } as unknown as SeqviewPayload;
}

beforeEach(() => {
  calls.length = 0;
  ran.length = 0;
  payload = makePayload(false, '');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllTimers();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(<SequenceViewer />);
  });
  for (let i = 0; i < 4; i++) await act(async () => {});
}

const cells = () => [...container.querySelectorAll('.seqcell')] as HTMLElement[];
const popup = () => container.querySelector('[data-testid="rowmenu"]') as HTMLElement | null;

/**
 * jsdom has no `PointerEvent` constructor; React's `onPointerDown` fires for a
 * bubbling `pointerdown` `MouseEvent` all the same, which is what every other
 * pointer test in this tree does (`features/movie/p8movieDrag.dom.test.tsx`).
 */
function press(node: Element, init: MouseEventInit): void {
  act(() => {
    node.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, ...init }),
    );
  });
}

function rightClick(node: Element): void {
  press(node, { button: 2, clientX: 40, clientY: 60 });
}

describe('right click on an UNSELECTED cell', () => {
  it('raises seq_option on that cell`s atoms', async () => {
    await render();
    rightClick(cells()[0]!);
    await act(async () => {});
    await act(async () => {});

    const menu = calls.filter((c) => c.action === 'menu');
    expect(menu).toHaveLength(1);
    // object, the column's atom indices, selected=0
    expect(menu[0]?.args).toEqual(['mol', [1, 2, 3], 0]);
    expect(popup()).not.toBeNull();
    expect(popup()?.textContent).toContain('zoom');
  });

  it('runs the leaf`s command string verbatim and closes', async () => {
    await render();
    rightClick(cells()[0]!);
    await act(async () => {});
    await act(async () => {});

    const leaf = [...container.querySelectorAll('.rowmenu__leaf, .rowmenu__item, button')].find(
      (el) => el.textContent?.trim() === 'zoom',
    ) as HTMLElement;
    expect(leaf).toBeTruthy();
    act(() => leaf.click());
    expect(ran).toEqual(['cmd.zoom("_seeker",animate=-1)']);
    await act(async () => {});
    expect(popup()).toBeNull();
  });
});

describe('right click on a SELECTED cell', () => {
  it('raises pick_sele on the ACTIVE SELECTION instead', async () => {
    payload = makePayload(true, 'sele01');
    await render();
    rightClick(cells()[0]!);
    await act(async () => {});
    await act(async () => {});

    const menu = calls.filter((c) => c.action === 'menu');
    expect(menu).toHaveLength(1);
    // selected=1, and no atom list is needed: the menu is on the selection.
    expect(menu[0]?.args).toEqual(['mol', [1, 2, 3], 1]);
    expect(popup()?.textContent).toContain('disable');
  });
});

describe('right click OUTSIDE any cell', () => {
  it('raises pick_sele with no atoms at all (`Seeker.cpp:330-340`)', async () => {
    payload = makePayload(false, 'sele01');
    await render();
    const strip = container.querySelector('.seqview') as HTMLElement;
    press(strip, { button: 2, clientX: 10, clientY: 10 });
    await act(async () => {});
    await act(async () => {});

    const menu = calls.filter((c) => c.action === 'menu');
    expect(menu).toHaveLength(1);
    expect(menu[0]?.args).toEqual(['', [], 1]);
  });

  it('does NOT raise seq_option there when there is no selection to pick', async () => {
    payload = makePayload(false, '');
    await render();
    const strip = container.querySelector('.seqview') as HTMLElement;
    press(strip, { button: 2, clientX: 10, clientY: 10 });
    await act(async () => {});
    expect(calls.filter((c) => c.action === 'menu')).toHaveLength(0);
    expect(popup()).toBeNull();
  });
});

describe('graftMenu', () => {
  it('replaces a lazy node`s children in place, leaving its siblings alone', () => {
    const items: PanelMenuNode[] = [
      { code: 1, text: 'a', path: [0] },
      { code: 1, text: 'b', path: [1], lazy: true },
    ];
    const out = graftMenu(items, [1], [{ code: 1, text: 'child', path: [1, 0] }]);
    expect(out[0]).toEqual(items[0]);
    expect(out[1]?.lazy).toBe(false);
    expect(out[1]?.items?.map((n) => n.text)).toEqual(['child']);
  });

  it('reaches a nested path', () => {
    const items: PanelMenuNode[] = [
      { code: 1, text: 'a', path: [0], items: [{ code: 1, text: 'inner', path: [0, 0], lazy: true }] },
    ];
    const out = graftMenu(items, [0, 0], [{ code: 1, text: 'deep', path: [0, 0, 0] }]);
    expect(out[0]?.items?.[0]?.items?.map((n) => n.text)).toEqual(['deep']);
  });
});
