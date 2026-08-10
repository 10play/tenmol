/**
 * The seam between the Engine and its command subsystems.
 *
 * Each subsystem (coloring, transforms, analysis, …) lives in its own module
 * and exposes a `registerX(ctx)` that adds its `cmd.*` handlers via
 * `ctx.command(...)`. The Engine builds one {@link RegistrarCtx} and calls every
 * subsystem's registrar. This keeps subsystems in DISJOINT files so they can be
 * developed independently.
 */

import type { Json } from '@tenmol/protocol';
import type { Executive } from '../exec/executive';

/** A `cmd` handler: positional args + kwargs -> a JSON-encodable result. */
export type CommandHandler = (args: unknown[], kwargs: Record<string, unknown>) => Json;

export interface RegistrarCtx {
  /** Register a `cmd.<name>` handler. `name` is the bare symbol (no `cmd.`). */
  command(name: string, handler: CommandHandler): void;
  /**
   * Invoke another registered `cmd.*` verb by name — the same dispatch the wire
   * uses (a `NotPorted` throw for an unregistered symbol). This is how
   * orchestration namespaces (`preset.*`, `movie.*`, `util.*`) compose the
   * lower-level verbs they are built from, exactly as the PyMOL Python modules
   * call `cmd.show`/`cmd.color`/`cmd.set`. Prefer {@link executive} for simple
   * state reads/writes; use `call` when you need a full verb's behaviour.
   */
  call(name: string, args?: readonly unknown[], kwargs?: Readonly<Record<string, unknown>>): Json;
  /** The executive: objects, selections, settings, colours, the camera. */
  readonly executive: Executive;
  /** Re-emit objects + view + geometry (call after a state mutation). */
  publish(): void;
  /** Re-emit only the camera view (call after a camera-only mutation). */
  emitView(): void;
  /** Coerce an unknown arg to a string (the console passes strings). */
  str(v: unknown, dflt?: string): string;
}
