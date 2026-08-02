/**
 * Resolution / dpr negotiation with the engine.
 *
 * The engine has no window, so the browser is the authority on size and the
 * bridge is the authority on what it actually managed to allocate. The
 * handshake, per `docs/input-mouse-keyboard.md` §2:
 *
 *   1. `{t:'input',kind:'reshape',width,height,force}` in DEVICE pixels
 *      (`_cmd._reshape` -> `PyMOL_Reshape` -> `G->Option->winX/winY` +
 *      `OrthoReshape`, `packages/engine/layer5/PyMOL.cpp:2397-2405`);
 *   2. `cmd.set('display_scale_factor', round(dpr))` — drives `_gScaleFactor`
 *      (`packages/engine/layer1/Setting.cpp:2946-2951`) and therefore `DIP2PIXEL()`, which
 *      sizes every internal-GUI hit rectangle. Setting it triggers
 *      `OrthoCommandIn(G, "viewport")`, so it goes AFTER the reshape.
 *
 * `internal_gui 0` + `internal_feedback 0` (the bridge sets both at boot,
 * plan §1.1 step 6) is what makes `get_viewport() == (width, height)`; without
 * them `reshape(640,480)` yields `(420,462)` and every mouse coordinate is
 * wrong.
 *
 * Debounced because a window drag emits a resize per frame and each one costs
 * an FBO re-storage on the engine thread.
 */

import type { ViewportTransport } from './types';

export interface SizeState {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  /** Device pixels — what the engine renders at. */
  width: number;
  height: number;
}

export interface ResizeNegotiatorOptions {
  /** Element whose CSS box defines the viewport. */
  host: HTMLElement;
  transport: ViewportTransport;
  /** Clamp on `devicePixelRatio`. */
  maxDpr?: number;
  debounceMs?: number;
  /** Emit reshape frames. False when something else owns the size handshake. */
  ownsReshape?: boolean;
  onResize?: (size: SizeState) => void;
  onError?: (error: Error) => void;
}

export interface ResizeNegotiator {
  readonly size: SizeState;
  /** Measure now; `force` re-sends even if nothing changed (socket reconnect). */
  sync(force?: boolean): void;
  destroy(): void;
}

function currentDpr(max: number): number {
  const raw = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(raw, max);
}

export function createResizeNegotiator(options: ResizeNegotiatorOptions): ResizeNegotiator {
  const { host, transport } = options;
  const maxDpr = options.maxDpr ?? 2;
  const debounceMs = options.debounceMs ?? 100;
  const ownsReshape = options.ownsReshape ?? true;

  const size: SizeState = { cssWidth: 1, cssHeight: 1, dpr: 1, width: 1, height: 1 };
  let lastSent = '';
  let lastSentDpr = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const measure = (): boolean => {
    const rect = host.getBoundingClientRect();
    const dpr = currentDpr(maxDpr);
    const cssWidth = Math.max(1, Math.round(rect.width));
    const cssHeight = Math.max(1, Math.round(rect.height));
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    const changed =
      size.cssWidth !== cssWidth ||
      size.cssHeight !== cssHeight ||
      size.dpr !== dpr ||
      size.width !== width ||
      size.height !== height;
    size.cssWidth = cssWidth;
    size.cssHeight = cssHeight;
    size.dpr = dpr;
    size.width = width;
    size.height = height;
    return changed;
  };

  const emit = (force: boolean): void => {
    if (destroyed) return;
    const key = `${size.width}x${size.height}`;
    if (key === lastSent && !force) return;
    lastSent = key;
    options.onResize?.({ ...size });
    if (!ownsReshape) return;
    try {
      transport.input({
        t: 'input',
        kind: 'reshape',
        width: size.width,
        height: size.height,
        force,
      });
      const scale = Math.max(1, Math.round(size.dpr));
      if (scale !== lastSentDpr || force) {
        lastSentDpr = scale;
        // After the reshape: this one runs `OrthoCommandIn(G, "viewport")`.
        void transport
          .call('set', ['display_scale_factor', scale])
          .catch((cause: unknown) =>
            options.onError?.(cause instanceof Error ? cause : new Error(String(cause))),
          );
      }
    } catch (cause) {
      options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      measure();
      emit(false);
    }, debounceMs);
  };

  const observer =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          // Update the local size immediately (the canvases must not lag the
          // layout) but debounce the engine round-trip.
          measure();
          options.onResize?.({ ...size });
          schedule();
        })
      : null;
  observer?.observe(host);

  // devicePixelRatio changes when the window moves between screens or the user
  // zooms; there is no event for it, only a resolution media query that has to
  // be re-armed after every change.
  let dprQuery: MediaQueryList | null = null;
  const armDprWatch = (): void => {
    if (typeof matchMedia !== 'function') return;
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };
  function onDprChange(): void {
    measure();
    options.onResize?.({ ...size });
    emit(true);
    armDprWatch();
  }
  armDprWatch();

  const onWindowResize = (): void => {
    measure();
    options.onResize?.({ ...size });
    schedule();
  };
  if (typeof addEventListener === 'function') addEventListener('resize', onWindowResize);

  measure();

  return {
    size,
    sync(force = false): void {
      measure();
      emit(force);
    },
    destroy(): void {
      destroyed = true;
      observer?.disconnect();
      if (timer !== null) clearTimeout(timer);
      dprQuery?.removeEventListener('change', onDprChange);
      if (typeof removeEventListener === 'function') removeEventListener('resize', onWindowResize);
    },
  };
}
