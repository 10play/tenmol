/**
 * The settings store — the only source of truth for every checkbox, radio,
 * slider and table cell that reflects a PyMOL setting.
 *
 * WHY IT LOOKS LIKE THIS
 * ----------------------
 * PyMOL has no settings *push*.  `cmd.get_setting_updates()`
 * (`packages/engine/layer1/Setting.cpp:1121-1147`) returns the changed indices AND CLEARS the
 * flags while iterating, so the first reader wins and every other reader sees
 * `[]`.  The bridge's status thread owns that call, and
 * `packages/bridge/tenmol_bridge/panels/settings.py` taps it: the client reads a
 * cumulative, cursor-addressed log instead of the drain.  Consequences the code
 * below depends on:
 *
 *  * Polling the tap slowly is LOSSLESS (a missed poll is not a missed change),
 *    unlike polling the drain, which would steal updates from the bridge.
 *  * `full` means "a session-load-sized batch arrived" -> refetch everything.
 *    Never diff after a `full`.
 *  * `[]` still means "nothing, or a lock miss" — so nothing here treats an
 *    empty drain as proof of quiescence (plan §1.2).
 *
 * NOTHING HERE IS OPTIMISTIC.  A write can silently no-op at the wrong level
 * (`packages/engine/layer3/Executive.cpp:12279-12286` warns and writes anyway), an int global
 * can be clamped behind your back (`packages/engine/layer1/Setting.cpp:1890-1911`) and
 * `SettingGenerateSideEffects` can invalidate geometry.  So every `set` is
 * followed by a read-back of the same index and the store shows what PyMOL
 * says, not what the user typed.
 */

import type {
  SettingBondsReply,
  SettingCatalogue,
  SettingDrainReply,
  SettingKind,
  SettingLevel,
  SettingMeta,
  SettingScope,
  SettingScopeReply,
  SettingServiceStatus,
  SettingValue,
  SettingValuesReply,
} from '@tenmol/protocol';
import { createStore, type Store } from './createStore';

/* ------------------------------------------------------------------ *
 * Transport shape (structural — the store never sees a socket)
 * ------------------------------------------------------------------ */

/** A `{t:'call'}` transport: a dotted `cmd.*` symbol invoked over the wire. */
export type SettingsCall = <T = unknown>(
  fn: string,
  args?: readonly unknown[],
  kwargs?: Readonly<Record<string, unknown>>,
) => Promise<T>;

/** A `{t:'do'}` transport: runs one command line through PyMOL's parser. */
export type SettingsDo = (commandLine: string) => Promise<unknown>;

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/** One cached setting value plus PyMOL's own rendering of it. */
export interface SettingEntry {
  value: SettingValue;
  /** `SettingGetTextPtr` rendering: `on`/`off`, `%d`, `%1.5f`, colour NAME. */
  text: string;
}

/** Lifecycle of the settings service: idle until bootstrapped, then ready. */
export type SettingsPhase = 'idle' | 'bootstrapping' | 'ready' | 'error';

/** The full settings-store snapshot: catalogue, value cache, and tap cursor. */
export interface SettingsState {
  phase: SettingsPhase;
  catalogue: SettingCatalogue | null;
  /** `${index}|${object}|${state}` -> value.  Global scope is `${index}||0`. */
  entries: Readonly<Record<string, SettingEntry>>;
  /** The tap cursor already consumed. */
  cursor: number;
  /** Bumped on every applied batch, so a table can memoise cheaply. */
  generation: number;
  updatedAt: number | null;
  lastError: string | null;
  /** Whether the backend module answered `installed: true`. */
  installed: boolean;
  /** Indices whose last write PyMOL did not accept verbatim. */
  rejected: Readonly<Record<number, string>>;
}

/** The settings store: state plus the mutators the source drives it with. */
export interface SettingsStore extends Store<SettingsState> {
  applyCatalogue(catalogue: SettingCatalogue): void;
  applyValues(reply: SettingValuesReply): void;
  setCursor(cursor: number): void;
  setPhase(phase: SettingsPhase, error?: string | null): void;
  noteRejected(index: number, message: string | null): void;
}

/**
 * `${index}|${object}|${state}` — the value cache key.
 *
 * `state` is PyMOL's 1-BASED state, the convention `cmd.set`, `cmd.get` and
 * `cmd.get_setting_tuple` all take (each does `int(state) - 1` before calling C,
 * `packages/engine/modules/pymol/setting.py:381,398`): `0` = not state-specific, `1` = the first
 * state. Passing -1 here would reach C as -2.
 */
