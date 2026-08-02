/**
 * WP-18's half of the File menu: binding every `= None` file seam of
 * `PyMOLDesktopGUI` to the dialog that already implements it.
 *
 * THE PROBLEM THIS CLOSES. `packages/engine/modules/pymol/_gui.py:13-38` leaves twenty-odd
 * entry points unbound and Qt fills each with a bound method of its main
 * window (`pymol_qt_gui.py:878-897`). Here the menu bar is one feature and the
 * dialogs are another, so every File leaf rendered DISABLED, tooltipped
 * "not built yet — WP-18 owns it", even though WP-18 had built and verified
 * all of them. `shell/panelHooks.ts` shipped the registry that fixes it
 * (`registerMenuHook`); this module is the caller it was waiting for, and it
 * lives in `features/files/` precisely so no shared file is edited.
 *
 * TWO HOPS, and both are needed:
 *
 *   1. `openPanel('files', intent)` — `FilesPanel` is an OVERLAY slot, so it
 *      is not mounted until the shell opens it. The intent is queued against
 *      the mount and drains in `panelMounted`.
 *   2. a window CustomEvent carrying the action id. The queue that drives the
 *      dialogs (`pending`, `nextStep`, `setDialog`) is `FilesPanel` component
 *      state and cannot be reached from outside it — the same wall that made
 *      `FileDropTarget`'s Ctrl+O fall back to the browser file picker. The
 *      event is the panel's imperative seam; `FilesPanel` runs the matching
 *      entry of its own menu table, so a leaf clicked in the menu bar does
 *      *exactly* what the same leaf in the panel's own strip does.
 *
 * WHERE IT IS INSTALLED: `FileDropTarget`, mounted unconditionally by the
 * viewport slot. Registering from `FilesPanel` would only bind the hooks while
 * the panel happened to be open, which is the bug that moved the drop handler
 * and the accelerators there in the first place.
 */

import { openPanel, registerMenuHook } from '../../shell/panelHooks';

/** Event name. `detail.action` is a `FilesPanel` menu id (or a log action). */
export const FILES_ACTION_EVENT = 'tenmol:files-action';

export interface FilesActionDetail {
  action: string;
  /** Only for `open-paths`: the files to push through the open pipeline. */
  paths?: readonly string[];
}

/** `open-paths` — the action id that means "run `load_dialog` on these". */
export const FILES_OPEN_PATHS = 'open-paths';

/**
 * `_gui.py` hook name -> the action `FilesPanel` performs for it.
 *
 * Every id is either an item id in `FilesPanel`'s own menu table or one of the
 * three `log-*` actions it handles separately. The mapping is exported so the
 * test can assert it against the harvested menu tree rather than against a
 * copy of itself: a hook that appears in `generated/menudata.ts` and not here
 * is a File leaf that is still dead.
 */
export const FILE_MENU_HOOKS: Readonly<Record<string, string>> = {
  // Open... / Get PDB... (`pymol_qt_gui.py:640-664`)
  file_open: 'open',
  file_fetch_pdb: 'fetch',
  // Save Session / Save Session As... (`:666-672`)
  session_save: 'session-save',
  session_save_as: 'session-save-as',
  // Export Molecule / Map / Alignment (`file_dialogs.py:409-568`)
  file_save: 'export-molecule',
  file_save_map: 'export-map',
  file_save_aln: 'export-aln',
  // Export Image As ▸ … — PNG is the dialog, the other five are one-shot
  // `save <file>, format=<fmt>` writes driven by `hello.geometryExports`.
  file_save_png: 'png',
  file_save_wrl: 'geo-wrl',
  file_save_dae: 'geo-dae',
  file_save_gltf: 'geo-gltf',
  file_save_pov: 'geo-pov',
  file_save_stl: 'geo-stl',
  // Export Movie As ▸ … (`pymol_qt_gui.py:792-820`)
  file_save_mpeg: 'movie-mpeg',
  file_save_mov: 'movie-mov',
  file_save_mpng: 'movie-png',
  // Log File ▸ Open / Resume / Append (`:823-845`). `Close` is a plain
  // `cmd.log_close` call in the menu data and needs no hook at all.
  log_open: 'log-open',
  log_resume: 'log-resume',
  log_append: 'log-append',
  // Run Script... (`:848-861`) and Working Directory ▸ Change... (`:863-869`)
  file_run: 'run',
  cd_dialog: 'cd',
};

