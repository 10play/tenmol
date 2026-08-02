/**
 * The molecular Builder.
 *
 * Upstream this is `BuilderPanelDocked()` (`packages/engine/modules/pmg_qt/builder.py:1573`): a
 * floating `QDockWidget` titled "Builder" holding a three-tab `QTabWidget` over
 * three always-visible action rows. Here it is a floating panel in the shell's
 * `overlay` region, opened from its own tab or from a `tenmol:open-builder`
 * window event (so WP-11's quick-button row can open it without either package
 * importing the other).
 *
 * WHAT LIVES WHERE. Not one line of chemistry is in this file. Every button is
 * a row of `./tables.ts` turned into `{kind, ...params}` and handed to
 * `cmd.builder_action`, which runs the *ported* `_BuilderPanel` handler in
 * `packages/bridge/tenmol_bridge/panels/builder.py`. The reply is the new editor state,
 * so the pk1..pk4 chips and every button's enablement come from PyMOL, never
 * from a local guess.
 *
 * THINGS THAT ARE DELIBERATELY NOT PRETENDED TO WORK:
 *   - **Clean** is rendered disabled with the reason in its tooltip.
 *     `cmd.clean` raises `IncentiveOnlyException` in this tree
 *     (`packages/engine/modules/pymol/computing.py:20-29`).
 *   - **Undo / Redo** carry a note: `editor.undocontext` is a bare `yield`
 *     here (`editor.py:38-49`), so the actions the Qt panel decorates as
 *     "undoable" are not.
 *   - The wizard strip is the Builder's OWN rendering of `get_prompt()` /
 *     `get_panel()`. WP-16 owns the general `<WizardOverlay/>`; until it lands,
 *     an armed Builder wizard would otherwise be invisible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BuilderActionKind,
  BuilderPickMode,
  BuilderSculptTick,
  BuilderState,
  BuilderTables,
} from '@tenmol/protocol/topics/builder';
import { registerPickRoute } from './viewportPicking';
import { errorText, useSession } from '../../app';
import { createBuilderController, pickHint } from './controller';
import {
  AMINO_ACIDS_ROW0,
  AMINO_ACIDS_ROW1,
  BOND_ORDERS,
  CHEM_ROW0_FRAGMENTS,
  DNA_BASES,
  ELEMENTS,
  FUNCTIONAL_GROUPS,
  RINGS,
  RNA_BASES,
  RNA_HINT_LINKS,
  SECONDARY_STRUCTURE,
  SETTING_CHECKBOXES,
  diffTables,
  type FragmentButton,
  type RingButton,
} from './tables';
import { RING_ICONS } from './ringIcons';
import { createSculptTicker } from './sculptTicker';
import './builder.css';

type Tab = 'Chemical' | 'Protein' | 'Nucleic Acid';
type NucTab = 'DNA' | 'RNA';

/** Anyone can open the Builder: `window.dispatchEvent(new Event(OPEN_EVENT))`. */
export const OPEN_EVENT = 'tenmol:open-builder';

/**
 * The two wizards that force the mouse into BOND picking on activation —
 * `cmd.button('single_left','none','PkBd')` (`builder.py:514-563,700-740`).
 * There is no getter for the button table (`ButModeGet` is declared at
 * `packages/engine/layer1/ButMode.h:225` and never bound in `packages/engine/layer4/Cmd.cpp`), so the armed
 * wizard's class name IS the state, and `builder_state` already carries it.
 */
const BOND_PICK_WIZARDS = new Set(['ValenceWizard', 'UnbondWizard']);

