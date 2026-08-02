# Internal GUI (the panels PyMOL draws inside the viewport)

Scope: everything PyMOL draws **itself inside the OpenGL viewport** as 2D "Blocks" —
the right-hand object panel ("names list"), its A/S/H/L/C/M popup menus, the mouse-mode
block, the movie/frame control bar, the movie timeline panel, the in-scene scene bar,
the wizard panel, the in-viewport command prompt + feedback scrollback, the popup-menu
engine itself, the busy/progress box and the splash.

Read-only source analysis of `packages/engine/`, which is unmodified upstream. All line
references were opened and read.

**Where the port stands.** The internal GUI is turned off in the engine (`internal_gui 0`,
`internal_feedback 0` at bridge boot) and rebuilt as components: object panel
`apps/web/src/features/objects/`, popup menus `apps/web/src/features/pymol-menu/`, mouse-mode
block `apps/web/src/features/mouse/ButModeBlock.tsx`, transport + timeline
`apps/web/src/features/movie/`, scene bar `apps/web/src/features/scenes/`, wizard block
`apps/web/src/features/wizards/`, prompt + scrollback + busy overlay
`apps/web/src/features/console/`. The layout of §0 is reproduced in
`apps/web/src/shell/orthoPanel.ts` and `apps/web/src/shell/extGuiDock.ts`.

---

## 0. Layout model

`OrthoLayoutPanel()` — `packages/engine/layer1/Ortho.cpp:2261-2340` — stacks the internal-GUI blocks in a
right-hand column, bottom-up:

| Block | Height | Source |
|---|---|---|
| Control (movie buttons) | `DIP2PIXEL(20)` | `packages/engine/layer1/Ortho.cpp:2267`, `packages/engine/layer1/Ortho.cpp:2296-2299` |
| ButMode (mouse mode) | `ButModeGetHeight()` = `DIP2PIXEL(124)` if `mouse_grid` else `DIP2PIXEL(40)` | `packages/engine/layer1/ButMode.cpp:72-77` |
| Wizard | `internal_gui_control_size * NLine + 4`, 0 if no wizard | `packages/engine/layer1/Wizard.cpp:254-259` |
| Executive (object panel) | everything above, to the top of the window | `packages/engine/layer1/Ortho.cpp:2280-2284` |

Column width = `internal_gui_width` (default `cOrthoRightSceneMargin` = `DIP2PIXEL(220)`,
`packages/engine/layer1/SettingInfo.h:182`, `packages/engine/layer1/Ortho.h:24`). The whole column is suppressed when
`internal_gui` = 0 (`packages/engine/layer1/Ortho.cpp:2286-2312`, `packages/engine/layer1/SettingInfo.h:183`).

`OrthoReshape()` — `packages/engine/layer1/Ortho.cpp:2340-2463` — additionally computes:
* `textBottom = MovieGetPanelHeight(G)` (movie timeline height) — `packages/engine/layer1/Ortho.cpp:2385-2386`
* `sceneBottom = textBottom + (internal_feedback-1)*cOrthoLineHeight + cOrthoBottomSceneMargin`
  when `internal_feedback` is set — `packages/engine/layer1/Ortho.cpp:2388-2393`
* sequence viewer above or below the scene depending on `seq_view_location` /
  `seq_view_overlay` — `packages/engine/layer1/Ortho.cpp:2413-2442`
* `cOrthoLineHeight = DIP2PIXEL(12)`, `cOrthoCharWidth = DIP2PIXEL(8)`,
  `cOrthoLeftMargin = DIP2PIXEL(3)`, `cOrthoBottomMargin = DIP2PIXEL(5)` —
  `packages/engine/layer1/Ortho.h:26`, `packages/engine/layer1/Ortho.cpp:62-64`

`internal_gui_mode` (`packages/engine/layer1/SettingInfo.h:436`, enum `packages/engine/layer0/PyMOLEnums.h:33-38`):
`Default` (0, opaque panel reserves screen space), `BG` (1), `Transparent` (2, panel floats
over the scene and does not reserve space — `packages/engine/layer1/Ortho.cpp:2400-2405`).

Mouse-event routing: `OrthoButton()` — `packages/engine/layer1/Ortho.cpp:2493-2563` — finds the topmost
Block at (x,y) (`COrtho::findBlock`, `packages/engine/layer1/Ortho.cpp:2980-2991`), honours a "grab"
(`OrthoGrab`/`OrthoUngrab`, `packages/engine/layer1/Ortho.cpp:1191-1221`), and dispatches
`click`/`drag`/`release`. `OrthoDrag()` — `packages/engine/layer1/Ortho.cpp:2575-2607`.
Modifier bit masks: `cOrthoSHIFT 1`, `cOrthoCTRL 2`, `cOrthoALT 4` — `packages/engine/layer1/Ortho.h:20-22`.

---

## 1. Object panel ("names list", the Executive block)

Implementation: `CExecutive::draw` `packages/engine/layer3/Executive.cpp:16167-16559`,
`CExecutive::click` `packages/engine/layer3/Executive.cpp:14994-15424`,
`CExecutive::drag` `packages/engine/layer3/Executive.cpp:15661-16013`,
`CExecutive::release` `packages/engine/layer3/Executive.cpp:15560-15658`,
`CExecutive::reshape` `packages/engine/layer3/Executive.cpp:16593-16602`.

### 1.1 Row model

Rows come from `CExecutive::Panel`, a `std::vector<PanelRec>`
(`packages/engine/layer3/ExecutiveDef.h:20-31`, `packages/engine/layer3/ExecutiveDef.h:79`) rebuilt by
`ExecutiveUpdatePanelList()` `packages/engine/layer3/Executive.cpp:1565-1577`. Each `PanelRec` carries
`spec` (the `SpecRec`), `nest_level`, `is_group`, `is_open`.

`SpecRec` (`packages/engine/layer3/SpecRec.h:9-37`) fields that drive the row:
* `type` — `cExecAll` (the synthetic "all" row), `cExecObject`, `cExecSelection`
* `name`, `obj`, `visible` ("enabled", not "visible"), `group_name`, `group`
* `hilight` — 0 none, 1 name button pressed, 2 group +/- pressed
* `sele_color`, `in_scene`, `in_panel`, `grid_slot`

Row height = `internal_gui_control_size` px (default 18, `packages/engine/layer1/SettingInfo.h:411`);
`ExecLineHeight` is read per draw at `packages/engine/layer3/Executive.cpp:16192-16193`.

### 1.2 What a row draws (left→right)

1. **Scroll bar** on the far left when `n_ent > n_disp`
   (`packages/engine/layer3/Executive.cpp:16222-16255`, `16266-16272`); width
   `ExecScrollBarWidth = DIP2PIXEL(13)`, margin `DIP2PIXEL(1)` — `packages/engine/layer3/Executive.cpp:6090-6091`.
2. **Group open/close button** `[+]` / `[-]`, `DIP2PIXEL(15)` wide, only when
   `panel->is_group` — `packages/engine/layer3/Executive.cpp:16411-16437`. `-` when open, `+` when closed.
3. **Indent** `nest_level * DIP2PIXEL(8)` — `packages/engine/layer3/Executive.cpp:16399`.
4. **Name button** (a 3D-bevel rect, `draw_button()` `packages/engine/layer3/Executive.cpp:16015-16098`).
   Fill colour:
   * pressed / hovered: `pressedColor {0.7,0.7,0.7}`
   * enabled (and all ancestor groups enabled): `enabledColor {0.5,0.5,0.5}`
   * enabled but an ancestor group is disabled: `cloakedColor {0.35,0.35,0.35}`
   * disabled: `disabledColor {0.25,0.25,0.25}`
   — `packages/engine/layer3/Executive.cpp:16173-16176`, `16439-16461`.
