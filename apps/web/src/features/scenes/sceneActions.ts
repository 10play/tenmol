/**
 * Every write the scene surface makes, as `cmd.scene` / `cmd.scene_order`.
 *
 * `cmd.scene(key, action, message, view, color, active, rep, frame, animate,
 * new_key, hand, quiet, sele)` (`packages/engine/modules/pymol/viewing.py:1034`) is the whole
 * API; the C side is `MovieSceneRecall`/`Store`/`Order`
 * (`packages/engine/layer3/MovieScene.cpp:755,700,733,88`). The semantics reproduced here:
 *
 *   `key='auto'` + recall silently becomes `next`
 *   `update` preserves the existing message
 *   `clear` deletes, `append`/`update` store
 *   `insert_before`/`insert_after` store then reorder against
 *     `scene_current_name`
 *   next/previous wrap only when `scene_loop`, or when there is no current
 *   recall `''` blanks the screen (disable all + clear the message)
 *   recall `*` prints the order
 *
 * The store flags are `view/color/active/rep/frame`, which is exactly the
 * Append> submenu of the Scene menu (`_gui.py:781-786`).
 */

import type { PanelMenuCode, PanelMenuNode } from '@tenmol/protocol';

export interface SceneAction {
  fn: string;
  args: readonly unknown[];
  kwargs?: Record<string, unknown>;
  echo: string;
}