export function BuilderPanel() {
  const session = useSession();
  const controller = useMemo(
    () =>
      createBuilderController({
        call: (fn, args, kwargs) => session.call(fn, args ?? [], kwargs ?? {}),
        run: (line) => session.run(line),
      }),
    [session],
  );

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('Chemical');
  const [nucTab, setNucTab] = useState<NucTab>('DNA');
  const [ssIndex, setSsIndex] = useState(0);
  const [state, setState] = useState<BuilderState | null>(null);
  const [tables, setTables] = useState<BuilderTables | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [undoObjects, setUndoObjects] = useState<string[] | null>(null);
  const [sculpt, setSculpt] = useState<BuilderSculptTick | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const listener = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, listener);
    return () => window.removeEventListener(OPEN_EVENT, listener);
  }, []);

  const apply = useCallback((next: BuilderState) => {
    if (!mounted.current) return;
    setState(next);
    setError(next.error ?? null);
  }, []);

  /** `showEvent` (builder.py:1337-1341) fires when the dock becomes visible. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    controller
      .open()
      .then((next) => {
        if (!cancelled) apply(next);
        return controller.tables();
      })
      .then((next) => {
        if (!cancelled) setTables(next);
      })
      .catch((exc: unknown) => {
        if (!cancelled) setError(errorText(exc));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, controller, apply]);

  /**
   * 4 Hz while open. Picks made in the VIEWPORT and settings changed from the
   * console do not come back through `builder_action`, and there is no editor
   * push topic in this wave, so the panel polls — slowly, because every read is
   * a lock-taking `get_names`/`iterate` on the engine thread.
   */
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      controller
        .refresh()
        .then(apply)
        .catch(() => undefined);
    }, 250);
    return () => window.clearInterval(timer);
  }, [open, controller, apply]);

  /**
   * THE SCULPTING READOUT.
   *
   * `sculpting 1` is enough on this backend: the pump's tick calls
   * `PyMOL_Idle` (`packages/bridge/tenmol_bridge/engine.py:236`), which is where
   * `ExecutiveSculptIterateAll` lives (`packages/engine/layer5/PyMOL.cpp:2424`), so the engine
   * minimises on its own — 0.6843 A of drift in 2.0 s with no client attached,
   * measured in `packages/bridge/tests/test_p10_viewport.py`. The panel therefore POLLS
   * `cmd.builder_sculpt_tick` with 0 cycles while the flag is on, purely to
   * show the strain converging; the moved atoms arrive on the pixel stream and
   * on the 4 Hz geometry diff exactly as any other engine-side change does.
   */
  const ticker = useMemo(
    () =>
      createSculptTicker({
        tick: (cycles) => controller.sculptTick(cycles),
        onTick: (result) => {
          if (mounted.current) setSculpt(result);
        },
        onError: (exc) => {
          if (mounted.current) setError(errorText(exc));
        },
      }),
    [controller],
  );

  useEffect(() => {
    if (!open) {
      ticker.stop();
      return;
    }
    ticker.sync(state?.settings.sculpting);
  }, [open, ticker, state?.settings.sculpting]);

  useEffect(() => () => ticker.stop(), [ticker]);

  /**
   * VIEWPORT CLICKS. `SceneClick` routes a click by the ButMode action, so in
   * EDITING mode the pixel that would select `sele` fills `pk1..pk4` instead
   * (`packages/engine/layer1/SceneMouse.cpp:404-470`). The client had no such branch: the
   * viewport turned every GL-free pick into `cmd.select` and the Builder's
   * `controller.pick()` was reachable only from a test. This is that branch.
   *
   * `stateRef` rather than `state`: the route must see the LATEST wizard and
   * mouse mode without being torn down and re-registered 4 Hz with the poll.
   */
  const stateRef = useRef<BuilderState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    if (!open) return;
    return registerPickRoute((hit) => {
      const current = stateRef.current;
      // Not in editing mode: this click means "select", which is exactly what
      // the viewport does by itself. Leave it alone.
      if (current === null || !current.mouse.editing) return false;
      const wantsBond =
        current.wizard !== null && BOND_PICK_WIZARDS.has(current.wizard.name);
      if (wantsBond && hit.index2 === null) {
        // Armed for a bond and the click landed on something that identifies
        // ONE atom (a sphere, a surface triangle). Consume it anyway: falling
        // through would rewrite `sele` while the user is trying to pick a bond.
        setError(
          'pick a BOND: that click resolved to a single atom — only sticks/lines carry both ends',
        );
        return true;
      }
      const mode: BuilderPickMode = wantsBond ? 'bond' : 'multi';
      setBusy(true);
      controller
        // 0-based in the CGO pick payload, 1-based in PyMOL's `obj`N` syntax,
        // which is what `builder_pick` builds. Verified natively: index 10
        // resolves to "u`11".
        .pick(
          hit.object,
          hit.index + 1,
          mode === 'bond' && hit.index2 !== null ? hit.index2 + 1 : null,
          mode,
        )
        .then(apply)
        .catch((exc: unknown) => setError(errorText(exc)))
        .finally(() => setBusy(false));
      return true;
    });
  }, [open, controller, apply]);

  /** `Undo` / `Redo`, shared by the two buttons and the keyboard. */
  const undo = useCallback(() => {
    void session.call('cmd.undo').catch((exc: unknown) => setError(errorText(exc)));
  }, [session]);
  const redo = useCallback(() => {
    void session.call('cmd.redo').catch((exc: unknown) => setError(errorText(exc)));
  }, [session]);

  const act = useCallback(
    (kind: BuilderActionKind, params: Record<string, unknown> = {}) => {
      setBusy(true);
      controller
        .act(kind, params)
        .then((next) => {
          apply(next);
          if (kind === 'setUndoEnabled' && Array.isArray(next.value) && next.value.length) {
            setUndoObjects(next.value as string[]);
          }
        })
        .catch((exc: unknown) => setError(errorText(exc)))
        .finally(() => setBusy(false));
    },
    [controller, apply],
  );

  const drift = useMemo(() => diffTables(tables), [tables]);
  const slots = state?.editor.slots ?? [];

  if (!open) {
    return (
      <button
        type="button"
        className="builder-launch"
        title="the Builder dock (packages/engine/modules/pmg_qt/builder.py)"
        onClick={() => setOpen(true)}
      >
        Builder
      </button>
    );
  }

  return (
    <div
      className="builder"
      role="dialog"
      aria-label="Builder"
      /*
       * "Two toolbar buttons plus keyboard shortcuts". Scoped to the panel
       * rather than the window on purpose: the ortho console already forwards
       * Ctrl-Z to PyMOL's own key table as a `cmd._ctrl('Z')` chord while IT
       * has focus, and two features racing for the same chord on `window` is
       * how a viewport stops rotating.
       */
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key === 'z') {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) redo();
          else undo();
        } else if (key === 'y' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          redo();
        }
      }}
    >
      <div className="builder__title">
        <span className="builder__title-text">Builder</span>
        {busy && <span className="builder__busy" aria-label="working" />}
        <span className="builder__spacer" />
        <span className="builder__mouse" title="cmd.edit_mode(1) rotates the mouse ring">
          {state?.mouse.mode_name || 'mouse mode ?'}
        </span>
        <button type="button" className="builder__close" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>

      {drift.length > 0 && (
        <div className="builder__error" data-testid="builder-drift">
          button table drift vs the bridge: {drift.join(' | ')}
        </div>
      )}
      {error && (
        <div className="builder__error" data-testid="builder-error">
          {error}
        </div>
      )}

      <PickStrip
        state={state}
        onUnpick={() => {
          void session
            .call('cmd.unpick')
            .then(() => controller.refresh().then(apply))
            .catch((exc: unknown) => setError(errorText(exc)));
        }}
      />

      <div className="builder__tabs" role="tablist">
        {(['Chemical', 'Protein', 'Nucleic Acid'] as Tab[]).map((name) => (
          <button
            type="button"
            role="tab"
            key={name}
            aria-selected={tab === name}
            className={`builder__tab${tab === name ? ' is-active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="builder__body">
        {tab === 'Chemical' && (
          <div className="builder__grid" data-testid="tab-chemical">
            <div className="builder__row">
              {ELEMENTS.map((element) => (
                <button
                  type="button"
                  key={element.label}
                  className="bbtn"
                  title={`${element.tooltip} — ${pickHint(state, 'replace')}`}
                  onClick={() =>
                    act('replace', {
                      symbol: element.symbol,
                      geometry: element.geometry,
                      valence: element.valence,
                      text: element.text,
                    })
                  }
                >
                  {element.label}
                </button>
              ))}
              {CHEM_ROW0_FRAGMENTS.map((fragment) => (
                <GrowButton key={fragment.label} fragment={fragment} state={state} act={act} />
              ))}
            </div>

            <div className="builder__row">
              {FUNCTIONAL_GROUPS.map((fragment) => (
                <GrowButton key={fragment.label} fragment={fragment} state={state} act={act} />
              ))}
            </div>

            <div className="builder__row">
              {RINGS.map((ring) => (
                <button
                  type="button"
                  key={ring.icon}
                  className="bbtn bbtn--icon"
                  title={`${ring.tooltip} — ${pickHint(state, 'grow')}`}
                  aria-label={ring.tooltip}
                  onClick={() =>
                    act('grow', {
                      fragment: ring.fragment,
                      hydrogen: ring.hydrogen,
                      anchor: ring.anchor,
                      text: ring.text,
                    })
                  }
                >
                  <RingGlyph ring={ring} />
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'Protein' && (
          <div className="builder__grid" data-testid="tab-protein">
            <div className="builder__row">
              {AMINO_ACIDS_ROW0.map((residue) => (
                <button
                  type="button"
                  key={residue}
                  className="bbtn"
                  title={`Build ${residue} residue — ${pickHint(state, 'attachAA')}`}
                  onClick={() => act('attachAA', { residue: residue.toLowerCase() })}
                >
                  {residue}
                </button>
              ))}
            </div>
            <div className="builder__row">
              {AMINO_ACIDS_ROW1.map((residue) => (
                <button
                  type="button"
                  key={residue}
                  className="bbtn"
                  title={`Build ${residue} residue — ${pickHint(state, 'attachAA')}`}
                  onClick={() => act('attachAA', { residue: residue.toLowerCase() })}
                >
                  {residue}
                </button>
              ))}
            </div>
            <div className="builder__row builder__row--form">
              <label htmlFor="builder-ss">Secondary Structure:</label>
              <select
                id="builder-ss"
                value={ssIndex}
                onChange={(event) => {
                  const index = Number(event.target.value);
                  setSsIndex(index);
                  // builder.py:1376-1379 also pushes into a live AminoAcidWizard.
                  act('ssChanged', { index });
                }}
              >
                {SECONDARY_STRUCTURE.map((entry, index) => (
                  <option key={entry.label} value={index}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <span className="builder__note">
                phi {SECONDARY_STRUCTURE[ssIndex]?.phi} / psi {SECONDARY_STRUCTURE[ssIndex]?.psi}
              </span>
            </div>
          </div>
        )}

        {tab === 'Nucleic Acid' && (
          <div className="builder__grid" data-testid="tab-nucleic">
            <div className="builder__tabs builder__tabs--nested" role="tablist">
              {(['DNA', 'RNA'] as NucTab[]).map((name) => (
                <button
                  type="button"
                  role="tab"
                  key={name}
                  aria-selected={nucTab === name}
                  className={`builder__tab${nucTab === name ? ' is-active' : ''}`}
                  onClick={() => setNucTab(name)}
                >
                  {name}
                </button>
              ))}
            </div>

            {nucTab === 'DNA' ? (
              <DnaTab state={state} act={act} />
            ) : (
              <div className="builder__grid">
                <div className="builder__row">
                  {RNA_BASES.map((base) => (
                    <button
                      type="button"
                      key={base.label}
                      className="bbtn"
                      title={`${base.tooltip} — ${pickHint(state, 'attachNA')}`}
                      onClick={() => act('attachNA', { base: base.fragment, nucType: 'RNA' })}
                    >
                      {base.label}
                    </button>
                  ))}
                </div>
                <p className="builder__hint">
                  Hint: Also check out{' '}
                  {RNA_HINT_LINKS.map((link, index) => (
                    <span key={link.href}>
                      {index > 0 && ' and its '}
                      <a href={link.href} target="_blank" rel="noreferrer">
                        {link.text}
                      </a>
                    </span>
                  ))}
                  .
                </p>
                <p className="builder__note">
                  RNA is always form A, single strand (`editor.py:803-805` forces it).
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- the three always-visible action rows (builder.py:1227-1264) --- */}

      <div className="builder__actions">
        <div className="builder__row">
          <span className="builder__label">Atoms:</span>
          <ActionButton kind="fixH" label="Fix H" tip="Fix hydrogens on picked atoms" state={state} act={act} />
          <ActionButton kind="addH" label="Add H" tip="Add hydrogens to entire molecule" state={state} act={act} />
          <ActionButton
            kind="invert"
            label="Invert"
            tip="Invert stereochemistry around pk1 (pk2 and pk3 will remain fixed)"
            state={state}
            act={act}
          />
          <ActionButton kind="removeAtom" label="Delete" tip="Remove atoms" state={state} act={act} />
          <button
            type="button"
            className="bbtn"
            title="Delete everything"
            onClick={() => setConfirmClear(true)}
          >
            Clear
          </button>
          <span className="builder__label">Charge:</span>
          <ActionButton
            kind="setCharge"
            label="+1"
            tip="Positive Charge"
            params={{ charge: 1, text: '+1' }}
            state={state}
            act={act}
          />
          <ActionButton
            kind="setCharge"
            label="0"
            tip="Neutral Charge"
            params={{ charge: 0, text: 'neutral' }}
            state={state}
            act={act}
          />
          <ActionButton
            kind="setCharge"
            label="-1"
            tip="Negative Charge"
            params={{ charge: -1, text: '-1' }}
            state={state}
            act={act}
          />
          <span className="builder__label">Residue:</span>
          <ActionButton kind="removeResn" label="Remove" tip="Remove residue" state={state} act={act} />
        </div>

        <div className="builder__row">
          <span className="builder__label">Bonds:</span>
          <ActionButton
            kind="createBond"
            label="Create"
            tip="Create bond between pk1 and pk2"
            state={state}
            act={act}
          />
          <ActionButton
            kind="deleteBond"
            label="Delete"
            tip="Delete bond between pk1 and pk2"
            state={state}
            act={act}
          />
          <ActionButton kind="cycleBond" label="Cycle" tip="Cycle bond valence" state={state} act={act} />
          {BOND_ORDERS.map((entry) => (
            <ActionButton
              key={entry.order}
              kind="setOrder"
              label={entry.glyph}
              tip={entry.tooltip}
              params={{ order: entry.order, text: entry.text }}
              state={state}
              act={act}
            />
          ))}
          <span className="builder__label">Model:</span>
          <button
            type="button"
            className="bbtn bbtn--disabled"
            disabled
            data-testid="builder-clean"
            title={state?.clean_reason ?? 'cmd.clean is Incentive-only in this build'}
          >
            Clean
          </button>
          <ActionButton kind="sculpt" label="Sculpt" tip="Molecular sculpting" state={state} act={act} />
          <ActionButton kind="fix" label="Fix" tip="Fix atom positions" state={state} act={act} />
          <ActionButton kind="rest" label="Rest" tip="Restrain atom positions" state={state} act={act} />
        </div>

        <div className="builder__row">
          {SETTING_CHECKBOXES.map((entry) => {
            const raw = state?.settings[entry.setting] ?? 0;
            const checked = entry.inverted ? !raw : Boolean(raw);
            return (
              <label className="builder__check" key={entry.setting} title={entry.tooltip}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = event.target.checked;
                    if (entry.inverted) {
                      act('setUndoEnabled', { enabled: next });
                    } else {
                      void session
                        .call('cmd.set', [entry.setting, next ? 1 : 0], { quiet: 0 })
                        .then(() => controller.refresh().then(apply))
                        .catch((exc: unknown) => setError(errorText(exc)));
                    }
                  }}
                />
                {entry.label}
              </label>
            );
          })}
          <button
            type="button"
            className="bbtn"
            title="Undo last change"
            aria-keyshortcuts="Control+Z"
            onClick={undo}
          >
            Undo
          </button>
          <button
            type="button"
            className="bbtn"
            title="Redo last change"
            aria-keyshortcuts="Control+Shift+Z Control+Y"
            onClick={redo}
          >
            Redo
          </button>
          {state?.undo_is_noop && (
            <span className="builder__note" title="packages/engine/modules/pymol/editor.py:38-49">
              editor.undocontext is a no-op here — only cmd.undo/redo against the C ring works
            </span>
          )}
        </div>
      </div>

      <WizardStrip
        state={state}
        onClick={(index) => {
          setBusy(true);
          controller
            .wizardClick(index)
            .then(apply)
            .catch((exc: unknown) => setError(errorText(exc)))
            .finally(() => setBusy(false));
        }}
        onDismiss={() => {
          setBusy(true);
          controller
            .dismiss()
            .then(apply)
            .catch((exc: unknown) => setError(errorText(exc)))
            .finally(() => setBusy(false));
        }}
      />

      {confirmClear && (
        <ConfirmModal
          title="Confirm"
          message="Really delete everything?"
          confirmLabel="Yes"
          cancelLabel="No"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            act('clear');
          }}
        />
      )}

      {undoObjects && (
        <ConfirmModal
          title="Enable for objects?"
          message={`Building "Undo" is disabled for the following objects:\n\n${undoObjects.join(
            '\n',
          )}\n\nEnable "Undo" for these objects?`}
          confirmLabel="Yes"
          cancelLabel="No"
          onCancel={() => setUndoObjects(null)}
          onConfirm={() => {
            const names = undoObjects;
            setUndoObjects(null);
            act('enableUndoForObjects', { objects: names });
          }}
        />
      )}

      <div className="builder__footer">
        <span>
          {slots.length ? `picked: ${slots.join(' ')}` : 'nothing picked — buttons arm a wizard'}
        </span>
        <span data-testid="builder-sculpt">
          {sculpt?.active
            ? `sculpting: strain ${sculpt.strain.toFixed(2)} · ${sculpt.cycles} cycles/frame`
            : state?.settings.sculpting
              ? 'sculpting: starting…'
              : ''}
        </span>
        <span>{state ? `${state.objects.length} object(s)` : ''}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

function GrowButton({
  fragment,
  state,
  act,
}: {
  fragment: FragmentButton;
  state: BuilderState | null;
  act: (kind: BuilderActionKind, params?: Record<string, unknown>) => void;
}) {
  return (
    <button
      type="button"
      className="bbtn"
      title={`${fragment.tooltip} — ${pickHint(state, 'grow')}`}
      onClick={() =>
        act('grow', {
          fragment: fragment.fragment,
          hydrogen: fragment.hydrogen,
          anchor: fragment.anchor,
          text: fragment.text,
        })
      }
    >
      {fragment.label}
    </button>
  );
}

function ActionButton({
  kind,
  label,
  tip,
  params,
  state,
  act,
}: {
  kind: BuilderActionKind;
  label: string;
  tip: string;
  params?: Record<string, unknown>;
  state: BuilderState | null;
  act: (kind: BuilderActionKind, params?: Record<string, unknown>) => void;
}) {
  return (
    <button
      type="button"
      className="bbtn"
      title={`${tip} — ${pickHint(state, kind)}`}
      onClick={() => act(kind, params ?? {})}
    >
      {label}
    </button>
  );
}

function DnaTab({
  state,
  act,
}: {
  state: BuilderState | null;
  act: (kind: BuilderActionKind, params?: Record<string, unknown>) => void;
}) {
  // NucleicAcidProperties (builder.py:1012-1015): B form, double helix.
  // Qt connects these on `toggled`, which fires for the deselected member too;
  // React's onChange only fires for the newly selected value, which is what the
  // parity note asks for.
  const [form, setForm] = useState<'A' | 'B'>('B');
  const [helix, setHelix] = useState<'Single' | 'Double'>('Double');

  return (
    <div className="builder__grid">
      <div className="builder__row">
        {DNA_BASES.map((base) => (
          <button
            type="button"
            key={base.label}
            className="bbtn"
            title={`${base.tooltip} — ${pickHint(state, 'attachNA')}`}
            onClick={() =>
              act('attachNA', {
                base: base.fragment,
                nucType: 'DNA',
                // The radios are panel state on the backend too; push them with
                // the action so the two can never disagree.
                form,
                dblHelix: helix === 'Double',
              })
            }
          >
            {base.label}
          </button>
        ))}
      </div>
      <div className="builder__row builder__row--form">
        <span className="builder__label">Form:</span>
        {(['A', 'B'] as const).map((value) => (
          <label className="builder__check" key={value}>
            <input
              type="radio"
              name="builder-dna-form"
              checked={form === value}
              onChange={() => setForm(value)}
            />
            {value}
          </label>
        ))}
        <span className="builder__label">Helix:</span>
        {(['Single', 'Double'] as const).map((value) => (
          <label className="builder__check" key={value}>
            <input
              type="radio"
              name="builder-dna-helix"
              checked={helix === value}
              onChange={() => setHelix(value)}
            />
            {value}
          </label>
        ))}
      </div>
    </div>
  );
}

function PickStrip({ state, onUnpick }: { state: BuilderState | null; onUnpick: () => void }) {
  const picked = state?.editor.picked ?? [];
  return (
    <div className="builder__picks" data-testid="builder-picks">
      {['pk1', 'pk2', 'pk3', 'pk4'].map((slot) => {
        const atom = picked.find((entry) => entry.slot === slot);
        return (
          <span
            key={slot}
            className={`builder__pick${atom ? ' is-set' : ''}`}
            title={atom ? atom.label : `${slot} is empty`}
          >
            <b>{slot}</b>
            {atom ? `${atom.resn}${atom.resi}/${atom.name}` : '—'}
          </span>
        );
      })}
      {state?.editor.hasBond && (
        <span className="builder__pick is-bond" title="pkbond exists: a BOND is picked">
          bond
        </span>
      )}
      {state?.editor.nFrag ? (
        <span className="builder__note" title="_pkfragN from SelectorSubdivide">
          {state.editor.nFrag} frag
        </span>
      ) : null}
      <span className="builder__spacer" />
      <button type="button" className="bbtn bbtn--small" onClick={onUnpick} title="cmd.unpick()">
        unpick
      </button>
    </div>
  );
}

function WizardStrip({
  state,
  onClick,
  onDismiss,
}: {
  state: BuilderState | null;
  onClick: (index: number) => void;
  onDismiss: () => void;
}) {
  const wizard = state?.wizard;
  if (!wizard) return null;
  return (
    <div className="builder__wizard" data-testid="builder-wizard">
      <div className="builder__wizard-head">
        <span className="builder__wizard-name">{wizard.name}</span>
        {wizard.repeating && <span className="builder__note">repeating</span>}
        <span className="builder__spacer" />
        <button type="button" className="bbtn bbtn--small" onClick={onDismiss}>
          dismiss
        </button>
      </div>
      {wizard.prompt.map((line) => (
        <div className="builder__wizard-prompt" key={line}>
          {line}
        </div>
      ))}
      <div className="builder__row">
        {wizard.panel.map((row, index) =>
          row[0] === 1 ? (
            <span className="builder__wizard-title" key={`${row[1]}-${index}`}>
              {row[1]}
            </span>
          ) : (
            <button
              type="button"
              className="bbtn"
              key={`${row[1]}-${index}`}
              title={row[2]}
              onClick={() => onClick(index)}
            >
              {row[1]}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="builder__modal" role="alertdialog" aria-label={title}>
      <div className="builder__modal-box">
        <div className="builder__modal-title">{title}</div>
        <pre className="builder__modal-message">{message}</pre>
        <div className="builder__row">
          <button type="button" className="bbtn" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="bbtn" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The ten ring icons, the shipped `$PYMOL_DATA/pmg_tk/bitmaps/builder/*.gif`
 * bitmaps themselves (`builder.py:1114-1125,1323-1335`), at their natural size
 * — which is what `QIcon.actualSize(QSize(48,48))` resolves to for a 20 px
 * bitmap, since QIcon never upscales. Dark mode is `.bbtn__icon`'s
 * `filter: invert(1)`, standing in for upstream's unused inverted copy.
 */
export function RingGlyph({ ring }: { ring: RingButton }) {
  const icon = RING_ICONS[ring.icon];
  if (icon === undefined) return null;
  return (
    <img
      className="bbtn__icon"
      src={icon.src}
      width={icon.width}
      height={icon.height}
      alt=""
      draggable={false}
    />
  );
}
