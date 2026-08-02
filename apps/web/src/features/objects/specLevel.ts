/**
 * The M button's tint — `ObjectGetSpecLevel(rec->obj, SceneGetFrame(G))`.
 *
 * `CExecutive::draw` case 5 (`layer3/Executive.cpp:16362-16381`):
 *
 *     float* button_color = toggleColor2;          // {0.4,0.4,0.6}
 *     spec_level = ObjectGetSpecLevel(rec->obj, SceneGetFrame(G));
 *     case 1: button_color = toggleColor3;         // {0.6,0.6,0.8}
 *     case 2: button_color = activeColor;          // {0.9,0.9,1.0}
 *
 * Level 1 is an interpolated frame, level 2 is a stored key frame
 * (`layer1/View.cpp`), and `-1` means the object has no `ViewElem` at all —
 * which draws the same as level 0, because the switch has no case for it.
 *
 * The level itself comes from `panels/objects.py:spec_levels`, which reads the
 * `ViewElem` out of the SAME `cmd.get_session(partial=1)` the row list already
 * costs. The inventory said this needed a new C accessor; it does not.
 */

export type SpecClass = 'none' | 'interp' | 'key';

/** `spec_level` -> the class the CSS keys the three fills off. */
export function specClass(level: number | undefined): SpecClass {
  if (level === 1) return 'interp';
  if (level === 2) return 'key';
  return 'none';
}

/** The three fills, as CSS, for a test that wants the real numbers. */
export const SPEC_FILL_CSS: Readonly<Record<SpecClass, string>> = {
  none: 'rgb(102, 102, 153)', // toggleColor2 {0.4,0.4,0.6}
  interp: 'rgb(153, 153, 204)', // toggleColor3 {0.6,0.6,0.8}
  key: 'rgb(230, 230, 255)', // activeColor  {0.9,0.9,1.0}
};
