/**
 * The client half of `packages/bridge/tenmol_bridge/panels/objects.py`.
 *
 * WHY THERE IS A BOOTSTRAP CALL
 * =============================
 * `panels/__init__.py` is a frozen barrel that nothing in the bridge imports,
 * and `server.py`'s `_bridge.*` route table (`BridgeServer.bridge_route`) is
 * owned by WP-02 and lists only the render service. So the panel module has no
 * route until somebody adds one. What it DOES have is `dispatch.py`'s rule that
 * a one-segment `fn` resolves with `getattr(engine.cmd, fn)` — the same seam
 * `shims.py` uses for PyMOL's five GUI hooks — so `install()` binds itself onto
 * the live `cmd` object as `cmd.tenmol_objects` and the ordinary `{t:'call'}`
 * path reaches it with no policy grant and no edit outside this work package.
 *
 * The bootstrap is ONE `{t:'do'}` per bridge PROCESS, not per connection: the
 * attribute lives on `cmd`, so a reconnect finds it already installed. We
 * therefore always TRY the call first and only bootstrap when it fails, which
 * keeps the user's console clean after the first time.
 *
 * `{t:'do'}` is explicitly allowed for UI code (plan §A6 / `dispatch.py`: every
 * `pymol.menu` popup leaf is a command *string*), and it is also how every menu
 * leaf here is executed — `PopUp.cpp:471-475` logs the string and PParses it,
 * which is exactly `cmd.do`.
 */

import type { PanelMenuPayload, PanelSnapshot } from '@tenmol/protocol';

/**
 * What `panels/objects.py:snapshot` answers on top of `PanelSnapshot`.
 *
 * `specLevels` is `ObjectGetSpecLevel(obj, SceneGetFrame(G))` per object; it is
 * NOT in `@tenmol/protocol`'s `PanelSnapshot` because it is per-FRAME state and
 * that type describes the row list, which is not. Keeping it here means the M
 * button's tint costs no extra round trip and no shared-type change.
 */
export interface PanelExtras {
  specLevels?: Record<string, number>;
  /** `cmd.get_frame()` — 1-based, the frame `specLevels` was read at. */
  frame?: number;
  /** `internal_gui_mode`; 0 = Default, anything else inverts the pop-ups. */
  internalGuiMode?: number;
}

/** A panel snapshot plus the extra GUI-mode fields the source layers on. */
export type PanelSnapshotFull = PanelSnapshot & PanelExtras;

/** `{t:'call'}` — `fn` is a dotted path resolved against `cmd` by the bridge. */
export type CallFn = <T = unknown>(
  fn: string,
  args?: readonly unknown[],
  kwargs?: Readonly<Record<string, unknown>>,
) => Promise<T>;

/** `{t:'do'}` — a raw PyMOL command line. */
export type DoFn = (commandLine: string) => Promise<unknown>;

/** The wire callbacks a panel source needs: a `call` and a `do`. */
export interface PanelSourceOptions {
  call: CallFn;
  do: DoFn;
}

/** Reads the objects panel — snapshots and row menus — over the bridge. */
export interface PanelSource {
  /** One panel snapshot. Bootstraps the endpoint on first use. */
  snapshot(): Promise<PanelSnapshotFull>;
  /** One row's popup menu, straight out of `pymol.menu.<name>`. */
  menu(name: string, op: string, kind?: string): Promise<PanelMenuPayload>;
  /** Resolve one lazy (`lambda:`) submenu — PyMOL's `SubGetItem`. */
  expand(
    name: string,
    op: string,
    path: readonly number[],
    kind?: string,
  ): Promise<{ items: PanelMenuPayload['items'] }>;
  /** True once a call has succeeded; false while it is still unproven. */
  readonly ready: boolean;
  /** Forget that the endpoint was installed (after a reconnect). */
  reset(): void;
}

/** The symbol `install()` binds; must match `panels/objects.py:ATTRIBUTE`. */
export const PANEL_SYMBOL = 'tenmol_objects';

/**
 * The bootstrap line. `/` makes PyMOL's parser treat the rest as Python
 * (`packages/engine/modules/pymol/parser.py`), which is the only way to import a module into
 * the engine from the wire.
 */
export const BOOTSTRAP =
  '/from tenmol_bridge.panels.objects import install;install()';

/** Build a panel source over the given `call`/`do`, bootstrapping on first use. */
export function createPanelSource(options: PanelSourceOptions): PanelSource {
  const { call } = options;
  let installed = false;
  let bootstrapping: Promise<void> | null = null;

  async function bootstrap(): Promise<void> {
    if (!bootstrapping) {
      // `Promise.resolve` because a bootstrap that throws synchronously, or a
      // transport that returns nothing, must not take the panel down with it —
      // the retry below is the real answer either way.
      bootstrapping = Promise.resolve()
        .then(() => options.do(BOOTSTRAP))
        .then(
          () => undefined,
          () => undefined,
        );
    }
    await bootstrapping;
    bootstrapping = null;
  }

  async function invoke<T>(verb: string, args: readonly unknown[] = []): Promise<T> {
    try {
      const value = await call<T>(PANEL_SYMBOL, [verb, ...args]);
      installed = true;
      return value;
    } catch (error) {
      if (installed) throw error;
      // First failure: the module may simply not be bound yet. Bootstrap once
      // and retry; a second failure is a real one and propagates.
      await bootstrap();
      const value = await call<T>(PANEL_SYMBOL, [verb, ...args]);
      installed = true;
      return value;
    }
  }

  return {
    get ready() {
      return installed;
    },
    snapshot: () => invoke<PanelSnapshotFull>('snapshot'),
    menu: (name, op, kind) => invoke<PanelMenuPayload>('menu', [name, op, kind ?? null]),
    expand: (name, op, path, kind) =>
      invoke<{ items: PanelMenuPayload['items'] }>('expand', [name, op, [...path], kind ?? null]),
    reset() {
      installed = false;
      bootstrapping = null;
    },
  };
}
