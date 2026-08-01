/**
 * Every write the scene surface makes, as `cmd.scene` / `cmd.scene_order`.
 *
 * `cmd.scene(key, action, message, view, color, active, rep, frame, animate,
 * new_key, hand, quiet, sele)` (`modules/pymol/viewing.py:1034`) is the whole
 * API; the C side is `MovieSceneRecall`/`Store`/`Order`
 * (`layer3/MovieScene.cpp:755,700,733,88`). The semantics reproduced here:
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
} as const;

/**
 * Move `name` to sit immediately before/after `anchor`, as a full order list.
 *
 * `scene_order` with `location='current'` inserts the block at the position of
 * `names[0]`, which is how the drag on the scene buttons works
 * (`layer1/Scene.cpp:2885`, `cmd.scene_order([a,b])`). Computing the whole
 * order client-side and sending it once is equivalent and easier to test.
 */
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
 * `modules/pmg_qt/scene_bin_gui.py:360-377` refuses two things — a blank name
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
