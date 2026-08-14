---
name: ui-main-internal
kind: feature
category: ui-gui
subcategory: front-end shell
summary: The PyMOL application shell (Qt main window — menu bar, command line, feedback panel, quick buttons, splash) and the internal OpenGL GUI drawn inside the viewport (object panel with A/S/H/L/C/M menus, movie control + timeline, ButMode line, wizard blocks, in-viewport prompt, selection indicators), reproduced as the React front-end.
parity: implemented
---

# UI: the main window and the internal GUI

PyMOL's user interface is two overlapping surfaces. The **main window** is a Qt
`QMainWindow` (`packages/engine/modules/pmg_qt/pymol_qt_gui.py`) whose menu-bar data model lives in the
toolkit-independent mixin `packages/engine/modules/pymol/_gui.py`. The **internal GUI** is everything PyMOL
draws *itself* inside the OpenGL viewport as 2D "Blocks" — the object panel, movie
transport, timeline, mouse-mode line, wizard panel and the in-viewport command prompt —
laid out by `OrthoLayoutPanel()` (`packages/engine/layer1/Ortho.cpp:2261`).

The tenmol port reproduces both: the shell is `apps/web/src/shell/`, the menu bar
`apps/web/src/features/menubar/`, the console (command line + feedback + in-viewport
prompt) `apps/web/src/features/console/`, the object panel `apps/web/src/features/objects/`,
the ASHLC popup menus `apps/web/src/features/pymol-menu/`, the movie transport/timeline
`apps/web/src/features/movie/`, the mouse-mode block `apps/web/src/features/mouse/`, the
wizard panel `apps/web/src/features/wizards/` and the scene bar
`apps/web/src/features/scenes/`. The engine boots with `internal_gui 0` /
`internal_feedback 0`; the viewport-drawn blocks are re-implemented as React components.

Everything below is grounded in `docs/qt-main-window.md` and `docs/internal-gui.md`, both
read out of unmodified upstream `packages/engine/` at `file:line`.

---

## Main window shell

The window is `PyMOLQtGUI(QMainWindow, PyMOLDesktopGUI)` (`pymol_qt_gui.py:31`). Layout is
`QMainWindow` + dock widgets — there are **no `QSplitter`s**. The central widget is the
OpenGL viewport (`PyMOLGLWidget`, replaced by the three.js canvas in the port); the
"External GUI" is a `QDockWidget` in the top area, and the Builder is another dock. Dock
options are `AllowTabbedDocks | AllowNestedDocks` (`pymol_qt_gui.py:90`). Initial size is
`win_x + (220 if internal_gui)` × `win_y + (246 if external_gui else 18)`, with option
defaults `win_x=640`, `win_y=480` (`invocation.py:144`). The window title tracks the
`session_file` setting (`PyMOL (basename)`, `pymol_qt_gui.py:114`); the base title is
`"PyMOL"`. Full-screen (`Ctrl` via `full_screen`) hides the menubar and the non-floating
ext window, remembering `_ext_window_visible` (`pymol_qt_gui.py:472`). Almost all visual
identity comes from the native Qt theme — the stylesheet `pmg_qt/styles/pymol.sty` has only
three rules — so the React shell has no upstream design source to copy.

### Behaviour
- Central-widget resizes are the only geometry that must be echoed to the backend
  (`cmd.reshape` / `cmd.viewport`); dock area/floating/visible state is pure client state.
- `cmd.viewport w, h` upstream resizes the *window* so the GL area matches
  (`pymolviewport`, `pymol_qt_gui.py:62`); a browser cannot resize its own window, so
  `cmd.viewport` resizes the canvas element and reports the achieved size back.
- Shutdown: `closeEvent → cmd.quit()` (`pymol_qt_gui.py:56`); `File ▸ Quit` just calls
  `QApplication.quit()`. There is **no** unsaved-session confirmation despite the
  `confirm_quit` name.

### Source
`packages/engine/modules/pmg_qt/pymol_qt_gui.py:31`, `docs/qt-main-window.md` §1, §11. Port:
`apps/web/src/shell/AppShell.tsx`. Implemented.

---

## Menu bar

The top menu bar is built from `self.get_menudata(cmd)` (`pymol_qt_gui.py:353`), defined on
the mixin at `_gui.py:55`. It is **not** generated from `pymol/menu.py` (that drives the
viewport right-click menus). Top-level menus: File, Edit, Build, Movie, Display, Setting,
Scene, Mouse, Wizard, Plugin, Help. Every menu is `setTearOffEnabled(True)`.

### Behaviour — the `_addmenu` item grammar (`pymol_qt_gui.py:295`)
| Tuple | Meaning |
|---|---|
| `('separator',)` | `addSeparator()` |
| `('menu', label, [items])` | submenu (`&`→`&&`) |
| `('command', label, callable\|str)` | `str` ⇒ `lambda: cmd.do(str)`; `None` ⇒ prints `warning: skipping` and drops the item |
| `('check', label, setting[, true, false])` | `SettingAction` checkable toggle |
| `('radio', label, setting, value)` | `QActionGroup` keyed **by setting name only** → `cmd.set(name, value, log=1)` |
| `('open_recent_menu',)` | inserts the dynamic Open Recent submenu |

