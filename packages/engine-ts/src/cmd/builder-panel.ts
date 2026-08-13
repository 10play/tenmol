/**
 * The molecular Builder's PANEL surface (`cmd.builder_*`), ported for the
 * TypeScript engine.
 *
 * The web `<BuilderPanel/>` bootstraps by installing `cmd.builder_*` and reading
 * `cmd.builder_show`; a 4 Hz poll reads `cmd.builder_state`, and every button
 * press is a `cmd.builder_action`. Against the Python bridge those symbols come
 * from `packages/bridge/tenmol_bridge/panels/builder.py`; against this local
 * engine they were unported, so the panel painted a red
 * `NotPorted: cmd.builder_show` banner on open. This module answers the whole
 * surface — the read endpoints (`show`/`state`/`tables`), a real pick machine
 * over `pk1..pk4`, and the action verbs — driven by the chemistry verbs the
 * engine already ports (`bond`, `unbond`, `valence`, `cycle_valence`, `h_add`,
 * `h_fill`, `invert`, `replace`, `remove_picked`, `editor.attach_*`).
 *
 * ── Arm-then-pick, without a PyMOL Wizard object ────────────────────────────
 * The bridge port is a PyMOL *wizard* state machine: pressing a button with the
 * wrong pick (e.g. "Create Bond" with nothing selected) ARMS a `Wizard` the
 * engine owns, and later viewport picks flow into `wizard.do_pick(bondFlag)`.
 * This engine has no wizard machinery, so instead we remember the pressed tool
 * ({@link Armed}) and apply it on the next {@link builder_pick} that satisfies
 * its precondition. `builder_state` reports the armed tool AS a `wizard` (name +
 * "Pick an atom to…" prompt) so the React panel shows the prompt and routes the
 * pick in the right mode (`ValenceWizard`/`UnbondWizard` force bond picking —
 * BuilderPanel.tsx:76). Pressing the armed tool again, or its Cancel row
 * (`builder_wizard_click`), disarms it. So every button does something visible:
 * it either edits the picked atoms now, or arms and edits on your next click.
 */

import { Rep, type Json } from '@tenmol/protocol';
import type {
  BuilderState,
  BuilderTables,
  BuilderPickedAtom,
} from '@tenmol/protocol/topics/builder';
import type { Executive } from '../exec/executive';
import type { ObjectMolecule } from '../model/molecule';
import { repBit } from '../model/atom';
import type { RegistrarCtx } from './registrar';

/**
 * The reps whose geometry carries a per-atom index the viewport can pick — i.e.
 * clicking them fills `pkN`. Cartoon/ribbon/surface follow the backbone spline
 * and give the user almost nothing to aim at, so an object shown only in those
 * is effectively un-editable until a clickable rep is added.
 */
const PICKABLE_REP_BITS =
  repBit(Rep.Cyl) | // sticks
  repBit(Rep.Sphere) |
  repBit(Rep.NonbondedSphere) |
  repBit(Rep.Line) | // lines
  repBit(Rep.Nonbonded);

/* ------------------------------------------------------------------------- */
/* The declarative button tables (builder.py:118-238)                        */
/* ------------------------------------------------------------------------- */

/** label, tooltip, symbol, geometry, valence, wizard text (builder.py:128-141). */
const ELEMENTS: BuilderTables['elements'] = [
  ['H', 'Hydrogen', 'H', 1, 1, 'hydrogen'],
  ['C', 'Carbon', 'C', 4, 4, 'carbon'],
  ['N', 'Nitrogen', 'N', 4, 3, 'nitrogen'],
  ['O', 'Oxygen', 'O', 4, 2, 'oxygen'],
  // builder.py:1079 — the wizard text really is the misspelling "Phosphorous".
  ['P', 'Phosphorus', 'P', 4, 3, 'Phosphorous'],
  ['S', 'Sulfur', 'S', 2, 2, 'sulfur'],
  ['F', 'Fluorine', 'F', 1, 1, 'fluorine'],
  // builder.py:1082 — tooltip typo "Chlorrine" is upstream's, kept verbatim.
  ['Cl', 'Chlorrine', 'Cl', 1, 1, 'chlorine'],
  ['Br', 'Bromine', 'Br', 1, 1, 'bromine'],
  ['I', 'Iodine', 'I', 1, 1, 'iodine'],
];

/** label, tooltip, fragment, hydrogen id, anchor, wizard text (builder.py:144-147). */
const CHEM_ROW0_FRAGMENTS: BuilderTables['chemRow0Fragments'] = [
  ['-CF3', 'Trifluoromethane', 'trifluoromethane', 4, 0, 'trifluoro'],
  ['-OMe', 'Methanol', 'methanol', 5, 0, 'methoxy'],
];

