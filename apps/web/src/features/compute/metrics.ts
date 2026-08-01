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
 *    unassigned residues (`modules/pymol/util.py:335-383`) — and creates three
 *    objects. It is `destructive`, and the panel must confirm before running it.
 */

export type MetricKind = 'scalar' | 'selection' | 'destructive' | 'unsupported';

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
   * Does the helper accept `quiet`? NOT universal: `find_surface_residues` and
   * `find_surface_atoms` take `(sele, name[, cutoff])` and raise
   * "unexpected keyword argument 'quiet'" if it is passed.
   */
  quiet?: boolean;
  source: string;
}

export const METRICS: readonly Metric[] = [
  {
    id: 'area',
    fn: 'util.get_area',
    label: 'Molecular surface area',
    kind: 'scalar',
    unit: 'Å²',
    precision: 2,
    source: 'modules/pymol/util.py:205',
  },
  {
    id: 'sasa',
    fn: 'util.get_sasa',
    label: 'Solvent-accessible surface area',
    kind: 'scalar',
    unit: 'Å²',
    precision: 2,
    source: 'modules/pymol/util.py:240',
  },
  {
    id: 'mass',
    fn: 'util.compute_mass',
    label: 'Mass',
    kind: 'scalar',
    unit: 'Da',
    precision: 2,
    source: 'modules/pymol/util.py:285',
  },
  {
    id: 'formal',
    fn: 'util.sum_formal_charges',
    label: 'Sum of formal charges',
    kind: 'scalar',
    precision: 0,
    source: 'modules/pymol/util.py:269',
  },
  {
    id: 'partial',
    fn: 'util.sum_partial_charges',
    label: 'Sum of partial charges',
    kind: 'scalar',
    precision: 4,
    source: 'modules/pymol/util.py:277',
  },
  {
    id: 'surf_res',
    fn: 'util.find_surface_residues',
    label: 'Find surface residues',
    kind: 'selection',
    quiet: false,
    source: 'modules/pymol/util.py:121',
  },
  {
    id: 'surf_atoms',
    fn: 'util.find_surface_atoms',
    label: 'Find surface atoms',
    kind: 'selection',
    quiet: false,
    source: 'modules/pymol/util.py:166',
  },
  {
    id: 'esp',
    fn: 'util.protein_vacuum_esp',
    label: 'Protein vacuum ESP',
    kind: 'destructive',
    warning:
      'This MODIFIES the structure: it deletes alternate conformers and residues it cannot ' +
      'assign charges to, then creates the objects _e_chg, _e_map and _e_pot. It cannot be undone.',
    source: 'modules/pymol/util.py:385',
  },
  {
    id: 'sasa_rel',
    fn: 'util.get_sasa_relative',
    label: 'Relative SASA per residue',
    kind: 'unsupported',
    unsupportedReason:
      'returns a dict keyed by a 4-tuple, which the bridge codec refuses with ' +
      'NotSerializable. Needs a bridge shim that re-keys it before it can be shown.',
    source: 'modules/pymol/util.py:1064',
  },
];

/** Format a scalar result the way PyMOL prints it, or report a non-number. */
export function formatResult(metric: Metric, value: unknown): string {
  if (metric.kind === 'selection') {
    return typeof value === 'string' && value !== '' ? `selection "${value}"` : 'no selection made';
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
