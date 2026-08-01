/**
 * The eleven mouse-mode matrices, the configuration rings and the display
 * names — mirrored from `modules/pymol/controlling.py`.
 *
 * GENERATED-BY-HAND-ONCE, CHECKED-BY-TEST-ALWAYS. `modes.test.ts` imports the
 * real `modules/pymol/controlling.py` through the bridge venv and diffs every
 * entry below against `mode_dict`, `ring_dict`, `mode_name_dict` and
 * `mode_name_list`. If upstream changes a binding, the test fails; it cannot
 * drift silently.
 *
 * WHY MIRROR AT ALL: there is no getter for the C `ButMode` table
 * (`ButModeGet` is not exposed to Python — grepped `modules/`), so the only way
 * to render the button x modifier grid is to reproduce what `cmd.mouse()`
 * pushed into it. Plan §A9 settles this as the intended design rather than a
 * workaround, and forbids adding a C++ accessor for it.
 *
 * Order is load-bearing in two places:
 *  * `MODE_NAME_LIST` — `cmd.mouse(name)` stores a mode outside the current
 *    ring as `button_mode = -1 - index` (`controlling.py:657-660`), so an
 *    insertion (as opposed to an append) renumbers saved sessions.
 *  * within a mode's rows — later `cmd.button` calls overwrite earlier ones.
 *    `three_button_motions` binds `double_left` twice (`controlling.py:398-399`,
 *    `menu` then `torf`) and `two_button_selecting` binds it twice as well
 *    (`:456-457`); the LAST one wins. That upstream quirk is reproduced here
 *    rather than tidied, because tidying it would make the client's grid
 *    disagree with what PyMOL actually does.
 */

/** `[button, modifier, action]`, exactly the tuple `cmd.button` takes. */
export type ButtonBinding = readonly [button: string, modifier: string, action: string];

export type ModeName =
  | 'three_button_lights'
  | 'three_button_viewing'
  | 'three_button_editing'
  | 'three_button_motions'
  | 'three_button_maestro'
  | 'two_button_viewing'
  | 'two_button_selecting'
  | 'two_button_editing'
  | 'two_button_lights'
  | 'one_button_viewing'
  | 'default';

export type RingName =
  | 'maestro'
  | 'three_button'
  | 'three_button_viewing'
  | 'three_button_editing'
  | 'two_button'
  | 'two_button_viewing'
  | 'two_button_editing'
  | 'three_button_motions'
  | 'three_button_all_modes'
  | 'one_button';

