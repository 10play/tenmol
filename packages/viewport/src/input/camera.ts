/**
 * Mouse actions by RPC, for a backend with no GL context.
 *
 * WHY THIS EXISTS. Normally a drag is forwarded verbatim as `{t:'input'}` and
 * PyMOL's own `CScene::drag` decides what it means. But that path is queued,
 * not executed: `click`/`drag`/`release` only call `OrthoDefer`, and the queue
 * is drained by `ExecutiveDrawNow`, which runs only when
 * `PyMOL_GetIdleAndReady` is true — and `IdleAndReady` only increments while
 * `DrawnFlag` is set, which only `PyMOL_Draw` sets. A bridge started `--no-gl`
 * never draws, so raw input is accepted and silently never applied. Measured: a
 * 20-step drag moved `get_view()[2]` by exactly 0.
 *
 * So on a GL-free backend the client must drive the session the way a script
 * does — `turn`, `move`, `clip`, `rotate`, `translate`, `torsion`, `select` —
 * which take effect immediately because they are ordinary API calls rather
 * than queued scene events.
 *
 * IT CONSULTS THE BUTMODE TABLE. Every gesture is resolved through
 * `butModeTranslate` against `tableForMode(<current mouse mode>)`, the same 80
 * slots and the same arithmetic the C core uses, so Shift+left is `+Box` in
 * 3-Button Viewing and `RotO` in 3-Button Editing rather than "translate,
 * whatever the mode". The mode is read from the backend (`button_mode_name`),
 * never assumed, and the resolution is redone on EVERY drag sample with the
 * modifier that sample carried — exactly as `SceneDrag` does
 * (`packages/engine/layer1/SceneMouse.cpp:1308`, `mode = ButModeTranslate(G, I->Button, mod)`),
 * so releasing Shift mid-drag changes the action mid-drag.
 *
 * WHAT IT CANNOT DO, and says so instead of guessing: the actions whose C
 * implementation has no Python equivalent — `DrgM`/`DrgO`/`DgRt` (they consume
 * `EditorDrag` state the client cannot see), the light actions, and the
 * click-only actions (`PkAt`, `Menu`, `Cent`, `Orig`, ...) which belong to the
 * press, not the drag. Those increment `counters.unsupported` and issue
 * nothing, which is strictly better than the previous behaviour of rotating
 * the camera for every gesture the table did not name.
 *
 * GAINS ARE APPROXIMATE, faithfulness of ACTION is not. Degrees per pixel and
 * Ångströms per pixel here are constants; PyMOL derives them from a virtual
 * trackball and `SceneGetExactScreenVertexScale`. The action a gesture maps to
 * is exact; how far one pixel takes you is not.
 */

import {
  BUT_ACT_CODE,
  BUT_MODE_NOTHING,
  GlutButton,
  SELECTION_LEVELS,
  WheelAction,
  butModeTranslate,
} from './butmode';
import { MODE_NAME_DICT, type ModeName } from './modes';
import { isModeName, tableForMode } from './mouseConfig';

/** Degrees of rotation per pixel dragged. PyMOL's own trackball is ~0.5. */
const DEG_PER_PX = 0.5;

/** Ångströms of translation per pixel, before the zoom-distance scale. */
const MOVE_PER_PX = 0.1;

/** Ångströms of dolly per wheel notch. */
const ZOOM_PER_NOTCH = 2.0;

/** `mouse_wheel_scale` default (`packages/engine/layer1/SettingInfo.h`). */
const WHEEL_SCALE = 1.0;

/** The mode the C core boots in, and the table used until the backend answers. */
export const DEFAULT_MOUSE_MODE: ModeName = 'three_button_viewing';

/** How stale the cached mouse mode may get before the next press re-reads it. */
const MODE_TTL_MS = 1000;

/** How the driver reaches the backend: one RPC call by function name. */
export type CameraCall = (fn: string, args?: readonly unknown[]) => Promise<unknown>;

/** A screen-space rectangle in DOM CSS pixels, y DOWN. */
export interface BandBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One atom, as the client-side pick index reports it (`index` 0-based). */
export interface AtomRef {
  object: string;
  index: number;
}