5. **Name text**. Selections are wrapped in `(` `)`. If the name is prefixed by its group
   name and `group_full_member_names`=0 (`packages/engine/layer3/Executive.cpp:16196`), the prefix
   is stripped; with `group_arrow_prefix`=1 (`:16197`) a `^|` glyph is drawn instead. Text colour
   from `getNameColor()` `packages/engine/layer3/Executive.cpp:16117-16164` driven by
   `internal_gui_name_color_mode` (0 default text colour, 1 first carbon atom colour,
   2 object colour; falls back to default if within 0.1 of the button colour).
6. **Caption** in `captionColor {0.3,0.9,0.3}` (`packages/engine/layer3/Executive.cpp:16179`) after the
   name, for objects only — drawn at `:16532-16545`. Content from `CObject::getCaption()`; only
   `ObjectMolecule` implements it (`packages/engine/layer2/ObjectMolecule.cpp:386-460`,
   base returns nullptr `packages/engine/layer1/PyMOLObject.h:135`) producing
   `"<coordset name> <colorcode><state>/<nstates>"`, colour-coded `\789` when the object
   has a frozen `state` setting and `\993` when discrete, controlled by
   `state_counter_mode`.
7. **A S H L C (M) toggle buttons** on the right, each `ExecToggleWidth = DIP2PIXEL(17)`
   wide, `ExecToggleSize = DIP2PIXEL(16)` — `packages/engine/layer3/Executive.cpp:3280-3281`,
   drawn at `packages/engine/layer3/Executive.cpp:16312-16390`. Button count is `get_op_cnt()`:
   **5 normally, 6 (adds "M") when `button_mode_name == "3-Button Motions"`** —
   `packages/engine/layer3/Executive.cpp:1757-1764`.
   Per-button fills: A `{0.5,0.5,1.0}`, S `{0.6,0.6,0.8}`, H `{0.4,0.4,0.6}`,
   L `{0.5,0.5,1.0}`, C = rainbow gradient (nullptr `inside` → 4-colour quad,
   `packages/engine/layer3/Executive.cpp:16074-16090`), M = colour by motion "spec level"
   (0→`{0.4,0.4,0.6}`, 1→`{0.6,0.6,0.8}`, 2→`activeColor {0.9,0.9,1.0}`, `:16182`) —
   `packages/engine/layer3/Executive.cpp:16369-16390`.
   These buttons are compiled out entirely under `_PYMOL_NOPY`
   (`packages/engine/layer3/Executive.cpp:16306`) because they call Python for their menus.

Panel background/edge and the 1px separator line at `Width - internal_gui_width`:
`OrthoDrawInternalGUIBG()` `packages/engine/layer1/Ortho.cpp:1561-1584`.

### 1.3 Click semantics on the toggle buttons

`CExecutive::click` `packages/engine/layer3/Executive.cpp:14994-15424`. The hit column index
`t = (rect.right - x - 1) / ExecToggleWidth`, then `t = op_cnt - t - 1`, giving
0=A, 1=S, 2=H, 3=L, 4=C, 5=M. Each dispatches `MenuActivate*` with a Python menu-builder
name from `packages/engine/modules/pymol/menu.py` and the row's object/selection name (`namesele`):

| Btn | Row type / object type | Menu function called |
|---|---|---|
| A | `cExecAll` | `all_action` (`Executive.cpp:15070`) |
| A | selection | `sele_action` (`:15073`) |
| A | group | `group_action` (`:15079`) |
| A | molecule | `mol_action` (`:15083`) |
| A | map | `map_action` (`:15087`) |
| A | surface | `surface_action` (`:15091`) |
| A | mesh | `mesh_action` (`:15095`) |
| A | measurement / CGO / callback / alignment / volume | `simple_action` (`:15103`) |
| A | slice | `slice_action` (`:15107`) |
| A | gadget (ramp) | `ramp_action` (`:15111`) |
| S | all | `mol_show` with `"all"` (`:15120`) |
| S | selection, group, molecule | `mol_show` (`:15123`, `:15129`) |
| S | CGO / alignment | `cgo_show` (`:15133`) |
| S | measurement | `measurement_show` (`:15137`) |
| S | map | `map_show` (`:15140`) |
| S | mesh | `mesh_show` (`:15143`) |
| S | surface | `surface_show` (`:15147`) |
| S | slice | `slice_show` (`:15151`) |
| S | volume | `volume_show` (`:15155`) |
| H | (mirror of S) | `mol_hide`/`cgo_hide`/`measurement_hide`/`map_hide`/`mesh_hide`/`surface_hide`/`slice_hide`/`volume_hide` (`:15164-15198`) |
| L | all | `mol_labels` with `"(all)"` (`:15208`) |
| L | selection, group, molecule | `mol_labels` (`:15211`, `:15218`) |
| L | measurement / map / surface / mesh / slice | **no menu** (empty cases, `:15220-15227`) |
| C | all, selection, group, molecule | `mol_color` (`:15235`, `:15241`) |
| C | map / CGO / alignment | `general_color` (`:15247`) |
| C | mesh | `mesh_color` (`:15251`) |
| C | surface | `mesh_color` with 2nd arg `"surface"` (`:15254`) |
| C | measurement | `measurement_color` (`:15259`) |
| C | slice | `slice_color` (`:15263`) |
| C | volume | `vol_color` (`:15266`) |
| C | gadget | `ramp_color` (`:15270`) |
| M | all | `camera_motion` (0 args) (`:15279`) |
| M | selection | nothing (`:15281`) |
| M | group/molecule/measurement/map/surface/CGO/mesh | `obj_motion` (`:15294`) |

`MenuActivate*` (`packages/engine/layer4/Menu.cpp:29-124`) calls `pymol.menu.<name>(cmd, *args)` and feeds
the returned list to `PopUpNew`.

### 1.4 Click semantics on the name / group control

`packages/engine/layer3/Executive.cpp:15300-15412`:
* Hit test: "on the name" when `(xx-1)/DIP2PIXEL(8) > nest_level` (`> nest_level+1` for
  groups); otherwise "on the group control".
* **Left button on name** → `DragMode=Visibility`, `ToggleMode=DeferVisibility`
  (toggle is applied on release). Modifier variants:
  * `Shift+Ctrl` → `HoverActivate` + zoom-on-hover; immediately enables the row and
    `ExecutiveWindowZoom` (`:15323-15334`)
  * `Shift` → `ImmediateVisibility`, toggles at once (`:15336-15337`)
  * `Ctrl` → `HoverActivate` (enable-only, exclusive-ish) (`:15338-15344`)
* **Middle button on name** → `DragMode=VisibilityWithCamera`:
  * plain → `CenterActivateDeactivatePrevious`, runs `ExecutiveCenter` (`:15376`)
  * `Ctrl` → `ZoomActivateDeactivatePrevious`, runs `ExecutiveWindowZoom` (`:15362`)
  * `Ctrl+Shift` → `ZoomExclusiveActivate`: `ExecutiveSetObjVisib("all", false)` then
    enable only this row (`:15368`)
* **Right button on name** → `DragMode=Reorder` (drag to reorder / re-group) (`:15392`).
* **Left on group `[+]/[-]`** → `hilight=2`, `PressedWhat=2`; on release logs
  `cmd.group("<name>",action='open'|'close')` and calls `ExecutiveGroup(...,5,1)` —
  `packages/engine/layer3/Executive.cpp:15620-15627`.
* **Mouse wheel** anywhere in the panel scrolls the list by ±1 row —
  `packages/engine/layer3/Executive.cpp:15017-15023`.
* When `internal_gui_mode != Default` and `y < HowFarDown` (below the last row), the click
  is forwarded to the Scene block — `packages/engine/layer3/Executive.cpp:15010-15014`.

