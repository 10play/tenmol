export {
  createInputController,
  ButtonState,
  Modifier,
  MouseButton,
  modifierMask,
  type InputController,
  type InputControllerOptions,
  type InputControllerStats,
  type PinchTarget,
} from './mouse';
export {
  createDragCoalescer,
  DEFAULT_DRAG_BUDGET_MS,
  type DragCoalescer,
  type DragCoalescerOptions,
  type DragCoalescerStats,
  type DragSample,
  type FlushReason,
} from './coalescer';
export {
  toPymolPoint,
  whenOf,
  type PointerLike,
  type PymolPoint,
  type SurfaceGeometry,
} from './coords';

/* --- the ButMode table (WP-23, plan §A9: mirrored from Python, no C++) --- */
export {
  ACTION_DESCRIPTION,
  ACTION_LABEL,
  ACTION_NAME,
  BLANK_LABEL,
  BUT_ACT_CODE,
  BUT_MOD_CODE,
  BUT_MODE_COUNT,
  BUT_MODE_INPUT_COUNT,
  BUT_MODE_NOTHING,
  BUTTON_ALIAS,
  BUTTON_CODE,
  GRID_COLUMNS,
  GRID_ROWS,
  GlutButton,
  SELECTION_LEVELS,
  WheelAction,
  butModeTranslate,
  buttonSlot,
  canonicalButton,
  checkPossibleSingleClick,
  emptyButModeTable,
  selectionLine,
  slotLabel,
  type GridRow,
  type SelectionLevel,
} from './butmode';

export {
  DEFAULT_RING,
  MODE_DICT,
  MODE_NAME_DICT,
  MODE_NAME_LIST,
  RING_DICT,
  type ButtonBinding,
  type ModeName,
  type RingName,
} from './modes';

export {
  MOUSE_CONFIG_MENU,
  displayName as mouseModeDisplayName,
  isModeName,
  isRingName,
  modeForButtonMode,
  stepButtonMode,
  stepSelectionMode,
  tableForMode,
  type MouseConfigItem,
} from './mouseConfig';

/* --- keyboard (WP-23) --- */
export {
  KEY_MAP,
  KEY_STATE_ASCII,
  KEY_STATE_SPECIAL,
  MODIFIER_KEYS,
  RESERVED_KEYS,
  SPECIAL_KEY_NAMES,
  SPECIAL_MAP,
  asciiUpperFromCode,
  isReservedKey,
  keyEventToButtonArgs,
  keyEventToShortcutName,
  modifierPrefix,
  validateShortcutName,
  type KeyButtonArgs,
  type KeyEventLike,
} from './keys';

export {
  DEFAULT_SHORTCUTS,
  DEFAULT_SHORTCUT_BY_KEY,
  shortcutGroup,
  type DefaultShortcut,
} from './shortcuts';
