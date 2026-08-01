/**
 * The shared modal chrome for area 6.
 *
 * Qt's dialogs are `QDialog`s built from `pmg_qt/forms/*.ui` at runtime
 * (`load_form`, `pymol_qt_gui.py:512-546`). There is no runtime `.ui` loading
 * here — each form is a React component — but the anatomy is kept: a title, a
 * body of labelled fields, an optional live "This will run the following
 * command" preview box (the `groupBox_2` present in load_traj / load_map /
 * load_mae / fetch), and a button row whose primary button carries the same
 * label as the Qt one.
 */

import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, footer, wide }: ModalProps) {
  return (
    <div className="fdlg__backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`fdlg${wide ? ' fdlg--wide' : ''}`}>
        <div className="fdlg__title">
          {title}
          <button type="button" className="fdlg__x" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="fdlg__body">{children}</div>
        {footer && <div className="fdlg__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="fdlg__field">
      <span className="fdlg__label" title={hint}>
        {label}
      </span>
      <span className="fdlg__control">{children}</span>
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`fdlg__check${disabled ? ' is-disabled' : ''}`} title={hint}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** The `groupBox_2` "This will run the following command" preview. */
export function Preview({ command }: { command: string }) {
  return (
    <div className="fdlg__preview">
      <div className="fdlg__preview-title">This will run the following command</div>
      <pre className="fdlg__preview-body">{command}</pre>
    </div>
  );
}

/** A red banner for formats that raise in this open-source build. */
export function Unavailable({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="fdlg__unavailable">
      <strong>Not available in this build.</strong> {message}
    </div>
  );
}
