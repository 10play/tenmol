# Area: dialogs-volume-properties-scenes

Scope: `modules/pmg_qt/volume.py`, `modules/pmg_qt/properties_dialog.py`,
`modules/pmg_qt/scene_bin_gui.py`, `modules/pmg_qt/shortcut_menu_gui.py`,
`modules/pmg_qt/advanced_settings_gui.py`, `modules/pmg_qt/TextEditor.py`,
plus a full inventory of `modules/pmg_qt/forms/*.ui`.

Everything below was read in the tree at commit `5e8bfca5`. Line numbers are
1-indexed and refer to the current files.

Target architecture assumed: PyMOL backend stays in Python/C++, a bridge exposes
`cmd` over WebSocket/HTTP, React reimplements every Qt widget. Nothing in this
area contradicts that architecture — none of these dialogs owns a GL context.
The only pixel-producing dependency is the scene thumbnail (`get_scene_thumbnail`
returns a PNG byte buffer produced server-side, `layer4/Cmd.cpp:1159-1173`),
which is trivially transportable as base64.

---

## 0. How these dialogs are opened (entry points)

| Dialog | Menu path / trigger | Source |
| --- | --- | --- |
| Volume Color Map Editor | Internal-GUI object menu `A > volume > panel`, and `volume_panel` command | `modules/pymol/menu.py:648`, `modules/pymol/colorramping.py:183-227` |
| Properties Inspector | "Properties" quick-button in the lower button row | `modules/pmg_qt/pymol_qt_gui.py:251`, opener `pymol_qt_gui.py:625-632` |
| Scene Panel | menubar `Scene > Scenes...` | `modules/pymol/_gui.py:776`, opener `pymol_qt_gui.py:891-897` |
| Keyboard Shortcut Menu | menubar `Setting > Keyboard Shortcuts...` | `modules/pymol/_gui.py:494`, opener `pymol_qt_gui.py:885-889` |
| Advanced Settings | menubar `Setting > Edit All...` | `modules/pymol/_gui.py:493`, opener `pymol_qt_gui.py:878-883` |
| Text Editor (pymolrc) | menubar `File > Edit pymolrc` | `modules/pymol/_gui.py:124`, opener `pymol_qt_gui.py:634-637` |

All five singleton dialogs are cached on the main window
(`pymol_qt_gui.py:104-108`: `advanced_settings_dialog`, `props_panel`,
`shortcut_menu_filter_dialog`, `scene_panel_dialog`) and re-`show()`n, i.e. they
are **modeless, single-instance, non-blocking** windows. Volume panels are cached
per volume object name in `colorramping.py:10-11` (`_volume_windows_qt`).

`load_form(name, dialog=None)` (`pymol_qt_gui.py:512-543`) is the .ui loader:
it first tries to import a generated `pmg_qt.forms.<name>` module, falls back to
runtime `.ui` parsing via `pymol.Qt.utils.loadUi` (`modules/pymol/Qt/utils.py:269-283`).
`dialog=None` -> wraps in a new `QDialog`; `dialog='floating'` -> wraps in a
floating `QDockWidget`; the resulting object always gets `form._dialog`.
**No generated `.py` forms exist in the tree** (`modules/pmg_qt/forms/` contains
only `.ui` + an empty `__init__.py`), so the `.ui` XML is the single source of truth.

---

## 1. Volume Color Map Editor (`modules/pmg_qt/volume.py`, 877 lines)

### 1.1 Container

Two factory variants exist:

- `VolumePanelDocked(parent, ...)` — `volume.py:811-821`: builds a `QDockWidget`,
  added to `Qt.DockWidgetArea.BottomDockWidgetArea` of the main window.
  `VolumePanel = VolumePanelDocked` (`volume.py:830`) — this is what ships.
- `VolumePanelDialog(parent, ...)` — `volume.py:824-827`: plain modeless `QDialog`
  variant (unused by default).

Window title: `"<name> - Volume Color Map Editor"` (`volume.py:837`).
Layout (`_VolumePanel.__init__`, `volume.py:833-877`):

1. `VolumeEditorWidget` canvas (stretches; `sizeHint` 600x200, `volume.py:98-99`)
2. Button row (`volume.py:864-871`):
   - `QPushButton "Get colors as script"` -> `displayScript` (`volume.py:847-849`)
   - `QPushButton "Reset Data Range"` -> `editor.reset` (`volume.py:853-855`)
   - `QPushButton "Help"` -> `displayHelp` (`volume.py:850-852`)
   - stretch
   - `QCheckBox "Update volume colors in real-time"` (objectName
     `volume_checkbox`), default **checked**, min width 30
     (`volume.py:856-862`) -> `toggleRealTimeUpdates` (`volume.py:423-424`)
   - All push buttons set `setAutoDefault(False)`.

Initial data load (`volume.py:873-877`):

```
histogram = cmd.get_volume_histogram(name)   # list len = bins+4 (default bins=64)
widget.editor.setHistogram(histogram)
colors    = cmd.volume_color(name)           # flat [v,r,g,b,a] * N
widget.editor.setColors(colors)
```

### 1.2 Data contracts

- `cmd.get_volume_histogram(objName, bins=64, range=None)`
  (`modules/pymol/querying.py:62-72`) -> `[min, max, mean, stdev, h0..h(bins-1)]`;
  C entry `CmdGetVolumeHistogram` / `ExecutiveGetHistogram`
  (`layer4/Cmd.cpp:738-752`).
- `cmd.volume_color(name, ramp='', state=CURRENT_STATE, quiet=1, _guiupdate=True)`
  (`modules/pymol/colorramping.py:123-181`). With empty `ramp` it is a **getter**
  (delegates to `get_volume_color`, `colorramping.py:87-121`, C
  `_cmd.get_volume_ramp`), returning a flat list of 5-tuples
  `v, r, g, b, a` (floats, RGB in 0..1). With a ramp it is a **setter**
  (`_cmd.set_volume_ramp`, `colorramping.py:156`).
- Named presets `namedramps` (`colorramping.py:17-54`): `2fofc`, `fofc`, `esp`,
  `rainbow`, `rainbow2`; extendable via `cmd.volume_ramp_new(name, ramp)`
  (`colorramping.py:56-84`). These are exposed in the internal `A > volume` menu
  (`modules/pymol/menu.py:644-654`).
- Ramp string parsing: `ramp_expand` (`colorramping.py:265-298`) accepts
  `v color a ...` or `v r g b a ...`, raises `ValueError("malformed color ramp")`.

### 1.3 The canvas widget — exact interaction model

`VolumeEditorWidget` (`volume.py:69-808`) is a custom-painted 2D plot. It **must
be reimplemented in React** (SVG or 2D canvas); there is no Qt equivalent.

**Constants:** `DOT_RADIUS = 5` (`volume.py:14`), `ALPHA_LOG_BASE = 10.0`
(`volume.py:15`), `EPS = 1e-6` (`volume.py:26`),
`DEFAULT_COLORS` cycle of 6 RGB triples used for newly added points
(`volume.py:17-24`, consumed via `itertools.cycle` at `volume.py:76` and
`volume.py:614`), `DEFAULT_TEXT_DIALOG_WIDTH = 500` (`volume.py:28`).

**Geometry / margins:** `left_margin = 35`, `bottom_margin = 20`
(`volume.py:87-88`). Paint rect = `event.rect().adjust(left_margin, 0, 0, -bottom_margin)`
(`volume.py:262-263`).

**Coordinate transforms** (must be replicated *exactly*, they define hit-testing):

| function | source | formula |
| --- | --- | --- |
| `convertX(x_px)` | `volume.py:443-448` | `clamp((x - left_margin)/(width - left_margin), 0, 1)` |
| `convertY(y_px)` | `volume.py:450-455` | `clamp(1 - y/(height - bottom_margin), 0, 1)` |
| `xToData(x01)` | `volume.py:457-461` | `vmin + x*(vmax - vmin)` |
| `dataToX(d)` | `volume.py:463-467` | `(d - vmin)/(vmax - vmin)` |
| `yToAlpha(y01)` | `volume.py:469-474` | `((10^y - 1)/(10 - 1)) * amax` |
| `alphaToY(a)` | `volume.py:476-483` | `log10(1 + 9*(a/amax))`, returns 0 if `amax==0` |

