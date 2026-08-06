/**
 * `cmd.volume_panel(name)` -> the React window, from wherever it was called.
 *
 * THE ROW THIS CLOSES. Area 10's container row said "NOT done: `cmd.volume_panel(name)`
 * as the entry point (fails with `ImportError: pymol.Qt`) and the
 * `volume_ramp_changed` event", and the presets row said the `A > volume`
 * `panel` leaf "is not wired". Both are the same command string, and it now has
 * TWO routes into this client — deliberately, because they cover different
 * callers:
 *
 *   1. THE LOCAL ROUTE. `features/pymol-menu/leafHooks.ts` lets a leaf be
 *      claimed before it is sent, so a click on `panel` in a pop-up opens the
 *      window with no round trip at all and nothing appears in the console. It
 *      only covers pop-ups this client renders.
 *   2. THE ENGINE ROUTE. `packages/bridge/tenmol_bridge/panels/volume.py` rebinds
 *      `cmd.volume_panel` (and its `cmd.keyword` entry, so the typed command
 *      language reaches it too) to a Qt-free shim that RECORDS the request and
 *      prints one tagged line. That line arrives here on the ordinary
 *      `feedback` topic. This route covers everything: `PyMOL>volume_panel vol`
 *      at the prompt, a `.pml` script, a plugin, and the object panel's own row
 *      menu — which is a second dispatch site in a directory this work package
 *      does not own (`features/objects/ObjectPanel.tsx:527-530`).
 *
 * WHY A CONSOLE LINE AND NOT A TOPIC. `packages/protocol/src/topics/index.ts`
 * is frozen, so `volume_ramp_changed` cannot be a topic; `feedback` is the one
 * server->client stream a feature can reach without editing it. The bridge
 * module's `echo` flag is therefore ON here, and the cost is honest: the marker
 * is visible in the PyMOL console. It is one line per EXPLICIT `volume_panel`
 * call and one per ramp change made from OUTSIDE an open editor, because the
 * editor's own pushes send `_guiupdate: 0` and the shim honours it.
 *
 * WHERE THIS IS INSTALLED. `features/pymol-menu`'s slot, which is the only
 * always-mounted component either directory owns: the `volume` slot is an
 * OVERLAY and does not exist until a window is open, which is precisely the
 * moment this has to work from. Three features have shipped dead handlers by
 * registering from a panel that was not mounted yet.
 */

import type { Session } from '../../app';
import { openPanel } from '../../shell/panelHooks';
import { registerLeafHook } from '../pymol-menu/leafHooks';
import { dialogsStore } from '../dialogs/store';

/** `packages/bridge/tenmol_bridge/panels/volume.py`, as the dispatcher addresses it. */
export const VOLUME_NS = 'cmd.tenmol_volume';

/**
 * `/` makes PyMOL's parser treat the rest as Python (`packages/engine/modules/pymol/parser.py`),
 * and `echo=1` turns on the tagged feedback marker this module listens for.
 */
export const VOLUME_BOOTSTRAP =
  '/import tenmol_bridge.panels.volume as _tv;_tv.install(echo=1)';

/** The console marker. Must match `panels/volume.py`'s `TAG`. */
export const VOLUME_TAG = 'TENMOL_VOLUME';

/** A parsed volume console marker: a panel-open or ramp-changed event and its stop count. */
export interface VolumeEvent {
  kind: 'panel' | 'ramp';
  name: string;
  /** Stops in the new ramp; 0 for `panel`, -1 when the read-back failed. */
  stops: number;
}

/**
 * `cmd.volume_panel('vol')` — the leaf `packages/engine/modules/pymol/menu.py:648` builds.
 *
 * Deliberately narrow. `menu.py` builds the argument with `%s` on a value that
 * is already `repr`-quoted (`rsele`), so the only forms that exist are a single
 * or double quoted literal; anything else — a variable, a nested call, extra
 * arguments — is NOT ours and goes to the engine, where the shim handles it.
 */
