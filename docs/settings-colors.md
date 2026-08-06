---
title: "Settings and colors"
description: "Map of PyMOL's setting table, its change-notification machinery, and the colour/ramp system. Every claim is anchored to a file:line in packages/engine/…"
---

# Settings and colors

Map of PyMOL's setting table, its change-notification machinery, and the colour/ramp system.
Every claim is anchored to a `file:line` in `packages/engine/`, which is unmodified upstream.

**Where the port stands.** Introspection and values:
`packages/bridge/tenmol_bridge/panels/settings.py` (`catalogue()`, `values()`, `drain()`), typed in
`packages/protocol/src/topics/settings.ts`, consumed by `apps/web/src/features/settings/`
(`service.ts`, `SettingsPanel.tsx`, `AdvancedSettingsTable.tsx`, `SettingMenu.tsx`,
`LightingPanel.tsx`, `atomSettings.ts`) and stored in `packages/stores/src/settings.ts`.
Colours and ramps: `packages/bridge/tenmol_bridge/panels/colors.py` and
`apps/web/src/features/colors/`.

---

## PART A — THE SETTINGS SYSTEM

### A1. The setting table is a static C table, generated twice from one header

`packages/engine/layer1/SettingInfo.h` is included twice (`packages/engine/layer1/Setting.h:242` for the enum,
`packages/engine/layer1/Setting.cpp:76-78` with `SETTINGINFO_IMPLEMENTATION` for the data table).

Record macros — `packages/engine/layer1/SettingInfo.h:15-23`:

| macro | type constant | meaning | payload |
|---|---|---|---|
| `REC__(idx, name)` | `cSetting_blank` (0) | retired slot, level `unused` | none |
| `REC_b(idx,name,level,val)` | `cSetting_boolean` (1) | bool | default, min 0, max 1 |
| `REC_i(idx,name,level,...)` | `cSetting_int` (2) | int | default `[, min, max]` |
| `REC_f(idx,name,level,...)` | `cSetting_float` (3) | float | default `[, min, max]` |
| `REC_3(idx,name,level,...)` | `cSetting_float3` (4) | 3-vector | 3 floats |
| `REC_s(idx,name,level,val)` | `cSetting_string` (6) | string | C string |
| `REC_c(idx,name,level,val)` | `cSetting_color` (5) | color | color spec string |

Type constants are mirrored in Python at `packages/engine/modules/pymol/setting.py:19-26` and defined in
`packages/engine/layer1/Setting.h:113-120`. `cSetting_tuple = -1` is a pseudo-type used only as an argument to
`_cmd.get_setting_of_type` to request `(type, value)` tuples.

**Exact counts (computed from `packages/engine/layer1/SettingInfo.h`, 798 `REC_*` rows, indices 0..797):**

- 798 total records; index range `0 .. 797`; `cSetting_INIT = 798` (`packages/engine/layer1/SettingInfo.h:913`).
- By type: 219 boolean, 203 int, 294 float, 15 float3, 34 color, 32 string, 1 blank
  (`REC__( 83, )` at `packages/engine/layer1/SettingInfo.h:167`).
- By level: 454 `global`, 231 `object-state` (`ostate`), 44 `object`, 27 `atom`,
  17 `atom-state` (`astate`), 6 `bond`, 18 `unused` (+1 blank).
- **779 settings are visible to Python.** `SettingGetSettingIndices()`
  (`packages/engine/layer1/Setting.cpp:3227-3245`) skips every record whose level is `cSettingLevel_unused`,
  so the 18 retired settings + 1 blank never appear in `index_dict`.
- `packages/engine/modules/pymol/setting.py:48` then injects one legacy alias, `ray_shadows -> ray_shadow`, into
  `index_dict` **after** `name_list` was captured at `setting.py:44`. Net effect:
  `len(setting.get_name_list()) == 779`, `len(setting.index_dict) == 780`.
- Indices are frozen forever (they are serialized into `.pse` sessions) —
  `packages/engine/layer1/SettingInfo.h:5-6` "WARNING: do not delete or change indices"; regression-tested at
  `packages/engine/testing/tests/api/setting.py:5-8` (`collada_geometry_mode == 742`).
- The last three added settings are 795 `salt_bridge_distance`, 796 `use_tessellation_shaders`,
  797 `cell_color` (`packages/engine/layer1/SettingInfo.h:895-908`).

**No documentation strings live in the C table.** There is a `packages/engine/data/setting_help.csv` (875 rows,
`"name","description","type","default","flag"`) but **grep over the entire tree finds zero
consumers** — no Python, no C++, no CMake reference. It is dead data in this fork, but it is the
only per-setting help text that exists and is the obvious source for tooltips in the web UI.

### A2. Levels form a non-linear lattice

`packages/engine/layer1/Setting.h:325-334` defines the enum; `packages/engine/layer1/Setting.cpp:64-74` defines the mask table:

```
{"unused",0x00} {"global",0x00} {"object",0x01} {"object-state",0x03}
{"atom",0x07} {"atom-state",0x0F} {"bond",0x13} {"bond-state",0x33}
```

Comment at `packages/engine/layer1/Setting.cpp:55-63` states the hierarchy:
`global < object < object-state`, and `object-state < atom < atom-state`,
`object-state < bond < bond-state`. Atom and bond branches are siblings, not ordered.

- `SettingLevelGetName(index)` → level name string (`packages/engine/layer1/Setting.cpp:83-85`).
- `SettingLevelCheckMask` / `SettingLevelCheck` (`packages/engine/layer1/Setting.cpp:88-96`) validate that a
  setting may be written at a requested level.
- Writing at a wrong level is a **warning, not an error**: `packages/engine/layer3/Executive.cpp:12279-12286`
  prints `" Setting-Warning: '%s' is a %s-level setting"` and still performs the write (which then
  silently has no effect). `packages/engine/modules/pymol/setting.py:230-247` documents the per-atom whitelist and
  `setting.py:148-155` the per-bond whitelist as prose only.
- `alter`/`alter_state` enforce hard: `packages/engine/layer1/P.cpp:523-528` (astate) and `P.cpp:531-536` (atom)
  raise `TypeError`.

### A3. Runtime introspection surface exposed to Python

C entry points registered in `packages/engine/layer4/Cmd.cpp:6492-6496`:

| `_cmd` function | C impl | signature | returns |
|---|---|---|---|
| `get_setting_indices()` | `packages/engine/layer4/Cmd.cpp:2080-2083` → `packages/engine/layer1/Setting.cpp:3227` | `()` | `{name: index}` dict, 779 entries |
| `get_setting_type(index)` | `packages/engine/layer4/Cmd.cpp:4394-4401` | `(int)` | int type code |
| `get_setting_level(index)` | `packages/engine/layer4/Cmd.cpp:4403-4409` | `(uint)` | level **name string** |
| `get_setting_of_type(COb, index, object, state, type)` | `packages/engine/layer4/Cmd.cpp:4411-4422` → `packages/engine/layer3/Executive.cpp:7995` | | typed value |
| `get_setting_updates(COb, name, state)` | `packages/engine/layer4/Cmd.cpp:2058-2078` → `packages/engine/layer1/Setting.cpp:1121` | | list of changed indices |

**`get_setting_level` is exported by C but never wrapped in `packages/engine/modules/pymol/setting.py`** — it is
reachable only as `cmd._cmd.get_setting_level(i)`. This is the single most important gap for the
web client: the level is what decides whether a setting can be edited globally, per-object,
per-state or per-atom, and the Python `setting` module currently discards it.

Python wrappers in `packages/engine/modules/pymol/setting.py` (re-exported into `cmd` at
`packages/engine/modules/pymol/api.py:415-432`):

