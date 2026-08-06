/**
 * Help ▸ About PyMOL.
 *
 * `QtWidgets.QMessageBox.about(self, "About PyMOL", '\n'.join(msg))` with the
 * exact message list of `packages/engine/modules/pmg_qt/pymol_qt_gui.py:899-916`. The version
 * string is `cmd.get_version()[0]` (`packages/engine/modules/pymol/querying.py:603`), read from
 * the live engine.
 *
 * There is NO Qt splash to reproduce: `options.show_splash` only queues
 * `cmd.splash(1)` as a deferred command drawn in PyMOL's own ortho layer
 * (`packages/engine/layer5/PyMOL.cpp:1954`), so it arrives through the viewport, not here.
 */

import { useEffect, useRef } from 'react';

/** The Help ▸ About PyMOL modal dialog showing version and credit lines. */
export function AboutDialog({ lines, onClose }: { lines: string[]; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="about__scrim" role="presentation" onMouseDown={onClose}>
      <div
        className="about"
        role="dialog"
        aria-modal="true"
        aria-label="About PyMOL"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="about__title">About PyMOL</div>
        <div className="about__body">
          {lines.map((line, index) => (
            <div className="about__line" key={index}>
              {line === '' ? ' ' : line}
            </div>
          ))}
        </div>
        <button type="button" className="about__ok" onClick={onClose} ref={ref}>
          OK
        </button>
      </div>
    </div>
  );
}
