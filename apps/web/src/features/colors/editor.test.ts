/**
 * The colour EDITOR's own logic — the parts of `edit_colors_dialog`
 * (`modules/pmg_qt/pymol_qt_gui.py:547-611`) that are not React.
 *
 * Every index and tuple asserted below was MEASURED against the live engine in
 * this checkout (PyMOL 3.2.0a) over the bridge WebSocket while writing
 * `bridge/tests/test_wf_colors.py`; that file re-measures them on every run, so
 * if PyMOL's answers ever move, the pair of tests disagrees rather than this one
 * quietly encoding a stale fact.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ColorEntry } from '@tenmol/protocol';
import {
  applyLine,
  compareColorNames,
  editorNames,
  EMPTY_PALETTE,
  quantiseChannels,
  resolveColorName,
  type CallFn,
  type PaletteState,
} from './palette';

/** A table with the real slots the assertions below name, and nothing else. */
function palette(patch: Partial<PaletteState> = {}): PaletteState {
  const entries: ColorEntry[] = [];
  for (let i = 0; i <= 5388; i++) entries.push({ index: i, name: `s${i}`, rgb: [0, 0, 0] });
  entries[0] = { index: 0, name: 'white', rgb: [1, 1, 1] };
  entries[1] = { index: 1, name: 'black', rgb: [0, 0, 0] };
  entries[3] = { index: 3, name: 'green', rgb: [0, 1, 0] };
  entries[4] = { index: 4, name: 'red', rgb: [1, 0, 0] };
  entries[104] = {
    index: 104,
    name: 'grey50',
    rgb: [0.5050504803657532, 0.5050504803657532, 0.5050504803657532],
  };
  entries[5388] = { index: 5388, name: 'tenmol_wf_dlg', rgb: [0.12, 0.34, 0.56] };
  const named = [entries[0], entries[1], entries[3], entries[4], entries[5388]] as ColorEntry[];
  return { ...EMPTY_PALETTE, status: 'ready', entries, named, ...patch };
}

/** A `call` that only knows the answers we measured; anything else throws. */
function scriptedCall(script: Record<string, unknown>): CallFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (name: string, args: readonly unknown[] = []) => {
    const key = `${name}(${JSON.stringify(args)})`;
    calls.push(key);
    if (!(key in script)) throw new Error(`unscripted call ${key}`);
    return script[key];
  }) as CallFn & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe('list_colors', () => {
  it('sorts the way QListWidget does, not the way localeCompare does', () => {
    // `QListWidgetItem::operator<` is `QString::operator<`: code units,
    // case-sensitive. The two agree on all 178 live names (measured) and stop
    // agreeing as soon as `set_color` is given a capital letter.
    const mixed = ['apple', 'MyColour', 'Zinc', '_deepsalmon', 'tv_red', 'tvorange'];
    expect([...mixed].sort(compareColorNames)).toEqual([
      'MyColour',
      'Zinc',
      '_deepsalmon',
      'apple',
      'tv_red',
      'tvorange',
    ]);
    expect([...mixed].sort((a, b) => a.localeCompare(b))).not.toEqual(
      [...mixed].sort(compareColorNames),
    );
  });

  it('is the digit-free names plus every slot this session defined', () => {
    // `set_color tenmol_wf_dlg` (no digit) rejoins `get_color_indices()` on a
    // refetch — 178 -> 179, measured. `tenmol_wf_dlg2` (digit) never does, and
    // the Qt dialog shows it only because `run()` appends it by hand.
    const state = palette();
    const withDigitName = palette({
      entries: [...state.entries, { index: 5389, name: 'tenmol_wf_dlg2', rgb: [0.5, 0.5, 0.5] }],
    });
    expect(editorNames(state)).toEqual(['black', 'green', 'red', 'tenmol_wf_dlg', 'white']);
    expect(editorNames(withDigitName)).toContain('tenmol_wf_dlg2');
    // ...and the one that IS in `named` is not listed twice.
    expect(editorNames(withDigitName).filter((n) => n === 'tenmol_wf_dlg')).toHaveLength(1);
  });
});