| Python API | line | notes |
|---|---|---|
| `setting.index_dict` / `name_dict` / `name_list` | 39-45 | name↔index maps built once at import |
| `setting.setting_sc = Shortcut(name_list)` | 45 | prefix/abbreviation resolution for names |
| `setting._get_index(name)` | 63-70 | accepts int, digit-string, exact name, or unique abbreviation; raises `QuietException` on ambiguity |
| `setting._get_name(index)`, `get_index_list()`, `get_name_list()` | 72-81 | legacy helpers |
| `setting._validate_value(type, value)` | 83-112 | client-side coercion, see below |
| `cmd.set(name, value, selection, state, updates, log, quiet)` | 185-271 | |
| `cmd.set_bond(name, value, sel1, sel2, state, ...)` | 116-182 | |
| `cmd.unset(name, selection, state, ...)` | 273-322 | restores **default** since PyMOL 2.5 (docstring 279-282) |
| `cmd.unset_bond(...)` | 324-348 | |
| `cmd.get(name, selection, state, quiet)` | 353-406 | returns *text* representation |
| `cmd.get_setting_tuple(name, object, state)` | 413-418 | `(type, (v,))` legacy shape, `(4,(x,y,z))` for float3 |
| `get_setting_tuple_new` | 408-411 | `(type, value)` — value not wrapped |
| `cmd.get_setting_boolean/int/float/text` | 420-438 | force a coercion type |
| `cmd.get_setting_updates(object, state)` | 440-447 | **destructive read**, see A5 |
| `cmd.get_bond(name, sel1, sel2, state, ...)` | 449-514 | `[(model, [(idx1, idx2, value), ...]), ...]` |
| `cmd.unset_deep(settings, object, updates, quiet)` | 516-569 | clears object/ostate/atom/bond; explicitly *not* atom-state (docstring 519-526) |

Value coercion rules — `packages/engine/modules/pymol/setting.py:83-112`:
- boolean: any float parses; non-zero → 1; otherwise `boolean_dict` (`setting.py:50-59`) accepts
  `true/false/on/off/1/0/1.0/0.0` with `Shortcut` abbreviation.
- int/float: strings that look boolean are converted first, then `int()`/`float()`.
- float3: list/tuple passthrough; string with commas goes through `cmd.safe_eval`
  (`packages/engine/modules/pymol/constants.py:106-117`), otherwise whitespace split; always returns 3 floats.
- color: `str(value)` — resolution happens in C (`SettingSet_color`, `packages/engine/layer1/Setting.cpp:1740-1770`).
- string: outermost matching quotes stripped.

### A4. Read/write semantics

**Resolution order.** `_SettingGetFirstDefined` (`packages/engine/layer1/Setting.cpp:3273-3282`): `set1` (most
specific) → `set2` → `G->Setting` (global). `ExecutiveGetSettingOfType`
(`packages/engine/layer3/Executive.cpp:7995-8021`) resolves `object` → object CSetting, `state >= 0` → object-state
CSetting, and errors `object "%s" not found` / `object "%s" lacks state %d`.

**Return shapes** — `SettingGetTuple` (`packages/engine/layer1/Setting.cpp:1448-1479`):
- boolean/int/color → `(type, int)`
- float → `(type, float)` via `pretty_f2d` (7 significant digits, `packages/engine/testing/tests/api/setting.py:49-55`)
- float3 → `(type, (f,f,f))`
- string → `(type, str)`
- blank → `None`

`SettingGetPyObject` (`packages/engine/layer1/Setting.cpp:1405-1443`) is different again: **color settings return an
RGB triple**, not an index (`Setting.cpp:1428-1437`), and only when `index > 0`.

**Text representation** — `SettingGetTextPtr` (`packages/engine/layer1/Setting.cpp:1183-1237`):
boolean → `"on"`/`"off"`; int → `%d`; float → `%1.5f`; float3 → `"[ %1.5f, %1.5f, %1.5f ]"`;
color → `atomic|object|front|back|default` for the negative specials, else the color's **name**;
string → the raw string. This is exactly what `cmd.get()` returns and what the advanced settings
table displays for float/float3/color (`packages/engine/modules/pmg_qt/advanced_settings_gui.py:63-64`).

**Min/max.** Only 30 records carry min/max, and **only int settings are actually clamped**, and only
for global writes: `packages/engine/layer1/Setting.cpp:1890-1911` — `rec.type == cSetting_int && rec.hasMinMax() &&
!(sele && sele[0])`, printing `" Setting-Warning: %s range = [%d,%d]; setting to %d."`.
The two float ranges present (`openvr_gui_fov` 0–89, `openvr_gui_alpha` 0–1) are declared but never
enforced. The clamped int settings are:
`stick_quality` 3–100, `sphere_quality` 0–4, `logging` 0–2, `secondary_structure` 1–4,
`cartoon_cylindrical_helices` 0–2, `stereo_mode` 1–13, `cgo_sphere_quality` 0–4,
`pdb_reformat_names_mode` 0–4, `mesh_type` 0–1, `sphere_mode` -1–11, `matrix_mode` -1–2,
`light_count` 1–10, `grid_mode` 0–3, `state_counter_mode` -1–2, `nb_spheres_quality` 0–4,
`nb_spheres_use_shader` 0–2, `cartoon_nucleic_acid_as_cylinders` 0–3, `anaglyph_mode` 0–4,
`bg_image_mode` 0–3, `label_connector_mode` 0–4, `label_relative_mode` 0–2, `valence_zero_mode` 0–2,
`auto_show_classified` -1–3, `internal_gui_name_color_mode` 0–2, `openvr_gui_use_alpha` 0–2,
`openvr_gui_use_backdrop` 0–2, `openvr_gui_overlay` 0–2, `isosurface_algorithm` 0–2
(`packages/engine/layer1/SettingInfo.h`, rows 46, 87, 131, 157, 180, 188, 189, 326, 335, 421, 438, 455, 577, 667,
689, 690, 693, 706, 713, 721, 727, 753, 754, 768, 771, 776, 777, 787).

**Side effects.** `SettingGenerateSideEffects` (`packages/engine/layer1/Setting.cpp:1872-…`) is a giant `switch`
over the setting index that invalidates reps, reloads shaders, rebuilds scenes, etc.
(`cSetting_stereo` → `SceneUpdateStereo` + shader reload; `cSetting_pick_surface` → invalidate
surface color; `cSetting_grid_mode` → reset uniforms + `ExecutiveUpdateSceneMembers`; …). It also
warns `" Setting-Warning: '%s' is no longer used"` for `unused`-level records
(`packages/engine/layer1/Setting.cpp:1876-1887`). **Implication for the web client: after any `set`, geometry that
three.js already holds may be stale; the bridge must emit a geometry-invalidation event, it cannot
assume settings are cosmetic.**

### A5. Change notification — `get_setting_updates` is destructive and single-consumer

`SettingGetUpdateList` (`packages/engine/layer1/Setting.cpp:1121-1147`) walks all `cSetting_INIT` records, collects
every index whose `changed` flag is set, **and resets the flag while iterating**. With a `name`
argument it targets one object's state-level CSetting instead of globals.

The Qt GUI is the only consumer today: `packages/engine/modules/pmg_qt/pymol_qt_gui.py:952-956` polls it inside
`update_feedback()` on a 500 ms `QTimer` (`pymol_qt_gui.py:391-393`, restarted at line 958) and
dispatches to `self.setting_callbacks[index]` (a `defaultdict(list)` built at
`pymol_qt_gui.py:111`). Menu actions register themselves there at `pymol_qt_gui.py:332-334`
(radio) and `pymol_qt_gui.py:1065-1066` (`SettingAction`). One hardcoded callback exists:
index 440 = `session_file` → window title (`pymol_qt_gui.py:114-116`).

The Tk path does the same via `pmg_tk/Setting.py:145-150` (`Setting.refresh()` over
`active_dict`), backed by `PymolVar`/`ListVarItem`/`ColorVar` two-way Tk variables
(`pmg_tk/Setting.py:28-100`).

**Consequence:** if the bridge polls `get_setting_updates()` and any other component (a plugin, the Qt
window if still alive) also polls it, updates are lost — the flag is cleared by whoever reads
first. The bridge must own this call exclusively.

### A6. Atom-, atom-state- and bond-level settings

Accessed only through the iterate family via the `s` namespace object
(`wrapper.SettingWrapper`, `packages/engine/layer1/P.cpp:393`):

- `s[key]` read — `packages/engine/layer1/P.cpp:455-486`. Key may be an int index or a name string
  (`get_and_check_setting_index`, `P.cpp:425-443`, raises `LookupError` for unknown).
  Lookup cascade: atom-state → atom → object-state/object/global.
- `s[key] = v` write — `packages/engine/layer1/P.cpp:502-539`; read-only outside `alter`/`alter_state`
  (`P.cpp:512-516`), and level-checked as noted in A2.
- `iter(s)` — `packages/engine/layer1/P.cpp:581-606` → `SettingUniqueGetIndicesAsPyList`
  (`packages/engine/layer1/Setting.cpp:3249-3268`): yields the **indices** actually defined on that atom/atom-state.
  This is the only way to enumerate per-atom overrides, and it returns numbers, not names.
- Storage is the `CSettingUnique` sparse map keyed by `unique_id`
  (`packages/engine/layer1/Setting.h:34-50`; `packages/engine/layer2/AtomInfo.cpp:74-95`; `packages/engine/layer2/CoordSet.cpp:1704-1719`).
