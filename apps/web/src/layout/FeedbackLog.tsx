import { useEffect, useRef } from 'react';
import { useBridge } from '../bridge/BridgeContext';

/**
 * Feedback / output scrollback.
 *
 * Qt: a read-only `QPlainTextEdit` named `feedback_browser`
 * (packages/engine/modules/pmg_qt/pymol_qt_gui.py:122-124), monospace, appended from
 * `cmd._get_feedback()` on a 500 ms timer (:941-958).
 *
 * Here the timer is gone: the bridge pushes `{ t:'feedback', lines:[...] }` frames.
 *
 * Auto-scroll is sticky-to-bottom: it only follows when the user is already at the
 * bottom, so scrolling back to read output is not yanked away by new lines.
 *
 * TODO(color): PyMOL emits `\\933`-style colour escapes (packages/engine/modules/pymol/menu.py:21-23);
 * `colorprinting.text2html` (packages/engine/modules/pymol/colorprinting.py:17) does NOT translate
 * them today, so lines can contain raw escapes. Decide whether to render them.
 */
export function FeedbackLog() {
  const bridge = useBridge();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [bridge.feedback]);

  return (
    <div
      className="feedback"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
      }}
    >
      {bridge.feedback.map((line, i) => (
        <div className="feedback__line" key={i}>
          {line === '' ? ' ' : line}
        </div>
      ))}
    </div>
  );
}
