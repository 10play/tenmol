/**
 * FloatingWindow — the shared draggable / resizable / raisable panel chrome.
 *
 * The app already had exactly one good movable window (`DialogWindow`, used by
 * the volume / properties / text-editor dialogs); every other "popup" was a
 * bespoke `position: fixed`/`absolute` box that could not be moved and sat on
 * top of the 3-D scene. The reported complaint — "the builder popup is
 * unmovable and hides most of the 3-D model" — is that pattern. This component
 * generalizes the good one into `src/ui` so any persistent tool panel opens in
 * a frame the user can drag, resize, shade and close, and which spawns to the
 * side of the viewport instead of over its centre.
 *
 * Self-contained on purpose. Each tool panel already owns its own open/closed
 * state (a `useState`), so a window here needs no global registry — it manages
 * its own geometry, remembers it in `localStorage` when given a `persistKey`,
 * and takes a z from the shared `windowZ` allocator so it stacks correctly
 * against the older dialog windows and the seqview HUD. Non-modal: no scrim, no
 * focus trap — the viewport stays visible and interactive behind it, which is
 * the whole point.
 *
 * `position: fixed`, rendered inline (NOT portalled). The overlay region no
 * longer wraps slots in a positioned box (`shell/AppShell.tsx` `OverlayLayer`),
 * and no shell ancestor establishes a containing block, so fixed positioning is
 * already viewport-relative; keeping the node in place also keeps it inside the
 * feature's own React subtree and DOM query scope.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { IconButton } from './Button';
import { cn } from './cn';
import { nextWindowZ } from './windowZ';
import './floating-window.css';

/** Which viewport edge a fresh window anchors to; default `right` keeps the scene centre clear. */
export type WindowAnchor = 'right' | 'left';

/** One window's live geometry. */
interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Props for {@link FloatingWindow}. */
export interface FloatingWindowProps {
  /** Title-bar label; also the default `aria-label`. */
  title: ReactNode;
  /** Called when the × button (or Esc from inside) closes the window. */
  onClose?: () => void;
  /** localStorage key for remembering geometry across opens; omit to not persist. */
  persistKey?: string;
  /** Preferred first-open width. Clamped to the viewport. */
  defaultWidth: number;
  /** Preferred first-open height. Clamped to the viewport. */
  defaultHeight: number;
  /** Smallest the user can resize to. */
  minWidth?: number;
  minHeight?: number;
  /** Viewport edge a fresh window anchors to. */
  anchor?: WindowAnchor;
  /** Show the resize grip. Default true. */
  resizable?: boolean;
  /** Footer strip below the scrolling body. */
  footer?: ReactNode;
  /** Extra title-bar content (a busy dot, a mode indicator…) shown before the buttons. */
  titleExtra?: ReactNode;
  /** Overrides the accessible name (defaults to `title`). */
  ariaLabel?: string;
  /** Extra classes for the outer window element (e.g. `modern:` theme utilities). */
  className?: string;
  /** Extra classes for the scrolling body. */
  bodyClassName?: string;
  /** `data-testid` on the window root. */
  'data-testid'?: string;
  children: ReactNode;
}

const MARGIN = 16;
/** Clears the menu-bar strip so a window never opens under it. */
const TOP = 52;
/** Never let the title bar leave less than this much of itself on-screen. */
const KEEP_VISIBLE = 48;
const TITLE_H = 34;
const SMALL_MAX = 640;

/** Non-persisted windows cascade so two opened at once are not exactly stacked. */
let cascade = 0;

function viewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1280, h: 800 };
  return { w: window.innerWidth || 1280, h: window.innerHeight || 800 };
}

function isSmall(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return (window.innerWidth || 1280) <= SMALL_MAX || coarse;
}

/** Keep the title bar reachable: clamp x/y so a chunk of it always stays on-screen. */
function clampPosition(x: number, y: number, width: number): { x: number; y: number } {
  const { w, h } = viewport();
  return {
    x: Math.min(Math.max(x, -width + KEEP_VISIBLE), w - KEEP_VISIBLE),
    y: Math.min(Math.max(y, 0), h - TITLE_H),
  };
}

/** First-open geometry: sized to the viewport, anchored to a side gutter, cascaded. */
function anchorGeometry(anchor: WindowAnchor, wantW: number, wantH: number): Geometry {
  const { w, h } = viewport();
  const width = Math.max(200, Math.min(wantW, w - MARGIN * 2));
  const height = Math.max(120, Math.min(wantH, h - TOP - MARGIN));
  const step = (cascade % 5) * 26;
  cascade += 1;
  const x = anchor === 'left' ? MARGIN + step : w - width - MARGIN - step;
  const y = TOP + step;
  const pos = clampPosition(x, y, width);
  return { x: pos.x, y: pos.y, width, height };
}

function persistedGeometry(key: string, minWidth: number, minHeight: number): Geometry | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(`flwin:${key}`);
  } catch {
    return null; // storage disabled by policy
  }
  if (!raw) return null;
  try {
    const g = JSON.parse(raw) as Partial<Geometry>;
    if (
      typeof g.x !== 'number' ||
      typeof g.y !== 'number' ||
      typeof g.width !== 'number' ||
      typeof g.height !== 'number'
    ) {
      return null;
    }
    const { w, h } = viewport();
    const width = Math.min(Math.max(g.width, minWidth), w - MARGIN);
    const height = Math.min(Math.max(g.height, minHeight), h - MARGIN);
    // A saved rect can be off-screen if the browser shrank since; if the title
    // bar would be unreachable, discard it and fall back to the anchor.
    const pos = clampPosition(g.x, g.y, width);
    if (pos.x !== g.x && (g.x > w || g.x < -width)) return null;
    return { x: pos.x, y: pos.y, width, height };
  } catch {
    return null;
  }
}

