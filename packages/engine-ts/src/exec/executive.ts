/**
 * The executive — PyMOL's `CExecutive` (`packages/engine/layer3/Executive.cpp`):
 * the ordered set of named objects and selections, the global settings, and the
 * camera. Every ported command is a thin method over this state.
 */

import { Rep, REP_NAMES } from '@tenmol/protocol';
import { repBit } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import { getColorIndex, buildColorTable, lookupColor, type ColorTable, type RGB } from './color';
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

/**
 * The `auto_color` cycle — PyMOL assigns each freshly loaded molecular object
 * the next colour index in this list as its object colour (`ColorGetNext`, driven
 * by `ExecutiveManageObject` when the `auto_color` setting is on, the default).
 * Verbatim from `modules/pymol/util.py` `_color_cycle` (carbon, cyan, …); the
 * indices are the registered colour-table positions (see `exec/color.ts`).
 */
const AUTO_COLOR_CYCLE: readonly number[] = [
  26, 5, 154, 6, 9, 29, 11, 13, 10, 5262, 12, 36, 5271, 124, 17, 18, 5270, 20,
  5272, 52, 5258, 5274, 5257, 5256, 15, 5277, 5279, 5276, 53, 5278, 5275, 5269,
  22, 5266, 5280, 5267, 5268, 104, 23, 51,
];

