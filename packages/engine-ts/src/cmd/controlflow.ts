/**
 * The `controlflow` command subsystem: PyMOL's control-flow / session / system
 * glue that, in a browser sandbox, is either a coordinate undo/redo stack or a
 * deliberate, side-effect-free no-op.
 *
 * WHAT IS REAL HERE
 * - A minimal coordinate/atom-state **undo/redo stack** (PyMOL's `CUndo`,
 *   `layer3/Executive.cpp:ExecutiveSaveUndo`). `push_undo(selection, state)`
 *   snapshots the current coordinates of the matched atoms; `undo()` restores
 *   the most recent snapshot (capturing the pre-restore coordinates onto the
 *   redo stack so `redo()` can re-apply them). This is a real, working undo of
 *   the last *recorded* coordinate mutation: a mutating command (or a test)
 *   calls `push_undo` before it edits coordinates, exactly as PyMOL does.
 * - `pop(name, source)` — PyMOL's `cmd.pop`: take one atom out of the named
 *   selection `source` and place it (alone) into the selection `name`. Returns
 *   1 if an atom was moved, 0 if `source` was empty.
 * - `set_key` / `button` / `mouse` / `config_mouse` record their binding into a
 *   module-local map, observable through the added `get_key_bindings()` getter.
 *
 * WHAT IS A DOCUMENTED NO-OP (never touches the real FS / shell / process)
 * - `run` / `spawn` / `system` — in the browser there is no filesystem or shell,
 *   so these return `null` WITHOUT executing anything (they do not throw).
 * - `sync` / `abort` / `accept` / `ending` / `splash` / `update` /
 *   `rebuild_all` — session lifecycle / render-refresh signals with nothing to
 *   drive locally; they succeed inertly (`null`).
 * - `api` — returns `null`.
 *
 * NOTE ON OWNERSHIP: several of these names (`undo`, `redo`, `sync`, `splash`,
 * `update`, `api`) are also registered as bare stubs by the `system` subsystem.
 * This registrar runs LAST (`ALL_REGISTRARS`), so its handlers win; the undo
 * stack here supersedes the inert `system` stubs. `get_version` is a FIXED stub
 * in engine.ts and is intentionally NOT redefined.
 */
import type { RegistrarCtx } from './registrar';
import type { Json } from '@tenmol/protocol';
import type { Executive } from '../exec/executive';

/**
 * One recorded coordinate snapshot: the (object, atom, state) coordinates as
 * they were at capture time. Atoms are addressed by object *name* + per-object
 * atom index + 1-based state so a snapshot survives object-reference churn and
 * is re-resolved against the live executive at apply time.
 */
interface UndoEntry {
  objName: string;
  index: number;
  state: number;
  xyz: [number, number, number];
}
type Snapshot = UndoEntry[];

/** Module-global session state (PyMOL keeps one undo history per session). */
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
/** Recorded input bindings: `set_key`/`button`/`mouse`/`config_mouse`. */
const keyBindings = new Map<string, string>();

/** Normalise a state argument: PyMOL state 0 (current) / -1 map to state 1. */
function normState(state: number): number {
  return Number.isFinite(state) && state >= 1 ? Math.trunc(state) : 1;
}

/** Snapshot the current coordinates of every atom matching `sel` in `state`. */
function capture(ex: Executive, sel: string, state: number): Snapshot {
  const st = normState(state);
  const snap: Snapshot = [];
  for (const ua of ex.atomsMatching(sel)) {
    const mol = ex.molecule(ua.objName);
    if (!mol) continue;
    const [x, y, z] = mol.coord(ua.index, st);
    snap.push({ objName: ua.objName, index: ua.index, state: st, xyz: [x, y, z] });
  }
  return snap;
}

/** Read the current coordinates for the atoms named by `snap` (for the inverse). */
function captureLike(ex: Executive, snap: Snapshot): Snapshot {
  const out: Snapshot = [];
  for (const e of snap) {
    const mol = ex.molecule(e.objName);
    if (!mol) continue;
    const [x, y, z] = mol.coord(e.index, e.state);
    out.push({ objName: e.objName, index: e.index, state: e.state, xyz: [x, y, z] });
  }
  return out;
}

/** Write a snapshot's coordinates back into the live molecules. Returns count. */
function apply(ex: Executive, snap: Snapshot): number {
  let n = 0;
  for (const e of snap) {
    const mol = ex.molecule(e.objName);
    if (!mol) continue;
    const set = mol.states[e.state - 1];
    if (!set) continue;
    const o = e.index * 3;
    if (o < 0 || o + 2 >= set.length) continue;
    set[o] = e.xyz[0];
    set[o + 1] = e.xyz[1];
    set[o + 2] = e.xyz[2];
    n++;
  }
  return n;
}

/** Positional arg else same-named kwarg else default, coerced to string. */
function pick(
  ctx: RegistrarCtx,
  args: unknown[],
  kwargs: Record<string, unknown>,
  i: number,
  name: string,
  dflt = '',
): string {
  const raw = args[i] !== undefined ? args[i] : kwargs[name];
  return ctx.str(raw, dflt);
}

