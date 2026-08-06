/**
 * Palettes and spectrum — `cmd.spectrum` (`viewing.py:2065-2151`) and the
 * `spectrumany` path behind it (`viewing.py:1978-2063`).
 *
 * The palette list is `constants_palette.palette_dict` (60 entries in this
 * tree, not the 57 the inventory quotes — checked in
 * `packages/bridge/tests/test_colors.py`). Each entry is `(prefix, digits, first, last)`
 * naming a slice of one of the generated 1000-colour bands, so the preview
 * strip is real: it samples `entries[bandFirst + n]` between `first` and
 * `last`, which is the same arithmetic `_cmd.spectrum` does in C.
 *
 * THE FALLBACK IS THE FEATURE. `cmd.spectrum` delegates the entire call to
 * `spectrumany` when the expression is not purely alphabetic OR the palette is
 * not a name `palette_sc` resolves (`viewing.py:2130-2135`). MEASURED against
 * this tree: `cmd.spectrumany` **does not exist** — `spectrumany` is a
 * module-level function in `viewing.py` that is never bound onto `cmd`, and
 * `cmd.spectrumany(...)` raises `AttributeError`. So "arbitrary colour list"
 * mode is not a different call, it is `cmd.spectrum` with the colour list
 * passed as the palette, and that is what the second tab below sends.
 * `byres` is deliberately disabled there because the fallback at
 * `viewing.py:2134` does not forward it.
 */

import { useMemo, useState } from 'react';
import { rgbToCss } from '@tenmol/protocol';
import {
  PALETTES,
  PALETTE_COLORS_DICT,
  SPECTRUM_INTERPOLATIONS,
  type SpectrumInterpolation,
} from './menuData';
import { sampleBand, type PaletteState } from './palette';
import { useColorAction } from './usePalette';

const PREVIEW_STOPS = 24;

/** Panel for applying a colour spectrum or palette across a selection by expression. */
export function SpectrumPanel({ palette, sele }: { palette: PaletteState; sele: string }) {
  const act = useColorAction();
  const [mode, setMode] = useState<'palette' | 'colors'>('palette');
  const [expression, setExpression] = useState('count');
  const [paletteName, setPaletteName] = useState('rainbow');
  const [colors, setColors] = useState('blue white red');
  const [interpolation, setInterpolation] = useState<SpectrumInterpolation>('rgb');
  const [byres, setByres] = useState(false);
  const [auto, setAuto] = useState(true);
  const [minimum, setMinimum] = useState('0');
  const [maximum, setMaximum] = useState('100');
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? PALETTES.filter((p) => p.name.includes(needle)) : PALETTES;
  }, [filter]);

  const run = async () => {
    const kwargs: Record<string, unknown> = { quiet: 0 };
    if (!auto) {
      kwargs['minimum'] = Number(minimum);
      kwargs['maximum'] = Number(maximum);
    }
    if (mode === 'palette') {
      if (byres) kwargs['byres'] = 1;
    } else {
      kwargs['interpolation'] = interpolation;
    }
    const palArg = mode === 'palette' ? paletteName : colors;
    const echo =
      `cmd.spectrum(${JSON.stringify(expression)}, ${JSON.stringify(palArg)}, ` +
      `${JSON.stringify(sele)}${auto ? '' : `, ${minimum}, ${maximum}`})`;
    let value: unknown = null;
    const error = await act(echo, async (call) => {
      value = await call('spectrum', [expression, palArg, sele], kwargs);
      return value;
    });
    if (error) {
      setResult(null);
      return;
    }
    setResult(
      Array.isArray(value) && value.length === 2
        ? `range ${String(value[0])} .. ${String(value[1])}`
        : 'done',
    );
  };

  return (
    <div className="cspec">
      <div className="cspec__modes">
        <button
          type="button"
          className={'cspec__mode' + (mode === 'palette' ? ' is-on' : '')}
          onClick={() => setMode('palette')}
        >
          palette ({PALETTES.length})
        </button>
        <button
          type="button"
          className={'cspec__mode' + (mode === 'colors' ? ' is-on' : '')}
          onClick={() => setMode('colors')}
          title="cmd.spectrum with an unresolvable palette delegates to spectrumany"
        >
          colour list (spectrumany)
        </button>
      </div>

      <div className="cspec__row">
        <label>
          expression
          <input
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            spellCheck={false}
            list="tenmol-spectrum-expressions"
          />
        </label>
        <datalist id="tenmol-spectrum-expressions">
          {['count', 'b', 'q', 'pc', 'fc', 'resi', 'segi', 'index'].map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>
        <label className="cspec__check">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          auto range
          <span title="minimum=0, maximum=-1 is the auto-range signal — viewing.py:2143-2145">
            ?
          </span>
        </label>
        {!auto && (
          <>
            <label>
              min
              <input value={minimum} onChange={(e) => setMinimum(e.target.value)} />
            </label>
            <label>
              max
              <input value={maximum} onChange={(e) => setMaximum(e.target.value)} />
            </label>
          </>
        )}
        {mode === 'palette' ? (
          <label className="cspec__check">
            <input type="checkbox" checked={byres} onChange={(e) => setByres(e.target.checked)} />
            byres
          </label>
        ) : (
          <label>
            interpolation
            <select
              value={interpolation}
              onChange={(e) => setInterpolation(e.target.value as SpectrumInterpolation)}
            >
              {SPECTRUM_INTERPOLATIONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="cspec__go" onClick={() => void run()}>
          spectrum
        </button>
        {result && <span className="cspec__result">{result}</span>}
      </div>

      {mode === 'colors' ? (
        <div className="cspec__colors">
          <label>
            colours
            <input
              value={colors}
              onChange={(e) => setColors(e.target.value)}
              spellCheck={false}
              size={48}
            />
          </label>
          <div className="cspec__presets">
            {Object.entries(PALETTE_COLORS_DICT).map(([name, list]) => (
              <button key={name} type="button" onClick={() => setColors(list)} title={list}>
                {name}
              </button>
            ))}
          </div>
          <p className="cspec__note">
            Colours are written as packed <code>0x40RRGGBB</code> values with <code>cmd.alter</code>
            , then <code>recolor</code> (<code>viewing.py:2053</code>) — so after this the atoms
            carry inline colours, not table indices.
          </p>
        </div>
      ) : (
        <>
          <input
            className="cspec__filter"
            placeholder="filter palettes"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="cspec__list">
            {shown.map((p) => {
              const stops = sampleBand(palette, p.prefix, p.first, p.last, PREVIEW_STOPS);
              return (
                <button
                  key={p.name}
                  type="button"
                  className={'cspec__palette' + (p.name === paletteName ? ' is-on' : '')}
                  onClick={() => setPaletteName(p.name)}
                  title={`${p.name} — band '${p.prefix}', ${p.first}..${p.last}`}
                >
                  <span className="cspec__bar">
                    {stops.map((entry, i) => (
                      <span
                        key={i}
                        style={{ background: entry ? rgbToCss(entry.rgb) : 'transparent' }}
                      />
                    ))}
                  </span>
                  <span className="cspec__palette-name">{p.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
