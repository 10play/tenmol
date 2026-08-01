/**
 * The server-side path browser — the component every other dialog in this area
 * opens instead of a native file dialog.
 *
 * A browser cannot show `QFileDialog`, and it must not: PyMOL loads and saves
 * **server** paths (`cmd.load` -> `exp_path`, `modules/pymol/importing.py:751`;
 * `cmd.save`, `exporting.py:836-838`), and this is a local desktop app with
 * full filesystem access. So the listing comes from the bridge
 * (`cmd.tenmol_files.browse`) and this renders it.
 *
 * Behaviour taken from the Qt dialogs it replaces:
 *   * it opens at `initialdir` (`pymol_qt_gui.py:496-506`) and writes back
 *     `os.path.dirname(chosen)` on accept;
 *   * `mode='open'` is multi-select (`file_open`, `pymol_qt_gui.py:643-649`);
 *   * `mode='save'` applies `getSaveFileNameWithExt` (`pymol/Qt/utils.py:229-246`)
 *     — a basename with no dot gains the first extension of the selected
 *     filter — and warns before overwriting;
 *   * the filter dropdown carries the exact Qt filter strings, and selecting
 *     one filters the listing by its globs;
 *   * `mode='dir'` is `QFileDialog.getExistingDirectory` (`:870-873`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterPatterns, humanSize, withExtension } from '@tenmol/protocol/topics/files';
import type { FsEntry, FsListing, FsPlace } from '@tenmol/protocol/topics/files';
import type { FilesApi } from './filesApi';

export type PickerMode = 'open' | 'save' | 'dir';

export interface PickerRequest {
  mode: PickerMode;
  title: string;
  /** Qt filter strings, e.g. `PDB (*.pdb *.pdb.gz)`. */
  filters?: string[] | undefined;
  /** Prefilled basename for `save`. */
  initialName?: string | undefined;
  /** Start directory; defaults to the sticky `initialdir`. */
  directory?: string | undefined;
  /** Label of the accept button. */
  accept?: string | undefined;
}

export interface PickerResult {
  paths: string[];
  filter: string;
  /** True when the user chose a filter whose label starts with "Python". */
  filterLabel: string;
}

interface Props {
  api: FilesApi;
  request: PickerRequest;
  onCancel: () => void;
  onAccept: (result: PickerResult) => void;
}

