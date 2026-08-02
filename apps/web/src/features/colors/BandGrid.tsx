/**
 * The advanced band browser — every one of the 5388 built-in slots, reachable.
 *
 * `<SwatchGrid>` is `pymol.menu.all_colors_list`: 80 tiles the PyMOL authors
 * chose. That is the right default. But four fifths of the table are the
 * GENERATED bands (`s000-999`, `r`, `c`, `w`, `o`, `grey00-99`, `gray00-99`)
 * and they are not decoration — `spectrum`, `ramp_new`, `util.color_by_area`
 * and every `constants_palette` palette are expressed in those names, so
 * "which colour is `o107`?" is a real question with no answer anywhere else in
 * the client. Sampling them for a preview strip does not answer it.
 *
 * COST. Nothing here fetches: `usePalette` already holds all 5388 RGB values
 * (one bootstrap, measured at 184 ms). This only decides which 200 of them are
 * on screen. 200 is a deliberate ceiling — a 1000-tile page is a scroll trap,
 * and React re-renders it on every page click.
 *
 * A tile is `cmd.color_deep(name, sele, 0)`, the same verb the swatch grid uses
 * and for the same reason (a per-rep colour setting would otherwise win and the
 * click would look dead) — `viewing.py:1948-1976`.
 */

import { useState } from 'react';
import { rgbToCss } from '@tenmol/protocol';
import { COLOR_REGIONS, regionEntries, regionPages, type PaletteState } from './palette';
import { useColorAction } from './usePalette';

export interface BandGridProps {
  palette: PaletteState;
  sele: string;
}

/** Tiles per page. */
export const PER_PAGE = 200;

export function BandGrid({ palette, sele }: BandGridProps) {
  const act = useColorAction();
  const [regionId, setRegionId] = useState(COLOR_REGIONS[0]!.id);
  const [page, setPage] = useState(0);
  const [jump, setJump] = useState('');

  const region = COLOR_REGIONS.find((r) => r.id === regionId) ?? COLOR_REGIONS[0]!;
  const pages = regionPages(region, PER_PAGE);
  const clamped = Math.min(page, pages - 1);
  const entries = regionEntries(palette, region, clamped, PER_PAGE);
  const last = region.first + region.count - 1;

  /** Jump to whatever slot the user typed, switching region and page for them. */
  const goToIndex = (raw: string) => {
    const index = Number(raw.trim());
    if (!Number.isInteger(index)) return;
    const target = COLOR_REGIONS.find((r) => index >= r.first && index < r.first + r.count);
    if (!target) return;
    setRegionId(target.id);
    setPage(Math.floor((index - target.first) / PER_PAGE));
  };

  return (
    <div className="cbands">
      <div className="cbands__regions" role="tablist">
        {COLOR_REGIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={r.id === region.id}
            className={'cbands__region' + (r.id === region.id ? ' is-on' : '')}
            title={`${r.note} — slots ${r.first}..${r.first + r.count - 1}`}
            onClick={() => {
              setRegionId(r.id);
              setPage(0);
            }}
          >
            {r.label}
            <em>{r.count}</em>
          </button>
        ))}
      </div>

      <div className="cbands__bar">
        <span className="cbands__range">
          slots {region.first}..{last}
        </span>
        {pages > 1 && (
          <span className="cbands__pages">
            <button type="button" disabled={clamped === 0} onClick={() => setPage(clamped - 1)}>
              ‹
            </button>
            <span data-testid="cbands-page">
              page {clamped + 1} / {pages}
            </span>
            <button
              type="button"
              disabled={clamped >= pages - 1}
              onClick={() => setPage(clamped + 1)}
            >
              ›
            </button>
          </span>
        )}
        <label className="cbands__jump">
          slot
          <input
            value={jump}
            size={5}
            spellCheck={false}
            aria-label="jump to slot"
            onChange={(e) => {
              setJump(e.target.value);
              goToIndex(e.target.value);
            }}
          />
        </label>
        {palette.status !== 'ready' && <span className="cbands__note">palette not loaded</span>}
      </div>

      <div className="cbands__tiles">
        {entries.map((entry, i) => {
          const index = region.first + clamped * PER_PAGE + i;
          if (!entry) {
            return <span key={index} className="cbands__tile is-missing" title={`slot ${index}`} />;
          }
          return (
            <button
              key={index}
              type="button"
              className="cbands__tile"
              style={{ background: rgbToCss(entry.rgb) }}
              title={`${entry.name} — index ${entry.index}, rgb ${entry.rgb
                .map((v) => v.toFixed(3))
                .join(', ')}`}
              onClick={() =>
                void act(`cmd.color_deep("${entry.name}", ${JSON.stringify(sele)}, 0)`, (call) =>
                  call('color_deep', [entry.name, sele], { quiet: 0 }),
                )
              }
            >
              <span className="cbands__tile-label">{entry.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