Gotchas the port must decide on: radio `QActionGroup`s are keyed by setting name only, so
two visually separate radio blocks on the same setting share one exclusive group; `None`
commands are silently dropped; tear-off menus have no browser equivalent. Checkable/radio
items stay in sync with the backend via the `cmd.get_setting_updates()` tap, not by local
state. In the port the whole tree is **harvested** from the backend as data (generated into
`apps/web/src/features/menubar/generated/menudata.ts`) rather than re-declared in TS, and
each leaf executes its embedded `cmd.*` string via `cmd.do`.

### Source
`_gui.py:55`, `pymol_qt_gui.py:289`, `docs/qt-main-window.md` §0, §6. Port:
`apps/web/src/features/menubar/`. Implemented.

---

## Open Recent submenu

The one genuinely dynamic menu-bar submenu, inserted by the `('open_recent_menu',)` marker
(`pymol_qt_gui.py:341`) and repopulated on every `aboutToShow`: `clear()`, then one action
per `self.recent_filenames`, label truncated to `'...' + fname[-120:]` when `len >= 128`,
each calling `load_dialog(fname)`.

### Behaviour
Backing store is **sqlite** at `~/.pymol/recent.db`, table
`recent(filename text unique, timestamp integer)` (`_gui.py:986`). `recent_filenames` =
`SELECT filename ORDER BY timestamp DESC`; `recent_filenames_add` uses `REPLACE INTO` and
prunes to the newest 20 rows. Only `session_save_as` calls `recent_filenames_add` in the Qt
file (`pymol_qt_gui.py:671`); `load_dialog` does **not** add to the list. The port keeps this
server-side and binds PyMOL's own unbound helpers so the DB schema/prune behaviour is
unchanged; nothing is mirrored into browser storage.

### Source
`_gui.py:975`, `docs/qt-main-window.md` §6.14, §14. Port:
`packages/bridge/tenmol_bridge/panels/files.py`. Implemented.

---

## External GUI dock

Historically PyMOL had two OS windows (OpenGL "internal" + Tk "external" with menu/command
line/output). In Qt they are merged: the "External GUI" is a `QDockWidget` in
`TopDockWidgetArea` (`pymol_qt_gui.py:184`) holding the feedback panel, the `PyMOL>` command
line, and the quick-button grid.

### Behaviour
- If `options.external_gui` is truthy the dock's title bar is an empty widget (undecorated,
  non-draggable); otherwise the dock is hidden. `-x` sets `external_gui=0`.
- Double-clicking the frame calls `toggle_ext_window_dockable`, swapping between
  titled/floating and untitled/docked. Menu entries `Display ▸ External GUI ▸ Toggle
  dockable` (**`Ctrl+E`**) and `▸ Visible` are appended imperatively after the data-driven
  build (`pymol_qt_gui.py:377`).
- Docking Left/Right re-orients the ext-GUI layout `BottomToTop` and removes the trailing
  stretch (`pymol_qt_gui.py:196`).
- `pymol.gui.ext_hide` / `ext_show` **no-op** (printing "ignoring gui.ext_hide") when a Qt
  window exists; the port keeps them no-ops but still surfaces them so scripts don't error.

### Source
`pymol_qt_gui.py:184`, `pymol/gui.py:44`, `docs/qt-main-window.md` §2. Port:
`apps/web/src/shell/extGuiDock.ts`. Implemented.

---

## Command line

`CommandLineEdit(QLineEdit)` (`pymol_qt_gui.py:1087`), instantiated with
`objectName="command_line"` and prefixed by a `QLabel("PyMOL>")`. Its tooltip documents the
`<TAB>` completion, `color ?` argument help and `help color` idioms.

### Behaviour — key handling (`lineeditKeyPressEventFilter`, `pymol_qt_gui.py:421`)
| Key | Action |
|---|---|
| `Tab` | tab completion (`complete()`) |
| `Up` / `Down` | history back / forward |
| `Ctrl+Up` | history **prefix** back-search |
| `Return`/`Enter` | submit via `doPrompt()` — deliberately **not** `returnPressed`, so PyMOL's OrthoKey doesn't also capture it |

Submit path `doPrompt` (`pymol_qt_gui.py:960`): `doTypedCommand(text)` → pump PyMOL idle
(`_pymolProcess`) → clear the line → immediate feedback flush. The line edit is also a
live-preview drag-and-drop target: `dragEnterEvent` inserts the dropped text (or
`url.toLocalFile()` for the first local file URL) at the cursor and selects it, saving the
prior text so `dragLeaveEvent` can restore it. In the port, HTML5 drag events reproduce the
preview-insert/restore, and completion is proxied server-side (it needs `kwhash`,
`auto_arg` and the local filesystem).

