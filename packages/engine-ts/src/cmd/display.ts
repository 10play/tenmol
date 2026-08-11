/**
 * The `display` command subsystem — object-level colouring, colour-table
 * introspection, per-atom labels, desaturation, and cartoon subtypes.
 * Registers its `cmd.*` handlers via the {@link RegistrarCtx}.
 * See docs/engine-port-gaps.md.
 *
 * Ports (approximated for the in-browser port):
 *   - `cmd.set_object_color` — the object-level `color` setting
 *     (`layer3/Executive.cpp:ExecutiveSetObjColorIndex`).
 *   - `cmd.color_deep` — `modules/pymol/coloring.py:color_deep`: recolour a
 *     selection AND its object colour (we skip true ramp objects, which the
 *     slice does not model).
 *   - `cmd.recolor` / `cmd.rebuild` — invalidate + refresh geometry (no-ops that
 *     force a re-emit).
 *   - `cmd.get_color_indices` — `cmd.get_color_indices` name→index table.
 *   - `cmd.space` — the colour-space setting (`cmd.space`).
 *   - `cmd.desaturate` — `modules/pymol/util.py`-style blend toward grey.
 *   - `cmd.label` — per-atom label text + the `labels` rep bit
 *     (`layer3/Executive.cpp:ExecutiveLabel`).
 *   - `cmd.cartoon` — the `cartoon_type` subtype setting
 *     (`modules/pymol/viewing.py:cartoon`).
 */
import { Rep, type Json } from '@tenmol/protocol';
import { repBit, type AtomInfo } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import {
  colorNames,
  getColorIndex,
  rgbForIndex,
  setColor,
  type RGB,
} from '../exec/color';
import type { RegistrarCtx } from './registrar';

/* --------------------------------------------------------------------------
 * Observable side-state.
 *
 * We may only edit this file, so per-object / per-atom extras that PyMOL keeps
 * on the object or atom struct are kept here in Weak-keyed maps and exposed via
 * dedicated getter commands (the differential/UI reads these).
 * ------------------------------------------------------------------------ */

/** Object-level colour index (`ObjectMolecule.Obj.Color`). */
const OBJECT_COLOR = new WeakMap<ObjectMolecule, number>();
/** Per-object `cartoon_type` subtype. */
const CARTOON_TYPE = new WeakMap<ObjectMolecule, number>();

/** `cmd.cartoon` type-name → `cartoon_type` int (viewing.py `cartoon`). */
const CARTOON_TYPES: Readonly<Record<string, number>> = {
  skip: -1,
  automatic: 0,
  loop: 1,
  rectangle: 2,
  rect: 2,
  oval: 3,
  tube: 4,
  arrow: 5,
  dumbbell: 6,
  putty: 7,
  dash: 8,
  cylinder: 9,
};

/** Grey that {@link desaturate} blends toward. */
const GREY: RGB = [0.5, 0.5, 0.5];

/** Clamp to [0, 1]. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Evaluate a PyMOL-style label expression against an atom, as JS. The atom's
 * common fields are in scope (`name`, `resn`, `resi`, `resv`, `chain`, `elem`,
 * `b`, `q`, `ss`, `segi`, `alt`, `id`). A bare/broken expression falls back to
 * its literal text — matching how PyMOL treats a plain-string label.
 */
function evalLabel(expr: string, atom: AtomInfo): string {
  const trimmed = expr.trim();
  if (trimmed === '') return '';
  // A quoted literal: use verbatim without evaluation.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  try {
     
    const fn = new Function(
      'name', 'resn', 'resi', 'resv', 'chain', 'elem',
      'b', 'q', 'ss', 'segi', 'alt', 'id',
      `"use strict"; return (${trimmed});`,
    );
    const out = fn(
      atom.name, atom.resn, atom.resi, atom.resv, atom.chain, atom.elem,
      atom.b, atom.q, atom.ss, atom.segi, atom.alt, atom.id,
    );
    return out == null ? '' : String(out);
  } catch {
    return trimmed;
  }
}