Drag-visibility band-select: dragging vertically toggles every row between `Pressed` and
`Over` (`packages/engine/layer3/Executive.cpp:15727-15809`). Reorder drag emits
`cmd.order("<a> <b>", location="upper"|"current")` and/or `group <parent>, <child>` /
`ungroup <child>` — `packages/engine/layer3/Executive.cpp:15928-15960`.

Release path: `ExecutiveSpecSetVisibility()` `packages/engine/layer3/Executive.cpp:15474-15541` is the
single mutation point; it logs `cmd.enable('x')` / `cmd.disable('x')` /
`cmd.enable('all')` / `cmd.disable('all')`, respects `active_selections` (hides other
selections when one is enabled) and calls `SceneObjectAdd/Del`.

### 1.5 Panel-level behaviours

* `hide_underscore_names` (default 1, `packages/engine/layer1/SettingInfo.h:558`) hides `_`-prefixed recs.
* `ExecutiveManageObject` sets `visible=1` for new objects except maps (`visible=0`) —
  `packages/engine/layer3/Executive.cpp:14885-14894`.
* `auto_hide_selections` / `auto_show_selections` (defaults 1/1,
  `packages/engine/layer1/SettingInfo.h:162-163`) — `packages/engine/layer3/Executive.cpp:14841`, `14982-14986`.
* `group_auto_mode` auto-creates/attaches groups from dotted names —
  `ExecutiveDoAutoGroup` `packages/engine/layer3/Executive.cpp:14766-14811`.

---

## 2. The popup menus (contents)

Menu data model: a Python list of `[code, text, command]`
(`packages/engine/layer4/PopUp.cpp:226-249`), where `code` is
**0 = separator bar**, **1 = clickable item**, **2 = non-clickable title/label**
(`packages/engine/layer4/PopUp.cpp:270-300`, drawn `packages/engine/layer4/PopUp.cpp:865-880`). `command` is either a
Python source string (executed by `PParse` on release, `packages/engine/layer4/PopUp.cpp:471-475`) or a
nested list / a zero-arg callable that lazily returns a list (`SubGetItem`,
`packages/engine/layer4/PopUp.cpp:88-110`). Text may embed 4-char colour codes `\RGB` with digits 0-9
(`TextStartsWithColorCode` `packages/engine/layer1/Text.cpp:507-521`, `TextSetColorFromCode`
`packages/engine/layer1/Text.cpp:530-548`; `\---` resets to the default colour).

All contents below live in `packages/engine/modules/pymol/menu.py`.

### 2.1 Action menus

**`all_action`** (`menu.py:1497-1518`): zoom / center / origin — separator — preset ▸ /
find ▸ — separator — hydrogens ▸ / `remove waters` — separator —
`delete selections` (`map(cmd.delete,cmd.get_names("selections"))`) — separator —
`delete everything` (`cmd.delete("all")`) — separator — masking ▸ / movement ▸ / compute ▸.

**`sele_action`** (`menu.py:1160-1188`): `delete selection`, `rename selection`
(`cmd.wizard("renaming",...)`) — zoom / orient / center / origin — `drag coordinates`
(`cmd.drag`) / `clean` — modify ▸ / preset ▸ / find ▸ / align ▸ — `remove atoms`
(`cmd.remove(...)` + `cmd.delete(...)`) / hydrogens ▸ — `duplicate`
(`cmd.select(None,...)`) / `copy to object` ▸ (lazy) / `extract object`
(`cmd.extract(None,...)`) — masking ▸ / movement ▸ / compute ▸.

**`sele_action2`** (`menu.py:1191-1214`) — the variant used from in-scene picking menus:
same head, then preset/find, `remove atoms`, then around/expand/extend/invert/complete
inline, then `duplicate selection`/`copy to object`/`extract object`, masking/movement/compute.

**`mol_action`** (`menu.py:1248-1281`): zoom/orient/center/origin — `drag matrix`
(`cmd.drag`) / `reset matrix` (`cmd.reset(object=…)`) — `drag coordinates` / `clean` —
preset ▸ / find ▸ / align ▸ / generate ▸ — `assign sec. struc.` (`cmd.dss`) —
`rename object` / `copy to object` ▸ / `group` ▸ / `delete object` — hydrogens ▸ /
`remove waters` — state ▸ / masking ▸ / sequence ▸ / movement ▸ / compute ▸.

**`group_action`** (`menu.py:1217-1246`): zoom/orient/center/origin — `drag` / `reset` —
preset ▸ / find ▸ / align ▸ / generate ▸ — `assign sec. struc.` — `rename group` /
`group` ▸ / `delete group` — hydrogens ▸ / `remove waters` — state ▸ / masking ▸ /
sequence ▸ / movement ▸ / compute ▸.

**`map_action`** (`menu.py:1384-1405`): mesh ▸ / surface ▸ / slice ▸ / gradient ▸ /
volume ▸ — zoom / center / origin — drag / reset — `matrix_copy` ▸ — rename / group ▸ —
delete.

**`mesh_action`** (`menu.py:1443-1458`) and **`surface_action`** (`menu.py:1426-1441`):
level ▸ — zoom / center / origin — drag / reset — rename / group ▸ — delete.

**`slice_action`** (`menu.py:1283-1302`): zoom / center / origin — `tracking on|off`
(`slice_track_camera`) — `height map on|off` (`slice_height_map`) —
`dynamic grid on|off` (`slice_dynamic_grid`) — rename / group ▸ — delete.

**`simple_action`** (`menu.py:1304-1318`): zoom / center / origin — drag / reset —
rename / group ▸ — delete.

**`ramp_action`** (`menu.py:1460-1471`): `levels ▸` with `Range +/- L` for
L ∈ {0.1,0.2,0.5,1,2,5,10,20,50,100} → `cmd.ramp_update(name, range=[-L,L])` — group ▸ —
delete.

Shared action sub-menus:
* `presets` (`menu.py:728-747`): classified, simple, simple (no solvent), ball and stick,
  b factor putty, technical, ligands, `ligand sites ▸`, pretty, pretty (with solvent),
  publication, publication (with solvent), protein interface, default — all
  `preset.*("<sele>")`. `preset_ligand_sites` (`menu.py:714-726`): cartoon, solid surface,
  solid (better), transparent surface, transparent (better), dot surface, mesh surface.
* `hydrogens` (`menu.py:749-755`): add / add polar / remove / remove nonpolar.
* `state` (`menu.py:757-766`): freeze / all states / thaw / split (`cmd.split_states`).
* `movement` (`menu.py:768-772`): protect / deprotect.
* `sequence` (`menu.py:774-780`): include / exclude / default (`seq_view` object setting).
* `masking` (`menu.py:782-786`): mask / unmask.
* `compute` (`menu.py:788-807`): atom count; charges ▸ (formal charge sum, partial charges
  sum); surface area ▸ (molecular, solvent accessible, per residue rel. sol. acc.);
  molecular weight ▸ (explicit, with missing hydrogens).
* `mol_generate` (`menu.py:854-860`): selection ▸ (`selection`, `menu.py:840-852`: all,
  polymer, organic, solvent, polar hydrogens, non-polar hydrogens, donors, acceptors,
  surface atoms, C-alphas), symmetry mates ▸ (`symmetry`, `menu.py:821-833`: `cmd.symexp`
  within 4/5/6/8/12/20/50/100/250/1000 Å), vacuum electrostatics ▸ (`vacuum`,
  `menu.py:809-819`: protein contact potential (local) + 4 note lines).
* `find` (`menu.py:1050-1064`): polar contacts ▸ (`polar`, `menu.py:1004-1047`, 12 entries
  from "within selection" to "between chains"), any contacts ▸ (3.0/3.5/4.0 Å),
  halogen-bond interactions ▸, salt-bridge interactions ▸, pi interactions ▸
  (all / pi-pi / pi-cation).
