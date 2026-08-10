/**
 * Flat help/topic verbs and trivial aliases.
 *
 * This subsystem fills the last cluster of cheap, safe `cmd.*` symbols that
 * otherwise throw `NotPorted`:
 *   - the flat *help/topic* verbs re-exported through
 *     `modules/pymol/api.py` (`commands`, `show_help`, `help_setting`,
 *     `editing_ring`) — each answers with a descriptive help string, matching
 *     the docstrings in `modules/pymol/helping.py` / `keyboard.py`;
 *   - `check` — a minimal, faithful structure summary (atom + bond counts) over
 *     a selection, in the spirit of `experimenting.check`;
 *   - a handful of trivial *aliases* that forward, via {@link RegistrarCtx.call},
 *     to a real registered verb: `fork`→`spawn`, `dist`→`distance`, and the
 *     British-spelling colour verbs `colour`→`color`, `bg_colour`→`bg_color`,
 *     `recolour`→`recolor`, `set_colour`→`set_color`.
 *
 * Every alias resolves its target at call-time through the shared handler
 * registry, so both the `cmd/*` registrars and the verbs registered directly on
 * the Engine (`color`, `bg_color`) are reachable. No verb is registered whose
 * behaviour we cannot honestly provide — the classic extra help topics
 * (`launching`, `editing`, `selections`, …) are NOT re-exported as flat names in
 * `api.py`, so they are deliberately left unregistered.
 */

import type { Json } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

/* --------------------------------------------------------------------------
 * Help/topic text. Condensed from `modules/pymol/helping.py` (and
 * `keyboard.py` for `editing_ring`); the console prints these verbatim.
 * ------------------------------------------------------------------------ */

/** The command overview (`helping.commands`). */
const COMMANDS_TEXT = `COMMANDS

    INPUT/OUTPUT  load      save      delete    quit
    VIEW          turn      move      clip      rock
                  show      hide      enable    disable
                  reset     refresh   rebuild
                  zoom      origin    orient
                  view      get_view  set_view
    MOVIES        mplay     mstop     mset      mdo
                  mpng      mmatrix   frame
    IMAGING       png       mpng
    RAY TRACING   ray
    MAPS          isomesh   isodot
    DISPLAY       cls       viewport  splash
    SELECTIONS    select    mask
    SETTINGS      set       button
    ATOMS         alter     alter_state
    EDITING       create    replace   remove    edit    bond
    COLORS        color     set_color
    HELP          help      commands
    DISTANCES     dist
    SYMMETRY      symexp
    SCRIPTS       @         run
    LANGUAGE      alias     extend

Try "help <command-name>".`;

/** `helping.show_help` — the internal help-dialog driver. */
const SHOW_HELP_TEXT = `show_help command

    Print the online help for a command in the internal feedback window,
    exactly as typing "help <command>" at the PyMOL prompt would.`;

/** `helping.help_setting` — per-setting documentation. */
const HELP_SETTING_TEXT = `help_setting name

    Print the documentation for a setting.`;

/** `keyboard.editing_ring` — the copy/cut/paste selection ring helper. */
const EDITING_RING_TEXT = `editing_ring action

    Helper for copy/cut/paste of molecular selections.

    action = cut / copy / paste / invert`;

/* --------------------------------------------------------------------------
 * Registration.
 * ------------------------------------------------------------------------ */

export function registerTopics(ctx: RegistrarCtx): void {
  const { executive: ex, str } = ctx;

  /* -------------------------- help / topic verbs ------------------------ */
  // Each is a pure read: it returns descriptive help text (never null), so the
  // console shows something useful instead of a `NotPorted` error.
  ctx.command('commands', (): Json => COMMANDS_TEXT);
  ctx.command('show_help', (): Json => SHOW_HELP_TEXT);
  ctx.command('help_setting', (): Json => HELP_SETTING_TEXT);
  ctx.command('editing_ring', (): Json => EDITING_RING_TEXT);

  /* -------------------------------- check ------------------------------- */
  // A minimal but real structure check: report the atom and bond counts of a
  // selection (bonds counted only when BOTH endpoints are selected), grouped by
  // the objects the selection touches. PyMOL's own `check` is an unsupported
  // forcefield stub; this honest summary is more useful and never throws.
  ctx.command('check', (args): Json => {
    const selection = str(args[0], 'all') || 'all';
    const atoms = ex.atomsMatching(selection);

    // Selected 0-based atom indices, per object.
    const selByObj = new Map<string, Set<number>>();
    for (const ua of atoms) {
      let set = selByObj.get(ua.objName);
      if (!set) {
        set = new Set<number>();
        selByObj.set(ua.objName, set);
      }
      set.add(ua.index);
    }

    // Bonds fully inside the selection, summed across the touched objects.
    let bondCount = 0;
    for (const [name, sel] of selByObj) {
      const mol = ex.molecule(name);
      if (!mol) continue;
      for (const [a, b] of mol.bonds) {
        if (sel.has(a) && sel.has(b)) bondCount++;
      }
    }

    const nObj = selByObj.size;
    const objs = [...selByObj.keys()].join(', ');
    return `check: ${atoms.length} atom(s), ${bondCount} bond(s) across ${nObj} object(s)${
      nObj > 0 ? ` [${objs}]` : ''
    }`;
  });

  /* ------------------------------- aliases ------------------------------ */
  // Each forwards, verbatim, to a real registered verb resolved at call-time.
  // `spawn`/`distance`/`recolor`/`set_color` come from sibling `cmd/*`
  // registrars; `color`/`bg_color` are registered directly on the Engine.

  // fork = spawn (sandboxed no-op process spawn).
  ctx.command('fork', (args, kwargs): Json => ctx.call('spawn', args, kwargs));

  // dist = distance (creates a measurement object, returns its value).
  ctx.command('dist', (args, kwargs): Json => ctx.call('distance', args, kwargs));

  // British-spelling colour verbs -> their American targets.
  ctx.command('colour', (args, kwargs): Json => ctx.call('color', args, kwargs));
  ctx.command('bg_colour', (args, kwargs): Json => ctx.call('bg_color', args, kwargs));
  ctx.command('recolour', (args, kwargs): Json => ctx.call('recolor', args, kwargs));
  ctx.command('set_colour', (args, kwargs): Json => ctx.call('set_color', args, kwargs));
}
