/**
 * Compute panel — the `pymol.util` helpers (WP-24 / B9).
 *
 * These are commands a user runs against a selection and reads a number back
 * from. PyMOL exposes them as Python functions that print to the console; here
 * they get a result column, because a number you have to scroll the feedback
 * pane to find is a number you will re-run.
 *
 * The one that matters is `protein_vacuum_esp`: it MUTATES the structure —
 * deleting alt-conformers and residues it cannot assign charges to
 * (`modules/pymol/util.py:335-383`) — before creating `_e_chg` / `_e_map` /
 * `_e_pot`. B9 requires the UI to warn before that and to surface the
 * diagnostics it prints. It is behind a confirm step, and its console output is
 * where PyMOL puts it.
 */

import { useCallback, useState } from 'react';

import { useSession } from '../../app';
import {
  METRICS,
  buildArgs,
  defaultOf,
  formatResult,
  missingParams,
  paramsOf,
  type Metric,
  type MetricParam,
} from './metrics';
import { COMPUTE_BOOTSTRAP, COMPUTE_NS, type SasaRelativeResult } from '@tenmol/protocol/topics/compute';
import './compute.css';

type Row = { text: string; error: boolean; table?: SasaRelativeResult };

type Form = Record<string, string | number | boolean>;

/** Form defaults for every metric that declares params. */
function initialForms(): Record<string, Form> {
  const out: Record<string, Form> = {};
  for (const m of METRICS) {
    const form: Form = {};
    for (const p of paramsOf(m)) if (p.kind !== 'selection') form[p.name] = defaultOf(p);
    if (Object.keys(form).length > 0) out[m.id] = form;
  }
  return out;
}

