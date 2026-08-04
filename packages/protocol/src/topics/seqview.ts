/**
 * Topic `seqview` — the sequence viewer ("Seeker").  OWNER: WP-21.
 *
 * ============================================================================
 *  WHAT CHANGED AND WHY (this file used to describe a Mode-P hit overlay)
 *
 *  The original v1 plan was "PyMOL draws the strip into the framebuffer and the
 *  client positions a hit-testing overlay", because `SeekerUpdate`
 *  (`packages/engine/layer3/Seeker.cpp:969`) only runs inside `OrthoDoDraw` and the model has no
 *  Python readout.  That plan does not survive contact with the requirement:
 *  the overlay would need the same `char2col` geometry it cannot see, so it
 *  could not hit-test, and in Mode G there is no server-rendered strip at all.
 *
 *  What is actually true on this build:
 *
 *    - the model IS reachable, by RECONSTRUCTION, not by an accessor.
 *      `cmd.iterate` is the only per-atom readout that exposes `color` and
 *      `flags`, and those two are exactly what `SeekerFindColor` (`:908`) and
 *      the polymer/organic/guide tests need.
 *    - `cmd.get_model` is NOT a substitute: `CoordSetAtomToChemPyAtom`
 *      (`packages/engine/layer2/CoordSet.cpp:1057-1140`) emits no `color` at all.
 *    - `cmd.get_fastastr` (`packages/engine/modules/pymol/exporting.py:170`) is not one either:
 *      polymers only, no colours, no atom indices, no selection state, no gaps.
 *
 *  So `packages/bridge/tenmol_bridge/panels/seqview.py` rebuilds `CSeqRow`/`CSeqCol` from
 *  `cmd`, and this file is that model's wire shape: real cells with text,
 *  colour, atom indices and a selected flag — a DOM sequence viewer, not an
 *  overlay.
 * ============================================================================
 *
 * THE PAYLOAD IS A WINDOW.  `codes == 2` (atom names) on 1tii is 6,058 columns
 * and a WebSocket frame caps at 1 MiB, so a row carries `nCols` (the true
 * count) and `first` (where this slice starts).  The component virtualises and
 * asks for the window it is showing — which is what the React plan calls for
 * ("a virtualized grid using the same offset math").
 */

/** `seq_view_format` (setting 357).  `packages/engine/layer3/Seeker.cpp:1259-1484`. */
export const SeqFormat = {
  /** One-letter residue codes; water is `O`; organic/inorganic fall back to resn. */
  ResidueCodes: 0,
  /** Three-letter residue names, space separated. */
  ResidueNames: 1,
  /** One column per atom. */
  AtomNames: 2,
  /** One column per chain. */
  Chains: 3,
  /** State names — discrete objects use CoordSet names, others enumerate. */
  States: 4,
  /** Movie frames — declared but empty in the C (`:1483-1484`). */
  MovieFrames: 5,
} as const;
export type SeqFormatValue = (typeof SeqFormat)[keyof typeof SeqFormat];

/** `seq_view_label_mode` (setting 363, global, default 2).  `:1028-1101`. */
export const SeqLabelMode = {
  /** Object names only, inline in the sequence row (`column_label_flag`). */
  ObjectNames: 0,
  /** A single label row, above the first object only. */
  TopSequenceOnly: 1,
  /** A label row above every object row. */
  AllResidueNumbers: 2,
  /** No labels at all. */
  None: 3,
} as const;
export type SeqLabelModeValue = (typeof SeqLabelMode)[keyof typeof SeqLabelMode];

/** `seq_view_gap_mode` (setting 767, global, default 1).  `:1230-1258`. */
export const SeqGapMode = { None: 0, All: 1, Single: 2 } as const;
export type SeqGapModeValue = (typeof SeqGapMode)[keyof typeof SeqGapMode];

/**
 * `seq_view_unaligned_mode` (setting 514, global, default 0).
 *
 * TWO independent things, which is why there are six values:
 *
 *  - LAYOUT (`packages/engine/layer3/Seeker.cpp:1590-1596`): 0/1/2 pack every row's untagged
 *    columns into ONE shared column; 3/4/5 give each row its own — `stagger`.
 *  - COLOUR (`packages/engine/layer1/Seq.cpp:420-449`): 0/3 paint an unaligned column in
 *    `seq_view_unaligned_color` flat, 1/4 average it with the background, 2/5
 *    average it with `seq_view_unaligned_color`.
 *
 * `seq_view_unaligned_color` left at its default of -1 resolves to
 * `seq_view_fill_color` — except in mode 3, where it stays -1 and the column
 * keeps its own colour (`packages/engine/layer1/Seq.cpp:323-332`).
 */
