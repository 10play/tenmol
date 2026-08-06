/**
 * The object panel ("names list", the Executive block).
 *
 * In PyMOL this is drawn by C++ INSIDE the GL viewport (`CExecutive::draw`,
 * `packages/engine/layer3/Executive.cpp:16116-16541`). Here it is real DOM, fed by
 * `packages/bridge/tenmol_bridge/panels/objects.py` through `panelSource.ts`, with the
 * two-call poll in `@tenmol/stores/objectsSource` as the fallback when that
 * endpoint is unreachable.
 *
 * Row anatomy, left to right (`docs/internal-gui.md` §1.2):
 *   group [+]/[-] | indent (nest_level × 8px) | name button | caption |
 *   A S H L C (M) toggles, each 17 px wide, right-aligned
 *
 * Click semantics reproduced from `CExecutive::click` (`:15300-15400`),
 * `CExecutive::drag` (`:15660-15990`) and `ExecutiveSpecSetVisibility`
 * (`:15413-15487`):
 *
 *   left                      DeferVisibility: the toggle lands on RELEASE, and
 *                             a vertical drag applies it to every row in the
 *                             band between press and release
 *   shift+left                ImmediateVisibility: toggles as you go
 *   ctrl+left                 HoverActivate: enable only, disabling whichever
 *                             row was activated by the previous hover
 *   ctrl+shift+left           HoverActivate + zoom
 *   middle                    center and activate, deactivating the previous
 *   ctrl+middle               zoom and activate, deactivating the previous
 *   ctrl+shift+middle         disable ALL, then enable only this one
 *   right drag                reorder / re-group (see `actions.ts:planDrop`)
 *   group [+]/[-]             cmd.group(name, action='open'|'close') — server
 *                             truth, because a CLOSED group's children are not
 *                             rows at all (`PanelListGroup`, `:1554-1560`)
 *   wheel                     scrolls exactly one row (`:15016-15022`)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PanelMenuNode } from '@tenmol/protocol';
import { panelActions } from '@tenmol/stores';
import {
  displayName,
  menuKey,
  parseColorCodes,
  visibleRows,
  type PanelRow,
} from '@tenmol/stores/objects';
import { useSession, useStore } from '../../app';
import { rowActions, planDrop, type DragRow } from './actions';
import { createPanelSource } from './panelSource';
import { RowMenu } from './RowMenu';
import { menuNameFor, MOTION_OP, OPS, rowKind, type OpButton } from './menus';
import { nameTextColor, rowFillName } from './rowStyle';
import { specClass } from './specLevel';
import './objects.css';

/** `internal_gui_control_size` default is 18 DIP; rows are that tall. */
const ROW_HEIGHT = 18;

/** Panel refresh. The endpoint costs 0.09 ms server-side; 8 Hz is invisible. */
const SNAPSHOT_HZ = 8;
const HIDDEN_HZ = 1;

interface OpenMenu {
  row: PanelRow;
  op: OpButton;
  anchor: { x: number; y: number };
}

type DragMode = 'visibility' | 'reorder';
type ToggleMode = 'defer' | 'immediate' | 'hover' | 'hoverZoom';

interface DragState {
  mode: DragMode;
  toggle: ToggleMode;
  pressed: number;
  over: number;
  /** The value a DeferVisibility band write will apply. */
  target: boolean;
  lastChanged: string | null;
}