/**
 * `File ▸ Edit pymolrc` — the last dead leaf of this menu, now bound.
 *
 * It is NOT in {@link FILE_MENU_HOOKS} because it is not a `FilesPanel` action:
 * it opens `features/texteditor`'s window, and the module that does so is
 * `../texteditor/openEditor`. It is registered here anyway, and deliberately,
 * because THIS is the file whose installer runs from something always mounted
 * (`FileDropTarget`). Registering it from `TextEditorSlot` would bind the hook
 * only while an editor was already open, which is the dead-handler bug four
 * features have now shipped.
 *
 * The import is DYNAMIC so the menu bar's File menu does not pull the editor,
 * its syntax highlighter and the dialogs store into the initial bundle — the
 * same reason `MenuBar` imports `requestFilesOpen` on click.
 */
export const EDIT_PYMOLRC_HOOK = 'edit_pymolrc';

export async function openPymolrc(): Promise<void> {
  const { openPymolrcEditor } = await import('../texteditor/openEditor');
  openPymolrcEditor();
}

/**
 * The seams deliberately NOT bound here, recorded so each absence is a decision
 * rather than an oversight:
 *
 *   `new_window`    — impossible by construction: one engine per bridge.
 *                     `UNAVAILABLE_HOOKS` already says so in the tooltip.
 *
 * `file_autoload_mtz` is in `_gui.py`'s seam list but no Qt menu references
 * it, so there is no leaf to light up.
 *
 * `edit_pymolrc` used to be on this list. It is now bound by
 * {@link installFileMenuHooks} through {@link openPymolrc}; the reason it was
 * unbound — `TextEditorPanel` ignoring `spec.arg` — is gone.
 */
export const UNBOUND_FILE_HOOKS: readonly string[] = ['new_window', 'file_autoload_mtz'];

/**
 * Every `_gui.py` File seam {@link installFileMenuHooks} actually registers.
 *
 * `FILE_MENU_HOOKS` is not that list any more: `edit_pymolrc` is bound too, and
 * it is not in the table because it is not a `FilesPanel` action. An inventory
 * test that walks the harvested tree must check against THIS.
 */
export const BOUND_FILE_HOOKS: readonly string[] = [
  ...Object.keys(FILE_MENU_HOOKS),
  EDIT_PYMOLRC_HOOK,
];

/**
 * Open the File dialogs panel and ask it to run `action`.
 *
 * THE DISPATCH IS A MICROTASK, and that is load-bearing rather than defensive.
 * `FeatureSlot` renders `<MountMarker/>` *before* `<Panel/>`, so within the
 * commit that mounts the slot React runs the marker's effect — which is what
 * drains this intent — BEFORE `FilesPanel`'s own effects have added the
 * listener. Dispatching synchronously there hits nobody and the leaf silently
 * does nothing, which is the exact failure mode this row exists to remove.
 * Passive effects for a commit are flushed in one synchronous loop, so a
 * microtask queued inside it runs once every effect in that commit has run.
 */
export function requestFilesAction(action: string, paths?: readonly string[]): void {
  openPanel('files', () => {
    queueMicrotask(() => {
      // `exactOptionalPropertyTypes`: an absent `paths` must be ABSENT, not
      // present-and-undefined.
      const detail: FilesActionDetail = paths ? { action, paths } : { action };
      window.dispatchEvent(new CustomEvent<FilesActionDetail>(FILES_ACTION_EVENT, { detail }));
    });
  });
}

/**
 * `load_dialog(fname)` for a path somebody else chose — row 246.
 *
 * Qt's `Open Recent` submenu calls `load_dialog(fname)` for the entry that was
 * clicked (`pymol_qt_gui.py:367-375`), i.e. the FULL dispatcher: a `.pse` asks
 * the partial question, a `.mtz` opens the reflection dialog, a `.dcd` the
 * trajectory one. `MenuBar`'s dynamic list runs a bare `load <file>` because
 * WP-14 has no way to reach that pipeline — this is the way, and it is the
 * same entry point the panel's own Open Recent dialog uses.
 */
export function requestFilesOpen(paths: readonly string[]): void {
  requestFilesAction(FILES_OPEN_PATHS, paths);
}

/**
 * Bind every hook in {@link FILE_MENU_HOOKS}. Returns an unregister function;
 * `registerMenuHook` is last-registration-wins, so a hot reload re-binding the
 * same names is correct rather than duplicated.
 */
export function installFileMenuHooks(): () => void {
  const offs = Object.entries(FILE_MENU_HOOKS).map(([hook, action]) =>
    registerMenuHook(hook, () => requestFilesAction(action)),
  );
  offs.push(registerMenuHook(EDIT_PYMOLRC_HOOK, () => openPymolrc()));
  return () => {
    for (const off of offs) off();
  };
}
