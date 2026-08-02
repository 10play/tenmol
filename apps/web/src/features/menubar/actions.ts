/**
 * Executing a menu leaf.
 *
 * `_addmenu` has exactly two execution paths and this file reproduces both:
 *
 *   command STRING   -> `cmd.do(str)`  — PyMOL echoes `PyMOL>…` into the console
 *   command CALLABLE -> called directly, silently
 *
 * so `do` here goes through `session.run` (which is `{t:'do'}` and lets PyMOL
 * produce the echo itself, never a second client-side one) and `call` goes
 * through `session.call` (`{t:'call'}`, silent, as in Qt).
 *
 * The stateful helpers are the interesting part. `mvprg` (`_gui.py:950-969`) is
 * a two-line state machine the Movie menu depends on:
 *
 *     movie_start   = cmd.get_movie_length() + 1
 *     movie_command = command % movie_start
 *     cmd.do(movie_command)
 *
 * with `mvprg(None)` re-running the stored command ("Update Last Program") and
 * `mvprg_remove_last` calling `cmd.mdelete(-1, movie_start)`. That state is GUI
 * state, not engine state, so it lives here — see the note on persistence.
 */

import type { MenuAction, MenuCall } from '@tenmol/protocol/topics/menus';
import { HOOK_OWNERS, UNAVAILABLE_COMMANDS, UNAVAILABLE_HOOKS } from './model';

/** Everything a menu action needs from the outside world. */
export interface MenuRuntime {
  /** `{t:'do'}` — PyMOL echoes the line itself. */
  run(commandLine: string): Promise<void>;
  /** `{t:'call'}` — silent, like Qt's direct callable. */
  call<T = unknown>(
    fn: string,
    args?: readonly unknown[],
    kwargs?: Readonly<Record<string, unknown>>,
  ): Promise<T>;
  /** A dim, client-origin console line. Never impersonates PyMOL output. */
  note(text: string, kind?: 'error' | 'warning'): void;
  /** Help entries. Separated so it is testable and so `noopener` is not forgotten. */
  openUrl(url: string): void;
  /** Hooks implemented by this feature or registered by another one. */
  hooks: Readonly<Record<string, (args: unknown[]) => void | Promise<void>>>;
}

/**
 * `mvprg`'s two variables. PLAIN MODULE STATE, on purpose: Qt keeps them as
 * instance attributes of the main window (`_gui.py:947-948`), i.e. they die
 * with the GUI and are not part of the session. A page reload loses them
 * exactly as closing PyMOL's window does.
 */
export interface MovieProgramState {
  start: number;
  command: string | null;
}

export const movieProgram: MovieProgramState = { start: 0, command: null };

export function resetMovieProgram(): void {
  movieProgram.start = 0;
  movieProgram.command = null;
}

/** `command % self.movie_start` — the format always carries exactly one `%d`. */
export function formatMovieCommand(format: string, start: number): string {
  return format.replace('%d', String(start));
}

/** `mvprg(command)` (`_gui.py:957-969`). */
export async function runMovieProgram(
  rt: MenuRuntime,
  format: string | null | undefined,
): Promise<void> {
  if (format !== null && format !== undefined) {
    const length = await rt.call<number>('cmd.get_movie_length');
    movieProgram.start = (typeof length === 'number' ? length : 0) + 1;
    movieProgram.command = formatMovieCommand(format, movieProgram.start);
  } else if (movieProgram.command === null) {
    // Upstream returns silently. Saying so is strictly better than a dead click.
    rt.note(' Movie: no program has been added yet — nothing to update', 'warning');
    return;
  }
  await rt.run(movieProgram.command as string);
}

/** `mvprg_remove_last` (`_gui.py:950-956`). */
export async function removeLastMovieProgram(rt: MenuRuntime): Promise<void> {
  if (movieProgram.start > 0) {
    await rt.call('cmd.mdelete', [-1, movieProgram.start]);
  } else {
    rt.note(' Movie: no program has been added yet — nothing to remove', 'warning');
  }
}

/** One recorded call -> one `{t:'call'}`. */
export async function runCall(rt: MenuRuntime, call: MenuCall): Promise<void> {
  await rt.call(call.fn, call.args, call.kwargs);
}

/**
 * Execute a menu action. Never throws: a failure becomes a console line, since
 * a menu click that silently does nothing is the failure mode this whole area
 * exists to avoid.
 */
export async function runAction(rt: MenuRuntime, action: MenuAction): Promise<void> {
  try {
    switch (action.type) {
      case 'do': {
        // Defence in depth for the `UNAVAILABLE_COMMANDS` leaves: `MenuList`
        // renders them disabled, and if anything ever reaches them anyway they
        // must not go out as a command line the engine will only reject.
        const impossible = UNAVAILABLE_COMMANDS[action.command];
        if (impossible) {
          rt.note(` "${action.command}" is not available in the web client: ${impossible}`, 'warning');
          return;
        }
        await rt.run(action.command);
        return;
      }

      case 'call':
        // Sequentially: the Transparency composites set three settings and the
        // order is part of the meaning.
        for (const call of action.calls) await runCall(rt, call);
        return;

      case 'url':
        rt.openUrl(action.url);
        return;

      case 'hook': {
        const unavailable = UNAVAILABLE_HOOKS[action.hook];
        if (unavailable) {
          rt.note(` ${action.hook} is not available in the web client: ${unavailable}`, 'warning');
          return;
        }
        const handler = rt.hooks[action.hook];
        if (!handler) {
          const owner = HOOK_OWNERS[action.hook];
          rt.note(
            owner
              ? ` "${action.hook}" is not built yet — ${owner.owner} owns it (${owner.note})`
              : ` "${action.hook}" has no handler in this client`,
            'warning',
          );
          return;
        }
        await handler(action.args ?? []);
        return;
      }

      case 'dropped':
        rt.note(` menu item was dropped upstream: ${action.reason}`, 'warning');
        return;
    }
  } catch (error) {
    rt.note(` ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

/**
 * A check/radio click. Qt fires `cmd.set(name, value, log=1, quiet=0)` for a
 * radio (`pymol_qt_gui.py:331-333`) and `cmd.set(index, …, log=1, quiet=0)` for
 * a SettingAction (`:1058-1062`). Only the first argument differs — index vs
 * name — and `cmd.set` accepts either (`packages/engine/modules/pymol/setting.py:185`,
 * `_get_index` handles digits). The name is used here because it needs no
 * `cmd.setting._get_index` round trip, which the policy would refuse anyway
 * (private interior segment, `policy/base.py`).
 */
export async function setSetting(
  rt: MenuRuntime,
  name: string,
  value: number | string,
): Promise<void> {
  try {
    await rt.call('cmd.set', [name, value], { log: 1, quiet: 0 });
  } catch (error) {
    rt.note(` ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}
