/**
 * The floating window chrome every area-10 dialog is drawn in.
 *
 * Qt PyMOL uses three different containers for these — a `QDockWidget` for the
 * volume editor (`volume.py:811-820`), a `QDialog` for properties, a
 * `QMainWindow` for the text editor. In one browser window they become one
 * draggable, resizable, raisable panel, so a user can have the volume ramp and
 * the properties inspector open side by side without a window manager.
 */

import { useCallback, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../ui';
import { dialogsStore, type DialogWindowSpec } from './store';
import './dialogs.css';

/** The draggable, resizable, raisable window chrome every area-10 dialog uses. */
export function DialogWindow({
  spec,
  footer,
  children,
}: {
  spec: DialogWindowSpec;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onTitleDown = useCallback(
    (down: React.PointerEvent) => {
      if (down.button !== 0) return;
      down.preventDefault();
      dialogsStore.raise(spec.key);
      const startX = down.clientX;
      const startY = down.clientY;
      const originX = spec.x;
      const originY = spec.y;
      const move = (e: PointerEvent) => {
        dialogsStore.move(
          spec.key,
          Math.max(0, originX + e.clientX - startX),
          Math.max(0, originY + e.clientY - startY),
        );
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [spec.key, spec.x, spec.y],
  );

  const onResizeDown = useCallback(
    (down: React.PointerEvent) => {
      if (down.button !== 0) return;
      down.preventDefault();
      down.stopPropagation();
      const startX = down.clientX;
      const startY = down.clientY;
      const w0 = spec.width;
      const h0 = spec.height;
      const move = (e: PointerEvent) => {
        dialogsStore.resize(
          spec.key,
          Math.max(320, w0 + e.clientX - startX),
          Math.max(160, h0 + e.clientY - startY),
        );
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [spec.key, spec.width, spec.height],
  );

  // PORTALLED, and `position: fixed` in the CSS. `AppShell`'s overlay region
  // wraps each mounted slot in its own `.overlay-panel` box; a floating window
  // laid out inside that box would be clipped by it and positioned relative to
  // it. The portal takes the window out of that subtree while leaving the React
  // tree (and therefore `useSession()`) intact.
  const window_ = (
    <div
      ref={ref}
      className={
        'dlgwin modern:bg-pm-panel modern:text-pm-text modern:border-line' +
        (spec.minimised ? ' is-minimised' : '')
      }
      style={{ left: spec.x, top: spec.y, width: spec.width, zIndex: spec.z }}
      onPointerDown={() => dialogsStore.raise(spec.key)}
      role="dialog"
      aria-label={spec.title}
      data-dialog={spec.key}
    >
      <div
        className="dlgwin__title modern:bg-none modern:bg-pm-panel-alt modern:text-pm-text-dim modern:border-line"
        onPointerDown={onTitleDown}
      >
        <span className="dlgwin__label modern:text-pm-text-bright">{spec.title}</span>
        <IconButton
          className="dlgwin__btn"
          title={spec.minimised ? 'restore' : 'shade'}
          onClick={() => dialogsStore.toggleMinimised(spec.key)}
        >
          {spec.minimised ? '▢' : '—'}
        </IconButton>
        <IconButton
          className="dlgwin__btn"
          title="close"
          data-close={spec.key}
          onClick={() => dialogsStore.close(spec.key)}
        >
          ×
        </IconButton>
      </div>

      {!spec.minimised && (
        <>
          <div className="dlgwin__body" style={{ height: spec.height }}>
            {children}
          </div>
          {footer && <div className="dlgwin__footer modern:border-line">{footer}</div>}
          <div className="dlgwin__grip" onPointerDown={onResizeDown} title="resize" />
        </>
      )}
    </div>
  );

  return typeof document === 'undefined' ? window_ : createPortal(window_, document.body);
}
