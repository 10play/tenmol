# Area map: `qt-main-window` (Qt application shell → React app shell)

Read-only survey of the PyMOL Qt main-window shell in this repo, for the React/pnpm rebuild.
Every claim below is anchored to a `file:line` that was actually opened.

Primary sources read:

- `modules/pmg_qt/pymol_qt_gui.py` (1267 lines) — the `QMainWindow` shell, menu builder, command line, feedback area, quick buttons, app startup.
- `modules/pymol/_gui.py` (1033 lines) — **the actual menu-bar data model** (`PyMOLDesktopGUI.get_menudata`), command history, movie-program helpers, recent-files sqlite DB.
- `modules/pmg_qt/mimic_pmg_tk.py` (177 lines) — Pmw/Tk menu-bar shim so legacy plugins can add menu items.
- `modules/pmg_qt/mimic_tk.py` (128 lines) — `tkMessageBox`/`tkFileDialog` → Qt shim, injected into `sys.modules`.
- `modules/pmg_qt/__init__.py` (3 lines) — empty placeholder docstring only, no code.
- Supporting: `modules/pmg_qt/pymol_gl_widget.py`, `modules/pmg_qt/keymapping.py`, `modules/pymol/gui.py`, `modules/pymol/Qt/utils.py`, `modules/pymol/invocation.py`, `modules/pymol/save_shortcut.py`, `modules/pymol/colorprinting.py`, `modules/pymol/parser.py`, `data/pmg_qt/styles/pymol.sty`, `modules/pmg_qt/forms/*.ui`.

---

## 0. IMPORTANT CORRECTION: menus are **not** generated from `modules/pymol/menu.py`

The task brief asks to "note where menus are generated dynamically from `modules/pymol/menu.py`". Grepping shows this is **not** the case for the main window:

- The Qt menu bar is built from `self.get_menudata(cmd)` at `modules/pmg_qt/pymol_qt_gui.py:353`.
- `get_menudata` is defined at `modules/pymol/_gui.py:55` on the toolkit-independent mixin `PyMOLDesktopGUI` (`modules/pymol/_gui.py:9`), which `PyMOLQtGUI` inherits (`modules/pmg_qt/pymol_qt_gui.py:31`).
- The only other consumer of `get_menudata` is the legacy Tk skin at `modules/pmg_tk/skins/normal/__init__.py:1072` (grep result; not part of this area).
- `modules/pymol/menu.py` is imported by the **C++ layer**, at `layer1/P.cpp:2020` (`P_menu = PImportModuleOrFatal("pymol.menu")`), and drives the *viewport-internal* popup menus via `MenuActivate*` in `layer3/Executive.cpp` (e.g. `layer3/Executive.cpp:15019`, `:15069`, `:783`). It also exports `rep_setting_lists` consumed by `modules/pymol/viewing.py:1965`.

