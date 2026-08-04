/**
 * @tenmol/client — the `cmd` facade.
 *
 * `createCmd(conn)` returns a Proxy so ANY PyMOL symbol is callable without a
 * declaration:
 *
 *     await cmd.fragment('ala');            // -> {t:'call', fn:'fragment', args:['ala'], kwargs:{}}
 *     await cmd.util.cbc();                 // -> fn:'util.cbc'
 *     await cmd.load('1ubq.pdb', { zoom: 1 });  // trailing plain object = Python kwargs
 *
 * A hand-written typed surface covers ~15 commands below, for autocomplete,
 * doc-comments and return types.
 *
 * >>> THE FULL TYPED SURFACE WILL BE GENERATED from `packages/engine/modules/pymol/api.py`
 * >>> (404 exported symbols, plus the `util` / `movie` / `gui` namespace
 * >>> modules at packages/engine/modules/pymol/api.py:487-489) into
 * >>> `packages/client/src/generated/`. Do not hand-expand this file beyond
 * >>> the common commands; add to the generator instead
 * >>> (architecture.md:787 — generated files are never hand-edited).
 *
 * Until then the split is explicit, and stated plainly:
 *
 *   * declared commands   -> strictly typed; a wrong argument is a compile error;
 *   * everything else     -> `cmd.$any.symexp(...)`, `cmd.util.cbc()` or
 *                            `cmd.$call<T>('symexp', [...])`, typed as `any`.
 *
 * Both halves hit the identical proxy at runtime — `$any` IS the root proxy —
 * so nothing about the wire format depends on which half you use.
 */

import type { Json, ViewMatrix } from '@tenmol/protocol';
import type { PymolConnection } from './connection';

/* ------------------------------------------------------------------ *
 * kwargs detection
 * ------------------------------------------------------------------ */

/**
 * A trailing PLAIN object argument is sent as Python **kwargs.
 * Arrays, typed arrays, class instances, Date, null etc. stay positional —
 * this matters because several PyMOL commands take list arguments
 * (`cmd.set_view([...18 floats])`, `cmd.load_cgo([...])`).
 */
