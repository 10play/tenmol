/**
 * The ButMode table: 57 actions, 80 slots, and the resolution PyMOL performs on
 * every press.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A BRIDGE CALL. `ButModeGet`/`ButModeTranslate`
 * exist in C (`packages/engine/layer1/ButMode.h:225`, `packages/engine/layer1/ButMode.cpp:603`) and are **not**
 * exposed to Python — grepped `packages/engine/modules/`, only the write path `cmd.button`
 * (`packages/engine/modules/pymol/controlling.py:799-868`) exists. Plan §A9 settles this: the
 * authoritative binding table is the PYTHON one (`controlling.mode_dict`,
 * `mouse_ring`, `mode_name_dict`), applied via `cmd.button()`, with the current
 * mode read from `cmd.get('button_mode')` / `cmd.get('button_mode_name')`. No
 * C++ accessor is added. So the client mirrors `mode_dict` (`./modes.ts`),
 * expands it into the same 80 slots the C core keeps, and resolves it with the
 * same arithmetic — which is what lets the ButMode block render the grid and
 * the "Picking Atoms (and Joints)" line without a new endpoint.
 *
 * The mirror is not trusted blindly: `butmode.test.ts` and `modes.test.ts`
 * diff every table here against the real `packages/engine/modules/pymol/controlling.py` and
 * `packages/engine/layer1/ButMode.cpp` in the tree.
 *
 * WRITES STILL GO TO PYTHON. `cmd.button(button, modifier, action)` owns the
 * bit-packing and the `Shortcut` abbreviation matcher; `buttonSlot()` below is
 * a mirror used to *render* and to test, never a substitute for the call.
 */

/* ------------------------------------------------------------------ *
 * Action codes — `packages/engine/layer1/ButMode.h:23-113`, names `controlling.py:57-123`
 * ------------------------------------------------------------------ */

/** `cButModeNothing` (`packages/engine/layer1/ButMode.h:23`) — the slot is unbound. */
export const BUT_MODE_NOTHING = -1;

/** Action name (as `cmd.button` spells it, lower-cased) -> action code. */
export const BUT_ACT_CODE: Readonly<Record<string, number>> = {
  rota: 0,
  move: 1,
  movz: 2,
  clip: 3,
  rotz: 4,
  clpn: 5,
  clpf: 6,
  lb: 7,
  mb: 8,
  rb: 9,
  '+lb': 10,
  '+mb': 11,
  '+rb': 12,
  pkat: 13,
  pkbd: 14,
  rotf: 15,
  torf: 16,
  movf: 17,
  orig: 18,
  '+lbx': 19,
  '-lbx': 20,
  lbbx: 21,
  none: 22,
  cent: 23,
  pktb: 24,
  slab: 25,
  movs: 26,
  pk1: 27,
  mova: 28,
  menu: 29,
  sele: 30,
  '+/-': 31,
  '+box': 32,
  '-box': 33,
  mvsz: 34,
  clik: 35,
  dgrt: 36,
  dgmv: 37,
  dgmz: 38,
  roto: 39,
  movo: 40,
  mvoz: 41,
  mvfz: 42,
  mvaz: 43,
  drgm: 44,
  rotv: 45,
  movv: 46,
  mvvz: 47,
  // 48 = cButModePotentialClick, internal only (no Python name)
  drgo: 49,
  imsz: 50,
  imvz: 51,
  box: 52,
  irtz: 53,
  rotl: 54,
  movl: 55,
  mvzl: 56,
};

/** `cButModeCount` (`packages/engine/layer1/ButMode.h:107`). */
export const BUT_MODE_COUNT = 57;

/**
 * The 5-character on-screen label of every action code, byte for byte as
 * `ButModeInit` writes it (`packages/engine/layer1/ButMode.cpp:500-555`). The trailing space is
 * part of the label: the block draws the four columns by concatenation
 * (`ButMode.cpp:249-260`), so trimming it silently narrows the grid.
 *
 * Code 48 (`cButModePotentialClick`) never reaches the grid and is left blank,
 * exactly as `ButModeInit` leaves it after zeroing `Code`.
 */
