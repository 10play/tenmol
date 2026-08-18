/**
 * The Engine — the TypeScript port's `PyMOL` instance.
 *
 * Owns the executive, the camera, a feedback line buffer and a typed emitter,
 * and turns a wire `call`/`do`/`input` into a state change plus the topic events
 * and geometry frames the client already knows how to consume. This is the
 * direct analogue of what `packages/bridge/tenmol_bridge/dispatch.py` +
 * `pump.py` do for real PyMOL — reduced to the covered command slice.
 *
 * A symbol with no ported implementation rejects with a `PymolError` of type
 * `NotPorted`, mirroring the bridge's `NotAllowed`: never a silent no-op, so the
 * differential suite sees the gap instead of a wrong-but-quiet answer.
 */

import { TypedEmitter, PymolError, type BackendEvents } from '@tenmol/backend';
import {
  Rep,
  REP_NAMES,
  decodeBinaryFrame,
  encodeBinaryFrame,
  geometryKey,
  parseGeometryKey,
  isGeometryFrame,
  type CgoDrawArraysHeader,
  type HelloMessage,
  type Json,
  type ObjectRow,
} from '@tenmol/protocol';
import { Executive } from './exec/executive';
import { defaultView } from './view/view';
import { repBit } from './model/atom';
import type { ObjectMolecule } from './model/molecule';
import { classifyMolecule, cAtomFlag_class_mask } from './model/classify';
import { getColorIndex, getColorTuple, COLOR_SETTINGS, colorSettingText } from './exec/color';
import { parsePdb } from './model/pdb';
import { buildLibraryFragment } from './model/fragments';
import { REP_BUILDERS, RENDERABLE_REPS, isRenderableRep } from './geometry/registry';
import { buildMeasurementFrame } from './exec/measurement';
import { parseCommand, splitCommands } from './cmd/parser';
import { SelectionError } from './select/selector';
import type { RegistrarCtx } from './cmd/registrar';
import { ALL_REGISTRARS } from './cmd/registrars';
import { renderRayImage, setLastImage, resolveAntialias } from './cmd/render';

/** Representation name -> RepId, for `_bridge.pull_geometry(object, repName)`. */
const REP_BY_NAME = new Map<string, number>();
for (const [id, name] of Object.entries(REP_NAMES)) REP_BY_NAME.set(name, Number(id));

/** Console verbs the `do` parser recognizes; anything else is silent Python. */
const KNOWN_KEYWORDS = new Set([
  'fragment',
  'show',
  'hide',
  'as',
  'color',
  'select',
  'delete',
  'zoom',
  'orient',
  'turn',
  'set',
  'bg_color',
  'reset',
]);

/**
 * Registered `cmd` symbols that are API-only — callable as `cmd.<fn>(...)` but
 * NOT PyMOL command-line keywords, so a typed `do("<fn> ...")` line must run as
 * script (a no-op here), never dispatch the command. PyMOL's keyword table
 * (`modules/pymol/keywords.py`) is the source of truth; `set_discrete` is absent
 * from it (exposed only via `pymol.editing.set_discrete`), so `set_discrete ala,
 * 1` at the console leaves the object untouched — matched here by excluding it
 * from `isCommandWord` even though it is a registered handler.
 *
 * `set_object_color` is likewise API-only (`pymol.editing.set_object_color`,
 * absent from `keywords.py`), so a console `set_object_color ala, marine` line
 * runs as script and leaves the object colour untouched — the object keeps its
 * `auto_color` cycle colour, not `marine`.
 */
const API_ONLY_SYMBOLS = new Set(['set_discrete', 'set_object_color']);

type Handler = (args: unknown[], kwargs: Record<string, unknown>) => Json;

/**
 * Natural string order — `strlessnat` (layer0/Util2.cpp), used by
 * `scene_order ..., sort=1`: digit runs compare numerically so "F2" precedes
 * "F10".
 */
function naturalCompare(a: string, b: string): number {
  const ta = a.match(/\d+|\D+/g) ?? [];
  const tb = b.match(/\d+|\D+/g) ?? [];
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const xa = ta[i] ?? '';
    const xb = tb[i] ?? '';
    const da = /^\d/.test(xa);
    const db = /^\d/.test(xb);
    if (da && db) {
      const diff = Number(xa) - Number(xb);
      if (diff !== 0) return diff;
    } else if (xa !== xb) {
      return xa < xb ? -1 : 1;
    }
  }
  return ta.length - tb.length;
}

/**
 * GLUT special-key modifier names, indexed by the bitmask PyMOL passes to
 * `_special` (`internal.modifier_keys`): 1=SHFT, 2=CTRL, 3=CTSH, 4=ALT.
 */
const MODIFIER_KEYS = ['', 'SHFT', 'CTRL', 'CTSH', 'ALT'];

/**
 * GLUT special key codes → key name (`internal.special_key_codes`): F1–F12 and
 * the navigation/edit specials. The bare key name is what F-key scene/view
 * lookups are keyed on.
 */
const SPECIAL_KEY_CODES: Record<number, string> = {
  1: 'F1', 2: 'F2', 3: 'F3', 4: 'F4', 5: 'F5', 6: 'F6',
  7: 'F7', 8: 'F8', 9: 'F9', 10: 'F10', 11: 'F11', 12: 'F12',
  100: 'left', 101: 'up', 102: 'right', 103: 'down',
  104: 'pgup', 105: 'pgdn', 106: 'home', 107: 'end', 108: 'insert',
};

/**
 * A minimal port of `pymol.shortcut.Shortcut.interpret(query, mode=False)` for
 * the F-key dispatch: returns the keyword list for an empty query, the matched
 * keyword (exact or unique-abbreviation) for a hit, a list for an ambiguous
 * prefix, or `undefined` (Python `None`) for no hit. `_special` only uses the
 * single-string result, but the full three-way shape is ported for fidelity.
 */
function shortcutInterpret(keywords: readonly string[], query: string): string | string[] | undefined {
  if (query === '') return [...keywords];
  // Build the shortcut map exactly as `_optimize_symbols`/`_rebuild_finalize`:
  // every proper prefix maps to its keyword, or to 0 (the collision sentinel)
  // when two keywords share it; the full keyword always maps to itself.
  const shortcut = new Map<string, string | 0>();
  const set = (k: string, kw: string): void => {
    shortcut.set(k, shortcut.has(k) ? 0 : kw);
  };
  for (const kw of keywords) {
    for (let i = 1; i < kw.length; i++) set(kw.slice(0, i), kw);
  }
  for (const kw of keywords) shortcut.set(kw, kw);

  const result = shortcut.get(query);
  if (result === undefined) return undefined; // None
  if (result) return result; // exact / unique (mode=False returns immediately)

  // Collision sentinel (0): fall back to a prefix search over the keywords.
  const unique = new Set<string>();
  for (const w of keywords) if (w.startsWith(query)) unique.add(w);
  if (unique.size === 0) return undefined;
  return unique.size === 1 ? [...unique][0]! : [...unique];
}

/**
 * Coerce a `scene_order` `sort` argument the way `viewing.scene_order` does:
 * numbers pass through, but a string is resolved through PyMOL's `boolean_sc`
 * shortcut (`yes`/`no`/`true`/`false`/`on`/`off`/`1`/`0`).
 */
function sceneBoolean(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '') return false;
  if (/^-?\d+$/.test(s)) return Number(s) !== 0;
  if (s === 'off') return false; // disambiguate the `o…` prefix (on vs off)
  const c = s[0];
  return c === 'y' || c === 't' || c === 'o' || c === '1';
}

/** One stored scene in the bin (`MovieScene`, layer3/MovieScene.h). */
interface SceneEntry {
  /** The stored 18-float camera view, or null when `view` was not stored. */
  view: number[] | null;
  /** The wizard message shown on recall ('' when none). */
  message: string;
  /** The stored movie frame index (1-based). */
  frame: number;
}

/**
 * A Python line the port cannot and should not run: the app's feature panels
 * install their bridge-side helpers with lines like
 * `/import tenmol_bridge.panels.settings as _s;_s.install()`, sent every poll,
 * and the Builder's one-shot `_ __import__('tenmol_bridge.panels.builder',
 * fromlist=['install']).install(cmd)` bootstrap. Those are internal plumbing
 * (real PyMOL runs them in its interpreter), so the port stays silent for them —
 * but ONLY for these bootstrap forms, so a user's own `/expr` or bare line is
 * still run as JavaScript (see `do`).
 */
