/*
 * NOTE: `p13shortcutEditor.dom.test.tsx` in this directory covers the same
 * component. Two agents wrote them independently in the same pass; both are
 * correct and neither is a strict superset, so both are kept rather than one
 * being deleted on the assumption it was redundant. Worth consolidating.
 */
/**
 * Row 192 — the Keyboard Shortcut Menu dialog itself.
 *
 * The row names a lot of specific behaviour: "a live regex Filter, a Refresh
 * button (tooltip `Refresh the table to reflect any external changes`), a
 * 3-column table (Key / Command (click to edit) / Description) where only
 * Command is editable and deleted rows read `Deleted`, and buttons Create New /
 * Delete Selected / Reset Selected / Reset All / Save. Create New opens a form
 * with a live key-capture field ... that silently rejects reserved keys
 * (CTRL-S, CTRL-E, CTRL-O, CTRL-M, up, down). Overwrites go through a confirm
 * dialog with a 'do not show' checkbox. Save persists to
 * `~/.pymol/shortcuts_save.json`" (`packages/engine/modules/pmg_qt/
 * shortcut_menu_gui.py:43-415`).
 *
 * WHY THIS FILE EXISTS. The row cited `packages/bridge/tests/test_shortcuts.py`
 * — which is real, but is the ENGINE half (`set_key` accept/refuse, the save
 * file round trip) — and `save.test.ts`, which re-implements the payload shape
 * locally and never imports `ShortcutEditor` at all. Measured while auditing:
 * deleting `if (isReservedKey(name)) return;` from the capture field left the
 * whole 1,906-test web suite green. Nothing rendered this dialog.
 *
 * The four properties below are the ones whose breakage is silent:
 *
 *  * A RESERVED KEY SILENTLY REJECTED. Binding CTRL-S / CTRL-O steals the
 *    browser's own save/open, and upstream drops it with no message
 *    (`shortcut_menu_gui.py:288-290`) — so a client that accepted it would
 *    look like it worked.
 *  * THE FILTER MUST NOT THROW. It is applied on every keystroke, so the user
 *    types through invalid intermediate regexes (`[`, `(`) on the way to a
 *    valid one; an uncaught `SyntaxError` blanks the dialog.
 *  * DELETE IS `set_key(key, '')`, NOT a client-side row removal. A default
 *    row stays and reads `Deleted`; only a created one disappears
 *    (`shortcut_menu_gui.py:216-243`).
 *  * SAVE WRITES THE 3-ELEMENT LIST. `setkey_from_dict` replays element [2];
 *    a flat `{key: command}` round-trips perfectly and then binds the key to
 *    `command[2]`, one character, at the next startup.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShortcutEditor } from './ShortcutEditor';

interface ActArgs {
  fn: string;
  args: readonly unknown[];
  echo: string;
}

const SESSION = {
  act: vi.fn(async (_call: ActArgs) => undefined),
  call: vi.fn(async (_fn: string, _args?: readonly unknown[]) => undefined as unknown),
  run: vi.fn(async (_line: string) => undefined),
};
vi.mock('../../app', () => ({
  useSession: () => SESSION,
  errorText: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(): Promise<void> {
  await act(async () => {
    root.render(<ShortcutEditor onClose={() => undefined} />);
  });
}

function query<T extends Element>(selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element;
}

function buttonNamed(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Type into a controlled input the way React wants it. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Press a chord at the live-capture field. */
async function press(init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    query<HTMLInputElement>('[data-testid="shortcut-capture"]').dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  });
}

const rowKeys = (): string[] =>
  [...container.querySelectorAll('tbody tr')].map(
    (tr) => tr.getAttribute('data-testid')?.replace('shortcut-row-', '') ?? '',
  );

function rowFor(key: string): HTMLTableRowElement {
  return query<HTMLTableRowElement>(`[data-testid="shortcut-row-${key}"]`);
}

/** `[fn, ...args]` for every `set_key` the dialog issued. */
const setKeyCalls = (): unknown[][] =>
  SESSION.act.mock.calls
    .map(([call]) => call)
    .filter((call) => call.fn === 'set_key')
    .map((call) => [...call.args]);

