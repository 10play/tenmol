/**
 * D1 — `bg_color` repaints the live viewport.
 *
 * The Mode-G renderer has always had a clear colour, but nothing in the web app
 * wired the engine's `bg_rgb` setting to it, so `bg_color white` ran with no
 * error and the interactive canvas stayed black (only the ray path went white).
 *
 * These tests exercise the wiring the fix adds (`viewportBackground.ts`): once
 * the engine reports `bg_rgb` white, the viewport handle's `setBackground` is
 * invoked with `[1, 1, 1]`; an unchanged `bg_rgb` does not repaint again; a
 * float3 (real PyMOL) is taken directly; an unresolvable colour stays `null`.
 *
 * The React hook is driven from a real component mount so this is a genuine
 * integration test of the subscription, spying the viewport handle it drives.
 * (The `@tenmol/viewport` package itself is not imported — jsdom has no WebGL,
 * and the wiring is deliberately decoupled from the handle's concrete type.)
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveBackgroundRgb,
  useViewportBackground,
  type BackgroundSession,
  type BackgroundTarget,
} from './viewportBackground';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A viewport handle whose only relevant surface is `setBackground`. */
function target(): BackgroundTarget & { setBackground: ReturnType<typeof vi.fn> } {
  return { setBackground: vi.fn() };
}

/**
 * An engine whose `bg_rgb` is a colour reference (index 0 = white), exactly the
 * shape engine-ts returns: `get_setting_tuple('bg_rgb') -> [5, [0]]` and
 * `get_color_tuple(0) -> [1, 1, 1]`.
 */
function engine(bg: [number, unknown[]] = [5, [0]]): BackgroundSession & {
  call: ReturnType<typeof vi.fn>;
} {
  const state = { bg };
  const call = vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (fn === 'cmd.get_setting_tuple') return state.bg;
    if (fn === 'cmd.get_color_tuple') return (args[0] as number) === 0 ? [1, 1, 1] : null;
    return null;
  });
  return { conn: { isOpen: true }, call: call as unknown as BackgroundSession['call'] } as never;
}

/** A probe component that arms the subscription against `session`/`handle`. */
function Probe({
  session,
  handle,
}: {
  session: BackgroundSession;
  handle: BackgroundTarget;
}): null {
  useViewportBackground(session, () => handle);
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** Flush microtasks so the async `apply()` settles, without firing a timer. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('D1 — bg_rgb repaints the live viewport', () => {
  it('calls setBackground([1,1,1]) once the engine reports bg_rgb white', async () => {
    const session = engine();
    const handle = target();
    act(() => root.render(<Probe session={session} handle={handle} />));
    await flush();

    expect(handle.setBackground).toHaveBeenCalledWith([1, 1, 1]);
  });

  it('does not repaint again while bg_rgb is unchanged', async () => {
    const session = engine();
    const handle = target();
    act(() => root.render(<Probe session={session} handle={handle} />));
    await flush();
    expect(handle.setBackground).toHaveBeenCalledTimes(1);

    // A poll tick with the same bg_rgb must not re-apply the colour.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flush();
    expect(handle.setBackground).toHaveBeenCalledTimes(1);
  });

  it('resolves a float3 bg_rgb (real PyMOL) directly to 0..1 RGB', async () => {
    const call = vi.fn() as unknown as BackgroundSession['call'];
    await expect(resolveBackgroundRgb(call, [0.25, 0.5, 0.75])).resolves.toEqual([
      0.25, 0.5, 0.75,
    ]);
    expect(call).not.toHaveBeenCalled(); // no get_color_tuple for a float3
  });

  it('resolves an unset/inline colour to null (keeps the black composite)', async () => {
    const call = vi.fn(async () => null) as unknown as BackgroundSession['call']; // get_color_tuple: no entry
    await expect(resolveBackgroundRgb(call, [1073741824])).resolves.toBeNull();
  });
});