The vertical axis is therefore a **logarithmic alpha axis** with base 10 scaled by
`amax`. Grid lines are drawn at alpha = k/10 for k in 1..9 mapped through
`alphaToY` (`volume.py:110-117`).

**Model state:** `self.points` is an ordered list of tuples `(x_dataValue, y_alpha, r, g, b)`
kept sorted ascending by x (insertion is order-preserving, `volume.py:617-623`).
`vmin/vmax` = visible data window, `original_vmin/original_vmax` = full data range
from the histogram, `amax` = alpha axis top (default 1.0) — `volume.py:82-86`.

**Painting order** (`paintEvent`, `volume.py:257-279`):
1. `paintGrid` — axis lines + 9 dashed horizontal grid lines (`volume.py:101-117`)
2. `paintAxes` — integer ticks on x (only drawn if labels do not collide:
   `if x - lastx > w + 2*fw`, `volume.py:218-227`), 0.1..0.9 ticks on y with the
   same anti-collision rule (`volume.py:232-239`), plus three editable value boxes
   (`volume.py:242-249`)
3. `paintHistogram` (clipped to plot rect) — a red polyline resampled per pixel
   column with linear interpolation, remapped for the current zoom window
   (`volume.py:148-177`)
4. `paintColorDots` — polyline connecting all points in gray, then a filled circle
   per point using its RGB; the hovered point is drawn again with radius
   `DOT_RADIUS + 2` (`volume.py:119-146`)
5. `paintZoomArea` — translucent `rgba(0,64,128,128)` rectangle between
   `init_pos.x()` and `zoom_pos.x()` while ctrl+right-dragging (`volume.py:251-255`)

**Histogram normalization** (`setHistogram`, `volume.py:665-709`): `vmin=hist[0]`,
`vmax=hist[1]`; if `vmin == vmax` it widens by ±1; if either is NaN it warns and
reverts. Bars `hist = histogram[4:]` are normalized by
`max_value = min(q90*4, max)` where `q90 = sorted(hist)[int(N*0.9)]` — i.e. extreme
peaks are clipped. Produces `self.path` = list of `(x01, y01)`.

**Three editable text boxes** (`text_boxes` dict, keys `"vmin"`, `"vmax"`, `"amax"`,
`volume.py:242-249`). Each is a hit-rect drawn by `paintValueBox`
(`volume.py:179-199`, format `%.3f` for vmin/vmax, `%.2f` for amax). Behaviour:

- Left-click a box -> `QInputDialog.getDouble` (`enterValue`, `volume.py:281-290`,
  `decimals=6`) with these validation ranges (`volume.py:294-309`):
  - `amax`: title "Maximum Alpha Value", range `[EPS, 1.0]`
  - `vmin`: title "Minimum Data Value", range `[-1e8, vmax - EPS]`
  - `vmax`: title "Maximum Data Value", range `[vmin + EPS, 1e8]`
  Cancel keeps the old value (`enterValue` returns `value` if not accepted).
- Mouse wheel over a box (`wheelEvent`, `volume.py:533-545`), `delta = -angleDelta.y()/1000`:
  - `amax` -> `clamp(amax*(1+delta), 0, 1)`
  - `vmin` -> `min(vmin + (vmax-vmin)*delta, vmax - EPS)`
  - `vmax` -> `max(vmax + (vmax-vmin)*delta, vmin + EPS)`
  Box wheel does **not** push colors to PyMOL (early `return` at `volume.py:545`).
- Mouse wheel **not** over a box (`volume.py:547-554`) scales every point's alpha:
  `y -= y*delta`, clamped to `[0,1]`, then repaint + `updateVolumeColors()`
  unconditionally (ignores the real-time checkbox).

**Mouse model** (authoritative list is the in-app help text, `volume.py:30-66`,
implemented in `mousePressEvent` `volume.py:292-323`, `mouseReleaseEvent`
`volume.py:325-365`, `mouseMoveEvent` `volume.py:493-517`):

No point under cursor:
- `L-Click` -> add 1 point at cursor, color from the 6-color cycle
  (`addPoint`, `volume.py:607-634`); sets `dragged = True` so the release does not
  open the color picker (`volume.py:322`).
- `Ctrl + L-Click` -> add **3 points** (isosurface preset): the clicked point plus
  two zero-alpha points at ±10 px (`volume.py:625-630`).
- `Ctrl + R-Drag` -> zoom band; on release `vmin, vmax = sorted([xToData(convertX(x0)), xToData(convertX(x1))])`
  (`volume.py:356-362`). Zero-width drag is ignored.

Point under cursor (found by `findPoint`, squared-distance < `4*DOT_RADIUS^2`,
`volume.py:651-663`):
- `L-Click` (release, not dragged) -> open `QColorDialog` for that point
  (`setPointColor`, `volume.py:406-421`). The dialog is **modal** (`.open()`),
  reused across invocations, with `currentColorChanged` wired to
  `updatePointColor` (live preview, `volume.py:387-393`) and `finished` wired to
  `colorDialogClosed` (`volume.py:395-404`) which restores `self.original_color`
  on Reject.
- `Ctrl + L-Click` -> same color dialog but applies to the point and its two
  neighbours (`changePointColor` with `color_triple`, `volume.py:367-385`).
- `R-Click` (no modifier, or Ctrl — see the comment at `volume.py:329`) -> edit the
  **data value** via `enterValue("Data value", ...)` clamped to
  `[prev_point.x or vmin, next_point.x or vmax]` (`volume.py:330-335`).
- `Shift + R-Click` -> edit the **alpha/opacity** via
  `enterValue("Alpha value (opacity)", value, 0.0, 1.0)` (`volume.py:336-339`).
- `M-Click` (middle) or `Shift + L-Click` -> remove the point (`volume.py:344-348`,
  `removePoints`, `volume.py:636-649`).
- `Ctrl + M-Click` or `Ctrl + Shift + L-Click` -> remove 3 points
  (`removePoints(three_points=True)`).
- `L-Drag` -> move the point in both axes (`movePoints`, `volume.py:556-605`);
  x is clamped so points cannot cross their neighbours (`volume.py:568-583`).
  A `QToolTip` follows the cursor showing `"value: %.3f\nalpha: %.3f"`
  (`volume.py:602-603`).
- `Ctrl + L-Drag` -> move 3 points, **horizontal only** (`delta = 2` selects
  neighbour-of-neighbour bounds, and `new_y = y` when `delta > 1`,
  `volume.py:561`, `volume.py:588`, `volume.py:592-599`).
- `R-Drag` -> axis-constrained move: the axis is latched on the first move from
  `abs(dx) > abs(dy) ? 'x' : 'y'` (`volume.py:502-507`), applied at
  `volume.py:587-588`.
- Hover (no buttons) -> `hover_point` tracked and repainted with a larger dot
  (`volume.py:509-517`, `setMouseTracking(True)` at `volume.py:73`).
- Hit region for press/hover is the plot rect inflated by `DOT_RADIUS` on all
  sides (`volume.py:311-313`, `volume.py:510-511`).

**Push to PyMOL** (`updateVolumeColors`, `volume.py:485-491`):
```
self.ignore_set_colors = True
self.cmd.volume_color(self.volume_name, self.getColors())
self.ignore_set_colors = False
```
`getColors()` flattens points to `[x, r, g, b, y] * N` (`volume.py:426-441`).
The `ignore_set_colors` flag suppresses the echo in `setColors`
(`volume.py:719-720`), because `cmd.volume_color` calls back into
`_volume_windows_qt[name].widget().editor.setColors(ramplist)`
(`colorramping.py:170-179`). Note the release handler calls
`updateVolumeColors()` unconditionally at `volume.py:365` even when real-time is off,
so "real-time" only suppresses updates *during* a drag / color-dialog preview
(`volume.py:342-343`, `volume.py:392-393`, `volume.py:604-605`).