So: **menu bar = `modules/pymol/_gui.py`; internal-GUI right-click menus = `modules/pymol/menu.py` (a different agent's area).** Both must be cloned, but they are separate data sources with different serialization needs.

---

## 1. Window layout, docking and splitters

There are **no `QSplitter`s** in the main window. Layout is `QMainWindow` + dock widgets:

| Element | Source | Notes |
|---|---|---|
| `QMainWindow` subclass `PyMOLQtGUI` | `pymol_qt_gui.py:31` | also mixes in `pymol._gui.PyMOLDesktopGUI` |
| Dock options: `AllowTabbedDocks \| AllowNestedDocks` | `pymol_qt_gui.py:90-91` | |
| Initial size = `win_x + (220 if internal_gui) , win_y + (246 if external_gui else 18)` | `pymol_qt_gui.py:94-97` | option defaults `win_x=640`, `win_y=480` (`modules/pymol/invocation.py:144-145`) |
| Central widget = `PyMOLGLWidget` (OpenGL viewport) | `pymol_qt_gui.py:207-208` | replaced by the three.js canvas in the web app |
| `ext_window` = `QDockWidget("External GUI")` in `TopDockWidgetArea` | `pymol_qt_gui.py:184-193` | |
| Dock contents = `ExtGuiFrame(QFrame)` with `sizeHint = QSize(win_x, ext_y)` | `pymol_qt_gui.py:171-182` | `ext_y` default 168 (`invocation.py:179`) |
| Ext-GUI layout re-orients on dock-location change (Left/Right ⇒ `BottomToTop`, removes the trailing stretch) | `pymol_qt_gui.py:196-204` | |
| Builder panel added as `QDockWidget` in `TopDockWidgetArea` | `pymol_qt_gui.py:613-623` | lazily constructed from `pmg_qt.builder.BuilderPanelDocked` |
| Stylesheet loaded from `$PYMOL_DATA/pmg_qt/styles/pymol.sty` | `pymol_qt_gui.py:407-416` | file is `data/pmg_qt/styles/pymol.sty`; only 3 rules: `#builder QPushButton` padding, `QPushButton[quickbutton=true]` padding, `QMainWindow::separator {width/height 5px}` |
| Window title tracks setting `session_file` (index 440) | `pymol_qt_gui.py:114-116`; setting id confirmed at `layer1/SettingInfo.h:540` | title becomes `PyMOL (basename)` |
| Base title set at startup | `pymol_qt_gui.py:1224` (`window.setWindowTitle("PyMOL")`) | |
| Full-screen toggle hides menubar + non-floating ext window | `pymol_qt_gui.py:472-494` | remembers `_ext_window_visible` (`pymol_qt_gui.py:47`) |

### Web plan
`AppShell` React component: CSS-grid/flex root, `<Viewport>` (three.js canvas) as the "central widget", and a dockable/resizable `ExternalGuiPanel` (react-mosaic / dockview / custom). Dock state (area, floating, visible) is pure client state; only `viewport` size changes must be echoed to the backend (`cmd.reshape` / `cmd.viewport`, see §12).

---

## 2. The "External GUI" concept

Historically PyMOL had two OS windows: the OpenGL "internal" window and a Tk "external" window with the menu bar, command line and output. In Qt they are merged: the "External GUI" is just the `QDockWidget` described above (`pymol_qt_gui.py:184-193`) containing, left-to-right (`pymol_qt_gui.py:159-169`):

1. a `QVBoxLayout` with the feedback `QPlainTextEdit` (`browser`) and the `PyMOL>` label + `CommandLineEdit` row;
2. a `quickbuttonslayout` `QVBoxLayout` with 4 rows of quick buttons plus the progress-bar row.

Behaviours:

- If `options.external_gui` is truthy the dock's title bar is replaced with an empty `QWidget` (i.e. undecorated, non-draggable); otherwise the dock is hidden (`pymol_qt_gui.py:188-191`). `-x` sets `external_gui = 0` (`invocation.py:382`), `-q`/`-c` paths at `invocation.py:492-493`.
- Double-clicking the frame calls `toggle_ext_window_dockable(True)` (`pymol_qt_gui.py:172-173`).
- `toggle_ext_window_dockable` swaps between "has title bar / floating" and "no title bar / docked" (`pymol_qt_gui.py:457-470`).
- Menu entries `Display ▸ External GUI ▸ Toggle dockable` (shortcut `Ctrl+E`) and `▸ Visible` (the dock's own `toggleViewAction`, re-labelled "Visible") are appended **imperatively after** the data-driven menu build (`pymol_qt_gui.py:377-384`).
- `pymol.gui.ext_hide` / `ext_show` explicitly **no-op with a printed "ignoring gui.ext_hide"** when a Qt window exists (`modules/pymol/gui.py:44-66`).

### Web plan
A `ExternalGuiPanel` React component with three modes (`docked-top | docked-side | floating | hidden`), persisted in client state, plus `Ctrl+E` binding. `ext_hide`/`ext_show` stay no-ops; the bridge should still surface them so scripts don't error.

---

## 3. Command entry line (`CommandLineEdit`)

Widget: `CommandLineEdit(QLineEdit)` at `pymol_qt_gui.py:1087`, instantiated at `pymol_qt_gui.py:120-121` with `objectName="command_line"`; prefixed by a `QLabel("PyMOL>")` with `objectName="command_label"` (`pymol_qt_gui.py:141-143`).

Tooltip text (must be reproduced verbatim), `pymol_qt_gui.py:145-157`:

```
Command Input Area

Get the list of commands by hitting <TAB>

Get the list of arguments for one command with a question mark:
PyMOL> color ?

Read the online help for a command with "help":
PyMOL> help color

Get autocompletion for many arguments by hitting <TAB>
PyMOL> color ye<TAB>    (will autocomplete "yellow")
```

### 3.1 Key handling (`lineeditKeyPressEventFilter`, `pymol_qt_gui.py:421-438`)

| Key | Action | Impl |
|---|---|---|
| `Tab` | tab completion | `self.complete()` → `_gui.py:899` |
| `Up` | history back | `_gui.py:925` `back()` |
| `Ctrl+Up` | history **prefix** back-search | `_gui.py:916` `back_search()` |
| `Down` | history forward | `_gui.py:931` `forward()` |
| `Return`/`Enter` | submit | `doPrompt()` (`pymol_qt_gui.py:960`) — deliberately *not* `returnPressed`, so PyMOL's OrthoKey doesn't also capture it (comment at `pymol_qt_gui.py:432-434`) |

`eventFilter` (`pymol_qt_gui.py:440-455`) additionally swallows all `Tab` **KeyRelease** events, and, when the GL widget has focus, routes `Tab` KeyPress into `keyPressEvent` → `pymol.button` (`pymol_qt_gui.py:50-54`).

### 3.2 History model (`modules/pymol/_gui.py:895-941`)

- `self.history = ['']`, `history_cur = 0` (`_gui.py:896-897`). Slot 0 is always a scratch buffer holding the currently typed text.
- `doTypedCommand` (`_gui.py:906`): dedupes against the previous entry, inserts a new blank at index 0, caps the list at **255** entries, resets `history_cur`, then `self.cmd.do(cmmd)`.
- `back()` saves current text into slot 0 on first press then steps `history_cur + 1`.
- `back_search(set0=False)` scans forward from `history_cur+1` for the first entry that `startswith(history[0])`.
- `_jump_history(i)` clamps to `len(history)-1`, sets text and moves the cursor to end.
- Accessors the mixin requires from the toolkit: `command_get` (`pymol_qt_gui.py:922`), `command_set` (`:925`), `command_set_cursor` (`:928`).

### 3.3 Tab completion

`complete()` (`_gui.py:899-904`) calls `self.cmd._parser.complete(self.command_get())`. The implementation is `Parser._complete` at `modules/pymol/parser.py:524-593`:

- no space/`@` in the string ⇒ complete against `cmd.kwhash` command keywords (`parser.py:534`);
- otherwise resolve the command via `cmd.kwhash.interpret`, count commas to pick the argument index, and complete from `cmd.auto_arg[count][command]` (`parser.py:540-558`);
- fallback: **filesystem glob completion** on the trailing token, including `$ENVVAR` completion (`parser.py:561-593`). Ambiguous matches are *printed* to feedback ("` parser: matching files:`") and the common prefix is inserted.
- Returns a full replacement string; the GUI replaces the whole line and puts the cursor at the end.

The alternative `QCompleter(cmd.kwhash.keywords)` path exists but is **commented out** (`pymol_qt_gui.py:212-216`).

### 3.4 Submit path

`doPrompt` (`pymol_qt_gui.py:960-964`): `doTypedCommand(text)` → `pymolwidget._pymolProcess()` (pump PyMOL idle/redisplay, `pymol_gl_widget.py:245`) → `lineedit.clear()` → `feedback_timer.start(0)` (immediate feedback flush).

### 3.5 Drag-and-drop into the command line

`CommandLineEdit` implements a **live preview** drop (`pymol_qt_gui.py:1087-1124`):

- `dragEnterEvent`: if the mime data has text, immediately insert it at the cursor and select it; if the first URL is a local file, insert `url.toLocalFile()` instead of the raw text. Saves `_saved_pos`/`_saved_text`.
- `dragLeaveEvent`: restores the saved text and cursor if a preview was inserted.
- `dropEvent`: accepts the proposed action (the text is already there).
- `dragMoveEvent`: overridden to a no-op.

### Web plan
`CommandInput` React component (controlled `<input>`), a `useCommandHistory` hook mirroring `_gui.py:895-941` exactly (255 cap, slot-0 scratch, prefix search), and a `bridge.complete(text)` RPC that proxies `cmd._parser.complete` (server-side, because it needs `kwhash`, `auto_arg` **and the local filesystem**). HTML5 drag events reproduce the preview-insert/restore semantics. Complexity: the completion RPC must be synchronous-feeling (debounce + optimistic).

---

## 4. Feedback / output text area

- `self.browser = QPlainTextEdit()`, `objectName="feedback_browser"`, read-only (`pymol_qt_gui.py:122-124`).
- **Focus proxy trick**: browser's focus proxy is the command line so clicking output focuses input; the proxy is cleared while a selection exists so `Ctrl+C` works (`pymol_qt_gui.py:126-134`, `copyAvailable` handler).
- Monospace font via `getMonospaceFont()` (`pymol_qt_gui.py:137`; impl `modules/pymol/Qt/utils.py:249-266` — Monaco/Consolas/Monospace by platform, size 9, +3 on macOS).
- `connectFontContextMenu(self.browser)` (`pymol_qt_gui.py:138`) adds a **"Select Font…"** entry to the standard context menu, opening `QFontDialog` (`Qt/utils.py:204-226`).
- Polling loop: `feedback_timer` is a single-shot `QTimer`, first fired after 100 ms (`pymol_qt_gui.py:391-394`), then re-armed at **500 ms** at the end of every `update_feedback` (`pymol_qt_gui.py:958`).
- `update_feedback` (`pymol_qt_gui.py:941-958`):
  1. `update_progress()`;
  2. `feedback = self.cmd._get_feedback()` (`modules/pymol/internal.py:593`) — drains the C++ feedback queue, returns a list of lines;
  3. `colorprinting.text2html(...)` (`modules/pymol/colorprinting.py:17` — escapes `&<>`, converts spaces to `&nbsp;` and newlines to `<br>`) then `browser.appendHtml(html)`;
  4. auto-scroll to `verticalScrollBar().maximum()`;
  5. `for setting in self.cmd.get_setting_updates()` (`modules/pymol/setting.py:440`) → for each registered index, read `cmd.get_setting_tuple(setting)[1][0]` and invoke every callback in `self.setting_callbacks[setting]`. **This is the entire mechanism that keeps checkable/radio menu items and the window title in sync with the backend.**

Note: `colorprinting.text2html` in this build does *not* translate PyMOL's `\933`-style color escapes (see `modules/pymol/menu.py:21-23` for those codes); `error/warning/suggest/parrot` are plain `print` aliases (`colorprinting.py:28-31`).

### Web plan
Replace polling with a WebSocket **push** channel: the bridge drains `cmd._get_feedback()` on a 100–500 ms tick and emits `{type:'feedback', lines:[...]}`; similarly emits `{type:'settings', changed:{index:value}}` from `cmd.get_setting_updates()`. React `<FeedbackLog>` = virtualized list, monospace, auto-scroll-on-bottom, selectable text, font-size preference persisted client-side.

---

## 5. Quick buttons + progress bar (the "toolbar"/status area)

There is no `QToolBar` and no `QStatusBar`. The button grid is built at `pymol_qt_gui.py:222-271` — 4 rows, each a `QHBoxLayout` with `spacing 2`; every button gets `setProperty("quickbutton", True)` (drives the stylesheet rule) and `WA_LayoutUsesWidgetRect` (macOS workaround, `pymol_qt_gui.py:261`).

| Row | Label | Action |
|---|---|---|
| 1 | `Reset` | `cmd.reset` |
| 1 | `Zoom` | `cmd.zoom(animate=1.0)` |
| 1 | `Orient` | `cmd.orient(animate=1.0)` |
| 1 | `Draw/Ray` | `WidgetMenu(self).setSetupUi(self.render_dialog)` — a popup menu embedding the render form, built lazily on first show (`Qt/utils.py:64-95`) |
| 2 | `Unpick` | `cmd.unpick` |
| 2 | `Deselect` | `cmd.deselect` |
| 2 | `Rock` | `cmd.rock` |
| 2 | `Get View` | `self.get_view` → `cmd.get_view(2, quiet=0)`, copies `cmd.get_view(3)` to the clipboard, prints `" get_view: matrix copied to clipboard."` (`pymol_qt_gui.py:83-86`) |
| 3 | `\|<` | `cmd.rewind` |
| 3 | `<` | `cmd.backward` |
| 3 | `Stop` | `cmd.mstop` |
| 3 | `Play` | `cmd.mplay` |
| 3 | `>` | `cmd.forward` |
| 3 | `>\|` | `cmd.ending` |
| 3 | `MClear` | `cmd.mclear` |
| 4 | `Builder` | `self.open_builder_panel` (`pymol_qt_gui.py:613`) |
| 4 | `Properties` | `self.open_props_dialog` (`pymol_qt_gui.py:625`) |
| 4 | `Rebuild` | `cmd.rebuild` |

Progress row (`pymol_qt_gui.py:273-284`): `QProgressBar` + a red `Abort` `QPushButton` (`background: #FF0000; color: #FFFFFF`) wired to `cmd.interrupt` (`modules/pymol/locking.py:88`). `update_progress` (`pymol_qt_gui.py:931-939`) computes `int(cmd.get_progress() * 100)` (`modules/pymol/monitoring.py:5`) and shows/hides both widgets when the value is `>= 0` / `< 0`.

A stretch is appended after the rows and its index is remembered so the dock-orientation handler can add/remove it (`pymol_qt_gui.py:286-287`, used at `:200` and `:203-204`).

---

## 6. Menu bar — full enumeration

Built at `pymol_qt_gui.py:289-357`. `self.menubar = self.menuBar()`; `self.menudict = {'': menubar}` (`:350`) is the registry legacy plugins mutate. Every top-level menu and submenu is `setTearOffEnabled(True)` and gets `setWindowTitle(title)` "needed for Windows" (`pymol_qt_gui.py:297-298`).

### 6.1 The `_addmenu` item grammar (`pymol_qt_gui.py:295-344`)

| Tuple | Meaning |
|---|---|
| `('separator',)` | `menu.addSeparator()` |
| `('menu', label, [items])` | submenu; `&` in the label is escaped to `&&` (`:303`) |
| `('command', label, callable_or_str)` | if `str` ⇒ `lambda: cmd.do(str)`; if `None` ⇒ prints `warning: skipping <item>` and drops the item (`:306-307`) |
| `('check', label, setting_name[, true_value, false_value])` | `SettingAction(...)` (`pymol_qt_gui.py:1041`) |
| `('radio', label, setting_name, value)` | `QActionGroup` keyed **by setting name only** (`:322-327`); triggers `cmd.set(name, value, log=1, quiet=0)`; registers a `setting_callbacks` entry `a.setChecked(v == value)` |
| `('open_recent_menu',)` | inserts the dynamic `Open Recent...` submenu (`:341-342`) |
| anything else | prints `error: <item>` (`:343-344`) |

`SettingAction` (`pymol_qt_gui.py:1041-1082`): resolves the setting index via `cmd.setting._get_index(name)`, reads `cmd.get_setting_tuple(index)`, makes the action checkable for setting types 1/2/3/5/6 (bool/int/float/color/str) else prints `TODO <type> <name>`; on trigger issues `cmd.set(index, true_value if checked else false_value, log=1, quiet=0)`; registers `setting_callbacks[index] → action.setChecked(v != false_value)`.

**Gotcha for the port:** because radio `QActionGroup`s are keyed only by setting name, two visually separate radio blocks for the same setting (e.g. `surface_cavity_mode` appearing both as the "Cavities and Pockets…" block and the "Exterior (Normal)" item in `Setting ▸ Surface`) share one exclusive group. Also, a radio's initial checked state is taken from `values[0] == value` where `values` was captured when the group was first created (`pymol_qt_gui.py:326-327, 339-340`).

macOS hack: `Edit` is temporarily renamed to `Edit_` and restored after 10 ms via `QTimer.singleShot` to suppress "Start Dictation" (`pymol_qt_gui.py:359-364`, QTBUG-43217).

---

### 6.2 `File` — `modules/pymol/_gui.py:80-134`

| Item | Type | Fires |
|---|---|---|
| `New PyMOL Window ▸ Default` | command | `self.new_window()` → `os.spawnv` of `python pymol/__init__.py -N <gui>` (`_gui.py:42-53`) |
| `New PyMOL Window ▸ Ignore .pymolrc and plugins (-k)` | command | `self.new_window(('-k',))` |
| — separator — | | |
| `Open...` | command | `self.file_open` (`pymol_qt_gui.py:643-649`): `QFileDialog.getOpenFileNames`, then `load_dialog(fname, partial=partial)` per file, `partial` becomes 1 after the first |
| `Open Recent...` | dynamic submenu | see §6.14 |
| `Get PDB...` | command | `file_dialogs.file_fetch_pdb` (`modules/pmg_qt/file_dialogs.py:444`) |
| — separator — | | |
| `Save Session` | command | `self.session_save` (`pymol_qt_gui.py:651-654`): `cmd.get('session_file')` → `cmd.as_pathstr` → `session_save_as(fname)` |
| `Save Session As...` | command | `self.session_save_as` (`pymol_qt_gui.py:656-671`): filters `PyMOL Session File (*.pse *.pze *.pse.gz)` / `PyMOL Show File (*.psw *.pzw *.psw.gz)`; `cmd.save(fname, format='pse', quiet=0)`; `recent_filenames_add(fname)` |
| — separator — | | |
| `Export Molecule...` | command | `file_dialogs.file_save` (`file_dialogs.py:519`) |
| `Export Map...` | command | `file_dialogs.file_save_map` (`file_dialogs.py:845`) |
| `Export Alignment...` | command | `file_dialogs.file_save_aln` (`file_dialogs.py:850`) |
| `Export Image As ▸ PNG...` | command | `file_dialogs.file_save_png` (`file_dialogs.py:604`) |
| `Export Image As ▸ VRML 2...` | command | `_file_save('VRML 2 WRL File (*.wrl)', 'wrl')` (`pymol_qt_gui.py:802`) |
| `Export Image As ▸ COLLADA...` | command | `_file_save(..., 'dae')` (`:805`) |
| `Export Image As ▸ GLTF...` | command | `_file_save(..., 'gltf')` (`:820`) |
| `Export Image As ▸ POV-Ray...` | command | `_file_save(..., 'pov')` (`:808`) |
| `Export Image As ▸ STL...` | command | `_file_save(..., 'stl')` (`:817`) |
| `Export Movie As ▸ MPEG...` | command | `file_save_mpeg` (`file_dialogs.py:691`) |
| `Export Movie As ▸ Quicktime...` | command | `file_save_mov` → `file_save_mpeg('mov')` (`pymol_qt_gui.py:814`) |
| `Export Movie As ▸ PNG Images...` | command | `file_save_mpng` → `file_save_mpeg('png')` (`pymol_qt_gui.py:811`) |
| — separator — | | |
| `Log File ▸ Open...` | command | `log_open()` (`pymol_qt_gui.py:829`) → `cmd.log_open(fname, 'w')` |
| `Log File ▸ Resume...` | command | `log_resume()` (`:840`) → `cmd.resume(fname)` |
| `Log File ▸ Append...` | command | `log_append()` (`:837`) → `log_open(mode='a')` |
| `Log File ▸ Close` | command | `cmd.log_close` |
| `Run Script...` | command | `file_run` (`:847-868`): multi-select, filters `All Runnable (*.pml *.py *.pym)` / `PyMOL Command Script (*.pml)` / `(*.txt)` / `Python Script (*.py *.pym)` / `(*.txt)` / `All Files(*)`; `cmd.cd(dir, quiet=0)` then `cmd.run(f)` for python (regex `\.py(\|m\|c\|o\|\.txt)$`) else `cmd.do("@"+f)` |
| `Working Directory ▸ Change...` | command | `cd_dialog` (`:870-873`) → `QFileDialog.getExistingDirectory` → `cmd.cd(dname or '.', quiet=0)` |
| `Working Directory ▸ File Browser` | command | `cmd.system('explorer .' / 'open .' / 'xdg-open .')` per platform (`_gui.py:74-77, 121`) |
| — separator — | | |
| `Edit pymolrc` | command | `edit_pymolrc` (`pymol_qt_gui.py:634-637`) → `pmg_qt.TextEditor.edit_pymolrc(plugins.get_pmgapp())` |
| — separator — | | |
| `Reinitialize ▸ Everything` | command | `cmd.reinitialize` |
| `Reinitialize ▸ Original Settings` | command str | `reinitialize original_settings` |
| `Reinitialize ▸ Stored Settings` | command str | `reinitialize settings` |
| `Reinitialize ▸ Store Current Settings` | command str | `reinitialize store_defaults` |
| `Quit` | command | `confirm_quit` (`pymol_qt_gui.py:875-876`) → `QApplication.instance().quit()` (note: **no confirmation prompt** despite the name) |

### 6.3 `Edit` — `_gui.py:135-138`
| Item | Fires |
|---|---|
| `Undo [Ctrl-Z]` | `cmd.undo` |
| `Redo [Ctrl-Y]` | `cmd.redo` |

### 6.4 `Build` — `_gui.py:139-233`

`Build ▸ Fragment` (all `cmd.do(...)` of literal strings):
`Acetylene [Alt-J]` `editor.attach_fragment('pk1','acetylene',2,0)` ·
`Amide N->C [Alt-1]` `...'formamide',3,1` ·
`Amide C->N [Alt-2]` `...'formamide',5,0` ·
`Bromine [Ctrl-Shift-B]` `replace Br,1,1` ·
`Carbon [Ctrl-Shift-C]` `replace C,4,4` ·
`Carbonyl [Alt-0]` `...'formaldehyde',2,0` ·
`Chlorine [Ctrl-Shift-L]` `replace Cl,1,1` ·
`Cyclobutyl [Alt-4]` `...'cyclobutane',4,0` ·
`Cyclopentyl [Alt-5]` `...'cyclopentane',5,0` ·
`Cyclopentadiene [Alt-8]` `...'cyclopentadiene',5,0` ·
`Cyclohexyl [Alt-6]` `...'cyclohexane',7,0` ·
`Cycloheptyl [Alt-7]` `...'cycloheptane',8,0` ·
`Fluorine [Ctrl-Shift-F]` `replace F,1,1` ·
`Iodine [Ctrl-Shift-I]` `replace I,1,1` ·
`Methane [Ctrl-Shift-M]` `...'methane',1,0` ·
`Nitrogen [Ctrl-Shift-N]` `replace N,4,3` ·
`Oxygen [Ctrl-Shift-O]` `replace O,4,2` ·
`Sulfer [Ctrl-Shift-S]` (sic) `replace S,2,2` ·
`Sulfonyl [Alt-3]` `...'sulfone',3,1` ·
`Phosphorus [Ctrl-Shift-P]` `replace P,4,3`.
(`_gui.py:140-161`; backend `modules/pymol/editor.py:51 attach_fragment`.)

`Build ▸ Residue` (`_gui.py:162-195`) — 23 commands, each `cmd.editor.attach_amino_acid('pk1', <code>)` (`modules/pymol/editor.py:98`):
`Acetyl [Alt-B]`=ace, `Alanine [Alt-A]`=ala, `Amine`=nhh, `Aspartate [Alt-D]`=asp, `Asparagine [Alt-N]`=asn, `Arginine [Alt-R]`=arg, `Cysteine [Alt-C]`=cys, `Glutamate [Alt-E]`=glu, `Glutamine [Alt-Q]`=gln, `Glycine [Alt-G]`=gly, `Histidine [Alt-H]`=his, `Isoleucine [Alt-I]`=ile, `Leucine [Alt-L]`=leu, `Lysine [Alt-K]`=lys, `Methionine [Alt-M]`=met, `N-Methyl [Alt-Z]`=nme, `Phenylalanine [Alt-F]`=phe, `Proline [Alt-P]`=pro, `Serine [Alt-S]`=ser, `Threonine [Alt-T]`=thr, `Tryptophan [Alt-W]`=trp, `Tyrosine [Alt-Y]`=tyr, `Valine [Alt-V]`=val.
Then a separator and 3 radios on `secondary_structure`: `Helix`=1, `Antiparallel Beta Sheet`=2, `Parallel Beta Sheet`=3.

`Build ▸ Sculpting` (`_gui.py:197-221`): checks `Auto-Sculpting`(`auto_sculpt`), `Sculpting`(`sculpting`); commands `Activate`=`sculpt_activate all`, `Deactivate`=`sculpt_deactivate all`, `Clear Memory`=`cmd.sculpt_purge`; radios on `sculpting_cycles` = 1,3,10,33,100,333,1000 (labels `1 Cycle per Update`, `N Cycles per Update`); radios on `sculpt_field_mask`: `Bonds Only`=0x01, `Bonds and Angles Only`=0x03, `Local Geometry Only`=0x1F, `All Except VDW`=`~(0x20|0x40)`, `All Except 1-4 VDW and Torsions`=`~(0x40|0x80)`, `All Terms`=0xFF.

`Build` root commands (`_gui.py:223-232`): `Cycle Bond Valence [Ctrl-Shift-W]`=`cycle_valence`; `Fill Hydrogens on (pk1) [Ctrl-Shift-R]`=`h_fill`; `Invert (pk2)-(pk1)-(pk3) [Ctrl-Shift-E]`=`invert`; `Create Bond (pk1)-(pk2) [Ctrl-Shift-T]`=`bond`; `Remove (pk1) [Ctrl-Shift-D]`=`remove pk1`; `Make (pk1) Positive [Ctrl-Shift-K]`=`alter pk1, formal_charge=1`; `Make (pk1) Negative [Ctrl-Shift-J]`=`alter pk1, formal_charge=-1`; `Make (pk1) Neutral [Ctrl-Shift-U]`=`alter pk1, formal_charge=0`.

### 6.5 `Movie` — `_gui.py:234-376`

- `Append ▸ {0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 18, 24, 30, 48, 60} second` → `cmd.movie.add_blank(i)` (`_gui.py:235-238`; `modules/pymol/movie.py:268`).
- `Program ▸ Camera Loop ▸ Nutate` — 15°/{4,8,12}s, 30°/{4,8,12,16}s, 60°/{8,16,24,32}s → `self.mvprg("movie.add_nutate(<sec>,<deg>,start=%d)")` (`_gui.py:241-256`).
- `Program ▸ Camera Loop ▸ X-Rock` — 30°/{2,4,8}, 60°/{4,8,16}, 90°/{6,12,24}, 120°/{8,16,32}, 180°/{12,24,48} (angle written as `179.99`) → `movie.add_rock(sec,deg,axis='x',start=%d)` (`_gui.py:258-278`).
- `Program ▸ Camera Loop ▸ X-Roll` — 4/8/16/32 seconds → `movie.add_roll(<s>.0,axis='x',start=%d)` (`_gui.py:279-284`).
- `Program ▸ Camera Loop ▸ Y-Rock` — same grid, `axis='y'` (`_gui.py:286-306`).
- `Program ▸ Camera Loop ▸ Y-Roll` — 4/8/16/32 seconds, `axis='y'` (`_gui.py:307-312`).
- `Program ▸ Scene Loop ▸ {Nutate|X-Rock|Y-Rock}` (rock=4/2/1) → for angle∈{30,60,90,120} × the matching seconds tuple `((2,4,8),(4,8,16),(6,12,24),(8,16,32))`, item label `"<angle> deg. over <sec> sec."` firing `set sweep_angle,<angle>;cmd.movie.add_scenes(None, <sec>, rock=<rock>, start=%d)` (`_gui.py:315-327`).
- `Program ▸ Scene Loop ▸ Steady ▸ {1,2,4,8,12,16,24} seconds each` → `movie.add_scenes(None,<v>.0,rock=0,start=%d)` (`_gui.py:329-333`).
- `Program ▸ State Loop` / `State Sweep` ▸ `{Full Speed | 1/2 | 1/3 | 1/4 | 1/8 | 1/16 Speed}` ▸ `{no pause | 1 | 2 | 4 second pause}` → `movie.add_state_loop(<speed>, <pause>, start=%d)` / `movie.add_state_sweep(...)` (`_gui.py:336-349`). That is 2 × 6 × 4 = **48** leaf items.
- `Update Last Program` → `self.mvprg()` re-runs `self.movie_command` (`_gui.py:958-969`).
- `Remove Last Program` → `self.mvprg_remove_last()` → `cmd.mdelete(-1, self.movie_start)` (`_gui.py:950-956`).
- `Reset` → `mset;rewind`.
- `Frame Rate ▸` radios on `movie_fps`: 30/15/5/1/0.3 FPS; check `Show Frame Rate`(`show_frame_rate`); command `Reset Meter`=`cmd.meter_reset`.
- Root checks: `Auto Interpolate`(`movie_auto_interpolate`), `Show Panel`(`movie_panel`), `Loop Frames`(`movie_loop`), `Draw Frames`(`draw_frames`), `Ray Trace Frames`(`ray_trace_frames`), `Cache Frame Images`(`cache_frames`); command `Clear Image Cache`=`cmd.mclear`; checks `Static Singletons`(`static_singletons`,1), `Show All States`(`all_states`,1).

`mvprg` state (`_gui.py:947-969`): `movie_start = cmd.get_movie_length() + 1`, then `movie_command = command % movie_start`, then `cmd.do(movie_command)`. This is **client-side stateful** and must be replicated in the React store.

### 6.6 `Display` — `_gui.py:377-491`

- check `Sequence` (`seq_view`,1).
- `Sequence Mode ▸` radios `seq_view_format`: `Residue Codes`0, `Residue Names`1, `Chain Identifiers`3, `Atom Names`2, `States`4; sep; radios `seq_view_label_mode`: `All Residue Numbers`2, `Top Sequence Only`1, `Object Names Only`0, `No Labels`3; sep; radios `seq_view_gap_mode`: `No Gaps`0, `All Gaps`1, `Single Gap`2.
- checks `Internal GUI`(`internal_gui`,1), `Internal Prompt`(`internal_prompt`,1).
- `Internal Feedback ▸` radios `internal_feedback` = 0,1,3,5.
- `Overlay ▸` radios `overlay` = 0,1,3,5.
- check `Stereo`(`stereo`,1).
- `Stereo Mode ▸` commands: `Anaglyph Stereo`=`stereo anaglyph`, `Cross-Eye Stereo`=`stereo crosseye`, `Wall-Eye Stereo`=`stereo walleye`, `Quad-Buffered Stereo`=`stereo quadbuffer`, `Zalman Stereo`=`stereo byrow`, `OpenVR`=`stereo openvr`, sep, `Swap Sides`=`stereo swap`, sep, `Chromadepth`=`stereo chromadepth`, `off`=`stereo off`.
- `Zoom ▸` `{4,6,8,12,20} Angstrom Sphere` → `cmd.zoom('center', i, animate=-1)`; `All`=`zoom animate=-1`; `Complete`=`zoom animate=-1, complete=1`.
- `Clip ▸` `Nothing`=`clip atoms, 5, all`; `{8,12,16,20,30} Angstrom Slab` → `cmd.clip('slab', i)`.
- `Background ▸` checks `Opaque`(`opaque_background`,1), `Alpha Checker`(`show_alpha_checker`,1); radios `bg_rgb`: `White`0, `Light Grey`134, `Grey`104, `Black`1.
- `Color Space ▸` `CMYK (for publications)`=`space cmyk`, `PyMOL (for video + web)`=`space pymol`, `RGB (default)`=`space rgb`.
- `Quality ▸` `Maximum Performance`=`util.performance(100)`, `Reasonable Performance`=`util.performance(66)`, `Reasonable Quality`=`util.performance(33)`, `Maximum Quality`=`util.performance(0)` (`modules/pymol/util.py:571`).
- `Grid ▸` radios `grid_mode`: `By Object`1, `By State`2, `By Object-State`3, `Disable`0.
- Root checks: `Orthoscopic View`(`orthoscopic`,1), `Show Valences`(`valence`,1), `Smooth Lines`(`line_smooth`,1), `Depth Cue (Fogging)`(`depth_cue`,1), `Two Sided Lighting`(`two_sided_lighting`,1), `Specular Reflections`(`specular`,1.0), `Animation`(`animation`,1), `Roving Detail`(`roving_detail`,1).
- **Appended imperatively** (not in `_gui.py`): separator + `External GUI ▸ Toggle dockable` (`Ctrl+E`) and `▸ Visible` — `pymol_qt_gui.py:377-384`.

### 6.7 `Setting` — `_gui.py:492-774`

Top: `Edit All...` → `settings_edit_all_dialog` (`pymol_qt_gui.py:878-883`, `pmg_qt/advanced_settings_gui.py:PyMOLAdvancedSettings`); `Keyboard Shortcuts...` → `shortcut_menu_edit_dialog` (`:885-889`, `pmg_qt/shortcut_menu_gui.py:PyMOLShortcutMenu`); `Colors...` → `edit_colors_dialog` (`:547-611`).

- `Label ▸ Size ▸` radios `label_size` = 10/14/18/24/36/48/72 "Point"; sep; `-0.3/-0.5/-1/-2/-4` shown as "N Angstrom".
- `Label ▸ Font ▸` radios `label_font_id`: Sans5, Sans Oblique6, Sans Bold7, Sans Bold Oblique8, Serif9, Serif Oblique17, Serif Bold10, Serif Bold Oblique18, Mono11, Mono Oblique12, Mono Bold13, Mono Bold Oblique14, Gentium Roman15, Gentium Italic16.
- `Label ▸ Color ▸` radios `label_color`: `Front`-6, `Back`-7.
- `Label ▸ Show Connectors` check (`label_connector`).
- `Label ▸ Background Color ▸` radios `label_bg_color`: `None`-1, `Back`-7, `Front`-6.
- `Lines & Sticks ▸` check `Ball and Stick`(`stick_ball`,1); `Ball and Stick Ratio ▸` radios `stick_ball_ratio` 1.0/1.5/VDW(-1); `Zero Order Bonds ▸` radios `valence_zero_mode` Hide0/Dashed1/Solid2; `Zero Order Stick Scale ▸` radios `valence_zero_scale` 0.1/0.2/0.3/1.0; `Stick Radius ▸` radios `stick_radius` .1/.2/.25; `Stick Hydrogen Scale ▸` radios `stick_h_scale` .4/1.; `Line Width ▸` radios `line_width` 1.0/1.49/3.0; check `Lines As Cylinders`(`line_as_cylinders`,1).
- `Cartoon ▸ Rings and Bases ▸` radios `cartoon_ring_mode`: Filled Rings (Round Edges)1, (Flat Edges)2, (with Border)3, Spheres4, Base Ladders0; radios `cartoon_ring_finder`: Bases and Sugars1, Bases Only2, Non-protein Rings3, All Rings4; radios `cartoon_ring_transparency`: Transparent Rings0.5, Default-1.
- `Cartoon ▸` checks: `Side Chain Helper`(`cartoon_side_chain_helper`), `Round Helices`, `Fancy Helices`, `Cylindrical Helices`, `Flat Sheets`, `Fancy Sheets`, `Smooth Loops`, `Discrete Colors`, `Highlight Color`(`cartoon_highlight_color`, true=104, false=-1); `Sampling ▸` radios `cartoon_sampling`: `Atom count dependent`-1, 2, 7, 14; `Gap Cutoff ▸` radios `cartoon_gap_cutoff` 0/5/10/20.
- `Ribbon ▸` checks `Side Chain Helper`(`ribbon_side_chain_helper`), `Trace Atoms`(`ribbon_trace_atoms`); radios `ribbon_as_cylinders`: `As Lines`0, `As Cylinders`1; `Cylinder Radius ▸` radios `ribbon_radius`: `Match Line Width`0., `0.2/0.5/1.0 Angstrom`.
- `Surface ▸ Color ▸` radios `surface_color`: White0, Light Gray4236, Gray25, `Default (Atomic)`-1; radios `surface_type`: Dot1, Wireframe2, Solid0; radios `surface_cavity_mode`: `Cavities and Pockets Only`1, `Cavities and Pockets (Culled)`2, `Exterior (Normal)`0; `Cavity Detection Radius ▸` radios `surface_cavity_radius`: `7 Angstrom`, and `-3/-4/-5/-6/-8/-10/-20` labelled "N Solvent Radii"; `Cavity Detection Cutoff ▸` radios `surface_cavity_cutoff` `-1..-5` "N Solvent Radii"; check `Solvent Accessible`(`surface_solvent`); checks `Smooth Edges`(`surface_smooth_edges`), `Edge Proximity`(`surface_proximity`); radios `surface_mode`: `Ignore None`1, `Ignore HETATMs`0, `Ignore Hydrogens`2, `Ignore Unsurfaced`3.
- `Volume ▸` check `Pre-integrated Rendering`(`volume_mode`); `Number of Layers ▸` radios `volume_layers` 100/256/500/1000.
- `Transparency ▸ {Surface|Sphere|Cartoon|Stick}` → each is `transparency_menu(setting)` = radios `Off`0.0, `20%`0.2, `40%`0.4, `50%`0.5, `60%`0.6, `80%`0.8 on `transparency`/`sphere_transparency`/`cartoon_transparency`/`stick_transparency` (`_gui.py:68-72`). Then 4 **composite** commands that set three settings at once (`_gui.py:681-690`): `Uni-Layer`(transparency_mode2, backface_cull1, two_sided_lighting0), `Multi-Layer`(1,0,1), `Multi-Layer (Real-time OIT)`(3,0,-1), `Fast and Ugly`(0,1,0). Then check `Angle-dependent`(`ray_transparency_oblique`,1.0).
- `Rendering ▸` check `OpenGL 2.0 Shaders`(`use_shaders`); check `Antialias (Ray Tracing)`(`antialias`); `Antialias (Real Time) ▸` radios `antialias_shader` off0/FXAA1/SMAA2; command `Modernize` → `cmd.util.modernize_rendering(1, cmd)` (`modules/pymol/util.py:553`); `Shadows ▸` commands `None/Light/Medium/Heavy/Black` then `Matte/Soft/Occlusion/Occlusion2` → `cmd.util.ray_shadows(v)` (`util.py:821`); `Texture ▸` radios `ray_texture`: None0, Matte 1=1, Matte 2=4, Swirl 1=2, Swirl 2=3, Fiber5; `Interior Texture ▸` same values on `ray_interior_texture`; `Memory ▸` radios `hash_max`: `Use Less (slower)`70, `Use Standard Amount`100, `Use More (faster)`170, `Use Even More`230, `Use Most`300; checks `Cull Backfaces`(`backface_cull`), `Opaque Interiors`(`ray_interior_color`, true=74, false=-1).
- `PDB File Loading ▸` check `Ignore PDB Segment Identifier`(`ignore_pdb_segi`).
- `mmCIF File Loading ▸` checks `Use "auth" Identifiers`(`cif_use_auth`), `Load Assembly (Biological Unit)`(`assembly`, true `"1"`, false `""` — a **string** setting), `Bonding by "Chemical Component Dictionary"`(`connect_mode`, true 4, false 0).
- `Map File Loading ▸` checks `Normalize CCP4 Maps`(`normalize_ccp4_maps`), `Normalize O Maps`(`normalize_o_maps`).
- `Auto-Show ... ▸` check `Cartoon/Sticks/Spheres by Classification`(`auto_show_classified`, true -1, false 0); checks `Auto-Show Lines`, `Auto-Show Spheres`, `Auto-Show Nonbonded`, `Auto-Show New Selections`(`auto_show_selections`), `Auto-Hide Selections`(`auto_hide_selections`).
- Root checks: `Auto-Zoom New Objects`(`auto_zoom`), `Auto-Remove Hydrogens`(`auto_remove_hydrogens`), `Show Text (Esc)`(`text`), `Overlay Text`(`overlay`).

### 6.8 `Scene` — `_gui.py:775-805`
`Scenes...` → `scene_panel_menu_dialog` (`pymol_qt_gui.py:891-897`, `pmg_qt/scene_bin_gui.py:ScenePanel`) · `Next [PgDn]`=`cmd.scene('', 'next')` · `Previous [PgUp]`=`cmd.scene('', 'previous')` · `Append`=`scene new, store` · `Append... ▸ Camera`=`scene new, store, color=0, rep=0`, `Color`=`scene new, store, view=0, rep=0`, `Reps`=`scene new, store, view=0, color=0`, `Reps + Color`=`scene new, store, view=0` · `Insert Before`=`cmd.scene('', 'insert_before')` · `Insert After`=`cmd.scene('','insert_after')` · `Update`=`cmd.scene('auto','update')` · `Delete`=`cmd.scene('auto','clear')` · `Recall ▸ F1..F12`=`cmd.scene(k,'recall')`, `Store ▸ F1..F12`, `Clear ▸ F1..F12` (generated by `F_scene_menu`, `_gui.py:61-66`) · check `Buttons`(`scene_buttons`,1) · `Cache ▸ Enable/Optimize/Read Only/Disable` → `cmd.cache("enable"|"optimize"|"read_only"|"disable")`.

### 6.9 `Mouse` — `_gui.py:806-833`
`Selection Mode ▸` radios `mouse_selection_mode`: Atoms0, Residues1, Chains2, Segments3, Objects4, Molecules5, C-alphas6.
Commands: `3 Button Motions`=`cmd.config_mouse('three_button_motions')`, `3 Button Editing`=`config_mouse('three_button_editing')`, `3 Button Viewing`=`cmd.mouse('three_button_viewing')`, `3 Button Lights`=`cmd.mouse('three_button_lights')`, `3 Button All Modes`=`config_mouse('three_button_all_modes')`, `2 Button Editing`=`config_mouse('two_button_editing')`, `2 Button Viewing`=`config_mouse('two_button')`, `1 Button Viewing Mode`=`cmd.mouse('one_button_viewing')`, `Emulate Maestro`=`cmd.mouse('three_button_maestro')`. (`cmd.config_mouse` at `modules/pymol/controlling.py:168`; `cmd.mouse` is marked INTERNAL at `controlling.py:609`.)
Checks: `Virtual Trackball`(`virtual_trackball`), `Show Mouse Grid`(`mouse_grid`), `Roving Origin`(`roving_origin`).

### 6.10 `Wizard` — `_gui.py:834-865`
`Appearance`=`wizard appearance` · `Measurement`=`wizard measurement` · `Mutagenesis ▸ Protein`=`wizard mutagenesis`, `▸ Nucleic Acids`=`wizard nucmutagenesis` · `Pair Fitting`=`wizard pair_fit` · `Density`=`wizard density` · `Filter`=`wizard filter` · `Sculpting`=`wizard sculpting` · `Label`=`wizard label` · `Charge`=`wizard charge` · `Demo ▸` `Representations`/`Cartoon Ribbons`/`Roving Detail`/`Roving Density`/`Transparency`/`Ray Tracing`/`Sculpting`/`Scripted Animation`/`Electrostatics`/`Compiled Graphics Objects`/`Molscript/Raster3D Input` → `cmd.wizard('demo', 'reps'|'cartoon'|'roving'|'roving_density'|'trans'|'ray'|'sculpt'|'anime'|'elec'|'cgo'|'raster3d')`, sep, `End Demonstration` → `cmd.replace_wizard('demo', 'finish')`.

### 6.11 `Plugin` — `_gui.py:866` is an **empty list**
At startup, exactly one item is added imperatively: `Initialize Plugin System` → `self.initializePlugins` (`pymol_qt_gui.py:397-398`). See §8.

### 6.12 `Help` — `_gui.py:867-888`
All `webbrowser.open(...)` except `About PyMOL`:
`PyMOL Home Page` http://www.pymol.org · `PyMOL Product Page` https://www.schrodinger.com/platform/products/pymol/ · `PyMOL Community Wiki` http://www.pymolwiki.org · `PyMOL Command Reference` http://pymol.org/pymol-command-ref.html · `PyMOL 3 Documentation` https://learn.schrodinger.com/public/pymol/current/Content/pymol/pymol_home.htm · `Legacy Online Documentation` http://pymol.org/d/ · `Topics ▸ Selection Algebra | Settings | Timeline Python API` (pymolwiki pages) · `PyMOL Mailing List` https://lists.sourceforge.net/lists/listinfo/pymol-users · `About PyMOL` → `self.show_about` · `Sponsorship Information` http://pymol.org/funding.html · `How to Cite PyMOL` http://pymol.org/citing.

### 6.13 Menu items whose callable is `None`
`PyMOLDesktopGUI` declares 22 class attributes as `None` (`_gui.py:12-40`). `PyMOLQtGUI` supplies all of them (imports at `pymol_qt_gui.py:36-45` + methods), but if a subclass didn't, `_addmenu` would print `warning: skipping <item>` and silently omit the entry (`pymol_qt_gui.py:306-307`). Note `_gui.py:39-40` declares `shortcut_menu_edit_dialog` and `scene_panel_dialog`, while the menu data actually references `self.scene_panel_menu_dialog` (`_gui.py:776`) — the declared-but-unused name is `scene_panel_dialog`; the real method is `scene_panel_menu_dialog` (`pymol_qt_gui.py:891`).

### 6.14 `Open Recent...` — the one genuinely dynamic submenu
Created by the `('open_recent_menu',)` marker (`pymol_qt_gui.py:341-342`), then populated on every `aboutToShow` (`pymol_qt_gui.py:366-374`): `clear()`, then one action per `self.recent_filenames`, label truncated to `'...' + fname[-120:]` when `len >= 128`, action calls `self.load_dialog(fname)`.

Backing store — **sqlite**, `modules/pymol/_gui.py:975-1032`:
- DB at `~/.pymol/recent.db`, table `recent (filename text unique, timestamp integer)` (`_gui.py:986-998`).
- Failure to connect prints `" Warning: failed to connect to recent DB: <e>"` and disables the feature (`_gui.py:1000-1003`).
- `recent_filenames` = `SELECT filename FROM recent ORDER BY timestamp DESC` (`_gui.py:1013-1014`).
- `recent_filenames_add` = `REPLACE INTO recent VALUES (?, datetime('now'))`; when count > 20, deletes rows older than the 16th newest (`LIMIT 1 OFFSET 15`) (`_gui.py:1016-1032`).
- Only `session_save_as` calls `recent_filenames_add` in this file (`pymol_qt_gui.py:671`); `load_dialog` in `file_dialogs.py` is the other likely caller (verify in the file-dialogs area).

---

## 7. Keyboard shortcuts owned by the main window

| Binding | Effect | Source |
|---|---|---|
| `Ctrl+E` | Toggle External GUI dockable | `pymol_qt_gui.py:379-380` |
| `Ctrl+O` | `self.file_open` (`QShortcut`, described as "MacPyMOL compatible") | `pymol_qt_gui.py:387` |
| `Ctrl+S` | `self.session_save` | `pymol_qt_gui.py:388` |
| `Tab` (line edit) | completion; `Tab` (GL widget) forwarded to `pymol.button` | `pymol_qt_gui.py:423-424, 452-454` |
| `Up/Down/Ctrl+Up/Enter` (line edit) | history / submit | `pymol_qt_gui.py:425-435` |
| Any other key with focus in the window | `keyPressEvent` → `keymapping.keyPressEventToPyMOLButtonArgs(ev)` → `pymolwidget.pymol.button(k, state, 0, 0, mod)` | `pymol_qt_gui.py:50-54`, `keymapping.py:61-97` |

`keymapping.py` translation tables (needed 1:1 in the browser):
- `keyMap` (`keymapping.py:10-17`): Escape→27, Tab→9, Backspace→8, Return/Enter→13, Delete→127.
- `specialMap` (`keymapping.py:19-41`): Left100, Up101, Right102, Down103, PageUp104, PageDown105, Home106, End107, Insert108, F1..F12 → 1..12. Special keys use `state = -2` (`PyMOL_Special`), ordinary keys `state = -1` (`PyMOL_Key`).
- Modifier mask (`keymapping.py:44-58`): Shift=0x1, Meta **or** Ctrl=0x2, Alt=0x4.
- Ctrl-<key> without text ⇒ `k = key - 64`; Alt-<key> ⇒ `k = key`; keys outside 0..255 are dropped (`keymapping.py:84-96`).

Saved user shortcuts: `pymol.save_shortcut.load_and_set(self.cmd)` at window construction (`pymol_qt_gui.py:419`), which reads `~/.pymol/shortcuts_save.json` and calls `cmd.set_key(key, value[2])` per entry (`modules/pymol/save_shortcut.py:6, 38-71`). The returned dict is stored as `self.saved_shortcuts` and handed to `PyMOLShortcutMenu` (`pymol_qt_gui.py:888`).

---

## 8. Plugin menu machinery (legacy Tk shim)

`initializePlugins` (`pymol_qt_gui.py:970-988`), decorated with `@PopupOnException.decorator`:
1. `self.menudict['Plugin'].clear()`;
2. `app = plugins.get_pmgapp()` (→ `pymol/gui.py:20-26` → `createlegacypmgapp`, overridden at `pymol_qt_gui.py:1240` to `window.createlegacypmgapp`);
3. `plugins.legacysupport.addPluginManagerMenuItem()` → adds `Plugin Manager` (`modules/pymol/plugins/legacysupport.py:72-87`), which opens the Qt `PluginManager` when `pymol.gui.get_qtwindow()` returns a window;
4. **Re-points the registry**: `menudict['PluginQt'] = menudict['Plugin']`, then `menudict['Plugin'] = menudict['PluginQt'].addMenu('Legacy Plugins')` — so Qt plugins land under `Plugin`, Tk plugins under `Plugin ▸ Legacy Plugins`;
5. `plugins.HAVE_QT = True; plugins.initialize(app)` (`modules/pymol/plugins/__init__.py:408`).

`createlegacypmgapp` (`pymol_qt_gui.py:990-994`) builds `mimic_pmg_tk.PMGApp()` and sets `pmgapp.menuBar = mimic_pmg_tk.PmwMenuBar(self.menudict)`.

`PmwMenuBar` (`mimic_pmg_tk.py:29-91`) is the Pmw-compatible façade plugins call through `pymol.plugins.addmenuitem` (`modules/pymol/plugins/__init__.py:112-129`) and `addmenuitemqt` (`:101-109`):
- `addmenu(name)` → `addcascademenu('', name)`;
- `deletemenuitems(menuName, start, end)` → removes `menu.actions()[start-1:(end or start)]` (**1-based, inclusive** — off-by-one-prone);
- `addmenuitem(menuName, 'separator'|'command', label=..., command=...)` — the command is wrapped so exceptions print a colored traceback and pop a `QMessageBox.critical` "Error" ("PyMOL would crash if an exception is not caught", `mimic_pmg_tk.py:65-77`);
- `addcascademenu(parent, name, label=...)` — raises `ValueError` if the menu name already exists; sets `TearOffEnabled`;
- unknown menu names print `Error: no such menu: <name>` and return `None`.
- Label paths use `|` as the separator (`plugins/__init__.py:116-129`), and a leaf label of `'-'` means "separator".

`PMGApp` (`mimic_pmg_tk.py:132-174`) lazily creates a **real hidden `tkinter.Tk()` root** on first `.root` access, wraps `root.tk` in `tkapp_proxy` and pumps `root.update()` from a 50 ms `QTimer`, pausing while `update`/`tkwait`/`vwait` are in flight (`mimic_pmg_tk.py:108-129, 150-163`). `Pmw.initialise(root)` is called at the end.

`mimic_tk.py` injects Qt replacements into `sys.modules` for `tkMessageBox` and `tkFileDialog` (`mimic_tk.py:99-100`) and installs a `MimicTkImporter` meta-path finder mapping `tkinter.messagebox` / `tkinter.filedialog` (`mimic_tk.py:106-128`). `_qtMessageBox` maps `askyesno/askquestion/askokcancel/askretrycancel/showinfo/showerror/showwarning` onto `QMessageBox` (`mimic_tk.py:13-33`); `_qtFileDialog` maps `askopenfilename(s)/askopenfile(s)/asksaveasfilename/asksaveasfile/askdirectory` and converts Tk `filetypes` tuples into Qt filter strings (`mimic_tk.py:36-91`).

Detection of this shim elsewhere: `'pmg_qt.mimic_tk' in sys.modules` at `modules/pymol/plugins/installation.py:155` and `legacysupport.py:43, 135, 153`.

### Web plan
Legacy Tk plugins **cannot** be ported. Decide explicitly: either (a) drop `Plugin ▸ Legacy Plugins` and keep only a Qt→React plugin API, or (b) keep the plugin process headless in Python and let plugins register *menu descriptors* (label path, id) over the bridge, with the React menu rendering them and RPCing back on click. Option (b) preserves `addmenuitem('A|B|C', fn)` semantics with a JSON tree; option (a) is much cheaper.

---

## 9. Dialogs owned by the main window

### 9.1 `load_form` — the .ui loader (`pymol_qt_gui.py:512-545`)
Tries `importlib.import_module('.forms.<name>', 'pmg_qt')` (pre-generated `Ui_Form`/`Ui_Dialog`), else falls back to `pymol.Qt.utils.loadUi(<dir>/forms/<name>.ui, widget)` (`modules/pymol/Qt/utils.py:269-320`). `dialog='floating'` wraps the widget in a floating `QDockWidget`. Available forms (`modules/pmg_qt/forms/`): `askpartial, change_confirm, colors, create_shortcut, fetch, help_shortcut, load_aln, load_mae, load_map, load_mtz, load_traj, movieexport, pluginitem, pluginmanager, png, props, render, save_molecule, save_object, shortcut_menu`.

### 9.2 `Setting ▸ Colors...` (`edit_colors_dialog`, `pymol_qt_gui.py:547-611`, form `forms/colors.ui`)
Widgets: `list_colors` (`QListWidget`, sorting enabled, filled from `cmd.get_color_indices()`), `input_name` (`QLineEdit`), `input_R/G/B` (`QDoubleSpinBox`, max 1.0, step per .ui), `slider_R/G/B` (`QSlider`, max 100), `frame_color` (`QFrame` preview via stylesheet `background-color: rgb(...)`), `button_apply`.
Wiring: sliders → spinboxes (`v/100`), spinboxes → sliders (`round(v*100)`) + preview, `input_name.textChanged` → `load_color` (`cmd.get_color_index(name)`, `-1` ⇒ ignore; then `cmd.get_color_tuple(index)`), list selection → name field. `button_apply` runs `cmd.do("set_color %s, [%.2f, %.2f, %.2f]\nrecolor")` and inserts+selects the name if new. A `spinbox_lock` flag prevents feedback loops (`pymol_qt_gui.py:566-583`).

### 9.3 `Draw/Ray` render dialog (`render_dialog`, `pymol_qt_gui.py:673-790`, form `forms/render.ui`)
Two-page `QStackedWidget` (`stack`).
Page 1 fields: `input_width`/`input_height` (`QSpinBox`, px), `input_width_units`/`input_height_units` (`QDoubleSpinBox`, suffix follows `input_units`), `input_units` (`QComboBox`: inch / cm — factor `1.0` vs `2.54`), `input_dpi` (editable `QComboBox` with `QIntValidator`, pre-filled from `cmd.get_setting_int('image_dots_per_inch')` when > 0), `button_current` ("Use current viewport size" → `cmd.get_viewport()`), `button_lock` (`QCheckBox`, aspect-ratio lock; computes `form.aspectratio = w/h`, unchecks itself on `ZeroDivisionError`), `input_transparent` (checkbox), `button_draw`, `button_ray`.
Actions: `run_draw` → `cmd.do('draw %d, %d')`; `run_ray` → `cmd.set('opaque_background', not input_transparent.isChecked())` then `cmd.do('ray %d, %d, async=1')`; both then switch to page 2.
Page 2: `button_save` ("Save Image to File") → `getSaveFileNameWithExt(filter='PNG File (*.png)')` then `cmd.png(fname, prior=1, dpi=<dpi>)`; `button_clip` ("Copy Image to Clipboard") → `_copy_image(cmd, False, dpi)` inside `PopupOnException`; `button_back` ("< Back") → page 1.
Circular-update protection uses `UpdateLock([ZeroDivisionError])` with `@lock.skipIfCircular` (`modules/pymol/Qt/utils.py:5-62`).
`_copy_image` (`pymol_qt_gui.py:1170-1185`): renders to a `tempfile.mktemp('.png')`, loads a `QImage`, `QApplication.clipboard().setImage(...)`, unlinks, prints `" Image copied to clipboard"` when not quiet. It is installed as `pymol.cmd._copy_image` at `pymol_qt_gui.py:1242`.

### 9.4 Lazily-constructed panels held by the window (`pymol_qt_gui.py:103-108`)
`dialog_png`, `advanced_settings_dialog`, `props_panel`, `builder`, `shortcut_menu_filter_dialog`, `scene_panel_dialog` — each created on first use in `settings_edit_all_dialog`/`open_props_dialog`/`open_builder_panel`/`shortcut_menu_edit_dialog`/`scene_panel_menu_dialog`.

### 9.5 `About PyMOL` (`show_about`, `pymol_qt_gui.py:899-916`)
`QMessageBox.about(self, "About PyMOL", text)` where text is exactly:
```
The PyMOL Molecular Graphics System

Version <cmd.get_version()[0]>
Copyright (C) Schrödinger, LLC.
All rights reserved.

License information:
Open-Source Build

For more information:
https://pymol.org
sales@schrodinger.com
```
(the `'Open-Source Build'` line is unconditional in this build, `pymol_qt_gui.py:908`).

### 9.6 Splash
There is **no Qt splash screen**. The splash is drawn inside the OpenGL viewport: `options.show_splash` (`modules/pymol/invocation.py:142`) causes `cmd.splash(1)` to be inserted as the first deferred command (`invocation.py:529-530`); the command is `modules/pymol/commanding.py:297`, and the C++ side consumes it via `OrthoInit(G, G->Option->show_splash)` (`layer5/PyMOL.cpp:1954`). `-q` clears it (`invocation.py:488`).
**Web implication:** the splash is part of the rendered ortho layer, so it either arrives as CGO/image data over the wire or must be re-implemented as a React overlay. Flag this to the viewport/ortho agent.

---

## 10. Drag-and-drop of files

Two independent drop targets:

1. **GL viewport** (`pymol_gl_widget.py:118-119` enables it; handlers at `:256-270`): `dragEnterEvent` accepts anything with URLs; `dropEvent` iterates `event.mimeData().urls()`, converting local files with `toLocalFile()` else `toString()` (so **remote URLs are passed through**), and calls `self.gui.load_dialog(url)` for each.
2. **Command line** — text preview insert, see §3.5.
3. **App icon / Finder** — `PyMOLApplication` (`pymol_qt_gui.py:1127-1166`): `handle_file_open` ignores events until the first `ApplicationActivate` (so `sys.argv` isn't hijacked by Qt), then handles `QEvent.FileOpen`:
   - if `not options.reuse_helper and cmd.get_names()` ⇒ `window.new_window([ev.file()])` (new process);
   - if `options.auto_reinitialize` (`pymol -I -U`) ⇒ `cmd.reinitialize()`;
   - if the file ends in `.psw` ⇒ `cmd.set('presentation')`, `cmd.set('internal_gui', 0)`, `cmd.set('internal_feedback', 0)`, `cmd.full_screen('on')`;
   - then `window.load_dialog(ev.file())`.

### Web plan
Browser drops give `File` objects, **not paths**. Since the backend is local with full filesystem access, the bridge needs two paths: (a) if the drop carries a real path (Electron/Tauri, or `text/uri-list` from a native app) send the path and call `load_dialog`; (b) otherwise upload the bytes to the bridge, write to a temp dir, and load from there. The `.psw` presentation branch and the "open in a new instance" branch are process-level and should be re-scoped (new browser tab ⇒ new backend process, or just refuse).

---

## 11. Application startup and shutdown flow

### Startup (`execapp`, `pymol_qt_gui.py:1193-1267`)
Entered from `pymol.launch` (`modules/pymol/__init__.py:415-425`): if `options.gui == 'pmg_qt'` and not `no_gui`/`testing`, `from pmg_qt import pymol_qt_gui; return pymol_qt_gui.execapp()`; on `ImportError` it prints `Qt not available (...), using GLUT/Tk interface` and falls back to `pmg_tk`. `no_gui` goes to `_launch_no_gui()` (`__init__.py:386-403`), which spins `p.draw()` until idle conditions clear.

`execapp` steps, in order:
1. `sys.excepthook = traceback.print_exception` — "don't let exceptions stop PyMOL" (`:1200-1202`);
2. Windows: `AA_UseDesktopOpenGL` (`:1204-1206`);
3. `AA_EnableHighDpiScaling` unless `QT_SCALE_FACTOR`/`QT_SCREEN_SCALE_FACTORS` set (`:1208-1212`);
4. Windows taskbar icon via `SetCurrentProcessExplicitAppUserModelID('com.schrodinger.pymol')` (`:1214-1218`);
5. `app = PyMOLApplication(['PyMOL'])`; `app.setWindowIcon(make_pymol_qicon())` → `$PYMOL_DATA/pymol/icons/icon2.svg` (`:1188-1190`, `:1220-1221`);
6. `window = PyMOLQtGUI()`; `setWindowTitle("PyMOL")`; `app.setDesktopFileName("org.pymol.PyMOL")` (gnome/wayland wmclass fix) (`:1223-1227`);
7. **Command overloads** via `commandoverloaddecorator` (`:1033-1038` — copies the docstring from `pymol.cmd.<name>`, `setattr`s onto `pymol.cmd`, then `pymol.cmd.extend`):
   - `viewport(w,h)` → `window.viewportsignal.emit(int(w), int(h))` (thread-safe hop into `pymolviewport`, `:1229-1231`),
   - `full_screen(toggle)` → resolves `pymol.viewing.toggle_dict/toggle_sc` then `window.toggle_fullscreen(toggle)` (`:1233-1237`);
8. `pymol.gui.createlegacypmgapp = window.createlegacypmgapp` (`:1239-1240`);
9. `pymol.cmd._copy_image = _copy_image`; `pymol.cmd._call_in_gui_thread = MainThreadCaller()` (`:1242-1243`; `MainThreadCaller` at `Qt/utils.py:147`);
10. `pymol.cmd._call_with_opengl_context = lambda func: _call_in_gui_thread(lambda: with window.pymolwidget: func())` (`:1245-1252`) — **the backend calls back into the GUI to get a current GL context**;
11. `window.show(); window.raise_()`;
12. if `options.win_xy_set`: `viewport(fb_scale * win_x, fb_scale * win_y)` (`:1257-1261`);
13. if `options.plugins`: `window.initializePlugins()` (`:1263-1265`);
14. `app.exec()`.

Window-construction side effects worth noting: the `PyMOLGLWidget` constructor **starts the PyMOL engine** (`self.pymol = PyMOL(); self.pymol.start()`, `pymol_gl_widget.py:99-101`) and installs `pcatch._install()` to capture Python stdout into the feedback queue (`pymol_gl_widget.py:104-105`).

### Shutdown
`closeEvent` → `self.cmd.quit()` (`pymol_qt_gui.py:56-57`). `File ▸ Quit` → `QApplication.instance().quit()` (`:875-876`). No unsaved-session prompt exists.

### `window_cmd` — the `cmd.window` backend hook (`pymol_qt_gui.py:996-1030`)
Reached from `cmd.window(action, x, y, w, h)` (`modules/pymol/viewing.py:1430-1457`) which resolves the action name through `window_dict` (`modules/pymol/constants.py:150-152`): `hide`0, `show`1, `position`2, `size`3, `box`4, `maximize`5, `fit`6, `focus`7, `defocus`8. `fit` clamps the frame geometry into `screen().availableGeometry()` and no-ops when Maximized/FullScreen.

### `viewport` / `pymolviewport` (`pymol_qt_gui.py:59-81`)
`viewportsignal = QtCore.Signal(int, int)` connected to `pymolviewport` (`:100`) so viewport resizes issued from worker threads land on the GUI thread. `pymolviewport` maintains aspect ratio when only one dimension is given, and resizes the **window** by `QSize(w-cw, h-ch)/fb_scale`, i.e. it grows the window to make the GL area match the requested pixel size.

---

## 12. Backend contract summary for the bridge

Commands/APIs this area calls (all confirmed present):

`cmd.do`, `cmd.set(name_or_index, value, log=1, quiet=0)`, `cmd.get`, `cmd.get_setting_tuple`, `cmd.get_setting_int`, `cmd.setting._get_index`, `cmd.get_setting_updates` (`setting.py:440`), `cmd._get_feedback` (`internal.py:593`), `cmd.get_progress` (`monitoring.py:5`), `cmd.interrupt` (`locking.py:88`), `cmd.get_viewport`, `cmd.get_view`, `cmd.set_view`, `cmd.reset`, `cmd.zoom`, `cmd.orient`, `cmd.unpick`, `cmd.deselect`, `cmd.rock`, `cmd.rewind`, `cmd.backward`, `cmd.forward`, `cmd.ending`, `cmd.mplay`, `cmd.mstop`, `cmd.mclear`, `cmd.rebuild`, `cmd.reinitialize`, `cmd.save`, `cmd.png`, `cmd.run`, `cmd.cd`, `cmd.system`, `cmd.log_open`/`log_close`/`resume` (`commanding.py:107, 206, 52`), `cmd.quit`, `cmd.undo`, `cmd.redo`, `cmd.scene`, `cmd.cache` (`exporting.py:48`), `cmd.clip`, `cmd.wizard`, `cmd.replace_wizard` (`wizarding.py:94`), `cmd.config_mouse` (`controlling.py:168`), `cmd.mouse` (`controlling.py:609`), `cmd.meter_reset` (`viewing.py:1800`), `cmd.sculpt_purge` (`editing.py:104`), `cmd.mdelete` (`moving.py:591`), `cmd.get_movie_length` (`querying.py:730`), `cmd.get_version` (`querying.py:603`), `cmd.get_color_indices`/`get_color_index`/`get_color_tuple` (`querying.py:843, 858, 825`), `cmd.get_names`, `cmd.as_pathstr` (`cmd.py:116`), `cmd.exp_path`, `cmd.set_key`, `cmd.extend`, `cmd._parser.complete` (`parser.py:524`), `cmd.editor.attach_amino_acid` / `attach_fragment` (`editor.py:98, 51`), `cmd.movie.add_blank/add_roll/add_rock/add_nutate/add_scenes/add_state_loop/add_state_sweep` (`movie.py:268, 296, 346, 433, 562, 409, 384`), `cmd.util.performance/ray_shadows/modernize_rendering` (`util.py:571, 821, 553`).

Engine-loop APIs (from `pymol_gl_widget.py`): `pymol.start()`, `pymol.idle()`, `pymol.getRedisplay()`, `pymol.draw()`, `pymol.reshape(w,h,True)`, `pymol.button(...)`, `pymol.drag(...)`.

**Bridge hooks the backend expects the front end to provide** (currently monkey-patched in `execapp`): `pymol.cmd._copy_image`, `pymol.cmd._call_in_gui_thread`, `pymol.cmd._call_with_opengl_context`, `pymol.gui.createlegacypmgapp`, and the overloaded `cmd.viewport` / `cmd.full_screen`. `pymol.gui.get_qtwindow()` (`modules/pymol/gui.py:28-36`) is queried by `cmd.window` (`viewing.py:1450`), `pymol.gui.save_as`/`save_image` (`gui.py:70-92`) and `plugins/legacysupport.py:76`. **These are the exact seams the Python bridge service must fill.**

---

## 13. Risks and contradictions vs the target architecture

1. `pymol.cmd._call_with_opengl_context` (`pymol_qt_gui.py:1245-1252`) makes the **backend** depend on a live, current OpenGL context in the GUI process. With rendering moved to the browser there is no such context in Python. Anything routed through it (shader-dependent operations, `ray`/`draw`/`png` in some paths) must either get a headless/offscreen GL context in the Python process or fail loudly.
2. `_copy_image` writes a PNG to a temp file and pushes it to the OS clipboard (`pymol_qt_gui.py:1170-1185`). In the browser this becomes a base64 data transfer + `navigator.clipboard.write(ClipboardItem)`, which requires a user gesture and HTTPS/localhost.
3. Feedback and setting sync are **polled at 500 ms** (`pymol_qt_gui.py:958`). Naively porting the poll over WebSocket is wasteful; push is the right model, but `cmd.get_setting_updates()` is a *drain* (consume-once) API — only one consumer may call it, so the bridge must own it and fan out.
4. `cmd.get_setting_updates()` being consume-once also means the internal GUI (`layer2/3` ortho widgets) and the web client compete for the same queue. Verify with the internal-GUI agent.
5. `_addmenu` silently drops items whose command is `None` (`pymol_qt_gui.py:306`) and prints `error:` for unknown types (`:343`). A serialized menu tree must define what `None` means (disabled vs omitted).
6. `QActionGroup`s are keyed by setting **name only** (`pymol_qt_gui.py:322-327`); a naive React port that scopes radio groups per submenu will behave *differently* (arguably better) than PyMOL. Decide and document.
7. Tear-off menus (`setTearOffEnabled(True)`, `pymol_qt_gui.py:297`, `mimic_pmg_tk.py:90`) have no browser equivalent. Either drop them or implement detachable palettes.
8. `File ▸ New PyMOL Window` spawns a whole new OS process (`_gui.py:42-53`) — contradicts "one process, one browser client". Needs a product decision (disable, or spawn a second backend + open a new tab on a new port).
9. Legacy Tk plugins (`mimic_pmg_tk.PMGApp` creating a real hidden `Tk()` root, `mimic_pmg_tk.py:140-168`) cannot run in the browser. `mimic_tk.py` also installs a **global `sys.meta_path` hook** (`mimic_tk.py:128`) that will still fire in the headless backend and hand plugins Qt dialogs that no one can see.
10. Filesystem completion in the command line (`parser.py:561-593`) prints candidate lists into the feedback stream instead of returning them — the web UI cannot render a proper completion popup without either re-implementing or extending `_complete` (which we may not do: source is read-only).
11. `confirm_quit` (`pymol_qt_gui.py:875`) does not actually confirm; `closeEvent` calls `cmd.quit()` unconditionally (`:56-57`). A browser tab close cannot reliably run this — the bridge needs a heartbeat/lifecycle policy.
12. The stylesheet `data/pmg_qt/styles/pymol.sty` is nearly empty; almost all visual identity comes from the native Qt theme. The React shell has no design source of truth to copy — expect a design pass.
13. `pymolviewport` resizes the *window* to satisfy `cmd.viewport w, h` (`pymol_qt_gui.py:62-81`). A browser cannot resize its own window reliably; `cmd.viewport` must instead resize the canvas element and report the achieved size back.
14. Drag-and-drop of files from the OS gives no path in a plain browser (§10).

## 14. Open questions

- Does `file_dialogs.load_dialog` call `recent_filenames_add`? (Only `session_save_as` does so in `pymol_qt_gui.py`; confirm in the file-dialogs area, `modules/pmg_qt/file_dialogs.py:33`.)
- Where should `Open Recent` live — keep the server-side `~/.pymol/recent.db` (`_gui.py:986`) or mirror in browser storage? Server-side is more faithful.
- Should the web app expose `Display ▸ Internal GUI` / `Internal Prompt` / `Internal Feedback` / `Overlay` at all, given the internal ortho GUI is being replaced by React? (These are settings `internal_gui`, `internal_prompt`, `internal_feedback`, `overlay`, `_gui.py:409-418`.)
- Stereo modes (`_gui.py:420-433`): which, if any, are reproducible in WebGL/WebXR? `stereo openvr` almost certainly must be dropped.
- What replaces `Setting ▸ Keyboard Shortcuts...` persistence (`~/.pymol/shortcuts_save.json`, `save_shortcut.py:6`) — server-side file (faithful) or browser storage?