export function valueKey(index: number, object = '', state = 0): string {
  return `${index}|${object}|${state}`;
}

/** Build an empty settings store in the `idle` phase. */
export function createSettingsStore(): SettingsStore {
  const store = createStore<SettingsState>({
    phase: 'idle',
    catalogue: null,
    entries: {},
    cursor: 0,
    generation: 0,
    updatedAt: null,
    lastError: null,
    installed: false,
    rejected: {},
  });

  return {
    ...store,

    applyCatalogue(catalogue) {
      store.set({ catalogue, installed: true, lastError: null });
    },

    applyValues(reply) {
      if (reply.values.length === 0) return;
      store.set((state) => {
        const entries = { ...state.entries };
        for (const [index, value, text] of reply.values) {
          entries[valueKey(index, reply.object, reply.state)] = { value, text };
        }
        return {
          entries,
          generation: state.generation + 1,
          updatedAt: Date.now(),
        };
      });
    },

    setCursor(cursor) {
      store.set({ cursor });
    },

    setPhase(phase, error = null) {
      store.set({ phase, lastError: error });
    },

    noteRejected(index, message) {
      store.set((state) => {
        const rejected = { ...state.rejected };
        if (message === null) delete rejected[index];
        else rejected[index] = message;
        return { rejected };
      });
    },
  };
}

/* ------------------------------------------------------------------ *
 * Catalogue helpers (pure)
 * ------------------------------------------------------------------ */

/** Build by-index and by-name lookup maps over a catalogue's settings. */
export function indexSettings(catalogue: SettingCatalogue | null): {
  byIndex: Map<number, SettingMeta>;
  byName: Map<string, SettingMeta>;
} {
  const byIndex = new Map<number, SettingMeta>();
  const byName = new Map<string, SettingMeta>();
  for (const meta of catalogue?.settings ?? []) {
    byIndex.set(meta.index, meta);
    byName.set(meta.name, meta);
  }
  return { byIndex, byName };
}

/**
 * `setting._get_index` (`packages/engine/modules/pymol/setting.py:63-70`) in the browser:
 * an int, a digit string, an exact name, or an UNAMBIGUOUS prefix.  Ambiguity
 * is an error there (`Shortcut.auto_err`) and null here — the caller must not
 * guess, because guessing writes the wrong setting.
 */
export function resolveSettingName(
  catalogue: SettingCatalogue | null,
  raw: string | number,
): SettingMeta | null {
  if (!catalogue) return null;
  const { byIndex, byName } = indexSettings(catalogue);
  if (typeof raw === 'number') return byIndex.get(raw) ?? null;
  const text = raw.trim();
  if (text === '') return null;
  if (/^\d+$/.test(text)) return byIndex.get(Number(text)) ?? null;
  const exact = byName.get(text);
  if (exact) return exact;
  const alias = catalogue.aliases[text];
  if (alias !== undefined) return byIndex.get(alias) ?? null;
  const prefixed = catalogue.settings.filter((meta) => meta.name.startsWith(text));
  return prefixed.length === 1 ? (prefixed[0] ?? null) : null;
}

/**
 * The advanced table's filter.  The Qt original is a `QSortFilterProxyModel`
 * regex over both columns (`packages/engine/modules/pmg_qt/advanced_settings_gui.py:83-99`), so
 * a regex is tried first and a plain substring is the fallback for the (common)
 * case where the user typed something that is not valid regex.
 */
export function filterSettings(
  settings: readonly SettingMeta[],
  query: string,
): readonly SettingMeta[] {
  const text = query.trim();
  if (text === '') return settings;
  let re: RegExp | null = null;
  try {
    re = new RegExp(text, 'i');
  } catch {
    re = null;
  }
  const lower = text.toLowerCase();
  return settings.filter((meta) =>
    re ? re.test(meta.name) : meta.name.toLowerCase().includes(lower),
  );
}

/** Scopes a level may be written at (`packages/engine/layer1/Setting.cpp:55-96`). */
const SCOPES_BY_LEVEL: Record<SettingLevel, readonly SettingScope[]> = {
  unused: [],
  global: ['global'],
  object: ['global', 'object'],
  'object-state': ['global', 'object', 'object-state'],
  atom: ['global', 'object', 'object-state', 'atom'],
  'atom-state': ['global', 'object', 'object-state', 'atom', 'atom-state'],
  bond: ['global', 'object', 'object-state', 'bond'],
  'bond-state': ['global', 'object', 'object-state', 'bond', 'bond-state'],
};