export const ACTION_LABEL: readonly string[] = (() => {
  const labels = new Array<string>(BUT_MODE_COUNT).fill('     ');
  const set = (code: number, label: string): void => {
    labels[code] = label;
  };
  set(0, 'Rota ');
  set(4, 'RotZ ');
  set(1, 'Move ');
  set(2, 'MovZ ');
  set(3, 'Clip ');
  set(5, 'ClpN ');
  set(6, 'ClpF ');
  set(13, 'PkAt ');
  set(14, 'PkBd ');
  set(16, 'TorF ');
  set(15, 'RotF ');
  set(17, 'MovF ');
  set(7, ' lb  ');
  set(8, ' mb  ');
  set(9, ' rb  ');
  set(10, '+lb  ');
  set(11, '+mb  ');
  set(12, '+rb  ');
  set(18, 'Orig ');
  set(19, '+lBx ');
  set(20, '-lBx ');
  set(21, 'lbBx ');
  set(22, '  -  ');
  set(23, 'Cent ');
  set(24, 'PkTB ');
  set(25, 'Slab ');
  set(26, 'MovS ');
  set(27, 'Pk1  ');
  set(28, 'MovA ');
  set(29, 'Menu ');
  set(30, 'Sele ');
  set(31, '+/-  ');
  set(32, '+Box ');
  set(33, '-Box ');
  set(34, 'MvSZ ');
  set(35, 'Clik ');
  set(36, 'RotD ');
  set(37, 'MovD ');
  set(38, 'MvDZ ');
  set(39, 'RotO ');
  set(40, 'MovO ');
  set(41, 'MvOZ ');
  set(42, 'MvFZ ');
  set(43, 'MvAZ ');
  set(44, 'DrgM ');
  set(45, 'RotV ');
  set(46, 'MovV ');
  set(47, 'MvVZ ');
  set(49, 'DrgO ');
  set(50, 'IMSZ ');
  set(51, 'IMvZ ');
  set(52, ' Box ');
  set(53, 'IRtZ ');
  set(54, 'RotL ');
  set(55, 'MovL ');
  set(56, 'MvzL ');
  return labels;
})();

/** `BLANK_STR` in `CButMode::draw` (`packages/engine/layer1/ButMode.cpp:107`). */
export const BLANK_LABEL = '     ';

/** One line of prose per action, for the mouse-config dropdowns and tooltips. */
export const ACTION_DESCRIPTION: Readonly<Record<string, string>> = {
  rota: 'rotate XYZ (virtual trackball)',
  move: 'translate in the screen plane',
  movz: 'translate along Z (zoom)',
  clip: 'move the near and far clipping planes',
  rotz: 'rotate about the Z axis',
  clpn: 'move the near clipping plane',
  clpf: 'move the far clipping plane',
  lb: 'legacy: set selection lb',
  mb: 'legacy: set selection mb',
  rb: 'legacy: set selection rb',
  '+lb': 'legacy: add to selection lb',
  '+mb': 'legacy: add to selection mb',
  '+rb': 'legacy: add to selection rb',
  pkat: 'pick atoms into the editor (pk1..pk4)',
  pkbd: 'pick a bond',
  rotf: 'rotate the picked fragment',
  torf: 'torsion the picked fragment',
  movf: 'move the picked fragment',
  orig: 'set the rotation origin at the clicked atom',
  '+lbx': 'deprecated box select: add',
  '-lbx': 'deprecated box select: subtract',
  lbbx: 'deprecated box select: set',
  none: 'unbound',
  cent: 'center on the clicked atom',
  pktb: 'pick a torsion bond',
  slab: 'scale the slab (wheel)',
  movs: 'move the slab (wheel)',
  pk1: 'pick a single atom into pk1 and open the editor',
  mova: 'move the picked atom',
  menu: 'open the pick / selection context menu',
  sele: 'set the active selection',
  '+/-': 'toggle the clicked atom in the active selection',
  '+box': 'rubber-band add to the active selection',
  '-box': 'rubber-band subtract from the active selection',
  mvsz: 'move the slab and zoom',
  clik: 'simple click (fires the click-ready callback only)',
  dgrt: 'drag-rotate',
  dgmv: 'drag-move',
  dgmz: 'drag-move along Z',
  roto: 'rotate the object',
  movo: 'move the object',
  mvoz: 'move the object along Z',
  mvfz: 'move the fragment along Z',
  mvaz: 'move the atom along Z',
  drgm: 'drag the whole molecule',
  rotv: 'rotate the view (TTT / movie)',
  movv: 'move the view (TTT / movie)',
  mvvz: 'move the view along Z (TTT / movie)',
  drgo: 'drag the object',
  imsz: 'inverted move-slab-and-zoom',
  imvz: 'inverted translate along Z',
  box: 'rubber-band set the active selection',
  irtz: 'inverted rotate about Z',
  rotl: 'rotate the edited light',
  movl: 'move the edited light',
  mvzl: 'move the edited light along Z',
};

