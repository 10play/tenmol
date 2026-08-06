/**
 * Named camera views — `cmd.view(key, action, animate)` (`viewing.py:783`).
 *
 * Scenes and views look alike and are not alike. A scene is C++ state with a
 * storemask, a thumbnail, per-atom colours and reps; a view is EIGHTEEN FLOATS
 * in a Python dict (`pymol._view_dict`) with a `Shortcut` index beside it
 * (`pymol._view_dict_sc`). Nothing in C knows views exist; they ride in the
 * `.pse` through `session_save_views` / `session_restore_views`
 * (`viewing.py:1187`, registered in `cmd.py:41-45`).
 *
 * Three things about that API are load-bearing here and all three are pinned in
 * `packages/bridge/tests/test_wf_camera.py`:
 *
 *  1. THERE IS NO GETTER. `pymol._view_dict` is an attribute, and the bridge
 *     dispatcher only invokes callables, so `cmd._pymol._view_dict` and friends
 *     are refused. `cmd.view('*')` only PRINTS. The one machine-readable
 *     listing is the message of a failed lookup — `Shortcut.auto_err`
 *     (`shortcut.py:188-194`) puts the sorted keyword list in the exception —
 *     which, unlike the printout, comes back in the reply to the request that
 *     asked for it instead of in the shared feedback ring.
 *
 *     This is a workaround, not a design. A `get_view_list` export beside
 *     `get_scene_panel` in `packages/bridge/tenmol_bridge/panels/movie.py` would delete
 *     `parseViewNames` entirely; that file is outside this slot, so the gap is
 *     reported rather than closed.
 *
 *  2. `action='update'` IS DEAD CODE. `view_sc = Shortcut(['store','recall',
 *     'clear'])` (`viewing.py:64`) is applied before the branch at
 *     `viewing.py:838`, and 'update' is not a prefix of any of the three, so it
 *     always raises. Overwriting is `store` on an existing key.
 *
 *  3. THE KEY IS A PREFIX, NOT A NAME. `view al` recalls `alpha`, and stops
 *     working the moment `album` exists. An exact name always wins
 *     (`shortcut.py:118-119`), so sending the full name from a list is safe —
 *     sending what the user typed is not.
 */

export interface ViewAction {
  fn: string;
  args: readonly unknown[];
  kwargs?: Record<string, unknown>;
  echo: string;
}

const view = (
  args: readonly unknown[],
  kwargs: Record<string, unknown> = {},
): ViewAction => {
  const rendered = [
    ...args.map((a) => (typeof a === 'string' ? `"${a}"` : String(a))),
    ...Object.entries(kwargs).map(([k, v]) => `${k}=${String(v)}`),
  ].join(', ');
  return { fn: 'cmd.view', args, kwargs, echo: `cmd.view(${rendered})` };
};

/**
 * A key no view can be a prefix of, used to provoke the listing.
 *
 * `Shortcut.auto_err` only raises when `interpret()` misses entirely; a key
 * that happened to be a prefix of a real view would RECALL it instead, which
 * would move the camera behind the user's back.
 */
export const VIEW_PROBE_KEY = '__tenmol_view_probe__';

/** The `cmd.view` command surface — store and recall named camera views. */
export const viewActions = {
  /** Overwrite-or-create. `store` is the only write; see (2) above. */
  store: (key: string) => view([key, 'store']),
  /**
   * `animate` defaults to -1, which is PyMOL's own default: the camera sweeps
   * for `animation_duration` (0.75 s) when `animation` is on, and jumps when it
   * is off. The animation runs SERVER-SIDE — the client must not tween as well
   * or the two interpolations fight (`feature-parity.md:330`).
   */
  recall: (key: string, animate = -1) => view([key, 'recall'], { animate }),
  /** Ctrl-click / rapid browse: no sweep whatever the settings say. */
  recallInstant: (key: string) => view([key, 'recall'], { animate: 0 }),
  clear: (key: string) => view([key, 'clear']),
  /** `key='*'` + clear is the only bulk operation (`viewing.py:823`). */
  clearAll: () => view(['*', 'clear']),
  /** Provokes the listing; ALWAYS fails, and the failure is the answer. */
  probe: () => view([VIEW_PROBE_KEY, 'recall']),
} as const;

/**
 * The sorted view names out of a failed-lookup message, or `null`.
 *
 * Both real shapes, measured on this build:
 *
 *     "Error: unknown view: 'X'. Choices:\n"
 *     "Error: unknown view: 'X'. Choices:\n  alpha  beta   mu   "
 *
 * The block is `parsing.list_to_str_list` output — names padded into columns
 * of the widest name — so whitespace is the separator and nothing else is.
 * `null` (not `[]`) when the message is not a view listing at all, so a
 * transport error cannot be mistaken for "there are no views" and wipe the
 * panel.
 *
 * KNOWN LIMIT, inherited: `auto_err` omits the block entirely above 99 views
 * (`shortcut.py:191`), which reads here as an empty list.
 */
export function parseViewNames(message: string): string[] | null {
  if (!/unknown view:/.test(message)) return null;
  const at = message.indexOf('Choices:');
  if (at < 0) return [];
  return message.slice(at + 'Choices:'.length).split(/\s+/).filter(Boolean);
}

/**
 * Why a view name is refused, or `null`.
 *
 * Upstream refuses nothing at all, and two of these three are names that get
 * silently lost rather than rejected:
 *
 *  * blank — `Shortcut.auto_err` returns early for `''` (`shortcut.py:183`),
 *    so the view is stored under a key that can never be looked up;
 *  * whitespace — the listing this panel reads back is whitespace-separated,
 *    and so is every other place PyMOL prints a name list;
 *  * leading underscore — `store` appends to the index, but the next `clear`
 *    rebuilds it with `Shortcut(keys)`, whose constructor DROPS `_`-prefixed
 *    keywords (`shortcut.py:27-31`). The view stays in the dict and becomes
 *    permanently unrecallable. Pinned in `test_wf_camera.py`.
 *
 * `*` is not refused: it is a legal argument meaning "all", and storing under
 * it is simply impossible to recall, which the blank/`*` check below covers.
 */
export function viewNameProblem(next: string): string | null {
  if (next.trim() === '') return 'a view name cannot be blank';
  if (/\s/.test(next)) return 'a view name cannot contain spaces';
  if (next.startsWith('_')) return 'a view name cannot start with "_"';
  if (next === '*') return '"*" means all views, it cannot be a name';
  return null;
}
