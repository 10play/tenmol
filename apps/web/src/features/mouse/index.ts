/**
 * `features/mouse` has NO `register.ts`, on purpose.
 *
 * `features/registry.ts` is frozen and declares no `mouse` slot; a directory
 * the registry does not know about is never rendered (`slotsForRegion` only
 * walks `FEATURE_SLOTS`) and would merely show up in the shell's "undeclared
 * feature dirs" warning. So the ButMode block is mounted by the `shortcuts`
 * service slot, which WP-23 owns and which is described in the plan as
 * "Keyboard and mouse configuration ... and the ButMode grid".
 *
 * Registry change requested: an `internal-gui` slot `butmode` ordered between
 * `wizards` (20) and `movie` (30), matching `OrthoLayoutPanel`'s bottom-up
 * stack (`layer1/Ortho.cpp:2261-2340`). Reported, not smuggled in.
 */

export { ButModeBlock } from './ButModeBlock';
export { MouseConfigPanel } from './MouseConfigPanel';
export { useMouseMode, modeFromDisplayName, type MouseModeState } from './useMouseMode';
