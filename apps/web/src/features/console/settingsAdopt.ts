/**
 * Which polled setting values the console is allowed to believe.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM, MEASURED. The bridge permanently forces two settings to 0 at
 * startup — `bridge/tenmol_bridge/engine.py:129-130` (invocation options) and
 * `:175-183` (`cmd.set` after start):
 *
 *     options.internal_gui = 0
 *     options.internal_feedback = 0
 *     ...
 *     self.cmd.set("internal_feedback", 0)
 *     self.cmd.set("movie_panel", 0)
 *
 * and it is right to: `OrthoReshape` subtracts the feedback band and
 * `MovieGetPanelHeight()` from the scene rectangle
 * (`layer1/Ortho.cpp:2383-2390`), so a non-zero `internal_feedback` makes
 * `cmd.get_viewport()` disagree with the browser canvas and every mouse
 * coordinate wrong (spike 04 §7.1). PyMOL's own in-viewport GUI is off because
 * the WEB CLIENT draws it now.
 *
 * So for those two, the value read back over the wire is a statement about the
 * BRIDGE's geometry, not about what the user asked for. Adopting it blindly
 * hides the in-viewport console permanently (`showLines = internal_feedback +
 * numOverlayLines`, `:1637-1642`) and kills the ENTER-on-empty-line movie
 * branch (`:966`).
 *
 * THE RULE. Adopt a boot-zeroed setting only when the value PyMOL reports
 * CHANGES. A first sample of 0 is the bridge's; a first sample of anything else
 * is the user's (a `.pymolrc`); and every later change — including a change
 * back to 0 — is the user's, so `set internal_feedback, 0` typed at the prompt
 * still works.
 *
 * Getting this wrong is not theoretical: an earlier version applied the rule
 * only to the FIRST poll, and the console went dark exactly one second after
 * connecting, when the second poll adopted the bridge's permanent 0.
 * ---------------------------------------------------------------------------
 */

import type { ConsoleSettingName, ConsoleSettings } from '@tenmol/protocol/topics/console';

/** The settings `engine.py` pins to 0 for viewport geometry. */
export const BRIDGE_ZEROED: readonly ConsoleSettingName[] = ['internal_feedback', 'movie_panel'];

export interface AdoptResult {
  /** What to merge into the console store. */
  patch: Partial<ConsoleSettings>;
  /** The remote snapshot to pass back as `previous` next time. */
  remote: Partial<ConsoleSettings>;
}

/**
 * @param previous the last remote snapshot, or `{}` on the first poll
 * @param values   `name -> value`, with `null` for a call that failed
 */
export function adoptSettings(
  previous: Partial<ConsoleSettings>,
  values: ReadonlyArray<readonly [ConsoleSettingName, number | null]>,
): AdoptResult {
  const patch: Partial<ConsoleSettings> = {};
  const remote: Partial<ConsoleSettings> = { ...previous };

  for (const [name, value] of values) {
    if (typeof value !== 'number') continue; // a failed call is not an answer
    const before = previous[name];
    remote[name] = value;
    if (BRIDGE_ZEROED.includes(name)) {
      if (before === undefined) {
        if (value === 0) continue; // the bridge's boot value: not the user's
      } else if (value === before) {
        continue; // unchanged: leave the client's value alone
      }
    }
    patch[name] = value;
  }

  return { patch, remote };
}
