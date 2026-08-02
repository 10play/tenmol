# 02 — Completeness Critique (adversarial review of 00 + 01)

Read-only audit of `docs/00-parity-inventory.md` and `01-architecture.md` plus the 12
area maps, against the PyMOL source in this tree. Every claim below cites a `file:line` I opened.

---

## A. Blockers — the architecture as written does not run

### A1. "Never call `draw()`" silently disables all viewport input, `cmd.png`, deferred ray, and rep rebuilds

`01-architecture.md:47-52` and `:251` state the bridge pump "calls `p.idle()` and `p.getRedisplay()`
but **never** `p.draw()`".

But mouse input into the scene is not executed on arrival — it is *queued*:

* `CScene::click` → `SceneDeferClickWhen` → `OrthoDefer` (`packages/engine/layer1/Scene.cpp:4113-4126`)
* `CScene::drag` → `OrthoDefer` (`packages/engine/layer1/Scene.cpp:4129-4137`)
* `CScene::release` → `OrthoDefer` (`packages/engine/layer1/Scene.cpp:4145-4155`)
* deferred image (`cmd.png`): `OrthoDeferImage` → `OrthoDefer` (`packages/engine/layer1/Ortho.cpp:3141-3169`)
* deferred ray (`ExecutiveRay` with `auto_copy_images`): `packages/engine/layer1/SceneRay.cpp:754-769`,
  forced at `packages/engine/layer3/Executive.cpp:11638-11641`
* `SceneDeferImage`: `packages/engine/layer1/Scene.cpp:4095-4110`

The queue is drained by `OrthoExecDeferred` (`packages/engine/layer1/Ortho.cpp:268-277`), whose **only** caller in
the entire tree is `ExecutiveDrawNow` (`packages/engine/layer3/Executive.cpp:11521-11523`). `ExecutiveDrawNow` is
reached from `PyMOL_Draw` (`packages/engine/layer5/PyMOL.cpp:2334`), `CmdRefresh` / `CmdRefreshNow`
(`packages/engine/layer4/Cmd.cpp:4728`, `:4748`), `CmdPNG` (`:4811`) and the movie loop (`packages/engine/layer1/Movie.cpp:315,746`).

Consequence: with a pump that never draws and never refreshes, `_cmd._button` / `_cmd._drag`
return successfully and *nothing happens* — no rotation, no picking, no rubber-band selection.

`ExecutiveDrawNow` is also the only routine call site of `SceneUpdate(G,false)`
(`packages/engine/layer3/Executive.cpp:11532-11534`), which is what runs `Rep::update()` and builds the very
geometry WP-06 exists to serialize. The `geometry-extraction` map already knows this
(`geometry-extraction.md:74-79`: "`cmd.refresh()` … are the Python triggers") — but `cmd.refresh`
*is* `ExecutiveDrawNow`. **The two synthesis documents disagree with each other about the single
most load-bearing decision in the plan.**

The workable answer is probably "call `cmd._refresh()` on the PyMOL thread each tick, with
`HaveGUI=1` and `ValidContext=0`", but that path is untested and runs `OrthoDoDraw`
(`packages/engine/layer1/Ortho.cpp:1852`) whose pre-guard prologue touches `G->ShaderMgr->topLevelConfig =
OrthoGetBackbuffers(...)` *before* the `if (G->HaveGUI && G->ValidContext)` guard at `:1894`.
This must be a day-one experiment, not an assumption.

### A2. `ModalDraw` hangs the whole engine when there is no draw loop

`MoviePNG` (`packages/engine/layer1/Movie.cpp:822`) sets `PyMOL_SetModalDraw(..., MovieModalDraw)`
(`packages/engine/layer1/Movie.cpp:866`, re-armed at `:816`) when `modal` is set. `cmd.mpng` reaches it at
`packages/engine/layer4/Cmd.cpp:4854`.