/** `controlling.py:234-548`. */
export const MODE_DICT: Readonly<Record<ModeName, readonly ButtonBinding[]>> = {
  three_button_lights: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'move'],
    ['r', 'none', 'movz'],
    ['l', 'shft', 'rotl'],
    ['m', 'shft', 'movl'],
    ['r', 'shft', 'mvzl'],
    ['l', 'ctrl', 'none'],
    ['m', 'ctrl', 'none'],
    ['r', 'ctrl', 'none'],
    ['l', 'ctsh', 'none'],
    ['m', 'ctsh', 'none'],
    ['r', 'ctsh', 'none'],
    ['l', 'alt', 'none'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['w', 'none', 'slab'],
    ['w', 'shft', 'movs'],
    ['w', 'ctrl', 'mvsz'],
    ['w', 'ctsh', 'movz'],
    ['double_left', 'none', 'none'],
    ['double_middle', 'none', 'none'],
    ['double_right', 'none', 'none'],
    ['single_left', 'none', 'none'],
    ['single_middle', 'none', 'cent'],
    ['single_right', 'none', 'menu'],
    ['single_left', 'alt', 'cent'],
  ],
  three_button_viewing: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'move'],
    ['r', 'none', 'movz'],
    ['l', 'shft', '+Box'],
    ['m', 'shft', '-Box'],
    ['r', 'shft', 'clip'],
    ['l', 'ctrl', 'move'],
    ['m', 'ctrl', 'pkat'],
    ['r', 'ctrl', 'pk1'],
    ['l', 'ctsh', 'Sele'],
    ['m', 'ctsh', 'orig'],
    ['r', 'ctsh', 'clip'],
    ['l', 'alt', 'move'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['w', 'none', 'slab'],
    ['w', 'shft', 'movs'],
    ['w', 'ctrl', 'mvsz'],
    ['w', 'ctsh', 'movz'],
    ['double_left', 'none', 'menu'],
    ['double_middle', 'none', 'none'],
    ['double_right', 'none', 'pkat'],
    ['single_left', 'none', '+/-'],
    ['single_middle', 'none', 'cent'],
    ['single_right', 'none', 'menu'],
    ['single_left', 'alt', 'cent'],
    ['single_left', 'ctrl', 'cent'],
  ],
  three_button_editing: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'move'],
    ['r', 'none', 'movz'],
    ['l', 'shft', 'roto'],
    ['m', 'shft', 'movo'],
    ['r', 'shft', 'mvoz'],
    ['l', 'ctrl', 'torf'],
    ['m', 'ctrl', '+/-'],
    ['r', 'ctrl', 'pktb'],
    ['l', 'ctsh', 'mova'],
    ['m', 'ctsh', 'orig'],
    ['r', 'ctsh', 'clip'],
    ['l', 'alt', 'move'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['w', 'none', 'slab'],
    ['w', 'shft', 'movs'],
    ['w', 'ctrl', 'mvsz'],
    ['w', 'ctsh', 'movz'],
    ['double_left', 'none', 'torf'],
    ['double_middle', 'none', 'drgm'],
    ['double_right', 'none', 'pktb'],
    ['single_left', 'none', 'pkat'],
    ['single_middle', 'none', 'cent'],
    ['single_right', 'none', 'menu'],
    ['single_left', 'alt', 'cent'],
    ['single_left', 'ctrl', 'cent'],
  ],
  three_button_motions: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'move'],
    ['r', 'none', 'movz'],
    ['l', 'shft', 'rotv'],
    ['m', 'shft', 'movv'],
    ['r', 'shft', 'mvvz'],
    ['l', 'ctrl', 'torf'],
    ['m', 'ctrl', 'pkat'],
    ['r', 'ctrl', 'pktb'],
    ['l', 'ctsh', 'mova'],
    ['m', 'ctsh', 'orig'],
    ['r', 'ctsh', 'clip'],
    ['l', 'alt', 'move'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['w', 'none', 'slab'],
    ['w', 'shft', 'movs'],
    ['w', 'ctrl', 'mvsz'],
    ['w', 'ctsh', 'movz'],
    ['double_left', 'none', 'menu'],
    ['double_left', 'none', 'torf'],
    ['double_middle', 'none', 'drgm'],
    ['double_right', 'none', 'pktb'],
    ['single_left', 'none', 'pkat'],
    ['single_middle', 'none', 'cent'],
    ['single_right', 'none', 'menu'],
    ['single_left', 'alt', 'cent'],
    ['single_left', 'ctrl', 'cent'],
  ],
  three_button_maestro: [
    ['l', 'none', 'box'],
    ['m', 'none', 'rota'],
    ['r', 'none', 'move'],
    ['l', 'shft', '+Box'],
    ['m', 'shft', '-Box'],
    ['r', 'shft', 'clip'],
    ['l', 'ctrl', '+/-'],
    ['m', 'ctrl', 'irtz'],
    ['r', 'ctrl', 'pk1'],
    ['l', 'ctsh', 'Sele'],
    ['m', 'ctsh', 'orig'],
    ['r', 'ctsh', 'clip'],
    ['l', 'alt', 'move'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['w', 'none', 'imvz'],
    ['w', 'shft', 'movs'],
    ['w', 'ctrl', 'none'],
    ['w', 'ctsh', 'slab'],
    ['double_left', 'none', 'menu'],
    ['double_middle', 'none', 'none'],
    ['double_right', 'none', 'pkat'],
    ['single_left', 'none', 'sele'],
    ['single_middle', 'none', 'cent'],
    ['single_right', 'none', 'menu'],
    ['single_left', 'shft', '+/-'],
    ['single_left', 'alt', 'cent'],
  ],
  two_button_viewing: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'none'],
    ['r', 'none', 'movz'],
    ['l', 'shft', 'pk1'],
    ['m', 'shft', 'none'],
    ['r', 'shft', 'clip'],
    ['l', 'ctrl', 'move'],
    ['m', 'ctrl', 'none'],
    ['r', 'ctrl', 'pkat'],
    ['l', 'ctsh', 'sele'],
    ['m', 'ctsh', 'none'],
    ['r', 'ctsh', 'cent'],
    ['l', 'alt', 'move'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['w', 'none', 'none'],
    ['w', 'shft', 'none'],
    ['w', 'ctrl', 'none'],
    ['w', 'ctsh', 'none'],
    ['double_left', 'none', 'menu'],
    ['double_middle', 'none', 'none'],
    ['double_right', 'none', 'cent'],
    ['single_left', 'none', 'pkat'],
    ['single_middle', 'none', 'none'],
    ['single_right', 'none', 'menu'],
    ['single_left', 'alt', 'cent'],
  ],
  two_button_selecting: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'none'],
    ['r', 'none', 'movz'],
    ['l', 'shft', '+Box'],
    ['m', 'shft', 'none'],
    ['r', 'shft', '-Box'],
    ['l', 'ctrl', '+/-'],
    ['m', 'ctrl', 'none'],
    ['r', 'ctrl', 'pkat'],
    ['l', 'ctsh', 'sele'],
    ['m', 'ctsh', 'none'],
    ['r', 'ctsh', 'cent'],
    ['l', 'alt', 'move'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['w', 'none', 'none'],
    ['w', 'shft', 'none'],
    ['w', 'ctrl', 'none'],
    ['w', 'ctsh', 'none'],
    ['double_left', 'none', 'menu'],
    ['double_left', 'none', 'menu'],
    ['double_middle', 'none', 'none'],
    ['double_right', 'none', 'cent'],
    ['single_left', 'none', '+/-'],
    ['single_right', 'none', 'menu'],
    ['single_left', 'alt', 'cent'],
  ],
  two_button_editing: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'none'],
    ['r', 'none', 'movz'],
    ['l', 'shft', 'pkat'],
    ['m', 'shft', 'none'],
    ['r', 'shft', 'clip'],
    ['l', 'ctrl', 'torf'],
    ['m', 'ctrl', 'none'],
    ['r', 'ctrl', 'pktb'],
    ['l', 'ctsh', 'rotf'],
    ['m', 'ctsh', 'none'],
    ['r', 'ctsh', 'movf'],
    ['l', 'alt', 'move'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['w', 'none', 'none'],
    ['w', 'shft', 'none'],
    ['w', 'ctrl', 'none'],
    ['w', 'ctsh', 'none'],
    ['double_left', 'none', 'menu'],
    ['double_middle', 'none', 'none'],
    ['double_right', 'none', 'cent'],
    ['single_left', 'none', 'pkat'],
    ['single_middle', 'none', 'none'],
    ['single_right', 'none', 'menu'],
    ['single_left', 'alt', 'cent'],
  ],
  two_button_lights: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'none'],
    ['r', 'none', 'movz'],
    ['l', 'shft', 'rotl'],
    ['m', 'shft', 'none'],
    ['r', 'shft', 'mvzl'],
    ['l', 'ctrl', 'movl'],
    ['m', 'ctrl', 'none'],
    ['r', 'ctrl', 'none'],
    ['l', 'ctsh', 'none'],
    ['m', 'ctsh', 'none'],
    ['r', 'ctsh', 'cent'],
    ['l', 'alt', 'none'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['w', 'none', 'none'],
    ['w', 'shft', 'none'],
    ['w', 'ctrl', 'none'],
    ['w', 'ctsh', 'none'],
    ['double_left', 'none', 'menu'],
    ['double_middle', 'none', 'none'],
    ['double_right', 'none', 'cent'],
    ['single_left', 'none', 'none'],
    ['single_middle', 'none', 'none'],
    ['single_right', 'none', 'menu'],
    ['single_left', 'alt', 'cent'],
  ],
  one_button_viewing: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'none'],
    ['r', 'none', 'none'],
    ['l', 'shft', '+Box'],
    ['m', 'shft', 'none'],
    ['r', 'shft', 'none'],
    ['l', 'ctrl', 'movZ'],
    ['m', 'ctrl', 'none'],
    ['r', 'ctrl', 'none'],
    ['l', 'ctsh', 'clip'],
    ['m', 'ctsh', 'none'],
    ['r', 'ctsh', 'none'],
    ['l', 'alt', 'move'],
    ['m', 'alt', 'none'],
    ['r', 'alt', 'none'],
    ['l', 'alsh', '-Box'],
    ['m', 'alsh', 'none'],
    ['r', 'alsh', 'none'],
    ['l', 'ctal', 'none'],
    ['m', 'ctal', 'none'],
    ['r', 'ctal', 'none'],
    ['l', 'ctas', 'none'],
    ['m', 'ctas', 'none'],
    ['r', 'ctas', 'none'],
    ['w', 'none', 'slab'],
    ['w', 'shft', 'movs'],
    ['w', 'ctrl', 'mvsz'],
    ['w', 'ctsh', 'movz'],
    ['double_left', 'none', 'menu'],
    ['double_middle', 'none', 'none'],
    ['double_right', 'none', 'none'],
    ['single_left', 'none', '+/-'],
    ['single_middle', 'none', 'none'],
    ['single_right', 'none', 'none'],
    ['single_left', 'shft', 'none'],
    ['single_left', 'ctrl', 'menu'],
    ['single_left', 'ctsh', 'pkat'],
    ['single_left', 'alt', 'cent'],
    ['single_left', 'alsh', 'none'],
    ['single_left', 'ctal', 'none'],
    ['single_left', 'ctas', 'none'],
  ],
  default: [
    ['l', 'none', 'rota'],
    ['m', 'none', 'move'],
    ['r', 'none', 'movz'],
    ['r', 'shft', 'clip'],
    ['m', 'ctsh', 'orig'],
    ['w', 'none', 'slab'],
    ['w', 'shft', 'movs'],
    ['w', 'ctrl', 'mvsz'],
    ['w', 'ctsh', 'movz'],
    ['double_middle', 'none', 'none'],
    ['single_middle', 'none', 'cent'],
  ],
};