/** Everything `createCameraDriver` needs: the RPC call plus optional hooks. */
export interface CameraDriverOptions {
  call: CameraCall;
  onError?: (error: Error) => void;
  /** Overridable for tests. */
  degPerPx?: number;
  movePerPx?: number;
  zoomPerNotch?: number;
  /**
   * The current mouse mode. When omitted the driver reads `button_mode_name`
   * from the backend itself (throttled), because nothing else in this package
   * is allowed to poll settings.
   */
  mode?: () => ModeName;
  /** `mouse_selection_mode`, 0..6. Default 1 (Residues), PyMOL's own default. */
  selectionMode?: () => number;
  /** `ExecutiveGetActiveSeleName`'s answer. Default `sele`. */
  activeSelection?: () => string;
  /** Resolve a click to an atom — the object and atom actions need one. */
  pick?: (x: number, y: number) => AtomRef | null;
  /** Resolve a rubber-band rectangle to atoms. Without it `+Box` does nothing. */
  boxHits?: (box: BandBox) => readonly AtomRef[];
  /** Live rubber-band rectangle, for the overlay. `null` when it is gone. */
  onBand?: (box: BandBox | null) => void;
  /** `cmd.get_view()`, for the slab arithmetic the wheel actions need. */
  view?: () => readonly number[] | null;
}

/** One drag sample: the motion since the last, plus button and modifiers. */
export interface DragDelta {
  /** Pixels moved since the last sample, in DOM coordinates. */
  dx: number;
  dy: number;
  /**
   * The absolute pointer position, in DOM CSS pixels within the canvas.
   * Optional, because only the rubber band needs it — everything else is a
   * relative motion. Without it the band falls back to accumulating deltas.
   */
  x?: number;
  y?: number;
  /** 0 left, 1 middle, 2 right — the same codes the input path uses. */
  button: number;
  /** `cOrtho` modifier mask: SHIFT 1, CTRL 2, ALT 4. */
  mod: number;
}

/** A press or a release, in DOM CSS pixels within the canvas (y DOWN). */
export interface GestureSample {
  x: number;
  y: number;
  button: number;
  mod: number;
}

/** Per-action tallies of the calls the driver issued, for the HUD and tests. */
export interface CameraCounters {
  turns: number;
  moves: number;
  zooms: number;
  /** `cmd.clip` calls (ClipNF / ClipN / ClipF, and the slab wheel actions). */
  clips: number;
  /** Object-matrix writes (RotO / MovO / MvOZ / RotV / MovV / MvVZ). */
  matrices: number;
  /** Atom and fragment coordinate writes (MovA / MvAZ / RotF / MovF / MvFZ). */
  coords: number;
  /** `cmd.torsion` calls (TorF). */
  torsions: number;
  /** Rubber-band selections committed (+Box / -Box / Box). */
  boxes: number;
  /** Gestures the table named but this driver cannot express. */
  unsupported: number;
  errors: number;
}

/** Turns pointer gestures into PyMOL camera/edit calls per the mouse mode. */
export interface CameraDriver {
  /** A button went down. Resolves the action and starts the gesture. */
  press(sample: GestureSample): void;
  drag(delta: DragDelta): void;
  /** A button came up. Commits a rubber band, ends the gesture. */
  release(sample: GestureSample): void;
  /** `notches > 0` is a wheel turn TOWARD the user (DOM `deltaY > 0`). */
  wheel(notches: number, mod?: number): void;
  /** Re-read the mouse mode from the backend. Resolves when the cache is warm. */
  refresh(): Promise<void>;
  /** The ButMode action code the last resolution produced. */
  readonly action: number;
  /** The mouse mode the driver is resolving against right now. */
  readonly mode: ModeName;
  /** The live rubber band, or null. */
  readonly band: BandBox | null;
  /** Calls issued, for assertions and the HUD. */
  readonly counters: CameraCounters;
}

const ACT = BUT_ACT_CODE;

/**
 * The actions that consume `LastPicked` — the object motions and the fragment
 * motions (`packages/engine/layer1/SceneMouse.cpp:1501-1513`). Every other action is resolved
 * from the gesture alone, so it must not pay for a ray cast.
 */