- Bond level is read back via `cmd.get_bond` (`packages/engine/modules/pymol/setting.py:449-514`,
  C at `packages/engine/layer3/Executive.cpp:11843`, level gate at `Executive.cpp:11969`).
- `unset_deep` docstring (`packages/engine/modules/pymol/setting.py:519-526`) documents the escape hatch for
  atom-state settings: `alter_state 1, *, del s[728]` (728 = `label_screen_point`).

### A7. Session / defaults lifecycle

- Blacklist for `.pse` persistence — `packages/engine/layer1/Setting.cpp:627-660`: `unused`-level plus
  `antialias_shader, ati_bugs, cache_max, cgo_shader_ub_*, colored_feedback,
  cylinder_shader_ff_workaround, defer_updates, fast_idle, fetch_path, internal_feedback,
  internal_gui, internal_prompt, logging, max_threads, mouse_grid, mouse_scale,
  nb_spheres_use_shader, no_idle, nvidia_bugs, presentation, precomputed_lighting,
  render_as_cylinders, security, session_changed, session_file, …`. Used by `SettingAsPyList`
  (`Setting.cpp:956-975`) and `SettingFromPyList` (`Setting.cpp:1024`).
- `SettingInitGlobal` (`packages/engine/layer1/Setting.cpp`, after line 1180) resets from `SettingInfo`, honours
  `reset_gui` (skips `internal_gui`, `internal_gui_width`), forces `volume_mode=0` in open source,
  and applies command-line overrides (`auto_show_lines/spheres/nonbonded`, `auto_zoom`,
  `presentation`, `defer_builds_mode`, `presentation_auto_quit`, `internal_feedback`, `stereo_mode`).
- `cmd.reinitialize(what)` with `reinit_code` (`packages/engine/modules/pymol/commanding.py:350-356`):
  `everything=0, settings=1, store_defaults=2, original_settings=3, purge_defaults=4`.
  Surfaced in the File menu (`packages/engine/modules/pymol/_gui.py:128-131`).
- `SettingStoreDefault` / `SettingPurgeDefault` / `SettingRestoreDefault`
  (`packages/engine/layer1/Setting.h:161-162`, `packages/engine/layer1/Setting.cpp:1528-1573`).

---

## PART B — THE QT SETTING UI (what becomes React)

### B1. Menu data is toolkit-independent already

`packages/engine/modules/pymol/_gui.py:55-58` `PyMOLDesktopGUI.get_menudata(cmd)` returns a pure nested list; both
the Qt window (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:353-357`) and the Tk skin
(`packages/engine/modules/pmg_tk/skins/normal/__init__.py:1072-1075`) consume it. Item grammar
(`pymol_qt_gui.py:294-343`):

| tuple | meaning |
|---|---|
| `('separator',)` | rule |
| `('menu', label, [items])` | submenu |
| `('command', label, callable-or-command-string)` | string → `cmd.do(str)` |
| `('check', label, setting_name[, true_value, false_value])` | toggle, defaults 1/0 |
| `('radio', label, setting_name, value)` | exclusive group keyed by setting name |
| `('open_recent_menu',)` | dynamic recent-files list |

`SettingAction` (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:1041-1080`) builds a checkable action for types
1,2,3,5,6 (bool, int, float, color, str) and prints `TODO` for float3 (type 4). It writes with
`cmd.set(index, value, log=1, quiet=0)`. Radio items write `cmd.set(name, value, log=1, quiet=0)`
(`pymol_qt_gui.py:328-330`) and group by setting name via `actiongroups` (`pymol_qt_gui.py:321-327`).

### B2. Full enumeration — the `Setting` menu (`packages/engine/modules/pymol/_gui.py:492-773`)

Top of menu (`_gui.py:493-496`):
- **Edit All…** → `settings_edit_all_dialog` (advanced table, B4)
- **Keyboard Shortcuts…** → `shortcut_menu_edit_dialog`
- **Colors…** → `edit_colors_dialog` (B10)
- separator

**Label** (`_gui.py:497-542`)
- *Size* radios on `label_size`: 10/14/18/24/36/48/72 Point; separator; 0.3/0.5/1/2/4 Angstrom (negated values)
- *Font* radios on `label_font_id`: Sans 5, Sans Oblique 6, Sans Bold 7, Sans Bold Oblique 8,
  Serif 9, Serif Oblique 17, Serif Bold 10, Serif Bold Oblique 18, Mono 11, Mono Oblique 12,
  Mono Bold 13, Mono Bold Oblique 14, Gentium Roman 15, Gentium Italic 16
- *Color* radios on `label_color`: Front −6, Back −7
- check **Show Connectors** → `label_connector`
- *Background Color* radios on `label_bg_color`: None −1, Back −7, Front −6

**Lines & Sticks** (`_gui.py:543-580`)
- check **Ball and Stick** → `stick_ball` 1
- *Ball and Stick Ratio* radios `stick_ball_ratio`: 1.0, 1.5, VDW (−1.0)
- *Zero Order Bonds* radios `valence_zero_mode`: Hide 0, Dashed 1, Solid 2
- *Zero Order Stick Scale* radios `valence_zero_scale`: 0.1, 0.2, 0.3, 1.0
- *Stick Radius* radios `stick_radius`: .1, .2, .25
- *Stick Hydrogen Scale* radios `stick_h_scale`: .4, 1.
- *Line Width* radios `line_width`: 1.0, 1.49, 3.0
- check **Lines As Cylinders** → `line_as_cylinders` 1

**Cartoon** (`_gui.py:581-612`)
- *Rings and Bases*: `cartoon_ring_mode` 1/2/3/4/0 (Filled Round / Filled Flat / Filled with Border /
  Spheres / Base Ladders); `cartoon_ring_finder` 1/2/3/4 (Bases and Sugars / Bases Only /
  Non-protein Rings / All Rings); `cartoon_ring_transparency` 0.5 / −1
- checks: **Side Chain Helper** `cartoon_side_chain_helper`, **Round Helices**
  `cartoon_round_helices`, **Fancy Helices** `cartoon_fancy_helices`, **Cylindrical Helices**
  `cartoon_cylindrical_helices`, **Flat Sheets** `cartoon_flat_sheets`, **Fancy Sheets**
  `cartoon_fancy_sheets`, **Smooth Loops** `cartoon_smooth_loops`, **Discrete Colors**
  `cartoon_discrete_colors`, **Highlight Color** `cartoon_highlight_color` on=104 off=−1
- *Sampling* radios `cartoon_sampling`: −1 (Atom count dependent), 2, 7, 14
- *Gap Cutoff* radios `cartoon_gap_cutoff`: 0, 5, 10, 20

**Ribbon** (`_gui.py:613-627`)
- checks `ribbon_side_chain_helper`, `ribbon_trace_atoms`
- radios `ribbon_as_cylinders` 0 (As Lines) / 1 (As Cylinders)
- *Cylinder Radius* radios `ribbon_radius`: 0. (Match Line Width), .2, .5, 1. Angstrom

**Surface** (`_gui.py:628-660`)
- *Color* radios `surface_color`: White 0, Light Gray 4236, Gray 25, Default (Atomic) −1
- radios `surface_type`: Dot 1, Wireframe 2, Solid 0
- radios `surface_cavity_mode`: 1 Cavities and Pockets Only, 2 Culled, 0 Exterior (Normal)
- *Cavity Detection Radius* radios `surface_cavity_radius`: 7 Angstrom; −3,−4,−5,−6,−8,−10,−20 Solvent Radii
- *Cavity Detection Cutoff* radios `surface_cavity_cutoff`: −1..−5 Solvent Radii
- check **Solvent Accessible** `surface_solvent`
- checks **Smooth Edges** `surface_smooth_edges`, **Edge Proximity** `surface_proximity`
- radios `surface_mode`: Ignore None 1, Ignore HETATMs 0, Ignore Hydrogens 2, Ignore Unsurfaced 3

**Volume** (`_gui.py:661-667`)
- check **Pre-integrated Rendering** `volume_mode`
- *Number of Layers* radios `volume_layers`: 100, 256, 500, 1000

**Transparency** (`_gui.py:668-689`)
- four submenus from `transparency_menu()` (`_gui.py:66-71`) on `transparency`,
  `sphere_transparency`, `cartoon_transparency`, `stick_transparency`, each radios
  Off 0.0 / 20% / 40% / 50% / 60% / 80%
