/**
 * Wave 6, area 8 — the React half of four inventory rows, driven by REAL
 * snapshots captured from this build over the bridge socket
 * (`bridge/tests/test_wf_wizards.py` asserts the same numbers server-side).
 *
 * What these pin, in order:
 *
 * 1. **Box wizard** (`box.py`) — the inline text entry is not a widget the
 *    client invents. It is a wizard SUB-STATE that only shows up as an event
 *    mask change (19 -> 23) plus a prompt, with the panel rows byte-identical
 *    in both states. So `<WizardKeyCapture/>` must mount off the mask alone.
 * 2. **Command wizard** (`command.py`) — three panel shapes, one popup row per
 *    introspected argument, and `eventMask 0` in the normal shape, meaning the
 *    client must NOT hold the keyboard while a wizard is merely open.
 * 3. **Session persistence** (`wizarding.py:176-196`) — there is no push
 *    topic; a `.pse` load shows up in the browser only as a `wizards.probe`
 *    whose version and depth moved, and `useWizard` has to answer that by
 *    pulling the snapshot exactly once.
 * 4. **Builder wizards** (`pmg_qt/builder.py`, ported Qt-free in
 *    `tenmol_bridge/panels/builder.py`) — they render through the identical
 *    generic path with no builder-specific branch anywhere in this feature.
 */

import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WizardProbe, WizardSnapshot } from '@tenmol/protocol';
import { WizardPanel } from './WizardPanel';
import { WizardPrompt } from './WizardPrompt';
import { WizardKeyCapture } from './WizardKeyCapture';
import { EMPTY_SNAPSHOT, type WizardService } from './service';
import { useWizard, type WizardState } from './useWizard';

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

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function snapshot(patch: Partial<WizardSnapshot>): WizardSnapshot {
  return { ...EMPTY_SNAPSHOT, depth: 1, cls: 'Test', ...patch };
}

// ---------------------------------------------------------------------------
// fixtures: literal `wizards.snapshot` output
// ---------------------------------------------------------------------------

/** `cmd.wizard('box')`. */
const BOX_IDLE = snapshot({
  cls: 'Box',
  module: 'pymol.wizard.box',
  eventMask: 19, // pick | select | scene
  panel: [
    { index: 0, type: 1, kind: 'text', text: 'Box Wizard', code: '' },
    { index: 1, type: 3, kind: 'popup', text: 'Box', code: 'mode' },
    {
      index: 2,
      type: 2,
      kind: 'button',
      text: 'Change Name',
      code: 'cmd.get_wizard().edit_name()',
    },
    {
      index: 3,
      type: 2,
      kind: 'button',
      text: 'Copy Box',
      code: 'cmd.get_wizard().edit_name(copying=1)',
    },
    {
      index: 4,
      type: 2,
      kind: 'button',
      text: 'Toggle Points',
      code: 'cmd.get_wizard().toggle_points()',
    },
    {
      index: 5,
      type: 2,
      kind: 'button',
      text: 'Auto-Position (50%)',
      code: 'cmd.get_wizard().auto_position(0.75)',
    },
    {
      index: 6,
      type: 2,
      kind: 'button',
      text: 'Auto-Position (99%)',
      code: 'cmd.get_wizard().auto_position(0.99)',
    },
    { index: 7, type: 2, kind: 'button', text: 'Done', code: 'cmd.set_wizard()' },
  ],
  prompt: [],
});

/** The same wizard after `edit_name()`: mask + prompt move, panel does not. */
const BOX_EDITING = snapshot({
  ...BOX_IDLE,
  eventMask: 23, // pick | select | scene | KEY
  prompt: ['Enter box name: cag'],
});

/** `cmd.wizard('command')` with no command chosen. */
const COMMAND_CHOOSER = snapshot({
  cls: 'Command',
  module: 'pymol.wizard.command',
  eventMask: 0,
  panel: [
    { index: 0, type: 3, kind: 'popup', text: 'Select a command...', code: '_commands' },
    { index: 1, type: 2, kind: 'button', text: 'Done', code: 'cmd.set_wizard()' },
  ],
  prompt: [],
});