/** The object tree panel: rows for every object/selection with visibility, colour and menus. */
export function ObjectPanel() {
  const session = useSession();
  const store = session.stores.objects;
  const rows = useStore(store, (s) => s.rows);
  const collapsed = useStore(store, (s) => s.collapsed);
  const feed = useStore(store, (s) => s.feed);
  const panel = useStore(store, (s) => s.panel);
  const menus = useStore(store, (s) => s.menus);
  const error = useStore(store, (s) => s.lastError);
  const phase = useStore(session.stores.connection, (s) => s.phase);

  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // `ObjectGetSpecLevel(obj, SceneGetFrame(G))` per object, from the same
  // snapshot call. Not on `PanelRow`: it is per-FRAME state and the row list
  // is not, so it lives beside the rows rather than inside them.
  const [specLevels, setSpecLevels] = useState<Record<string, number>>({});
  const [guiMode, setGuiMode] = useState(0);
  // The drag lives in a REF, mirrored into state only so the band can be
  // highlighted. React batches state updates, so a press and the release that
  // follows it in the same task would both read `drag === null` — which is
  // exactly what a synthetic pointerdown/pointerup pair does, and what a fast
  // real click can do too. `CExecutive` keeps `Pressed`/`Over`/`DragMode` in
  // the block, not in the frame it draws, and so do we.
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDragBand] = useState<DragState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setDrag = useCallback((state: DragState | null) => {
    dragRef.current = state;
    setDragBand(state);
  }, []);

  const source = useMemo(
    () =>
      createPanelSource({
        call: (fn, args, kwargs) => session.call(fn, args, kwargs),
        do: (line) => session.conn.do(line),
      }),
    [session],
  );

  /* ------------------------------------------------------------------ *
   * the snapshot loop
   * ------------------------------------------------------------------ */
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopped) return;
      if (phase === 'open') {
        try {
          const snapshot = await source.snapshot();
          if (!stopped) {
            store.applySnapshot(snapshot);
            setSpecLevels(snapshot.specLevels ?? {});
            setGuiMode(snapshot.internalGuiMode ?? 0);
          }
        } catch (fault) {
          if (!stopped) {
            // Hand the panel back to the two-call poll rather than showing a
            // stale tree: the fallback is worse (inferred nesting, no
            // captions) but it is honest and it keeps working.
            store.releasePanelFeed();
            store.setError(panelUnavailable(fault));
          }
        }
      }
      const hz = document.visibilityState === 'hidden' ? HIDDEN_HZ : SNAPSHOT_HZ;
      timer = setTimeout(() => void tick(), 1000 / hz);
    };

    void tick();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      store.releasePanelFeed();
    };
  }, [source, store, phase]);

  // `P_GLUT_BUTTON_SCROLL_*` moves the panel scrollbar by exactly ONE ROW
  // (Executive.cpp:15016-15022), not by a pixel delta. React registers `onWheel`
  // through a PASSIVE root listener, so `event.preventDefault()` from JSX is
  // ignored with a console warning and the browser scrolls by its own delta on
  // top of ours — the listener has to be attached by hand.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (el.scrollHeight <= el.clientHeight) return;
      event.preventDefault();
      el.scrollTop += Math.sign(event.deltaY) * ROW_HEIGHT;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // A reconnect can be a different bridge process; forget both the endpoint
  // and every cached menu (they embed object names and colour indices).
  useEffect(() => {
    if (phase !== 'open') {
      source.reset();
      store.clearMenus();
    }
  }, [phase, source, store]);

  /* ------------------------------------------------------------------ *
   * rows
   * ------------------------------------------------------------------ */
  // With the panel feed, a closed group's children are already absent (PyMOL
  // does not draw them either). Without it, `collapsed` is the client-side
  // stand-in and `visibleRows` applies it.
  const shown = feed === 'panel' ? rows : visibleRows(rows, collapsed);
  const ops = OPS.slice(0, panel.opCount || 5);

  const dragRows: DragRow[] = useMemo(
    () =>
      shown.map((row) => ({
        name: row.name,
        group: row.group,
        isGroup: row.isGroup,
        isOpen: row.isOpen,
        isAll: row.isAll,
      })),
    [shown],
  );

  const nameOf = (row: PanelRow) => (row.isAll ? 'all' : row.name);

  /* ------------------------------------------------------------------ *
   * visibility drag state machine (Executive.cpp:15300-15400, :15660-15760)
   * ------------------------------------------------------------------ */

  const applyBand = useCallback(
    async (state: DragState) => {
      const lo = Math.min(state.pressed, state.over);
      const hi = Math.max(state.pressed, state.over);
      for (let index = lo; index <= hi; index++) {
        const row = shown[index];
        if (!row) continue;
        const name = nameOf(row);
        if (row.enabled === state.target) continue;
        await session.act(
          state.target ? panelActions.enable(name) : panelActions.disable(name),
        );
      }
    },
    [session, shown],
  );

  const hoverActivate = useCallback(
    async (state: DragState, row: PanelRow) => {
      const name = nameOf(row);
      if (state.lastChanged && state.lastChanged !== name) {
        await session.act(panelActions.disable(state.lastChanged));
      }
      if (!row.enabled) await session.act(panelActions.enable(name));
      if (state.toggle === 'hoverZoom') await session.act(panelActions.zoom(name));
      state.lastChanged = name;
    },
    [session],
  );

  const onNamePointerDown = (row: PanelRow, index: number, event: React.PointerEvent) => {
    if (menu) setMenu(null);
    const name = nameOf(row);
    const ctrl = event.ctrlKey || event.metaKey;

    if (event.button === 2) {
      event.preventDefault();
      if (row.isAll) return;
      setDrag({
        mode: 'reorder',
        toggle: 'defer',
        pressed: index,
        over: index,
        target: false,
        lastChanged: null,
      });
      capture(event);
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      if (ctrl && event.shiftKey) {
        void session
          .act(rowActions.disableAll())
          .then(() => session.act(panelActions.enable(name)))
          .then(() => session.act(panelActions.zoom(name)));
        return;
      }
      void session
        .act(ctrl ? panelActions.zoom(name) : panelActions.center(name))
        .then(() => (row.enabled ? undefined : session.act(panelActions.enable(name))));
      return;
    }

    if (event.button !== 0) return;
    const state: DragState = {
      mode: 'visibility',
      toggle: 'defer',
      pressed: index,
      over: index,
      target: !row.enabled,
      lastChanged: null,
    };
    if (ctrl && event.shiftKey) {
      state.toggle = 'hoverZoom';
      void hoverActivate(state, row);
    } else if (event.shiftKey) {
      state.toggle = 'immediate';
      void session.act(
        state.target ? panelActions.enable(name) : panelActions.disable(name),
      );
    } else if (ctrl) {
      state.toggle = 'hover';
      void hoverActivate(state, row);
    }
    setDrag(state);
    capture(event);
  };

  const onRowsPointerMove = (event: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    const index = rowIndexAt(listRef.current, event.clientY, shown.length);
    if (index === current.over) return;
    const next = { ...current, over: index };
    setDrag(next);
    if (current.mode !== 'visibility') return;
    const row = shown[index];
    if (!row) return;
    if (current.toggle === 'immediate') {
      const name = nameOf(row);
      if (row.enabled !== current.target) {
        void session.act(
          current.target ? panelActions.enable(name) : panelActions.disable(name),
        );
      }
    } else if (current.toggle === 'hover' || current.toggle === 'hoverZoom') {
      void hoverActivate(next, row);
    }
  };

  const onRowsPointerUp = () => {
    const state = dragRef.current;
    if (!state) return;
    setDrag(null);
    if (state.mode === 'reorder') {
      const plan = planDrop(dragRows, state.pressed, state.over);
      switch (plan.kind) {
        case 'order':
          void session.act(rowActions.order(plan.names, plan.location));
          break;
        case 'group':
          void session.act(rowActions.groupAdd(plan.parent, plan.child));
          break;
        case 'ungroup':
          void session.act(rowActions.ungroup(plan.child));
          break;
        case 'none':
          break;
      }
      return;
    }
    if (state.toggle === 'defer') void applyBand(state);
  };

  /* ------------------------------------------------------------------ *
   * menus
   * ------------------------------------------------------------------ */

  const openMenu = (row: PanelRow, op: OpButton, element: HTMLElement) => {
    const kind = rowKind(row);
    if (menuNameFor(kind, op) === null) return; // PyMOL draws it and does nothing
    const rect = element.getBoundingClientRect();
    setMenu({ row, op, anchor: { x: rect.left - 200, y: rect.bottom + 2 } });
    const name = nameOf(row);
    void source
      .menu(name, op, kind)
      .then((payload) => store.cacheMenu({ ...payload, name, op }))
      .catch((fault) => store.setError(`menu ${op}: ${String(fault)}`));
  };

  const expandMenu = useCallback(
    (path: readonly number[]) => {
      if (!menu) return;
      const name = nameOf(menu.row);
      const key = menuKey(name, menu.op);
      const cached = store.get().menus[key];
      if (nodeAtPath(cached?.items ?? [], path)?.items) return; // already resolved
      void source
        .expand(name, menu.op, path, rowKind(menu.row))
        .then((payload) => store.expandMenu(name, menu.op, path, payload.items))
        .catch((fault) => store.setError(`expand: ${String(fault)}`));
    },
    [menu, source, store],
  );

  const openPayload = menu ? menus[menuKey(nameOf(menu.row), menu.op)] : undefined;

  /* ------------------------------------------------------------------ */

  return (
    <div className="objpanel">
      <div className="objpanel__head">
        <span className="objpanel__head-title">Objects</span>
        <span className="objpanel__head-note" title={`row source: ${feed}`}>
          {feed === 'panel' ? 'panel' : feed === 'topic' ? 'pushed' : 'polled'}
        </span>
      </div>

      {error && <div className="objpanel__error">{error}</div>}

      {shown.length === 0 && (
        <div className="objpanel__empty">
          {phase === 'open'
            ? 'no objects — type `fragment ala` below'
            : 'not connected to a bridge'}
        </div>
      )}

      <div
        className="objpanel__rows"
        ref={listRef}
        onPointerMove={onRowsPointerMove}
        onPointerUp={onRowsPointerUp}
        onPointerCancel={onRowsPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {shown.map((row, index) => {
          // `but_color` (Executive.cpp:16443-16463) and, from it, the name
          // colour: `getNameColor` is handed the FILL as its background and
          // falls back to the default text colour when the object colour is
          // within 0.1 of it (`:16469`).
          const fill = rowFillName({
            enabled: row.enabled,
            cloaked: row.cloaked,
            pressed: Boolean(drag && inBand(drag, index)),
          });
          const nameColor = nameTextColor(row.nameColor, fill);
          return (
          <div
            className={
              'objrow' +
              (row.enabled ? ' is-enabled' : '') +
              (row.cloaked ? ' is-cloaked' : '') +
              (row.isAll ? ' objrow--all' : '') +
              (drag && inBand(drag, index) ? ' is-pressed' : '') +
              (drag?.mode === 'reorder' && drag.over === index ? ' is-droptarget' : '')
            }
            key={row.name}
            data-row-index={index}
            data-fill={fill}
          >
            {row.isGroup ? (
              <button
                type="button"
                className="objrow__group"
                title={isOpen(row, collapsed) ? 'collapse group' : 'expand group'}
                onClick={() => {
                  if (feed === 'panel') {
                    void session.act(rowActions.groupOpen(row.name, !isOpen(row, collapsed)));
                  } else {
                    store.toggleCollapsed(row.name);
                  }
                }}
              >
                {isOpen(row, collapsed) ? '-' : '+'}
              </button>
            ) : (
              <span className="objrow__group objrow__group--empty" />
            )}

            <button
              type="button"
              className="objrow__name"
              style={{
                ...(row.nest > 0 ? { marginLeft: row.nest * 8 } : null),
                ...(nameColor ? { color: cssColor(nameColor) } : null),
              }}
              title={rowTooltip(row)}
              onPointerDown={(e) => onNamePointerDown(row, index, e)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className="objrow__name-text">{displayName(row, panel.settings)}</span>
              {row.caption && (
                <span className="objrow__caption">
                  {parseColorCodes(row.caption).map((span, i) => (
                    <span key={i} style={span.color ? { color: span.color } : undefined}>
                      {span.text}
                    </span>
                  ))}
                </span>
              )}
            </button>

            <div className="objrow__ops">
              {ops.map((op) => {
                const target = menuNameFor(rowKind(row), op);
                // The M button alone is tinted by the row's motion spec level
                // at the CURRENT frame (Executive.cpp:16362-16381).
                const spec =
                  op === MOTION_OP ? specClass(specLevels[nameOf(row)]) : 'none';
                return (
                  <button
                    type="button"
                    key={op}
                    className={
                      `objrow__op objrow__op--${op.toLowerCase()}` +
                      (target === null ? ' is-inert' : '') +
                      (op === MOTION_OP ? ` is-spec-${spec}` : '')
                    }
                    {...(op === MOTION_OP ? { 'data-spec': spec } : {})}
                    title={
                      op === MOTION_OP && spec !== 'none'
                        ? `M — pymol.menu.${target} · motion spec level ${
                            spec === 'key' ? '2 (key frame)' : '1 (interpolated)'
                          }`
                        : target
                          ? `${op} — pymol.menu.${target}`
                          : `${op} — no menu`
                    }
                    onClick={(e) => openMenu(row, op, e.currentTarget)}
                  >
                    {op}
                  </button>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      {menu && (
        <RowMenu
          title={nameOf(menu.row)}
          op={menu.op}
          menuName={openPayload?.menu ?? menuNameFor(rowKind(menu.row), menu.op)}
          items={openPayload?.items ?? []}
          loading={!openPayload}
          error={null}
          anchor={menu.anchor}
          reps={menu.row.reps}
          internalGuiMode={guiMode}
          onPick={(command) => {
            setMenu(null);
            if (command) void session.run(command);
          }}
          onExpand={expandMenu}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * helpers (pure — unit tested in ObjectPanel.test.ts)
 * ------------------------------------------------------------------ */

/**
 * `OrthoGrab` (`Executive.cpp:15398`) — keep receiving move/up after the pointer
 * leaves the row. A synthetic PointerEvent has no active pointer, so this throws
 * in tests and in some assistive-tech paths; losing capture degrades the drag,
 * it must not take the panel down with it.
 */
function capture(event: React.PointerEvent): void {
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    /* no active pointer: the drag still works, it just is not captured */
  }
}

/** Whether a group row is expanded, preferring its own flag over the collapsed set. */
export function isOpen(row: PanelRow, collapsed: readonly string[]): boolean {
  return row.isOpen !== undefined ? row.isOpen : !collapsed.includes(row.name);
}

/** Whether a row index falls inside the current visibility-drag band. */
export function inBand(drag: { pressed: number; over: number; mode: string }, index: number) {
  if (drag.mode !== 'visibility') return false;
  return index >= Math.min(drag.pressed, drag.over) && index <= Math.max(drag.pressed, drag.over);
}

/** `[r,g,b]` in 0..1 (PyMOL's `ColorGet`) -> CSS. */
export function cssColor(rgb: readonly number[]): string {
  const channel = (index: number) =>
    Math.max(0, Math.min(255, Math.round((rgb[index] ?? 0) * 255)));
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** Which visible row a client Y coordinate is over; `rows` when past the end. */
export function rowIndexAt(
  container: HTMLElement | null,
  clientY: number,
  count: number,
): number {
  if (!container) return 0;
  const rect = container.getBoundingClientRect();
  const offset = clientY - rect.top + container.scrollTop;
  const index = Math.floor(offset / ROW_HEIGHT);
  if (index < 0) return 0;
  return index >= count ? count : index;
}

/** Walk a nested menu tree by index path to the node it points at, or undefined. */
export function nodeAtPath(
  items: readonly PanelMenuNode[],
  path: readonly number[],
): PanelMenuNode | undefined {
  let level: readonly PanelMenuNode[] = items;
  let node: PanelMenuNode | undefined;
  for (const index of path) {
    node = level[index];
    if (!node) return undefined;
    level = node.items ?? [];
  }
  return node;
}

function panelUnavailable(fault: unknown): string {
  const text = fault instanceof Error ? fault.message : String(fault);
  return `object-panel endpoint unavailable (${text}) — falling back to get_names/get_vis polling: group nesting is inferred and captions are missing`;
}

function rowTooltip(row: PanelRow): string {
  const bits = [row.name, row.type];
  if (row.caption) bits.push(row.caption);
  if (row.color !== null) bits.push(`color index ${row.color}`);
  if (row.cloaked) bits.push('cloaked (enabled inside a disabled group)');
  if (row.nestInferred) bits.push(`group "${row.group}" inferred from the dotted name`);
  bits.push('click: toggle · shift: immediate · ctrl: activate · ctrl+shift: +zoom');
  bits.push('middle: center · right-drag: reorder');
  return bits.join(' · ');
}
