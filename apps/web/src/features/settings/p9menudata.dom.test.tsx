/**
 * Row 213 — `<MenuDataRenderer>` driven over the HARVESTED tree.
 *
 * Every assertion below reads the expectation out of
 * `features/menubar/generated/menudata.ts` and then drives the component: no
 * label, setting name or value is written twice in this file, so the test
 * cannot pass by agreeing with a copy of itself. What it pins is the
 * INTERPRETATION — which node kind becomes which control, when a check is
 * ticked, which value a click writes, and that the four menus go through one
 * component.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MenuCheckNode,
  MenuCommandNode,
  MenuNode,
  MenuRadioNode,
  MenuSettingValue,
  MenuValue,
} from '@tenmol/protocol/topics/menus';
import { walkMenu } from '@tenmol/protocol/topics/menus';
import { MenuDataRenderer, type MenuContext } from './SettingMenu';
import { menuSubtree, PANEL_MENUS } from './menuTree';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

interface Harness {
  writes: Array<[string, MenuValue]>;
  commands: MenuCommandNode[];
  hooks: Record<string, (args: unknown[]) => void>;
  values: Record<string, MenuSettingValue>;
  ctx: MenuContext;
}

function harness(values: Record<string, MenuSettingValue> = {}): Harness {
  const h: Harness = {
    writes: [],
    commands: [],
    hooks: {},
    values,
    ctx: {
      valueOf: (name) => h.values[name],
      write: (setting, value) => h.writes.push([setting, value]),
      run: (node) => h.commands.push(node),
      hook: (name) => h.hooks[name],
      hookNote: (name) => `no handler for ${name}`,
    },
  };
  return h;
}

function render(nodes: readonly MenuNode[], ctx: MenuContext): void {
  act(() => {
    root.render(<MenuDataRenderer nodes={nodes} ctx={ctx} />);
  });
}

/** Open every collapsed submenu, depth first, so leaves are in the document. */
function openAll(): void {
  for (let pass = 0; pass < 8; pass++) {
    const closed = [...host.querySelectorAll<HTMLButtonElement>('[aria-expanded="false"]')];
    if (closed.length === 0) return;
    act(() => {
      for (const button of closed) button.click();
    });
  }
}

/** The first node of `kind` anywhere under a top-level menu. */
function find<T extends MenuNode>(menu: string, test: (node: MenuNode) => node is T): T {
  for (const node of walkMenu(menuSubtree(menu))) if (test(node)) return node;
  throw new Error(`no such node in ${menu}`);
}

const isCheck = (node: MenuNode): node is MenuCheckNode => node.kind === 'check';
const isRadio = (node: MenuNode): node is MenuRadioNode => node.kind === 'radio';

