/**
 * The advanced settings table — `PyMOL Advanced Settings`
 * (`packages/engine/modules/pmg_qt/advanced_settings_gui.py:8-99`) with the six gaps the Qt one
 * has, closed.
 *
 * The Qt dialog is a `QStandardItemModel` of 779 rows behind a
 * `QSortFilterProxyModel` regex over both columns, with bool rendered as a
 * checkbox, int/str as `str(value)` and float/float3/color as `cmd.get(index)`
 * text; edits call `cmd.set(index, value, log=1, quiet=0)` and exceptions are
 * swallowed (`:70-77`). What it does NOT have, and this does:
 *
 *   level      `_cmd.get_setting_level` — never wrapped in `pymol.setting`
 *   default    parsed from `packages/engine/layer1/SettingInfo.h` and validated against the
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
import { Button, Checkbox, Select, TextInput } from '../../ui';
import {
  atomSettingDelete,
  atomSettingWrite,
  describeAtomWriteResult,
  type AtomSettingWrite,
} from './atomSettings';
import { REINITIALIZE_MENU, isSessionBlacklisted } from './sessionLifecycle';

const ROW_HEIGHT = 22;
const OVERSCAN = 8;

/** The scope, object, state and selection a settings write is addressed to. */
export interface ScopeSelection {
  scope: SettingScope;
  object: string;
  state: number;
  /** Atom-selection expression; only `atom` and `bond` scopes use it. */
  selection: string;
}

/**
 * The scopes this table offers.
 *
 * `atom-state` is here even though `cmd.set` cannot address it: the write goes
 * through `cmd.alter_state`'s `s[...]` instead (`features/settings/atomSettings.ts`,
 * `packages/engine/layer1/P.cpp:455-606`), which is the escape hatch `setting.py:519-526`
 * documents and the only path to the 17 atom-state settings.
 *
 * `bond-state` is still absent, and stays absent: no PyMOL API reaches it —
 * there is no `alter_bond`, and `set_bond` writes the bond level.
 */
const OFFERED_SCOPES: readonly SettingScope[] = [
  'global',
  'object',
  'object-state',
  'atom',
  'atom-state',
  'bond',
];

/** `atom`, `atom-state` and `bond` are addressed by a selection, not an object. */
function isSelectionScope(scope: SettingScope): boolean {
  return scope === 'atom' || scope === 'atom-state' || scope === 'bond';
}

/** The one raw call the atom-state path needs; `cmd.alter_state` is not on `SettingsSource`. */
export type RawCall = (fn: string, args: readonly unknown[]) => Promise<unknown>;

