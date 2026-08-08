/**
 * Colour ramps — `cmd.ramp_new` / `ramp_update` (`packages/engine/modules/pymol/creating.py:374-518`)
 * — and volume ramps, which are a different mechanism with a similar name
 * (`packages/engine/modules/pymol/colorramping.py`).
 *
 * A ramp is a real object (`object:ramp`) registered as a colour EXTENSION
 * (`ColorRegisterExt`, `packages/engine/layer1/Color.cpp:347-365`); its colour index is
 * `-10 - slot`. Verified against a live PyMOL: after
 * `ramp_new r1, m1, [-1,0,1], [red,white,blue]`, `get_color_index('r1')`
 * answers **-10**. That index can then be used anywhere a colour can — which is
 * why the swatch grid lists live ramps alongside the named colours, exactly as
 * `all_colors_generic` does (`menu.py:625-636`).
 *
 * Ramp colour is evaluated PER VERTEX from `(position, state)`
 * (`ColorGetRamped`, `Color.cpp:189-218`), so this editor never pretends a ramp
 * has one RGB: the stop list is shown as the gradient it defines, and the
 * geometry feed has to bake the real thing server-side.
 *
 * Volume ramps are separate: `cmd.volume_color(volumeName, presetName)` with
 * the five presets in `colorramping.namedramps` (`colorramping.py:17-54`).
 */

import { useState } from 'react';
import { rgbToCss } from '@tenmol/protocol';
import { RAMP_SPECTRA, VOLUME_RAMPS } from './menuData';
import { findByName, type PaletteState } from './palette';
import { useColorAction } from './usePalette';

interface Stop {
  value: string;
  color: string;
}

const DEFAULT_STOPS: Stop[] = [
  { value: '-1', color: 'red' },
  { value: '0', color: 'white' },
  { value: '1', color: 'blue' },
];

export function RampPanel({ palette }: { palette: PaletteState }) {
  const act = useColorAction();
  const [name, setName] = useState('ramp1');
  const [map, setMap] = useState('');
  const [stops, setStops] = useState<Stop[]>(DEFAULT_STOPS);
  const [spectrum, setSpectrum] = useState('');
  const [volume, setVolume] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const range = stops.map((s) => Number(s.value));
  const colors = stops.map((s) => s.color);

  const create = async () => {
    // `color` is either a list of names/tuples or ONE of the named spectra in
    // `ramp_spectrum_dict` (creating.py:47-57) — never both.
    const colorArg: unknown = spectrum ? spectrum : colors;
    const echo = `cmd.ramp_new("${name}", "${map}", [${range.join(', ')}], ${
      spectrum ? `"${spectrum}"` : JSON.stringify(colors)
    })`;
    const error = await act(
      echo,
      (call) => call('ramp_new', [name, map, range, colorArg], { quiet: 0 }),
      'ramps',
    );
    setStatus(error ?? `ramp "${name}" created`);
  };

  const update = async () => {
    // `ramp_update` forwards to `ramp_new` with an EMPTY map (creating.py:518),
    // which is what keeps the existing map binding.
    const echo = `cmd.ramp_update("${name}", [${range.join(', ')}], ${JSON.stringify(colors)})`;
    const error = await act(
      echo,
      (call) => call('ramp_update', [name, range, colors], { quiet: 0 }),
      'ramps',
    );
    setStatus(error ?? `ramp "${name}" updated`);
  };

  const gradient = stops
    .map((stop, i) => {
      const entry = findByName(palette, stop.color);
      const css = entry ? rgbToCss(entry.rgb) : stop.color;
      const pct = stops.length === 1 ? 0 : (i / (stops.length - 1)) * 100;
      return `${css} ${pct}%`;
    })
    .join(', ');

  return (
    <div className="cramp">
      <div className="cramp__live modern:bg-pm-panel-alt modern:border-line">
        <div className="cramp__head">live ramps ({palette.ramps.length})</div>
        {palette.ramps.length === 0 && (
          <p className="cramp__empty modern:text-pm-text-dim">
            no <code>object:ramp</code> in the session — create one below (it needs a map object)
          </p>
        )}
        {palette.ramps.map((ramp) => (
          <div className="cramp__row" key={ramp.name}>
            <code>{ramp.name}</code>
            <span title="ColorRegisterExt: index = -10 - slot (packages/engine/layer1/Color.h:46)">
              colour index {ramp.index} (ext {-10 - ramp.index})
            </span>
            <button
              type="button"
              onClick={() => {
                setName(ramp.name);
                setStatus(null);
              }}
            >
              edit
            </button>
            <button
              type="button"
              onClick={() =>
                void act(
                  `cmd.delete("${ramp.name}")`,
                  (call) => call('delete', [ramp.name]),
                  'ramps',
                )
              }
            >
              delete
            </button>
          </div>
        ))}
      </div>

      <div className="cramp__editor modern:bg-pm-panel-alt modern:border-line">
        <div className="cramp__head">ramp_new</div>
        <div className="cramp__fields">
          <label>
            name
            <input
              className="modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text-bright"
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            map object
            <input
              className="modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text-bright"
              value={map}
              onChange={(e) => setMap(e.target.value)}
              spellCheck={false}
              placeholder="e.g. 2fofc map, or a selection ramp"
            />
          </label>
          <label>
            named spectrum
            <select
              className="modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text-bright"
              value={spectrum}
              onChange={(e) => setSpectrum(e.target.value)}
            >
              <option value="">(use the stops)</option>
              {RAMP_SPECTRA.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cramp__bar" style={{ background: `linear-gradient(90deg, ${gradient})` }} />

        <div className="cramp__stops">
          {stops.map((stop, i) => (
            <div className="cramp__stop" key={i}>
              <input
                className="modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text-bright"
                aria-label={`stop ${i} value`}
                value={stop.value}
                onChange={(e) =>
                  setStops(stops.map((s, k) => (k === i ? { ...s, value: e.target.value } : s)))
                }
              />
              <input
                className="modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text-bright"
                aria-label={`stop ${i} colour`}
                value={stop.color}
                spellCheck={false}
                onChange={(e) =>
                  setStops(stops.map((s, k) => (k === i ? { ...s, color: e.target.value } : s)))
                }
              />
              <button type="button" onClick={() => setStops(stops.filter((_s, k) => k !== i))}>
                −
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setStops([...stops, { value: '0', color: 'white' }])}
          >
            + stop
          </button>
        </div>

        <div className="cramp__actions">
          <button type="button" onClick={() => void create()}>
            ramp_new
          </button>
          <button type="button" onClick={() => void update()}>
            ramp_update
          </button>
          {status && <span className="cramp__status">{status}</span>}
        </div>
      </div>

      <div className="cramp__volume modern:bg-pm-panel-alt modern:border-line">
        <div className="cramp__head">volume ramps</div>
        <p className="cramp__note modern:text-pm-text-dim">
          A different mechanism from <code>object:ramp</code>:{' '}
          <code>cmd.volume_color(name, preset)</code> over <code>colorramping.namedramps</code> (
          <code>colorramping.py:17-54</code>).
        </p>
        <label>
          volume object
          <input
            className="modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text-bright"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="cramp__presets">
          {VOLUME_RAMPS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={!volume}
              onClick={() =>
                void act(`cmd.volume_color("${volume}", "${preset}")`, (call) =>
                  call('volume_color', [volume, preset]),
                )
              }
            >
              {preset}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
