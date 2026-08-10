/**
 * The "C" menu — `pymol.menu.mol_color` as React.
 *
 * Structure and every command string come from `packages/engine/modules/pymol/menu.py:672-686`
 * and the providers it calls. The top row is the five submenus PyMOL puts
 * before the palette (by element / by chain / by ss / by rep / spectrum, then
 * auto), and below them the 9-group swatch grid of `all_colors_list`
 * (`menu.py:519-618`) followed by the live ramps section
 * (`all_colors_generic`, `menu.py:625-636`).
 *
 * TWO THINGS THIS GETS RIGHT THAT A GENERIC COLOUR PICKER CANNOT:
 *
 *  1. A swatch is `cmd.color_deep(name, sele, 0)`, not `cmd.color`.
 *     `color_deep` (`viewing.py:1948-1976`) first `unset_deep`s every per-rep
 *     colour setting in `menu.rep_setting_lists` and only then colours the
 *     atoms — otherwise a `cartoon_color` set earlier silently wins and the
 *     click appears to do nothing.
 *  2. The "by rep" entries are SETTINGS WRITES (`cmd.set('cartoon_color', ...)`,
 *     `menu.py:436-444`), not atom colours, and each submenu ends with an
 *     `unset`. Routing them through `cmd.color` would be a different feature
 *     wearing the same label.
 *
 * The tile colours are PyMOL's own `\RGB` swatch digits, not the true RGB of
 * each colour, because that is what the in-viewport menu draws — `gray90` is
 * drawn `999`, the same as `white`. The true RGB is in the tooltip and in the
 * ring around the tile once the palette has loaded.
 */

import { useState } from 'react';
import { menuSwatchToRgb, rgbToCss } from '@tenmol/protocol';
import {
  ALL_COLORS_LIST,
  BY_ELEM_PAGES,
  BY_SS_PRESETS,
  COLOR_CYCLE,
  FIXED_CARBON_SHORTCUTS,
  NEGATIVE_REPS,
  REP_SETTING_LISTS,
  REP_SETTING_MODE_NAMES,
  negativeSettings,
  type NegativeRep,
} from './menuData';
import { findByName, type PaletteState } from './palette';
import { useColorAction } from './usePalette';

/** Props for `SwatchGrid`: the loaded palette and the selection to colour. */
export interface SwatchGridProps {
  palette: PaletteState;
  /** The selection every command is applied to. */
  sele: string;
}

type Submenu = 'elem' | 'chain' | 'ss' | 'rep' | 'spectrum' | 'auto' | 'negative' | null;

