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
  decodeBinaryFrame,
  isGeometryFrame,
  type HelloMessage,
  type Json,
  type ObjectRow,
} from '@tenmol/protocol';
import { Executive } from './exec/executive';
import { getColorIndex, getColorTuple } from './exec/color';
import { parsePdb } from './model/pdb';
import { buildLinesFrame, buildSpheresFrame } from './geometry/frames';
import { parseCommand, splitCommands } from './cmd/parser';
import { SelectionError } from './select/selector';

/** PROTOCOL contract: the reps this engine can render in Mode G today. */
const RENDERABLE_REPS = [Rep.Line, Rep.Sphere] as const;

type Handler = (args: unknown[], kwargs: Record<string, unknown>) => Json;

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
    this.appendFeedback(`PyMOL>${line}`);
    for (const command of splitCommands(line)) {
      const { keyword, args } = parseCommand(command);
      try {
        this.runKeyword(keyword, args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.appendFeedback(` ${message}`);
      }
    }
  }

  private runKeyword(keyword: string, args: string[]): void {
    // Map the console keyword to a ported handler with positional string args.
    switch (keyword) {
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
        throw new Error(`Error: unknown command '${keyword}'`);
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
        return { width: msg.width ?? 0, height: msg.height ?? 0 };
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

    h('get_color_index', (args) => getColorIndex(str(args[0])));
    h('get_color_tuple', (args) => {
      const t = getColorTuple(Number(args[0]));
      return t ? [t[0], t[1], t[2]] : null;
    });

    // A per-atom colour/vis probe the differential suite reads. Schema-stable,
    // NEW (not upstream), namespaced under `_engine` so it never shadows a real
    // PyMOL symbol; the remote side answers it via a bridge route in the harness.
    h('_engine.atom_report', (args) => this.atomReport(str(args[0], 'all') || 'all'));

    h('get_model', (args) => this.getModel(str(args[0], 'all') || 'all'));
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
    const scale = this.executive.getSettingFloat('sphere_scale') || 1;
    for (const mol of this.executive.moleculesInOrder()) {
      if (!mol.enabled) continue;
      for (const rep of RENDERABLE_REPS) {
        const buf =
          rep === Rep.Sphere
            ? buildSpheresFrame(mol, 1, this.seq, scale)
            : buildLinesFrame(mol, 1, this.seq);
        if (!buf) continue;
        this.seq++;
        const frame = decodeBinaryFrame(buf);
        this.emitter.emit('binary:frame', frame);
        if (isGeometryFrame(frame)) this.emitter.emit('geometry:frame', frame);
      }
    }
  }
}
