/**
 * Row 221 — how a cell of the Advanced Settings table RENDERS.
 *
 * `advanced_settings_gui.py:55-71` has one rule per type:
 *
 *   bool          -> a checkbox, `Qt.Checked` when the value is truthy
 *   int / str     -> `str(value)`
 *   float / float3 / color -> `cmd.get(index)`, the TEXT form
 *
 * and the NAME column is read-only (`flags()` drops `ItemIsEditable` for
 * column 0, `:36-40`).
 *
 * MEASURED before this file existed: replacing the checkbox branch with a text
 * box, and making the int/string branch return an empty string, both left the
 * whole web suite green. `settings.test.ts` covers the filter and
 * `test_advanced_settings.py` covers the round trip, but nothing looked at what
 * the user actually sees in the cell — which is the entire content of this
 * half of the row.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingCatalogue, SettingMeta } from '@tenmol/protocol';
import { createSettingsStore, type SettingsSource } from '@tenmol/stores/settings';
import { AdvancedSettingsTable, displayValue } from './AdvancedSettingsTable';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;

/** One row per rendering rule, with the real indices this build reports. */
const SETTINGS: SettingMeta[] = [
  { name: 'orthoscopic', index: 23, kind: 'boolean', level: 'global' },
  { name: 'label_font_id', index: 328, kind: 'int', level: 'atom' },
  { name: 'sphere_scale', index: 155, kind: 'float', level: 'atom' },
  { name: 'label_position', index: 464, kind: 'float3', level: 'atom' },
  { name: 'bg_rgb', index: 6, kind: 'color', level: 'global' },
  { name: 'pdb_echo_tags', index: 519, kind: 'string', level: 'global' },
] as SettingMeta[];

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
      minMaxNote: '',
      helpSource: null,
      helpRows: 0,
    },
  };
}

const write = vi.fn(async () => undefined);
const source = {
  bootstrap: vi.fn(async () => undefined),
  write,
  reset: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  scope: vi.fn(async () => ({ object: '', state: 0, objectSettings: [], atoms: [] })),
  getBonds: vi.fn(async () => ({ bonds: [] })),
  setBond: vi.fn(async () => undefined),
  unsetBond: vi.fn(async () => undefined),
} as unknown as SettingsSource;

let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createSettingsStore>;

/** The `(value, text)` pairs a live `values` reply carries for these six. */
function seedValues(): void {
  store.applyValues({
    object: '',
    state: 0,
    cursor: 0,
    values: [
      [23, 1, 'on'],
      [328, 5, '5'],
      [155, 1.0, '1.00000'],
      [464, [0, 0, 0], '[ 0.00000, 0.00000, 0.00000 ]'],
      [6, 0, 'black'],
      [519, 'HEADER', 'HEADER'],
    ],
  } as never);
}

beforeEach(() => {
  write.mockClear();
  store = createSettingsStore();
  store.applyCatalogue(catalogue());
  store.setPhase('ready');
  seedValues();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<AdvancedSettingsTable store={store} source={source} objects={[]} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function cell(name: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
  if (!el) throw new Error(`no editor for ${name}`);
  return el;
}

const meta = (name: string): SettingMeta =>
  SETTINGS.find((s) => s.name === name) as SettingMeta;

describe('row 221 — displayValue is the Qt type switch', () => {
  it('shows int and string as str(value), NOT as the text form', () => {
    // The distinction matters: for an int the two agree today, so the test
    // uses a case where the text form differs to keep the branch honest.
    expect(displayValue(meta('label_font_id'), { value: 5, text: 'five' })).toBe('5');
    expect(displayValue(meta('pdb_echo_tags'), { value: 'HEADER', text: 'x' })).toBe('HEADER');
  });

  it('shows float, float3 and color as cmd.get() TEXT', () => {
    expect(displayValue(meta('sphere_scale'), { value: 1, text: '1.00000' })).toBe('1.00000');
    expect(
      displayValue(meta('label_position'), {
        value: [0, 0, 0],
        text: '[ 0.00000, 0.00000, 0.00000 ]',
      }),
    ).toBe('[ 0.00000, 0.00000, 0.00000 ]');
    // A colour index only becomes a NAME in the text form; showing `value`
    // would put `0` in the cell where the dialog shows `black`.
    expect(displayValue(meta('bg_rgb'), { value: 0, text: 'black' })).toBe('black');
  });

  it('shows nothing at all for a value that has not loaded', () => {
    expect(displayValue(meta('sphere_scale'), undefined)).toBe('');
  });
});

describe('row 221 — the cell a bool gets is a CHECKBOX', () => {
  it('renders type=checkbox for a boolean and type=text for everything else', () => {
    expect(cell('orthoscopic').type).toBe('checkbox');
    for (const name of ['label_font_id', 'sphere_scale', 'label_position', 'bg_rgb']) {
      expect(cell(name).type).toBe('text');
    }
  });

  it('ticks the checkbox from the live value and writes 1/0 on a click', () => {
    expect(cell('orthoscopic').checked).toBe(true);
    act(() => {
      cell('orthoscopic').click();
    });
    expect(write).toHaveBeenCalledTimes(1);
    const [wroteMeta, wroteValue] = write.mock.calls[0] as unknown as [SettingMeta, unknown];
    expect(wroteMeta.index).toBe(23);
    expect(wroteValue).toBe(0);
  });

  it('puts the rendered text in the text cells', () => {
    expect(cell('label_font_id').value).toBe('5');
    expect(cell('sphere_scale').value).toBe('1.00000');
    expect(cell('bg_rgb').value).toBe('black');
  });
});

describe('row 221 — the name column is read-only', () => {
  it('renders each name as text, never as an input', () => {
    const names = [...container.querySelectorAll('.setadv__c-name')].map((el) =>
      el.textContent?.trim(),
    );
    expect(names).toContain('orthoscopic');
    expect(names).toContain('sphere_scale');
    for (const el of container.querySelectorAll('.setadv__c-name')) {
      expect(el.querySelector('input')).toBeNull();
    }
  });
});
