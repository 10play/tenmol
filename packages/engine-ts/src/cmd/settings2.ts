/**
 * The `settings2` command subsystem — settings + view extras.
 *
 * Ports the parts of PyMOL's setting machinery that sit beside the plain
 * `cmd.set` / `cmd.get_setting_*` handlers the engine already registers:
 *
 *   - `unset` / `toggle`            (`modules/pymol/setting.py`, `layer3/Executive.cpp:ExecutiveUnsetSetting/ExecutiveToggleRepShown`)
 *   - `set` with a per-object selection, and `get_object_settings`
 *   - `set_bond` / `unset_bond`     (`ExecutiveSetBondSetting`)
 *   - `get_setting_legacy`          (`cmd.get_setting_legacy`)
 *   - `get_clip`                    (`cmd.get_view` indices 15/16)
 *   - `viewport` / `window` / `full_screen` / `reference` (window/scene extras)
 *
 * The executive owns the *global* settings store and the camera; per-object and
 * per-bond overrides live here (PyMOL keeps them on the object; we keep a
 * parallel store so the subsystem stays self-contained). See
 * docs/engine-port-gaps.md.
 */

import type { Json } from '@tenmol/protocol';
import { Rep, REP_NAMES } from '@tenmol/protocol';
import { repBit } from '../model/atom';
import { COLOR_SETTINGS, colorSettingText, getColorIndex, REP_COLOR_SETTING_DEFAULTS } from '../exec/color';
import { SETTING_INDEX_TYPE } from './setting-catalog';
import type { RegistrarCtx } from './registrar';

/** `cSetting_*` type tags (`layer1/Setting.h`). */
const cSetting_float3 = 4;
const cSetting_string = 6;

/**
 * Compiled-in defaults for the settings this subsystem may reset to
 * (`layer1/SettingInfo.h`). `unset` restores these; anything not listed falls
 * back to 0 (PyMOL's numeric default for most unlisted settings). We *also*
 * capture the executive's live default the first time `set` overrides a
 * setting, so a round-trip is exact even for settings not tabulated here.
 */
const SETTING_DEFAULTS: Readonly<Record<string, number | string>> = {
  sphere_scale: 1.0,
  stick_radius: 0.25,
  nb_spheres_size: 0.25,
  line_width: 1.0,
  field_of_view: 20,
  orthoscopic: 0,
  cartoon_transparency: 0,
  sphere_transparency: 0,
  stick_transparency: 0,
  transparency: 0,
  dot_width: 2.0,
  mesh_width: 1.0,
  dash_width: 2.5,
  ambient: 0.14,
  specular: 1.0,
  cartoon_side_chain_helper: 0,
  valence: 0,
  ray_trace_mode: 0,
  antialias: 1,
  sculpt_line_weight: 1.0,
};

/**
 * Setting names whose value formats as an integer / boolean when read as text
 * (`layer1/SettingInfo.h` `REC_i` / `REC_b`). `SettingGetTextPtr`
 * (`layer1/Setting.cpp`) prints booleans as `on`/`off`, ints with `%d`, and
 * every other numeric setting (the float default) with `%1.5f`. We only need the
 * non-float exceptions among the settings this port actually tracks; unknown
 * numeric settings fall through to the float format, PyMOL's most common type.
 */
const BOOLEAN_SETTINGS: ReadonlySet<string> = new Set([
  'orthoscopic',
  'mouse_grid',
  'cartoon_side_chain_helper',
  'valence',
]);
const INT_SETTINGS: ReadonlySet<string> = new Set([
  'button_mode',
  'mouse_selection_mode',
  'ray_trace_mode',
  'antialias',
]);

/**
 * PyMOL's `SettingGetTextPtr` — the text form `cmd.get` / `cmd.get_setting_text`
 * return. Colour-typed settings read back as a colour name; booleans as
 * `on`/`off`; ints with `%d`; floats with `%1.5f`; strings verbatim.
 */