### Source
`pymol_qt_gui.py:1087`, `docs/qt-main-window.md` §3. Port:
`apps/web/src/features/console/CommandLine.tsx`. Implemented.

---

## Command history

The command-line history model (`_gui.py:895`). `self.history = ['']` with
`history_cur = 0`; **slot 0 is always a scratch buffer** holding the currently typed text.

### Behaviour
- `doTypedCommand` dedupes against the previous entry, inserts a fresh blank at index 0,
  caps the list at **255** entries, resets `history_cur`, then `cmd.do(cmmd)`.
- `back()` saves current text into slot 0 on first press, then steps `history_cur + 1`.
- `back_search(set0=False)` scans forward from `history_cur+1` for the first entry that
  `startswith(history[0])` — the prefix search bound to `Ctrl+Up`.
- `_jump_history(i)` clamps to `len(history)-1`, sets the text and moves the cursor to end.

The port mirrors this exactly (255 cap, slot-0 scratch, prefix search) in
`useCommandHistory.ts`.

### Source
`_gui.py:895`, `docs/qt-main-window.md` §3.2. Port:
`apps/web/src/features/console/useCommandHistory.ts`. Implemented.

---

## Tab completion

`complete()` calls `cmd._parser.complete(command_get())`, implemented as `Parser._complete`
(`parser.py:524`).

### Behaviour
- No space/`@` in the string ⇒ complete against `cmd.kwhash` command keywords.
- Otherwise resolve the command via `cmd.kwhash.interpret`, count commas to pick the
  argument index, and complete from `cmd.auto_arg[count][command]`.
- Fallback: **filesystem glob completion** on the trailing token, including `$ENVVAR`
  expansion. Ambiguous matches are *printed* to feedback (`parser: matching files:`) and
  the common prefix is inserted — the completion returns a full replacement string, and the
  GUI replaces the whole line, cursor at end.

Because ambiguous filesystem candidates are printed rather than returned, a proper
completion popup in the browser would require re-implementing `_complete` (the source is
read-only). The alternative `QCompleter` path exists but is commented out.

### Source
`parser.py:524`, `_gui.py:899`, `docs/qt-main-window.md` §3.3. Port: proxied to
`cmd._parser.complete` server-side. Implemented.

---

## Feedback output panel

`self.browser = QPlainTextEdit()` (`objectName="feedback_browser"`), read-only, monospace
(`pymol_qt_gui.py:122`). A focus-proxy trick makes clicking the output focus the command
line, but clears the proxy while a selection exists so `Ctrl+C` works. A "Select Font…"
entry is added to its context menu.

### Behaviour — polling loop (`update_feedback`, `pymol_qt_gui.py:941`)
A single-shot `feedback_timer` fires first at 100 ms then re-arms at **500 ms**. Each tick:
1. `update_progress()`;
2. drain `cmd._get_feedback()` (the C++ feedback queue → list of lines);
3. `colorprinting.text2html(...)` (escapes `&<>`, spaces→`&nbsp;`, newlines→`<br>`) then
   `appendHtml`;
4. auto-scroll to the bottom;
5. for each `cmd.get_setting_updates()` index, invoke every registered
   `setting_callbacks[index]` — **this is the entire mechanism** keeping checkable/radio
   menu items and the window title in sync with the backend.

The port replaces polling with push: the bridge drains `_get_feedback()` and the
`get_setting_updates()` tap on its status tick and publishes `feedback` / `settings`
topics. Note `get_setting_updates()` is a **consume-once drain**, so exactly one consumer
(the bridge) may own it and fan out.

### Source
`pymol_qt_gui.py:941`, `colorprinting.py:17`, `docs/qt-main-window.md` §4. Port:
`apps/web/src/features/console/FeedbackLog.tsx`. Implemented.

---

## Quick buttons

The external-GUI shortcut-button grid (`pymol_qt_gui.py:222`): four rows of `QPushButton`s
(each `setProperty("quickbutton", True)`). There is no `QToolBar` and no `QStatusBar`.

### Behaviour — button map
| Row | Buttons → action |
|---|---|
| 1 | `Reset`→`cmd.reset` · `Zoom`→`cmd.zoom(animate=1.0)` · `Orient`→`cmd.orient(animate=1.0)` · `Draw/Ray`→popup embedding the render form |
| 2 | `Unpick`→`cmd.unpick` · `Deselect`→`cmd.deselect` · `Rock`→`cmd.rock` · `Get View`→prints matrix and copies `cmd.get_view(3)` to the clipboard |
| 3 | `\|<`→`rewind` · `<`→`backward` · `Stop`→`mstop` · `Play`→`mplay` · `>`→`forward` · `>\|`→`ending` · `MClear`→`mclear` |
| 4 | `Builder`→builder panel · `Properties`→props dialog · `Rebuild`→`cmd.rebuild` |

