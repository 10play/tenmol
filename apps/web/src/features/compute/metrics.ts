/**
 * The `pymol.util` compute helpers, as data.
 *
 * Scoped by B9, which recorded these as "previously unnamed anywhere" — they
 * are real user-facing commands with no parity rows until wave 4.
 *
 * Every entry here was called over the real bridge before being listed, because
 * two of them do not behave the way the signature suggests:
 *
 *  - `get_sasa_relative` returns a `defaultdict` keyed by a 4-TUPLE, which the
 *    bridge codec refuses with `NotSerializable: dict key of type tuple`. It is
 *    marked `unsupported` here rather than offered as a button that always
 *    errors.
 *  - `protein_vacuum_esp` MUTATES the model — it deletes alt-conformers and
 *    unassigned residues (`packages/engine/modules/pymol/util.py:335-383`) — and creates three
 *    objects. It is `destructive`, and the panel must confirm before running it.
 */

import { COMPUTE_NS } from '@tenmol/protocol/topics/compute';

/** How a metric's result is produced and rendered by the panel. */
export type MetricKind =
  | 'scalar'
  | 'selection'
  | 'destructive'
  | 'unsupported'
  /** Runs for its side effect on the scene; there is no number to report. */
  | 'action'
  /** Returns `(phi, psi)` — two angles or nulls. */
  | 'angles'
  /** Returns a per-residue table, rendered as rows rather than one cell. */
  | 'table';

/**
 * One positional argument of a helper.
 *
 * The panel used to assume every helper was `fn(selection, quiet=1)`. Half of
 * them are not: `mass_align` takes a TARGET OBJECT, `ff_copy` takes a source
 * and a destination, `interchain_distances` takes the name of the distance
 * object to create, and `enable_all_shaders` takes nothing at all. Passing the
 * shared selection box into those either errors or silently does the wrong
 * thing, so the shape is declared instead of assumed.
 */
export type MetricParam =
  /** Bound to the panel's shared selection box. */
  | { kind: 'selection' }
  | { kind: 'text'; name: string; label: string; default: string }
  | { kind: 'number'; name: string; label: string; default: number }
  | { kind: 'bool'; name: string; label: string; default: boolean };

/** One compute-panel helper: its call, kind, params and presentation. */
export interface Metric {
  id: string;
  /** Dotted call, resolved by the dispatcher to `pymol.util.<name>`. */
  fn: string;
  label: string;
  kind: MetricKind;
  unit?: string;
  /** Decimal places for a scalar result. */
  precision?: number;
  /** Shown before running a `destructive` metric. */
  warning?: string;
  /** Why an `unsupported` metric is not offered. */
  unsupportedReason?: string;
  /**
   * A constraint the helper has that its signature does not show. Rendered as
   * a hint under the button, because both of the ones recorded here fail with
   * a message that points at the wrong thing.
   */
  note?: string;
  /**
   * Positional arguments, in order. Omitted means the historical shape, a
   * single selection — every scalar helper below.
   */
  params?: readonly MetricParam[];
  /**
   * Does the helper accept `quiet`? NOT universal: `find_surface_residues` and
   * `find_surface_atoms` take `(sele, name[, cutoff])` and raise
   * "unexpected keyword argument 'quiet'" if it is passed.
   */
  quiet?: boolean;
  source: string;
}