function settingText(name: string, v: number | string | undefined): string {
  if (COLOR_SETTINGS.has(name)) return colorSettingText(v);
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (BOOLEAN_SETTINGS.has(name)) return v !== 0 ? 'on' : 'off';
  if (INT_SETTINGS.has(name)) return String(Math.trunc(v));
  return v.toFixed(5); // "%1.5f"
}

/** rep command-name -> rep id, for the representation-toggle path of `toggle`. */
const REP_ID_BY_NAME = new Map<string, number>();
for (const [id, name] of Object.entries(REP_NAMES)) REP_ID_BY_NAME.set(name, Number(id));
REP_ID_BY_NAME.set('wire', Rep.Line);
REP_ID_BY_NAME.set('dot', Rep.Dot);

/** PyMOL's `set` value coercion (mirrors the engine's built-in `set`). */
function coerceValue(raw: unknown, str: RegistrarCtx['str']): number | string {
  if (typeof raw === 'number') return raw;
  const n = Number(raw);
  return Number.isNaN(n) ? str(raw) : n;
}

/**
 * `set` coercion for colour-typed settings (`REC_c`). PyMOL stores a colour
 * INDEX, not a name: `SettingSetFromString`'s `cSetting_color` branch runs the
 * value through `ColorGetIndex` (`layer1/Setting.cpp`), so `set cartoon_color,
 * red` stores `4`. A bare numeric index passes through; an unknown colour name
 * is left verbatim (matches PyMOL's text fallback for non-palette values).
 */
function coerceSettingValue(name: string, raw: unknown, str: RegistrarCtx['str']): number | string {
  const v = coerceValue(raw, str);
  if (typeof v === 'string' && COLOR_SETTINGS.has(name)) {
    const idx = getColorIndex(v);
    if (idx >= 0) return idx;
  }
  return v;
}

