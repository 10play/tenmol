/**
 * Advanced Settings — `packages/engine/modules/pmg_qt/advanced_settings_gui.py:13-99`.
 *
 * A filterable two-column table of every PyMOL setting, headers hidden, name
 * column read-only, booleans as checkboxes and everything else as text from
 * `cmd.get(index)`. Editing calls `cmd.set(index, value, log=1, quiet=0)`.
 *
 * Upstream has **no validation, no error handling and no refresh** — a value
 * changed from the command line goes stale in the table and stays stale. Two of
 * those are bugs worth not cloning, so this table adds an explicit `Refresh`
 * button and shows the error a rejected `cmd.set` returns; the *behaviour* of
 * the edit itself (log=1, quiet=0, string passed straight through) is upstream's
 * exactly.
 *
 * THE ROW COUNT IS THE DESIGN CONSTRAINT. `setting.get_name_list()` answers
 * ~1000 names, and the type and value of each need their own `cmd` call — Qt
 * pays that cost once at construction on a local in-process API, which over a
 * WebSocket would be ~2000 round trips. So: names are fetched once, and type +
 * value are fetched for the rows the viewport is actually showing. A filter
 * narrows the fetch set to what the user asked for.
 *
 * `cmd.get_setting_tuple` and `cmd.get`/`cmd.set` all accept a setting NAME as
 * well as an index (verified against the running bridge), so the private
 * `setting._get_index` — which the policy refuses, correctly, as a private
 * interior segment — is not needed at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SETTING_TYPE, type SettingTypeValue } from '@tenmol/protocol/topics/dialogs';
import { useSession } from '../../app';
import { Button, TextInput, Checkbox } from '../../ui';
import { DialogWindow } from './DialogWindow';
import type { DialogWindowSpec } from './store';
import './dialogs.css';

const ROW_HEIGHT = 22;
const OVERSCAN = 8;

interface Loaded {
  type: SettingTypeValue;
  value: string;
}

export function AdvancedSettings({ spec }: { spec: DialogWindowSpec }) {
  const session = useSession();
  const [names, setNames] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [error, setError] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    void session
      .call<string[]>('setting.get_name_list')
      .then((list) => setNames(Array.isArray(list) ? list : []))
      .catch((e: unknown) => setError(messageOf(e)));
  }, [session]);

  /** Case-insensitive substring across the name column (Qt uses a regex filter). */
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return names;
    return names.filter((n) => n.toLowerCase().includes(needle));
  }, [names, filter]);

  const viewportHeight = spec.height;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(first, last);

  const fetchRow = useCallback(
    async (name: string) => {
      if (inflight.current.has(name)) return;
      inflight.current.add(name);
      try {
        const [tuple, value] = await Promise.all([
          session.call<[number, unknown[]]>('get_setting_tuple', [name]),
          session.call<string>('get', [name]),
        ]);
        const type = (Array.isArray(tuple) ? tuple[0] : SETTING_TYPE.String) as SettingTypeValue;
        setLoaded((prev) => ({ ...prev, [name]: { type, value: String(value ?? '') } }));
      } catch (e: unknown) {
        setLoaded((prev) => ({
          ...prev,
          [name]: { type: SETTING_TYPE.String, value: `<${messageOf(e)}>` },
        }));
      } finally {
        inflight.current.delete(name);
      }
    },
    [session],
  );

  useEffect(() => {
    for (const name of visible) {
      if (!(name in loaded)) void fetchRow(name);
    }
  }, [visible, loaded, fetchRow]);

  const applyEdit = useCallback(
    async (name: string, value: string) => {
      setError('');
      try {
        // advanced_settings_gui.py:93 — `cmd.set(index, value, log=1, quiet=0)`.
        await session.call('set', [name, value], { log: 1, quiet: 0 });
      } catch (e: unknown) {
        setError(`${name}: ${messageOf(e)}`);
      }
      // Read back rather than trust the write: `SettingGenerateSideEffects` can
      // coerce or refuse a value without raising.
      setLoaded((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    },
    [session],
  );

  return (
    <DialogWindow spec={spec}>
      <div className="advset" style={{ height: spec.height }}>
        <div className="advset__head">
          <TextInput
            className="advset__filter"
            data-advset-filter=""
            placeholder="filter settings…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button
            data-advset-refresh=""
            onClick={() => {
              setLoaded({});
              setError('');
            }}
          >
            Refresh
          </Button>
          <span className="advset__note" data-advset-count={rows.length}>
            {rows.length} / {names.length}
          </span>
        </div>

        {error && <div className="advset__error">{error}</div>}

        <div
          className="advset__scroll"
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div className="advset__rows" style={{ height: rows.length * ROW_HEIGHT }}>
            {visible.map((name, i) => {
              const row = loaded[name];
              const top = (first + i) * ROW_HEIGHT;
              return (
                <div
                  className="advset__row"
                  key={name}
                  style={{ top, height: ROW_HEIGHT }}
                  data-advset-row={name}
                >
                  <span className="advset__name" title={name}>
                    {name}
                  </span>
                  {!row ? (
                    <span className="advset__note">…</span>
                  ) : row.type === SETTING_TYPE.Boolean ? (
                    <Checkbox
                      data-advset-value={name}
                      checked={row.value !== '0' && row.value !== 'off' && row.value !== ''}
                      onChange={(e) => void applyEdit(name, e.target.checked ? '1' : '0')}
                    />
                  ) : (
                    <TextInput
                      className="advset__value"
                      data-advset-value={name}
                      defaultValue={row.value}
                      key={row.value}
                      onBlur={(e) => {
                        if (e.target.value !== row.value) void applyEdit(name, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </DialogWindow>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
