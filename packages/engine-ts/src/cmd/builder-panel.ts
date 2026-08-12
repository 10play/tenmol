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
 * ── One deliberate divergence from the Python panel ─────────────────────────
 * The bridge port is a PyMOL *wizard* state machine: when a button is pressed
 * with the wrong pick (e.g. "Create Bond" with nothing selected) it ARMS a
 * `Wizard` object the engine owns, and later viewport picks flow into
 * `wizard.do_pick(bondFlag)`. This engine has no wizard machinery, so those
 * arming fallbacks are honest NO-OPS here: the direct actions (right pick
 * present) run, and a wrong-pick press simply refreshes state without arming
 * anything. `builder_state` therefore always reports `wizard: null`, which the
 * React panel already handles — it falls back to `pickHint()` to tell the user
 * what pick a button needs. `builder_wizard_click`/`builder_select` are wizard
 * callbacks and are correspondingly inert.
 */

import type { Json } from '@tenmol/protocol';
import type {
  BuilderState,
  BuilderTables,
  BuilderPickedAtom,
} from '@tenmol/protocol/topics/builder';
import type { Executive } from '../exec/executive';
import type { RegistrarCtx } from './registrar';

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

  const si = (name: string): number => Math.trunc(ex.getSettingFloat(name));

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
    wizard: null, // no wizard machinery in this engine (see module header)
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

    if (mode === 'bond') {
      if (index2 === null) throw new Error('bond picking needs index2');
      writePicks([{ object, index }, { object, index: index2 }]);
      selectSafe('pkbond', `(${object} and index ${index}) or (${object} and index ${index2})`);
      ctx.publish();
      const state = builderState() as unknown as Record<string, unknown>;
      state.bondFlag = 1;
      return state as Json;
    }

    if (mode === 'single') {
      ex.delete('pkbond');
      writePicks([{ object, index }]);
      ctx.publish();
      const state = builderState() as unknown as Record<string, unknown>;
      state.bondFlag = 0;
      return state as Json;
    }

    // multi (cButModePickAtom): re-hold the current picks by identity, then add,
    // remove-on-re-click, or overwrite pk4 (Editor.cpp:499-536).
    ex.delete('pkbond');
    let held: Held[] = editorState().picked.map((p) => ({ object: p.object, index: p.index }));
    const already = held.some((h) => h.object === object && h.index === index);
    let unpicked = false;
    if (already) {
      held = held.filter((h) => !(h.object === object && h.index === index));
      unpicked = true;
    } else {
      if (held.length >= 4) held = held.slice(0, 3); // a fifth pick overwrites pk4
      held = [...held, { object, index }];
    }
    writePicks(held);
    ctx.publish();
    const state = builderState() as unknown as Record<string, unknown>;
    state.bondFlag = 0;
    if (unpicked) state.unpicked = true;
    return state as Json;
  });

  /* ------------------------------ builder_action ---------------------- */
  ctx.command('builder_action', (args, kwargs): Json => {
    const kind = ctx.str(args[0] ?? kwargs['kind'], '');
    // The action reads its named params from kwargs (the web sends them there).
    const params = kwargs;
    let error: string | null = null;
    let value: unknown = null;
    try {
      value = runAction(kind, params);
    } catch (err) {
      error = `${err instanceof Error ? err.name : 'Error'}: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
    ctx.publish();
    const state = builderState() as unknown as Record<string, unknown>;
    state.kind = kind;
    state.error = error;
    state.value = value ?? null;
    return state as Json;
  });

  /**
   * One button press. Runs the direct chemistry verb when the required pick is
   * present; a wrong-pick press is a no-op here (the Python panel would arm a
   * wizard — see the module header). Returns the verb's own value, if any.
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
        if (!ex.hasSelection('pk1')) return null; // would arm AttachWizard
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
        if (slots.length === 0) return null; // would arm ReplaceWizard
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
        if (slots.length !== 1) return null; // would arm AminoAcidWizard
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
        if (slots.length !== 1) return null; // would arm NucleicAcidWizard
        ctx.call('attach_nuc_acid', [slots[0], String(params['base'])], {
          nuc_type: nucType,
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
        if (slots.length === 1 && slots[0] === 'pk1') {
          selectSafe('_builder_added', 'byres pk1');
          ctx.call('remove', ['_builder_added']);
          ex.delete('_builder_added');
          clearPicks();
        }
        return null;
      }
      case 'setCharge': {
        need(['charge']);
        if (slots.length === 0) return null; // would arm ChargeWizard
        const sel = slots.join(' or ');
        const charge = Math.trunc(Number(params['charge']));
        ctx.call('alter', [sel, `formal_charge=${charge}`]);
        ctx.call('h_fill', [sel]);
        clearPicks();
        return null;
      }
      case 'fixH': {
        if (slots.length === 0) return null; // would arm HydrogenWizard
        ctx.call('h_fill', [slots.join(' or ')]);
        clearPicks();
        return null;
      }
      case 'addH': {
        if (slots.length === 0) return null; // would arm HydrogenWizard
        ctx.call('h_add', [`bymol (${slots.join(' or ')})`]);
        clearPicks();
        return null;
      }
      case 'invert': {
        if (!(slots.length === 3 && slots[0] === 'pk1' && slots[1] === 'pk2' && slots[2] === 'pk3'))
          return null; // would arm InvertWizard
        ctx.call('invert', ['pk1']);
        clearPicks();
        return null;
      }
      case 'removeAtom': {
        if (slots.length === 0) return null; // would arm RemoveWizard
        // builder.py:1782-1801 removes the picked atoms, then re-adds the
        // hydrogens the removal freed on the SURVIVING heavy neighbours
        // (fix_chemistry + h_add on `((?pk…) and not hydro) extend 1`).
        // fix_chemistry is a no-op stub in this engine; h_add is real. Collect
        // the heavy neighbours (by stable id, so removal's reindex can't lose
        // them) BEFORE removing, then h_add them after.
        const neighbourIdsByObj = new Map<string, Set<number>>();
        const pickedByObj = new Map<string, Set<number>>();
        for (const slot of slots) {
          for (const ua of ex.atomsMatching(slot)) {
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
        if (!(slots.length === 2 && slots[0] === 'pk1' && slots[1] === 'pk2')) return null;
        // BondWizard.staticaction (builder.py:1180-1206): bond, then h_fill to
        // trim the hydrogens the new bond makes excess.
        ctx.call('bond', ['pk1', 'pk2']);
        ctx.call('h_fill', []);
        clearPicks();
        return null;
      }
      case 'deleteBond': {
        if (!(slots.length === 2 && slots[0] === 'pk1' && slots[1] === 'pk2')) return null;
        ctx.call('unbond', ['pk1', 'pk2']);
        ctx.call('h_fill', []);
        clearPicks();
        return null;
      }
      case 'cycleBond': {
        if (!(slots.length === 2 && slots[0] === 'pk1' && slots[1] === 'pk2')) return null;
        ctx.call('cycle_valence', []);
        clearPicks();
        return null;
      }
      case 'setOrder': {
        need(['order']);
        if (!(slots.length === 2 && slots[0] === 'pk1' && slots[1] === 'pk2')) return null;
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
  // No wizard state machine here, so these are inert (the panel never renders
  // wizard rows because builder_state always reports `wizard: null`).
  ctx.command('builder_wizard_click', (): Json => {
    throw new Error('no wizard is active');
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
  // The universal Done: drop the builder's scratch selections and picks.
  ctx.command('builder_dismiss', (): Json => {
    clearPicks();
    ctx.publish();
    return builderState() as unknown as Json;
  });
}

/** `count_atoms` that never throws (a bad/absent selection counts as 0). */
function countSafe(ex: Executive, sel: string): number {
  try {
    return ex.countAtoms(sel);
  } catch {
    return 0;
  }
}