**Other actions:**
- `reset()` (`volume.py:739-746`) — restores `vmin/vmax` to `original_vmin/original_vmax`
  and re-pushes colors. It does **not** touch the points.
- `displayScript()` (`volume.py:775-799`) — builds a `cmd.volume_ramp_new('ramp%03d', [...])`
  snippet with a random 3-digit name and shows it in a reusable read-only
  monospace `QPlainTextEdit` dialog (`displayTextDialog`, `volume.py:748-767`,
  width 500). Identical text is also printed by
  `get_volume_color(..., quiet=0)` (`colorramping.py:106-114`).
- `displayHelp()` (`volume.py:769-773`) — shows the `VOLUME_HELP` block verbatim
  (`volume.py:30-66`).
- `setColors(colors)` (`volume.py:711-737`) — external ingestion, 5 floats per point,
  aborts with a warning if any value is NaN.
- `windowTopLevelChanged(floating)` (`volume.py:801-808`) — dead code; the
  connection is commented out at `volume.py:818-819` and `is_floating` is hardcoded
  `True` at `volume.py:267`.

**Latent issues to carry over knowingly:**
- `__init__` sets `self.constrain = None` (`volume.py:89`) but the drag code reads
  and writes `self.constraint` (`volume.py:318`, `volume.py:503`, `volume.py:587-588`).
  `self.constrain` is dead.
- `movePoints` uses the Qt5-only `event.x()` / `event.y()` (`volume.py:565`,
  `volume.py:584`) while `wheelEvent` already uses the Qt6 form
  `event.position().toPoint()` (`volume.py:534`). Mixed API generation.
- `paintHistogram` computes `y` against `rect.height()-2` rather than `rect.top()`
  (`volume.py:155`, `volume.py:168`), so the curve is anchored to the widget, not
  to the plot rect.

---

## 2. Properties Inspector (`modules/pmg_qt/properties_dialog.py`, 415 lines + `forms/props.ui`)

### 2.1 Form `props.ui` (`QWidget "Form"`, windowTitle "Properties Inspector", 400x500)

| widget | class | notes |
| --- | --- | --- |
| `label` | QLabel | "Object:" |
| `input_model` | QComboBox | object list, hstretch 1 |
| `label_2` | QLabel | "State:" |
| `input_state` | QSpinBox | minimum 1 |
| `label_3` | QLabel | "Atom:" |
| `input_index` | QSpinBox | minimum 1, maximum 999999 |
| `button_refresh` | QToolButton | toolTip "Refresh", no text (icon only) |
| `treeWidget` | QTreeWidget | `alternatingRowColors=true`, columns `Key` / `Value` |

(`forms/props.ui:20-94`.) The refresh icon falls back to
`$PYMOL_DATA/pmg_qt/icons/refresh.svg` when the themed icon is null
(`properties_dialog.py:136-139`). Column 0 width is forced to 200
(`properties_dialog.py:143`). Column 0 uses `UneditableDelegate`
(`properties_dialog.py:17-19`, installed at `properties_dialog.py:70`) — keys are
never editable, values always are.

### 2.2 Tree structure (built in `setup_tree_widget`, `properties_dialog.py:69-117`)

```
Object-Level                       (cat)
  TTT Matrix                       (entry, editable)
  Settings                         (cat, dynamic)
Object-State-Level                 (cat)
  Title                            (entry)
  State Matrix                     (entry)
  Settings                         (cat, dynamic)
  [Properties]                     (Incentive-only; = Ellipsis in open source, line 80)
Atom-Level                         (cat)
  Identifiers                      (cat)
  Properties (built-in)            (cat)
  Settings                         (cat, dynamic)
  [Properties]                     (Incentive-only; = Ellipsis, line 86)
Atom-State-Level                   (cat)
  Properties (built-in)            (cat)
  Settings                         (cat, dynamic)
```

Fixed key sets:
- `keys_atom_identifiers` (`properties_dialog.py:92-95`):
  `model, index, segi, chain, resi, resn, oneletter, name, alt, ID, rank`
- `keys_atom_builtins` (`properties_dialog.py:96-103`):
  `elem, q, b, type, formal_charge, partial_charge, numeric_type, text_type,
  vdw, ss, color, reps, flags, label, cartoon, protons, geom, valence, elec_radius`
  — note `stereo` is deliberately commented out to avoid stereo auto-assignment
  errors (`properties_dialog.py:98-99`).
- `keys_astate_builtins` (`properties_dialog.py:104`): `state, x, y, z`

Disabled (read-only) rows: `model`, `index`, `state`, `oneletter`
(`properties_dialog.py:114-117`).

Display formatting (`strfunctions`, `properties_dialog.py:11-15`):
`color` -> `hex()` when `>= 0x40000000` else `str()`; `reps` -> `bin()`;
`flags` -> `bin()`.

### 2.3 Data sources (getters)

| tree row | getter | source |
| --- | --- | --- |
| object list in combo | `cmd.get_object_list()` | `properties_dialog.py:37-41`, API `modules/pymol/querying.py:131` |
| initial state | `cmd.get_state()` | `properties_dialog.py:123` |
| TTT Matrix | `cmd.get_object_ttt(model)` | `properties_dialog.py:388`, API `querying.py:102-119` |
| Object Settings | `cmd.get_object_settings(model, 0)` | `properties_dialog.py:290`, API `querying.py:121-128` |
| Object-State Settings | `cmd.get_object_settings(model, state)` | `properties_dialog.py:375` |
| Title | `cmd.get_title(model, state)` | `properties_dialog.py:368-369`, API `querying.py:176` |
| State Matrix | `cmd.get_object_matrix(model, state, 0)` | `properties_dialog.py:370-373`, API `querying.py:89-99` |
| atom fields | `cmd.iterate('pk1', 'update_atom_fields(locals())', space=...)` | `properties_dialog.py:351-352` |
| atom-state fields | `cmd.iterate_state(state, 'pk1', 'update_astate_fields(locals())', ...)` | `properties_dialog.py:355-357` |
| atom settings | the `s` namespace wrapper inside `iterate` | `properties_dialog.py:295-300`, `316`, `322` |
| ranges | `cmd.count_atoms('?'+model)`, `cmd.count_states('?'+model)` | `properties_dialog.py:391-392` |
| pk1 sync | `cmd.iterate('?pk1', 'pk1_atom[:] = [model, index]', space=...)` | `properties_dialog.py:324-328` |
| selection existence | `cmd.get_names('selections')` | `properties_dialog.py:407` |

Setting names are humanized through `pymol.setting.name_dict`
(`properties_dialog.py:8`, `291`, `298`; built at `modules/pymol/setting.py:39-42`
from `_cmd.get_setting_indices()`).

The dialog **drives the picked atom**: `update_pk1` calls
`cmd.edit((model, index))` whenever the object/state/index inputs change
(`properties_dialog.py:330-341`); a `pymol.CmdException` there is swallowed and
returns `False`.

### 2.4 Effects (setters), triggered from `item_changed` (`properties_dialog.py:150-227`)

