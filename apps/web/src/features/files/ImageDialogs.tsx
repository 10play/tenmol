/**
 * Image and movie export.
 *
 *   PNG export dialog   `file_dialogs.py:604-688`, form `png.ui`
 *   Draw/Ray panel      `pymol_qt_gui.py:673-790`, form `render.ui`
 *   Movie export        `file_dialogs.py:691-813`, form `movieexport.ui`
 *
 * The PNG dialog's width/height/DPI widgets are DEAD CODE in PyMOL
 * (commented out at `file_dialogs.py:625-634` and `:654-685`); the live sizing
 * UI is the render panel. They are not reproduced — a control that does
 * nothing is worse than no control.
 */

import { useEffect, useState } from 'react';
import type { MovieDialogInfo, RenderInfo } from '@tenmol/protocol/topics/files';
import { PNG_RENDERING_MODES } from '@tenmol/protocol/topics/files';
import { Check, Field, Modal } from './Modal';
import { movieResolution } from './commands';

/** `file_save_png` (`file_dialogs.py:604-688`). */
export function PngDialog({
  onSave,
  onClose,
}: {
  onSave: (rendering: number) => void;
  onClose: () => void;
}) {
  const [rendering, setRendering] = useState(0);
  return (
    <Modal
      title="Save PNG image"
      onClose={onClose}
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fdlg__btn fdlg__btn--go"
            onClick={() => onSave(rendering)}
          >
            Save PNG image as …
          </button>
        </>
      }
    >
      <div className="fdlg__banner">
        New in PyMOL 2.0: To render a sized antialiased image, use the Draw/Ray panel in the
        upper right.
      </div>
      <Field label="Rendering">
        <select value={rendering} onChange={(e) => setRendering(Number(e.target.value))}>
          {PNG_RENDERING_MODES.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

/**
 * `render_dialog` (`pymol_qt_gui.py:673-790`).
 *
 * Page 1 is the size/dpi block with the bidirectional px↔units↔dpi conversion
 * and the aspect lock; page 2 appears after a render and offers "Save Image to
 * File" (`cmd.png(fname, prior=1, dpi=…)`) and "Copy Image to Clipboard".
 */
export function RenderPanel({
  info,
  onDraw,
  onRay,
  onSave,
  onClipboard,
  onClose,
}: {
  info: RenderInfo;
  onDraw: (width: number, height: number) => void;
  onRay: (width: number, height: number, transparent: boolean) => void;
  onSave: (dpi: number) => void;
  onClipboard: () => void;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(info.width);
  const [height, setHeight] = useState(info.height);
  const [units, setUnits] = useState<'cm' | 'inch'>('cm');
  const [dpi, setDpi] = useState(info.dpi > 0 ? info.dpi : 300);
  const [lock, setLock] = useState(true);
  const [transparent, setTransparent] = useState(true);
  const [page, setPage] = useState<1 | 2>(1);

  const factor = (units === 'inch' ? 1 : 2.54) / (dpi || 1);
  const aspect = info.width / Math.max(1, info.height);

  return (
    <Modal
      title="Draw / Ray"
      onClose={onClose}
      footer={
        page === 1 ? (
          <>
            <span className="fdlg__spacer" />
            <button
              type="button"
              className="fdlg__btn"
              onClick={() => {
                onDraw(width, height);
                setPage(2);
              }}
            >
              Draw (fast)
            </button>
            <button
              type="button"
              className="fdlg__btn fdlg__btn--go"
              onClick={() => {
                onRay(width, height, transparent);
                setPage(2);
              }}
            >
              Ray (slow)
            </button>
          </>
        ) : (
          <>
            <button type="button" className="fdlg__btn" onClick={() => setPage(1)}>
              &lt; Back
            </button>
            <span className="fdlg__spacer" />
            <button type="button" className="fdlg__btn" onClick={onClipboard}>
              Copy Image to Clipboard
            </button>
            <button type="button" className="fdlg__btn fdlg__btn--go" onClick={() => onSave(dpi)}>
              Save Image to File
            </button>
          </>
        )
      }
    >
      {page === 1 ? (
        <>
          <Field label="Width">
            <input
              type="number"
              max={99999}
              value={width}
              onChange={(e) => {
                const next = Number(e.target.value);
                setWidth(next);
                if (lock) setHeight(Math.max(1, Math.round(next / aspect)));
              }}
            />
            <span className="fdlg__unit">
              {(width * factor).toFixed(2)} {units}
            </span>
          </Field>
          <Field label="Height">
            <input
              type="number"
              max={99999}
              value={height}
              onChange={(e) => {
                const next = Number(e.target.value);
                setHeight(next);
                if (lock) setWidth(Math.max(1, Math.round(next * aspect)));
              }}
            />
            <span className="fdlg__unit">
              {(height * factor).toFixed(2)} {units}
            </span>
          </Field>
          <Field label="Units">
            <select value={units} onChange={(e) => setUnits(e.target.value as 'cm' | 'inch')}>
              {info.units.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </Field>
          <Field label="at DPI">
            <input type="number" value={dpi} onChange={(e) => setDpi(Number(e.target.value))} />
          </Field>
          <Check label="Lock aspect ratio" checked={lock} onChange={setLock} />
          <Check
            label='transparent background ("Ray" only)'
            checked={transparent}
            onChange={setTransparent}
            hint="sets opaque_background"
          />
          <button
            type="button"
            className="fdlg__btn"
            title="Use current viewport size"
            onClick={() => {
              setWidth(info.width);
              setHeight(info.height);
            }}
          >
            Reset
          </button>
        </>
      ) : (
        <p className="fdlg__text">
          The render is running in PyMOL. “Save Image to File” writes it with{' '}
          <code>cmd.png(file, prior=1, dpi={dpi})</code> — no re-render.
        </p>
      )}
    </Modal>
  );
}

/** `file_save_mpeg` (`file_dialogs.py:691-813`), form `movieexport.ui`. */
export function MovieDialog({
  info,
  preselect,
  onSave,
  onClose,
}: {
  info: MovieDialogInfo;
  /** 'png' hides the whole format group; 'mov' preselects ffmpeg + MOV. */
  preselect?: 'png' | 'mov' | null;
  onSave: (options: {
    format: string;
    width: number;
    height: number;
    quality: number;
    ray: boolean;
    encoder: string;
  }) => void;
  onClose: () => void;
}) {
  const [encoder, setEncoder] = useState<string>(
    preselect === 'mov' ? 'ffmpeg' : info.defaultEncoder,
  );
  const [format, setFormat] = useState<string>(
    preselect === 'png'
      ? 'png'
      : preselect === 'mov'
        ? 'mov'
        : info.defaultEncoder === 'ffmpeg'
          ? 'mp4'
          : info.defaultEncoder === 'mpeg_encode'
            ? 'mpg'
            : 'png',
  );
  const [width, setWidth] = useState(info.width);
  const [height, setHeight] = useState(info.height);
  const [quality, setQuality] = useState(info.quality);
  const [ray, setRay] = useState(info.ray);

  const support = info.support[encoder] ?? {};
  const installed = Boolean(info.encoders[encoder]);

  // "Disabled radios auto-switch to the encoder's default" (`:711-726`).
  useEffect(() => {
    if (format === 'png') return;
    if (!support[format]) {
      setFormat(encoder === 'mpeg_encode' ? 'mpg' : encoder === 'convert' ? 'gif' : 'png');
    }
  }, [encoder, format, support]);

  return (
    <Modal
      title="Export Movie"
      onClose={onClose}
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fdlg__btn fdlg__btn--go"
            onClick={() => onSave({ format, width, height, quality, ray, encoder })}
          >
            Save Movie as …
          </button>
        </>
      }
    >
      {info.frames === 0 && (
        <div className="fdlg__banner">This session has no movie frames yet.</div>
      )}
      {preselect !== 'png' && (
        <fieldset className="fdlg__group">
          <legend>Movie Format</legend>
          <Field label="Encoder">
            <select value={encoder} onChange={(e) => setEncoder(e.target.value)}>
              <option value=""></option>
              {['ffmpeg', 'mpeg_encode', 'convert'].map((name) => (
                <option key={name} value={name}>
                  {name}
                  {info.encoders[name] ? '' : ' (not installed)'}
                </option>
              ))}
            </select>
          </Field>
          {encoder && !installed && (
            <div className="fdlg__unavailable">Encoder &apos;{encoder}&apos; is not installed.</div>
          )}
          <Field label="Quality">
            <input
              type="number"
              min={60}
              max={100}
              value={quality}
              disabled={encoder === '' || encoder === 'convert'}
              onChange={(e) => setQuality(Number(e.target.value))}
            />
          </Field>
          <div className="fdlg__radios">
            {(['mp4', 'mpg', 'mov', 'gif', 'png'] as const).map((fmt) => (
              <label key={fmt} className="fdlg__radio">
                <input
                  type="radio"
                  checked={format === fmt}
                  disabled={fmt !== 'png' && !support[fmt]}
                  onChange={() => setFormat(fmt)}
                />
                <span>{info.filters[fmt]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="Width">
        <input
          type="number"
          max={9999}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
        />
      </Field>
      <Field label="Height">
        <input
          type="number"
          max={9999}
          value={height}
          onChange={(e) => setHeight(Number(e.target.value))}
        />
      </Field>
      <div className="fdlg__row">
        <span className="fdlg__label">Common:</span>
        {[720, 480, 360].map((target) => (
          <button
            key={target}
            type="button"
            className="fdlg__btn"
            onClick={() => {
              const next = movieResolution(width, height, target);
              setWidth(next.width);
              setHeight(next.height);
            }}
          >
            {target}p
          </button>
        ))}
      </div>
      <fieldset className="fdlg__group">
        <legend>Rendering</legend>
        <label className="fdlg__radio">
          <input type="radio" checked={!ray} onChange={() => setRay(false)} />
          <span>Draw</span>
        </label>
        <label className="fdlg__radio">
          <input type="radio" checked={ray} onChange={() => setRay(true)} />
          <span>Ray (slow)</span>
        </label>
      </fieldset>
    </Modal>
  );
}
