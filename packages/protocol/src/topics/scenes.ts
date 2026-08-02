/**
 * Topic `scenes` — the scene bin.  OWNER: WP-20.
 *
 * `scenes_changed` (setting 254, `packages/engine/layer1/SettingInfo.h:339`) already rides the
 * settings drain, so this topic needs NO new PyMOL event: the bridge re-reads
 * `cmd.get_scene_list()` (0.7 us median) when 254 appears (plan §1.5).
 */

export interface SceneEntry {
  name: string;
  /** Scene message shown in the viewport overlay, '' when unset. */
  message: string;
  /** Which aspects the scene stores: any of 'view','color','rep','active','frame'. */
  stores: readonly string[];
}

export interface ScenesPayload {
  /** `cmd.get_scene_list()`, in bin order. */
  scenes: SceneEntry[];
  /** Currently recalled scene name, or null. */
  current: string | null;
}
