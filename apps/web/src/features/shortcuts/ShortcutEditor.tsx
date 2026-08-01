/**
 * The Keyboard Shortcut Menu, ported from
 * `modules/pmg_qt/shortcut_menu_gui.py:43-415`.
 *
 * Reproduced: the 700x700 window, the live Filter, the Refresh button with its
 * exact tooltip, the three-column table (Key / Command (click to edit) /
 * Description) with only Command editable and deleted rows reading `Deleted`,
 * the five buttons (Create New / Delete Selected / Reset Selected / Reset All /
 * Save), the Create-New form with a live key-capture field that silently
 * rejects the six reserved keys, and the overwrite confirmation with its
 * "do not show this again" checkbox.
 *
 * WRITES ARE PYTHON'S. Every mutation is `cmd.set_key(key, command)`
 * (`modules/pymol/controlling.py:719-797`) — delete is `set_key(key, '')` and
 * reset is `set_key(key, default)`, exactly as `delete_selected` /
 * `reset_selected` do (`shortcut_menu_gui.py:216-273`). Validation therefore
 * stays in Python; the client's `validateShortcutName` only saves a round trip.
 *
 * READS ARE NOT. `cmd.key_mappings` and `cmd.shortcut_dict` are plain dicts and
 * the bridge dispatcher resolves CALLABLES only
 * (`bridge/tenmol_bridge/dispatch.py:276`), so there is no way to read the live
 * mapping today. The table is therefore seeded from the mirrored default table
 * (`@tenmol/viewport/input`, diffed against `shortcut_dict.py` by test) and
 * tracks this session's edits. Refresh re-seeds. That gap is real and is
 * reported rather than papered over — it needs a bridge reader for
 * `cmd.key_mappings`.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_SHORTCUTS,
  isReservedKey,
  keyEventToShortcutName,
  validateShortcutName,
} from '../mouse/tables';
import { useSession } from '../../app';
import './shortcuts.css';

interface Row {
  key: string;
  /** The default command, or '' for a user-created binding. */
  command: string;
  description: string;
  /** Non-empty when this session changed it; `Deleted` after a delete. */
  userDefined: string;
  created: boolean;
}

function seed(): Row[] {
  return DEFAULT_SHORTCUTS.map((entry) => ({
    key: entry.key,
    command: entry.command,
    description: entry.description,
    userDefined: '',
    created: false,
  }));
}

function effectiveCommand(row: Row): string {
  return row.userDefined !== '' ? row.userDefined : row.command;
}

