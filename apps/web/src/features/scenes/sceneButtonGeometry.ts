/**
 * `SceneDrawButtons` (`packages/engine/layer1/Scene.cpp:2885-3060`) as arithmetic.
 *
 * THE QUESTION THIS FILE ANSWERS. The parity row asked whether the scene-button
 * overlay is meant to be a pixel-for-pixel port of PyMOL's GL block or a DOM
 * toolbar that merely behaves the same. The answer here is: the GEOMETRY is
 * ported, the RENDERING is not. PyMOL lays the buttons out with fixed 8-dip
 * character cells because it draws its own bitmap font and has no text metrics;
 * the browser has both. But the three things the layout DECIDES — how many
 * buttons fit before a scrollbar is needed, how many characters of a name
 * survive, and how wide a button is — are user-visible behaviour, not
 * implementation detail, and a flex toolbar silently has none of them.
 *
 * So this module reproduces the arithmetic exactly and the component uses it
 * for sizing and truncation. Every constant below is `packages/engine/layer1/Scene.cpp`'s or
 * `packages/engine/layer1/Scene.h`'s, and
 * `packages/bridge/tests/test_p9_rest.py::test_scene_button_geometry_matches_Scene_cpp`
 * re-reads both files and fails if either side moves.
 *
 * COORDINATES ARE PYMOL'S: origin bottom-left, y increasing upwards, and the
 * button list is laid out DOWNWARD from the top of the stack (`y -= lineHeight`
 * with a `y < rect.bottom` break, `:3053-3055`). `topOffset` on each button is
 * the CSS-friendly distance from the top of the block, so a caller does not
 * have to flip anything itself.
 */

/* --- `packages/engine/layer1/Scene.cpp:2772-2778`, `packages/engine/layer1/Scene.h:46-47` ---------------- */

/** `charWidth = DIP2PIXEL(8)` (`Scene.cpp:2896`). */
export const SCENE_CHAR_WIDTH_DIP = 8;
/** `#define SceneToggleWidth DIP2PIXEL(17)`. One toggle column, `op_cnt = 1`. */
export const SCENE_TOGGLE_WIDTH_DIP = 17;
/** `#define SceneTextLeftMargin DIP2PIXEL(1)`. */
export const SCENE_TEXT_LEFT_MARGIN_DIP = 1;
/** `#define SceneScrollBarMargin DIP2PIXEL(1)`. */
export const SCENE_SCROLLBAR_MARGIN_DIP = 1;
/** `#define SceneScrollBarWidth DIP2PIXEL(13)`. */
export const SCENE_SCROLLBAR_WIDTH_DIP = 13;
/** `x2 = x + len * charWidth + DIP2PIXEL(6)` (`Scene.cpp:3018`). */
export const SCENE_BUTTON_PAD_DIP = 6;
/** `#define SceneRightMargin 0` — NOT scaled. */
export const SCENE_RIGHT_MARGIN = 0;
/** `#define SceneTopMargin 0` — NOT scaled. */
export const SCENE_TOP_MARGIN = 0;
/** `#define SceneBottomMargin 3` (`Scene.cpp:97`) — NOT scaled. */
export const SCENE_BOTTOM_MARGIN = 3;
/** The literal `4` in the `max_char` expression (`Scene.cpp:2949-2950`). */
export const SCENE_MAX_CHAR_SLACK = 4;
/** `int op_cnt = 1` (`Scene.cpp:2903`). */
export const SCENE_OP_CNT = 1;
/** `(block->rect.right - block->rect.left) > 6` (`Scene.cpp:2905`). */
export const SCENE_MIN_BLOCK_WIDTH = 6;

/** `inline int DIP2PIXEL(int v) { return v * _gScaleFactor; }` (`PyMOLGlobals.h:29`). */
export function dip2pixel(value: number, scale: number): number {
  return value * scale;
}

export interface SceneBlockRect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface SceneButtonLayoutInput {
  /** `CScene::rect`, in pixels. */
  rect: SceneBlockRect;
  /** `internal_gui_control_size` — the setting, unscaled. Default 18. */
  controlSize?: number;
  /** `_gScaleFactor`, i.e. the `display_scale_factor` setting. */
  scale?: number;
  /** `CScene::SceneVec` names, in order. */
  names: readonly string[];
  /** `CScene::NSkip` — entries the scrollbar has scrolled past. */
  skip?: number;
}

