/**
 * Page Visibility, done properly (defect D3b).
 *
 * The bug this replaces: the viewport subscribed to the `visibilitychange`
 * EVENT and nothing else. An event only fires on a TRANSITION, so a tab that
 * was ALREADY hidden when the viewport mounted — a background tab restored at
 * startup, a `target=_blank` opened behind the current one, a session restore,
 * a prerender — never paused. It sat there decoding and acking 60 Mode-P frames
 * a second that the compositor threw away, and (worse for the north star) it
 * kept the bridge rendering GL frames nobody could see.
 *
 * What this module handles that a bare `visibilitychange` listener does not:
 *
 *   * the state AT MOUNT (`document.visibilityState`), reported synchronously;
 *   * `pagehide` / `pageshow`: bfcache. Safari and Firefox freeze a page into
 *     the back/forward cache WITHOUT a `visibilitychange` in older versions,
 *     and `pageshow` is the only signal on restore;
 *   * `freeze` / `resume`: the Chrome Page Lifecycle API. A frozen tab is
 *     hidden AND has its timers stopped; on `resume` we must re-read the state
 *     rather than assume "visible".
 *
 * Deliberately NOT handled: window `blur`. Losing keyboard focus is not losing
 * visibility — a user watching a `movie play` in a side-by-side window must
 * keep getting frames.
 *
 * There is no DOM dependency at construction time: pass any object with
 * `addEventListener`/`removeEventListener`, or none at all (node), and the
 * controller reports "visible" and never fires.
 */

export type VisibilitySource =
  'mount' | 'visibilitychange' | 'pagehide' | 'pageshow' | 'freeze' | 'resume';

/** The slice of `document` this needs. */
export interface VisibilityDocumentLike {
  readonly visibilityState?: string;
  readonly hidden?: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** The slice of `window` this needs. */
export interface VisibilityWindowLike {
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  removeEventListener(type: string, listener: (event?: unknown) => void): void;
}

/** Wiring for {@link createVisibilityController}: callback, document/window, init. */
export interface VisibilityControllerOptions {
  /**
   * Called whenever the answer changes, and ONCE at construction with the
   * mount-time state (`source === 'mount'`) unless `emitInitial` is false.
   */
  onChange: (hidden: boolean, source: VisibilitySource) => void;
  /** Defaults to the global `document`, if there is one. */
  document?: VisibilityDocumentLike | null;
  /** Defaults to the global `window`, if there is one. */
  window?: VisibilityWindowLike | null;
  /** Default true. False only for a caller that reads `.hidden` itself. */
  emitInitial?: boolean;
}

/** Watches page visibility and reports when it changes. */
export interface VisibilityController {
  /** The last reported answer. */
  readonly hidden: boolean;
  /** Re-read the document and fire `onChange` if it moved. */
  refresh(source?: VisibilitySource): boolean;
  destroy(): void;
}

function globalDocument(): VisibilityDocumentLike | null {
  return typeof document === 'undefined' ? null : (document as unknown as VisibilityDocumentLike);
}

function globalWindow(): VisibilityWindowLike | null {
  return typeof window === 'undefined' ? null : (window as unknown as VisibilityWindowLike);
}

/**
 * True when the page is not being presented.
 *
 * `visibilityState` is authoritative; `hidden` is the fallback for anything
 * that implements only the older half of the API. Anything that is not the
 * literal string `visible` counts as hidden — that includes `prerender`, which
 * is a page that has never been shown and must not be burning frames.
 */
export function isDocumentHidden(doc: VisibilityDocumentLike | null = globalDocument()): boolean {
  if (doc === null) return false;
  const state = doc.visibilityState;
  if (typeof state === 'string') return state !== 'visible';
  if (typeof doc.hidden === 'boolean') return doc.hidden;
  return false;
}

/** Build a controller that fires `onChange` when page visibility changes. */
export function createVisibilityController(
  options: VisibilityControllerOptions,
): VisibilityController {
  const doc = options.document === undefined ? globalDocument() : options.document;
  const win = options.window === undefined ? globalWindow() : options.window;

  let hidden = isDocumentHidden(doc);
  let destroyed = false;

  const report = (next: boolean, source: VisibilitySource): boolean => {
    if (destroyed) return hidden;
    if (next === hidden && source !== 'mount') return hidden;
    hidden = next;
    options.onChange(hidden, source);
    return hidden;
  };

  const refresh = (source: VisibilitySource = 'visibilitychange'): boolean =>
    report(isDocumentHidden(doc), source);

  const onVisibilityChange = (): void => {
    refresh('visibilitychange');
  };
  // `pagehide` means the page is going away or into the bfcache: hidden, full
  // stop, whatever `visibilityState` says at that instant.
  const onPageHide = (): void => {
    report(true, 'pagehide');
  };
  const onPageShow = (): void => {
    refresh('pageshow');
  };
  const onFreeze = (): void => {
    report(true, 'freeze');
  };
  const onResume = (): void => {
    refresh('resume');
  };

  doc?.addEventListener('visibilitychange', onVisibilityChange);
  doc?.addEventListener('freeze', onFreeze);
  doc?.addEventListener('resume', onResume);
  win?.addEventListener('pagehide', onPageHide);
  win?.addEventListener('pageshow', onPageShow);

  // THE FIX: the mount-time state is reported, not waited for.
  if (options.emitInitial !== false) options.onChange(hidden, 'mount');

  return {
    get hidden(): boolean {
      return hidden;
    },
    refresh,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      doc?.removeEventListener('visibilitychange', onVisibilityChange);
      doc?.removeEventListener('freeze', onFreeze);
      doc?.removeEventListener('resume', onResume);
      win?.removeEventListener('pagehide', onPageHide);
      win?.removeEventListener('pageshow', onPageShow);
    },
  };
}
