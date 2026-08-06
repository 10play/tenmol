/**
 * The one open PyMOL pop-up.
 *
 * PyMOL has exactly one pop-up at a time: `MenuActivate*` pushes a `CPopUp`
 * block onto Ortho and the previous one is dismissed (`packages/engine/layer4/PopUp.cpp:263`,
 * `packages/engine/layer4/Menu.cpp`). Modelling that as a module singleton — rather than as
 * local state in whichever component opened it — is what lets the ButMode
 * block, the object panel and (later) a scene strip all raise a menu without
 * knowing about each other, and guarantees that opening a second one closes
 * the first.
 *
 * The payload is PyMOL's own menu shape: a list of `[code, label, command]`
 * rows where code 0 is a separator, 1 a clickable leaf and 2 a non-clickable
 * title (`packages/engine/layer4/PopUp.cpp:270-300`), and a leaf's `command` is a COMMAND
 * STRING executed verbatim (`:471-475`) — which is why plan §A6 had to allow
 * `t:'do'` from the UI at all.
 */

import { createStore, type Store } from '@tenmol/stores';

/** `[code, label, command]` exactly as `packages/engine/modules/pymol/menu.py` returns it. */
export type PymolMenuRow = readonly [code: number, label: string, command: string];

/** State of the popup PyMOL menu: whether it is open, its rows, and where it was anchored. */
export interface PymolMenuState {
  open: boolean;
  /** Optional heading; PyMOL uses a code-2 row for this, we allow both. */
  title: string;
  rows: readonly PymolMenuRow[];
  /** Viewport coordinates of the click that opened it. */
  x: number;
  y: number;
  /** Monotonic, so a re-open at the same point still re-renders. */
  epoch: number;
}

const EMPTY: PymolMenuState = { open: false, title: '', rows: [], x: 0, y: 0, epoch: 0 };

/** Store for the popup PyMOL menu, with imperative open/close controls. */
export interface PymolMenuStore extends Store<PymolMenuState> {
  openAt(
    x: number,
    y: number,
    rows: readonly PymolMenuRow[],
    title?: string,
  ): void;
  close(): void;
}

/** Build a fresh popup-menu store; prefer the `pymolMenu` singleton below. */
export function createPymolMenuStore(): PymolMenuStore {
  const store = createStore<PymolMenuState>({ ...EMPTY });
  return {
    ...store,
    openAt(x, y, rows, title = ''): void {
      store.set((state) => ({
        open: true,
        title,
        rows,
        x,
        y,
        epoch: state.epoch + 1,
      }));
    },
    close(): void {
      store.set((state) => ({ ...EMPTY, epoch: state.epoch }));
    },
  };
}

/** The singleton. Import it, do not construct another. */
export const pymolMenu: PymolMenuStore = createPymolMenuStore();
