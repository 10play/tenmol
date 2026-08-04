/**
 * The Camera Motion / Object Motion context menus.
 *
 * Ported from `packages/engine/modules/pymol/menu.py` — `camera_motion` (`:108`),
 * `obj_motion` (`:126`), `camera_store_with_scene` (`:54`),
 * `store_with_state` (`:62`) and `smooth` (`:103`) — including the exact
 * command strings, which is the point: `PopUp` leaves are command strings
 * (`packages/engine/layer4/PopUp.cpp:471-475`) and these are byte-identical to them, so they
 * can go straight to `cmd.do`.
 *
 * `frame` here is the string PyMOL passes down, which is the **0-based**
 * `mview first=` value (`MovieClick` builds it from `ViewElemXtoFrame`).
 */

export interface MotionItem {
  label: string;
  /** A command string for `cmd.do`, or a submenu. */
  command?: string;
  items?: MotionItem[];
  /** `[2, ...]` in PyMOL's list format: a non-clickable header. */
  header?: boolean;
  separator?: boolean;
}

const SEP: MotionItem = { label: '', separator: true };

/** `menu.py:103` — window defaults to 0/15/30. */
function smoothMenu(extra: string): MotionItem[] {
  return [
    { label: 'a little', command: `cmd.mview("smooth"${extra})` },
    { label: 'more', command: `cmd.mview("smooth",window=15${extra})` },
    { label: 'a lot', command: `cmd.mview("smooth",window=30${extra})` },
  ];
}

/** `menu.py:54` — up to 40 scene names, "keep this practical". */
export function cameraStoreWithScene(scenes: readonly string[], frame: string): MotionItem[] {
  return [
    { label: 'Scene:', header: true },
    ...scenes.slice(0, 40).map((name) => ({
      label: name,
      command: `cmd.mview("store",scene="${name}",first=${frame})`,
    })),
  ];
}

/**
 * `menu.py:62` — current, 1, n, then 8 evenly spaced states.
 *
 * The spacing is `(n_state * i) // n_show for i in range(2, n_show)` with
 * `n_show = min(8, n_state)`, which is why the list is neither 1..8 nor evenly
 * divided into 8 — it is 6 interior samples at most.
 */
export function storeWithState(nStates: number, obj: string, frame: string): MotionItem[] {
  const cmdFor = (state: number | string) =>
    `cmd.mview("store",object="${obj}",state=${state},first=${frame})`;
  const items: MotionItem[] = [
    { label: 'State:', header: true },
    { label: 'current', command: cmdFor(-1) },
    SEP,
    { label: '1', command: cmdFor(1) },
  ];
  if (nStates > 1) {
    items.push({ label: String(nStates), command: cmdFor(nStates) }, SEP);
    const nShow = Math.min(8, nStates);
    for (let i = 2; i < nShow; i += 1) {
      const state = Math.trunc((nStates * i) / nShow);
      items.push({ label: String(state), command: cmdFor(state) });
    }
  }
  return items;
}

/** `menu.py:108`. `frame` is the 0-based `first=` value. */
export function cameraMotionMenu(
  scenes: readonly string[],
  nStates: number,
  frame = '0',
): MotionItem[] {
  return [
    { label: 'Camera Motion:', header: true },
    { label: 'store', command: `cmd.mview("store",first=${frame})` },
    { label: 'store with scene', items: cameraStoreWithScene(scenes, frame) },
    { label: 'store with state', items: storeWithState(nStates, '', frame) },
    { label: 'clear', command: `cmd.mview("clear",first=${frame})` },
    SEP,
    { label: 'reset camera motions', command: 'cmd.mview("reset")' },
    SEP,
    { label: 'purge entire movie', command: 'cmd.mset()' },
    SEP,
    { label: 'smooth key frames', items: smoothMenu('') },
    SEP,
    { label: 'interpolate', command: 'cmd.mview("interpolate")' },
    { label: 'reinterpolate', command: 'cmd.mview("reinterpolate")' },
    { label: 'uninterpolate', command: 'cmd.mview("uninterpolate")' },
  ];
}

/** `menu.py:126` — adds drag, reset(object=), purge, and passes `object=`. */
export function objectMotionMenu(obj: string, nStates: number, frame = '0'): MotionItem[] {
  const o = `,object="${obj}"`;
  return [
    { label: `Object "${obj}" Motion:`, header: true },
    { label: 'drag', command: `cmd.drag("${obj}")` },
    SEP,
    { label: 'store', command: `cmd.mview("store",object="${obj}",first=${frame})` },
    { label: 'store with state', items: storeWithState(nStates, obj, frame) },
    { label: 'reset', command: `;cmd.reset(object="${obj}");` },
    { label: 'clear', command: `cmd.mview("clear",object="${obj}",first=${frame})` },
    SEP,
    { label: 'reset object motions', command: `cmd.mview("reset",object="${obj}")` },
    { label: 'purge object motions', command: `cmd.mview("purge",object="${obj}")` },
    SEP,
    { label: 'smooth key frames', items: smoothMenu(o) },
    SEP,
    { label: 'interpolate', command: `cmd.mview("interpolate",object="${obj}")` },
    { label: 'reinterpolate', command: `cmd.mview("reinterpolate",object="${obj}")` },
    { label: 'uninterpolate', command: `cmd.mview("uninterpolate",object="${obj}")` },
  ];
}