/** The scopes a setting of this level may be written at. */
export function scopesForLevel(level: SettingLevel): readonly SettingScope[] {
  return SCOPES_BY_LEVEL[level] ?? ['global'];
}

/**
 * True when a write at `scope` would actually take effect.
 *
 * PyMOL does not refuse a wrong-level write: it prints
 * `" Setting-Warning: '%s' is a %s-level setting"` and performs a write that
 * then has no effect (`packages/engine/layer3/Executive.cpp:12279-12286`).  The UI disables the
 * scope instead, so the user never hits the silent no-op.
 */
export function canWriteAt(meta: SettingMeta, scope: SettingScope): boolean {
  return scopesForLevel(meta.level).includes(scope);
}

/* ------------------------------------------------------------------ *
 * Coercion — mirrors setting._validate_value (setting.py:83-112)
 * ------------------------------------------------------------------ */

/** `boolean_dict` (`packages/engine/modules/pymol/setting.py:50-59`). */
const BOOLEAN_WORDS: Record<string, number> = {
  true: 1,
  false: 0,
  on: 1,
  off: 0,
  '1': 1,
  '0': 0,
  '1.0': 1,
  '0.0': 0,
};

/** `Shortcut` abbreviation over `boolean_dict`'s keys, unique prefixes only. */
function booleanWord(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  const exact = BOOLEAN_WORDS[text];
  if (exact !== undefined) return exact;
  const keys = Object.keys(BOOLEAN_WORDS).filter((key) => key.startsWith(text));
  if (keys.length === 0) return null;
  const values = new Set(keys.map((key) => BOOLEAN_WORDS[key]));
  // `Shortcut` resolves an abbreviation that maps to ONE key; 'f' -> 'false'
  // is unique, 't' -> 'true' is unique, and an ambiguous prefix is an error.
  return keys.length === 1 || values.size === 1 ? (BOOLEAN_WORDS[keys[0] as string] as number) : null;
}

/** Thrown when an editor's value cannot be coerced into what `cmd.set` accepts. */
export class SettingCoercionError extends Error {}

/**
 * Turn whatever an editor produced into what `cmd.set` will accept.
 *
 * Rules are `setting._validate_value`'s, in its order:
 *  * boolean — ANY float parses (non-zero -> 1); otherwise a `boolean_dict`
 *    word, abbreviations allowed.
 *  * int/float — a boolean-looking STRING converts first, then `int()`/`float()`.
 *  * float3 — a list passes through; a string with a comma is `safe_eval`ed;
 *    otherwise whitespace-split.  Always exactly three floats.
 *  * color — `str(value)`; the name/index/`0x` form is resolved in C.
 *  * string — outermost matching quotes stripped.
 *
 * Throwing here is the point: the backend is the final authority, but an editor
 * must never send it something it will reject with a console error the user
 * cannot see.
 */
export function coerceSettingValue(kind: SettingKind, raw: unknown): SettingValue {
  switch (kind) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw ? 1 : 0;
      if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0 ? 1 : 0;
      const text = String(raw).trim();
      const asNumber = Number(text);
      if (text !== '' && Number.isFinite(asNumber)) return asNumber !== 0 ? 1 : 0;
      const word = booleanWord(text);
      if (word === null) throw new SettingCoercionError(`not a boolean: ${text}`);
      return word;
    }
    case 'int':
    case 'float': {
      let value: unknown = raw;
      if (typeof value === 'boolean') value = value ? 1 : 0;
      if (typeof value === 'string') {
        const word = booleanWord(value);
        const asNumber = Number(value.trim());
        // A boolean WORD wins, but a plain number is a number: '1' is 1 either
        // way and '0.5' must not be mistaken for a word.
        value = value.trim() !== '' && Number.isFinite(asNumber) ? asNumber : word;
        if (value === null) throw new SettingCoercionError(`not a number: ${String(raw)}`);
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new SettingCoercionError(`not a number: ${String(raw)}`);
      return kind === 'int' ? Math.trunc(numeric) : numeric;
    }
    case 'float3': {
      const parts = Array.isArray(raw)
        ? (raw as unknown[])
        : String(raw)
            .replace(/^[[(]|[\])]$/g, '')
            .split(String(raw).includes(',') ? ',' : /\s+/);
      const numbers = parts.map((part) => Number(String(part).trim()));
      if (numbers.length < 3 || numbers.some((n) => !Number.isFinite(n))) {
        throw new SettingCoercionError(`not three floats: ${String(raw)}`);
      }
      return [numbers[0] as number, numbers[1] as number, numbers[2] as number];
    }
    case 'color':
      return String(raw);
    case 'string': {
      const text = String(raw);
      if (text.length > 1 && text[0] === text[text.length - 1] && (text[0] === '"' || text[0] === "'")) {
        return text.slice(1, -1);
      }
      return text;
    }
    default:
      throw new SettingCoercionError(`setting kind ${kind} cannot be edited`);
  }
}

