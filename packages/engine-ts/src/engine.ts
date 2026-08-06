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
  isGeometryFrame,
  type HelloMessage,
  type Json,
  type ObjectRow,
} from '@tenmol/protocol';
import { Executive } from './exec/executive';
import { getColorIndex, getColorTuple } from './exec/color';
import { parsePdb } from './model/pdb';
import { buildFragment } from './model/fragments';
import { buildLinesFrame, buildSpheresFrame } from './geometry/frames';
import { parseCommand, splitCommands } from './cmd/parser';
import { SelectionError } from './select/selector';

/** PROTOCOL contract: the reps this engine can render in Mode G today. */
const RENDERABLE_REPS = [Rep.Line, Rep.Sphere] as const;

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

type Handler = (args: unknown[], kwargs: Record<string, unknown>) => Json;

/**
 * A line that is Python, not a PyMOL command — the app's feature panels send
 * these to install their bridge-side helpers every poll, e.g.
 * `/import tenmol_bridge.panels.settings as _s;_s.install()`. Real PyMOL runs
 * them in its interpreter; the port has no Python and must stay silent for them
 * (they are internal plumbing), while still giving feedback for a user's line.
 *
 *   * a leading `/` is PyMOL's inline-Python escape;
 *   * a leading `@` is a script include;
 *   * an `import`/`from` statement (with or without the `/` escape) is Python.
 */
