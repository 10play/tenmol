/**
 * Topic `menu` — the PyMOL popup-menu engine.  OWNER: WP-13.
 *
 * `pymol.menu.*` resolved over the wire. Every leaf returns a COMMAND STRING
 * (`packages/engine/layer4/PopUp.cpp:471-475`, e.g. `packages/engine/modules/pymol/menu.py:824`), which the
 * client executes with `{t:'do'}` — allowed from the UI per plan §A6.
 * Declaring `do` console-only made WP-13 and WP-16 unimplementable.
 */

/** A resolved menu node. `command` and `children` are mutually exclusive. */
export interface MenuNode {
  label: string;
  /** Command string to run via `{t:'do'}`. Absent for submenus and separators. */
  command?: string;
  /** Present for submenus. */
  children?: MenuNode[];
  /** True for a separator row (PyMOL emits these as blank/'-' entries). */
  separator?: boolean;
  /** Check/radio state, when the leaf mirrors a setting. */
  checked?: boolean;
}

export interface MenuPayload {
  /** The `pymol.menu` function that was resolved, e.g. 'mol_show'. */
  menu: string;
  /** The object/selection the menu was opened on. */
  target: string;
  nodes: MenuNode[];
}
