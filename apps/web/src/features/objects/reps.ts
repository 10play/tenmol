/**
 * Which reps a show/hide menu leaf touches, so the client can draw a check
 * mark next to the ones already on.
 *
 * PyMOL DOES NOT DRAW THESE. `packages/engine/layer4/PopUp.cpp` has no notion of a checked
 * item — every `rep_action` leaf looks identical whether the rep is on or off,
 * and the only way to know is to look at the scene. The inventory row asks for
 * the check marks precisely because `cmd.get_vis()[name][2]` is on the wire
 * already (`panels/objects.py:rows` ships it as the `reps` bitmask) and the
 * information is free.
 *
 * The mapping is `packages/engine/modules/pymol/constants.py:repmasks` — INCLUDING the two
 * combinations, which is why a bitmask and not an index: `wire` is
 * `lines|nonbonded` and `licorice` is `sticks|nb_spheres`, so the `wire` leaf
 * of `mol_show` is "on" only when BOTH bits are set. `packages/bridge/tests/
 * test_p8_a2.py::test_rep_masks_match_pymols_own_table` diffs this table
 * against the live `pymol.constants.repmasks`, so a rename in PyMOL fails a
 * test here rather than silently mis-ticking a menu.
 */

/** `packages/engine/modules/pymol/constants.py:180-207`, verbatim. */
export const REP_MASKS: Readonly<Record<string, number>> = {
  everything: 0b000111111111111111111111,
  sticks: 0b000000000000000000000001,
  spheres: 0b000000000000000000000010,
  surface: 0b000000000000000000000100,
  labels: 0b000000000000000000001000,
  nb_spheres: 0b000000000000000000010000,
  cartoon: 0b000000000000000000100000,
  ribbon: 0b000000000000000001000000,
  lines: 0b000000000000000010000000,
  mesh: 0b000000000000000100000000,
  dots: 0b000000000000001000000000,
  dashes: 0b000000000000010000000000,
  nonbonded: 0b000000000000100000000000,
  cell: 0b000000000001000000000000,
  cgo: 0b000000000010000000000000,
  callback: 0b000000000100000000000000,
  extent: 0b000000001000000000000000,
  slice: 0b000000010000000000000000,
  angles: 0b000000100000000000000000,
  dihedrals: 0b000001000000000000000000,
  ellipsoids: 0b000010000000000000000000,
  volume: 0b000100000000000000000000,
  // combinations
  licorice: 0b000000000000000000010001, // sticks | nb_spheres
  wire: 0b000000000000100010000000, // lines | nonbonded
};

/**
 * The verbs whose FIRST argument is a representation name.
 * `rep_action` (`menu.py:145-176`) builds `cmd.<action>("<rep>","<sele>")` for
 * `show`, `hide`, `show_as` and `toggle`; `show_misc`, `mol_show` and the
 * per-type variants all go through the same shape.
 */
const REP_VERBS = new Set(['show', 'hide', 'show_as', 'toggle']);

const CALL = /^\s*cmd\.(\w+)\s*\(\s*(["'])(.*?)\2/;

/**
 * The rep bitmask a menu leaf's command string would change, or 0 when the
 * leaf is not a rep action at all (`cmd.flag(...)`, `cmd.color(...)`, a
 * multi-statement line, ...).
 */
export function repMaskOfCommand(command: string | undefined): number {
  if (!command) return 0;
  const match = CALL.exec(command);
  if (!match) return 0;
  const [, verb, , rep] = match;
  if (!verb || !rep || !REP_VERBS.has(verb)) return 0;
  // A leaf that does more than the one call (`cmd.flag(...);cmd.rebuild(...)`)
  // is not a plain rep toggle and must not be ticked.
  if (/;/.test(command)) return 0;
  return REP_MASKS[rep] ?? 0;
}

export type RepCheck = 'on' | 'partial' | 'off' | 'none';

/**
 * How a leaf should be ticked given the row's live rep bitmask.
 *
 * `everything` is deliberately excluded: `mol_hide`'s `everything` entry is not
 * a state, it is an action, and PyMOL's own `hide everything` leaf would
 * otherwise show as "on" for any visible object.
 */
export function repCheck(command: string | undefined, reps: number): RepCheck {
  const mask = repMaskOfCommand(command);
  if (mask === 0 || mask === REP_MASKS.everything) return 'none';
  const hit = reps & mask;
  if (hit === mask) return 'on';
  return hit === 0 ? 'off' : 'partial';
}