/** Default global settings the slice reads (`packages/engine/layer1/SettingInfo.h`). */
const DEFAULT_SETTINGS: Readonly<Record<string, number | string>> = {
  sphere_scale: 1.0,
  stick_radius: 0.25,
  nb_spheres_size: 0.25,
  line_width: 1.49, // packages/engine/layer1/SettingInfo.h (under 1.5 for SGI antialiasing)
  field_of_view: 20,
  orthoscopic: 0,
  sculpt_line_weight: 1.0, // packages/engine/layer1/SettingInfo.h (0x010 linearity restraint)
  sculpt_plan_weight: 1.0, // packages/engine/layer1/SettingInfo.h:255 (0x008 planarity restraint)
  // 0x200 cSculptMin minimum-distance restraint term (packages/engine/layer1/SettingInfo.h:493-496).
  sculpt_min_scale: 0.975,
  sculpt_min_weight: 0.75,
  sculpt_min_min: 4.0,
  sculpt_min_max: 12.0,
  // 0x100 cSculptTri 1-4 distance ('triangle') restraint term (packages/engine/layer1/SettingInfo.h:581-584).
  sculpt_tri_scale: 1.025,
  sculpt_tri_weight: 1.0,
  sculpt_tri_min: 2,
  sculpt_tri_max: 18,
  // Mouse-config panel reads these; PyMOL's fresh-session defaults.
  button_mode: 0,
  // button_mode_name's SettingInfo.h default is "" but PyMOL's runtime startup
  // (mouse-config init) sets it to '3-Button Viewing'; the oracle reports that
  // on a fresh session, so this engine-specific override is authoritative and
  // must stay (removing it would wrongly resolve to the empty SettingInfo.h value).
  button_mode_name: '3-Button Viewing',
  // NOTE: mouse_grid and mouse_selection_mode used to be hardcoded to 0 here,
  // which overrode and diverged from the authoritative SettingInfo.h defaults
  // (both 1, oracle-confirmed). They are intentionally omitted so resolveSetting
  // falls through to SETTING_INFO_DEFAULTS.
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
  private readonly settings = new Map<string, number | string | number[]>(Object.entries(DEFAULT_SETTINGS));
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
  private readonly gadgets = new Map<
    string,
    { name: string; kind: string; enabled: boolean; extent?: [[number, number, number], [number, number, number]] }
  >();

  registerGadget(name: string, kind: string, extent?: [[number, number, number], [number, number, number]]): void {
    if (!this.objects.has(name) && !this.measures.has(name) && !this.gadgets.has(name)) {
      this.order.push(name);
    }
    this.gadgets.set(name, { name, kind, enabled: true, ...(extent ? { extent } : {}) });
  }

  gadget(name: string): { name: string; kind: string; enabled: boolean } | undefined {
    return this.gadgets.get(name);
  }

  /** Bounding box of a non-molecule object (e.g. a map grid), if one is
   *  recorded — used by `get_extent`/zoom when a selection names a gadget rather
   *  than atoms (`ExecutiveGetExtent` consults ObjectMap::GetExtent upstream). */
  gadgetExtent(name: string): [[number, number, number], [number, number, number]] | undefined {
    return this.gadgets.get(name)?.extent;
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

  /**
   * `cmd.select_list(name, object, id_list, state, mode)` — API-only selection
   * of atoms within a SINGLE object by an explicit list of numeric identifiers,
   * bypassing the selection-language parser. Mirrors
   * `ExecutiveSelectList` (`layer3/Executive.cpp`): `mode` chooses the identifier
   * semantics — `index` (1-based atom offset), `id` (the atom's stored ID) or
   * `rank` (0-based load order). Returns the number of atoms selected.
   *
   * `state` limits the selection to atoms that have coordinates in that state
   * (`-1` = current, `0` = ignore); the port's coordsets always cover every
   * atom, so this only ever matters for out-of-range states. Index mode never
   * consults coordinates, matching upstream.
   */
  selectList(
    name: string,
    object: string,
    idList: readonly number[],
    state: number,
    mode: 'index' | 'id' | 'rank',
  ): number {
    const mol = this.objects.get(object);
    if (!mol) throw new SelectionError(`select_list: object not found '${object}'`);

    const keys = new Set<string>();
    const wanted = new Set(idList.map((v) => Math.trunc(Number(v))));

    if (mode === 'index') {
      // 1-based index -> 0-based atom offset; out-of-range values are ignored.
      for (const v of wanted) {
        const atm = v - 1;
        const atom = mol.atoms[atm];
        if (atom) keys.add(atomKey(object, atom));
      }
    } else {
      // `id` matches the stored atom id (1-based load order in the port); `rank`
      // matches the 0-based load-order position. Optionally state-filtered.
      const filterState = state > 0 ? state : 0;
      for (let atm = 0; atm < mol.atoms.length; atm++) {
        const atom = mol.atoms[atm]!;
        const idValue = mode === 'id' ? atom.id : atm;
        if (!wanted.has(idValue)) continue;
        if (filterState > 0 && !mol.states[filterState - 1]) continue;
        keys.add(atomKey(object, atom));
      }
    }

    this.selections.set(name, { keys, enabled: true });
    return keys.size;
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

  set(name: string, value: number | string | boolean | number[]): void {
    this.settings.set(name, typeof value === 'boolean' ? (value ? 1 : 0) : value);
    this.settingsVersion++;
  }

  /** Monotonic counter bumped on every `set()`; see {@link settingsVersion}. */
  getSettingsVersion(): number {
    return this.settingsVersion;
  }

  getSetting(name: string): number | string | number[] | undefined {
    return this.settings.get(name);
  }

  /* ---------------------------- per-bond settings --------------------------- */

  /**
   * Per-bond setting overrides (`ExecutiveSetBondSetting`), keyed by
   * `${settingName}\n${objName}\n${lo}-${hi}` where lo/hi are the two 0-based
   * atom indices of the bond. PyMOL stores these on each bond record; we keep a
   * parallel store on the executive so both the writers (`set_bond`/
   * `unset_bond`) and the reader (`get_bond`) share one source of truth.
   */
  private readonly bondSettings = new Map<string, number | string>();

  private static bondSettingKey(name: string, obj: string, i: number, j: number): string {
    return `${name}\n${obj}\n${Math.min(i, j)}-${Math.max(i, j)}`;
  }

  setBondSetting(name: string, obj: string, i: number, j: number, value: number | string): void {
    this.bondSettings.set(Executive.bondSettingKey(name, obj, i, j), value);
    this.settingsVersion++;
  }

  /** Remove a per-bond override; returns true when one was present. */
  unsetBondSetting(name: string, obj: string, i: number, j: number): boolean {
    const removed = this.bondSettings.delete(Executive.bondSettingKey(name, obj, i, j));
    if (removed) this.settingsVersion++;
    return removed;
  }

  getBondSetting(name: string, obj: string, i: number, j: number): number | string | undefined {
    return this.bondSettings.get(Executive.bondSettingKey(name, obj, i, j));
  }

  /**
   * Bulk-remove per-bond overrides for `obj` (`cmd.unset_deep`'s bond level).
   * When `name` is given only that setting's bonds are cleared; otherwise every
   * bond override on the object goes. Returns the number of overrides removed.
   */
  clearBondSettings(obj: string, name?: string): number {
    let n = 0;
    // Keys are `${settingName}\n${objName}\n${lo}-${hi}`.
    for (const key of this.bondSettings.keys()) {
      const nl = key.indexOf('\n');
      const keyName = key.slice(0, nl);
      const rest = key.slice(nl + 1);
      const keyObj = rest.slice(0, rest.indexOf('\n'));
      if (keyObj !== obj) continue;
      if (name !== undefined && keyName !== name) continue;
      this.bondSettings.delete(key);
      n++;
    }
    if (n > 0) this.settingsVersion++;
    return n;
  }

  /* --------------------------- colour space --------------------------- */

  /**
   * The `space` command's state: the active palette name and its resolved LUT
   * plus the gamma factor. `space rgb`/`''` clears the table; `cmyk`/`pymol`/
   * `greyscale` load one (see {@link buildColorTable}). Persists across
   * `reinitialize`, mirroring PyMOL (the colour table has no public reset path).
   */
  private colorSpaceName = 'rgb';
  private colorSpaceGamma = 1;
  private colorSpaceTable: ColorTable | null = null;

  /** Apply `space <name>, <gamma>` — resolve and store the LUT. */
  setColorSpace(space: string, gamma: number): void {
    const name = (space.trim().toLowerCase() || 'rgb') as string;
    this.colorSpaceName = name;
    this.colorSpaceGamma = Number.isFinite(gamma) ? gamma : 1;
    this.colorSpaceTable = buildColorTable(name);
  }

  /** The active colour-space name (`cmd.get_color_space`). */
  getColorSpaceName(): string {
    return this.colorSpaceName;
  }

  /** True when a LUT or a non-unit gamma is in effect (PyMOL's `LUTActive`). */
  colorLutActive(): boolean {
    return this.colorSpaceTable !== null || this.colorSpaceGamma !== 1;
  }

  /**
   * Remap an RGB triple through the active colour space, as PyMOL's `ColorGet`
   * does when returning a colour with `clamp_colors` on (the default). A no-op
   * when no space is active.
   */
  spaceColor(rgb: RGB): RGB {
    if (!this.colorLutActive()) return rgb;
    return lookupColor(this.colorSpaceTable, this.colorSpaceGamma, rgb);
  }

  /* ---------------------------- auto colour --------------------------- */

  /**
   * Assign a freshly loaded molecular object its object colour from the
   * `auto_color` cycle — PyMOL's `ExecutiveManageObject` behaviour when the
   * `auto_color` setting is on (the default). Called by the structure-loading
   * verbs (`load`, `load_model`, `read_pdbstr`, `fragment`); NOT by
   * `pseudoatom`, which leaves its object colour unset (reported as `0`). A
   * no-op when `auto_color` is explicitly off or the object already carries an
   * explicit colour.
   *
   * The cursor lives in the `auto_color_next` global setting (PyMOL's
   * `ColorGetNext`, layer1/Color.cpp): read it, wrap, emit, advance and store
   * it back so `get_setting_int("auto_color_next")` observes the progress.
   */
  autoColorObject(mol: ObjectMolecule): void {
    const s = this.settings.get('auto_color');
    const on = s === undefined ? true : Number(s) !== 0;
    if (!on || mol.color >= 0) return;
    let next = Number(this.settings.get('auto_color_next') ?? 0);
    if (!Number.isFinite(next) || next < 0 || next >= AUTO_COLOR_CYCLE.length) next = 0;
    mol.color = AUTO_COLOR_CYCLE[next]!;
    next++;
    if (next >= AUTO_COLOR_CYCLE.length) next = 0;
    this.settings.set('auto_color_next', next);
    this.settingsVersion++;
  }

  getSettingFloat(name: string): number {
    const v = this.settings.get(name);
    // A float3 (vector) setting has no scalar float value — PyMOL's
    // `SettingGet_f` on a float3 returns 0 (verified vs the oracle for `light`).
    if (Array.isArray(v)) return 0;
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
   *
   * `buffer` mirrors `cmd.zoom`'s padding: PyMOL grows the extent box by `buffer`
   * on every side BEFORE measuring (`mx += buffer; mn -= buffer`), so the centre
   * is unchanged (symmetric) and the radius gains exactly `buffer`. The
   * `MAX_VDW` floor is applied AFTER the buffer, matching ExecutiveWindowZoom.
   */
  windowZoomSphere(sel: string, buffer = 0): { center: [number, number, number]; radius: number } | null {
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
    let radius = Math.max(fmxX, fmxY, fmxZ) + buffer;
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