export function registerSettings2(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const str = ctx.str;

  /** Live defaults captured lazily from the executive on first override. */
  const capturedDefaults = new Map<string, number | string>();
  /** objName -> (settingName -> value). */
  const perObject = new Map<string, Map<string, number | string>>();

  // Window state the scene extras track (no GL side effects here). Viewport size
  // lives on the executive so `cmd.viewport` (here) and `cmd.get_viewport` (on
  // the Engine) share one source of truth.
  let windowState: string = 'show';
  let fullScreenState = 0;

  /** The default a global setting resets to. */
  const defaultOf = (name: string): number | string => {
    if (capturedDefaults.has(name)) return capturedDefaults.get(name)!;
    if (Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, name)) return SETTING_DEFAULTS[name]!;
    return 0;
  };

  /** Objects whose atoms match `sel` (for per-object / per-bond scoping). */
  const objectsFor = (sel: string): string[] => {
    const names = new Set<string>();
    if (!sel || sel === 'all' || sel === '*') {
      for (const m of ex.moleculesInOrder()) names.add(m.name);
      return [...names];
    }
    // A bare object name is the common case; take it directly if it exists.
    if (ex.molecule(sel)) return [sel];
    for (const ua of ex.atomsMatching(sel)) names.add(ua.objName);
    return [...names];
  };

  /* ------------------------------ set (super) ----------------------------- */
  // Superset of the engine's built-in `set`: global path is identical; a
  // non-empty selection routes to a per-object override (PyMOL's object-level
  // settings). Registered after the built-in, so this handler wins.
  ctx.command('set', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const value = coerceSettingValue(name, args[1] ?? kwargs['value'] ?? 1, str);
    const sel = str(args[2] ?? kwargs['selection'] ?? '');
    if (!name) return 0;
    if (sel) {
      const objs = objectsFor(sel);
      for (const obj of objs) {
        let m = perObject.get(obj);
        if (!m) perObject.set(obj, (m = new Map()));
        m.set(name, value);
      }
      ctx.publish();
      return objs.length;
    }
    // Capture the pristine default the first time we override this global.
    if (!capturedDefaults.has(name)) {
      const cur = ex.getSetting(name);
      if (cur !== undefined) capturedDefaults.set(name, cur);
    }
    ex.set(name, value);
    ctx.publish();
    return 1;
  });

  /* -------------------------------- unset --------------------------------- */
  ctx.command('unset', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const sel = str(args[1] ?? kwargs['selection'] ?? '');
    if (!name) return 0;
    if (sel) {
      // Per-object: drop the override for every matched object.
      let n = 0;
      for (const obj of objectsFor(sel)) {
        const m = perObject.get(obj);
        if (m && m.delete(name)) {
          n++;
          if (m.size === 0) perObject.delete(obj);
        }
      }
      ctx.publish();
      return n;
    }
    // Global: restore the compiled/captured default.
    ex.set(name, defaultOf(name));
    ctx.publish();
    return 1;
  });

  /* -------------------------------- toggle -------------------------------- */
  // For a representation name: flip its visibility across the selection
  // (PyMOL's `cmd.toggle`). Otherwise flip a boolean-ish global setting 0<->1.
  ctx.command('toggle', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['representation'] ?? 'lines') || 'lines';
    const sel = str(args[1] ?? kwargs['selection'] ?? 'all') || 'all';
    const repId = REP_ID_BY_NAME.get(name);
    if (repId !== undefined) {
      const bit = repBit(repId);
      const anyOn = ex.atomsMatching(sel).some((ua) => (ua.atom.visRep & bit) !== 0);
      if (anyOn) ex.hide(name, sel);
      else ex.show(name, sel);
      ctx.publish();
      return anyOn ? 0 : 1;
    }
    const next = ex.getSettingFloat(name) !== 0 ? 0 : 1;
    if (!capturedDefaults.has(name)) {
      const cur = ex.getSetting(name);
      if (cur !== undefined) capturedDefaults.set(name, cur);
    }
    ex.set(name, next);
    ctx.publish();
    return next;
  });

  /* ------------------------------ bond settings --------------------------- */
  /** Bonds of `obj` with one endpoint in `set1` and the other in `set2`. */
  const bondsBetween = (obj: string, set1: Set<number>, set2: Set<number>): [number, number][] => {
    const mol = ex.molecule(obj);
    if (!mol) return [];
    const out: [number, number][] = [];
    for (const [i, j] of mol.bonds) {
      if ((set1.has(i) && set2.has(j)) || (set1.has(j) && set2.has(i))) out.push([i, j]);
    }
    return out;
  };

  /** Per-object atom-index sets for a selection. */
  const indexSets = (sel: string): Map<string, Set<number>> => {
    const m = new Map<string, Set<number>>();
    for (const ua of ex.atomsMatching(sel)) {
      let s = m.get(ua.objName);
      if (!s) m.set(ua.objName, (s = new Set()));
      s.add(ua.index);
    }
    return m;
  };

  // PyMOL's `cmd.set_bond` / `cmd.unset_bond` return the C result of
  // `_cmd.set_bond` / `_cmd.unset_bond` (`ExecutiveSetBondSetting` /
  // `ExecutiveUnsetBondSetting`), which is `None` — the number of bonds touched
  // is not surfaced to Python. We mirror that (return null) and route the store
  // through the executive so `get_bond` (in misc.ts) can read the overrides.
  ctx.command('set_bond', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const value = coerceValue(args[1] ?? kwargs['value'] ?? 1, str);
    const sel1 = str(args[2] ?? kwargs['selection1'] ?? 'all') || 'all';
    const sel2 = str(args[3] ?? kwargs['selection2'] ?? sel1) || sel1;
    if (!name) return null;
    const a = indexSets(sel1);
    const b = indexSets(sel2);
    for (const obj of a.keys()) {
      const s2 = b.get(obj);
      if (!s2) continue;
      for (const [i, j] of bondsBetween(obj, a.get(obj)!, s2)) {
        ex.setBondSetting(name, obj, i, j, value);
      }
    }
    ctx.publish();
    return null;
  });

  ctx.command('unset_bond', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const sel1 = str(args[1] ?? kwargs['selection1'] ?? 'all') || 'all';
    const sel2 = str(args[2] ?? kwargs['selection2'] ?? sel1) || sel1;
    if (!name) return null;
    const a = indexSets(sel1);
    const b = indexSets(sel2);
    for (const obj of a.keys()) {
      const s2 = b.get(obj);
      if (!s2) continue;
      for (const [i, j] of bondsBetween(obj, a.get(obj)!, s2)) {
        ex.unsetBondSetting(name, obj, i, j);
      }
    }
    ctx.publish();
    return null;
  });

  /* ------------------------------- unset_deep ----------------------------- */
  // PyMOL's `cmd.unset_deep` (`modules/pymol/setting.py`) bulk-clears setting
  // overrides at every level — object, object-state, atom, and bond — so the
  // matched objects fall back to global/default values. Empty `settings` means
  // "all settings"; `object='*'`/`'all'` means every object. This port keeps
  // object-level overrides in `perObject` and bond-level overrides on the
  // executive; it does not model object-state or atom-state overrides (PyMOL's
  // own note: it also skips atom-state settings), so those levels are no-ops.
  ctx.command('unset_deep', (args, kwargs): Json => {
    const settingsArg = str(args[0] ?? kwargs['settings'] ?? '');
    const objectArg = str(args[1] ?? kwargs['object'] ?? '*') || '*';
    const names: string[] | null = settingsArg ? settingsArg.split(/\s+/).filter(Boolean) : null;
    const objs = objectsFor(objectArg === 'all' ? '*' : objectArg);
    for (const obj of objs) {
      const m = perObject.get(obj);
      if (m) {
        if (names) {
          for (const name of names) m.delete(name);
        } else {
          m.clear();
        }
        if (m.size === 0) perObject.delete(obj);
      }
      if (names) {
        for (const name of names) ex.clearBondSettings(obj, name);
      } else {
        ex.clearBondSettings(obj);
      }
    }
    ctx.publish();
    return null;
  });

  /* ----------------------------- introspection ---------------------------- */
  // PyMOL's `_cmd.get_object_settings` (`layer4/Cmd.cpp:CmdGetObjectSettings`)
  // returns the object-level setting handle serialized by `SettingAsPyList`
  // (`layer1/Setting.cpp`): a list of `[index, type, value]` tuples, one per
  // *defined* override, in ascending setting-index order. Value follows the
  // setting type — boolean/int/color as an int, float as a float, string
  // verbatim. When the object has no settings handle (no overrides, or the
  // object does not exist) the C-layer result is null -> Python `None`.
  ctx.command('get_object_settings', (args, kwargs): Json => {
    const obj = str(args[0] ?? kwargs['object']);
    const m = perObject.get(obj);
    if (!m || m.size === 0) return null;
    const rows: [number, number, number | string][] = [];
    for (const [name, value] of m) {
      const meta = SETTING_INDEX_TYPE[name];
      if (!meta) continue; // not a real PyMOL setting -> never serialized
      const [index, type] = meta;
      let v: number | string = value;
      if (type !== cSetting_float3 && type !== cSetting_string && typeof value !== 'string') {
        // boolean / int / color are integers; float keeps its value.
        v = type === 3 ? value : Math.trunc(value);
      }
      rows.push([index, type, v]);
    }
    if (rows.length === 0) return null;
    rows.sort((a, b) => a[0] - b[0]);
    return rows as unknown as Json;
  });

  /* ------------------------- per-object-aware reads ----------------------- */
  // PyMOL's `cmd.get_setting_*(name, selection)` resolves the *effective* value
  // for the referenced object: a per-object override if one exists, otherwise
  // the global. The engine's built-in handlers only read the global store, so
  // we re-register the query verbs here (this subsystem loads after the
  // built-ins, so these win) to consult the per-object overrides first.
  const resolveSetting = (name: string, sel: string): number | string | undefined => {
    if (sel) {
      for (const obj of objectsFor(sel)) {
        const m = perObject.get(obj);
        if (m && m.has(name)) return m.get(name);
      }
    }
    const g = ex.getSetting(name);
    if (g !== undefined) return g;
    // A colour-typed rep setting with no override resolves to its compiled
    // default (`-1`/`-6`), not a bare `0` — matches PyMOL after `color_deep`.
    if (Object.prototype.hasOwnProperty.call(REP_COLOR_SETTING_DEFAULTS, name)) {
      return REP_COLOR_SETTING_DEFAULTS[name];
    }
    return undefined;
  };
  const asFloat = (v: number | string | undefined): number =>
    typeof v === 'number' ? v : Number(v ?? 0);

  ctx.command('get_setting', (args, kwargs): Json => {
    const v = resolveSetting(str(args[0] ?? kwargs['name']), str(args[1] ?? kwargs['selection'] ?? ''));
    return v === undefined ? null : (v as Json);
  });
  ctx.command('get_setting_float', (args, kwargs): Json =>
    asFloat(resolveSetting(str(args[0] ?? kwargs['name']), str(args[1] ?? kwargs['selection'] ?? ''))));
  // `get_setting_legacy` is a pure import alias of `get_setting_float`
  // (`modules/pymol/api.py`: `get_setting_float as get_setting_legacy`), so it
  // must honour the per-object `object` argument identically, not just read the
  // global store.
  ctx.command('get_setting_legacy', (args, kwargs): Json =>
    asFloat(resolveSetting(str(args[0] ?? kwargs['name']), str(args[1] ?? kwargs['object'] ?? kwargs['selection'] ?? ''))));
  ctx.command('get_setting_int', (args, kwargs): Json =>
    Math.trunc(asFloat(resolveSetting(str(args[0] ?? kwargs['name']), str(args[1] ?? kwargs['selection'] ?? '')))));
  // PyMOL's `get_setting_boolean` coerces to `cSetting_boolean`, which the C
  // layer returns as a Python bool (`True`/`False`), not `1`/`0`.
  ctx.command('get_setting_boolean', (args, kwargs): Json =>
    asFloat(resolveSetting(str(args[0] ?? kwargs['name']), str(args[1] ?? kwargs['selection'] ?? ''))) !== 0);
  ctx.command('get_setting_text', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const v = resolveSetting(name, str(args[1] ?? kwargs['selection'] ?? ''));
    return settingText(name, v);
  });

  // `cmd.get(name, selection='', state=0, quiet=1)` — the read counterpart to
  // `set` (`modules/pymol/setting.py`). PyMOL resolves the setting via
  // `get_setting_text`, so `get` returns the TEXT form (floats as `%1.5f`,
  // colours as names, …), not the raw stored value, and honours a per-object
  // `selection`. The engine's built-in `get` only read the raw global store;
  // this handler (registered after the built-ins) supersedes it.
  ctx.command('get', (args, kwargs): Json => {
    const name = str(args[0] ?? kwargs['name']);
    const sel = str(args[1] ?? kwargs['selection'] ?? '');
    const v = resolveSetting(name, sel);
    return settingText(name, v);
  });
  ctx.command('get_setting_tuple', (args, kwargs): Json => [
    resolveSetting(str(args[0] ?? kwargs['name']), str(args[1] ?? kwargs['selection'] ?? '')) ?? 0,
  ] as Json);

  /* ------------------------------- view extras ---------------------------- */
  ctx.command('get_clip', (): Json => {
    const view = ex.view.get();
    return [view[15]!, view[16]!];
  });

  ctx.command('viewport', (args, kwargs): Json => {
    const w = Number(args[0] ?? kwargs['width'] ?? -1);
    const h = Number(args[1] ?? kwargs['height'] ?? -1);
    ex.setViewport(w, h);
    return ex.getViewport();
  });

  ctx.command('window', (args, kwargs): Json => {
    const action = str(args[0] ?? kwargs['action'] ?? 'show') || 'show';
    windowState = action;
    return null;
  });

  ctx.command('full_screen', (args, kwargs): Json => {
    const raw = args[0] ?? kwargs['toggle'] ?? 0;
    const toggle = Number(raw);
    fullScreenState = toggle === -1 ? (fullScreenState ? 0 : 1) : toggle ? 1 : 0;
    return null;
  });

  // Silence unused-var lint for the window/full-screen trackers (state kept for
  // future scene extras that read the current window mode).
  void windowState;
  void fullScreenState;
}