/** The "C" colour menu: the by-* submenus above PyMOL's 9-group swatch grid and ramps. */
export function SwatchGrid({ palette, sele }: SwatchGridProps) {
  const act = useColorAction();
  const [open, setOpen] = useState<Submenu>(null);
  const [repMode, setRepMode] = useState(0);
  const [repSetting, setRepSetting] = useState<string | null>(null);
  const [negativeRep, setNegativeRep] = useState<NegativeRep>('mesh');
  const [negativeArmed, setNegativeArmed] = useState(false);

  const q = JSON.stringify(sele);

  const colorDeep = (name: string) =>
    act(`cmd.color_deep("${name}", ${q}, 0)`, (call) =>
      call('color_deep', [name, sele], { quiet: 0 }),
    );

  const setRepColor = (setting: string, name: string) =>
    act(`cmd.set("${setting}", "${name}", ${q}, quiet=0)`, (call) =>
      call('set', [setting, name, sele], { quiet: 0 }),
    );

  const unsetRep = (setting: string) =>
    act(`cmd.unset("${setting}", ${q}, quiet=0)`, (call) =>
      call('unset', [setting, sele], { quiet: 0 }),
    );

  /**
   * `mesh_color`'s colour entries — menu.py:697-698. ONE menu item, TWO writes,
   * in this order: make the negative lobe visible, then colour it. Dropping the
   * `_negative_visible` write is the classic way to make this look broken: the
   * colour lands in the setting and nothing appears, because the default is 0.
   */
  const setNegativeColor = (name: string) => {
    const s = negativeSettings(negativeRep);
    return act(
      `cmd.set("${s.visible}",1,${q},quiet=0); cmd.set("${s.color}","${name}",${q},quiet=0)`,
      async (call) => {
        await call('set', [s.visible, 1, sele], { quiet: 0 });
        await call('set', [s.color, name, sele], { quiet: 0 });
      },
    );
  };

  const onSwatch = (name: string) => {
    if (negativeArmed) void setNegativeColor(name);
    else if (repSetting) void setRepColor(repSetting, name);
    else void colorDeep(name);
  };

  return (
    <div className="cmenu">
      <div className="cmenu__tabs" role="tablist">
        {(
          [
            ['elem', 'by element'],
            ['chain', 'by chain'],
            ['ss', 'by ss'],
            ['rep', 'by rep'],
            ['spectrum', 'spectrum'],
            ['auto', 'auto'],
            ['negative', 'negative'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={open === id}
            className={
              'cmenu__tab modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text modern:transition-colors modern:hover:bg-btn-hover modern:hover:text-pm-text-bright' +
              (open === id
                ? ' is-open modern:bg-pm-accent modern:text-accent-text modern:border-transparent'
                : '')
            }
            onClick={() => setOpen(open === id ? null : id)}
          >
            {label}
          </button>
        ))}
      </div>

      {open === 'elem' && <ByElement sele={sele} palette={palette} />}
      {open === 'chain' && <ByChain sele={sele} palette={palette} />}
      {open === 'ss' && <BySs sele={sele} />}
      {open === 'rep' && (
        <ByRep
          mode={repMode}
          setMode={setRepMode}
          active={repSetting}
          setActive={setRepSetting}
          onUnset={unsetRep}
        />
      )}
      {open === 'spectrum' && <SpectrumShortcuts sele={sele} />}
      {open === 'auto' && <AutoColor sele={sele} />}
      {open === 'negative' && (
        <Negative
          sele={sele}
          rep={negativeRep}
          setRep={setNegativeRep}
          armed={negativeArmed}
          setArmed={setNegativeArmed}
        />
      )}

      {negativeArmed && (
        <div className="cmenu__armed modern:bg-accent-soft modern:border-line modern:text-pm-text">
          next swatch writes <code>{negativeSettings(negativeRep).color}</code>
          <button
            type="button"
            className="modern:border-line modern:text-pm-text-dim modern:hover:text-pm-text-bright"
            onClick={() => setNegativeArmed(false)}
          >
            cancel
          </button>
        </div>
      )}

      {repSetting && !negativeArmed && (
        <div className="cmenu__armed modern:bg-accent-soft modern:border-line modern:text-pm-text">
          next swatch writes <code>{repSetting}</code>
          <button
            type="button"
            className="modern:border-line modern:text-pm-text-dim modern:hover:text-pm-text-bright"
            onClick={() => setRepSetting(null)}
          >
            cancel
          </button>
        </div>
      )}

      <div className="cmenu__groups">
        {ALL_COLORS_LIST.map(([group, swatches]) => (
          <div className="cmenu__group" key={group}>
            <div className="cmenu__group-name">{group}</div>
            <div className="cmenu__tiles">
              {swatches.map(([digits, name], i) => {
                const entry = findByName(palette, name);
                return (
                  <button
                    key={`${name}-${i}`}
                    type="button"
                    className="cmenu__tile"
                    style={{
                      background: rgbToCss(menuSwatchToRgb(digits)),
                      outlineColor: entry ? rgbToCss(entry.rgb) : 'transparent',
                    }}
                    title={
                      entry
                        ? `${name} — index ${entry.index}, rgb ${entry.rgb.map((v) => v.toFixed(3)).join(', ')}`
                        : `${name} (palette not loaded)`
                    }
                    onClick={() => onSwatch(name)}
                  >
                    <span className="cmenu__tile-label">{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {palette.ramps.length > 0 && (
        <div className="cmenu__group">
          <div className="cmenu__group-name">ramps</div>
          <div className="cmenu__tiles">
            {palette.ramps.map((ramp) => (
              <button
                key={ramp.name}
                type="button"
                className="cmenu__tile cmenu__tile--ramp"
                title={`${ramp.name} — colour index ${ramp.index} (ext ${-10 - ramp.index})`}
                onClick={() => onSwatch(ramp.name)}
              >
                <span className="cmenu__tile-label">{ramp.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * by element — menu.py:335-418
 * ------------------------------------------------------------------ */

function ByElement({ sele, palette }: { sele: string; palette: PaletteState }) {
  const act = useColorAction();
  const [page, setPage] = useState(0);
  const current = BY_ELEM_PAGES[page] ?? BY_ELEM_PAGES[0];
  if (!current) return null;

  return (
    <div className="cmenu__sub modern:bg-pm-panel-alt">
      <div className="cmenu__sub-head">
        Atoms
        <span className="cmenu__pages">
          {BY_ELEM_PAGES.map((p, i) => (
            <button
              key={p.title}
              type="button"
              className={'cmenu__page' + (i === page ? ' is-on' : '')}
              onClick={() => setPage(i)}
            >
              {p.title}
            </button>
          ))}
        </span>
      </div>

      <button
        type="button"
        className="cmenu__row"
        title="colour every non-carbon atom `atomic`, leave carbons alone — util.py:512"
        onClick={() =>
          void act(`util.cnc(${JSON.stringify(sele)})`, (call) => call('util.cnc', [sele]))
        }
      >
        <span className="cmenu__chip" style={{ background: '#777' }} /> non-carbon only (cnc)
      </button>

      <div className="cmenu__tiles">
        {current.choices.map((choice) => {
          const entry =
            choice.index !== undefined
              ? (palette.entries[choice.index] ?? null)
              : findByName(palette, choice.name ?? '');
          return (
            <button
              key={choice.label}
              type="button"
              className="cmenu__tile"
              style={{ background: rgbToCss(menuSwatchToRgb(choice.swatch)) }}
              title={
                current.kind === 'cba'
                  ? `util.cba(${choice.index}, …) — carbons ${choice.label}, everything else atomic`
                  : `util.cbh("${choice.name}", …) — hydrogens ${choice.label}`
              }
              onClick={() => {
                if (current.kind === 'cba' && choice.index !== undefined) {
                  void act(`util.cba(${choice.index}, ${JSON.stringify(sele)})`, (call) =>
                    call('util.cba', [choice.index, sele]),
                  );
                } else if (choice.name) {
                  void act(`util.cbh("${choice.name}", ${JSON.stringify(sele)})`, (call) =>
                    call('util.cbh', [choice.name, sele]),
                  );
                }
              }}
            >
              <span className="cmenu__tile-label">{entry ? entry.name : choice.label}</span>
            </button>
          );
        })}
      </div>

      <div className="cmenu__sub-head">Fixed-carbon shortcuts</div>
      <p className="cmenu__note modern:text-pm-text-dim">
        <code>util.cbaX</code> — util.py:442-510. Same as the tiles above except they do{' '}
        <em>not</em> set the object colour (no <code>flags=1</code> pass), so they are their own
        entries rather than aliases.
      </p>
      <div className="cmenu__tiles">
        {FIXED_CARBON_SHORTCUTS.map((shortcut) => {
          const entry = findByName(palette, shortcut.color);
          return (
            <button
              key={shortcut.fn}
              type="button"
              className="cmenu__tile cmenu__tile--shortcut"
              style={{ background: entry ? rgbToCss(entry.rgb) : '#444' }}
              title={`util.${shortcut.fn}(…) — carbons ${shortcut.color}, everything else atomic, object colour untouched`}
              onClick={() =>
                void act(`util.${shortcut.fn}(${JSON.stringify(sele)})`, (call) =>
                  call(`util.${shortcut.fn}`, [sele]),
                )
              }
            >
              <span className="cmenu__tile-label">{shortcut.fn}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * negative colour — menu.py:696-712, `mesh_color`
 * ------------------------------------------------------------------ */

function Negative({
  sele,
  rep,
  setRep,
  armed,
  setArmed,
}: {
  sele: string;
  rep: NegativeRep;
  setRep: (r: NegativeRep) => void;
  armed: boolean;
  setArmed: (b: boolean) => void;
}) {
  const act = useColorAction();
  const s = negativeSettings(rep);
  const q = JSON.stringify(sele);
  return (
    <div className="cmenu__sub modern:bg-pm-panel-alt">
      <div className="cmenu__sub-head">
        Negative Color:
        <span className="cmenu__pages">
          {NEGATIVE_REPS.map((name) => (
            <button
              key={name}
              type="button"
              className={'cmenu__page' + (name === rep ? ' is-on' : '')}
              onClick={() => setRep(name)}
            >
              {name}
            </button>
          ))}
        </span>
      </div>
      <p className="cmenu__note modern:text-pm-text-dim">
        Only <code>object:mesh</code> and <code>object:surface</code> have this menu —{' '}
        <code>ExecutiveMenu</code> sends them to <code>mesh_color</code> instead of{' '}
        <code>mol_color</code> (Executive.cpp:15249-15256). Both entries are settings writes on{' '}
        <code>{sele}</code>.
      </p>
      <button
        type="button"
        className="cmenu__row"
        onClick={() =>
          void act(`cmd.set("${s.visible}",0,${q},quiet=0)`, (call) =>
            call('set', [s.visible, 0, sele], { quiet: 0 }),
          )
        }
      >
        off<code>{s.visible} = 0</code>
      </button>
      <button
        type="button"
        className={'cmenu__row' + (armed ? ' is-on' : '')}
        onClick={() => setArmed(!armed)}
      >
        pick a colour below<code>{s.color}</code>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * by chain — menu.py:464-481
 * ------------------------------------------------------------------ */

function ByChain({ sele, palette }: { sele: string; palette: PaletteState }) {
  const act = useColorAction();
  const rows: [string, string, readonly unknown[]][] = [
    ['by chain (elem C)', 'util.color_chains', [`(${sele} and elem C)`]],
    ['by chain (*/CA)', 'util.color_chains', [`(${sele} and name CA)`]],
    ['by chain', 'util.color_chains', [`(${sele})`]],
    ['chainbows', 'util.chainbow', [`(${sele})`]],
  ];
  return (
    <div className="cmenu__sub modern:bg-pm-panel-alt">
      <div className="cmenu__sub-head">By Chain:</div>
      {rows.map(([label, fn, args]) => (
        <button
          key={label}
          type="button"
          className="cmenu__row"
          onClick={() =>
            void act(`${fn}(${args.map((a) => JSON.stringify(a)).join(', ')})`, (call) =>
              call(fn, args),
            )
          }
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        className="cmenu__row"
        onClick={() =>
          void act(`cmd.spectrum("segi", "rainbow", "(${sele}) & elem C")`, (call) =>
            call('spectrum', ['segi', 'rainbow', `(${sele}) & elem C`]),
          )
        }
      >
        by segi (elem C)
      </button>
      <button
        type="button"
        className="cmenu__row"
        onClick={() =>
          void act(`cmd.spectrum("segi", "rainbow", ${JSON.stringify(sele)})`, (call) =>
            call('spectrum', ['segi', 'rainbow', sele]),
          )
        }
      >
        by segi
      </button>

      <div
        className="cmenu__cycle"
        title="util._color_cycle — util.py:27-70, identical to C AutoColor"
      >
        {COLOR_CYCLE.map((index, i) => {
          const entry = palette.entries[index];
          return (
            <span
              key={`${index}-${i}`}
              className="cmenu__cycle-cell"
              style={{ background: entry ? rgbToCss(entry.rgb) : '#333' }}
              title={entry ? `${i}: ${entry.name} (${index})` : `${i}: index ${index}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * by ss — menu.py:420-426
 * ------------------------------------------------------------------ */

function BySs({ sele }: { sele: string }) {
  const act = useColorAction();
  return (
    <div className="cmenu__sub modern:bg-pm-panel-alt">
      <div className="cmenu__sub-head">By Secondary Structure:</div>
      {BY_SS_PRESETS.map((preset) => (
        <button
          key={`${preset.helix}-${preset.sheet}-${preset.loop}`}
          type="button"
          className="cmenu__row"
          onClick={() =>
            void act(
              `util.cbss(${JSON.stringify(sele)}, "${preset.helix}", "${preset.sheet}", "${preset.loop}")`,
              (call) => call('util.cbss', [sele, preset.helix, preset.sheet, preset.loop]),
            )
          }
        >
          <span className="cmenu__chip" style={{ background: preset.helix }} /> Helix
          <span className="cmenu__chip" style={{ background: preset.sheet }} /> Sheet
          <span className="cmenu__chip" style={{ background: preset.loop }} /> Loop
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * by rep — menu.py:428-444. SETTINGS, not atom colours.
 * ------------------------------------------------------------------ */

function ByRep({
  mode,
  setMode,
  active,
  setActive,
  onUnset,
}: {
  mode: number;
  setMode: (n: number) => void;
  active: string | null;
  setActive: (s: string | null) => void;
  onUnset: (setting: string) => void;
}) {
  const list = REP_SETTING_LISTS[mode] ?? [];
  return (
    <div className="cmenu__sub modern:bg-pm-panel-alt">
      <div className="cmenu__sub-head">
        By Representation:
        <span className="cmenu__pages">
          {REP_SETTING_MODE_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              className={'cmenu__page' + (i === mode ? ' is-on' : '')}
              onClick={() => setMode(i)}
            >
              {name}
            </button>
          ))}
        </span>
      </div>
      <p className="cmenu__note modern:text-pm-text-dim">
        These write per-rep colour <em>settings</em> (<code>cmd.set</code>), not atom colours. Pick
        one, then click a swatch below.
      </p>
      {list.map(([rep, setting], i) =>
        setting ? (
          <div className="cmenu__reprow" key={`${setting}-${i}`}>
            <button
              type="button"
              className={'cmenu__row' + (active === setting ? ' is-on' : '')}
              onClick={() => setActive(active === setting ? null : setting)}
            >
              {rep || setting.replace(/_color$/, '').replace(/_/g, ' ')}
              <code>{setting}</code>
            </button>
            <button type="button" className="cmenu__unset" onClick={() => onUnset(setting)}>
              unset
            </button>
          </div>
        ) : (
          <div className="cmenu__sep" key={`sep-${i}`} />
        ),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * spectrum shortcuts — menu.py:446-462
 * ------------------------------------------------------------------ */

function SpectrumShortcuts({ sele }: { sele: string }) {
  const act = useColorAction();
  const items: [string, string, readonly unknown[], Record<string, unknown>][] = [
    ['rainbow (elem C)', 'spectrum', ['count'], { selection: `(${sele})&elem C` }],
    ['rainbow (*/CA)', 'spectrum', ['count'], { selection: `(${sele})&*/CA` }],
    ['rainbow (byres)', 'spectrum', ['count'], { selection: sele, byres: 1 }],
    ['b-factors', 'spectrum', ['b'], { selection: sele, quiet: 0 }],
    ['b-factors (*/CA)', 'spectrum', ['b'], { selection: `((${sele})&*/CA)`, quiet: 0 }],
    ['area (molecular)', 'util.color_by_area', [sele, 'molecular'], {}],
    ['area (solvent)', 'util.color_by_area', [sele, 'solvent'], {}],
  ];
  return (
    <div className="cmenu__sub modern:bg-pm-panel-alt">
      <div className="cmenu__sub-head">Spectrum:</div>
      {items.map(([label, fn, args, kwargs]) => (
        <button
          key={label}
          type="button"
          className="cmenu__row"
          onClick={() =>
            void act(`cmd.${fn}(${args.map((a) => JSON.stringify(a)).join(', ')})`, (call) =>
              call(fn, args, kwargs),
            )
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * auto — menu.py:659-670
 * ------------------------------------------------------------------ */

function AutoColor({ sele }: { sele: string }) {
  const act = useColorAction();
  const items: [string, string, readonly unknown[]][] = [
    ['auto (elem C)', 'color', ['auto', `(${sele}) and elem C`]],
    ['auto', 'color', ['auto', sele]],
    ['one colour per object (elem C)', 'util.color_objs', [`(${sele} and elem C)`]],
    ['one colour per object', 'util.color_objs', [`(${sele})`]],
  ];
  return (
    <div className="cmenu__sub modern:bg-pm-panel-alt">
      <div className="cmenu__sub-head">Auto</div>
      {items.map(([label, fn, args]) => (
        <button
          key={label}
          type="button"
          className="cmenu__row"
          onClick={() =>
            void act(
              `${fn.includes('.') ? fn : 'cmd.' + fn}(${args.map((a) => JSON.stringify(a)).join(', ')})`,
              (call) => call(fn, args),
            )
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