While `I->ModalDraw` is non-null, the engine's API entry macros short-circuit:
`#define PYMOL_API_LOCK if(I->PythonInitStage && (!I->ModalDraw)) {` (`packages/engine/layer5/PyMOL.cpp:93`,
non-Python variant `:99`). `PyMOL_Idle` returns `did_work || I->ModalDraw` (`:2466-2470`) — i.e.
"always busy". The flag is only cleared inside `PyMOL_Draw` (`packages/engine/layer5/PyMOL.cpp:2279-2286`).

Consequence: the first `cmd.mpng` / `movie.produce` in a never-draw bridge puts the engine into a
state where every subsequent `_button`, `_drag`, `_idle` is a no-op forever. Not mentioned in
either document, and `movie.produce` is a first-class parity row (00 §7 / §6).

### A3. The sequence viewer model is built only in the draw path

`SeqUpdate` has exactly two call sites, both inside `OrthoDoDrawUpdateSeqView`
(`packages/engine/layer1/Ortho.cpp:1470-1478`), itself called only from `OrthoDoDraw` (`:1882`), and gated on the
`seq_view` setting. §14 item 5 specifies a new `get_seq_view()` accessor reading Seeker state — in
a never-draw process that state is never built and never invalidated. WP-20 has no working data
source as specified.

### A4. The "one ordered PyMOL thread" model is not enforced by anything

`01-architecture.md:247-265` builds correctness on "PyMOLThread (exactly one)" and
`:713-717` on "the request must be issued from a worker thread, never the single PyMOL thread".

`is_gui_thread()` returns `gui_ident is None or gui_ident == thread.get_ident()`
(`packages/engine/modules/pymol/locking.py:80-86`). `pymol.glutThread` is module-level `None`
(`packages/engine/modules/pymol/__init__.py:543`) and is only ever set by `prime_pymol`/`launch`
(`packages/engine/modules/pymol/__init__.py:378-383`); `pymol2.SingletonPyMOL.start()`
(`packages/engine/modules/pymol2/__init__.py:52-63`) never sets it (`self.glutThread = None` at `:124` is on the
`PyMOL` subclass and is a different attribute).

Therefore, under `SingletonPyMOL`, **every** thread is "the GUI thread". `cmd.refresh()`
(`packages/engine/modules/pymol/viewing.py:1769-1772`), `cmd.sync()` (`packages/engine/modules/pymol/commanding.py:415-419`),
`cmd.do` flushing (`commanding.py:466`) and `internal.py:547` will all execute inline on whatever
uvicorn/worker thread calls them instead of being marshalled. The bridge must set
`pymol.glutThread` to its PyMOL thread ident explicitly, or the ordering guarantee is fiction.
Zero mentions of `is_gui_thread` / `glutThread` across all 14 documents.

### A5. The two synthesis documents contradict each other on picking

* `00-parity-inventory.md:519`: "**Picking stays backend-authoritative.** Provision an offscreen GL
  context." (grounded in `packages/engine/layer1/ScenePicking.cpp:17-38,146-149`)
* `01-architecture.md:497-504`: "Our picking is therefore client-side (three.js raycast …)".

These are different products with different WP-08s. Worse, neither addresses
`SceneMultipick` (`packages/engine/layer1/ScenePicking.cpp:332-360`, rectangle pass at `:239-244`), which is how
the rubber-band selection works — a client raycaster has to reimplement rectangle selection across
every rep, including reps it cannot draw (`volume`, `slice`, `cRepCallback`), while honouring
`selection_visible_only` and the `cPickableThrough` sentinels (`packages/engine/layer1/CGO.h:141-142`).

### A6. The dispatcher deny-list forbids features the parity inventory requires

`01-architecture.md:357-364` deny-lists `system`, `run`, `spawn`, `quit`, `_quit`, `cd`, "anything
starting with `_`", and declares `t:'do'` console-only ("**No UI action may use it**").

Directly required by rows already in 00:

