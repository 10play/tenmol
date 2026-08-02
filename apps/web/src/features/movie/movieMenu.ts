/**
 * The Movie menu, ported node-for-node from `packages/engine/modules/pymol/_gui.py:234-375`.
 *
 * WHY IT IS PORTED RATHER THAN FETCHED. `PyMOLDesktopGUI.get_menudata()`
 * builds this tree out of Python **closures** (`lambda: self.mvprg(...)`,
 * `lambda i=i: cmd.movie.add_blank(i)`); a closure cannot cross the wire, and
 * the bridge has no `get_menudata` endpoint (that is WP-14's `menu` topic, and
 * it would still have to invent a serialisation for the lambdas). The three
 * kinds that DO serialise are reproduced exactly:
 *
 *   command  -> a command string, or a `{fn,args}` call
 *   check    -> a boolean setting toggle
 *   radio    -> a setting set to one value
 *
 * Every leaf below is the literal text and the literal command from `_gui.py`,
 * including the `179.99` that stands in for 180 in the rock menus and the
 * `%d` placeholder that `mvprg` fills with `get_movie_length()+1`.
 */

export interface MenuSeparator {
  kind: 'separator';
}
export interface MenuSubmenu {
  kind: 'menu';
  label: string;
  items: MovieMenuNode[];
}
/** A literal PyMOL command line, run through `cmd.do`. */
export interface MenuCommand {
  kind: 'command';
  label: string;
  command: string;
}
/** A typed call: `cmd.<fn>(...args)`. */
export interface MenuCall {
  kind: 'call';
  label: string;
  fn: string;
  args: readonly unknown[];
}
/**
 * A "last program" entry. `mvprg(command)` stores
 * `movie_start = get_movie_length()+1` and `movie_command = command % start`
 * before running it (`_gui.py:958-970`), which is what makes Update/Remove
 * Last Program possible. The `%d` is left in the template on purpose.
 */
export interface MenuProgram {
  kind: 'program';
  label: string;
  template: string;
}
export interface MenuCheck {
  kind: 'check';
  label: string;
  setting: string;
}
export interface MenuRadio {
  kind: 'radio';
  label: string;
  setting: string;
  value: number;
}
/** `('command', 'Update Last Program', self.mvprg)` — re-runs `movie_command`. */
export interface MenuProgramUpdate {
  kind: 'program-update';
  label: string;
}
/** `mvprg_remove_last` -> `cmd.mdelete(-1, movie_start)` (`_gui.py:950-955`). */
export interface MenuProgramRemove {
  kind: 'program-remove';
  label: string;
}

export type MovieMenuNode =
  | MenuSeparator
  | MenuSubmenu
  | MenuCommand
  | MenuCall
  | MenuProgram
  | MenuProgramUpdate
  | MenuProgramRemove
  | MenuCheck
  | MenuRadio;

/** Everything that is not a container. */
export type MovieMenuLeaf = Exclude<MovieMenuNode, MenuSeparator | MenuSubmenu>;

const sep: MenuSeparator = { kind: 'separator' };

const menu = (label: string, items: MovieMenuNode[]): MenuSubmenu => ({
  kind: 'menu',
  label,
  items,
});
const program = (label: string, template: string): MenuProgram => ({
  kind: 'program',
  label,
  template,
});

/** `_gui.py:235-238` — 14 durations, `cmd.movie.add_blank(i)`. */
export const APPEND_DURATIONS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 18, 24, 30, 48, 60] as const;

const appendMenu = menu(
  'Append',
  APPEND_DURATIONS.map<MenuCall>((seconds) => ({
    kind: 'call',
    label: `${seconds} second`,
    fn: 'movie.add_blank',
    args: [seconds],
  })),
);

