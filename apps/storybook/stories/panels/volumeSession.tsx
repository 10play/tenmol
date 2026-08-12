/**
 * A per-story session that makes the Volume Color Map Editor render the way it
 * does against a live `object:volume` instead of the empty transfer function the
 * bare stub draws.
 *
 * WHY THE PANEL IS HOLLOW ON THE STUB. `VolumePanel` bootstraps on mount by
 * reading three things off the bridge — the ramp (`cmd.volume_color(name)`), the
 * named-ramp list (`cmd.tenmol_volume.ramps`), and the histogram
 * (`cmd.get_volume_histogram(name)`). The global `withSession` decorator answers
 * every call with `null`, so `getRamp` sees "not a volume object" and shows
 * `0 stops`, `presetList` falls to its compiled-in tier, and `fetchHistogram`
 * exhausts all three tiers and paints an empty plot under a scary
 * "no histogram: …" status line.
 *
 * WHAT THIS SUPPLIES. The exact shapes those calls return for a real electron
 * density map:
 *   - a six-stop colour ramp (`[value, r, g, b, alpha] * 6`), so the canvas
 *     draws its polyline, coloured dots and axis value-boxes;
 *   - the 64-bin histogram captured from the running engine
 *     (`features/volume/__fixtures__/engine-volume.json`), `[min, max, mean,
 *     stdev, h0..h63]`, so the red distribution curve is real;
 *   - a live named-ramp list with two `volume_ramp_new` registrations, so the
 *     preset dropdown reads "live" and marks the extras with `*`;
 *   - a `status.ok` volume bridge, so the header reads "tracking" rather than
 *     "untracked".
 * The setter (`cmd.volume_color(name, flat)`) answers a status int, exactly as
 * the C setter does, so every edit in the canvas round-trips without error.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/**
 * A six-stop transfer function across the map's data range (-0.31 … 5.0 σ),
 * flat `[value, r, g, b, alpha]` as `cmd.volume_color` returns it. Blue at the
 * noise floor rising through cyan/green/yellow/orange to red at the strong
 * density — the classic 2Fo-Fc colouring, with alpha climbing so weak signal
 * stays transparent.
 */
// prettier-ignore
const RAMP: number[] = [
  0.30, 0.16, 0.36, 0.94, 0.00,
  0.90, 0.13, 0.78, 0.86, 0.14,
  1.60, 0.20, 0.82, 0.35, 0.34,
  2.40, 0.99, 0.86, 0.20, 0.55,
  3.30, 0.98, 0.52, 0.16, 0.76,
  4.30, 0.94, 0.20, 0.24, 0.95,
];

/**
 * `[min, max, mean, stdev, h0..h63]`, captured from a real
 * `cmd.get_volume_histogram` over a socket (the panel's own fixture). The first
 * bin dominates (the noise floor) and a long low tail runs out to +5σ — the
 * shape of a genuine density map.
 */
// prettier-ignore
const HISTOGRAM: number[] = [
  -0.30942875146865845, 4.999135971069336, 5.338918640518386e-9, 0.9998271465301514,
  2337, 109, 72, 60, 45, 26, 22, 14, 21, 12, 13, 10, 8, 8, 6, 17, 6, 13, 8, 10, 7, 6,
  6, 5, 7, 4, 8, 5, 2, 6, 1, 5, 8, 3, 5, 3, 1, 2, 0, 1, 5, 3, 6, 2, 3, 0, 0, 0, 1, 0,
  1, 2, 0, 1, 5, 3, 1, 1, 5, 2, 4, 6, 1, 2,
];

/** The five compiled-in ramps plus two live `volume_ramp_new` registrations. */
const RAMP_NAMES = ['2fofc', 'esp', 'fofc', 'my_density', 'rainbow', 'rainbow2', 'wpe_pot'];
const RAMP_EXTRA = ['my_density', 'wpe_pot'];

/** Answer one bridge call the way a live volume session would. */
function volumeCall(fn: string, args: readonly unknown[] | undefined): unknown {
  switch (fn) {
    // GETTER form: `cmd.volume_color(name)` with a single argument returns the
    // flat ramp. The two-argument SETTER / preset forms return a status int.
    case 'volume_color':
      return !args || args.length <= 1 ? RAMP : 0;

    case 'get_volume_histogram':
      return HISTOGRAM;

    // Tier 1 of `presetList`: the live named-ramp read, with the extras split
    // out so the dropdown can mark them.
    case 'cmd.tenmol_volume.ramps':
      return { names: RAMP_NAMES, extra: RAMP_EXTRA };

    // The bridge status / watch handshake — so the header reads "tracking".
    case 'cmd.tenmol_volume.status':
      return { ok: true, installed: true };
    case 'cmd.tenmol_volume.watch':
    case 'cmd.tenmol_volume.unwatch':
      return { ok: true };

    // `volume_data_range` per-object setting, read by the field-histogram tier.
    case 'get':
      return '5.0';

    default:
      return null;
  }
}

/** Wrap a story in a session that answers the volume editor's bootstrap calls. */
export const withVolumeData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string, args: readonly unknown[]) =>
      Promise.resolve(volumeCall(fn, args))) as Session['call'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
