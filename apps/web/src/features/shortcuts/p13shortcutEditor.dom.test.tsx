/*
 * NOTE: `p13editor.dom.test.tsx` in this directory covers the same
 * component. Two agents wrote them independently in the same pass; both are
 * correct and neither is a strict superset, so both are kept rather than one
 * being deleted on the assumption it was redundant. Worth consolidating.
 */
/**
 * Wave 13 — the Keyboard Shortcut Menu (rows 455 and 456), client side.
 *
 * The two citations these rows carried were `†`, and one of them was worse
 * than weak. `save.test.ts` — cited for row 456's Save button — declares its
 * own local `payloadFor()` helper and asserts against that:
 *
 *     function payloadFor(rows) { ... }        // in the TEST file
 *
 * It imports nothing from `ShortcutEditor.tsx`. Deleting the whole `save()`
 * callback, or writing a flat `{key: command}` map, cannot make it fail. It
 * documents the file format; it does not protect the code that writes it.
 *
 * `packages/bridge/tests/test_shortcuts.py` and `test_p8_a34.py` ARE real, and
 * they cover the other end: `cmd.set_key`'s validation, delete-as-`set_key('')`,
 * reset-as-`set_key(default)`, the save-file round trip, and that the mirrored
 * default table matches PyMOL's own. What no test touched was the 496-line
 * React component in between — the filter, the single editable column, the
 * five buttons, the key-capture field and the overwrite confirmation.
 *
 * So this file mounts the real `<ShortcutEditor>` and asserts the exact calls
 * that reach the bridge. Only `useSession` is doubled.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHORTCUTS } from '../mouse/tables';
import { ShortcutEditor } from './ShortcutEditor';

interface Call {
  fn: string;
  args: readonly unknown[];
  kwargs?: Record<string, unknown>;
  echo?: string;
}

const acted: Call[] = [];
const called: Call[] = [];
const ran: string[] = [];
/** Set to make `cmd.tenmol_shortcuts.key_mappings` answer, or throw. */
let liveBindings: { entries: unknown[] } | Error = new Error('cmd.tenmol_shortcuts is not defined');

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = [], kwargs = {}) => {
    called.push({ fn, args, kwargs: kwargs as Record<string, unknown> });
    if (fn === 'cmd.tenmol_shortcuts.key_mappings') {
      if (liveBindings instanceof Error) throw liveBindings;
      return liveBindings;
    }
    return null;
  }),
  act: vi.fn(async (action: Call) => {
    acted.push(action);
  }),
  run: vi.fn(async (line: string) => {
    ran.push(line);
  }),
};

vi.mock('../../app', () => ({
  useSession: () => SESSION,
  errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  acted.length = 0;
  called.length = 0;
  ran.length = 0;
  liveBindings = new Error('cmd.tenmol_shortcuts is not defined');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<ShortcutEditor onClose={() => {}} />);
  });
  await act(async () => {});
}

const q = <T extends Element>(selector: string): T | null => container.querySelector<T>(selector);
const rows = (): HTMLTableRowElement[] =>
  [...container.querySelectorAll('tbody tr')] as HTMLTableRowElement[];
const rowFor = (key: string) => q<HTMLTableRowElement>(`[data-testid="shortcut-row-${key}"]`);
const status = () => q('[data-testid="shortcut-status"]')!.textContent ?? '';
const setKeys = () => acted.filter((a) => a.fn === 'set_key');

function button(titleFragment: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) =>
    (b.getAttribute('title') ?? '').includes(titleFragment),
  );
  if (!found) throw new Error(`no button whose title contains ${titleFragment}`);
  return found as HTMLButtonElement;
}