export const SeqUnalignedMode = {
  /** Packed; flat unaligned colour. */
  PackedFlat: 0,
  /** Packed; blended with the background. */
  PackedDim: 1,
  /** Packed; blended with the unaligned colour. */
  PackedBlend: 2,
  /** Staggered; the column keeps its own colour. */
  StaggeredOwn: 3,
  /** Staggered; blended with the background. */
  StaggeredDim: 4,
  /** Staggered; blended with the unaligned colour. */
  StaggeredBlend: 5,
} as const;
export type SeqUnalignedModeValue =
  (typeof SeqUnalignedMode)[keyof typeof SeqUnalignedMode];

/** `packages/engine/layer3/Seeker.cpp:1590-1596` — only 3/4/5 stagger. */
export function seqUnalignedStagger(mode: number): boolean {
  return mode !== 0 && mode !== 1 && mode !== 2;
}

/**
 * `SelModeKW`, `packages/engine/layer1/Scene.cpp:459-467`, indexed by `mouse_selection_mode`.
 * The keyword the selection algebra wraps every term in.
 */
export const SEL_MODE_KEYWORDS = [
  '',
  'byresi',
  'bychain',
  'bysegi',
  'byobject',
  'bymol',
  'bca.',
] as const;

/** `_seeker` / `_seeker_center` — `packages/engine/layer3/Seeker.h:25-27`. */
export const SEQ_TEMP_SELE = '_seeker';
export const SEQ_TEMP_CENTER_SELE = '_seeker_center';

/**
 * One column — `CSeqCol` (`packages/engine/layer1/Seq.h:25-37`).
 *
 * Boolean and numeric fields are OMITTED when false/zero: a 1,200-cell window
 * is sent 30 times a second and the defaults are the common case.
 */
export interface SeqviewCell {
  /** The characters this column contributes to the row's flat text buffer. */
  text: string;
  /** PyMOL colour index; look it up in `SeqviewPayload.colors`. */
  color: number;
  /** Character offset into the row — the FOURTH pass (`:1917-1943`). */
  offset: number;
  /** 1-based atom indices, i.e. what the `index` selection keyword takes. */
  atoms: number[];
  /** A gap/fill column: never clickable, never selected (`:1250-1251`). */
  spacer?: boolean;
  /** The text is a one-letter code rather than a full `resn` (`:1319`). */
  isAbbr?: boolean;
  /** `hint_no_space` — the previous column was also abbreviated. */
  hintNoSpace?: boolean;
  /** `col->inverse` — in the active selection (`SeekerRefresh`, `:475-525`). */
  selected?: boolean;
  /** 1-based state this column stands for, in `seq_view_format` 4. */
  state?: number;
  /** Alignment tag (`SeekerFindTag`, `:928-967`); 0 when no alignment. */
  tag?: number;
  /**
   * `col->unaligned` — set by the alignment pass on every column with no tag
   * (`packages/engine/layer3/Seeker.cpp:1658`).  Drives the colour, not the position.
   */
  unaligned?: boolean;
  resi?: string;
  chain?: string;
  resn?: string;
}

/**
 * One `row->fill` run — `packages/engine/layer1/Seq.cpp:488-504` paints `width` copies of
 * `seq_view_fill_char` at `offset`, in `seq_view_fill_color`.  These are the
 * dashes under a residue another row has and this one does not.
 */
export interface SeqviewFill {
  /** Character offset, in the same space as `SeqviewCell.offset`. */
  offset: number;
  /** `col->stop - col->start` — how many fill characters. */
  width: number;
}

/** A residue-number label or a `/segi/chain/` breadcrumb above a column. */
export interface SeqviewLabel {
  /** Column index WITHIN THE WINDOW (already rebased off `row.first`). */
  col: number;
  /** Character offset, for a grid that positions by character not by cell. */
  offset: number;
  text: string;
}

