---
title: "File I/O"
description: "Everything the desktop PyMOL GUI does with the filesystem and the network: open/load, format-specific import dialogs, save/export, sessions (.pse/.psw)…"
---

# File I/O

Everything the desktop PyMOL GUI does with the filesystem and the network: open/load,
format-specific import dialogs, save/export, sessions (`.pse`/`.psw`), partial session merge,
recent files, log files and script execution, image export, movie export, and `fetch` from the PDB.
All references are `path:line` in `packages/engine/`, which is unmodified upstream. Anything that
could not be verified is marked **UNVERIFIED**.

**Where the port stands.** `packages/bridge/tenmol_bridge/panels/files.py` serves the whole
surface as `cmd.tenmol_files.<method>`, typed in `packages/protocol/src/topics/files.ts` and
called from `apps/web/src/features/files/filesApi.ts`. The dialogs are
`LoadDialogs.tsx`, `SaveDialogs.tsx`, `ImageDialogs.tsx`, `ToolsDialogs.tsx`, `PathPicker.tsx`,
`FileDropTarget.tsx`, `globalDrop.ts` and `PluginDialogHost.tsx` in the same directory.

---

## 0. The model

**Server-managed working directory, a client-rendered server-side path picker, and
upload/download as opt-in escape hatches. No native OS dialogs.**

Grounded in how the code actually works:

1. Every load/save path in PyMOL is a **real server-side path string**. `cmd.load`
   calls `_self.exp_path(filename)` (`packages/engine/modules/pymol/importing.py:751`) which expands
   `~` and `$VARS` (`packages/engine/modules/pymol/cmd.py:112`), then hands the *path* to C
   (`packages/engine/modules/pymol/internal.py:362`). `cmd.save` does the same
   (`packages/engine/modules/pymol/exporting.py:836-838`). Feeding it browser `File` blobs would require
   rewriting every loader.
2. Format dispatch is done on **filename/extension**, not content
   (`packages/engine/modules/pymol/importing.py:41-109`, `packages/engine/modules/pymol/exporting.py:836-844`). A browser
   upload loses the path but keeps the name, so uploads must be materialised into a
   server temp/working dir before `cmd.load`.
3. Several operations *cannot* be expressed as a download at all: `mpng` writes N
   numbered files (`packages/engine/modules/pymol/moving.py:366`), `movie.produce` creates a `.tmp`
   sibling directory and shells out to `ffmpeg`/`mpeg_encode`/`convert`
   (`packages/engine/modules/pymol/movie.py:770-800, 946-985`), `log_open` holds an open file handle for
   the whole session (`packages/engine/modules/pymol/commanding.py:107-155`), `fetch` writes into
   `fetch_path` (`packages/engine/modules/pymol/importing.py:1213-1248`), and `cd`/`system`/`run`
   operate on the server process (`packages/engine/modules/pymol/externing.py:32,112`,
   `packages/engine/modules/pymol/parsing.py:427`).
