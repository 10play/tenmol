/**
 * Draw / Ray render dialog — the two-page stacked form of
 * `packages/engine/modules/pmg_qt/pymol_qt_gui.py:673` (`forms/render.ui`).
 *
 * Page 1 picks a size and renders; page 2 saves the result.
 *
 * WHAT DIFFERS FROM QT, AND WHY:
 *
 * - Qt's page 2 shows the image in a label and offers "Copy Image to
 *   Clipboard" via `pymol.cmd._copy_image`. Here the render lands in the
 *   VIEWPORT: `_bridge.ray()` pushes its result onto the pixel stream as a
 *   still (`render/framestream.py:1652`), which is the same image by the same
 *   renderer. So page 2 offers save, and says where the picture is instead of
 *   duplicating it into a second canvas.
 * - Clipboard IS offered now, by a different route. Upstream's `cmd._copy_image`
 *   raises NotImplementedError by default; the bridge REPLACES it with a shim
 *   that dispatches to a registered handler and returns None when there is
 *   none (measured — it does not raise here). Either way a browser cannot be
 *   handed a QImage — so `cmd.tenmol_files.copy_image_png` returns the PRIOR
 *   render as PNG bytes and the client writes them with
 *   `navigator.clipboard.write(new ClipboardItem(...))`. `prior=1` matters: it
 *   copies what is on screen instead of re-rendering, which for a ray trace
 *   could be minutes of work to reproduce.
 * - Save writes SERVER-side through `cmd.png(path, prior=1, dpi=...)`. This is
 *   a local desktop replacement with full filesystem access; a browser download
 *   would re-encode and lose the dpi metadata `prior=1` exists to preserve.
 */

import { useCallback, useEffect, useReducer, useState } from 'react';

import { useSession } from '../../app';
import { registerMenuHook } from '../../shell/panelHooks';
import { INITIAL, derive, reducer, type Units } from './useRenderForm';
import './render.css';

type Page = 'setup' | 'result';

/**
 * The `_gui.py` seam name Qt fills with a bound method
 * (`pymol_qt_gui.py:232`: `('Draw/Ray', WidgetMenu(self).setSetupUi(self.render_dialog))`).
 * The External GUI's Draw/Ray quick button has been looking for exactly this
 * string since wave 8 (`features/console/QuickButtons.tsx:90,147`) and printing
 * the missing line when it was absent.
 */
export const RENDER_HOOK = 'render_dialog';

/** Also accepted, for symmetry with `features/builder`'s `tenmol:open-builder`. */
export const OPEN_EVENT = 'tenmol:open-render';

