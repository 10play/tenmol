/**
 * The three little modals area 10 needs everywhere.
 *
 *   <TextDialog>     the reusable read-only monospace box of
 *                    `VolumeEditorWidget.displayTextDialog` (`volume.py:748-767`),
 *                    500 px wide, used for both "Get colors as script" and Help.
 *   <NumberPrompt>   `QInputDialog.getDouble(..., decimals=6)` — the value/alpha
 *                    and vmin/vmax/amax editors (`volume.py:283-289`).
 *   <ConfirmPrompt>  `QMessageBox` Yes/No/Cancel — the text editor's
 *                    "Save changes?" guard (`TextEditor.py:120-135`).
 *
 * They are plain absolutely-positioned overlays rather than `<dialog>`: the
 * volume colour picker has to LIVE-PREVIEW into PyMOL while it is open
 * (`currentColorChanged`, `volume.py:398-400`), and a top-layer modal that
 * steals focus makes that painful for no benefit inside a single-window app.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, IconButton, TextInput } from '../../ui';
import { DEFAULT_TEXT_DIALOG_WIDTH } from '../volume/ramp';
import './dialogs.css';

export function TextDialog({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="dlgmodal" role="dialog" aria-label={title} data-textdialog="">
      <div className="dlgmodal__box" style={{ width: DEFAULT_TEXT_DIALOG_WIDTH }}>
        <div className="dlgmodal__title">
          {title}
          <IconButton className="dlgwin__btn" onClick={onClose} title="close">
            ×
          </IconButton>
        </div>
        <pre className="dlgmodal__pre">{text}</pre>
        <div className="dlgmodal__row">
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            Copy
          </Button>
          {copied && <span className="dlgmodal__note">copied</span>}
          <span className="dlgmodal__spacer" />
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

export interface NumberPromptSpec {
  title: string;
  value: number;
  min: number;
  max: number;
  decimals: number;
}

/**
 * `QInputDialog.getDouble`. Cancel keeps the old value — the caller gets
 * `onDone(null)` and must not touch its state, which is what upstream's
 * `enterValue` does by returning the value it was given (`volume.py:283-289`).
 */
export function NumberPrompt({
  spec,
  onDone,
}: {
  spec: NumberPromptSpec;
  onDone: (value: number | null) => void;
}) {
  const [text, setText] = useState(() => spec.value.toFixed(spec.decimals));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);

  const accept = () => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      onDone(null);
      return;
    }
    onDone(Math.min(Math.max(parsed, spec.min), spec.max));
  };

  return (
    <div className="dlgmodal" role="dialog" aria-label={spec.title} data-numberprompt="">
      <div className="dlgmodal__box dlgmodal__box--narrow">
        <div className="dlgmodal__title">{spec.title}</div>
        <TextInput
          ref={ref}
          className="dlgmodal__input"
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') accept();
            if (e.key === 'Escape') onDone(null);
          }}
        />
        <div className="dlgmodal__hint">
          {spec.min.toPrecision(6)} … {spec.max.toPrecision(6)}
        </div>
        <div className="dlgmodal__row">
          <span className="dlgmodal__spacer" />
          <Button onClick={() => onDone(null)}>Cancel</Button>
          <Button data-accept="" onClick={accept}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}

export type ConfirmAnswer = 'yes' | 'no' | 'cancel';

export function ConfirmPrompt({
  title,
  message,
  onDone,
}: {
  title: string;
  message: string;
  onDone: (answer: ConfirmAnswer) => void;
}) {
  return (
    <div className="dlgmodal" role="dialog" aria-label={title} data-confirmprompt="">
      <div className="dlgmodal__box dlgmodal__box--narrow">
        <div className="dlgmodal__title">{title}</div>
        <div className="dlgmodal__message">{message}</div>
        <div className="dlgmodal__row">
          <span className="dlgmodal__spacer" />
          <Button data-answer="yes" onClick={() => onDone('yes')}>
            Yes
          </Button>
          <Button data-answer="no" onClick={() => onDone('no')}>
            No
          </Button>
          <Button data-answer="cancel" onClick={() => onDone('cancel')}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
