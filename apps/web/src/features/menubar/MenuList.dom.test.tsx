/**
 * The renderer, driven by the REAL harvested tree.
 *
 * These are the four rules a menu bar has to get right and that a pure-logic
 * test cannot see: a tick appears only when the setting says so, a radio dot
 * follows `values[0]`, an unbuilt hook renders DISABLED and names its owner,
 * and a submenu opens on hover rather than needing a click.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { walkMenu, type MenuNode, type MenuSettingValue } from '@tenmol/protocol/topics/menus';
import { MENU_DATA } from './generated/menudata';
import { MenuList } from './MenuList';
import { HOOK_OWNERS, UNAVAILABLE_HOOKS } from './model';

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
});

/** The real subtree of one top-level menu. */
function menu(label: string): MenuNode[] {
  const found = MENU_DATA.menus.find((m) => m.kind === 'submenu' && m.label === label);
  if (!found || found.kind !== 'submenu') throw new Error(`no menu ${label}`);
  return found.items;
}

function submenu(top: string, path: string[]): MenuNode[] {
  let items = menu(top);
  for (const step of path) {
    const next = items.find((n) => n.kind === 'submenu' && n.label === step);
    if (!next || next.kind !== 'submenu') throw new Error(`no submenu ${step}`);
    items = next.items;
  }
  return items;
}

function render(
  nodes: MenuNode[],
  values: Record<string, MenuSettingValue> = {},
  unavailable: (n: MenuNode) => string | null = () => null,
  onPick: (n: MenuNode) => void = () => undefined,
) {
  act(() =>
    root.render(
      <MenuList
        nodes={nodes}
        values={values}
        onPick={onPick}
        unavailable={unavailable}
        renderDynamic={() => <div className="dynamic-stub" />}
      />,
    ),
  );
}

function rows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.menu__row')];
}

