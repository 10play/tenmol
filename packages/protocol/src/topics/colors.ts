/**
 * Topic `colors` — the colour table and ramps.  OWNER: WP-22.
 *
 * Every `color` field on every other topic (`ObjectRow.color`,
 * `IndexedMeshHeader.oneColor`, CGO colour arrays) is a PyMOL colour INDEX.
 * Without this table the client cannot render any of them, so this topic is a
 * hard dependency of the object panel and of Mode G.
 */

export interface ColorEntry {
  index: number;
  name: string;
  /** 0..1 floats, as `cmd.get_color_tuple()` returns them. */
  rgb: readonly [number, number, number];
}

export interface ColorRamp {
  name: string;
  /** Object name of the ramp (`object:ramp`). */
  object: string;
}

export interface ColorsPayload {
  /** `cmd.get_color_indices()` enriched with `cmd.get_color_tuple()`. */
  colors: ColorEntry[];
  ramps: ColorRamp[];
  /** True when this replaces the whole table rather than patching it. */
  full: boolean;
}