function byText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button labelled ${text}`);
  return found as HTMLButtonElement;
}

function click(node: Element) {
  act(() => {
    (node as HTMLElement).click();
  });
}

async function clickAsync(node: Element) {
  await act(async () => {
    (node as HTMLElement).click();
  });
  await act(async () => {});
}

/** React installs its own value setter; go through the prototype's. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(node: Element, init: KeyboardEventInit) {
  act(() => {
    node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

/** React's `onBlur` is delegated from `focusout`, which must bubble. */
async function blurEditor(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await act(async () => {});
}

/** Double-click the Command cell, type `command`, commit it. */
async function editCommand(key: string, command: string) {
  const row = rowFor(key)!;
  dblclick([...row.querySelectorAll('td')][1]!);
  const editor = row.querySelector('input.scmodal__edit') as HTMLInputElement;
  typeInto(editor, command);
  await blurEditor(editor);
}

function dblclick(node: Element) {
  act(() => {
    node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}

/* ====================================================================== 455 */

describe('row 455 — the filterable three-column table', () => {
  it('has the three headers upstream names, including the "click to edit" hint', async () => {
    await render();
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['Key', 'Command (click to edit)', 'Description']);
  });

  it('seeds one row per default binding', async () => {
    await render();
    expect(rows()).toHaveLength(DEFAULT_SHORTCUTS.length);
    expect(rowFor('CTRL-A')).not.toBeNull();
  });

  it('filters across ALL THREE columns, case-insensitively', async () => {
    await render();
    const filter = q<HTMLInputElement>('[data-testid="shortcut-filter"]')!;

    // matches the KEY column only
    typeInto(filter, 'ctrl-a');
    expect(rowFor('CTRL-A')).not.toBeNull();
    expect(rows().length).toBeLessThan(DEFAULT_SHORTCUTS.length);

    // matches the DESCRIPTION column of CTRL-A ("select all"), whose key and
    // command contain no "select all".
    typeInto(filter, 'SELECT ALL');
    expect(rowFor('CTRL-A')).not.toBeNull();

    typeInto(filter, 'zzz-no-such-binding');
    expect(rows()).toHaveLength(0);
  });

  it('treats the filter as a REGEX, and survives a half-typed one', async () => {
    await render();
    const filter = q<HTMLInputElement>('[data-testid="shortcut-filter"]')!;

    typeInto(filter, '^CTRL-(A|C)$');
    expect(
      rows()
        .map((r) => r.querySelector('.scmodal__key')!.textContent)
        .sort(),
    ).toEqual(['CTRL-A', 'CTRL-C']);

    // `new RegExp('[')` throws; an in-progress character class must NARROW the
    // table, not blow the component up.
    typeInto(filter, '[');
    expect(rows()).toHaveLength(0);
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('makes ONLY the Command cell editable — the Key and Description cells are not', async () => {
    await render();
    const row = rowFor('CTRL-A')!;
    const [keyCell, commandCell, descriptionCell] = [...row.querySelectorAll('td')];

    dblclick(keyCell!);
    expect(row.querySelector('input')).toBeNull();
    dblclick(descriptionCell!);
    expect(row.querySelector('input')).toBeNull();

    dblclick(commandCell!);
    expect(row.querySelector('input.scmodal__edit')).not.toBeNull();
  });

  it('an edit calls cmd.set_key(key, text) and marks the row user-defined', async () => {
    await render();
    await editCommand('CTRL-A', 'orient');

    expect(setKeys()).toHaveLength(1);
    expect(setKeys()[0]!.args).toEqual(['CTRL-A', 'orient']);
    expect(rowFor('CTRL-A')!.querySelectorAll('td')[1]!.textContent).toBe('orient');
    expect(rowFor('CTRL-A')!.querySelectorAll('td')[1]!.className).toContain('is-user');
  });

  it('Refresh re-reads the LIVE bindings, not the compiled-in defaults', async () => {
    await render();
    liveBindings = {
      entries: [
        { key: 'CTRL-A', kind: 'command', command: 'orient', callable: null },
        { key: 'CTRL-J', kind: 'command', command: 'ray', callable: null },
        { key: 'F5', kind: 'callable', command: '', callable: 'my_plugin_hook' },
      ],
    };

    await clickAsync(button('reflect any external changes'));

    expect(rows()).toHaveLength(3);
    // An external `set_key CTRL-A, orient` is now visible — the thing the
    // button's own tooltip promises and the seeded table could never show.
    expect(rowFor('CTRL-A')!.querySelectorAll('td')[1]!.textContent).toBe('orient');
    // A Python callable is named, never repr()-ed with an address.
    expect(rowFor('F5')!.querySelectorAll('td')[1]!.textContent).toBe('<my_plugin_hook>');
    expect(status()).toContain('3 live bindings');
  });

  it('bootstraps the bridge module once, then falls back to the defaults and SAYS SO', async () => {
    await render();
    await clickAsync(button('reflect any external changes'));

    expect(ran).toEqual(['import tenmol_bridge.panels.shortcuts as _ts; _ts.install()']);
    expect(rows()).toHaveLength(DEFAULT_SHORTCUTS.length);
    expect(status()).toContain('showing the default table instead');
  });
});

/* ====================================================================== 456 */

describe('row 456 — create / delete / reset / reset-all / save', () => {
  it('Delete Selected and Reset Selected are disabled until a row is selected', async () => {
    await render();
    expect(button('Unbind selected').disabled).toBe(true);
    expect(button('Restore selected').disabled).toBe(true);

    click(rowFor('CTRL-A')!);
    expect(button('Unbind selected').disabled).toBe(false);
    expect(button('Restore selected').disabled).toBe(false);
  });

  it('Delete Selected unbinds with set_key(key, "") and the row reads `Deleted`', async () => {
    await render();
    click(rowFor('CTRL-A')!);
    await clickAsync(button('Unbind selected'));

    expect(setKeys()).toHaveLength(1);
    expect(setKeys()[0]!.args).toEqual(['CTRL-A', '']);
    const cells = [...rowFor('CTRL-A')!.querySelectorAll('td')].map((td) => td.textContent);
    // Upstream writes the literal string `Deleted` into both columns
    // (`shortcut_menu_gui.py:216-238`).
    expect(cells[1]).toBe('Deleted');
    expect(cells[2]).toBe('Deleted');
  });

  it('Reset Selected restores the DEFAULT command, not an empty one', async () => {
    const original = DEFAULT_SHORTCUTS.find((s) => s.key === 'CTRL-A')!.command;
    await render();

    // change it first
    await editCommand('CTRL-A', 'orient');

    click(rowFor('CTRL-A')!);
    await clickAsync(button('Restore selected'));

    expect(setKeys().map((a) => a.args)).toEqual([
      ['CTRL-A', 'orient'],
      ['CTRL-A', original],
    ]);
    expect(rowFor('CTRL-A')!.querySelectorAll('td')[1]!.textContent).toBe(original);
  });

  it('Reset All re-sends the default for every CHANGED row and nothing else', async () => {
    await render();
    for (const key of ['CTRL-A', 'CTRL-C']) await editCommand(key, 'ray');
    const afterEdits = setKeys().length;

    await clickAsync(button('Restore all key bindings'));

    // Two changed rows -> two restores; the other 100+ untouched rows must NOT
    // generate a round trip each.
    const restores = setKeys().slice(afterEdits);
    expect(restores.map((a) => a.args)).toEqual([
      ['CTRL-A', DEFAULT_SHORTCUTS.find((s) => s.key === 'CTRL-A')!.command],
      ['CTRL-C', DEFAULT_SHORTCUTS.find((s) => s.key === 'CTRL-C')!.command],
    ]);
    expect(status()).toContain('restored to their defaults');
  });

  it('Save writes the 3-ELEMENT list per key that setkey_from_dict replays', async () => {
    await render();
    await editCommand('CTRL-A', 'orient');

    await clickAsync(button('Save the current key bindings'));

    const save = called.find((c) => c.fn === 'save_shortcut.save_shortcuts');
    expect(save).toBeDefined();
    const payload = save!.args[0] as Record<string, unknown>;
    const entry = payload['CTRL-A'] as string[];
    // NOT a bare command string: `setkey_from_dict` indexes `[2]`, so a flat
    // map would rebind the key to a single character at the next startup.
    expect(Array.isArray(entry)).toBe(true);
    expect(entry).toHaveLength(3);
    expect(entry[0]).toBe(DEFAULT_SHORTCUTS.find((s) => s.key === 'CTRL-A')!.command);
    expect(entry[2]).toBe('orient');
    // an untouched row saves with a FALSY [2], which is how startup skips it
    expect((payload['CTRL-C'] as string[])[2]).toBe('');
    expect(status()).toContain('~/.pymol/shortcuts_save.json');
  });

  it('Save reports a failure and says the live bindings survived it', async () => {
    await render();
    SESSION.call.mockImplementationOnce(async () => {
      throw new Error('no write permission');
    });

    await clickAsync(button('Save the current key bindings'));

    expect(status()).toContain('Save failed: no write permission');
    expect(status()).toContain('live in PyMOL either way');
  });

  it('Create New captures a CHORD, not the letters typed', async () => {
    await render();
    click(button('does not currently appear'));
    const capture = q<HTMLInputElement>('[data-testid="shortcut-capture"]')!;

    press(capture, { key: 'j', ctrlKey: true, code: 'KeyJ' });
    expect(capture.value).toBe('CTRL-J');

    // A bare letter is not bindable at all (`controlling.py:781-790`), so the
    // field must not accept it.
    press(capture, { key: 'q', code: 'KeyQ' });
    expect(capture.value).toBe('CTRL-J');
  });

  it('silently drops the six reserved keys, exactly as upstream does', async () => {
    await render();
    click(button('does not currently appear'));
    const capture = q<HTMLInputElement>('[data-testid="shortcut-capture"]')!;

    const reserved: ReadonlyArray<readonly [string, string]> = [
      ['s', 'KeyS'],
      ['e', 'KeyE'],
      ['o', 'KeyO'],
      ['m', 'KeyM'],
    ];
    for (const [key, code] of reserved) {
      press(capture, { key, ctrlKey: true, code });
      // No error, no message — the field simply does not fill in.
      expect(capture.value).toBe('');
    }
  });

  it('creating an UNUSED key binds it straight away and adds a row', async () => {
    await render();
    const before = rows().length;
    click(button('does not currently appear'));

    press(q('[data-testid="shortcut-capture"]')!, { key: 'j', ctrlKey: true, code: 'KeyJ' });
    typeInto(q<HTMLInputElement>('[data-testid="shortcut-command"]')!, 'ray');
    await clickAsync(byText('Create'));

    expect(setKeys()).toHaveLength(1);
    expect(setKeys()[0]!.args).toEqual(['CTRL-J', 'ray']);
    expect(rows()).toHaveLength(before + 1);
    expect(q('[data-testid="shortcut-create"]')).toBeNull();
  });

  it('creating an EXISTING key asks first, and Cancel binds nothing', async () => {
    await render();
    click(button('does not currently appear'));

    press(q('[data-testid="shortcut-capture"]')!, { key: 'a', ctrlKey: true, code: 'KeyA' });
    typeInto(q<HTMLInputElement>('[data-testid="shortcut-command"]')!, 'ray');
    await clickAsync(byText('Create'));

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('CTRL-A');
    expect(setKeys()).toEqual([]);

    await clickAsync(byText('Cancel'));
    expect(setKeys()).toEqual([]);
  });

  it('Confirm overwrites, and "do not show this again" skips the NEXT one', async () => {
    await render();
    click(button('does not currently appear'));
    press(q('[data-testid="shortcut-capture"]')!, { key: 'a', ctrlKey: true, code: 'KeyA' });
    typeInto(q<HTMLInputElement>('[data-testid="shortcut-command"]')!, 'ray');
    await clickAsync(byText('Create'));

    const skip = container.querySelector('[role="alertdialog"] input[type="checkbox"]')!;
    click(skip);
    await clickAsync(byText('Confirm'));

    expect(setKeys()).toHaveLength(1);
    expect(setKeys()[0]!.args).toEqual(['CTRL-A', 'ray']);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();

    // Second overwrite of an existing key: no dialog this time.
    click(button('does not currently appear'));
    press(q('[data-testid="shortcut-capture"]')!, { key: 'c', ctrlKey: true, code: 'KeyC' });
    typeInto(q<HTMLInputElement>('[data-testid="shortcut-command"]')!, 'turn x, 90');
    await clickAsync(byText('Create'));

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(setKeys()).toHaveLength(2);
    expect(setKeys()[1]!.args).toEqual(['CTRL-C', 'turn x, 90']);
  });
});
