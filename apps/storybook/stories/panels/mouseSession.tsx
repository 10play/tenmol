/**
 * A per-story session that answers the four settings reads {@link useMouseMode}
 * issues on mount, so the {@link MouseConfigPanel} renders its POPULATED 80-slot
 * matrix instead of a wall of "(unset)" cells.
 *
 * The hook derives the whole grid from `button_mode_name` (the only
 * authoritative signal PyMOL exposes — see the hook's header). The base stub
 * `call()` returns `null` for every fn, so `button_mode_name` comes back null,
 * `modeFromDisplayName(null)` yields `null`, and the table falls to all -1.
 * This decorator instead reports a live 3-Button Viewing session — the engine's
 * own default mode — so `tableForMode('three_button_viewing')` fills the cells
 * with real action bindings (Rota, Move, RotZ, Sele, …). Nothing here reaches a
 * bridge; it is the exact shape an idle engine in that mode would return.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** The settings an engine sitting in its default 3-Button Viewing mode reports. */
const MOUSE_SETTINGS: Record<string, unknown> = {
  button_mode_name: '3-Button Viewing',
  button_mode: 1,
  mouse_selection_mode: 1,
  mouse_grid: 1,
};

/** Answer the `get_setting_*` reads the mouse hook makes; null for anything else. */
function mouseCall(fn: string, args?: readonly unknown[]): unknown {
  if (fn === 'get_setting_text' || fn === 'get_setting_int' || fn === 'get_setting_boolean') {
    const key = args?.[0] as string;
    return MOUSE_SETTINGS[key] ?? null;
  }
  return null;
}

/** Wrap a story in a session that reports a live 3-Button Viewing mouse mode. */
export const withMouseMode: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string, args?: readonly unknown[]) =>
      Promise.resolve(mouseCall(fn, args))) as Session['call'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