| Denied | Required by |
|---|---|
| `cmd.run`, `cmd.do('@file')` | File > Run Script (`00:61`, `packages/engine/modules/pymol/_gui.py:118`); demo wizard runs `run $PYMOL_DATA/demo/cgo03.py` (`packages/engine/modules/pymol/wizard/demo.py:195`) |
| `cmd.cd` | File > Working Directory > Change (`00:61`) |
| `cmd.system` | File > Working Directory > File Browser (`00:61`) |
| `cmd.quit` | File > Quit / shutdown (`00:61`) |
| `cmd._ctrl` / `_alt` / `_ctsh` | ortho CLI chord fallback (`00:110`; real symbols at `packages/engine/modules/pymol/internal.py:488,494,509`, registered in `packages/engine/modules/pymol/keywords.py:46`) |
| `t:'do'` | **Every** `pymol.menu` popup leaf and wizard button — the menu system returns *command strings* (`00:100`, `packages/engine/layer4/PopUp.cpp:471-475`, e.g. `packages/engine/modules/pymol/menu.py:824` `cmd.symexp(...)`) |

`t:'do'` being console-only is incompatible with WP-13 and WP-15 as scoped.

### A7. Work-package file-ownership lists do not exist

`01-architecture.md:779-781`: "Full file-ownership lists, scope statements and acceptance criteria
are in the structured `workPackages` return value that accompanies this document." That artifact is
not in `docs/` (only the 14 `.md` files exist). Agents given the docs cannot determine
ownership, which is the mechanism the whole parallel plan rests on.

### A8. Concrete file collisions between work packages

Derived from the tree at `01-architecture.md:75-199` and the WP table at `:729-781`:

| File / dir | Declared owner | Also needed by |
|---|---|---|
| `packages/protocol/src/panels.ts` | WP-12 (`:786`) | WP-19 (`movie_panel` topic `:390`), WP-20 (`seqview` `:391`), WP-13 (menus) |
| `packages/protocol/src/topics.ts` | WP-01 (`:785`) | every WP that adds a topic — `geometry` (WP-06), `editor` (WP-16), `wizard` (WP-15), `dialog` (WP-17/21) |
| `packages/stores/src/**` (10 files + `index.ts`) | **unassigned** | WP-08/10/12/14/15/16/19/21 |
| `packages/client/src/keymap.ts` | WP-05 package | WP-22 (keyboard) |
| `packages/viewport/src/input/**`, `picking/**` | WP-07 owns the package | WP-08 owns input + picking |
| `packages/ui/src/{Menu,Popover}.tsx` | WP-09 (`:789`) | WP-13 (popup engine) |
| `packages/bridge/pymol_bridge/panels/{objects,movie,seqview,menus}.py` | **unassigned** | WP-12, WP-19, WP-20, WP-13 |
| `packages/bridge/pymol_bridge/allowlist.py`, `dispatch.py` | WP-02 | every feature WP that needs a symbol un-denied |
| `packages/bridge/pymol_bridge/shims.py` | WP-02 | `_copy_image` → WP-18; `window_cmd` → WP-09; blocking dialogs → WP-17/21 |
| `tools/gen-api/overrides.ts` | WP-04 (`:788`) | every WP that finds a wrong return type |
| `apps/web/src/App.tsx` + "generated barrel" (`:793-794`) | WP-09 | barrel generator has no owner; every feature WP adds an entry |

### A9. New C++ is scheduled after the packages that need it

`packages/engine/layer4/CmdWebGeometry.cpp` + the `Cmd.cpp` method table are **WP-06 only** (`:791`). But 00 §14
items 6–9 also require new C:

* item 6 `cmd.get_click_string` (C at `packages/engine/layer4/Cmd.cpp:1420-1436`, table row `:6451`, zero Python callers) → needed by **WP-08**
* items 7/8 `ButModeGet`/`ButModeTranslate` and the 5-char code table (`packages/engine/layer1/ButMode.h:225,227`, `packages/engine/layer1/ButMode.cpp:497-520`) → needed by **WP-22** and the ButMode grid (WP-12/09)
* item 9 setting default/min/max/help (`packages/engine/layer1/SettingInfo.h:46-58`, `hasMinMax()` at `:56`) → needed by **WP-10**

None of WP-08 (`:752`), WP-10 (`:753`) or WP-22 (`:770`) declares a dependency on WP-06. Either they
block, or a second agent edits WP-06's exclusive files.

