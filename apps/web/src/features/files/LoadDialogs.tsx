/**
 * The format-specific import dialogs of `modules/pmg_qt/file_dialogs.py`.
 *
 * Each one is a 1:1 port of a `pmg_qt/forms/*.ui` form plus the `get_command()`
 * that renders its live preview. They emit a **command string** through
 * `cmd.do` exactly like the Qt originals, so the console echo and the log file
 * are identical.
 */

import { useEffect, useMemo, useState } from 'react';
import type {
  AlnDialogInfo,
  FileClassification,
  MaeDialogInfo,
  MapDialogInfo,
  MtzDialogInfo,
  PartialGate,
  TrajDialogInfo,
} from '@tenmol/protocol/topics/files';
import { Check, Field, Modal, Preview, Unavailable } from './Modal';
import { maeCommand, mapCommand, trajCommand } from './commands';

/* ------------------------------------------------------------------ traj */

/** `load_traj_dialog` (`file_dialogs.py:102-149`), form `load_traj.ui`. */
export function TrajDialog({
  filename,
  info,
  onRun,
  onClose,
}: {
  filename: string;
  info: TrajDialogInfo;
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  // `form.input_object.setCurrentIndex(count - 1)` — the LAST object.
  const [object, setObject] = useState(info.objects[info.objects.length - 1] ?? '');
  const [state, setState] = useState(1);
  const [start, setStart] = useState(1);
  const [stop, setStop] = useState(-1);
  const [interval, setInterval] = useState(1);
  const [deferBuilds, setDeferBuilds] = useState(false);

  const command = trajCommand({ filename, object, state, start, stop, interval, deferBuilds });

  if (!info.ok) {
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
        <p className="fdlg__text">{info.message}</p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Load Trajectory"
      onClose={onClose}
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fdlg__btn fdlg__btn--go" onClick={() => onRun(command)}>
            Load
          </button>
        </>
      }
    >
      <div className="fdlg__path">{filename}</div>
      <Field label="Target Object">
        <select value={object} onChange={(e) => setObject(e.target.value)}>
          {info.objects.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="State" hint="Append if state=0">
        <input
          type="number"
          min={0}
          max={999}
          value={state}
          onChange={(e) => setState(Number(e.target.value))}
        />
      </Field>
      <fieldset className="fdlg__group">
        <legend>Frames</legend>
        <Field label="Start">
          <input
            type="number"
            min={1}
            max={99999}
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
          />
        </Field>
        <Field label="Stop" hint="Load entire trajectory if stop < 1">
          <input
            type="number"
            min={-1}
            max={99999}
            value={stop}
            onChange={(e) => setStop(Number(e.target.value))}
          />
        </Field>
        <Field label="Interval">
          <input
            type="number"
            min={1}
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
          />
        </Field>
      </fieldset>
      <fieldset className="fdlg__group">
        <legend>Memory Optimization</legend>
        <Check
          label="defer_builds_mode=3"
          checked={deferBuilds}
          onChange={setDeferBuilds}
          hint="set defer_builds_mode, 3"
        />
      </fieldset>
      <Preview command={command} />
    </Modal>
  );
}

/* ------------------------------------------------------------------- map */

/** `load_map_dialog` (`file_dialogs.py:336-406`), form `load_map.ui`. */
export function MapDialog({
  filename,
  mapType,
  info,
  onRun,
  onClose,
}: {
  filename: string;
  mapType: string;
  info: MapDialogInfo;
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  const [objectName, setObjectName] = useState('');
  const [normalize, setNormalize] = useState(info.normalize);
  const [selection, setSelection] = useState('');
  const [buffer, setBuffer] = useState(2);
  const [carve, setCarve] = useState(false);
  const [level, setLevel] = useState(1);
  const [volume, setVolume] = useState(false);
  const [volumeName, setVolumeName] = useState('');
  const [isomesh, setIsomesh] = useState(false);
  const [isomeshName, setIsomeshName] = useState('');
  const [isosurface, setIsosurface] = useState(false);
  const [isosurfaceName, setIsosurfaceName] = useState('');

  const command = mapCommand({
    filename,
    normalizeSetting: info.normalizeSetting,
    normalize,
    objectName,
    defaultName: info.objectName,
    selection,
    buffer,
    carve,
    level,
    volume,
    volumeName,
    isomesh,
    isomeshName,
    isosurface,
    isosurfaceName,
  });

  return (
    <Modal
      title={`Load Map (${mapType})`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fdlg__btn fdlg__btn--go" onClick={() => onRun(command)}>
            Load
          </button>
        </>
      }
    >
      <div className="fdlg__path">{filename}</div>
      <fieldset className="fdlg__group">
        <legend>Map Object</legend>
        <Field label="Object name">
          <input
            value={objectName}
            placeholder={info.objectName}
            onChange={(e) => setObjectName(e.target.value)}
          />
        </Field>
        <Check
          label="normalize (mean=0 stdev=1)"
          checked={normalize}
          onChange={setNormalize}
          hint={`setting ${info.normalizeSetting}. Normalization does NOT take the unit cell into account.`}
        />
      </fieldset>
      <fieldset className="fdlg__group">
        <legend>Representation</legend>
        <Field label="selection">
          <input
            value={selection}
            list="fdlg-map-sele"
            placeholder="(none)"
            onChange={(e) => setSelection(e.target.value)}
          />
        </Field>
        <datalist id="fdlg-map-sele">
          <option value="enabled" />
          <option value="sele" />
          <option value="center" />
        </datalist>
        <Field label="buffer">
          <input
            type="number"
            step={0.1}
            value={buffer}
            onChange={(e) => setBuffer(Number(e.target.value))}
          />
        </Field>
        <Check label="carve" checked={carve} onChange={setCarve} />
        <Field label="level">
          <input
            type="number"
            step={0.1}
            min={-99}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
          />
        </Field>
        <div className="fdlg__row">
          <Check label="volume" checked={volume} onChange={setVolume} />
          <input
            placeholder="object name"
            value={volumeName}
            onChange={(e) => setVolumeName(e.target.value)}
          />
        </div>
        <div className="fdlg__row">
          <Check label="isomesh" checked={isomesh} onChange={setIsomesh} />
          <input
            placeholder="object name"
            value={isomeshName}
            onChange={(e) => setIsomeshName(e.target.value)}
          />
        </div>
        <div className="fdlg__row">
          <Check label="isosurface" checked={isosurface} onChange={setIsosurface} />
          <input
            placeholder="object name"
            value={isosurfaceName}
            onChange={(e) => setIsosurfaceName(e.target.value)}
          />
        </div>
      </fieldset>
      <Preview command={command} />
    </Modal>
  );
}

/* ------------------------------------------------------------------- mae */

/** `load_mae_dialog` (`file_dialogs.py:285-333`), form `load_mae.ui`. */
export function MaeDialog({
  filename,
  info,
  onRun,
  onClose,
}: {
  filename: string;
  info: MaeDialogInfo;
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  const [objectName, setObjectName] = useState('');
  const [mimic, setMimic] = useState(true);
  const [objectProps, setObjectProps] = useState(info.objectProps);
  const [atomProps, setAtomProps] = useState(info.atomProps);
  const [choice, setChoice] = useState(0);

  // `forms/load_mae.ui` always ships the four entries; fall back to
  // "automatic handling" (-2, -1) rather than crash if a build ships fewer.
  const selected = info.choices[choice] ??
    info.choices[0] ?? { label: 'automatic handling', multiplex: -2, discrete: -1 };
  const command = maeCommand({
    filename,
    objectName,
    mimic,
    objectProps,
    atomProps,
    multiplex: selected.multiplex,
    discrete: selected.discrete,
  });

  return (
    <Modal
      title="Load Maestro File"
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
            disabled={Boolean(info.unavailable)}
            onClick={() => onRun(command)}
          >
            Load
          </button>
        </>
      }
    >
      <div className="fdlg__path">{filename}</div>
      <Unavailable message={info.unavailable} />
      <Field label="Object/group name">
        <input
          value={objectName}
          placeholder={info.objectName}
          onChange={(e) => setObjectName(e.target.value)}
        />
      </Field>
      <Check
        label="Use settings to match cartoon/ribbon color and ballstick style"
        checked={mimic}
        onChange={setMimic}
      />
      <Field label="Object properties">
        <input value={objectProps} onChange={(e) => setObjectProps(e.target.value)} />
      </Field>
      <Field label="Atom properties">
        <input value={atomProps} onChange={(e) => setAtomProps(e.target.value)} />
      </Field>
      <Field label="Multiple entries">
        <select value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
          {info.choices.map((item, index) => (
            <option key={item.label} value={index}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      <Preview command={command} />
    </Modal>
  );
}

/* ------------------------------------------------------------------- mtz */

/** `load_mtz_dialog` (`file_dialogs.py:152-201`), form `load_mtz.ui`. */
export function MtzDialog({
  filename,
  info,
  onRun,
  onClose,
}: {
  filename: string;
  info: MtzDialogInfo;
  onRun: (args: {
    prefix: string;
    amplitudes: string;
    phases: string;
    weights: string;
    resoMin: number;
    resoMax: number;
  }) => void;
  onClose: () => void;
}) {
  const [prefix, setPrefix] = useState(info.prefix);
  const [amplitudes, setAmplitudes] = useState(info.guessAmplitudes ?? info.amplitudes[0] ?? '');
  const [phases, setPhases] = useState(info.guessPhases ?? info.phases[0] ?? '');
  const [weights, setWeights] = useState('');
  const [resoMin, setResoMin] = useState(info.resoMin);
  const [resoMax, setResoMax] = useState(info.resoMax);

  return (
    <Modal
      title="Load Reflections (MTZ)"
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
            disabled={Boolean(info.unavailable)}
            onClick={() => onRun({ prefix, amplitudes, phases, weights, resoMin, resoMax })}
          >
            Load
          </button>
        </>
      }
    >
      <div className="fdlg__path">{filename}</div>
      <Unavailable message={info.unavailable} />
      {info.error && <div className="fdlg__error">{info.error}</div>}
      <Field label="Prefix">
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
      </Field>
      <Field label="Amplitudes">
        <select value={amplitudes} onChange={(e) => setAmplitudes(e.target.value)}>
          {info.amplitudes.map((col) => (
            <option key={col}>{col}</option>
          ))}
        </select>
      </Field>
      <Field label="Phases">
        <select value={phases} onChange={(e) => setPhases(e.target.value)}>
          {info.phases.map((col) => (
            <option key={col}>{col}</option>
          ))}
        </select>
      </Field>
      <Field label="Weights">
        <select value={weights} onChange={(e) => setWeights(e.target.value)}>
          <option value="" />
          {info.weights.map((col) => (
            <option key={col}>{col}</option>
          ))}
        </select>
      </Field>
      <Field label="Resolution min">
        <input
          type="number"
          step={0.1}
          value={resoMin}
          onChange={(e) => setResoMin(Number(e.target.value))}
        />
      </Field>
      <Field label="Resolution max">
        <input
          type="number"
          step={0.1}
          value={resoMax}
          onChange={(e) => setResoMax(Number(e.target.value))}
        />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------- aln */

export type AlnInfo = AlnDialogInfo;

/** `load_aln_dialog` (`file_dialogs.py:204-282`), form `load_aln.ui`. */
export function AlnDialog({
  filename,
  info,
  onLoad,
  onCancel,
}: {
  filename: string;
  info: AlnInfo;
  onLoad: (mapping: Record<string, string>) => void;
  /** Cancel on a FASTA asks "Load sequences as extended structures instead?". */
  onCancel: (loadAnyway: boolean) => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>(info.mapping);
  return (
    <Modal
      title="Load Alignment"
      onClose={() => onCancel(false)}
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={() => onCancel(true)}>
            Cancel (load as structures)
          </button>
          <button
            type="button"
            className="fdlg__btn fdlg__btn--go"
            onClick={() => onLoad(mapping)}
          >
            Load
          </button>
        </>
      }
    >
      <div className="fdlg__path">{filename}</div>
      <p className="fdlg__text">
        Map each alignment record onto a loaded object. Pre-filled by the same greedy
        <code> difflib.SequenceMatcher </code> argmax the Qt dialog uses.
      </p>
      {info.ids.map((id) => (
        <Field key={id} label={id}>
          <select
            value={mapping[id] ?? ''}
            onChange={(e) => setMapping({ ...mapping, [id]: e.target.value })}
          >
            <option value="" />
            {info.models.map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        </Field>
      ))}
    </Modal>
  );
}

/* --------------------------------------------------------------- partial */

/** `ask_partial` (`file_dialogs.py:80-99`), form `askpartial.ui`. */
export function PartialDialog({
  gate,
  filename,
  onChoice,
  onCancel,
}: {
  gate: PartialGate;
  filename: string;
  onChoice: (choice: 'discard' | 'partial', rename: boolean) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<'discard' | 'partial' | 'new'>('discard');
  const [rename, setRename] = useState(gate.autoRenameDuplicates);
  return (
    <Modal
      title="Load Session"
      onClose={onCancel}
      footer={
        <>
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="fdlg__btn fdlg__btn--go"
            disabled={choice === 'new'}
            onClick={() => onChoice(choice === 'partial' ? 'partial' : 'discard', rename)}
          >
            OK
          </button>
        </>
      }
    >
      <div className="fdlg__path">{filename}</div>
      <p className="fdlg__text">
        The current PyMOL window has a session in progress. How do you want to proceed?
      </p>
      <label className="fdlg__radio">
        <input
          type="radio"
          checked={choice === 'discard'}
          onChange={() => setChoice('discard')}
        />
        <span>
          Discard current session
          <small>All currently loaded objects will be deleted.</small>
        </span>
      </label>
      <label className="fdlg__radio">
        <input
          type="radio"
          checked={choice === 'partial'}
          onChange={() => setChoice('partial')}
        />
        <span>
          Merge with current session (partial load)
          <small>
            Will not restore global settings, selections, scenes or movies from the session file
          </small>
        </span>
      </label>
      {choice === 'partial' && (
        <Check
          label="Automatically rename duplicate objects"
          checked={rename}
          onChange={setRename}
          hint="setting auto_rename_duplicate_objects, written back with cmd.set(..., quiet=0)"
        />
      )}
      <label className="fdlg__radio is-disabled">
        <input type="radio" checked={choice === 'new'} onChange={() => setChoice('new')} />
        <span>
          Open in new PyMOL Window
          <small>
            No web analogue: one bridge process, one client. `new_window` spawns a second OS
            process (`_gui.py:41-53`).
          </small>
        </span>
      </label>
    </Modal>
  );
}

/* ------------------------------------------------------------ open queue */

/** A small read-out of what the multi-file open is doing, step by step. */
export function OpenProgress({ steps, index }: { steps: FileClassification[]; index: number }) {
  const items = useMemo(() => steps.map((s, i) => ({ ...s, done: i < index })), [steps, index]);
  useEffect(() => undefined, [items]);
  if (steps.length < 2) return null;
  return (
    <div className="fdlg__queue">
      {items.map((item, i) => (
        <span key={item.filename} className={`fdlg__queue-item${i === index ? ' is-now' : ''}`}>
          {baseName(item.filename)}
          {item.partial === 1 ? ' (partial)' : ''}
        </span>
      ))}
    </div>
  );
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