/**
 * `SettingGetTextPtr` (`packages/engine/layer1/Setting.cpp:1183-1237`) for values the client
 * already holds.  Used ONLY for optimistic-free previews (a slider being
 * dragged); the authoritative text always comes from `cmd.get`.
 */
export function formatSettingValue(kind: SettingKind, value: SettingValue): string {
  switch (kind) {
    case 'boolean':
      return Number(value) ? 'on' : 'off';
    case 'int':
    case 'color':
      return String(Math.trunc(Number(value)));
    case 'float':
      return Number(value).toFixed(5);
    case 'float3': {
      const v = Array.isArray(value) ? (value as readonly number[]) : [0, 0, 0];
      return `[ ${(v[0] ?? 0).toFixed(5)}, ${(v[1] ?? 0).toFixed(5)}, ${(v[2] ?? 0).toFixed(5)} ]`;
    }
    default:
      return String(value);
  }
}

/** True when `value` equals the record's default (drives the Reset button). */
export function isDefaultValue(meta: SettingMeta, value: SettingValue | undefined): boolean {
  if (meta.default === undefined || value === undefined) return false;
  if (Array.isArray(meta.default) && Array.isArray(value)) {
    const a = meta.default as readonly number[];
    const b = value as readonly number[];
    return a.length === b.length && a.every((n, i) => Math.abs(n - (b[i] ?? 0)) < 1e-6);
  }
  if (typeof meta.default === 'number' && typeof value === 'number') {
    return Math.abs(meta.default - value) < 1e-6;
  }
  return String(meta.default) === String(value);
}

/**
 * A range hint, never a limit.  Returns null when the record declares none, or
 * when the range is one PyMOL does not enforce (every float range, and every
 * range for a non-global write) — showing "0-89" next to an input that happily
 * accepts 500 and keeps it would be worse than showing nothing.
 */
export function rangeHint(meta: SettingMeta, scope: SettingScope): string | null {
  if (meta.min === undefined || meta.max === undefined) return null;
  if (meta.kind === 'boolean') return null;
  const enforced = meta.kind === 'int' && scope === 'global';
  return `${meta.min}–${meta.max}${enforced ? '' : ' (not enforced)'}`;
}

/* ------------------------------------------------------------------ *
 * The source: bootstrap, refresh, write
 * ------------------------------------------------------------------ */

/**
 * The one-line Python bootstrap.  `cmd.do` executes a `/`-prefixed line as
 * Python (verified against this build), and the module publishes its API onto
 * `pymol.setting`, which the capability policy already lists as an addressable
 * root.  Idempotent: `install()` returns early when it has already run.
 */
export const SETTINGS_BOOTSTRAP =
  '/import tenmol_bridge.panels.settings as _s;_s.install()';

const FN = {
  status: 'setting.tenmol_settings_status',
  catalogue: 'setting.tenmol_settings_catalogue',
  values: 'setting.tenmol_settings_values',
  scope: 'setting.tenmol_settings_scope',
  bonds: 'setting.tenmol_settings_bonds',
  drain: 'setting.tenmol_settings_drain',
} as const;

/** What `createSettingsSource` needs: the two transports, the store, and a hook. */
export interface SettingsSourceOptions {
  call: SettingsCall;
  do: SettingsDo;
  store: SettingsStore;
  /** Called after a change batch, so geometry consumers can invalidate. */
  onChanged?: (indices: readonly number[], full: boolean) => void;
}