export function isKwargs(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Split a JS argument list into PyMOL positional args and kwargs. */
export function splitArgs(argv: readonly unknown[]): {
  args: unknown[];
  kwargs: Record<string, unknown>;
} {
  if (argv.length > 0) {
    const last = argv[argv.length - 1];
    if (isKwargs(last)) {
      return { args: argv.slice(0, -1), kwargs: last };
    }
  }
  return { args: [...argv], kwargs: {} };
}

/* ------------------------------------------------------------------ *
 * Structural types
 * ------------------------------------------------------------------ */

/**
 * Any PyMOL symbol, called dynamically.
 *
 * `unknown[]` in and `Promise<unknown>` out, NOT `any`: the proxy really does
 * accept anything JSON-encodable and really does return whatever the bridge
 * decoded, and `unknown` says that without disabling the type checker for
 * callers. The convenient-but-unsound `any` lives in exactly one place —
 * {@link CmdNamespace}'s index signature — and this type is not it.
 */
export type CmdCallable = (...args: unknown[]) => Promise<unknown>;

/**
 * The untyped half of the facade: every property is a callable that is also a
 * namespace, so `ns.cbc()` and `ns.a.b()` both resolve.
 *
 * The value type is `any` on purpose. The repo compiles with
 * `noUncheckedIndexedAccess`, which turns any *declared* index-signature value
 * into `T | undefined` and would make every dynamic call an error
 * ("Cannot invoke an object which is possibly 'undefined'"). `any` absorbs the
 * added `undefined`. This is exactly the imprecision the GENERATED surface
 * removes; it is confined to symbols we have not declared by hand.
 */
export interface CmdNamespace {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [symbol: string]: any;
}

/** Escape hatches available on the proxy under `$`-prefixed names. */
export interface CmdInternals {
  /** The transport this facade writes to. */
  readonly $conn: PymolConnection;
  /**
   * The same proxy, untyped — the door to the ~389 symbols that do not have a
   * hand-written signature yet: `await cmd.$any.symexp('s', 'obj', 'sele', 5)`.
   * Prefer `$call` when you want a typed result.
   */
  readonly $any: CmdNamespace;
  /** Explicit call with separated args/kwargs; bypasses kwargs sniffing. */
  $call<T = Json>(
    fn: string,
    args?: readonly unknown[],
    kwargs?: Readonly<Record<string, unknown>>,
  ): Promise<T>;
  /** Raw PyMOL command line via `cmd.do`; always resolves to null. */
  $do(line: string): Promise<null>;
  /**
   * Tab completion — PyMOL's own, over the wire.
   *
   * `cmd._parser.complete(line)` (`packages/engine/modules/pymol/parser.py:524-596`) returns
   * the COMPLETED LINE, or `null` when it could not complete. Callers should do
   * exactly what every PyMOL front end does (`packages/engine/modules/pymol/_gui.py:899-903`):
   * if the answer is a non-empty string, replace the line and put the cursor at
   * the end; otherwise leave the line alone.
   *
   * The candidate list is not returned — PyMOL *prints* it
   * (`colorprinting.suggest`, `parser.py:63-67`), so it arrives on the
   * `feedback` topic as ` parser: matching commands:` and the lines under it.
   * That is the parity behaviour, not a limitation of this method.
   *
   * It cannot be done in the browser: it reads `cmd.kwhash`, `cmd.auto_arg`,
   * `cmd.get_names` and the SERVER's filesystem.
   */
  $complete(line: string): Promise<string | null>;
}

/** The symbol `$complete` calls. Granted by `policy/grants/wp-11-console.py`. */
export const COMPLETE_FN = 'cmd._parser.complete';

/* ------------------------------------------------------------------ *
 * Hand-written typed surface (~15 commands)
 *
 * Signatures mirror the real Python ones; the file:line of each is quoted so
 * the generator can be diffed against them later.
 * ------------------------------------------------------------------ */

export interface TypedPymolCmd {
  /**
   * `cmd.load(filename, object='', state=0, format='', finish=1, discrete=-1,
   * quiet=1, multiplex=None, zoom=-1, partial=0, mimic=1, object_props=None,
   * atom_props=None)` — packages/engine/modules/pymol/importing.py:643.
   *
   * NOTE: `filename` is a path ON THE SERVER. Browser-side files must be
   * uploaded first; the backend takes paths, not blobs.
   */
  load(
    filename: string,
    kwargs?: {
      object?: string;
      state?: number;
      format?: string;
      finish?: number;
      discrete?: number;
      quiet?: number;
      multiplex?: number | null;
      zoom?: number;
      partial?: number;
      mimic?: number;
    },
  ): Promise<Json>;

  /** `cmd.fragment(name, object=None, origin=1, zoom=0, quiet=1)` — creating.py:943. */
  fragment(
    name: string,
    kwargs?: { object?: string; origin?: number; zoom?: number; quiet?: number },
  ): Promise<Json>;

  /** `cmd.delete(name)` — commanding.py:511. Accepts patterns and 'all'. */
  delete(name: string): Promise<Json>;

  /** `cmd.show(representation='wire', selection='')` — viewing.py:520. */
  show(representation?: string, selection?: string): Promise<Json>;

  /** `cmd.hide(representation='everything', selection='')` — viewing.py:597. */
  hide(representation?: string, selection?: string): Promise<Json>;

  /** `cmd.color(color, selection='(all)', quiet=1, flags=0)` — viewing.py:1904. */
  color(
    color: string,
    selection?: string,
    kwargs?: { quiet?: number; flags?: number },
  ): Promise<Json>;

  /**
   * `cmd.get_names(type='public_objects', enabled_only=0, selection='')`
   * — querying.py:1155. Common types: 'objects', 'selections',
   * 'public_objects', 'public_selections', 'all'.
   */
  get_names(type?: string, enabled_only?: number, selection?: string): Promise<string[]>;

  /**
   * `cmd.get_view(output=1, quiet=1)` — viewing.py:634.
   * Returns the 18 floats documented at viewing.py:660-676.
   */
  get_view(output?: number, quiet?: number): Promise<ViewMatrix>;

  /** `cmd.set_view(view, animate=0, quiet=1, hand=1)` — viewing.py:734. */
  set_view(
    view: ViewMatrix | readonly number[],
    kwargs?: { animate?: number; quiet?: number; hand?: number },
  ): Promise<Json>;

  /** `cmd.turn(axis, angle)` — viewing.py:1300. axis is 'x' | 'y' | 'z'. */
  turn(axis: 'x' | 'y' | 'z', angle: number): Promise<Json>;

  /**
   * `cmd.zoom(selection='all', buffer=0.0, state=0, complete=0, animate=0)`
   * — viewing.py:66.
   */
  zoom(
    selection?: string,
    buffer?: number,
    kwargs?: { state?: number; complete?: number; animate?: number },
  ): Promise<Json>;

  /** `cmd.orient(selection='(all)', state=0, animate=0)` — viewing.py:310. */
  orient(selection?: string, kwargs?: { state?: number; animate?: number }): Promise<Json>;

  /**
   * `cmd.refresh()` — viewing.py:1750, i.e. `ExecutiveDrawNow`
   * (packages/engine/layer3/Executive.cpp:11521). This is what drains the deferred queue that
   * mouse input, deferred images and rep rebuilds sit in
   * (`packages/engine/layer1/Ortho.cpp:268` `OrthoExecDeferred`), so the bridge — not the client —
   * decides when it runs. Call it from the UI only when you know why.
   */
  refresh(): Promise<Json>;

  /**
   * `cmd.png(filename, width=0, height=0, dpi=-1.0, ray=0, quiet=1, prior=0,
   * format=0)` — exporting.py:499. Writes a file on the SERVER.
   */
  png(
    filename: string,
    kwargs?: {
      width?: number;
      height?: number;
      dpi?: number;
      ray?: number;
      quiet?: number;
      prior?: number;
      format?: number;
    },
  ): Promise<Json>;

  /**
   * `cmd.get_setting(name, object='', state=0)` — setting.py:350 (marked
   * INTERNAL upstream).
   *
   * For typed reads prefer the public family
   * `get_setting_boolean|int|float|text|tuple` (setting.py:408-447).
   * `cmd.get_setting_str` does NOT exist anywhere in this tree — verified by
   * grep over `packages/engine/modules/pymol/setting.py`; do not call it.
   */
  get_setting(name: string, object?: string, state?: number): Promise<Json>;

  /**
   * `cmd.set(name, value=1, selection='', state=0, updates=1, log=0, quiet=1)`
   * — setting.py:185.
   *
   * Menu check/radio items must pass `{log: 1, quiet: 0}` so the action reaches
   * the log and the console (`packages/engine/modules/pymol/setting.py:185`,
   * where both default to the silent values).
   */
  set(
    name: string,
    value?: string | number | boolean,
    selection?: string,
    kwargs?: { state?: number; updates?: number; log?: number; quiet?: number },
  ): Promise<Json>;
}

/** Namespace modules re-exported by the api (`packages/engine/modules/pymol/api.py:487-489`). */
export interface KnownNamespaces {
  /** packages/engine/modules/pymol/util.py — cbc, cbag, protein_vacuum_esp, ... */
  util: CmdNamespace;
  /** packages/engine/modules/pymol/movie.py — produce, roll, nutate, ... */
  movie: CmdNamespace;
  /** packages/engine/modules/pymol/gui.py */
  gui: CmdNamespace;
}

/**
 * The `cmd` facade.
 *
 * Declared commands are strictly typed (a wrong argument IS a compile error).
 * Everything else goes through `cmd.$any.<symbol>(...)`, `cmd.util.<symbol>()`
 * or `cmd.$call('<symbol>', args, kwargs)`. The generated surface will fold
 * `$any` back into `Cmd` itself.
 */
export type Cmd = TypedPymolCmd & KnownNamespaces & CmdInternals;

/* ------------------------------------------------------------------ *
 * Proxy factory
 * ------------------------------------------------------------------ */

/** Property names that must never be turned into a PyMOL call. */
const RESERVED = new Set<string>([
  'then', // must stay undefined or `await cmd` hangs / misbehaves
  'catch',
  'finally',
  'constructor',
  'prototype',
  'toJSON',
  'inspect',
  'nodeType',
  '$$typeof', // React
]);

function makeNode(conn: PymolConnection, path: string): CmdCallable & CmdNamespace {
  const children = new Map<string, CmdCallable & CmdNamespace>();

  const target = function callTarget(): void {
    /* proxy apply trap replaces this */
  };

  const proxy = new Proxy(target, {
    apply(_t, _thisArg, argv: unknown[]) {
      if (!path) {
        throw new TypeError('cmd is not callable; call a symbol, e.g. cmd.fragment("ala")');
      }
      const { args, kwargs } = splitArgs(argv);
      return conn.call(path, args, kwargs);
    },

    get(_t, prop, _receiver) {
      if (typeof prop !== 'string') return undefined;
      if (RESERVED.has(prop)) return undefined;

      if (!path) {
        // Root-only escape hatches.
        if (prop === '$conn') return conn;
        if (prop === '$any') return proxy;
        if (prop === '$call') {
          return (
            fn: string,
            args: readonly unknown[] = [],
            kwargs: Readonly<Record<string, unknown>> = {},
          ) => conn.call(fn, args, kwargs);
        }
        if (prop === '$do') return (line: string) => conn.do(line);
        if (prop === '$complete') {
          return async (line: string): Promise<string | null> => {
            const done = await conn.call(COMPLETE_FN, [line], {});
            return typeof done === 'string' && done.length > 0 ? done : null;
          };
        }
      }

      const cached = children.get(prop);
      if (cached) return cached;
      const child = makeNode(conn, path ? `${path}.${prop}` : prop);
      children.set(prop, child);
      return child;
    },

    has() {
      // Every symbol "exists" as far as the proxy is concerned; the bridge is
      // the real allow-list and answers with {t:'err', type:'NotAllowed'}.
      return true;
    },

    set() {
      throw new TypeError('the cmd facade is read-only');
    },

    deleteProperty() {
      throw new TypeError('the cmd facade is read-only');
    },
  });

  return proxy as unknown as CmdCallable & CmdNamespace;
}

/**
 * Build a `cmd` facade bound to a connection.
 *
 * Every call becomes `{id, t:'call', fn:'<dotted path>', args, kwargs}`.
 * Errors reject with `PymolError` carrying the Python exception type and
 * traceback.
 */
export function createCmd(conn: PymolConnection): Cmd {
  return makeNode(conn, '') as unknown as Cmd;
}
