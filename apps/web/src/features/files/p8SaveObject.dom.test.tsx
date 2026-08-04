/**
 * Inventory row 271 — `_file_save_object`'s **no-objects** branch.
 *
 * `file_dialogs.py:816-820` is two dialogs, not one:
 *
 *     names = self.cmd.get_names_of_type(otype)
 *     if not names:
 *         QtWidgets.QMessageBox.warning(self, "Warning", noobjectsmsg)
 *         return
 *
 * Wave 4 exercised the populated form (Export Map and Export Alignment both
 * showed the object combo) and wrote down that the warning path had NOT been
 * run — which matters, because it is the branch a user hits FIRST: a fresh
 * session has no `object:map` and no `object:alignment`, and the wrong
 * behaviour here is an empty combo with a live "Save…" button that would call
 * `cmd.save(fname, '', -1)` and write a file named after nothing.
 *
 * The two `noobjectsmsg` strings are upstream's, verbatim
 * (`file_dialogs.py:845-855`).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaveObjectDialog } from './SaveDialogs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NO_MAPS = 'No map objects loaded';
const NO_ALIGNMENTS =
  'No alignment objects loaded\n\nHint: create alignment objects with "align" and\n"super" using the "object=..." argument.';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactElement) {
  act(() => root.render(node));
}

describe('SaveObjectDialog with no objects of the type', () => {
  it('shows QMessageBox.warning, not the form', () => {
    const onPick = vi.fn();
    render(
      <SaveObjectDialog
        title="Save object:map"
        names={[]}
        emptyMessage={NO_MAPS}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Warning');
    expect(container.textContent).toContain(NO_MAPS);
    // The form is what must NOT be there: no combo, so no way to press Save…
    // with an empty object name.
    expect(container.querySelector('select')).toBeNull();
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      '×',
      'OK',
    ]);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('closes on OK and never picks a name', () => {
    const onClose = vi.fn();
    const onPick = vi.fn();
    render(
      <SaveObjectDialog
        title="Save object:alignment"
        names={[]}
        emptyMessage={NO_ALIGNMENTS}
        onPick={onPick}
        onClose={onClose}
      />,
    );

    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent === 'OK');
    act(() => ok?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("keeps the alignment hint's line breaks, like QMessageBox does", () => {
    render(
      <SaveObjectDialog
        title="Save object:alignment"
        names={[]}
        emptyMessage={NO_ALIGNMENTS}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const block = container.querySelector('pre');
    expect(block?.textContent).toBe(NO_ALIGNMENTS);
    // …and the hint is not silently truncated at the first newline.
    expect(container.textContent).toContain('"super" using the "object=..." argument.');
  });
});

describe('SaveObjectDialog with objects', () => {
  it('is the other dialog entirely: a combo seeded with the first name', () => {
    const onPick = vi.fn();
    render(
      <SaveObjectDialog
        title="Save object:map"
        names={['emd_1155', '2fofc']}
        emptyMessage={NO_MAPS}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Save object:map');
    const select = container.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['emd_1155', '2fofc']);
    // `form.input_name.addItems(names)` leaves index 0 current.
    expect(select.value).toBe('emd_1155');

    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save…',
    );
    act(() => save?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onPick).toHaveBeenCalledWith('emd_1155');
  });
});