export function registerDisplay(ctx: RegistrarCtx): void {
  const { executive: ex, str } = ctx;

  /* --------------------------- set_object_color ------------------------- */

  ctx.command('set_object_color', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs.name);
    const color = str(args[1] ?? kwargs.color);
    const idx = getColorIndex(color);
    if (idx < 0) return -1;
    const mol = ex.molecule(name);
    if (!mol) return -1;
    OBJECT_COLOR.set(mol, idx);
    ctx.publish();
    return idx;
  });

  /** Getter for the object colour we store (get_object_color_index in engine.ts
   *  is a fixed stub we must not redefine). */
  ctx.command('get_object_color', (args): Json => {
    const mol = ex.molecule(str(args[0]));
    if (!mol) return -1;
    return OBJECT_COLOR.get(mol) ?? -1;
  });

  /* ------------------------------ color_deep ---------------------------- */

  ctx.command('color_deep', (args, kwargs): Json => {
    const color = str(args[0] ?? kwargs.color);
    const selection = str(args[1] ?? kwargs.selection, 'all') || 'all';
    const idx = getColorIndex(color);
    if (idx < 0) return 0;
    // Per-atom colour (like `cmd.color`)…
    const count = ex.color(color, selection);
    // …plus the object colour of every object the selection touches (the
    // "deep" part: derived/ramped colours track the object colour here).
    const touched = new Set<string>();
    for (const ua of ex.atomsMatching(selection)) touched.add(ua.objName);
    for (const objName of touched) {
      const mol = ex.molecule(objName);
      if (mol) OBJECT_COLOR.set(mol, idx);
    }
    ctx.publish();
    return count;
  });

  /* --------------------------- recolor / rebuild ------------------------ */

  // Both invalidate colour/geometry and force a refresh; no state change.
  ctx.command('recolor', (): Json => {
    ctx.publish();
    return null;
  });
  ctx.command('rebuild', (): Json => {
    ctx.publish();
    return null;
  });

  /* -------------------------- get_color_indices ------------------------- */

  ctx.command('get_color_indices', (args, kwargs): Json => {
    // `all` includes runtime/extended colours; our table already returns every
    // known name, so the flag only affects ordering intent — we return all.
    void (args[0] ?? kwargs.all);
    return colorNames().map((name) => [name, getColorIndex(name)] as [string, number]);
  });

  /* -------------------------------- space ------------------------------- */

  ctx.command('space', (args, kwargs): Json => {
    const space = (str(args[0] ?? kwargs.space, 'rgb') || 'rgb').toLowerCase();
    ex.set('color_space', space);
    ctx.publish();
    return null;
  });
  ctx.command('get_color_space', (): Json => String(ex.getSetting('color_space') ?? 'rgb'));

  /* ------------------------------ desaturate ---------------------------- */

  ctx.command('desaturate', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs.selection, 'all') || 'all';
    const factorRaw = Number(args[1] ?? kwargs.factor ?? 0.5);
    const factor = Number.isFinite(factorRaw) ? clamp01(factorRaw) : 0.5;
    const atoms = ex.atomsMatching(selection);
    // Cache old-index → new-index so identical source colours share one slot.
    const remap = new Map<number, number>();
    for (const ua of atoms) {
      const old = ua.atom.color;
      let next = remap.get(old);
      if (next === undefined) {
        const [r, g, b] = rgbForIndex(old);
        const nr = clamp01(r * (1 - factor) + GREY[0] * factor);
        const ng = clamp01(g * (1 - factor) + GREY[1] * factor);
        const nb = clamp01(b * (1 - factor) + GREY[2] * factor);
        next = setColor(`desat_${old}_${factor}`, [nr, ng, nb]);
        remap.set(old, next);
      }
      ua.atom.color = next;
    }
    ctx.publish();
    return atoms.length;
  });

  /* -------------------------------- label ------------------------------- */

  ctx.command('label', (args, kwargs): Json => {
    const selection = str(args[0] ?? kwargs.selection, 'all') || 'all';
    const expression = str(args[1] ?? kwargs.expression, '');
    const bit = repBit(Rep.Label);
    const atoms = ex.atomsMatching(selection);
    for (const ua of atoms) {
      const text = evalLabel(expression, ua.atom);
      if (text === '') {
        delete ua.atom.label;
        ua.atom.visRep &= ~bit;
      } else {
        ua.atom.label = text;
        ua.atom.visRep |= bit;
      }
    }
    ctx.publish();
    return atoms.length;
  });

  /** Read back stored labels as `[objName, id, text]` triples (UI/differential). */
  ctx.command('get_label', (args): Json => {
    const selection = str(args[0], 'all') || 'all';
    const out: Array<[string, number, string]> = [];
    for (const ua of ex.atomsMatching(selection)) {
      const text = ua.atom.label;
      if (text !== undefined) out.push([ua.objName, ua.atom.id, text]);
    }
    return out;
  });

  /**
   * Labels WITH model-space coordinates, for the viewport's text overlay:
   * `{object, id, x, y, z, text}` per labelled atom in the selection. The client
   * projects (x,y,z) with the camera each frame; positions are camera-independent
   * so this only needs re-reading when labels or coordinates change.
   */
  ctx.command('get_labels', (args): Json => {
    const selection = str(args[0], 'all') || 'all';
    const state = Number(args[1] ?? 0) || 1;
    const out: Array<{ object: string; id: number; x: number; y: number; z: number; text: string }> = [];
    for (const ua of ex.atomsMatching(selection)) {
      const text = ua.atom.label;
      if (text === undefined) continue;
      const mol = ex.molecule(ua.objName);
      if (!mol) continue;
      const [x, y, z] = mol.coord(ua.index, state > 0 ? state : 1);
      out.push({ object: ua.objName, id: ua.atom.id, x, y, z, text });
    }
    return out;
  });

  /* ------------------------------- set_vis ------------------------------ */

  // `cmd.set_vis(dict)` restores a visibility snapshot from `cmd.get_vis`. The
  // slice's `get_vis` returns `{}`, so there is nothing to restore; we accept
  // the dict and force a refresh.
  ctx.command('set_vis', (): Json => {
    ctx.publish();
    return null;
  });

  /* ------------------------------- cartoon ------------------------------ */

  ctx.command('cartoon', (args, kwargs): Json => {
    const typeName = (str(args[0] ?? kwargs.type, 'automatic') || 'automatic').toLowerCase();
    const selection = str(args[1] ?? kwargs.selection, 'all') || 'all';
    const value = CARTOON_TYPES[typeName] ?? 0;
    // Track the global setting and the per-object subtype for touched objects.
    ex.set('cartoon_type', value);
    const touched = new Set<string>();
    for (const ua of ex.atomsMatching(selection)) touched.add(ua.objName);
    for (const objName of touched) {
      const mol = ex.molecule(objName);
      if (mol) CARTOON_TYPE.set(mol, value);
    }
    ctx.publish();
    return value;
  });

  ctx.command('get_cartoon', (args): Json => {
    const mol = ex.molecule(str(args[0]));
    if (!mol) return Number(ex.getSetting('cartoon_type') ?? 0);
    return CARTOON_TYPE.get(mol) ?? Number(ex.getSetting('cartoon_type') ?? 0);
  });
}