export interface SceneButtonRect {
  name: string;
  /** `name` cut to `max_char`; PyMOL stops drawing characters, it does not "…". */
  label: string;
  truncated: boolean;
  left: number;
  right: number;
  bottom: number;
  top: number;
  width: number;
  height: number;
  /** Distance from `rect.top` — for a DOM box, which measures downward. */
  topOffset: number;
  /**
   * Distance from the top of the DRAWN STACK, i.e. `row * lineHeight`.
   *
   * WHY BOTH. `topOffset` is faithful to PyMOL: the stack sits at the BOTTOM of
   * the scene block (`y = rect.bottom + SceneBottomMargin + (n_vis-1)*lineHeight`,
   * `Scene.cpp:2974`), so against an 800x600 viewport the first button's
   * `topOffset` is 579. That is the right number for anything drawing into the
   * viewport, and the WRONG one for the Scene panel's DOM strip, which is only
   * as tall as the stack — positioning a button 579 px down inside an 18 px
   * `overflow: hidden` box put it under the panel's own text, where it was
   * invisible AND unclickable (the e2e scene-recall click was intercepted by
   * `.scpanel__hint`). A DOM strip wants the offset within the stack.
   */
  stackOffset: number;
}

export interface SceneScrollBar {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  /** Entries and window, i.e. `ScrollBar::setLimits(n_ent, n_disp)`. */
  total: number;
  visible: number;
}

export interface SceneButtonLayout {
  /** `I->ButtonsShown`: false for an empty list or a block 6 px wide. */
  shown: boolean;
  charWidth: number;
  lineHeight: number;
  /** `n_disp` — how many rows fit; at least 1. */
  nDisp: number;
  /** `max_char` — characters a name is cut to. May be <= 0 in a narrow block. */
  maxChar: number;
  /** `text_lift`, the baseline offset inside a row (`Scene.cpp:2902`). */
  textLift: number;
  scrollBar: SceneScrollBar | null;
  buttons: SceneButtonRect[];
}

/**
 * The whole of `SceneDrawButtons`'s layout half, with `draw_for_real = false`.
 *
 * ONE DELIBERATE SIMPLIFICATION, recorded because it is a difference: the C
 * also clamps `x2` to `x + 10` when the button would collide with the toggle
 * column (`Scene.cpp:3010-3012`) and then overwrites it with the text width on
 * the very next line, so the clamp has no effect on the stored rect. It is not
 * reproduced.
 */