/** `_gui.py:242-255` — 10 nutate entries with two separators. */
const nutateMenu = menu('Nutate', [
  program('15 deg. over 4 sec.', 'movie.add_nutate(4,15,start=%d)'),
  program('15 deg. over 8 sec.', 'movie.add_nutate(8,15,start=%d)'),
  program('15 deg. over 12 sec.', 'movie.add_nutate(12,15,start=%d)'),
  sep,
  program('30 deg. over 4 sec.', 'movie.add_nutate(4,30,start=%d)'),
  program('30 deg. over 8 sec.', 'movie.add_nutate(8,30,start=%d)'),
  program('30 deg. over 12 sec.', 'movie.add_nutate(12,30,start=%d)'),
  program('30 deg. over 16 sec.', 'movie.add_nutate(16,30,start=%d)'),
  sep,
  program('60 deg. over 8 sec.', 'movie.add_nutate(8,60,start=%d)'),
  program('60 deg. over 16 sec.', 'movie.add_nutate(16,60,start=%d)'),
  program('60 deg. over 24 sec.', 'movie.add_nutate(24,60,start=%d)'),
  program('60 deg. over 32 sec.', 'movie.add_nutate(32,60,start=%d)'),
]);

/** `_gui.py:258-278` / `:288-308` — the same 15 entries per axis. */
const ROCK_ROWS: readonly (readonly [string, number, readonly number[]])[] = [
  ['30', 30, [2, 4, 8]],
  ['60', 60, [4, 8, 16]],
  ['90', 90, [6, 12, 24]],
  ['120', 120, [8, 16, 32]],
  ['180', 179.99, [12, 24, 48]],
];

function rockMenu(axis: 'x' | 'y'): MenuSubmenu {
  const items: MovieMenuNode[] = [];
  ROCK_ROWS.forEach(([label, angle, durations], index) => {
    if (index > 0) items.push(sep);
    for (const seconds of durations) {
      items.push(
        program(
          `${label} deg. over ${seconds} sec.`,
          `movie.add_rock(${seconds},${angle},axis='${axis}',start=%d)`,
        ),
      );
    }
  });
  return menu(`${axis.toUpperCase()}-Rock`, items);
}

/** `_gui.py:279-284` — 4 durations per axis. */
function rollMenu(axis: 'x' | 'y'): MenuSubmenu {
  return menu(
    `${axis.toUpperCase()}-Roll`,
    [4, 8, 16, 32].map((seconds) =>
      program(`${seconds} seconds`, `movie.add_roll(${seconds.toFixed(1)},axis='${axis}',start=%d)`),
    ),
  );
}

const cameraLoopMenu = menu('Camera Loop', [
  nutateMenu,
  sep,
  rockMenu('x'),
  rollMenu('x'),
  sep,
  rockMenu('y'),
  rollMenu('y'),
]);

/** `_gui.py:318-330` — Nutate/X-Rock/Y-Rock share 12 entries; rock=4/2/1. */
const SCENE_LOOP_ANGLES: readonly (readonly [number, readonly number[]])[] = [
  [30, [2, 4, 8]],
  [60, [4, 8, 16]],
  [90, [6, 12, 24]],
  [120, [8, 16, 32]],
];

function sceneLoopMenu(label: string, rock: number): MenuSubmenu {
  const items: MovieMenuNode[] = [];
  for (const [angle, durations] of SCENE_LOOP_ANGLES) {
    for (const seconds of durations) {
      items.push(
        program(
          `${angle} deg. over ${seconds} sec.`,
          `set sweep_angle,${angle};cmd.movie.add_scenes(None, ${seconds}, rock=${rock}, start=%d)`,
        ),
      );
    }
  }
  return menu(label, items);
}

const sceneLoopSteady = menu(
  'Steady',
  [1, 2, 4, 8, 12, 16, 24].map((seconds) =>
    program(
      `${seconds} seconds each`,
      `movie.add_scenes(None,${seconds.toFixed(1)},rock=0,start=%d)`,
    ),
  ),
);

const sceneLoopsMenu = menu('Scene Loop', [
  sceneLoopMenu('Nutate', 4),
  sceneLoopMenu('X-Rock', 2),
  sceneLoopMenu('Y-Rock', 1),
  sceneLoopSteady,
]);