- composite commands setting `(transparency_mode, backface_cull, two_sided_lighting)`:
  Uni-Layer (2,1,0), Multi-Layer (1,0,1), Multi-Layer (Real-time OIT) (3,0,−1), Fast and Ugly (0,1,0)
- check **Angle-dependent** `ray_transparency_oblique` 1.0

**Rendering** (`_gui.py:690-742`)
- check **OpenGL 2.0 Shaders** `use_shaders`
- check **Antialias (Ray Tracing)** `antialias`
- *Antialias (Real Time)* radios `antialias_shader`: off 0, FXAA 1, SMAA 2
- command **Modernize** → `cmd.util.modernize_rendering(1, cmd)` (`packages/engine/modules/pymol/util.py:553`)
- *Shadows*: 9 commands → `cmd.util.ray_shadows(v)` (`packages/engine/modules/pymol/util.py:821`) for
  none/light/medium/heavy/black, then matte/soft/occlusion/occlusion2
- *Texture* radios `ray_texture`: None 0, Matte 1 = 1, Matte 2 = 4, Swirl 1 = 2, Swirl 2 = 3, Fiber 5
- *Interior Texture* radios `ray_interior_texture`: same 6 values
- *Memory* radios `hash_max`: 70 / 100 / 170 / 230 / 300
- check **Cull Backfaces** `backface_cull`
- check **Opaque Interiors** `ray_interior_color` on=74 off=−1

**File-loading group** (`_gui.py:743-757`)
- *PDB File Loading*: check `ignore_pdb_segi`
- *mmCIF File Loading*: check `cif_use_auth`; check **Load Assembly** `assembly` on="1" off=""
  (a **string** setting used as a toggle); check **Bonding by CCD** `connect_mode` on=4 off=0
- *Map File Loading*: checks `normalize_ccp4_maps`, `normalize_o_maps`

**Auto-Show …** (`_gui.py:758-768`)
- check **Cartoon/Sticks/Spheres by Classification** `auto_show_classified` on=−1 off=0
- checks `auto_show_lines`, `auto_show_spheres`, `auto_show_nonbonded`
- checks `auto_show_selections`, `auto_hide_selections`

**Tail** (`_gui.py:769-773`)
- check **Auto-Zoom New Objects** `auto_zoom`
- check **Auto-Remove Hydrogens** `auto_remove_hydrogens`
- check **Show Text (Esc)** `text`
- check **Overlay Text** `overlay`

### B3. Settings that also live in the `Display` menu (`packages/engine/modules/pymol/_gui.py:377-491`)

Not in the `Setting` menu but pure setting toggles, so they belong to this area's data model:
`seq_view`; `seq_view_format` (0 Residue Codes, 1 Residue Names, 3 Chain Identifiers, 2 Atom Names,
4 States); `seq_view_label_mode` (2/1/0/3); `seq_view_gap_mode` (0/1/2); `internal_gui`;
`internal_prompt`; `internal_feedback` (0/1/3/5); `overlay` (0/1/3/5); `stereo`;
`opaque_background`; `show_alpha_checker`; `bg_rgb` radios White 0 / Light Grey 134 / Grey 104 /
Black 1; `grid_mode` (By Object 1, By State 2, By Object-State 3, Disable 0); `orthoscopic`;
`valence`; `line_smooth`; `depth_cue`; `two_sided_lighting`; `specular` (1.0); `animation`;
`roving_detail`. Plus command-only entries: `stereo <mode>` (`_gui.py:419-433`),
`space cmyk|pymol|rgb` (`_gui.py:461-465`), `util.performance(100|66|33|0)` (`_gui.py:466-471`).
The `Mouse` menu also carries `mouse_selection_mode` radios 0–6, and checks `virtual_trackball`,
`mouse_grid`, `roving_origin` (`_gui.py:807-832`). `Scene` carries check `scene_buttons`
(`_gui.py:797`).

### B4. Advanced settings table (`packages/engine/modules/pmg_qt/advanced_settings_gui.py`)

`PyMOLAdvancedSettings(QWidget)`, min size 400×500, title "PyMOL Advanced Settings".
- `QLineEdit` placeholder "Filter" wired to `QSortFilterProxyModel.setFilterRegularExpression`
  (lines 25-28) — the filter is a **regex over both columns**.
- `populateData()` (40-67): `sorted(setting.get_name_list())` → 779 rows; per row
  `setting._get_index(name)` then `cmd.get_setting_tuple(index)`.
  - type 1 (bool) → checkable item, not text-editable
  - types 2, 6 (int, str) → `str(v_list[0])`
  - types 3, 4, 5 (float, float3, color) → `cmd.get(index)` i.e. the *text* form
  - name column is read-only (`Qt.ItemIsEnabled` only)
  - setting index stashed in `value_item.setData(index)`
- `formatTable()` (69-80): headers hidden both axes, last column stretches, columns auto-resized.
- `itemChanged` (82-99): checkbox → `cmd.set(index, checked, log=1, quiet=0)`; else
  `cmd.set(index, item.text(), log=1, quiet=0)`.
- **Known gaps to fix in the port:** no level column, no default value, no min/max validation, no
  reset/unset action, no help text, no per-object scope, no live refresh from
  `get_setting_updates` (the table goes stale when a menu changes a setting), and edits are
  swallowed on error because `cmd.set` failures are not surfaced.

Legacy Tk equivalent for reference: `packages/engine/modules/pmg_tk/SetEditor.py` — 15 visible rows scrolled by a
`Scale` widget (`SetEditor.py:23,52`), substring (not regex) filter with Filter/Reset buttons
(`SetEditor.py:74-86,127-147`), Enter-to-commit with rollback on exception
(`SetEditor.py:109-125`).

### B5. Lighting Settings plugin (`packages/engine/data/startup/lightingsettings_gui/main.py`)

A second, curated settings panel shipped as a startup plugin (menu entry registered at
`packages/engine/data/startup/lightingsettings_gui/__init__.py:14-15`). It is the model for "grouped slider panel"
in the web UI.

- `SettingSlider(QSlider)` (main.py:13-61): integer slider mapped onto a float range with
  resolution `res`, paired `QLineEdit`, writes on every `valueChanged` via
  `cmd.set(self.setting, self.getDoubleValue())`, `objectName` = setting name so
  `update_setting()` can find and refresh it (main.py:64-68).
- Presets (main.py:70-139): **Default, Metal, Plastic, Rubber, X-Ray** — each a fixed list of
  `cmd.set` calls over `ambient, direct, spec_direct, spec_direct_power, light_count, shininess,
  reflect, spec_count, spec_power, spec_reflect, specular, specular_intensity,
  ambient_occlusion_mode, ambient_occlusion_scale, ambient_occlusion_smooth, power, reflect_power`.
- Slider layout with section headers (main.py:157-188): *Diffuse Reflection* (`ambient` 0–1,
  `reflect` −1–1); *Direct Light from Front* (`direct` −1–1, `spec_direct` 0–1,
  `spec_direct_power` 0–100 step 1); *Free placeable directed Lights* (`light_count` 1–8,
  `edit_light` 1–7); *Specular Reflection* (`spec_count` −1–8, `shininess` 0–100,
  `spec_reflect` −0.01–1, `specular` 0–1, `specular_intensity` 0–1); *Ambient Occlusion (Surface
  only)* (`ambient_occlusion_mode` 0–2, `ambient_occlusion_scale` 1–50, `ambient_occlusion_smooth`
  1–20); *Ray trace only* (`power` 1–10, `reflect_power` 1–10).
- Note `spec_power` is commented out as deprecated since v1.5 (main.py:174).

---

## PART C — THE COLOR SYSTEM

### C1. The color table: 5388 slots, index layout is load-bearing

`ColorReset` (`packages/engine/layer1/Color.cpp:825-1322`) rebuilds `CColor::Color` from scratch. Registration is
the `reg_named_color(name,R,G,B)` macro (`packages/engine/layer1/Color.cpp:1017-1022`) which appends to the vector
and registers the name in `CColor::Idx` (`packages/engine/layer1/Color.h:85`).

Counted from source: **188 explicitly named colors + 5200 generated = 5388 slots (index 0..5387)**.
Verified layout (this arithmetic is relied upon by the menus, which hardcode indices):

