/**
 * Wave 8 — the three pop-up behaviours the inventory listed as NOT done:
 * check marks for reps already on, the fixed 10 px wheel scroll
 * (`PopUp.cpp:438-445`), and the `internal_gui_mode` colour inversion
 * (`PopUp.cpp:144-164`, `:813-826`) — plus the submenu side-flip
 * (`Pop.cpp:111-150`), whose pure half lives in `p8a2placement.test.ts`.
 *
 * The fixtures are the literal wire nodes `cmd.tenmol_objects('menu', ...)`
 * answers for `pymol.menu.mol_show`.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PanelMenuNode } from '@tenmol/protocol';
import { RowMenu } from './RowMenu';

let container: HTMLDivElement;
let root: Root;

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

const MOL_SHOW: PanelMenuNode[] = [
  { code: 2, text: 'Show:', path: [0], command: '' },
  {
    code: 1,
    text: 'as',
    path: [1],
    items: [
      { code: 2, text: 'As:', path: [1, 0], command: '' },
      { code: 1, text: 'wire', path: [1, 1], command: 'cmd.show_as("wire"      ,"ala")' },
      { code: 1, text: '  sticks', path: [1, 2], command: 'cmd.show_as("sticks"    ,"ala")' },
    ],
  },
  { code: 0, text: '', path: [2], command: '' },
  { code: 1, text: 'wire', path: [3], command: 'cmd.show("wire"      ,"ala")' },
  { code: 1, text: '  lines', path: [4], command: 'cmd.show("lines"     ,"ala")' },
  { code: 1, text: '  nonbonded', path: [5], command: 'cmd.show("nonbonded" ,"ala")' },
  { code: 1, text: 'cartoon', path: [6], command: 'cmd.show("cartoon"   ,"ala")' },
  {
    code: 1,
    text: 'flag ignore',
    path: [7],
    items: [
      { code: 2, text: 'flag ignore', path: [7, 0], command: '' },
      {
        code: 1,
        text: 'clear',
        path: [7, 1],
        command: "cmd.flag(\"ignore\",'ala','clear');cmd.rebuild('ala')",
      },
    ],
  },
];

function menu(over: Partial<React.ComponentProps<typeof RowMenu>> = {}) {
  return (
    <RowMenu
      title="ala"
      op="S"
      menuName="mol_show"
      items={MOL_SHOW}
      anchor={{ x: 10, y: 10 }}
      onPick={() => undefined}
      onExpand={() => undefined}
      onClose={() => undefined}
      {...over}
    />
  );
}

function leaf(text: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('.rowmenu__row')].find(
    (el) => el.textContent?.replace(/[▸✓·]/g, '').trim() === text,
  );
  if (!found) throw new Error(`no menu row ${JSON.stringify(text)}`);
  return found;
}

/** `cmd.get_vis()[name][2]` -> the bitmask the panel ships. */
const bits = (...indices: number[]) => indices.reduce((m, i) => m | (1 << i), 0);

describe('check marks for reps already on', () => {
  it('ticks lines but not cartoon when only lines is shown', () => {
    // `fragment ala` with nothing else: get_vis reports rep index 7 (lines).
    act(() => root.render(menu({ reps: bits(7) })));
    expect(leaf('lines').getAttribute('data-rep')).toBe('on');
    expect(leaf('lines').getAttribute('aria-checked')).toBe('true');
    expect(leaf('lines').querySelector('.rowmenu__tick')?.textContent).toBe('✓');
    expect(leaf('cartoon').getAttribute('data-rep')).toBe('off');
    expect(leaf('cartoon').getAttribute('aria-checked')).toBe('false');
    expect(leaf('cartoon').querySelector('.rowmenu__tick')?.textContent).toBe('');
  });

  it('a combination leaf is `partial` on half its bits and `on` on both', () => {
    act(() => root.render(menu({ reps: bits(7) })));
    expect(leaf('wire').getAttribute('data-rep')).toBe('partial');
    act(() => root.render(menu({ reps: bits(7, 11) })));
    expect(leaf('wire').getAttribute('data-rep')).toBe('on');
  });

  it('leaves a non-rep leaf untouched — no tick, no aria-checked', () => {
    act(() => root.render(menu({ reps: bits(7) })));
    act(() => leaf('flag ignore').click());
    const clear = leaf('clear');
    expect(clear.getAttribute('data-rep')).toBeNull();
    expect(clear.hasAttribute('aria-checked')).toBe(false);
    expect(clear.querySelector('.rowmenu__tick')).toBeNull();
  });

  it('with reps=0 (the default) nothing claims to be on', () => {
    act(() => root.render(menu()));
    expect(
      [...container.querySelectorAll('[data-rep="on"]')].map((el) => el.textContent),
    ).toEqual([]);
  });

  it('the submenu inherits the row’s rep mask', () => {
    act(() => root.render(menu({ reps: bits(0, 4) })));
    act(() => leaf('as').click());
    const panel = container.querySelector('.rowmenu__panel') as HTMLElement;
    const sticks = [...panel.querySelectorAll<HTMLElement>('.rowmenu__row')].find((el) =>
      el.textContent?.includes('sticks'),
    );
    expect(sticks?.getAttribute('data-rep')).toBe('on');
  });
});