function row(label: string): HTMLElement {
  const found = rows().find(
    (el) => el.querySelector('.menu__label')?.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no row ${JSON.stringify(label)}`);
  return found;
}

function mark(label: string): string {
  return row(label).querySelector('.menu__mark')?.textContent?.trim() ?? '';
}

describe('checkmarks', () => {
  const cartoon = () => menu('Setting').filter((n) => n.kind === 'submenu' && n.label === 'Cartoon');

  it('tick only when the live setting is not the off value', () => {
    const items = submenu('Setting', ['Cartoon']);
    render(items, {
      cartoon_fancy_helices: { type: 1, value: 1 },
      cartoon_flat_sheets: { type: 1, value: 0 },
      cartoon_highlight_color: { type: 5, value: -1 },
    });
    expect(mark('Fancy Helices')).toBe('✓');
    expect(mark('Flat Sheets')).toBe('');
    // 104/-1 pair: -1 is OFF
    expect(mark('Highlight Color')).toBe('');
    expect(cartoon()).toHaveLength(1);
  });

  it('tick the 104/-1 pair when it holds the on value', () => {
    render(submenu('Setting', ['Cartoon']), {
      cartoon_highlight_color: { type: 5, value: 104 },
    });
    expect(mark('Highlight Color')).toBe('✓');
  });

  it('never tick a setting type SettingAction refuses to make checkable', () => {
    // type 4 (float3) is the `print('TODO', type_, name)` branch upstream.
    render(submenu('Setting', ['Cartoon']), {
      cartoon_fancy_helices: { type: 4, value: 1 },
    });
    expect(mark('Fancy Helices')).toBe('');
  });

  it('show nothing while the value is still unknown', () => {
    render(submenu('Setting', ['Cartoon']), {});
    expect(mark('Fancy Helices')).toBe('');
  });
});

describe('radio dots', () => {
  it('follow values[0]', () => {
    render(submenu('Mouse', ['Selection Mode']), {
      mouse_selection_mode: { type: 2, value: 4 },
    });
    expect(mark('Objects')).toBe('●');
    expect(mark('Atoms')).toBe('');
    expect(mark('C-alphas')).toBe('');
  });

  it('tolerate the float32 round trip Qt trips over', () => {
    render(submenu('Setting', ['Lines & Sticks', 'Stick Radius']), {
      stick_radius: { type: 3, value: 0.10000000149011612 },
    });
    expect(mark('0.1')).toBe('●');
    expect(mark('0.2')).toBe('');
  });
});

describe('accelerators', () => {
  it('are split out of the label and right-aligned', () => {
    render(menu('Edit'));
    expect(row('Undo').querySelector('.menu__accel')?.textContent).toBe('Ctrl-Z');
    expect(row('Redo').querySelector('.menu__accel')?.textContent).toBe('Ctrl-Y');
  });
});

describe('unbuilt hooks', () => {
  const unavailable = (node: MenuNode): string | null => {
    if (node.kind !== 'command' || node.action.type !== 'hook') return null;
    const hook = node.action.hook;
    if (UNAVAILABLE_HOOKS[hook]) return UNAVAILABLE_HOOKS[hook];
    if (HOOK_OWNERS[hook]) return `not built yet — ${HOOK_OWNERS[hook].owner} owns it`;
    return null;
  };

  it('render disabled and name their owner in the tooltip', () => {
    render(menu('File'), {}, unavailable);
    const open = row('Open...') as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.className).toContain('is-disabled');
    expect(open.getAttribute('title')).toContain('WP-18');
  });

  it('do not fire onPick', () => {
    const picked: MenuNode[] = [];
    render(menu('File'), {}, unavailable, (n) => picked.push(n));
    (row('Open...') as HTMLButtonElement).click();
    expect(picked).toEqual([]);
  });

  it('leave runnable items enabled', () => {
    render(menu('Wizard'), {}, unavailable);
    const wizard = row('Appearance') as HTMLButtonElement;
    expect(wizard.disabled).toBe(false);
    wizard.click();
  });
});

describe('submenus', () => {
  it('open on hover and render their own children', () => {
    render(menu('Build'));
    expect(container.querySelectorAll('.menu--sub')).toHaveLength(0);
    act(() => {
      row('Fragment').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const sub = container.querySelector('.menu--sub');
    expect(sub).toBeTruthy();
    expect(sub!.querySelectorAll('.menu__row')).toHaveLength(20);
  });

  it('route the dynamic node to its own renderer', () => {
    render(menu('File'));
    act(() => {
      row('Open Recent...').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(container.querySelector('.dynamic-stub')).toBeTruthy();
  });
});

describe('separators', () => {
  it('render as rules, not as clickable rows', () => {
    render(menu('Wizard'));
    const seps = container.querySelectorAll('.menu__sep');
    const expected = menu('Wizard').filter((n) => n.kind === 'separator').length;
    expect(seps).toHaveLength(expected);
    expect(expected).toBeGreaterThan(0);
  });
});

describe('picking', () => {
  it('hands the node back, not a pre-digested command', () => {
    const picked: MenuNode[] = [];
    render(menu('Edit'), {}, () => null, (n) => picked.push(n));
    (row('Undo') as HTMLButtonElement).click();
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ kind: 'command', label: 'Undo [Ctrl-Z]' });
  });
});

describe('the whole tree renders', () => {
  it('every top-level menu mounts, and only Plugin is empty', () => {
    const empty: string[] = [];
    for (const top of MENU_DATA.menus) {
      if (top.kind !== 'submenu') continue;
      render(top.items);
      const mounted = rows().length + container.querySelectorAll('.menu__sep').length;
      if (mounted === 0) empty.push(top.label);
      expect(mounted).toBe(top.items.length);
    }
    // `('menu', 'Plugin', [])` upstream (`_gui.py:865`): Qt fills it in
    // imperatively with "Initialize Plugin System" after the data-driven build,
    // which is what MenuBar's APPENDED table reproduces.
    expect(empty).toEqual(['Plugin']);
  });

  it('walks the whole tree without an unrenderable node', () => {
    const kinds = new Set([...walkMenu(MENU_DATA.menus)].map((n) => n.kind));
    expect([...kinds].sort()).toEqual([
      'check',
      'command',
      'dynamic',
      'radio',
      'separator',
      'submenu',
    ]);
  });
});