export function registerControlflow(ctx: RegistrarCtx): void {
  const ex = ctx.executive;

  // A fresh registration is a fresh session: start with an empty history and
  // no recorded bindings.
  undoStack.length = 0;
  redoStack.length = 0;
  keyBindings.clear();

  /* ------------------------------ undo/redo --------------------------- */

  // `cmd.push_undo(selection, state)` — record the current coordinates so a
  // later `undo()` can restore them. Recording a new snapshot invalidates the
  // redo history (PyMOL discards the redo branch on a new edit). Returns null
  // (PyMOL returns None).
  ctx.command('push_undo', (args, kwargs) => {
    const sel = pick(ctx, args, kwargs, 0, 'selection', 'all') || 'all';
    const state = Number(pick(ctx, args, kwargs, 1, 'state', '0'));
    undoStack.push(capture(ex, sel, state));
    redoStack.length = 0;
    return null;
  });

  // `cmd.undo()` — restore the most recent snapshot. The pre-restore
  // coordinates of the same atoms are captured onto the redo stack first, so
  // `redo()` reverses this exactly. Returns the number of atoms restored, or
  // null when there is nothing to undo (a documented, safe no-op).
  ctx.command('undo', () => {
    const snap = undoStack.pop();
    if (!snap) return null;
    redoStack.push(captureLike(ex, snap));
    const n = apply(ex, snap);
    ctx.publish();
    return n;
  });

  // `cmd.redo()` — re-apply the most recently undone snapshot, capturing the
  // current coordinates back onto the undo stack. Returns the atom count or
  // null when there is nothing to redo.
  ctx.command('redo', () => {
    const snap = redoStack.pop();
    if (!snap) return null;
    undoStack.push(captureLike(ex, snap));
    const n = apply(ex, snap);
    ctx.publish();
    return n;
  });

  /* ---------------------------------- pop ----------------------------- */

  // `cmd.pop(name, source, quiet=1)` — remove one atom from the named
  // selection `source` and place it, alone, into the selection `name`.
  // Returns 1 if an atom was moved, else 0. The atom is only removed from
  // `source` when `source` is itself a NAMED selection (there is no way to
  // mutate a raw expression or an object in place); otherwise `name` still
  // receives the atom and `source` is left unchanged (documented limit).
  ctx.command('pop', (args, kwargs) => {
    const name = pick(ctx, args, kwargs, 0, 'name');
    const source = pick(ctx, args, kwargs, 1, 'source');
    if (!name || !source) return 0;
    const atoms = ex.atomsMatching(source);
    const first = atoms[0];
    if (!first) return 0;
    // A precise, unique selection for the single popped atom: per-object
    // positional `index` scoped to its object.
    const one = `model ${first.objName} and index ${first.index + 1}`;
    ex.select(name, one);
    if (ex.hasSelection(source)) {
      ex.select(source, `(${source}) and not (${one})`);
    }
    ctx.publish();
    return 1;
  });

  /* ----------------------- sandboxed no-ops (safe) -------------------- */
  // No filesystem, shell or process in the browser: run/spawn/system return
  // null WITHOUT executing anything, and never throw.
  ctx.command('run', () => null);
  ctx.command('spawn', () => null);
  ctx.command('system', () => null);

  // Session-lifecycle / render-refresh signals with nothing to drive locally.
  ctx.command('sync', () => null);
  ctx.command('abort', () => null);
  ctx.command('accept', () => null);
  // `ending` (jump to last movie frame) is registered in system.ts where the
  // movie/frame state lives.
  ctx.command('splash', () => null);
  ctx.command('update', () => null);
  ctx.command('rebuild_all', () => null);
  ctx.command('api', () => null);

  /* ---------------------------- input bindings ------------------------ */

  // `cmd.set_key(key, command)` — record the key binding. Returns null.
  ctx.command('set_key', (args, kwargs) => {
    const key = pick(ctx, args, kwargs, 0, 'key');
    if (key) keyBindings.set(key, pick(ctx, args, kwargs, 1, 'command'));
    return null;
  });

  // `cmd.button(button, modifier, action)` — record a mouse-button binding.
  ctx.command('button', (args, kwargs) => {
    const button = pick(ctx, args, kwargs, 0, 'button');
    const modifier = pick(ctx, args, kwargs, 1, 'modifier');
    const action = pick(ctx, args, kwargs, 2, 'action');
    if (button) keyBindings.set(`button:${button}:${modifier}`, action);
    return null;
  });

  // `cmd.mouse(action)` — record the requested mouse-mode change.
  ctx.command('mouse', (args, kwargs) => {
    keyBindings.set('mouse', pick(ctx, args, kwargs, 0, 'action'));
    return null;
  });

  // `cmd.config_mouse(name)` — record the named mouse configuration.
  ctx.command('config_mouse', (args, kwargs) => {
    keyBindings.set('config_mouse', pick(ctx, args, kwargs, 0, 'name'));
    return null;
  });

  // Getter (added, not upstream): observe the recorded bindings as a plain map.
  ctx.command('get_key_bindings', () => {
    return Object.fromEntries(keyBindings) as unknown as Json;
  });
}
