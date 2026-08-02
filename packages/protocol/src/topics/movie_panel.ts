/**
 * Topic `movie_panel` — the movie timeline strip.  OWNER: WP-20.
 *
 * Like the object panel, the movie panel is a C++ `Block::draw` surface
 * upstream with no Python readout, so `packages/bridge/tenmol_bridge/panels/movie.py`
 * is a NEW endpoint (plan §6 WP-12's note applies here too).
 *
 * `movie.produce` / `cmd.mpng` work headless (plan §A2).
 */

export interface MovieFrameCell {
  /** 1-based movie frame. */
  frame: number;
  /** Object state this frame maps to (`cmd.get_movie_locked` semantics). */
  state: number;
  /** True when a scene is pinned at this frame. */
  scene?: string;
  /** True when this frame carries a stored view (movie interpolation key). */
  key?: boolean;
}

export interface MoviePanelPayload {
  cells: MovieFrameCell[];
  nframes: number;
  /** True when the movie panel is visible (`cmd.get('movie_panel')`). */
  visible: boolean;
}
