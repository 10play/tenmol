/**
 * D1 — reflect the engine's `bg_rgb` setting on the live viewport.
 *
 * WHY THIS EXISTS. The Mode-G renderer has always supported a background clear
 * colour (`packages/viewport/src/modeG/renderer.ts` `setBackground`, exposed as
 * `viewport.setBackground`), and the ray path already honours `bg_rgb`
 * (`engine-ts/src/cmd/render.ts`). But nothing in the web app wired the setting
 * to the interactive canvas: the renderer starts at `null` and no subscription
 * updated it, so `bg_color white` ran with no error and the live viewport stayed
 * black. This hook is that missing wire.
 *
 * WHY A POLL, not the settings tap. There is no push feed for `bg_rgb` on the
 * default (`?backend=local`) backend: the settings tap (`shell/settingsTap.ts`)
 * is a bridge-only Python module that never installs on the in-browser engine,
 * and its `watch()` only reports `values[0]` anyway — no use for a 3-float
 * colour. So, exactly like the ortho console's setting poll
 * (`features/console/consoleSource.ts`), this re-reads `bg_rgb` on mount and on a
 * modest interval, and repaints only when the value actually changes. This works
 * identically on both backends.
 */

import { useEffect } from 'react';

/** The minimum a viewport handle must expose for this hook (structural). */
export interface BackgroundTarget {
  setBackground(background: readonly [number, number, number] | null): void;
}

/** The slice of the session this hook needs — a raw call and the socket state. */
export interface BackgroundSession {
  call<T = unknown>(fn: string, args?: readonly unknown[]): Promise<T>;
  conn: { isOpen: boolean };
}

/**
 * How often the viewport re-reads `bg_rgb`. 250 ms is well under the console's
 * 1 Hz setting poll and comfortably under the audit's 500 ms settle, so a
 * `bg_color` typed at the prompt repaints promptly. `get_setting_tuple` is
 * cheap; the follow-up `get_color_tuple` only fires when the value changed.
 */
export const BG_RGB_POLL_MS = 250;

const isRgb = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === 'number');

/**
 * Resolve a `bg_rgb` setting VALUE-TUPLE (`get_setting_tuple(...)[1]`) to a 0..1
 * `[r, g, b]`, or `null` when it does not resolve (unset / inline colour) —
 * `null` keeps the renderer compositing over the Mode-P canvas, the current
 * (black) behaviour.
 *
 * `bg_rgb` is a colour REFERENCE, so this mirrors the engine's ray path
 * (`engine-ts/src/cmd/render.ts` `rgbForIndex`): `get_color_tuple` turns the
 * colour index into RGB. Real PyMOL reports `bg_rgb` as a `float3` instead — the
 * three floats are already 0..1 — so a 3-value tuple is taken directly.
 */
export async function resolveBackgroundRgb(
  call: <T = unknown>(fn: string, args?: readonly unknown[]) => Promise<T>,
  values: readonly unknown[],
): Promise<readonly [number, number, number] | null> {
  // Real PyMOL: `[cSetting_float3, [r, g, b]]` — already 0..1.
  if (isRgb(values)) return [values[0], values[1], values[2]];
  // engine-ts: `[cSetting_color, [colourIndex]]` — resolve like the ray path.
  const raw = values[0];
  if (typeof raw !== 'number') return null;
  const rgb = await call<unknown>('cmd.get_color_tuple', [raw]).catch(() => null);
  return isRgb(rgb) ? [rgb[0], rgb[1], rgb[2]] : null;
}

/**
 * Read `bg_rgb` now and hand the resolved colour to `target.setBackground`, but
 * only when it differs from `lastRaw`. Returns the raw key to remember for the
 * next call (so `get_color_tuple` is skipped while the value is unchanged).
 */
export async function applyBackgroundOnce(
  session: BackgroundSession,
  target: BackgroundTarget,
  lastRaw: string | null,
): Promise<string | null> {
  if (!session.conn.isOpen) return lastRaw;
  const tuple = await session
    .call<[number, unknown[]]>('cmd.get_setting_tuple', ['bg_rgb'])
    .catch(() => null);
  if (!Array.isArray(tuple) || !Array.isArray(tuple[1])) return lastRaw;
  const values = tuple[1];
  const rawKey = JSON.stringify(values);
  if (rawKey === lastRaw) return lastRaw; // unchanged since the last read — no repaint
  const rgb = await resolveBackgroundRgb((fn, args) => session.call(fn, args), values);
  target.setBackground(rgb);
  return rawKey;
}

/**
 * The subscription itself, framework-agnostic so it can be unit-tested without a
 * WebGL context. `getTarget` is late-bound because the viewport handle is
 * created in a sibling effect; a tick before it exists is a harmless no-op.
 * Returns a teardown.
 */
export function startBackgroundSync(
  session: BackgroundSession,
  getTarget: () => BackgroundTarget | null,
  setInterval_: typeof setInterval = setInterval,
  clearInterval_: typeof clearInterval = clearInterval,
): () => void {
  // D1.bg-color: bg_rgb -> viewport.setBackground (BROKEN-MAP.md defect 1).
  let cancelled = false;
  let lastRaw: string | null = null;
  const tick = async (): Promise<void> => {
    const target = getTarget();
    if (target === null) return;
    const next = await applyBackgroundOnce(session, target, lastRaw);
    // A tick whose `await` was in flight when teardown flipped `cancelled` must
    // not mutate state that outlives the subscription: bail before stashing
    // `lastRaw` for a poll that will never fire again.
    if (cancelled) return;
    lastRaw = next;
  };
  void tick();
  const timer = setInterval_(() => void tick(), BG_RGB_POLL_MS);
  return () => {
    cancelled = true;
    clearInterval_(timer);
  };
}

/**
 * React binding for {@link startBackgroundSync}. Runs once for the life of the
 * viewport (the handle is stable, so the effect has no changing deps).
 */
export function useViewportBackground(
  session: BackgroundSession,
  getTarget: () => BackgroundTarget | null,
): void {
  // `getTarget` is a fresh closure each render but only reads a ref, so it is
  // deliberately omitted from the deps; including it would re-arm the poll every
  // render. (This repo's eslint config does not enable react-hooks/exhaustive-deps,
  // so no disable directive is used — one would error as an unknown rule.)
  useEffect(() => startBackgroundSync(session, getTarget), [session]);
}
