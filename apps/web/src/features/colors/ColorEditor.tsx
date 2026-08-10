/**
 * The colour editor — `PyMOLQtGUI.edit_colors_dialog`
 * (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:547-611`) over `pmg_qt/forms/colors.ui`.
 *
 * Widget-for-widget: a sorted list of the **178 digit-free** names (the Qt
 * dialog populates from `cmd.get_color_indices()`, not `all=1`) plus whatever
 * this session has defined, a live swatch (`frame_color`), a name field, three
 * 0..1 numeric inputs stepping 0.01 (`input_R/G/B`), three 0..100 sliders
 * (`slider_R/G/B`), and Apply.
 *
 * Behaviours copied deliberately, because they are what make it feel like the
 * PyMOL dialog rather than a colour picker:
 *
 *  * selecting in the list writes the NAME field, and it is the name field's
 *    change that loads the RGB (`currentTextChanged -> setText`, then
 *    `textChanged -> load_color`) — so typing a known name loads it too, and so
 *    does typing a PREFIX of one, or `0xff8800`, or `104` (see
 *    `resolveColorName`);
 *  * `load_color` returns early when the index is negative, leaving the sliders
 *    where they were instead of resetting to black;
 *  * the three channels live on the spinboxes' 2-decimal grid, so the swatch
 *    shows the value Apply will write and not something 1/255 away from it;
 *  * Apply goes through `cmd.do('set_color name, [r, g, b]\nrecolor')` with
 *    **2 decimal places**, so the console shows exactly what the desktop shows,
 *    and a brand-new name is appended to the list and selected;
 *  * `recolor` is part of the same submission, because `set_color` alone does
 *    not repaint existing objects (`viewing.py:1868`).
 *
 * Additions the Qt dialog does not have, all of which the inventory row asks
 * for: a search box over the list, a hex field accepting `0xRRGGBB` / `#RRGGBB`
 * (the `0x` form is what `ColorGetIndex` itself parses,
 * `packages/engine/layer1/Color.cpp:704-712`), the seven special-colour chips, and the HSV
 * picker below.
 *
 * THE HSV PICKER (row 72's last open item, "HSV/RGB picker replacing 3 sliders
 * + 3 spinboxes"). It REPLACES the three RGB rows rather than sitting beside
 * them — one trio at a time, switched by the R G B / H S V toggle — because the
 * six-widget RGB form is the one piece of `colors.ui` parity worth keeping as
 * the default, and eleven sliders in a column is not a picker, it is a mixing
 * desk. Two details that are not decoration:
 *
 *  * the conversion is `Lib/colorsys.py` (`./hsv.ts`), the module PyMOL itself
 *    imports for `spectrum … interpolation=hsv`, so the H slider walks the same
 *    path between two colours that PyMOL walks;
 *  * H is HELD while the picker is open. `rgbToHsv` reports hue 0 for anything
 *    grey (`minc === maxc`), so dragging V to 0 and back would silently pull a
 *    blue swatch to red if the hue were re-derived from RGB each render. The
 *    draft is dropped the moment the colour arrives from anywhere else — the
 *    name field, the list, the hex box — which is where a stale hue would lie.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { SPECIAL_COLORS, cssToRgb, rgbToCss } from '@tenmol/protocol';
import {
  applyLine,
  editorNames,
  findByName,
  quantiseChannels,
  resolveColorName,
  type PaletteState,
  type Rgb,
} from './palette';
import {
  HSV_RANGES,
  displayToHsv,
  hsvToDisplay,
  hsvToRgb,
  hueStripCss,
  rgbToHsv,
  type Hsv,
} from './hsv';
import { callOf, useColorAction } from './usePalette';
import { useSession } from '../../app';
import { Button, Slider, TextInput } from '../../ui';

const CHANNELS = ['R', 'G', 'B'] as const;
const HSV_CHANNELS = [
  { key: 'H', max: HSV_RANGES.h, unit: '°' },
  { key: 'S', max: HSV_RANGES.s, unit: '%' },
  { key: 'V', max: HSV_RANGES.v, unit: '%' },
] as const;

/** The colour-editor panel: name/list, live swatch, RGB or HSV inputs, and Apply. */
export function ColorEditor({ palette }: { palette: PaletteState }) {
  const session = useSession();
  const act = useColorAction();
  const [name, setName] = useState('red');
  const [rgb, setRgbState] = useState<Rgb>([1, 0, 0]);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  /** What the hex box is showing while it is being typed into; see below. */
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  /** Which trio the form is showing. RGB is `colors.ui`'s, and the default. */
  const [space, setSpace] = useState<'rgb' | 'hsv'>('rgb');
  /** The hue the user is holding; null means "derive it from RGB". */
  const [hsvDraft, setHsvDraft] = useState<Hsv | null>(null);

  // `load_color` is synchronous in Qt and asynchronous here, so every write to
  // the channels carries a token and a late reply that no longer owns the token
  // is dropped. That covers both races the desktop dialog cannot have: two
  // keystrokes whose replies land out of order, and a slider dragged while a
  // name lookup is still in flight (which would otherwise snap back).
  const token = useRef(0);

  // Everything that writes the channels goes through the spinbox grid, so the
  // swatch, the numbers, the sliders and the `set_color` line never disagree.
  const setRgb = (next: Rgb) => {
    token.current++;
    setHsvDraft(null);
    setRgbState(quantiseChannels(next));
  };

  /** What the H/S/V rows show: the held draft, or the colour's own HSV. */
  const hsv: Hsv = hsvDraft ?? rgbToHsv(rgb);
  const hsvShown = hsvToDisplay(hsv);

  const setHsvChannel = (i: number, value: number) => {
    const next: [number, number, number] = [hsvShown[0], hsvShown[1], hsvShown[2]];
    next[i] = value;
    const asHsv = displayToHsv(next);
    token.current++;
    // The draft is set AFTER `setRgbState` in source order but both land in the
    // same render; what matters is that this path does not go through `setRgb`,
    // which is the one that forgets the hue.
    setRgbState(quantiseChannels(hsvToRgb(asHsv)));
    setHsvDraft(asHsv);
  };

  // The table the lookup consults, held in a ref rather than read as a
  // dependency. `load_color` is connected to `textChanged` and to NOTHING else
  // (`pymol_qt_gui.py:609`); `usePalette` hands out a NEW state object on every
  // refetch, and the Colours window's "refetch" button is in the title bar,
  // visible while this tab is open — as a dependency it re-ran the lookup and
  // reset half-made channels to the named colour (measured: R dragged to 0.42,
  // one refetch, R back at 1.00).
  const paletteRef = useRef(palette);
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  // `input_name.textChanged -> load_color` (pymol_qt_gui.py:609), which is
  // `get_color_index` + `get_color_tuple` — see `resolveColorName` for why that
  // cannot be a local table lookup. A miss leaves the sliders where they are,
  // like the early return at `pymol_qt_gui.py:557-558`.
  useEffect(() => {
    const mine = ++token.current;
    void resolveColorName(paletteRef.current, name, callOf(session)).then((found) => {
      if (found && token.current === mine) {
        // A colour that arrived from the NAME field brings its own hue; the
        // held draft is about the one the user was dragging and is now stale.
        setHsvDraft(null);
        setRgbState(quantiseChannels(found.rgb));
      }
    });
  }, [name, session]);

  const names = useMemo(() => {
    const list = editorNames(palette);
    const needle = filter.trim().toLowerCase();
    return needle ? list.filter((n) => n.toLowerCase().includes(needle)) : list;
  }, [palette, filter]);

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
    // No client echo: this goes out as `cmd.do`, and PyMOL echoes BOTH lines
    // itself — measured, `PyMOL>set_color …`, ` Color: "…" defined as [ … ].`,
    // `PyMOL>recolor`. Adding our own would print the command twice.
    const error = await act(null, (call) => call('do', [applyLine(clean, rgb)]), 'palette');
    setStatus(error ?? `set_color ${clean} applied and recoloured`);
  };

  const existing = findByName(palette, name.trim());

  return (
    <div className="cedit">
      <div className="cedit__list">
        <TextInput
          className="cedit__filter"
          placeholder={`filter ${palette.named.length} named colours`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ul
          role="listbox"
          aria-label="named colours"
          className="modern:bg-pm-panel-alt modern:border-line"
        >
          {names.map((n) => {
            const entry = findByName(palette, n);
            return (
              <li key={n}>
                <Button
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
                </Button>
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
          <TextInput
            aria-label="input_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="cedit__space" role="radiogroup" aria-label="colour space">
          {(['rgb', 'hsv'] as const).map((option) => (
            <Button
              key={option}
              role="radio"
              aria-checked={space === option}
              aria-label={`space_${option}`}
              className={'cedit__space-btn' + (space === option ? ' is-on' : '')}
              onClick={() => setSpace(option)}
              title={
                option === 'rgb'
                  ? 'the three QDoubleSpinBox/QSlider pairs of forms/colors.ui'
                  : 'hue, saturation, value — colorsys, the space PyMOL interpolates in'
              }
            >
              {option === 'rgb' ? 'R G B' : 'H S V'}
            </Button>
          ))}
        </div>

        {space === 'rgb'
          ? CHANNELS.map((channel, i) => (
              <div className="cedit__channel" key={channel}>
                <span className="cedit__channel-name">{channel}</span>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  aria-label={`slider_${channel}`}
                  value={Math.round((rgb[i] ?? 0) * 100)}
                  onChange={(e) => setChannel(i, Number(e.target.value) / 100)}
                />
                <TextInput
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  aria-label={`input_${channel}`}
                  value={Number((rgb[i] ?? 0).toFixed(2))}
                  onChange={(e) => setChannel(i, Number(e.target.value))}
                />
              </div>
            ))
          : HSV_CHANNELS.map((channel, i) => (
              <div className="cedit__channel" key={channel.key}>
                <span className="cedit__channel-name">{channel.key}</span>
                <Slider
                  min={0}
                  max={channel.max}
                  step={1}
                  aria-label={`slider_${channel.key}`}
                  className={channel.key === 'H' ? 'cedit__hue' : undefined}
                  style={channel.key === 'H' ? { background: hueStripCss() } : undefined}
                  value={hsvShown[i]}
                  onChange={(e) => setHsvChannel(i, Number(e.target.value))}
                />
                <TextInput
                  type="number"
                  min={0}
                  max={channel.max}
                  step={1}
                  aria-label={`input_${channel.key}`}
                  value={hsvShown[i]}
                  onChange={(e) => setHsvChannel(i, Number(e.target.value))}
                />
                <span className="cedit__unit">{channel.unit}</span>
              </div>
            ))}

        {/*
          The draft is not decoration. A controlled input whose value is
          `rgbToCss(rgb)` cannot be TYPED into: the first keystroke gives a
          string `cssToRgb` refuses, the state does not move, and React puts the
          old text straight back. Only a paste ever worked. So the field holds
          its own text while it is being edited and snaps to the canonical
          (2-decimal, see `quantiseChannels`) form on blur.
        */}
        <label className="cedit__field">
          <span>hex</span>
          <TextInput
            aria-label="input_hex"
            value={hexDraft ?? rgbToCss(rgb)}
            spellCheck={false}
            onChange={(e) => {
              setHexDraft(e.target.value);
              const parsed = cssToRgb(e.target.value);
              if (parsed) setRgb(parsed);
            }}
            onBlur={() => setHexDraft(null)}
            title="0xRRGGBB is what ColorGetIndex itself parses (packages/engine/layer1/Color.cpp:704-712); the value lands on the spinboxes' 2-decimal grid, so #ff8800 settles as #ff8700"
          />
        </label>

        <div className="cedit__actions">
          <Button className="cedit__apply" onClick={() => void apply()}>
            Apply
          </Button>
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
