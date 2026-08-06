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
 * (`packages/engine/modules/pymol/util.py:335-383`) — before creating `_e_chg` / `_e_map` /
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
import { Button, Checkbox, TextInput } from '../../ui';
import './compute.css';

type Row = {
  text: string;
  error: boolean;
  table?: SasaRelativeResult;
  /** Console lines PyMOL printed WHILE this button's call ran. See below. */
  diagnostics?: readonly string[];
};

/**
 * How long to keep watching the feedback stream after a call returns.
 *
 * Not decoration, and not a guess at a round trip: PyMOL's console output does
 * not come back with the RPC reply. It is drained by the bridge's status thread
 * at `status_hz` (10 Hz, `packages/bridge/tenmol_bridge/config.py`) and pushed as
 * `{t:'feedback'}` frames, so the last lines of a run land AFTER the promise
 * resolves. Measured on `util.protein_vacuum_esp`: the four diagnostic lines
 * arrive across ~0.3 s either side of the reply. 800 ms is two status ticks of
 * margin on that.
 */
export const DIAGNOSTIC_WINDOW_MS = 800;

/** More than this and it is a log, not a result; the console has the rest. */
const MAX_DIAGNOSTIC_LINES = 40;

/** The shape this module needs out of a `FeedbackEntry`; keeps it store-free. */
interface FeedbackLine {
  seq: number;
  text: string;
  origin: 'server' | 'client';
  kind: string;
}

/**
 * The console lines PyMOL produced since `mark`, as a result rather than a log.
 *
 * Three filters, each for a reason:
 *
 *   origin === 'server'  — a client-origin line is this UI talking to itself
 *                          (`session.act`'s echo, transport notices). Showing
 *                          it back would claim PyMOL said it.
 *   kind !== 'prompt'    — `PyMOL>...` is the echo of somebody's command line,
 *                          not output of this call.
 *   text.trim() !== ''   — PyMOL pads its diagnostics with blank lines.
 *
 * Exported because the filter, not the rendering, is the part worth pinning.
 */
export function diagnosticsSince(
  lines: readonly FeedbackLine[],
  mark: number,
): readonly string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.seq < mark) continue;
    if (line.origin !== 'server') continue;
    if (line.kind === 'prompt') continue;
    if (line.text.trim() === '') continue;
    out.push(line.text);
  }
  // The TAIL, not the head: when a run overflows, the summary lines that come
  // last are the ones worth keeping.
  return out.length > MAX_DIAGNOSTIC_LINES ? out.slice(-MAX_DIAGNOSTIC_LINES) : out;
}

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
      /*
       * B9 / inventory row 503: "must warn before the mutation AND surface the
       * diagnostics".
       *
       * `util.protein_vacuum_esp` prints what it did — how many residues it
       * deleted, the summed partial charge, the total charge of the map — and
       * those lines used to go only to the generic console feed, metres away
       * from the button that caused them and interleaved with everything else.
       * A user who has just confirmed a DESTRUCTIVE dialog is exactly the user
       * who needs to see them.
       *
       * The mark is the feedback store's next sequence number, taken before the
       * call: every line the store hands out afterwards is newer, and `seq` is
       * monotonic and never reused (`packages/stores/src/feedback.ts`). That is
       * a read of a store the shell already fills, NOT a second subscription —
       * the bridge's feedback drain is destructive and a second consumer would
       * split the stream (see `app/session.ts`).
       */
      const mark = session.stores.feedback.get().nextSeq;
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
        // Detached on purpose: the button un-busies immediately and the
        // diagnostics fill in when the console has caught up. Awaiting it here
        // would leave a destructive helper looking like it was still running
        // for another 800 ms.
        void (async () => {
          await new Promise((resolve) => setTimeout(resolve, DIAGNOSTIC_WINDOW_MS));
          const lines = diagnosticsSince(session.stores.feedback.get().lines, mark);
          if (lines.length === 0) return;
          setResults((r) => {
            const row = r[m.id];
            return row ? { ...r, [m.id]: { ...row, diagnostics: lines } } : r;
          });
        })();
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
        <TextInput
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
                  <Button
                    variant="bare"
                    type="button"
                    className={`compute__btn${m.kind === 'destructive' ? ' is-danger' : ''}`}
                    disabled={off || busy !== null}
                    title={off ? m.unsupportedReason : m.source}
                    onClick={() => press(m)}
                  >
                    {busy === m.id ? '…' : m.label}
                  </Button>
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
                  {row?.diagnostics && row.diagnostics.length > 0 && (
                    <details className="compute__diag" data-diagnostics={m.id} open>
                      <summary>
                        what PyMOL reported ({row.diagnostics.length}{' '}
                        {row.diagnostics.length === 1 ? 'line' : 'lines'})
                      </summary>
                      <pre className="compute__diaglines">{row.diagnostics.join('\n')}</pre>
                    </details>
                  )}
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
            <Button variant="bare" type="button" className="compute__btn" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="bare"
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
            </Button>
          </div>
        </div>
      )}

      <p className="compute__note">
        Whatever PyMOL printed while a helper ran is captured next to that helper&rsquo;s result, as
        well as going to the console. Results use each helper&rsquo;s own units; a failure is shown
        here rather than only in the feedback pane.
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
        <Checkbox
          id={id}
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
      <TextInput
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
            <Button
              variant="bare"
              type="button"
              className="compute__sasa-sele"
              title={`select ${r.sele}`}
              onClick={() => void session.run(`select sele, ${r.sele}`)}
            >
              {r.chain || '-'}/{r.resi} {r.resn}
            </Button>
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
