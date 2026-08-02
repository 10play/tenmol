/**
 * The generic renderer, driven by REAL snapshots.
 *
 * Every fixture below is the literal output of `wizards.snapshot` against this
 * build's PyMOL (captured while writing `packages/bridge/tests/test_wizards.py`), so a
 * change in either the wizard modules or the bridge encoding breaks this test
 * rather than quietly changing the UI.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WizardMenuItem, WizardSnapshot } from '@tenmol/protocol';
import { WizardPanel } from './WizardPanel';
import { WizardPrompt } from './WizardPrompt';
import { EMPTY_SNAPSHOT } from './service';

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

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function snapshot(patch: Partial<WizardSnapshot>): WizardSnapshot {
  return { ...EMPTY_SNAPSHOT, depth: 1, cls: 'Test', ...patch };
}

/** `cmd.wizard('measurement')` -> `wizards.snapshot()`, verbatim. */
const MEASUREMENT = snapshot({
  cls: 'Measurement',
  module: 'pymol.wizard.measurement',
  eventMask: 131,
  panel: [
    { index: 0, type: 1, kind: 'text', text: 'Measurement', code: '' },
    { index: 1, type: 3, kind: 'popup', text: 'Distances', code: 'mode' },
    { index: 2, type: 3, kind: 'popup', text: 'Create New Object', code: 'object_mode' },
    {
      index: 3,
      type: 2,
      kind: 'button',
      text: 'Delete Last Object',
      code: 'cmd.get_wizard().delete_last()',
    },
    {
      index: 4,
      type: 2,
      kind: 'button',
      text: 'Delete All Measurements',
      code: 'cmd.get_wizard().delete_all()',
    },
    { index: 5, type: 2, kind: 'button', text: 'Done', code: 'cmd.set_wizard()' },
  ],
  prompt: ['Please click on the first atom...'],
});

function pointerEventInit(target: Element, inside: boolean) {
  // jsdom has no layout: every getBoundingClientRect is the zero rect, so
  // "inside" is the top-left corner itself and "outside" is well past it.
  const rect = target.getBoundingClientRect();
  return {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX: inside ? rect.left : rect.right + 500,
    clientY: inside ? rect.top : rect.bottom + 500,
  };
}

/** jsdom has no PointerEvent; React only needs the fields it reads. */
function firePointer(target: Element, type: 'pointerdown' | 'pointerup', inside = true) {
  const event = new MouseEvent(type, pointerEventInit(target, inside));
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
}

beforeEach(() => {
  // setPointerCapture does not exist in jsdom.
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
});