const FUNCTIONAL_GROUPS: BuilderTables['functionalGroups'] = [
  ['CH4', 'Methyl', 'methane', 1, 0, 'methyl'],
  ['C=C', 'Ethylene', 'ethylene', 4, 0, 'vinyl'],
  ['C#C', 'Acetylene', 'acetylene', 2, 0, 'alkynl'],
  ['C#N', 'Cyanide', 'cyanide', 2, 0, 'cyano'],
  ['C=O', 'Aldehyde', 'formaldehyde', 2, 0, 'carbonyl'],
  ['C=OO', 'Formic Acid', 'formic', 4, 0, 'carboxyl'],
  ['C=ON', 'C->N amide', 'formamide', 5, 0, 'C->N amide'],
  ['NC=O', 'N->C amide', 'formamide', 3, 1, 'N->C amide'],
  ['S=O2', 'Sulfone', 'sulfone', 3, 1, 'sulfonyl'],
  ['P=O3', 'Phosphite', 'phosphite', 4, 0, 'phosphoryl'],
  ['N=O2', 'Nitro', 'nitro', 3, 0, 'nitro'],
];

const RINGS: BuilderTables['rings'] = [
  ['cyc3', 'Cyclopropane', 'cyclopropane', 4, 0, 'cyclopropyl'],
  ['cyc4', 'Cyclobutane', 'cyclobutane', 4, 0, 'cyclobutyl'],
  ['cyc5', 'Cyclopentane', 'cyclopentane', 5, 0, 'cyclopentyl'],
  ['cyc6', 'Cyclohexane', 'cyclohexane', 7, 0, 'cyclohexyl'],
  ['cyc7', 'Cycloheptane', 'cycloheptane', 8, 0, 'cycloheptyl'],
  ['aro5', 'Cyclopentadiene', 'cyclopentadiene', 5, 0, 'cyclopentadienyl'],
  ['aro6', 'Benzene', 'benzene', 6, 0, 'phenyl'],
  ['aro65', 'Indane', 'indane', 12, 0, 'indanyl'],
  // builder.py:1109 — "napthylene" is misspelled upstream, and so is the .pkl.
  ['aro66', 'Napthylene', 'napthylene', 13, 0, 'napthyl'],
  ['aro67', 'Benzocycloheptane', 'benzocycloheptane', 13, 0, 'benzocycloheptyl'],
];

const AMINO_ACIDS_ROW0: string[] = [
  'Ace', 'Ala', 'Arg', 'Asn', 'Asp', 'Cys',
  'Gln', 'Glu', 'Gly', 'His', 'Ile', 'Leu',
];
const AMINO_ACIDS_ROW1: string[] = [
  'Lys', 'Met', 'Phe', 'Pro', 'Ser', 'Thr', 'Trp', 'Tyr', 'Val', 'NMe', 'NHH',
];

/** ss = index + 1; phi/psi pairs are editor.py:151-162 (builder.py:191-195). */
const SECONDARY_STRUCTURE: BuilderTables['secondaryStructure'] = [
  ['Alpha Helix', 1, -57.0, -47.0],
  ['Beta Sheet (Anti-Parallel)', 2, -139.0, 135.0],
  ['Beta Sheet (Parallel)', 3, -119.0, 113.0],
];

const DNA_BASES: BuilderTables['dnaBases'] = [
  ['A', 'Deoxyadenosine', 'atp'],
  ['C', 'Deoxycytidine', 'ctp'],
  ['T', 'Deoxythymidine', 'ttp'],
  ['G', 'Deoxyguanosine', 'gtp'],
];

const RNA_BASES: BuilderTables['rnaBases'] = [
  ['A', 'Adenosine', 'atp'],
  ['C', 'Cytosine', 'ctp'],
  ['U', 'Uracil', 'utp'],
  ['G', 'Guanine', 'gtp'],
];

/** glyph, order, text (builder.py:212-217). */
const BOND_ORDERS: BuilderTables['bondOrders'] = [
  ['  |  ', '1', 'single'],
  [' || ', '2', 'double'],
  [' ||| ', '3', 'triple'],
  ['Arom', '4', 'aromatic'],
];

/** label, setting, tooltip, inverted (builder.py:220-224). */
const SETTING_CHECKBOXES: BuilderTables['settingCheckboxes'] = [
  ['El-stat', 'clean_electro_mode', "Electrostatics term for 'Clean' action", false],
  ['Bumps', 'sculpt_vdw_vis_mode', 'Show VDW contacts during sculpting', false],
  ['Undo Enabled', 'suspend_undo', '', true], // inverted binding
];