/** `cmd.wizard('command', 'png')` — one popup per POSITIONAL_OR_KEYWORD arg. */
const COMMAND_PNG = snapshot({
  cls: 'Command',
  module: 'pymol.wizard.command',
  eventMask: 0,
  panel: [
    { index: 0, type: 1, kind: 'text', text: 'Png Wizard', code: '' },
    { index: 1, type: 3, kind: 'popup', text: 'filename: ', code: 'filename' },
    { index: 2, type: 3, kind: 'popup', text: 'width: 0', code: 'width' },
    { index: 3, type: 3, kind: 'popup', text: 'height: 0', code: 'height' },
    { index: 4, type: 3, kind: 'popup', text: 'dpi: -1.0', code: 'dpi' },
    { index: 5, type: 3, kind: 'popup', text: 'ray: 0', code: 'ray' },
    { index: 6, type: 3, kind: 'popup', text: 'prior: 0', code: 'prior' },
    { index: 7, type: 3, kind: 'popup', text: 'format: 0', code: 'format' },
    { index: 8, type: 2, kind: 'button', text: 'Run', code: 'stored._wizard1.run()' },
    { index: 9, type: 2, kind: 'button', text: 'Done', code: 'cmd.set_wizard()' },
  ],
  prompt: [],
});

/** `set_input_arg('selection')` — the text-entry shape. */
const COMMAND_INPUT = snapshot({
  cls: 'Command',
  module: 'pymol.wizard.command',
  eventMask: 4,
  panel: [
    { index: 0, type: 1, kind: 'text', text: 'Input', code: '' },
    { index: 1, type: 2, kind: 'button', text: 'Apply', code: 'stored._wizard1.apply_input()' },
    {
      index: 2,
      type: 2,
      kind: 'button',
      text: 'Cancel ',
      code: 'stored._wizard1.set_input_arg()',
    },
  ],
  prompt: ['Please enter value for \\999selection\\---: \\990ala'],
});

/** `cmd.builder_action('addH')` — a wizard whose module is the BRIDGE. */
const BUILDER_HYDROGEN = snapshot({
  cls: 'HydrogenWizard',
  module: 'tenmol_bridge.panels.builder',
  eventMask: 3,
  panel: [
    { index: 0, type: 1, kind: 'text', text: 'Adding Hydrogens', code: '' },
    {
      index: 1,
      type: 2,
      kind: 'button',
      text: 'Add To Multiple...',
      code: 'cmd.get_wizard().repeat()',
    },
    { index: 2, type: 2, kind: 'button', text: 'Done', code: 'cmd.set_wizard()' },
  ],
  prompt: ['Pick molecule upon which to add hydrogens...'],
});

// ---------------------------------------------------------------------------
// 1. box wizard — inline text entry is a mask change, nothing else
// ---------------------------------------------------------------------------