/** The bridge-facing side of settings: bootstrap, poll, refresh, and every write. */
export interface SettingsSource {
  /** Install the backend module if needed and load catalogue + all values. */
  bootstrap(): Promise<void>;
  /** One tap poll.  Cheap: no PyMOL call at all when nothing changed. */
  poll(): Promise<void>;
  /** Re-read every global value (after `full`, a reinitialize or a reconnect). */
  refreshAll(): Promise<void>;
  /** Re-read specific indices in a given scope. */
  refresh(indices: readonly number[], object?: string, state?: number): Promise<void>;
  /** `cmd.set` + read-back.  Returns the value PyMOL actually holds. */
  write(
    meta: SettingMeta,
    raw: unknown,
    options?: { object?: string; state?: number; selection?: string },
  ): Promise<SettingEntry | null>;
  /** `cmd.unset` — restores the DEFAULT since PyMOL 2.5 (`setting.py:279-282`). */
  reset(meta: SettingMeta, options?: { object?: string; state?: number }): Promise<void>;
  /** `cmd.unset_deep` — object/ostate/atom/bond, explicitly NOT atom-state. */
  resetDeep(metas: readonly SettingMeta[], object?: string): Promise<void>;
  /** Where a value actually comes from: object/state overrides and per-atom. */
  scope(object: string, selection?: string, state?: number): Promise<SettingScopeReply>;
  /**
   * `cmd.set_bond` — the ONLY write that reaches a bond-level setting. Using
   * `cmd.set` with a selection here "will appear to take, but no change will be
   * observed" (`packages/engine/modules/pymol/setting.py:245-248`).
   */
  setBond(
    meta: SettingMeta,
    raw: unknown,
    selection: string,
    options?: { selection2?: string; state?: number },
  ): Promise<SettingBondsReply>;
  /** `cmd.unset_bond` (`setting.py:324-347`). */
  unsetBond(
    meta: SettingMeta,
    selection: string,
    options?: { selection2?: string; state?: number },
  ): Promise<SettingBondsReply>;
  /** `cmd.get_bond` for all six bond-level settings over a selection. */
  getBonds(selection: string, options?: { selection2?: string; state?: number }): Promise<SettingBondsReply>;
  serviceStatus(): Promise<SettingServiceStatus | null>;
}

