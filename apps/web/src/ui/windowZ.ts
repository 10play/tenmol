/**
 * One z-index allocator for every floating window in the app.
 *
 * WHY A SHARED COUNTER. Floating windows must stack above the seqview HUD
 * (z 20) and viewport HUD (z 10) — the exact bug `features/dialogs` documents,
 * where the Seq block covered a window's title bar and made its controls
 * unclickable. Each window writes its z INLINE (CSS can't override it), so the
 * numbers have to come from a single monotonic source or two windows opened by
 * two different features could tie and stack by DOM order instead of by which
 * the user last touched.
 *
 * The floor matches `features/dialogs/store.ts` (`WINDOW_Z_FLOOR = 30`) so the
 * shared `FloatingWindow` panels and the older dialog windows share one stack.
 */

/** The lowest z a floating window may take; clears the seqview HUD (20). */
export const WINDOW_Z_FLOOR = 30;

let top = WINDOW_Z_FLOOR;

/** Allocate the next (highest) z for a window being opened or raised. */
export function nextWindowZ(): number {
  top += 1;
  return top;
}

/** The current top-most z. */
export function topWindowZ(): number {
  return top;
}

/** Test-only: reset the counter so a suite starts from the floor. */
export function resetWindowZ(): void {
  top = WINDOW_Z_FLOOR;
}
