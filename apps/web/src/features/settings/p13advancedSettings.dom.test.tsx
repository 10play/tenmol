/**
 * Wave 13 — row 458, **Advanced Settings dialog**, the RENDERING RULES.
 *
 * The row carried four `†` citations, all bridge files. One of them —
 * `packages/bridge/tests/test_advanced_settings.py` — is genuinely about this
 * row and pins the engine end: `setting.get_name_list()` is 779 names,
 * `get_setting_tuple` answers `[typeCode, values]` with the `cSetting_*` codes
 * 1..5, `cmd.get` returns a FORMATTED string, and `cmd.set` writes through.
 *
 * What none of the four can see is the sentence that follows in the row:
 *
 *   "Booleans render as checkboxes, ints/strings as text, floats/float3/colors
 *    as text from `cmd.get(index)`."
 *
 * That is a client rule, and it was unprotected. Measured against the whole
 * `features/settings` + `packages/stores` suite:
 *
 *   `if (meta.kind === 'boolean' && !writeOnly)` -> `if (false)`   GREEN
 *   `return entry.text || String(entry.value)`   -> drop `.text`   GREEN
 *   dropping `{log: 1, quiet: 0}` from `cmd.set`                   GREEN
 *
 * The first two are exactly the failure `test_advanced_settings.py`'s own
 * docstring warns about — "if the codes ever shifted, every checkbox would
 * become a text box and nothing would fail loudly". Nothing did.
 *
 * `settings.test.ts` already proves `filterSettings` and that the write sends
 * the setting INDEX (renaming `filterSettings` or swapping index for name both
 * go red there), so neither is re-asserted; this file is the table.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingCatalogue, SettingMeta } from '@tenmol/protocol';
import {
  SETTINGS_BOOTSTRAP,
  createSettingsSource,
  createSettingsStore,
} from '@tenmol/stores/settings';
import { AdvancedSettingsTable } from './AdvancedSettingsTable';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;

/**
 * One setting per `cSetting_*` type code the dialog branches on
 * (`advanced_settings_gui.py:55-70`), each at `global` level so every row is
 * writable in the default scope.
 */
const SETTINGS: SettingMeta[] = [
  { name: 'orthoscopic', index: 23, kind: 'boolean', level: 'global', default: 0 },
  { name: 'two_sided_lighting', index: 90, kind: 'boolean', level: 'global', default: 0 },
  { name: 'ray_trace_mode', index: 442, kind: 'int', level: 'global', default: 0 },
  { name: 'sphere_scale', index: 155, kind: 'float', level: 'global', default: 1 },
  { name: 'bg_rgb', index: 6, kind: 'color', level: 'global', default: 0 },
  { name: 'label_placement_offset', index: 622, kind: 'float3', level: 'global', default: 0 },
  { name: 'pse_export_version', index: 574, kind: 'string', level: 'global', default: '0' },
] as SettingMeta[];

/**
 * The values as the engine reports them: `[raw, cmd.get text]`. The two forms
 * DIFFER on purpose for the float/color/float3 rows — that difference is the
 * whole point of the row's "as text from `cmd.get(index)`" clause, because the
 * text form is the only place a colour index becomes a colour NAME and a
 * float3 becomes `[ x, y, z ]`.
 */
const VALUES = new Map<number, [unknown, string]>([
  [23, [1, '1']],
  [90, [0, '0']],
  // Deliberately divergent: `cmd.get` and `str(value)` AGREE for a real int
  // or string, so the only way to see WHICH rule the cell applied is to make
  // them disagree in the fixture.
  [442, [3, 'INT-TEXT-FORM']],
  [155, [0.5, '0.50000']],
  [6, [17, 'white']],
  [622, [[1, 2, 3], '[ 1.00000, 2.00000, 3.00000 ]']],
  [574, ['1.74', 'STR-TEXT-FORM']],
]);

function catalogue(): SettingCatalogue {
  return {
    version: 1,
    count: SETTINGS.length,
    settings: SETTINGS,
    aliases: {},
    counts: {},
    levelCounts: {},
    meta: {
      cSettingInit: 798,
      indexDictSize: 780,
      nameListSize: 779,
      defaultsSource: 'packages/engine/layer1/SettingInfo.h',
      defaultsNote: '',
      minMaxEnforced: false,
      minMaxNote: 'PyMOL clamps int min/max on global writes',
      helpSource: 'packages/engine/data/setting_help.csv',
      helpRows: 875,
    },
  };
}

interface Recorded {
  fn: string;
  args: readonly unknown[];
  kwargs: Record<string, unknown> | undefined;
}

/** The engine, as far as `createSettingsSource` can tell. */
function backend() {
  const calls: Recorded[] = [];
  let installed = false;
  const call = vi.fn(
    async (fn: string, args: readonly unknown[] = [], kwargs?: Record<string, unknown>) => {
      calls.push({ fn, args, kwargs });
      if (fn === 'setting.tenmol_settings_status') {
        if (!installed) throw new Error('setting.tenmol_settings_status: no such symbol');
        return {
          installed: true,
          cursor: 0,
          calls: 0,
          recorded: 0,
          catalogueBuilt: true,
          module: 'm',
        };
      }
      if (fn === 'setting.tenmol_settings_catalogue') return catalogue();
      if (fn === 'setting.tenmol_settings_values') {
        const wanted = (args[0] as number[] | null) ?? [...VALUES.keys()];
        return {
          object: (args[1] as string) ?? '',
          state: (args[2] as number) ?? 0,
          values: wanted.map((i) => [i, VALUES.get(i)?.[0], VALUES.get(i)?.[1]]),
          failed: [],
        };
      }
      if (fn === 'setting.tenmol_settings_drain') {
        return { cursor: 0, indices: [], batches: 0, full: false, lost: false, observing: true };
      }
      return null;
    },
  );
  const run = vi.fn(async (line: string) => {
    if (line === SETTINGS_BOOTSTRAP) installed = true;
    return null;
  });
  return { call, run, calls };
}

