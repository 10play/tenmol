/**
 * The named-view list, read back the only way the API allows.
 *
 * `refresh()` sends one deliberately-failing `cmd.view` and parses the sorted
 * names out of the error message (see `viewActions.ts` for why). It goes
 * through `session.conn.call` rather than `session.call` ON PURPOSE:
 * `session.call` writes every rejection into the console scrollback, and this
 * one is not a user-visible failure — it is how the list is fetched, and it
 * would print an error line on every refresh.
 *
 * The writes DO go through `session.act`, so `cmd.view("a", "store")` shows up
 * in the console like every other panel action.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../../app';
import { parseViewNames, viewActions, type ViewAction } from './viewActions';

export interface ViewsController {
  names: readonly string[];
  /** Non-null when the last refresh could not be understood. */
  error: string | null;
  run(action: ViewAction): Promise<void>;
  refresh(): Promise<void>;
}

export function useViews(): ViewsController {
  const session = useSession();
  const [names, setNames] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const probe = viewActions.probe();
    try {
      await session.conn.call(probe.fn, probe.args, probe.kwargs ?? {});
      // Reaching here means a view is actually named (or prefixed by) the
      // probe key, which also means the camera just moved. Nothing sane to do
      // but say so rather than silently blank the list.
      if (alive.current) setError('the view-list probe key is in use');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const parsed = parseViewNames(message);
      if (!alive.current) return;
      if (parsed === null) {
        setError(message);
      } else {
        setError(null);
        setNames(parsed);
      }
    }
  }, [session]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const run = useCallback(
    async (action: ViewAction) => {
      await session.act({
        fn: action.fn,
        args: action.args,
        kwargs: action.kwargs ?? {},
        echo: action.echo,
      });
      await refresh();
    },
    [session, refresh],
  );

  return { names, error, run, refresh };
}