/** Virtualised table of every PyMOL setting, editable across scopes. */
export function AdvancedSettingsTable({
  store,
  source,
  objects,
  call,
}: {
  store: SettingsStore;
  source: SettingsSource;
  /** Object names for the scope selector (from the object panel's poll). */
  objects: readonly string[];
  /**
   * `session.call`. Only the `atom-state` scope uses it, because `alter_state`
   * is not a settings API and has no business on `SettingsSource`.
   */
  call?: RawCall;
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
  const [note, setNote] = useState('');
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(420);
  const viewport = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => filterSettings(catalogue?.settings ?? [], query), [catalogue, query]);

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
          <TextInput
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
                call={call}
                error={rejected[meta.index]}
                onWrote={() => bumpOverrides((n) => n + 1)}
                onNote={setNote}
              />
            ))}
          </div>
        </div>
      </div>

      {scope.scope === 'atom-state' ? (
        <AtomStateStrip note={note} scope={scope} />
      ) : isSelectionScope(scope.scope) ? (
        <OverridesView source={source} scope={scope} tick={overridesTick} store={store} />
      ) : null}

      <ReinitializeStrip call={call} source={source} onDone={() => bumpOverrides((n) => n + 1)} />

      <div className="setadv__foot">
        {catalogue?.meta.defaultsSource ? (
          <span>
            defaults + ranges: {catalogue.meta.defaultsSource} · {catalogue.meta.minMaxNote}
          </span>
        ) : (
          <span className="setadv__warn modern:text-danger">
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
        <Select
          value={value.scope}
          onChange={(e) => onChange({ ...value, scope: e.target.value as SettingScope })}
        >
          {OFFERED_SCOPES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </label>
      {value.scope !== 'global' && !isSelectionScope(value.scope) && (
        <label>
          Object
          <Select
            value={value.object}
            onChange={(e) => onChange({ ...value, object: e.target.value })}
          >
            <option value="">(pick)</option>
            {objects.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {isSelectionScope(value.scope) && (
        <label>
          Selection
          <TextInput
            type="text"
            spellCheck={false}
            className="setadv__sel"
            placeholder={value.scope === 'bond' ? 'e.g. */n+c+ca+o' : 'e.g. elem C'}
            value={value.selection}
            onChange={(e) => onChange({ ...value, selection: e.target.value })}
          />
        </label>
      )}
      {(value.scope === 'object-state' || value.scope === 'atom-state') && (
        <label>
          State
          <TextInput
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
  call,
  error,
  onWrote,
  onNote,
}: {
  meta: SettingMeta;
  entry: SettingEntry | undefined;
  scope: ScopeSelection;
  source: SettingsSource;
  store: SettingsStore;
  call: RawCall | undefined;
  error: string | undefined;
  onWrote: () => void;
  onNote: (text: string) => void;
}) {
  const selectionScope = isSelectionScope(scope.scope);
  const writable = canWriteAt(meta, scope.scope);
  const object = selectionScope || scope.scope === 'global' ? '' : scope.object;
  const state = scope.scope === 'object-state' ? scope.state : 0;
  const hint = rangeHint(meta, scope.scope);
  const noTarget = selectionScope
    ? scope.selection.trim() === ''
    : scope.scope !== 'global' && !object;

  const fail = (e: unknown) =>
    store.noteRejected(meta.index, e instanceof Error ? e.message : String(e));

  /**
   * `cmd.alter_state` — the only path to an atom-state setting. The literal is
   * built from the typed value (`atomSettings.ts`); the user never supplies a
   * Python fragment, because this verb evaluates whatever it is given per atom.
   */
  const runAtomState = (write: AtomSettingWrite) => {
    if (!call) {
      fail(new Error('atom-state writes need a session; none was passed to this table'));
      return;
    }
    onNote(`${write.echo} …`);
    void call(write.fn, write.args)
      .then((result) => {
        onNote(`${write.echo} → ${describeAtomWriteResult(write, result)}`);
        onWrote();
      })
      .catch(fail);
  };

  const commit = (raw: unknown) => {
    if (scope.scope === 'atom-state') {
      try {
        runAtomState(atomSettingWrite(meta, raw, 'atom-state', scope));
      } catch (e) {
        fail(e);
      }
      return;
    }
    // A BOND-level write must go through `cmd.set_bond`. `cmd.set` with a
    // selection "will appear to take, but no change will be observed"
    // (`packages/engine/modules/pymol/setting.py:245-248`) — the exact silent failure this
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
    if (scope.scope === 'atom-state') {
      runAtomState(atomSettingDelete(meta, 'atom-state', scope));
      return;
    }
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
      className={`setadv__row modern:border-line${writable ? '' : ' is-locked'}`}
      style={{ height: ROW_HEIGHT }}
      data-index={meta.index}
      data-name={meta.name}
      title={meta.help ?? `${meta.name} (index ${meta.index}, ${meta.level})`}
    >
      <span className="setadv__c-name">
        {meta.name}
        {isSessionBlacklisted(meta) && (
          <em
            className="setadv__nopse modern:text-pm-text-dim"
            title={
              meta.level === 'unused'
                ? 'unused level — never written to a .pse (Setting.cpp:628-631)'
                : 'system-dependent — never written to a .pse (Setting.cpp:634-683)'
            }
          >
            ¬pse
          </em>
        )}
      </span>
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
      <span
        className="setadv__c-level"
        title={`writable at: ${scopesForLevel(meta.level).join(', ')}`}
      >
        {meta.level}
      </span>
      <span className="setadv__c-default">
        {meta.default === undefined ? '—' : String(meta.default)}
        {hint ? <em className="setadv__hint modern:text-pm-text-dim"> {hint}</em> : null}
      </span>
      <span className="setadv__c-reset">
        <Button
          type="button"
          title={
            scope.scope === 'bond'
              ? 'cmd.unset_bond — removes the per-bond override'
              : scope.scope === 'atom-state'
                ? "cmd.alter_state … del s['name'] — cmd.unset cannot reach this level"
                : 'cmd.unset — restores the DEFAULT (PyMOL 2.5+)'
          }
          disabled={
            !writable || noTarget || (!selectionScope && isDefaultValue(meta, entry?.value))
          }
          onClick={reset}
        >
          ⟲
        </Button>
      </span>
      {error ? <span className="setadv__error modern:text-danger">{error}</span> : null}
    </div>
  );
}

/**
 * `File ▸ Reinitialize` — `_gui.py:126-132`.
 *
 * It lives HERE and not in a File menu because there is no menu bar yet
 * (WP-14), and because three of its four entries do nothing but rewrite this
 * table: after any of them every cached value is stale, so the refetch is not
 * optional. `Everything` also deletes every object, so it asks first — the Qt
 * File menu does not, and a mis-click there is unrecoverable.
 *
 * The word, not the code, is what goes over the wire:
 * `reinit_code[reinit_sc.auto_err(what)]` (`commanding.py:373`) resolves it, and
 * an abbreviation resolves too — so sending `settings` is sending the API's own
 * vocabulary rather than a magic `1`.
 */
function ReinitializeStrip({
  call,
  source,
  onDone,
}: {
  call: RawCall | undefined;
  source: SettingsSource;
  onDone: () => void;
}) {
  const [armed, setArmed] = useState<string | null>(null);

  const run = (what: string) => {
    setArmed(null);
    if (!call) return;
    void call('reinitialize', [what])
      .then(() => source.bootstrap())
      .then(onDone)
      .catch(() => undefined);
  };

  return (
    <div className="setadv__reinit">
      <span className="setadv__reinit-label" title="PyMOL puts these in File ▸ Reinitialize">
        Reinitialize
      </span>
      {REINITIALIZE_MENU.map((entry) => (
        <Button
          key={entry.what}
          type="button"
          title={`cmd.reinitialize("${entry.what}") — ${entry.help}`}
          data-what={entry.what}
          className={armed === entry.what ? 'is-armed' : undefined}
          onClick={() => {
            if (entry.destructive && armed !== entry.what) setArmed(entry.what);
            else run(entry.what);
          }}
        >
          {armed === entry.what ? `${entry.label}?` : entry.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * The atom-state scope's own strip. It reports the atom count `alter_state`
 * returned instead of enumerating overrides, because ENUMERATION IS NOT
 * AVAILABLE at this level over the wire: the bridge's `scope` RPC reads
 * `list(s)` inside `cmd.iterate`, whose `s` is bound to the ATOM
 * (`packages/engine/layer1/P.cpp:455-606`), so an atom-state override is invisible to it —
 * measured: after `alter_state 1, …, s['label_screen_point']=(1,2,3)`,
 * `iterate` reports no override on that atom and `iterate_state 1` reports
 * index 728. Reading them back needs an `iterate_state` variant of that RPC
 * (`packages/bridge/tenmol_bridge/panels/settings.py:718`), which this feature does not
 * own. Saying so is better than showing "no overrides".
 */
function AtomStateStrip({ note, scope }: { note: string; scope: ScopeSelection }) {
  return (
    <div className="setadv__overrides" data-scope="atom-state">
      {note ||
        (scope.selection.trim() === ''
          ? 'type a selection, then write a value — atom-state goes through cmd.alter_state'
          : `state ${scope.state || 1} of ${scope.selection}: write a value to see what alter_state answered`)}
      <em className="setadv__hint modern:text-pm-text-dim">
        {' '}
        · atom-state overrides cannot be listed back: the scope RPC uses cmd.iterate, not
        cmd.iterate_state
      </em>
    </div>
  );
}

/**
 * What a selection actually carries, read back after every write.
 *
 * `cmd.get_object_settings` gives the object's own CSetting, `iter(s)` inside
 * `cmd.iterate` gives the indices genuinely defined on each atom
 * (`SettingUniqueGetIndicesAsPyList`, `packages/engine/layer1/P.cpp:455-606`) and `cmd.get_bond`
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
   * (`packages/engine/layer1/Setting.cpp:1183-1237`) is applied here.
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
      <Checkbox
        aria-label={meta.name}
        disabled={disabled}
        checked={Number(entry?.value ?? 0) !== 0}
        onChange={(e) => onCommit(e.target.checked ? 1 : 0)}
      />
    );
  }

  return (
    <TextInput
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