/** Action code -> the lower-case name `cmd.button` accepts. */
export const ACTION_NAME: readonly (string | null)[] = (() => {
  const names = new Array<string | null>(BUT_MODE_COUNT).fill(null);
  for (const [name, code] of Object.entries(BUT_ACT_CODE)) names[code] = name;
  return names;
})();

/* ------------------------------------------------------------------ *
 * Buttons and modifiers — `controlling.py:30-53`
 * ------------------------------------------------------------------ */

/** Mouse button name -> `cmd.button`'s numeric code (`controlling.py:30-53`). */
export const BUTTON_CODE: Readonly<Record<string, number>> = {
  left: 0,
  middle: 1,
  right: 2,
  wheel: 3,
  double_left: 4,
  double_middle: 5,
  double_right: 6,
  single_left: 7,
  single_middle: 8,
  single_right: 9,
};

/** Modifier name -> `cmd.button`'s numeric code (`controlling.py:30-53`). */
export const BUT_MOD_CODE: Readonly<Record<string, number>> = {
  none: 0,
  shft: 1,
  ctrl: 2,
  ctsh: 3,
  alt: 4,
  alsh: 5,
  ctal: 6,
  ctas: 7,
};

/** `mode_dict` writes `l`/`m`/`r`/`w`; `cmd.button` resolves them through `Shortcut`. */
export const BUTTON_ALIAS: Readonly<Record<string, string>> = {
  l: 'left',
  m: 'middle',
  r: 'right',
  w: 'wheel',
};

/** `cmd.button`'s name resolution, minus the general prefix matcher. */
export function canonicalButton(name: string): string {
  const lower = name.toLowerCase();
  return BUTTON_ALIAS[lower] ?? lower;
}

/**
 * The bit-packing of `cmd.button` (`controlling.py:849-864`).
 *
 * MIRROR, NOT A REPLACEMENT. The client must always call `cmd.button` with
 * string names so Python owns the arithmetic and the abbreviation matcher; this
 * exists to place a binding in the 80-slot table for RENDERING, and to be
 * diffed against Python in `butmode.test.ts`.
 */
export function buttonSlot(button: string, modifier: string): number {
  const buttonNum = BUTTON_CODE[canonicalButton(button)];
  const modNum = BUT_MOD_CODE[modifier.toLowerCase()];
  if (buttonNum === undefined) throw new Error(`unknown button "${button}"`);
  if (modNum === undefined) throw new Error(`unknown modifier "${modifier}"`);
  if (buttonNum < 3) return modNum < 4 ? buttonNum + 3 * modNum : buttonNum + 68 + 3 * (modNum - 4);
  if (buttonNum < 4) return modNum < 4 ? 12 + modNum : 64 + modNum - 4;
  return 16 + buttonNum - 4 + modNum * 6;
}

/** `cButModeInputCount` (`packages/engine/layer1/ButMode.h:216`). */
export const BUT_MODE_INPUT_COUNT = 80;

/** A fresh, wholly unbound 80-slot table (`ButModeInit`, `ButMode.cpp:497-499`). */
export function emptyButModeTable(): number[] {
  return new Array<number>(BUT_MODE_INPUT_COUNT).fill(BUT_MODE_NOTHING);
}

/* ------------------------------------------------------------------ *
 * Resolution — `ButModeTranslate` (`packages/engine/layer1/ButMode.cpp:603-757`)
 * ------------------------------------------------------------------ */

/** `packages/engine/layer0/os_gl_glut.h:21-28` + `os_gl_glut_pretend.h:24-26`. */
export const GlutButton = {
  Left: 0,
  Middle: 1,
  Right: 2,
  ScrollForward: 3,
  ScrollBackward: 4,
  SingleLeft: 100,
  SingleMiddle: 101,
  SingleRight: 102,
  DoubleLeft: 200,
  DoubleMiddle: 201,
  DoubleRight: 202,
} as const;

/** Wheel-only pseudo actions (`packages/engine/layer1/ButMode.h:106-113`), never stored in a slot. */
export const WheelAction = {
  ScaleSlabShrink: 101,
  ScaleSlabExpand: 102,
  MoveSlabForward: 103,
  MoveSlabBackward: 104,
  MoveSlabAndZoomForward: 105,
  MoveSlabAndZoomBackward: 106,
  ZoomForward: 107,
  ZoomBackward: 108,
} as const;