`Draw/Ray` opens a `WidgetMenu` embedding the two-page render form (size/dpi/aspect-lock on
page 1; Save/Copy/Back on page 2). `Get View` also prints
`" get_view: matrix copied to clipboard."`.

### Source
`pymol_qt_gui.py:222`, `docs/qt-main-window.md` §5. Port:
`apps/web/src/features/console/QuickButtons.tsx`. Implemented.

---

## Progress bar and Abort

The progress row below the quick buttons (`pymol_qt_gui.py:273`): a `QProgressBar` plus a
red `Abort` button wired to `cmd.interrupt` (`locking.py:88`).

### Behaviour
`update_progress` computes `int(cmd.get_progress() * 100)` (`monitoring.py:5`) and
shows/hides both widgets when the value is `>= 0` / `< 0`. It is driven from the same 500 ms
feedback tick. (Distinct from the in-viewport busy box; see [Busy and progress box](#busy-and-progress-box).)

### Source
`pymol_qt_gui.py:273`, `docs/qt-main-window.md` §5. Port:
`apps/web/src/features/console/QuickButtons.tsx`. Implemented.

---

## Splash

There is **no Qt splash screen**. The splash is drawn inside the OpenGL viewport by
`OrthoSplash()` (`Ortho.cpp:2608`) — version/copyright text — and `SplashFlag` forces full
display until the first click (`OrthoRemoveSplash`, called from `OrthoButton`).
`options.show_splash` (`invocation.py:142`) inserts `cmd.splash(1)` as the first deferred
command; `-q` clears it.

### Behaviour
Because it is part of the rendered ortho layer, the splash either arrives as image/CGO data
or is re-implemented as an overlay. The port renders it as a React overlay that dismisses on
first interaction (Esc also dismisses the splash before toggling `text`, per `OrthoKey`).

### Source
`Ortho.cpp:2608`, `invocation.py:529`, `docs/internal-gui.md` §10, `docs/qt-main-window.md`
§9.6. Port: `apps/web/src/features/console/orthoOverlays.ts`. Implemented.

---

## Object panel (names list)

The internal-GUI object panel (the "names list", `CExecutive::draw`,
`Executive.cpp:16167`) is the right-hand column of rows — one per `PanelRec` (object,
selection, or the synthetic `all` row). Row height = `internal_gui_control_size` (default
18). Column width = `internal_gui_width` (default 220 px). The whole column is suppressed
when `internal_gui = 0`.

### Behaviour — what a row draws (left→right)
1. Scroll bar (far left) when `n_ent > n_disp`.
2. Group open/close `[+]`/`[-]` (groups only) — see [Group open and close control](#group-open-and-close-control).
3. Indent `nest_level * 8 px`.
4. **Name button** — a 3D-bevel rect coloured by state: pressed/hovered `{0.7}`, enabled
   `{0.5}`, cloaked (enabled but an ancestor group disabled) `{0.35}`, disabled `{0.25}`.
5. **Name text** — selections wrapped in `( )`; group prefix stripping / `^|` arrow glyph
   controlled by `group_full_member_names` / `group_arrow_prefix`; text colour from
   `internal_gui_name_color_mode`.
6. **Caption** (objects only) in `{0.3,0.9,0.3}` — `"<coordset> <state>/<nstates>"`,
   colour-coded by `state_counter_mode`.
7. The **A S H L C (M)** toggle buttons on the right (see below).

Click semantics on the name: **left** = toggle visibility (deferred to release);
`Shift+Ctrl` = enable + zoom-on-hover, `Shift` = immediate toggle, `Ctrl` = enable-only.
**Middle** = center (plain), zoom (`Ctrl`), or exclusive-zoom (`Ctrl+Shift`). **Right** =
drag to reorder/regroup. Vertical drag band-selects visibility across rows. The single
mutation point `ExecutiveSpecSetVisibility` logs `cmd.enable/disable(...)`, respects
`active_selections`, and calls `SceneObjectAdd/Del`. `hide_underscore_names` (default 1)
hides `_`-prefixed recs. Because group nest-level/open-state are **not exposed by any
`cmd.*` query**, the port's bridge supplies the panel model itself and polls four version
counters instead of diffing.

### Source
`Executive.cpp:16167`, `docs/internal-gui.md` §1. Port:
`apps/web/src/features/objects/ObjectPanel.tsx`. Implemented.

---

## Group open and close control

The `[+]`/`[-]` button at the head of a group row (`Executive.cpp:16411`), 15 px wide, only
drawn when `panel->is_group`. `-` when open, `+` when closed.

### Behaviour
Left click sets `hilight=2`; on release it logs
`cmd.group("<name>", action='open'|'close')` and calls `ExecutiveGroup(...,5,1)`. The hit
test distinguishes "on the name" from "on the group control" by
`(xx-1)/8 > nest_level` (`> nest_level+1` for groups). Right-button drag on a group name
reorders/regroups, emitting `cmd.order` / `group <parent>, <child>` / `ungroup <child>`.

### Source
`Executive.cpp:16411`, `Executive.cpp:15300`, `docs/internal-gui.md` §1.2, §1.4. Port:
`apps/web/src/features/objects/placement.ts`. Implemented.

---

## A button: action menu

The leftmost of the per-row toggle buttons (fill `{0.5,0.5,1.0}`). Opens a context-specific
**action** menu built by a `pymol.menu.*` function, keyed on the row's type
(`Executive.cpp:15070`).

### Behaviour
| Row type | Menu function |
|---|---|
| all | `all_action` (zoom/center/origin, preset ▸, find ▸, hydrogens ▸, delete selections/everything, masking/movement/compute) |
| selection | `sele_action` (delete/rename, zoom/orient, modify ▸, preset ▸, find ▸, align ▸, remove atoms, duplicate / copy to object / extract) |
| molecule | `mol_action` (drag/reset matrix, assign sec. struc., rename/copy/group/delete, state ▸, sequence ▸) |
| group | `group_action` · map | `map_action` · surface/mesh | `surface_action`/`mesh_action` (level ▸) · slice | `slice_action` · measurement/CGO/callback/alignment/volume | `simple_action` · ramp gadget | `ramp_action` |

Menu data is a list of `[code, text, command]` (0=separator, 1=item, 2=title); leaves carry
`cmd.*` source strings executed on release, and lazy sub-menus (`copy_to`, `move_to_group`)
are expanded on demand. The port fetches this JSON from the backend rather than re-declaring
it, executing each leaf via `cmd.do`.

### Source
`menu.py:1497` etc., `Executive.cpp:15070`, `docs/internal-gui.md` §1.3, §2.1. Port:
`apps/web/src/features/objects/menus.ts`, `apps/web/src/features/pymol-menu/`. Implemented.

---

## S button: show menu

The second toggle button (fill `{0.6,0.6,0.8}`). Opens a **show** menu
(`Executive.cpp:15120`). The shared body `rep_action(sele, 'show')` (`menu.py:145`) offers
lines/nonbonded/licorice/sticks/nb_spheres/ribbon/cartoon/label/cell/dots/spheres/mesh/surface
plus `flag ignore ▸`.

### Behaviour
Dispatch by row type: `mol_show` (molecule/selection/group/all, with `as ▸`, organic/main
chain/side chain/disulfides sub-menus and `valence`), `cgo_show`, `measurement_show`,
`map_show`, `mesh_show`, `surface_show`, `slice_show`, `volume_show`. For the `all` row,
`mol_show` is invoked with `"all"`.

### Source
`menu.py:197`, `Executive.cpp:15120`, `docs/internal-gui.md` §2.2. Port:
`apps/web/src/features/pymol-menu/`. Implemented.

---

## H button: hide menu

The third toggle button (fill `{0.4,0.4,0.6}`). Opens a **hide** menu — the mirror of S
(`Executive.cpp:15164`).

### Behaviour
`mol_hide` (`menu.py:223`) offers `everything`, the `rep_action` reps, plus main chain /
side chain / waters / `hydrogens ▸` (all, nonpolar) / unselected / valence. Non-molecule
rows dispatch to `cgo_hide` / `measurement_hide` / `map_hide` / `mesh_hide` /
`surface_hide` / `slice_hide` / `volume_hide`.

### Source
`menu.py:223`, `Executive.cpp:15164`, `docs/internal-gui.md` §2.2. Port:
`apps/web/src/features/pymol-menu/`. Implemented.

---

## L button: label menu

The fourth toggle button (fill `{0.5,0.5,1.0}`). Opens the **label** menu
(`Executive.cpp:15208`) — only for all / selection / group / molecule rows; measurement,
map, surface, mesh and slice rows have **no** L menu (empty cases).

### Behaviour
`mol_labels` (`menu.py:1546`): clear — residues (`resn-resi`, one-letter), chains, segments
— atom name / element / residue name / one-letter / residue identifier / chain / segment —
b-factor / occupancy / vdw radius — `other properties ▸` (formal/partial charge, elec.
radius, text/numeric type, stereochemistry) — `atom identifiers ▸` (rank, ID, index). For
`all` it is called with `"(all)"`.

### Source
`menu.py:1546`, `Executive.cpp:15208`, `docs/internal-gui.md` §2.3. Port:
`apps/web/src/features/pymol-menu/`. Implemented.

---

## C button: color menu

The fifth toggle button, drawn as a **rainbow-gradient** quad. Opens the **color** menu
(`Executive.cpp:15235`).

### Behaviour
`mol_color` (`menu.py:672`): `by element ▸` / `by chain ▸` / `by ss ▸` / `by rep ▸` /
`spectrum ▸` — `auto ▸` — then the full palette (`all_colors`: nine colour groups running
`cmd.color_deep`, plus a `ramps ▸` group). Non-molecule rows dispatch to `general_color`
(map/CGO/alignment), `mesh_color` (mesh; and surface via `rep="surface"`, both with a
`negative ▸` sub-menu), `measurement_color`, `slice_color`, `vol_color`, or `ramp_color`
for ramp gadgets.

### Source
`menu.py:672`, `Executive.cpp:15235`, `docs/internal-gui.md` §2.4. Port:
`apps/web/src/features/pymol-menu/`, `apps/web/src/features/colors/`. Implemented.

---

## M button: motion menu

The sixth toggle button, present **only when `button_mode_name == "3-Button Motions"`**
(`get_op_cnt` returns 6, `Executive.cpp:1757`). Coloured by the row's motion "spec level"
(0→`{0.4,0.4,0.6}`, 1→`{0.6,0.6,0.8}`, 2→active `{0.9,0.9,1.0}`).

### Behaviour
`all` → `camera_motion(frame)` (store / store-with-scene ▸ / store-with-state ▸ / clear —
reset — purge movie — smooth key frames ▸ — interpolate/reinterpolate/uninterpolate).
group/molecule/measurement/map/surface/CGO/mesh → `obj_motion(obj, frame)` (adds `drag`).
A selection row has **no** M menu.

### Source
`menu.py:108`, `Executive.cpp:15279`, `docs/internal-gui.md` §2.5. Port:
`apps/web/src/features/movie/motionMenu.ts`. Implemented.

---

## Popup-menu engine

The behaviours shared by every ASHLC/viewport popup, `packages/engine/layer4/PopUp.cpp`. The
data model is a list of `[code, text, command]` where **0 = separator bar**, **1 =
clickable item**, **2 = non-clickable title**. Text may embed 4-char `\RGB` colour codes
(`\---` resets).

### Behaviour
- Placement: initial rect `left = x - Width/3`, `right = x + 2*Width/3`, then `PopFitBlock`
  clamps into the window.
- Sub-menus open on hover after `cChildDelay = 0.25 s`, placed on whichever side fits.
- "Sloppy mousing": leaving a row keeps the child alive for another `cChildDelay`.
- Click-and-release without dragging within `cPassiveDelay = 0.45 s` makes the menu
  **passive** (sticky — stays open after mouse-up).
- Mouse wheel scrolls the block by 10 px.
- On commit: `PLog` then `PParse` of the command string.
- Colours flip to black-on-white when `internal_gui_mode != Default`.

The port copies these semantics (hover delay, passive/sticky, colour codes) in the shared
menu component.

### Source
`PopUp.cpp:40`, `docs/internal-gui.md` §2, §3. Port:
`apps/web/src/features/pymol-menu/PopupMenu.tsx`, `menuStore.ts`. Implemented.

---

## Movie control bar

The transport bar (the "Control" block, `packages/engine/layer1/Control.cpp`), height 20 px,
`NButton = 9` box-buttons; icons only draw when `control_width > 100`.

### Behaviour — buttons (action on release)
| # | Icon | Action | Logged |
|---|---|---|---|
| 0 | `\|◀` | rewind to frame 1 | `cmd.rewind()` |
| 1 | `◀` | step back | `cmd.back()` |
| 2 | `■` | stop (also clears `sculpting`/`rock`) | `cmd.mstop()` |
| 3 | `▶` | toggle play (`Ctrl` rewinds first) | `cmd.mplay()`/`mstop()` |
| 4 | `▶` | step forward | `cmd.forward()` |
| 5 | `▶\|` | end (`Ctrl` → middle) | `cmd.ending()`/`middle()` |
| 6 | `S` | toggle `seq_view` | `cmd.set('seq_view',…)` |
| 7 | `▼` | toggle `rock` | `cmd.rock(…)` |
| 8 | `F` | full screen | `cmd.full_screen()` |

"Lit" states: button 6 when `seq_view`, 3 when playing, 7 when rocking. The **left-gutter
nub** (`x < left + margin`) drag-resizes `internal_gui_width` live and calls `OrthoReshape`;
a double click (<0.35 s) collapses the panel to width 5 / restores it. The SpaceNavigator
6-DOF paths (`ControlSdof*`) are not reproducible in the browser and are dropped.

### Source
`Control.cpp:298`, `docs/internal-gui.md` §4. Port:
`apps/web/src/features/movie/TransportBar.tsx`. Implemented.

---

## Movie timeline scrubber

The Movie block (`packages/engine/layer1/Movie.cpp`), a per-frame timeline. Height =
`movie_panel_row_height (default 15) * ExecutiveCountMotions()` rows (camera row plus every
object with its own `ViewElem`); a single row in `presentation` mode; 0 when `movie_panel=0`
or nothing to show.

### Behaviour
A horizontal scroll bar spans the frame range and its value **is** the current frame
(`SceneSetFrame(G,7,value)`). Each row is a `ViewElemDraw` strip (camera first, labelled
`"camera"`; object rows labelled by name); per-frame `specification_level` 1 → thin bar
`{0.3,0.3,0.6}`, 2 → full key block `{0.4,0.4,0.8}`. Interaction:

| Input | Effect |
|---|---|
| Left | scrub frame |
| Left+`Ctrl` | insert/delete frames (`cmd.minsert`/`mdelete`); `+Shift` = all rows |
| Middle+`Ctrl` | clear key (`cmd.mview('clear',…)`); `+Shift` = column-wide |
| Right | move key (`cmd.mmove`); click-without-drag opens the motion menu |
| Right+`Shift` | copy key (`cmd.mcopy`) |
| Wheel | step frame; `+Ctrl+Shift` changes `movie_panel_row_height` |

### Source
`Movie.cpp:1741`, `docs/internal-gui.md` §5. Port:
`apps/web/src/features/movie/MovieTimeline.tsx`, `MoviePanel.tsx`. Implemented.

---

## ButMode mouse-mode block

The mouse-mode indicator line (`packages/engine/layer1/ButMode.cpp:192`). Height is
`DIP2PIXEL(124)` when `mouse_grid` (default 1) else `DIP2PIXEL(40)`.

### Behaviour
Line 1: `"Mouse Mode "` + `button_mode_name` (colour `{1,0.5,0.5}`). When `mouse_grid` is on,
a 4×(L/M/R/Wheel) matrix of 5-char codes (`Rota`, `Move`, `Clip`, `PkAt`, `PkBd`, …) for
`& Keys / Shft / Ctrl / CtSh` plus `SnglClk` / `DblClk` rows. Last lines show
`Picking Atoms (and Joints)` or `Selecting <Atoms|Residues|Chains|Segments|Objects|Molecules|C-alphas>`
from `mouse_selection_mode`; a fast-redraw line shows `Frame/State %4d/%4d` and `%5.1f Hz`
when `show_frame_rate`. Click: the bottom 2 lines cycle the **selection** mode
(`mouse select_forward/backward`); elsewhere left/wheel cycle the mouse config
(`mouse forward/backward`) and **right button opens the `mouse_config` popup**.

### Source
`ButMode.cpp:149`, `docs/internal-gui.md` §7. Port:
`apps/web/src/features/mouse/ButModeBlock.tsx`. Implemented.

---

## Wizard block

The wizard panel (`packages/engine/layer1/Wizard.cpp`). `WizardRefresh()` pulls
`wizard.get_panel()` (a list of `[type, text, code]`) and sizes the block to
`internal_gui_control_size * NLine + 4`. Line types: **1 = text**, **2 = button**,
**3 = popup**.

### Behaviour
Click a button → pressed state; on release `PParse(code)`. Click a popup line →
`wizard.get_menu(code)` → `PopUpNew`. Drag highlights the button under the cursor. The
block's event mask (`get_event_mask`, default `cWizEventPick + cWizEventSelect`) governs
which scene events the active wizard receives. The port renders the descriptor list as
React and calls back on click.

### Source
`Wizard.cpp:195`, `docs/internal-gui.md` §8. Port:
`apps/web/src/features/wizards/WizardPanel.tsx`. Implemented.

---

## Wizard prompt overlay

The floating wizard prompt, drawn independently of the wizard block by
`OrthoDrawWizardPrompt()` (`Ortho.cpp:2124`) from `wizard.get_prompt()` (a list of strings).

### Behaviour
`wizard_prompt_mode` (default 1): 1 = filled box top-left, 2 = text only, 3 = flush to the
top-left corner. Text may carry `\RGB` colour codes. The position accounts for the sequence
viewer height when `seq_view_location=0`.

### Source
`Ortho.cpp:2124`, `docs/internal-gui.md` §8. Port:
`apps/web/src/features/wizards/WizardPrompt.tsx`. Implemented.

---

## Ortho command line

The command prompt PyMOL draws **inside** the viewport (distinct from the Qt command line),
handled by `OrthoKey()` (`Ortho.cpp:841`). State lives in `COrtho`: a `Line[256]` scrollback
ring, a `History[256]` ring, `CurLine`/`CurChar`/`PromptChar`/`CursorChar` and `InputFlag`.

### Behaviour (selected chords)
- Printable chars insert at cursor; `Alt+k` → `cmd._alt`, `Ctrl+Shift+k` → `cmd._ctsh`,
  other Ctrl chars → `cmd._ctrl`.
- Backspace never deletes past `PromptChar`; Ctrl-A/E move to start/end; Ctrl-K truncates;
  Ctrl-D deletes forward or (empty line) prints completion candidates; Tab replaces the line
  via `PComplete`.
- `Space` on an empty line = `mtoggle` (or `scene next` in presentation); `Shift+Space` =
  `rewind;mplay`.
- `Enter` on a non-empty line → `OrthoParseCurrentLine()` (push history, `PLog` except
  `quit`, `PParse`). On an empty line with a movie/panel it drives `mview toggle` variants.
- `Esc` dismisses the splash, else toggles `text`; `Shift+Esc` toggles `overlay`.
- Arrows (`OrthoSpecial`) recall history / move the cursor, but are only grabbed when there
  is typed text **and** text is visible (`OrthoArrowsGrabbed`); otherwise they fall through
  to `shortcut_dict` bindings.

### Source
`Ortho.cpp:841`, `docs/internal-gui.md` §9.1. Port:
`apps/web/src/features/console/orthoKeys.ts`, `OrthoConsole.tsx`. Implemented.

---

## Ortho feedback scrollback

The feedback/scrollback text PyMOL draws at the bottom of the viewport
(`OrthoDrawText()`, `Ortho.cpp:1623`), the in-viewport analogue of the Qt feedback panel.

### Behaviour
Origin `x = cOrthoLeftMargin`, `y = cOrthoBottomMargin + MovieGetPanelHeight`. Line count =
`ShowLines` when `text` is on or the splash is up, otherwise
`internal_feedback + overlay_lines`. `internal_prompt = 0` hides the prompt line. Prompt
lines use `TextColor`, output lines use `OverlayColor` (1 − background). `overlay` (default
0) with `overlay_lines` (default 5) shows recent output over the scene; `auto_overlay`
(default 0) makes new output transiently visible until the next mouse click. Wrapping obeys
`wrap_output` (default 0 = off); `OrthoNewLine` also pushes lines into the `feedback` queue
and strips ANSI unless `colored_feedback`.

### Source
`Ortho.cpp:1623`, `docs/internal-gui.md` §9.2. Port:
`apps/web/src/features/console/OrthoConsole.tsx`, `orthoOverlays.ts`. Implemented.

---

## Selection indicators

The visual cues that mark named selections and in-progress picking. Selection rows in the
object panel render their name wrapped in `( )` and carry a per-selection `sele_color`
(indicator colour in `SpecRec`, with no `cmd` getter). `active_selections` /
`auto_hide_selections` / `auto_show_selections` govern which selections stay visible.

### Behaviour
The rubber-band selection rectangle is `OrthoDrawLoop()` (`Ortho.cpp:1695`) — a 1-px band
(`LoopRect`, set via `OrthoSetLoopRect`) drawn in `cColorFront` while box-picking. Picked
atoms/joints are indicated by the mouse-mode line (`Picking Atoms (and Joints)`).
`cmd.get_vis()` reports per-rec `visible` but **not** the "cloaked" state (enabled under a
disabled ancestor group) nor `sele_color`, so both are derived client-side.

### Source
`Ortho.cpp:1695`, `Executive.cpp:16443`, `docs/internal-gui.md` §1.5, §10, §11. Port:
`apps/web/src/features/console/OrthoLoopRect.tsx`, `apps/web/src/features/objects/rowStyle.ts`.
Implemented.

---

## Scene bar

The in-scene scene buttons stacked bottom-left of the viewport, `SceneDrawButtons()`
(`Scene.cpp:2885`), drawn when `scene_buttons` (default 1) is on. There is no `MovieButton`
symbol — the name is misleading folklore.

### Behaviour
One button per scene from `SceneVec`, row height `internal_gui_control_size`, own scroll bar
on overflow. Fill: pressed `{0.7}`, current scene `{0.5}`, otherwise `{0.25}`.
Left click → `cmd.scene('<name>')` (interpolated); middle → immediate
`cmd.scene(name, animate=-1)` (`animate=0` with `Ctrl`); right → drag reorders
(`cmd.scene_order`), and click-without-drag opens `scene_menu(name)` (rename/update/delete).

### Source
`Scene.cpp:2885`, `SceneMouse.cpp:179`, `docs/internal-gui.md` §6. Port:
`apps/web/src/features/scenes/ViewList.tsx`, `SceneMenu.tsx`. Implemented.

---

## Busy and progress box

The in-viewport busy/progress box, `OrthoBusyDraw()` (`Ortho.cpp:609`) — a 240×60 px black
box top-left with a message line and up to two progress bars (`BusyStatus[0..3]` = slow and
fast progress/total), gated by `show_progress`.

### Behaviour
Fed by `OrthoBusySlow` / `OrthoBusyFast`, which also call `PyMOL_SetProgress`; the Python
side is `cmd.get_progress()` (`monitoring.py:5`), the same value the Qt progress bar reads.
Distinct from the external-GUI [Progress bar and Abort](#progress-bar-and-abort) widget.

### Source
`Ortho.cpp:609`, `docs/internal-gui.md` §10. Port:
`apps/web/src/features/console/BusyOverlay.tsx`. Implemented.

---

## Related
- [wizards](../topics/wizards.md) — the wizard modules driven by the wizard block/prompt.
- [presets](../topics/presets.md) — the `preset ▸` entries reachable from the A menu.
- [selection-algebra](../topics/selection-algebra.md) — the operators behind selection rows.
