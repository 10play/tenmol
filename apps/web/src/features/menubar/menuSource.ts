/**
 * The client half of `packages/bridge/tenmol_bridge/panels/menus.py`.
 *
 * The panel binds itself onto the live `cmd` when the bootstrap line runs, so
 * the first call may legitimately fail with `no such symbol`; that failure is
 * the trigger to bootstrap and retry once. A second failure is real and
 * propagates. This is the same handshake the object panel and the settings feed
 * use — one convention for every `panels/*.py` module.
 *
 * Everything here degrades: the menu TREE has a checked-in generated copy that
 * is byte-identical to what the endpoint returns (proved by
 * `packages/bridge/tests/test_menus.py::test_generated_typescript_matches_a_fresh_harvest`),
 * so a bridge that refuses the bootstrap still renders a complete menu bar. The
 * live endpoint buys three things the generated copy cannot: the ~110 setting
 * values in ONE round trip instead of 111, the `~/.pymol/recent.db` list, and
 * immunity to the generated file going stale in someone's working tree.
 */

import type { MenuSettingValue, MenusPayload } from '@tenmol/protocol/topics/menus';

/** Must match `panels/menus.py:ATTRIBUTE`. */
export const PANEL_SYMBOL = 'tenmol_menus';

/** `/` makes PyMOL's parser treat the rest as Python (`packages/engine/modules/pymol/parser.py`). */
export const BOOTSTRAP = '/from tenmol_bridge.panels.menus import install;install()';

/** The two transports `createMenuSource` needs: a `{t:'call'}` and a `{t:'do'}`. */
export interface MenuSourceOptions {
  call<T>(fn: string, args?: readonly unknown[]): Promise<T>;
  do(commandLine: string): Promise<void>;
}

/** The menu bar's bridge side: menus, setting values, and the recent-files list. */
export interface MenuSource {
  /** True once a call has succeeded. */
  readonly ready: boolean;
  menus(): Promise<MenusPayload>;
  settings(names?: readonly string[]): Promise<Record<string, MenuSettingValue>>;
  recent(): Promise<string[]>;
  addRecent(path: string): Promise<string[]>;
  reset(): void;
}

/** Wire the menu panel to the bridge, bootstrapping the backend module on first miss. */
export function createMenuSource(options: MenuSourceOptions): MenuSource {
  let installed = false;
  let bootstrapping: Promise<void> | null = null;

  async function bootstrap(): Promise<void> {
    if (!bootstrapping) {
      bootstrapping = Promise.resolve()
        .then(() => options.do(BOOTSTRAP))
        .then(
          () => undefined,
          () => undefined,
        );
    }
    await bootstrapping;
    bootstrapping = null;
  }

  async function invoke<T>(verb: string, args: readonly unknown[] = []): Promise<T> {
    try {
      const value = await options.call<T>(PANEL_SYMBOL, [verb, ...args]);
      installed = true;
      return value;
    } catch (error) {
      if (installed) throw error;
      await bootstrap();
      const value = await options.call<T>(PANEL_SYMBOL, [verb, ...args]);
      installed = true;
      return value;
    }
  }

  return {
    get ready() {
      return installed;
    },
    menus: () => invoke<MenusPayload>('menus'),
    settings: (names) =>
      invoke<Record<string, MenuSettingValue>>('settings', names ? [[...names]] : []),
    recent: () => invoke<string[]>('recent'),
    addRecent: (path) => invoke<string[]>('recent_add', [path]),
    reset() {
      installed = false;
    },
  };
}
