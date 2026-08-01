/**
 * The colour editor — `PyMOLQtGUI.edit_colors_dialog`
 * (`modules/pmg_qt/pymol_qt_gui.py:547-611`) over `pmg_qt/forms/colors.ui`.
 *
 * Widget-for-widget: a sorted list of the **178 digit-free** names (the Qt
 * dialog populates from `cmd.get_color_indices()`, not `all=1`), a live swatch
 * (`frame_color`), a name field, three 0..1 numeric inputs stepping 0.01
 * (`input_R/G/B`), three 0..100 sliders (`slider_R/G/B`), and Apply.
 *
 * Behaviours copied deliberately, because they are what make it feel like the
 * PyMOL dialog rather than a colour picker:
 *
 *  * selecting in the list writes the NAME field, and it is the name field's
 *    change that loads the RGB (`currentTextChanged -> setText`, then
 *    `textChanged -> load_color`) — so typing a known name loads it too;
 *  * `load_color` returns early when `get_color_index` answers -1, leaving the
 *    sliders where they were instead of resetting to black;
 *  * Apply goes through `cmd.do('set_color name, [r, g, b]\nrecolor')` with
 *    **2 decimal places**, so the console shows exactly what the desktop shows,
 *    and a brand-new name is appended to the list and selected;
 *  * `recolor` is part of the same submission, because `set_color` alone does
 *    not repaint existing objects (`viewing.py:1868`).
 *
 * Additions the Qt dialog does not have, all of which the inventory row asks
 * for: a search box over the list, a hex field accepting `0xRRGGBB` / `#RRGGBB`
 * (the `0x` form is what `ColorGetIndex` itself parses,
 * `layer1/Color.cpp:704-712`), and the seven special-colour chips.
 */

import { useEffect, useMemo, useState } from 'react';
import { SPECIAL_COLORS, cssToRgb, rgbToCss } from '@tenmol/protocol';
import { findByName, type PaletteState, type Rgb } from './palette';
import { useColorAction } from './usePalette';

const CHANNELS = ['R', 'G', 'B'] as const;

export function ColorEditor({ palette }: { palette: PaletteState }) {
  const act = useColorAction();
  const [name, setName] = useState('red');
  const [rgb, setRgb] = useState<Rgb>([1, 0, 0]);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  // `input_name.textChanged -> load_color` (pymol_qt_gui.py:609). The lookup is
  // the local table, which is `get_color_index` + `get_color_tuple` already
  // fetched; a miss leaves the sliders alone, exactly like the early return at
  // `pymol_qt_gui.py:557-558`.
  useEffect(() => {
    const entry = findByName(palette, name);
    if (entry) setRgb(entry.rgb);
  }, [name, palette]);

  const names = useMemo(() => {
    const list = palette.named.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
    const needle = filter.trim().toLowerCase();
    return needle ? list.filter((n) => n.toLowerCase().includes(needle)) : list;
  }, [palette.named, filter]);

  const setChannel = (i: number, value: number) => {
    const next: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
    next[i] = Math.max(0, Math.min(1, value));
    setRgb(next);
  };

  const apply = async () => {
    const clean = name.trim();
    if (!clean) {
      setStatus('name is required');
      return;
    }
    // `%.2f` and the embedded newline, from pymol_qt_gui.py:589-590.
    const line = `set_color ${clean}, [${rgb.map((v) => v.toFixed(2)).join(', ')}]\nrecolor`;
    const error = await act(
      `PyMOL>${line.replace('\n', ' ; ')}`,
      (call) => call('do', [line]),
      'palette',
    );
    setStatus(error ?? `set_color ${clean} applied and recoloured`);
  };

  const existing = findByName(palette, name.trim());

  return (
    <div className="cedit">
      <div className="cedit__list">
        <input
          className="cedit__filter"
          placeholder={`filter ${palette.named.length} named colours`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ul role="listbox" aria-label="named colours">
          {names.map((n) => {
            const entry = findByName(palette, n);
            return (
              <li key={n}>
                <button
                  type="button"
                  role="option"
                  aria-selected={n === name}
                  className={'cedit__item' + (n === name ? ' is-on' : '')}
                  onClick={() => setName(n)}
                >
                  <span
                    className="cedit__dot"
                    style={{ background: entry ? rgbToCss(entry.rgb) : '#000' }}
                  />
                  {n}
                </button>
              </li>
            );
          })}
          {names.length === 0 && <li className="cedit__empty">no match</li>}
        </ul>
      </div>

      <div className="cedit__form">
        <div
          className="cedit__swatch"
          data-testid="frame_color"
          style={{ background: rgbToCss(rgb) }}
        />

        <label className="cedit__field">
          <span>name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        </label>

        {CHANNELS.map((channel, i) => (
          <div className="cedit__channel" key={channel}>
            <span className="cedit__channel-name">{channel}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              aria-label={`slider_${channel}`}
              value={Math.round((rgb[i] ?? 0) * 100)}
              onChange={(e) => setChannel(i, Number(e.target.value) / 100)}
            />
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              aria-label={`input_${channel}`}
              value={Number((rgb[i] ?? 0).toFixed(2))}
              onChange={(e) => setChannel(i, Number(e.target.value))}
            />
          </div>
        ))}

        <label className="cedit__field">
          <span>hex</span>
          <input
            value={rgbToCss(rgb)}
            spellCheck={false}
            onChange={(e) => {
              const parsed = cssToRgb(e.target.value);
              if (parsed) setRgb(parsed);
            }}
            title="0xRRGGBB is what ColorGetIndex itself parses (layer1/Color.cpp:704-712)"
          />
        </label>

        <div className="cedit__actions">
          <button type="button" className="cedit__apply" onClick={() => void apply()}>
            Apply
          </button>
          <span className="cedit__hint">
            {existing ? `overwrites index ${existing.index}` : 'creates a new colour'}
          </span>
        </div>

        {status && <div className="cedit__status">{status}</div>}

        <div className="cedit__specials">
          <div className="cedit__specials-head">special colours</div>
          {SPECIAL_COLORS.map((special) => {
            const live = palette.specials.find((s) => s.keyword === special.keyword);
            return (
              <span
                key={special.keyword}
                className="cedit__chip"
                title={`${special.help} — ${special.constant ? `constant ${special.index}` : 'resolved live'}${live ? `, currently ${live.index}` : ''}`}
                style={{ background: live?.rgb ? rgbToCss(live.rgb) : 'transparent' }}
              >
                {special.keyword}
                <em>{live ? live.index : special.index}</em>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
