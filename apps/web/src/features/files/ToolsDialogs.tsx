/**
 * Get PDB, Run Script, Log File, Working Directory and Open Recent.
 *
 * Sources: `file_dialogs.py:444-516` (fetch, form `fetch.ui`),
 * `pymol_qt_gui.py:823-873` (log / run / cd) and `_gui.py:975-1032` +
 * `pymol_qt_gui.py:341-375` (recent files).
 */

import { useEffect, useRef, useState } from 'react';
import type { FetchInfo, LogStatus, RecentEntry } from '@tenmol/protocol/topics/files';
import { Check, Field, Modal, Preview } from './Modal';
import { fetchCommand } from './commands';
import type { FilesApi } from './filesApi';

/** `file_fetch_pdb` (`file_dialogs.py:444-516`). */
export function FetchDialog({
  api,
  info,
  onRun,
  onClose,
  onBrowseFetchPath,
}: {
  api: FilesApi;
  info: FetchInfo;
  onRun: (command: string) => void;
  onClose: () => void;
  onBrowseFetchPath: () => void;
}) {
  const [code, setCode] = useState('');
  const [assembly, setAssembly] = useState(info.assembly ?? '');
  const [chain, setChain] = useState('');
  const [name, setName] = useState('');
  const [structure, setStructure] = useState(true);
  const [map2fofc, setMap2fofc] = useState(false);
  const [name2fofc, setName2fofc] = useState('');
  const [mapfofc, setMapfofc] = useState(false);
  const [namefofc, setNamefofc] = useState('');
  const [assemblies, setAssemblies] = useState<string[]>([]);
  const [chains, setChains] = useState<string[]>([]);
  const [lookup, setLookup] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const timer = useRef<number | null>(null);

  // `AsyncFunc` in Qt (`pymol/Qt/utils.py:100-125`): the two PDBe lookups run
  // off the UI thread and fill the combos when they land. Here the HTTP call
  // runs on a bridge worker thread and this polls for it, because doing it on
  // the engine thread would stall the 60 Hz draw pump.
  useEffect(() => {
    if (code.length !== 4) {
      setAssemblies([]);
      setChains([]);
      setLookup('idle');
      return;
    }
    let cancelled = false;
    setLookup('pending');
    void api.pdbeStart(code).catch(() => undefined);
    const poll = () => {
      void api
        .pdbeResult(code)
        .then((result) => {
          if (cancelled) return;
          if (result.pending) {
            timer.current = window.setTimeout(poll, 300);
            return;
          }
          setAssemblies(result.assemblies);
          setChains(result.chains);
          setLookup(result.error ? 'error' : 'done');
        })
        .catch(() => setLookup('error'));
    };
    timer.current = window.setTimeout(poll, 250);
    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [api, code]);

  const command = fetchCommand({
    code,
    assembly,
    chain,
    name,
    structure,
    map2fofc,
    name2fofc,
    mapfofc,
    namefofc,
  });

  return (
    <Modal
      title="Get PDB"
      onClose={onClose}
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fdlg__btn fdlg__btn--go"
            onClick={() => onRun(command)}
            disabled={code.length !== 4}
            title={code.length === 4 ? '' : 'Need 4 letter PDB code'}
          >
            Download
          </button>
        </>
      }
    >
      <div className="fdlg__banner modern:rounded modern:bg-accent-soft modern:text-pm-text">
        Downloading will save the files in the directory{' '}
        <code>{info.fetchPath}</code> (setting <code>fetch_path</code>
        {info.fetchPathWritable ? '' : ' — NOT WRITABLE'}).{' '}
        <button
          type="button"
          className="fdlg__link modern:text-pm-accent"
          onClick={onBrowseFetchPath}
        >
          change…
        </button>
      </div>
      <Field label="PDB ID">
        <input
          maxLength={4}
          placeholder="4 letter PDB code"
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
        />
        <span className="fdlg__unit">
          {lookup === 'pending' ? 'looking up PDBe…' : lookup === 'error' ? 'PDBe lookup failed' : ''}
        </span>
      </Field>
      <div className="fdlg__row">
        <Check label="PDB Structure" checked={structure} onChange={setStructure} />
        <input placeholder="Object name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <fieldset className="fdlg__group">
        <legend>PDB Structure Options</legend>
        <Field label="Assembly (optional)" hint="setting assembly">
          <input value={assembly} list="fdlg-assemblies" onChange={(e) => setAssembly(e.target.value)} />
        </Field>
        <datalist id="fdlg-assemblies">
          {assemblies.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <Field label="Chain">
          <input value={chain} list="fdlg-chains" onChange={(e) => setChain(e.target.value)} />
        </Field>
        <datalist id="fdlg-chains">
          {chains.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </fieldset>
      <div className="fdlg__row">
        <Check label="2FoFc Map" checked={map2fofc} onChange={setMap2fofc} />
        <input
          placeholder="Object name"
          value={name2fofc}
          onChange={(e) => setName2fofc(e.target.value)}
        />
      </div>
      <div className="fdlg__row">
        <Check label="FoFc Map" checked={mapfofc} onChange={setMapfofc} />
        <input
          placeholder="Object name"
          value={namefofc}
          onChange={(e) => setNamefofc(e.target.value)}
        />
      </div>
      <Preview command={command} />
    </Modal>
  );
}

/** Log File ▸ Open / Append / Resume / Close (`pymol_qt_gui.py:823-845`). */
export function LogDialog({
  status,
  onOpen,
  onAppend,
  onResume,
  onCloseLog,
  onClose,
}: {
  status: LogStatus;
  onOpen: () => void;
  onAppend: () => void;
  onResume: () => void;
  onCloseLog: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Log File"
      onClose={onClose}
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <p className="fdlg__text">
        {status.open ? (
          <>
            logging to <code>{status.path || '(open)'}</code> — mode{' '}
            {status.logging === 2 ? 'python' : 'pml'} (setting <code>logging</code> ={' '}
            {status.logging})
          </>
        ) : (
          <>no log file open (setting <code>logging</code> = 0)</>
        )}
      </p>
      <div className="fdlg__row">
        <button type="button" className="fdlg__btn" onClick={onOpen}>
          Open…
        </button>
        <button type="button" className="fdlg__btn" onClick={onResume}>
          Resume…
        </button>
        <button type="button" className="fdlg__btn" onClick={onAppend}>
          Append…
        </button>
        <button
          type="button"
          className="fdlg__btn"
          disabled={!status.open}
          onClick={onCloseLog}
        >
          Close log
        </button>
      </div>
      <p className="fdlg__hint">
        `.py`/`.pym` sets <code>logging</code> to 2 (python form), anything else to 1 (pml).
        Append mode writes a leading newline. Resume executes the file, then reopens it in
        append mode.
      </p>
    </Modal>
  );
}

/** Open Recent (`pymol_qt_gui.py:341-375`, DB at `~/.pymol/recent.db`). */
export function RecentDialog({
  entries,
  onOpen,
  onClose,
}: {
  entries: RecentEntry[];
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Open Recent"
      onClose={onClose}
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {entries.length === 0 && <p className="fdlg__text">no recent files</p>}
      <div className="fdlg__list">
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className={`fdlg__listrow${entry.exists === false ? ' is-missing' : ''}`}
            title={entry.path}
            onClick={() => onOpen(entry.path)}
          >
            {entry.display}
          </button>
        ))}
      </div>
      <p className="fdlg__hint">
        `~/.pymol/recent.db`, newest first, pruned to 15 rows once it passes 20 — PyMOL&apos;s
        own SQLite table, written by PyMOL&apos;s own code.
      </p>
    </Modal>
  );
}