* `mol_align` (`menu.py:1116-1122`) = `sele_align` (`menu.py:1104-1114`: to molecule
  (*/CA) ▸, to selection (*/CA) ▸, enabled to this, all to this, states (*/CA), states)
  plus `matrix from ▸`, `matrix to ▸`, `matrix reset`.
* `modify_sele` (`menu.py:1124-1133`): around ▸ / expand ▸ / extend ▸ / invert ▸ /
  complete ▸ / restrict ▸ / include ▸ / exclude ▸ — each defined at `menu.py:862-986`
  with fixed distance/bond ladders (4/5/6/8/12/20 Å; 1..6 bonds; plus `, residues`
  variants).
* `copy_to` (`menu.py:1136-1146`, lazy): `new` + up to 25 enabled objects from
  `cmd.get_object_list('enabled')`.
* `move_to_group` (`menu.py:1148-1158`, lazy): `new` (`cmd.group(cmd.get_unused_name(...))`),
  `ungroup`, then every `cmd.get_names_of_type('object:group')`.

### 2.2 Show / Hide menus

`rep_action(sele, action)` (`menu.py:145-176`) is the shared body used with
`show` / `hide` / `show_as` / `toggle`:
`wire`, `  lines`, `  nonbonded` — `licorice`, `  sticks`, `  nb_spheres` — `ribbon`,
`cartoon` — `label`, `cell` — `dots`, `spheres` — `mesh`, `surface`,
`flag ignore ▸` (set/clear the `ignore` flag + `cmd.rebuild`, plus 4 explanatory
`code 2` note lines).

* `mol_show` (`menu.py:197-215`): `as ▸` (= `mol_as`, `menu.py:178-182`, `show_as`) +
  rep_action(show) + `organic ▸` / `main chain ▸` / `side chain ▸` / `disulfides ▸`
  (each = `show_misc`, `menu.py:190-195`: lines/sticks/spheres) + `valence`
  (`cmd.set_bond("valence","1",…)`).
* `mol_hide` (`menu.py:223-240`): `everything` + rep_action(hide) + `main chain` /
  `side chain` / `waters` / `hydrogens ▸` (`hide_hydro`, `menu.py:217-221`: all,
  nonpolar) / `unselected` / `valence`.
* `mol_toggle` (`menu.py:184-188`) — exists but is not wired to any ASHLC button.
* `measurement_show` / `measurement_hide` (`menu.py:243-257`): dashes, angles, dihedrals,
  labels.
* `cgo_show` / `cgo_hide` (`menu.py:259-267`): cgo.
* `simple_show` / `simple_hide` (`menu.py:269-275`): everything.
* `map_show` / `map_hide` (`menu.py:277-287`): dots, extent, everything.
* `mesh_show` / `mesh_hide` (`menu.py:289-299`): mesh, cell, everything.
* `surface_show` / `surface_hide` (`menu.py:301-311`): surface, cell, everything.
* `slice_show` / `slice_hide` (`menu.py:313-321`): slice.
* `volume_show` / `volume_hide` (`menu.py:323-333`): volume, extent.

### 2.3 Label menu

`mol_labels` (`menu.py:1546-1571`): clear — residues (`"%s-%s"%(resn,resi)` anchored on
`cmd.get("label_anchor")`), residues (oneletter), chains, segments — atom name, element
symbol, residue name, one letter code, residue identifier, chain identifier, segment
identifier — b-factor, occupancy, vdw radius — `other properties ▸` (`label_props`,
`menu.py:1520-1537`: formal charge, partial charge 0.00 / 0.0000, elec. radius, text type,
numeric type, stereochemistry) — `atom identifiers ▸` (`label_ids`, `menu.py:1539-1544`:
rank, ID, index).

### 2.4 Color menus

* `mol_color` (`menu.py:672-685`): `by element ▸` / `by chain ▸` / `by ss ▸` / `by rep ▸` /
  `spectrum ▸` — `auto ▸` — then the full colour palette (`all_colors`).
  * `by_elem` (`menu.py:400-418`) 8 carbon colours + `set 2..set 6/H` submenus
    (`by_elem2..by_elem6`, `menu.py:335-398`), all `util.cba(<idx>, sele)` /
    `util.cbh(<name>, sele)`; the first entry is `util.cnc(sele)` (colour non-carbon only).
  * `by_chain` (`menu.py:464-480`): by chain (elem C) / (*/CA) / all → `util.color_chains`;
    `chainbows` → `util.chainbow`; by segi (elem C) / by segi → `cmd.spectrum("segi","rainbow",…)`.
  * `by_ss` (`menu.py:420-426`): 3 preset helix/sheet/loop triples via `util.cbss`.
  * `by_rep` (`menu.py:428-444`) over `rep_setting_lists` (`menu.py:482-517`): lines→`line_color`,
    sticks→`stick_color`, ribbon→`ribbon_color`, cartoon→`cartoon_color`, labels→`label_color`,
    dots→`dot_color`, spheres→`sphere_color`, mesh→`mesh_color`, surface→`surface_color`
    (mode 1 = measurement: dash/angle/dihedral/label colours; mode 2 = extra 9 settings).
    Each rep sub-menu = full palette + `unset`.
  * `spectrum` (`menu.py:446-462`): rainbow(elem C), rainbow(*/CA), rainbow byres,
    b-factors, b-factors(*/CA), area (molecular), area (solvent).
  * `color_auto` (`menu.py:659-670`): elem C, all, by obj (elem C), by obj.
  * `all_colors`/`all_colors_generic` (`menu.py:625-641`): 9 colour groups from
    `all_colors_list` (`menu.py:519-618`) — reds(11), greens(10), blues(9), yellows(7),
    magentas(10), cyans(7), oranges(7), tints(8), grays(11) — each entry runs
    `cmd.color_deep("<name>", "<sele>", 0)`; plus a `ramps ▸` group listing every
    `object:ramp` (`colorramps`, `menu.py:620-623`).
* `general_color` (`menu.py:711-712`): just the palette.
* `mesh_color` (`menu.py:696-709`): `negative ▸` (off + palette writing
  `<rep>_negative_visible` / `<rep>_negative_color`) then the palette. Called with
  `rep="surface"` for surface objects.
* `measurement_color` (`menu.py:687-694`): `by rep ▸` (mode 1) + palette.
* `slice_color` (`menu.py:655-657`): list of ramp objects.
* `vol_color` (`menu.py:643-653`): `panel` (`cmd.volume_panel`) + every named ramp from
  `pymol.colorramping.namedramps`.
* `ramp_color` (`menu.py:1473-1481`): `[red, white, blue]` + `pymol.creating.ramp_spectrum_dict`
  keys → `cmd.ramp_update(name, color=…)`.

### 2.5 Motion (M button) menus

* `camera_motion(frame)` (`menu.py:108-124`): store / `store with scene ▸`
  (`camera_store_with_scene`, first 40 scenes, `menu.py:54-59`) /
  `store with state ▸` (`store_with_state`, `menu.py:62-80`) / clear —
  `reset camera motions` — `purge entire movie` (`cmd.mset()`) —
  `smooth key frames ▸` (`smooth`, `menu.py:103-106`: a little / more (window=15) /
  a lot (window=30)) — interpolate / reinterpolate / uninterpolate.
* `obj_motion(obj, frame)` (`menu.py:126-143`): drag — store / `store with state ▸` /
  reset / clear — `reset object motions` / `purge object motions` —
  `smooth key frames ▸` — interpolate / reinterpolate / uninterpolate.

### 2.6 Menus reachable from elsewhere in the viewport (same engine)