| edited row | call |
| --- | --- |
| TTT Matrix | `cmd.set_object_ttt(model, new_value)`; `ValueError`/`IndexError` -> treated as failure (`properties_dialog.py:166-171`); API `modules/pymol/editing.py:2219` |
| Title | `cmd.set_title(model, state, new_value)` (`:172-173`; API `editing.py:2194`) |
| State Matrix | `cmd.matrix_reset(model, state)` then `cmd.transform_object(model, safe_eval(new_value), state)` (`:174-180`; API `editing.py:2464`, `editing.py:2344`) |
| Object Settings child | `cmd.set(key, new_value, model, quiet=0)` inside `PopupOnException()` (`:181-183`) |
| Object-State Settings child | `cmd.set(key, new_value, model, state, quiet=0)` (`:184-186`) |
| Object-State Properties child | `cmd.set_property(key, new_value, model, state, quiet=0)` (`:187-188`; Incentive-only path, API `modules/pymol/properties.py:123`) |
| Atom Properties child | `cmd.alter('pk1', 'p.<key> = get_new_value(p.<key>)', 0, space)` (`:192-193`, `215-222`) |
| Atom Settings child | same with `s.<key>` (`:194-195`) |
| Atom-State Settings child | `cmd.alter_state(state, 'pk1', 's.<key> = ...')` (`:196-198`, `219-220`) |
| Atom-state builtins (`state/x/y/z`) | `cmd.alter_state(...)` (`:199-200`) |
| all other atom fields | `cmd.alter('pk1', '<key> = get_new_value(<key>)', 0, space)` (`:215-222`) |

**Type coercion** is done inside the injected `get_new_value(old_value)` closure
(`properties_dialog.py:202-213`): tuple/list/bool -> `cmd.safe_eval(text)`;
int -> `int(text, 0)` (so `0x...` and `0b...` literals work for `color`/`reps`/`flags`);
otherwise `type(old_value)(text)`; a `ValueError` falls through to
`text.encode('utf-8')` so PyMOL can retype user properties. Errors are surfaced
via `PopupOnException` (a modal `QMessageBox.Critical` with a detailed traceback,
`modules/pymol/Qt/utils.py:323-360`). On any failure the whole tree is reloaded
(`properties_dialog.py:224-225`).

**Unset / Delete key** (`eventFilter`, `properties_dialog.py:278-286`): pressing
`Delete` in the tree calls `unset_caller` -> `unset_item` on the first selected
item (`properties_dialog.py:229-276`):

| row | unset action |
| --- | --- |
| TTT Matrix | `cmd.matrix_reset(model, mode=1)` (`:246-247`) |
| Title | `cmd.set_title(model, state, '')` (`:248-249`) |
| State Matrix | `cmd.matrix_reset(model, state, mode=2)` (`:250-251`) |
| Object Setting | `cmd.unset(key, model, quiet=0)` (`:252-253`) |
| Object-State Setting | `cmd.unset(key, model, state, quiet=0)` (`:254-255`) |
| Object-State Property | `cmd.set_property(key, None, model, state, quiet=0)` (`:256-257`) |
| Atom Property | `cmd.alter('pk1', 'p.<key> = None', 0)` (`:258-261`) |
| Atom Setting | `cmd.alter('pk1', 's.<key> = None', 0)` (`:262-265`) |
| anything else | no-op, returns False (`:266-267`) |
Empty value -> no-op (`:242-244`).

**Re-entrancy guards:** `item_changed_skip` flag (`properties_dialog.py:50`,
`155-156`, set/cleared around every programmatic tree update) and the
`@suspendable` decorator on `update_treewidget_model` with the
`FunctionSuspender` context manager (`properties_dialog.py:21-35`, `380`, `410`)
so that repopulating the combo does not trigger a reload storm.

**Visibility rules** (`update_treewidget_model`, `properties_dialog.py:394-401`):
state spinbox range `[1, count_states]`, index spinbox range `[1, count_atoms]`;
`Atom-Level` and `Atom-State-Level` hidden when `natoms == 0`; `Object-State-Level`
hidden when `nstates == 0`. `Atom-Level` / `Atom-State-Level` are additionally
*disabled* when the corresponding `iterate` returns 0 (`properties_dialog.py:353`,
`358`).

---

## 3. Scene Panel (`modules/pmg_qt/scene_bin_gui.py`, 397 lines)

Plain `QWidget` (`scene_bin_gui.py:29-45`), windowTitle "Scene Panel",
`resize(365, 700)` in `__init__` then `resize(300, height)` again in
`_format_condensed_widget` (`scene_bin_gui.py:212`). Minimum widths: table 275,
panel 375 (`scene_bin_gui.py:210-211`). Modeless singleton.

### 3.1 Widgets

| widget | text | wiring |
| --- | --- | --- |
| `instructionLabel` (QLabel) | "Double click selected thumbnail to \nload into Workspace." | `scene_bin_gui.py:64-67` |
| `addSceneButton` (QPushButton) | "Add Scene" | -> `_add_scene` (`:97`) |
| `sceneTableWidget` (QTableWidget) | — | row-selection mode, movable vertical header sections, event filter on viewport (`:74-83`) |
| `updateButton` (QPushButton) | "Update Scene" | -> `_update_scene`, disabled until selection (`:91-94`, `:99`) |
| `deleteButton` (QPushButton) | "Delete Scene" | -> `_delete_scene`, disabled until selection (`:86-89`, `:98`) |

Enum column layout `SceneTableColumn` (`scene_bin_gui.py:16-21`):
`NAME=0, IMAGE=1, MESSAGE=2, ACTIONS=3`. `SceneDictIndex`
(`scene_bin_gui.py:10-13`): `QPIXMAP=0, MESSAGE=1, ACTIONS=2`.
Header labels actually shown: `['Name', 'Scene Preview']` with
`setColumnCount(2)` (`scene_bin_gui.py:213-215`) — so the MESSAGE and ACTIONS
items written at `scene_bin_gui.py:143-148` are **silently dropped**. Row height
is fixed at 100 px (`scene_bin_gui.py:130`). Vertical header items are set to a
20-pt `↕` (U+2195) glyph as drag handles (`_set_vertical_headers`,
`scene_bin_gui.py:231-242`); the last column stretches
(`_format_table`, `scene_bin_gui.py:223`).

### 3.2 Data source

- `cmd.get_scene_list()` -> `_cmd.get_scene_order()` (`scene_bin_gui.py:244-251`;
  API `modules/pymol/viewing.py:919-921`).
- `cmd.get_scene_thumbnail(name)` -> raw PNG bytes loaded into a `QPixmap`
  (`scene_bin_gui.py:183-192`; API `viewing.py:923-925`; C
  `layer4/Cmd.cpp:1159-1173`, backed by `MovieSceneGetThumbnail`,
  `layer3/MovieScene.cpp:45`).
- Message and actions columns are **hardcoded placeholders**
  `'This is a base message'` / `'Rock, zoom, something'`
  (`scene_bin_gui.py:170-171`). The real APIs exist and are unused here:
  `cmd.get_scene_message(name)` / `cmd.set_scene_message(name, message)`
  (`modules/pymol/viewing.py:927-933`).

### 3.3 Effects

| action | call | source |
| --- | --- | --- |
| Add Scene | `cmd.scene('new', 'append', quiet=0)` then repopulate + `scrollToBottom()` | `scene_bin_gui.py:253-260` |
| Update Scene | `cmd.scene(name, 'update')` + refresh that thumbnail | `scene_bin_gui.py:262-274` |
| Delete Scene | `cmd.scene(name, 'clear')` (aliased to `delete` in `viewing.py:1099-1100`) | `scene_bin_gui.py:276-290` |
| Double-click row | `cmd.scene(name, 'recall')` | `scene_bin_gui.py:100`, `292-299` |
| Rename (edit NAME cell) | `cmd.scene(old, 'rename', new_key=new)` | `scene_bin_gui.py:360-377` |
| Reorder (drag vertical header) | `cmd.scene_order(' '.join(names))` | `scene_bin_gui.py:379-388`; API `viewing.py:961` |

`cmd.scene` full signature: `scene(key='auto', action='recall', message=None,
view=1, color=1, active=1, rep=1, frame=1, animate=-1, new_key=None, hand=1,
quiet=1, sele="all")` (`modules/pymol/viewing.py:1034-1036`). Actions:
`store, recall, insert_after, insert_before, next, previous, update, rename,
clear` (`viewing.py:1055-1057`); `append`/`update` alias to `store`
(`viewing.py:1101-1102`).