/** The Draw/Ray dialog: a size-and-render setup page and a save page for the result. */
export function RenderDialog() {
  const session = useSession();
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [page, setPage] = useState<Page>('setup');
  /*
   * COLLAPSED BY DEFAULT. `registry.ts` declares this slot in the `viewport`
   * region and that file is frozen, so the panel renders alongside the GL
   * surface rather than in the overlay layer. Rendering it expanded took half
   * the viewport permanently — the same mistake the overlay region made with
   * ten panels at once, just smaller. It opens on demand instead.
   */
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<null | 'draw' | 'ray'>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savePath, setSavePath] = useState('');
  const d = derive(state);

  /*
   * THE OPEN SEAM. Until now this component could only be opened by itself:
   * `expanded` was local state, it took no props, published no event and
   * registered no hook, so Qt's one-click Draw/Ray button (a `WidgetMenu`
   * wrapping `render_dialog`) had nothing to call and rendered as a labelled
   * TODO. Rows 00:58 and 00:73 both stood open on this one line.
   *
   * Registering from HERE is what makes it work: this slot is in the `viewport`
   * region, which `AppShell` mounts unconditionally, so the component exists
   * from first paint — collapsed to its `Ray / Draw` tab. Registering from an
   * overlay panel instead is the mistake three features shipped: an overlay
   * only exists while it is open, so its hook is absent exactly when something
   * needs it to open the panel.
   *
   * Opening is idempotent, and it must be: Qt's WidgetMenu re-shows an already
   * built dialog rather than building a second one.
   */
  useEffect(() => {
    const open = () => setExpanded(true);
    const unregister = registerMenuHook(RENDER_HOOK, open);
    window.addEventListener(OPEN_EVENT, open);
    return () => {
      unregister();
      window.removeEventListener(OPEN_EVENT, open);
    };
  }, []);

  // Seed dpi from PyMOL, exactly as the Qt form seeds its combo from
  // `image_dots_per_inch` when > 0.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const dpi = await session.call<number>('cmd.get_setting_int', ['image_dots_per_inch']);
        if (!cancelled && typeof dpi === 'number' && dpi > 0) dispatch({ type: 'dpi', value: dpi });
      } catch {
        /* keep the default; the console already reported it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const useViewport = useCallback(async () => {
    try {
      const vp = await session.call<[number, number]>('cmd.get_viewport');
      if (Array.isArray(vp) && vp.length >= 2) {
        dispatch({ type: 'viewport', width: vp[0], height: vp[1] });
      }
    } catch {
      /* reported in the console */
    }
  }, [session]);

  const render = useCallback(
    async (mode: 'draw' | 'ray') => {
      setBusy(mode);
      setStatus(null);
      try {
        if (mode === 'ray') {
          // Qt sets opaque_background from the transparent checkbox first.
          await session.call('cmd.set', ['opaque_background', state.transparent ? 0 : 1]);
          await session.call('_bridge.ray', [state.width, state.height]);
        } else {
          await session.run(`draw ${state.width}, ${state.height}`);
        }
        setStatus(`${mode} ${state.width}x${state.height} complete — shown in the viewport`);
        setPage('result');
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [session, state.width, state.height, state.transparent],
  );

  const copyImage = useCallback(async () => {
    setStatus(null);
    try {
      const result = await session.call<{ ok: boolean; base64: string; error: string | null }>(
        'cmd.tenmol_files.copy_image_png',
        [state.dpi],
      );
      if (!result.ok) {
        // Qt PRINTS "no prior image"; showing it in place is the same
        // information without a trip to the console.
        setStatus(result.error ?? 'no prior image');
        return;
      }
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('image copied to the clipboard');
    } catch (e) {
      /*
       * The clipboard API is gated on a secure context AND a user gesture, and
       * refuses outright in some browsers. Saying which failed matters: "copy
       * failed" reads as a broken render when the render was fine.
       */
      setStatus(
        `clipboard write failed (${e instanceof Error ? e.message : String(e)}) — ` +
          'the image is still in the viewport; use Save image instead.',
      );
    }
  }, [session, state.dpi]);

  const save = useCallback(async () => {
    const path = savePath.trim();
    if (!path) {
      setStatus('enter a path to save to');
      return;
    }
    try {
      // prior=1 saves the image just rendered rather than re-rendering it.
      await session.call('cmd.png', [path], { prior: 1, dpi: state.dpi });
      setStatus(`saved ${path}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }, [session, savePath, state.dpi]);

  const num = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(3)) : 0);

  if (!expanded) {
    return (
      <button
        type="button"
        className="render__tab"
        title="Ray / Draw render dialog"
        onClick={() => setExpanded(true)}
      >
        Ray / Draw
      </button>
    );
  }

  return (
    <div className="render">
      <div className="render__title">
        Ray / Draw{page === 'result' ? ' — result' : ''}
        <button
          type="button"
          className="render__collapse"
          aria-label="close Ray / Draw"
          onClick={() => setExpanded(false)}
        >
          x
        </button>
      </div>

      {page === 'setup' && (
        <div className="render__body">
          <div className="render__grid">
            <label htmlFor="rd-w">Width</label>
            <input
              id="rd-w"
              type="number"
              min={1}
              value={state.width}
              onChange={(e) => dispatch({ type: 'width', px: Number(e.target.value) })}
            />
            <span className="render__unit">px</span>
            <input
              type="number"
              step={0.01}
              value={num(d.widthUnits)}
              onChange={(e) => dispatch({ type: 'widthUnits', value: Number(e.target.value) })}
            />

            <label htmlFor="rd-h">Height</label>
            <input
              id="rd-h"
              type="number"
              min={1}
              value={state.height}
              onChange={(e) => dispatch({ type: 'height', px: Number(e.target.value) })}
            />
            <span className="render__unit">px</span>
            <input
              type="number"
              step={0.01}
              value={num(d.heightUnits)}
              onChange={(e) => dispatch({ type: 'heightUnits', value: Number(e.target.value) })}
            />

            <label htmlFor="rd-dpi">DPI</label>
            <input
              id="rd-dpi"
              type="number"
              min={1}
              value={state.dpi}
              onChange={(e) => dispatch({ type: 'dpi', value: Number(e.target.value) })}
            />
            <select
              value={state.units}
              onChange={(e) => dispatch({ type: 'units', value: e.target.value as Units })}
            >
              <option value="inch">inch</option>
              <option value="cm">cm</option>
            </select>
            <span className="render__aspect">{d.aspect ? `${num(d.aspect)}:1` : ''}</span>
          </div>

          <div className="render__row">
            <label>
              <input
                type="checkbox"
                checked={state.lock}
                onChange={(e) => dispatch({ type: 'lock', value: e.target.checked })}
              />{' '}
              lock aspect ratio
            </label>
            <label>
              <input
                type="checkbox"
                checked={state.transparent}
                onChange={(e) => dispatch({ type: 'transparent', value: e.target.checked })}
              />{' '}
              transparent background
            </label>
            <button type="button" className="render__btn" onClick={() => void useViewport()}>
              use viewport size
            </button>
          </div>

          <div className="render__actions">
            <button
              type="button"
              className="render__btn"
              disabled={busy !== null}
              onClick={() => void render('draw')}
            >
              {busy === 'draw' ? 'drawing…' : 'Draw'}
            </button>
            <button
              type="button"
              className="render__btn render__btn--primary"
              disabled={busy !== null}
              onClick={() => void render('ray')}
            >
              {busy === 'ray' ? 'ray tracing…' : 'Ray'}
            </button>
          </div>
        </div>
      )}

      {page === 'result' && (
        <div className="render__body">
          <p className="render__note">
            The rendered image is in the viewport. Ray output is the CPU ray tracer, the same
            renderer desktop PyMOL uses, so it is identical rather than approximated.
          </p>
          <div className="render__row">
            <input
              className="render__path"
              type="text"
              placeholder="/path/to/image.png"
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
            />
            <button type="button" className="render__btn" onClick={() => void save()}>
              Save image
            </button>
            <button
              type="button"
              className="render__btn"
              title="cmd.png(prior=1) — copies the image already rendered"
              onClick={() => void copyImage()}
            >
              Copy image
            </button>
          </div>
          <div className="render__actions">
            <button type="button" className="render__btn" onClick={() => setPage('setup')}>
              &lt; Back
            </button>
          </div>
        </div>
      )}

      {status !== null && <div className="render__status">{status}</div>}
    </div>
  );
}
