/**
 * The executive — PyMOL's `CExecutive` (`packages/engine/layer3/Executive.cpp`):
 * the ordered set of named objects and selections, the global settings, and the
 * camera. Every ported command is a thin method over this state.
 */

import { Rep, REP_NAMES } from '@tenmol/protocol';
import { repBit } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import { getColorIndex } from './color';
import {
  atomKey,
  countAtoms as selCount,
  selectAtoms,
  SelectionError,
  type SelectorContext,
  type UniverseAtom,
} from '../select/selector';
import { ViewState } from '../view/view';

/** Representation name -> RepId (the reverse of REP_NAMES), plus `everything`. */
const REP_BY_NAME = new Map<string, number>();
for (const [id, name] of Object.entries(REP_NAMES)) REP_BY_NAME.set(name, Number(id));
// PyMOL aliases the abbreviations accepted by show/hide.
REP_BY_NAME.set('wire', Rep.Line);
REP_BY_NAME.set('dot', Rep.Dot);

/** Default global settings the slice reads (`packages/engine/layer1/SettingInfo.h`). */
const DEFAULT_SETTINGS: Readonly<Record<string, number | string>> = {
  sphere_scale: 1.0,
  stick_radius: 0.25,
  nb_spheres_size: 0.25,
  line_width: 1.0,
  field_of_view: 20,
  orthoscopic: 0,
  // Mouse-config panel reads these; PyMOL's fresh-session defaults.
  button_mode: 0,
  button_mode_name: '3-Button Viewing',
  mouse_grid: 0,
  mouse_selection_mode: 0,
};

export class Executive {
  private readonly order: string[] = [];
  private readonly objects = new Map<string, ObjectMolecule>();
  /** name -> stable atom identities (see selector `atomKey`). */
  private readonly selections = new Map<string, Set<string>>();
  private readonly settings = new Map<string, number | string>(Object.entries(DEFAULT_SETTINGS));
  readonly view = new ViewState();

  /* ----------------------------- context ----------------------------- */

  readonly selectorContext: SelectorContext = {
    objects: () => this.order.map((n) => this.objects.get(n)!).filter(Boolean),
    namedSelection: (name) => this.selections.get(name),
  };

  /* ------------------------------ objects ----------------------------- */

  addMolecule(mol: ObjectMolecule): void {
    if (!this.objects.has(mol.name)) this.order.push(mol.name);
    this.objects.set(mol.name, mol);
  }

  molecule(name: string): ObjectMolecule | undefined {
    return this.objects.get(name);
  }

  moleculesInOrder(): ObjectMolecule[] {
    return this.order.map((n) => this.objects.get(n)!).filter(Boolean);
  }

  /** A unique object name from `base`, PyMOL's `obj`, `obj_1`, ... disambiguation. */
  uniqueName(base: string): string {
    if (!this.objects.has(base) && !this.selections.has(base)) return base;
    for (let i = 1; ; i++) {
      const candidate = `${base}_${i}`;
      if (!this.objects.has(candidate) && !this.selections.has(candidate)) return candidate;
    }
  }

  /* ------------------------------ get_names --------------------------- */

  getNames(type = 'public_objects', enabledOnly = false): string[] {
    const objs = this.order.filter((n) => {
      if (n.startsWith('_') && type.startsWith('public')) return false;
      if (enabledOnly && !this.objects.get(n)?.enabled) return false;
      return true;
    });
    const sels = [...this.selections.keys()].filter((n) => !(n.startsWith('_') && type.startsWith('public')));
    switch (type) {
      case 'objects':
        return objs;
      case 'selections':
      case 'public_selections':
        return sels;
      case 'all':
        return [...objs, ...sels];
      case 'public_objects':
      default:
        return objs;
    }
  }

  /* ------------------------------- delete ----------------------------- */

  delete(pattern: string): void {
    if (pattern === 'all' || pattern === '*') {
      this.order.length = 0;
      this.objects.clear();
      this.selections.clear();
      return;
    }
    if (this.objects.delete(pattern)) {
      const i = this.order.indexOf(pattern);
      if (i >= 0) this.order.splice(i, 1);
    }
    this.selections.delete(pattern);
  }