function isPythonImport(line: string): boolean {
  const stripped = line.trim().replace(/^\//, '');
  if (line.trim().startsWith('@')) return true; // `@script` include
  return splitCommands(stripped).some((c) => {
    const t = c.trim();
    // `from x import y` / `import x` statements, and the Builder's bootstrap
    // idiom `_ __import__('...').install(cmd)` — anchored to the leading
    // `_ __import__(` so a user line that merely mentions `__import__` elsewhere
    // (e.g. inside a string) is still evaluated as JavaScript.
    return /^(from|import)\s/.test(t) || /^_\s+__import__\s*\(/.test(t);
  });
}

/**
 * Read a command-script file synchronously, or `null` when no filesystem is
 * reachable (the browser). The `@file.pml` include (`parser.py:403-441`) reads
 * the file off disk; under Node — where the differential and app-server run —
 * we reach the real `fs` through `process.getBuiltinModule` so the include
 * behaves like PyMOL's, while a browser bundle (no `process`) simply gets
 * `null` and reports the include as unsupported.
 */
function readScriptFile(filename: string): string | null {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const getBuiltin = proc?.getBuiltinModule;
  if (typeof getBuiltin !== 'function') return null;
  try {
    const fs = getBuiltin.call(proc, 'node:fs') as {
      readFileSync(path: string, enc: string): string;
    };
    return fs.readFileSync(filename, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Invert a row-major homogeneous 4×4 affine matrix (last row `0 0 0 1`), as
 * PyMOL's `invert_special44d44d` does for `matrix_reset` mode 0. The rotational
 * 3×3 block is inverted by cofactors and the translation carried through as
 * `-R⁻¹·t`. Returns `null` for a singular (non-invertible) rotation block.
 */
function invertAffine44(m: number[]): number[] | null {
  const a = m[0]!, b = m[1]!, c = m[2]!;
  const d = m[4]!, e = m[5]!, f = m[6]!;
  const g = m[8]!, h = m[9]!, i = m[10]!;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  // R⁻¹ (row-major 3×3) via the transposed cofactor matrix.
  const r00 = (e * i - f * h) * inv;
  const r01 = (c * h - b * i) * inv;
  const r02 = (b * f - c * e) * inv;
  const r10 = (f * g - d * i) * inv;
  const r11 = (a * i - c * g) * inv;
  const r12 = (c * d - a * f) * inv;
  const r20 = (d * h - e * g) * inv;
  const r21 = (b * g - a * h) * inv;
  const r22 = (a * e - b * d) * inv;
  const tx = m[3]!, ty = m[7]!, tz = m[11]!;
  return [
    r00, r01, r02, -(r00 * tx + r01 * ty + r02 * tz),
    r10, r11, r12, -(r10 * tx + r11 * ty + r12 * tz),
    r20, r21, r22, -(r20 * tx + r21 * ty + r22 * tz),
    0, 0, 0, 1,
  ];
}

export class Engine {
  readonly executive = new Executive();
  readonly emitter = new TypedEmitter<BackendEvents>();
  private seq = 1;
  private feedback: string[] = [];
  private readonly handlers = new Map<string, Handler>();
  private booted = false;

  // Drag state for the interactive (non-gated) trackball.
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  // The viewport size (answered by `get_viewport`, set by `cmd.viewport` and
  // `reshape`) lives on the executive so the setter and reader share one source
  // of truth — the Mode-G client polls it to size its GL scene rectangle.

  // Named camera views — `cmd.view(key, 'store'|'recall'|'clear')`. PyMOL keeps
  // these as 18-float entries in a Python dict; the port mirrors that.
  private readonly views = new Map<string, number[]>();

  // The scene bin — `cmd.scene(key, action, …)`. Mirrors `CMovieScenes`
  // (layer3/MovieScene.cpp): an ORDERED list of scene keys plus a dict of the
  // stored state per key. The port stores the observable slice PyMOL captures
  // for a scene — the camera view, the wizard message and the movie frame —
  // and manages the ordering exactly as `MovieSceneOrder`/`MovieSceneStore`/
  // `MovieSceneRename` do, so `get_scene_list` reports the bin in bin order.
  private readonly sceneOrder: string[] = [];
  private readonly sceneDict = new Map<string, SceneEntry>();
  // The auto-numbering counter behind `getUniqueKey()` (scene key "new").
  private sceneCounter = 1;

  constructor() {
    this.register();
  }

  /* ------------------------------- boot ------------------------------- */

  boot(): HelloMessage {
    this.booted = true;
    return {
      t: 'hello',
      protocolVersion: 1,
      pymolVersion: 'tenmol-engine-ts',
      // `session.ts` reads `state`; 'running' unlocks the full UI.
      state: 'running',
    } as unknown as HelloMessage;
  }

  isBooted(): boolean {
    return this.booted;
  }

  /* ------------------------------- call ------------------------------- */

  call(
    fn: string,
    args: readonly unknown[] = [],
    kwargs: Readonly<Record<string, unknown>> = {},
  ): Json {
    const name = fn.startsWith('cmd.') ? fn.slice(4) : fn;
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new PymolError(
        {
          kind: 'NotAllowed',
          type: 'NotPorted',
          message: `${fn}: not ported by @tenmol/engine-ts yet`,
          traceback: '',
        },
        fn,
      );
    }
    try {
      return handler([...args], { ...kwargs });
    } catch (err) {
      if (err instanceof PymolError) throw err;
      if (err instanceof SelectionError) {
        throw new PymolError(
          { kind: 'CmdException', type: 'SelectorError', message: err.message, traceback: '' },
          fn,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new PymolError(
        { kind: 'CmdException', type: 'CmdException', message, traceback: '' },
        fn,
      );
    }
  }

  /**
   * The names of every registered `cmd.*` handler. Powers the command-coverage
   * KPI (`scripts/coverage.mjs`) — a burndown of ported vs. total PyMOL symbols.
   * Order is registration order; callers that need a set should build their own.
   */
  commandNames(): string[] {
    return [...this.handlers.keys()];
  }

  /* -------------------------------- do -------------------------------- */

  /**
   * Is this word a PyMOL command (so the console runs the command language
   * rather than JavaScript)? Any registered `cmd` symbol counts, plus the
   * curated console verbs — so a newly-ported command is a console verb for
   * free, and `scene new, store` runs the scene command instead of throwing a
   * JavaScript syntax error.
   */
  private isCommandWord(kw: string): boolean {
    if (API_ONLY_SYMBOLS.has(kw)) return false;
    return KNOWN_KEYWORDS.has(kw) || this.handlers.has(kw);
  }

  // An open `embed` block's closing sentinel + destination key (parser.py). While
  // set, every incoming line is RAW embedded data, not a command, until the
  // sentinel line closes the block.
  private embedSentinel: string | null = null;
  private embedKey: string | null = null;

  do(line: string): void {
    // While an `embed` block is open, capture lines verbatim until the sentinel
    // (`parser.py` `parse_embed`): the block's raw text becomes a loadable object
    // via `load_embedded`, so it must bypass command/JS parsing entirely.
    if (this.embedSentinel !== null) {
      if (line.trim() === this.embedSentinel) {
        this.embedSentinel = null;
        this.embedKey = null;
      } else if (this.embedKey !== null) {
        this.executive.appendEmbeddedLine(this.embedKey, line.replace(/\s+$/, '') + '\n');
      }
      return;
    }

    // `embed key, format [, sentinel]` opens an embedded-data block (`parser.py`
    // EMBED keyword): register it and start capturing subsequent lines.
    const trimmed = line.trim();
    if (/^embed(\s|$)/.test(trimmed)) {
      const rest = trimmed.slice('embed'.length).trim();
      const parts = rest.length ? rest.split(',').map((s) => s.trim()) : [];
      const key = parts[0] || this.executive.embedDefaultKey || 'embedded';
      const format = parts[1] || 'pdb';
      this.embedSentinel = parts[2] || 'embed end';
      this.embedKey = key;
      this.executive.setEmbedded(key, format);
      return;
    }

    // `@file.pml` inline-includes and executes a command script (`parser.py:403`).
    // Under Node the file is read and each line replayed through `do`; in the
    // browser (no filesystem) it is reported honestly rather than mis-run as JS.
    if (line.trim().startsWith('@')) {
      this.appendFeedback(`tenmol>${line}`);
      this.includeScript(line.trim().slice(1).trim());
      return;
    }

    const commands = splitCommands(line).map(parseCommand);
    const anyCommand = commands.some((c) => this.isCommandWord(c.keyword));

    // A line with a recognized PyMOL command runs the command language.
    if (anyCommand) {
      this.appendFeedback(`tenmol>${line}`);
      for (const { keyword, args, kwargs } of commands) {
        // A `@script` include anywhere in a compound line (`sele x; @a.pml`)
        // nests one parser layer instead of being mis-run as a command.
        if (keyword.startsWith('@')) {
          this.includeScript(keyword.slice(1).trim());
          continue;
        }
        if (!this.isCommandWord(keyword)) continue;
        try {
          this.runKeyword(keyword, args, kwargs);
        } catch (err) {
          this.appendFeedback(` ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return;
    }

    // Feature/plugin Python bootstraps are silent internal plumbing.
    if (isPythonImport(line)) return;

    // EVERYTHING ELSE IS A SCRIPT — run it as JAVASCRIPT. This is the whole
    // point of a web port: PyMOL's console runs Python; here it runs JS,
    // client-side, with the `cmd` API in scope. `/expr` is the explicit escape,
    // and a bare line works too (PyMOL treats a bare non-command line as code).
    this.appendFeedback(`tenmol>${line}`);
    this.runJs(line.trim().replace(/^\//, ''));
  }

  /**
   * Execute a `@`-included command script (`parser.py:403-441`): open the file,
   * nest one parser layer, and replay each line through `do`. Blank lines and
   * `#` comments are skipped, matching PyMOL's command-file parser. Without a
   * filesystem (browser) the include is reported as unsupported.
   */
  private includeScript(filename: string): void {
    const text = readScriptFile(filename);
    if (text === null) {
      this.appendFeedback(' @script files are not supported in the browser console');
      return;
    }
    // The parser's default embed key is the script's basename sans extension
    // (`parser.py:get_default_key`), so a bare `embed`/`load_embedded` resolves.
    const base = filename.replace(/^.*[/\\]/, '').replace(/\.[^.]*$/, '');
    if (base) this.executive.embedDefaultKey = base;
    for (const raw of text.split(/\r?\n/)) {
      const stripped = raw.trim();
      // Blank/`#` lines are skipped by the command parser — but INSIDE an open
      // embed block every line is raw data, so pass them straight through.
      if (this.embedSentinel === null && (stripped === '' || stripped.startsWith('#'))) continue;
      this.do(raw);
    }
  }

  /* ----------------------------- JS console --------------------------- */

  /** The `cmd` object exposed to console JavaScript: `cmd.<symbol>(...args)`. */
  private jsCmd(): Record<string, (...args: unknown[]) => unknown> {
    return this.nsProxy('');
  }

  /**
   * A namespace proxy for the JS console: `<ns>.<fn>(...args)` dispatches through
   * the engine as `cmd.<ns>.<fn>`. With `ns === ''` it is the bare `cmd` object.
   * Nested access (`cmd.util.cbag(...)`) works because each property is itself a
   * namespace proxy until it is called.
   */
  private nsProxy(ns: string): Record<string, (...args: unknown[]) => unknown> {
    const call = (fn: string, args: unknown[]): unknown => this.call(fn, args);
    const prefix = ns === '' ? '' : `${ns}.`;
    return new Proxy(function () {} as unknown as Record<string, (...args: unknown[]) => unknown>, {
      get: (_t, prop: string | symbol) => {
        if (typeof prop !== 'string') return undefined;
        const full = `${prefix}${prop}`;
        // Callable AND further-navigable: `preset.pretty('all')` calls, while
        // `cmd.util.cbag(...)` navigates one more level first.
        const fn = (...args: unknown[]): unknown => call(full, args);
        return new Proxy(fn, {
          get: (_f, p: string | symbol) =>
            typeof p === 'string' ? this.nsProxy(full)[p] : undefined,
          apply: (_f, _this, args: unknown[]) => call(full, args),
        });
      },
    }) as Record<string, (...args: unknown[]) => unknown>;
  }

  /**
   * PyMOL module names a console script may reference bare (`editor.foo()`,
   * `util.cbag()`), so they resolve through the engine — and an unported one
   * (`editor.*`) throws a clean `NotPorted` rather than a JS `ReferenceError`.
   * Union of the namespace prefixes actually registered plus `editor`, which is
   * unported but the exact thing users reach for (`attach_amino_acid`).
   */
  private consoleNamespaces(): string[] {
    const ns = new Set<string>(['editor']);
    for (const name of this.handlers.keys()) {
      const dot = name.indexOf('.');
      if (dot > 0) ns.add(name.slice(0, dot));
    }
    // Never shadow the reserved console params.
    for (const reserved of ['cmd', 'print', 'console']) ns.delete(reserved);
    return [...ns];
  }

  /**
   * Run a line of console JavaScript. `console.log`/`print` and the expression
   * value are routed to the feedback stream, so output shows in the PyMOL
   * console the same way Python `print` does upstream. Errors are shown, not
   * thrown.
   */
  private runJs(code: string): void {
    if (code === '') return;
    const out: string[] = [];
    const fmt = (v: unknown): string => {
      if (typeof v === 'string') return v;
      try {
        return JSON.stringify(v) ?? String(v);
      } catch {
        return String(v);
      }
    };
    const log = (...a: unknown[]): void => {
      out.push(a.map(fmt).join(' '));
    };
    const consoleShim = { log, info: log, warn: log, error: log, debug: log };
    // Scope exposed to the eval: `cmd`, `print`, `console`, and one proxy per
    // PyMOL namespace so `editor.attach_amino_acid(...)` / `util.cbag(...)` route
    // through the engine instead of throwing `ReferenceError: editor is not defined`.
    const scope: Record<string, unknown> = { cmd: this.jsCmd(), print: log, console: consoleShim };
    for (const ns of this.consoleNamespaces()) scope[ns] = this.nsProxy(ns);
    const names = Object.keys(scope);
    const values = names.map((n) => scope[n]);
    try {
      let value: unknown;
      try {
        // Expression form first, so `1+1` / `cmd.count_atoms("all")` show a value.
        const fn = new Function(...names, `return (\n${code}\n);`);
        value = fn(...values);
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        // Statement form: `for (...) {...}`, `let x = ...`, multiple statements.
        const fn = new Function(...names, code);
        value = fn(...values);
      }
      if (value !== undefined) out.push(fmt(value));
    } catch (err) {
      out.push(` ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const l of out) this.appendFeedback(l);
  }

  private runKeyword(keyword: string, args: string[], kwargs: Record<string, string> = {}): void {
    // Map the console keyword to a ported handler with positional string args.
    // `kwargs` (parsed `key=value` tokens) is threaded through so verbs that take
    // keyword arguments (e.g. `spectrum expression=count`) receive them.
    switch (keyword) {
      case 'fragment':
        this.call('fragment', [args[0] ?? '', args[1] ?? ''], kwargs);
        return;
      case 'bg_color':
        this.call('bg_color', [args[0] ?? 'black'], kwargs);
        return;
      case 'reset':
        this.call('reset', [], kwargs);
        return;
      case 'show':
        this.call('show', [args[0] ?? 'lines', args[1] ?? 'all'], kwargs);
        return;
      case 'hide':
        this.call('hide', [args[0] ?? 'everything', args[1] ?? 'all'], kwargs);
        return;
      case 'as':
        this.call('as', [args[0] ?? 'lines', args[1] ?? 'all'], kwargs);
        return;
      case 'color':
        this.call('color', [args[0] ?? '', args[1] ?? 'all'], kwargs);
        return;
      case 'select':
        this.call('select', [args[0] ?? 'sele', args[1] ?? 'all'], kwargs);
        return;
      case 'delete':
        this.call('delete', [args[0] ?? 'all'], kwargs);
        return;
      case 'zoom': {
        // The console parser keeps every `key=value` token positional (it cannot
        // infer kwargs without a signature). Fold `zoom`'s `buffer` back out so a
        // console line like `zoom p, buffer=2` matches real PyMOL. A bare second
        // positional (`zoom p, 2`) is the buffer too.
        const zk: Record<string, unknown> = { ...kwargs };
        const zpos: unknown[] = [];
        for (const a of args) {
          if (typeof a === 'string') {
            const eq = a.indexOf('=');
            const key = eq > 0 ? a.slice(0, eq).trim() : '';
            if (eq > 0 && key === 'buffer') {
              zk['buffer'] = a.slice(eq + 1).trim();
              continue;
            }
          }
          zpos.push(a);
        }
        this.call('zoom', [zpos[0] ?? 'all', zpos[1]], zk);
        return;
      }
      case 'orient':
        this.call('orient', [args[0] ?? 'all'], kwargs);
        return;
      case 'turn':
        this.call('turn', [args[0] ?? 'y', Number(args[1] ?? 0)], kwargs);
        return;
      case 'set':
        this.call('set', [args[0] ?? '', args[1] ?? '1', args[2] ?? ''], kwargs);
        return;
      default:
        // Any other registered command: call it generically with the console's
        // positional string arguments (the handler coerces them). This is what
        // makes every ported `cmd` symbol a console verb — `scene`, `spectrum`,
        // `rotate`, `dss`, ... — without a bespoke case each.
        if (this.handlers.has(keyword)) {
          this.call(keyword, args, kwargs);
          return;
        }
        // A command-shaped word we do not implement: report it (PyMOL's own
        // "unknown command"), rather than letting it fall through to the JS
        // evaluator and throw a syntax error.
        throw new Error(`Error: unknown command '${keyword}'`);
    }
  }

  /* ------------------------------ input ------------------------------- */

  input(msg: {
    kind: string;
    x?: number;
    y?: number;
    state?: number;
    width?: number;
    height?: number;
  }): Json {
    switch (msg.kind) {
      case 'button':
        this.dragging = msg.state === 0;
        this.lastX = msg.x ?? 0;
        this.lastY = msg.y ?? 0;
        return null;
      case 'drag': {
        if (this.dragging) {
          const dx = (msg.x ?? 0) - this.lastX;
          const dy = (msg.y ?? 0) - this.lastY;
          this.lastX = msg.x ?? 0;
          this.lastY = msg.y ?? 0;
          this.executive.view.turn('y', dx * 0.5);
          this.executive.view.turn('x', -dy * 0.5);
          this.emitView();
        }
        return null;
      }
      case 'reshape': {
        this.executive.setViewport(msg.width ?? -1, msg.height ?? -1);
        const [width, height] = this.executive.getViewport();
        return { width, height };
      }
      default:
        return null;
    }
  }

  /* --------------------------- feedback drain ------------------------- */

  drainFeedback(): string[] {
    const out = this.feedback;
    this.feedback = [];
    return out;
  }

  private appendFeedback(line: string): void {
    this.feedback.push(line);
    this.emitter.emit('feedback', { lines: [line] });
  }

  /* ----------------------------- registry ----------------------------- */

  private register(): void {
    const ex = this.executive;
    const h = (name: string, fn: Handler): void => void this.handlers.set(name, fn);
    const str = (v: unknown, d = ''): string => (v === undefined || v === null ? d : String(v));

    h('read_pdbstr', (args, kwargs) => {
      const pdb = str(args[0]);
      const requested = str(args[1] ?? kwargs['object']);
      const name = ex.uniqueName(requested || 'obj');
      const mol = parsePdb(pdb, name);
      ex.addMolecule(mol);
      ex.autoColorObject(mol);
      this.publish();
      return name;
    });

    h('get_names', (args) => ex.getNames(str(args[0], 'public_objects'), Boolean(args[1])));

    h('count_atoms', (args) => ex.countAtoms(str(args[0], 'all') || 'all'));

    h('select', (args) => {
      const n = ex.select(str(args[0], 'sele') || 'sele', str(args[1], 'all') || 'all');
      this.emitObjects();
      return n;
    });

    // `cmd.select_list(name, object, id_list, state=0, mode='id', quiet=1)` —
    // API-only selection of one object's atoms by an explicit id/index/rank list.
    h('select_list', (args, kwargs) => {
      const name = str(args[0] ?? kwargs['name']);
      const object = str(args[1] ?? kwargs['object']);
      const raw = (args[2] ?? kwargs['id_list']) as unknown;
      const idList = Array.isArray(raw) ? raw.map((v) => Number(v)) : [];
      const state = Number(args[3] ?? kwargs['state'] ?? 0);
      const modeRaw = str(args[4] ?? kwargs['mode'] ?? 'id') || 'id';
      const mode = modeRaw as 'index' | 'id' | 'rank';
      if (mode !== 'index' && mode !== 'id' && mode !== 'rank') {
        throw new SelectionError(`select_list: invalid identifier type '${modeRaw}'`);
      }
      const n = ex.selectList(name, object, idList, state, mode);
      this.emitObjects();
      return n;
    });

    h('delete', (args) => {
      ex.delete(str(args[0], 'all') || 'all');
      this.publish();
      return null;
    });

    h('color', (args) => {
      ex.color(str(args[0]), str(args[1], 'all') || 'all');
      this.publish();
      return null;
    });

    h('show', (args) => {
      ex.show(str(args[0], 'lines') || 'lines', str(args[1], 'all') || 'all');
      this.publish();
      return null;
    });
    h('hide', (args) => {
      ex.hide(str(args[0], 'everything') || 'everything', str(args[1], 'all') || 'all');
      this.publish();
      return null;
    });
    h('show_as', (args) => {
      ex.showAs(str(args[0], 'lines') || 'lines', str(args[1], 'all') || 'all');
      this.publish();
      return null;
    });
    // `as` is a Python keyword, so the API name is `show_as`; the console maps it.
    h('as', (args) => this.call('show_as', args));

    h('get_view', () => ex.view.get());
    h('set_view', (args) => {
      const v = args[0];
      if (!Array.isArray(v)) throw new Error('set_view expects a list of 18 floats');
      const view = (v as unknown[]).map(Number);
      // Element 17 is the SIGNED field of view. SceneSetView (layer1/Scene.cpp)
      // does not store it per-view: it updates the `field_of_view` /
      // `orthoscopic` SETTINGS from it (only when the magnitude clears ~1), and
      // get_view then reports `ortho ? fov : -fov` off those settings. Mirror
      // that so, e.g., a passed fov of 0 leaves the default (20) intact and
      // get_view reports -20 rather than round-tripping the raw 0.
      const fov = Number(view[17]);
      if (fov < 0) {
        ex.set('orthoscopic', 0);
        if (fov < -(1 - 1e-4)) ex.set('field_of_view', -fov);
      } else {
        ex.set('orthoscopic', fov > 0.5 ? 1 : 0);
        if (fov > 1 + 1e-4) ex.set('field_of_view', fov);
      }
      const settingFov = ex.getSettingFloat('field_of_view');
      view[17] = ex.getSettingFloat('orthoscopic') !== 0 ? settingFov : -settingFov;
      ex.view.set(view);
      this.emitView();
      return null;
    });
    h('turn', (args) => {
      ex.view.turn(str(args[0], 'y') as 'x' | 'y' | 'z', Number(args[1] ?? 0));
      this.emitView();
      return null;
    });
    h('zoom', (args, kwargs) => {
      // `ExecutiveWindowZoom(sele, buffer)` (Executive.cpp): frame the WEIGHTED
      // extent — origin at the centre of mass, radius = half the largest
      // (buffer-grown, recentred) box dimension floored to MAX_VDW, clip slab at
      // ±1.2·radius — exactly like `reset` but on a selection and with `buffer`.
      // NOT a plain bounding sphere. See `windowZoomSphere`/`ViewState.windowSphere`.
      const buffer = Number(args[1] ?? kwargs['buffer'] ?? 0);
      const sphere = ex.windowZoomSphere(str(args[0], 'all') || 'all', buffer);
      if (sphere) ex.view.windowSphere(sphere.center, sphere.radius);
      this.emitView();
      return null;
    });
    h('orient', (args) => {
      const info = ex.orientInfo(str(args[0], 'all') || 'all');
      if (info) ex.view.orientTo(info.moment, info.center, info.radius);
      this.emitView();
      return null;
    });

    h('set', (args) => {
      const name = str(args[0]);
      const raw = args[1];
      const value =
        typeof raw === 'number' ? raw : Number.isNaN(Number(raw)) ? str(raw) : Number(raw);
      ex.set(name, value);
      this.publish();
      return null;
    });
    h('get_setting', (args) => ex.getSetting(str(args[0])) ?? null);
    h('get_setting_float', (args) => ex.getSettingFloat(str(args[0])));
    h('get_setting_int', (args) => Math.trunc(ex.getSettingFloat(str(args[0]))));
    h('get_setting_boolean', (args) => ex.getSettingFloat(str(args[0])) !== 0);

    // `cmd.get_viewport()` — the scene rectangle in pixels (width, height). The
    // Mode-G viewport polls this to size its GL scissor/viewport. Reads the size
    // the `viewport` command (settings2 subsystem) and `reshape` both write into
    // the executive, so the setter and this reader share ONE source of truth.
    h('get_viewport', () => ex.getViewport());

    // `_bridge.pull_geometry(object, repName, state)` — the Mode-G PULL path.
    // The viewport requests a rep; we push the frame out of band (like the
    // bridge does) and answer with the PullResult status. This is what makes
    // rendering reliable: a frame the viewport missed on the initial push is
    // re-fetched here the moment it tracks the object.
    h('_engine.pull_geometry', (args) => this.pullGeometry(args));
    h('_bridge.pull_geometry', (args) => this.pullGeometry(args));

    // `_bridge.ray` / `_bridge.draw` — the web UI's Ray/Draw buttons
    // (`features/render/RenderDialog.tsx`). The real bridge renders and pushes a
    // Mode-P still onto the pixel stream; the local engine has no GL, so it runs
    // the CPU ray tracer (`cmd/render.ts`) into the image buffer instead. The
    // rendered PNG is then read back with `cmd.png(prior)` for the dialog preview
    // / save / clipboard. Returns null, exactly like the bridge symbol.
    const bridgeRender = (args: unknown[], shadows: boolean): Json => {
      const [vw, vh] = ex.getViewport();
      const w = Math.round(Number(args[0]) || 0) || vw;
      const h2 = Math.round(Number(args[1]) || 0) || vh;
      setLastImage(ex, renderRayImage(ex, w, h2, shadows, resolveAntialias(-1)));
      return null;
    };
    h('_bridge.ray', (args) => bridgeRender(args, true));
    h('_bridge.draw', (args) => bridgeRender(args, false));

    // `cmd.tenmol_objects('snapshot')` — the object-panel endpoint. Answering it
    // means the panel renders from real rows (group/enabled/reps/caption)
    // instead of the get_names fallback, and its "endpoint unavailable" notice
    // goes away.
    h('tenmol_objects', (args) => this.objectsPanel(str(args[0], 'snapshot')));

    // NOTE ON PANEL ENDPOINTS. The movie/scene *panel* endpoints
    // (get_movie_panel, get_scene_panel, cmd.do-as-a-call, ...) return rich
    // structures the features dereference, and those features PROBE-then-degrade
    // gracefully when the endpoint is missing. A wrong-shape stub crashes them
    // and making cmd.do callable removes the graceful-fallback trigger, so both
    // are deliberately left NotPorted until the real shapes are implemented.

    h('get_color_index', (args) => getColorIndex(str(args[0])));
    h('get_color_tuple', (args) => {
      // Accept a colour name OR an index (real PyMOL's `get_color_tuple`
      // resolves a name via `get_color_index` first — querying.py).
      const arg = args[0];
      let idx: number;
      if (typeof arg === 'number') {
        idx = arg;
      } else {
        const s = str(arg);
        idx = s !== '' && Number.isFinite(Number(s)) ? Number(s) : getColorIndex(s);
      }
      const t = idx < 0 ? null : getColorTuple(idx);
      if (!t) return null;
      // Re-map through the active colour space (`space cmyk|pymol|…`), matching
      // PyMOL's `ColorGet` returning the LUT colour when `clamp_colors` is on.
      const s = ex.spaceColor(t);
      return [s[0], s[1], s[2]];
    });

    // `cmd.fragment(name, object)` — load a built-in fragment and frame it.
    h('fragment', (args, kwargs) => {
      const name = str(args[0]);
      const requested = str(args[1] ?? kwargs['object']) || name;
      const objName = ex.uniqueName(requested || name || 'obj');
      const mol = buildLibraryFragment(name, objName);
      if (!mol) {
        throw new PymolError(
          {
            kind: 'CmdException',
            type: 'CmdException',
            message: `fragment '${name}' is not in the TypeScript engine's library yet`,
            traceback: '',
          },
          'fragment',
        );
      }
      ex.addMolecule(mol);
      ex.autoColorObject(mol);
      const sphere = ex.selectionSphere(objName);
      if (sphere) ex.view.zoomToSphere(sphere.center, sphere.radius);
      this.publish();
      return objName;
    });

    h('bg_color', (args) => {
      ex.set('bg_rgb', getColorIndex(str(args[0], 'black')) || 0);
      this.emitView();
      return null;
    });

    h('reset', () => {
      // `ExecutiveReset(all)` = `SceneResetMatrix` (rotation -> identity) then
      // `ExecutiveWindowZoom(all)` (Executive.cpp). Window-zoom frames the
      // WEIGHTED extent: origin at the centre of mass, radius = half the largest
      // (recentred) box dimension, clip slab at ±1.2·radius — not a plain
      // bounding sphere. See `windowZoomSphere` / `ViewState.windowSphere`.
      ex.view.resetMatrix();
      const sphere = ex.windowZoomSphere('all');
      if (sphere) ex.view.windowSphere(sphere.center, sphere.radius);
      else ex.view.set(defaultView());
      this.emitView();
      return null;
    });

    // ---- benign read defaults ----------------------------------------------
    // A fresh, empty PyMOL session answers these with trivial values. Answering
    // them the same way keeps the app's panels (movie, scenes, views, mouse,
    // settings) rendering CLEANLY on the local engine instead of showing a red
    // "not ported" error for every idle poll. These are reads only; nothing is
    // pretending to implement a feature.
    // `cmd.get_scene_list()` -> `_cmd.get_scene_order` -> `MovieSceneGetOrder`
    // (layer3/MovieScene.cpp): the scene bin's keys, in bin order.
    h('get_scene_list', () => [...this.sceneOrder]);
    h('get_scene_dict', () => ({}) as unknown as Json);
    // `cmd.get_scene_message(name)` -> `MovieSceneGetMessage`: the stored
    // wizard message, or '' when the scene is unknown / has no message.
    h('get_scene_message', (args) => this.sceneDict.get(str(args[0], ''))?.message ?? '');
    // `cmd.set_scene_message(name, message)` -> `MovieSceneSetMessage`
    // (layer3/MovieScene.cpp): store the wizard message on an existing scene.
    // An unknown scene is an error ("<name> could not be found.").
    h('set_scene_message', (args) => {
      const name = str(args[0], '');
      const scene = this.sceneDict.get(name);
      if (!scene) throw this.sceneError(`${name} could not be found.`);
      scene.message = str(args[1], '');
      return null;
    });
    h('get_frame', () => 1);
    h('get_state', () => 1);
    h('count_frames', () => 0);
    h(
      'count_states',
      (args) => ex.molecule(str(args[0]))?.nstate ?? ex.moleculesInOrder()[0]?.nstate ?? 1,
    );
    h('count_discrete', () => 0);
    h('get_movie_locked', () => 0);
    h('get_movie_length', () => 0);
    h('get_movie_playing', () => 0);
    // The web movie panel's aggregate poll. Mirrors the shape its fallback
    // builds from the individual getters (movie/movieSource.ts).
    h('get_movie_status', () => ({
      frame: 1,
      state: 1,
      nframes: 0,
      length: 0,
      playing: false,
      locked: false,
      rocking: false,
      fps: null,
      sceneCurrent: null,
      settings: {},
    }));
    h('get_object_list', (args) => ex.getObjectList(str(args[0], '(all)')));
    const getType = (name: string): string => {
      if (ex.measurement(name)) return 'object:measurement';
      const g = ex.gadget(name);
      if (g) return g.kind;
      const mol = ex.molecule(name);
      if (mol) return mol.kind as string;
      // A defined named selection (not an object) reports as 'selection'
      // (ExecutiveGetType: object lookup fails, selection lookup succeeds).
      if (ex.hasSelection(name)) return 'selection';
      return 'object:molecule';
    };
    // `get_names_of_type(type, public=1)` — the pure-Python wrapper (querying.py):
    // enumerate `public_objects` (or `objects` when public=0) and keep the names
    // whose `get_type` equals the requested type string.
    h('get_names_of_type', (args) => {
      const type = str(args[0], '');
      const publicOnly = args[1] === undefined ? true : Boolean(Number(args[1]));
      return ex.getNames(publicOnly ? 'public_objects' : 'objects').filter((n) => getType(n) === type);
    });
    h('get_type', (args) => getType(str(args[0], '')));
    h('get_vis', () => ({}) as unknown as Json);
    h('get_setting_updates', () => []);
    h('get_setting_text', (args) => {
      const name = str(args[0]);
      const v = ex.getSetting(name);
      // Colour-typed settings read back as a colour NAME, not the raw index —
      // `SettingGetTextPtr`'s `cSetting_color` branch (`Setting.cpp`).
      // Colour settings are never float3, so the scalar cast is safe here.
      if (COLOR_SETTINGS.has(name)) return colorSettingText(v as number | string | undefined);
      return v === undefined ? '' : String(v);
    });
    h('get_setting_tuple', (args) => [ex.getSetting(str(args[0])) ?? 0]);
    h('get', (args) => (ex.getSetting(str(args[0])) ?? null) as Json);
    h('get_title', () => '');
    h('set_title', () => null);
    // `cmd.get_drag_object_name()` — the name of the object currently under
    // interactive drag (editor move) mode. The editor's drag subsystem is not
    // ported, so nothing is ever the drag target; real PyMOL returns an empty
    // string when no object is being dragged (querying.py:84), which is the only
    // observable state here.
    h('get_drag_object_name', () => '');
    h('matrix_reset', () => null);
    // `cmd.get_object_color_index(name)` — `ExecutiveGetObjectColorIndex`
    // (layer3/Executive.cpp): return the object's `Color` index, or -1 when no
    // object of that name exists. A fresh object's `Color` defaults to 0
    // (PyMOLObject.h:79 `int Color = 0;`); `set_object_color` stores the real
    // index (tracked by the display registrar's `get_object_color`, which uses
    // -1 as its "unset" sentinel — mapped back to the 0 default here).
    h('get_object_color_index', (args) => {
      const name = str(args[0], '');
      if (!ex.molecule(name)) return -1;
      const stored = Number(this.call('get_object_color', [name]));
      return stored < 0 ? 0 : stored;
    });
    h('get_object_matrix', (args) => {
      const mol = ex.molecule(str(args[0], ''));
      return (mol?.objectMatrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) as Json;
    });
    // `cmd.matrix_copy(source, target, ...)` (`modules/pymol/editing.py:matrix_copy`)
    // copies an object's transformation matrix onto another object — or, when the
    // target is empty, composes the source object's matrix into the camera view
    // and re-applies it via `set_view` (the view adopts the object's frame). Only
    // the empty-target path has an observable side effect our state model can
    // expose (`get_view`); the object-to-object path copies the stored state
    // matrix. `matrix_transfer` is a legacy alias for the same command.
    const matrixCopy = (args: unknown[], kwargs: Record<string, unknown>): Json => {
      const sourceName = str(args[0] ?? kwargs['source_name'], '').trim();
      const targetName = str(args[1] ?? kwargs['target_name'], '').trim();
      const sourceMode = Number(args[2] ?? kwargs['source_mode'] ?? -1);
      const targetMode = Number(args[3] ?? kwargs['target_mode'] ?? -1);
      const sourceState = Number(args[4] ?? kwargs['source_state'] ?? 1);
      if (targetName === '' && sourceName !== '') {
        const mat = this.call('get_object_matrix', [sourceName, sourceState]) as number[];
        const v = ex.view.get();
        // Compose the row-major object matrix `mat` with the 18-float `view`,
        // exactly as editing.py does (rotation ✕ view-rotation, plus the
        // origin-corrected translation), then re-apply through set_view.
        const nv = [
          mat[0]! * v[0]! + mat[4]! * v[3]! + mat[8]! * v[6]!,
          mat[0]! * v[1]! + mat[4]! * v[4]! + mat[8]! * v[7]!,
          mat[0]! * v[2]! + mat[4]! * v[5]! + mat[8]! * v[8]!,
          mat[1]! * v[0]! + mat[5]! * v[3]! + mat[9]! * v[6]!,
          mat[1]! * v[1]! + mat[5]! * v[4]! + mat[9]! * v[7]!,
          mat[1]! * v[2]! + mat[5]! * v[5]! + mat[9]! * v[8]!,
          mat[2]! * v[0]! + mat[6]! * v[3]! + mat[10]! * v[6]!,
          mat[2]! * v[1]! + mat[6]! * v[4]! + mat[10]! * v[7]!,
          mat[2]! * v[2]! + mat[6]! * v[5]! + mat[10]! * v[8]!,
          v[9]!,
          v[10]!,
          v[11]!,
          mat[0]! * v[12]! + mat[1]! * v[13]! + mat[2]! * v[14]! -
            mat[0]! * mat[3]! - mat[4]! * mat[7]! - mat[8]! * mat[11]!,
          mat[4]! * v[12]! + mat[5]! * v[13]! + mat[6]! * v[14]! -
            mat[1]! * mat[3]! - mat[5]! * mat[7]! - mat[9]! * mat[11]!,
          mat[8]! * v[12]! + mat[9]! * v[13]! + mat[10]! * v[14]! -
            mat[2]! * mat[3]! - mat[6]! * mat[7]! - mat[10]! * mat[11]!,
          v[15]!,
          v[16]!,
          v[17]!,
        ];
        return this.call('set_view', [nv]);
      }
      // Object-to-object: copy the source's stored state matrix onto the target.
      const srcMol = ex.molecule(sourceName);
      const tgtMol = ex.molecule(targetName);
      if (srcMol && tgtMol) {
        tgtMol.objectMatrix = srcMol.objectMatrix ? srcMol.objectMatrix.slice() : undefined;
        // `copy_ttt_too`: when both modes are auto (-1, the default), PyMOL also
        // copies the object's TTT display matrix (`ExecutiveMatrixCopy2`), but
        // only when the source actually has one — a missing source TTT never
        // clears the target's. Mirror that so a TTT set by `translate object=`
        // (or a movie/drag transform) transfers along with the state matrix.
        if (sourceMode < 0 && targetMode < 0 && srcMol.ttt) {
          tgtMol.ttt = srcMol.ttt.slice();
        }
        this.publish();
      }
      return null;
    };
    h('matrix_copy', matrixCopy);
    h('matrix_transfer', matrixCopy);
    // `cmd.matrix_reset(name, state=1, mode=-1, log=0, quiet=1)`
    // (`modules/pymol/editing.py:matrix_reset` → `ExecutiveResetMatrix`). Undo a
    // transform applied to an object. `mode` selects the target: 0 = the
    // transformation baked into the coordinates (reversed by applying its
    // inverse, which also left-combines the recorded matrix back to identity),
    // 1 = the TTT display matrix, 2 = the state (object) matrix. mode=-1 falls
    // back to the `matrix_mode` setting (or 0 when unset/negative), exactly as
    // the C layer does.
    const matrixReset = (args: unknown[], kwargs: Record<string, unknown>): Json => {
      const name = str(args[0] ?? kwargs['name'], '').trim();
      const state = Number(args[1] ?? kwargs['state'] ?? 1);
      const log = Number(args[3] ?? kwargs['log'] ?? 0);
      let mode = Number(args[2] ?? kwargs['mode'] ?? -1);
      if (!Number.isFinite(mode) || mode < 0) {
        const mm = Number(this.call('get_setting_int', ['matrix_mode']));
        mode = Number.isFinite(mm) && mm >= 0 ? mm : 0;
      }
      const mol = ex.molecule(name);
      if (!mol) {
        throw new PymolError(
          {
            kind: 'CmdException',
            type: 'CmdException',
            message: 'No object found',
            traceback: '',
          },
          'matrix_reset',
        );
      }
      switch (mode) {
        case 0: {
          // Reverse the transform recorded into the coordinates by applying its
          // inverse; transform_object left-combines it, so the stored matrix
          // collapses back to identity (matching CoordSetRecordTxfApplied).
          const inv = mol.objectMatrix ? invertAffine44(mol.objectMatrix) : null;
          if (inv) this.call('transform_object', [name, inv, state, log, '', 1]);
          break;
        }
        case 1:
          mol.ttt = undefined;
          this.publish();
          break;
        case 2:
          mol.objectMatrix = undefined;
          this.publish();
          break;
      }
      return null;
    };
    h('matrix_reset', matrixReset);
    h('get_object_ttt', () => null);
    h('get_progress', () => -1);
    h('get_idle', () => 0);
    // `cmd.get_version()` (`layer4/Cmd.cpp:CmdGetVersion`) returns the compiled-in
    // version tuple `(text, double, int, build_date, git_sha, svn_rev)`. The
    // text/double/int come from `layer0/Version.h`
    // (`_PyMOL_VERSION`, `_PyMOL_VERSION_int`, `double = int / 1e6`); the build
    // date (unix ts) and git sha are baked in at build time. The port mirrors the
    // reference PyMOL build it is verified against.
    h('get_version', () => [
      '3.2.0a',
      3000000 / 1000000,
      3000000,
      1786014386,
      'c030472fa9f5ad96994bf3e4d4277b3862057897',
      0,
    ]);
    h('get_renderer', () => ['tenmol-engine-ts (WebGL2)', 'browser', '']);
    // `cmd.view(key, action, animate)` — named camera views. The views panel
    // lists them by a deliberately-failing recall and parsing the error's
    // "Choices:" block (there is no getter, upstream), so an unknown recall MUST
    // raise with the sorted names, exactly as PyMOL's Shortcut.auto_err does.
    h('view', (args) => {
      const key = str(args[0]);
      const action = str(args[1], 'recall') || 'recall';
      if (action === 'store') {
        this.views.set(key, ex.view.get());
        return null;
      }
      if (action === 'clear') {
        if (key === '*') this.views.clear();
        else this.views.delete(key);
        return null;
      }
      // recall
      const stored = this.views.get(key);
      if (stored) {
        ex.view.set(stored);
        this.emitView();
        return null;
      }
      const names = [...this.views.keys()].sort();
      throw new PymolError(
        {
          kind: 'CmdException',
          type: 'CmdException',
          message: `unknown view: '${key}'. Choices:\n  ${names.join('  ')}`,
          traceback: '',
        },
        'view',
      );
    });
    // `cmd.scene(key, action, …)` — store/recall/reorder the scene bin.
    // Ported from `MovieSceneFunc` (layer3/MovieScene.cpp) plus the argument
    // canonicalisation in `viewing.scene` (modules/pymol/viewing.py).
    h('scene', (args, kwargs) => this.runScene(args, kwargs));
    // `cmd.scene_order(names, sort, location)` — reorder the scene bin. Mirrors
    // the argument canonicalisation in `viewing.scene_order` (a string `names`
    // splits on whitespace, `sort` accepts boolean-like words, `location` is a
    // top/current/bottom shortcut) feeding `MovieSceneOrder`.
    h('scene_order', (args, kwargs) => this.runSceneOrder(args, kwargs));
    // `internal._special(k, x, y, m=0)` — dispatch a GLUT special key (F1–F12,
    // PgUp/PgDn, …). Real PyMOL first honours an explicit `set_key` mapping, then
    // tries the key name against the scene list, then the named-view dictionary.
    // Explicit `set_key` bindings are not ported (no `key_mappings` table), so we
    // fall straight through to scenes then views, exactly as internal._special's
    // scene/view loop does — returning True on the first hit, else False.
    h('_special', (args) => {
      const k = Math.trunc(Number(args[0]));
      const m = Math.trunc(Number(args[3] ?? 0));
      const base = SPECIAL_KEY_CODES[k];
      if (base === undefined) return false;
      if (m && MODIFIER_KEYS[m] === undefined) return false;
      const key = m ? `${MODIFIER_KEYS[m]}-${base}` : base;
      for (const [fn, keywords] of [
        ['scene', [...this.sceneOrder]] as const,
        ['view', [...this.views.keys()]] as const,
      ]) {
        if (keywords.includes(key)) {
          this.call(fn, [key]);
          return true;
        }
        const autocomp = shortcutInterpret(keywords, key + '-');
        if (typeof autocomp === 'string') {
          this.call(fn, [autocomp]);
          return true;
        }
      }
      return false;
    });
    h('wizards.catalog', () => []);
    // NOTE: only stub a symbol when the EMPTY shape is known. wizards.probe /
    // wizards.snapshot return rich objects a feature dereferences; a wrong-shape
    // stub crashes it, whereas an honest NotPorted is caught and shown cleanly.
    // So they are deliberately left unported.
    h('setting.get_name_list', () => []);
    h('setting.get_index_list', () => []);

    // A per-atom colour/vis probe the differential suite reads. Schema-stable,
    // NEW (not upstream), namespaced under `_engine` so it never shadows a real
    // PyMOL symbol; the remote side answers it via a bridge route in the harness.
    h('_engine.atom_report', (args) => this.atomReport(str(args[0], 'all') || 'all'));

    h('get_model', (args) => this.getModel(str(args[0], 'all') || 'all'));
    // `cmd.do(line)` — run a command line through the console. Mirrors the
    // Backend `do()` method for callers that reach it via `call('cmd.do', ...)`
    // (the movie panel bootstrap, macros). Errors are echoed to feedback, not
    // thrown, exactly like the console.
    h('do', (args) => {
      this.do(str(args[0], ''));
      return null;
    });

    // Subsystems in their own modules register their `cmd.*` handlers here.
    const ctx: RegistrarCtx = {
      command: (name, fn) => void this.handlers.set(name, fn),
      call: (name, args = [], kwargs = {}) => this.call(name, args, kwargs),
      executive: ex,
      publish: () => this.publish(),
      emitView: () => this.emitView(),
      str: (v, d = '') => str(v, d),
    };
    for (const register of ALL_REGISTRARS) register(ctx);
  }

  /* ------------------------------- scenes -------------------------------- */

  /** The `scene_current_name` setting, as a plain string ('' when unset). */
  private sceneCurrentName(): string {
    const v = this.executive.getSetting('scene_current_name');
    return v === undefined ? '' : String(v);
  }

  /** Set `scene_current_name` so the value is observable via `get_setting_text`. */
  private setSceneCurrentName(name: string): void {
    this.executive.set('scene_current_name', name);
  }

  /** `CMovieScenes::getUniqueKey()` — the next free "%03d" scene key. */
  private uniqueSceneKey(): string {
    for (;;) {
      const key = String(this.sceneCounter).padStart(3, '0');
      if (!this.sceneDict.has(key)) return key;
      this.sceneCounter++;
    }
  }

  /**
   * `MovieSceneStore` — create/overwrite scene `key`, appending it to the order
   * when new. Empty/"new" key auto-numbers. Returns the resolved key.
   */
  private sceneStore(key: string, message: string, storeView: boolean): string {
    if (key === '' || key === 'new') {
      key = this.uniqueSceneKey();
      this.sceneOrder.push(key);
    } else if (!this.sceneDict.has(key)) {
      this.sceneOrder.push(key);
    }
    this.setSceneCurrentName(key);
    this.sceneDict.set(key, {
      view: storeView ? this.executive.view.get() : null,
      message,
      frame: 1,
    });
    return key;
  }

  /** `MovieSceneRecall` — restore the stored view; false if `key` is unknown. */
  private sceneRecall(key: string, recallView: boolean): boolean {
    const scene = this.sceneDict.get(key);
    if (!scene) return false;
    this.setSceneCurrentName(key);
    if (recallView && scene.view) {
      this.executive.view.set(scene.view);
      this.emitView();
    }
    return true;
  }

  /**
   * `MovieSceneRename` — rename `name` to `newName`, or (empty `newName`)
   * delete it. `name === '*'` clears the whole bin. Updates `scene_current_name`.
   */
  private sceneRename(name: string, newName: string): void {
    if (name === '*') {
      this.sceneOrder.length = 0;
      this.sceneDict.clear();
      return;
    }
    if (newName && name === newName) return;
    const scene = this.sceneDict.get(name);
    if (!scene) throw this.sceneError(`${name} could not be found.`);
    this.sceneDict.delete(name);
    const idx = this.sceneOrder.indexOf(name);
    if (newName) {
      this.sceneDict.set(newName, scene);
      // Overwriting an existing key drops its old slot before renaming.
      const oldNew = this.sceneOrder.indexOf(newName);
      if (idx >= 0) this.sceneOrder[idx] = newName;
      if (oldNew >= 0 && oldNew !== idx) this.sceneOrder.splice(oldNew, 1);
    } else if (idx >= 0) {
      this.sceneOrder.splice(idx, 1);
    }
    if (name === this.sceneCurrentName()) this.setSceneCurrentName(newName);
  }

  /**
   * `MovieSceneOrder` — move `names` to `location` (top|current|bottom),
   * optionally natural-sorting them first. `names === '*'` reorders the whole
   * bin (only meaningful with `sort`).
   */
  private sceneOrderMove(names: string[], sort: boolean, location: string): void {
    let list = names;
    const isAll = list.length === 1 && list[0] === '*';
    if (isAll) {
      list = [...this.sceneOrder];
    } else {
      for (const name of list) {
        if (!this.sceneDict.has(name)) throw this.sceneError(`Scene '${name}' is not defined.`);
      }
    }
    if (list.length === 0) return;
    if (sort) list = [...list].sort(naturalCompare);

    let newOrder: string[];
    if (isAll) {
      newOrder = list;
    } else {
      const set = new Set(list);
      if (set.size !== list.length) throw this.sceneError('Duplicated keys.');
      const loc = (location || 'current')[0];
      newOrder = [];
      if (loc === 't') newOrder.push(...list);
      for (const name of this.sceneOrder) {
        if (!set.has(name)) newOrder.push(name);
        else if (loc === 'c' && name === list[0]) newOrder.push(...list);
      }
      if (loc === 'b') newOrder.push(...list);
    }
    this.sceneOrder.length = 0;
    this.sceneOrder.push(...newOrder);
  }

  /**
   * `cmd.scene_order` — the argument canonicalisation from `viewing.scene_order`
   * (a string `names` splits on whitespace, `sort` accepts boolean-like words,
   * `location` resolves through the top/current/bottom shortcut) feeding
   * `MovieSceneOrder`.
   */
  private runSceneOrder(args: unknown[], kwargs: Record<string, unknown>): Json {
    const str = (v: unknown, d = ''): string => (v === undefined || v === null ? d : String(v));

    const rawNames = args[0] ?? kwargs['names'];
    let names: string[];
    if (Array.isArray(rawNames)) names = rawNames.map((n) => String(n));
    else names = str(rawNames, '').split(/\s+/).filter(Boolean);

    const rawSort = args[1] ?? kwargs['sort'] ?? 0;
    const location = str(args[2] ?? kwargs['location'], 'current') || 'current';

    this.sceneOrderMove(names, sceneBoolean(rawSort), location);
    this.executive.set('scenes_changed', 1);
    return null;
  }

  /** `MovieSceneGetNextKey` — next/previous key relative to `scene_current_name`. */
  private sceneNextKey(next: boolean): string {
    const current = this.sceneCurrentName();
    const loop = this.executive.getSetting('scene_loop');
    // Default scene_loop is on (SettingInfo.h); an empty current always loops.
    let sceneLoop = loop === undefined ? true : Number(loop) !== 0;
    if (!current) sceneLoop = true;
    const order = this.sceneOrder;
    let i = order.indexOf(current);
    if (next) {
      if (i >= 0 && i < order.length - 1) i += 1;
      else if (sceneLoop) i = 0;
      else return '';
    } else {
      if (i > 0) i -= 1;
      else if (sceneLoop) i = order.length - 1;
      else return '';
    }
    return order[i] ?? '';
  }

  /** `MovieSceneOrderBeforeAfter` — move the current scene next to `key`. */
  private sceneOrderBeforeAfter(key: string, before: boolean): void {
    let location: string | undefined;
    const key2 = this.sceneCurrentName();
    let anchor = key;
    if (before) {
      const it = this.sceneOrder.indexOf(key);
      if (it === 0) {
        location = 'top';
        anchor = '';
      } else if (it > 0) {
        anchor = this.sceneOrder[it - 1] ?? '';
      }
    }
    const names = [anchor, key2].filter((n) => n !== '');
    this.sceneOrderMove(names, false, location ?? 'current');
  }

  private sceneError(message: string): PymolError {
    return new PymolError(
      { kind: 'CmdException', type: 'CmdException', message, traceback: '' },
      'scene',
    );
  }

  /**
   * `cmd.scene` — the argument canonicalisation from `viewing.scene` followed by
   * the action dispatch in `MovieSceneFunc`.
   */
  private runScene(args: unknown[], kwargs: Record<string, unknown>): Json {
    const str = (v: unknown, d = ''): string => (v === undefined || v === null ? d : String(v));

    // The console parser keeps every comma-separated token positional (it cannot
    // safely split `=` in general — see cmd/parser.ts). PyMOL's Python arg binder
    // does interpret a `name=value` token as a keyword argument against the
    // command's signature, so `scene F1, store, message=hi` binds `message`. We
    // reproduce that here: peel `name=value` tokens whose name is a known scene
    // parameter out of the positional list and into kwargs. Only the first `=`
    // splits, so a value may itself contain `=`.
    const SCENE_PARAMS = new Set([
      'key', 'action', 'message', 'view', 'color', 'active',
      'rep', 'frame', 'animate', 'new_key', 'hand', 'quiet', 'sele',
    ]);
    const pos: unknown[] = [];
    const kw: Record<string, unknown> = { ...kwargs };
    for (const a of args) {
      if (typeof a === 'string') {
        const eq = a.indexOf('=');
        if (eq > 0) {
          const name = a.slice(0, eq).trim();
          if (SCENE_PARAMS.has(name)) {
            kw[name] = a.slice(eq + 1);
            continue;
          }
        }
      }
      pos.push(a);
    }

    let key = str(pos[0] ?? kw['key'], 'auto') || 'auto';
    let action = (str(pos[1] ?? kw['action'], 'recall') || 'recall').toLowerCase();
    const rawMsg = pos[2] ?? kw['message'];
    const message = rawMsg === undefined || rawMsg === null ? '' : str(rawMsg);
    const newKey = str(kw['new_key'] ?? pos[9] ?? '', '');
    const storeView = Number(pos[3] ?? kw['view'] ?? 1) !== 0;

    // viewing.scene canonicalisation.
    if (key === 'auto' && action === 'recall') action = 'next';
    if (action === 'clear') action = 'delete';
    else if (action === 'append' || action === 'update') action = 'store';

    // MovieSceneFunc: insert_before / insert_after -> store + reorder.
    let beforeafter = 0;
    let prevName = '';
    if (action.startsWith('insert_')) {
      prevName = this.sceneCurrentName();
      if (prevName) beforeafter = action[7] === 'b' ? 1 : 2;
      action = 'store';
    }

    if (action === 'next' || action === 'previous') {
      if (this.sceneOrder.length === 0) throw this.sceneError('No scenes');
      key = this.sceneNextKey(action[0] === 'n');
      action = 'recall';
    } else if (action === 'start') {
      if (this.sceneOrder.length === 0) throw this.sceneError('No scenes');
      key = this.sceneOrder[0] ?? '';
      action = 'recall';
    } else if (key === 'auto') {
      key = this.sceneCurrentName();
    }

    switch (action) {
      case 'recall': {
        if (key === '*') break; // print-order only; no state change
        if (!key) {
          // empty key -> blank the current scene name (blank-screen recall)
          this.setSceneCurrentName('');
        } else if (!this.sceneRecall(key, storeView)) {
          throw this.sceneError(`Scene ${key} is not defined.`);
        }
        break;
      }
      case 'store': {
        this.sceneStore(key, message, storeView);
        if (beforeafter) this.sceneOrderBeforeAfter(prevName, beforeafter === 1);
        break;
      }
      case 'delete':
        this.sceneRename(key, '');
        break;
      case 'rename':
        this.sceneRename(key, newKey);
        break;
      case 'order':
        this.sceneOrderMove(key.split(/\s+/).filter(Boolean), false, 'current');
        break;
      case 'sort':
        this.sceneOrderMove(key.split(/\s+/).filter(Boolean), true, 'current');
        break;
      case 'first':
        this.sceneOrderMove(key.split(/\s+/).filter(Boolean), false, 'top');
        break;
      default:
        break;
    }

    // Trigger GUI updates (scene buttons) exactly as the C function does.
    this.executive.set('scenes_changed', 1);
    return null;
  }

  /**
   * `cmd.tenmol_objects(action, ...)` — the object-panel endpoint
   * (`PanelSnapshot` in `packages/protocol/src/topics/objects.ts`). Only
   * 'snapshot' is answered with content; menus return empty (no popups yet).
   */
  private objectsPanel(action: string): Json {
    if (action !== 'snapshot') return [] as unknown as Json;
    const allRow = {
      name: 'all',
      type: 'all',
      enabled: true,
      group: '',
      nest: 0,
      reps: 0,
      color: null,
      caption: '',
      isGroup: false,
      isOpen: true,
      isAll: true,
      repIndices: [] as number[],
    };
    const rows = [allRow];
    for (const mol of this.executive.moleculesInOrder()) {
      let reps = 0;
      for (const a of mol.atoms) reps |= a.visRep;
      const repIndices: number[] = [];
      for (let r = 0; r < 32; r++) if (reps & (1 << r)) repIndices.push(r);
      rows.push({
        name: mol.name,
        type: 'object:molecule',
        enabled: mol.enabled,
        group: '',
        nest: 0,
        reps,
        color: null,
        caption: '',
        isGroup: false,
        isOpen: true,
        isAll: false,
        repIndices,
      });
    }
    return {
      rows,
      opCount: 6,
      buttonMode: '3-Button Motions',
      ops: ['A', 'S', 'H', 'L', 'C', 'M'],
      settings: {
        group_full_member_names: 0,
        group_arrow_prefix: 0,
        internal_gui_name_color_mode: 0,
        internal_gui_control_size: 18,
        internal_gui_width: 220,
        hide_underscore_names: 1,
      },
    } as unknown as Json;
  }

  /* --------------------------- probe helpers -------------------------- */

  private atomReport(sel: string): Json {
    return this.executive.atomsMatching(sel).map((ua) => {
      const rgb = getColorTuple(ua.atom.color);
      return {
        object: ua.objName,
        id: ua.atom.id,
        name: ua.atom.name,
        elem: ua.atom.elem,
        color: ua.atom.color,
        rgb: rgb ?? [0.5, 0.5, 0.5],
        visRep: ua.atom.visRep,
      };
    }) as unknown as Json;
  }

  private getModel(sel: string): Json {
    const matched = this.executive.atomsMatching(sel);
    // Class flags (organic/polymer/solvent/…) are assigned per residue over the
    // FULL object, exactly like PyMOL classifies during a selector-table update
    // (`SelectorClassifyAtoms`); cache one pass per object we touch.
    const classCache = new Map<string, number[]>();
    const classOf = (objName: string): number[] => {
      let m = classCache.get(objName);
      if (!m) {
        const mol = this.executive.molecule(objName);
        m = mol ? classifyMolecule(mol) : [];
        classCache.set(objName, m);
      }
      return m;
    };
    const atoms = matched.map((ua, i) => {
      const mol = this.executive.molecule(ua.objName)!;
      const [x, y, z] = mol.coord(ua.index, 1);
      const a = ua.atom;
      // Coordinates are already float32 (stored in a Float32Array); round the
      // remaining floats the same way, since PyMOL stores them as C `float` and
      // `cmd.get_model` hands back float32-rounded values.
      const classMask = classOf(ua.objName)[ua.index] ?? 0;
      const flags = ((a.flags ?? 0) & cAtomFlag_class_mask) | classMask;
      const atom: Record<string, Json> = {
        // chempy Atom, in the field set `CoordSetAtomToChemPyAtom` populates
        // (`packages/engine/layer2/CoordSet.cpp:1057`) as serialised by the
        // bridge codec (`packages/bridge/tenmol_bridge/codec.py`).
        index: i + 1,
        id: a.id,
        name: a.name,
        symbol: a.elem,
        resn: a.resn,
        resi: a.resi,
        resi_number: a.resv,
        chain: a.chain,
        segi: a.segi,
        alt: a.alt,
        ss: a.ss,
        b: Math.fround(a.b),
        q: Math.fround(a.q),
        vdw: Math.fround(mol.vdw(ua.index)),
        elec_radius: 0,
        partial_charge: Math.fround(a.partialCharge ?? 0),
        formal_charge: a.formalCharge ?? 0,
        numeric_type: a.customType ?? 0,
        text_type: '??',
        coord: [x, y, z],
        hetatm: a.hetatm ? 1 : 0,
        flags,
        stereo: 0,
      };
      // `u_aniso`/`label` are only present when the atom carries them — chempy's
      // codec whitelist has no `label`, but the port surfaces a set one for the
      // Properties panel and the label parity test.
      if (a.u) atom.u_aniso = Array.from(a.u);
      if (a.label) atom.label = a.label;
      return atom;
    });
    // Bonds among the matched atoms, reindexed to the model's atom order
    // (chempy `get_bonds`: (atm1, atm2, order)).
    const posOf = new Map<string, number>();
    matched.forEach((ua, i) => posOf.set(`${ua.objName} ${ua.index}`, i));
    const bonds: Array<{ index: [number, number]; order: number }> = [];
    const seenObj = new Set<string>();
    for (const ua of matched) {
      if (seenObj.has(ua.objName)) continue;
      seenObj.add(ua.objName);
      const mol = this.executive.molecule(ua.objName);
      if (!mol) continue;
      for (const [a, b, order] of mol.bonds) {
        const ia = posOf.get(`${ua.objName} ${a}`);
        const ib = posOf.get(`${ua.objName} ${b}`);
        if (ia === undefined || ib === undefined) continue;
        bonds.push({ index: [ia, ib], order: order ?? 1 });
      }
    }
    // The full chempy `Indexed` shape the bridge codec emits: a `__model__`
    // tag, the atom/bond lists, and the `Molecule` header (title/comments). An
    // untitled object reports the chempy Molecule default title.
    const title = this.call('get_title', [this.executive.moleculesInOrder()[0]?.name ?? '']);
    return {
      __model__: 'Indexed',
      atom: atoms,
      bond: bonds,
      molecule: { title: (typeof title === 'string' && title) || 'untitled', comments: '' },
    } as unknown as Json;
  }

  /* --------------------------- publishing ----------------------------- */

  private publish(): void {
    this.emitObjects();
    this.emitView();
    this.emitGeometry();
  }

  private emitObjects(): void {
    const objects: ObjectRow[] = this.executive.moleculesInOrder().map((mol) => {
      let reps = 0;
      for (const a of mol.atoms) reps |= a.visRep;
      return {
        name: mol.name,
        type: 'object:molecule',
        enabled: mol.enabled,
        group: '',
        nest: 0,
        reps,
        color: null,
        caption: '',
        states: mol.nstate,
      };
    });
    // Measurement objects (distance/angle/dihedral) render through the Dash rep.
    for (const m of this.executive.measurementsInOrder()) {
      objects.push({
        name: m.name,
        type: 'object:measurement',
        enabled: m.enabled,
        group: '',
        nest: 0,
        reps: 1 << Rep.Dash,
        color: null,
        caption: '',
        states: 1,
      });
    }
    this.emitter.emit('objects', { objects });
  }

  private emitView(): void {
    // The `view` topic payload; the client narrows/uses get_view directly too.
    this.emitter.emit(
      'view' as keyof BackendEvents & string,
      { view: this.executive.view.get() } as never,
    );
  }

  /** object/rep/state keys that currently have geometry on the client. */
  private liveKeys = new Set<string>();

  /**
   * F1 — per-rep geometry memoization. Keyed by `geometryKey(object,state,rep)`,
   * holds the content hash of the inputs the frame was last built from and its
   * byte size. On the push path (`emitGeometry`) a rep whose hash is unchanged
   * is NOT rebuilt or re-emitted — the client already holds that exact frame —
   * turning `show cartoon` (which changes only the cartoon vis bit) from a
   * rebuild of EVERY rep, surface included, into a rebuild of just the cartoon.
   */
  private frameCache = new Map<string, { hash: number; bytes: number }>();

  private emitGeometry(): void {
    const liveNow = new Set<string>();
    for (const mol of this.executive.moleculesInOrder()) {
      if (!mol.enabled) continue;
      for (const rep of RENDERABLE_REPS) {
        if (this.emitRepFrame(mol.name, rep, 1) > 0) {
          liveNow.add(geometryKey({ object: mol.name, state: 1, rep }));
        }
      }
    }
    // Measurement objects (distance/angle/dihedral) render as dashes.
    for (const m of this.executive.measurementsInOrder()) {
      if (!m.enabled) continue;
      const buf = buildMeasurementFrame(m, this.seq);
      if (!buf) continue;
      this.seq++;
      const frame = decodeBinaryFrame(buf);
      this.emitter.emit('binary:frame', frame);
      if (isGeometryFrame(frame)) this.emitter.emit('geometry:frame', frame);
      liveNow.add(geometryKey({ object: m.name, state: 1, rep: Rep.Dash }));
    }
    // Any key that was live but produced nothing this pass (rep hidden, object
    // disabled/deleted, selection emptied) is DROPPED with a tombstone — an
    // empty geometry frame the renderer treats as a removal (defect D1). Without
    // this the client keeps drawing the last frame it saw for that key.
    for (const key of this.liveKeys) {
      if (liveNow.has(key)) continue;
      const parsed = parseGeometryKey(key);
      if (parsed) this.emitTombstone(parsed.object, parsed.rep, parsed.state);
    }
    this.liveKeys = liveNow;
  }

  /** Emit an empty geometry frame for one key, dropping it on the client. */
  private emitTombstone(object: string, rep: number, state: number): void {
    // Forget the memoized frame so a later re-show rebuilds from scratch.
    this.frameCache.delete(geometryKey({ object, state, rep }));
    const header: CgoDrawArraysHeader = {
      v: 1,
      kind: 'cgo-draw-arrays',
      seq: this.seq++,
      payloadBytes: 0,
      object,
      state,
      rep,
      blocks: [],
      instances: [],
    };
    const frame = decodeBinaryFrame(encodeBinaryFrame(header, new Uint8Array(0)));
    this.emitter.emit('binary:frame', frame);
    if (isGeometryFrame(frame)) this.emitter.emit('geometry:frame', frame);
  }

  /**
   * The Mode-G pull. `args = [object, repName, state]`. Pushes the frame out of
   * band and answers with a `PullResult` the viewport's geometry cache reads
   * (`packages/viewport/src/modeG/cache.ts`): `not-built`/`empty` mean "nothing
   * to draw", any other status means a frame was (or will be) pushed.
   */
  private pullGeometry(args: unknown[]): Json {
    const object = String(args[0] ?? '');
    const repNameArg = String(args[1] ?? '');
    const rep = REP_BY_NAME.get(repNameArg) ?? -1;
    const state = 1;
    const mol = this.executive.molecule(object);
    const result = (status: string, bytes = 0): Json => ({
      object,
      rep: repNameArg,
      state,
      status,
      bytes,
    });
    if (!mol) return result('not-built');
    // Reps this engine cannot render yet are simply "nothing to draw" — never a
    // Mode-P fallback, because the local engine has no pixel stream.
    if (!isRenderableRep(rep)) return result('not-built');
    const bytes = this.emitRepFrame(object, rep, state, true);
    return bytes > 0 ? result('updated', bytes) : result('empty');
  }

  /**
   * Build and push the frame for one object/rep/state; returns bytes, or 0.
   *
   * On the push path (`force=false`) an unchanged rep — same content hash as the
   * last build — is skipped entirely: not rebuilt, not re-emitted, since the
   * client still holds that frame. The pull path (`_bridge.pull_geometry`) sets
   * `force=true`: its caller is asking for the frame NOW and must receive one.
   */
  private emitRepFrame(object: string, rep: number, state: number, force = false): number {
    const mol = this.executive.molecule(object);
    if (!mol || !mol.enabled) return 0;
    const builder = REP_BUILDERS[rep];
    if (!builder) return 0;
    const key = geometryKey({ object, state, rep });
    const hash = this.repInputHash(mol, rep, state);
    const cached = this.frameCache.get(key);
    if (!force && cached && cached.hash === hash) return cached.bytes;
    const buf = builder({
      mol,
      state,
      seq: this.seq,
      getSettingFloat: (name) => this.executive.getSettingFloat(name),
    });
    if (!buf) {
      this.frameCache.set(key, { hash, bytes: 0 });
      return 0;
    }
    this.seq++;
    const frame = decodeBinaryFrame(buf);
    this.emitter.emit('binary:frame', frame);
    if (isGeometryFrame(frame)) this.emitter.emit('geometry:frame', frame);
    this.frameCache.set(key, { hash, bytes: buf.byteLength });
    return buf.byteLength;
  }

  /**
   * A cheap 32-bit content hash of everything a rep's built frame depends on:
   * atom count, the global settings version, per-atom colour, this rep's own
   * visibility bit and secondary-structure code, and the state's raw coordinate
   * bytes. Folding only the rep's OWN vis bit (not the whole `visRep`) is what
   * lets toggling one rep skip rebuilding the others. O(atoms) — trivially
   * cheaper than any builder (surface is O(verts x atoms)).
   */
  private repInputHash(mol: ObjectMolecule, rep: number, state: number): number {
    const bit = repBit(rep);
    const atoms = mol.atoms;
    const n = atoms.length;
    let h = 2166136261;
    const mix = (x: number): void => {
      h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0;
    };
    mix(n);
    mix(this.executive.getSettingsVersion());
    mix(rep);
    for (let i = 0; i < n; i++) {
      const a = atoms[i];
      if (!a) continue;
      mix((a.visRep & bit) !== 0 ? 1 : 0);
      mix(a.color);
      mix(a.ss.length > 0 ? a.ss.charCodeAt(0) : 0);
    }
    const coords = mol.states[state - 1];
    if (coords) {
      const u = new Uint32Array(coords.buffer, coords.byteOffset, coords.length);
      for (let i = 0; i < u.length; i++) mix(u[i] ?? 0);
    }
    return h >>> 0;
  }
}
