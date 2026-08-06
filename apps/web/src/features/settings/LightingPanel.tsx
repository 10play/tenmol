/**
 * The Lighting Settings panel — `packages/engine/data/startup/lightingsettings_gui/main.py`.
 *
 * Every range, resolution and preset value below is copied from that file
 * (`:151-176` for the slider table, `:69-137` for the five presets). They are
 * UI-authored numbers, NOT `SettingInfo` min/max: `ambient` has no declared
 * range in the C table at all, and the plugin still pins its slider to 0..1.
 * That is why this panel does not use `SettingMeta.min/max` — the two are
 * different things and conflating them would silently change the widget.
 *
 * Three labels in the plugin carry a parenthetical that is not part of the
 * setting name (`direct (+reflect)`, `specular_intensity (=specular)`); the
 * plugin splits on whitespace before using it (`main.py:227`) and so does this.
 *
 * The slider is a hint; the number field is authoritative. Both write through
 * `cmd.set` and then re-read, so a value PyMOL rejects or clamps snaps back.
 */

import { useMemo } from 'react';
import type { SettingMeta } from '@tenmol/protocol';
import { valueKey, type SettingsSource, type SettingsStore } from '@tenmol/stores/settings';
import { useStore } from '../../app';

interface SliderSpec {
  /** Label as the plugin shows it (may carry a parenthetical). */
  label: string;
  setting: string;
  min: number;
  max: number;
  /** `res is None -> 0.01 if (max-min) < 100 else 0.1` (`main.py:219-221`). */
  step: number;
}

type Section = { heading: string; sliders: readonly SliderSpec[] };

const spec = (label: string, min: number, max: number, res?: number): SliderSpec => ({
  label,
  setting: label.split(/\s+/)[0] as string,
  min,
  max,
  step: res ?? (max - min < 100 ? 0.01 : 0.1),
});

/** The grouped lighting settings and their slider ranges, laid out by section. */
export const LIGHTING_SECTIONS: readonly Section[] = [
  {
    heading: 'Diffuse Reflection',
    sliders: [spec('ambient', 0, 1), spec('reflect', -1, 1)],
  },
  {
    heading: 'Direct Light from Front',
    sliders: [
      spec('direct (+reflect)', -1, 1),
      spec('spec_direct', 0, 1),
      spec('spec_direct_power', 0, 100, 1),
    ],
  },
  {
    heading: 'Free placeable directed Lights',
    sliders: [spec('light_count', 1, 8, 1), spec('edit_light', 1, 7, 1)],
  },
  {
    heading: 'Specular Reflection',
    sliders: [
      spec('spec_count', -1, 8, 1),
      spec('shininess', 0, 100),
      spec('spec_reflect', -0.01, 1),
      spec('specular', 0, 1),
      spec('specular_intensity (=specular)', 0, 1),
    ],
  },
  {
    heading: 'Ambient Occlusion (Surface only)',
    sliders: [
      spec('ambient_occlusion_mode', 0, 2, 1),
      spec('ambient_occlusion_scale', 1.0, 50, 1),
      spec('ambient_occlusion_smooth', 1, 20, 1),
    ],
  },
  { heading: 'Ray trace only', sliders: [spec('power', 1, 10), spec('reflect_power', 1, 10)] },
];

