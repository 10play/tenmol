/**
 * The advanced settings table — `PyMOL Advanced Settings`
 * (`modules/pmg_qt/advanced_settings_gui.py:8-99`) with the six gaps the Qt one
 * has, closed.
 *
 * The Qt dialog is a `QStandardItemModel` of 779 rows behind a
 * `QSortFilterProxyModel` regex over both columns, with bool rendered as a
 * checkbox, int/str as `str(value)` and float/float3/color as `cmd.get(index)`
 * text; edits call `cmd.set(index, value, log=1, quiet=0)` and exceptions are
 * swallowed (`:70-77`). What it does NOT have, and this does:
 *
 *   level      `_cmd.get_setting_level` — never wrapped in `pymol.setting`
 *   default    parsed from `layer1/SettingInfo.h` and validated against the
 *              live table; absent (and SAID to be absent) when unavailable
 *   reset      `cmd.unset`, which restores the DEFAULT since PyMOL 2.5
 *   scope      per-object / per-state reads, gated by the setting's level so a
 *              scope that would silently no-op is disabled, not offered
 *   live       every row re-reads itself from the update tap
 *   errors     a rejected or clamped write is shown, not swallowed
 *
 * Rows are windowed (only the visible slice is in the DOM) because 779 rows of
 * inputs is enough to make a filter keystroke visibly slow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SettingMeta, SettingScope, SettingValue } from '@tenmol/protocol';
import {
  canWriteAt,
  filterSettings,
  formatSettingValue,
  isDefaultValue,
  rangeHint,
  scopesForLevel,
  valueKey,
  type SettingEntry,
  type SettingsSource,
  type SettingsStore,
} from '@tenmol/stores/settings';
import { useStore } from '../../app';

const ROW_HEIGHT = 22;
const OVERSCAN = 8;

export interface ScopeSelection {
  scope: SettingScope;
  object: string;
  state: number;
  /** Atom-selection expression; only `atom` and `bond` scopes use it. */
  selection: string;
}

/**
 * The scopes this table offers. `atom-state` and `bond-state` are deliberately
 * absent: `cmd.set` cannot address them at all (only `alter_state`'s `s[...]`
 * can, `layer1/P.cpp:455-606`), so offering them would be offering a no-op.
 */
const OFFERED_SCOPES: readonly SettingScope[] = [
  'global',
  'object',
  'object-state',
  'atom',
  'bond',
];

/** `atom` and `bond` are addressed by a selection, not by an object name. */
function isSelectionScope(scope: SettingScope): boolean {
  return scope === 'atom' || scope === 'bond';
}

export function AdvancedSettingsTable({
  store,
  source,
  objects,
}: {
  store: SettingsStore;
  source: SettingsSource;
  /** Object names for the scope selector (from the object panel's poll). */
  objects: readonly string[];
}) {
  const catalogue = useStore(store, (s) => s.catalogue);
  const entries = useStore(store, (s) => s.entries);
  const rejected = useStore(store, (s) => s.rejected);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeSelection>({
    scope: 'global',
    object: '',
    state: 0,
    selection: '',
  });
  const [overridesTick, bumpOverrides] = useState(0);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(420);
  const viewport = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => filterSettings(catalogue?.settings ?? [], query),
    [catalogue, query],
  );

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight || 420);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Reading a whole scope at once: one round trip for every visible setting.
  useEffect(() => {
    if (scope.scope === 'global' || isSelectionScope(scope.scope) || !scope.object) return;
    void source.refresh(
      (catalogue?.settings ?? []).map((meta) => meta.index),
      scope.object,
      scope.scope === 'object-state' ? scope.state : 0,
    );
  }, [source, catalogue, scope]);

  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const visible = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2;
  const slice = rows.slice(first, first + visible);

  const readObject = scope.scope === 'global' ? '' : scope.object;
  const readState = scope.scope === 'object-state' ? scope.state : 0;

  const entryFor = useCallback(
    (meta: SettingMeta): SettingEntry | undefined =>
      entries[valueKey(meta.index, readObject, readState)] ??
      (readObject ? entries[valueKey(meta.index, '', 0)] : undefined),
    [entries, readObject, readState],
  );

  return (
    <div className="setadv">
      <div className="setadv__bar">
        <label className="setadv__filter">
          Filter
          <input
            type="text"
            value={query}
            spellCheck={false}
            placeholder="regex or substring"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <ScopeSelector value={scope} onChange={setScope} objects={objects} />
        <span className="setadv__count">
          {rows.length} / {catalogue?.count ?? 0}
        </span>
      </div>

      <div className="setadv__head">
        <span className="setadv__c-name">Name</span>
        <span className="setadv__c-value">Value</span>
        <span className="setadv__c-level">Level</span>
        <span className="setadv__c-default">Default</span>
        <span className="setadv__c-reset" />
      </div>

      <div
        className="setadv__body"
        ref={viewport}
        onScroll={(e) => setTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
            {slice.map((meta) => (
              <Row
                key={meta.index}
                meta={meta}
                entry={entryFor(meta)}
                scope={scope}
                source={source}
                store={store}
                error={rejected[meta.index]}
                onWrote={() => bumpOverrides((n) => n + 1)}
              />
            ))}
          </div>
        </div>
      </div>

      {isSelectionScope(scope.scope) && (
        <OverridesView source={source} scope={scope} tick={overridesTick} store={store} />
      )}

      <div className="setadv__foot">
        {catalogue?.meta.defaultsSource ? (
          <span>
            defaults + ranges: {catalogue.meta.defaultsSource} · {catalogue.meta.minMaxNote}
          </span>
        ) : (
          <span className="setadv__warn">
            defaults and ranges unavailable — {catalogue?.meta.defaultsNote}
          </span>
        )}
      </div>
    </div>
  );
}