| index range | contents | source |
|---|---|---|
| 0–53 | `white black blue green red cyan yellow dash magenta salmon lime slate hotpink orange chartreuse limegreen purpleblue marine olive purple teal ruby forest deepblue grey gray carbon nitrogen oxygen hydrogen brightorange sulfur tv_red tv_green tv_blue tv_yellow yelloworange tv_orange br0..br9 pink firebrick chocolate brown wheat violet` | `Color.cpp:1024-1075` |
| 54–153 | `grey00`..`grey99` (British) | `Color.cpp:1079-1085` |
| 154 | `lightmagenta` | `Color.cpp:1087` |
| 155–1154 | `s000`..`s999` — full spectrum, magenta→…→magenta, 13 knots, `A_DIV = 83.3333` | `Color.cpp:1089-1108` |
| 1155–2154 | `r000`..`r999` — offset/reversed spectrum | `Color.cpp:1110-1123` |
| 2155–3154 | `c000`..`c999` — complementary spectra | `Color.cpp:1125-1139` |
| 3155–4154 | `w000`..`w999` — complementary separated by white, `W_DIV = 41.6667` | `Color.cpp:1141-1157` |
| 4155 | `density` | `Color.cpp:1159` |
| 4156–4255 | `gray00`..`gray99` (American) | `Color.cpp:1161-1167` |
| 4256–5255 | `o000`..`o999` — original spectrum with extra blue/red ends, `B_DIV = 35.7143` | `Color.cpp:1169-1185` |
| 5256–5280 | `paleyellow aquamarine deepsalmon palegreen deepolive deeppurple deepteal lightblue lightorange palecyan lightteal splitpea raspberry sand smudge violetpurple dirtyviolet _deepsalmon lightpink greencyan limon skyblue bluewhite warmpink darksalmon` | `Color.cpp:1187-1211` |
| 5281–5387 | element colors `helium`..`meitnerium` + `deuterium lonepair pseudoatom` | `Color.cpp:1212-1321` |

Spot checks that confirm the layout: `grey80 = 134` and `grey50 = 104` are hardcoded in the Display
menu (`_gui.py:456-461`); `gray80 = 4236` in the Surface Color menu (`_gui.py:632`);
`lightmagenta = 154`, `deepteal = 5262`, `darksalmon = 5280` in `AutoColor`
(`packages/engine/layer1/Color.cpp:35-75`) and `_color_cycle` (`packages/engine/modules/pymol/util.py:27-70`).

`ColorGetStatus` (`packages/engine/layer1/Color.cpp:784-807`) returns 1 for names with no digits, −1 for names
containing digits, 0 for invalid. `cmd.get_color_indices()` (mode 1) therefore returns exactly the
**178 digit-free names**; `cmd.get_color_indices(all=1)` (mode 2) returns all 5388
(`packages/engine/layer4/Cmd.cpp:1340-1381`).

### C2. Special / encoded color indices

`packages/engine/layer1/Color.h:36-47`:

| constant | value | meaning |
|---|---|---|
| `cColorDefault` | −1 | "default" |
| `cColorNewAuto` | −2 | `auto` — next auto color, `ColorGetNext` (`Color.cpp:140`) |
| `cColorCurAuto` | −3 | `current` — `ColorGetCurrent` (`Color.cpp:156`) |
| `cColorAtomic` | −4 | per-atom color |
| `cColorObject` | −5 | object color |
| `cColorFront` | −6 | contrast-with-background foreground |
| `cColorBack` | −7 | background |
| `cColorExtCutoff` | −10 | indices ≤ −10 are **ramp objects**: `ext = -10 - index` |
| `cColor_TRGB_Bits` | `0x40000000` | inline RGB encoding |
| `cColor_TRGB_Mask` | `0xC0000000` | mask for the above |

`ColorGetIndex` (`packages/engine/layer1/Color.cpp:661-750`) resolution order: all-digit string → literal index or
special; `0x`-prefixed hex → TRGB-encoded inline color (transparency packed into the top 6 bits,
`Color.cpp:704-712`); exact word match for `default/auto/current/atomic/object/front/back`
(`Color.cpp:715-729`, prefix matching was removed in 2.5); exact case-sensitive map hit; then
case-insensitive prefix search over colors and ramps (`Color.cpp:240-298, 736-748`).

`ColorGetName` (`packages/engine/layer1/Color.cpp:759-782`) inverts this, printing `0x%06x`/`0x%08x` for TRGB
indices and ramp names for `index <= -10`. `ColorGetSpecial` (`Color.cpp:1789`) returns tuples with
a **negative R component** to flag special colors — this is what `cmd.get_color_tuple(x, mode=4)`
exposes and what `ramp_new` uses (`packages/engine/modules/pymol/creating.py:472`).
`ColorGetEncoded` (`Color.cpp:1847`) and `Color3fToInt` (`Color.cpp:1883`) do the 0x40RRGGBB
packing used by `spectrumany` (`packages/engine/modules/pymol/viewing.py:2053`: `0x40000000 + r*0x10000 + g*0x100 + b`).

Front/back auto-contrast: `ColorUpdateFront` (`Color.cpp:1754`), `ColorUpdateFrontFromSettings`
(`Color.cpp:1765`), `ColorGetBkrdContColor` (`Color.cpp:81`).

### C3. Python color API

| API | source | notes |
|---|---|---|
| `cmd.get_color_indices(all=0)` | `packages/engine/modules/pymol/querying.py:843-849` | `[(name, index), ...]`; 178 or 5388 entries |
| `cmd.get_color_index(color)` | `querying.py:858-861` | `_cmd.get_color(name, 3)`; −1 when unknown |
| `cmd.get_color_index_from_string_or_list(color)` | `querying.py:851-856` | accepts `"[1,0,0]"` / list → `0xRRGGBB` |
| `cmd.get_color_tuple(name, mode=0)` | `querying.py:825-841` | `(r,g,b)` floats 0–1; mode 4 = signed/special; modes 1,2,3 print deprecation warnings |
| `cmd.get_object_color_index(name)` | `querying.py:819-823` | |
| `cmd.set_object_color(name, color)` | `packages/engine/modules/pymol/editing.py:2866-2874` | |
| `cmd.set_color(name, rgb, mode=0, quiet=1)` | `packages/engine/modules/pymol/viewing.py:2153-2211` | accepts a string that `safe_list_eval`s; auto-detects 0–1 vs 0–255 by "any component > 1.0" (viewing.py:2205-2207); calls `_cmd.colordef` then `_invalidate_color_sc` |
| `cmd.color(color, selection, quiet, flags)` | `viewing.py:1904-1945` | `flags=1` used by `util.cba/cbh` to set object-level color |
| `cmd.color_deep(color, name, quiet)` | `viewing.py:1948-1976` | `unset_deep` over every color setting in `menu.rep_setting_lists`, then `color` |
| `cmd.recolor(selection, representation)` | `viewing.py:1868-1901` | needed after `set_color` |
| `cmd.bg_color(color)` | `viewing.py:1488-1524` | writes `bg_rgb` |
| `cmd.spectrum(...)` | `viewing.py:2065-2151` | C fast path |
| `cmd.spectrumany(...)` | `viewing.py:1978-2063` | pure-Python fallback |
| `cmd.space(space, gamma)` | `packages/engine/modules/pymol/importing.py:227-288` | color LUT |
| `cmd.get_colorection(key)` / `set_colorection(dict,key)` / `del_colorection` | `viewing.py:907-918` | scene color snapshots |
| `cmd.ramp_new / ramp_update` | `packages/engine/modules/pymol/creating.py:374-494` | |
| `cmd.volume_color / get_volume_color / volume_ramp_new / volume_panel` | `packages/engine/modules/pymol/colorramping.py:56-227` | |

Color-name autocompletion/abbreviation is a Python-side `Shortcut` cache:
`_validate_color_sc` builds it lazily from `get_color_indices(all=1)` plus special names
(`packages/engine/modules/pymol/internal.py:575-586`), `_interpret_color` resolves user input
(`internal.py:563-573`), `_invalidate_color_sc` clears it after `set_color`
(`viewing.py:2210`) and `ramp_new` (`creating.py:486`). `cmd.color_sc` is initialized to `None`
(`packages/engine/modules/pymol/cmd.py:382`); completion hooks are at `packages/engine/modules/pymol/completing.py:96,103-104`.

### C4. Palettes and spectrum

`packages/engine/modules/pymol/constants_palette.py:1-89` — `palette_dict`, **57 palettes**, each
`(prefix, digits, first, last)` where prefix ∈ `o|s|r|c|w` selects one of the generated 1000-color
bands and first/last are indices within it. Examples: `rainbow = ('o',3,107,893)`,
`rainbow_cycle = ('o',3,0,999)`, `rainbow2 = ('s',3,167,833)`, `gcbmry = ('r',3,166,999)`,
`blue_white_red = ('w',3,83,167)`, `blue_red = ('c',3,83,167)`.
`palette_sc = Shortcut(palette_dict.keys())` at `packages/engine/modules/pymol/constants.py:223`.

