/**
 * Camera control by RPC, for a backend with no GL context.
 *
 * WHY THIS EXISTS. Normally a drag is forwarded verbatim as `{t:'input'}` and
 * PyMOL's own `CScene::drag` moves the camera. But that path is queued, not
 * executed: `click`/`drag`/`release` only call `OrthoDefer`, and the queue is
 * drained by `ExecutiveDrawNow`, which runs only when `PyMOL_GetIdleAndReady`
 * is true — and `IdleAndReady` only increments while `DrawnFlag` is set, which
 * only `PyMOL_Draw` sets. A bridge started `--no-gl` never draws, so raw input
 * is accepted and silently never applied. Measured: a 20-step drag moved
 * `get_view()[2]` by exactly 0.
 *
 * So on a GL-free backend the client must drive the camera the way a script
 * does — `turn`, `move`, `zoom` — which take effect immediately because they
 * are ordinary API calls rather than queued scene events.
 *
 * THIS IS NOT A REPLACEMENT for input forwarding. It cannot pick, it cannot
 * rubber-band select, and it does not consult the ButMode table, so a user who
 * has switched to 3-Button Editing still gets viewing behaviour. It is the
 * camera, and only the camera, for the case where the alternative is nothing.
 */

/** Degrees of rotation per pixel dragged. PyMOL's own trackball is ~0.5. */
const DEG_PER_PX = 0.5;

/** Ångströms of translation per pixel, before the zoom-distance scale. */
const MOVE_PER_PX = 0.1;

/** Ångströms of dolly per wheel notch. */
const ZOOM_PER_NOTCH = 2.0;

export type CameraCall = (fn: string, args?: readonly unknown[]) => Promise<unknown>;

export interface CameraDriverOptions {
  call: CameraCall;
  onError?: (error: Error) => void;
  /** Overridable for tests. */
  degPerPx?: number;
  movePerPx?: number;
  zoomPerNotch?: number;
}

export interface DragDelta {
  /** Pixels moved since the last sample, in DOM coordinates. */
  dx: number;
  dy: number;
  /** 0 left, 1 middle, 2 right — the same codes the input path uses. */
  button: number;
  /** Modifier mask; only SHIFT (1) is consulted, to force translate. */
  mod: number;
}

export interface CameraDriver {
  drag(delta: DragDelta): void;
  wheel(notches: number): void;
  /** Calls issued, for assertions and the HUD. */
  readonly counters: { turns: number; moves: number; zooms: number; errors: number };
}

export function createCameraDriver(options: CameraDriverOptions): CameraDriver {
  const degPerPx = options.degPerPx ?? DEG_PER_PX;
  const movePerPx = options.movePerPx ?? MOVE_PER_PX;
  const zoomPerNotch = options.zoomPerNotch ?? ZOOM_PER_NOTCH;
  const counters = { turns: 0, moves: 0, zooms: 0, errors: 0 };

  const run = (fn: string, args: readonly unknown[], kind: 'turns' | 'moves' | 'zooms'): void => {
    counters[kind]++;
    void options.call(fn, args).catch((cause: unknown) => {
      counters.errors++;
      options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
    });
  };

  return {
    counters,
    drag({ dx, dy, button, mod }: DragDelta): void {
      if (dx === 0 && dy === 0) return;
      const translate = button === 1 || (mod & 1) !== 0;

      if (translate) {
        // Screen right is +x. Screen DOWN is -y in PyMOL's frame, so dy is
        // negated: without this a drag down moves the model up.
        if (dx !== 0) run('cmd.move', ['x', dx * movePerPx], 'moves');
        if (dy !== 0) run('cmd.move', ['y', -dy * movePerPx], 'moves');
        return;
      }

      // Horizontal drag spins about the VERTICAL axis and vice versa — the
      // axis is perpendicular to the motion, which is what makes a trackball
      // feel like one.
      if (dx !== 0) run('cmd.turn', ['y', dx * degPerPx], 'turns');
      if (dy !== 0) run('cmd.turn', ['x', dy * degPerPx], 'turns');
    },
    wheel(notches: number): void {
      if (notches === 0) return;
      // `move z` dollies the camera; positive notches (wheel down) pull back.
      run('cmd.move', ['z', notches * zoomPerNotch], 'zooms');
    },
  };
}
