/**
 * Slot `colors` (region `overlay`) — the whole colour system in one window.
 *
 * The five surfaces PyMOL spreads across three toolkits, gathered:
 *
 *   Palette   the "C" menu (`pymol.menu.mol_color`, `menu.py:672-686`) —
 *             swatch grid + by element / chain / ss / rep / spectrum / auto
 *   Editor    `edit_colors_dialog` (`pmg_qt/pymol_qt_gui.py:547-611`)
 *   Spectrum  `cmd.spectrum` + the 60 palettes of `constants_palette.py`
 *   Ramps     `ramp_new` / `ramp_update` + `volume_color`
 *   Space     `cmd.space` (`importing.py:227-288`)
 *
 * There is no menu bar yet (`features/menubar` is WP-14 and unbuilt), so this
 * feature carries its own launcher. It is a floating button, not a dock, and it
 * says which slot it is — an overlay that appears from nowhere is worse than no
 * overlay.
 */

import { useState } from 'react';
import { rgbToCss } from '@tenmol/protocol';
import { useSession, useStore } from '../../app';
import { Button, FloatingWindow, Select, TextInput } from '../../ui';
import { COLOR_SPACES, UTIL_COLOR_SCHEMES } from './menuData';
import { paletteIntegrity } from './palette';
import { BandGrid } from './BandGrid';
import { ColorEditor } from './ColorEditor';
import { RampPanel } from './RampPanel';
import { SpectrumPanel } from './SpectrumPanel';
import { SwatchGrid } from './SwatchGrid';
import { callOf, refreshPalette, useColorAction, usePalette } from './usePalette';
import './colors.css';

const TABS = ['palette', 'bands', 'editor', 'spectrum', 'ramps', 'space'] as const;
type Tab = (typeof TABS)[number];

/** The colours overlay: a floating launcher opening the palette/editor/spectrum/ramps/space tabs. */
export function ColorsPanel() {
  const session = useSession();
  const palette = usePalette();
  const phase = useStore(session.stores.connection, (s) => s.phase);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('palette');
  const [sele, setSele] = useState('(all)');
  const integrity = paletteIntegrity(palette);

  if (!open) {
    return (
      <Button
        className="colors-launch"
        title="Colours — slot `colors`, WP-22"
        onClick={() => setOpen(true)}
      >
        <span className="colors-launch__c">C</span>
        {palette.status === 'ready' && (
          <span className="colors-launch__strip">
            {['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'magenta'].map((name) => {
              const entry = palette.entries.find((e) => e.name === name);
              return (
                <i key={name} style={{ background: entry ? rgbToCss(entry.rgb) : 'transparent' }} />
              );
            })}
          </span>
        )}
      </Button>
    );
  }

  return (
    <FloatingWindow
      title="Colours"
      ariaLabel="Colours"
      onClose={() => setOpen(false)}
      persistKey="colors"
      defaultWidth={460}
      defaultHeight={560}
      minWidth={360}
      minHeight={320}
      anchor="right"
      data-testid="colors-window"
      titleExtra={
        <>
          <span
            className="colors__status modern:text-pm-text-dim"
            title="cmd.get_color_indices(all=1) + get_color_tuple"
          >
            {palette.status === 'ready'
              ? `${palette.entries.length} slots / ${palette.named.length} named` +
                (integrity.custom > 0 ? ` (+${integrity.custom} set_color)` : '') +
                (palette.loadedMs !== null ? ` in ${Math.round(palette.loadedMs)} ms` : '')
              : palette.status === 'loading'
                ? 'loading the colour table…'
                : palette.status === 'error'
                  ? `error: ${palette.error ?? ''}`
                  : phase === 'open'
                    ? 'idle'
                    : 'not connected'}
          </span>
          <Button
            className="colors__reload"
            onClick={() => void refreshPalette(callOf(session), true)}
          >
            refetch
          </Button>
        </>
      }
    >
      <div className="colors modern:text-pm-text">
        {!integrity.ok && palette.status === 'ready' && (
          <div className="colors__warn modern:bg-accent-soft modern:text-pm-text">
            colour table does not match this PyMOL build: {integrity.problems.join('; ')}
          </div>
        )}

        <div className="colors__sele modern:border-b modern:border-line">
          <label>
            selection
            <TextInput value={sele} onChange={(e) => setSele(e.target.value)} spellCheck={false} />
          </label>
          <span className="colors__sele-note modern:text-pm-text-dim">
            every command below is applied to this selection
          </span>
        </div>

        <div className="colors__tabs" role="tablist">
          {TABS.map((id) => (
            <Button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={'colors__tab' + (tab === id ? ' is-on' : '')}
              onClick={() => setTab(id)}
            >
              {id}
            </Button>
          ))}
        </div>

        <div className="colors__body">
          {tab === 'palette' && <SwatchGrid palette={palette} sele={sele} />}
          {tab === 'bands' && <BandGrid palette={palette} sele={sele} />}
          {tab === 'editor' && <ColorEditor palette={palette} />}
          {tab === 'spectrum' && <SpectrumPanel palette={palette} sele={sele} />}
          {tab === 'ramps' && <RampPanel palette={palette} />}
          {tab === 'space' && <SpacePanel />}
        </div>
      </div>
    </FloatingWindow>
  );
}

/**
 * `cmd.space(space, gamma)` — `importing.py:227-288`.
 *
 * The whole point of this tab is the refetch. `ColorRec::LutColor`
 * (`packages/engine/layer1/Color.h:58-59`) means `get_color_tuple` returns the LUT-MAPPED
 * value, so every cached RGB in the client is stale the moment this runs.
 * Verified against a live PyMOL: `red` reads `(1, 0, 0)`, then after
 * `space greyscale` it reads `(0.343, 0.331, 0.331)`.
 */
function SpacePanel() {
  const act = useColorAction();
  const [gamma, setGamma] = useState('1.0');
  const [scheme, setScheme] = useState(UTIL_COLOR_SCHEMES[0] ?? 'jmol');

  return (
    <div className="cspace">
      <div className="cspace__head">colour space</div>
      <label>
        gamma
        <TextInput value={gamma} onChange={(e) => setGamma(e.target.value)} size={6} />
      </label>
      <div className="cspace__buttons">
        {COLOR_SPACES.map((space) => (
          <Button
            key={space.name}
            title={space.help}
            onClick={() =>
              void act(
                `cmd.space("${space.name}", ${gamma})`,
                (call) => call('space', [space.name, Number(gamma)]),
                'palette',
              )
            }
          >
            {space.name}
          </Button>
        ))}
      </div>
      <p className="cspace__note modern:text-pm-text-dim">
        Changing the space rewrites every colour&rsquo;s RGB through the LUT, so the whole palette
        is refetched afterwards — the client cannot keep a cached table across this.
      </p>

      <div className="cspace__head">element colour schemes</div>
      <div className="cspace__buttons">
        <Select value={scheme} onChange={(e) => setScheme(e.target.value)}>
          {UTIL_COLOR_SCHEMES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Button
          title="util.colors('jmol') redefines 6 element colours then recolors — util.py:1029-1040"
          onClick={() =>
            void act(`util.colors("${scheme}")`, (call) => call('util.colors', [scheme]), 'palette')
          }
        >
          apply
        </Button>
      </div>
    </div>
  );
}
