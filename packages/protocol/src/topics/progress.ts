/**
 * Topic `progress` — busy indicator.  OWNER: WP-03.
 *
 * `cmd.get_progress()` on the 10 Hz status thread. Measured (plan §1.1, spike
 * 05 §6): it returns in 0.0-0.1 ms *during* a 4.3 s `cmd.ray()` and produced
 * real fractions (0.25 -> 0.386 -> 0.440 -> 0.495 -> 0.577 -> 0.734), while
 * `cmd.get_names()` from the same probe blocked for 3,808.8 ms.
 *
 * It is therefore the ONLY liveness signal available while PyMOL is busy, and
 * the UI busy indicator is built on it and on nothing else.
 *
 * THIS TYPE WAS A WORK OF FICTION UNTIL WAVE 10, and it is worth recording
 * why, because it is the failure mode a declared-but-unowned protocol type
 * has. The bridge emitted `{value: <float>}` and this file declared
 * `{fraction, busy, label, abortable}` — FOUR fields, ZERO of them the one
 * actually on the wire. Anything reading `payload.fraction` got `undefined`;
 * the only reason the bar ever moved is that `apps/web/src/app/session.ts`
 * read both names defensively and left a comment saying the type was wrong.
 * `BridgeServer._on_status` now emits this shape, mirrored by
 * `tenmol_bridge/session.py: progress_payload`, and
 * `bridge/tests/test_p10_infra.py` asserts the exact key set on the wire.
 *
 * `label` IS GONE and was not replaced. The busy text lives in
 * `I->BusyMessage` and nothing exports it: `cmd.get_busy` does not exist on
 * this build (measured — `hasattr(cmd, 'get_busy')` is False while
 * `hasattr(pymol._cmd, 'get_busy')` is True, and the C one answers a FLAG, not
 * a string). A field that is permanently `''` is a worse contract than no
 * field, because a UI writes `{label || 'working'}` and the branch is dead.
 */

export interface ProgressPayload {
  /** 0..1, or -1 when nothing is running (`cmd.get_progress()` convention). */
  fraction: number;
  /**
   * `fraction >= 0`. Qt spells the same predicate
   * `int(cmd.get_progress() * 100) >= 0` (`pymol_qt_gui.py:931-939`); idle is
   * exactly `-1.0`, so the two never disagree.
   */
  busy: boolean;
  /**
   * True when the operation exposes an abort path. Equal to `busy` on this
   * backend, and that is a fact about the backend rather than a redundant
   * field: `cmd.interrupt` is "asynch -- no locking"
   * (`modules/pymol/locking.py:88`), so it lands even while the engine thread
   * is inside the C++ call being reported on.
   */
  abortable: boolean;
}
