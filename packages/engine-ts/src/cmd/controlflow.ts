/**
 * The `controlflow` command subsystem: PyMOL's control-flow / session / system
 * glue that, in a browser sandbox, is a small amount of real behaviour plus a
 * set of deliberate, side-effect-free no-ops.
 *
 * WHAT IS REAL HERE
 * - `pop(name, source)` — PyMOL's `cmd.pop`: take one atom out of the named
 *   selection `source` and place it (alone) into the selection `name`. Returns
 *   1 if an atom was moved, 0 if `source` was empty.
 * - `set_key` / `button` / `mouse` / `config_mouse` record their binding into a
 *   module-local map, observable through the added `get_key_bindings()` getter.
 *
 * WHAT IS A DOCUMENTED NO-OP (never touches the real FS / shell / process)
 * - `push_undo` / `undo` / `redo` — coordinate undo is NOT ported. Real
 *   (open-source, headless) PyMOL only rolls back the object *currently being
 *   edited* through the picking Editor: `ExecutiveUndo` acts on
 *   `ExecutiveGetLastObjectEdited`, which scripting never sets. So a scripted
 *   `push_undo(sel); translate ...; undo` does NOT restore the pre-translate
 *   coordinates — the atoms stay translated. (Verified against real PyMOL via
 *   the differential oracle.) These three succeed inertly (`null`).
 * - `run` — a `.pml` file IS executed: PyMOL's `run(file.pml)` delegates to
 *   `cmd.load`, whose `pml` handler runs `cmd.do("_ @file")` (`importing.py:1625`),
 *   so we replay the script through the console's `@`-include (under Node the
 *   file is read and each line run; the browser reports it honestly). Python
 *   (`.py`/`.pym`) scripts have no interpreter in this port, so they stay inert.
 * - `spawn` / `system` — in the browser there is no filesystem or shell, so
 *   these return `null` WITHOUT executing anything (they do not throw).
 * - `sync` / `abort` / `accept` / `ending` / `splash` / `rebuild_all` —
 *   session lifecycle / render-refresh signals with nothing to drive locally;
 *   they succeed inertly (`null`).
 * - `api` — returns `null`.
 *
 * NOTE ON OWNERSHIP: several of these names (`undo`, `redo`, `sync`, `splash`,
 * `api`) are also registered as bare stubs by the `system` subsystem. This
 * registrar runs LAST (`ALL_REGISTRARS`), so its handlers win; they match the
 * inert `system` stubs. `update` is owned solely by the `system` subsystem
 * (a real behavioural port) and is NOT re-stubbed here. `get_version` is a
 * FIXED stub in engine.ts and is intentionally NOT redefined.
 */
import type { RegistrarCtx } from './registrar';
import type { Json } from '@tenmol/protocol';

/** Recorded input bindings: `set_key`/`button`/`mouse`/`config_mouse`. */
const keyBindings = new Map<string, string>();

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

  // A fresh registration is a fresh session: forget any recorded bindings.
  keyBindings.clear();

  /* ------------------------------ undo/redo --------------------------- */

  // `cmd.push_undo(selection, ...)` / `cmd.undo()` / `cmd.redo()` — coordinate
  // undo is NOT ported behaviourally. Real (open-source, headless) PyMOL only
  // restores the object *currently being edited* through the picking Editor
  // (`ExecutiveUndo` acts on `ExecutiveGetLastObjectEdited`), so a scripted
  // `push_undo(sel); translate ...; undo` leaves the coordinates AT the
  // translated position — `undo`/`redo` do not roll a scripted edit back. We
  // verified this against real PyMOL via the differential oracle. These three
  // therefore succeed inertly (return null / None) without touching coords.
  ctx.command('push_undo', () => null);
  ctx.command('undo', () => null);
  ctx.command('redo', () => null);

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

  /* -------------------------------- run ------------------------------- */

  // `cmd.run(filename, namespace=None)` — execute a script file. PyMOL routes a
  // `.pml` file to `cmd.load`, whose `pml` loader runs `cmd.do("_ @file")`
  // (`importing.py:1625`); we mirror that by replaying the script through the
  // console's `@`-include (reads the file under Node, runs each line). Python
  // (`.py`/`.pym`) scripts have no interpreter in this port and stay inert.
  ctx.command('run', (args, kwargs) => {
    const filename = pick(ctx, args, kwargs, 0, 'filename');
    if (filename && /\.pml$/i.test(filename)) {
      ctx.call('do', [`@${filename}`]);
    }
    return null;
  });

  /* ----------------------- sandboxed no-ops (safe) -------------------- */
  // No filesystem, shell or process in the browser: spawn/system return null
  // WITHOUT executing anything, and never throw.
  ctx.command('spawn', () => null);
  ctx.command('system', () => null);

  // Session-lifecycle / render-refresh signals with nothing to drive locally.
  ctx.command('sync', () => null);
  ctx.command('abort', () => null);
  ctx.command('accept', () => null);
  // `ending` (jump to last movie frame) is registered in system.ts where the
  // movie/frame state lives.
  ctx.command('splash', () => null);
  // `update` (coordinate transfer) is registered in system.ts, which owns a real
  // behavioural port; it is intentionally NOT re-stubbed here.
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
