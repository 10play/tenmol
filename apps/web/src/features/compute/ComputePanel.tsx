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
import { METRICS, formatResult, type Metric } from './metrics';
import './compute.css';

type Row = { text: string; error: boolean };

export function ComputePanel() {
  const session = useSession();
  const [selection, setSelection] = useState('polymer');
  const [results, setResults] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Metric | null>(null);

  const execute = useCallback(
    async (m: Metric) => {
      setBusy(m.id);
      try {
        // `quiet` is not universal — see Metric.quiet.
        const kwargs = m.quiet === false ? {} : { quiet: 1 };
        const value = await session.call<unknown>(m.fn, [selection], kwargs);
        setResults((r) => ({ ...r, [m.id]: { text: formatResult(m, value), error: false } }));
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
    [session, selection],
  );

  const press = useCallback(
    (m: Metric) => {
      if (m.kind === 'destructive') setConfirming(m);
      else void execute(m);
    },
    [execute],
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
                </td>
                <td className={`compute__val${row?.error ? ' is-error' : ''}`}>
                  {off ? (
                    <span className="compute__off" title={m.unsupportedReason}>
                      unavailable
                    </span>
                  ) : (
                    (row?.text ?? '')
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
            <button type="button" className="compute__btn" onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="compute__btn is-danger"
              onClick={() => void execute(confirming)}
            >
              Modify structure and run
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
