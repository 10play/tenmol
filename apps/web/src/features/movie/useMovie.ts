/**
 * One hook per feature, holding the polled status and the panel cache.
 *
 * The poll interval is 100 ms (10 Hz), not 30: `get_movie_status()` is 0.01 ms
 * on the engine but every poll is still a WebSocket round trip, and the movie
 * clock's fastest useful cadence is `movie_fps`, which tops out at 30 in the
 * Frame Rate menu. 10 Hz shows every frame change a human can see and leaves
 * the socket to the viewport, which needs it more.
 *
 * The panel (`get_session`, up to 41 ms) is refreshed only when a write says
 * it must, plus once on mount. Nothing polls it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MoviePanel, MovieStatus } from '@tenmol/protocol/topics/movie';
import { useSession } from '../../app';
import { createMovieSource, type MovieAction, type MovieSource } from './movieSource';

const POLL_MS = 100;

/**
 * The timeline refresh cadence.
 *
 * `get_movie_panel()` is `get_session()`, measured at 0.3 / 3.0 / 40.8 ms for
 * 660 / 5,439 / 64,309 atoms. At 0.5 Hz that is 2% of one core in the worst
 * case measured, which buys the panel the one thing a write-triggered refresh
 * cannot give it: a movie edited from the PyMOL console (`mview store`,
 * `mset`, a script) still shows up. Hidden tabs are skipped entirely.
 */
const PANEL_MS = 2000;

const EMPTY_STATUS: MovieStatus = {
  frame: 1,
  state: 1,
  nframes: 0,
  length: 0,
  playing: false,
  locked: false,
  rocking: false,
  fps: null,
  sceneCurrent: null,
  settings: {} as MovieStatus['settings'],
};

export interface MovieController {
  status: MovieStatus;
  panel: MoviePanel | null;
  source: MovieSource;
  error: string | null;
  /** Run a `MovieAction`, echo it, and refresh what it invalidated. */
  run(action: MovieAction): Promise<void>;
  /** Run a raw command line through `cmd.do` (menu leaves are command strings). */
  runLine(line: string): Promise<void>;
  refreshPanel(): Promise<void>;
  refreshNow(): Promise<void>;
}

export function useMovie(): MovieController {
  const session = useSession();
  const source = useMemo(() => createMovieSource(session.call), [session]);
  const [status, setStatus] = useState<MovieStatus>(EMPTY_STATUS);
  const [panel, setPanel] = useState<MoviePanel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refreshNow = useCallback(async () => {
    try {
      const next = await source.status();
      if (alive.current) {
        setStatus(next);
        setError(null);
      }
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [source]);

  const refreshPanel = useCallback(async () => {
    const next = await source.panel();
    if (alive.current) setPanel(next);
  }, [source]);

  useEffect(() => {
    alive.current = true;
    void refreshNow();
    void refreshPanel();
    const status = window.setInterval(() => {
      // Polling STATUS, never advancing a frame. The engine owns the clock.
      if (document.visibilityState === 'visible') void refreshNow();
    }, POLL_MS);
    const panelTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshPanel();
    }, PANEL_MS);
    return () => {
      alive.current = false;
      window.clearInterval(status);
      window.clearInterval(panelTimer);
    };
  }, [refreshNow, refreshPanel]);

  const run = useCallback(
    async (action: MovieAction) => {
      await session.act({
        fn: action.fn,
        args: action.args,
        kwargs: action.kwargs ?? {},
        echo: action.echo,
        invalidatesNames: false,
      });
      await refreshNow();
      if (action.invalidatesPanel) await refreshPanel();
    },
    [session, refreshNow, refreshPanel],
  );

  const runLine = useCallback(
    async (line: string) => {
      await session.run(line);
      await refreshNow();
      await refreshPanel();
    },
    [session, refreshNow, refreshPanel],
  );

  return { status, panel, source, error, run, runLine, refreshPanel, refreshNow };
}