const NEEDS_PICK: ReadonlySet<number> = new Set(
  ['roto', 'movo', 'mvoz', 'rotv', 'movv', 'mvvz', 'rotf', 'movf', 'mvfz']
    .map((name) => ACT[name])
    .filter((code): code is number => code !== undefined),
);

/** `button_mode_name` -> `mode_dict` key. The inverse of `mode_name_dict`. */
export function modeFromDisplayName(displayName: string): ModeName | null {
  for (const [key, label] of Object.entries(MODE_NAME_DICT)) {
    if (label === displayName && isModeName(key)) return key;
  }
  // `default` has no display name: cmd.mouse writes the raw key through.
  return isModeName(displayName) ? displayName : null;
}

/** DOM button -> `GlutButton`. Anything else has no slot in the table. */
function glutButton(button: number): number | null {
  switch (button) {
    case 0:
      return GlutButton.Left;
    case 1:
      return GlutButton.Middle;
    case 2:
      return GlutButton.Right;
    default:
      return null;
  }
}

/** `obj\`N` — PyMOL's index selection is 1-based, the pick payload is not. */
function atomSelection(atom: AtomRef): string {
  return `${atom.object}\`${atom.index + 1}`;
}

/**
 * `ExecutiveSelectRect` (`packages/engine/layer3/Executive.cpp:7480-7520`), with the temporary
 * rectangle selection replaced by the literal atom list the client resolved.
 *
 * The three shapes are the C's, byte for byte, including the `?` prefixes that
 * make a missing selection evaluate to empty instead of raising.
 */
export function boxSelectExpression(
  action: number,
  selName: string,
  atoms: readonly AtomRef[],
  keyword: string,
): string {
  const list = atoms.map(atomSelection).join(' ');
  const kw = keyword === '' ? '' : `${keyword} `;
  if (atoms.length === 0) return action === ACT['-box'] ? `(?${selName})` : '(none)';
  if (action === ACT['+box']) return `(?${selName} or ${kw}(${list}))`;
  if (action === ACT['-box']) return `(${kw}(?${selName}) and not ${kw}(${list}))`;
  return `(${kw}(${list}))`;
}