4. The GUI already has a notion of a sticky "current directory": `initialdir`
   (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:496-506`) which defaults to `os.getcwd()` and is
   updated after every browse. That maps 1:1 onto a server-managed working directory
   exposed in React.

Concretely:

| Concern | Web mechanism |
| --- | --- |
| Browse for input file(s) | React `<FilePicker>` component driven by a new bridge FS API (`fs.list`, `fs.stat`, `fs.home`, `fs.cwd`, `fs.glob`), rooted anywhere on the server FS (single-user localhost, so full access is fine and matches desktop behaviour). |
| Browse for output file | Same component in "save" mode: directory tree + filename field + extension-filter dropdown that mirrors the Qt `filter` strings, plus the `getSaveFileNameWithExt` auto-extension rule (`packages/engine/modules/pymol/Qt/utils.py:229-246`). |
| Drop a file from the OS onto the browser | Browser gives us a `File` (no path). Upload to `POST /fs/upload` → server writes into the working dir (or a `~/.pymol/uploads` scratch dir) → then run the normal `load_dialog` flow on the resulting path. Mirrors `pymol_gl_widget.py:262-270`. |
| "I want the file on my laptop, not on the server" | `GET /fs/download?path=…` streaming any server file the user just wrote (PNG, PSE, PDB, MP4). Optional convenience; the primary flow is still "write to server path". |
| Working directory | `cmd.cd` / `cmd.pwd` (`packages/engine/modules/pymol/externing.py:32,56`) are the source of truth; React shows it in a status bar and the picker starts there. "File Browser" menu item (`packages/engine/modules/pymol/_gui.py:121`) becomes "reveal in picker", not `open .`. |
| Plugin dialogs | Plugins import `tkinter.filedialog`, which upstream shims to Qt (`packages/engine/modules/pmg_qt/mimic_tk.py:36-90,108`). The bridge provides the same *blocking* shim backed by a round trip to the client picker (`panels/files.py::install_tk_filedialog`), so legacy plugins keep working. |

---

## 1. Menu inventory (File menu)

Source: `packages/engine/modules/pymol/_gui.py:80-133` (toolkit-independent menu data, consumed by
`packages/engine/modules/pmg_qt/pymol_qt_gui.py:295-357`).

| Label | Callback | Ref |
| --- | --- | --- |
| New PyMOL Window ▸ Default | `self.new_window` | `_gui.py:82`, impl `_gui.py:41-53` |
| New PyMOL Window ▸ Ignore .pymolrc and plugins (-k) | `new_window(('-k',))` | `_gui.py:83` |
| Open… | `file_open` | `_gui.py:86`, impl `pymol_qt_gui.py:643-649` |
| Open Recent… (submenu) | dynamic | `_gui.py:87`, built `pymol_qt_gui.py:341-342,367-375` |
| Get PDB… | `file_fetch_pdb` | `_gui.py:88`, impl `file_dialogs.py:444-516` |
| Save Session | `session_save` | `_gui.py:90`, impl `pymol_qt_gui.py:651-655` |
| Save Session As… | `session_save_as` | `_gui.py:91`, impl `pymol_qt_gui.py:656-671` |
| Export Molecule… | `file_save` | `_gui.py:93`, impl `file_dialogs.py:519-601` |
| Export Map… | `file_save_map` | `_gui.py:94`, impl `file_dialogs.py:845-847` |
| Export Alignment… | `file_save_aln` | `_gui.py:95`, impl `file_dialogs.py:850-855` |
| Export Image As ▸ PNG… | `file_save_png` | `_gui.py:97`, impl `file_dialogs.py:604-688` |
| Export Image As ▸ VRML 2… | `file_save_wrl` | `_gui.py:99`, impl `pymol_qt_gui.py:802` |
| Export Image As ▸ COLLADA… | `file_save_dae` | `_gui.py:100`, impl `pymol_qt_gui.py:805` |
| Export Image As ▸ GLTF… | `file_save_gltf` | `_gui.py:101`, impl `pymol_qt_gui.py:820` |
| Export Image As ▸ POV-Ray… | `file_save_pov` | `_gui.py:102`, impl `pymol_qt_gui.py:808` |
| Export Image As ▸ STL… | `file_save_stl` | `_gui.py:103`, impl `pymol_qt_gui.py:817` |
| Export Movie As ▸ MPEG… | `file_save_mpeg` | `_gui.py:106`, impl `file_dialogs.py:691-813` |
| Export Movie As ▸ Quicktime… | `file_save_mov` | `_gui.py:107` → `file_save_mpeg('mov')` `pymol_qt_gui.py:814` |
| Export Movie As ▸ PNG Images… | `file_save_mpng` | `_gui.py:109` → `file_save_mpeg('png')` `pymol_qt_gui.py:811` |
| Log File ▸ Open… | `log_open` | `_gui.py:113`, impl `pymol_qt_gui.py:829-836` |
| Log File ▸ Resume… | `log_resume` | `_gui.py:114`, impl `pymol_qt_gui.py:840-845` |
| Log File ▸ Append… | `log_append` | `_gui.py:115`, impl `pymol_qt_gui.py:837-838` |
| Log File ▸ Close | `cmd.log_close` | `_gui.py:116`, impl `commanding.py:206-227` |
| Run Script… | `file_run` | `_gui.py:118`, impl `pymol_qt_gui.py:847-868` |
| Working Directory ▸ Change… | `cd_dialog` | `_gui.py:120`, impl `pymol_qt_gui.py:870-873` |
| Working Directory ▸ File Browser | `cmd.system('open .'/'explorer .'/'xdg-open .')` | `_gui.py:74-78,121` |
| Edit pymolrc | `edit_pymolrc` | `_gui.py:124`, impl `pymol_qt_gui.py:634-637` |
| Reinitialize ▸ Everything / Original Settings / Stored Settings / Store Current Settings | `cmd.reinitialize` variants | `_gui.py:126-131` |
| Quit | `confirm_quit` | `_gui.py:133` |

Keyboard: `Ctrl+O` → `file_open`, `Ctrl+S` → `session_save`
(`packages/engine/modules/pmg_qt/pymol_qt_gui.py:387-388`). Note these are *extra* Qt shortcuts, not
PyMOL `set_key` bindings.

Note: `PyMOLDesktopGUI` also declares `file_autoload_mtz` (`_gui.py:13`) but **it is not
referenced by any menu entry and has no implementation in pmg_qt** — dead slot.

---

## 2. Cross-cutting infrastructure

### 2.1 `initialdir`
`packages/engine/modules/pmg_qt/pymol_qt_gui.py:496-506`. Falls back to `os.getcwd()` until the first
browse, then remembers the last directory used by *any* dialog. Updated in
`file_dialogs.py:40, 585, 619, 669, 770` and `pymol_qt_gui.py:669, 749, 834, 843, 862`.
**Web:** one server-side `session.initialdir` value on the bridge, exposed as
`fs.get_initialdir` / `fs.set_initialdir`, seeded from `cmd.pwd()`.

### 2.2 Recent files
`packages/engine/modules/pymol/_gui.py:975-1032`. SQLite DB at `~/.pymol/recent.db`, table
`recent(filename text unique, timestamp integer)`, `REPLACE INTO` on add, pruned to
~15-20 entries when count > 20 (`_gui.py:1026-1031`). Menu is rebuilt on
`aboutToShow` and truncates display to `'...' + fname[-120:]` when ≥128 chars
(`pymol_qt_gui.py:367-375`). Registered by `load_dialog` (`file_dialogs.py:42`),
molecule export (`file_dialogs.py:593`) and session save-as (`pymol_qt_gui.py:671`).
**Web:** keep the same SQLite file server-side; expose `recent.list` / `recent.add`.
React renders a dropdown; clicking runs the same `load_dialog` pipeline.

### 2.3 Drag & drop
- Onto the 3D viewport: `packages/engine/modules/pmg_qt/pymol_gl_widget.py:256-270` — accepts URLs,
  local files via `toLocalFile()`, remote URLs passed through as strings, each goes to
  `gui.load_dialog(url)`.
- Onto the command line: `packages/engine/modules/pmg_qt/pymol_qt_gui.py:1092-1119` — inserts the path
  as *text* at the cursor.
- macOS Finder "Open With": `PyMOLApplication.handle_file_open_active`
  (`pymol_qt_gui.py:1140-1160`): opens a new instance unless `--reuse_helper`, honours
  `auto_reinitialize`, and for `.psw` sets `presentation`, `internal_gui 0`,
  `internal_feedback 0`, `full_screen on` before `load_dialog`.
**Web:** HTML5 drop on the canvas. Local files → upload endpoint → path → `load_dialog`.
URLs (text/uri-list) → pass the string straight to `cmd.load`, which supports URLs via
`file_read` (`packages/engine/modules/pymol/internal.py:279-297`). The Finder/new-window behaviour has
no web analogue (see risks).

### 2.4 Qt form loading (`load_form`)
`packages/engine/modules/pmg_qt/pymol_qt_gui.py:512-546` loads `pmg_qt/forms/<name>.ui|.py`. Every
`.ui` under `packages/engine/modules/pmg_qt/forms/` that this area owns is enumerated in §3/§4:
`askpartial.ui`, `fetch.ui`, `load_aln.ui`, `load_mae.ui`, `load_map.ui`,
`load_mtz.ui`, `load_traj.ui`, `movieexport.ui`, `png.ui`, `render.ui`,
`save_molecule.ui`, `save_object.ui`.
**Web:** each becomes a React component; there is no runtime `.ui` loading.

### 2.5 Save-dialog extension helper
`getSaveFileNameWithExt` (`packages/engine/modules/pymol/Qt/utils.py:229-246`): if the typed basename has
no `.`, append the first `*.ext` from the selected filter. Reproduce exactly in the React
save picker.

### 2.6 Error surfacing
`PopupOnException` (`packages/engine/modules/pymol/Qt/utils.py:323-348`) wraps `file_save`,
`file_save_mpeg`, `session_save_as`, `_file_save`, `file_run`. Load errors are shown via
`QMessageBox.critical` (`file_dialogs.py:67-69`, `197`).
**Web:** a single `<ErrorToast>`/modal fed by bridge error events.

---

## 3. Loading

### 3.1 Open… entry point
`file_open` (`pymol_qt_gui.py:643-649`): `getOpenFileNames` with **no filter** (all
files), multi-select; first file loads with `partial=0`, all subsequent with
`partial=1`, and the loop breaks as soon as `load_dialog` returns falsy.

### 3.2 `load_dialog` dispatch table
`packages/engine/modules/pmg_qt/file_dialogs.py:33-77`:

| Condition | Action | Ref |
| --- | --- | --- |
| `'://' not in fname` | set `initialdir` to dirname | `:39-40` |
| always | `recent_filenames_add(fname)` | `:42` |
| ext in `.dcd .dtr .xtc .trr` | `load_traj_dialog` | `:46-47` |
| format `aln`/`fasta` | `load_aln_dialog` | `:48-49` |
| format `mae` | `load_mae_dialog` | `:50-51` |
| format `ccp4`/`map` | `load_map_dialog(..., 'ccp4')` | `:52-53` |
| format `brix` | `load_map_dialog(..., 'o')` | `:54-55` |
| format `mtz` | `load_mtz_dialog` | `:56-57` |
| format `pse`/`psw` | `ask_partial` gate, then `cmd.load` | `:59-60` |
| format `pml`/`py`/`pym` | `cmd.cd(initialdir, quiet=0)` **then** `cmd.load` | `:62-63` |
| otherwise | `cmd.load(fname, quiet=0, **kwargs)` | `:66` |
| `.cms` post-step | auto-find Desmond trajectory, then `load_traj_dialog` | `:71-75`, helper `:12-30` |

`_get_cms_traj_file` (`:12-30`) tries `<stem>_trj/clickme.dtr` then `<stem>.xtc`, where
stem strips `-out.cms` or `.cms`.

### 3.3 Format detection
`filename_to_format` (`packages/engine/modules/pymol/importing.py:41-109`) returns
`(prefix, ext, format, zipped)`. Rules to port verbatim:
- `.gz`/`.bz2` are stripped into `zipped` and the *previous* extension re-parsed (`:45-49`).
- `brick|callback|cgo|model|plugin` → format `''` (reserved loadable names, not extensions) (`:56-58`).
- `ent|p5m`→`pdb`; `pze`→`pse`+gz; `pzw`→`psw`+gz; `mmd|out|dat`→`mmod`; `cc2`→`cc1`;
  `sd`→`sdf`; `sdfgz`→`sdf`+gz; `rst7`→`rst`; `o|dsn6|omap`→`brix`; `maegz`→`mae`+gz;
  `ph4`→`moe`; `spi`→`spider`; `pym|pyc`→`py`; `p1m|pim`→`pml`; `xml`→`pdbml`;
  `mmcif`→`cif`; `bcif`; `bcifgz`→`bcif`+gz; `pdb\d+`→`pdb`; `xyz_\d+`→`xyz`;
  `dxbin`→`dx` (`:59-105`).
- `filename_to_objectname` (`:37-39`) = prefix run through `cmd.get_legal_name`.

### 3.4 `cmd.load` core
`packages/engine/modules/pymol/importing.py:643-827`. Signature
`load(filename, object='', state=0, format='', finish=1, discrete=-1, quiet=1,
multiplex=None, zoom=-1, partial=0, mimic=1, object_props=None, atom_props=None)`.
Behaviour worth preserving:
- numeric `format` accepted (loadable enum, `constants.py:9-63`) (`:719-726`).
- `format=…str` variants are deprecated in favour of `load_raw` (`:727-733`).
- `format='plugin:<name>'` syntax (`:743-744`).
- object name defaults to filename prefix, or `get_unused_name('obj')`; for `dcd`/`dtr`
  it defaults to the most recently added object (`:754-759`, helper `:126-132`).
- unknown extensions fall through to VMD molfile plugins via
  `_cmd.find_molfile_plugin` (`:762-767`).
- `.trj` AMBER-vs-GROMACS/NetCDF autodetection by magic bytes (`:770-773`, `:115-124`).
- `.crd` AMBER-vs-CHARMM autodetection by two leading `*` lines (`:775-778`, `:617-624`).
- dispatch through `loadfunctions` with signature introspection; a `contents` parameter
  causes `cmd.file_read(filename)` to be called first (`:780-827`).

`loadfunctions` (`:1619-1644`) — the complete supported-format-with-python-handler list:
`mae`(incentive→raises), `pdbml`, `cml`, `mtz`(→`load_mtz`, raises IncentiveOnly at
`:1511`), `py`(→`run`), `pml`(→`@`), `pwg`, `aln`, `fasta`, `png`(→`load_png`), `idx`,
`pse`, `psw`, `ply`, `r3d`, `cc1`, `pdb`(→`read_pdbstr`), `stl`, `dae`, plus incentive-only
`vis`, `moe`, `phypo`. Everything else goes to `pymol.internal._load`
(`packages/engine/modules/pymol/internal.py:346-386`) and thence to C.

### 3.5 Other load entry points
| API | Ref | Note |
| --- | --- | --- |
| `cmd.loadall(pattern, group=…)` | `importing.py:1513-1542` | glob on the **server**; needs `fs.glob` in the picker |
| `cmd.load_raw(content, format, …)` | `importing.py:898-934` | in-memory; falls back to a `tempfile` when the format has no `…str` loadable |
| `cmd.read_pdbstr/read_molstr/read_sdfstr/read_mol2str/read_mmodstr/read_xplorstr` | `:1008,965,936,1041,995,1074` | API-only string loaders — ideal for browser uploads |
| `cmd.load_traj` | `:341-459` | rejects gzipped trajectories (`:429-430`) |
| `cmd.load_idx` | `:1450-1479` | Desmond IDX → structure + trajectory, resolves sibling paths |
| `cmd.load_mmtf` | `:1545-1601` | uses `MmtfReader.from_url`, honours `assembly` setting |
| `cmd.load_ply / load_r3d / load_cc1` | `:1603,1610,1615` | CGO / chempy loaders |
| `cmd.load_png` | `packages/engine/modules/pymol/viewing.py:1814-1834` | loads a PNG as the displayed image (movie overlay) |
| `cmd.load_object/load_cgo/load_model/load_callback/load_brick/load_map` | `:185,308,327,291,210,218` | Python-object loaders (no filesystem) |
| `cmd.load_embedded(key)` | `:856-896` | data embedded in a `.pml` via `embed` |
| `cmd.load_coords / load_coordset` | `:1428,1404` | coordinate injection, no file |
| `cmd.set_session` | `:138-183` | see §5 |
| `_processPWG` | `:516-615` | `.pwg` launches PyMOL's own HTTP server (`pymolhttpd.py:441`) — see risks |
| `cmd.space(space, gamma)` | `:227-289` | loads a colour-space table file from `$PYMOL_DATA` |

### 3.6 Format-specific import dialogs

#### 3.6.1 Trajectory — `load_traj_dialog` (`file_dialogs.py:102-149`, form `load_traj.ui`)
Guard: if `cmd.get_object_list()` is empty, warn "To load a trajectory, you first need
to load a molecular object" and abort (`:104-109`).
Widgets (`forms/load_traj.ui`): `input_object` (combo of object names, preselects the
last), `input_state` (spin, 0-999, default 1, tooltip "Append if state=0"),
`input_start` (1-99999, default 1), `input_stop` (-1-99999, default -1, "Load entire
trajectory if stop &lt; 1"), `input_interval` (min 1, default 1), `input_dbm3` (checkbox
"defer_builds_mode=3"), `output_command` (live command preview), `button_ok` ("Load").
Emits (`:115-129`): optional `set defer_builds_mode, 3` then
`load_traj <file>, <object>, <state>, start=, stop=, interval=`, executed via `cmd.do`.

#### 3.6.2 Alignment — `load_aln_dialog` (`file_dialogs.py:204-282`, form `load_aln.ui`)
- Parses via `pymol.seqalign.aln_magic_read`; a FASTA with &lt;2 records or ragged lengths
  raises `ValueError` → falls back to plain `cmd.load` (→ `fab`-based extended
  structures) (`:211-222`).
- Builds an id→object similarity matrix with `difflib.SequenceMatcher` + `numpy`, greedy
  argmax assignment to pre-fill the mapping (`:236-247`).
- UI: one row per alignment record — `QLabel(rec_id)` + `QComboBox` of object names
  (blank first), added into `form.layout_mapping` (`:253-261`).
- OK → `seqalign.load_aln_multi(filename, mapping=…)` (`:263-267`).
- Cancel on a FASTA file → asks "Load sequences as extended structures instead?" and if
  Yes runs `cmd.load` (`:269-275`).

#### 3.6.3 Maestro — `load_mae_dialog` (`file_dialogs.py:285-333`, form `load_mae.ui`)
Widgets: `input_object_name` (placeholder = `filename_to_objectname`),
`input_mimic` (checkbox, default on, "Use settings to match cartoon/ribbon color and
ballstick style"), `input_object_props` / `input_atom_props` (default from settings
`load_object_props_default` / `load_atom_props_default`, both `"*"`,
`SettingInfo.h:818-819`), `input_multiplex` combo with 4 entries mapping to
`(multiplex, discrete)` = `(-2,-1) (0,0) (0,1) (1,-1)` (`:304-313`), `output_command`,
`button_ok`. **In this open-source build `loadfunctions['mae']` raises
`IncentiveOnlyException` (`importing.py:1620`, `:31-33`)** — the dialog exists but the
load fails.

#### 3.6.4 Map — `load_map_dialog` (`file_dialogs.py:336-406`, form `load_map.ui`)
Called for ccp4/map (normalize setting `normalize_ccp4_maps`) and brix/o
(`normalize_o_maps`) (`:52-55`, `:338`; settings `SettingInfo.h:210,394`).
Widgets: `input_object_name`, `input_normalize` (checkbox "normalize (mean=0 stdev=1)"),
`input_selection` (editable combo: blank/`enabled`/`sele`/`center`), `input_buffer`
(double, default 2.0), `check_carve`, `input_level` (double, 4 decimals, min −99, step
0.1, default 1.0), `check_volume` + `input_name_volume`, `check_isomesh` +
`input_name_isomesh`, `check_isosurface` + `input_name_isosurface`, `output_command`,
`button_ok`.
Generated script (`:344-380`): `set <normalize_setting>, 0|1` → `load <file>[, name]` →
optionally `volume <name>_volume, <map>, <level> blue .5 <level*2> yellow 0`,
`isomesh <name>_isomesh, <map>, <level>`, `isosurface …`, each with the shared suffix
`, <sele>, <buffer>[, carve=<buffer>]`.

#### 3.6.5 Reflections (MTZ) — `load_mtz_dialog` (`file_dialogs.py:152-201`, form `load_mtz.ui`)
Header parsed by `pymol.headering.MTZHeader` (`packages/engine/modules/pymol/headering.py:132-262`);
column type filters F/G (amplitudes), P (phases), W/Q (weights); `guessCols("2FoFc")`
and `guessCols("FoFc")` preselect (`:157-179`). Resolution spinboxes seeded from
`reso_min`/`reso_max` (`:181-184`). OK → `cmd.load_mtz(filename, prefix, amplitudes,
phases, weights, reso_min, reso_max, quiet=0)`. **`cmd.load_mtz` raises
`IncentiveOnlyException` (`importing.py:1481-1511`) in this build.**

Legacy Tk twin: `packages/engine/modules/pmg_tk/PyMOLMapLoad.py` — a `Pmw.Dialog` with OK/Cancel/Help,
groups "Column Labels" (`_ampl_chooser`, `_phase_chooser`, `_wt_chooser` with a `None`
entry), "Input Options" (`_min_res_fld`, `_max_res_fld`, real validators),
"Map Options" (`_name_prefix_fld` alphanumeric, `_fofc_chooser` checkbutton "FoFc").
It supports MTZ/CIF/CNS-HKL headers (`PyMOLMapLoad.py:28-33`) and on OK calls
`cmd.map_generate(pfx, file, ampl, phases, weights, min_res, max_res, 1, 1)`
(`:281-283`, impl `packages/engine/modules/pymol/creating.py:176-274`), then builds a representation
according to `default_fofc_map_rep` / `default_2fofc_map_rep`
(`SettingInfo.h:758-759`, defaults `"volume"`) → `isosurface` (level 1.0), `isomesh`
(±3.0 green/red for FoFc, 1.0 blue for 2FoFc), or `volume` (`:294-331`), wrapped in
`set suspend_updates` (`:295,335`), and auto-closes if `autoclose_dialogs`
(`SettingInfo.h:761`, default 1). This dialog is **not wired to any menu** in the Qt GUI
(no references outside its own file) — it is the design reference for a real
`map_generate` UI, which `cmd.map_generate` *does* support in this build.

#### 3.6.6 Session partial-load gate — `ask_partial` (`file_dialogs.py:80-99`, form `askpartial.ui`)
Skipped when `partial` is already truthy or the session is empty (`cmd.get_names()`)
(`:81-82`). Radio options (`askpartial.ui`):
- `check_discard` (default) — "Discard current session / All currently loaded objects will be deleted."
- `check_partial` — "Merge with current session (partial load)"; enables `check_rename`
  ("Automatically rename duplicate objects", bound to global setting
  `auto_rename_duplicate_objects`, `SettingInfo.h:661`) which is written back with
  `cmd.set(..., quiet=0)` (`:91-94`).
- `check_new` — "Open in new PyMOL Window" → `parent.new_window([fname])`, returns False
  so nothing is loaded locally (`:95-97`).
Modal `exec()`; Cancel aborts the load (`:88-89`).

---

## 4. Saving / exporting

### 4.1 `cmd.save` core
`packages/engine/modules/pymol/exporting.py:784-935`. Signature
`save(filename, selection='(all)', state=-1, format='', ref='', ref_state=-1, quiet=1,
partial=0)`.
- selection preprocessed by `selector.process` (`:830`).
- format guessed from extension; **unrecognised extension raises "Unrecognized file
  format"** (`:836-843`) — note the docstring at `:809-812` still claims a PDB fallback.
- `pse`/`psw` set the `session_file` setting with `\`→`/` normalisation (`:846-849`).
- Python-object formats via `func_type4`: `mmod` (`io.mmd.toFile`), `pkl` (binary
  pickle), `pkla` (ascii pickle) (`:853-857, 900-902`).
- Everything else dispatches through `savefunctions` with signature introspection; if the
  handler takes `filename` it is assumed to have written the file itself, otherwise the
  returned str/bytes are written here, honouring `.gz` (gzip) and `.bz2` (bz2)
  (`:861-925`).

`savefunctions` (`:988-1020`) — complete export format list:

| Extension(s) | Handler | Ref |
| --- | --- | --- |
| `cif`, `xyz`, `pdb`, `pqr`, `sdf`, `mol2`, `mae`, `mol` | `get_str` | `:989-996` |
| `mmtf`, `bcif` | `get_bytes` | `:997-998` |
| `pse`, `psw` | `get_psestr` (pickled session) | `:1000-1001`, impl `:975-979` |
| `fasta` | `get_fastastr` | `:1003`, impl `:170-220` |
| `aln` | `get_alnstr` | `:1004`, impl `:958-961` |
| `ccp4`, `mrc`, `map` | `get_ccp4str` | `:1005-1007`, impl `:969-973` |
| `png` | `png` | `:1009`, impl `:499-602` |
| `dae` | `pymol.querying:get_collada` | `:1012` |
| `gltf` | `pymol.querying:get_gltf` | `:1013` |
| `wrl` | `pymol.querying:get_vrml` | `:1014` |
| `pov` | `pymol.querying:get_povray` | `:1015` |
| `idtf` | `pymol.querying:get_idtf` | `:1016` |
| `mtl` | `_get_mtl_obj` — **raises ".MTL export not implemented"** | `:1017`, `:981-986` |
| `obj` | `_get_mtl_obj` | `:1018` |
| `stl` | `pymol.lazyio:get_stlstr` | `:1019` |

Plus the extension-only formats handled by `func_type4`: `mmd`/`out`/`dat` (→`mmod`),
`pkl`, `pkla`. `pmo` is explicitly rejected in `multisave` (`:641-642`).

String-returning API equivalents (perfect for browser download without touching disk):
`get_str` (`:666`), `get_bytes` (`:679`), `get_pdbstr` (`:222`), `get_cifstr` (`:937`),
`get_xyzstr` (`:949`), `get_sdfstr` (`:952`), `get_mol2str` (`:955`), `get_pqrstr`
(`:963`), `get_maestr` (`:966`), `get_fastastr` (`:170`), `get_alnstr` (`:958`),
`get_ccp4str` (`:969`), `get_psestr` (`:975`).

### 4.2 Export Molecule dialog — `file_save` (`file_dialogs.py:519-601`, form `save_molecule.ui`)
Widgets:
- `input_selection` — editable combo seeded with `enabled`, `all` from the `.ui`, then
  all objects + `cmd.get_names('public_selections')` (`:530-537`); its placeholder is the
  original first entry and is used when left blank (`:521,555`).
- `input_state` — combo `-1 (current)`, `0 (all states)`, then `1..count_states()`
  (`:534`); parsed with `int(text.split()[0])` (`:556`).
- Tab "Options"/`tab_3`: `input_retain_order` ← setting `retain_order`.
- Tab PDB/`tab_4`: `input_no_pdb_conect_nodup` (inverted `pdb_conect_nodup`),
  `input_pdb_conect_all`, `input_no_ignore_pdb_segi` (inverted `ignore_pdb_segi`),
  `input_pdb_retain_ids`, `input_multisave` ("Write HEADER for every object").
  All five settings are read on open (`:523-528`) and written back on OK (`:558-562`)
  — settings ids at `SettingInfo.h:821,423,204,389,351`.
- Tab "Multiple files"/`tab`: radios `input_multi_off` (default) / `input_multi_object`
  (+`input_multi_object_fmt`, default `{name}`) / `input_multi_state`
  (+`input_multi_state_fmt`, default `{name}_{state}`), and `input_multi_prompt`
  ("Prompt for every file", default on). Pressing `input_multi_state` forces the state
  combo to index 1 = "0 (all states)" (`:597-598`).
- `button_ok` "Save…".

Format filter list (`:539-551`): PDBx/mmCIF `*.cif *.cif.gz`; PDB `*.pdb *.pdb.gz`;
PQR `*.pqr`; MOL2 `*.mol2`; MDL SD `*.sdf *.mol`; Maestro `*.mae`; MacroModel
`*.mmd *.mmod *.dat`; ChemPy Pickle `*.pkl`; XYZ `*.xyz`; MMTF `*.mmtf`;
By Extension `*.*`.

Execution (`:564-595`): if a multi-file pattern is active *and* "prompt for every file"
is checked, `cmd.multifilenamegen(fmt, selection, state)` produces one
(filename, selection, state) triple per object/state and a **save dialog is shown for
each** (`:571-580`); then per file: `cmd.multisave` if `input_multisave`, else
`cmd.multifilesave` if the basename still contains `{`, else `cmd.save` +
`recent_filenames_add` (`:587-593`).

Supporting APIs: `multisave` (`exporting.py:604-657`, pdb/cif only, `append` flag,
rejects gz/bz2), `multifilesave` (`:707-732`), `multifilenamegen` (`:735-781`,
placeholders `{name} {state} {title} {num} {}`, zero-padded `{state}`/`{num}`).

### 4.3 Export Map / Export Alignment — `_file_save_object` (`file_dialogs.py:816-855`, form `save_object.ui`)
Generic: `cmd.get_names_of_type(otype)`; empty → warning box; else a combo `input_name`
and a "Save…" button; on OK a save dialog then `cmd.save(fname, name, -1, quiet=0)`.
- Maps: `otype='object:map'`, filter `CCP4 (*.ccp4 *.map)`, empty message
  "No map objects loaded" (`:845-847`).
- Alignments: `otype='object:alignment'`, filter `clustalw (*.aln)`, empty message
  "No alignment objects loaded\n\nHint: create alignment objects with "align" and
  "super" using the "object=…" argument." (`:850-855`). (A `url` local is assigned at
  `:851` but never used — dead code.)

### 4.4 Geometry/scene exports — `_file_save` (`pymol_qt_gui.py:793-800, 802-821`)
Single save dialog then `cmd.save(fname, format=<fmt>, quiet=0)`:
`VRML 2 WRL File (*.wrl)` → `wrl`; `COLLADA File (*.dae)` → `dae`;
`POV File (*.pov)` → `pov`; `STL File (*.stl)` → `stl`; `GLTF File (*.gltf)` → `gltf`.

### 4.5 PNG export dialog — `file_save_png` (`file_dialogs.py:604-688`, form `png.ui`)
Singleton dialog (`parent.dialog_png`, `:605-610`, field declared
`pymol_qt_gui.py:103`). Widgets: a green banner label ("New in PyMOL 2.0: To render a
sized antialiased image, use the Draw/Ray panel in the upper right."), `input_rendering`
combo, `button_ok` ("Save PNG image as …").
Flow (`:612-652`): save dialog (`PNG File (*.png)`) → `initialdir` update → dialog hides
→ branch on the combo index:
- 0 "capture current display" → `png <f>, 0, 0, -1, ray=0`
- 1 "draw antialiased OpenGL image" → `draw 0, 0` first, then `png` with width/height 0
- 2 "ray trace with opaque background" → `set opaque_background, 1`, `ray=1`
- 3 "ray trace with transparent background" → `set opaque_background, 0`, `ray=1`
then `cmd.sync()` and `cmd.do('png %s, %d, %d, %d, ray=%d')`.
**Width/height/DPI inputs are dead code**, commented out at `:625-634` and `:654-685`
(they would have used `exporting._unit2px`). The live sizing UI is the render panel
(§4.6).

`cmd.png` (`exporting.py:499-602`): appends `.png` when missing, `exp_path`, dpi default
from `image_dots_per_inch` (`SettingInfo.h:529`), `_unit2px` accepts `px`/`in`/`mm`/`cm`
suffixes (`:478-497`), `prior` (-1 try / 0 no / 1 yes) fetches the last rendered image
without re-rendering, `format` 0=PNG 1=PPM guessed from `.ppm` (`:553-567`), and
non-ray renders go through `_call_with_opengl_context` (`:602`).

### 4.6 Draw/Ray render panel — `render_dialog` (`pymol_qt_gui.py:673-790`, form `render.ui`)
Docked in the upper-right by default (called with a `widget`). Page 1 widgets:
`input_width`/`input_height` (px spinboxes, max 99999), `input_width_units`/
`input_height_units` (cm/inch doubles), `input_units` combo (`cm`, `inch`),
`input_dpi` editable combo (`300`,`150`,`90`, seeded from `image_dots_per_inch`, int
validator), `button_current` ("Reset" → viewport size), `button_lock` ("Lock aspect
ratio", default on), `input_transparent` ("transparent background ("Ray" only)", default
on), `button_draw` ("Draw (fast)"), `button_ray` ("Ray (slow)").
Bidirectional px↔units↔dpi conversion with a re-entrancy guard `UpdateLock`
(`:676-717`). `run_draw` issues `draw W, H`; `run_ray` sets `opaque_background` from the
transparency checkbox and issues `ray W, H, async=1`, then switches the stack to page 2
(`:730-742`). Page 2: `button_save` ("Save Image to File" → save dialog +
`cmd.png(fname, prior=1, dpi=…)`), `button_clip` ("Copy Image to Clipboard" →
`_copy_image`), `button_back` ("&lt; Back").
`_copy_image` (`pymol_qt_gui.py:1170-1186`) writes a temp PNG with `prior=1` and pushes
it to the Qt clipboard; the generic hook is `cmd._copy_image`
(`packages/engine/modules/pymol/internal.py:272-274`, monkey-patched at `pymol_qt_gui.py:1242`), also
reachable as `cmd.copy_image` (`exporting.py:35-36`).
Underlying: `cmd.draw` (`viewing.py:1601-1660`, stops movie/sculpting, needs a GL
context via `_call_with_opengl_context` `:1660`) and `cmd.ray`
(`viewing.py:1662-1745`, internal `_ray` `:1581`; stops movie/rocking/sculpting
`:1733-1739`, `renderer=1` shells out to PovRay).

### 4.7 Movie export dialog — `file_save_mpeg` (`file_dialogs.py:691-813`, form `movieexport.ui`)
Widgets: group "Movie Format" with `input_encoder` combo (``, `ffmpeg`, `mpeg_encode`,
`convert`), `input_quality` spin (60-100%, default from `movie_quality` setting,
`SettingInfo.h:734`), radios `format_mp4`, `format_mpg`, `format_mov`, `format_gif`,
`format_png` (default checked); size group `input_width`/`input_height` (max 9999,
seeded from `cmd.get_viewport()`), preset buttons `button_720p`/`button_480p`/
`button_360p`; group "Rendering" radios `input_draw` (default) / `input_ray` (checked if
`ray_trace_frames`, `SettingInfo.h:114`); `button_ok` ("Save Movie as …").
Encoder capability matrix (`:702-707`): none→png only; `ffmpeg`→mp4/mpg/mov/gif;
`mpeg_encode`→mpg; `convert`→gif. Disabled radios auto-switch to the encoder's default
(`:711-726`), quality is disabled for `""`/`convert` (`:725`), and a missing binary pops
"Encoder '&lt;x>' is not installed." (`:727-735`, `pymol.movie.find_exe`
`packages/engine/modules/pymol/movie.py:824-844`). Preselect logic for the three menu entries at
`:737-754`; `_preselect='png'` hides the whole format group.
Resolution presets clamp to ≤16:9 and round width to an even number (`:789-794`).
Save filters (`:694-700`): `Numbered PNG Files (*.png)`, `MPEG 4 movie file (*.mp4)`,
`MPEG 1 movie file (*.mpg *.mpeg)`, `QuickTime (*.mov)`, `Animated GIF (*.gif)`.
Run (`:758-787`): PNG → `cmd.mpng(fname, width, height, mode=2|1, quiet=0, modal=-1)`;
otherwise → `cmd.movie.produce(fname, width, height, quality, mode='ray'|'draw',
encoder, quiet=0)`.

`cmd.mpng` (`packages/engine/modules/pymol/moving.py:366-434`, internal `_mpng`
`internal.py:243-267`): writes `<prefix>NNNN.png` (or `.ppm`), strips an existing numeric
suffix, `first`/`last`/`preserve`/`mode`/`modal`.
`movie.produce` (`packages/engine/modules/pymol/movie.py:846-1000`): creates `<basename>.tmp/`, renders
frames there via `mpng`, then `_encode` (`:687-806`) runs `mpeg_encode` (via
`pymol.mpeg_encode`, PPM frames, quality→1-30, frame rate snapped to
`[23.976,24,25,29.97,30,50,59.94,60]`), `ffmpeg` (two-pass palette for GIF; `libvpx-vp9`
for `.webm`; crf 10/15/20 by quality; `-pix_fmt yuv420p`), or ImageMagick `convert`
(`-delay`). Even dimensions forced for mp4/mov/webm (`:952-967`); temp dir deleted
unless `preserve` (`:805-806`); `keep_alive` set/unset (`:975`, `:804`).

---

## 5. Sessions

- **Save Session** (`pymol_qt_gui.py:651-655`): reads the `session_file` setting
  (`SettingInfo.h` / `Setting.cpp:660`), passes it through `cmd.as_pathstr`
  (`cmd.py:116-125`) and delegates to Save-As; if empty, a dialog is shown.
- **Save Session As** (`pymol_qt_gui.py:656-671`): filters
  `PyMOL Session File (*.pse *.pze *.pse.gz)` and `PyMOL Show File (*.psw *.pzw *.psw.gz)`;
  always calls `cmd.save(fname, format='pse', quiet=0)` (so `.psw` gets identical
  content, only the extension differs), then `recent_filenames_add`.
- **Serialisation**: `get_psestr` → `cmd.get_session` → `cPickle.dumps(session, 1)`
  (`exporting.py:975-979`). `get_session` (`:371-476`) honours `pse_export_version`
  (`SettingInfo.h:855`, backports settings/objects via `_session_convert_legacy`
  `:261-369`), `pse_binary_dump` (`:859`), deprecated `session_compression` (`:649`,
  now warns `:469-473`), `session_cache_optimize` (`:696`) → `cache('optimize')`, plus
  `_session_save_tasks` hooks (`:436-451`).
- **Loading**: `load_pse` (`importing.py:829-854`) reads the file with `cmd.file_read`,
  unpickles, `set_session(..., steal=1)`, sets `session_file` (unix separators), and for
  `.psw` (or `presentation` + `presentation_auto_start`, `SettingInfo.h:512`) rewinds the
  movie and recalls the first scene.
- **`set_session`** (`importing.py:138-183`): accepts bytes (zlib+pickle) or dict,
  `partial` and `cache` flags, restores `pymol.session`/`_cache`, runs
  `_session_restore_tasks`, and **activates the `security` wizard when the session
  contains movie commands** (`:178-180`; wizard text
  `packages/engine/modules/pymol/wizard/security.py:15-43` with accept/decline/mdump).
- **Partial / merge**: §3.6.6 plus the `partial` kwarg threaded from `file_open`
  (`pymol_qt_gui.py:645-649`).
- **Session chaining**: `cmd.chain_session` (`viewing.py:934-959`) finds the next
  numbered `.pse`/`.psw` next to `session_file` and loads it as `psw` — used by
  presentation mode.

---

## 6. Logs, scripts, working directory

| Feature | Ref | Behaviour |
| --- | --- | --- |
| Log File ▸ Open… | `pymol_qt_gui.py:823-836` | Save-style dialog, filters `PyMOL Script (*.pml)`, `Python Script (*.py *.pym)`, `All (*)`; then `cmd.log_open(fname, 'w')` |
| Log File ▸ Append… | `pymol_qt_gui.py:837-838` | same, mode `'a'` |
| Log File ▸ Resume… | `pymol_qt_gui.py:840-845` | `cmd.resume(fname)` |
| Log File ▸ Close | `commanding.py:206-227` | closes handle, `set logging, 0` |
| `cmd.log_open` | `commanding.py:107-155` | holds an open `LogFile`; sets `logging` = 2 for `.py`/`.pym`, else 1; mode `'a'` writes a leading newline; can also log to a Queue object (`QueueFile` `:80-93`) |
| `cmd.log` | `commanding.py:160-204` | writes pml or python form of each command |
| `cmd.resume` | `commanding.py:52-78` | executes the file (`run` for `.py`/`.pym`, else `@`) then `log_open …,a` |
| Log rewriting | `commanding.py:94-99` | `LogFile.write` rewrites `fetch …` lines to append `async=0` |
| Run Script… | `pymol_qt_gui.py:847-868` | multi-select; filters `All Runnable (*.pml *.py *.pym)`, `PyMOL Command Script (*.pml)`, `(*.txt)`, `Python Script (*.py *.pym)`, `(*.txt)`, `All Files(*)`; **`cmd.cd(dirname)` before each run**; `.py/.pym/.pyc/.pyo/.py.txt` (or a "Python" filter selection) → `cmd.run`, else `cmd.do("@" + fname)` |
| `@` handling | `parser.py:403-441` | opens the file, nests one parser layer, `.p1m` forces secure mode, warns "use 'run' instead of '@' with Python files?" |
| `cmd.run` | `parsing.py:427-470` | `.pml` delegates to `cmd.load`; namespaces `local/global/module/main/private`; `spawn` variant |
| Working Directory ▸ Change… | `pymol_qt_gui.py:870-873` | `QFileDialog.getExistingDirectory` → `cmd.cd(dname or '.', quiet=0)` |
| Working Directory ▸ File Browser | `_gui.py:74-78,121` | `cmd.system('open .' / 'explorer .' / 'xdg-open .')` |
| `cmd.cd` / `pwd` / `ls` / `system` | `externing.py:32,56,73,112` | server-process cwd + shell-out |
| Edit pymolrc | `pymol_qt_gui.py:634-637` | opens `pmg_qt/TextEditor` on the pymolrc |

---

## 7. Network / fetch

### 7.1 `Get PDB…` dialog — `file_fetch_pdb` (`file_dialogs.py:444-516`, form `fetch.ui`)
Widgets: banner label linking to the `fetch_path` wiki page; `input_code` (max 4 chars,
placeholder "4 letter PDB code"); checkboxes + object-name fields
`input_check_pdb`/`input_name` (checked by default), `input_check_2fofc`/
`input_name_2fofc`, `input_check_fofc`/`input_name_fofc`; group "PDB Structure Options"
with editable combos `input_chain` and `input_assembly` (seeded from the `assembly`
setting, `SettingInfo.h:857`); `output_command` live preview; `button_ok` ("Download").
On a 4-character code, two **async network lookups** populate the combos
(`AsyncFunc`, `packages/engine/modules/pymol/Qt/utils.py:100-125`):
- `_get_assemblies` → `https://www.ebi.ac.uk/pdbe/api/pdb/entry/summary/<id>` →
  `assemblies[].assembly_id` (`file_dialogs.py:409-423`)
- `_get_chains` → `https://www.ebi.ac.uk/pdbe/api/pdb/entry/polymer_coverage/<id>` →
  `molecules[].chains[].chain_id` (`:426-441`)
Generated command (`:448-475`): `set assembly, "<a>"` + `fetch <code><chain>[, name]`,
plus `fetch <code>[, name], type=2fofc` and `…type=fofc`. OK validates the 4-letter code
(`:492-495`) and runs via `cmd.do`.

### 7.2 `cmd.fetch`
`importing.py:1331-1402`. Args: `code, name, state, finish, discrete, multiplex, zoom,
type, async_, path, file, quiet`. `path` defaults to the `fetch_path` setting or `'.'`
(`:1387-1389`; setting default `"."`, `SettingInfo.h:607`, special-cased in
`packages/engine/layer1/Setting.cpp:644`). `async_<0` ⇒ async when interactive (`:1390-1391`).
`_multifetch` (`:1274-1329`) splits whitespace-separated codes, infers `type` (2-3 char
codes → `cc` chemical component; else `fetch_type_default`, default `"cif"`,
`SettingInfo.h:870`), understands `EMD-xxxx`/`emd_xxxx`/`CID_`/`SID_` prefixes, extracts
a trailing chain from 5+ character codes and post-filters with `cmd.remove`, and
legalises the object name.
`_fetch` (`:1155-1272`): per-type filename pattern (`{code}.{type}`,
`{code}_{type}.ccp4`, `emd_{code}.ccp4`, `{type}_{code}.sdf`, `{code}.cif`), skips the
download when the target file already exists (`:1219-1221`), tries each URL from
`fetch_host` (space-separated; aliases `pdb`/`pdbe`/`pdbj`, `:1118-1122`; setting default
`"pdb"`, `SettingInfo.h:736`) crossed with `hostPaths` (`:1124-1153`: mmtf, bio, pdb,
cif, bcif, 2fofc, fofc, pubchem, emd, cc), treats an HTML body as failure
(`:1229-1231`), writes the file, then loads via `cmd.load` / `read_pdbstr` /
`load_raw('cif'|'mmtf')`.
Related: `download_chem_comp` (`internal.py:314-338`) caches ligand CIFs in `fetch_path`
and warns when it is read-only.

### 7.3 URL loading
`cmd.file_read` (`internal.py:279-311`) accepts a filename, an URL (`://`, sets a
`PyMOL/<version>` User-Agent) or an open handle, and transparently gunzips/bunzips by
magic bytes. `load_dialog` deliberately skips the `initialdir` update for URLs
(`file_dialogs.py:39-40`).

---

## 8. Per-user state files (also "file I/O")

| File | Ref | Content |
| --- | --- | --- |
| `~/.pymol/recent.db` | `_gui.py:986-1000` | SQLite recent-files list |
| `~/.pymol/shortcuts_save.json` | `packages/engine/modules/pymol/save_shortcut.py:6-16` | JSON dict of saved key bindings; `save_shortcuts` (`:18-36`, creates `~/.pymol` mode 0750), `load_shortcuts_dict` (`:38-55`, silent on `FileNotFoundError`), `setkey_from_dict` (`:57-63`, replays `cmd.set_key(key, value[2])`), `load_and_set` (`:65-71`). Loaded at GUI startup (`pymol_qt_gui.py:419`) and written by `shortcut_manager.save_shortcuts` (`packages/engine/modules/pymol/shortcut_manager.py:70-76`) |
| pymolrc | `pymol_qt_gui.py:634-637` | edited via the built-in text editor |
| `$PYMOL_DATA/pmg_qt/styles/pymol.sty` | `pymol_qt_gui.py:406-417` | Qt stylesheet (no web analogue) |

---

## 9. Behaviour, per menu entry

| Operation | Mechanism in the web app |
| --- | --- |
| Open… (multi-select) | **Server path picker** (React), multi-select, then the `load_dialog` state machine runs on the server bridge; first file `partial=0`, rest `partial=1` |
| Open Recent | **Server list** from `recent.db`; no picker |
| Drag & drop from desktop | **Upload** to a server scratch dir, then normal load; dropped URLs go straight to `cmd.load` |
| Format-specific import dialogs (traj/aln/mae/map/mtz/askpartial) | Pure React modals; they only ever emit `cmd.do(<command string>)` or a typed call — no filesystem access of their own |
| Get PDB / fetch | Pure React modal + server `cmd.fetch`; downloads land in the server's `fetch_path`. Show `fetch_path` and make it editable (`cmd.set('fetch_path', …)`) with a directory picker |
| Save Session / Save As | **Server path picker (save mode)**; optionally offer "also download a copy" via `/fs/download` |
| Export Molecule | **Server path picker**, but for the common single-file case also offer "Download" using `cmd.get_bytes/get_str` — no server file at all |
| Export Map / Alignment | Server path picker (`get_ccp4str`/`get_alnstr` allow a download variant too) |
| Export Image As (wrl/dae/gltf/pov/stl) | Server path picker + download variant via the `get_*` functions in `savefunctions` |
| PNG export & Draw/Ray panel | Render server-side (`ray`/`draw`), then **either** write to a picked server path **or** stream the PNG bytes to the browser (`cmd.png(tmp, prior=1)` → download). "Copy to clipboard" becomes `navigator.clipboard.write(PNG blob)` |
| Movie export (mp4/mpg/mov/gif) | **Server working directory only** — `movie.produce` needs a temp dir and external encoders. Show a server-side progress feed; offer a download link when finished |
| Movie export (numbered PNGs) | **Server directory picker only** (N files) |
| Log File open/append/resume | **Server path picker**; the handle lives in the PyMOL process for the whole session |
| Run Script… | **Server path picker**; note it also `cd`s. Uploading a script is possible but changes `cd` semantics — warn |
| Working Directory ▸ Change | Server directory picker → `cmd.cd` |
| Working Directory ▸ File Browser | Replace `cmd.system('open .')` with "reveal in the in-app picker" (a browser cannot open Finder) |
| New PyMOL Window | No analogue (single process, single client); the item is not offered |
| Plugin `tkinter.filedialog` calls | Bridge-side shim that blocks the calling thread while React shows the picker (same contract as `mimic_tk._qtFileDialog`, `packages/engine/modules/pmg_qt/mimic_tk.py:36-90`) |

### The bridge FS API

None of this existed upstream: the only directory-ish primitives are `cmd.ls` (prints only,
`externing.py:73-110`) and `cmd.system`, and neither returns structured data.
`packages/bridge/tenmol_bridge/panels/files.py` installs a `cmd.tenmol_files` namespace, so every
method is an ordinary `{t:'call', fn:'cmd.tenmol_files.<method>'}`:

`pwd`, `chdir`, `home`, `expand`, `initialdir` / `set_initialdir`, `browse`, `stat`, `mkdir`,
`glob_paths`, `places`, `recent` / `recent_add`, `classify`, `note_open`, `plan_open`,
`load_formats`, `load_capabilities`, `save_formats`, `unavailable`, `refused`, plus the
per-format dialog descriptors (`traj_dialog_info`, `map_dialog_info`, `aln_dialog_info`,
`mae_dialog_info`, `mtz_dialog_info`, `map_generate_info`) and `produce` /
`multifilenamegen` for movie export. Bulk bytes ride `POST /upload` and `GET /blob/{id}` on the
HTTP side rather than the WebSocket.

`pymol.pymolhttpd.PymolHttpd` (`packages/engine/modules/pymol/pymolhttpd.py:441-520`) serves a
document root and JSON-wrapped `cmd` calls and was read as prior art; it is a separate legacy
server and is not used (see `docs/cmd-api-rpc.md` §5).

---

## 10. Constraints this area lives under

1. **`.pwg` files launch a second HTTP server** and can `launch <module>` arbitrary
   Python, open a browser, and even `os.unlink` themselves
   (`importing.py:516-615`). `.pwg` is refused (`panels/files.py::refused`).
2. **Session security wizard**: `.pse` files with movie commands trigger a modal
   accept/decline flow (`importing.py:178-180`, `wizard/security.py`). It is a normal wizard,
   so it renders through the generic wizard protocol (`docs/wizards.md` §7.24); without it,
   sessions would silently execute embedded commands.
3. **`run`/`@`/`system`/`cd` are full local code execution.** Acceptable for a local
   desktop replacement, catastrophic if the bridge ever binds to a non-loopback interface —
   which is why the transport is loopback + token + `Origin` allow-list
   (`docs/cmd-api-rpc.md` §8.1).
4. **Movie/mpng and log files are inherently server-side**; any UX that implies "save to
   my Downloads folder" will be wrong for them.
5. **Blocking dialogs**: `ask_partial` uses `exec()` (`file_dialogs.py:88`) and the
   `tkinter.filedialog` shim is blocking. `panels/files.py::DialogBroker` suspends the calling
   Python thread on a round trip without deadlocking the `cmd` lock (`_self.lockcm`), and
   `install_tk_filedialog` puts the same contract behind `mimic_tk._qtFileDialog`'s API so legacy
   plugins keep working.
6. **Formats that don't work in this build**: `mae` load, `load_mtz`, `vis`, `moe`,
   `phypo` all raise `IncentiveOnlyException`
   (`importing.py:31-33,1620,1641-1643,1511`); `.mtl` export raises
   (`exporting.py:981-986`); `pmo` is rejected (`exporting.py:641-642`). The React
   dialogs must not advertise them as working, or must surface the exception cleanly.
7. **Dead UI that may be mistaken for a spec**: PNG width/height/DPI block
   (`file_dialogs.py:625-685`), `PyMOLMapLoad.py` (Tk, unreferenced),
   `file_autoload_mtz` (`_gui.py:13`, no implementation), unused `url` in
   `file_save_aln` (`file_dialogs.py:851`).
8. **`new_window`** spawns a new OS process (`_gui.py:41-53`) and is reachable from the
   File menu *and* from the partial-session dialog (`file_dialogs.py:96`). One backend process
   means that path is not offered.
9. **Encoder availability** (`ffmpeg`, `mpeg_encode`, `convert`) is probed with
   `shutil.which` on the server (`movie.py:824-844`), so the export dialog asks the server for
   capabilities rather than assuming (`cmd.get_movie_encoders`).
10. **Large transfers**: `.pse` of a big system, CCP4 maps and MP4s are tens to hundreds
    of MB, so they ride `/blob` and `/upload` rather than the WebSocket JSON channel.
11. **`cmd.save` throws on unknown extensions** (`exporting.py:841-843`) despite the
    docstring's PDB-fallback claim, so the extension is validated before the call.
12. **Path encoding**: `cmd.as_pathstr`/`exp_path` (`cmd.py:112-125`) do Windows-specific
    decoding and `$VAR`/`~` expansion, so the picker sends raw strings and lets the server expand
    them (`cmd.tenmol_files.expand`) rather than pre-resolving.
