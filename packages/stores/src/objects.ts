/**
 * The object panel's data.
 *
 * There is NO push feed for this panel. `ReportEnabledChange`
 * (`layer3/Executive.cpp:313-322`) only invokes `G->enabledCallback` under
 * `_PYMOL_LIB`, and the panel itself is a C++ `Block::draw` surface
 * (`struct CExecutive : public Block`, `layer3/ExecutiveDef.h:54`) redrawn from
 * the live `Spec` list — nothing in the Python build announces a change. So this
 * store POLLS, at the plan §1.5 cadence (30 Hz focused / 4 Hz hidden), through
 * exactly two calls per pass:
 *
 *     cmd.get_names('public', 0)   -> panel order        (querying.py:1155-1199)
 *     cmd.get_vis()                -> enabled/reps/color (viewing.py:899-901,
 *                                     C: ExecutiveGetVisAsPyDict :4481-4512)
 *
 * Measured against the running bridge: 0.22 ms per round trip, so a 30 Hz poll
 * of both costs ~1.3 % of one engine tick. `get_type` and `count_atoms` are
 * per-name and CACHED — `count_atoms` is 5,902 us at 500k atoms and is banned
 * from the hot path (plan §6 WP-10).
 *
 * When WP-12's `objects` topic starts pushing `ObjectsPayload`, call
 * `adoptTopic()`: the store switches source and the poller stops. Both paths
 * produce the same rows.
 *
 * KNOWN GAP, deliberately not faked: group nesting. `PanelRec.nest_level` and
 * `is_open` live only in C++ (`layer3/ExecutiveDef.h:20-31`) and `group_name` is
 * only reachable through `cmd.get_session(partial=1)`, which is far too heavy to
 * poll (internal-gui.md §11 "Gaps in the Python surface"). Nesting here is
 * derived from dotted names against the real group list — which is how
 * `group_auto_mode` builds them — and is marked `nestInferred` so the UI can say
 * so instead of pretending.
 */

import type { ObjectRow, PymolObjectType } from '@tenmol/protocol';
import { createStore, type Store } from './createStore';

/** `cmd.get_vis()` value: `[visible, [], repIndices | None, colorIndex | None]`. */
export type VisEntry = [number, unknown[], number[] | null, number | null];
export type VisMap = Record<string, VisEntry>;

/** A row as the panel renders it: the wire row plus what the client derives. */
export interface PanelRow extends ObjectRow {
  isGroup: boolean;
  /** Enabled, but an ancestor group is disabled (`layer3/Executive.cpp:16392-16406`). */
  cloaked: boolean;
  /** The synthetic `all` row (`cExecAll`), which is not in `get_names`. */
  isAll: boolean;
  /** `cmd.count_atoms(name)`, cached; null until fetched or not applicable. */
  atoms: number | null;
  /** True when `nest`/`group` were derived from the name, not read from PyMOL. */
  nestInferred: boolean;
}

export type RowSource = 'none' | 'poll' | 'topic';

export interface ObjectsState {
  rows: readonly PanelRow[];
  source: RowSource;
  /** Bumped whenever the row set (not just the flags) changes. */
  generation: number;
  /** Epoch ms of the last successful snapshot. */
  updatedAt: number | null;
  lastError: string | null;
  /** Group names whose children the user collapsed. Client-side: PyMOL's
   *  `is_open` is not readable (see the file header). */
  collapsed: readonly string[];
}

export interface ObjectsStore extends Store<ObjectsState> {
  applyRows(rows: PanelRow[], source: RowSource): void;
  setError(message: string | null): void;
  toggleCollapsed(name: string): void;
}

