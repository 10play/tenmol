/**
 * The output pane.
 *
 * Qt: a read-only `QPlainTextEdit` named `feedback_browser`
 * (`modules/pmg_qt/pymol_qt_gui.py:122-124`), monospace, appended from
 * `cmd._get_feedback()` on a 500 ms timer (`:941-958`). Here the timer is gone —
 * the bridge pushes `{t:'feedback', lines:[...]}` from its 10 Hz status thread.
 *
 * Three things this pane must get right, all of them from measurements:
 *
 *  1. WINDOWING, NOT VIRTUALISATION. The store keeps 5,000 lines; rendering
 *     5,000 DOM nodes on every push is what makes a console feel broken. Only
 *     the last `WINDOW` lines are mounted, with a "showing last N" affordance to
 *     lift the limit — no measuring, no absolute positioning, no scroll jank.
 *  2. STICKY AUTOSCROLL. Follow the tail only when already at the tail, so
 *     scrolling back to read is never yanked away (`ui.followOutput`).
 *  3. SELECTABLE, MONOSPACE, PRESERVED WHITESPACE. PyMOL output is aligned with
 *     spaces (`" count_atoms: 10 atoms"`, ray timing tables) and users copy it.
 *
 * Long lines are hard-split by PyMOL itself at ~1018 chars regardless of
 * `wrap_output` (`OrthoLineLength` fail-safe, `layer1/Ortho.cpp:1097-1104`), so
 * one feedback entry is NOT always one logical line — hence no line numbering.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession, useStore } from '../../app';

const WINDOW = 1200;

export function FeedbackLog() {
  const session = useSession();
  const lines = useStore(session.stores.feedback, (s) => s.lines);
  const evicted = useStore(session.stores.feedback, (s) => s.evicted);
  const fontSize = useStore(session.stores.ui, (s) => s.consoleFontSize);
  const follow = useStore(session.stores.ui, (s) => s.followOutput);

  const [showAll, setShowAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const hidden = showAll ? 0 : Math.max(0, lines.length - WINDOW);
  const shown = hidden > 0 ? lines.slice(hidden) : lines;

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current && follow) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  // Start pinned to the bottom on first paint, before any output arrives.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div
      className="feedback"
      ref={ref}
      style={{ fontSize }}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 6;
      }}
    >
      {(hidden > 0 || evicted > 0) && (
        <div className="feedback__more">
          {evicted > 0 && <span>{evicted} older lines dropped from the 5,000-line ring · </span>}
          {hidden > 0 && (
            <button type="button" className="feedback__more-btn" onClick={() => setShowAll(true)}>
              show {hidden} earlier lines
            </button>
          )}
        </div>
      )}
      {shown.map((line) => (
        <div className={`feedback__line feedback__line--${line.kind}`} key={line.seq}>
          {line.text === '' ? ' ' : line.text}
        </div>
      ))}
    </div>
  );
}