/** `_gui.py:341-353` — 6 speeds x 4 pauses, twice. */
const STATE_SPEEDS = [1, 2, 3, 4, 8, 16] as const;
const STATE_PAUSES = [0, 1, 2, 4] as const;

function stateMenu(label: string, fn: string): MenuSubmenu {
  return menu(
    label,
    STATE_SPEEDS.map((speed) =>
      menu(
        speed === 1 ? 'Full Speed' : `1/${speed} Speed`,
        STATE_PAUSES.map((pause) =>
          program(
            pause ? `${pause} second pause` : 'no pause',
            `${fn}(${speed}, ${pause}, start=%d)`,
          ),
        ),
      ),
    ),
  );
}

const programMenu = menu('Program', [
  cameraLoopMenu,
  sep,
  sceneLoopsMenu,
  sep,
  stateMenu('State Loop', 'movie.add_state_loop'),
  stateMenu('State Sweep', 'movie.add_state_sweep'),
]);

/** `_gui.py:356-364` — 5 radios plus the meter. */
const frameRateMenu = menu('Frame Rate', [
  { kind: 'radio', label: '30 FPS', setting: 'movie_fps', value: 30 },
  { kind: 'radio', label: '15 FPS', setting: 'movie_fps', value: 15 },
  { kind: 'radio', label: '5 FPS', setting: 'movie_fps', value: 5 },
  { kind: 'radio', label: '1 FPS', setting: 'movie_fps', value: 1 },
  { kind: 'radio', label: '0.3 FPS', setting: 'movie_fps', value: 0.3 },
  sep,
  { kind: 'check', label: 'Show Frame Rate', setting: 'show_frame_rate' },
  { kind: 'call', label: 'Reset Meter', fn: 'meter_reset', args: [] },
]);

/** The whole `('menu','Movie',[...])` node. */
export const MOVIE_MENU: readonly MovieMenuNode[] = [
  appendMenu,
  sep,
  programMenu,
  { kind: 'program-update', label: 'Update Last Program' },
  { kind: 'program-remove', label: 'Remove Last Program' },
  sep,
  { kind: 'command', label: 'Reset', command: 'mset;rewind' },
  sep,
  frameRateMenu,
  sep,
  { kind: 'check', label: 'Auto Interpolate', setting: 'movie_auto_interpolate' },
  { kind: 'check', label: 'Show Panel', setting: 'movie_panel' },
  { kind: 'check', label: 'Loop Frames', setting: 'movie_loop' },
  { kind: 'check', label: 'Draw Frames', setting: 'draw_frames' },
  { kind: 'check', label: 'Ray Trace Frames', setting: 'ray_trace_frames' },
  { kind: 'check', label: 'Cache Frame Images', setting: 'cache_frames' },
  { kind: 'call', label: 'Clear Image Cache', fn: 'mclear', args: [] },
  sep,
  { kind: 'check', label: 'Static Singletons', setting: 'static_singletons' },
  { kind: 'check', label: 'Show All States', setting: 'all_states' },
];

/** Count every leaf of a tree — the shape assertion the tests lean on. */
export function countLeaves(nodes: readonly MovieMenuNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.kind === 'menu') total += countLeaves(node.items);
    else if (node.kind !== 'separator') total += 1;
  }
  return total;
}

/** Depth-first flatten, separators dropped. Used by the tests and the search. */
export function flattenMenu(
  nodes: readonly MovieMenuNode[],
  path: readonly string[] = [],
): { path: string[]; node: MovieMenuLeaf }[] {
  const out: { path: string[]; node: MovieMenuLeaf }[] = [];
  for (const node of nodes) {
    if (node.kind === 'separator') continue;
    if (node.kind === 'menu') {
      out.push(...flattenMenu(node.items, [...path, node.label]));
      continue;
    }
    out.push({ path: [...path], node });
  }
  return out;
}
