/**
 * A per-story session + decorators that drive the {@link DialogsPanel} the way a
 * live bridge would, so the launcher strip AND the Advanced Settings window it
 * hosts open POPULATED instead of as empty chrome.
 *
 * WHY THE PANEL IS HOLLOW ON THE STUB. `DialogsPanel` polls
 * `cmd.get_names_of_type('object:volume')` to fill its volume chooser, and the
 * Advanced Settings table it hosts reads `setting.get_name_list` once and then
 * `get_setting_tuple` / `get` per visible row. The global `withSession`
 * decorator answers every `call()` with `null`, so the volume select is empty
 * and the settings table has no rows at all — the window opens blank.
 *
 * WHAT THIS SUPPLIES. A bridge whose:
 *   - `get_names_of_type` returns two volume objects, so the launcher's chooser
 *     lists real targets;
 *   - `setting.get_name_list` returns a realistic slice of PyMOL's setting
 *     catalogue (~50 names), and `get_setting_tuple` / `get` return each one's
 *     type + string value — so the Advanced Settings table renders a full,
 *     scrollable grid with booleans as checkboxes and everything else editable.
 *
 * `withAdvancedSettingsOpen` additionally opens the Advanced Settings window on
 * mount (and closes it on unmount), so the Default story shows the panel doing
 * its real job — hosting a populated dialog — rather than just the idle strip.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import { useEffect } from 'react';
import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';
import { dialogsStore } from '@web/features/dialogs/store';

import { mockSession } from '../../.storybook/decorators';

/** `cmd.get_setting_tuple` type codes — inlined; the stories dir cannot resolve
 * the protocol package (only `@tenmol/stores` + the `@web` alias are on path). */
const T = { Boolean: 1, Int: 2, Float: 3, Float3: 4, Color: 5, String: 6 } as const;

/** Volume objects the launcher's chooser lists (`get_names_of_type`). */
const VOLUME_NAMES = ['emap.ccp4', '2fofc_density'];

/**
 * A realistic slice of the setting catalogue: `[name, type, value]`. The value
 * is always the STRING form `cmd.get` returns, exactly like the Qt table.
 */
const SETTINGS: ReadonlyArray<readonly [string, number, string]> = [
  ['ambient', T.Float, '0.140000'],
  ['ambient_occlusion_mode', T.Int, '0'],
  ['ambient_occlusion_scale', T.Float, '25.000000'],
  ['antialias', T.Int, '2'],
  ['ao_blur', T.Float, '1.500000'],
  ['ao_max_dist', T.Float, '10.000000'],
  ['auto_show_lines', T.Boolean, '1'],
  ['auto_show_nonbonded', T.Boolean, '1'],
  ['auto_show_spheres', T.Boolean, '0'],
  ['auto_zoom', T.Boolean, '1'],
  ['bg_gradient', T.Boolean, '0'],
  ['bg_rgb', T.Color, 'black'],
  ['cartoon_cylindrical_helices', T.Int, '0'],
  ['cartoon_fancy_helices', T.Int, '0'],
  ['cartoon_flat_sheets', T.Boolean, '1'],
  ['cartoon_highlight_color', T.Color, 'grey50'],
  ['cartoon_side_chain_helper', T.Boolean, '0'],
  ['cartoon_transparency', T.Float, '0.000000'],
  ['dash_gap', T.Float, '0.350000'],
  ['dash_length', T.Float, '0.500000'],
  ['dash_radius', T.Float, '0.050000'],
  ['depth_cue', T.Boolean, '1'],
  ['dot_density', T.Int, '2'],
  ['fog', T.Boolean, '1'],
  ['fog_start', T.Float, '0.450000'],
  ['gaussian_resolution', T.Float, '2.000000'],
  ['grid_mode', T.Int, '0'],
  ['h_bond_cutoff_center', T.Float, '3.600000'],
  ['label_color', T.Color, 'default'],
  ['label_font_id', T.Int, '5'],
  ['label_size', T.Float, '14.000000'],
  ['light', T.Float3, '[ -0.40, -0.40, -1.00 ]'],
  ['line_width', T.Float, '1.000000'],
  ['mesh_width', T.Float, '0.500000'],
  ['opaque_background', T.Boolean, '1'],
  ['orthoscopic', T.Boolean, '0'],
  ['ray_opaque_background', T.Boolean, '1'],
  ['ray_shadows', T.Boolean, '1'],
  ['ray_trace_mode', T.Int, '0'],
  ['solvent_radius', T.Float, '1.400000'],
  ['specular', T.Float, '1.000000'],
  ['spec_power', T.Float, '60.000000'],
  ['sphere_scale', T.Float, '1.000000'],
  ['stick_radius', T.Float, '0.250000'],
  ['surface_quality', T.Int, '0'],
  ['transparency', T.Float, '0.000000'],
  ['two_sided_lighting', T.Int, '-1'],
  ['valence', T.Boolean, '0'],
];

const NAMES = SETTINGS.map(([name]) => name);
const BY_NAME = new Map(SETTINGS.map(([name, type, value]) => [name, { type, value }]));

/** Answer one bridge call the way a connected engine would for this panel. */
function dialogsCall(fn: string, args?: unknown[]): unknown {
  if (fn === 'get_names_of_type') return VOLUME_NAMES;
  if (fn === 'setting.get_name_list') return NAMES;
  if (fn === 'get_setting_tuple') {
    const row = BY_NAME.get(String((args ?? [])[0] ?? ''));
    return row ? [row.type, []] : [T.String, []];
  }
  if (fn === 'get') {
    const row = BY_NAME.get(String((args ?? [])[0] ?? ''));
    return row ? row.value : '';
  }
  if (fn === 'set') return null;
  return null;
}

/** Wrap a story in a session that answers the dialogs panel's bridge calls. */
export const withDialogsData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string, args?: unknown[]) =>
      Promise.resolve(dialogsCall(fn, args))) as Session['call'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};

/** Open the Advanced Settings window on mount so the host is shown doing its job. */
export const withAdvancedSettingsOpen: Decorator = (Story) => {
  useEffect(() => {
    const key = dialogsStore.open('advanced-settings');
    return () => dialogsStore.close(key);
  }, []);
  return <Story />;
};