function isPythonBootstrap(line: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('/') || trimmed.startsWith('@')) return true;
  return splitCommands(line).some((c) => /^(from|import)\s/.test(c.trimStart()));
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

  // Last reshaped viewport size, answered by `get_viewport`. The Mode-G client
  // polls this to size its GL scene rectangle; without it the scene defaults to
  // 1x1 and nothing is visible.
  private width = 640;
  private height = 480;

  // Named camera views — `cmd.view(key, 'store'|'recall'|'clear')`. PyMOL keeps
  // these as 18-float entries in a Python dict; the port mirrors that.
  private readonly views = new Map<string, number[]>();

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

  call(fn: string, args: readonly unknown[] = [], kwargs: Readonly<Record<string, unknown>> = {}): Json {
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
      throw new PymolError({ kind: 'CmdException', type: 'CmdException', message, traceback: '' }, fn);
    }
  }

  /* -------------------------------- do -------------------------------- */

  do(line: string): void {
    const commands = splitCommands(line).map(parseCommand);
    const anyKnown = commands.some((c) => KNOWN_KEYWORDS.has(c.keyword));

    // Feature/plugin bootstrap lines (`from tenmol_bridge... import install`)
    // are Python the bridge runs silently server-side; the port has no Python,
    // so it stays FULLY silent for them rather than echoing an error every poll.
    // A user's own line always gets feedback, so the console never feels dead.
    if (!anyKnown && isPythonBootstrap(line)) return;

    this.appendFeedback(`PyMOL>${line}`);
    for (const { keyword, args } of commands) {
      if (KNOWN_KEYWORDS.has(keyword)) {
        try {
          this.runKeyword(keyword, args);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.appendFeedback(` ${message}`);
        }
      } else {
        // Honest parity note: the TS engine has no Python interpreter, so a line
        // that is not a ported command cannot run. Real PyMOL would try to exec
        // it as Python; here we say so instead of silently doing nothing.
        this.appendFeedback(
          ` Error: '${keyword}' is not a ported command (the TypeScript engine has no Python)`,
        );
      }
    }
  }

  private runKeyword(keyword: string, args: string[]): void {
    // Map the console keyword to a ported handler with positional string args.
    switch (keyword) {
      case 'fragment':
        this.call('fragment', [args[0] ?? '', args[1] ?? '']);
        return;
      case 'bg_color':
        this.call('bg_color', [args[0] ?? 'black']);
        return;
      case 'reset':
        this.call('reset', []);
        return;
      case 'show':
        this.call('show', [args[0] ?? 'lines', args[1] ?? 'all']);
        return;
      case 'hide':
        this.call('hide', [args[0] ?? 'everything', args[1] ?? 'all']);
        return;
      case 'as':
        this.call('as', [args[0] ?? 'lines', args[1] ?? 'all']);
        return;
      case 'color':
        this.call('color', [args[0] ?? '', args[1] ?? 'all']);
        return;
      case 'select':
        this.call('select', [args[0] ?? 'sele', args[1] ?? 'all']);
        return;
      case 'delete':
        this.call('delete', [args[0] ?? 'all']);
        return;
      case 'zoom':
        this.call('zoom', [args[0] ?? 'all']);
        return;
      case 'orient':
        this.call('orient', [args[0] ?? 'all']);
        return;
      case 'turn':
        this.call('turn', [args[0] ?? 'y', Number(args[1] ?? 0)]);
        return;
      case 'set':
        this.call('set', [args[0] ?? '', args[1] ?? '1', args[2] ?? '']);
        return;
      default:
        // Not a ported command keyword. In real PyMOL a non-command line is
        // handed to the Python interpreter (that is how `from pymol import cmd`
        // works at the prompt). The port has no Python, so it is a silent
        // no-op — NOT a spurious "unknown command" echo. This is what keeps
        // panel-bootstrap lines like `from tenmol_bridge... import install`
        // from flooding the console when a feature targets the local engine.
        return;
    }
  }

  /* ------------------------------ input ------------------------------- */

  input(msg: { kind: string; x?: number; y?: number; state?: number; width?: number; height?: number }): Json {
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
      case 'reshape':
        this.width = msg.width ?? this.width;
        this.height = msg.height ?? this.height;
        return { width: this.width, height: this.height };
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
      ex.addMolecule(parsePdb(pdb, name));
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
      ex.view.set(v as number[]);
      this.emitView();
      return null;
    });
    h('turn', (args) => {
      ex.view.turn(str(args[0], 'y') as 'x' | 'y' | 'z', Number(args[1] ?? 0));
      this.emitView();
      return null;
    });
    h('zoom', (args) => {
      const sphere = ex.selectionSphere(str(args[0], 'all') || 'all');
      if (sphere) ex.view.zoomToSphere(sphere.center, sphere.radius, Number(args[1] ?? 0));
      this.emitView();
      return null;
    });
    h('orient', (args) => {
      const sphere = ex.selectionSphere(str(args[0], 'all') || 'all');
      if (sphere) ex.view.zoomToSphere(sphere.center, sphere.radius, Number(args[1] ?? 0));
      this.emitView();
      return null;
    });

    h('set', (args) => {
      const name = str(args[0]);
      const raw = args[1];
      const value = typeof raw === 'number' ? raw : Number.isNaN(Number(raw)) ? str(raw) : Number(raw);
      ex.set(name, value);
      this.publish();
      return null;
    });
    h('get_setting', (args) => ex.getSetting(str(args[0])) ?? null);
    h('get_setting_float', (args) => ex.getSettingFloat(str(args[0])));
    h('get_setting_int', (args) => Math.trunc(ex.getSettingFloat(str(args[0]))));
    h('get_setting_boolean', (args) => (ex.getSettingFloat(str(args[0])) !== 0 ? 1 : 0));

    // `cmd.get_viewport()` — the scene rectangle in pixels (width, height). The
    // Mode-G viewport polls this to size its GL scissor/viewport.
    h('get_viewport', () => [this.width, this.height]);

    // `_bridge.pull_geometry(object, repName, state)` — the Mode-G PULL path.
    // The viewport requests a rep; we push the frame out of band (like the
    // bridge does) and answer with the PullResult status. This is what makes
    // rendering reliable: a frame the viewport missed on the initial push is
    // re-fetched here the moment it tracks the object.
    h('_engine.pull_geometry', (args) => this.pullGeometry(args));
    h('_bridge.pull_geometry', (args) => this.pullGeometry(args));

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
      const t = getColorTuple(Number(args[0]));
      return t ? [t[0], t[1], t[2]] : null;
    });

    // `cmd.fragment(name, object)` — load a built-in fragment and frame it.
    h('fragment', (args, kwargs) => {
      const name = str(args[0]);
      const requested = str(args[1] ?? kwargs['object']) || name;
      const objName = ex.uniqueName(requested || name || 'obj');
      const mol = buildFragment(name, objName);
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
      ex.view.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -40, 0, 0, 0, 20, 60, -20]);
      const sphere = ex.selectionSphere('all');
      if (sphere) ex.view.zoomToSphere(sphere.center, sphere.radius);
      this.emitView();
      return null;
    });

    // ---- benign read defaults ----------------------------------------------
    // A fresh, empty PyMOL session answers these with trivial values. Answering
    // them the same way keeps the app's panels (movie, scenes, views, mouse,
    // settings) rendering CLEANLY on the local engine instead of showing a red
    // "not ported" error for every idle poll. These are reads only; nothing is
    // pretending to implement a feature.
    h('get_scene_list', () => []);
    h('get_scene_dict', () => ({}) as unknown as Json);
    h('get_frame', () => 1);
    h('get_state', () => 1);
    h('count_frames', () => 0);
    h('count_states', (args) => ex.molecule(str(args[0]))?.nstate ?? ex.moleculesInOrder()[0]?.nstate ?? 1);
    h('count_discrete', () => 0);
    h('get_movie_locked', () => 0);
    h('get_movie_length', () => 0);
    h('get_movie_playing', () => 0);
    h('get_object_list', () => ex.getNames('objects'));
    h('get_names_of_type', () => []);
    h('get_type', () => 'object:molecule');
    h('get_vis', () => ({}) as unknown as Json);
    h('get_setting_updates', () => []);
    h('get_setting_text', (args) => {
      const v = ex.getSetting(str(args[0]));
      return v === undefined ? '' : String(v);
    });
    h('get_setting_tuple', (args) => [ex.getSetting(str(args[0])) ?? 0]);
    h('get', (args) => (ex.getSetting(str(args[0])) ?? null) as Json);
    h('get_title', () => '');
    h('set_title', () => null);
    h('matrix_reset', () => null);
    h('get_object_color_index', () => 0);
    h('get_object_matrix', () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    h('get_object_ttt', () => null);
    h('get_progress', () => -1);
    h('get_idle', () => 0);
    h('get_version', () => ['tenmol-engine-ts', 0, 0, '', '', '']);
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
    h('scene', () => null);
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
    const atoms = this.executive.atomsMatching(sel).map((ua) => {
      const mol = this.executive.molecule(ua.objName)!;
      const [x, y, z] = mol.coord(ua.index, 1);
      return { name: ua.atom.name, resn: ua.atom.resn, resi: ua.atom.resi, chain: ua.atom.chain, elem: ua.atom.elem, coord: [x, y, z] };
    });
    return { atom: atoms } as unknown as Json;
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
    this.emitter.emit('objects', { objects });
  }

  private emitView(): void {
    // The `view` topic payload; the client narrows/uses get_view directly too.
    this.emitter.emit('view' as keyof BackendEvents & string, { view: this.executive.view.get() } as never);
  }

  private emitGeometry(): void {
    for (const mol of this.executive.moleculesInOrder()) {
      if (!mol.enabled) continue;
      for (const rep of RENDERABLE_REPS) this.emitRepFrame(mol.name, rep, 1);
    }
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
    if (rep !== Rep.Sphere && rep !== Rep.Line) return result('not-built');
    const bytes = this.emitRepFrame(object, rep, state);
    return bytes > 0 ? result('updated', bytes) : result('empty');
  }

  /** Build and push the frame for one object/rep/state; returns bytes, or 0. */
  private emitRepFrame(object: string, rep: number, state: number): number {
    const mol = this.executive.molecule(object);
    if (!mol || !mol.enabled) return 0;
    const scale = this.executive.getSettingFloat('sphere_scale') || 1;
    const buf =
      rep === Rep.Sphere
        ? buildSpheresFrame(mol, state, this.seq, scale)
        : rep === Rep.Line
          ? buildLinesFrame(mol, state, this.seq)
          : null;
    if (!buf) return 0;
    this.seq++;
    const frame = decodeBinaryFrame(buf);
    this.emitter.emit('binary:frame', frame);
    if (isGeometryFrame(frame)) this.emitter.emit('geometry:frame', frame);
    return buf.byteLength;
  }
}