* `main_menu(pos, screenpos)` (`menu.py:1682-1706`) — right-click on empty scene
  background, invoked at `packages/engine/layer1/SceneMouse.cpp:885-886` via `MenuActivate3fv`:
  `new ▸` (pseudoatom ▸ label / single) — zoom (vis) / orient (vis) / center (vis) /
  reset — movie ▸ (`movie_main`, `menu.py:1671-1680`: play, stop, rewind, panel ▸ on/off) /
  scene ▸ (`scene_main`, `menu.py:1636-1650`: next, append, update, recall ▸ <all scenes>,
  buttons ▸ on/off) — enable ▸ / disable ▸ (`enable_disable`, `menu.py:1613-1629`) —
  `(all) ▸` / `(visible) ▸` (`all_option`, `menu.py:1592-1611`) — ray —
  `delete all` / `reinitialize` / `quit`.
* `pick_menu(title, sele)` (`menu.py:1782-1798`) and `pick_sele` (`menu.py:1709-1733`) —
  right-click on an atom, `packages/engine/layer1/SceneMouse.cpp:386-401`.
* `pick_option` (`menu.py:1735-1779`) — the atom/residue/chain/segment/object/molecule/
  fragment sub-menus.
* `seq_option` (`menu.py:1800-1840`) — sequence viewer (other agent's area, same engine).
* `scene_menu(name)` (`menu.py:1842-1849`) — right-click a scene button:
  rename / update / delete.
* `mouse_config` (`menu.py:82-101`) — right-click the ButMode block: 3-Button Motions /
  Editing / Viewing / Lights / All Modes, 2-Button Editing / Viewing / Lights.

---

## 3. Popup-menu engine (`packages/engine/layer4/PopUp.cpp`)

Behaviours the React menu component must copy:
* Geometry: `cPopUpLineHeight` (item), `cPopUpTitleHeight = DIP2PIXEL(19)` (code 2),
  `cPopUpBarHeight = DIP2PIXEL(4)` (code 0), `cPopUpCharWidth = DIP2PIXEL(8)` —
  `packages/engine/layer4/PopUp.cpp:40-45`, `PopUpConvertY` `packages/engine/layer4/PopUp.cpp:265-...`.
* Placement: initial rect is `left = x - Width/3`, `right = x + 2*Width/3`, then
  `PopFitBlock` clamps it into the window — `packages/engine/layer4/PopUp.cpp:255-261`.
* Sub-menu opens on hover after `cChildDelay = 0.25 s` (`packages/engine/layer4/PopUp.cpp:47`,
  `packages/engine/layer4/PopUp.cpp:527-566`) and is placed by `PopPlaceChild` on whichever side fits
  (`PlacementAffinity`).
* "Sloppy mousing": leaving the row keeps the child alive for another `cChildDelay`;
  redraws are delayed by `cDirtyDelay = 0.05 s`; `PyMOL_NeedFakeDrag` keeps re-entering
  drag — `packages/engine/layer4/PopUp.cpp:585-608`, `OrthoFakeDrag` `packages/engine/layer1/Ortho.cpp:305-311`.
* Click-and-release without dragging inside `cPassiveDelay = 0.45 s` makes the menu
  "passive" (sticky — stays open after mouse-up) — `packages/engine/layer4/PopUp.cpp:446-465`.
* Mouse wheel scrolls the whole menu block by 10 px — `packages/engine/layer4/PopUp.cpp:436-444`.
* On commit: `PLog` then `PParse` of the command string —
  `packages/engine/layer4/PopUp.cpp:471-475`.
* Colours flip to black-on-white when `internal_gui_mode != Default` —
  `packages/engine/layer4/PopUp.cpp:144-163`.
* Selected row inverts text/background — `packages/engine/layer4/PopUp.cpp:866-867`; sub-menu rows get
  left/right gradient "wings" — `packages/engine/layer4/PopUp.cpp:884-928`.

---

## 4. Movie / frame control bar (the Control block)

`packages/engine/layer1/Control.cpp`. `NButton = 9` (`packages/engine/layer1/Control.cpp:62`), buttons laid out evenly
across `rect.right - (rect.left + cControlLeftMargin)`; box size
`cControlBoxSize = DIP2PIXEL(17)` (`packages/engine/layer1/Control.cpp:36-42`). Icons are only drawn when
`control_width > 100` (`packages/engine/layer1/Control.cpp:655`).

| # | Icon (draw code) | Action on release (`packages/engine/layer1/Control.cpp:298-376`) | Logged |
|---|---|---|---|
| 0 | ◀ with bar (`:665-696`) | `SceneSetFrame(G,4,0)` — rewind to frame 1 | `cmd.rewind()` |
| 1 | ◀ (`:697-719`) | `SceneSetFrame(G,5,-1)` — step back | `cmd.back()` |
| 2 | ■ (`:720-742`) | `MoviePlay(cMovieStop)`, also clears `sculpting` and `rock` | `cmd.mstop()` |
| 3 | ▶ (`:743-761`) | toggle play; with `Ctrl` rewinds first (`cmd.rewind();cmd.mplay()`) | `cmd.mplay()` / `cmd.mstop()` |
| 4 | ▶ (`:762-785`) | `SceneSetFrame(G,5,1)` — step forward | `cmd.forward()` |
| 5 | ▶ with bar (`:786-817`) | end; with `Ctrl` → middle | `cmd.ending()` / `cmd.middle()` |
| 6 | letter `S` (`:818-822`) | toggle `seq_view` | `cmd.set('seq_view',0|1)` |
| 7 | ▼ triangle (`:823-839`) | toggle `rock`, restarts sweep/frame timers | `cmd.rock(0|1)` |
| 8 | letter `F` (`:840-844`) | `full_screen` | `cmd.full_screen()` |

"Lit" (ActiveColor `{0.65,0.65,0.65}`) states: button 6 when `seq_view`, button 3 when
`MoviePlaying`, button 7 when `rock` — `packages/engine/layer1/Control.cpp:645-649`. Pressed state uses
`{0.8,0.8,0.8}` (`packages/engine/layer1/Control.cpp:545`).

**Left gutter "nub"** (`x < rect.left + cControlLeftMargin`, `packages/engine/layer1/Control.cpp:448-469`):
* single click + drag horizontally → live-resizes `internal_gui_width`
  (min `cControlMinWidth = 5`) and calls `OrthoReshape` — `packages/engine/layer1/Control.cpp:263-276`
* double click (<0.35 s) → collapse the panel to width 5 / restore the saved width.

`ControlIdling()` (`packages/engine/layer1/Control.cpp:397-403`) — the client must keep animating while
sdof active / movie playing / rock / sculpting.
`ControlSdofButton` / `ControlSdofUpdate` / `ControlSdofIterate`
(`packages/engine/layer1/Control.cpp:83-216`) implement 6-DOF-device (SpaceNavigator) input — not
reproducible in the browser; note as dropped.

---

## 5. Movie timeline panel (the Movie block)

`packages/engine/layer1/Movie.cpp`. Height = `MovieGetPanelHeight()` `packages/engine/layer1/Movie.cpp:1701-1726`:
`movie_panel_row_height (default 15) * ExecutiveCountMotions()` rows, or a single row in
`presentation` mode; 0 when `movie_panel`=0 or there is nothing to show.
`ExecutiveCountMotions()` `packages/engine/layer3/Executive.cpp:659-689` counts the camera row (if
`MovieGetSpecLevel >= 0`) plus every object with its own `ViewElem`.

Drawing: `CMovie::draw` `packages/engine/layer1/Movie.cpp:1741-1847`.
* a horizontal scroll bar spanning the frame range, whose value **is** the current frame
  (`SceneSetFrame(G,7,value)`, `packages/engine/layer1/Movie.cpp:1770-1783`)
* `ExecutiveMotionDraw` `packages/engine/layer3/Executive.cpp:694-730` draws one `ViewElemDraw` strip per
  row (camera row first, labelled `"camera"`; object rows labelled with the object name —
  `ObjectDrawViewElem` `packages/engine/layer1/PyMOLObject.cpp:129-134`)
* per-frame `specification_level`: 1 → thin bar (`bar_color {0.3,0.3,0.6}`),
  2 → full-height key block (`key_color {0.4,0.4,0.8}`) — `packages/engine/layer1/View.cpp:158-300`
* right-hand label gutter `LabelIndent = DIP2PIXEL(64)` (`packages/engine/layer1/Movie.cpp:1865-1867`)
* when there are no view elems the label is `"states"` (`packages/engine/layer1/Movie.cpp:1841-1843`)

Interaction (`CMovie::click` `packages/engine/layer1/Movie.cpp:1488-1568`,
`drag` `:1574-1607`, `release` `:1609-1699`):

| Input | Effect |
|---|---|
| Left (no mod) | scrollbar → scrub frame |
| Left + `Ctrl` | `cMovieDragModeInsDel` → drag right = `cmd.minsert(n, first, object=…)`, drag left = `cmd.mdelete(n, first, object=…)` |
| Left + `Ctrl+Shift` | same but `DragColumn` (applies to all rows, `object=''`) |
| Middle + `Ctrl` | `cMovieDragModeOblate` → `cmd.mview('clear', first=…, last=…, object=…)` |
| Middle + `Ctrl+Shift` | same, column-wide (`object='same'`) |
| Middle (no mod) | scrollbar |
| Right | `cMovieDragModeMoveKey` → drag = `cmd.mmove(target, source, 1, object=…)`; click-without-drag opens the motion menu (`ExecutiveMotionMenuActivate`) |
| Right + `Shift` | `cMovieDragModeCopyKey` → `cmd.mcopy(...)` |
| Right + `Ctrl+Shift` | `DragColumn` |
| Wheel | `SceneSetFrame(G,5,±1)` (step frame) |
| Wheel + `Ctrl+Shift` | change `movie_panel_row_height` and `OrthoReshape` |

`ExecutiveMotionMenuActivate` `packages/engine/layer3/Executive.cpp:732-793` picks the row under the
cursor and opens `camera_motion(frame)` for the camera row or
`obj_motion(objname, frame)` for an object row; when `DragColumn` it uses
`obj_motion("same", frame)`.

Drag feedback boxes (white outline for source, grey/green/red for target) —
`packages/engine/layer1/Movie.cpp:1789-1839`, `ViewElemDrawBox` `packages/engine/layer1/View.cpp:107-156`.

---

## 6. Scene bar (in-scene scene buttons)

There is **no symbol named `MovieButton` anywhere in this tree** (grepped: no match).
The "scene bar" is `SceneDrawButtons()` `packages/engine/layer1/Scene.cpp:2885-3063`, drawn by
`CScene::draw` `packages/engine/layer1/Scene.cpp:3446-3466` when `scene_buttons` (default 1,
`packages/engine/layer1/SettingInfo.h:699`) is on. `scene_buttons_mode` exists but is marked `unused`
(`packages/engine/layer1/SettingInfo.h:698`).

* One button per scene from `CScene::SceneVec`, stacked bottom-left of the viewport,
  row height `internal_gui_control_size`, own scroll bar when the list overflows
  (`packages/engine/layer1/Scene.cpp:2911-2963`).
* Fill: pressed `{0.7,0.7,0.7}`; current scene (name == `scene_current_name`)
  `{0.5,0.5,0.5}`; otherwise `{0.25,0.25,0.25}` — `packages/engine/layer1/Scene.cpp:3029-3038`.
* `ButtonMargin` is exported so the scene image is not overlapped
  (`packages/engine/layer1/Scene.cpp:3024-3025`).

Interaction — `SceneClickSceneButton` `packages/engine/layer1/SceneMouse.cpp:179-221` and
`SceneRelease` `packages/engine/layer1/SceneMouse.cpp:1070-1140`, `SceneDrag` `:1233-1305`:

| Input | Effect |
|---|---|
| Left click | `PressMode 1` → on release `cmd.scene('<name>')` (with interpolation) |
| Middle click | `PressMode 2` → immediate `cmd.scene('<name>', animate=-1)`; with `Ctrl`, `animate=0` |
| Right click | `PressMode 3` → drag reorders (`cmd.scene_order([...])`, `location='top'` when dropped on the first slot); click-without-drag opens `scene_menu(name)` (passive) |

---

## 7. Mouse-mode block (ButMode)

`packages/engine/layer1/ButMode.cpp:192-395`. Text-only block:
* line 1: `"Mouse Mode "` + `button_mode_name` (colour `{1,0.5,0.5}`).
* if `mouse_grid` (default 1, `packages/engine/layer1/SettingInfo.h:687`): a 4×(3+wheel) matrix —
  header `Buttons` / `    L    M    R  Wheel`, then rows `& Keys`, `Shft`, `Ctrl`,
  `CtSh`, then ` SnglClk` and ` DblClk` rows. Cell contents are 5-char codes from
  `CButMode::Code`, initialised at `packages/engine/layer1/ButMode.cpp:497-520+`:
  `Rota `, `RotZ `, `Move `, `MovZ `, `Clip `, `ClpN `, `ClpF `, `PkAt `, `PkBd `,
  `TorF `, `RotF `, `MovF `, ` lb  `, ` mb  `, ` rb  `, `+lb  `, `+mb  `, `+rb  `,
  `Orig `, `+lBx `, `-lBx `, … (blank = `"     "`).
* last lines: `Picking Atoms (and Joints)` or `Selecting <Atoms|Residues|Chains|Segments|Objects|Molecules|C-alphas>`
  from `mouse_selection_mode` — `packages/engine/layer1/ButMode.cpp:355-390`.
* fast-redraw line: `Frame`/`State` `%4d/%4d` plus `%5.1f Hz` when `show_frame_rate`
  (`packages/engine/layer1/ButMode.cpp:423-475`).

Click (`packages/engine/layer1/ButMode.cpp:149-190`):
* in the bottom 2 lines (`dy < 2`) → cycle the **selection** mode:
  `mouse select_forward` / `mouse select_backward` (reversed by right button, wheel-back,
  or `Shift`)
* elsewhere: left/wheel → `mouse forward` / `mouse backward`; **right button → opens the
  `mouse_config` popup**.

---

## 8. Wizard block

`packages/engine/layer1/Wizard.cpp`. `WizardRefresh()` `packages/engine/layer1/Wizard.cpp:195-259` pulls
`wizard.get_prompt()` (a list of strings → the floating wizard prompt) and
`wizard.get_panel()` (list of `[type, text, code]`) and resizes the block to
`internal_gui_control_size * NLine + 4`.
Line types (`packages/engine/layer1/Wizard.cpp:45-47`): **1 = text**, **2 = button**, **3 = popup**.

* click on a button → pressed state; on release `PParse(code)` — `packages/engine/layer1/Wizard.cpp:481-580`
* click on a popup line → `wizard.get_menu(code)` → `PopUpNew` — `packages/engine/layer1/Wizard.cpp:495-513`
* drag highlights the button under the cursor — `packages/engine/layer1/Wizard.cpp:519-550`
* event mask `get_event_mask()` (`cWizEventPick + cWizEventSelect` default) —
  `packages/engine/layer1/Wizard.cpp:213-221`

Wizard **prompt** overlay (independent of the block): `OrthoDrawWizardPrompt()`
`packages/engine/layer1/Ortho.cpp:2124-2255`. `wizard_prompt_mode` (default 1, `packages/engine/layer1/SettingInfo.h:461`):
1 = filled box top-left, 2 = text only, 3 = flush to the very top-left corner. Text may
carry `\RGB` colour codes. Position accounts for the sequence viewer height when
`seq_view_location`=0.

---

## 9. Command prompt drawn inside the viewport

State lives in `COrtho` (`packages/engine/layer1/Ortho.cpp:68-149`): a `Line[256]` ring of scrollback
lines (`OrthoSaveLines 0xFF`), a `History[256]` ring (`OrthoHistoryLines 0xFF`),
`CurLine`, `CurChar`, `PromptChar`, `CursorChar`, `InputFlag`, `Prompt[255]`,
`Saved`/`SavedPC`/`SavedCC` (the in-progress line stashed while output is written).

### 9.1 Key handling — `OrthoKey()` `packages/engine/layer1/Ortho.cpp:841-1031`

| Key / chord | Behaviour |
|---|---|
| any printable >32, ≠127 | insert at cursor (`add_normal_char`, `packages/engine/layer1/Ortho.cpp:822-839`) |
| `mod == 4` (Alt) | `cmd._alt(chr(k))`; `Alt+@` is treated as plain `@` — `packages/engine/layer1/Ortho.cpp:803-820` |
| `mod == 3` (Ctrl+Shift) | `cmd._ctsh(chr(k+64))` — `packages/engine/layer1/Ortho.cpp:789-801` |
| other Ctrl chars (default branch) | `cmd._ctrl(chr(k+64))` — `packages/engine/layer1/Ortho.cpp:761-773`, `:1024-1026` |
| Space, empty line | `mtoggle` (or, in `presentation`, `cmd.scene('','next')`); `Shift+Space` → `rewind;mplay` — `packages/engine/layer1/Ortho.cpp:876-893` |
| Space, non-empty line | insert a space |
| Backspace (8) | delete left of cursor, never past `PromptChar` |
| Delete (127) | delete right of cursor; on an empty line falls through to `Ctrl-D` |
| Ctrl-A (1) | cursor to start of input |
| Ctrl-E (5) | cursor to end |
| Ctrl-D (4) | delete forward, or (empty line) filename/keyword completion *print only* via `PComplete` |
| Tab (9) | `PComplete` and replace the line |
| Ctrl-K (11) | truncate line at cursor |
| Ctrl-V (22) | `cmd.paste()` when the line is empty-ish |
| Enter (13), non-empty | `OrthoParseCurrentLine()` — push to history, `PLog` (except `quit`), `PParse` — `packages/engine/layer1/Ortho.cpp:1033-1060` |
| Enter (13), empty, movie panel or presentation and a movie exists | `mview toggle,quiet=1`; `+Ctrl` → `mview toggle,freeze=1`; `+Shift` → `mview toggle_interp`; `+Ctrl+Shift` → `mview toggle_interp,object=same`; in `presentation` plain Enter → `mtoggle` — `packages/engine/layer1/Ortho.cpp:961-983` |
| Esc (27) | dismiss splash; else toggle `text`; `Shift+Esc` toggles `overlay`; in `presentation` → `_quit` — `packages/engine/layer1/Ortho.cpp:941-959` |

`OrthoSpecial()` `packages/engine/layer1/Ortho.cpp:322-389` handles ↑/↓ (history recall, saving the
in-progress line back into `History[HistoryLine]`) and ←/→ (cursor). Arrows are only
grabbed when `OrthoArrowsGrabbed()` — i.e. there is typed text **and** text is visible
(`packages/engine/layer1/Ortho.cpp:394-409`); otherwise they fall through to `_special` →
`packages/engine/modules/pymol/shortcut_dict.py` bindings (`packages/engine/layer5/PyMOL.cpp:2361-2395`).

### 9.2 Feedback / scrollback rendering

`OrthoDrawText()` `packages/engine/layer1/Ortho.cpp:1623-1693`:
* origin `x = cOrthoLeftMargin`, `y = cOrthoBottomMargin + MovieGetPanelHeight(G)`
* number of lines: `ShowLines` (= `height/cOrthoLineHeight`) when `text` is on or the
  splash is up, otherwise `internal_feedback + overlay_lines`
* `internal_prompt` = 0 hides the prompt line entirely (`skip_prompt`,
  `packages/engine/layer1/Ortho.cpp:1633-1634`)
* the input line gets a `_` cursor glyph, positioned at `CursorChar` when set
  (`packages/engine/layer1/Ortho.cpp:1676-1685`)
* colour: prompt lines use `TextColor`, output lines use `OverlayColor`
  (= 1 − background, zeroed if too close to the background, `packages/engine/layer1/Ortho.cpp:1874-1880`)
* background strip: `OrthoDrawInternalFeedbackBG()` `packages/engine/layer1/Ortho.cpp:1506-1553` (black
  band across the bottom under the scene plus a `{0.3,0.3,0.3}` separator line)

Overlay-line count: `OrthoGetNumberOverlayLines()` `packages/engine/layer1/Ortho.cpp:1591-1621`.
`overlay` (default 0, `packages/engine/layer1/SettingInfo.h:145`), `overlay_lines` (default 5,
`packages/engine/layer1/SettingInfo.h:400`), `auto_overlay` (default 0, `packages/engine/layer1/SettingInfo.h:703`) makes
new output transiently visible until `OrthoRemoveAutoOverlay()`
(`packages/engine/layer1/Ortho.cpp:426-431`, called on every mouse click, `packages/engine/layer1/Ortho.cpp:2528`).

Line assembly: `OrthoAddOutput()` `packages/engine/layer1/Ortho.cpp:1062-1127` (wraps at `wrap_output`
columns, default 0 = off, `packages/engine/layer1/SettingInfo.h:276`), `OrthoNewLine()`
`packages/engine/layer1/Ortho.cpp:1129-1189` (also pushes the line into the `feedback` queue and strips
ANSI escapes unless `colored_feedback`, `packages/engine/layer1/SettingInfo.h:874`).

Queue drain for an external GUI: `OrthoFeedbackOut()` `packages/engine/layer1/Ortho.cpp:502-516` →
`_cmd.get_feedback` (`packages/engine/layer4/Cmd.cpp:3866-3900`) → `cmd._get_feedback()`
(`packages/engine/modules/pymol/internal.py:593-606`). The Qt GUI polls it every 500 ms and converts to
HTML with `colorprinting.text2html` — `packages/engine/modules/pmg_qt/pymol_qt_gui.py:941-957`.

Command **input** from an external GUI goes the other way through
`OrthoCommandIn()` / `OrthoCommandOut()` (`packages/engine/layer1/Ortho.cpp:2851-2868`, `:455-470`) with a
4-deep nesting stack (`OrthoCommandNest`, `packages/engine/layer1/Ortho.cpp:440-453`).

---

## 10. Busy / progress box and splash

* `OrthoBusyDraw()` `packages/engine/layer1/Ortho.cpp:609-724` — a 240×60 px black box in the top-left with
  a message line and up to two progress bars (`BusyStatus[0..3]` = slow progress/total,
  fast progress/total), gated by `show_progress`. Fed by `OrthoBusySlow` / `OrthoBusyFast`
  (`packages/engine/layer1/Ortho.cpp:538-596`) which also call `PyMOL_SetProgress`.
  Python side: `cmd.get_progress()` (`packages/engine/modules/pymol/monitoring.py:5`), already consumed by
  the Qt GUI at `packages/engine/modules/pmg_qt/pymol_qt_gui.py:931-939`.
* `OrthoSplash()` `packages/engine/layer1/Ortho.cpp:2608-2679` — version/copyright text; `SplashFlag`
  forces full text display until the first click (`OrthoRemoveSplash`,
  `packages/engine/layer1/Ortho.cpp:433-438`, called from `OrthoButton` `packages/engine/layer1/Ortho.cpp:2527`).
* `OrthoDrawLoop()` `packages/engine/layer1/Ortho.cpp:1695-1750` — the 1-px rubber-band selection
  rectangle (`LoopRect`, set via `OrthoSetLoopRect` `packages/engine/layer1/Ortho.cpp:253-261`), coloured
  `cColorFront`.
* `OrthoDrawMessages()` `packages/engine/layer1/Ortho.cpp:1752-1781` — build-flavour banners
  (`PYMOL_EVAL`, `PYMOL_EDU`, …); not applicable to this fork's default build.

---

## 11. Reading the panel state from Python (confirmed APIs)

All of the following were verified to exist in this tree.

| Need | API | Source |
|---|---|---|
| Row names, in SpecRec order | `cmd.get_names(type, enabled_only, selection)` with `type` ∈ objects / selections / all / public / public_objects / public_selections / public_nongroup_objects / public_group_objects / nongroup_objects / group_objects | `packages/engine/modules/pymol/querying.py:1155-1199`; C: `ExecutiveGetNames` `packages/engine/layer3/Executive.cpp:8873-8960` |
| Row kind | `cmd.get_type(name)` → `object:molecule`, `object:map`, `object:mesh`, `object:slice`, `object:surface`, `object:measurement`, `object:cgo`, `object:group`, `object:volume`, `selection` | `packages/engine/modules/pymol/querying.py:1206-1240` |
| All names of one kind | `cmd.get_names_of_type('object:group')` | `packages/engine/modules/pymol/querying.py:1459-1485` |
| **enabled + reps + colour, all rows at once** | `cmd.get_vis()` → `{name: [visible:int, [], [rep_indices] | None, color_index | None]}` | `packages/engine/modules/pymol/viewing.py:899-901`; C: `ExecutiveGetVisAsPyDict` `packages/engine/layer3/Executive.cpp:4496-4527` (rep list built by `getRepArrayFromBitmask` `:4529-4540`; `_`-prefixed recs are skipped) |
| Restore that state | `cmd.set_vis(dict)` | `packages/engine/modules/pymol/viewing.py:903-905`; C: `ExecutiveSetVisFromPyDict` `packages/engine/layer3/Executive.cpp:4574` |
| Enabled-only listing | `cmd.get_names('objects', enabled_only=1)` | used by `menu.enable_disable` `packages/engine/modules/pymol/menu.py:1613-1629` |
| Object colour index | `cmd.get_object_color_index(name)` | `packages/engine/modules/pymol/querying.py:819-823` |
| Colour index → RGB | `cmd.get_color_tuple(name_or_index)` | `packages/engine/modules/pymol/querying.py:825-841` |
| Atom count for a row/selection | `cmd.count_atoms(selection)` | `packages/engine/modules/pymol/querying.py:1419-1441` |
| State count / caption numbers | `cmd.count_states(selection)`, `cmd.get_title(object, state)` | `packages/engine/modules/pymol/querying.py:703`, `:176` |
| Objects covered by a selection | `cmd.get_object_list(selection)` | `packages/engine/modules/pymol/querying.py:131-145` |
| Frame / state / movie | `cmd.get_frame()`, `cmd.get_state()`, `cmd.count_frames()`, `cmd.get_movie_length()`, `cmd.get_movie_playing()`, `cmd.get_movie_locked()` | `packages/engine/modules/pymol/moving.py:984`, `:958`, `packages/engine/modules/pymol/querying.py:759`, `:730`, `packages/engine/modules/pymol/moving.py:64`, `packages/engine/modules/pymol/querying.py:814` |
| Scene bar contents / order | `cmd.get_scene_list()` (→ `_cmd.get_scene_order`), `cmd.scene_order(...)`, `cmd.get_scene_message` | `packages/engine/modules/pymol/viewing.py:919-921`, `:961`, `:935` |
| Feedback stream | `cmd._get_feedback()` | `packages/engine/modules/pymol/internal.py:593-606` |
| Progress | `cmd.get_progress()` | `packages/engine/modules/pymol/monitoring.py:5` |
| Settings that changed since last poll | `cmd.get_setting_updates()` | `packages/engine/modules/pymol/setting.py:440` |
| Tab completion for the prompt | `cmd._parser.complete(str)` (exposed as `new_complete_closure`) | `packages/engine/modules/pymol/parser.py:524-604` |
| Menu contents (do NOT re-implement) | `pymol.menu.<name>(cmd, *args)` — returns the `[code, text, command]` list; entries whose 3rd element is a callable must be called with no args to expand | `packages/engine/modules/pymol/menu.py`, mirrors `packages/engine/layer4/Menu.cpp:29-124` and `packages/engine/layer4/PopUp.cpp:88-110` |

### Gaps in the Python surface (confirmed by grep, not guessed)

* **Group nesting / indent level and group open-closed state are NOT exposed by any
  `cmd.*` query.** `PanelRec.nest_level` / `is_open` live only in C
  (`packages/engine/layer3/ExecutiveDef.h:20-31`) and `SpecRec::group_name` is only serialised through
  `cmd.get_session(partial=1)['names']` — element 6 of each rec is `group_name`
  (`ExecutiveGetExecObjectAsPyList` `packages/engine/layer3/Executive.cpp:5377-5448`,
  `ExecutiveGetExecSeleAsPyList` `:5450-5468`), and `ObjectGroup.OpenOrClosed` is element 1
  of the group's own list (`ObjectGroupAsPyList` `packages/engine/layer2/ObjectGroup.cpp:60-73`).
  `cmd.get_session` is far too heavy to poll, so the bridge supplies the panel model itself in
  `packages/bridge/tenmol_bridge/panels/objects.py` rather than reading `PanelRec`.
* There is **no push notification** for panel changes in the Python build:
  `ReportEnabledChange` (`packages/engine/layer3/Executive.cpp:313-326`) only invokes
  `G->enabledCallback` under `_PYMOL_LIB`. The fork bumps `m_web_enable_version` at the top of
  that same function (`:315-319`), which is what `_cmd.web_get_versions` reports, so the client
  polls four counters instead of diffing names.
* `sele_color` (per-selection indicator colour) is in `SpecRec` but has no `cmd` getter.
* `cmd.get_vis()` reports `visible` per rec but **not** the "cloaked" state (enabled but an
  ancestor group is disabled); that has to be derived client-side from group membership,
  matching `packages/engine/layer3/Executive.cpp:16443-16461`.

---

## 12. Consequences for the port

* Menus are fetched from the backend as data (`pymol.menu.*` → JSON), **not** re-declared in
  TypeScript: the entries embed `cmd.*` source strings and are generated from live state (scene
  lists, ramp lists, object lists, colour list). Each selected leaf is executed via
  `cmd.do(<command string>)` — which is exactly what `packages/engine/layer4/PopUp.cpp:471-475`
  does (`PLog` + `PParse`). See `apps/web/src/features/pymol-menu/menuStore.ts`.
* Lazy sub-menus (`lambda: copy_to(...)`, `lambda: move_to_group(...)`,
  `menu.py:1182`, `:1208`, `:1235`, `:1269-1270`, `:1299`, `:1315`, `:1402`, `:1438`,
  `:1455`, `:1468`, `:1740`, `:1776`) are expanded on demand, mirroring
  `SubGetItem` `packages/engine/layer4/PopUp.cpp:88-110`.
* Text colour codes `\RGB` are parsed into spans (`packages/engine/layer1/Text.cpp:507-548`,
  ported in `apps/web/src/features/wizards/colorCodes.ts`); they appear in menu labels
  (`del_col`/`rem_col` = `\933`, `menu.py:21-22`), object captions, and wizard prompts.
* The panel is the *only* place where drag-reorder/regroup exists; it emits real
  `cmd.order` / `group` / `ungroup` commands, so the tree can be optimistic and then re-read
  (`apps/web/src/features/objects/placement.ts`).
* Modifier semantics (Shift/Ctrl/Ctrl+Shift on left and middle mouse over a row) are
  non-obvious and are part of the product; see §1.4.