/** Build a {@link CameraDriver} bound to the given transport and options. */
export function createCameraDriver(options: CameraDriverOptions): CameraDriver {
  const degPerPx = options.degPerPx ?? DEG_PER_PX;
  const movePerPx = options.movePerPx ?? MOVE_PER_PX;
  const zoomPerNotch = options.zoomPerNotch ?? ZOOM_PER_NOTCH;
  const counters: CameraCounters = {
    turns: 0,
    moves: 0,
    zooms: 0,
    clips: 0,
    matrices: 0,
    coords: 0,
    torsions: 0,
    boxes: 0,
    unsupported: 0,
    errors: 0,
  };

  /** The mode cache. Only used when the caller did not supply a getter. */
  let cachedMode: ModeName = DEFAULT_MOUSE_MODE;
  let cachedSelectionMode = 1;
  let cachedSeleName = 'sele';
  let modeReadAt = -Infinity;
  let modeInFlight: Promise<void> | null = null;

  const currentMode = (): ModeName => options.mode?.() ?? cachedMode;
  const selectionMode = (): number => options.selectionMode?.() ?? cachedSelectionMode;
  const seleName = (): string => options.activeSelection?.() ?? cachedSeleName;

  /** The gesture in flight, resolved at the press. */
  interface Gesture {
    button: number;
    /** The press point, for the rubber band. */
    x: number;
    y: number;
    /** The action the PRESS resolved to; drags re-resolve with their own mod. */
    action: number;
    /** The object under the press, for the object actions. */
    atom: AtomRef | null;
    /** `_pkfragN` plus the anchor, for the fragment actions. Null until read. */
    fragment: { selection: string; origin: readonly number[] | null } | null;
    fragmentPending: boolean;
  }
  let gesture: Gesture | null = null;
  let band: BandBox | null = null;
  let lastAction = BUT_MODE_NOTHING;

  const fail = (cause: unknown): void => {
    counters.errors++;
    options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
  };

  const run = (fn: string, args: readonly unknown[], kind: keyof CameraCounters): void => {
    counters[kind]++;
    void options.call(fn, args).catch(fail);
  };

  async function readMode(): Promise<void> {
    const [name, selMode, names] = await Promise.all([
      options.call('cmd.get_setting_text', ['button_mode_name']),
      options.call('cmd.get_setting_int', ['mouse_selection_mode']),
      options.call('cmd.get_names', ['selections', 1]),
    ]);
    const resolved = modeFromDisplayName(String(name ?? ''));
    if (resolved !== null) cachedMode = resolved;
    const level = Number(selMode);
    if (Number.isFinite(level)) cachedSelectionMode = level;
    // `ExecutiveGetActiveSeleName` returns the first ENABLED selection and
    // falls back to creating `sele` (`packages/engine/layer3/Executive.cpp:7476`).
    const enabled = Array.isArray(names) ? (names as unknown[]).filter((n) => typeof n === 'string') : [];
    cachedSeleName = (enabled[0] as string | undefined) ?? 'sele';
    modeReadAt = Date.now();
  }

  function refresh(): Promise<void> {
    if (modeInFlight !== null) return modeInFlight;
    const done = readMode()
      .catch(fail)
      .finally(() => {
        modeInFlight = null;
      });
    modeInFlight = done;
    return done;
  }

  /** Read the mode at most once per TTL, and never when a getter supplies it. */
  function maybeRefresh(): void {
    if (options.mode !== undefined) return;
    if (Date.now() - modeReadAt < MODE_TTL_MS) return;
    void refresh();
  }

  function resolve(button: number, mod: number): number {
    const glut = glutButton(button);
    if (glut === null) return BUT_MODE_NOTHING;
    const action = butModeTranslate(tableForMode(currentMode()), glut, mod);
    lastAction = action;
    return action;
  }

  /* ---------------------------------------------------------- fragments */

  /**
   * The `_pkfragN` selection that contains `atom`, plus the editor's anchor.
   *
   * `EditorPrepareDrag` walks fragments 1..NFrag and keeps the one the dragged
   * atom belongs to (`packages/engine/layer3/Editor.cpp:1928-1940`). `SelectorSubdivide` makes
   * at most four of them — one per picked atom (`pk1`..`pk4`) — so this probe
   * is bounded at four `count_atoms` calls and runs once per gesture.
   *
   * SAMPLES BEFORE IT RESOLVES ARE DROPPED, not queued: on loopback the probe
   * is under a millisecond, and a queued delta applied late would move the
   * fragment after the user stopped.
   */
  async function readFragment(atom: AtomRef): Promise<void> {
    const target = atomSelection(atom);
    for (let n = 1; n <= 4; n++) {
      const selection = `_pkfrag${n}`;
      // `(?name)` — the "maybe" prefix. MEASURED: `count_atoms('_pkfrag3')`
      // RAISES ` Error: Invalid selection name "_pkfrag3"` when the editor made
      // only two fragments, which would abort the probe on its third step. The
      // same `?` the C's own `ExecutiveSelectRect` uses makes it evaluate empty.
      const count = await options.call('cmd.count_atoms', [`(?${selection}) and (${target})`]);
      if (Number(count) > 0) {
        let origin: readonly number[] | null = null;
        try {
          const coords = await options.call('cmd.get_atom_coords', ['pk1']);
          if (Array.isArray(coords) && coords.length === 3) origin = coords as number[];
        } catch {
          origin = null; // no anchor: rotate about the fragment's own centre
        }
        if (gesture !== null) gesture.fragment = { selection, origin };
        return;
      }
    }
  }

  function ensureFragment(): { selection: string; origin: readonly number[] | null } | null {
    const g = gesture;
    if (g === null) return null;
    if (g.fragment !== null) return g.fragment;
    if (g.fragmentPending || g.atom === null) return null;
    g.fragmentPending = true;
    void readFragment(g.atom).catch(fail);
    return null;
  }

  /* -------------------------------------------------------------- drags */

  /** Screen-space delta -> a camera-space vector, in Ångströms. */
  const cameraVector = (dx: number, dy: number, z = 0): number[] => [
    dx * movePerPx,
    -dy * movePerPx,
    z * movePerPx,
  ];

  function dispatchDrag(action: number, delta: DragDelta): void {
    const { dx, dy } = delta;
    const g = gesture;
    switch (action) {
      case ACT['rota']:
        // Horizontal drag spins about the VERTICAL axis and vice versa — the
        // axis is perpendicular to the motion, which is what makes a trackball
        // feel like one.
        if (dx !== 0) run('cmd.turn', ['y', dx * degPerPx], 'turns');
        if (dy !== 0) run('cmd.turn', ['x', dy * degPerPx], 'turns');
        return;
      case ACT['rotz']:
        if (dx !== 0) run('cmd.turn', ['z', dx * degPerPx], 'turns');
        return;
      case ACT['irtz']:
        if (dx !== 0) run('cmd.turn', ['z', -dx * degPerPx], 'turns');
        return;
      case ACT['move']:
        // Screen right is +x. Screen DOWN is -y in PyMOL's frame, so dy is
        // negated: without this a drag down moves the model up.
        if (dx !== 0) run('cmd.move', ['x', dx * movePerPx], 'moves');
        if (dy !== 0) run('cmd.move', ['y', -dy * movePerPx], 'moves');
        return;
      case ACT['movz']:
        if (dy !== 0) run('cmd.move', ['z', dy * movePerPx], 'zooms');
        return;
      case ACT['imvz']:
        if (dy !== 0) run('cmd.move', ['z', -dy * movePerPx], 'zooms');
        return;
      /*
       * `SceneMouse.cpp:1925-1955`, and the signs are MEASURED, not assumed:
       * ClipNF does `back -= dx/10` and `front -= dy/10` in PyMOL screen
       * coordinates (y UP), while `cmd.clip('far', d)` does `back -= d` and
       * `cmd.clip('near', d)` does `front -= d` (`SceneClip`, `Scene.cpp:1372`,
       * confirmed live: `clip near, 1` moved `get_view()[15]` by exactly -1).
       * A DOM dy is the negative of a PyMOL dy, hence the one flip.
       */
      case ACT['clip']:
        if (dx !== 0) run('cmd.clip', ['far', dx / 10], 'clips');
        if (dy !== 0) run('cmd.clip', ['near', -dy / 10], 'clips');
        return;
      case ACT['clpn']:
        if (dx !== 0 || dy !== 0) run('cmd.clip', ['near', (dx - dy) / 10], 'clips');
        return;
      case ACT['clpf']:
        if (dx !== 0 || dy !== 0) run('cmd.clip', ['far', (dx - dy) / 10], 'clips');
        return;
      case ACT['roto']:
      case ACT['rotv']: {
        const object = g?.atom?.object;
        if (object === undefined) break;
        if (dx !== 0) run('cmd.rotate', ['y', dx * degPerPx, 'all', -1, 1, object], 'matrices');
        if (dy !== 0) run('cmd.rotate', ['x', dy * degPerPx, 'all', -1, 1, object], 'matrices');
        return;
      }
      case ACT['movo']:
      case ACT['movv']: {
        const object = g?.atom?.object;
        if (object === undefined) break;
        if (dx !== 0 || dy !== 0)
          run('cmd.translate', [cameraVector(dx, dy), 'all', -1, 1, object], 'matrices');
        return;
      }
      case ACT['mvoz']:
      case ACT['mvvz']: {
        const object = g?.atom?.object;
        if (object === undefined) break;
        if (dy !== 0) run('cmd.translate', [cameraVector(0, 0, dy), 'all', -1, 1, object], 'matrices');
        return;
      }
      case ACT['torf']:
        // `EditorDrag` turns the drag into an angle about the picked bond;
        // `cmd.torsion` is the same rotation, driven by the same `pk1`/`pk2`.
        if (dx !== 0) run('cmd.torsion', [dx * degPerPx], 'torsions');
        return;
      case ACT['mova']:
        if (dx !== 0 || dy !== 0) run('cmd.translate', [cameraVector(dx, dy), 'pk1', -1, 1], 'coords');
        return;
      case ACT['mvaz']:
        if (dy !== 0) run('cmd.translate', [cameraVector(0, 0, dy), 'pk1', -1, 1], 'coords');
        return;
      case ACT['rotf']: {
        const frag = ensureFragment();
        if (frag === null) return; // still probing; see readFragment
        const args = (axis: string, angle: number): unknown[] => [
          axis,
          angle,
          frag.selection,
          -1,
          1,
          null,
          frag.origin,
        ];
        if (dx !== 0) run('cmd.rotate', args('y', dx * degPerPx), 'coords');
        if (dy !== 0) run('cmd.rotate', args('x', dy * degPerPx), 'coords');
        return;
      }
      case ACT['movf']: {
        const frag = ensureFragment();
        if (frag === null) return;
        if (dx !== 0 || dy !== 0)
          run('cmd.translate', [cameraVector(dx, dy), frag.selection, -1, 1], 'coords');
        return;
      }
      case ACT['mvfz']: {
        const frag = ensureFragment();
        if (frag === null) return;
        if (dy !== 0) run('cmd.translate', [cameraVector(0, 0, dy), frag.selection, -1, 1], 'coords');
        return;
      }
      case ACT['+box']:
      case ACT['-box']:
      case ACT['box']:
        return; // the band is tracked in drag(); nothing is written until release
      default:
        break;
    }
    counters.unsupported++;
  }

  /* -------------------------------------------------------- rubber band */

  function isBoxAction(action: number): boolean {
    return action === ACT['+box'] || action === ACT['-box'] || action === ACT['box'];
  }

  /** `SceneLoopRelease` swaps the corners before selecting (`SceneMouse.cpp:76-85`). */
  function normalise(box: BandBox): BandBox {
    return {
      left: Math.min(box.left, box.right),
      right: Math.max(box.left, box.right),
      top: Math.min(box.top, box.bottom),
      bottom: Math.max(box.top, box.bottom),
    };
  }

  function commitBand(action: number): void {
    const box = band === null ? null : normalise(band);
    band = null;
    options.onBand?.(null);
    if (box === null) return;
    const hits = options.boxHits?.(box) ?? [];
    const name = seleName();
    if (hits.length === 0 && action === ACT['box']) {
      // "no atoms in the rectangle" with Box SET means deselect, which is what
      // `ExecutiveSelectRect`'s empty branch does (`Executive.cpp:7560-7570`).
      counters.boxes++;
      void options.call('cmd.disable', [name]).catch(fail);
      return;
    }
    if (hits.length === 0 && action === ACT['+box']) return; // add nothing: no write
    const keyword = SELECTION_LEVELS.find((l) => l.value === selectionMode())?.keyword ?? '';
    counters.boxes++;
    void options
      .call('cmd.select', [name, boxSelectExpression(action, name, hits, keyword)])
      .then(() => options.call('cmd.enable', [name]))
      .catch(fail);
  }

  /* ------------------------------------------------------------- wheel */

  function slab(): { front: number; back: number } | null {
    const view = options.view?.();
    if (!view || view.length < 18) return null;
    return { front: Number(view[15]), back: Number(view[16]) };
  }

  function dispatchWheel(action: number, notches: number): void {
    switch (action) {
      case WheelAction.ScaleSlabExpand:
      case WheelAction.ScaleSlabShrink: {
        // `SceneMouse.cpp:717-727`: the slab is SCALED by 1 ± 0.2 * scale.
        const factor = 1 + (action === WheelAction.ScaleSlabExpand ? 0.2 : -0.2) * WHEEL_SCALE;
        const planes = slab();
        if (planes === null) break;
        const thickness = Math.max(0.001, planes.back - planes.front);
        run('cmd.clip', ['slab', thickness * factor], 'clips');
        return;
      }
      case WheelAction.MoveSlabForward:
      case WheelAction.MoveSlabBackward:
      case WheelAction.MoveSlabAndZoomForward:
      case WheelAction.MoveSlabAndZoomBackward: {
        const forward =
          action === WheelAction.MoveSlabForward || action === WheelAction.MoveSlabAndZoomForward;
        const planes = slab();
        if (planes === null) break;
        const thickness = Math.max(0.001, planes.back - planes.front);
        // `SceneClipMode::Proportional`, ±0.1 * scale of the slab thickness.
        run('cmd.clip', ['move', (forward ? 0.1 : -0.1) * WHEEL_SCALE * thickness], 'clips');
        return;
      }
      case WheelAction.ZoomForward:
      case WheelAction.ZoomBackward: {
        /*
         * `SceneMouse.cpp:752-780`: the dolly is PROPORTIONAL to the slab
         * midpoint, `factor = -/+((front + back) / 2) * 0.1 * scale`, applied
         * as `translate(0, 0, factor)` with `front`/`back` following it — which
         * is exactly what `cmd.move('z', factor)` does (measured: `move z, 5`
         * moved `get_view()[11]` by +5 and `[15]` by -5). The upstream guard
         * (`if (factor <= 0)` forward, `>= 0` backward) is kept, so a slab that
         * straddles the eye does not invert the gesture.
         */
        const planes = slab();
        const forward = action === WheelAction.ZoomForward;
        const magnitude =
          planes === null
            ? Math.abs(notches) * zoomPerNotch
            : Math.abs(((planes.front + planes.back) / 2) * 0.1 * WHEEL_SCALE);
        const factor = forward ? -magnitude : magnitude;
        if (forward ? factor <= 0 : factor >= 0) run('cmd.move', ['z', factor], 'zooms');
        return;
      }
      default:
        break;
    }
    counters.unsupported++;
  }

  return {
    counters,
    refresh,
    get action(): number {
      return lastAction;
    },
    get mode(): ModeName {
      return currentMode();
    },
    get band(): BandBox | null {
      return band;
    },

    press(sample: GestureSample): void {
      maybeRefresh();
      const action = resolve(sample.button, sample.mod);
      gesture = {
        button: sample.button,
        x: sample.x,
        y: sample.y,
        action,
        atom: null,
        fragment: null,
        fragmentPending: false,
      };
      if (isBoxAction(action)) {
        band = { left: sample.x, top: sample.y, right: sample.x, bottom: sample.y };
        options.onBand?.(band);
        return;
      }
      // Only the actions that NEED an object pay for the ray cast: PyMOL keeps
      // `LastPicked` from the press for exactly these, and a plain `Rota` press
      // should not walk the whole geometry index for an answer it will discard.
      if (options.pick && NEEDS_PICK.has(action)) {
        gesture.atom = options.pick(sample.x, sample.y);
      }
    },

    drag(delta: DragDelta): void {
      // `SceneDrag` re-resolves on every sample with the CURRENT modifier and
      // the button captured at the press (`SceneMouse.cpp:1308`).
      const button = gesture?.button ?? delta.button;
      const action = resolve(button, delta.mod);
      if (isBoxAction(action) && band !== null) {
        // ABSOLUTE when the caller knows it: `SceneLoopDrag` sets
        // `LoopRect.right/bottom` to the cursor, it does not integrate deltas
        // (`packages/engine/layer1/SceneMouse.cpp:56-66`), and an anchor sample with a zero
        // delta must still move the rectangle.
        band = {
          ...band,
          right: delta.x ?? band.right + delta.dx,
          bottom: delta.y ?? band.bottom + delta.dy,
        };
        options.onBand?.(band);
        return;
      }
      if (delta.dx === 0 && delta.dy === 0) return;
      dispatchDrag(action, delta);
    },

    release(sample: GestureSample): void {
      const action = gesture === null ? resolve(sample.button, sample.mod) : gesture.action;
      if (isBoxAction(action)) commitBand(action);
      gesture = null;
    },

    wheel(notches: number, mod = 0): void {
      if (notches === 0) return;
      // DOM `deltaY > 0` scrolls content down, which is the wheel turning
      // TOWARD the user: `P_GLUT_BUTTON_SCROLL_BACKWARD`.
      const button = notches < 0 ? GlutButton.ScrollForward : GlutButton.ScrollBackward;
      const action = butModeTranslate(tableForMode(currentMode()), button, mod);
      lastAction = action;
      dispatchWheel(action, notches);
    },
  };
}
