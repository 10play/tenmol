/**
 * The `= None` toolkit seams the MENU BAR itself can fill.
 *
 * `PyMOLDesktopGUI` leaves every dialog entry point unbound
 * (`modules/pymol/_gui.py:13-40`) and Qt's main window binds them to bound
 * methods of itself (`pymol_qt_gui.py:878-897`):
 *
 *     settings_edit_all_dialog  -> PyMOLAdvancedSettings(self, cmd).show()
 *     shortcut_menu_edit_dialog -> PyMOLShortcutMenu(self, saved, cmd).show()
 *     edit_colors_dialog        -> the `forms/colors.ui` window   (:547)
 *     scene_panel_menu_dialog   -> scene_bin_gui.ScenePanel(self).show()
 *
 * All four surfaces EXIST in this client already; what was missing was the
 * `self` — one object that owns both the menu and the dialogs. Three of them
 * are self-contained components in other feature directories and are mounted
 * HERE, in a modal host, which is the closest analogue of Qt's `QDialog.show()`
 * (a second top-level window owned by the main window). The fourth,
 * Advanced Settings, is already a floating window managed by
 * `features/dialogs`' own store, so this opens THAT rather than a second copy —
 * `if self.advanced_settings_dialog is None` is the same "one instance, shown
 * again" rule.
 *
 * The lazy import matters: `features/colors` fetches a 5388-entry colour table
 * and `features/scenes` polls the scene bin. Neither should start because the
 * menu bar mounted; they start when the leaf is clicked, exactly as the Qt
 * `from .advanced_settings_gui import …` inside each handler does.
 */

import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { openPanel } from '../../shell/panelHooks';
import type { MenuRuntime } from './actions';

/** Which of the locally hosted dialogs is showing. Qt: which QDialog is shown. */
export type ToolkitDialog = 'colors' | 'shortcuts' | 'scenes' | null;

const ColorEditorHost = lazy(async () => {
  const [{ ColorEditor }, { usePalette }] = await Promise.all([
    import('../colors/ColorEditor'),
    import('../colors/usePalette'),
  ]);
  return {
    default: function ColorEditorWithPalette() {
      // `usePalette` is a module singleton (`features/colors/usePalette.ts`), so
      // this shares the table with the `colors` overlay instead of fetching a
      // second one.
      return <ColorEditor palette={usePalette()} />;
    },
  };
});

const ShortcutEditorHost = lazy(async () => {
  const { ShortcutEditor } = await import('../shortcuts/ShortcutEditor');
  return { default: ShortcutEditor };
});

const ScenePanelHost = lazy(async () => {
  const { ScenePanel } = await import('../scenes/ScenePanel');
  return { default: ScenePanel };
});

const TITLES: Record<Exclude<ToolkitDialog, null>, string> = {
  // Qt window titles: `colors.ui` is "Color Editor"; `PyMOLShortcutMenu` sets
  // "PyMOL Shortcut Menu"; `scene_bin_gui.ScenePanel` sets "Scene Panel".
  colors: 'Color Editor',
  shortcuts: 'PyMOL Shortcut Menu',
  scenes: 'Scene Panel',
};

export interface ToolkitHooks {
  /** Merged into `MenuRuntime.hooks`. */
  hooks: Readonly<Record<string, (args: unknown[]) => void | Promise<void>>>;
  /** The open dialog, or null. Render it inside the menu bar. */
  dialog: ToolkitDialog;
  close: () => void;
}

export function useToolkitHooks(note: MenuRuntime['note']): ToolkitHooks {
  const [dialog, setDialog] = useState<ToolkitDialog>(null);
  const close = useCallback(() => setDialog(null), []);

  const hooks = useMemo(
    () => ({
      edit_colors_dialog: () => setDialog('colors'),
      shortcut_menu_edit_dialog: () => setDialog('shortcuts'),
      scene_panel_dialog: () => setDialog('scenes'),
      scene_panel_menu_dialog: () => setDialog('scenes'),

      settings_edit_all_dialog: async () => {
        // Two steps, and both are needed: an overlay slot is not MOUNTED until
        // the shell opens it, and the window itself is a row in
        // `features/dialogs`' store. `openPanel` runs the intent after the
        // slot's component mounts (`shell/panelHooks.ts`), which is why this
        // cannot simply be two statements in a row.
        const { dialogsStore } = await import('../dialogs/store');
        openPanel('dialogs', () => dialogsStore.open('advanced-settings'));
      },

      /**
       * `initializePlugins` (`pymol_qt_gui.py:970`) adds a `Plugin Manager`
       * entry and re-points the registry. The registry half belongs to WP-25
       * and is not built; opening the manager is the half that exists, and it
       * says so rather than implying the legacy plugin surface came with it.
       */
      initializePlugins: () => {
        openPanel('plugin-manager');
        note(
          ' Plugin Manager opened. The legacy `Plugin > Legacy Plugins` registry ' +
            '(pmg_tk PmwMenuBar) is not ported — WP-25 owns it.',
          'warning',
        );
      },
    }),
    [note],
  );

  return { hooks, dialog, close };
}

/**
 * The modal host. One at a time, Escape closes, click-outside closes — the
 * behaviour of the `QDialog`s these replace, minus the ability to leave one
 * open behind the main window (a browser has no second window).
 */
export function ToolkitDialogHost({
  dialog,
  onClose,
}: {
  dialog: ToolkitDialog;
  onClose: () => void;
}) {
  if (dialog === null) return null;

  // `ShortcutEditor` IS a modal already (`.scmodal`, its own scrim, its own
  // close button, `role="dialog"`), so it is rendered bare. Wrapping it put one
  // dialog inside another and stacked two scrims.
  if (dialog === 'shortcuts') {
    return (
      <div data-dialog="shortcuts">
        <Suspense fallback={<div className="toolkit-dialog__loading">loading…</div>}>
          <ShortcutEditorHost onClose={onClose} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="about__scrim" role="presentation" onMouseDown={onClose}>
      <div
        className="toolkit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[dialog]}
        data-dialog={dialog}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="toolkit-dialog__title">
          {TITLES[dialog]}
          <button type="button" className="toolkit-dialog__x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="toolkit-dialog__body">
          <Suspense fallback={<div className="toolkit-dialog__loading">loading…</div>}>
            {dialog === 'colors' && <ColorEditorHost />}
            {dialog === 'scenes' && <ScenePanelHost />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