beforeEach(() => {
  SESSION.act.mockClear();
  SESSION.call.mockClear();
  SESSION.run.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the dialog chrome the row enumerates', () => {
  it('is a three-column table with the upstream headers and the five buttons', async () => {
    await render();
    expect([...container.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Key',
      'Command (click to edit)',
      'Description',
    ]);
    for (const label of [
      'Create New',
      'Delete Selected',
      'Reset Selected',
      'Reset All',
      'Save',
      'Refresh',
    ]) {
      expect(buttonNamed(label), label).toBeTruthy();
    }
    // The tooltip is a promise about behaviour, quoted verbatim upstream.
    expect(buttonNamed('Refresh').title).toBe(
      'Refresh the table to reflect any external changes',
    );
    // Nothing is selected yet, so the two "Selected" buttons are dead.
    expect(buttonNamed('Delete Selected').disabled).toBe(true);
    expect(buttonNamed('Reset Selected').disabled).toBe(true);
  });

  it('seeds from the default table, which is more than 100 bindings', async () => {
    await render();
    const keys = rowKeys();
    expect(keys.length).toBeGreaterThan(100);
    expect(keys).toContain('CTRL-A');
    expect(keys).toContain('ALT-1');
  });
});

describe('the live Filter', () => {
  it('narrows by regex across key, command and description', async () => {
    await render();
    await type(query<HTMLInputElement>('[data-testid="shortcut-filter"]'), '^CTSH-F1$');
    expect(rowKeys()).toEqual(['CTSH-F1']);
  });

  it('falls back to a substring match instead of throwing on a half-typed regex', async () => {
    // The filter runs on every keystroke, so `CTRL-[` exists on the way to
    // `CTRL-[AB]`. `new RegExp('[')` throws; an uncaught throw here blanks the
    // whole dialog mid-word.
    await render();
    const filter = query<HTMLInputElement>('[data-testid="shortcut-filter"]');
    await type(filter, '[');
    expect(rowKeys().length).toBe(0); // no key contains a literal '['
    await type(filter, 'CTSH-F1');
    expect(rowKeys()).toContain('CTSH-F1');
  });
});

describe('the Create-New key-capture field', () => {
  it('shows PyMOL’s name for the chord, not the character typed', async () => {
    await render();
    await click(buttonNamed('Create New'));
    await press({ key: 'j', code: 'KeyJ', ctrlKey: true });
    expect(query<HTMLInputElement>('[data-testid="shortcut-capture"]').value).toBe('CTRL-J');
    // Ctrl+Shift is CTSH, not "CTRL+SHIFT"; macOS Meta folds onto CTRL.
    await press({ key: 'j', code: 'KeyJ', ctrlKey: true, shiftKey: true });
    expect(query<HTMLInputElement>('[data-testid="shortcut-capture"]').value).toBe('CTSH-J');
    await press({ key: 'PageUp' });
    expect(query<HTMLInputElement>('[data-testid="shortcut-capture"]').value).toBe('pgup');
  });

  it('SILENTLY rejects each of the six reserved keys', async () => {
    await render();
    await click(buttonNamed('Create New'));
    const capture = query<HTMLInputElement>('[data-testid="shortcut-capture"]');
    // Seed with something legal so a rejection is visible as "unchanged".
    await press({ key: 'j', code: 'KeyJ', ctrlKey: true });
    expect(capture.value).toBe('CTRL-J');

    for (const reserved of [
      { key: 's', code: 'KeyS', ctrlKey: true }, // CTRL-S
      { key: 'e', code: 'KeyE', ctrlKey: true }, // CTRL-E
      { key: 'o', code: 'KeyO', ctrlKey: true }, // CTRL-O
      { key: 'm', code: 'KeyM', ctrlKey: true }, // CTRL-M
      { key: 'ArrowUp' }, // up
      { key: 'ArrowDown' }, // down
    ]) {
      await press(reserved);
      expect(capture.value, JSON.stringify(reserved)).toBe('CTRL-J');
    }
    // Silently: no error line, exactly as `shortcut_menu_gui.py:288-290`.
    expect(query('[data-testid="shortcut-status"]').textContent).toBe('');
  });

  it('needs both a key and a command before Create is live', async () => {
    await render();
    await click(buttonNamed('Create New'));
    expect(buttonNamed('Create').disabled).toBe(true);
    await press({ key: 'j', code: 'KeyJ', ctrlKey: true });
    expect(buttonNamed('Create').disabled).toBe(true);
    await type(query<HTMLInputElement>('[data-testid="shortcut-command"]'), 'zoom');
    expect(buttonNamed('Create').disabled).toBe(false);
  });
});