function writeGeometry(key: string, g: Geometry): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`flwin:${key}`, JSON.stringify(g));
  } catch {
    /* storage disabled — geometry simply won't persist */
  }
}

/** The shared draggable / resizable / raisable window frame. */
export function FloatingWindow({
  title,
  onClose,
  persistKey,
  defaultWidth,
  defaultHeight,
  minWidth = 320,
  minHeight = 160,
  anchor = 'right',
  resizable = true,
  footer,
  titleExtra,
  ariaLabel,
  className,
  bodyClassName,
  'data-testid': testId,
  children,
}: FloatingWindowProps) {
  const [geom, setGeom] = useState<Geometry>(
    () =>
      (persistKey ? persistedGeometry(persistKey, minWidth, minHeight) : null) ??
      anchorGeometry(anchor, defaultWidth, defaultHeight),
  );
  const [z, setZ] = useState(() => nextWindowZ());
  const [minimised, setMinimised] = useState(false);
  const [small, setSmall] = useState(() => isSmall());
  const rootRef = useRef<HTMLDivElement>(null);

  // Track phone-sized viewports so the window maximises instead of trapping
  // itself off a screen too small to drag on.
  useEffect(() => {
    const onResize = () => setSmall(isSmall());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Focus the window on open so Esc-to-close and keyboard use land here without
  // stealing focus from the viewport while the user is orbiting the scene.
  useLayoutEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const raise = useCallback(() => setZ(nextWindowZ()), []);

  const persist = useCallback(
    (g: Geometry) => {
      if (persistKey) writeGeometry(persistKey, g);
    },
    [persistKey],
  );

  const onTitleDown = useCallback(
    (down: ReactPointerEvent) => {
      if (down.button !== 0 || small) return;
      down.preventDefault();
      raise();
      const startX = down.clientX;
      const startY = down.clientY;
      let latest = geom;
      const move = (e: PointerEvent) => {
        const pos = clampPosition(
          geom.x + (e.clientX - startX),
          geom.y + (e.clientY - startY),
          geom.width,
        );
        latest = { ...geom, x: pos.x, y: pos.y };
        setGeom(latest);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        persist(latest);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [geom, raise, persist, small],
  );

  const onResizeDown = useCallback(
    (down: ReactPointerEvent) => {
      if (down.button !== 0 || small) return;
      down.preventDefault();
      down.stopPropagation();
      raise();
      const startX = down.clientX;
      const startY = down.clientY;
      const w0 = geom.width;
      const h0 = geom.height;
      let latest = geom;
      const move = (e: PointerEvent) => {
        const { w, h } = viewport();
        const width = Math.min(Math.max(minWidth, w0 + (e.clientX - startX)), w - geom.x - 4);
        const height = Math.min(Math.max(minHeight, h0 + (e.clientY - startY)), h - geom.y - 4);
        latest = { ...geom, width, height };
        setGeom(latest);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        persist(latest);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [geom, raise, persist, minWidth, minHeight, small],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Don't hijack Esc from a text field (it may be clearing/committing).
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      e.stopPropagation();
      onClose?.();
    },
    [onClose],
  );

  // When maximised the media query owns geometry (`inset: 8px !important` and
  // `width: auto !important`), so pass only the z-index and let CSS place and
  // size the window; the inline left/top/width would just be overridden.
  const style = small ? { zIndex: z } : { left: geom.x, top: geom.y, width: geom.width, zIndex: z };

  return (
    <div
      ref={rootRef}
      className={cn(
        'flwin flwin--maximisable',
        minimised && 'is-minimised',
        'modern:bg-pm-panel modern:text-pm-text modern:border-line modern:rounded-lg',
        className,
      )}
      style={style}
      role="dialog"
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      tabIndex={-1}
      data-testid={testId}
      onPointerDown={raise}
      onKeyDown={onKeyDown}
    >
      <div
        className="flwin__title modern:bg-pm-panel-alt modern:border-line modern:text-pm-text-dim"
        onPointerDown={onTitleDown}
        onDoubleClick={() => setMinimised((m) => !m)}
      >
        <span className="flwin__label modern:text-pm-text-bright">{title}</span>
        {titleExtra && <span className="flwin__extra">{titleExtra}</span>}
        <IconButton
          className="flwin__btn"
          title={minimised ? 'restore' : 'shade'}
          aria-label={minimised ? 'restore' : 'shade'}
          onClick={() => setMinimised((m) => !m)}
        >
          {minimised ? '▢' : '—'}
        </IconButton>
        {onClose && (
          <IconButton
            className="flwin__btn flwin__close"
            title="close"
            aria-label="close"
            data-close=""
            onClick={onClose}
          >
            ×
          </IconButton>
        )}
      </div>

      {!minimised && (
        <>
          <div
            className={cn('flwin__body', bodyClassName)}
            style={small ? undefined : { height: geom.height }}
          >
            {children}
          </div>
          {footer && <div className="flwin__footer modern:border-line">{footer}</div>}
          {resizable && !small && (
            <div className="flwin__grip" onPointerDown={onResizeDown} title="resize" aria-hidden />
          )}
        </>
      )}
    </div>
  );
}
