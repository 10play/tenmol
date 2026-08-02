/**
 * The legacy plugin menu, as JSON descriptors — inventory row 76, option (b).
 *
 * The row said the Tk/Qt plugin surface could be answered two ways: (a) a new
 * React plugin API, or (b) "keep plugins headless in Python and have them
 * register JSON menu descriptors (label path with `|`, id) over the bridge,
 * clicks RPC'd back — option (b) preserves `addmenuitem` semantics".
 *
 * This is the client half of (b). The server half is
 * `bridge/tenmol_bridge/panels/plugins.py`, which becomes `pymol._ext_gui` and
 * drives the REAL upstream `PmwMenuBar` over a recording menu dict, so a plugin
 * calling
 *
 *     pymol.plugins.addmenuitem('My Tool|Run', my_function)
 *
 * lands here as a tree keyed by the pipe-joined label path, and clicking a leaf
 * calls `my_function` on the engine thread.
 *
 * WHAT IS DELIBERATELY MISSING, because it is the whole point: no Tk, no Qt, no
 * `sys.meta_path` hook, and `plugins.addmenuitemqt` stays REFUSED — that call
 * asserts the plugin opens a PyQt window, which would open on the server's
 * display rather than in this browser.
 */

/** Minimal slice of `Session`; keeps this module React-free and testable. */
export type CallFn = <T>(fn: string, args?: readonly unknown[]) => Promise<T>;
export type RunFn = (line: string) => Promise<void>;

export const PLUGINS_NS = 'cmd.tenmol_plugins';
/** One `{t:'do'}` line; the bootstrap every panel added since wave 5 uses. */
export const PLUGINS_BOOTSTRAP = '/import tenmol_bridge.panels.plugins as _p;_p.install()';

export interface LegacyMenuItem {
  kind: 'command' | 'separator' | 'menu';
  index: number;
  label: string;
  /** Cascades only: the pipe-joined path, and the handle `invoke` takes. */
  key?: string | null;
  items?: LegacyMenuItem[];
}

export interface LegacyMenu {
  key: string;
  label: string;
  items: LegacyMenuItem[];
}

export interface LegacyMenuReply {
  ok: boolean;
  reason?: string;
  menus?: LegacyMenu[];
  keys?: string[];
}

export interface InvokeReply {
  ok: boolean;
  label?: string;
  error?: string;
  note?: string;
}

/**
 * Attach the registry, then read it.
 *
 * Probe-then-bootstrap, the same shape `filesApi.ensure()` and the compute
 * panel use: a reconnect costs one round trip, not two, and the bootstrap is
 * idempotent on the server anyway.
 */
export async function ensureRegistry(call: CallFn, run: RunFn): Promise<void> {
  try {
    await call(`${PLUGINS_NS}.hello`);
  } catch {
    await run(PLUGINS_BOOTSTRAP);
  }
}

export async function readMenu(call: CallFn): Promise<LegacyMenu[]> {
  const reply = await call<LegacyMenuReply>(`${PLUGINS_NS}.menu`);
  if (!reply?.ok || !Array.isArray(reply.menus)) return [];
  return reply.menus;
}

export async function invokeLeaf(
  call: CallFn,
  key: string,
  index: number,
): Promise<InvokeReply> {
  return await call<InvokeReply>(`${PLUGINS_NS}.invoke`, [key, index]);
}

/**
 * The tree flattened for rendering, one row per entry, depth carried.
 *
 * Only the ROOT menus are walked (`Plugin`, `PluginQt`, and whatever cascades
 * hang off them); the reply also lists every cascade as a top-level entry so it
 * can be addressed directly, and rendering both would show each submenu twice.
 */
export interface LegacyRow {
  kind: 'command' | 'separator' | 'menu';
  label: string;
  depth: number;
  /** For a command: the menu it belongs to plus its index. */
  menuKey: string;
  index: number;
  /** True when the row is a leaf that can be clicked. */
  clickable: boolean;
}

export const ROOT_KEYS = ['Plugin', 'PluginQt'];

export function flattenMenus(menus: readonly LegacyMenu[]): LegacyRow[] {
  const rows: LegacyRow[] = [];
  const walk = (key: string, items: readonly LegacyMenuItem[], depth: number) => {
    for (const item of items) {
      rows.push({
        kind: item.kind,
        label: item.label,
        depth,
        menuKey: key,
        index: item.index,
        clickable: item.kind === 'command',
      });
      if (item.kind === 'menu') walk(item.key ?? '', item.items ?? [], depth + 1);
    }
  };
  for (const root of ROOT_KEYS) {
    const menu = menus.find((m) => m.key === root);
    if (!menu) continue;
    rows.push({
      kind: 'menu',
      label: menu.label,
      depth: 0,
      menuKey: menu.key,
      index: -1,
      clickable: false,
    });
    walk(menu.key, menu.items, 1);
  }
  return rows;
}

/** How many clickable leaves a tree holds — "is anything registered at all". */
export function leafCount(menus: readonly LegacyMenu[]): number {
  return flattenMenus(menus).filter((row) => row.clickable).length;
}