/** The catalogue of compute helpers the panel offers, in display order. */
export const METRICS: readonly Metric[] = [
  {
    id: 'area',
    fn: 'util.get_area',
    label: 'Molecular surface area',
    kind: 'scalar',
    unit: 'Å²',
    precision: 2,
    source: 'packages/engine/modules/pymol/util.py:205',
  },
  {
    id: 'sasa',
    fn: 'util.get_sasa',
    label: 'Solvent-accessible surface area',
    kind: 'scalar',
    unit: 'Å²',
    precision: 2,
    source: 'packages/engine/modules/pymol/util.py:240',
  },
  {
    id: 'mass',
    fn: 'util.compute_mass',
    label: 'Mass',
    kind: 'scalar',
    unit: 'Da',
    precision: 2,
    source: 'packages/engine/modules/pymol/util.py:285',
  },
  {
    id: 'formal',
    fn: 'util.sum_formal_charges',
    label: 'Sum of formal charges',
    kind: 'scalar',
    precision: 0,
    source: 'packages/engine/modules/pymol/util.py:269',
  },
  {
    id: 'partial',
    fn: 'util.sum_partial_charges',
    label: 'Sum of partial charges',
    kind: 'scalar',
    precision: 4,
    source: 'packages/engine/modules/pymol/util.py:277',
  },
  {
    id: 'surf_res',
    fn: 'util.find_surface_residues',
    label: 'Find surface residues',
    kind: 'selection',
    quiet: false,
    source: 'packages/engine/modules/pymol/util.py:121',
  },
  {
    id: 'surf_atoms',
    fn: 'util.find_surface_atoms',
    label: 'Find surface atoms',
    kind: 'selection',
    quiet: false,
    source: 'packages/engine/modules/pymol/util.py:166',
  },
  {
    id: 'esp',
    fn: 'util.protein_vacuum_esp',
    label: 'Protein vacuum ESP',
    kind: 'destructive',
    warning:
      'This MODIFIES the structure: it deletes alternate conformers and residues it cannot ' +
      'assign charges to, then creates the objects _e_chg, _e_map and _e_pot. It cannot be undone.',
    source: 'packages/engine/modules/pymol/util.py:385',
  },
  {
    /*
     * Was `unsupported`: called directly, `util.get_sasa_relative` returns a
     * dict keyed by a 4-tuple and the codec refuses it with
     * `NotSerializable: dict key of type tuple`. It goes through the bridge
     * shim, which re-keys each entry to `/model/segi/chain/`resi` — PyMOL's
     * own spelling, so every row's `sele` is a usable selection.
     */
    id: 'sasa_rel',
    fn: `${COMPUTE_NS}.sasa_relative`,
    label: 'Relative SASA per residue',
    kind: 'table',
    quiet: false,
    params: [
      { kind: 'selection' },
      { kind: 'number', name: 'state', label: 'state', default: 1 },
      { kind: 'text', name: 'var', label: 'property', default: 'b' },
      { kind: 'text', name: 'subsele', label: 'sub-selection', default: 'all' },
      { kind: 'bool', name: 'vis', label: 'label and colour', default: false },
    ],
    warning:
      'This writes the computed value onto every atom in the selection (the ' +
      '"property" argument, b by default), overwriting what was there.',
    source: 'packages/engine/modules/pymol/util.py:1064',
  },

  /*
   * ------------------------------------------------------------------ *
   * The helpers B9 recorded as "previously unnamed anywhere".
   *
   * They were listed in the inventory but not built, and an unlisted feature
   * is one nobody schedules. Signatures read off the source, not guessed —
   * three of them do NOT take the shared selection.
   * ------------------------------------------------------------------ *
   */
  {
    id: 'label_chains',
    fn: 'util.label_chains',
    label: 'Label chains',
    kind: 'action',
    quiet: false,
    source: 'packages/engine/modules/pymol/util.py:721',
  },
  {
    id: 'label_segments',
    fn: 'util.label_segments',
    label: 'Label segments',
    kind: 'action',
    quiet: false,
    source: 'packages/engine/modules/pymol/util.py:746',
  },
  {
    id: 'phipsi',
    fn: 'util.phipsi',
    label: 'Phi / psi of a residue',
    kind: 'angles',
    quiet: false,
    // Upstream's default is `(pk1)`, the picked atom; the shared box is used
    // instead so the panel has one selection concept, not two.
    source: 'packages/engine/modules/pymol/util.py:963',
  },
  {
    id: 'b2vdw',
    fn: 'util.b2vdw',
    label: 'B-factors to VDW radii',
    kind: 'action',
    quiet: false,
    warning:
      'This overwrites the VDW radius of every atom in the selection with ' +
      'sqrt(b / 8pi^2). The original radii are not kept.',
    source: 'packages/engine/modules/pymol/util.py:958',
  },
  {
    id: 'interchain',
    fn: 'util.interchain_distances',
    label: 'Interchain distances',
    kind: 'action',
    quiet: false,
    /*
     * THE CUTOFF IS NOT OPTIONAL HERE, and this is the one place this panel
     * deliberately does not use upstream's default.
     *
     * `interchain_distances(name, selection, cutoff=None, ...)` forwards
     * `cutoff=None` to `cmd.distance`, which turns it into `-1.0`
     * (`querying.py:492-493`) — meaning NO cutoff, measure every pair. On
     * 1tii.pdb that is chains of 1479/290/740x5 atoms, i.e.
     *
     *     12,450,210 distance measurements
     *
     * and the renderer dies building the geometry for them:
     * `libc++abi: terminating due to uncaught exception of type
     * std::length_error: vector`, thrown inside `PyMOL_Draw`. Measured — the
     * whole bridge process goes down, so it is not an error the panel could
     * catch and report. With a cutoff the same call completes in a second.
     *
     * So the field is here, pre-filled with 3.5 A (PyMOL's own polar-contact
     * distance), and `buildArgs` will not send null for it.
     */
    // `name` comes FIRST, before the selection — the only helper here that
    // takes an output object name.
    params: [
      { kind: 'text', name: 'name', label: 'distance object', default: 'interchain' },
      { kind: 'selection' },
      { kind: 'number', name: 'cutoff', label: 'cutoff Å', default: 3.5 },
      { kind: 'number', name: 'mode', label: 'mode', default: 0 },
      { kind: 'bool', name: 'label', label: 'show labels', default: false },
      { kind: 'bool', name: 'reset', label: 'reset first', default: true },
    ],
    note:
      'A cutoff is required. Upstream defaults it to "no cutoff", which measures ' +
      'every atom pair between every chain — 12.4M distances on a 7-chain structure — ' +
      'and takes the renderer down with it.',
    source: 'packages/engine/modules/pymol/util.py:1043',
  },
  {
    id: 'mass_align',
    fn: 'util.mass_align',
    label: 'Align all objects to target',
    kind: 'action',
    quiet: false,
    /*
     * UPSTREAM DEFECT, verified: `util.py:256` is
     *
     *     [x for x in list if cmd.get_type(x)!="object:molecule"]
     *
     * a list comprehension whose result is DISCARDED — no assignment. The
     * filter that was meant to drop non-molecules does nothing, so the loop
     * then evaluates `(target) and (name)` for every object including maps,
     * distance objects and alignments, and dies on the first one with
     * `Invalid selection name`. Measured: clean scene aligns fine; adding one
     * `distance` object makes it fail. Not patched here — this is a clone of
     * PyMOL, not a fork of it — but the note is shown so the failure is
     * legible instead of looking like a bad target.
     */
    note:
      'Upstream bug (util.py:256): fails if the scene contains any non-molecule ' +
      'object — a map, a distance or an alignment. Delete those first.',
    // Takes a TARGET OBJECT NAME, not a selection: it aligns every other
    // loaded object onto it and creates an `aln*` object.
    params: [
      { kind: 'text', name: 'target', label: 'target object', default: '' },
      { kind: 'bool', name: 'enabled_only', label: 'enabled objects only', default: false },
      { kind: 'number', name: 'max_gap', label: 'max gap', default: 50 },
    ],
    source: 'packages/engine/modules/pymol/util.py:253',
  },
  {
    id: 'ff_copy',
    fn: 'util.ff_copy',
    label: 'Copy force-field parameters',
    kind: 'action',
    quiet: false,
    // Two selections, source and destination — the shared box is neither.
    note:
      'Copies by ATOM NAME, so source and destination must have the same atoms. ' +
      'Mismatched residues raise KeyError on the first name that is missing.',
    params: [
      { kind: 'text', name: 'src', label: 'from', default: '' },
      { kind: 'text', name: 'dst', label: 'to', default: '' },
    ],
    source: 'packages/engine/modules/pymol/util.py:946',
  },
  {
    id: 'shaders',
    fn: 'util.enable_all_shaders',
    label: 'Enable all shaders',
    kind: 'action',
    quiet: false,
    // Takes no arguments at all.
    params: [],
    source: 'packages/engine/modules/pymol/util.py:534',
  },
];