---

## B. Major — unmapped user-facing surface

### B1. The APBS Electrostatics plugin is completely absent from all 14 documents

`packages/engine/data/startup/apbs_gui/` — `__init__.py` (450 lines), `electrostatics.py` (195),
`creating.py` (251), `qtwidgets.py` (32), `apbs.ui` (1405 lines, **86 `<widget>` elements**,
5 stacked pages, widget ids `input_sele`, `do_prepare`/`do_apbs`/`do_surface`, `prep_method`,
`prep_name`, `prepwizard_args`, `pdb2pqr_exe`/`_args`/`_fixrna`/`_ignore_warnings`, `apbs_exe`,
`apbs_template`, `apbs_grid`, `apbs_map`, `surf_map`/`surf_ramp`/`surf_range`, `check_preserve`,
`check_no_group`, `button_ok`/`button_reset`/`button_load`/`button_register`, four
`optbutton_*`/`optarea_*` collapsible option areas).

It autoloads: `startup.__path__.append(cmd.exp_path('$PYMOL_DATA/startup'))`
(`packages/engine/modules/pymol/plugins/__init__.py:39`), `PluginInfo.autoload` defaults True (`:174-175`),
`initialize()` loads them at `:408-431`, and it registers a menu item
`addmenuitem('APBS Electrostatics', dialog)` (`packages/engine/data/startup/apbs_gui/__init__.py:448-450`).

The sibling plugin `lightingsettings_gui` **is** mapped (`settings-colors.md:400`, `00:221`). APBS
is not mentioned anywhere (`grep -ri apbs docs/webclient` → 0 hits). It also subprocess-shells
`pdb2pqr`/`apbs` and captures stdout (`StdOutCapture`, `:24-49`), which the bridge must surface.

### B2. Plugin Manager is a widget-name dump, not a mapping

`dialogs-volume-properties-scenes.md:786` lists `pluginmanager.ui` widget names in one line. The
behaviour is unmapped and no WP owns it:

* `managergui_qt.py:34-415` — `PluginManager` with ~25 wired signals (`:43-62`), install from
  local file (`installplugin`), install from PyMOLWiki/URL (`fetchplugin`), repository browse /
  add / remove (`:185-208`), multi-select repo install (`:134-156`), plugin info (`:158-183`),
  startup-path add/remove/reorder (`:78-88`), a live preferences table (`:90-133`),
  per-plugin enable-at-startup toggles (`:214-217`), filter by name/loaded/startup (`:274-291`),
  `confirm_network_access()` (`:11`).
* `plugins/installation.py:22-234` — `get_default_user_plugin_path`, `is_writable`, `cmp_version`,
  `get_name_and_ext`, `check_valid_name`, `extract_zipfile`, `get_plugdir`,
  `installPluginFromFile`, plus `InstallationCancelled` / `BadInstallationFile`.
* `plugins/repository.py:51-266` — `Repository`, `HttpRepository`, `GithubRepository`,
  `LocalRepository`, `guess(url)`, `fetchscript`.
* `plugins/__init__.py:21-24,64-99` — preferences dict (`verbose`, `instantsave`), `pref_get`/
  `pref_set`/`pref_save` writing `~/.pymolpluginsrc.py` (`PYMOLPLUGINSRC`, `:20`),
  `get_startup_path`/`set_startup_path` (`:50-62`).

This is the whole plugin-ecosystem story. It needs either a mapping or an explicit "descoped".

### B3. `cmd.get_setting_str` is an invented API

Cited as the backend contract in three parity rows (`00-parity-inventory.md:92`, `:106`, `:107`)
for `button_mode_name` and `scene_current_name`. `grep -rn get_setting_str packages/engine/modules/ layer*` → 0
hits. The real symbol is `cmd.get_setting_text` (`packages/engine/modules/pymol/setting.py:435-438`); the family is
`get_setting_boolean/int/float/text/tuple/updates` (`setting.py:408-447`). This is exactly the
class of error the brief forbids and will make three components fail at runtime.