const PANEL_LEAF = /^cmd\.volume_panel\(\s*(['"])((?:[^'"\\]|\\.)*)\1\s*\)$/;

/** Extract the object name from a `cmd.volume_panel('x')` command, or null if it is not one. */
export function volumePanelLeafName(command: string): string | null {
  const match = PANEL_LEAF.exec(command.trim());
  if (!match) return null;
  // `repr` escapes with backslashes; a PyMOL object name cannot contain one,
  // but unescaping is one line and a wrong name would open a dead panel.
  return (match[2] ?? '').replace(/\\(.)/g, '$1');
}

/**
 * `TENMOL_VOLUME <kind> <name> <stops>`.
 *
 * The name is taken as the whole middle field rather than by splitting on the
 * first space from the right, because PyMOL object names may not contain
 * spaces (`ExecutiveValidName`) while a badly-formed line must not be parsed
 * into a plausible-looking event.
 */
export function parseVolumeEvent(line: string): VolumeEvent | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 4 || parts[0] !== VOLUME_TAG) return null;
  const kind = parts[1];
  if (kind !== 'panel' && kind !== 'ramp') return null;
  const stops = Number(parts[3]);
  if (!Number.isFinite(stops)) return null;
  return { kind, name: parts[2] ?? '', stops };
}

/* ------------------------------------------------------------------ *
 * the event bus
 * ------------------------------------------------------------------ */

type EventListener = (event: VolumeEvent) => void;
const listeners = new Set<EventListener>();

/**
 * `volume_ramp_changed`, keyed by object name.
 *
 * This is the subscription the inventory row asked for, and the panel is the
 * only consumer: upstream's equivalent is `_volume_windows_qt[name].widget()
 * .editor.setColors(ramplist)` (`colorramping.py:170-179`), which likewise
 * only exists while a window for that name is open.
 */
export function subscribeVolumeRamp(name: string, listener: () => void): () => void {
  const wrapped: EventListener = (event) => {
    if (event.kind === 'ramp' && event.name === name) listener();
  };
  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}

/** Exported for tests: deliver an event as if it had come off the socket. */
export function emitVolumeEvent(event: VolumeEvent): void {
  for (const listener of [...listeners]) if (listeners.has(listener)) listener(event);
}

/* ------------------------------------------------------------------ *
 * opening a window
 * ------------------------------------------------------------------ */

/**
 * Show the editor for `name`, raising the cached one rather than making a
 * second — `_volume_windows_qt` semantics, which `dialogsStore.open` already
 * implements by key.
 *
 * `openPanel` is what MOUNTS the overlay slot; without it the store would hold
 * a window nobody draws.
 */
export function openVolumeWindow(name: string): string {
  const key = dialogsStore.open('volume', name);
  openPanel('volume');
  return key;
}

/* ------------------------------------------------------------------ *
 * the bridge module
 * ------------------------------------------------------------------ */

/** After this many failed installs, stop asking: the bridge has no such module. */
const MAX_INSTALL_ATTEMPTS = 3;

interface BridgeState {
  installed: boolean;
  attempts: number;
}

const BY_SESSION = new WeakMap<Session, BridgeState>();

function stateOf(session: Session): BridgeState {
  const existing = BY_SESSION.get(session);
  if (existing) return existing;
  const created: BridgeState = { installed: false, attempts: 0 };
  BY_SESSION.set(session, created);
  return created;
}

/**
 * Probe first, bootstrap only if the probe fails — `filesApi.ensure()`'s rule.
 * The PyMOL process survives a socket drop but a bridge restart does not, and
 * this side cannot tell the two apart cheaply.
 */
export async function ensureVolumeBridge(session: Session): Promise<boolean> {
  const state = stateOf(session);
  if (state.installed) return true;
  if (state.attempts >= MAX_INSTALL_ATTEMPTS) return false;
  state.attempts += 1;
  try {
    const status = await session.call<{ installed?: boolean; ok?: boolean }>(
      `${VOLUME_NS}.status`,
    );
    if (status?.ok) {
      state.installed = true;
      return true;
    }
  } catch {
    /* the normal first-run path: `no such symbol` */
  }
  try {
    // `echo=0` on `cmd.do` so the import itself does not appear in the console;
    // the module's OWN echo flag is what puts the event markers there.
    await session.call('cmd.do', [VOLUME_BOOTSTRAP], { echo: 0 });
    const status = await session.call<{ ok?: boolean }>(`${VOLUME_NS}.status`);
    state.installed = !!status?.ok;
  } catch {
    state.installed = false;
  }
  return state.installed;
}

/** Exported for tests only: forget what this session was told. */
export function resetVolumeBridge(session: Session): void {
  BY_SESSION.delete(session);
}

/** "A panel for `name` is open" — the `_volume_windows_qt` key, server side. */
export async function watchVolume(session: Session, name: string): Promise<boolean> {
  if (!(await ensureVolumeBridge(session))) return false;
  try {
    await session.call(`${VOLUME_NS}.watch`, [name]);
    return true;
  } catch {
    return false;
  }
}

/** Tell the server a volume panel for `name` has closed; failures are ignored. */
export async function unwatchVolume(session: Session, name: string): Promise<void> {
  try {
    await session.call(`${VOLUME_NS}.unwatch`, [name]);
  } catch {
    /* the panel is closing; a failed unwatch costs one ignored event */
  }
}

/* ------------------------------------------------------------------ *
 * installation
 * ------------------------------------------------------------------ */

/**
 * Bind both routes for the life of the application. Returns a teardown.
 *
 * Everything here is best-effort: a bridge with no volume module, or no socket
 * at all, must leave the pop-up host working exactly as it did before.
 */
export function installVolumeMenuBridge(session: Session): () => void {
  const offLeaf = registerLeafHook('volume-panel', (command) => {
    const name = volumePanelLeafName(command);
    if (name === null) return false;
    openVolumeWindow(name);
    return true;
  });

  const offFeedback =
    session.conn?.on?.('feedback', ({ lines }) => {
      for (const line of lines ?? []) {
        const event = parseVolumeEvent(line);
        if (!event) continue;
        if (event.kind === 'panel') openVolumeWindow(event.name);
        emitVolumeEvent(event);
      }
    }) ?? (() => undefined);

  const offOpen =
    session.conn?.on?.('connection:open', () => {
      // A bridge restart loses the shim; a socket drop does not. `ensure`
      // probes before it bootstraps, so re-arming on every open is cheap.
      resetVolumeBridge(session);
      void ensureVolumeBridge(session);
    }) ?? (() => undefined);

  void ensureVolumeBridge(session).catch(() => undefined);

  return () => {
    offLeaf();
    offFeedback();
    offOpen();
  };
}
