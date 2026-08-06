/**
 * Export Molecule, Export Map, Export Alignment, and the session save flow.
 *
 * Sources: `file_dialogs.py:519-601` (`file_save`, form `save_molecule.ui`),
 * `file_dialogs.py:816-855` (`_file_save_object`, form `save_object.ui`) and
 * `pymol_qt_gui.py:651-671` (`session_save` / `session_save_as`).
 */

import { useEffect, useState } from 'react';
import type { SaveMoleculeInfo } from '@tenmol/protocol/topics/files';
import { Check, Field, Modal } from './Modal';

/** The parameters the Export Molecule dialog collects for one save. */
export interface MoleculeSaveRequest {
  selection: string;
  state: number;
  settings: SaveMoleculeInfo['settings'];
  /** '' | '{name}' | '{name}_{state}' — the multi-file pattern. */
  pattern: string;
  promptEach: boolean;
  multisave: boolean;
  filter: string;
}

/** `file_save` (`file_dialogs.py:519-601`). */
export function ExportMoleculeDialog({
  info,
  onSave,
  onClose,
}: {
  info: SaveMoleculeInfo;
  onSave: (request: MoleculeSaveRequest) => void;
  onClose: () => void;
}) {
  // `input_selection` is an editable combo seeded with 'enabled', 'all' from
  // the .ui and then all objects + public selections; blank means the
  // placeholder, which is the first entry ('enabled').
  const names = ['enabled', 'all', ...info.objects, ...info.selections];
  const [selection, setSelection] = useState('');
  const [state, setState] = useState(-1);
  const [tab, setTab] = useState<'options' | 'pdb' | 'multi'>('options');
  const [settings, setSettings] = useState(info.settings);
  const [pattern, setPattern] = useState<'' | 'object' | 'state'>('');
  const [objectFmt, setObjectFmt] = useState('{name}');
  const [stateFmt, setStateFmt] = useState('{name}_{state}');
  const [promptEach, setPromptEach] = useState(true);
  const [multisave, setMultisave] = useState(false);
  const [filter, setFilter] = useState(info.filters[0] ?? 'By Extension (*.*)');

  // "Pressing `input_multi_state` forces the state combo to index 1 = all
  // states" (`file_dialogs.py:597-598`).
  useEffect(() => {
    if (pattern === 'state') setState(0);
  }, [pattern]);

  const effectivePattern = pattern === 'state' ? stateFmt : pattern === 'object' ? objectFmt : '';

  return (
    <Modal
      title="Export Molecule"
      onClose={onClose}
      wide
      footer={
        <>
          <select className="fdlg__select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            {info.filters.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fdlg__btn fdlg__btn--go"
            onClick={() =>
              onSave({
                selection: selection || 'enabled',
                state,
                settings,
                pattern: effectivePattern,
                promptEach,
                multisave,
                filter,
              })
            }
          >
            Save…
          </button>
        </>
      }
    >
      <Field label="Selection">
        <input
          value={selection}
          placeholder="enabled"
          list="fdlg-save-sele"
          onChange={(e) => setSelection(e.target.value)}
        />
      </Field>
      <datalist id="fdlg-save-sele">
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <Field label="State">
        <select value={state} onChange={(e) => setState(Number(e.target.value))}>
          <option value={-1}>-1 (current)</option>
          <option value={0}>0 (all states)</option>
          {Array.from({ length: info.states }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>

      <div className="fdlg__tabs">
        <button
          type="button"
          className={tab === 'options' ? 'is-on' : ''}
          onClick={() => setTab('options')}
        >
          Options
        </button>
        <button type="button" className={tab === 'pdb' ? 'is-on' : ''} onClick={() => setTab('pdb')}>
          PDB
        </button>
        <button
          type="button"
          className={tab === 'multi' ? 'is-on' : ''}
          onClick={() => setTab('multi')}
        >
          Multiple files
        </button>
      </div>

      {tab === 'options' && (
        <Check
          label='Original atom order (according to "rank")'
          checked={settings.retain_order}
          onChange={(v) => setSettings({ ...settings, retain_order: v })}
          hint="setting retain_order"
        />
      )}

      {tab === 'pdb' && (
        <>
          <Check
            label="Write multiple bonds as duplicate CONECT records"
            checked={settings.no_pdb_conect_nodup}
            onChange={(v) => setSettings({ ...settings, no_pdb_conect_nodup: v })}
            hint="INVERSE of setting pdb_conect_nodup"
          />
          <Check
            label="Write CONECT records for all bonds"
            checked={settings.pdb_conect_all}
            onChange={(v) => setSettings({ ...settings, pdb_conect_all: v })}
            hint="setting pdb_conect_all"
          />
          <Check
            label="Write segment identifier (segi) column"
            checked={settings.no_ignore_pdb_segi}
            onChange={(v) => setSettings({ ...settings, no_ignore_pdb_segi: v })}
            hint="INVERSE of setting ignore_pdb_segi"
          />
          <Check
            label="Retain atom ids"
            checked={settings.pdb_retain_ids}
            onChange={(v) => setSettings({ ...settings, pdb_retain_ids: v })}
            hint="setting pdb_retain_ids"
          />
          <Check
            label="Write HEADER for every object"
            checked={multisave}
            onChange={setMultisave}
            hint="cmd.multisave — pdb/cif only"
          />
        </>
      )}

      {tab === 'multi' && (
        <>
          <p className="fdlg__text">Write objects or states to …</p>
          <label className="fdlg__radio">
            <input type="radio" checked={pattern === ''} onChange={() => setPattern('')} />
            <span>one single file</span>
          </label>
          <label className="fdlg__radio">
            <input
              type="radio"
              checked={pattern === 'object'}
              onChange={() => setPattern('object')}
            />
            <span>one file per object</span>
          </label>
          {pattern === 'object' && (
            <input value={objectFmt} onChange={(e) => setObjectFmt(e.target.value)} />
          )}
          <label className="fdlg__radio">
            <input type="radio" checked={pattern === 'state'} onChange={() => setPattern('state')} />
            <span>one file per object-state</span>
          </label>
          {pattern === 'state' && (
            <input value={stateFmt} onChange={(e) => setStateFmt(e.target.value)} />
          )}
          <Check
            label="Prompt for every file"
            checked={promptEach}
            onChange={setPromptEach}
            hint="cmd.multifilenamegen produces one (file, selection, state) triple per object/state"
          />
        </>
      )}
    </Modal>
  );
}

/**
 * `_file_save_object` (`file_dialogs.py:816-855`) — Export Map and Export
 * Alignment share this form; only the type, the filter and the "no objects"
 * message differ.
 */
export function SaveObjectDialog({
  title,
  names,
  emptyMessage,
  onPick,
  onClose,
}: {
  title: string;
  names: string[];
  emptyMessage: string;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(names[0] ?? '');
  if (names.length === 0) {
    return (
      <Modal
        title="Warning"
        onClose={onClose}
        footer={
          <button type="button" className="fdlg__btn" onClick={onClose}>
            OK
          </button>
        }
      >
        <pre className="fdlg__text">{emptyMessage}</pre>
      </Modal>
    );
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fdlg__btn fdlg__btn--go" onClick={() => onPick(name)}>
            Save…
          </button>
        </>
      }
    >
      <Field label="Object">
        <select value={name} onChange={(e) => setName(e.target.value)}>
          {names.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}