`cmd.spectrum` (`viewing.py:2065-2151`): resolves the palette through `palette_sc`; **falls back to
`spectrumany` when the expression is not purely alphabetic or the palette is not a known name**
(`viewing.py:2137-2140`); otherwise calls `_cmd.spectrum(selection, expression, min, max, first,
last, prefix, digits, byres, quiet)`. `minimum=0, maximum=-1` signals auto-ranging
(`viewing.py:2143-2145`). Returns `(min, max)`.

`cmd.spectrumany` (`viewing.py:1978-2063`): arbitrary color lists, interpolation in
`rgb` (default), `hls`, or `hsv` (`_spectrumany_interpolations`, `viewing.py:1968-1973`);
expression aliases `pc→partial_charge, fc→formal_charge, resi→resv` (viewing.py:2016-2017);
non-numeric values are enumerated (viewing.py:2027-2031); writes packed TRGB colors via
`cmd.alter(... 'color = next_color() or color')` then `recolor`.
`palette_colors_dict` (`viewing.py:39-50`) maps the 10 rainbow-family palette names to explicit
color-name strings for this path.

### C5. Color ramps (ramp objects) and volume ramps

- Ramps are real objects (`object:ramp`) registered as color "extensions":
  `ColorRegisterExt` (`packages/engine/layer1/Color.cpp:347-365`), `ColorForgetExt` (`Color.cpp:367`),
  `ColorRenameExt` (`Color.cpp:1894`). Their color index is `-10 - ext_slot`.
- `ColorCheckRamped` (`Color.cpp:168-171`), `ColorGetRamp` (`Color.cpp:173-187`),
  `ColorGetRamped` (`Color.cpp:189-218`) — a ramped color is evaluated **per vertex**
  (`vertex`, `state`), which is why ramp-colored geometry must be baked server-side before it
  reaches three.js.
- `cmd.ramp_new(name, map_name, range, color, state, selection, beyond, within, sigma, zero, quiet)`
  — `packages/engine/modules/pymol/creating.py:374-490`. `color` may be a list of names/tuples (each resolved with
  `get_color_tuple(a, 4)` so specials survive) or one of the named spectra in `ramp_spectrum_dict`
  (`creating.py:47-57`): `traditional 1, sludge 2, ocean 3, hot 4, grayable 5, rainbow 6,
  afmhot 7, grayscale 8, object [[-1,-1,-1]]`.
- `cmd.ramp_update(name, range, color)` → `ramp_new(name, '', …)` (`creating.py:492-518`).
- Volume ramps are separate: `packages/engine/modules/pymol/colorramping.py:17-54` `namedramps` presets
  **`2fofc, fofc, esp, rainbow, rainbow2`** (built with the `peak()` helper, `colorramping.py:14-15`);
  `volume_ramp_new(name, ramp)` registers more (`colorramping.py:56-84`);
  `volume_color(name, ramp, state)` sets/gets (`colorramping.py:123-181`, C:
  `_cmd.set_volume_ramp` / `_cmd.get_volume_ramp`); `ramp_expand` flattens
  `(v, colorname, a)` or `(v, r, g, b, a)` into flat float lists (`colorramping.py:265-298`);
  `ramp_to_colors` interpolates to N colors (`colorramping.py:231-263`, **note: it uses
  `range(len(ramp) / 5)` — Python-2 division, this function is broken on Python 3**).
- `volume_panel(name)` opens the Qt volume ramp editor `pmg_qt/volume.py`
  (`colorramping.py:183-227`), which itself hosts a `QColorDialog` (`pmg_qt/volume.py:414`).

### C6. Chain / element / secondary-structure coloring

All in `packages/engine/modules/pymol/util.py`:

- `_color_cycle` (util.py:27-70) — 40 color indices, identical to C `AutoColor`
  (`packages/engine/layer1/Color.cpp:35-76`).
- `cbc(selection, first_color=7, quiet, legacy=0)` — "color by chain", iterates
  `cmd.get_chains`, quotes chains containing spaces, uses `_color_cycle[c % 40]` unless
  `legacy=1` (then `first_color + c`) (util.py:771-785). Aliased `color_chains = cbc` (util.py:819).
- `color_objs(selection)` — one color per object; when a real selection is given it also calls
  `set_object_color` (util.py:787-799).
- `chainbow(selection, palette='rainbow')` — per model, per chain, `spectrum('count', palette, …,
  byres=1)` (util.py:809-817).
- `cbss(selection, helix_color='red', sheet_color='yellow', loop_color='green')` — three
  `cmd.color` calls on `ss H`, `ss S`, `not ss S+H` (util.py:432-440).
- Element/carbon family: `color_carbon` (427), `cnc` (512, color `atomic` on non-carbon),
  `cba(color, sel)` (518, atomic on non-C + color on C + `flags=1` object color),
  `cbh(color, sel)` (526, same but hydrogens), and the fixed-carbon shortcuts
  `cbag` (green, 442), `cbac` (cyan, 449), `cbam` (lightmagenta, 456), `cbay` (yellow, 463),
  `cbas` (salmon, 470), `cbaw` (white/hydrogen, 477), `cbab` (slate, 484), `cbao` (brightorange, 491),
  `cbap` (purple, 498), `cbak` (pink, 505).
- `color_by_area(sele, mode='molecular', state=0, palette='rainbow')` (util.py:80-119).
- `util.colors('jmol')` (util.py:1029-1040) — redefines `hydrogen carbon nitrogen oxygen fluorine
  sulfur` to Jmol values, sets `auto_color 0`, then `color carbon, elem C` + `recolor`.
- Deprecated: `util.rainbow` (993, prints deprecation, builds a 11-stop hex list), `util.ss` (1019),
  `util.color_deep` (801, forwards to `cmd.color_deep`).

### C7. The internal-GUI "C" (color) menu — `packages/engine/modules/pymol/menu.py`

Menu items are `[type, label, action]` with type 1 = item/submenu, 2 = title, 0 = separator.
Labels embed inline color escapes `\RGB` with one digit per channel (e.g. `\900` = red).

- `mol_color(sele)` (menu.py:672-686) — root: **by element**, **by chain**, **by ss**, **by rep**,
  **spectrum**, separator, **auto**, separator, then the full color palette from `all_colors`.
- `by_elem` (menu.py:400-418) + `by_elem2..by_elem6` (335-399) — 8 carbon-color choices per page,
  6 pages; page 6 colors hydrogens via `util.cbh`. First entry is `util.cnc` (color non-carbon only).
- `by_chain` (menu.py:464-481) — `util.color_chains` over `elem C` / `*/CA` / all;
  `util.chainbow`; `spectrum('segi','rainbow', …)` for `elem C` and all.
- `by_ss` (menu.py:420-426) — three `util.cbss` presets: red/yellow/green, cyan/magenta/salmon,
  cyan/red/magenta.
- `by_rep` / `by_rep_sub` (menu.py:428-444) — writes the per-rep color **settings** rather than
  atom colors, driven by `rep_setting_lists` (menu.py:482-517):
  - molecule: `line_color, stick_color, ribbon_color, cartoon_color, label_color, dot_color,
    sphere_color, mesh_color, surface_color`
  - measurement: `dash_color, angle_color, dihedral_color, label_color`
  - extra: `cartoon_highlight_color, cartoon_ladder_color, cartoon_nucleic_acid_color,
    cartoon_ring_color, ellipsoid_color, label_outline_color, ray_interior_color, ray_trace_color,
    stick_ball_color`
  Each submenu ends with an **unset** entry (`cmd.unset(setting, sele)`).
- `spectrum` (menu.py:446-462) — rainbow over `elem C`, `*/CA`, `byres`; `b`-factors (all and
  `*/CA`); `util.color_by_area` molecular/solvent.
- `color_auto` (menu.py:659-670) — `color auto` on `elem C` / all; `util.color_objs` on `elem C` / all.
- `all_colors_list` (menu.py:519-618) — the curated swatch palette, **9 groups**:
  reds (11), greens (10), blues (9), yellows (7), magentas (10), cyans (7), oranges (7), tints (8),
  grays (11) — each entry a `(3-digit swatch, color name)` pair.
- `all_colors_generic(expr)` (menu.py:625-636) renders those groups and appends a **ramps** submenu
  built from `colorramps` (menu.py:620-623), which lists live `object:ramp` names cached by the
  `menucontext` singleton (menu.py:24-46).