export function createObjectsStore(): ObjectsStore {
  const store = createStore<ObjectsState>({
    rows: [],
    source: 'none',
    generation: 0,
    updatedAt: null,
    lastError: null,
    collapsed: [],
  });

  return {
    ...store,

    applyRows(rows, source) {
      store.set((state) => {
        const same = rowsEqual(state.rows, rows);
        if (same && state.source === source && state.lastError === null) {
          // Nothing changed: keep the old array identity so React does not
          // re-render the panel 30 times a second for no reason.
          return { updatedAt: Date.now() };
        }
        return {
          rows,
          source,
          updatedAt: Date.now(),
          lastError: null,
          generation: same ? state.generation : state.generation + 1,
        };
      });
    },

    setError(message) {
      store.set({ lastError: message });
    },

    toggleCollapsed(name) {
      store.set((state) => ({
        collapsed: state.collapsed.includes(name)
          ? state.collapsed.filter((n) => n !== name)
          : [...state.collapsed, name],
      }));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Row construction (pure — unit tested)
 * ------------------------------------------------------------------ */

export interface BuildRowsInput {
  /** `cmd.get_names('public', 0)`, in panel order. */
  names: readonly string[];
  /** `cmd.get_vis()`. */
  vis: VisMap;
  /** name -> `cmd.get_type(name)`, cached across polls. */
  types: ReadonlyMap<string, string>;
  /** name -> `cmd.count_atoms(name)`, cached; optional. */
  atoms?: ReadonlyMap<string, number>;
}

export function buildRows(input: BuildRowsInput): PanelRow[] {
  const { names, vis, types, atoms } = input;

  const groupNames = new Set(names.filter((name) => types.get(name) === 'object:group'));

  const allVis = vis['all'];
  const rows: PanelRow[] = [
    {
      name: 'all',
      type: 'object:group',
      enabled: allVis ? allVis[0] !== 0 : true,
      group: '',
      nest: 0,
      reps: 0,
      color: null,
      caption: '',
      isGroup: false,
      cloaked: false,
      isAll: true,
      atoms: atoms?.get('all') ?? null,
      nestInferred: false,
    },
  ];

  for (const name of names) {
    const entry = vis[name];
    const type = (types.get(name) ?? 'object:molecule') as PymolObjectType;
    const group = inferGroup(name, groupNames);
    rows.push({
      name,
      type,
      enabled: entry ? entry[0] !== 0 : false,
      group,
      nest: group === '' ? 0 : group.split('.').length,
      reps: entry ? bitmaskFromRepIndices(entry[2]) : 0,
      color: entry ? entry[3] : null,
      caption: '',
      isGroup: groupNames.has(name),
      cloaked: false,
      isAll: false,
      atoms: atoms?.get(name) ?? null,
      nestInferred: group !== '',
    });
  }

  // "Cloaked": enabled, but an ancestor group is disabled. Derived client-side
  // exactly as CExecutive::draw does (layer3/Executive.cpp:16392-16406) —
  // cmd.get_vis() reports `visible` per rec and never this.
  const enabledByName = new Map(rows.map((row) => [row.name, row.enabled]));
  for (const row of rows) {
    if (!row.enabled || row.group === '') continue;
    let parent: string | undefined = row.group;
    while (parent) {
      if (enabledByName.get(parent) === false) {
        row.cloaked = true;
        break;
      }
      const dot = parent.lastIndexOf('.');
      parent = dot > 0 ? parent.slice(0, dot) : undefined;
    }
  }

  return rows;
}

/**
 * `cmd.get_vis()` element 2 is the rep INDEX list built by
 * `getRepArrayFromBitmask` (`layer3/Executive.cpp:4514-4525`); `ObjectRow.reps`
 * is the bitmask it came from. Note what this is worth: for a molecule this is
 * the OBJECT-level `visRep`, which is all-on by default — per-atom reps are
 * invisible to it. Plan §1.5 proved it: `show spheres, m and name CA` leaves
 * `get_vis()` byte-identical while 574 atoms carry the rep. It is kept for
 * non-molecular objects (maps, meshes, surfaces), where it is meaningful.
 */
export function bitmaskFromRepIndices(indices: number[] | null): number {
  if (!indices) return 0;
  let mask = 0;
  for (const index of indices) {
    if (index >= 0 && index < 31) mask |= 1 << index;
  }
  return mask;
}

/** Longest known group name that is a dotted prefix of `name`. */
function inferGroup(name: string, groups: ReadonlySet<string>): string {
  let best = '';
  for (let dot = name.lastIndexOf('.'); dot > 0; dot = name.lastIndexOf('.', dot - 1)) {
    const candidate = name.slice(0, dot);
    if (groups.has(candidate) && candidate.length > best.length) best = candidate;
  }
  return best;
}

/**
 * True when two row lists are equivalent for rendering. Compares every field the
 * panel draws, so a 30 Hz poll that finds nothing new produces zero renders.
 */
export function rowsEqual(a: readonly PanelRow[], b: readonly PanelRow[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return false;
    if (
      x.name !== y.name ||
      x.type !== y.type ||
      x.enabled !== y.enabled ||
      x.group !== y.group ||
      x.nest !== y.nest ||
      x.reps !== y.reps ||
      x.color !== y.color ||
      x.caption !== y.caption ||
      x.isGroup !== y.isGroup ||
      x.cloaked !== y.cloaked ||
      x.atoms !== y.atoms
    ) {
      return false;
    }
  }
  return true;
}

/** Rows the panel actually shows: children of a collapsed group are hidden. */
export function visibleRows(
  rows: readonly PanelRow[],
  collapsed: readonly string[],
): readonly PanelRow[] {
  if (collapsed.length === 0) return rows;
  const hidden = new Set(collapsed);
  return rows.filter((row) => {
    let parent = row.group;
    while (parent) {
      if (hidden.has(parent)) return false;
      const dot = parent.lastIndexOf('.');
      parent = dot > 0 ? parent.slice(0, dot) : '';
    }
    return true;
  });
}

/**
 * The name PyMOL draws: the group prefix is stripped when
 * `group_full_member_names` is 0 (`layer3/Executive.cpp:16421-16434`), and
 * selections are wrapped in parentheses (`:16437-16441`).
 */
export function displayName(row: PanelRow): string {
  const short = row.group !== '' ? row.name.slice(row.group.length + 1) : row.name;
  return row.type === 'selection' ? `(${short})` : short;
}