### B4. `scenes_changed` and `session_changed` already exist — two "NEW" items are over-scoped and one risk is wrong

* `scenes_changed` is setting index 254 (`packages/engine/layer1/SettingInfo.h:339`), set by
  `MovieScene.cpp:833-834` with `SettingGenerateSideEffects`, and therefore delivered through the
  existing `cmd.get_setting_updates()` drain. The Tk skin already consumes it as a change hook
  (`packages/engine/modules/pmg_tk/skins/normal/__init__.py:1191-1193`). `00 §14 item 17` lists
  `scenes_changed` as a **NEW** required event.
* `session_changed` is setting index 521 (`packages/engine/layer1/SettingInfo.h:621`, `packages/engine/layer1/Setting.cpp:659`).
  `00 §15 risk 20` says "Shutdown has no safe hook" — the Tk skin's `confirm_quit`
  (`packages/engine/modules/pmg_tk/skins/normal/__init__.py:207-221`) implements exactly the unsaved-session guard
  by reading it. The Qt GUI is the one that lost the feature, not PyMOL.

This also weakens `00 §15 risk 1` ("no event bus"): two real dirty flags ride the setting drain.

### B5. The parity inventory admits it is truncated

`00-parity-inventory.md:499`: build-and-tooling arrived "truncated at feature 2 of 22" and asks for
reconciliation "before sign-off". The stated total of **351 rows** (`:43`) is therefore not the
definition of done it claims to be.

### B6. The Tk skin has no scope statement, and it is a live code path

`packages/engine/modules/pymol/__init__.py:415-426`: if importing `pmg_qt` raises `ImportError`, PyMOL prints
"Qt not available … using GLUT/Tk interface" and sets `invocation.options.gui = 'pmg_tk'`.
`PMGApp.setSkin` / `addSkinMenuItems` (`packages/engine/modules/pmg_tk/PMGApp.py:253-290`) discovers skins by glob.
Unmapped: `pmg_tk/skins/normal/__init__.py` (1298), `skins/normal/builder.py` (1507),
`pmg_tk/volume.py` (1088), `PMGApp.py` (371), `SetEditor.py`, `ColorEditor.py`, `Demo.py`,
`TextEditor.py`, `skins/demo/`. 00 explicitly excludes the Tk builder (`:387`) and calls
`ColorEditor` "legacy, not ported" (`:225`) but never states the global position. Needs one line:
"the Tk skin is out of scope; the web client is a `pmg_qt` replacement only".

### B7. The broken-in-open-source list is incomplete

`00 §15 risk 13` / `01 risk 12` enumerate `clean`, `load_mtz`, `.mae`, `.mtl`, STL. Also raising
`IncentiveOnlyException` in this tree, all reachable from the UI or the 404-symbol API:

| Symbol | Line | UI reach |
|---|---|---|
| `assign_stereo` | `packages/engine/modules/pymol/stereochemistry/__init__.py:29` | L-menu "stereochemistry" labels by the `stereo` property (`packages/engine/modules/pymol/menu.py:1536`) — silently blank |
| `morph` | `packages/engine/modules/pymol/morphing.py:53` | api.py symbol |
| `focal_blur` | `packages/engine/modules/pymol/experimenting.py:244` | api.py symbol |
| `callout` | `packages/engine/modules/pymol/experimenting.py:266` | api.py symbol |
| `desaturate` | `packages/engine/modules/pymol/experimenting.py:280` | api.py symbol |
| `find_pi_interactions` | `packages/engine/modules/pymol/querying.py:545` | `find > pi interactions` popup (`menu.py`, see `internal-gui.md:302`) |
| `help_setting` | `packages/engine/modules/pymol/helping.py:99` | it is the intended consumer of `packages/engine/data/setting_help.csv` |
| `read_stlstr` / `read_collada` | `packages/engine/modules/pymol/lazyio.py:240,250` | import filters |

`find > pi interactions` in particular is an enumerated menu leaf that will always throw.

### B8. No serialization policy for non-JSON return values

