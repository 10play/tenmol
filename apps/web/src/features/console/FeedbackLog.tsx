/**
 * The output pane.
 *
 * Qt: a read-only `QPlainTextEdit` named `feedback_browser`
 * (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:122-124`), monospace, appended from
 * `cmd._get_feedback()` on a 500 ms timer (`:941-958`). Here the timer is gone —
 * the bridge pushes `{t:'feedback', lines:[...]}` from its 10 Hz status thread.
 *
 * Four things this pane must get right, all of them from measurements:
 *
 *  1. WINDOWING, NOT VIRTUALISATION. The store keeps 5,000 lines; rendering
 *     5,000 DOM nodes on every push is what makes a console feel broken. Only
 *     the last `WINDOW` lines are mounted, with a "showing last N" affordance to
 *     lift the limit — no measuring, no absolute positioning, no scroll jank.
 *  2. STICKY AUTOSCROLL. Follow the tail only when already at the tail, so
 *     scrolling back to read is never yanked away (`ui.followOutput`).
 *  3. SELECTABLE, MONOSPACE, PRESERVED WHITESPACE. PyMOL output is aligned with
 *     spaces (`" count_atoms: 10 atoms"`, ray timing tables) and users copy it.
 *  4. THE FOCUS PROXY. `setFocusProxy(self.lineedit)` (`pymol_qt_gui.py:126`)
 *     makes a click on the output land in the command line, and the proxy is
 *     CLEARED while text is selected so Ctrl+C copies instead of typing
 *     (`:960-975`, `selectionChanged`). Reproduced below with a real selection
 *     check, because a browser has no focus proxy: focus the input on mouseup
 *     only when the click left no selection behind.
 *
 * Long lines are hard-split by PyMOL itself at ~1018 chars regardless of
 * `wrap_output` (`OrthoLineLength` fail-safe, `packages/engine/layer1/Ortho.cpp:1099-1104`), and
 * `wrap_output` itself is applied server-side before the line is queued (see
 * `@tenmol/protocol/topics/console`), so one feedback entry is NOT always one
 * logical line — hence no line numbering, and hence `white-space: pre` rather
 * than any CSS wrapping that would fight PyMOL's own.
 *
 * ANSI: `OrthoFeedbackOut` (`packages/engine/layer1/Ortho.cpp:1148-1150`) strips escapes unless
 * `colored_feedback` is on, so with it on the escapes arrive here intact —
 * verified: `print("\\033[31mRED\\033[0m")` gives `"RED"` at 0 and the raw
 * escapes at 1. Colouring them is this component's job.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ansiColorCss,
  hasAnsiEscapes,
  parseAnsi,
  stripAnsiEscapes,
} from '@tenmol/protocol/topics/console';
import { useSession, useStore } from '../../app';
import { getConsoleSource } from './consoleSource';

const WINDOW = 1200;

/** The console output pane: renders feedback lines with ANSI colour and follow. */
export function FeedbackLog() {
  const session = useSession();
  const lines = useStore(session.stores.feedback, (s) => s.lines);
  const evicted = useStore(session.stores.feedback, (s) => s.evicted);
  const fontSize = useStore(session.stores.ui, (s) => s.consoleFontSize);
  const follow = useStore(session.stores.ui, (s) => s.followOutput);
  const colored = useStore(getConsoleSource().store, (s) => s.settings.colored_feedback > 0);

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
      className="feedback modern:px-3 modern:py-2 modern:leading-[1.55] modern:font-mono modern:text-pm-text modern:bg-[var(--sh-console-bg)]"
      ref={ref}
      style={{ fontSize }}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 6;
      }}
      onMouseUp={() => {
        // The focus proxy (see the header): only when nothing was selected.
        const selection = globalThis.getSelection?.();
        if (selection && !selection.isCollapsed && selection.toString() !== '') return;
        document.getElementById('command_line')?.focus();
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
          <FeedbackText text={line.text} colored={colored} />
        </div>
      ))}
    </div>
  );
}

/**
 * One line. Plain text is returned as a bare string so the overwhelmingly
 * common case allocates no spans at all; only a line that really carries
 * escapes goes through the SGR parser.
 */
function FeedbackText({ text, colored }: { text: string; colored: boolean }) {
  const spans = useMemo(() => {
    if (!hasAnsiEscapes(text)) return null;
    return colored ? parseAnsi(text) : null;
  }, [text, colored]);

  if (spans === null) {
    const clean = hasAnsiEscapes(text) ? stripAnsiEscapes(text) : text;
    return <>{clean === '' ? ' ' : clean}</>;
  }
  return (
    <>
      {spans.map((span, i) => (
        <span
          key={i}
          style={{
            color: span.fg === null ? undefined : (ansiColorCss(span.fg) ?? undefined),
            background: span.bg === null ? undefined : (ansiColorCss(span.bg) ?? undefined),
            fontWeight: span.bold ? 700 : undefined,
            opacity: span.dim ? 0.6 : undefined,
            fontStyle: span.italic ? 'italic' : undefined,
            textDecoration: span.underline ? 'underline' : undefined,
            filter: span.inverse ? 'invert(1)' : undefined,
          }}
        >
          {span.text}
        </span>
      ))}
    </>
  );
}
