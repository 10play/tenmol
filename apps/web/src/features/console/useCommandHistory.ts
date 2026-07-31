/**
 * Command-line history, a direct port of `PyMOLDesktopGUI` in
 * `modules/pymol/_gui.py:895-941`. Behaviour is deliberately identical,
 * including the odd bits:
 *
 *  - slot 0 is always a scratch buffer holding the currently typed text
 *    (`self.history = ['']`, `_gui.py:896`)
 *  - `doTypedCommand` dedupes only against the *immediately previous* entry
 *    (`if len(self.history) < 2 or self.history[1] != cmmd`, `_gui.py:908`)
 *  - the list is capped at 255 entries by popping the oldest (`_gui.py:911-912`)
 *  - `back()` saves the current text into slot 0 only on the first press
 *    (`if not self.history_cur`, `_gui.py:927`)
 *  - `back_search()` scans forward from `history_cur + 1` for the first entry
 *    that startswith slot 0 (`_gui.py:916-923`) — bound to Ctrl+Up
 *  - `_jump_history` clamps to `len(history) - 1` (`_gui.py:936`)
 *
 * Addition: the list is mirrored into the `ui` store, which persists it to
 * localStorage, so history survives a reload the way a shell's does. PyMOL's own
 * history does not, but PyMOL's own process does not reload either.
 */

import { useCallback, useRef } from 'react';
import type { UiStore } from '@tenmol/stores';

export interface CommandHistory {
  push(cmd: string): void;
  /** Up. Returns the text to show, or null to leave the line alone. */
  back(current: string): string | null;
  /** Ctrl+Up. Prefix search backwards. */
  backSearch(current: string): string | null;
  /** Down. */
  forward(): string | null;
  entries(): readonly string[];
}

const MAX_HISTORY = 255;

export function useCommandHistory(ui: UiStore): CommandHistory {
  const history = useRef<string[] | null>(null);
  if (history.current === null) {
    const saved = ui.get().history;
    history.current = saved.length > 0 ? [...saved] : [''];
    if (history.current[0] !== '') history.current.unshift('');
  }
  const cur = useRef(0);

  const jump = useCallback((i: number): string | null => {
    const h = history.current as string[];
    cur.current = Math.min(i, h.length - 1);
    return h[cur.current] ?? null;
  }, []);

  const push = useCallback(
    (cmd: string) => {
      const h = history.current as string[];
      if (h.length < 2 || h[1] !== cmd) {
        h[0] = cmd;
        h.unshift('');
        if (h.length > MAX_HISTORY) h.pop();
      }
      cur.current = 0;
      ui.set({ history: [...h] });
    },
    [ui],
  );

  const back = useCallback(
    (current: string): string | null => {
      if (!cur.current) (history.current as string[])[0] = current;
      return jump(cur.current + 1);
    },
    [jump],
  );

  const backSearch = useCallback(
    (current: string): string | null => {
      const h = history.current as string[];
      if (!cur.current) h[0] = current;
      const prefix = h[0] ?? '';
      for (let i = cur.current + 1; i < h.length; i++) {
        if ((h[i] ?? '').startsWith(prefix)) return jump(i);
      }
      return null;
    },
    [jump],
  );

  const forward = useCallback((): string | null => {
    if (!cur.current) return null;
    return jump(cur.current - 1);
  }, [jump]);

  const entries = useCallback(() => history.current as readonly string[], []);

  return { push, back, backSearch, forward, entries };
}