### 3.4 Validation & refresh model

- Rename validation (`_rename_scene`, `scene_bin_gui.py:360-377`): rejects names
  containing a space ("Scene names with spaces are not supported") and blank names
  ("Blank scene names are not allowed") — both only `print()` to the console and
  revert the table. No modal error.
- Reorder detection is heuristic: `_check_table_state` (`scene_bin_gui.py:339-349`)
  diffs the model order against `cmd.get_scene_list()`, and only calls
  `_reorder_scenes` if **more than one** position differs — that is how it
  disambiguates "drag" from "rename".
- `_compare_scene_lists` (`scene_bin_gui.py:309-318`) compares positionally over
  `min(len)` and returns `[old, new]` pairs.
- `_get_table_scene_list` (`scene_bin_gui.py:320-337`) derives order from
  `rowViewportPosition(row)/100` (hardcoded to the 100 px row height) and sorts by it.
- `eventFilter` (`scene_bin_gui.py:102-113`) is installed on the table **viewport**
  and reacts to raw numeric event types: `12` (paint) -> `_check_table_state()`
  on **every repaint**, `24` (window-activate) -> full `_populate_data()`.
  This is a polling design and is the main thing to replace with a proper event
  subscription on the web side.
- `_selection_changed` (`scene_bin_gui.py:351-358`) enables/disables the Delete and
  Update buttons.
- `_update_scene_dict` (`scene_bin_gui.py:154-181`) builds/prunes the cache and,
  note, appends a 4th element (`scene_position`) to a list whose enum only defines
  three indices (`scene_bin_gui.py:172-174`).

---

## 4. Keyboard Shortcut Menu (`modules/pmg_qt/shortcut_menu_gui.py`, 415 lines)

`QWidget` with `Qt.WindowType.Window`, `resize(700,700)`, windowTitle
"Keyboard Shortcut Menu" (`shortcut_menu_gui.py:50-72`). Modeless singleton.

### 4.1 Widgets

| widget | text / behaviour | source |
| --- | --- | --- |
| `filter_le` (QLineEdit) | placeholder "Filter"; `textChanged` -> `proxy_model.setFilterRegularExpression` | `:81-84` |
| `refresh_button` (QPushButton) | icon `$PYMOL_DATA/pmg_qt/icons/refresh.svg`, tooltip "Refresh the table to reflect any external changes" -> `refresh_populate` | `:86-95` |
| `table` (QTableView) | model = `QSortFilterProxyModel` over `QStandardItemModel`, case-insensitive, `filterKeyColumn = -1` (all columns) | `:66-70`, `:98-100` |
| `create_new_button` | "Create New", tooltip "Add a key binding that does not currently appear on the table" -> shows `create_shortcut` dialog | `:109-115` |
| `delete_selected_button` | "Delete Selected", tooltip "Unbind selected key bindings and remove any that have been created", disabled w/o selection | `:117-123` |
| `reset_selected_button` | "Reset Selected", tooltip "Restore selected key bindings to their default values", disabled w/o selection | `:125-131` |
| `reset_all_button` | "Reset All", tooltip "Restore all key bindings to their default values and remove any that have been created" | `:133-138` |
| `save_button` | "Save", tooltip "Save the current key bindings to be loaded automatically when opening PyMOL" -> `ShortcutManager.save_shortcuts` | `:140-145` |

Table columns: `['Key', 'Command (click to edit)', 'Description']`
(`shortcut_menu_gui.py:162-163`). Only column 1 (Command) is editable in practice —
the Key item is `ItemIsEnabled` only (`:169`); the Description item is created with
`ItemIsEditable` (`:170`) but `itemChanged` ignores anything but column 1 (`:401`).
`formatTable` hides the vertical header and auto-sizes columns
(`shortcut_menu_gui.py:381-391`).

### 4.2 Sub-dialogs loaded via `load_form` (`shortcut_menu_gui.py:62-64`)

**`forms/create_shortcut.ui`** — `QDialog` "Create Shortcut", fixed 235x104, modeless:
- `keyLabel` "Key:", `keyEdit` (QLineEdit, **readOnly**, placeholder "Press Key")
- `commandLabel` "Command:", `commandEdit` (QLineEdit, placeholder "Type Command")
- `helpButton` "Help" (`setDefault(False)`, `setAutoDefault(False)`,
  `shortcut_menu_gui.py:282-283`) -> shows `help_shortcut`
- `createButton` "Create Shortcut" -> `create_new_shortcut_caller`

`keyEdit` has an event filter (`shortcut_menu_gui.py:285-299`) that captures raw
key presses and converts them to PyMOL key syntax:
- `keyevent_to_string` (`:301-315`) — joins modifier names from
  `_SHORTCUT_MODIFIER_MAP` (`:25-30`) with the key name from `_SHORTCUT_KEY_MAP`
  (a reverse map of every `Qt.Key` enum member, built at `:15-23`).
- `process_keyevent_string` (`:317-344`) — normalizes to PyMOL prefixes:
  `Control`/`Meta` -> `CTRL`, `Control+Shift` -> `CTSH`, `Alt` -> `ALT`,
  `Shift` -> `SHFT`; and remaps special names through `_REPLACE_KEYS`
  (`:32-42`: PageUp->pgup, PageDown->pgdn, Home->home, Insert->insert,
  Up->up, Down->down, Left->left, Right->right, End->end). Result is joined
  with `-` (e.g. `CTRL-F5`).
- Keys in `ShortcutManager.reserved_keys` are swallowed and never displayed
  (`shortcut_menu_gui.py:293-294`); reserved set is
  `('CTRL-S','CTRL-E','CTRL-O','CTRL-M','up','down')`
  (`modules/pymol/shortcut_manager.py:21`).

**`forms/help_shortcut.ui`** — `QDialog` "Shortcut Help", 622x366:
`label` "Creating New Shortcuts" (16 pt), a horizontal `Line`, and a
`QTextBrowser textBrowser` with static HTML listing the reserved keys
(CTRL-S/E/O/M), the assignable key space (F1..F12; left, right, pgup, pgdn,
home, insert; CTRL-A..CTRL-Z; ALT-0..ALT-9, ALT-A..ALT-Z) and the note that
multiple python commands may be chained with `;`
(`forms/help_shortcut.ui:64-83`).

**`forms/change_confirm.ui`** — `QDialog` "Confirm Changing Existing Binding",
**`windowModality = Qt::ApplicationModal`** (the only modal .ui form in the tree),
fixed 412x90:
- `label` "Are you sure you want to change this existing key binding?" (centered)
- `doNotShowCheckBox` "Don't show this again"
- `cancelButton` "Cancel" -> hide (`shortcut_menu_gui.py:355-356`)
- `confirmButton` "Confirm" -> `create_new_shortcut(confirm_new_key, confirm_new_binding)`
  + `populateData()` + hide (`shortcut_menu_gui.py:350-354`)

**`forms/shortcut_menu.ui`** — `QDialog` 340x380 with `shortcutTable` (QTableWidget)
and buttons `showAllButton` "Show All", `showBasicButton` "Show Basic",
`addNewButton` "Add New". **Dead file**: grep over the whole repo finds no
reference to `shortcut_menu.ui`, `shortcutTable`, `showAllButton`,
`showBasicButton` or `addNewButton` outside the .ui itself. Treat as an abandoned
earlier design; do not port unless product wants it.

### 4.3 Backing model (`modules/pymol/shortcut_manager.py`, `modules/pymol/shortcut_dict.py`)

- `ShortcutIndex` enum: `COMMAND=0, DESCRIPT=1, USER_DEF=2`
  (`shortcut_manager.py:8-11`).
