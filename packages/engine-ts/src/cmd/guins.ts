/**
 * The `cmd.gui.*` namespace — ported from `pymol/gui.py`.
 *
 * `gui.py` is the "abstract (external or internal) gui control interface": every
 * verb is about a *desktop* GUI — the legacy Tkinter `PMGApp`, the modern
 * `PyMOLQtGUI`/`QMainWindow`, or a file dialog those windows raise. tenmol runs
 * the engine headless with the UI living in the browser, so there is no PMGApp
 * and no Qt window to talk to. Each verb is therefore ported as a *documented
 * no-op*: we model whatever observable intent PyMOL expresses (e.g. the external
 * GUI's shown/hidden state) and return a sensible value, while the actual
 * windowing side effect — `deiconify()`/`withdraw()`, `session_save_as()`,
 * `file_save_png()` — has no counterpart here and is intentionally skipped.
 *
 * Porting these still matters: registering `gui.<name>` makes `cmd.gui.<name>`
 * resolve instead of throwing `NotPorted`, matching PyMOL's public surface.
 *
 * Registers its handlers through the shared {@link RegistrarCtx}.
 */
import type { Json } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

export function registerGuiNs(ctx: RegistrarCtx): void {
  /**
   * The external GUI's shown/hidden intent. PyMOL's `ext_show`/`ext_hide` post
   * `deiconify()`/`withdraw()` to the legacy app's fifo; there is no window
   * here, so we track only the observable boolean the caller is really asking
   * for. Starts shown, matching a freshly-launched external GUI.
   */
  let extGuiVisible = true;

  /* ------------------------ app / window accessors ---------------------- */

  // gui.get_pmgapp: returns the legacy Tkinter PMGApp, lazily creating one. No
  // legacy external GUI exists in-engine, so there is nothing to return.
  ctx.command('gui.get_pmgapp', (): Json => null);

  // gui.get_qtwindow: returns the PyMOLQtGUI/QMainWindow, or None when Qt is not
  // importable. Headless in the browser, we take that None branch faithfully.
  ctx.command('gui.get_qtwindow', (): Json => null);

  // gui.createlegacypmgapp: constructs the legacy Tk app. No windowing toolkit
  // is available in-engine, so this is a no-op that yields no app instance.
  ctx.command('gui.createlegacypmgapp', (): Json => null);

  /* --------------------------- external gui control --------------------- */

  // gui.ext_show: raise/deiconify the external GUI. The window is a no-op here;
  // we record the shown intent and return the resulting visibility.
  ctx.command('gui.ext_show', (): Json => {
    extGuiVisible = true;
    return extGuiVisible;
  });

  // gui.ext_hide: withdraw/hide the external GUI. Windowing is a no-op; we
  // record the hidden intent and return the resulting visibility.
  ctx.command('gui.ext_hide', (): Json => {
    extGuiVisible = false;
    return extGuiVisible;
  });

  /* ------------------------------ common actions ------------------------ */

  // gui.save_as: PyMOL asks the desktop window to pop a "Save Session As…"
  // dialog (`session_save_as()`). Raising a file dialog is the web client's
  // responsibility, so there is nothing to model in-engine — a documented no-op.
  ctx.command('gui.save_as', (): Json => null);

  // gui.save_image: likewise pops the desktop "Save Image…" dialog
  // (`file_save_png()`). Env-bound to the desktop window; no-op in-engine.
  ctx.command('gui.save_image', (): Json => null);
}
