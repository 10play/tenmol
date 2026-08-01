/**
 * "Last program" bookkeeping — `PyMOLDesktopGUI.mvprg` (`_gui.py:958-970`).
 *
 * This is GUI-layer state, not backend state: PyMOL keeps `movie_start` and
 * `movie_command` on the *window object*, and nothing in the engine knows they
 * exist. So it lives here, in the client, exactly as the inventory says.
 *
 *   mvprg(command)  movie_start = get_movie_length() + 1
 *                   movie_command = command % movie_start      (the `%d`)
 *                   cmd.do(movie_command)
 *   mvprg()         re-run movie_command, or do nothing if there is none
 *   removeLast()    cmd.mdelete(-1, movie_start), only if movie_start > 0
 */

export interface MvprgState {
  movieStart: number;
  movieCommand: string | null;
}

export const MVPRG_INITIAL: MvprgState = { movieStart: 0, movieCommand: null };

/**
 * Python's `template % start` for the single `%d` these templates carry.
 *
 * `_gui.py` templates are things like `movie.add_nutate(4,15,start=%d)` and
 * `movie.add_state_loop(2, 1, start=%d)`; one `%d`, nothing else. Anything
 * with no `%d` is returned unchanged, which is what `%` would do too.
 */
export function renderTemplate(template: string, start: number): string {
  return template.replace(/%d/g, String(start));
}

/** `mvprg(command)`: stores the program and returns the line to run. */
export function beginProgram(
  template: string,
  movieLength: number,
): { state: MvprgState; command: string } {
  const movieStart = movieLength + 1;
  const command = renderTemplate(template, movieStart);
  return { state: { movieStart, movieCommand: command }, command };
}

/** `mvprg()` with no argument: Update Last Program. */
export function updateProgram(state: MvprgState): string | null {
  return state.movieCommand;
}

/** `mvprg_remove_last`: `cmd.mdelete(-1, movie_start)`, guarded on `> 0`. */
export function removeLastProgram(state: MvprgState): { count: number; frame: number } | null {
  if (state.movieStart <= 0) return null;
  return { count: -1, frame: state.movieStart };
}
