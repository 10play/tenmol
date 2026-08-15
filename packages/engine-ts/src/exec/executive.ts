/**
 * The executive — PyMOL's `CExecutive` (`packages/engine/layer3/Executive.cpp`):
 * the ordered set of named objects and selections, the global settings, and the
 * camera. Every ported command is a thin method over this state.
 */

import { Rep, REP_NAMES } from '@tenmol/protocol';
import { repBit } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import { getColorIndex } from './color';
import type { MeasurementObject } from './measurement';
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
  line_width: 1.49, // packages/engine/layer1/SettingInfo.h (under 1.5 for SGI antialiasing)
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
  /** Measurement objects (distance/angle/dihedral), rendered as dashes. */
  private readonly measures = new Map<string, MeasurementObject>();
  /**
   * name -> stable atom identities (see selector `atomKey`) plus the selection's
   * enabled/visible flag. PyMOL tracks each named selection's enabled state
   * (the pink indicator dots); `deselect` disables the visible ones and
   * `get_names('selections', enabled_only=1)` reports only the enabled set.
   */
  private readonly selections = new Map<string, { keys: Set<string>; enabled: boolean }>();
  /**
   * Group membership: group name -> its direct member object names. A group is a
   * named container (parked in `order` so it shows in get_names) that is not a
   * molecule; using it as a selection spans all its members' atoms. Mutated by
   * the `objects` command subsystem via {@link groups}.
   */
  private readonly groupMembership = new Map<string, Set<string>>();
  private readonly settings = new Map<string, number | string>(Object.entries(DEFAULT_SETTINGS));
  /**
   * Bumped on every `set()`. The engine's geometry memoization (F1) folds this
   * into each rep's content hash so a settings change (e.g. `sphere_scale`,
   * `stick_radius`) invalidates the cached frames without the engine needing to
   * know which setting feeds which rep.
   */
  private settingsVersion = 0;
  readonly view = new ViewState();

  /**
   * The screen viewport size in pixels, reported by `cmd.get_viewport` and set
   * by `cmd.viewport` / a client `reshape` (`viewing.py:1459`). Shared here so
   * the setter (`viewport`, in the settings2 subsystem) and the reader
   * (`get_viewport`, on the Engine) agree on ONE source of truth. Defaults match
   * PyMOL's compiled window size.
   */
  private viewportWidth = 640;
  private viewportHeight = 480;

  /** The current viewport size as `[width, height]`. */
  getViewport(): [number, number] {
    return [this.viewportWidth, this.viewportHeight];
  }

  /**
   * Resize the viewport. Mirrors `_cmd.viewport`: a non-positive dimension
   * leaves that axis unchanged (PyMOL's `viewport(-1, -1)` is a no-op query).
   */
  setViewport(width: number, height: number): void {
    if (Number.isFinite(width) && width > 0) this.viewportWidth = Math.trunc(width);
    if (Number.isFinite(height) && height > 0) this.viewportHeight = Math.trunc(height);
  }

  /* ----------------------------- context ----------------------------- */

  readonly selectorContext: SelectorContext = {
    objects: () => this.order.map((n) => this.objects.get(n)!).filter(Boolean),
    namedSelection: (name) => this.selections.get(name)?.keys,
    groupMembers: (name) => this.flattenGroup(name),
  };

  /**
   * Transitively flatten a group into the set of molecule-object names it holds,
   * so a group name used as a selection matches all its members' atoms. Nested
   * groups are expanded; a cycle is broken by the `seen` guard. Returns
   * `undefined` when `name` is not a group.
   */
  private flattenGroup(name: string, seen = new Set<string>()): Set<string> | undefined {
    const direct = this.groupMembership.get(name);
    if (!direct) return undefined;
    if (seen.has(name)) return new Set();
    seen.add(name);
    const out = new Set<string>();
    for (const m of direct) {
      const nested = this.flattenGroup(m, seen);
      if (nested) for (const n of nested) out.add(n);
      else out.add(m);
    }
    return out;
  }

  /* ------------------------------- embed ------------------------------ */
  /**
   * Inline data blocks captured by the `embed`/`load_embedded` script mechanism
   * (`parser.py` `embed_dict` + `importing.py:load_embedded`). An `embed key,
   * format` block accumulates its raw lines here until the sentinel closes it;
   * `load_embedded key` later concatenates the lines and hands them to `load`.
   * Keyed by block name -> `{ format, lines }`.
   */
  private readonly embedDict = new Map<string, { format: string; lines: string[] }>();
  /** Default embed key: the current script's basename (parser `get_default_key`). */
  embedDefaultKey = '';

  /** Open (or reset) an embed block; subsequent lines append via {@link appendEmbeddedLine}. */
  setEmbedded(key: string, format: string): void {
    this.embedDict.set(key, { format, lines: [] });
  }

  /** Append one raw line (newline-terminated) to an open embed block. */
  appendEmbeddedLine(key: string, line: string): void {
    this.embedDict.get(key)?.lines.push(line);
  }

  /** Fetch a captured embed block by key (parser `get_embedded`). */
  getEmbedded(key: string): { format: string; lines: string[] } | undefined {
    return this.embedDict.get(key);
  }

  /** Drop all captured embed blocks (session reset). */
  clearEmbedded(): void {
    this.embedDict.clear();
    this.embedDefaultKey = '';
  }

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

  /* --------------------------- measurements --------------------------- */

  addMeasurement(m: MeasurementObject): void {
    if (!this.objects.has(m.name) && !this.measures.has(m.name)) this.order.push(m.name);
    this.measures.set(m.name, m);
  }

  measurement(name: string): MeasurementObject | undefined {
    return this.measures.get(name);
  }

  measurementsInOrder(): MeasurementObject[] {
    return this.order.map((n) => this.measures.get(n)!).filter(Boolean);
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
      if (enabledOnly && !(this.objects.get(n)?.enabled ?? this.measures.get(n)?.enabled ?? this.gadgets.get(n)?.enabled)) return false;
      return true;
    });
    const sels = [...this.selections.entries()]
      .filter(([n]) => !(n.startsWith('_') && type.startsWith('public')))
      .filter(([, s]) => !enabledOnly || s.enabled)
      .map(([n]) => n);
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

  /**
   * `get_object_list(sel)` — the molecule-object names covered by a selection,
   * i.e. the objects that contain at least one matched atom, in object order.
   * Mirrors `ExecutiveGetObjectMoleculeVLA` (only ObjectMolecules qualify, not
   * measurements/gadgets), unlike `get_names` which is scoped by type.
   */
  getObjectList(sel: string): string[] {
    if (!sel) return [];
    const covered = new Set(selectAtoms(sel, this.selectorContext).map((ua) => ua.objName));
    return this.order.filter((n) => this.objects.has(n) && covered.has(n));
  }

  /* ------------------------------- delete ----------------------------- */

  delete(pattern: string): void {
    if (pattern === 'all' || pattern === '*') {
      this.order.length = 0;
      this.objects.clear();
      this.measures.clear();
      this.gadgets.clear();
      this.selections.clear();
      return;
    }
    if (this.objects.delete(pattern) || this.measures.delete(pattern) || this.gadgets.delete(pattern)) {
      const i = this.order.indexOf(pattern);
      if (i >= 0) this.order.splice(i, 1);
    }
    this.selections.delete(pattern);
    this.groupMembership.delete(pattern);
  }

  /* ------------------------------- groups ----------------------------- */

  /** Direct member object names of a group, or `undefined` if `name` is not a
   *  group. Creating/removing membership is done by the `group` command. */
  groupDirectMembers(name: string): Set<string> | undefined {
    return this.groupMembership.get(name);
  }

  /** Ensure a group's membership record exists and return it (does not park the
   *  name in `order` — the command registers the group gadget for that). */
  ensureGroup(name: string): Set<string> {
    let s = this.groupMembership.get(name);
    if (!s) this.groupMembership.set(name, (s = new Set()));
    return s;
  }

  /** Forget a group's membership record (leaves member objects untouched). */
  dropGroupMembership(name: string): void {
    this.groupMembership.delete(name);
  }

  /* ------------------------------ gadgets ----------------------------- */
  // Non-molecule, non-measurement named objects: maps, ramps, isosurface/
  // isomesh/gradient meshes. Their geometry lives in the command modules; the
  // executive only tracks name/kind so get_names lists them and get_type reports
  // the right 'object:map'/'object:ramp'/'object:mesh'/'object:surface' kind.
  private readonly gadgets = new Map<string, { name: string; kind: string; enabled: boolean }>();

  registerGadget(name: string, kind: string): void {
    if (!this.objects.has(name) && !this.measures.has(name) && !this.gadgets.has(name)) {
      this.order.push(name);
    }
    this.gadgets.set(name, { name, kind, enabled: true });
  }

  gadget(name: string): { name: string; kind: string; enabled: boolean } | undefined {
    return this.gadgets.get(name);
  }

  /** Rename an object, measurement or gadget (PyMOL `set_name`). Returns true on
   *  success. Validates BEFORE mutating `order` so a failed rename never corrupts
   *  state (the entry's backing registry, not just `order`, must be updated). */
  rename(oldName: string, newName: string): boolean {
    if (oldName === newName) return true;
    if (this.objects.has(newName) || this.measures.has(newName) || this.gadgets.has(newName)) {
      return false;
    }
    const mol = this.objects.get(oldName);
    const meas = this.measures.get(oldName);
    const gad = this.gadgets.get(oldName);
    if (!mol && !meas && !gad) return false; // unknown name — leave `order` untouched
    const i = this.order.indexOf(oldName);
    if (i >= 0) this.order[i] = newName;
    if (mol) {
      this.objects.delete(oldName);
      (mol as { name: string }).name = newName;
      this.objects.set(newName, mol);
    } else if (meas) {
      this.measures.delete(oldName);
      meas.name = newName;
      this.measures.set(newName, meas);
    } else if (gad) {
      this.gadgets.delete(oldName);
      gad.name = newName;
      this.gadgets.set(newName, gad);
    }
    return true;
  }

  /* ------------------------------ selection --------------------------- */

  countAtoms(sel: string): number {
    return selCount(sel, this.selectorContext);
  }

  select(name: string, sel: string): number {
    const matched = selectAtoms(sel, this.selectorContext);
    const keys = new Set(matched.map((ua) => atomKey(ua.objName, ua.atom)));
    // `select` enables the selection by default (enable=-1), showing its dots.
    this.selections.set(name, { keys, enabled: true });
    return matched.length;
  }

  /** `deselect` — disable every currently enabled named selection, clearing the
   *  selection indicator dots without deleting the selections themselves
   *  (`selecting.py` `def deselect`). Returns the number disabled. */
  deselect(): number {
    let n = 0;
    for (const s of this.selections.values()) {
      if (s.enabled) {
        s.enabled = false;
        n++;
      }
    }
    return n;
  }

  /** Store a named selection from an explicit atom list — the editor's
   *  `SelectorEmbedSelection` path (`Selector.cpp`), used by `edit`'s bond-mode
   *  subdivide to create the `_pkbase*`/`_pkfrag*`/`pkbond`/`pkmol` selections. */
  selectAtomList(name: string, atoms: readonly UniverseAtom[]): number {
    this.selections.set(name, {
      keys: new Set(atoms.map((ua) => atomKey(ua.objName, ua.atom))),
      enabled: true,
    });
    return atoms.length;
  }

  /** Names of the currently defined named selections, in creation order. */
  selectionNames(): string[] {
    return [...this.selections.keys()];
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
    this.settingsVersion++;
  }

  /** Monotonic counter bumped on every `set()`; see {@link settingsVersion}. */
  getSettingsVersion(): number {
    return this.settingsVersion;
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

  /**
   * `cmd.reset` / `cmd.zoom`'s window-zoom framing (`ExecutiveWindowZoom` with
   * the weighted extent, `packages/engine/layer3/Executive.cpp`). Unlike
   * {@link selectionSphere} (a plain bounding sphere), PyMOL's window-zoom uses
   * `ExecutiveGetExtent(..., weighted=true)`: the atom coordinate box is
   * re-centred so it is symmetric about the *unweighted centre of mass* (the
   * mean atom position), then the frame is the box centre (= the mean) and a
   * radius of half the largest box dimension (floored to `MAX_VDW`). This is the
   * origin `reset` restores.
   */
  windowZoomSphere(sel: string): { center: [number, number, number]; radius: number } | null {
    const matched = selectAtoms(sel, this.selectorContext);
    if (matched.length === 0) return null;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const sum: [number, number, number] = [0, 0, 0];
    for (const ua of matched) {
      const mol = this.objects.get(ua.objName)!;
      const [x, y, z] = mol.coord(ua.index, 1);
      min[0] = Math.min(min[0], x); max[0] = Math.max(max[0], x);
      min[1] = Math.min(min[1], y); max[1] = Math.max(max[1], y);
      min[2] = Math.min(min[2], z); max[2] = Math.max(max[2], z);
      sum[0] += x; sum[1] += y; sum[2] += z;
    }
    const n = matched.length;
    const mean: [number, number, number] = [sum[0] / n, sum[1] / n, sum[2] / n];
    // Re-centre the box symmetrically about the weighted centre (mean), matching
    // the `have_atoms_flag && weighted` loop in ExecutiveGetExtent. Each axis's
    // half-width becomes fmx = max(mean-min, max-mean); the window-zoom radius is
    // the largest such half-width (df[a]/2), floored to MAX_VDW.
    const fmxX = Math.max(mean[0] - min[0], max[0] - mean[0]);
    const fmxY = Math.max(mean[1] - min[1], max[1] - mean[1]);
    const fmxZ = Math.max(mean[2] - min[2], max[2] - mean[2]);
    let radius = Math.max(fmxX, fmxY, fmxZ);
    const MAX_VDW = 2.5;
    if (radius < MAX_VDW) radius = MAX_VDW;
    return { center: mean, radius };
  }

  /** All atoms matching a selection, for geometry/probe readout. */
  atomsMatching(sel: string): UniverseAtom[] {
    return selectAtoms(sel, this.selectorContext);
  }

  /**
   * Data `orient` needs: the unweighted moment-of-inertia tensor about the
   * selection centroid (`ExecutiveGetMoment`, layer3/Executive.cpp) plus the
   * window-zoom framing PyMOL applies afterwards (`ExecutiveWindowZoom`): the
   * bounding-box centre and half of the largest box dimension (floored to
   * `MAX_VDW`). Returns `null` when the selection has no atoms.
   */
  orientInfo(
    sel: string,
  ): { moment: [number, number, number, number, number, number]; center: [number, number, number]; radius: number } | null {
    const matched = selectAtoms(sel, this.selectorContext);
    if (matched.length === 0) return null;
    const pts: [number, number, number][] = [];
    let cx = 0, cy = 0, cz = 0;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const ua of matched) {
      const mol = this.objects.get(ua.objName)!;
      const [x, y, z] = mol.coord(ua.index, 1);
      pts.push([x, y, z]);
      cx += x; cy += y; cz += z;
      min[0] = Math.min(min[0], x); max[0] = Math.max(max[0], x);
      min[1] = Math.min(min[1], y); max[1] = Math.max(max[1], y);
      min[2] = Math.min(min[2], z); max[2] = Math.max(max[2], z);
    }
    const n = pts.length;
    cx /= n; cy /= n; cz /= n;
    // Moment of inertia tensor (unweighted) about the centroid:
    //   d[i][i] = sum(|r|^2 - r_i^2),  d[i][j] = -sum(r_i r_j).
    let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
    for (const [px, py, pz] of pts) {
      const vx = px - cx, vy = py - cy, vz = pz - cz;
      const r2 = vx * vx + vy * vy + vz * vz;
      xx += r2 - vx * vx;
      yy += r2 - vy * vy;
      zz += r2 - vz * vz;
      xy += -vx * vy;
      xz += -vx * vz;
      yz += -vy * vz;
    }
    // Window-zoom framing: box centre + half the largest box dimension.
    const center: [number, number, number] = [
      (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2,
    ];
    const MAX_VDW = 2.5;
    let radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    if (radius < MAX_VDW) radius = MAX_VDW;
    return { moment: [xx, yy, zz, xy, xz, yz], center, radius };
  }
}