/** `controlling.py:127-164`. The value of `cmd.config_mouse(ring)`. */
export const RING_DICT: Readonly<Record<RingName, readonly ModeName[]>> = {
  'maestro': ['three_button_maestro'],
  'three_button': ['three_button_viewing', 'three_button_editing'],
  'three_button_viewing': ['three_button_viewing', 'three_button_editing'],
  'three_button_editing': ['three_button_editing', 'three_button_viewing'],
  'two_button': ['two_button_viewing', 'two_button_selecting'],
  'two_button_viewing': ['two_button_viewing', 'two_button_selecting'],
  'two_button_editing': ['two_button_editing', 'two_button_viewing', 'two_button_selecting'],
  'three_button_motions': ['three_button_motions', 'three_button_viewing'],
  'three_button_all_modes': ['three_button_editing', 'three_button_motions', 'three_button_viewing', 'three_button_lights'],
  'one_button': ['one_button_viewing'],
};

/** The startup ring: `mouse_ring = ring_dict['three_button']` (`controlling.py:204`). */
export const DEFAULT_RING: RingName = 'three_button';

/** `controlling.py:206-217` — the string written to `button_mode_name`. */
export const MODE_NAME_DICT: Readonly<Record<string, string>> = {
  three_button_lights: '3-Button Lights',
  three_button_maestro: '3-Button Maestro',
  three_button_viewing: '3-Button Viewing',
  three_button_editing: '3-Button Editing',
  three_button_motions: '3-Button Motions',
  two_button_viewing: '2-Button Viewing',
  two_button_selecting: '2-Btn. Selecting',
  two_button_editing: '2-Button Editing',
  two_button_lights: '2-Button Lights',
  one_button_viewing: '1-Button Viewing',
};

/** `controlling.py:219-232`. Position is persisted state — append only. */
export const MODE_NAME_LIST: readonly ModeName[] = [
  'three_button_lights',
  'three_button_viewing',
  'three_button_editing',
  'three_button_motions',
  'three_button_maestro',
  'two_button_viewing',
  'two_button_selecting',
  'two_button_editing',
  'two_button_lights',
  'one_button_viewing',
  'default',
];