export function ShortcutEditor({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const [rows, setRows] = useState<Row[]>(seed);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [confirm, setConfirm] = useState<{ key: string; command: string } | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(false);

  const visible = useMemo(() => {
    if (filter === '') return rows;
    let test: (value: string) => boolean;
    try {
      const re = new RegExp(filter, 'i');
      test = (value) => re.test(value);
    } catch {
      // An in-progress regex ("[" ) must narrow, not throw.
      const lower = filter.toLowerCase();
      test = (value) => value.toLowerCase().includes(lower);
    }
    return rows.filter(
      (row) => test(row.key) || test(effectiveCommand(row)) || test(row.description),
    );
  }, [rows, filter]);

  const setKey = useCallback(
    async (key: string, command: string): Promise<boolean> => {
      const problem = validateShortcutName(key);
      if (problem !== null) {
        setStatus(`${key}: ${problem}`);
        return false;
      }
      try {
        await session.act({
          fn: 'set_key',
          args: [key, command],
          echo: `cmd.set_key(${JSON.stringify(key)}, ${JSON.stringify(command)})`,
        });
        setStatus(command === '' ? `${key} unbound` : `${key} -> ${command}`);
        return true;
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [session],
  );

  const applyEdit = useCallback(
    async (key: string, command: string): Promise<void> => {
      if (!(await setKey(key, command))) return;
      setRows((previous) =>
        previous.map((row) => (row.key === key ? { ...row, userDefined: command } : row)),
      );
    },
    [setKey],
  );

  const deleteSelected = useCallback(async (): Promise<void> => {
    for (const key of selected) {
      if (!(await setKey(key, ''))) continue;
      setRows((previous) =>
        previous.flatMap((row) => {
          if (row.key !== key) return [row];
          // A created binding disappears; a default one reads "Deleted".
          return row.created ? [] : [{ ...row, userDefined: 'Deleted' }];
        }),
      );
    }
    setSelected(new Set());
  }, [selected, setKey]);

  const resetSelected = useCallback(async (): Promise<void> => {
    for (const key of selected) {
      const row = rows.find((entry) => entry.key === key);
      if (!row || row.created) {
        setStatus(`${key} has no default value.`);
        continue;
      }
      if (!(await setKey(key, row.command))) continue;
      setRows((previous) =>
        previous.map((entry) => (entry.key === key ? { ...entry, userDefined: '' } : entry)),
      );
    }
    setSelected(new Set());
  }, [selected, rows, setKey]);

  const resetAll = useCallback(async (): Promise<void> => {
    for (const row of rows) {
      if (row.created || row.userDefined === '') continue;
      await setKey(row.key, row.command);
    }
    setRows(seed());
    setSelected(new Set());
    setStatus('all key bindings restored to their defaults');
  }, [rows, setKey]);

  const save = useCallback(async (): Promise<void> => {
    /*
     * The 3-element list is not a convention, it is the file format:
     * `~/.pymol/shortcuts_save.json` IS `cmd.shortcut_dict`, and at startup
     * `save_shortcut.setkey_from_dict` replays element [2] — the user-defined
     * command — skipping entries whose [2] is falsy. Saving a flat
     * `{key: command}` would write a file that loads fine and then binds the
     * key to `command[2]`, a single character.
     */
    const payload: Record<string, [string, string, string]> = {};
    for (const row of rows) payload[row.key] = [row.command, row.description, row.userDefined];
    try {
      await session.call('save_shortcut.save_shortcuts', [payload]);
      setStatus('saved to ~/.pymol/shortcuts_save.json');
    } catch (error) {
      setStatus(
        `Save failed: ${error instanceof Error ? error.message : String(error)}. ` +
          'Bindings set this session are live in PyMOL either way; only persistence failed.',
      );
    }
  }, [rows, session]);

  const create = useCallback(
    async (key: string, command: string, confirmed: boolean): Promise<void> => {
      const existing = rows.find((row) => row.key === key);
      if (existing && !confirmed && !skipConfirm) {
        setConfirm({ key, command });
        return;
      }
      if (!(await setKey(key, command))) return;
      setRows((previous) =>
        existing
          ? previous.map((row) => (row.key === key ? { ...row, userDefined: command } : row))
          : [
              ...previous,
              { key, command: '', description: '', userDefined: command, created: true },
            ],
      );
      setCreating(false);
      setConfirm(null);
    },
    [rows, setKey, skipConfirm],
  );

  return (
    <div className="scmodal" role="dialog" aria-label="Keyboard Shortcut Menu">
      <div className="scmodal__box" data-testid="shortcut-editor">
        <div className="scmodal__head">
          <span className="scmodal__title">Keyboard Shortcut Menu</span>
          <button type="button" className="scmodal__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="scmodal__toolbar">
          <input
            className="scmodal__filter"
            placeholder="Filter"
            value={filter}
            data-testid="shortcut-filter"
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            type="button"
            title="Refresh the table to reflect any external changes"
            onClick={() => {
              setRows(seed());
              setStatus('table refreshed from the default binding table');
            }}
          >
            Refresh
          </button>
        </div>

        <div className="scmodal__tablewrap">
          <table className="scmodal__table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Command (click to edit)</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const deleted = row.userDefined === 'Deleted';
                const isSelected = selected.has(row.key);
                return (
                  <tr
                    key={row.key}
                    className={isSelected ? 'is-selected' : undefined}
                    data-testid={`shortcut-row-${row.key}`}
                    onClick={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      })
                    }
                  >
                    <td className="scmodal__key">{row.key}</td>
                    <td
                      className={row.userDefined !== '' ? 'is-user' : undefined}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditing(row.key);
                      }}
                    >
                      {editing === row.key ? (
                        <input
                          className="scmodal__edit"
                          autoFocus
                          defaultValue={deleted ? '' : effectiveCommand(row)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            setEditing(null);
                            void applyEdit(row.key, e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditing(null);
                          }}
                        />
                      ) : (
                        (deleted ? 'Deleted' : effectiveCommand(row))
                      )}
                    </td>
                    <td>{deleted ? 'Deleted' : row.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="scmodal__buttons">
          <button
            type="button"
            title="Add a key binding that does not currently appear on the table"
            onClick={() => setCreating(true)}
          >
            Create New
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            title="Unbind selected key bindings and remove any that have been created"
            onClick={() => void deleteSelected()}
          >
            Delete Selected
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            title="Restore selected key bindings to their default values"
            onClick={() => void resetSelected()}
          >
            Reset Selected
          </button>
          <button
            type="button"
            title="Restore all key bindings to their default values and remove any that have been created"
            onClick={() => void resetAll()}
          >
            Reset All
          </button>
          <button
            type="button"
            title="Save the current key bindings to be loaded automatically when opening PyMOL"
            onClick={() => void save()}
          >
            Save
          </button>
        </div>

        <div className="scmodal__status" data-testid="shortcut-status">
          {status}
        </div>

        {creating && (
          <CreateShortcut
            onCancel={() => setCreating(false)}
            onCreate={(key, command) => void create(key, command, false)}
          />
        )}

        {confirm !== null && (
          <div className="scmodal__confirm" role="alertdialog">
            <p>
              <strong>{confirm.key}</strong> is already bound. Overwrite it?
            </p>
            <label>
              <input
                type="checkbox"
                checked={skipConfirm}
                onChange={(e) => setSkipConfirm(e.target.checked)}
              />{' '}
              do not show this again
            </label>
            <div className="scmodal__buttons">
              <button
                type="button"
                onClick={() => void create(confirm.key, confirm.command, true)}
              >
                Confirm
              </button>
              <button type="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The Create-New form. `keyEdit` is a LIVE CAPTURE field: it never shows what
 * you typed, it shows PyMOL's name for the chord you pressed
 * (`shortcut_menu_gui.py:300-342`), and a reserved key is dropped in silence
 * (`:288-290`).
 */
function CreateShortcut({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (key: string, command: string) => void;
}) {
  const [key, setKey] = useState('');
  const [command, setCommand] = useState('');

  return (
    <div className="scmodal__create" data-testid="shortcut-create">
      <label className="scmodal__field">
        <span>Key</span>
        <input
          readOnly
          value={key}
          placeholder="press a key combination"
          data-testid="shortcut-capture"
          onKeyDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = keyEventToShortcutName(e.nativeEvent);
            if (name === null) return;
            if (isReservedKey(name)) return; // silently rejected, as upstream
            setKey(name);
          }}
        />
      </label>
      <label className="scmodal__field">
        <span>Command</span>
        <input
          value={command}
          data-testid="shortcut-command"
          onChange={(e) => setCommand(e.target.value)}
        />
      </label>
      <div className="scmodal__buttons">
        <button
          type="button"
          disabled={key === '' || command === ''}
          onClick={() => onCreate(key, command)}
        >
          Create
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
