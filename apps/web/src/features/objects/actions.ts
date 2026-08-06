/**
 * The panel mutations that `@tenmol/stores`' `panelActions` does not carry:
 * group open/close, re-grouping and reordering.
 *
 * Every string here is what PyMOL's own panel writes to the log file, so a
 * session recorded through this UI replays identically in the Qt build:
 *
 *   `cmd.order("<a> <b>",location="upper"|"current")`   Executive.cpp:15927-15930
 *   `group <parent>, <child>`                           Executive.cpp:15913-15915
 *   `ungroup <child>`                                   Executive.cpp:15916-15917
 *
 * `cmd.group(name, action='open'|'close')` is the only way to move
 * `ObjectGroup::OpenOrClosed`, which is what decides whether a group's children
 * are panel rows at all (`PanelListGroup`, `:1554-1560`).
 */

import { quoteName, type PanelAction } from '@tenmol/stores';

/** The panel-row commands (group open/close, reorder, (un)group, disable) as {@link PanelAction}s. */
export const rowActions = {
  /** `cmd.group(name, action='open'|'close')`. */
  groupOpen: (name: string, open: boolean): PanelAction => ({
    fn: 'group',
    args: [name],
    kwargs: { action: open ? 'open' : 'close' },
    echo: `group ${quoteName(name)}, action=${open ? 'open' : 'close'}`,
    invalidatesNames: true,
  }),

  /** `cmd.order("<a> <b>", location=...)` — the reorder the drag emits. */
  order: (names: readonly string[], location: 'current' | 'upper'): PanelAction => {
    const list = names.join(' ');
    return {
      fn: 'order',
      args: [list],
      kwargs: { location },
      echo: `order ${list}, location=${location}`,
      invalidatesNames: true,
    };
  },

  /** `group <parent>, <child>` — drop onto an open group. */
  groupAdd: (parent: string, child: string): PanelAction => ({
    fn: 'group',
    args: [parent, child],
    kwargs: { action: 'add' },
    echo: `group ${quoteName(parent)}, ${quoteName(child)}`,
    invalidatesNames: true,
  }),

  /** `ungroup <child>` — drop below the last row while inside a group. */
  ungroup: (child: string): PanelAction => ({
    fn: 'ungroup',
    args: [child],
    echo: `ungroup ${quoteName(child)}`,
    invalidatesNames: true,
  }),

  /** `cmd.disable('all')` — the middle+ctrl+shift exclusive activate. */
  disableAll: (): PanelAction => ({
    fn: 'disable',
    args: ['all'],
    echo: 'disable all',
  }),
} as const;

/* ------------------------------------------------------------------ *
 * The drag-to-reorder rules (`Executive.cpp:15809-15935`), as data
 * ------------------------------------------------------------------ */

/** One row as the drag-to-reorder logic sees it: name, group, and role flags. */
export interface DragRow {
  name: string;
  group: string;
  isGroup: boolean;
  isOpen?: boolean | undefined;
  isAll: boolean;
}

/** The resolved outcome of a drop: do nothing, reorder, group, or ungroup. */
export type DropPlan =
  | { kind: 'none'; why: string }
  | { kind: 'order'; names: [string, string]; location: 'current' | 'upper' }
  | { kind: 'group'; parent: string; child: string }
  | { kind: 'ungroup'; child: string };

/** True when `candidate` is `ancestor` or lives (transitively) inside it. */
export function isChildOf(
  rows: readonly DragRow[],
  candidate: DragRow,
  ancestor: DragRow,
): boolean {
  const byName = new Map(rows.map((row) => [row.name, row]));
  let cursor: DragRow | undefined = candidate;
  const seen = new Set<string>();
  while (cursor && cursor.group !== '' && !seen.has(cursor.name)) {
    seen.add(cursor.name);
    if (cursor.group === ancestor.name) return true;
    cursor = byName.get(cursor.group);
  }
  return false;
}

/**
 * What `ExecutiveDragMode::Reorder` would do, for a drag from row `pressed` to
 * row `over` (both indices into the VISIBLE row list, `all` included at 0).
 *
 * `over === rows.length` means "dragged past the last row", which is the
 * `mov_rec && !new_rec && Over > Pressed` branch: the row leaves its group and
 * joins its group's group (`:15843-15848`).
 */
export function planDrop(
  rows: readonly DragRow[],
  pressed: number,
  over: number,
): DropPlan {
  const moved = rows[pressed];
  if (!moved || moved.isAll) return { kind: 'none', why: 'the `all` row does not move' };
  if (pressed === over) return { kind: 'none', why: 'no movement' };

  const target = rows[over];
  if (!target) {
    // Dragged past the end: pop out one group level.
    if (over > pressed && moved.group !== '') {
      const parent = rows.find((row) => row.name === moved.group);
      const grandparent = parent?.group ?? '';
      return grandparent
        ? { kind: 'group', parent: grandparent, child: moved.name }
        : { kind: 'ungroup', child: moved.name };
    }
    return { kind: 'none', why: 'nothing under the pointer' };
  }
  if (target.isAll) return { kind: 'none', why: 'cannot drop above the `all` row' };
  if (isChildOf(rows, target, moved)) {
    // "do nothing when a group is dragged over one of its members" (:15845).
    return { kind: 'none', why: 'a group cannot be dropped onto its own member' };
  }

  // Dropping onto an OPEN group puts the row inside it and emits no order
  // (:15866-15874).
  if (target.isGroup && target.isOpen && moved.group !== target.name) {
    return { kind: 'group', parent: target.name, child: moved.name };
  }

  return pressed < over
    ? { kind: 'order', names: [target.name, moved.name], location: 'current' }
    : { kind: 'order', names: [moved.name, target.name], location: 'upper' };
}