describe('input_R/G/B', () => {
  it('quantises to the QDoubleSpinBox 2-decimal grid', () => {
    // colors.ui sets `maximum 1.0` and `singleStep 0.01` but no `decimals`, so
    // the boxes keep Qt's default of 2 and `setValue` rounds to it.
    expect(quantiseChannels([0.5050504803657532, 0.336, 0.5333333611488342])).toEqual([
      0.51, 0.34, 0.53,
    ]);
    expect(quantiseChannels([-4, 0.5, 12])).toEqual([0, 0.5, 1]);
  });

  it('round-trips the slider rule round(v * 100) / 100', () => {
    for (let k = 0; k <= 100; k++) {
      const v = k / 100;
      expect(Math.round(quantiseChannels([v, v, v])[0] * 100)).toBe(k);
    }
  });
});

describe('button_apply', () => {
  it('builds the %.2f + embedded-newline line verbatim', () => {
    expect(applyLine('tenmol_wf_dlg', [0.12, 0.34, 0.56])).toBe(
      'set_color tenmol_wf_dlg, [0.12, 0.34, 0.56]\nrecolor',
    );
    // `%.2f` pads, so 1 and 0 are '1.00' and '0.00' — that is what PyMOL echoed
    // when the red restore ran: `PyMOL>set_color red, [1.00, 0.00, 0.00]`.
    expect(applyLine('red', [1, 0, 0])).toBe('set_color red, [1.00, 0.00, 0.00]\nrecolor');
  });
});

describe('load_color', () => {
  it('answers an exact table name with no round trip at all', async () => {
    const call = scriptedCall({});
    await expect(resolveColorName(palette(), 'red', call)).resolves.toEqual({
      index: 4,
      rgb: [1, 0, 0],
      local: true,
    });
    expect(call.calls).toEqual([]);
  });

  it('asks the backend for a PREFIX, because ColorGetIndex does prefix matching', async () => {
    // measured: get_color_index('re') == 4 (red), get_color_index('gr') == 3
    // (green — first match wins, so not 'grey').
    const call = scriptedCall({ 'get_color_index(["re"])': 4 });
    await expect(resolveColorName(palette(), 're', call)).resolves.toEqual({
      index: 4,
      rgb: [1, 0, 0],
      local: true,
    });
    // The index came back inside the cached table, so no second call.
    expect(call.calls).toEqual(['get_color_index(["re"])']);
  });

  it('loads BLACK for an empty name, which is what the engine answers', async () => {
    // get_color_index('') == 1 — measured. Clearing the box blanks the swatch
    // to black in the desktop dialog too; it is not a miss.
    const call = scriptedCall({ 'get_color_index([""])': 1 });
    await expect(resolveColorName(palette(), '', call)).resolves.toEqual({
      index: 1,
      rgb: [0, 0, 0],
      local: true,
    });
  });

  it('fetches the tuple for an inline 0xRRGGBB index', async () => {
    // measured: get_color_index('0xff8800') == 1090488320 (0x40FF8800), and
    // get_color_tuple of that index answers (1, 0.5333…, 0).
    const call = scriptedCall({
      'get_color_index(["0xff8800"])': 1090488320,
      'get_color_tuple([1090488320])': [1.0, 0.5333333611488342, 0.0],
    });
    await expect(resolveColorName(palette(), '0xff8800', call)).resolves.toEqual({
      index: 1090488320,
      rgb: [1.0, 0.5333333611488342, 0.0],
      local: false,
    });
  });

  it('ignores an unknown name (-1), like load_color’s early return', async () => {
    const call = scriptedCall({ 'get_color_index(["zzz"])': -1 });
    await expect(resolveColorName(palette(), 'zzz', call)).resolves.toBeNull();
    expect(call.calls).toHaveLength(1); // no get_color_tuple(-1)
  });

  it('ignores atomic/object/front/back, the four the Qt dialog crashes on', async () => {
    // `pymol_qt_gui.py:558` guards `index == -1` only. These resolve to
    // -4/-5/-6/-7 and `cmd.get_color_tuple` returns **None** for every one of
    // them (measured, with `cmd-Error: Unknown color '-6'.` on the console), so
    // the desktop handler raises TypeError on `rgb[0]`.
    for (const [word, index] of [
      ['atomic', -4],
      ['object', -5],
      ['front', -6],
      ['back', -7],
    ] as const) {
      const call = scriptedCall({ [`get_color_index(["${word}"])`]: index });
      await expect(resolveColorName(palette(), word, call)).resolves.toBeNull();
      expect(call.calls).toHaveLength(1);
    }
  });

  it('survives a call that rejects instead of propagating it into the UI', async () => {
    const call = vi.fn(async () => {
      throw new Error('socket closed');
    }) as unknown as CallFn;
    await expect(resolveColorName(palette(), 'nope', call)).resolves.toBeNull();
  });
});