/**
 * `ButModeTranslate(G, button, mod)` — verbatim (`packages/engine/layer1/ButMode.cpp:603-757`).
 *
 * `table` is the 80-slot array; `button` is a `GlutButton`; `mod` is the
 * `cOrtho` mask (SHIFT 1, CTRL 2, ALT 4, `packages/engine/layer1/Ortho.h:20-22`).
 *
 * Returns an action code, one of the 101..108 wheel pseudo-actions, or
 * `BUT_MODE_NOTHING` when the gesture is unbound.
 *
 * The upstream fall-through is preserved: a button the switch does not
 * recognise leaves `mode` at `cButModeNothing` (-1) and then has the modifier
 * offset added to it, which is exactly what the C does.
 */
export function butModeTranslate(
  table: readonly number[],
  button: number,
  mod: number,
): number {
  let mode: number = BUT_MODE_NOTHING;
  let modifier = mod;

  switch (button) {
    case GlutButton.Left:
      mode = 0;
      break;
    case GlutButton.Middle:
      mode = 1;
      break;
    case GlutButton.Right:
      mode = 2;
      break;
    case GlutButton.ScrollForward:
    case GlutButton.ScrollBackward: {
      // Wheel slots 12..15, then re-mapped BY DIRECTION. Anything not in the
      // six wheel-capable actions returns -1: the wheel does nothing.
      if (modifier === 0) mode = 12;
      else if (modifier === 1) mode = 13;
      else if (modifier === 2) mode = 14;
      else if (modifier === 3) mode = 15;
      modifier = 0;
      const forward = button === GlutButton.ScrollForward;
      switch (table[mode]) {
        case BUT_ACT_CODE['slab']:
          return forward ? WheelAction.ScaleSlabExpand : WheelAction.ScaleSlabShrink;
        case BUT_ACT_CODE['movs']:
          return forward ? WheelAction.MoveSlabForward : WheelAction.MoveSlabBackward;
        case BUT_ACT_CODE['mvsz']:
          return forward
            ? WheelAction.MoveSlabAndZoomForward
            : WheelAction.MoveSlabAndZoomBackward;
        case BUT_ACT_CODE['imsz']:
          return forward
            ? WheelAction.MoveSlabAndZoomBackward
            : WheelAction.MoveSlabAndZoomForward;
        case BUT_ACT_CODE['movz']:
          return forward ? WheelAction.ZoomForward : WheelAction.ZoomBackward;
        case BUT_ACT_CODE['imvz']:
          return forward ? WheelAction.ZoomBackward : WheelAction.ZoomForward;
        default:
          return BUT_MODE_NOTHING;
      }
    }
    case GlutButton.DoubleLeft:
    case GlutButton.DoubleMiddle:
    case GlutButton.DoubleRight:
    case GlutButton.SingleLeft:
    case GlutButton.SingleMiddle:
    case GlutButton.SingleRight: {
      const base: Record<number, number> = {
        [GlutButton.DoubleLeft]: 16,
        [GlutButton.DoubleMiddle]: 17,
        [GlutButton.DoubleRight]: 18,
        [GlutButton.SingleLeft]: 19,
        [GlutButton.SingleMiddle]: 20,
        [GlutButton.SingleRight]: 21,
      };
      mode = base[button] as number;
      // +6 Shft, +12 Ctrl, +18 CtSh, +24 Alt, +30 AltShft, +36 CtrlAlt, +42 all
      const bump: Record<number, number> = { 1: 6, 2: 12, 3: 18, 4: 24, 5: 30, 6: 36, 7: 42 };
      mode += bump[modifier] ?? 0;
      modifier = 0;
      break;
    }
    default:
      break;
  }

  // L/M/R: +3 Shft, +6 Ctrl, +9 CtSh, +68 Alt, +71 AltShft, +74 CtAl, +77 CtAS
  const bump: Record<number, number> = { 1: 3, 2: 6, 3: 9, 4: 68, 5: 71, 6: 74, 7: 77 };
  mode += bump[modifier] ?? 0;

  const resolved = table[mode];
  return resolved === undefined ? BUT_MODE_NOTHING : resolved;
}

/**
 * `ButModeCheckPossibleSingleClick` (`packages/engine/layer1/ButMode.cpp:583-601`): true iff the
 * SINGLE slot matching a physical button is bound.
 */
