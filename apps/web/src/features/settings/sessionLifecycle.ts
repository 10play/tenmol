/**
 * Session / defaults lifecycle — `cmd.reinitialize` and the PSE blacklist.
 *
 * TWO FACTS THE CLIENT CANNOT ASK THE BACKEND FOR.
 *
 * 1. `is_session_blacklisted` (`packages/engine/layer1/Setting.cpp:627-686`) is a `static bool`
 *    in an anonymous-ish translation unit. It is not wrapped, not exported and
 *    not reachable from Python — there is no `cmd.is_session_blacklisted`. So
 *    the list below is a PORT, and it is checked two ways in
 *    `packages/bridge/tests/test_p8_a5.py`: against the C source, and against the engine
 *    (a blacklisted setting, once defined, still never appears in
 *    `cmd.get_session()['settings']`, because `SettingAsPyList` filters through
 *    exactly this predicate).
 *
 * 2. The reinit codes are a dict in `packages/engine/modules/pymol/commanding.py:350-356` that
 *    `cmd.reinitialize` looks the WORD up in. Sending the word is right;
 *    sending the number would be sending an implementation detail.
 *
 * The four menu entries are `packages/engine/modules/pymol/_gui.py:126-132`, verbatim including
 * the labels — and the labels are not the words: PyMOL's "Stored Settings" runs
 * `reinitialize settings` (code 1) and its "Original Settings" runs
 * `reinitialize original_settings` (code 3). Getting those two the wrong way
 * round silently throws the user's stored defaults away, which is why they are
 * data here and diffed against `_gui.py` by the bridge test.
 */

import type { SettingMeta } from '@tenmol/protocol';

/** `commanding.py:350-356`. The word is what `cmd.reinitialize` takes. */
export const REINIT_CODES: Readonly<Record<string, number>> = {
  everything: 0,
  settings: 1,
  store_defaults: 2,
  original_settings: 3,
  purge_defaults: 4,
};

/** One `File ▸ Reinitialize` menu entry: its label, reinit word, help text, and whether it deletes objects. */
export interface ReinitEntry {
  label: string;
  what: string;
  /** Why a user would pick it, since the labels are not self-explanatory. */
  help: string;
  /** True when it destroys objects as well as settings. */
  destructive: boolean;
}

/** `File ▸ Reinitialize` — `_gui.py:126-132`, in order. */
export const REINITIALIZE_MENU: readonly ReinitEntry[] = [
  {
    label: 'Everything',
    what: 'everything',
    help: 'delete every object AND restore the default settings',
    destructive: true,
  },
  {
    label: 'Original Settings',
    what: 'original_settings',
    help: 'restore the settings PyMOL shipped with, ignoring anything stored',
    destructive: false,
  },
  {
    label: 'Stored Settings',
    what: 'settings',
    help: 'restore the settings last stored with Store Current Settings',
    destructive: false,
  },
  {
    label: 'Store Current Settings',
    what: 'store_defaults',
    help: 'make the current settings the ones "Stored Settings" restores',
    destructive: false,
  },
];

/**
 * The system-dependent settings `is_session_blacklisted` names one by one
 * (`packages/engine/layer1/Setting.cpp:634-683`), in source order. Everything at the `unused`
 * LEVEL is blacklisted too, but by rule rather than by name — see
 * `isSessionBlacklisted`.
 */
export const SESSION_BLACKLIST: readonly string[] = [
  'antialias_shader',
  'ati_bugs',
  'cache_max',
  'cgo_shader_ub_color',
  'cgo_shader_ub_flags',
  'cgo_shader_ub_normal',
  'colored_feedback',
  'cylinder_shader_ff_workaround',
  'defer_updates',
  'fast_idle',
  'fetch_path',
  'internal_feedback',
  'internal_gui',
  'internal_prompt',
  'logging',
  'max_threads',
  'mouse_grid',
  'mouse_scale',
  'nb_spheres_use_shader',
  'no_idle',
  'nvidia_bugs',
  'presentation',
  'precomputed_lighting',
  'render_as_cylinders',
  'security',
  'session_changed',
  'session_file',
  'session_migration',
  'session_version_check',
  'shaders_from_disk',
  'show_progress',
  'slow_idle',
  'stereo',
  'stereo_double_pump_mono',
  'stereo_mode',
  'suspend_deferred',
  'suspend_undo',
  'suspend_undo_atom_count',
  'suspend_updates',
  'text',
  'trilines',
  'use_geometry_shaders',
  'use_shaders',
  'pick32bit',
  'display_scale_factor',
];

const BLACKLIST_SET = new Set(SESSION_BLACKLIST);

/**
 * True when this setting is NOT written to a PSE, so its value will not travel
 * with the session and a collaborator opening the file gets their own.
 *
 * The two rules of `is_session_blacklisted`, in the same order: level `unused`
 * first (it covers 18 records), then the name list.
 */
export function isSessionBlacklisted(meta: Pick<SettingMeta, 'name' | 'level'>): boolean {
  return meta.level === 'unused' || BLACKLIST_SET.has(meta.name);
}

/** What `cmd.reinitialize(what)` invalidates on the client. */
export function reinitInvalidates(what: string): 'everything' | 'settings' {
  return what === 'everything' ? 'everything' : 'settings';
}