export function layoutSceneButtons(input: SceneButtonLayoutInput): SceneButtonLayout {
  const scale = Math.max(1, Math.round(input.scale ?? 1));
  const controlSize = input.controlSize ?? 18;
  const charWidth = dip2pixel(SCENE_CHAR_WIDTH_DIP, scale);
  const lineHeight = dip2pixel(controlSize, scale);
  const textLift = Math.floor(lineHeight / 2) - dip2pixel(5, scale);
  const { rect } = input;
  const width = rect.right - rect.left;
  const height = rect.top - rect.bottom;
  const nEnt = input.names.length;

  const empty: SceneButtonLayout = {
    shown: false,
    charWidth,
    lineHeight,
    nDisp: 1,
    maxChar: 0,
    textLift,
    scrollBar: null,
    buttons: [],
  };
  if (width <= SCENE_MIN_BLOCK_WIDTH || nEnt === 0 || lineHeight <= 0) return empty;

  // n_disp = ((top - bottom) - SceneTopMargin) / lineHeight - 1, min 1.
  let nDisp = Math.floor((height - SCENE_TOP_MARGIN) / lineHeight) - 1;
  if (nDisp < 1) nDisp = 1;

  const scrollBarActive = nEnt > nDisp;

  let maxChar =
    width -
    (dip2pixel(SCENE_TEXT_LEFT_MARGIN_DIP, scale) +
      SCENE_RIGHT_MARGIN +
      SCENE_MAX_CHAR_SLACK) -
    SCENE_OP_CNT * dip2pixel(SCENE_TOGGLE_WIDTH_DIP, scale);
  if (scrollBarActive) {
    maxChar -=
      dip2pixel(SCENE_SCROLLBAR_MARGIN_DIP, scale) +
      dip2pixel(SCENE_SCROLLBAR_WIDTH_DIP, scale);
  }
  // Integer division, and C truncates toward zero.
  maxChar = Math.trunc(maxChar / charWidth);

  let x = rect.left + dip2pixel(SCENE_TEXT_LEFT_MARGIN_DIP, scale);
  const scrollBar: SceneScrollBar | null = scrollBarActive
    ? {
        left: rect.left + dip2pixel(SCENE_SCROLLBAR_MARGIN_DIP, scale),
        right:
          rect.left +
          dip2pixel(SCENE_SCROLLBAR_MARGIN_DIP, scale) +
          dip2pixel(SCENE_SCROLLBAR_WIDTH_DIP, scale),
        top: rect.top - dip2pixel(SCENE_SCROLLBAR_MARGIN_DIP, scale),
        bottom: rect.bottom + 2,
        width: dip2pixel(SCENE_SCROLLBAR_WIDTH_DIP, scale),
        total: nEnt,
        visible: nDisp,
      }
    : null;
  if (scrollBarActive) {
    x += dip2pixel(SCENE_SCROLLBAR_WIDTH_DIP, scale) + dip2pixel(SCENE_SCROLLBAR_MARGIN_DIP, scale);
  }

  const nVis = Math.min(nDisp, nEnt);
  let y = rect.bottom + SCENE_BOTTOM_MARGIN + (nVis - 1) * lineHeight;

  const skip = Math.max(0, Math.min(input.skip ?? 0, Math.max(0, nEnt - 1)));
  const buttons: SceneButtonRect[] = [];
  for (let i = skip; i < nEnt; i++) {
    const name = input.names[i] ?? '';
    const len = Math.min(name.length, Math.max(0, maxChar));
    const x2 = x + len * charWidth + dip2pixel(SCENE_BUTTON_PAD_DIP, scale);
    buttons.push({
      name,
      label: name.slice(0, len),
      truncated: len < name.length,
      left: x,
      right: x2,
      bottom: y,
      top: y + lineHeight,
      width: x2 - x,
      height: lineHeight,
      topOffset: rect.top - (y + lineHeight),
      stackOffset: buttons.length * lineHeight,
    });
    y -= lineHeight;
    // `if (y < I->rect.bottom) break;` — the last row may hang below
    // `bottom + SceneBottomMargin`, which is why this is checked AFTER the push.
    if (y < rect.bottom) break;
  }

  return {
    shown: true,
    charWidth,
    lineHeight,
    nDisp,
    maxChar,
    textLift,
    scrollBar,
    buttons,
  };
}

/**
 * `SceneClick`'s scrollbar test (`packages/engine/layer1/SceneMouse.cpp:645,701,1078`): a press
 * in the left gutter belongs to the scrollbar and never to a button, even when
 * a button's rect overlaps it.
 */
export function isScrollBarClick(
  layout: SceneButtonLayout,
  rect: SceneBlockRect,
  x: number,
  scale = 1,
): boolean {
  if (!layout.scrollBar) return false;
  return (
    x - rect.left <
    dip2pixel(SCENE_SCROLLBAR_WIDTH_DIP, scale) + dip2pixel(SCENE_SCROLLBAR_MARGIN_DIP, scale)
  );
}

/**
 * `elem.drawn && elem.rect.contains(x, y)` (`SceneMouse.cpp:651`).
 *
 * `contains` defaults to `proper = true` — STRICT on all four edges
 * (`packages/engine/layer0/Rect.h:28-32`), so a click exactly on a button's boundary belongs to
 * no button, and the 1 px seam between two stacked rows (`bottom` of one is
 * `top` of the next) falls through to the camera. Reproduced, not tidied.
 */
export function buttonAt(
  layout: SceneButtonLayout,
  x: number,
  y: number,
): SceneButtonRect | null {
  for (const button of layout.buttons) {
    if (x > button.left && x < button.right && y > button.bottom && y < button.top) {
      return button;
    }
  }
  return null;
}
