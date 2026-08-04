/**
 * Topic `frame` — the movie clock.  OWNER: WP-20.
 *
 * THE BACKEND IS THE CLOCK. The client never runs a frame timer (plan §6
 * WP-20, measured: 1 s of `idle()` + `refresh()` at `movie_fps 30` advances 28
 * distinct frames). A client-side timer would drift against PyMOL's own.
 *
 * Frames and states are 1-based in PyMOL.
 */

export interface FramePayload {
  frame: number;
  state: number;
  nframes: number;
  playing: boolean;
  /** `cmd.get('movie_fps')`. */
  fps?: number;
}