/** One object's row — `CSeqRow` (`packages/engine/layer1/Seq.h:42-57`). */
export interface SeqviewRow {
  object: string;
  /** `cmd.get_object_color_index`; -1 when the object has none. */
  objectColor: number;
  /** The effective `seq_view_format` for THIS object (discrete flips to 4). */
  codes: number;
  /** False for `codes == 4` on a non-discrete object (`:427`). */
  selectable: boolean;
  discrete: boolean;
  /** `ext_len` — total character width of the whole row, not just the window. */
  extLen: number;
  /** Total column count. `cells.length` is only the window. */
  nCols: number;
  /** Index of `cells[0]` in the full row. */
  first: number;
  /** True when the window is not the whole row. */
  truncated: boolean;
  cells: SeqviewCell[];
  /**
   * `row->fill` — empty unless an alignment is active.  Windowed by character
   * offset against the span the windowed cells cover, not by column, because a
   * fill run has no column index.
   */
  fill: SeqviewFill[];
  /** Residue-number labels — the THIRD pass (`:1820-1914`). */
  labels: SeqviewLabel[];
  /** `/segi/chain/` markers, re-emitted at every change (`:1147-1215`). */
  breadcrumbs: SeqviewLabel[];
}

export interface SeqviewPayload {
  /** True when at least one enabled object has `seq_view` on. */
  visible: boolean;
  /** `seq_view_location`: 0 = top, 1 = bottom (`packages/engine/layer1/Ortho.cpp:2181`). */
  location: number;
  /** `seq_view_overlay` — draw over the scene instead of reserving space. */
  overlay: boolean;
  /** Global `seq_view_format`; a row may override it. */
  format: number;
  labelMode: number;
  gapMode: number;
  /** `seq_view_fill_color` (default 104) — gaps and out-of-state atoms. */
  fillColor: number;
  /** `ExecutiveGetActiveSeleName` without `create_new`; '' when none. */
  activeSele: string;
  /** `SceneGetSeleModeKeyword` — one of `SEL_MODE_KEYWORDS`. */
  seleMode: string;
  /**
   * `ExecutiveGetActiveAlignment` (`packages/engine/layer3/Executive.cpp:3403`) — the
   * `seq_view_alignment` object, or the first enabled one, or ''.  Non-empty is
   * exactly the C's `align_sele >= 0`: rows are laid out by tag, and gaps are
   * suppressed (`packages/engine/layer3/Seeker.cpp:1235`).
   */
  alignment: string;
  /** `seq_view_unaligned_mode` — see `SeqUnalignedMode`. */
  unalignedMode: number;
  /** Resolved `seq_view_unaligned_color`; -1 = keep the column's own colour. */
  unalignedColor: number;
  /** `seq_view_fill_char`, first character only; '' means draw no fill. */
  fillChar: string;
  /** `bg_rgb` (or the gradient end this strip sits on) as 0..1 RGB. */
  bgColor: number[];
  rows: SeqviewRow[];
  /** Colour index (as a string key) -> 0..1 RGB, for every index in `rows`. */
  colors: Record<string, number[]>;
  /** The window this payload answers. */
  window: { first: number; count: number; max: number };
}

/** What `select` / `select_range` answer with. */
export interface SeqviewSelectResult {
  /** The active selection name, created if it did not exist. */
  name: string;
  /** The algebra that was applied, e.g. `((byresi(?sele)) or byresi(_seeker))`. */
  expression: string;
  /** The `cmd.select(...)` line `SeekerSelectionToggle` logs (`:227-230`). */
  log: string;
  /** `cmd.count_atoms(name)` afterwards. */
  count: number;
  /** For `select_range`: the clamped `[first, last]` column span. */
  columns?: [number, number];
}

/**
 * `SeekerSelectionToggle` (`packages/engine/layer3/Seeker.cpp:203-221`) — the three forms.
 * Reimplemented here so the client can show the user what it is about to run
 * before the round trip; the bridge builds the same string and is authoritative.
 */
export function seqSelectExpression(
  seleKeyword: string,
  seleName: string,
  include: boolean,
  startOver: boolean,
  temp: string = SEQ_TEMP_SELE,
): string {
  if (startOver) return `${seleKeyword}(${temp})`;
  if (include) return `((${seleKeyword}(?${seleName})) or ${seleKeyword}(${temp}))`;
  return `((${seleKeyword}(?${seleName})) and not ${seleKeyword}(${temp}))`;
}