export function checkPossibleSingleClick(
  table: readonly number[],
  button: number,
  mod: number,
): boolean {
  let clickButton = -1;
  if (button === GlutButton.Left) clickButton = GlutButton.SingleLeft;
  else if (button === GlutButton.Middle) clickButton = GlutButton.SingleMiddle;
  else if (button === GlutButton.Right) clickButton = GlutButton.SingleRight;
  if (clickButton < 0) return false;
  return butModeTranslate(table, clickButton, mod) >= 0;
}

/* ------------------------------------------------------------------ *
 * The on-screen grid — `CButMode::draw` (`packages/engine/layer1/ButMode.cpp:224-360`)
 * ------------------------------------------------------------------ */

/**
 * The six labelled rows of the ButMode grid and the slots each one shows, in
 * the order the block draws them top to bottom (`ButMode.cpp:232-357`).
 *
 * Note the SnglClk row is drawn ABOVE DblClk even though its slots (19..21) sit
 * after the double-click slots (16..18) in the table, and that the click rows
 * have no wheel column.
 */
export interface GridRow {
  /** The label PyMOL draws in the left column. */
  label: string;
  /** Slots for L, M, R. */
  buttons: readonly [number, number, number];
  /** The wheel slot, or null for the click rows. */
  wheel: number | null;
}

/** The six labelled rows of the on-screen ButMode grid, top to bottom. */
export const GRID_ROWS: readonly GridRow[] = [
  { label: '& Keys', buttons: [0, 1, 2], wheel: 12 },
  { label: 'Shft', buttons: [3, 4, 5], wheel: 13 },
  { label: 'Ctrl', buttons: [6, 7, 8], wheel: 14 },
  { label: 'CtSh', buttons: [9, 10, 11], wheel: 15 },
  { label: 'SnglClk', buttons: [19, 20, 21], wheel: null },
  { label: 'DblClk', buttons: [16, 17, 18], wheel: null },
];

/** The column header, `"    L    M    R  Wheel"` (`ButMode.cpp:239`). */
export const GRID_COLUMNS: readonly string[] = ['L', 'M', 'R', 'Wheel'];

/** The label for a slot, or `BLANK_LABEL` when unbound. */
export function slotLabel(table: readonly number[], slot: number): string {
  const code = table[slot];
  if (code === undefined || code < 0) return BLANK_LABEL;
  return ACTION_LABEL[code] ?? BLANK_LABEL;
}

/* ------------------------------------------------------------------ *
 * Selection level — `mouse_selection_mode`
 * ------------------------------------------------------------------ */

/**
 * The seven selection levels: the label the ButMode block prints
 * (`packages/engine/layer1/ButMode.cpp:370-392`) and the selection-expansion keyword
 * `SceneGetSeleModeKeyword` hands to the selector (`packages/engine/layer1/Scene.cpp:460-468`).
 * Default is 1, Residues (`packages/engine/layer1/SettingInfo.h:449`).
 */
export interface SelectionLevel {
  value: number;
  label: string;
  /** `sel_mode_kw`; level 0 (Atoms) has none. */
  keyword: string;
}

/** The seven `mouse_selection_mode` levels, from Atoms up to C-alphas. */
export const SELECTION_LEVELS: readonly SelectionLevel[] = [
  { value: 0, label: 'Atoms', keyword: '' },
  { value: 1, label: 'Residues', keyword: 'byresi' },
  { value: 2, label: 'Chains', keyword: 'bychain' },
  { value: 3, label: 'Segments', keyword: 'bysegi' },
  { value: 4, label: 'Objects', keyword: 'byobject' },
  { value: 5, label: 'Molecules', keyword: 'bymol' },
  { value: 6, label: 'C-alphas', keyword: 'bca.' },
];

/**
 * The bottom line of the ButMode block (`packages/engine/layer1/ButMode.cpp:363-393`).
 *
 * When single-left resolves to `pkat` the block shows
 * `Picking Atoms (and Joints)` and clicking it does NOT cycle the level
 * (`ButMode.cpp:163-173`) — `cycles` carries that.
 */
export function selectionLine(
  table: readonly number[],
  selectionMode: number,
): { prefix: string; value: string; cycles: boolean } {
  if (butModeTranslate(table, GlutButton.SingleLeft, 0) === BUT_ACT_CODE['pkat']) {
    return { prefix: 'Picking ', value: 'Atoms (and Joints)', cycles: false };
  }
  const level = SELECTION_LEVELS.find((entry) => entry.value === selectionMode);
  return { prefix: 'Selecting ', value: level?.label ?? '', cycles: true };
}
