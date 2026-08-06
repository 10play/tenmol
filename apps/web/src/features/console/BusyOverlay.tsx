/**
 * PyMOL's busy box, in DOM — `OrthoBusyDraw` (`packages/engine/layer1/Ortho.cpp:609-724`).
 *
 * 240x60, black, top-left of the viewport, a caption line and a progress bar,
 * shown only while `cmd.get_progress()` is non-negative.  Everything it can
 * and cannot say is argued in `./orthoOverlays.ts`; the short version is that
 * PyMOL's two bars and its `BusyMessage` caption are C-internal, so this draws
 * one bar and a caption of its own.
 *
 * WHY THIS EXISTS WHEN THE DOCK ALREADY HAS A BAR.  `QuickButtons` renders the
 * External GUI's progress row (`pymol_qt_gui.py:273-284`) with its Abort
 * button.  This is the OTHER one — the box PyMOL paints inside the viewport,
 * which is the only feedback a user gets when the dock is scrolled away or the
 * window is mostly viewport.  Both exist in the Qt build at once, for the same
 * reason both consoles do.
 *
 * WHEN `show_progress` IS READ, AND WHY NOT WHILE BUSY.  Measured on a live
 * bridge (`test_wf_ortho.py::test_a_plain_rpc_gets_no_answer_while_the_engine_is_busy`):
 * an ordinary `cmd.*` call issued 50 ms into a 0.7 s ray took ~0.6 s to answer,
 * because it needs `lock_api` and the ray holds it.  Asking for the setting at
 * the moment the bar appears would therefore answer after the job finished.
 * It is read at mount and again after each busy spell ends, both times with an
 * idle engine.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession, useStore } from '../../app';
import {
  BUSY_BAR,
  BUSY_BAR_WIDTH,
  BUSY_HEIGHT,
  BUSY_MARGIN,
  BUSY_SPACING,
  BUSY_WIDTH,
  busyFillWidth,
  busyVisible,
} from './orthoOverlays';

/** The viewport busy/progress bar, portaled over the canvas during long jobs. */
export function BusyOverlay() {
  const session = useSession();
  const progress = useStore(session.stores.connection, (s) => s.progress);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [showProgress, setShowProgress] = useState(true);

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.shell__viewport'));
  }, []);

  useEffect(() => {
    // Runs on mount and on every CHANGE of the pushed value, so the two idle
    // moments — before the first job and just after each one — are covered.
    if (progress >= 0) return; // never ask the engine while it is busy
    let alive = true;
    void session
      .call<number>('cmd.get_setting_int', ['show_progress'])
      .then((value) => {
        if (alive) setShowProgress(Number(value) !== 0);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session, progress]);

  if (!host || !busyVisible(progress, showProgress)) return null;

  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return createPortal(
    <div
      className="ortho-busy"
      data-testid="ortho-busy"
      role="progressbar"
      aria-label="PyMOL is busy"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={{ width: BUSY_WIDTH, height: BUSY_HEIGHT, padding: BUSY_MARGIN }}
      title="packages/engine/layer1/Ortho.cpp:609-724 — cmd.get_progress(), pushed on the `progress` topic"
    >
      {/* `I->BusyMessage` is C-internal (`OrthoBusyMessage`, `:530`), so this
          says what the client actually knows instead of inventing PyMOL's
          caption. */}
      <div className="ortho-busy__message" style={{ height: BUSY_SPACING }}>
        PyMOL busy — {percent}%
      </div>
      {/* ONE bar. `CmdGetProgress` folds the slow counter into the fast one
          before dividing (`packages/engine/layer4/Cmd.cpp:4334-4348`); the pair the box draws
          two bars from is not on the wire. */}
      <div
        className="ortho-busy__bar"
        style={{ width: BUSY_BAR_WIDTH, height: BUSY_BAR }}
        aria-hidden="true"
      >
        <div className="ortho-busy__fill" style={{ width: busyFillWidth(progress) }} />
      </div>
    </div>,
    host,
  );
}
