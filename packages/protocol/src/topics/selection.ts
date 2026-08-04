/**
 * Topic `selection` — named selections and the active pick.  OWNER: WP-10.
 *
 * `counts` is NOT produced by the 30 Hz tick: `cmd.count_atoms()` is 5,902 us
 * for a selection at 500k atoms — 18 % of a 30 Hz budget and the only call in
 * the poll set that scales (plan §1.5). It is a debounced client request ~150 ms
 * after the names/enabled diff settles.
 *
 * Picking is BACKEND-AUTHORITATIVE (plan §1.4): the client forwards
 * button/drag 1:1 and renders whatever the backend decided. A client-side
 * raycast is never a source of truth.
 */

export interface SelectionPayload {
  /** `cmd.get_names('selections')`. */
  names: string[];
  /** selection name -> atom count. Present only on a debounced count request. */
  counts?: Record<string, number>;
  /** `cmd.get_names('selections', enabled_only=1)`. */
  enabled?: string[];
  /** The most recent `cmd.get_click_string()` result, or null. */
  lastClick?: string | null;
}