/** The declared params, or the historical default of a single selection. */
export function paramsOf(metric: Metric): readonly MetricParam[] {
  return metric.params ?? [{ kind: 'selection' }];
}

/** Default value for one param, as it first appears in the form. */
export function defaultOf(param: MetricParam): string | number | boolean {
  return param.kind === 'selection' ? '' : param.default;
}

/**
 * Positional arguments for the call, in declaration order.
 *
 * `selection` params take the shared box; the rest take their form value,
 * falling back to the declared default so a blank number field does not send
 * `NaN`. Booleans go over as 0/1 because that is what PyMOL's helpers test.
 */
export function buildArgs(
  metric: Metric,
  selection: string,
  form: Readonly<Record<string, string | number | boolean>>,
): unknown[] {
  return paramsOf(metric).map((p) => {
    if (p.kind === 'selection') return selection;
    const raw = form[p.name];
    if (p.kind === 'bool') return (raw === undefined ? p.default : Boolean(raw)) ? 1 : 0;
    if (p.kind === 'number') {
      /*
       * A CLEARED field is not zero. `Number('')` is 0 and passes
       * `Number.isFinite`, so an empty box used to send 0 — which for
       * `interchain_distances` means a cutoff of zero, and for `state` means
       * "all states". Empty means "I did not choose", so it takes the default.
       */
      if (raw === undefined || raw === '') return p.default;
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? n : p.default;
    }
    return raw === undefined || raw === '' ? p.default : String(raw);
  });
}