describe('WizardPanel', () => {
  it('renders nothing at all when the stack is empty', () => {
    render(<WizardPanel snapshot={EMPTY_SNAPSHOT} onExec={vi.fn()} onMenu={vi.fn()} />);
    expect(container.querySelector('[data-testid="wizard-panel"]')).toBeNull();
  });

  it('renders one row per get_panel entry, typed 0/1/2/3', () => {
    render(<WizardPanel snapshot={MEASUREMENT} onExec={vi.fn()} onMenu={vi.fn()} />);
    const rows = container.querySelectorAll('.wizrow');
    expect(rows.length).toBe(6);
    expect(rows[0]?.className).toContain('wizrow--text');
    expect(rows[1]?.className).toContain('wizrow--popup');
    expect(rows[5]?.className).toContain('wizrow--button');
    expect(rows[0]?.textContent).toContain('Measurement');
  });

  it('fires code on release INSIDE the row and cancels on drag-off', () => {
    // packages/engine/layer1/Wizard.cpp:568-580 (release) and :519-548 (drag-off cancels).
    const onExec = vi.fn();
    render(<WizardPanel snapshot={MEASUREMENT} onExec={onExec} onMenu={vi.fn()} />);
    const done = container.querySelectorAll('.wizrow--button')[2] as HTMLElement;

    firePointer(done, 'pointerdown');
    expect(done.className).toContain('is-pressed');
    firePointer(done, 'pointerup', false); // released outside
    expect(onExec).not.toHaveBeenCalled();
    expect(done.className).not.toContain('is-pressed');

    firePointer(done, 'pointerdown');
    firePointer(done, 'pointerup', true);
    expect(onExec).toHaveBeenCalledWith('cmd.set_wizard()');
  });

  it('opens a popup row on PRESS and fetches the menu at open time', async () => {
    // Menus are never cached: density.py:160 / filter.py:236 / command.py:87
    // rebuild them from live state on every call.
    const items: WizardMenuItem[] = [
      { code: 2, kind: 'title', text: 'Mode' },
      { code: 1, kind: 'item', text: 'Distances', command: 'cmd.get_wizard().set_mode("pairs")' },
      { code: 0, kind: 'separator', text: '' },
      {
        code: 1,
        kind: 'item',
        text: 'Neighbors',
        submenu: [{ code: 1, kind: 'item', text: 'in all objects', command: 'cmd.x()' }],
      },
    ];
    const onMenu = vi.fn(async () => items);
    const onExec = vi.fn();
    render(<WizardPanel snapshot={MEASUREMENT} onExec={onExec} onMenu={onMenu} />);

    const popup = container.querySelector('.wizrow--popup') as HTMLElement;
    firePointer(popup, 'pointerdown');
    await act(async () => {});
    expect(onMenu).toHaveBeenCalledWith('mode');

    const menu = container.querySelector('[data-testid="wizard-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('.wizmenu__sep').length).toBe(1);
    expect(menu?.querySelector('.wizmenu__title')?.textContent).toBe('Mode');
    // A submenu entry is a disclosure, not a leaf.
    expect(menu?.querySelectorAll('.wizmenu__item--sub').length).toBe(1);

    const leaf = menu?.querySelectorAll('.wizmenu__item')[0] as HTMLElement;
    act(() => leaf.click());
    expect(onExec).toHaveBeenCalledWith('cmd.get_wizard().set_mode("pairs")');
  });

  it('says so when get_menu returns None instead of flashing an empty popup', async () => {
    const onMenu = vi.fn(async () => null);
    render(<WizardPanel snapshot={MEASUREMENT} onExec={vi.fn()} onMenu={onMenu} />);
    firePointer(container.querySelector('.wizrow--popup') as HTMLElement, 'pointerdown');
    await act(async () => {});
    expect(container.querySelector('.wizpanel__error')?.textContent).toContain('no menu');
  });

  it('handles a prompt-only wizard: message.py dismiss=0 returns []', () => {
    render(
      <WizardPanel
        snapshot={snapshot({ cls: 'Message', panel: [], prompt: ['Please wait...'] })}
        onExec={vi.fn()}
        onMenu={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.wizrow').length).toBe(0);
    expect(container.querySelector('.wizpanel__promptonly')).not.toBeNull();
  });

  it('reserves space for security.py blank spacer rows', () => {
    render(
      <WizardPanel
        snapshot={snapshot({
          cls: 'Security',
          panel: [
            { index: 0, type: 1, kind: 'text', text: 'Assume Movie Risks?', code: '' },
            { index: 1, type: 2, kind: 'button', text: 'accept', code: 'cmd.accept()' },
            { index: 2, type: 1, kind: 'text', text: '', code: '' },
            { index: 3, type: 2, kind: 'button', text: 'decline', code: 'cmd.decline()' },
          ],
        })}
        onExec={vi.fn()}
        onMenu={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.wizrow').length).toBe(4);
    expect((container.querySelectorAll('.wizrow')[2] as HTMLElement).textContent).toBe('');
  });

  it('re-renders a DIFFERENT row count when the panel shape changes', () => {
    // appearance.py:163-183: the middle row is colour OR what OR a static label.
    const colour = snapshot({
      cls: 'Appearance',
      panel: [
        { index: 0, type: 1, kind: 'text', text: 'Appearance Wizard', code: '' },
        { index: 1, type: 3, kind: 'popup', text: 'Color', code: 'mode' },
        { index: 2, type: 3, kind: 'popup', text: '\\900red', code: 'color' },
        { index: 3, type: 3, kind: 'popup', text: 'By Residue', code: 'scope' },
        { index: 4, type: 2, kind: 'button', text: 'Done', code: 'cmd.set_wizard()' },
      ],
    });
    render(<WizardPanel snapshot={colour} onExec={vi.fn()} onMenu={vi.fn()} />);
    expect(container.querySelectorAll('.wizrow').length).toBe(5);
    // The \RGB swatch is rendered as colour, not printed as text.
    expect(container.querySelectorAll('.wizrow')[2]?.textContent).toBe('red▾');

    const atoms = snapshot({
      cls: 'Appearance',
      panel: [
        { index: 0, type: 1, kind: 'text', text: 'Appearance Wizard', code: '' },
        { index: 1, type: 3, kind: 'popup', text: 'Select', code: 'mode' },
        { index: 2, type: 1, kind: 'text', text: 'Atoms', code: '' },
        { index: 3, type: 2, kind: 'button', text: 'Done', code: 'cmd.set_wizard()' },
      ],
    });
    render(<WizardPanel snapshot={atoms} onExec={vi.fn()} onMenu={vi.fn()} />);
    expect(container.querySelectorAll('.wizrow').length).toBe(4);
    expect(container.querySelectorAll('.wizrow')[2]?.className).toContain('wizrow--text');
  });

  it('shows the stack depth when a wizard pushed another wizard', () => {
    render(
      <WizardPanel
        snapshot={snapshot({
          depth: 2,
          cls: 'Message',
          stack: [
            { cls: 'Demo', module: 'pymol.wizard.demo' },
            { cls: 'Message', module: 'pymol.wizard.message' },
          ],
        })}
        onExec={vi.fn()}
        onMenu={vi.fn()}
      />,
    );
    expect(container.querySelector('.wizpanel__depth')?.textContent).toBe('stack 2');
  });

  it('surfaces a wizard method that raised instead of swallowing it', () => {
    render(
      <WizardPanel
        snapshot={snapshot({ errors: ["get_panel AttributeError: 'Toggle' object has no 'cmd'"] })}
        onExec={vi.fn()}
        onMenu={vi.fn()}
      />,
    );
    expect(container.querySelector('.wizpanel__error')?.textContent).toContain('AttributeError');
  });
});

describe('WizardPrompt', () => {
  it('honours wizard_prompt_mode 0 (suppressed)', () => {
    render(<WizardPrompt lines={['hello']} mode={0} target="#nope" />);
    expect(container.querySelector('[data-testid="wizard-prompt"]')).toBeNull();
  });

  it('mode 1 draws the opaque backdrop at the 15px margin', () => {
    render(<WizardPrompt lines={['Pick an atom...']} mode={1} target="#nope" />);
    const el = container.querySelector('[data-testid="wizard-prompt"]') as HTMLElement;
    expect(el.className).toContain('wizprompt--backdrop');
    expect(el.style.top).toBe('15px');
    expect(el.style.left).toBe('15px');
    // WizardBackColor / WizardTextColor, packages/engine/layer1/Ortho.cpp:2692-2697.
    expect(el.style.background).toBe('rgb(51, 51, 51)');
    expect(el.style.color).toBe('rgb(51, 255, 51)');
  });

  it('mode 2 is text only, still inset', () => {
    render(<WizardPrompt lines={['x']} mode={2} target="#nope" />);
    const el = container.querySelector('[data-testid="wizard-prompt"]') as HTMLElement;
    expect(el.className).not.toContain('backdrop');
    expect(el.style.top).toBe('15px');
  });

  it('mode 3 is flush to the top-left corner', () => {
    render(<WizardPrompt lines={['x']} mode={3} target="#nope" />);
    const el = container.querySelector('[data-testid="wizard-prompt"]') as HTMLElement;
    expect(el.style.top).toBe('1px');
    expect(el.style.left).toBe('1px');
  });

  it('renders one div per prompt line and colours \\RGB markup', () => {
    render(
      <WizardPrompt lines={['Label text: \\888abc_', 'second line']} mode={2} target="#nope" />,
    );
    const lines = container.querySelectorAll('.wizprompt__line');
    expect(lines.length).toBe(2);
    expect(lines[0]?.textContent).toBe('Label text: abc_');
  });

  it('portals into the viewport region when the shell provides one', () => {
    const viewport = document.createElement('div');
    viewport.className = 'shell__viewport';
    document.body.appendChild(viewport);
    try {
      render(<WizardPrompt lines={['over the scene']} mode={1} />);
      expect(container.querySelector('[data-testid="wizard-prompt"]')).toBeNull();
      expect(viewport.querySelector('[data-testid="wizard-prompt"]')?.textContent).toBe(
        'over the scene',
      );
    } finally {
      viewport.remove();
    }
  });
});
