/**
 * One poll pass for the object panel, plus the mutations its buttons issue.
 *
 * Split out of `objects.ts` so that file stays pure and testable. Everything
 * here is a real `cmd.*` call over `{t:'call'}`; nothing is optimistic. The
 * panel shows what PyMOL says, one poll later (≤ 33 ms, or immediately via
 * `poller.kick()`), because a settings write can silently no-op at the wrong
 * level and `SettingGenerateSideEffects` can invalidate geometry — plan §6
 * WP-08, "nothing is optimistic except pure-UI state".
 */

import type { ObjectsStore, PanelRow, VisMap } from './objects';
import { buildRows } from './objects';

/** `{t:'call'}`. `fn` is a dotted path resolved against `cmd` by the bridge. */
export type CallFn = <T = unknown>(
  fn: string,
  args?: readonly unknown[],
  kwargs?: Readonly<Record<string, unknown>>,
) => Promise<T>;

export interface ObjectsSourceOptions {
  call: CallFn;
  store: ObjectsStore;
  /** Names to skip for `count_atoms` (maps, meshes, ...). */
  maxTypeLookupsPerPass?: number;
  maxAtomLookupsPerPass?: number;
}

export interface ObjectsSource {
  /** One pass: two RPCs plus a bounded number of cache fills. */
  poll(): Promise<void>;
  /** Drop the per-name caches (after `delete`, `set_name`, or a reconnect). */
  invalidate(): void;
  /** Adopt a pushed `ObjectsPayload` from WP-12's `objects` topic. */
  adoptTopic(rows: PanelRow[]): void;
}

/** Types for which `cmd.count_atoms` is meaningful. */
const ATOM_COUNT_TYPES = new Set(['object:molecule', 'selection']);

export function createObjectsSource(options: ObjectsSourceOptions): ObjectsSource {
  const { call, store } = options;
  const maxTypes = options.maxTypeLookupsPerPass ?? 8;
  const maxAtoms = options.maxAtomLookupsPerPass ?? 8;

  const types = new Map<string, string>();
  const atoms = new Map<string, number>();

  return {
    async poll(): Promise<void> {
      if (store.get().source === 'topic') return;

      const [names, vis] = await Promise.all([
        call<string[]>('get_names', ['public', 0]),
        call<VisMap>('get_vis'),
      ]);
      const live = Array.isArray(names) ? names.filter((n) => typeof n === 'string') : [];

      // Forget names that are gone, so a delete + recreate cannot serve a stale
      // type or atom count.
      const liveSet = new Set(live);
      for (const key of [...types.keys()]) if (!liveSet.has(key)) types.delete(key);
      for (const key of [...atoms.keys()]) if (!liveSet.has(key)) atoms.delete(key);

      // Bounded cache fills: `get_type` once per name ever, `count_atoms` once
      // per name (5,902 us at 500k atoms — never in the hot path, plan §6 WP-10).
      const missingTypes = live.filter((name) => !types.has(name)).slice(0, maxTypes);
      await Promise.all(
        missingTypes.map(async (name) => {
          try {
            types.set(name, await call<string>('get_type', [name]));
          } catch {
            types.set(name, 'object:molecule');
          }
        }),
      );

      const missingAtoms = live
        .filter((name) => !atoms.has(name) && ATOM_COUNT_TYPES.has(types.get(name) ?? ''))
        .slice(0, maxAtoms);
      await Promise.all(
        missingAtoms.map(async (name) => {
          try {
            // quiet=1: the panel must not spam the console with a
            // " count_atoms: N atoms" line every time a row appears.
            atoms.set(name, await call<number>('count_atoms', [name], { quiet: 1 }));
          } catch {
            /* leave it unknown */
          }
        }),
      );

      store.applyRows(buildRows({ names: live, vis: vis ?? {}, types, atoms }), 'poll');
    },

    invalidate(): void {
      types.clear();
      atoms.clear();
    },

    adoptTopic(rows: PanelRow[]): void {
      store.applyRows(rows, 'topic');
    },
  };
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

/**
 * Every mutation the panel can perform, as the single `cmd.*` call PyMOL's own
 * panel logs for it. The strings are what `ExecutiveSpecSetVisibility`
 * (`layer3/Executive.cpp:15413-15487`) and the popup leaves
 * (`layer4/PopUp.cpp:471-475`) put in the log file, which is exactly what the
 * console shows the user here.
 */
export interface PanelAction {
  /** Dotted symbol for `{t:'call'}`. */
  fn: string;
  args: readonly unknown[];
  /** Keyword arguments — several `cmd.*` signatures only reach `animate` by name. */
  kwargs?: Readonly<Record<string, unknown>>;
  /** The equivalent command line, echoed into the scrollback (dim, client-origin). */
  echo: string;
  /** Whether the row set (not just flags) can change — clears the name caches. */
  invalidatesNames?: boolean;
}

/** Quote a name for a command-line echo when it is not a bare identifier. */
export function quoteName(name: string): string {
  return /^[A-Za-z0-9_.]+$/.test(name) && name !== '' ? name : JSON.stringify(name);
}

export const panelActions = {
  enable: (name: string): PanelAction => ({
    fn: 'enable',
    args: [name],
    echo: `enable ${quoteName(name)}`,
  }),
  disable: (name: string): PanelAction => ({
    fn: 'disable',
    args: [name],
    echo: `disable ${quoteName(name)}`,
  }),
  show: (rep: string, name: string): PanelAction => ({
    fn: 'show',
    args: [rep, name],
    echo: `show ${rep}, ${quoteName(name)}`,
  }),
  hide: (rep: string, name: string): PanelAction => ({
    fn: 'hide',
    args: [rep, name],
    echo: `hide ${rep}, ${quoteName(name)}`,
  }),
  showAs: (rep: string, name: string): PanelAction => ({
    fn: 'show_as',
    args: [rep, name],
    echo: `as ${rep}, ${quoteName(name)}`,
  }),
  color: (color: string, name: string): PanelAction => ({
    fn: 'color',
    args: [color, name],
    echo: `color ${color}, ${quoteName(name)}`,
  }),
  // `animate=-1` is what menu.py:1250-1252 passes: "use the
  // `animation_duration` setting", not a literal one second.
  zoom: (name: string): PanelAction => ({
    fn: 'zoom',
    args: [name],
    kwargs: { animate: -1 },
    echo: `zoom ${quoteName(name)}, animate=-1`,
  }),
  orient: (name: string): PanelAction => ({
    fn: 'orient',
    args: [name],
    kwargs: { animate: -1 },
    echo: `orient ${quoteName(name)}, animate=-1`,
  }),
  center: (name: string): PanelAction => ({
    fn: 'center',
    args: [name],
    kwargs: { animate: -1 },
    echo: `center ${quoteName(name)}, animate=-1`,
  }),
  deleteObject: (name: string): PanelAction => ({
    fn: 'delete',
    args: [name],
    echo: `delete ${quoteName(name)}`,
    invalidatesNames: true,
  }),
  label: (expression: string, name: string): PanelAction => ({
    fn: 'label',
    args: [name, expression],
    echo: `label ${quoteName(name)}, ${expression}`,
  }),
} as const;