describe('internal_gui_mode colour inversion (PopUp.cpp:144-164)', () => {
  it('Default (0) leaves the dark pop-up alone', () => {
    act(() => root.render(menu({ internalGuiMode: 0 })));
    const el = container.querySelector('.rowmenu') as HTMLElement;
    expect(el.className).not.toContain('is-light');
    expect(el.getAttribute('data-gui-mode')).toBe('0');
  });

  it('modes 1 and 2 both invert it', () => {
    for (const mode of [1, 2]) {
      act(() => root.render(menu({ internalGuiMode: mode })));
      const el = container.querySelector('.rowmenu') as HTMLElement;
      expect(el.className).toContain('is-light');
      expect(el.getAttribute('data-gui-mode')).toBe(String(mode));
    }
  });
});

describe('wheel scrolling (PopUp.cpp:438-445)', () => {
  it('moves the body by exactly 10 px per notch, in either direction', () => {
    act(() => root.render(menu()));
    const body = container.querySelector('.rowmenu__body') as HTMLElement;
    // jsdom has no layout, so give the element a scrollable range by hand.
    Object.defineProperty(body, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 100, configurable: true });
    body.scrollTop = 50;

    const wheel = (deltaY: number) =>
      act(() => {
        body.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
      });

    wheel(120);
    expect(body.scrollTop).toBe(60);
    wheel(3); // a trackpad's tiny delta is still ONE notch: sign, not magnitude
    expect(body.scrollTop).toBe(70);
    wheel(-120);
    expect(body.scrollTop).toBe(60);
  });

  it('consumes the event so the page behind does not scroll too', () => {
    act(() => root.render(menu()));
    const body = container.querySelector('.rowmenu__body') as HTMLElement;
    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    act(() => {
      body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('submenu side (Pop.cpp:111-150)', () => {
  it('opens on the right by default and marks the side it took', () => {
    act(() => root.render(menu()));
    act(() => leaf('as').click());
    const panel = container.querySelector('.rowmenu__panel') as HTMLElement;
    expect(panel.getAttribute('data-side')).toBe('right');
    expect(panel.className).toContain('rowmenu__panel--right');
  });

  it('flips to the left when the parent is against the right edge', () => {
    // jsdom reports a 0x0 rect for everything, so the layout has to be handed
    // to the component the way a browser would: a parent menu that ends at the
    // window edge and a child wide enough that `parentRight - 2` cannot fit.
    const real = Element.prototype.getBoundingClientRect;
    const W = window.innerWidth;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('rowmenu')) {
        return { left: W - 220, right: W - 20, width: 200, height: 300, top: 0, bottom: 300 } as DOMRect;
      }
      if (this.classList.contains('rowmenu__panel')) {
        return { left: 0, right: 190, width: 190, height: 100, top: 0, bottom: 100 } as DOMRect;
      }
      return real.call(this);
    };
    try {
      act(() => root.render(menu()));
      act(() => leaf('as').click());
      const panel = container.querySelector('.rowmenu__panel') as HTMLElement;
      expect(panel.getAttribute('data-side')).toBe('left');
      expect(panel.className).toContain('rowmenu__panel--left');
    } finally {
      Element.prototype.getBoundingClientRect = real;
    }
  });

  it('keeps the right side when the same menu has room', () => {
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('rowmenu')) {
        return { left: 40, right: 240, width: 200, height: 300, top: 0, bottom: 300 } as DOMRect;
      }
      if (this.classList.contains('rowmenu__panel')) {
        return { left: 0, right: 190, width: 190, height: 100, top: 0, bottom: 100 } as DOMRect;
      }
      return real.call(this);
    };
    try {
      act(() => root.render(menu()));
      act(() => leaf('as').click());
      expect(
        (container.querySelector('.rowmenu__panel') as HTMLElement).getAttribute('data-side'),
      ).toBe('right');
    } finally {
      Element.prototype.getBoundingClientRect = real;
    }
  });
});