/** Every fragment the Chemical tab can request (builder.py:241-247). */
function fragmentNames(): string[] {
  const names = [
    ...CHEM_ROW0_FRAGMENTS.map((r) => r[2]),
    ...FUNCTIONAL_GROUPS.map((r) => r[2]),
    ...RINGS.map((r) => r[2]),
  ];
  // formamide appears twice (C=ON and NC=O); dedupe preserving order.
  return [...new Set(names)];
}

const CLEAN_REASON =
  'cmd.clean raises IncentiveOnlyException in open-source PyMOL ' +
  '(packages/engine/modules/pymol/computing.py:20-29)';

/* ------------------------------------------------------------------------- */
/* Pick state (pk1..pk4)                                                      */
/* ------------------------------------------------------------------------- */

/** The picked-atom slots, in click order (Editor.h:30-48). */
const PK_NAMES = ['pk1', 'pk2', 'pk3', 'pk4'] as const;
const ACTIVE_SELE = '_builder_active';

/** A held pick — enough to re-select the atom by identity. `index` is 1-based. */
interface Held {
  object: string;
  index: number;
}

export function registerBuilderPanel(ctx: RegistrarCtx): void {
  const ex = ctx.executive;

  // Panel-scoped state, exactly like the Qt dock's combo/radios (builder.py:1590).
  let ssIndex = 0; // "Alpha Helix"
  let dnaForm = 'B';
  let dnaDblHelix = true;
  let nucType = 'DNA';

  /**
   * The ARMED TOOL — this engine's stand-in for a PyMOL editor Wizard.
   *
   * PyMOL's Builder arms a `Wizard` object when a button is pressed with the
   * wrong pick, and the next viewport pick flows into `wizard.do_pick`. There is
   * no wizard machinery here, so instead we remember the pressed tool and apply
   * it on the next `builder_pick` that satisfies its precondition. `builder_state`
   * reports the armed tool AS a `wizard` (name + prompt) so the React panel shows
   * a "Pick an atom to…" prompt and routes the pick in the right mode
   * (`ValenceWizard`/`UnbondWizard` force bond picking — BuilderPanel.tsx:76).
   */
  interface Armed {
    kind: string;
    params: Record<string, unknown>;
    name: string; // the wizard class name the panel keys pick-mode + label off
    prompt: string;
  }
  let armed: Armed | null = null;

  /** Thrown by an action whose required pick is absent — becomes an armed tool. */
  class NotReady extends Error {
    constructor(
      readonly wizardName: string,
      readonly wizardPrompt: string,
    ) {
      super('not ready');
    }
  }
  const notReady = (wizardName: string, wizardPrompt: string): never => {
    throw new NotReady(wizardName, wizardPrompt);
  };
  const sameParams = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => String(a[k]) === String(b[k]));
  };

  const si = (name: string): number => Math.trunc(ex.getSettingFloat(name));

  /**
   * Ensure every molecular object shows a CLICKABLE rep, so editing-mode picks
   * actually land on atoms. An object shown only as cartoon/ribbon/surface has
   * no per-atom pick target — the user clicks and the tool keeps asking for a
   * pick — so we add `lines` (cheap, non-destructive: it sits under the cartoon).
   * A no-op for objects that already show sticks/lines/spheres. Returns true if
   * anything changed (so the caller republishes).
   */
  const ensurePickable = (): boolean => {
    let changed = false;
    for (const mol of ex.moleculesInOrder()) {
      if (!mol.enabled || mol.natom === 0) continue;
      let shown = 0;
      for (const a of mol.atoms) shown |= a.visRep;
      if ((shown & PICKABLE_REP_BITS) === 0) {
        ex.show('lines', mol.name);
        changed = true;
      }
    }
    return changed;
  };

  /** A human label for a tool's arm prompt (the button's own text/symbol). */
  const label = (params: Record<string, unknown>, dflt: string): string =>
    String(
      params['text'] ??
        params['symbol'] ??
        params['base'] ??
        params['order'] ??
        params['charge'] ??
        dflt,
    );

  /** Select `sel` into `name`, swallowing a grammar error (leaves it deleted). */
  const selectSafe = (name: string, sel: string): number => {
    try {
      return ex.select(name, sel);
    } catch {
      ex.delete(name);
      return 0;
    }
  };

  const atomSel = (h: Held): string => `${h.object} and index ${h.index}`;

  /* -------------------------- pick bookkeeping -------------------------- */

  /** Rewrite pk1..pk4 from `held`, dropping any trailing slots. */
  const writePicks = (held: Held[]): void => {
    for (let i = 0; i < PK_NAMES.length; i++) {
      const slot = PK_NAMES[i]!;
      const h = held[i];
      if (h) selectSafe(slot, atomSel(h));
      else ex.delete(slot);
    }
  };

  /** Clear every builder-owned selection (the `unpick` this engine lacks). */
  const clearPicks = (): void => {
    for (const slot of PK_NAMES) ex.delete(slot);
    ex.delete('pkbond');
    ex.delete(ACTIVE_SELE);
  };

  /** First matched atom of a slot, as a `BuilderPickedAtom`, or null. */
  const describeSlot = (slot: string): BuilderPickedAtom | null => {
    if (!ex.hasSelection(slot)) return null;
    const matched = ex.atomsMatching(slot);
    const ua = matched[0];
    if (!ua) return null;
    const a = ua.atom;
    return {
      slot,
      object: ua.objName,
      // PyMOL's 1-based atom index, as the pick round-trips it (builder.py:2070).
      index: ua.index + 1,
      // PyMOL's own atom identifier syntax, as printed by SceneMouse.
      label: `/${ua.objName}/${a.segi}/${a.chain}/${a.resn}\`${a.resi}/${a.name}`,
      elem: a.elem,
      resn: a.resn,
      resi: a.resi,
      name: a.name,
      formalCharge: a.formalCharge ?? 0,
    };
  };

  const editorState = (): BuilderState['editor'] => {
    const picked: BuilderPickedAtom[] = [];
    for (const slot of PK_NAMES) {
      const d = describeSlot(slot);
      if (d) picked.push(d);
    }
    return {
      picked,
      slots: picked.map((p) => p.slot),
      hasBond: ex.hasSelection('pkbond') && countSafe(ex, 'pkbond') > 0,
      nFrag: 0, // no `_pkfragN` subdivision in this engine
      active: picked.length > 0,
      hasActiveSele: ex.hasSelection(ACTIVE_SELE),
    };
  };

  const mouseState = (): BuilderState['mouse'] => {
    const editing = ex.getSettingFloat('edit_mode') !== 0;
    return {
      button_mode: si('button_mode'),
      mode_name: editing ? '3-Button Editing' : '3-Button Viewing',
      editing,
    };
  };

  const settingsState = (): BuilderState['settings'] => ({
    clean_electro_mode: si('clean_electro_mode'),
    sculpt_vdw_vis_mode: si('sculpt_vdw_vis_mode'),
    suspend_undo: si('suspend_undo'),
    valence: si('valence'),
    auto_overlay: si('auto_overlay'),
    editor_auto_measure: si('editor_auto_measure'),
    secondary_structure: si('secondary_structure'),
    auto_remove_hydrogens: si('auto_remove_hydrogens'),
    sculpting: si('sculpting'),
    sculpting_cycles: si('sculpting_cycles'),
  });

  const builderState = (): BuilderState => ({
    editor: editorState(),
    mouse: mouseState(),
    // An armed tool is surfaced AS a wizard so the panel shows its prompt and
    // routes the next pick in the right mode; null when nothing is armed.
    wizard: armed
      ? {
          name: armed.name,
          mine: true,
          prompt: [armed.prompt],
          panel: [[2, 'Cancel', 'cmd.set_wizard()']],
          repeating: false,
        }
      : null,
    settings: settingsState(),
    clean_available: false,
    clean_reason: CLEAN_REASON,
    undo_is_noop: true,
    objects: ex.getNames('objects'),
  });

  /* ------------------------------ builder_show ------------------------- */
  // showEvent (builder.py:410-421): editor_auto_measure off, auto_overlay and
  // valence on, editor mode on. Returns the same state the 4 Hz poll reads.
  ctx.command('builder_show', (): Json => {
    ex.set('editor_auto_measure', 0);
    ex.set('auto_overlay', 1);
    ex.set('valence', 1);
    ctx.call('edit_mode', [1]);
    // Make atoms clickable so viewport picks land (a cartoon-only object has no
    // pick target); publish if that changed what's shown.
    if (ensurePickable()) ctx.publish();
    return builderState() as unknown as Json;
  });

  /* ------------------------------ builder_state ------------------------ */
  ctx.command('builder_state', (): Json => builderState() as unknown as Json);

  /* ------------------------------ builder_tables ----------------------- */
  ctx.command('builder_tables', (): Json => {
    const tables: BuilderTables = {
      elements: ELEMENTS,
      chemRow0Fragments: CHEM_ROW0_FRAGMENTS,
      functionalGroups: FUNCTIONAL_GROUPS,
      rings: RINGS,
      aminoAcidsRow0: AMINO_ACIDS_ROW0,
      aminoAcidsRow1: AMINO_ACIDS_ROW1,
      secondaryStructure: SECONDARY_STRUCTURE,
      dnaBases: DNA_BASES,
      rnaBases: RNA_BASES,
      bondOrders: BOND_ORDERS,
      settingCheckboxes: SETTING_CHECKBOXES,
      fragments: fragmentNames(),
      // No filesystem here; the declared inventory is authoritative and complete.
      missingFragments: [],
    };
    return tables as unknown as Json;
  });

  /* ------------------------------ builder_pick ------------------------- */
  // A viewport pick, routed like SceneMouse.cpp:404-470. `index`/`index2` are
  // PyMOL's 1-based atom indices (the web sends CGO index + 1). `mode`:
  //   multi  — fill the first free pkN; re-click un-picks; pk4 overflow overwrites
  //   single — reset the editor and pick pk1 only
  //   bond   — pk1 + pk2 with a bond picked (hasBond true)
  ctx.command('builder_pick', (args, kwargs): Json => {
    const object = ctx.str(args[0] ?? kwargs['object'], '');
    const index = Math.trunc(Number(args[1] ?? kwargs['index'] ?? 0));
    const rawIndex2 = args[2] ?? kwargs['index2'];
    const index2 = rawIndex2 === undefined || rawIndex2 === null ? null : Math.trunc(Number(rawIndex2));
    const mode = ctx.str(args[3] ?? kwargs['mode'], 'multi') || 'multi';
    if (!object) throw new Error('builder_pick needs an object name');

    let bondFlag = 0;
    let unpicked = false;
    if (mode === 'bond') {
      if (index2 === null) throw new Error('bond picking needs index2');
      writePicks([{ object, index }, { object, index: index2 }]);
      selectSafe('pkbond', `(${object} and index ${index}) or (${object} and index ${index2})`);
      bondFlag = 1;
    } else if (mode === 'single') {
      ex.delete('pkbond');
      writePicks([{ object, index }]);
    } else {
      // multi (cButModePickAtom): re-hold the current picks by identity, then add,
      // remove-on-re-click, or overwrite pk4 (Editor.cpp:499-536).
      ex.delete('pkbond');
      let held: Held[] = editorState().picked.map((p) => ({ object: p.object, index: p.index }));
      const already = held.some((h) => h.object === object && h.index === index);
      if (already) {
        held = held.filter((h) => !(h.object === object && h.index === index));
        unpicked = true;
      } else {
        if (held.length >= 4) held = held.slice(0, 3); // a fifth pick overwrites pk4
        held = [...held, { object, index }];
      }
      writePicks(held);
    }
    ctx.publish();

    // If a tool is armed (PyMOL's `wizard.do_pick`), apply it now that the pick
    // may satisfy it. It stays armed until a pick completes it.
    const armError = applyArmedIfReady();

    const state = builderState() as unknown as Record<string, unknown>;
    state.bondFlag = bondFlag;
    if (unpicked) state.unpicked = true;
    if (armError) state.error = armError;
    return state as Json;
  });

  /**
   * Try to run the armed tool against the current picks. Returns an error string
   * if the tool ran but threw a real error; null otherwise. A `NotReady` throw
   * (pick still incomplete) leaves the tool armed and returns null.
   */
  function applyArmedIfReady(): string | null {
    if (!armed) return null;
    try {
      runAction(armed.kind, armed.params);
      armed = null; // completed
      ctx.publish();
      return null;
    } catch (err) {
      if (err instanceof NotReady) return null; // need more picks; stay armed
      armed = null; // a real failure disarms, like a wizard aborting
      ctx.publish();
      return `${err instanceof Error ? err.name : 'Error'}: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  /* ------------------------------ builder_action ---------------------- */
  // One button press. If the required pick is present the chemistry verb runs
  // now; otherwise the tool is ARMED (PyMOL would arm a wizard) and applied on
  // the next qualifying pick. Pressing the armed tool again cancels it.
  ctx.command('builder_action', (args, kwargs): Json => {
    const kind = ctx.str(args[0] ?? kwargs['kind'], '');
    const params = kwargs;

    // Re-press of the armed tool -> cancel it (PyMOL activateOrDismiss).
    if (armed && armed.kind === kind && sameParams(armed.params, params)) {
      armed = null;
      clearPicks();
      ctx.publish();
      const s = builderState() as unknown as Record<string, unknown>;
      s.kind = kind;
      s.error = null;
      s.value = null;
      return s as Json;
    }

    let error: string | null = null;
    let value: unknown = null;
    try {
      value = runAction(kind, params);
      armed = null; // ran now -> nothing left armed
    } catch (err) {
      if (err instanceof NotReady) {
        // Precondition not met: arm the tool for the next pick to complete, and
        // make sure atoms are clickable so that pick can actually land.
        armed = { kind, params, name: err.wizardName, prompt: err.wizardPrompt };
        ensurePickable();
      } else {
        error = `${err instanceof Error ? err.name : 'Error'}: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }
    ctx.publish();
    const state = builderState() as unknown as Record<string, unknown>;
    state.kind = kind;
    state.error = error;
    state.value = value ?? null;
    return state as Json;
  });

  /**
   * Run one Builder action. When the required pick is present the chemistry verb
   * runs and returns its value; when it is absent this throws {@link NotReady}
   * carrying the wizard name/prompt to arm (the caller catches it).
   */
  function runAction(kind: string, params: Record<string, unknown>): unknown {
    const slots = editorState().slots;
    const need = (names: string[]): void => {
      for (const n of names) {
        if (!(n in params)) throw new Error(`builder action '${kind}' needs ${n}`);
      }
    };
    switch (kind) {
      case 'grow': {
        need(['fragment']);
        if (!ex.hasSelection('pk1'))
          notReady('AttachWizard', `Pick an atom to grow ${label(params, 'the fragment')} onto…`);
        selectSafe(ACTIVE_SELE, 'byobj pk1');
        ctx.call('editor.attach_fragment', [
          'pk1',
          String(params['fragment']),
          params['hydrogen'] ?? 0,
          params['anchor'] ?? 0,
        ]);
        clearPicks();
        return null;
      }
      case 'replace': {
        need(['symbol', 'geometry', 'valence']);
        if (slots.length === 0)
          notReady('ReplaceWizard', `Pick an atom to replace with ${label(params, 'the element')}…`);
        selectSafe(ACTIVE_SELE, `byobj ${slots[0]}`);
        ctx.call('replace', [
          String(params['symbol']),
          params['geometry'],
          params['valence'],
          '',
          slots[0],
        ]);
        clearPicks();
        return null;
      }
      case 'attachAA': {
        need(['residue']);
        if (slots.length !== 1)
          notReady('AminoAcidWizard', `Pick one atom to attach ${String(params['residue'])}…`);
        ctx.call('editor.attach_amino_acid', [slots[0], String(params['residue'])], {
          ss: ssIndex + 1,
        });
        clearPicks();
        return null;
      }
      case 'attachNA': {
        need(['base', 'nucType']);
        if (params['form'] !== undefined) {
          const form = String(params['form']);
          if (form !== 'A' && form !== 'B') throw new Error(`Form not recognized: '${form}'`);
          dnaForm = form;
        }
        if (params['dblHelix'] !== undefined) dnaDblHelix = Boolean(params['dblHelix']);
        nucType = String(params['nucType']);
        if (slots.length !== 1)
          notReady('NucleicAcidWizard', `Pick one atom to attach ${String(params['base'])}…`);
        // The engine's attach_nuc_acid grows/extends a NAMED object (it does not
        // read the selection arg), so pass the PICKED object as `object` — the
        // base extends the picked strand instead of a stray hardcoded 'obj'.
        const naObj = ex.atomsMatching(slots[0]!)[0]?.objName ?? '';
        ctx.call('attach_nuc_acid', [slots[0], String(params['base'])], {
          nuc_type: nucType,
          object: naObj,
          form: dnaForm,
          dbl_helix: dnaDblHelix ? 1 : 0,
        });
        clearPicks();
        return null;
      }
      case 'ssChanged': {
        need(['index']);
        ssIndex = Math.trunc(Number(params['index']));
        return null;
      }
      case 'removeResn': {
        if (!(slots.length === 1 && slots[0] === 'pk1'))
          notReady('RemoveWizard', 'Pick a single atom on the residue to remove…');
        selectSafe('_builder_added', 'byres pk1');
        ctx.call('remove', ['_builder_added']);
        ex.delete('_builder_added');
        clearPicks();
        return null;
      }
      case 'setCharge': {
        need(['charge']);
        if (slots.length === 0)
          notReady('ChargeWizard', `Pick atoms to set charge ${label(params, '')}…`);
        const sel = slots.join(' or ');
        const charge = Math.trunc(Number(params['charge']));
        ctx.call('alter', [sel, `formal_charge=${charge}`]);
        ctx.call('h_fill', [sel]);
        clearPicks();
        return null;
      }
      case 'fixH': {
        if (slots.length === 0)
          notReady('HydrogenWizard', 'Pick an atom on the molecule to fix hydrogens…');
        ctx.call('h_fill', [slots.join(' or ')]);
        clearPicks();
        return null;
      }
      case 'addH': {
        if (slots.length === 0)
          notReady('HydrogenWizard', 'Pick an atom on the molecule to add hydrogens…');
        ctx.call('h_add', [`bymol (${slots.join(' or ')})`]);
        clearPicks();
        return null;
      }
      case 'invert': {
        if (!(slots.length === 3 && slots[0] === 'pk1' && slots[1] === 'pk2' && slots[2] === 'pk3'))
          notReady('InvertWizard', 'Pick pk1, then pk2 and pk3 to invert around pk1…');
        ctx.call('invert', ['pk1']);
        clearPicks();
        return null;
      }
      case 'removeAtom': {
        if (slots.length === 0) notReady('RemoveWizard', 'Pick atoms to remove…');
        // builder.py:1782-1801 removes the picked atoms, then re-adds the
        // hydrogens the removal freed on the SURVIVING heavy neighbours
        // (fix_chemistry + h_add on `((?pk…) and not hydro) extend 1`).
        // fix_chemistry is a no-op stub in this engine; h_add is real. Collect
        // the heavy neighbours (by stable id, so removal's reindex can't lose
        // them) BEFORE removing, then h_add them after.
        const neighbourIdsByObj = new Map<string, Set<number>>();
        // Only HEAVY picked atoms seed the refill — builder.py filters
        // `and not hydro` BEFORE `extend 1`, so a hydrogen-only pick refills
        // nothing (removing a lone H is a real removal, not a no-op).
        const pickedByObj = new Map<string, Set<number>>();
        for (const slot of slots) {
          for (const ua of ex.atomsMatching(slot)) {
            if (ua.atom.elem === 'H' || ua.atom.elem === 'D') continue;
            let pset = pickedByObj.get(ua.objName);
            if (!pset) pickedByObj.set(ua.objName, (pset = new Set()));
            pset.add(ua.index);
          }
        }
        for (const [obj, picks] of pickedByObj) {
          const mol = ex.molecule(obj);
          if (!mol) continue;
          const nset = new Set<number>();
          for (const [a, b] of mol.bonds) {
            let nb = -1;
            if (picks.has(a) && !picks.has(b)) nb = b;
            else if (picks.has(b) && !picks.has(a)) nb = a;
            if (nb < 0) continue;
            const at = mol.atoms[nb];
            if (at && at.elem !== 'H' && at.elem !== 'D') nset.add(at.id);
          }
          if (nset.size) neighbourIdsByObj.set(obj, nset);
        }
        // Remove every picked atom (Editor's pkset ∪ pk1), not just pk1.
        ctx.call('remove', [slots.join(' or ')]);
        for (const [obj, ids] of neighbourIdsByObj) {
          ctx.call('h_add', [`${obj} and id ${[...ids].join('+')}`]);
        }
        clearPicks();
        return null;
      }
      case 'clear': {
        ex.delete('all');
        return null;
      }
      case 'createBond': {
        if (!(slots.length === 2 && slots[0] === 'pk1' && slots[1] === 'pk2'))
          notReady('BondWizard', 'Pick pk1 and pk2 (two atoms) to bond…');
        // BondWizard.staticaction (builder.py:1186-1198): if BOTH picks are
        // hydrogens with a heavy neighbour, bond the heavy neighbours instead
        // (the "pick two terminal H's to fuse two fragments" workflow) — bonding
        // the hydrogens themselves would make an invalid H–H bond.
        const p1 = ex.atomsMatching('pk1')[0];
        const p2 = ex.atomsMatching('pk2')[0];
        if (p1 && p2 && isHydrogen(p1.atom.elem) && isHydrogen(p2.atom.elem)) {
          const h1 = heavyNeighbour(ex.molecule(p1.objName), p1.index);
          const h2 = heavyNeighbour(ex.molecule(p2.objName), p2.index);
          if (h1 >= 0 && h2 >= 0) {
            selectSafe('pk1', `${p1.objName} and index ${h1 + 1}`);
            selectSafe('pk2', `${p2.objName} and index ${h2 + 1}`);
          }
        }
        // Then bond, and h_fill to trim the hydrogens the new bond makes excess.
        ctx.call('bond', ['pk1', 'pk2']);
        ctx.call('h_fill', []);
        clearPicks();
        return null;
      }
      case 'deleteBond': {
        if (!(slots.length === 2 && slots[0] === 'pk1' && slots[1] === 'pk2'))
          notReady('UnbondWizard', 'Pick the bond to delete…');
        ctx.call('unbond', ['pk1', 'pk2']);
        ctx.call('h_fill', []);
        clearPicks();
        return null;
      }
      case 'cycleBond': {
        if (!(slots.length === 2 && slots[0] === 'pk1' && slots[1] === 'pk2'))
          notReady('ValenceWizard', 'Pick a bond to cycle its valence…');
        ctx.call('cycle_valence', []);
        clearPicks();
        return null;
      }
      case 'setOrder': {
        need(['order']);
        if (!(slots.length === 2 && slots[0] === 'pk1' && slots[1] === 'pk2'))
          notReady('ValenceWizard', `Pick a bond to set as ${label(params, 'that order')}…`);
        ctx.call('unbond', ['pk1', 'pk2']);
        ctx.call('bond', ['pk1', 'pk2', params['order']]);
        ctx.call('h_fill', []);
        clearPicks();
        return null;
      }
      case 'sculpt':
      case 'fix':
      case 'rest':
        // Wizard-driven (sculpt/flag) modes: no wizard machinery here.
        return null;
      case 'clean':
        // cmd.clean is incentive-only; report the reason the panel shows.
        return CLEAN_REASON;
      case 'setUndoEnabled': {
        need(['enabled']);
        const enabled = Boolean(params['enabled']);
        ex.set('suspend_undo', enabled ? 0 : 1);
        return enabled ? [] : suspendedObjects();
      }
      case 'enableUndoForObjects': {
        need(['objects']);
        const list = Array.isArray(params['objects']) ? (params['objects'] as unknown[]) : [];
        const known = new Set(ex.getNames('objects'));
        const done: string[] = [];
        for (const raw of list) {
          const name = String(raw);
          if (!known.has(name)) continue;
          // Per-object suspend_undo is not modelled; the global flag stands in.
          done.push(name);
        }
        return done;
      }
      default:
        throw new Error(`unknown builder action '${kind}'`);
    }
  }

  /** Objects that currently carry suspend_undo (a global flag in this engine). */
  const suspendedObjects = (): string[] =>
    si('suspend_undo') ? [...ex.getNames('objects')].sort() : [];

  /* -------------------------- wizard callbacks ------------------------- */
  // The synthesized wizard's only panel row is "Cancel"; any click disarms the
  // pending tool (there is no multi-row wizard panel in this engine).
  ctx.command('builder_wizard_click', (): Json => {
    armed = null;
    clearPicks();
    ctx.publish();
    const state = builderState() as unknown as Record<string, unknown>;
    state.error = null;
    state.clicked = 'Cancel';
    return state as Json;
  });
  ctx.command('builder_select', (args, kwargs): Json => {
    const selection = ctx.str(args[0] ?? kwargs['selection'], '');
    const state = builderState() as unknown as Record<string, unknown>;
    state.error = null;
    state.selection = selection;
    return state as Json;
  });

  /* ---------------------------- sculpt tick ---------------------------- */
  // ONE turn of PyMOL's sculpting loop, or — with cycles=0 — a pure strain read.
  ctx.command('builder_sculpt_tick', (args, kwargs): Json => {
    if (ex.getSettingFloat('sculpting') === 0) {
      return { active: false, strain: 0, cycles: 0, objects: 0, auto_center_unsupported: false };
    }
    const raw = args[0] ?? kwargs['cycles'];
    const nCycles = raw === undefined || raw === null ? si('sculpting_cycles') : Math.max(0, Math.trunc(Number(raw)));
    let strain = 0;
    try {
      strain = Number(ctx.call('sculpt_iterate', ['all', -1, nCycles])) || 0;
    } catch {
      strain = 0;
    }
    return {
      active: true,
      strain,
      cycles: nCycles,
      objects: ex.getNames('objects').length,
      auto_center_unsupported: ex.getSettingFloat('sculpt_auto_center') !== 0,
    };
  });

  /* ------------------------------ dismiss ------------------------------ */
  // The universal Done: disarm any pending tool and drop the scratch picks.
  ctx.command('builder_dismiss', (): Json => {
    armed = null;
    clearPicks();
    ctx.publish();
    return builderState() as unknown as Json;
  });
}

/** Hydrogen (or deuterium) — the elements `hydro` selects. */
function isHydrogen(elem: string): boolean {
  return elem === 'H' || elem === 'D';
}

/** The first non-hydrogen atom bonded to local atom `idx`, or -1. */
function heavyNeighbour(mol: ObjectMolecule | undefined, idx: number): number {
  if (!mol) return -1;
  for (const [a, b] of mol.bonds) {
    const nb = a === idx ? b : b === idx ? a : -1;
    if (nb >= 0 && !isHydrogen(mol.atoms[nb]?.elem ?? '')) return nb;
  }
  return -1;
}

/** `count_atoms` that never throws (a bad/absent selection counts as 0). */
function countSafe(ex: Executive, sel: string): number {
  try {
    return ex.countAtoms(sel);
  } catch {
    return 0;
  }
}