/** Wire a settings store to the bridge: read-back-verified writes and a lossless tap poll. */
export function createSettingsSource(options: SettingsSourceOptions): SettingsSource {
  const { call, store } = options;
  const runLine = options.do;
  let bootstrapped = false;

  async function ensureInstalled(): Promise<void> {
    try {
      const status = await call<SettingServiceStatus>(FN.status);
      if (status?.installed) {
        bootstrapped = true;
        return;
      }
    } catch {
      /* not installed yet — that is the normal first-run path */
    }
    await runLine(SETTINGS_BOOTSTRAP);
    const status = await call<SettingServiceStatus>(FN.status);
    if (!status?.installed) throw new Error('settings service did not install');
    bootstrapped = true;
  }

  async function loadValues(
    indices: readonly number[] | null,
    object = '',
    state = 0,
  ): Promise<void> {
    const reply = await call<SettingValuesReply>(FN.values, [indices, object, state]);
    if (reply) store.applyValues(reply);
  }

  return {
    async bootstrap(): Promise<void> {
      store.setPhase('bootstrapping');
      try {
        await ensureInstalled();
        const catalogue = await call<SettingCatalogue>(FN.catalogue);
        store.applyCatalogue(catalogue);
        await loadValues(null);
        // Take the cursor AFTER the full read, so nothing between the two is
        // dropped: a change that lands in between is re-reported next poll.
        const drained = await call<SettingDrainReply>(FN.drain, [store.get().cursor]);
        store.setCursor(drained?.cursor ?? 0);
        store.setPhase('ready');
      } catch (error) {
        bootstrapped = false;
        store.setPhase('error', errorMessage(error));
        throw error;
      }
    },

    async poll(): Promise<void> {
      if (!bootstrapped) return;
      const drained = await call<SettingDrainReply>(FN.drain, [store.get().cursor]);
      if (!drained) return;
      store.setCursor(drained.cursor);
      if (drained.full || drained.lost) {
        await loadValues(null);
        // A full resync (a session load, a `reinitialize`) makes every prior
        // "PyMOL kept X instead" notice stale: the value it complained about is
        // gone. Leaving them up is worse than never showing them.
        for (const index of Object.keys(store.get().rejected)) {
          store.noteRejected(Number(index), null);
        }
        options.onChanged?.(drained.indices, true);
        return;
      }
      if (drained.indices.length === 0) return;
      await loadValues(drained.indices);
      // NOT cleared on the diff path: the drain that reports a clamped write is
      // the write's OWN drain, arriving ~200 ms later, so clearing here would
      // erase the notice the user is about to read. Only a full resync clears.
      options.onChanged?.(drained.indices, false);
    },

    async refreshAll(): Promise<void> {
      await loadValues(null);
    },

    async refresh(indices, object = '', state = 0): Promise<void> {
      if (indices.length === 0) return;
      await loadValues(indices, object, state);
    },

    async write(meta, raw, opts = {}): Promise<SettingEntry | null> {
      const object = opts.object ?? '';
      const state = opts.state ?? 0;
      const value = coerceSettingValue(meta.kind, raw);
      // `log=1, quiet=0` so the browser console mirrors the desktop's: PyMOL
      // prints ` Setting: name set to ...` and logs the equivalent command.
      await call('cmd.set', [meta.index, value as unknown, opts.selection ?? object, state], {
        log: 1,
        quiet: 0,
      });
      await loadValues([meta.index], object, state);
      const entry = store.get().entries[valueKey(meta.index, object, state)] ?? null;
      // Round-trip check: a wrong-level write warns and no-ops, and an int
      // global can be clamped (`Setting.cpp:1890-1911`). Say so instead of
      // showing the user their own input back.
      //
      // A PER-ATOM write is exempt: `cmd.get_setting_tuple` takes an object,
      // not a selection, so the read-back is the object/global value and would
      // "disagree" with every correct atom-level write. Use `scope()` there.
      if (opts.selection) {
        store.noteRejected(meta.index, null);
      } else if (entry && !sameValue(meta.kind, entry.value, value)) {
        store.noteRejected(
          meta.index,
          `PyMOL holds ${entry.text} — the write was clamped, coerced or applied at a level with no effect`,
        );
      } else {
        store.noteRejected(meta.index, null);
      }
      return entry;
    },

    async reset(meta, opts = {}): Promise<void> {
      const object = opts.object ?? '';
      const state = opts.state ?? 0;
      await call('cmd.unset', [meta.index, object, state], { log: 1, quiet: 0 });
      await loadValues([meta.index], object, state);
      store.noteRejected(meta.index, null);
    },

    async resetDeep(metas, object = ''): Promise<void> {
      if (metas.length === 0) return;
      await call('cmd.unset_deep', [metas.map((m) => m.index), object], { quiet: 0 });
      await loadValues(metas.map((m) => m.index));
    },

    scope(object, selection = '', state = 0): Promise<SettingScopeReply> {
      return call<SettingScopeReply>(FN.scope, [object, selection, state]);
    },

    async setBond(meta, raw, selection, opts = {}): Promise<SettingBondsReply> {
      const value = coerceSettingValue(meta.kind, raw);
      await call('cmd.set_bond', [
        meta.index,
        value as unknown,
        selection,
        opts.selection2 ?? null,
        opts.state ?? 0,
      ], { log: 1, quiet: 0 });
      return call<SettingBondsReply>(FN.bonds, [selection, opts.selection2 ?? '', opts.state ?? 0]);
    },

    async unsetBond(meta, selection, opts = {}): Promise<SettingBondsReply> {
      await call('cmd.unset_bond', [
        meta.index,
        selection,
        opts.selection2 ?? null,
        opts.state ?? 0,
      ], { log: 1, quiet: 0 });
      return call<SettingBondsReply>(FN.bonds, [selection, opts.selection2 ?? '', opts.state ?? 0]);
    },

    getBonds(selection, opts = {}): Promise<SettingBondsReply> {
      return call<SettingBondsReply>(FN.bonds, [selection, opts.selection2 ?? '', opts.state ?? 0]);
    },

    async serviceStatus(): Promise<SettingServiceStatus | null> {
      try {
        return await call<SettingServiceStatus>(FN.status);
      } catch {
        return null;
      }
    },
  };
}

function sameValue(kind: SettingKind, a: SettingValue, b: SettingValue): boolean {
  if (kind === 'float' || kind === 'int') {
    return Math.abs(Number(a) - Number(b)) < 1e-6;
  }
  if (kind === 'float3') {
    const x = Array.isArray(a) ? (a as readonly number[]) : [];
    const y = Array.isArray(b) ? (b as readonly number[]) : [];
    return x.length === y.length && x.every((n, i) => Math.abs(n - (y[i] ?? 0)) < 1e-6);
  }
  if (kind === 'boolean') return Number(a) === Number(b);
  return String(a) === String(b);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