- `cmd.shortcut_dict` is a deep-ish copy of `shortcut_dict_ref`
  (`shortcut_manager.py:18`), the canonical default table in
  `modules/pymol/shortcut_dict.py:11-136` — **135 default bindings**, covering
  `left/right/pgup/pgdn/home/end/insert`, their `SHFT-`/`CTRL-`/`ALT-`/`CTSH-`
  variants, `CTRL-A/C/F/H/I/L/T/V/X/Y/Z`, `ALT-0..9`, `ALT-A..Z` (fragment and
  amino-acid attach commands), `CTSH-A..Z` (editing/replace commands), and
  `CTRL-F1..F12` / `CTSH-F1..F12` (scene store).
- `get_default_keys` (`modules/pymol/keyboard.py:87-93`) projects
  `shortcut_dict_ref` to `{key: default_command}`.
- `check_saved_dict` (`shortcut_manager.py:23-31`) merges the user file into the
  table; `check_key_mappings` (`:33-68`) reconciles three sources —
  `cmd.key_mappings` (live), `default_bindings`, `cmd.shortcut_dict` — marking
  mismatches as user-defined, empty mappings as `'Deleted'`, and creating rows for
  keys bound with `cmd.set_key` outside the GUI.
- Persistence: `save_shortcuts` (`shortcut_manager.py:70-76`) prunes unused keys
  (`remove_unused`, `:78-88`) then JSON-dumps to `~/.pymol/shortcuts_save.json`
  (`modules/pymol/save_shortcut.py:6`, `18-36`). Load on startup:
  `load_and_set` (`save_shortcut.py:65-71`) called from
  `pymol_qt_gui.py:419` and passed into the dialog at `pymol_qt_gui.py:888`.
- `reset_all_default` (`shortcut_manager.py:90-116`) re-`set_key`s everything,
  supports both string and `(fn, args, kwargs)` tuple bindings, deletes keys with
  no default from both `shortcut_dict` and `cmd.key_mappings`, prints
  "Restored default keybindings".
- `create_new_shortcut` (`shortcut_manager.py:118-139`) wraps `cmd.set_key` in
  try/except printing "This cannot be bound." / "This key is reserved.".

### 4.4 Row-level actions

- **Edit command cell** (`itemChanged`, `shortcut_menu_gui.py:393-415`):
  `cmd.set_key(key, text)` + write `shortcut_dict[key][2]`; description column is
  set to `'user defined'` **only when no filter is active** (`:408-411`) — a known
  wart, because the proxy model row index differs from the source row index.
  Rows whose text is `"Deleted"` are skipped (`:401`).
- **Delete Selected** (`:219-245`): `cmd.set_key(key, '')`; keys that have a
  default become the literal string `"Deleted"` in both value columns, keys
  without a default are removed from the model *and* from `shortcut_dict`, with a
  console message `"<key>  has been deleted and will be removed from the table"`.
  Note it iterates over `selectedIndexes()`, i.e. once per selected **cell**.
- **Reset Selected** (`:247-274`): restores the default command/description and
  re-`set_key`s; prints "This key does not have a default value." otherwise.
- **Reset All** (`:211-217`), **Save** (`:145`), **Refresh** (`:204-209`,
  re-runs `check_key_mappings` then `populateData`).
- `intial_populate` (`:195-202`) runs `check_saved_dict` + `check_key_mappings`
  once at open.
- After each `populateData` the selection model is re-connected
  (`shortcut_menu_gui.py:188`) — repeated connects accumulate.

### 4.5 `cmd.set_key` contract (validation the web UI must mirror)

`modules/pymol/controlling.py:719-796`:
- `key.rpartition('-')` -> modifier must be in
  `internal.modifier_keys = ['', 'SHFT', 'CTRL', 'CTSH', 'ALT']`
  (`modules/pymol/internal.py:390-396`), else
  `CmdException("not a valid modifier key: '<mod>'.")`.
- Multi-char patterns not starting with `F` are lowercased and must be in
  `internal.special_key_names` (derived from `special_key_codes`,
  `internal.py:398-425`: `F1..F12`, `left, up, right, down, pgup, pgdn, home,
  end, insert`), else `CmdException("special '<pat>' key not found.")`.
- Single character with no modifier -> `CmdException("Can't map regular letters.")`;
  with `SHFT` -> `CmdException("Can't map regular letters with SHFT.")`.
- Stores into `cmd.key_mappings[key]`, value is either a command string or a
  `(fn, args, kwargs)` tuple. Dispatch at runtime: `internal._invoke_key`
  (`internal.py:426-445`) and `internal._special` (`internal.py:447-...`).
- Qt->PyMOL key translation for the *viewport* lives in
  `modules/pmg_qt/keymapping.py:10-97` (`keyMap`, `specialMap`,
  `keyPressEventToPyMOLButtonArgs`, modifier mask 0x1 Shift / 0x2 Ctrl-or-Meta /
  0x4 Alt) — the web client needs the same mapping to forward viewport keys.

---

## 5. Advanced Settings (`modules/pmg_qt/advanced_settings_gui.py`, 99 lines)

`QWidget` with `Qt.WindowType.Window`, `setMinimumSize(400, 500)`, windowTitle
"PyMOL Advanced Settings" (`advanced_settings_gui.py:13-23`). Modeless singleton.

Widgets:
- `filter_le` (QLineEdit, placeholder "Filter") ->
  `proxy_model.setFilterRegularExpression` (`:25-28`)
- `table` (QTableView) over `QSortFilterProxyModel`/`QStandardItemModel`
  (`:18-20`, `:32-34`); both headers hidden, columns auto-sized
  (`formatTable`, `:69-80`)

Rows (`populateData`, `:40-67`): every setting name from
`sorted(setting.get_name_list())` (`modules/pymol/setting.py:80-81`, backed by
`_cmd.get_setting_indices()` at `setting.py:39`). For each name:
`index = setting._get_index(name)` (`setting.py:63-70`),
`v_type, v_list = cmd.get_setting_tuple(index)`
(`modules/pymol/setting.py:413-418`).

Rendering by type (constants at `modules/pymol/setting.py:19-26`):

| `v_type` | constant | widget |
| --- | --- | --- |
| 1 | `cSetting_boolean` | checkable item, text not editable, checked from `v_list[0]` (`:56-60`) |
| 2, 6 | `cSetting_int`, `cSetting_string` | text item `str(v_list[0])` (`:61-62`) |
| 3, 4, 5 | `cSetting_float`, `cSetting_float3`, `cSetting_color` | text item from `cmd.get(index)` (`:63-64`) |

Name column is `ItemIsEnabled` only — read-only (`:54`). The setting index is
stashed on the value item via `value_item.setData(index)` (default role), read
back in `itemChanged` (`:90-94`, with a legacy `.toInt()[0]` PyQt4 branch that is
now dead).

Effect (`itemChanged`, `:82-99`):
- checkable -> `cmd.set(index, checked, log=1, quiet=0)`
- otherwise -> `cmd.set(index, item.text(), log=1, quiet=0)`
`log=1` means the change is echoed into the PyMOL log file; `quiet=0` prints to
the feedback browser. **No validation, no error handling** — a bad value raises
inside `cmd.set` and only prints. **No refresh** — the table never re-reads values
after opening, so settings changed from the command line go stale.

---

## 6. Text Editor (`modules/pmg_qt/TextEditor.py`, 195 lines)

`QMainWindow`, `sizeHint` 600x400 (`TextEditor.py:18-21`), default title
"Text Editor" (`:111`), retitled to `"<basename> (<dirname>)"` once a file is open
(`:44-46`). Modeless, one instance per invocation (not cached).

Menus (`TextEditor.py:119-136`):
- **File**: `Open` (Ctrl+O) -> `doOpen`; `Save` (Ctrl+S) -> `doSave`;
  `Save as ...` (Ctrl+Shift+S) -> `doSaveAs`
- **Syntax**: exclusive `QActionGroup` of checkable actions
  `Python` / `PML` / `Plain Text` (keys `python`, `pml`, `plain`) ->
  `setSyntax(key)`

