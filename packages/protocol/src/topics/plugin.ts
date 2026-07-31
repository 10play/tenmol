/**
 * Topic `plugin` — the plugin surface.  OWNER: WP-25.
 *
 * PRODUCT OWNER DECISION: the Plugin Manager ships **READ-ONLY** for v1 —
 * list + preferences + startup paths, and NO network install. This overrides
 * any wider reading of plan §B2.
 *
 * The APBS stub entry of §B1 appears here as a normal entry with
 * `available: false`.
 */

export interface PluginEntry {
  name: string;
  /** Module path as registered in `pymol.plugins`. */
  module: string;
  version: string;
  /** Autoload flag from the plugin preferences. */
  autoload: boolean;
  /** False when the plugin failed to import or is a stub (e.g. APBS). */
  available: boolean;
  /** Import error text when `available` is false, '' otherwise. */
  error: string;
}

export interface PluginPayload {
  plugins: PluginEntry[];
  /** `pymol.plugins.get_startup_path()` — read-only in v1. */
  startupPaths: string[];
  /** True: v1 never installs. The UI hides every install/remove affordance. */
  readOnly: true;
}
