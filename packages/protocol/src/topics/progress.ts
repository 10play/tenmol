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
 */

export interface ProgressPayload {
  /** 0..1, or -1 when nothing is running (`cmd.get_progress()` convention). */
  fraction: number;
  /** True while a long operation is in flight. */
  busy: boolean;
  /** Best-effort label ('ray', 'movie', ...). '' when unknown. */
  label: string;
  /** True when the operation exposes an abort path (`cmd.abort`-able). */
  abortable: boolean;
}