let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createSettingsStore>;
let engine: ReturnType<typeof backend>;
let source: ReturnType<typeof createSettingsSource>;

beforeEach(async () => {
  engine = backend();
  store = createSettingsStore();
  source = createSettingsSource({ call: engine.call as never, do: engine.run, store });
  await source.bootstrap();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(): void {
  act(() => {
    root.render(
      <AdvancedSettingsTable store={store} source={source} objects={['obj']} call={engine.call} />,
    );
  });
}

const rowFor = (name: string) => container.querySelector<HTMLElement>(`[data-name="${name}"]`);
const editorFor = (name: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
const filterBox = () => container.querySelector<HTMLInputElement>('.setadv__filter input')!;
const sets = () => engine.calls.filter((c) => c.fn === 'cmd.set');

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, 'value')?.set;
  setter?.call(el, value);
  act(() => el.dispatchEvent(new Event('input', { bubbles: true })));
}

/** React delegates `onBlur` from the bubbling `focusout`. */
function commit(name: string, value: string): void {
  const box = editorFor(name)!;
  type(box, value);
  act(() => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/* ====================================================================== 458 */

describe('row 458 — a row per setting, and a filter over them', () => {
  it('renders every setting the catalogue carries', () => {
    mount();
    for (const meta of SETTINGS) expect(rowFor(meta.name)).not.toBeNull();
    expect(container.querySelector('.setadv__count')!.textContent).toBe('7 / 7');
  });

  it('the filter narrows the table and the count reports it', () => {
    mount();
    type(filterBox(), 'ray_');
    expect(rowFor('ray_trace_mode')).not.toBeNull();
    expect(rowFor('sphere_scale')).toBeNull();
    expect(container.querySelector('.setadv__count')!.textContent).toBe('1 / 7');
  });

  it('keeps the Name column read-only: it is text, never an input', () => {
    mount();
    const nameCell = rowFor('sphere_scale')!.querySelector('.setadv__c-name')!;
    expect(nameCell.textContent).toContain('sphere_scale');
    expect(nameCell.querySelector('input')).toBeNull();
  });
});

describe('row 458 — the type code decides how the cell renders', () => {
  it('a BOOLEAN is a checkbox, checked from the live value', () => {
    mount();
    const on = editorFor('orthoscopic')!;
    expect(on.getAttribute('type')).toBe('checkbox');
    expect(on.checked).toBe(true);
    const off = editorFor('two_sided_lighting')!;
    expect(off.getAttribute('type')).toBe('checkbox');
    expect(off.checked).toBe(false);
  });

  it('int, float, float3, color and string are all TEXT boxes', () => {
    mount();
    for (const name of [
      'ray_trace_mode',
      'sphere_scale',
      'bg_rgb',
      'label_placement_offset',
      'pse_export_version',
    ]) {
      expect(editorFor(name)!.getAttribute('type')).toBe('text');
    }
  });

  it('int and string show str(value); float, color and float3 show the cmd.get TEXT', () => {
    mount();
    // `advanced_settings_gui.py:63-64`: `str(value)` for int/str, `cmd.get`
    // for the rest. The distinction is visible only because the fixture makes
    // the two forms differ.
    expect(editorFor('ray_trace_mode')!.value).toBe('3');
    expect(editorFor('pse_export_version')!.value).toBe('1.74');
    // i.e. NOT the `cmd.get` text, which the fixture made distinguishable.
    expect(editorFor('ray_trace_mode')!.value).not.toBe('INT-TEXT-FORM');

    expect(editorFor('sphere_scale')!.value).toBe('0.50000');
    // a colour is a NAME in the text form and an index in the raw one
    expect(editorFor('bg_rgb')!.value).toBe('white');
    expect(editorFor('label_placement_offset')!.value).toBe('[ 1.00000, 2.00000, 3.00000 ]');
  });
});

describe('row 458 — editing writes through cmd.set(index, value, log=1, quiet=0)', () => {
  it("a text edit sends the typed value with the dialog's own kwargs", async () => {
    mount();
    commit('sphere_scale', '2.5');
    await settle();

    expect(sets()).toHaveLength(1);
    expect(sets()[0]!.args[0]).toBe(155);
    expect(sets()[0]!.args[1]).toBe(2.5);
    // `log=1` is what makes the browser console mirror the desktop's — PyMOL
    // prints ` Setting: ... set to ...` and logs the equivalent command line.
    // Dropping it is invisible until someone reads a .pml log that is missing
    // every setting change they made.
    expect(sets()[0]!.kwargs).toEqual({ log: 1, quiet: 0 });
  });

  it('a checkbox sends 1 and 0, not true and false', async () => {
    mount();
    // ticking an unticked box -> 1
    act(() => editorFor('two_sided_lighting')!.click());
    await settle();
    // unticking a ticked one -> 0
    act(() => editorFor('orthoscopic')!.click());
    await settle();

    expect(sets().map((c) => [c.args[0], c.args[1]])).toEqual([
      [90, 1],
      [23, 0],
    ]);
    // The value goes through `coerceSettingValue`, which mirrors
    // `setting._validate_value`; a JS boolean is not what the C side reads.
    for (const c of sets()) expect(c.kwargs).toEqual({ log: 1, quiet: 0 });
  });

  it('an unchanged cell writes NOTHING when it loses focus', async () => {
    mount();
    const box = editorFor('sphere_scale')!;
    act(() => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await settle();
    expect(sets()).toEqual([]);
  });
});
