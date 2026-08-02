/**
 * The Builder's transport half, with no React in it, so it can be tested
 * without a DOM and without a bridge.
 *
 * Everything here is about ONE thing: the panel must never guess. Every button
 * press goes to `cmd.builder_action` and the reply IS the new state, so the
 * client never maintains a shadow copy of `pk1..pk4` that can drift from the
 * engine's. The 4 Hz poll exists only for state the panel did not cause —
 * a pick made in the viewport, a `set valence, 0` typed in the console, a
 * wizard armed by a script.
 */

import {
  BUILDER_BOOTSTRAP,
  BUILDER_RPC,
  type BuilderActionKind,
  type BuilderSculptTick,
  type BuilderPickMode,
  type BuilderState,
  type BuilderTables,
} from '@tenmol/protocol/topics/builder';

export interface BuilderTransport {
  call<T>(fn: string, args?: readonly unknown[], kwargs?: Record<string, unknown>): Promise<T>;
  /** `{t:'do'}` — used exactly once, for the bootstrap line. */
  run(commandLine: string): Promise<void>;
}

export interface BuilderController {
  /** Install `cmd.builder_*` and run `showEvent`. Safe to call repeatedly. */
  open(): Promise<BuilderState>;
  refresh(): Promise<BuilderState>;
  tables(): Promise<BuilderTables>;
  act(kind: BuilderActionKind, params?: Record<string, unknown>): Promise<BuilderState>;
  pick(
    object: string,
    index: number,
    index2: number | null,
    mode: BuilderPickMode,
  ): Promise<BuilderState>;
  wizardClick(index: number): Promise<BuilderState>;
  /**
   * One turn of the sculpting loop PyMOL's idle handler runs for itself
   * (`layer5/PyMOL.cpp:2424`) — and, with `cycles: 0`, a pure READ of the total
   * strain. The pump does idle (`engine.py:236`), so the engine is already
   * minimising and `sculptTicker.ts` passes 0 rather than iterating beside it.
   */
  sculptTick(cycles?: number): Promise<BuilderSculptTick>;
  /**
   * "A named selection was edited somewhere else" — the engine's
   * `WizardDoSelect` (`layer1/Wizard.cpp:172-190`), which PyMOL fires only from
   * its own mouse paths and never from `cmd.select`.
   *
   * The Builder needs it because `AtomFlagWizard` treats an edit of the
   * `_build_display` selection as an edit of the FIXED/RESTRAINED atom set
   * (`modules/pmg_qt/builder.py:906-913`), and in this client that selection is
   * edited by the OBJECT PANEL. Whoever rewrites a named selection calls this.
   */
  selectionEdited(selection: string): Promise<BuilderState>;
  dismiss(): Promise<BuilderState>;
}

export function createBuilderController(transport: BuilderTransport): BuilderController {
  // The bootstrap is a `{t:'do'}`, which the bridge classifies as `resync`; it
  // must therefore happen once per connection, not once per button.
  let bootstrapped: Promise<void> | null = null;

  const bootstrap = (): Promise<void> => {
    if (!bootstrapped) {
      bootstrapped = transport.run(BUILDER_BOOTSTRAP).catch((error: unknown) => {
        // A failed bootstrap must be retried on the next interaction, otherwise
        // a single dropped frame leaves the panel permanently inert.
        bootstrapped = null;
        throw error;
      });
    }
    return bootstrapped;
  };

  /** Reconnects tear `cmd.builder_*` down with the PyMOL instance. */
  const withBootstrap = async <T>(body: () => Promise<T>): Promise<T> => {
    await bootstrap();
    try {
      return await body();
    } catch (error) {
      if (!isMissingSymbol(error)) throw error;
      bootstrapped = null;
      await bootstrap();
      return body();
    }
  };

  return {
    async open() {
      await bootstrap();
      return transport.call<BuilderState>(BUILDER_RPC.show);
    },
    refresh() {
      return withBootstrap(() => transport.call<BuilderState>(BUILDER_RPC.state));
    },
    tables() {
      return withBootstrap(() => transport.call<BuilderTables>(BUILDER_RPC.tables));
    },
    act(kind, params = {}) {
      return withBootstrap(() =>
        transport.call<BuilderState>(BUILDER_RPC.action, [kind], params),
      );
    },
    pick(object, index, index2, mode) {
      return withBootstrap(() =>
        transport.call<BuilderState>(BUILDER_RPC.pick, [object, index, index2, mode]),
      );
    },
    wizardClick(index) {
      return withBootstrap(() =>
        transport.call<BuilderState>(BUILDER_RPC.wizardClick, [index]),
      );
    },
    sculptTick(cycles) {
      return withBootstrap(() =>
        transport.call<BuilderSculptTick>(
          BUILDER_RPC.sculptTick,
          cycles === undefined ? [] : [cycles],
        ),
      );
    },
    selectionEdited(selection) {
      // Not in `BUILDER_RPC`: `packages/protocol` belongs to another work
      // package and this leaf was added after that map was frozen for the
      // wave. The name is asserted against the backend's `_ENTRY_POINTS` in
      // p8a9builderselect.test.ts, which is the same guarantee the map gives.
      return withBootstrap(() =>
        transport.call<BuilderState>('cmd.builder_select', [selection]),
      );
    },
    dismiss() {
      return withBootstrap(() => transport.call<BuilderState>(BUILDER_RPC.dismiss));
    },
  };
}

/**
 * `NotAllowed: cmd.builder_state: no such symbol` — the bridge's answer when
 * PyMOL restarted (or the client reconnected to a fresh one) and the install
 * went with it. Distinguished from a real error so the controller can re-run
 * the bootstrap instead of showing the user a dead panel.
 */
export function isMissingSymbol(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such symbol|not allowed|NotAllowed/i.test(message);
}

/**
 * `collectPicked`-shaped guards, so each button can say WHY it is about to arm
 * a wizard instead of acting (`modules/pmg_qt/builder.py:1000-1006` — every
 * bottom-row button branches on exactly this).
 */
export function pickHint(state: BuilderState | null, kind: BuilderActionKind): string {
  const slots = state?.editor.slots ?? [];
  const n = slots.length;
  switch (kind) {
    case 'replace':
      return n ? `replace ${slots[0]}` : 'nothing picked — arms the ReplaceWizard';
    case 'grow':
      return slots.includes('pk1') ? 'grow onto pk1' : 'nothing picked — arms the AttachWizard';
    case 'attachAA':
      return n === 1 ? `attach to ${slots[0]}` : 'needs exactly one pick — arms the AminoAcidWizard';
    case 'attachNA':
      return n === 1
        ? `attach to ${slots[0]}`
        : 'needs exactly one pick — arms the NucleicAcidWizard';
    case 'removeResn':
      return n === 1 ? `remove byres(${slots[0]})` : 'pick a single atom on the residue first';
    case 'createBond':
    case 'deleteBond':
    case 'cycleBond':
    case 'setOrder':
      return n === 2 ? `${slots[0]} - ${slots[1]}` : 'needs pk1 and pk2 — arms a bond wizard';
    case 'invert':
      return n === 3 ? 'invert around pk1' : 'needs pk1, pk2, pk3 — arms the InvertWizard';
    case 'setCharge':
      return n ? `set on ${slots.join(' ')}` : 'nothing picked — arms the ChargeWizard';
    case 'fixH':
    case 'addH':
      return n ? 'apply to the picked molecule' : 'nothing picked — arms the HydrogenWizard';
    case 'removeAtom':
      return n ? `remove ${slots.join(' ')}` : 'nothing picked — arms the RemoveWizard';
    default:
      return '';
  }
}
