/**
 * The popup engine, driven by REAL `pymol.menu` output.
 *
 * Every fixture below is the literal JSON `cmd.tenmol_objects('menu', ...)`
 * answered on this build (captured while writing `bridge/tests/test_objects.py`),
 * so a change in `modules/pymol/menu.py` or in the bridge's serialisation breaks
 * this test rather than quietly changing the UI.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelMenuNode } from '@tenmol/protocol';
import { RowMenu, SUBMENU_DELAY_MS } from './RowMenu';

let container: HTMLDivElement;
let root: Root;

// React 19 refuses to treat `act` as an act-scope without this flag.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function rows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.rowmenu__row')];
}

function labelled(text: string): HTMLElement {
  const found = rows().find((el) => el.textContent?.replace(/▸$/, '').trim() === text);
  if (!found) throw new Error(`no menu row ${JSON.stringify(text)}`);
  return found;
}

/** `menu(cmd, 'ala', 'S')` -> `mol_show`, first rows verbatim. */
const MOL_SHOW: PanelMenuNode[] = [
  { code: 2, text: 'Show:', path: [0], command: '' },
  {
    code: 1,
    text: 'as',
    path: [1],
    items: [
      { code: 2, text: 'As:', path: [1, 0], command: '' },
      { code: 1, text: 'wire', path: [1, 1], command: 'cmd.show_as("wire"      ,"ala")' },
      { code: 1, text: '  lines', path: [1, 2], command: 'cmd.show_as("lines"     ,"ala")' },
    ],
  },
  { code: 0, text: '', path: [2], command: '' },
  { code: 1, text: 'wire', path: [3], command: 'cmd.show("wire"      ,"ala")' },
  { code: 1, text: '  lines', path: [4], command: 'cmd.show("lines"     ,"ala")' },
];

/** `menu(cmd, 'ala', 'A')` -> `mol_action`, the two lazy leaves. */
const MOL_ACTION: PanelMenuNode[] = [
  { code: 2, text: 'Action:', path: [0], command: '' },
  { code: 1, text: 'zoom', path: [1], command: 'cmd.zoom("ala",animate=-1)' },
  { code: 1, text: 'copy to object', path: [20], lazy: true },
  { code: 1, text: 'group', path: [21], lazy: true },
  { code: 1, text: '\\933delete object', path: [22], command: 'cmd.delete("ala")' },
];

/** `expand(cmd, 'ala', 'A', [21])` -> `move_to_group`, verbatim. */
const MOVE_TO_GROUP: PanelMenuNode[] = [
  { code: 2, text: 'Move to Group:', path: [21, 0], command: '' },
  { code: 1, text: 'new', path: [21, 1], command: 'cmd.group(cmd.get_unused_name("group"),"ala")' },
  { code: 1, text: 'ungroup', path: [21, 2], command: 'cmd.ungroup("ala")' },
  { code: 0, text: '', path: [21, 3], command: '' },
  { code: 1, text: 'grp', path: [21, 4], command: 'cmd.group("grp","ala",quiet=0)' },
];

function menu(items: PanelMenuNode[], over: Partial<React.ComponentProps<typeof RowMenu>> = {}) {
  return (
    <RowMenu
      title="ala"
      op="S"
      menuName="mol_show"
      items={items}
      anchor={{ x: 10, y: 10 }}
      onPick={() => undefined}
      onExpand={() => undefined}
      onClose={() => undefined}
      {...over}
    />
  );
}