function ScopeSelector({
  value,
  onChange,
  objects,
}: {
  value: ScopeSelection;
  onChange: (next: ScopeSelection) => void;
  objects: readonly string[];
}) {
  return (
    <span className="setadv__scope">
      <label>
        Scope
        <select
          value={value.scope}
          onChange={(e) => onChange({ ...value, scope: e.target.value as SettingScope })}
        >
          {OFFERED_SCOPES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {value.scope !== 'global' && !isSelectionScope(value.scope) && (
        <label>
          Object
          <select value={value.object} onChange={(e) => onChange({ ...value, object: e.target.value })}>
            <option value="">(pick)</option>
            {objects.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {isSelectionScope(value.scope) && (
        <label>
          Selection
          <input
            type="text"
            spellCheck={false}
            className="setadv__sel"
            placeholder={value.scope === 'bond' ? 'e.g. */n+c+ca+o' : 'e.g. elem C'}
            value={value.selection}
            onChange={(e) => onChange({ ...value, selection: e.target.value })}
          />
        </label>
      )}
      {value.scope === 'object-state' && (
        <label>
          State
          <input
            type="number"
            min={1}
            value={value.state || 1}
            onChange={(e) => onChange({ ...value, state: Number(e.target.value) || 1 })}
          />
        </label>
      )}
    </span>
  );
}

function Row({
  meta,
  entry,
  scope,
  source,
  store,
  error,
  onWrote,
}: {
  meta: SettingMeta;
  entry: SettingEntry | undefined;
  scope: ScopeSelection;
  source: SettingsSource;
  store: SettingsStore;
  error: string | undefined;
  onWrote: () => void;
}) {
  const selectionScope = isSelectionScope(scope.scope);
  const writable = canWriteAt(meta, scope.scope);
  const object = selectionScope || scope.scope === 'global' ? '' : scope.object;
  const state = scope.scope === 'object-state' ? scope.state : 0;
  const hint = rangeHint(meta, scope.scope);
  const noTarget = selectionScope ? scope.selection.trim() === '' : scope.scope !== 'global' && !object;

  const fail = (e: unknown) =>
    store.noteRejected(meta.index, e instanceof Error ? e.message : String(e));

  const commit = (raw: unknown) => {
    // A BOND-level write must go through `cmd.set_bond`. `cmd.set` with a
    // selection "will appear to take, but no change will be observed"
    // (`modules/pymol/setting.py:245-248`) — the exact silent failure this
    // table exists to stop.
    const done =
      scope.scope === 'bond'
        ? source.setBond(meta, raw, scope.selection)
        : source.write(meta, raw, {
            object,
            state,
            ...(scope.scope === 'atom' ? { selection: scope.selection } : {}),
          });
    void done.then(onWrote).catch(fail);
  };

  const reset = () => {
    const done =
      scope.scope === 'bond'
        ? source.unsetBond(meta, scope.selection)
        : source.reset(meta, {
            object: scope.scope === 'atom' ? scope.selection : object,
            state,
          });
    void done.then(onWrote).catch(fail);
  };

  return (
    <div
      className={`setadv__row${writable ? '' : ' is-locked'}`}
      style={{ height: ROW_HEIGHT }}
      data-index={meta.index}
      data-name={meta.name}
      title={meta.help ?? `${meta.name} (index ${meta.index}, ${meta.level})`}
    >
      <span className="setadv__c-name">{meta.name}</span>
      <span className="setadv__c-value">
        <ValueEditor
          meta={meta}
          entry={entry}
          disabled={!writable || noTarget}
          /* A per-atom / per-bond value has no bulk read API, so the cell is a
             write field and the Overrides strip below reports what landed. */
          writeOnly={selectionScope}
          onCommit={commit}
        />
      </span>
      <span className="setadv__c-level" title={`writable at: ${scopesForLevel(meta.level).join(', ')}`}>
        {meta.level}
      </span>
      <span className="setadv__c-default">
        {meta.default === undefined ? '—' : String(meta.default)}
        {hint ? <em className="setadv__hint"> {hint}</em> : null}
      </span>
      <span className="setadv__c-reset">
        <button
          type="button"
          title={
            scope.scope === 'bond'
              ? 'cmd.unset_bond — removes the per-bond override'
              : 'cmd.unset — restores the DEFAULT (PyMOL 2.5+)'
          }
          disabled={!writable || noTarget || (!selectionScope && isDefaultValue(meta, entry?.value))}
          onClick={reset}
        >
          ⟲
        </button>
      </span>
      {error ? <span className="setadv__error">{error}</span> : null}
    </div>
  );
}

/**
 * What a selection actually carries, read back after every write.
 *
 * `cmd.get_object_settings` gives the object's own CSetting, `iter(s)` inside
 * `cmd.iterate` gives the indices genuinely defined on each atom
 * (`SettingUniqueGetIndicesAsPyList`, `layer1/P.cpp:455-606`) and `cmd.get_bond`
 * gives per-bond values. None of the three is a cascading read, so this strip is
 * the only place that answers "did that write land, and where?".
 */
function OverridesView({
  source,
  scope,
  tick,
  store,
}: {
  source: SettingsSource;
  scope: ScopeSelection;
  tick: number;
  store: SettingsStore;
}) {
  const catalogue = useStore(store, (s) => s.catalogue);
  const [text, setText] = useState('');

  const byIndex = useMemo(() => {
    const map = new Map<number, SettingMeta>();
    for (const meta of catalogue?.settings ?? []) map.set(meta.index, meta);
    return map;
  }, [catalogue]);

  /**
   * `cmd.get_bond` hands back the RAW C value, and PyMOL stores floats as
   * float32: writing 0.7 reads back 0.699999988079071. Rendering that verbatim
   * looks like a bug, so the same `%1.5f` `SettingGetTextPtr` uses
   * (`layer1/Setting.cpp:1183-1237`) is applied here.
   */
  const render = useCallback(
    (index: number, value: SettingValue): string => {
      const meta = byIndex.get(index);
      return meta ? formatSettingValue(meta.kind, value) : String(value);
    },
    [byIndex],
  );

  useEffect(() => {
    const selection = scope.selection.trim();
    if (!selection) {
      setText('');
      return;
    }
    let live = true;
    void (async () => {
      try {
        if (scope.scope === 'bond') {
          const reply = await source.getBonds(selection);
          if (!live) return;
          setText(
            reply.bonds.length === 0
              ? `no per-bond overrides on ${selection}`
              : reply.bonds
                  .slice(0, 8)
                  .map(
                    (b) =>
                      `${byIndex.get(b.index)?.name ?? b.index}=${render(b.index, b.value)} on ` +
                      `${b.model}\`${b.atoms[0]}-${b.atoms[1]}`,
                  )
                  .join(' · ') + (reply.bonds.length > 8 ? ` … ${reply.bonds.length} bonds` : ''),
          );
        } else {
          const reply = await source.scope('', selection);
          if (!live) return;
          const total = reply.atoms.reduce((n, a) => n + a.settings.length, 0);
          setText(
            total === 0
              ? `no per-atom overrides on ${selection}`
              : `${reply.atoms.length} atoms carry ${total} overrides: ` +
                [...new Set(reply.atoms.flatMap((a) => a.settings))]
                  .map((i) => byIndex.get(i)?.name ?? i)
                  .join(', '),
          );
        }
      } catch (e) {
        if (live) setText(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => {
      live = false;
    };
  }, [source, scope.scope, scope.selection, tick, byIndex, render]);

  return (
    <div className="setadv__overrides" data-scope={scope.scope}>
      {text || `type a selection to read its ${scope.scope}-level overrides`}
    </div>
  );
}

function ValueEditor({
  meta,
  entry,
  disabled,
  writeOnly = false,
  onCommit,
}: {
  meta: SettingMeta;
  entry: SettingEntry | undefined;
  disabled: boolean;
  /** Per-atom / per-bond: no bulk read exists, so show nothing, not a lie. */
  writeOnly?: boolean;
  onCommit: (raw: unknown) => void;
}) {
  const shown = writeOnly ? '' : displayValue(meta, entry);
  const [draft, setDraft] = useState<string | null>(null);

  if (meta.kind === 'boolean' && !writeOnly) {
    return (
      <input
        type="checkbox"
        aria-label={meta.name}
        disabled={disabled}
        checked={Number(entry?.value ?? 0) !== 0}
        onChange={(e) => onCommit(e.target.checked ? 1 : 0)}
      />
    );
  }

  return (
    <input
      type="text"
      aria-label={meta.name}
      spellCheck={false}
      disabled={disabled}
      placeholder={writeOnly ? 'value to write' : undefined}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== shown) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/**
 * What the cell shows. The Qt table shows `str(value)` for int/str and
 * `cmd.get(index)` TEXT for float, float3 and color
 * (`advanced_settings_gui.py:63-64`) — because the text form is the only place
 * a colour index becomes a colour NAME and a float3 becomes `[ x, y, z ]`.
 */
export function displayValue(meta: SettingMeta, entry: SettingEntry | undefined): string {
  if (!entry) return '';
  if (meta.kind === 'int' || meta.kind === 'string') return String(entry.value);
  return entry.text || String(entry.value as SettingValue);
}