  /* ------------------------------ selection --------------------------- */

  countAtoms(sel: string): number {
    return selCount(sel, this.selectorContext);
  }

  select(name: string, sel: string): number {
    const matched = selectAtoms(sel, this.selectorContext);
    const keys = new Set(matched.map((ua) => atomKey(ua.objName, ua.atom)));
    this.selections.set(name, keys);
    return matched.length;
  }

  hasSelection(name: string): boolean {
    return this.selections.has(name);
  }

  /* -------------------------------- color ----------------------------- */

  /** `cmd.color(color, selection)` — returns the number of atoms recoloured. */
  color(color: string, sel: string): number {
    const idx = getColorIndex(color);
    if (idx < 0) throw new SelectionError(`Color: unknown color '${color}'`);
    const matched = selectAtoms(sel, this.selectorContext);
    for (const ua of matched) ua.atom.color = idx;
    return matched.length;
  }

  /* ------------------------------ reps -------------------------------- */

  private repId(name: string): number | 'everything' {
    if (name === 'everything') return 'everything';
    const id = REP_BY_NAME.get(name);
    if (id === undefined) throw new SelectionError(`unknown representation '${name}'`);
    return id;
  }

  /** `cmd.show(rep, sel)` — OR the rep bit onto matched atoms. */
  show(rep: string, sel: string): number {
    const id = this.repId(rep);
    const matched = selectAtoms(sel, this.selectorContext);
    for (const ua of matched) {
      ua.atom.visRep = id === 'everything' ? ua.atom.visRep : ua.atom.visRep | repBit(id);
    }
    return matched.length;
  }

  /** `cmd.hide(rep, sel)` — clear the rep bit (or all bits for 'everything'). */
  hide(rep: string, sel: string): number {
    const id = this.repId(rep);
    const matched = selectAtoms(sel, this.selectorContext);
    for (const ua of matched) {
      ua.atom.visRep = id === 'everything' ? 0 : ua.atom.visRep & ~repBit(id);
    }
    return matched.length;
  }

  /** `cmd.show_as(rep, sel)` — set matched atoms to ONLY this rep. */
  showAs(rep: string, sel: string): number {
    const id = this.repId(rep);
    if (id === 'everything') return this.show(rep, sel);
    const matched = selectAtoms(sel, this.selectorContext);
    for (const ua of matched) ua.atom.visRep = repBit(id);
    return matched.length;
  }

  /* ------------------------------ settings ---------------------------- */

  set(name: string, value: number | string | boolean): void {
    this.settings.set(name, typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }

  getSetting(name: string): number | string | undefined {
    return this.settings.get(name);
  }

  getSettingFloat(name: string): number {
    const v = this.settings.get(name);
    return typeof v === 'number' ? v : Number(v ?? 0);
  }

  /* ------------------------------- extent ----------------------------- */

  /** Bounding sphere (centre + radius) of a selection, for zoom/orient. */
  selectionSphere(sel: string): { center: [number, number, number]; radius: number } | null {
    const matched = selectAtoms(sel, this.selectorContext);
    if (matched.length === 0) return null;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const ua of matched) {
      const mol = this.objects.get(ua.objName)!;
      const [x, y, z] = mol.coord(ua.index, 1);
      min[0] = Math.min(min[0], x); max[0] = Math.max(max[0], x);
      min[1] = Math.min(min[1], y); max[1] = Math.max(max[1], y);
      min[2] = Math.min(min[2], z); max[2] = Math.max(max[2], z);
    }
    const center: [number, number, number] = [
      (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2,
    ];
    let radius = 0;
    for (const ua of matched) {
      const mol = this.objects.get(ua.objName)!;
      const [x, y, z] = mol.coord(ua.index, 1);
      const dx = x - center[0], dy = y - center[1], dz = z - center[2];
      radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz) + mol.vdw(ua.index));
    }
    return { center, radius };
  }

  /** All atoms matching a selection, for geometry/probe readout. */
  atomsMatching(sel: string): UniverseAtom[] {
    return selectAtoms(sel, this.selectorContext);
  }
}