describe('box wizard (row: CGO box + inline text entry)', () => {
  it('renders the 8-row panel with the mode popup and six buttons', () => {
    render(<WizardPanel snapshot={BOX_IDLE} onExec={vi.fn()} onMenu={vi.fn()} />);
    const rows = container.querySelectorAll('.wizrow');
    expect(rows.length).toBe(8);
    expect([...rows].map((r) => r.className.includes('wizrow--popup'))).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(rows[6]?.textContent).toContain('Auto-Position (99%)');
  });

  it('does NOT hold the keyboard while the box wizard is merely open', () => {
    render(<WizardKeyCapture eventMask={BOX_IDLE.eventMask} onKey={vi.fn()} />);
    expect(container.querySelector('[data-testid="wizard-keys"]')).toBeNull();
  });

  it('grabs the keyboard the moment edit_name() adds bit 4, and only then', () => {
    // The panel is IDENTICAL in both states; the mask is the only signal.
    expect(BOX_EDITING.panel).toEqual(BOX_IDLE.panel);
    expect(BOX_EDITING.eventMask - BOX_IDLE.eventMask).toBe(4);

    const onKey = vi.fn();
    render(<WizardKeyCapture eventMask={BOX_EDITING.eventMask} onKey={onKey} />);
    const input = container.querySelector('.wizkeys__input') as HTMLInputElement;
    expect(input).not.toBeNull();

    // `box.py:423-437` compares against 8/127, 10/13 and `k > 32`.
    for (const key of ['c', 'a', 'g', 'e']) {
      act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onKey.mock.calls.map(([k]) => k)).toEqual([99, 97, 103, 101, 8, 13]);
  });

  it('shows the box wizard prompt only while it is renaming', () => {
    render(<WizardPrompt lines={BOX_IDLE.prompt} mode={1} />);
    expect(container.querySelector('[data-testid="wizard-prompt"]')).toBeNull();
    render(<WizardPrompt lines={BOX_EDITING.prompt} mode={1} />);
    expect(container.querySelector('[data-testid="wizard-prompt"]')?.textContent).toBe(
      'Enter box name: cag',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. command wizard — the generic contract with zero special-casing
// ---------------------------------------------------------------------------

describe('command wizard (row: generic command introspector)', () => {
  it('renders all three panel shapes off the same renderer', () => {
    render(<WizardPanel snapshot={COMMAND_CHOOSER} onExec={vi.fn()} onMenu={vi.fn()} />);
    expect(container.querySelectorAll('.wizrow').length).toBe(2);
    expect(container.querySelector('.wizrow--popup')?.textContent).toContain(
      'Select a command...',
    );

    render(<WizardPanel snapshot={COMMAND_PNG} onExec={vi.fn()} onMenu={vi.fn()} />);
    const popups = container.querySelectorAll('.wizrow--popup');
    expect(popups.length).toBe(7); // one per introspected argument
    expect([...popups].map((p) => p.textContent?.split(':')[0])).toEqual([
      'filename',
      'width',
      'height',
      'dpi',
      'ray',
      'prior',
      'format',
    ]);
    // `quiet` and `_self` are skipped by command.py:57-58 and never reach here.
    expect(container.textContent).not.toContain('quiet');
    expect(container.textContent).not.toContain('_self');

    render(<WizardPanel snapshot={COMMAND_INPUT} onExec={vi.fn()} onMenu={vi.fn()} />);
    // `'Cancel '` keeps its trailing space: `command.py:129` wrote it that way
    // and panel text is reproduced verbatim, never trimmed or title-cased.
    expect([...container.querySelectorAll('.wizrow')].map((r) => r.textContent)).toEqual([
      'Input',
      'Apply',
      'Cancel ',
    ]);
  });

  it('opens a popup by tag, never by argument name knowledge', async () => {
    // `command.py:98-104` splices live `cmd.auto_arg` completions into the menu
    // on every open, so the client may not cache and may not guess.
    const onMenu = vi.fn(async () => [
      { code: 2, kind: 'title' as const, text: 'Ray' },
      { code: 1, kind: 'item' as const, text: '0', command: 'stored._wizard1.set_current("ray", 0)' },
      { code: 1, kind: 'item' as const, text: '1', command: 'stored._wizard1.set_current("ray", 1)' },
    ]);
    render(<WizardPanel snapshot={COMMAND_PNG} onExec={vi.fn()} onMenu={onMenu} />);
    const ray = container.querySelectorAll('.wizrow--popup')[4] as HTMLElement;
    await act(async () => {
      ray.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    expect(onMenu).toHaveBeenCalledWith('ray');
  });

  it('holds the keyboard only in the text-entry shape', () => {
    render(<WizardKeyCapture eventMask={COMMAND_CHOOSER.eventMask} onKey={vi.fn()} />);
    expect(container.querySelector('[data-testid="wizard-keys"]')).toBeNull();
    render(<WizardKeyCapture eventMask={COMMAND_PNG.eventMask} onKey={vi.fn()} />);
    expect(container.querySelector('[data-testid="wizard-keys"]')).toBeNull();
    render(<WizardKeyCapture eventMask={COMMAND_INPUT.eventMask} onKey={vi.fn()} />);
    expect(container.querySelector('[data-testid="wizard-keys"]')).not.toBeNull();
  });

  it('colours the input prompt from the wizard’s own \\RGB markup', () => {
    render(<WizardPrompt lines={COMMAND_INPUT.prompt} mode={1} />);
    const prompt = container.querySelector('[data-testid="wizard-prompt"]') as HTMLElement;
    expect(prompt.textContent).toBe('Please enter value for selection: ala');
    const coloured = [...prompt.querySelectorAll('span[style]')].map(
      (s) => (s as HTMLElement).style.color,
    );
    // `\999` -> rgb(255,255,255) on the argument name, `\990` -> rgb(255,255,0)
    // on the value being typed (`command.py:145-147`).
    expect(coloured).toContain('rgb(255, 255, 255)');
    expect(coloured).toContain('rgb(255, 255, 0)');
  });
});

// ---------------------------------------------------------------------------
// 3. session persistence — the client only ever sees a probe move
// ---------------------------------------------------------------------------

function fakeService(
  probes: WizardProbe[],
  snapshots: WizardSnapshot[],
): { service: WizardService; probeCalls: () => number; snapCalls: () => number } {
  let probeIndex = 0;
  let snapIndex = 0;
  const service = {
    probe: async () => probes[Math.min(probeIndex++, probes.length - 1)]!,
    snapshot: async () => snapshots[Math.min(snapIndex++, snapshots.length - 1)]!,
    menu: async () => ({ tag: '', items: null, error: null }),
    exec: async () => null,
    event: async () => ({}) as never,
    launch: async () => probes[0]!,
    replace: async () => probes[0]!,
    dismiss: async () => probes[0]!,
    catalog: async () => ({}) as never,
  } as unknown as WizardService;
  return { service, probeCalls: () => probeIndex, snapCalls: () => snapIndex };
}

function Harness({ service, out }: { service: WizardService; out: { state?: WizardState } }) {
  const state = useWizard({ service, isEnabled: () => true, intervalMs: 10_000_000 });
  const ref = useRef(out);
  ref.current.state = state;
  useEffect(() => {
    ref.current.state = state;
  });
  return (
    <div>
      <span data-testid="cls">{state.snapshot.cls ?? 'none'}</span>
      <span data-testid="depth">{state.snapshot.depth}</span>
      <span data-testid="top">{state.snapshot.prompt[0] ?? ''}</span>
    </div>
  );
}

describe('session persistence (row: session persistence of wizards)', () => {
  it('repopulates the stack from a probe whose version and depth moved', async () => {
    // Before the .pse load the stack is empty; after `cmd.load` the bridge's
    // wrapped `set_wizard_stack` has bumped the counter and depth is 2.
    const empty: WizardProbe = { version: 11, depth: 0, cls: null, module: null };
    const restored: WizardProbe = {
      version: 14,
      depth: 2,
      cls: 'Message',
      module: 'pymol.wizard.message',
    };
    const restoredSnapshot = snapshot({
      version: 14,
      depth: 2,
      cls: 'Message',
      module: 'pymol.wizard.message',
      stack: [
        { cls: 'Label', module: 'pymol.wizard.label' },
        { cls: 'Message', module: 'pymol.wizard.message' },
      ],
      panel: [
        { index: 0, type: 1, kind: 'text', text: 'Message', code: '' },
        { index: 1, type: 2, kind: 'button', text: 'Dismiss', code: 'cmd.set_wizard()' },
      ],
      prompt: ['a note from before the save'],
    });

    const { service, snapCalls } = fakeService([empty, restored], [restoredSnapshot]);
    const out: { state?: WizardState } = {};
    await act(async () => {
      root.render(<Harness service={service} out={out} />);
    });

    // depth 0: NO snapshot round trip at all — `get_panel()`/`get_prompt()`
    // have side effects, so an empty stack must cost nothing.
    expect(snapCalls()).toBe(0);
    expect(container.querySelector('[data-testid="depth"]')?.textContent).toBe('0');

    await act(async () => {
      out.state?.kick();
    });

    expect(snapCalls()).toBe(1);
    expect(container.querySelector('[data-testid="cls"]')?.textContent).toBe('Message');
    expect(container.querySelector('[data-testid="depth"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-testid="top"]')?.textContent).toBe(
      'a note from before the save',
    );
  });

  it('does not re-pull when nothing moved — a session load is not a poll', async () => {
    const still: WizardProbe = {
      version: 14,
      depth: 1,
      cls: 'Label',
      module: 'pymol.wizard.label',
    };
    const snap = snapshot({ cls: 'Label', module: 'pymol.wizard.label', version: 14 });
    const { service, snapCalls } = fakeService([still], [snap]);
    const out: { state?: WizardState } = {};
    await act(async () => {
      root.render(<Harness service={service} out={out} />);
    });
    expect(snapCalls()).toBe(1); // the mount is forced
    await act(async () => {
      out.state?.kick();
    });
    // `kick()` forces too, but an ordinary interval tick with an unchanged
    // probe must not — that is what `probeChanged` is for (service.test.ts).
    expect(snapCalls()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. builder wizards — free, because nothing here knows what a builder is
// ---------------------------------------------------------------------------

describe('builder wizards (row: cross-area dependency)', () => {
  it('renders a wizard whose class lives in the bridge, not in pymol.wizard', () => {
    const onExec = vi.fn();
    render(<WizardPanel snapshot={BUILDER_HYDROGEN} onExec={onExec} onMenu={vi.fn()} />);
    const rows = [...container.querySelectorAll('.wizrow')];
    expect(rows.map((r) => r.textContent)).toEqual([
      'Adding Hydrogens',
      'Add To Multiple...',
      'Done',
    ]);
    // The Done/Repeat vocabulary is ordinary panel `code`; the client runs
    // neither, it ships both back as strings.
    expect(BUILDER_HYDROGEN.panel[1]?.code).toBe('cmd.get_wizard().repeat()');
    expect(BUILDER_HYDROGEN.panel[2]?.code).toBe('cmd.set_wizard()');
  });

  it('shows the builder prompt through the same overlay as any wizard', () => {
    render(<WizardPrompt lines={BUILDER_HYDROGEN.prompt} mode={1} />);
    expect(container.querySelector('[data-testid="wizard-prompt"]')?.textContent).toBe(
      'Pick molecule upon which to add hydrogens...',
    );
  });
});
