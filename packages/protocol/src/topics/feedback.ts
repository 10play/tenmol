/**
 * Topic `feedback` — console output.  OWNER: WP-03.
 *
 * Drained from `cmd._get_feedback()` (`packages/engine/modules/pymol/internal.py:596-606`) on
 * the 10 Hz status thread. Append-only: reading the queue DESTROYS it, so lines
 * are never coalesced and never dropped.
 *
 * Severity is heuristic and tagged `inferred` at the boundary —
 * `packages/engine/modules/pymol/colorprinting.py` assigns `error`, `warning`, `suggest` and
 * `parrot` all directly to `print`, so severity is gone before the string
 * reaches the Ortho queue (plan §1.2).
 */

export const FEEDBACK_SEVERITIES = ['error', 'warning', 'suggest', 'info'] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

export interface FeedbackLine {
  text: string;
  severity: FeedbackSeverity;
  /** Always true in v1: severity is reconstructed from the text, not carried. */
  inferred: boolean;
}

export interface FeedbackPayload {
  /** Raw lines, in order. Same shape as the top-level `{t:'feedback'}` frame. */
  lines: string[];
  /** Optional enrichment; when absent the client classifies client-side. */
  classified?: FeedbackLine[];
}
