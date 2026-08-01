/**
 * The wizard RPCs, as a thin typed surface over `session.call`.
 *
 * Every symbol here is served by `bridge/tenmol_bridge/panels/wizards.py` and
 * granted by `bridge/tenmol_bridge/policy/grants/wp-16.py`. There is no
 * client-side model of a wizard: PyMOL owns the state, the browser draws what
 * the snapshot says and sends tags/codes back verbatim.
 *
 * The one rule that must never be broken here: **`code` is never evaluated in
 * the browser.** It is PyMOL command language run by `PParse`
 * (`layer1/Wizard.cpp:573-577`) — `sculpting.py:175` carries raw inline Python,
 * `demo.py:42` carries a keyword line. It goes back out as a string.
 */

import {
  WIZARD_RPC,
  type WizardCatalog,
  type WizardEventKind,
  type WizardEventResult,
  type WizardMenuResult,
  type WizardProbe,
  type WizardSnapshot,
} from '@tenmol/protocol';

export type CallFn = <T = unknown>(
  fn: string,
  args?: readonly unknown[],
  kwargs?: Readonly<Record<string, unknown>>,
) => Promise<T>;

/** Payload for `wizards.event`; the bridge gates on the mask before dispatch. */
export interface WizardEventPayload {
  /** `pick`: a selection expression the bridge turns into pk1 via `cmd.edit`. */
  selection?: string;
  /** `pick` with `bond: true`: the second atom of the picked bond. */
  selection2?: string;
  bond?: boolean;
  /** `select`: the named selection PyMOL just created. */
  name?: string;
  /** 1-based; omitted means "derive from the picked object" (`Wizard.cpp:189`). */
  state?: number;
  frame?: number;
  /** `key`/`special`: ASCII code. 8/127 backspace, 10/13 enter, 27 escape. */
  k?: number;
  x?: number;
  y?: number;
  /** cOrtho modifier bitmask: SHIFT=1 CTRL=2 ALT=4. */
  mod?: number;
}

export interface WizardService {
  probe(): Promise<WizardProbe>;
  snapshot(): Promise<WizardSnapshot>;
  menu(tag: string): Promise<WizardMenuResult>;
  exec(code: string): Promise<unknown>;
  event(kind: WizardEventKind, payload?: WizardEventPayload): Promise<WizardEventResult>;
  launch(name: string, args?: unknown[], kwargs?: Record<string, unknown>): Promise<WizardProbe>;
  replace(name: string, args?: unknown[], kwargs?: Record<string, unknown>): Promise<WizardProbe>;
  dismiss(all?: boolean): Promise<WizardProbe>;
  catalog(): Promise<WizardCatalog>;
}

export function createWizardService(call: CallFn): WizardService {
  return {
    probe: () => call<WizardProbe>(WIZARD_RPC.probe),
    snapshot: () => call<WizardSnapshot>(WIZARD_RPC.snapshot),
    menu: (tag) => call<WizardMenuResult>(WIZARD_RPC.menu, [tag]),
    exec: (code) => call(WIZARD_RPC.exec, [code]),
    event: (kind, payload = {}) =>
      call<WizardEventResult>(WIZARD_RPC.event, [kind], payload as Record<string, unknown>),
    launch: (name, args = [], kwargs = {}) =>
      call<WizardProbe>(WIZARD_RPC.launch, [name, args, kwargs]),
    replace: (name, args = [], kwargs = {}) =>
      call<WizardProbe>(WIZARD_RPC.replace, [name, args, kwargs]),
    dismiss: (all = false) => call<WizardProbe>(WIZARD_RPC.dismiss, [], { all }),
    catalog: () => call<WizardCatalog>(WIZARD_RPC.catalog),
  };
}

/** The empty snapshot: what the panel renders when no wizard is on the stack. */
export const EMPTY_SNAPSHOT: WizardSnapshot = {
  version: 0,
  depth: 0,
  cls: null,
  module: null,
  stack: [],
  panel: [],
  prompt: [],
  eventMask: 0,
  methods: [],
  errors: [],
  promptMode: 1,
};

/** True when `probe` says something a snapshot would show has changed. */
export function probeChanged(previous: WizardProbe | null, next: WizardProbe): boolean {
  if (previous === null) return true;
  return (
    previous.version !== next.version ||
    previous.depth !== next.depth ||
    previous.cls !== next.cls ||
    previous.module !== next.module
  );
}