- `all_colors(sele)` (menu.py:638-641) binds the expression to
  `cmd.color_deep("{0}", <sele>, 0)`.
- `vol_color` (menu.py:643-653) — "panel" entry + one item per name in
  `colorramping.namedramps`.
- `slice_color` (menu.py:655-657), `mesh_color` (menu.py:696-709, adds negative-color submenu
  driving `<rep>_negative_visible` / `<rep>_negative_color`), `measurement_color` (687-694),
  `general_color` (711-712).

### C8. Color editor dialogs

**Qt** — `PyMOLQtGUI.edit_colors_dialog` (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:547-611`) using
`packages/engine/modules/pmg_qt/forms/colors.ui`. Widgets: `list_colors` (QListWidget, sorting enabled,
populated from `cmd.get_color_indices()` — so only the 178 digit-free colors), `frame_color`
(live swatch via stylesheet), `input_name` (QLineEdit), `input_R/G/B` (QDoubleSpinBox, max 1.0,
step 0.01), `slider_R/G/B` (QSlider 0–100), `button_apply`. Wiring: list selection → name field →
`load_color()` which does `get_color_index` then `get_color_tuple`; spinbox↔slider two-way with a
re-entrancy lock; Apply runs `cmd.do('set_color %s, [%.2f, %.2f, %.2f]\nrecolor')` and inserts new
names into the list.

**Tk (legacy)** — `packages/engine/modules/pmg_tk/ColorEditor.py`: `ColorEditor` (81-138) is a
`Pmw.SelectionDialog` (500×400) with buttons New/Edit/Done over `cmd.get_color_indices()`;
`ColorEdit` (60-79) opens the native `tkColorChooser` and emits `set_color` + `recolor`;
`NewColor` (25-58) prompts for a name first.

### C9. Color LUT / color space

`cmd.space(space, gamma)` (`packages/engine/modules/pymol/importing.py:227-288`) maps through
`constants.space_dict` (`packages/engine/modules/pymol/constants.py:141-148`):
`cmyk → $PYMOL_DATA/pymol/cmyk.png`, `pymol → 'pymol'`, `rgb → 'rgb'`, `greyscale → 'greyscale'`,
then `_cmd.load_color_table(filename, gamma, quiet)` → `ColorTableLoad`
(`packages/engine/layer1/Color.cpp:1324-…`). `'rgb'` purges the table; `'greyscale'` and `'pymol'` synthesize a
512×512 LUT (the `pymol` space is parameterized by settings `pymol_space_max_red/green/blue` and
`pymol_space_min_factor`, `Color.cpp:1404-1408`); anything else is loaded as a PNG.
`ColorUpdateFromLut` (`Color.cpp:1680`) and `ColorLookupColor` (`Color.cpp:1721`) apply it.
`ColorRec::LutColor/LutColorFlag` (`packages/engine/layer1/Color.h:58-59`) hold the mapped value, so
**`get_color_tuple` returns the LUT-mapped color, not the raw definition** — the web client must
re-fetch the whole palette after `space`.

---

## PART D — REACT / BRIDGE MODEL

### D1. One introspection RPC drives both UIs

The curated menu and the advanced table must be fed by the same catalogue. Nothing in the current
Python layer returns level/default/min/max, so the bridge has to assemble it:

```python
# bridge-side, built once at startup
def settings_catalogue():
    out = []
    for name, index in cmd.setting.index_dict.items():       # setting.py:39
        if name == 'ray_shadows':                            # setting.py:48 legacy alias
            continue
        t = cmd._cmd.get_setting_type(index)                 # Cmd.cpp:4394
        level = cmd._cmd.get_setting_level(index)            # Cmd.cpp:4403  (str)
        out.append({'name': name, 'index': index, 'type': t, 'level': level})
    return out
```

`get_setting_level` returns the level **name** (`"global"`, `"object"`, `"object-state"`, `"atom"`,
`"atom-state"`, `"bond"`, `"bond-state"`). Defaults, min/max and help text are **not** reachable
from Python at all — `SettingInfo` is `static` in `Setting.cpp` and nothing exports it. Three ways
out were considered: a new C accessor beside `CmdGetSettingLevel`
(`packages/engine/layer4/Cmd.cpp:4403`); snapshotting defaults by calling
`cmd.reinitialize('original_settings')` in a scratch instance; or reading the header that generates
the table. The third shipped: `packages/bridge/tenmol_bridge/panels/settings.py` parses
`packages/engine/layer1/SettingInfo.h` for defaults and min/max and
`packages/engine/data/setting_help.csv` for help text, and reports `defaultsSource: null` when
neither is readable rather than inventing values. No C accessor was added.

Wire schema (bridge → client, sent once, cached in a React context):

```ts
type SettingType = 0|1|2|3|4|5|6;      // blank|bool|int|float|float3|color|string
type SettingLevel = 'global'|'object'|'object-state'|'atom'|'atom-state'|'bond'|'bond-state';
interface SettingMeta {
  name: string; index: number; type: SettingType; level: SettingLevel;
  default?: number|number[]|string; min?: number; max?: number; help?: string;
}
```

### D2. Value RPCs

| bridge method | maps to | notes |
|---|---|---|
| `settings.catalogue()` | above | once per session |
| `settings.getMany(indices, object='', state=0)` | `cmd.get_setting_tuple(i, object, state)` (`setting.py:413`) | batch; returns `(type, value)` |
| `settings.getText(index, object, state)` | `cmd.get(index, object, state)` (`setting.py:353`) | for float/float3/color display |
| `settings.set(index, value, selection='', state=0)` | `cmd.set(..., log=1, quiet=0)` (`setting.py:185`) | keep `log=1` so the command log matches desktop PyMOL |
| `settings.setBond(index, value, sel1, sel2, state)` | `cmd.set_bond` (`setting.py:116`) | |
| `settings.unset(index, selection='', state=0)` | `cmd.unset` (`setting.py:273`) | restores default (2.5 semantics) |
| `settings.unsetDeep(names, object)` | `cmd.unset_deep` (`setting.py:516`) | |
| `settings.getBond(index, sel1, sel2, state)` | `cmd.get_bond` (`setting.py:449`) | |
| `settings.atomOverrides(selection)` | `cmd.iterate(sel, 'r.append((model, index, list(s)))')` (`packages/engine/layer1/P.cpp:581`) | returns defined per-atom indices |
| `colors.list(all=false)` | `cmd.get_color_indices` (`querying.py:843`) | 178 / 5388 |
| `colors.tuple(nameOrIndex, mode=0)` | `cmd.get_color_tuple` (`querying.py:825`) | mode 4 for specials |
| `colors.index(name)` | `cmd.get_color_index` (`querying.py:858`) | |
| `colors.define(name, rgb)` | `cmd.set_color` + `cmd.recolor` (`viewing.py:2153`, `1868`) | |
| `colors.apply(color, selection, deep)` | `cmd.color` / `cmd.color_deep` (`viewing.py:1904`, `1948`) | |
| `colors.spectrum(expr, palette, sel, min, max, byres, interpolation)` | `cmd.spectrum` (`viewing.py:2065`) | |
| `colors.palettes()` | `constants_palette.palette_dict` keys (57) | static |
| `colors.ramps()` | `[n for n in cmd.get_names() if cmd.get_type(n)=='object:ramp']` (`menu.py:35`) | |
| `colors.rampNew/rampUpdate` | `cmd.ramp_new/ramp_update` (`creating.py:374/492`) | |
| `colors.volumeRamps()` / `colors.volumeColor(obj, ramp)` | `colorramping.namedramps`, `cmd.volume_color` (`colorramping.py:17/123`) | |
| `colors.space(space, gamma)` | `cmd.space` (`importing.py:227`) | client must invalidate its whole palette cache afterwards |

### D3. Change propagation

Exactly one component calls `cmd.get_setting_updates()` (`setting.py:440`): the bridge's status
thread (`packages/bridge/tenmol_bridge/pump.py`). Because the read clears the flags, a second
caller would silently steal updates. `panels/settings.py::install` therefore does not call it — it
*wraps* it with a pass-through that records what the status thread received, and the client reads
that recording through a cursor. Two delivery channels, one cursor: the `settings` topic pushes
within one status interval, and the 5 Hz poll is an idempotent backstop that cannot lose an index
the push missed. This mirrors the Qt design (`pymol_qt_gui.py:952-956`) without a second drain.

The no-argument call is the only one recorded. `get_setting_updates(name, state)` targets one
object's state-level `CSetting` — a different channel the status thread does not poll.

Colours have **no change feed** at all: `set_color`, `ramp_new`, `space` and session loads mutate
the palette silently. The palette is therefore re-fetched after any of
`set_color \| ramp_new \| ramp_update \| space \| load \| reinitialize \| set_session`, mirroring the
`_invalidate_color_sc` invalidation points (`internal.py:584`, `viewing.py:2210`, `creating.py:486`).

### D4. Component inventory

| component | replaces | contract |
|---|---|---|
| `<SettingsProvider>` | `pmg_tk/Setting.py` var syncing | holds `SettingMeta[]` + value cache keyed `${index}\|${object}\|${state}`, subscribes to `settings.changed` |
| `useSetting(name, {object, state})` | `PymolVar` (`pmg_tk/Setting.py:28`) | `[value, setValue, {meta, isDefault, unset}]` |
| `<SettingMenu>` | `Setting` menu (`_gui.py:492-773`) | renders the declarative tree; `check` → checkbox item with `trueValue/falseValue`, `radio` → radio group keyed by setting name |
| `<MenuDataRenderer>` | `_addmenu` (`pymol_qt_gui.py:294-343`) | one generic renderer for `separator/menu/command/check/radio/open_recent_menu` — reuse for Display/Mouse/Scene menus too |
| `<AdvancedSettingsTable>` | `advanced_settings_gui.py` | virtualized 779-row table; columns Name, Value, Level, Default, Scope; regex + fuzzy filter; per-type editors; Reset (→ `unset`) per row |
| `<SettingEditor type=…>` | `advanced_settings_gui.populateData` type switch | bool→Switch, int→NumberInput (clamp when min/max known), float→NumberInput/Slider, float3→3 NumberInputs (fixes the Qt `TODO` at `pymol_qt_gui.py:1077`), color→`<ColorPicker>`, string→TextInput |
| `<ScopeSelector>` | nothing (new) | global / object / object-state / atom-selection, gated on `SettingMeta.level` mask (`Setting.cpp:64-74`) |
| `<LightingPanel>` | `packages/engine/data/startup/lightingsettings_gui/main.py` | grouped sliders + 5 presets |
| `<ColorPicker>` | `forms/colors.ui` + `edit_colors_dialog` | 178-name list, RGB sliders+spinboxes, swatch, name field, Apply → `set_color`+`recolor`; must also accept `-1..-7` specials, `0xRRGGBB`, and ramp names |
| `<ColorMenu>` | `menu.mol_color` tree (`menu.py:672`) | swatch grid from `all_colors_list` (9 groups) + by element/chain/ss/rep/spectrum/auto + live ramps |
| `<PalettePicker>` | `palette_dict` | 57 palettes, previewed by sampling `get_color_tuple` along the band |
| `<RampEditor>` | `pmg_qt/volume.py` ramp widget | stop list (value, color, alpha), maps to `volume_color` / `ramp_new` |

### D5. Client-side color evaluation

The three.js layer needs an RGB for every color index it is handed. Ship the whole 5388-entry table
once (name → index → rgb) after `colors.list(all=1)` + batched `get_color_tuple`, ~5388 × 3 floats
≈ 65 KB — cheap. But:

- specials −1..−7 must be resolved by the backend, not the client (`ColorGetSpecial`,
  `Color.cpp:1789`; front/back depend on `bg_rgb`, `Color.cpp:1754-1788`);
- `0x40RRGGBB`-encoded colors decode client-side (`Color.cpp:1847`, `viewing.py:2053`);
- ramp colors (`index <= -10`) are **position-dependent** (`ColorGetRamped`, `Color.cpp:189`) and
  must be baked into vertex colors server-side;
- `space` rewrites the whole table through the LUT (`Color.cpp:1680`) — full re-fetch required.

---

## Constraints this area lives under

1. `cmd.get_setting_updates()` clears the `changed` flags as it reads (`packages/engine/layer1/Setting.cpp:1128-1132`).
   Two pollers = lost updates. The bridge must be the only caller, and any surviving Qt window must
   be disabled.
2. Defaults, min/max and help text are **not exposed to Python** anywhere
   (`SettingInfo` is `static` in `Setting.cpp`; `packages/engine/data/setting_help.csv` has zero consumers). Without
   a new accessor or a build-time extraction, the advanced table cannot show "default" or validate ranges.
3. `get_setting_level` exists in C (`packages/engine/layer4/Cmd.cpp:4403`) but has no Python wrapper — must be
   called as `cmd._cmd.get_setting_level(i)`, which is undocumented/private and could change.
4. Setting indices are session-file ABI (`packages/engine/layer1/SettingInfo.h:5-6`). Any cached client-side
   catalogue keyed by index is safe across versions only if new settings are appended, never renumbered.
5. Wrong-level writes are silently accepted with only a console warning
   (`packages/engine/layer3/Executive.cpp:12279-12286`). The web UI must gate by level client-side or users will see
   "it saved but nothing happened".
6. Float min/max declared in the table are never enforced (`Setting.cpp:1890` checks
   `type == cSetting_int` only). Client-side validation is the only guard.
7. Menu items hardcode color **indices** (134, 104, 4236, 74, 104…) computed from the generated
   color-table layout (`_gui.py:456-461,632,741`). If a user runs `set_color` on a generated name or
   `space` changes the LUT, those labels lie. The web UI should resolve label→index at render time.
8. `set_color` auto-detects the 0–1 vs 0–255 range by "any component > 1.0" (`viewing.py:2205-2207`).
   A legitimate `[1, 0, 0]` in 0–255 space becomes red-in-0–1. Web pickers must always send 0–1 floats.
9. There is no event when colors change. Anything that calls `set_color`, `ramp_new`, `space`,
   `load` or `reinitialize` desynchronizes the client palette.
10. `colorramping.ramp_to_colors` uses Python-2 integer division (`colorramping.py:243`) and will
    raise on Python 3 — do not port it, reimplement in TS.
11. Color name lookup falls back to **case-insensitive prefix matching** in C
    (`packages/engine/layer1/Color.cpp:736-748`), which the source itself questions ("TODO does this even make
    sense?"). Two different lookup policies exist (C prefix match vs Python `Shortcut` in
    `internal.py:566`); the web client should send exact names to avoid divergence.
12. `advanced_settings_gui` writes with `cmd.set(index, text)`; a bad value raises inside PyMOL and
    the table keeps showing the new text. Any port must round-trip the value back from the backend.
13. `SettingGenerateSideEffects` can invalidate reps and force geometry rebuilds
    (`packages/engine/layer1/Setting.cpp:1872+`). Setting changes are not cosmetic — the three.js scene may need a
    fresh geometry payload after almost any `set`.
14. 179 settings are `atom`/`atom-state`/`bond`/`bond-state`/`object`-level and are **invisible to
    the current advanced table**, which only reads globals. Feature parity with the desktop C menu
    (`menu.rep_setting_lists`) requires per-object/per-selection scope.

## Decisions this map fed

- **No C accessor for `SettingInfo` default/min/max.** The header is parsed instead
  (`packages/bridge/tenmol_bridge/panels/settings.py`); see D1.
- **`packages/engine/data/setting_help.csv` (875 rows, zero upstream consumers) is the tooltip
  source.** Row count does not equal setting count, so entries are matched by name and a missing
  row yields no tooltip rather than a wrong one.
- **Menu writes keep `log=1, quiet=0`** so the browser's command log mirrors desktop PyMOL's
  `.pml` log.
- **Per-object and per-selection scope is offered wherever the level allows it**
  (`apps/web/src/features/settings/atomSettings.ts`), because 179 settings are
  atom/atom-state/bond/bond-state/object level and the Qt advanced table only ever read globals
  (constraint 14).
- **The generated bands (`s000…`, `r`, `c`, `w`, `o`) sit behind an "advanced" toggle**, not in
  the default palette: `apps/web/src/features/colors/SwatchGrid.tsx` is
  `pymol.menu.all_colors_list` (80 tiles) and `BandGrid.tsx` pages through the remaining 5388
  slots. They cannot be dropped — `spectrum`, `ramp_new` and the `constants_palette` palettes are
  expressed in those names.
- **`atomic`/`object`/`front`/`back` are guarded on `index < 0`, not `index == -1`.** They resolve
  to -4/-5/-6/-7 and `cmd.get_color_tuple` returns `None` for all of them
  (`packages/engine/layer4/Cmd.cpp:1336`); the Qt dialog tests only -1
  (`pymol_qt_gui.py:558`) and raises `TypeError` on the others.