describe('Create New over an existing binding', () => {
  it('asks before overwriting, and the confirm is what issues set_key', async () => {
    await render();
    await click(buttonNamed('Create New'));
    // CTRL-A is a default binding (`select sele, all, 1`).
    await press({ key: 'a', code: 'KeyA', ctrlKey: true });
    await type(query<HTMLInputElement>('[data-testid="shortcut-command"]'), 'zoom');
    await click(buttonNamed('Create'));

    expect(setKeyCalls()).toEqual([]);
    const dialog = query('[role="alertdialog"]');
    expect(dialog.textContent).toContain('CTRL-A');
    expect(dialog.textContent).toContain('do not show this again');

    await click(buttonNamed('Confirm'));
    expect(setKeyCalls()).toEqual([['CTRL-A', 'zoom']]);
  });

  it('Cancel leaves the binding alone', async () => {
    await render();
    await click(buttonNamed('Create New'));
    await press({ key: 'a', code: 'KeyA', ctrlKey: true });
    await type(query<HTMLInputElement>('[data-testid="shortcut-command"]'), 'zoom');
    await click(buttonNamed('Create'));
    // The confirm's own Cancel — the Create form has one too, and dismissing
    // the FORM is not the same gesture as declining the overwrite.
    const dialogCancel = [...query('[role="alertdialog"]').querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel',
    );
    expect(dialogCancel).toBeTruthy();
    await click(dialogCancel as HTMLButtonElement);
    expect(setKeyCalls()).toEqual([]);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('a NEW key needs no confirmation', async () => {
    await render();
    await click(buttonNamed('Create New'));
    await press({ key: 'j', code: 'KeyJ', ctrlKey: true });
    await type(query<HTMLInputElement>('[data-testid="shortcut-command"]'), 'orient');
    await click(buttonNamed('Create'));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(setKeyCalls()).toEqual([['CTRL-J', 'orient']]);
    expect(rowKeys()).toContain('CTRL-J');
  });
});

describe('Delete Selected and Reset Selected go through cmd.set_key', () => {
  it('delete unbinds with an EMPTY command and leaves the row reading Deleted', async () => {
    await render();
    await click(rowFor('CTRL-A'));
    expect(buttonNamed('Delete Selected').disabled).toBe(false);
    await click(buttonNamed('Delete Selected'));

    expect(setKeyCalls()).toEqual([['CTRL-A', '']]);
    // The row survives — it is a DEFAULT binding — and says so.
    expect(rowKeys()).toContain('CTRL-A');
    expect(rowFor('CTRL-A').textContent).toContain('Deleted');
  });

  it('reset rebinds the DEFAULT command, which is what upstream does', async () => {
    await render();
    await click(rowFor('CTSH-R'));
    await click(buttonNamed('Reset Selected'));
    // `shortcut_dict.py` binds CTSH-R to `h_fill`.
    expect(setKeyCalls()).toEqual([['CTSH-R', 'h_fill']]);
  });

  it('a CREATED binding disappears on delete instead of reading Deleted', async () => {
    await render();
    await click(buttonNamed('Create New'));
    await press({ key: 'j', code: 'KeyJ', ctrlKey: true });
    await type(query<HTMLInputElement>('[data-testid="shortcut-command"]'), 'orient');
    await click(buttonNamed('Create'));
    expect(rowKeys()).toContain('CTRL-J');

    await click(rowFor('CTRL-J'));
    await click(buttonNamed('Delete Selected'));
    expect(rowKeys()).not.toContain('CTRL-J');
  });
});

describe('Save', () => {
  it('writes a 3-element list per key through save_shortcut.save_shortcuts', async () => {
    await render();
    await click(buttonNamed('Create New'));
    await press({ key: 'j', code: 'KeyJ', ctrlKey: true });
    await type(query<HTMLInputElement>('[data-testid="shortcut-command"]'), 'orient');
    await click(buttonNamed('Create'));
    await click(buttonNamed('Save'));

    const call = SESSION.call.mock.calls.find(([fn]) => fn === 'save_shortcut.save_shortcuts');
    expect(call, 'Save did not reach save_shortcut.save_shortcuts').toBeTruthy();
    const payload = (call as [string, unknown[]])[1][0] as Record<string, unknown>;

    for (const [key, value] of Object.entries(payload)) {
      expect(Array.isArray(value), key).toBe(true);
      expect((value as unknown[]).length, key).toBe(3);
    }
    // Element [2] is what `setkey_from_dict` replays; an untouched default has
    // a falsy [2] and is skipped at startup.
    expect(payload['CTRL-J']).toEqual(['', '', 'orient']);
    expect((payload['CTSH-R'] as string[])[2]).toBe('');
    expect((payload['CTSH-R'] as string[])[0]).toBe('h_fill');
    expect(query('[data-testid="shortcut-status"]').textContent).toContain(
      '~/.pymol/shortcuts_save.json',
    );
  });

  it('says the bindings are still live when only persistence failed', async () => {
    SESSION.call.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    await render();
    await click(buttonNamed('Save'));
    const status = query('[data-testid="shortcut-status"]').textContent ?? '';
    expect(status).toContain('disk full');
    expect(status).toContain('live in PyMOL');
  });
});