const scene = (
  args: readonly unknown[],
  kwargs: Record<string, unknown> = {},
): SceneAction => {
  const rendered = [
    ...args.map((a) => (typeof a === 'string' ? `"${a}"` : String(a))),
    ...Object.entries(kwargs).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : String(v)}`),
  ].join(', ');
  return { fn: 'cmd.scene', args, kwargs, echo: `cmd.scene(${rendered})` };
};

export const sceneActions = {
  store: (key = 'new') => scene([key, 'store'], { quiet: 0 }),
  /** Append> submenu: the four flag combinations `_gui.py:782-785` offers. */
  storeCameraOnly: () => scene(['new', 'store'], { color: 0, rep: 0 }),
  storeColorOnly: () => scene(['new', 'store'], { view: 0, rep: 0 }),
  storeRepsOnly: () => scene(['new', 'store'], { view: 0, color: 0 }),
  storeRepsColor: () => scene(['new', 'store'], { view: 0 }),

  recall: (key: string, animate = -1) => scene([key, 'recall'], { animate }),
  /** Middle-drag "rapid browse": Ctrl forces `animate=0`. */
  browse: (key: string) => scene([key, 'recall'], { animate: 0 }),
  update: (key = 'auto') => scene([key, 'update']),
  clear: (key: string) => scene([key, 'clear']),
  rename: (key: string, newKey: string) => scene([key, 'rename'], { new_key: newKey }),
  insertBefore: () => scene(['', 'insert_before']),
  insertAfter: () => scene(['', 'insert_after']),
  /*
   * HAZARD, dormant but real, for whoever builds presentation mode.
   *
   * `viewing.py:1107-1114`: a second consecutive `next`/`previous` at the end
   * of the scene list, with `presentation` on, calls `chain_session()` — and
   * if there is no numerically-next .pse/.psw beside `session_file`, it calls
   * `_self.quit()`.
   *
   * On the desktop that closes the app the user is looking at. Here it ends
   * the BRIDGE PROCESS for every connected client, and because the call comes
   * from inside PyMOL it bypasses the graceful shutdown the bridge installs
   * for a client-issued `cmd.quit` (`packages/bridge/tenmol_bridge/server.py:139`).
   *
   * `presentation` is OFF by default, which is the only thing stopping it;
   * `presentation_auto_quit` is ON, and both are editable from the Advanced
   * Settings table. Preconditions are pinned in
   * `packages/bridge/tests/test_sessions.py`, which deliberately does not trigger them.
   */
  next: () => scene(['', 'next']),
  previous: () => scene(['', 'previous']),
  first: () => scene(['', 'first']),
  /** `recall ''` blanks the screen: disable all + clear the message. */
  blank: () => scene(['', 'recall']),
  setMessage: (key: string, message: string): SceneAction => ({
    fn: 'cmd.set_scene_message',
    args: [key, message],
    echo: `cmd.set_scene_message("${key}", "${message}")`,
  }),
  /** `cmd.scene_order(names, sort, location)` (`viewing.py:961`). */
  order: (names: readonly string[], location = ''): SceneAction => ({
    fn: 'cmd.scene_order',
    args: [names.join(' ')],
    kwargs: location ? { location } : {},
    echo: `cmd.scene_order("${names.join(' ')}"${location ? `, location="${location}"` : ''})`,
  }),
  sort: (): SceneAction => ({
    fn: 'cmd.scene_order',
    args: ['*'],
    kwargs: { sort: 1 },
    echo: 'cmd.scene_order("*", sort=1)',
  }),
  cache: (mode: 'enable' | 'optimize' | 'read_only' | 'disable'): SceneAction => ({
    fn: 'cmd.cache',
    args: [mode],
    echo: `cmd.cache("${mode}")`,
  }),
  /**
   * The Scene menu's `Buttons` check item (`_gui.py:801`).
   *
   * `('check', 'Buttons', 'scene_buttons')` is a plain global setting, and it
   * is the one that decides whether `SceneDrawButtons` (`Scene.cpp:2885`)
   * paints the overlay at all — so the checkbox has to write the SETTING, not
   * a piece of client state, or the overlay and the menu disagree the moment
   * anything else touches it.
   */
  buttons: (on: boolean): SceneAction => ({
    fn: 'cmd.set',
    args: ['scene_buttons', on ? 1 : 0],
    echo: `cmd.set('scene_buttons', ${on ? 1 : 0})`,
  }),
} as const;

/**
 * `pymol.menu.scene_menu`'s reply -> the popup nodes `RowMenu` renders.
 *
 * `menu.py:1842` returns `[[code, text, command], ...]` and NOTHING ELSE: no
 * submenus, no lazy callables. So the encoding is the flat case of the bridge's
 * `panels/objects.py::_encode_items`, done here because the menu itself needs
 * no bridge module — `menu` is an addressable root (`policy/base.py`), the
 * function ignores its `self_cmd` argument, and the reply is plain lists the
 * codec already serialises. One round trip, no new server surface.
 *
 * Anything that is not `[code, text, command]` is dropped rather than guessed
 * at, so a future submenu shows up as a missing row and not as a broken one.
 */
export function encodeMenu(raw: unknown): PanelMenuNode[] {
  if (!Array.isArray(raw)) return [];
  const out: PanelMenuNode[] = [];
  raw.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 2) return;
    const command = entry[2];
    const code = Number(entry[0]);
    if (code !== 0 && code !== 1 && code !== 2) return;
    out.push({
      code: code as PanelMenuCode,
      text: String(entry[1]),
      path: [index],
      command: typeof command === 'string' ? command : '',
    });
  });
  return out;
}

/**
 * Move `name` to sit immediately before/after `anchor`, as a full order list.
 *
 * `scene_order` with `location='current'` inserts the block at the position of
 * `names[0]`, which is how the drag on the scene buttons works
 * (`packages/engine/layer1/Scene.cpp:2885`, `cmd.scene_order([a,b])`). Computing the whole
 * order client-side and sending it once is equivalent and easier to test.
 */
/**
 * The scene_order the BUTTON STRIP emits mid-drag — `SceneMouse.cpp:1274-1298`.
 *
 * Not `reorder()` below. The strip does not compute a whole new order and send
 * it; PyMOL sends a two-name block and lets `MovieSceneOrder` place it, and it
 * sends one per row crossed, not one per gesture:
 *
 *   over === 0        `cmd.scene_order(['pressed'], location='top')`
 *   otherwise         `cmd.scene_order([anchor, 'pressed'])` — location
 *                     defaults to `current`, which inserts the block at the
 *                     slot `anchor` occupies (`MovieScene.cpp:140-146`), so
 *                     `pressed` ends up immediately after `anchor`.
 *
 * `anchor` is the row BEFORE the one under the pointer when dragging up, and
 * the row under the pointer when dragging down. That asymmetry is the C's
 * `SceneElem* first = elem - 1; if (first >= pressed) first = elem;` — a
 * POINTER comparison against the pressed element, which is a comparison of
 * indices. Both branches land the dragged scene where the pointer is.
 *
 * Returns null when there is nothing to send (same row).
 */
export function dragOrder(
  order: readonly string[],
  pressedIndex: number,
  overIndex: number,
): SceneAction | null {
  const pressed = order[pressedIndex];
  if (pressed === undefined || overIndex === pressedIndex) return null;
  if (overIndex < 0 || overIndex >= order.length) return null;
  if (overIndex === 0) return sceneActions.order([pressed], 'top');
  const anchorIndex = overIndex - 1 >= pressedIndex ? overIndex : overIndex - 1;
  const anchor = order[anchorIndex];
  if (anchor === undefined || anchor === pressed) return null;
  return sceneActions.order([anchor, pressed]);
}

export function reorder(order: readonly string[], name: string, beforeIndex: number): string[] {
  const without = order.filter((entry) => entry !== name);
  const at = Math.max(0, Math.min(without.length, beforeIndex));
  return [...without.slice(0, at), name, ...without.slice(at)];
}

/** `_gui.py:61` — Recall/Store/Clear each list F1..F12. */
export const F_KEYS = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);

/**
 * Why a scene rename is refused, or `null` if it is fine.
 *
 * `packages/engine/modules/pmg_qt/scene_bin_gui.py:360-377` refuses two things — a blank name
 * and a name containing a space — and reports both by printing to the console
 * while the cell silently reverts. The refusals are kept; the silence is not
 * (the inventory row asks for a visible inline error instead).
 *
 * The third case is not upstream's and is added because upstream's outcome is
 * worse than an error: `cmd.scene(old, 'rename', new_key=existing)` overwrites
 * the scene already holding that name, and the panel would just show one fewer
 * row with no explanation.
 */
export function renameProblem(
  next: string,
  current: string,
  existing: readonly string[],
): string | null {
  if (next.trim() === '') return 'a scene name cannot be blank';
  // Tested before trimming: an interior space is the case that matters, and
  // `scene_order` is a SPACE-SEPARATED list, so a name with a space in it
  // could never be ordered again.
  if (/\s/.test(next)) return 'a scene name cannot contain spaces';
  if (next !== current && existing.includes(next)) return `"${next}" already exists`;
  return null;
}
