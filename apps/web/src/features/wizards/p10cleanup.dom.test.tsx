/**
 * Wave 10, inventory row 371 — the **Cleanup (szybki) wizard**, on the client.
 *
 * This row has said "the panel itself is unverifiable here" since wave 4,
 * because `cmd.wizard('cleanup')` raises `CmdException` at construction unless
 * `$OE_DIR/bin/szybki` exists, and no OpenEye install does on this machine.
 * `bridge/tests/test_p10_wizards.py` closes that: it puts a stub executable at
 * `$OE_DIR/bin/szybki` that honours the same file contract, launches the wizard
 * for real and drives `run()`/`undo()`/`redo()` end to end.
 *
 * EVERY FIXTURE BELOW IS THE LITERAL `wizards.snapshot` / `wizards.menu` OUTPUT
 * OF THAT RUN — no invented rows. What it pins here is the client half:
 *
 *  - the 7 rows render through the ONE generic renderer, with no cleanup-
 *    specific branch anywhere in this feature (`WizardPanel.tsx`);
 *  - the `\999Ligand:\000 ` markup (`cleanup.py:133`) becomes two coloured
 *    spans and a clean `title`, rather than leaking backslashes into the UI;
 *  - the four action rows send back their `code` strings VERBATIM, which is
 *    what actually runs `run()`/`undo()`/`redo()` server-side;
 *  - the Ligand popup is fetched at open time and its leaf command is executed;
 *  - the launcher does NOT disable `cleanup` (`catalog()`'s `available` is a
 *    static module+class check, `panels/wizards.py:757-772`), so the user's
 *    click really does reach `wizard cleanup` and the engine's refusal is what
 *    they see — the console line `session.run` writes (`app/session.ts:213`).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WizardCatalog, WizardMenuItem, WizardSnapshot } from '@tenmol/protocol';
import { WizardPanel } from './WizardPanel';
import { WizardLauncher } from './WizardLauncher';
import { EMPTY_SNAPSHOT } from './service';
import { stripColorCodes } from './colorCodes';

let container: HTMLDivElement;
let root: Root;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function firePointer(target: Element, type: 'pointerdown' | 'pointerup') {
  const rect = target.getBoundingClientRect();
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: rect.left,
    clientY: rect.top,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** The ligand `bridge/tests/test_p10_wizards.py` builds with `fragment ala`. */
const LIGAND = 'p10cleanup_lig';

/**
 * `wizards.snapshot()` with `cmd.wizard('cleanup')` on the stack and
 * `$OE_DIR/bin/szybki` present — captured over the socket, not typed from the
 * source (`cleanup.py:126-137` is where these seven rows come from).
 */
const CLEANUP: WizardSnapshot = {
  ...EMPTY_SNAPSHOT,
  version: 3,
  depth: 1,
  cls: 'Cleanup',
  module: 'pymol.wizard.cleanup',
  stack: [{ cls: 'Cleanup', module: 'pymol.wizard.cleanup' }],
  eventMask: 3,
  // `get_prompt` appends `self.message`, which is `[]` and not None
  // (`cleanup.py:62,156-157`) — the wire really does carry the string '[]'.
  prompt: ['[]'],
  methods: ['get_panel', 'get_prompt', 'get_menu', 'get_event_mask', 'cleanup', 'do_pick'],
  panel: [
    { index: 0, type: 1, kind: 'text', text: 'Cleanup', code: '' },
    { index: 1, type: 2, kind: 'button', text: 'Run', code: 'cmd.get_wizard().run()' },
    { index: 2, type: 2, kind: 'button', text: 'Undo', code: 'cmd.get_wizard().undo()' },
    { index: 3, type: 2, kind: 'button', text: 'Redo', code: 'cmd.get_wizard().redo()' },
    { index: 4, type: 3, kind: 'popup', text: `\\999Ligand:\\000 ${LIGAND}`, code: 'ligand' },
    { index: 5, type: 2, kind: 'button', text: 'Refresh', code: 'cmd.get_wizard().update()' },
    { index: 6, type: 2, kind: 'button', text: 'Done', code: 'cmd.set_wizard()' },
  ],
};

/** `wizards.menu('ligand')`, verbatim (`cleanup.py:38-47`). */
const LIGAND_MENU: WizardMenuItem[] = [
  { code: 2, kind: 'title', text: 'Ligand' },
  {
    code: 1,
    kind: 'item',
    text: LIGAND,
    command: `cmd.get_wizard().set_ligand("${LIGAND}")`,
  },
];