/**
 * Which params must be filled before the button does anything.
 *
 * `mass_align` with no target aligns everything onto an object named "", and
 * `ff_copy` with no source silently copies nothing — both look like the helper
 * failed rather than like the form being incomplete.
 */
export function missingParams(
  metric: Metric,
  form: Readonly<Record<string, string | number | boolean>>,
): string[] {
  return paramsOf(metric)
    .filter(
      (p) =>
        p.kind === 'text' &&
        p.default === '' &&
        String(form[p.name] ?? '').trim() === '',
    )
    .map((p) => (p.kind === 'selection' ? '' : p.label));
}

/** Format a scalar result the way PyMOL prints it, or report a non-number. */
export function formatResult(metric: Metric, value: unknown): string {
  if (metric.kind === 'selection') {
    return typeof value === 'string' && value !== '' ? `selection "${value}"` : 'no selection made';
  }
  if (metric.kind === 'action') {
    // These run for their side effect and mostly return None. Saying "done" is
    // the honest report; printing "null" would look like a failure.
    return 'done';
  }
  if (metric.kind === 'angles') {
    // `util.phipsi` returns `(phi, psi)`, either of which is None when the
    // residue has no preceding or following neighbour — a chain terminus.
    if (!Array.isArray(value) || value.length < 2) return String(value ?? '—');
    const one = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}°` : 'n/a';
    return `phi ${one(value[0])}, psi ${one(value[1])}`;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return value === null || value === undefined ? '—' : String(value);
  }
  const digits = metric.precision ?? 2;
  const shown = value.toFixed(digits);
  return metric.unit ? `${shown} ${metric.unit}` : shown;
}

/** Metrics a user can actually press. */
export function runnable(metrics: readonly Metric[] = METRICS): Metric[] {
  return metrics.filter((m) => m.kind !== 'unsupported');
}