/** The five presets, verbatim (`main.py:69-137`). */
export const LIGHTING_PRESETS: readonly { name: string; sets: readonly [string, number][] }[] = [
  {
    name: 'Default',
    sets: [
      ['ambient', 0.14],
      ['direct', 0.45],
      ['spec_direct', 0],
      ['spec_direct_power', 55],
      ['light_count', 2],
      ['shininess', 55],
      ['reflect', 0.45],
      ['spec_count', -1],
      ['spec_power', -1],
      ['spec_reflect', -1],
      ['specular', 1],
      ['specular_intensity', 0.5],
      ['ambient_occlusion_mode', 0],
      ['ambient_occlusion_scale', 25],
      ['ambient_occlusion_smooth', 10],
      ['power', 1],
      ['reflect_power', 1],
    ],
  },
  {
    name: 'Metal',
    sets: [
      ['ambient', 0.2],
      ['direct', 0],
      ['spec_direct', 0],
      ['shininess', 51],
      ['reflect', 0.5],
      ['spec_count', -1],
      ['spec_reflect', -1],
      ['specular', 1],
      ['specular_intensity', 0.5],
    ],
  },
  {
    name: 'Plastic',
    sets: [
      ['ambient', 0],
      ['direct', 0.2],
      ['spec_direct', 0],
      ['shininess', 32],
      ['reflect', 0.55],
      ['spec_count', -1],
      ['spec_reflect', -1],
      ['specular', 1],
      ['specular_intensity', 0.5],
    ],
  },
  {
    name: 'Rubber',
    sets: [
      ['ambient', 0.05],
      ['direct', 0.2],
      ['spec_direct', 0],
      ['shininess', 10],
      ['reflect', 0.5],
      ['spec_count', -1],
      ['spec_reflect', -1],
      ['specular', 1],
      ['specular_intensity', 0.5],
    ],
  },
  {
    name: 'X-Ray',
    sets: [
      ['ambient', 1.0],
      ['direct', -0.6],
      ['spec_direct', 0],
      ['spec_direct_power', 55],
      ['light_count', 2],
      ['shininess', 0],
      ['reflect', -0.6],
      ['spec_count', -1],
      ['spec_power', -1],
      ['spec_reflect', -1],
      ['specular', 0.0],
      ['specular_intensity', 0.0],
      ['ambient_occlusion_mode', 0],
      ['ambient_occlusion_scale', 25],
      ['ambient_occlusion_smooth', 10],
      ['power', 1],
      ['reflect_power', 1],
    ],
  },
];

/** Settings panel of sliders controlling PyMOL's lighting and shading. */
export function LightingPanel({
  store,
  source,
}: {
  store: SettingsStore;
  source: SettingsSource;
}) {
  const catalogue = useStore(store, (s) => s.catalogue);
  const entries = useStore(store, (s) => s.entries);
  const byName = useMemo(() => {
    const map = new Map<string, SettingMeta>();
    for (const meta of catalogue?.settings ?? []) map.set(meta.name, meta);
    return map;
  }, [catalogue]);

  const apply = (preset: (typeof LIGHTING_PRESETS)[number]) => {
    void (async () => {
      for (const [name, value] of preset.sets) {
        const meta = byName.get(name);
        if (meta) await source.write(meta, value);
      }
    })();
  };

  return (
    <div className="lighting">
      <div className="lighting__presets">
        <span className="lighting__presets-label">Presets:</span>
        {LIGHTING_PRESETS.map((preset) => (
          <button key={preset.name} type="button" onClick={() => apply(preset)}>
            {preset.name}
          </button>
        ))}
      </div>
      {LIGHTING_SECTIONS.map((section) => (
        <fieldset key={section.heading} className="lighting__section">
          <legend>{section.heading}</legend>
          {section.sliders.map((slider) => {
            const meta = byName.get(slider.setting);
            const entry = meta ? entries[valueKey(meta.index)] : undefined;
            const value = Number(entry?.value ?? slider.min);
            return (
              <div key={slider.label} className="lighting__row">
                <label htmlFor={`light-${slider.setting}`}>{slider.label}</label>
                <input
                  id={`light-${slider.setting}`}
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={Number.isFinite(value) ? value : slider.min}
                  disabled={!meta}
                  onChange={(e) => meta && void source.write(meta, e.target.value)}
                />
                <input
                  className="lighting__num"
                  type="number"
                  step={slider.step}
                  aria-label={`${slider.setting} value`}
                  value={Number.isFinite(value) ? value : ''}
                  disabled={!meta}
                  onChange={(e) => meta && void source.write(meta, e.target.value)}
                />
              </div>
            );
          })}
        </fieldset>
      ))}
      <p className="lighting__note">
        Ranges come from the plugin that authored this panel, not from
        <code> SettingInfo</code>: PyMOL declares no min/max for most of these and enforces none
        of them. Values are written unclamped and read back.
      </p>
    </div>
  );
}
