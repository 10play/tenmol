/**
 * Topic `settings` — the single source of truth for every checkbox and radio
 * in every menu.  OWNER: WP-15.
 *
 * Drained from `cmd.get_setting_updates()` (`modules/pymol/setting.py:440-447`),
 * which returns *indices* and CLEARS the queue; the bridge enriches each index.
 *
 * TWO MEASURED TRAPS (plan §1.2):
 *  * `[]` on a lock miss is indistinguishable from "nothing changed" — never
 *    build quiescence/settle detection on this topic.
 *  * The per-object setting channel is SEPARATE and must be drained too
 *    (21.6 us for 31 objects — do it every tick).
 *
 * Min/max are unavailable in v1 (C++ Task 4 not built): sliders are unclamped
 * and annotated (plan §6 WP-15).
 */

export type SettingKind = 'boolean' | 'int' | 'float' | 'float3' | 'color' | 'string';

export type SettingValue = boolean | number | readonly number[] | string;

export interface SettingChange {
  /** Setting index, e.g. 254 = scenes_changed (`layer1/SettingInfo.h:339`). */
  index: number;
  /** Setting name, e.g. 'scenes_changed'. */
  name: string;
  kind: SettingKind;
  value: SettingValue;
  /** `cmd.get_setting_text(...)` rendering (`setting.py:435-438`). */
  text: string;
  /**
   * Object name when this change came from the per-object channel; absent for
   * global settings.
   */
  object?: string;
  /** `_cmd.get_setting_level` (`layer4/Cmd.cpp:6494`) — no C++ needed (§A9). */
  level?: string;
}

export interface SettingsPayload {
  /**
   * Map key is the setting index rendered as a decimal string, because JSON
   * object keys are always strings.
   */
  changed: Record<string, SettingChange>;
  /**
   * True when this is a full resync rather than a diff. A session load produces
   * `len(get_setting_updates()) == 798` — a usable full-resync signal (§1.5).
   */
  full?: boolean;
}