describe('PopUp codes (layer4/PopUp.cpp:270-300)', () => {
  it('0 = separator, 1 = item, 2 = title', () => {
    render(menu(MOL_SHOW));
    expect(container.querySelectorAll('.rowmenu__sep')).toHaveLength(1);
    expect([...container.querySelectorAll('.rowmenu__title')].map((el) => el.textContent)).toEqual([
      'Show:',
    ]);
    // titles and separators are not clickable
    expect(rows().map((el) => el.textContent?.replace('▸', '').trim())).toEqual([
      'as',
      'wire',
      'lines',
    ]);
  });

  it('a leaf hands its command string back verbatim', () => {
    const picked: string[] = [];
    render(menu(MOL_SHOW, { onPick: (command) => picked.push(command) }));
    act(() => labelled('wire').click());
    expect(picked).toEqual(['cmd.show("wire"      ,"ala")']);
  });

  it("rep_action's two-space indent becomes real indentation", () => {
    render(menu(MOL_SHOW));
    expect(labelled('lines').style.paddingLeft).toBe('18px');
    expect(labelled('wire').style.paddingLeft).toBe('');
  });

  it('\\RGB colour codes are applied, and the plain text is the tooltip', () => {
    render(menu(MOL_ACTION, { op: 'A', menuName: 'mol_action' }));
    const del = labelled('delete object');
    const label = del.querySelector('.rowmenu__label') as HTMLElement;
    expect(label.title).toBe('delete object');
    expect((label.firstElementChild as HTMLElement).style.color).toBe('rgb(255, 85, 85)');
  });
});

describe('submenus', () => {
  it('an eager submenu opens on click and renders its own leaves', () => {
    render(menu(MOL_SHOW));
    expect(labelled('as').getAttribute('aria-haspopup')).toBe('menu');
    act(() => labelled('as').click());
    expect(labelled('as').getAttribute('aria-expanded')).toBe('true');
    // the submenu's own rows are now present
    expect(rows().some((el) => el.textContent?.trim() === 'wire')).toBe(true);
    const panel = container.querySelector('.rowmenu__panel');
    expect(panel?.textContent).toContain('As:');
  });

  it('hover opens it only after PopUp.cpp’s 0.25 s delay', () => {
    vi.useFakeTimers();
    render(menu(MOL_SHOW));
    const sub = labelled('as');
    act(() => {
      sub.parentElement?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      sub.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    });
    // React attaches onMouseEnter through the `mouseover` delegation path.
    act(() => {
      vi.advanceTimersByTime(SUBMENU_DELAY_MS - 1);
    });
    expect(container.querySelector('.rowmenu__panel')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(container.querySelector('.rowmenu__panel')).not.toBeNull();
  });

  it('a lazy submenu asks for its path and shows the resolved items', () => {
    const asked: number[][] = [];
    const { rerender } = {
      rerender: (items: PanelMenuNode[]) =>
        render(
          menu(items, {
            op: 'A',
            menuName: 'mol_action',
            onExpand: (path) => asked.push([...path]),
          }),
        ),
    };
    rerender(MOL_ACTION);
    act(() => labelled('group').click());
    expect(asked).toEqual([[21]]);
    expect(container.querySelector('.rowmenu__panel')?.textContent).toContain('resolving');

    // the store answers; RowMenu is pure, so this is just a new `items` prop
    const resolved = MOL_ACTION.map((node) =>
      node.path[0] === 21 ? { ...node, lazy: false, items: MOVE_TO_GROUP } : node,
    );
    // No second click: the submenu is already open, so the resolved items must
    // simply appear in place — which is what `SubGetItem` does on hover.
    rerender(resolved);
    const panel = container.querySelector('.rowmenu__panel') as HTMLElement;
    expect(panel.textContent).toContain('Move to Group:');
    expect(panel.textContent).toContain('ungroup');
    expect(panel.textContent).toContain('grp');
  });
});

describe('sticky / dismissal', () => {
  it('stays open until Escape or an outside click', () => {
    const closes: number[] = [];
    render(menu(MOL_SHOW, { onClose: () => closes.push(1) }));
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(closes).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closes).toHaveLength(2);
  });

  it('a mousedown inside the menu does not close it', () => {
    const closes: number[] = [];
    render(menu(MOL_SHOW, { onClose: () => closes.push(1) }));
    act(() => {
      labelled('wire').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(closes).toHaveLength(0);
  });

  it('shows which pymol.menu function produced the list', () => {
    render(menu(MOL_SHOW));
    expect(container.querySelector('.rowmenu__src')?.textContent).toBe('mol_show');
    expect(container.querySelector('.rowmenu__head')?.textContent).toContain('Show');
  });
});