Central widget: `QPlainTextEdit` with `getMonospaceFont()`
(`modules/pymol/Qt/utils.py:249-267`: Monaco+3 on darwin, Consolas on win32,
Monospace elsewhere) and `connectFontContextMenu` (`Qt/utils.py:204-226`) which
adds a "Select Font..." entry (non-native `QFontDialog`) to the standard context
menu. So the editor also has a **right-click context menu**:
Undo/Redo/Cut/Copy/Paste/Delete/Select All (Qt standard) + separator +
"Select Font...".

Behaviour:
- `_open(filename)` (`:28-46`): reads the file if it exists, otherwise starts
  empty; auto-selects syntax by extension — `.py` -> python, `.pml` or a name
  ending in `pymolrc` -> pml, else plain.
- `setSyntax(filetype='plain')` (`:48-60`): checks the menu action, detaches the
  old highlighter, imports `pmg_qt.syntax.<filetype>` and instantiates
  `Highlighter(self.text.document())`. Available modules:
  `modules/pmg_qt/syntax/python.py` (147 lines),
  `modules/pmg_qt/syntax/pml.py` (119 lines, `class Highlighter` at
  `syntax/pml.py:30`, uses `syntax/pmlparser.py:parse_pml`). There is **no**
  `syntax/plain.py`, so `setSyntax('plain')` hits the `ImportError` branch and
  simply leaves the document unhighlighted (`TextEditor.py:57-58`).
- `doSaveAs` (`:69-77`): `QFileDialog.getSaveFileName` starting in the current
  file's directory; writes and re-points `self.filename`.
- `doSave` (`:79-83`): falls back to Save-As when there is no filename.
- `doOpen` (`:85-91`): `check_ask_save()` gate, then
  `QFileDialog.getOpenFileNames`, opens `fnames[0]` only.
- `check_ask_save` (`:93-103`): if the buffer differs from `_savedcontent`,
  a **modal** `QMessageBox.question` "Save?" / "Save changes?" with
  Yes / No / Cancel (default Yes); Cancel aborts the operation.
- `closeEvent` (`:105-109`): same gate; `event.ignore()` on Cancel.

`edit_pymolrc(app)` (`TextEditor.py:150-166`): reads
`pymol.invocation.options.pymolrc`; when 2+ rc files are active it first shows a
modal `QInputDialog.getItem` "Select pymolrc file" / "Active pymolrc files:".
`_edit_pymolrc` (`:168-185`): if the list is empty, proposes
`$HOMEDRIVE$HOMEPATH\pymolrc.pml` (win) or `$HOME/.pymolrc` (posix) through a
modal `QInputDialog.getText` "Create new pymolrc?" / "Filename of new pymolrc",
then opens a `TextEditor`.

---

## 7. Full `modules/pmg_qt/forms/` inventory

20 `.ui` files. Forms outside this area (file/save/render/plugin dialogs) are
listed for completeness with their widget names, since they define dialogs not
obvious from the `.py` files; the owning agent for `file_dialogs.py` /
`pymol_qt_gui.py` should take the behaviour.

| file | top class / name | windowTitle | modality | consumer |
| --- | --- | --- | --- | --- |
| `askpartial.ui` | QDialog `Dialog` | Load Session | (default modeless) | `file_dialogs.py:84` |
| `change_confirm.ui` | QDialog `Dialog` | Confirm Changing Existing Binding | **Qt::ApplicationModal** | `shortcut_menu_gui.py:64` |
| `colors.ui` | QWidget `Form` | Colors | — | `pymol_qt_gui.py:548` |
| `create_shortcut.ui` | QDialog `Dialog` | Create Shortcut | — | `shortcut_menu_gui.py:62` |
| `fetch.ui` | QWidget `Form` | Get PDB File | — | `file_dialogs.py:445` |
| `help_shortcut.ui` | QDialog `Dialog` | Shortcut Help | — | `shortcut_menu_gui.py:63` |
| `load_aln.ui` | QWidget `Form` | Load Alignment | — | `file_dialogs.py:249` |
| `load_mae.ui` | QWidget `Form` | Maestro File Import | — | `file_dialogs.py:286` |
| `load_map.ui` | QWidget `Form` | Map Import | — | `file_dialogs.py:337` |
| `load_mtz.ui` | QDialog `Dialog` | Reflection File Import | — | `file_dialogs.py:165` |
| `load_traj.ui` | QWidget `Form` | Trajectory Import | — | `file_dialogs.py:111` |
| `movieexport.ui` | QWidget `Form` | Movie Export | — | `file_dialogs.py:692` |
| `pluginitem.ui` | QWidget `Form` | Form | — | `pymol/plugins/managergui_qt.py:226` |
| `pluginmanager.ui` | QWidget `Form` | Plugin Manager | — | `pymol/plugins/managergui_qt.py:42` |
| `png.ui` | QWidget `Form` | Save PNG image | — | `file_dialogs.py:609` |
| `props.ui` | QWidget `Form` | Properties Inspector | — | `properties_dialog.py:47` |
| `render.ui` | QWidget `Form` | Form | — | `pymol_qt_gui.py:674` |
| `save_molecule.ui` | QWidget `Form` | Save Molecule | — | `file_dialogs.py:520` |
| `save_object.ui` | QWidget `Form` | (none) | — | `file_dialogs.py:823` |
| `shortcut_menu.ui` | QDialog `Dialog` | Dialog | — | **unused (dead)** |

### 7.1 Widget lists (as declared in the XML)

