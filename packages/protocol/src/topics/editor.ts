/**
 * Topic `editor` — the Builder's pick state.  OWNER: WP-17.
 *
 * Every Builder button branches on how many atoms are currently picked
 * (`pk1`..`pk4`), so that state is a topic rather than a per-click query.
 *
 * `cmd.clean` raises `IncentiveOnlyException` in this tree
 * (`packages/engine/modules/pymol/computing.py:29`, plan §B7): the Clean button ships VISIBLY
 * DISABLED with a tooltip, not silently broken.
 */

export interface EditorPickedAtom {
  /** Selection name: 'pk1' | 'pk2' | 'pk3' | 'pk4'. */
  slot: string;
  object: string;
  index: number;
  /** Human label, e.g. '/1ubq//A/MET`1/CA'. */
  label: string;
}

export interface EditorPayload {
  /** `cmd.get_setting_int('auto_zoom')`-style editor mode flags. */
  active: boolean;
  picked: EditorPickedAtom[];
  /** True when an active bond (pk1-pk2) exists. */
  hasBond: boolean;
  /** Fragment/valence state that gates the Builder buttons. */
  validValence?: boolean;
}