`01 §2.3` says `getattr(cmd, m)(*a, **k)` is returned as `ok.v` over msgpack. Several of the 404
symbols return Python objects msgpack cannot encode: `cmd.get_model()` → `chempy.models.Indexed`
(`packages/engine/modules/chempy/models.py`), `cmd.get_session()` → nested dict with binary,
`cmd.get_coords`/`get_coordset` → numpy arrays and, with `copy=0`, a **live view onto C++ memory**
(`packages/engine/layer2/CoordSet.cpp:326-361`, noted in `geometry-extraction.md:259-261`),
`cmd.get_volume_field` → numpy. `grep -rn "get_model\|serializable" docs/cmd-api-rpc.md`
→ 0 hits. Needs a typed codec table plus a rule for the zero-copy view (must be copied before it
leaves the lock).

### B9. `util.py` compute/electrostatics contract unspecified

`internal-gui.md:288-293` correctly enumerates the `compute` and `vacuum` popup submenus in prose
but names no backend symbol. The leaves call `util.protein_vacuum_esp`
(`packages/engine/modules/pymol/util.py:385`), which calls `protein_assign_charges_and_radii`
(`:335-383`) → `from chempy.champ import assign` (`:338`) — i.e. the compiled `chempy.champ._champ`
extension (`setup.py:860-878`). It mutates the model (deletes alt-confs and unassigned residues),
prints multi-line diagnostics, and creates three new objects `_e_chg` / `_e_map` / `_e_pot`.
Also unnamed anywhere: `util.get_area`, `get_sasa`, `get_sasa_relative`, `compute_mass`,
`sum_formal_charges`, `sum_partial_charges`, `find_surface_residues`, `find_surface_atoms`,
`label_chains`, `label_segments`, `phipsi`, `b2vdw`, `interchain_distances`, `enable_all_shaders`,
`mass_align`, `ff_copy` (all `packages/engine/modules/pymol/util.py`).

---

## C. Minor

* **C1.** `01-architecture.md:1213` asks "Does `pmg_qt/file_dialogs.load_dialog` call
  `recent_filenames_add`?" — yes: `packages/engine/modules/pmg_qt/file_dialogs.py:42` and `:593`. The open question
  is answerable in 30 seconds and its wrong resolution would have cloned a non-existent bug.
* **C2.** `_cmd.get_setting_level` is already in the method table (`packages/engine/layer4/Cmd.cpp:6494`,
  impl `:4403`), so `00 §14 item 10` is a 3-line Python wrapper, not backend work — it should not
  sit on the "critical path" gap list.
* **C3.** `tools/parity/extract-features.mjs` (`01-architecture.md:164`) is specified to parse the
  markdown feature tables, but those tables contain escaped pipes inside cells (`\|`, e.g.
  `00-parity-inventory.md:55`, `:59`, `:98`). A naive `split('|')` mis-columns dozens of rows.
* **C4.** `01 §2.3` forces `quiet=1` unless the caller sets it. Several parity rows depend on
  `quiet=0` output reaching the console (`cmd.get_view(2,quiet=0)` at `00:58`, `cmd.set(...,log=1,
  quiet=0)` for every check/radio menu item at `00:59`). Default should be "pass through".
* **C5.** `01-architecture.md:63-67` principle 1 ("upstream tree is not moved… a git merge must
  never touch a web-client file") is contradicted two paragraphs later by editing
  `packages/engine/layer4/Cmd.cpp` (`:218-220`). The doc flags the brief contradiction (`:227-230`) but not its own.
* **C6.** The invocation surface is only spot-checked (`-R`, `-x`, `-q`, `-y`, `-k`,
  `packages/engine/modules/pymol/invocation.py` ~532 lines). Flags that change front-end behaviour and have no web
  analogue are unenumerated: `-p` (read commands from stdin), `-X/-Y` window position, `-A` preset
  profiles, `-t/-o` stereo, `-m/-M` mouse profiles (`invocation.py:344,346`), `-d`/`-l`/`-r`/`-u`
  deferred command hooks (`:250,286,423-436`).
