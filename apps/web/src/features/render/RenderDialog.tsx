/**
 * Draw / Ray render dialog — the two-page stacked form of
 * `modules/pmg_qt/pymol_qt_gui.py:673` (`forms/render.ui`).
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
 * - Clipboard is not offered. `cmd._copy_image` is a shim that raises
 *   NotImplementedError headlessly (`bridge/tenmol_bridge/shims.py:9`), and a
 *   button that always errors is worse than an absent one.
 * - Save writes SERVER-side through `cmd.png(path, prior=1, dpi=...)`. This is
 *   a local desktop replacement with full filesystem access; a browser download
 *   would re-encode and lose the dpi metadata `prior=1` exists to preserve.
 */

import { useCallback, useEffect, useReducer, useState } from 'react';

import { useSession } from '../../app';
import { INITIAL, derive, reducer, type Units } from './useRenderForm';
import './render.css';

type Page = 'setup' | 'result';

export function RenderDialog() {
  const session = useSession();
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [page, setPage] = useState<Page>('setup');
  const [busy, setBusy] = useState<null | 'draw' | 'ray'>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savePath, setSavePath] = useState('');
  const d = derive(state);

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

  return (
    <div className="render">
      <div className="render__title">Ray / Draw{page === 'result' ? ' — result' : ''}</div>

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