- **askpartial.ui**: `label` ("The current PyMOL window has a session in progress. How do you want to proceed?"), `check_discard` (QRadioButton "&Discard current session", checked), `label_3`, `check_partial` (QRadioButton "&Merge with current session (partial load)", tip `partial=1`), `label_2`, `check_rename` (QCheckBox "Automatically rename duplicate objects", tip `auto_rename_duplicate_objects (global setting)`), `check_new` (QRadioButton "Open &in new PyMOL Window"), `label_4`, `buttonBox` (QDialogButtonBox).
- **change_confirm.ui**: `label`, `doNotShowCheckBox`, `confirmButton`, `cancelButton` (see §4.2).
- **colors.ui**: `list_colors` (QListWidget), `frame_color` (QFrame swatch), `input_name` (QLineEdit) + `label_4` "Name", `input_R/G/B` (QDoubleSpinBox max 1.0 step 0.01) + `label`/`label_2`/`label_3` "Red"/"Green"/"Blue", `slider_R/G/B` (QSlider max 100), `button_apply` ("Apply").
- **create_shortcut.ui**: `keyLabel`, `keyEdit` (readOnly, "Press Key"), `commandLabel`, `commandEdit` ("Type Command"), `helpButton`, `createButton`.
- **fetch.ui**: `label` (fetch_path hyperlink note), `label_2` "PDB ID:", `input_code` (QLineEdit, "4 letter PDB code"), `input_check_pdb` (checked), `input_check_2fofc`, `input_check_fofc`, `input_name`, `input_name_2fofc`, `input_name_fofc` (all "Object name (optional)"), `groupBox` "PDB Structure Options", `label_3` "Chain name (optional):", `input_chain` (editable QComboBox), `label_4` "Assembly (optional):", `input_assembly` (editable QComboBox), `groupBox_2` "This will run the following command", `output_command` (QLabel "fetch ..."), `button_ok` ("Download").
- **help_shortcut.ui**: `label`, `line`, `textBrowser`.
- **load_aln.ui**: `label_column_input` ("PyMOL Object"), `button_cancel` ("Cancel"), `button_ok` ("Load"). Note: the object-column widgets are generated at runtime in `file_dialogs.py`, not in the XML.
- **load_mae.ui**: `input_mimic` (checked, "Use settings to match cartoon/ribbon color and ballstick style"), `label_3` "Object/group name" + `input_object_name`, `label` "Object properties" + `input_object_props` (default `*`), `label_2` "Atom properties" + `input_atom_props` (default `*`), `label` "Multiple entries" + `input_multiplex` (QComboBox: "automatic handling", "as one multi-state object (trajectory)", "as one multi-state object (discrete states)", "as separate objects"), `groupBox_2` + `output_command`, `button_ok` ("Load").
- **load_map.ui**: `groupBox_3` "Map Object" [`input_object_name`, `input_normalize` (checked), `label` normalization caveat], `groupBox` "Representation" [`label_2` "se&lection" + `input_selection` (editable combo: (blank), enabled, sele, center), `label_3` "b&uffer" + `input_buffer` (default 2.0), `check_carve`, `label_4` "level" + `input_level` (min -99, default 1.0, 4 decimals, step 0.1), `check_volume` + `input_name_volume`, `check_isosurface` + `input_name_isosurface`, `check_isomesh` + `input_name_isomesh`], `groupBox_2` + `output_command`, `button_ok`.
- **load_mtz.ui**: `groupBox` "Column Labels" [`label_4` "Amplitudes" + `input_amplitudes`, `label_5` "Phases" + `input_phases`, `label_6` "Weights" + `input_weights` — all QComboBox], `groupBox_2` "Resolution" [`label` "Low" + `input_reso_min` (50.0), `label_2` "High" + `input_reso_max` (1.0)], `groupBox_3` "Map Options" [`label_3` "New Map Name Prefix" + `input_prefix`], `buttonBox`.
- **load_traj.ui**: `groupBox` "Target Object" [`label` + `input_object` (combo), `label_3` "State" + `input_state` (max 999, default 1, tip "Append if state=0")], `groupBox_3` "Frames" [`input_start` (1..99999, 1), `input_stop` (-1..99999, -1, tip "Load entire trajectory if stop < 1"), `input_interval` (min 1)], `groupBox_4` "Memory Optimization" [`input_dbm3` "defer_builds_mode=3 (don't keep geometry for other states in memory)"], `groupBox_2` + `output_command`, `button_ok`.
- **movieexport.ui**: `group_format` "Movie Format" [`label` "E&ncoder" + `input_encoder` (blank, ffmpeg, mpeg_encode, convert), `label_quality` + `input_quality` (60..100, default 90, suffix %), radios `format_mp4`, `format_mpg`, `format_mov`, `format_gif`, `format_png` (checked)], `label_2` "Wid&th" + `input_width` (max 9999), `label_3` "Hei&ght" + `input_height`, `label_7` "Common:" + `button_720p`/`button_480p`/`button_360p`, `group_mode` "Rendering" [`input_draw` (checked), `input_ray`], `button_ok` (QCommandLinkButton "Save Movie as ...").
- **pluginitem.ui**: `w_title`, `w_version`, `w_loadtime`, `w_info` ("Info"), `w_enable` ("Load"), `w_startup` ("Load on startup"), `w_settings` ("Settings"), `w_uninstall` ("Uninstall").
- **pluginmanager.ui**: `tabWidget` with 4 tabs — tab1 (`e_filter`, `c_loaded`, `c_startup`, `f_installed_scroll`/`f_installed_widget`, `b_startup_all`, `b_startup_none`), tab2 (`groupBox` "Install from local file" + `b_local`; `groupBox_2` "Install from PyMOLWiki or any URL" + `label`, `label_2` "URL:", `e_wiki`, `b_wiki` "Fetch"; `groupBox_3` "Install from Repository" + `l_repositories`, `b_add_repo`, `b_remove_repo`, `l_repo_plugins`, `b_info`, `b_install`), tab3 (`groupBox_4` "Plugin override search path" + `slb_path`, `bb_path_add`, `bb_path_remove`, `bb_path_up`, `bb_path_down`, `label_4` restart notice; `groupBox_5` "Preferences" + `t_preferences`), tab4 (`textBrowser`).
- **png.ui**: `label` (2.0 note), `input_rendering` (QComboBox: "capture current display", "draw antialiased OpenGL image", "ray trace with opaque background", "ray trace with transparent background"), `button_ok` (QCommandLinkButton "Save PNG image as ...").
- **props.ui**: see §2.1.
- **render.ui**: `stack` (QStackedWidget, 2 pages). page_1: `label` "Width" + `input_width` (px, max 99999) + `input_width_units` (suffix cm, max 999), `label_2` "Height" + `input_height`/`input_height_units`, `button_current` ("Reset", tip "Use current viewport size"), `button_lock` ("Lock aspect ratio", checked), `label_5` "Units" + `input_units` (cm/inch), `label_3` "at" + `input_dpi` (editable combo 300/150/90, currentIndex 1) + `label_4` "DPI", `input_transparent` ("transparent background (\"Ray\" only)", checked), `line_2`, `button_draw` ("Draw (fast)"), `label_6` "- or -", `button_ray` ("Ray (slow)"). page_2: `button_save` ("Save Image to File"), `button_clip` ("Copy Image to Clipboard"), `button_back` ("< Back").
- **save_molecule.ui**: `label_2` "Se&lection" + `input_selection` (editable combo: enabled, all), `label` "S&tate" + `input_state` ("-1 (current)", "0 (all states)"), `tabWidget` with 3 tabs — tab_3 (`input_retain_order`), tab_4 (`input_no_pdb_conect_nodup`, `input_pdb_conect_all`, `input_no_ignore_pdb_segi`, `input_pdb_retain_ids`, `input_multisave`), tab (`label_3` "Write objects or states to ...", `input_multi_off` (checked), `input_multi_object` + `input_multi_object_fmt` (`{name}`), `input_multi_state` + `input_multi_state_fmt` (`{name}_{state}`), `input_multi_prompt` (checked)), `button_ok` ("Save...").
- **save_object.ui**: `label` "Object", `input_name` (QComboBox), `button_ok` ("Save...").
- **shortcut_menu.ui**: `shortcutTable`, `showAllButton`, `showBasicButton`, `addNewButton` — dead.

---

## 8. Bridge / API surface required by this area

Getters: `get_volume_histogram`, `volume_color` (getter form) /
`get_volume_color`, `get_object_list`, `get_state`, `get_object_ttt`,
`get_object_settings`, `get_object_matrix`, `get_title`, `count_atoms`,
`count_states`, `get_names('selections')`, `iterate`, `iterate_state`,
`get_scene_list`, `get_scene_thumbnail`, `get_scene_message`,
`get_setting_tuple`, `get`, `setting.get_name_list`, `setting._get_index`,
`setting.name_dict`.

Setters/commands: `volume_color` (setter form), `volume_ramp_new`,
`set_object_ttt`, `set_title`, `matrix_reset`, `transform_object`, `set`,
`unset`, `set_property`, `alter`, `alter_state`, `safe_eval`, `edit`,
`scene`, `scene_order`, `set_scene_message`, `set_key`, plus direct access to
the mutable dicts `cmd.key_mappings` (`controlling.py:795`) and
`cmd.shortcut_dict` (`shortcut_manager.py:18`).

Events the bridge must push (currently done by direct widget calls that will not
exist on the web):
1. volume ramp changed externally -> `colorramping.py:170-179` calls
   `panel.widget().editor.setColors(ramplist)`. Needs a `volume_ramp_changed`
   event keyed by object name.
2. scene list / order / thumbnails changed -> currently discovered by the paint
   and window-activate polling in `scene_bin_gui.py:102-113`. Needs a
   `scenes_changed` event.
3. settings changed from the command line -> Advanced Settings has **no** refresh
   at all today; `pymol_qt_gui.py:110-115` shows the existing
   `setting_callbacks` mechanism (index -> callable) that the bridge should
   generalize.
4. picked atom (`pk1`) changed -> Properties Inspector currently only reads pk1
   on open and on Refresh (`properties_dialog.py:324-328`, `406-415`).

File-system side effects (localhost assumption is required): shortcut persistence
to `~/.pymol/shortcuts_save.json` (`save_shortcut.py:6`), and the Text Editor's
arbitrary read/write of `.py` / `.pml` / `pymolrc` files
(`TextEditor.py:30-32`, `:74-83`).
