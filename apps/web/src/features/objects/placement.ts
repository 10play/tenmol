/**
 * Submenu side-flip and pop-up scrolling — `packages/engine/layer1/Pop.cpp` as data.
 *
 * PLACEMENT (`PopPlaceChild`, `Pop.cpp:111-150`). A child menu is laid out on
 * the side its parent's `PlacementAffinity` says, `right` for the first one
 * (affinity starts at 0, and the test is `affinity >= 0`):
 *
 *     right:  left = parentRight - 2
 *     left:   left = parentLeft - width + 2
 *
 * then `PopFitBlock` (`:79-107`) clamps it into the viewport with a 3 px
 * margin. **If the clamp moved it, the side is wrong** — `PopPlaceChild` tests
 * `block->rect.left != target_x` and lays it out again on the other side. The
 * chosen side is RETURNED and inherited: `CPopUp::drag` passes
 * `I->PlacementAffinity` into the next `PopPlaceChild`, so once a chain has
 * flipped left it keeps going left even where the right side would have fit.
 *
 * SCROLL (`PopUp.cpp:438-445`). A wheel release scrolls the menu by exactly
 * 10 px — `scroll_dy = 10`, negated for `SCROLL_FORWARD` — through
 * `Block::translate`, which MOVES the block; it is not a viewport-sized page
 * scroll and it is not proportional to the wheel delta.
 */

/** `#define cPopMargin 3` (`packages/engine/layer1/Pop.cpp:24`). */
export const POP_MARGIN = 3;

/** `scroll_dy = 10` (`packages/engine/layer4/PopUp.cpp:438`). */
export const POP_SCROLL_PX = 10;

export type Affinity = 'left' | 'right';

export interface ChildPlacement {
  left: number;
  affinity: Affinity;
  /** True when even the chosen side had to be clamped (both sides overflow). */
  clamped: boolean;
}

export interface PlaceChildInput {
  /** The parent menu's box in client coordinates. */
  parentLeft: number;
  parentRight: number;
  /** The child's measured width. */
  width: number;
  /** `CPop::rect.right` — the drawable width, i.e. the window. */
  viewportWidth: number;
  /** The parent's `PlacementAffinity`; the root menu has none. */
  affinity?: Affinity | undefined;
}

/** `PopFitBlock`'s horizontal half: clamp into `[margin, viewport-margin]`. */
function fitLeft(left: number, width: number, viewportWidth: number): number {
  let x = left;
  if (x + width + POP_MARGIN > viewportWidth) x = viewportWidth - POP_MARGIN - width;
  if (x - POP_MARGIN < 0) x = POP_MARGIN;
  return x;
}

/** `PopPlaceChild` — the side, the x, and whether it still had to be clamped. */
export function placeChild(input: PlaceChildInput): ChildPlacement {
  const { parentLeft, parentRight, width, viewportWidth } = input;
  const first: Affinity = input.affinity ?? 'right';
  const targetFor = (side: Affinity) =>
    side === 'right' ? parentRight - 2 : parentLeft - width + 2;

  const firstTarget = targetFor(first);
  const firstFit = fitLeft(firstTarget, width, viewportWidth);
  if (firstFit === firstTarget) return { left: firstFit, affinity: first, clamped: false };

  const other: Affinity = first === 'right' ? 'left' : 'right';
  const otherTarget = targetFor(other);
  const otherFit = fitLeft(otherTarget, width, viewportWidth);
  return {
    left: otherFit,
    affinity: other,
    clamped: otherFit !== otherTarget,
  };
}
