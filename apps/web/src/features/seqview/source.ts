/**
 * The seqview data feed and the writes the click grammar performs.
 *
 * There is no `seqview` push topic and there cannot be one without touching the
 * frozen bridge topic set, so this is a poll — same shape as WP-12's object
 * panel, at a much lower rate because a sequence row only changes when the
 * structure, the state, the settings or the selection change.
 *
 * BOOTSTRAP.  `packages/bridge/tenmol_bridge/panels/seqview.py` is a bridge module, not a
 * PyMOL one, so nothing imports it until we ask. One allowed call does that:
 *
 *     cmd.do("from tenmol_bridge.panels import seqview; seqview.install()", 0, 0)
 *
 * `install()` binds `cmd.tenmol_seqview` onto the `pymol.cmd` module the
 * dispatcher resolves against (`packages/engine/modules/pymol2/__init__.py:53`), which is how a
 * PyMOL plugin installs a command and needs no policy grant: `cmd.do` is an
 * explicitly allowed capability (plan §A6) and `cmd.tenmol_seqview` is an
 * ordinary two-segment name under the `cmd` root. `log=0, echo=0` keeps the
 * bootstrap out of the user's console.
 */

import type { SeqviewPayload, SeqviewSelectResult } from '@tenmol/protocol';
import type { PanelMenuNode } from '@tenmol/protocol';

/**
 * One right-click popup, as `SeekerClick` builds it
 * (`packages/engine/layer3/Seeker.cpp:357-395`): `pick_sele` on the active selection when the
 * cell is IN that selection, `seq_option` on a `_seeker` temporary otherwise.
 */
export interface SeqviewMenuPayload {
  /** `pick_sele` | `seq_option`, or '' when there was nothing to build one on. */
  menu: string;
  /** The selection the leaves refer to — the active one, or `_seeker`. */
  sele: string;
  /** `ObjectMoleculeGetAtomSele` of the first atom, or the selection name. */
  title: string;
  items: PanelMenuNode[];
}

/** The `cmd.do` line that installs the seqview panel helper into the bridge. */
export const BOOTSTRAP_LINE =
  'from tenmol_bridge.panels import seqview; seqview.install()';

/** The dotted path the seqview source calls the bridge helper through. */
export const ENTRY_POINT = 'cmd.tenmol_seqview';

/** `{t:'call'}` — `fn` is a dotted path the bridge resolves against `cmd`. */
export type CallFn = <T = unknown>(
  fn: string,
  args?: readonly unknown[],
  kwargs?: Readonly<Record<string, unknown>>,
) => Promise<T>;

/** The sequence viewer's data and interaction API over the bridge: rows, selection, menus. */
export interface SeqviewSource {
  /** One poll pass. Bootstraps on the first call and after a reconnect. */
  rows(first: number, count: number): Promise<SeqviewPayload>;
  /** Left click / drag on ONE column's atoms (`SeekerSelectionToggle`). */
  select(
    object: string,
    atoms: readonly number[],
    include: boolean,
    startOver: boolean,
  ): Promise<SeqviewSelectResult>;
  /**
   * A drag span, addressed by COLUMN so a 6,000-column row costs two integers
   * (`SeekerSelectionToggleRange`, `packages/engine/layer3/Seeker.cpp:70-167`).
   */
  selectRange(
    object: string,
    firstCol: number,
    lastCol: number,
    include: boolean,
    startOver: boolean,
  ): Promise<SeqviewSelectResult>;
  /** Left double-click outside a cell (`:328-341`). */
  clear(): Promise<{ name: string; log: string }>;
  /** Middle click = center, ctrl+middle = zoom (`:275-315`). */
  center(
    object: string,
    atoms: readonly number[],
    zoom: boolean,
  ): Promise<{ log: string }>;
  /** A cell that carries a state sets that object's state (`:463-466`). */
  setState(object: string, state: number): Promise<{ log: string }>;
  /** Right click: `pick_sele` (selected cell) or `seq_option` (anything else). */
  menu(
    object: string,
    atoms: readonly number[],
    selected: boolean,
  ): Promise<SeqviewMenuPayload>;
  /** One lazy submenu of that popup — PyMOL's `SubGetItem`. */
  menuExpand(
    path: readonly number[],
    object: string,
    atoms: readonly number[],
    selected: boolean,
  ): Promise<{ path: number[]; items: PanelMenuNode[] }>;
  /** Forget that the panel is installed — after a reconnect. */
  reset(): void;
}

/** Build a seqview source over a bridge `call` function, self-bootstrapping on first use. */
export function createSeqviewSource(call: CallFn): SeqviewSource {
  let ready: Promise<void> | null = null;

  async function bootstrap(): Promise<void> {
    await call('cmd.do', [BOOTSTRAP_LINE, 0, 0]);
    // Probe rather than trust: `cmd.do` swallows exceptions into the console,
    // so a failed import would otherwise show up as a confusing AttributeError
    // on the first real call.
    const probe = await call<{ installed?: boolean }>(ENTRY_POINT, ['install']);
    if (!probe?.installed) {
      throw new Error(
        'seqview bootstrap ran but cmd.tenmol_seqview did not install',
      );
    }
  }

  async function ensure(): Promise<void> {
    if (ready === null) {
      ready = bootstrap().catch((error: unknown) => {
        ready = null; // a failed bootstrap must be retryable
        throw error;
      });
    }
    return ready;
  }

  async function action<T>(name: string, args: readonly unknown[]): Promise<T> {
    await ensure();
    return call<T>(ENTRY_POINT, [name, ...args]);
  }

  return {
    async rows(first: number, count: number): Promise<SeqviewPayload> {
      return action<SeqviewPayload>('rows', [-1, first, count]);
    },

    select(object, atoms, include, startOver) {
      return action<SeqviewSelectResult>('select', [
        object,
        [...atoms],
        include ? 1 : 0,
        startOver ? 1 : 0,
      ]);
    },

    selectRange(object, firstCol, lastCol, include, startOver) {
      return action<SeqviewSelectResult>('select_range', [
        object,
        firstCol,
        lastCol,
        include ? 1 : 0,
        startOver ? 1 : 0,
      ]);
    },

    clear() {
      return action<{ name: string; log: string }>('clear', []);
    },

    center(object, atoms, zoom) {
      return action<{ log: string }>('center', [object, [...atoms], zoom ? 1 : 0]);
    },

    setState(object, state) {
      return action<{ log: string }>('set_state', [object, state]);
    },

    menu(object, atoms, selected) {
      return action<SeqviewMenuPayload>('menu', [object, [...atoms], selected ? 1 : 0]);
    },

    menuExpand(path, object, atoms, selected) {
      return action<{ path: number[]; items: PanelMenuNode[] }>('menu_expand', [
        [...path],
        object,
        [...atoms],
        selected ? 1 : 0,
      ]);
    },

    reset() {
      ready = null;
    },
  };
}