describe('the five node kinds are interpreted as data', () => {
  it('draws a checkbox, a radio, a separator, a submenu and a command', () => {
    const h = harness();
    render(menuSubtree('Setting'), h.ctx);
    openAll();

    expect(host.querySelectorAll('.setmenu__sep').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('[aria-expanded]').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('[role="menuitemcheckbox"]').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('[role="menuitemradio"]').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.setmenu__row--command').length).toBeGreaterThan(0);

    // Counts come from the tree, not from this file.
    const nodes = [...walkMenu(menuSubtree('Setting'))];
    expect(host.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(
      nodes.filter(isCheck).length,
    );
    expect(host.querySelectorAll('[role="menuitemradio"]')).toHaveLength(
      nodes.filter(isRadio).length,
    );
  });

  it('renders all four menus through the same component', () => {
    for (const menu of PANEL_MENUS) {
      const h = harness();
      render(menuSubtree(menu), h.ctx);
      openAll();
      const nodes = [...walkMenu(menuSubtree(menu))];
      const controls =
        host.querySelectorAll('[role="menuitemcheckbox"]').length +
        host.querySelectorAll('[role="menuitemradio"]').length;
      expect(controls).toBe(nodes.filter((n) => n.kind === 'check' || n.kind === 'radio').length);
      expect(controls).toBeGreaterThan(0);
    }
  });
});

describe('state is the LIVE value', () => {
  it('ticks a check when the value is not the false value — Qt`s rule, not equality', () => {
    // `pymol_qt_gui.py:1065`: setChecked(v != false_value). A third value is
    // therefore ON, which is what makes `cartoon_highlight_color` (104/-1)
    // tick for grey70 as well as for grey50.
    const node = find('Setting', isCheck);
    const h = harness({ [node.setting]: { type: 2, value: node.falseValue } });
    render([node], h.ctx);
    expect(host.querySelector('[role="menuitemcheckbox"]')?.getAttribute('aria-checked')).toBe(
      'false',
    );

    h.values[node.setting] = { type: 2, value: node.trueValue };
    render([node], h.ctx);
    expect(host.querySelector('[role="menuitemcheckbox"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );

    h.values[node.setting] = { type: 2, value: 999 };
    render([node], h.ctx);
    expect(host.querySelector('[role="menuitemcheckbox"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('moves a radio when the console writes the setting', () => {
    const ring = [...walkMenu(menuSubtree('Setting'))].filter(
      (n): n is MenuRadioNode => n.kind === 'radio' && n.setting === 'cartoon_ring_mode',
    );
    expect(ring.length).toBeGreaterThan(2);
    const [firstRing, , thirdRing] = ring as [MenuRadioNode, MenuRadioNode, MenuRadioNode];
    const h = harness({ cartoon_ring_mode: { type: 2, value: firstRing.value } });
    render(ring, h.ctx);
    const on = () =>
      [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .filter((el) => el.getAttribute('aria-checked') === 'true')
        .map((el) => el.querySelector('.setmenu__label')?.textContent);
    expect(on()).toEqual([firstRing.label]);

    // `set cartoon_ring_mode, <other>` in the PyMOL console.
    h.values.cartoon_ring_mode = { type: 2, value: thirdRing.value };
    render(ring, h.ctx);
    expect(on()).toEqual([thirdRing.label]);
  });

  it('ticks a float radio against the C float PyMOL reads back', () => {
    // `stick_radius` 0.1 comes back as 0.10000000149011612; Qt compares with
    // `==` and fails to tick its own item. `valueEquals` tolerates 1e-6.
    const node = [...walkMenu(menuSubtree('Setting'))].find(
      (n): n is MenuRadioNode => n.kind === 'radio' && n.setting === 'stick_radius',
    );
    expect(node).toBeDefined();
    const h = harness({ stick_radius: { type: 3, value: Math.fround(Number(node?.value)) } });
    render([node as MenuNode], h.ctx);
    expect(host.querySelector('[role="menuitemradio"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('disables a control whose setting this build does not have', () => {
    const node = find('Setting', isCheck);
    const h = harness();
    render([node], h.ctx);
    const el = host.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]');
    expect(el?.disabled).toBe(true);
    expect(el?.title).toContain("not in this build's setting table");
  });

  it('disables a check whose setting type SettingAction refuses (float3)', () => {
    const node = find('Setting', isCheck);
    const h = harness({ [node.setting]: { type: 4, value: null } });
    render([node], h.ctx);
    const el = host.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]');
    expect(el?.disabled).toBe(true);
    expect(el?.title).toContain('not checkable');
  });
});

describe('a click writes what the DATA says', () => {
  it('toggles a check to its OWN off value, not to 0', () => {
    // `('check', 'Load Assembly (Biological Unit)', 'assembly', '1', '')` —
    // a STRING setting used as a toggle.
    const node = [...walkMenu(menuSubtree('Setting'))].find(
      (n): n is MenuCheckNode => n.kind === 'check' && n.setting === 'assembly',
    );
    expect(node).toBeDefined();
    const h = harness({ assembly: { type: 6, value: node?.falseValue as MenuValue } });
    render([node as MenuNode], h.ctx);
    act(() => host.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.click());
    expect(h.writes).toEqual([['assembly', node?.trueValue]]);

    h.values.assembly = { type: 6, value: node?.trueValue as MenuValue };
    render([node as MenuNode], h.ctx);
    act(() => host.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.click());
    expect(h.writes[1]).toEqual(['assembly', node?.falseValue]);
  });

  it('writes a radio value verbatim', () => {
    const node = find('Setting', isRadio);
    const h = harness({ [node.setting]: { type: 2, value: -12345 } });
    render([node], h.ctx);
    act(() => host.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.click());
    expect(h.writes).toEqual([[node.setting, node.value]]);
  });

  it('hands a command node back whole, action and all', () => {
    const node = [...walkMenu(menuSubtree('Setting'))].find(
      (n): n is MenuCommandNode => n.kind === 'command' && n.action.type === 'call',
    );
    expect(node).toBeDefined();
    const h = harness();
    render([node as MenuNode], h.ctx);
    act(() => host.querySelector<HTMLButtonElement>('.setmenu__row--command')?.click());
    expect(h.commands).toEqual([node]);
  });
});

describe('toolkit seams', () => {
  it('disables a hook nobody has filled and names the owner', () => {
    const node = [...walkMenu(menuSubtree('Setting'))].find(
      (n): n is MenuCommandNode => n.kind === 'command' && n.action.type === 'hook',
    );
    expect(node).toBeDefined();
    const h = harness();
    render([node as MenuNode], h.ctx);
    const el = host.querySelector<HTMLButtonElement>('.setmenu__row--command');
    expect(el?.disabled).toBe(true);
    expect(el?.title).toContain('no handler for');
  });

  it('goes live the moment the hook exists', () => {
    const node = [...walkMenu(menuSubtree('Setting'))].find(
      (n): n is MenuCommandNode => n.kind === 'command' && n.action.type === 'hook',
    );
    const hookName = node?.action.type === 'hook' ? node.action.hook : '';
    const h = harness();
    h.hooks[hookName] = vi.fn();
    render([node as MenuNode], h.ctx);
    const el = host.querySelector<HTMLButtonElement>('.setmenu__row--command');
    expect(el?.disabled).toBe(false);
    act(() => el?.click());
    expect(h.commands).toEqual([node]);
  });
});

describe('radio groups', () => {
  it('wraps each setting`s radios in one group named after the setting', () => {
    const h = harness();
    render(menuSubtree('Setting'), h.ctx);
    openAll();
    const groups = [...host.querySelectorAll<HTMLElement>('[data-radio-group]')];
    const settings = [...walkMenu(menuSubtree('Setting'))]
      .filter(isRadio)
      .map((node) => node.setting);
    // One group ELEMENT per distinct setting — not one per radio, which is
    // what an adjacency-only grouping produces for the three
    // `surface_cavity_mode` items that sit either side of two submenus.
    expect(groups).toHaveLength(new Set(settings).size);
    expect(new Set(groups.map((g) => g.dataset.radioGroup)).size).toBe(new Set(settings).size);
    for (const radio of host.querySelectorAll('[role="menuitemradio"]')) {
      expect(radio.closest('[data-radio-group]')).not.toBeNull();
    }
    expect(groups.every((g) => g.getAttribute('aria-label') === g.dataset.radioGroup)).toBe(true);
  });
});