describe('row 371 — the Cleanup wizard renders through the generic panel', () => {
  it('draws all seven rows: one label, four buttons, one popup, one Done', () => {
    render(<WizardPanel snapshot={CLEANUP} onExec={vi.fn()} onMenu={vi.fn()} />);

    const rows = container.querySelectorAll('.wizrow');
    expect(rows.length).toBe(7);
    expect([...rows].map((row) => row.className.split(' ')[1])).toEqual([
      'wizrow--text',
      'wizrow--button',
      'wizrow--button',
      'wizrow--button',
      'wizrow--popup',
      'wizrow--button',
      'wizrow--button',
    ]);
    expect(container.querySelector('.wizpanel__head-title')?.textContent).toBe('Cleanup');
    expect([...rows].map((row) => row.textContent?.replace('▾', '').trim())).toEqual([
      'Cleanup',
      'Run',
      'Undo',
      'Redo',
      `Ligand: ${LIGAND}`,
      'Refresh',
      'Done',
    ]);
    // a single stack entry draws no depth badge
    expect(container.querySelector('.wizpanel__depth')).toBeNull();
    expect(container.querySelectorAll('.wizpanel__error').length).toBe(0);
  });

  it('turns the \\999/\\000 markup into colours, not into visible backslashes', () => {
    render(<WizardPanel snapshot={CLEANUP} onExec={vi.fn()} onMenu={vi.fn()} />);

    const popup = container.querySelector('.wizrow--popup') as HTMLElement;
    expect(popup.textContent).not.toContain('\\');
    // `TextSetColorFromCode` maps each digit to d/9 of full scale: 999 is white,
    // 000 is black (`layer1/Text.cpp:530-548`).
    const spans = [...popup.querySelectorAll('span[style]')];
    expect(spans.map((span) => (span as HTMLElement).style.color)).toEqual([
      'rgb(255, 255, 255)',
      'rgb(0, 0, 0)',
    ]);
    expect(spans.map((span) => span.textContent)).toEqual(['Ligand:', ` ${LIGAND}`]);
    expect(popup.querySelector('span[title]')?.getAttribute('title')).toBe(`Ligand: ${LIGAND}`);
    expect(stripColorCodes(CLEANUP.panel[4]!.text)).toBe(`Ligand: ${LIGAND}`);
  });

  it('sends Run / Undo / Redo / Refresh back as their exact code strings', () => {
    // These four strings are what `bridge/tests/test_p10_wizards.py` executes
    // through `wizards.exec_code` to drive the real szybki round trip; the
    // browser never evaluates them (`layer1/Wizard.cpp:573-577`).
    const onExec = vi.fn();
    render(<WizardPanel snapshot={CLEANUP} onExec={onExec} onMenu={vi.fn()} />);

    const buttons = [...container.querySelectorAll<HTMLElement>('.wizrow--button')];
    for (const button of buttons) {
      firePointer(button, 'pointerdown');
      firePointer(button, 'pointerup');
    }
    expect(onExec.mock.calls.map((call) => call[0])).toEqual([
      'cmd.get_wizard().run()',
      'cmd.get_wizard().undo()',
      'cmd.get_wizard().redo()',
      'cmd.get_wizard().update()',
      'cmd.set_wizard()',
    ]);
  });

  it('fetches the Ligand popup at open time and executes its leaf', async () => {
    const onMenu = vi.fn(async () => LIGAND_MENU);
    const onExec = vi.fn();
    render(<WizardPanel snapshot={CLEANUP} onExec={onExec} onMenu={onMenu} />);

    firePointer(container.querySelector('.wizrow--popup') as HTMLElement, 'pointerdown');
    await act(async () => {});

    expect(onMenu).toHaveBeenCalledWith('ligand');
    const menu = container.querySelector('[data-testid="wizard-menu"]');
    expect(menu).not.toBeNull();
    // the popup's own head is the row label with the markup stripped
    expect(menu?.querySelector('.wizmenu__head')?.textContent).toBe(`Ligand: ${LIGAND}`);
    expect(menu?.querySelector('.wizmenu__title')?.textContent).toBe('Ligand');

    const leaf = menu?.querySelector('.wizmenu__item') as HTMLElement;
    expect(leaf.textContent).toBe(LIGAND);
    act(() => leaf.click());
    expect(onExec).toHaveBeenCalledWith(`cmd.get_wizard().set_ligand("${LIGAND}")`);
  });

  it('leaves cleanup ENABLED in the launcher: the refusal comes from the engine', () => {
    // `catalog()`'s `available` is a static module+class check and says true for
    // cleanup, because construction is what fails and construction has side
    // effects (`panels/wizards.py:739-772`). Measured over the socket:
    //   {'name': 'cleanup', 'cls': 'Cleanup', 'available': True, 'note': ''}
    // so the entry must be clickable and the user learns the truth from the
    // console line `session.run` writes when `{t:'do'}` comes back `err`.
    const catalog: WizardCatalog = {
      wizards: [
        { name: 'cleanup', cls: 'Cleanup', available: true, note: '' },
        { name: 'openvr', cls: 'Openvr', available: false, note: 'ImportError: no openvr' },
      ],
      menubar: [],
      aliases: { distance: 'measurement' },
    };
    const onRun = vi.fn();
    render(
      <WizardLauncher
        catalog={catalog}
        error={null}
        onRun={onRun}
        onDismiss={vi.fn()}
        active={false}
      />,
    );

    act(() => (container.querySelector('.wizlaunch__toggle') as HTMLElement).click());
    act(() => (container.querySelector('.wizlaunch__item--more') as HTMLElement).click());

    const entries = [...container.querySelectorAll<HTMLButtonElement>('.wizlaunch__all button')];
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'cleanup',
      'openvr unavailable',
    ]);
    expect(entries[0]!.disabled).toBe(false);
    expect(entries[1]!.disabled).toBe(true);

    act(() => entries[0]!.click());
    expect(onRun).toHaveBeenCalledWith('wizard cleanup');
  });
});