export function PathPicker({ api, request, onCancel, onAccept }: Props) {
  const filters = request.filters?.length ? request.filters : ['All Files (*)'];
  const [filter, setFilter] = useState(filters[0] ?? 'All Files (*)');
  const [listing, setListing] = useState<FsListing | null>(null);
  const [places, setPlaces] = useState<FsPlace[]>([]);
  const [dir, setDir] = useState<string | null>(request.directory ?? null);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState(request.initialName ?? '');
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The save target the user has been warned about; a second press accepts. */
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const patterns = useMemo(() => filterPatterns(filter), [filter]);

  const load = useCallback(
    async (target: string | null) => {
      setBusy(true);
      try {
        const next = await api.browse(target ?? '', {
          showHidden,
          dirsOnly: request.mode === 'dir',
          patterns,
        });
        setListing(next);
        setDir(next.path);
        setSelected([]);
        setError(next.error);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [api, showHidden, patterns, request.mode],
  );

  // `dir` is deliberately read through a ref rather than listed as a dependency:
  // navigation calls `load` directly, so re-running on every `setDir` would
  // double every listing. This effect exists only to re-list when the listing
  // PARAMETERS (`showHidden`, `patterns`, `mode`) change.
  const dirRef = useRef<string | null>(dir);
  dirRef.current = dir;
  useEffect(() => {
    void load(dirRef.current);
  }, [load]);

  useEffect(() => {
    api
      .places()
      .then(setPlaces)
      .catch(() => undefined);
  }, [api]);

  const entries = listing?.entries ?? [];
  const dirs = entries.filter((e) => e.isDir);
  const files = entries.filter((e) => !e.isDir);

  const accept = async () => {
    if (request.mode === 'dir') {
      onAccept({ paths: [dir ?? ''], filter, filterLabel: filter });
      return;
    }
    if (request.mode === 'save') {
      const typed = name.trim();
      if (!typed) {
        setError('enter a file name');
        nameRef.current?.focus();
        return;
      }
      const full = withExtension(joinPath(dir ?? '', typed), filter);
      // `QFileDialog.getSaveFileName` confirms an overwrite by default; the
      // web picker has to ask explicitly, so the second press is the confirm.
      if (confirmPath !== full) {
        const info = await api.stat(full).catch(() => null);
        if (info?.exists) {
          setConfirmPath(full);
          setError(`${full} exists — press ${request.accept ?? 'Save'} again to overwrite`);
          return;
        }
      }
      onAccept({ paths: [full], filter, filterLabel: filter });
      return;
    }
    if (selected.length === 0) {
      setError('select at least one file');
      return;
    }
    onAccept({ paths: selected, filter, filterLabel: filter });
  };

  const onRowClick = (entry: FsEntry, event: React.MouseEvent) => {
    if (entry.isDir) return;
    if (request.mode === 'save') {
      setName(entry.name);
      return;
    }
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      setSelected((prev) =>
        prev.includes(entry.path) ? prev.filter((p) => p !== entry.path) : [...prev, entry.path],
      );
    } else {
      setSelected([entry.path]);
    }
  };

  return (
    // `--top`: two dialogs of area 6 stay mounted while they open the picker
    // (the Draw/Ray panel's "Save Image to File" and the fetch dialog's
    // fetch_path browse). Both render AFTER the picker in `FilesPanel`, so with
    // equal z-index their backdrop would swallow every click meant for it.
    <div
      className="fdlg__backdrop fdlg__backdrop--top"
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
    >
      <div className="fdlg fdlg--picker">
        <div className="fdlg__title">
          {request.title}
          <button type="button" className="fdlg__x" onClick={onCancel} title="Cancel">
            ×
          </button>
        </div>

        <div className="fpick__crumbs">
          {breadcrumbs(dir ?? '').map((crumb) => (
            <button
              key={crumb.path}
              type="button"
              className="fpick__crumb"
              onClick={() => void load(crumb.path)}
            >
              {crumb.label}
            </button>
          ))}
          <span className="fpick__spacer" />
          {/* `QFileDialog` lets you type a path into its filename field; this
              is that affordance, and it is also what makes `~` and `$VAR`
              usable, because the bridge runs the text through `cmd.exp_path`
              (`modules/pymol/cmd.py:112`) before listing. */}
          <input
            className="fpick__goto"
            data-testid="fpick-goto"
            placeholder="go to path…"
            defaultValue=""
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const typed = event.currentTarget.value.trim();
              if (!typed) return;
              void load(typed);
            }}
          />
          <button
            type="button"
            className={`fpick__toggle${showHidden ? ' is-on' : ''}`}
            title="show dotfiles"
            onClick={() => setShowHidden((v) => !v)}
          >
            .hidden
          </button>
          <button
            type="button"
            className="fpick__toggle"
            title="create a directory here"
            onClick={() => {
              const folder = window.prompt('New directory name');
              if (!folder) return;
              void api.mkdir(joinPath(dir ?? '', folder)).then(() => load(dir));
            }}
          >
            new folder
          </button>
        </div>

        <div className="fpick__body">
          <div className="fpick__places">
            {places.map((place) => (
              <button
                key={place.path + place.label}
                type="button"
                className="fpick__place"
                title={place.path}
                onClick={() => void load(place.path)}
              >
                {place.label}
              </button>
            ))}
          </div>

          <div className="fpick__list">
            {busy && <div className="fpick__note">reading…</div>}
            {listing?.parent && (
              <button
                type="button"
                className="fpick__row fpick__row--dir"
                onDoubleClick={() => void load(listing.parent)}
                onClick={() => void load(listing.parent)}
              >
                <span className="fpick__icon">↑</span>
                <span className="fpick__name">..</span>
              </button>
            )}
            {dirs.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="fpick__row fpick__row--dir"
                onClick={() => void load(entry.path)}
              >
                <span className="fpick__icon">▸</span>
                <span className="fpick__name">{entry.name}</span>
              </button>
            ))}
            {request.mode !== 'dir' &&
              files.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={`fpick__row${selected.includes(entry.path) ? ' is-selected' : ''}`}
                  onClick={(event) => onRowClick(entry, event)}
                  onDoubleClick={() => onAccept({ paths: [entry.path], filter, filterLabel: filter })}
                >
                  <span className="fpick__icon" />
                  <span className="fpick__name">{entry.name}</span>
                  <span className="fpick__size">{humanSize(entry.size)}</span>
                </button>
              ))}
            {listing?.truncated && (
              <div className="fpick__note">listing truncated at 4000 entries</div>
            )}
            {!busy && entries.length === 0 && <div className="fpick__note">empty</div>}
          </div>
        </div>

        {error && <div className="fdlg__error">{error}</div>}

        <div className="fdlg__foot">
          {request.mode === 'save' && (
            <input
              ref={nameRef}
              className="fdlg__input fpick__nameinput"
              value={name}
              placeholder="file name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void accept();
              }}
            />
          )}
          {request.mode !== 'dir' && (
            <select
              className="fdlg__select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              title="Qt filter strings, reproduced exactly"
            >
              {filters.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
          <span className="fdlg__spacer" />
          <button type="button" className="fdlg__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="fdlg__btn fdlg__btn--go"
            data-testid="fpick-accept"
            onClick={() => void accept()}
          >
            {request.accept ?? (request.mode === 'save' ? 'Save' : 'Open')}
          </button>
        </div>

        {request.mode === 'save' && name && (
          <div className="fdlg__hint">
            → {withExtension(joinPath(dir ?? '', name.trim()), filter)}
          </div>
        )}
      </div>
    </div>
  );
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  if (name.startsWith('/')) return name;
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}

export function breadcrumbs(path: string): { label: string; path: string }[] {
  if (!path) return [];
  const parts = path.split('/').filter(Boolean);
  const out = [{ label: '/', path: '/' }];
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    out.push({ label: part, path: current });
  }
  return out;
}