export function ComputePanel() {
  const session = useSession();
  const [selection, setSelection] = useState('polymer');
  const [results, setResults] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Metric | null>(null);
  const [forms, setForms] = useState<Record<string, Form>>(initialForms);
  const setField = useCallback(
    (id: string, name: string, value: string | number | boolean) =>
      setForms((f) => ({ ...f, [id]: { ...f[id], [name]: value } })),
    [],
  );

  const execute = useCallback(
    async (m: Metric) => {
      setBusy(m.id);
      try {
        // `quiet` is not universal — see Metric.quiet.
        const kwargs = m.quiet === false ? {} : { quiet: 1 };
        const args = buildArgs(m, selection, forms[m.id] ?? {});
        /*
         * The one call that is not a plain `util.*`: the SASA shim lives on
         * `cmd.tenmol_compute`, which the bridge attaches on demand. Bootstrap
         * it the way `filesApi.ensure()` does — probe, and only install if the
         * probe fails, so a reconnect costs one round trip and not two.
         */
        if (m.fn.startsWith(COMPUTE_NS)) {
          try {
            await session.call(`${COMPUTE_NS}.hello`);
          } catch {
            await session.run(COMPUTE_BOOTSTRAP);
          }
        }
        const value = await session.call<unknown>(m.fn, args, kwargs);
        setResults((r) => ({
          ...r,
          // Spread, not `table: undefined` — `exactOptionalPropertyTypes` makes
          // an explicit undefined a different thing from an absent key.
          [m.id]: {
            text: formatResult(m, value),
            error: false,
            ...(m.kind === 'table' ? { table: value as SasaRelativeResult } : {}),
          },
        }));
      } catch (e) {
        setResults((r) => ({
          ...r,
          [m.id]: { text: e instanceof Error ? e.message : String(e), error: true },
        }));
      } finally {
        setBusy(null);
        setConfirming(null);
      }
    },
    [session, selection, forms],
  );

  const press = useCallback(
    (m: Metric) => {
      const missing = missingParams(m, forms[m.id] ?? {});
      if (missing.length > 0) {
        setResults((r) => ({
          ...r,
          [m.id]: { text: `fill in: ${missing.join(', ')}`, error: true },
        }));
        return;
      }
      // A warning is a warning whatever the kind: `b2vdw` and the SASA shim
      // both overwrite an atom property, which is not undoable either.
      if (m.kind === 'destructive' || m.warning) setConfirming(m);
      else void execute(m);
    },
    [execute, forms],
  );

  return (
    <div className="compute">
      <div className="compute__title">Compute</div>

      <div className="compute__sel">
        <label htmlFor="cp-sel">Selection</label>
        <input
          id="cp-sel"
          type="text"
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          spellCheck={false}
        />
      </div>

      <table className="compute__table">
        <tbody>
          {METRICS.map((m) => {
            const row = results[m.id];
            const off = m.kind === 'unsupported';
            const extra = paramsOf(m).filter((p) => p.kind !== 'selection');
            return (
              <tr key={m.id} className={off ? 'is-off' : undefined}>
                <td>
                  <button
                    type="button"
                    className={`compute__btn${m.kind === 'destructive' ? ' is-danger' : ''}`}
                    disabled={off || busy !== null}
                    title={off ? m.unsupportedReason : m.source}
                    onClick={() => press(m)}
                  >
                    {busy === m.id ? '…' : m.label}
                  </button>
                  {m.note !== undefined && <div className="compute__note-inline">{m.note}</div>}
                  {extra.length > 0 && (
                    <div className="compute__args">
                      {extra.map((p) => (
                        <ParamField
                          key={p.name}
                          metricId={m.id}
                          param={p}
                          value={forms[m.id]?.[p.name]}
                          onChange={setField}
                        />
                      ))}
                    </div>
                  )}
                </td>
                <td className={`compute__val${row?.error ? ' is-error' : ''}`}>
                  {off ? (
                    <span className="compute__off" title={m.unsupportedReason}>
                      unavailable
                    </span>
                  ) : (
                    (row?.text ?? '')
                  )}
                  {row?.table && <SasaTable result={row.table} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {confirming !== null && (
        <div className="compute__confirm" role="alertdialog" aria-label="confirm destructive action">
          <p className="compute__warn">{confirming.warning}</p>
          <div className="compute__confirm-actions">
            <button type="button" className="compute__btn" onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="compute__btn is-danger"
              onClick={() => void execute(confirming)}
            >
              {/*
               * Not every warned helper deletes atoms. `protein_vacuum_esp`
               * really does modify the structure; `b2vdw` and the SASA shim
               * overwrite an atom property. Saying "modify structure" for
               * those would overstate it, and a warning nobody believes is a
               * warning nobody reads.
               */}
              {confirming.kind === 'destructive' ? 'Modify structure and run' : 'Overwrite and run'}
            </button>
          </div>
        </div>
      )}

      <p className="compute__note">
        Diagnostics print to the console, where PyMOL puts them. Results use each helper&rsquo;s own
        units; a failure is shown here rather than only in the feedback pane.
      </p>
    </div>
  );
}

/** One declared argument, rendered by its kind. */
function ParamField({
  metricId,
  param,
  value,
  onChange,
}: {
  metricId: string;
  param: Exclude<MetricParam, { kind: 'selection' }>;
  value: string | number | boolean | undefined;
  onChange: (id: string, name: string, value: string | number | boolean) => void;
}) {
  const id = `cp-${metricId}-${param.name}`;
  if (param.kind === 'bool') {
    return (
      <label className="compute__arg" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === undefined ? param.default : Boolean(value)}
          onChange={(e) => onChange(metricId, param.name, e.target.checked)}
        />
        {param.label}
      </label>
    );
  }
  return (
    <label className="compute__arg" htmlFor={id}>
      {param.label}
      <input
        id={id}
        type={param.kind === 'number' ? 'number' : 'text'}
        spellCheck={false}
        value={String(value ?? param.default)}
        onChange={(e) =>
          onChange(
            metricId,
            param.name,
            param.kind === 'number' ? Number(e.target.value) : e.target.value,
          )
        }
      />
    </label>
  );
}

/**
 * Per-residue exposure.
 *
 * PyMOL's own printout (`util.py:1166-1172`) is a fixed-width bar of `=`
 * characters next to a percentage. The same information here is a real bar,
 * and every row's `sele` is clickable because the bridge spells the 4-tuple key
 * as a selection expression — which is the whole reason the shim exists.
 */
function SasaTable({ result }: { result: SasaRelativeResult }) {
  const session = useSession();
  const records = result.records ?? [];
  if (records.length === 0) return <div className="compute__empty">no residues</div>;
  return (
    <div className="compute__sasa">
      <div className="compute__sasa-head">
        {records.length} residues, value written to “{result.var}”
        {result.unnormalised > 0 && (
          <span className="compute__warn-inline">
            {' '}
            — {result.unnormalised} not normalised (upstream skipped them; the value is a raw area)
          </span>
        )}
      </div>
      <ul className="compute__sasa-list">
        {records.map((r) => (
          <li key={r.sele} className={r.normalised ? undefined : 'is-raw'}>
            <button
              type="button"
              className="compute__sasa-sele"
              title={`select ${r.sele}`}
              onClick={() => void session.run(`select sele, ${r.sele}`)}
            >
              {r.chain || '-'}/{r.resi} {r.resn}
            </button>
            <span className="compute__sasa-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(1, r.value)) * 100}%` }} />
            </span>
            <span className="compute__sasa-num">
              {r.normalised ? `${(r.value * 100).toFixed(0)}%` : r.value.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
