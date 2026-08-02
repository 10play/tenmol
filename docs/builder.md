# The molecular builder

The Builder dock widget and the molecular editor state machine behind it, read out of
`packages/engine/`, which is unmodified upstream.

**Where the port stands.** `apps/web/src/features/builder/` (`BuilderPanel.tsx`, `controller.ts`,
`tables.ts`, `ringIcons.ts`, `sculptTicker.ts`, `viewportPicking.ts`) over
`packages/bridge/tenmol_bridge/panels/builder.py` and
`packages/protocol/src/topics/{builder,editor}.ts`. Every button press goes to
`cmd.builder_action` and the reply *is* the new state, so the client never keeps a shadow copy of
`pk1..pk4`; a 4 Hz poll covers state the panel did not cause (a viewport pick, a `set valence, 0`
typed in the console, a wizard armed by a script). The 13 action wizards of §6 render through the
generic wizard protocol — see `docs/wizards.md` §8.

Sources read:

| file | what it is |
|---|---|
| `packages/engine/modules/pmg_qt/builder.py` (1579 lines) | The Qt Builder panel + 13 "action wizard" classes. **Authoritative UI spec.** |
| `packages/engine/modules/pymol/editor.py` (1169 lines) | Python-level fragment/monomer attachment logic (`attach_fragment`, `attach_amino_acid`, `attach_nuc_acid`, `fab`, `fnab`). |
| `packages/engine/modules/pymol/editing.py` (3161 lines) | The `cmd.*` editing API (`edit`, `unpick`, `bond`, `unbond`, `valence`, `cycle_valence`, `replace`, `attach`, `remove_picked`, `h_fill`, `h_fix`, `h_add`, `fix_chemistry`, `invert`, `flag`, `reference`, `undo`, `redo`, `push_undo`, `sculpt_*`, `set_geometry`, `torsion`, `drag`). |
| `packages/engine/layer3/Editor.h`, `packages/engine/layer3/Editor.cpp` | The C++ editor state machine: `pk1..pk4`, `pkbond`, `pkset`, `pkmol`, `pkresi`, `pkchain`, `pkobject`, `_pkfrag*`, auto-measure, auto-dihedral. |
| `packages/engine/layer1/SceneMouse.cpp` | How a viewport click assigns the next `pkN` selection. |
| `packages/engine/modules/pymol/controlling.py` | `cmd.edit_mode`, `cmd.button` (mouse action codes `PkAt`/`PkBd`/`MovA`). |
| `packages/engine/modules/pymol/creating.py:943` | `cmd.fragment` — fragment library loader. |
| `packages/engine/modules/pymol/computing.py:20` | `cmd.clean` — **raises `IncentiveOnlyException` in this open-source tree.** |
| `packages/engine/modules/pymol/wizard/__init__.py` | Wizard base class contract (`get_prompt`, `get_panel`, `do_pick`, `do_select`, `cleanup`). |
| `packages/engine/data/chempy/fragments/*.pkl` (131 files) | The fragment library on disk. |
| `packages/engine/data/pmg_tk/bitmaps/builder/*.gif` (10 files) | Ring icons: `cyc3..cyc7`, `aro5`, `aro6`, `aro65`, `aro66`, `aro67`. |
| `packages/engine/modules/pmg_tk/skins/normal/builder.py` (1507 lines) | **Legacy Tk builder. Do NOT port.** It has no Nucleic Acid tab and an older AminoAcidWizard. The Qt file supersedes it. |

Entry point: `pmg_qt/pymol_qt_gui.py:613 open_builder_panel()` → `pmg_qt/builder.py:1573 BuilderPanelDocked()` wraps `_BuilderPanel` in a floating `QDockWidget` docked to `TopDockWidgetArea`. It is also reachable from the quick-button row `('Builder', self.open_builder_panel)` at `pmg_qt/pymol_qt_gui.py:250`.

---

## 0. Architecture of this area

**The Builder is 100% a control-plane surface.** Every single button issues `cmd.*` calls; nothing about it needs client-side geometry. The 3D consequences (new atoms, bonds, sculpt CGO bumps) come back as ordinary object/rep updates through the geometry channel that the viewport agent owns. **No contradiction with the target architecture.**

Two things do NOT fit the plain request/response model and need explicit bridge support:

1. **The wizard system.** 12 of the ~40 buttons do not act immediately — they *arm a wizard*, which then (a) publishes a prompt string + a button panel that PyMOL normally draws **inside the GL viewport**, and (b) receives `do_pick` / `do_select` callbacks when the user clicks an atom in the viewport. The wizard object lives in Python. The web client must render the wizard prompt/panel as React and must receive a `wizard_refresh` event whenever `cmd.refresh_wizard()` is called.
2. **Picking.** The editor's `pk1..pk4` selections are created by the C++ scene-click handler (`packages/engine/layer1/SceneMouse.cpp:429 cButModePickAtom`). Client-side WebGL picking must round-trip an `(object, atom_index)` to the backend, which then calls the same `EditorSelect` path (exposed as `cmd.edit(...)`). See §7.

---

## 1. Panel-scoped globals and helpers

| name | value | source |
|---|---|---|
| `active_sele` | `"_builder_active"` — the object currently being worked on | `builder.py:22` |
| `newest_sele` | `"_builder_added"` — last atom(s) added | `builder.py:23` |
| `display_sele` | `"_build_display"` — used by the Fix/Restrain flag wizard | `builder.py:24` |
| `undocontext(cmd, sele)` | context manager, **no-op in open source** (`editor.py:38-49`) | `builder.py:26` |
| `undoablemethod(sele)` | decorator wrapping a method in `undocontext` | `builder.py:28-34` |
| `getSeleDict(cmd)` | `{name: 1}` for `cmd.get_names("selections")` | `builder.py:993` |
| `collectPicked(cmd)` | returns the ordered subset of `["pk1","pk2","pk3","pk4"]` that currently exist | `builder.py:1000-1006` |
| `NucleicAcidProperties` | holds `dna_form` (default `"B"`), `dna_dbl_helix` (default `True`) | `builder.py:1012-1015` |
| `makeFragmentButton()` | `QPushButton`, `WA_LayoutUsesWidgetRect`, sizePolicy `(Minimum, MinimumExpanding)`, `autoDefault=False` | `builder.py:1021-1028` |

`collectPicked` is the single most important helper: **every** bottom-row button branches on it. If atoms are already picked → act immediately. If not → arm a wizard.

### Panel show side effects (`showEvent`, `builder.py:1337-1341`)

```python
cmd.set("editor_auto_measure", 0)
cmd.set("auto_overlay")        # value defaults to 1 (setting.py:185)
cmd.set("valence")             # value defaults to 1
cmd.edit_mode(1)
```
Web: fire these four on panel mount. Note `cmd.set(name)` with no value sets `1`.

---

## 2. Tab structure

`QTabWidget` with three top-level tabs (`builder.py:1068-1070`):

1. **"Chemical"** — `QGridLayout`, 3 rows of fragment/element buttons.
2. **"Protein"** — `QGridLayout`, 2 rows of residue buttons + a secondary-structure `QComboBox` on row 2.
3. **"Nucleic Acid"** — `QVBoxLayout` containing a **nested `QTabWidget`** with sub-tabs **"DNA"** and **"RNA"** (`builder.py:1164-1172`).

Below the tabs, a `QVBoxLayout` (`self.buttons_layout`) holds **3 always-visible rows** of editing actions (§5). Layout margins `5,5,5,5`, spacing `5`, plus a trailing stretch.

---

## 3. Tab 1 — "Chemical"

### 3a. Row 0 — atom replacement + two small O/F fragments (`builder.py:1075-1087`)

Every element button calls `self.replace(symbol, geometry, valence, text)` (`builder.py:1352-1359`):

```python
picked = collectPicked(cmd)
if picked:
    cmd.select("_builder_active", "byobj " + picked[0])
    cmd.replace(atom, geometry, valence)      # editing.py:1572
    self.doAutoPick()
else:
    ReplaceWizard(_self=cmd).toggle(atom, geometry, valence, text)
```

Geometry codes come from `packages/engine/layer2/AtomInfo.h:129-133`: `1=Single, 2=Linear, 3=Planar, 4=Tetrahedral, 5=None`.

| label | tooltip | call | geometry | valence |
|---|---|---|---|---|
| `H` | Hydrogen | `cmd.replace("H",1,1)` | Single | 1 |
| `C` | Carbon | `cmd.replace("C",4,4)` | Tetrahedral | 4 |
| `N` | Nitrogen | `cmd.replace("N",4,3)` | Tetrahedral | 3 |
| `O` | Oxygen | `cmd.replace("O",4,2)` | Tetrahedral | 2 |
| `P` | Phosphorus | `cmd.replace("P",4,3)` | Tetrahedral | 3 |
| `S` | Sulfur | `cmd.replace("S",2,2)` | Linear | 2 |
| `F` | Fluorine | `cmd.replace("F",1,1)` | Single | 1 |
| `Cl` | `Chlorrine` *(typo in source, builder.py:1082)* | `cmd.replace("Cl",1,1)` | Single | 1 |
| `Br` | Bromine | `cmd.replace("Br",1,1)` | Single | 1 |
| `I` | Iodine | `cmd.replace("I",1,1)` | Single | 1 |
| `-CF3` | Trifluoromethane | `self.grow("trifluoromethane",4,0,"trifluoro")` | — | — |
| `-OMe` | Methanol | `self.grow("methanol",5,0,"methoxy")` | — | — |

Note: the internal `text` strings differ from tooltips: `"Phosphorous"` (builder.py:1079).

### 3b. Row 1 — functional-group fragments (`builder.py:1088-1099`)

All call `self.grow(fragment, hydrogen_id, anchor, text)` (`builder.py:1343-1350`):

```python
if "pk1" in cmd.get_names("selections"):
    cmd.select("_builder_active", "byobj pk1")
    editor.attach_fragment("pk1", name, pos, geom, _self=cmd)   # editor.py:51
    self.doAutoPick()
else:
    cmd.unpick()
    AttachWizard(cmd).toggle(name, pos, geom, text)
```

`editor.attach_fragment(selection, fragment, hydrogen, anchor)` (`editor.py:51-86`):
- If `selection` is not an existing named selection → `cmd.fragment(fragment)` creates a new object (errors if an object of that name exists); then `cmd.remove("(hydro and <fragment>)")` if `auto_remove_hydrogens`.
- Else → `cmd.fragment(fragment, tmp_name, origin=0)`, `cmd.fuse(f"{tmp} and id {hydrogen}", f"({selection})", 1)`, then `cmd.remove("(hydro and pkmol)")` if `auto_remove_hydrogens` else `cmd.h_fill()` when `cmd.count_atoms('hydro and (neighbor pk2)')`, finally `cmd.delete(tmp)`.
- **`anchor` is documented as unused** (`editor.py:62`).

| label | tooltip | fragment | hydrogen id | anchor | text |
|---|---|---|---|---|---|
| `CH4` | Methyl | `methane` | 1 | 0 | methyl |
| `C=C` | Ethylene | `ethylene` | 4 | 0 | vinyl |
| `C#C` | Acetylene | `acetylene` | 2 | 0 | alkynl |
| `C#N` | Cyanide | `cyanide` | 2 | 0 | cyano |
| `C=O` | Aldehyde | `formaldehyde` | 2 | 0 | carbonyl |
| `C=OO` | Formic Acid | `formic` | 4 | 0 | carboxyl |
| `C=ON` | C->N amide | `formamide` | 5 | 0 | C->N amide |
| `NC=O` | N->C amide | `formamide` | 3 | 1 | N->C amide |
| `S=O2` | Sulfone | `sulfone` | 3 | 1 | sulfonyl |
| `P=O3` | Phosphite | `phosphite` | 4 | 0 | phosphoryl |
| `N=O2` | Nitro | `nitro` | 3 | 0 | nitro |

### 3c. Row 2 — cyclic / aromatic fragments, icon buttons (`builder.py:1100-1111`)

Labels starting with `#` are rendered as **icon** buttons, not text. Icons are loaded in `getIcons()` (`builder.py:1323-1335`) from `$PYMOL_DATA/pmg_tk/bitmaps/builder/{aro*,cyc*}.gif`; each is loaded twice — normal and `image.invertPixels()` — and stored as `(QIcon, QIcon_inverted)` in `self.icons[name]`; icon size = `icons[1].actualSize(QSize(48,48))`. The inverted variant is stored in `self.btn_icons[btn]` but **never swapped in** in this file (dead code — intended for dark theme).

| label | icon file | tooltip | fragment | hydrogen id | anchor | text |
|---|---|---|---|---|---|---|
| `#cyc3` | `cyc3.gif` | Cyclopropane | `cyclopropane` | 4 | 0 | cyclopropyl |
| `#cyc4` | `cyc4.gif` | Cyclobutane | `cyclobutane` | 4 | 0 | cyclobutyl |
| `#cyc5` | `cyc5.gif` | Cyclopentane | `cyclopentane` | 5 | 0 | cyclopentyl |
| `#cyc6` | `cyc6.gif` | Cyclohexane | `cyclohexane` | 7 | 0 | cyclohexyl |
| `#cyc7` | `cyc7.gif` | Cycloheptane | `cycloheptane` | 8 | 0 | cycloheptyl |
| `#aro5` | `aro5.gif` | Cyclopentadiene | `cyclopentadiene` | 5 | 0 | cyclopentadienyl |
| `#aro6` | `aro6.gif` | Benzene | `benzene` | 6 | 0 | phenyl |
| `#aro65` | `aro65.gif` | Indane | `indane` | 12 | 0 | indanyl |
| `#aro66` | `aro66.gif` | Napthylene *(sic)* | `napthylene` | 13 | 0 | napthyl |
| `#aro67` | `aro67.gif` | Benzocycloheptane | `benzocycloheptane` | 13 | 0 | benzocycloheptyl |

All 23 fragment `.pkl` files referenced by the Chemical tab were verified present in `packages/engine/data/chempy/fragments/`.

### 3d. `doAutoPick` (`builder.py:1412-1427`) — runs after every immediate grow/replace

```python
cmd.unpick()
if cmd.select("_builder_added", "(byobj _builder_active) and not _builder_active") == 0:
    cmd.select("_builder_added", "_builder_active")
new_list = cmd.index("_builder_added and hydro")
if not new_list: new_list = cmd.index("_builder_added")
if new_list:
    index = new_list.pop()                       # last entry
    cmd.edit("%s`%d" % index)                    # re-pick as pk1
    if cmd.get_wizard() is not None:
        cmd.do("_ cmd.get_wizard().do_pick(0)")
self.doZoom()
```
`doZoom` (`builder.py:1429-1431`): if `pk1` exists → `cmd.center("%pk1 extend 9", animate=-1)`.

---

## 4. Tab 2 — "Protein" and Tab 3 — "Nucleic Acid"

### 4a. Protein tab — 23 residue buttons (`builder.py:1132-1144`)

Row 0: `Ace Ala Arg Asn Asp Cys Gln Glu Gly His Ile Leu` (12 buttons)
Row 1: `Lys Met Phe Pro Ser Thr Trp Tyr Val NMe NHH` (11 buttons)

Tooltip is `"Build %s residue" % label`. The command is `self.attach(label.lower())`.

`_BuilderPanel.attach(aa)` (`builder.py:1361-1374`):

```python
ss = self.ss_cbox.currentIndex() + 1      # 1..3
picked = collectPicked(cmd)
if len(picked) == 1:
    with undocontext(cmd, "bymol %s" % picked[0]):
        editor.attach_amino_acid(picked[0], aa, ss=ss, _self=cmd)
    self.doZoom()
else:
    cmd.unpick()
    AminoAcidWizard(_self=cmd, ss=ss).toggle(aa)
```

Note the bare `except: fin = -1` at `builder.py:1369-1370` swallows all attach errors silently and assigns an unused local — reproduce as a logged, non-fatal error in the web client (do **not** reproduce the silence).

### 4b. Secondary-structure combo (`builder.py:1146-1154`)

`QLabel("Secondary Structure:")` spanning grid cols 0..2 on row 2, `QComboBox` spanning cols 3..6 on row 2. Items, in order:

| index | item text | `ss` value passed |
|---|---|---|
| 0 | `Alpha Helix` | 1 |
| 1 | `Beta Sheet (Anti-Parallel)` | 2 |
| 2 | `Beta Sheet (Parallel)` | 3 |

`currentIndexChanged[int]` → `ssIndexChanged(index)` (`builder.py:1376-1379`): if the current wizard is an `AminoAcidWizard`, call `w.setSecondaryStructure(index + 1)` live.

Backing dihedrals in `editor.attach_amino_acid` (`editor.py:151-162`):

| ss | phi | psi |
|---|---|---|
| 1 helix | −57.0 | −47.0 |
| 2 antiparallel beta | −139.0 | 135.0 |
| 3 parallel beta | −119.0 | 113.0 |
| 4 flat (**not exposed in the Qt combo**) | 180.0 | 180.0 |
| ss<0 | falls back to the `secondary_structure` setting (`SettingInfo.h:242`, default 2, range 1..4) | |

### 4c. `editor.attach_amino_acid` semantics (`editor.py:98-292`)

Signature: `attach_amino_acid(selection, amino_acid, center=0, animate=-1, object="", hydro=-1, ss=-1)`.

- `hydro < 0` → `hydro = not auto_remove_hydrogens`.
- **New-object branch** (selection empty / 0 atoms): `cmd.fragment(amino_acid, object)`; `cmd.remove("(hydro and <obj>)")` if `not hydro`; then `cmd.edit("((obj) and name C)")` if a C exists else `cmd.edit("((obj) and name N)")`. Errors if an object with that name already exists.
- **Validation errors** (each prints and raises `QuietException`, after `cmd.delete("_tmp_editor*")`):
  - `cmd.select(tmp_connect, "(sel) & elem N,C") != 1` → *"invalid connection point: must be one atom, name N or C."*
  - `amino_acid in ["nhh","nme"]` and the picked atom is not `elem C` → *"invalid connection point: must be C for residue '<x>'"*
  - `amino_acid == "ace"` and the picked atom is not `elem N` → *"invalid connection point: must be N for residue '<x>'"*
  - picked atom is `elem H` → *"please pick a nitrogen or carbonyl carbon to grow from."*
  - otherwise → *"unable to attach fragment."*
- **Backward (grow off N)** `editor.py:167-222`: renumber new residue `resi = resv-1`; `cmd.set_geometry(tmp_connect, 3, 3)` (make N planar); `cmd.fuse("(tmp_editor and name C)", tmp_connect, 2)`; `cmd.select(tmp_domain,"byresi (pk1 | pk2)")`; `cmd.remove("(pkmol and hydro)")` if `not hydro`; `cmd.set_dihedral(CA/CH3', pk2, pk1, CA/CH3, 180.0)` (omega); `cmd.h_fix(tmp2)` if hydro; PHI/PSI `cmd.set_dihedral` (skipped for `pro*`); re-`cmd.edit` on the new terminal N; optional `cmd.center(..., animate=animate)`.
- **Forward (grow off C)** `editor.py:223-281`: mirror image, `resi = resv+1`, `cmd.set_geometry(tmp_editor+" & name N", 3, 3)`, `cmd.fuse("(tmp_editor and name N)", tmp_connect, 2)`, `cmd.h_fix("pk1")`, special amide-H fix for `nhh` (`set_dihedral(O, C, N, H1, 180)`), PHI/PSI, then `cmd.edit` new terminal C or `cmd.unpick()`.
- Always finishes with `cmd.delete("_tmp_editor*")`.

Temp selection names used (`editor.py:15-23`): `_tmp_editor0`, `_tmp_editor_con`, `_tmp_editor_dom`, `_tmp_editor1..4`, wildcard `_tmp_editor*`.

Related non-GUI commands in the same module, worth surfacing in the web client as a text/sequence builder: **`fab`** (`editor.py:1062`, `fab ACDEFGH, helix, ss=1`, one-letter codes in `_aa_codes`, `editor.py:294-317`) and **`fnab`** (`editor.py:1100`, `fnab ATGCGATAC, name=myDNA, mode=DNA, form=B, dbl_helix=1`).

### 4d. Nucleic Acid tab → "DNA" sub-tab (`builder.py:1176-1203`)

Single grid row, columns in this exact order:

| col | widget | label | tooltip | action |
|---|---|---|---|---|
| 0 | button | `A` | Deoxyadenosine | `self.attach_nuc_acid("atp","DNA")` |
| 1 | button | `C` | Deoxycytidine | `self.attach_nuc_acid("ctp","DNA")` |
| 2 | button | `T` | Deoxythymidine | `self.attach_nuc_acid("ttp","DNA")` |
| 3 | button | `G` | Deoxyguanosine | `self.attach_nuc_acid("gtp","DNA")` |
| 4 | label | `Form:` | — | starts a new `QButtonGroup` |
| 5 | radio | `A` | — | `self._nuc_acid_prop.dna_form = "A"` |
| 6 | radio | `B` **(checked by default)** | — | `self._nuc_acid_prop.dna_form = "B"` |
| 7 | label | `Helix:` | — | starts a second `QButtonGroup` |
| 8 | radio | `Single` | — | `self._nuc_acid_prop.dna_dbl_helix = False` |
| 9 | radio | `Double` **(checked by default)** | — | `self._nuc_acid_prop.dna_dbl_helix = True` |

Encoding convention in the source table: `@` prefix → label + open a new radio group; `#` prefix → radio button; otherwise → push button. Radios connect on `toggled`, so the handler fires for *both* the deselected and selected member — the web version should use `onChange` on the selected value only.

### 4e. Nucleic Acid tab → "RNA" sub-tab (`builder.py:1206-1224`)

| col | label | tooltip | action |
|---|---|---|---|
| 0 | `A` | Adenosine | `self.attach_nuc_acid("atp","RNA")` |
| 1 | `C` | Cytosine | `self.attach_nuc_acid("ctp","RNA")` |
| 2 | `U` | Uracil | `self.attach_nuc_acid("utp","RNA")` |
| 3 | `G` | Guanine | `self.attach_nuc_acid("gtp","RNA")` |
| 4 | rich-text label with `setOpenExternalLinks(True)` | — | `Hint: Also check out <a href="http://x3dna.org/articles/3dna-fiber-models">fiber</a> and its <a href="http://x3dna.org/articles/pymol-wrapper-to-3dna-fiber-models">PyMOL wrapper</a>` |

The RNA sub-tab has **no** Form/Helix radios; `attach_nuc_acid` forces `form='A'` and `dbl_helix=False` for RNA (`editor.py:803-805`).

### 4f. `_BuilderPanel.attach_nuc_acid` (`builder.py:1381-1402`)

```python
self._nuc_type = nuc_type
picked = collectPicked(cmd)
if len(picked) == 1:
    with undocontext(cmd, "byobject %s" % picked[0]):
        editor.attach_nuc_acid(picked[0], nuc_acid,
                               nuc_type=self._nuc_type, object="",
                               form=self._nuc_acid_prop.dna_form,
                               dbl_helix=self._nuc_acid_prop.dna_dbl_helix,
                               _self=cmd)
    # pymol.CmdException and ValueError are caught and printed
    self.doZoom()
else:
    cmd.unpick()
    NucleicAcidWizard(_self=cmd)._init(form=..., dbl_helix=..., nuc_type=...).toggle(nuc_acid)
```

`editor.attach_nuc_acid` (`editor.py:789-854`) — the single most complex backend routine in this area:
- Fragment naming: `nascent.fragment_name = nuc_acid + form` (e.g. `atpB`); double-helix fragment name is `nuc_acid + "_" + _base_pair["DNA"][nuc_acid] + form` (e.g. `atp_ttpB`). Base-pair tables at `editor.py:412-416`.
- **New object** (`count_atoms(selection)==0`): `cmd.fragment(frag_string, object)` for the duplex, or `cmd.fragment(fragment_name, object, origin=0)` + `cmd.alter(object, "segi='A';chain='A';resv=1")` + `rename_three_to_one` for single strand; RNA additionally calls `add2pO`; then `cmd.edit(f"{object} & segi A & name P" or "... name O3'")`, `cmd.select("pk1", f"{object} & name O3' & chain A")`.
- **Extend** (`cmd.select(tmp_connect, selection)==1`): reads `chain,name,model` via `iterate_to_list`. If the picked atom is `O5'` → `attach_O5_phosphate()` first. Accepts only `P` or `O3'`, else raises `"invalid connection point: must be one atom, name O3' or P"`.
- Always ends with `cmd.show("cartoon", f"byobject {selection}")` and `cmd.delete("_tmp_editor*")`.
- `extend_nuc_acid` (`editor.py:856-1060`) does: chain→segi normalization via `cmd.alter`, fragment load, resv ±1, `check_valid_attachment` (raises `"P already bonded!"` / `"O3' already bonded!"`), `move_new_res` (cylindrical twist/rise: B-form `twist=-36.0, rise=-3.375`; A-form `twist=-32.7, rise=-2.548`, `editor.py:541-548`; raises `ValueError("Form not recognized")` for anything else), `cmd.fuse(..., mode=3)`, `cmd.bond(...)` via `bond_single_stranded` / `bond_double_stranded`, `cmd.pair_fit` in `fit_sugars` / `fit_DS_fragment`, opposing-chain auto-detection (`get_chains_oppo`, `within 15.0`), base-pair detection (`check_DNA_base_pair`, `within 3.5`), new-chain naming (`get_new_chain`, increments the last chain letter, `Z`→`ZA`, `z`→`za`), bond-distance sanity check (`within 3.0`).
- `attach_O5_phosphate` (`editor.py:612-646`) prints *"This building selection has an unphosphorylated O5' end."*, calls `attach_fragment("pk1","phosphite",4,0)`, then a fixed sequence of `cmd.select`/`cmd.remove`/`cmd.unbond`/`cmd.bond(...,1)`/`cmd.bond(...,2)`/`cmd.alter(P,"name='P'")`/`cmd.select("pk1", P)`.
- `add2pO` (`editor.py:497-506`): for RNA (skipped for `utp`), `cmd.edit(C2')` + `cmd.attach("O",4,4)` + `cmd.alter(... name O01 ..., "name=\"O2'\"")`.

All these print a lot of diagnostic text to stdout (`editor.py:722, 736, 738, 775, 785, 962, 988, 1037, 664, 689, 692`). **The web client must surface the PyMOL feedback stream next to the Builder**, or these become invisible failures.

---

## 5. The three always-visible action rows

Encoding (`builder.py:1267-1298`): `@` prefix → `QLabel`; `$` prefix → `QCheckBox` bound directly to a PyMOL setting (checked = setting truthy); `#` prefix → `QCheckBox` bound **inverted** to a setting (checked = `not value`); otherwise → `QPushButton`.

### Row 1 (`builder.py:1227-1240`)

| widget | label | tooltip | handler | exact cmd sequence |
|---|---|---|---|---|
| label | `Atoms:` | — | — | — |
| button | `Fix H` | Fix hydrogens on picked atoms | `fixH` (`builder.py:1481`) | picked → `cmd.h_fill()`, `cmd.unpick()`; else `HydrogenWizard.toggle('fix')` |
| button | `Add H` | Add hydrogens to entire molecule | `addH` (`builder.py:1489`) | picked → `cmd.h_add("pkmol")`, `cmd.unpick()`; else `HydrogenWizard.toggle('add')` |
| button | `Invert` | Invert stereochemistry around pk1 (pk2 and pk3 will remain fixed) | `invert` (`builder.py:1497`, wrapped in `PopupOnException.decorator`) | `picked == ["pk1","pk2","pk3"]` → `cmd.invert()`, `cmd.unpick()`; else `cmd.unpick()` + `InvertWizard.toggle()` |
| button | `Delete` | Remove atoms | `removeAtom` (`builder.py:1507`) | see below |
| button | `Clear` | Delete everything | `clear` (`builder.py:1527`) | `QMessageBox.question(None,"Confirm","Really delete everything?",Yes\|No)`; on Yes → `cmd.delete("all")`, `cmd.refresh_wizard()` |
| label | `   Charge:` | — | — | — |
| button | ` +1 ` | Positive Charge | `setCharge(1,"+1")` | see below |
| button | `  0 ` | Neutral Charge | `setCharge(0,"neutral")` | see below |
| button | ` -1 ` | Negative Charge | `setCharge(-1,"-1")` | see below |
| label | `  Residue:` | — | — | — |
| button | `Remove` | Remove residue | `removeResn` (`builder.py:1404`) | `picked == ["pk1"]` → `cmd.select("_builder_added","byres(pk1)")`, `cmd.remove("_builder_added")`; else prints *"Select a single atom on the residue and press remove again"* |

`removeAtom` (`builder.py:1507-1522`) exact sequence when something is picked:
```python
if cmd.count_atoms("?pkbond"):
    cmd.edit("(pk1)", "(pk2)", pkbond=0)
cnt = cmd.select("_builder_active",
                 "(((?pkset or ?pk1) and not hydro) extend 1) and not hydro")
with undocontext(cmd, "(?pkset ?pk1) extend 1"):
    cmd.remove_picked()
    if cnt:
        cmd.fix_chemistry("_builder_active")
        cmd.h_add("_builder_active")
cmd.delete("_builder_active"); cmd.unpick()
# else: RemoveWizard(cmd).toggle()
```

`setCharge(charge, text)` (`builder.py:1433-1443`):
```python
if collectPicked(cmd):
    sele = "?pk1 ?pk2 ?pk3 ?pk4"
    with undocontext(cmd, sele):
        cmd.alter(sele, "formal_charge=%s" % charge)
        cmd.h_fill()
        cmd.label(sele, '"%+d" % formal_charge if formal_charge else ""')
    cmd.unpick()
else:
    ChargeWizard(cmd).toggle(charge, text)
```

### Row 2 (`builder.py:1241-1255`)

| widget | label | tooltip | handler | exact cmd sequence |
|---|---|---|---|---|
| label | `Bonds:` | — | — | — |
| button | `Create` | Create bond between pk1 and pk2 | `createBond` (`builder.py:1445`) | `BondWizard.staticaction(cmd)`; if it returns False → `BondWizard(cmd).toggle()` |
| button | `Delete` | Delete bond between pk1 and pk2 | `deleteBond` (`builder.py:1449`) | `picked == ["pk1","pk2"]` → `cmd.unbond("pk1","pk2")` + `cmd.h_fill()` + `cmd.unpick()`; else `cmd.unpick()` + `UnbondWizard(cmd).toggle()` |
| button | `Cycle` | Cycle bond valence | `cycleBond` (`builder.py:1460`) | `picked == ["pk1","pk2"]` → `cmd.cycle_valence()` + `cmd.unpick()`; else `ValenceWizard.toggle(-1,"Cycle bond")` |
| button | `  \|  ` | Create single bond | `setOrder("1","single")` | see below |
| button | ` \|\| ` | Create double bond | `setOrder("2","double")` | see below |
| button | ` \|\|\| ` | Create triple bond | `setOrder("3","triple")` | see below |
| button | `Arom` | Create aromatic bond | `setOrder("4","aromatic")` | see below |
| label | `   Model:` | — | — | — |
| button | `Clean` | Cleanup structure | `clean` (`builder.py:1541`) | picked → `cmd.select("_builder_active","pkmol")`, `cmd.unpick()`; then always `CleanWizard(cmd).toggle()` |
| button | `Sculpt` | Molecular sculpting | `sculpt` (`builder.py:1535`) | picked → `cmd.select("_builder_active", " or ".join(picked))`; then always `SculptWizard(cmd).toggle()` |
| button | `Fix` | Fix atom positions | `fix` (`builder.py:1554`) | picked → `cmd.select("_builder_active","pk1")` + `cmd.deselect()`; else `cmd.delete("_builder_active")`; then `FixAtomWizard(cmd).toggle(3)` |
| button | `Rest` | Restrain atom positions | `rest` (`builder.py:1563`) | picked → `cmd.select("_builder_active","byobj (" + " or ".join(picked) + ")")` + `cmd.deselect()`; else `cmd.delete("_builder_active")`; then `RestAtomWizard(cmd).toggle(2)` |

`setOrder(order, text)` (`builder.py:1469-1479`, decorated `@undoablemethod("(?pk1 ?pk2) extend 1")`):
```python
if picked == ["pk1","pk2"]:
    cmd.unbond("pk1","pk2"); cmd.bond("pk1","pk2", order); cmd.h_fill(); cmd.unpick()
else:
    cmd.unpick(); ValenceWizard(_self=cmd).toggle(order, text)
```
Order strings map through `editing.py:598 order_dict`: `'0'..'4'`, `'aromatic'=4`, `'guess'=-1`, `'copy'=-2`.

### Row 3 (`builder.py:1256-1264`)

| widget | label | tooltip | binding |
|---|---|---|---|
| checkbox | `El-stat` | Electrostatics term for 'Clean' action | setting `clean_electro_mode` (`SettingInfo.h:715`, int, global, default 1). Checked ↔ truthy. On toggle: `cmd.set("clean_electro_mode", checked, quiet=0)` |
| label | `   ` | — | spacer |
| checkbox | `Bumps` | Show VDW contacts during sculpting | setting `sculpt_vdw_vis_mode` (`SettingInfo.h:544`, int, object-state, default 0). On toggle: `cmd.set("sculpt_vdw_vis_mode", checked, quiet=0)` |
| label | `   ` | — | spacer |
| checkbox | `Undo Enabled` | *(no tooltip)* | **inverted** binding to `suspend_undo` (`SettingInfo.h:809`, bool, object-level, default 0). Initial `setChecked(not value)`; handler is `setUndoEnabled` |
| button | `Undo` | Undo last change | `cmd.undo()` (`builder.py:1548`) |
| button | `Redo` | Redo last change | `cmd.redo()` (`builder.py:1551`) |

`setUndoEnabled(checked)` (`builder.py:1300-1321`):
```python
cmd.set('suspend_undo', not checked, quiet=0)
if not checked: return
on_per_object = {o for o in cmd.get_object_list()
                 if cmd.get_setting_int('suspend_undo', o)}
# if >20, truncate to first 15 sorted + "[N more]"
# QMessageBox.question("Enable for objects?",
#   'Building "Undo" is disabled for the following objects:\n\n<list>\n\n'
#   'Enable "Undo" for these objects?', Yes|No)
# on Yes: for each -> cmd.unset('suspend_undo', oname)
```
Note the truncation bug: the truncated list including the literal `"[N more]"` pseudo-name is what gets passed to `cmd.unset` — reproduce carefully or fix (fixing is safer; document the divergence).

---

## 6. The wizard layer (13 classes)

### 6.0 Base machinery

- `ActionWizard` (`builder.py:39-86`)
  - `actionHash` defaults to `str(self.__class__)`; `setActionHash(h)` lets a wizard be identified by its arguments.
  - `activateOrDismiss()` (`builder.py:48-60`): if the current wizard is the same class **and** same hash → `actionWizardDone()` (deactivate, toggle-off); else `cmd.set_wizard(self, replace=1)` + `cmd.refresh_wizard()`. **This is the toggle semantics every Builder button has: clicking the same button twice cancels it.**
  - `actionWizardDone()`: `cmd.delete("_builder_active")`, `cmd.unpick()`, `cmd.set_wizard()`, `cmd.refresh_wizard()`.
  - `activeSeleValid()` (`builder.py:68-86`): revalidates `_builder_active` — deletes it if it spans ≠1 object or the object is not enabled; if `pk1` exists → `cmd.select("_builder_active","byobj pk1")`; else if exactly one object is enabled → select it.
- `RepeatableActionWizard` (`builder.py:228-263`): adds `repeating` flag, `repeat()`, `getRepeating()`, `activateRepeatOrDismiss()` (first click arms + **always sets repeating=1** — see `builder.py:255 "always repeating for now..."`), `cleanup()` → `cmd.unpick()`.
- Panel format from `Wizard.get_panel()` (`packages/engine/modules/pymol/wizard/__init__.py:50`): a list of `[type, text, command]`; `type==1` is a title row, `type==2` is a clickable button whose `command` is a **PyMOL command string** evaluated by the engine. Prompt from `get_prompt()` is a list of strings drawn in the viewport.
- Event mask default is `event_mask_pick + event_mask_select` (`wizard/__init__.py:56`).

**Web plan for the whole wizard layer:** the bridge must emit `{prompt: string[], panel: [type, text, command][]}` on every `refresh_wizard`, and expose `wizard_panel_click(command)` which does `cmd.do(command)`. Render as a floating overlay anchored to the viewport (PyMOL draws it top-left inside the GL canvas) — this is the faithful clone. Also expose `cmd.set_wizard()` as the universal "Done".

### 6.1 `CleanWizard` (`builder.py:89-131`)

- `toggle()` → `activateOrDismiss()`; if `activeSeleValid()` → `run_job()`.
- `run_job()`: if `_builder_active` names exactly one object → `cmd.unpick()`, `cmd.set_wizard()`, `cmd.refresh_wizard()`, `cmd.do("_ cmd.clean('_builder_active', message='''Cleaning <obj>...''', async_=1)")`.
- `do_pick(bondFlag)`: normalize `_builder_active` to `byobj pk1`, `cmd.unpick()`, `cmd.deselect()`, then `run_job()`; prints *"Error: can only clean one object at a time"* if >1 object.
- Prompt: `["Pick object to clean..."]`. Panel: `[1,'Clean',''] , [2,'Done','cmd.set_wizard()']`.
- ⚠ **`cmd.clean` raises `pymol.IncentiveOnlyException` in this tree (`packages/engine/modules/pymol/computing.py:20-29`).** The Clean button is dead in open-source PyMOL. Web client must either hide it, or surface the exception cleanly, or the team must supply an MMFF94 minimizer.

### 6.2 `SculptWizard` (`builder.py:134-225`)

- `toggle()` → `activateOrDismiss()` + `activeSeleValid()` → `sculpt_activate()`.
- `sculpt_activate()` (`builder.py:140-155`): requires exactly one object in `_builder_active`; then
  `cmd.push_undo(obj)`, `cmd.sculpt_activate(obj)`, `cmd.set("sculpting", 1)`, `cmd.sculpt_activate(obj)` *(called twice — redundant)*, and if `cmd.get("sculpt_vdw_vis_mode")` is truthy → `cmd.show("cgo", obj)`; then `cmd.unpick()`, `cmd.refresh_wizard()`. Error: *"cannot sculpt more than one object at a time"*.
- `sculpt_deactivate()` (`builder.py:157-165`): `cmd.set("sculpt_vdw_vis_mode","0",obj)`, `cmd.sculpt_iterate(obj, cmd.get_state(), 0)`, `cmd.unset("sculpt_vdw_vis_mode",obj)`, `cmd.sculpt_deactivate(obj)`, `refresh_wizard`.
- `do_pick`: if not yet sculpting → `cmd.select("_builder_active","byobj pk1")` + activate; else `return 0` (fall through to normal editing drag).
- `finish_sculpting()`: deactivate, `cmd.set("sculpting", 0)`, `cmd.delete("_builder_active")`, `cmd.set_wizard()`, `cmd.refresh_wizard()`.
- `scramble(mode)` (`builder.py:193-210`): selects `<obj> and not (fixed or restrained)` for mode 0, `<obj> and not (fixed)` for mode 1; computes `radius = 1.25 * cpv.length(cpv.sub(extent[0], extent[1]))` from `cmd.get_extent`, center from `cmd.get_position`, then
  `cmd.alter_state(cmd.get_state(), sel, "(x,y,z)=rsp(pos,rds)", space={'rsp': cpv.random_displacement, 'pos': center, 'rds': radius})`, then deletes `_scramble_tmp`.
- Prompt: `["Pick object to sculpt..."]` / `["Sculpting <obj>..."]`.
- Panel: `Sculpt` (title); `Undo` → `cmd.undo()`; `Switch Object` → `cmd.get_wizard().sculpt_deactivate()`; `Scramble Unrestrained Coords.` → `scramble(0)`; `Scramble Unfixed Coords.` → `scramble(1)`; `Done` → `finish_sculpting()`.
- `cleanup()` → `sculpt_deactivate()`.
- Relevant settings: `sculpting` (`SettingInfo.h:246`), `sculpt_field_mask` (`:259`, default `0x1FF`), `sculpt_vdw_vis_mode` (`:544`), `sculpt_max_scale/weight/min/max` (`:597-600`). Sculpting runs as a per-frame iteration in the engine — the web bridge must stream coordinate updates while it is active.

### 6.3 `ReplaceWizard` (`builder.py:266-299`)

- `toggle(symbol, geometry, valence, text)` sets `actionHash = (symbol, geometry, valence, text)` → `activateRepeatOrDismiss()`.
- `do_pick`: `cmd.select("_builder_active","bymol pk1")`, `cmd.replace(symbol, geometry, valence)`, then `actionWizardDone()` if not repeating.
- Prompt: `"Pick atoms to replace with <text>..."` / `"Pick atom to replace with <text>..."`.
- Panel (repeating): `Replacing Multiple Atoms`, `Done`. (non-repeating): `Replacing an Atom`, `Replace Multiple Atoms` → `repeat()`, `Done`.

### 6.4 `AttachWizard` (`builder.py:302-365`)

- `toggle(fragment, position, geometry, text)`, hash `(fragment, position, geometry, text)`.
- `mode 0` (`do_pick`): `cmd.select("_builder_active","bymol pk1")` + `editor.attach_fragment("pk1", fragment, position, geometry)`.
- `mode 1` (`do_pick`): `editor.combine_fragment("pk1", fragment, position, geometry)` (`editor.py:88-96` → `cmd.fragment(f, "_tmp_editor0")`, optional `cmd.remove("(hydro and ?_tmp_editor0)")`, `cmd.fuse("?_tmp_editor0","(pk1)",3)`, `cmd.delete`), then mode resets to 0.
- Always `cmd.unpick()` after.
- `create_new()` (`builder.py:330-335`): `cmd.unpick()`, `name = cmd.get_unused_name("obj")`, `cmd.fragment(self.fragment, name)`.
- `combine()` sets mode 1.
- Prompts: `"Pick location(s) to attach <text>..."` / `"Pick object to combine <text> into..."`.
- Panel (repeating): `Attaching Multiple Fragments`, `Create As New Object`, `Combine w/ Existing Object`, `Done`. (non-repeating): `Attaching One Fragment`, `Create As New Object`, `Combine w/ Existing Object`, `Attach Multiple Fragments`, `Done`.

### 6.5 `BioPolymerWizard` (`builder.py:368-471`) — base for amino acid + nucleic acid

- Class attr `HIGHLIGHT_SELE` (empty in the base).
- `highlight_attachment_points(show=True)` (`builder.py:389-397`): `cmd.show('spheres', HIGHLIGHT_SELE)` / `cmd.hide('spheres', HIGHLIGHT_SELE)`, only when `self._highlighting_enabled`.
- `toggle(monomer)` (`builder.py:425-434`): hash `(monomer,)`; on activation, `_highlighting_enabled = HIGHLIGHT_SELE and cmd.count_atoms('(rep spheres) & (<HIGHLIGHT_SELE>)') == 0` — i.e. only auto-highlight when no spheres are already shown; then show highlights.
- Context manager `__enter__/__exit__` temporarily hides the highlight spheres during the attach.
- `do_pick` mode 0: `cmd.select("_builder_active","bymol ?pk1")` then `with undocontext(cmd,"bymol ?pk1"): self.attach_monomer()`, catching `pymol.CmdException` and printing it.
- `do_pick` mode 1: `cmd.select("_builder_active","bymol ?pk1")` then `editor.combine_monomer()`.
- `create_new()` (`builder.py:436-443`): `cmd.unpick()`, `name = cmd.get_unused_name("obj")`, `self.attach_monomer(name)`.
- Prompts: `"Pick location(s) to attach <monomer>..."` / `"Pick object to combine <monomer> into..."`.
- Panel (repeating): `Attaching Multiple Residues`, `Create As New Object`, `Done`. (non-repeating): `Attaching Amino Acid` *(hard-coded string, wrong for nucleic acids)*, `Create As New Object`, `Attach Multiple...`, `Done`.

### 6.6 `AminoAcidWizard` (`builder.py:473-492`)

- `HIGHLIGHT_SELE = "(name N &! neighbor name C) | (name C &! neighbor name N)"` — free N/C termini.
- `attach_monomer(objectname="")` → `editor.attach_amino_acid("?pk1", monomer, object=objectname, ss=self._secondary_structure)`.
- `setSecondaryStructure(ss)` is called live by the SS combo (`builder.py:1376-1379`).
- `combine_monomer()` → `editor.combine_fragment("pk1", monomer, 0, 1)`.

### 6.7 `NucleicAcidWizard` (`builder.py:494-512`)

- `HIGHLIGHT_SELE = "(name O3' &! neighbor name P) | (name P &! neighbor name O3') | (name O5' &! neighbor name P) "` — free 3'/5' ends.
- `_init(form, dbl_helix, nuc_type)` is a fluent initializer called right before `toggle()`.
- `attach_monomer(objectname="")` → `editor.attach_nuc_acid("?pk1", monomer, object=objectname, nuc_type=..., form=..., dbl_helix=...)`.
- `combine_monomer()` → `editor.combine_nucleotide("pk1", monomer + form, 0, 1)`.

### 6.8 `ValenceWizard` (`builder.py:514-563`)

- `toggle(order, text)`, hash `(order, text)`. On activation it forces bond-picking mouse mode: `cmd.button('double_left','none','PkBd')` and `cmd.button('single_left','none','PkBd')`.
- `do_pick(bondFlag)` (decorated `@undoablemethod("(?pk1 ?pk2) extend 1")`): `cmd.select("_builder_active","bymol pk1")`; if `bondFlag` → `cmd.valence(order,"pk1","pk2")` + `cmd.h_fill()` when `int(order) >= 0`, else `cmd.cycle_valence()`; if `not bondFlag` → re-arm `PkBd` on double_left and single_left. Then `cmd.unpick()`.
- `cleanup()` restores `cmd.button('single_left','none','PkAt')` and `cmd.button('double_left','none','MovA')`.
- Prompt: `"Pick bond(s) to set as <text>..."`. Panel: `Set a Bond Valence` / `Setting Multiple Valences`, `Set Multiple Valences`, `Done`.

### 6.9 `ChargeWizard` (`builder.py:566-604`)

- `toggle(charge, text)`, hash `(charge, text)`.
- `do_pick` (`@undoablemethod("bymol ?pk1")`): `cmd.select("_builder_active","bymol pk1")`, `cmd.alter("pk1","formal_charge=<charge>")`, `cmd.h_fill()`; then `cmd.label("pk1","'''<text>'''")` if `abs(float(charge)) > 0.0001` else `cmd.label("pk1")` (clears); `cmd.unpick()`.
- Prompt: `"Pick atom(s) to set charge = <text>..."`. Panel: `Setting Atom Charge` / `Setting Multiple Charges`, `Modify Multiple Atoms`, `Done`.

### 6.10 `InvertWizard` (`builder.py:607-643`)

- `do_pick` (`@PopupOnException.decorator`): `cmd.select("_builder_active","bymol pk1")`; only when `collectPicked() == ["pk1","pk2","pk3"]` → `cmd.invert()` + `cmd.unpick()`; always `cmd.refresh_wizard()`.
- Prompt is a 3-state progress indicator: no pk1 → `"Pick origin atom for inversion..."`; pk1 only → `"Pick the first stationary atom..."`; pk1+pk2 → `"Pick the second stationary atom..."`.
- Panel: `Inverting Stereocenter` / `Inverting Multiple`, `Invert Multiple`, `Done`.
- Backend errors from `EditorInvert` (`packages/engine/layer3/Editor.cpp:634-638`): *"Must pick atom to invert as pk1"*, *"Must pick immobile atom in pk2"*, *"Must pick immobile atom in pk3"*.

### 6.11 `BondWizard` (`builder.py:646-697`)

`staticaction(cmd)` (`builder.py:648-669`) is shared with the `Create` button:
```python
picked = collectPicked(cmd)
if picked != ["pk1","pk2"]: return False
cmd.select("_builder_active", "bymol ?pk1")
if (cmd.count_atoms("?pk1&hydro") and cmd.count_atoms("?pk2&hydro") and
    cmd.count_atoms("(?pk1 extend 1)&!hydro") and cmd.count_atoms("(?pk2 extend 1)&!hydro")):
    cmd.select("pk1", "(pk1 extend 1) and not hydro")   # two H picked -> use heavy neighbors
    cmd.select("pk2", "(pk2 extend 1) and not hydro")
with undocontext(cmd, "(?pk1 ?pk2) extend 1"):
    cmd.bond("pk1", "pk2"); cmd.h_fill()
cmd.unpick(); return True
```
Prompt: `"Pick first atom for bond..."` / `"Pick second atom for bond..."`. Panel: `Creating Bond` / `Creating Multiple Bonds`, `Create Multiple Bonds`, `Done`.

### 6.12 `UnbondWizard` (`builder.py:700-740`)

- `toggle()` forces `cmd.button('single_left','none','PkBd')`; `cleanup()` restores `PkAt`.
- `do_pick` (`@undoablemethod("(?pk1 ?pk2) extend 1")`): `cmd.select("_builder_active","bymol pk1")`; if `bondFlag` → `cmd.unbond("pk1","pk2")` + `cmd.h_fill()` + `cmd.unpick()`; else re-arm `PkBd` + `cmd.unpick()`.
- Prompt: `"Pick bond(s) to delete..."`. Panel: `Deleting a Bond` / `Deleting Multiple Bonds`, `Delete Multiple Bonds`, `Done`.

### 6.13 `HydrogenWizard` (`builder.py:743-805`)

- `toggle(mode)` with `mode ∈ {'fix','add'}`, hash `(mode,)`. `'add'` uses `activateOrDismiss` + `activeSeleValid` + immediate `run_add()`; `'fix'` uses `activateRepeatOrDismiss`.
- `run_add()`: `cmd.h_add("_builder_active")` then `cmd.delete("_builder_active")`.
- `do_pick`: `cmd.select("_builder_active","bymol pk1")`; `'fix'` → `cmd.h_fill()` + `cmd.unpick()`; `'add'` → `cmd.unpick()` + `run_add()`.
- Prompts: fix repeating → `"Pick atom upon which to fix hydrogens..."`; fix single → `"Pick atoms upon which to fix hydrogens..."` *(the singular/plural strings are swapped in the source, `builder.py:774-777`)*; add → `"Pick molecule upon which to add hydrogens..."`.
- Panels: `Fixing Hydrogens` / `Adding Hydrogens` titles, plus `Fix Multiple Atoms` / `Add To Multiple...` when not repeating, plus `Done`.

### 6.14 `AtomFlagWizard` + `FixAtomWizard` + `RestAtomWizard` (`builder.py:844-987`)

Two subclasses (`FixAtomWizard`, `RestAtomWizard`) exist only to give distinct `actionHash` values; both bodies are `pass`. Flag numbers from `editing.py:2848-2861 flag_dict`: `restrain=2`, `fix=3` (also `focus=0, free=1, exclude=4, study=5, exfoliate=24, ignore=25, no_smooth=26`).

| method | exact cmd calls |
|---|---|
| `toggle(flag)` (`:884`) | sets `self.flag`; `activateOrDismiss()`; if `activeSeleValid()` → `update_display()` else `cmd.deselect()`; then `cmd.unpick()` |
| `update_display()` (`:846`) | `cmd.select("_build_display", "_builder_active and flag <N>")` + `cmd.enable("_build_display")`, else `cmd.delete("_build_display")`; then `cmd.refresh_wizard()` |
| `do_pick` (`:855`) | toggles the flag on `pk1` via `cmd.flag(N,"pk1","clear"/"set")` depending on `cmd.count_atoms("pk1 and flag N")`; `cmd.select("_builder_active","byobj pk1")`; `cmd.unpick()`; `update_display()` |
| `do_select(name)` (`:865`) | when `name == "_build_display"`: `cmd.flag(N, "_builder_active and _build_display","set")` and `cmd.flag(N,"_builder_active and not _build_display","clear")` — i.e. **editing the `_build_display` named selection in the object panel edits the flag set** |
| `do_all()` | `cmd.flag(N, "_builder_active", "set")` |
| `do_cas(1)` | `cmd.flag(N, active,"clear")` then `cmd.flag(N, active + " and polymer and name ca","set")` |
| `do_cas(0)` | `cmd.flag(N, active + " and flag N and polymer and name ca","set")` then `cmd.flag(N, active + " and not (polymer and name ca)","clear")` |
| `do_more(0)` | `cmd.flag(N, active + " and (flag N extend 1)","set")` |
| `do_more(1)` | `cmd.flag(N, "byres (" + active + " and (byres flag N) extend 1)","set")` |
| `do_more(2)` | `cmd.flag(N, "byres (" + active + " and flag N )","set")` |
| `do_less(0)` | `cmd.flag(N, "(( byobj " + active + " ) and not flag N) extend 1","clear")` |
| `do_less(1)` | `cmd.flag(N, "byres ((( byobj " + active + " ) and not flag N) extend 1)","clear")` |
| `do_none()` | `cmd.flag(N, active, "clear")` |
| `do_store()` | `cmd.reference("store", active)` |
| `do_recall()` | `cmd.reference("recall", active)` |
| `do_swap()` | `cmd.reference("swap", active)` |
| `get_prompt()` | if no active sele → `["Pick object to operate on..."]`; else calls `cmd.reference("validate", active)` (`# overbroad`) and returns `["Toggle restrained atoms..."]` (flag 2) / `["Toggle fixed atoms..."]` (flag 3) / `["Toggle unknown atom flag..."]` |
| `cleanup()` | `cmd.delete("_build_display")` |

Panel (`builder.py:950-975`), title `"Restrained Atoms"` (flag 2) or `"Fixed Atoms"` (flag 3), in order:
`All`, `All C-alphas`, `More (byres)`, `More`, `Byresidue`, `Less`, `Less (by residue)`, `Only C-alphas`, `None`, **[flag 2 only:** `Store Reference Coords.`, `Recall Reference Coords.`, `Swap Reference Coords.`**]**, `Done`.

`cmd.reference` actions (`editing.py:77-84`): `store=1, recall=2, validate=3, swap=4`.

Note: the local `verb` dict (`builder.py:953`, `{2:"Restrain", 3:"Fix"}`) is computed and never used — dead code.

---

## 7. The editor state machine (pk1 / pk2 / pk3 / pk4)

### 7a. Reserved selection names (`packages/engine/layer3/Editor.h:30-48`)

| macro | name | meaning |
|---|---|---|
| `cEditorSele1..4` | `pk1`, `pk2`, `pk3`, `pk4` | the picked atoms, in click order |
| `cEditorSet` | `pkset` | union of all picked atoms (built by `SelectorSubdivide`, `packages/engine/layer3/Selector.cpp:4202`) |
| `cEditorBond` | `pkbond` | the two atoms of the picked bond (`Selector.cpp:4323`) |
| `cEditorRes` | `pkresi` | `byres <single picked>` |
| `cEditorChain` | `pkchain` | `bychain <single picked>` |
| `cEditorObject` | `pkobject` | `byobject <single picked>` |
| `cEditorComp` | `pkmol` | the whole connected component being edited |
| `cEditorLink` | `pkfrag` | link atom |
| `cEditorFragPref` | `_pkfrag` | `_pkfrag1.._pkfragN` — the movable fragments |
| `cEditorBasePref` | `_pkbase` | fragment base atoms |
| `cEditorDihedral` | `_pkdihe` (+`_pkdihe1`,`_pkdihe2`) | the auto-dihedral measurement object |
| `cEditorMeasure` | `_auto_measure` | the auto distance/angle/dihedral object |
| `cEditorDrag` | `_drag` | drag selection |

### 7b. Pick assignment order (`EditorGetNextMultiatom`, `packages/engine/layer3/Editor.cpp:498-536`)

Next pick goes to the first free slot in order `pk1 → pk2 → pk3 → pk4`. **Once all four are taken, further picks overwrite `pk4`** (the round-robin variant is commented out). Clicking an already-picked atom in atom-pick mode *unpicks* it (`EditorDeselectIfSelected`, `Editor.cpp:356-392`; message *"You unpicked <atom>."*).

### 7c. Scene click → editor (`packages/engine/layer1/SceneMouse.cpp:404-470`)

- `cButModePickAtom1` (`PkAt1` / "Pk1"): resets the editor and puts the atom in `pk1` only: `EditorInactivate` → `SelectorCreate(pk1, "<obj>`<index+1>")` → `EditorActivate(state, enable_bond=false)` → `EditorDefineExtraPks()` → `WizardDoPick(0, state)`. Logs `cmd.edit("<sele>",pkresi=1)`.
- `cButModePickAtom` (`PkAt`): multi-pick; leaves bond mode if active, unpicks if already picked, otherwise `EditorGetNextMultiatom` → `SelectorCreate(name, ...)` → `EditorActivate(state, false)` → `EditorDefineExtraPks()` → `EditorLogState(false)` → `WizardDoPick(0, state)`. Feedback: *"You clicked <atom> -> (pkN)"*.
- Bond picking (`PkBd`) goes through `SceneClickPickBond` (`SceneMouse.cpp:487+`) and sets `pk1`+`pk2` with `BondMode=true` → wizards receive `do_pick(bondFlag=1)`.
- `ObjectMolecule.cpp:3428` calls `EditorSelect(sele1, sele2, "", "", false, true, true)` for bond picks.

### 7d. `EditorActivate` (`packages/engine/layer3/Editor.cpp:1786-1830`)

Deletes `pkmol pkresi pkchain pkobject pkbond _pkdihe _pkdihe1 _pkdihe2 _auto_measure`, sets `BondMode`, calls `SelectorSubdivide` to compute `NFrag` and the `_pkfragN` selections, hides selections if `auto_hide_selections`, and:
- if `BondMode` and `editor_auto_dihedral` → schedule `EditorDrawDihedral`
- if `!BondMode` and `editor_auto_measure` → `EditorAutoMeasure` (`Editor.cpp:1764-1783`):
  - 2 picks → `ExecutiveDistance("_auto_measure", pk1, pk2, ...)`
  - 3 picks → `ExecutiveAngle("_auto_measure", pk1, pk2, pk3, ...)`
  - 4 picks → `ExecutiveDihedral("_auto_measure", pk1..pk4, ...)`
  - then `ExecutiveColor("_auto_measure", "gray", 0x1, true)`

**The Builder disables this on show** (`cmd.set("editor_auto_measure", 0)`, `builder.py:1338`).

### 7e. `cmd.edit` (`editing.py:1080-1120`)

```
cmd.edit(selection1='', selection2='none', selection3='none', selection4='none',
         pkresi=0, pkbond=1, quiet=1)
```
One selection → picks an atom; two → picks the bond between them (when `pkbond`). `cmd.unpick()` (`editing.py:991`) deletes all `pkN`. Both are the web client's handles for programmatic picking.

Backend errors surfaced from `EditorSelect` / `EditorCycleValence` / `EditorAttach` (`Editor.cpp:851, 878-914, 930-970`): *"Invalid input selection(s)"*, *"Only two picked selections allowed."*, *"Both pk selections must belong to the same molecule."*, *"Invalid bond."*, *"No valid pk2 selection."*, *"No valid pk1 selection."*, *"Only 1 or 2 picked selections allowed."*, *"Can't attach atoms onto discrete objects."*, *"Picked atoms must belong to the same object."*, *"Could not attach atom."*, *"Editor not active"*, *"Invalid pk selection"*.

### 7f. Mouse modes touched by the Builder (`packages/engine/modules/pymol/controlling.py:57-125`)

`cmd.button(button, modifier, action)` action codes used by the Builder: `PkAt`=13 (`controlling.py:71`), `PkBd`=14 (`:72`), `MovA`=28 (`:87`). Buttons touched: `single_left`, `double_left`. `cmd.edit_mode(1)` (`controlling.py:688-717`) switches the current mouse ring entry from `*_viewing` to `*_editing`.

### 7g. Editor-related settings

| setting | id / type / default | source |
|---|---|---|
| `editor_label_fragments` | 321, bool, global, 0 | `SettingInfo.h:410` |
| `editor_auto_dihedral` | 416, bool, global, 1 | `SettingInfo.h:511` |
| `editor_auto_origin` | 439, bool, global, 1 | `SettingInfo.h:539` |
| `editor_bond_cycle_mode` | 633, bool, object, 1 (`>0 -> include aromatic`) | `SettingInfo.h:733` |
| `editor_auto_measure` | 761, bool, global, 1 | `SettingInfo.h:871` |
| `secondary_structure` | 157, int, global, 2, range 1..4 | `SettingInfo.h:242` |
| `auto_remove_hydrogens` | 158, bool, global, 0 | `SettingInfo.h:243` |
| `valence` | 64, bool, bond-level, 1 | `SettingInfo.h:148` |
| `auto_overlay` | 603, int, global, 0 | `SettingInfo.h:703` |
| `clean_electro_mode` | 615, int, global, 1 | `SettingInfo.h:715` |
| `suspend_undo` | 708, bool, object, 0 | `SettingInfo.h:809` |
| `suspend_undo_atom_count` | 709, int, global, 1000 | `SettingInfo.h:810` |
| `sculpting` | 161, bool, object-state, 0 | `SettingInfo.h:246` |
| `sculpt_field_mask` | 174, int, object-state, 0x1FF | `SettingInfo.h:259` |
| `sculpt_vdw_vis_mode` | 444, int, object-state, 0 | `SettingInfo.h:544` |
| `sculpt_max_scale/weight/min/max` | 497-500, float | `SettingInfo.h:597-600` |

---

## 8. Complete `cmd` surface the Builder needs from the bridge

Grouped, all verified in this tree:

- **Picking / editor**: `edit`, `unpick`, `deselect`, `get_editor_scheme`, `torsion`, `drag`
- **Bonds**: `bond`, `unbond`, `valence`, `cycle_valence`, `add_bond`, `rebond`
- **Atoms**: `attach`, `replace`, `remove`, `remove_picked`, `fuse`, `set_geometry`, `fix_chemistry`, `invert`, `sort`, `rename`
- **Hydrogens**: `h_fill`, `h_fix`, `h_add`, `protonate`
- **Flags / restraints**: `flag`, `protect`, `deprotect`, `reference`
- **Undo**: `undo`, `redo`, `push_undo` (partially implemented in open source, `editing.py:531`)
- **Sculpting**: `sculpt_activate`, `sculpt_deactivate`, `sculpt_iterate`, `sculpt_purge`
- **Minimization**: `clean` (**IncentiveOnly — raises**)
- **Attribute editing**: `alter`, `alter_state`, `iterate`, `label`, `set_dihedral`, `translate`, `transform_object`, `get_object_matrix`
- **Objects/selections**: `fragment`, `create`, `select`, `delete`, `get_names`, `get_names("selections")`, `get_object_list`, `get_chains`, `get_unused_name`, `count_atoms`, `index`, `get_coords`, `get_extent`, `get_position`, `get_state`, `enable`, `show`, `hide`, `center`, `zoom`, `pair_fit`
- **Wizards**: `set_wizard`, `get_wizard`, `refresh_wizard`, `wizard`, `get_wizard_stack`, `set_wizard_stack`
- **Settings**: `set`, `unset`, `get`, `get_setting_int`, `get_setting_boolean`
- **Mouse**: `button`, `edit_mode`
- **Command channel**: `cmd.do(...)` — used by `CleanWizard.run_job` and `doAutoPick`, and by every wizard panel button (panel commands are strings).
- **Sequence builders (not in the panel, worth exposing)**: `fab`, `fnab`

---

## 9. Known defects in the source

1. `builder.py:417` calls `editor.combine_monomer()` — **this function does not exist** in `packages/engine/modules/pymol/editor.py` (grep-verified; only wizard *methods* named `combine_monomer` exist at `builder.py:402/491/511`). `BioPolymerWizard.do_pick` mode 1 therefore raises `AttributeError`.
2. `builder.py:512` calls `editor.combine_nucleotide(...)` — **also does not exist** in `editor.py`.
3. `BioPolymerWizard.get_panel` (`builder.py:458-471`) never exposes a `Combine w/ Existing Object` entry, so `combine()`/mode 1 is unreachable from the panel — defects 1&2 are latent.
4. `BioPolymerWizard.get_panel` hard-codes the title `"Attaching Amino Acid"` even for `NucleicAcidWizard` (`builder.py:467`).
5. `HydrogenWizard.get_prompt` swaps singular/plural (`builder.py:774-777`).
6. `setUndoEnabled` (`builder.py:1310-1321`) can pass the literal string `"[N more]"` to `cmd.unset('suspend_undo', oname)` when >20 objects have undo suspended.
7. `_BuilderPanel.attach` uses a bare `except: fin = -1` (`builder.py:1369-1370`) — silent failure, dead variable.
8. `_BuilderPanel.reset()` (`builder.py:1524-1525`) is never wired to any widget — dead code.
9. `self.btn_icons` (inverted ring icons) is populated but never used (`builder.py:1114, 1125`).
10. `AtomFlagWizard.get_panel`'s `verb` dict is unused (`builder.py:953`).
11. `SculptWizard.sculpt_activate` calls `cmd.sculpt_activate(obj_name)` twice (`builder.py:146, 149`).
12. `AtomFlagWizard.do_pick` uses the double negative `if not(active_sele not in ...)` (`builder.py:856`).
13. Tooltip typo `"Chlorrine"` (`builder.py:1082`); `"Napthylene"`/`napthylene` fragment misspelling throughout (`builder.py:1109`, and the on-disk `napthylene.pkl`).
14. `editor.attach_nuc_acid` has an in-source `FIXME` about using `selection` as a name (`editor.py:838-840`), and `extend_nuc_acid` has a `FIXME` about the undocumented `tmp_connect` precondition (`editor.py:867-868`).
15. `packages/engine/data/chempy/fragments/utpA.pkl` does **not** exist (all other `{a,c,g,t,u}tp{A,B}` and duplex fragments do). Only reachable if RNA form B is ever allowed; `attach_nuc_acid` currently forces RNA→form A (`editor.py:803-805`), so it is latent.

---

## 10. Where each surface lives now

- **`<BuilderPanel/>`** — a dockable/floating panel. `Tabs` = Chemical | Protein | Nucleic Acid; the last contains nested `Tabs` DNA | RNA. Below the tabs, three fixed toolbars.
- **Button data lives in one declarative table** mirroring `builder.py:1074-1112`, `1132-1135`, `1176-1210`, `1226-1265`. Each entry: `{label, tooltip, icon?, action: {kind, args}}`. The React layer never contains chemistry logic.
- **`useBuilderStore`** holds only UI state: active tab, SS combo index, DNA form ('A'|'B'), helix (single|double), and mirrored settings (`clean_electro_mode`, `sculpt_vdw_vis_mode`, `suspend_undo`). Settings mirror through the bridge's setting-change event so external `set` commands stay in sync.
- **`usePickedAtoms()`** — subscribes to an editor-state event carrying `{pk1?, pk2?, pk3?, pk4?, bondMode, nFrag}` derived from `EditorAsPyList`/`get_names("selections")`. Every action button branches on this exactly like `collectPicked`.
- **`<WizardOverlay/>`** — renders `get_prompt()` lines + `get_panel()` rows over the WebGL canvas, re-fetched on every `refresh_wizard` event. `type==1` rows are non-interactive headers; `type==2` rows dispatch `cmd.do(command)`.
- **Two confirm dialogs** must be modeled as React modals (they are currently `QMessageBox.question`): *"Really delete everything?"* (`builder.py:1529`) and *"Enable Undo for these objects?"* (`builder.py:1315`).
- **`PopupOnException`** (`pymol/Qt/utils.py`, used at `builder.py:609` and `:1497`) becomes an error-toast wrapper around the two invert paths.
- **Feedback pane** — the builder relies heavily on `print()` diagnostics from `editor.py`; the bridge must forward PyMOL's feedback stream and the panel must show it.

---

## 11. Decisions this map fed

1. **`cmd.clean` stays incentive-only.** It raises `IncentiveOnlyException` in this tree
   (`computing.py:20`), so the bridge lists it in
   `packages/bridge/tenmol_bridge/incentive_only.py` and the client shows the button as
   unavailable rather than failing at click time. No open-source minimiser was substituted behind
   the same signature.
2. **`undocontext` is a no-op in this tree** (`editor.py:38-49`), so most `undoablemethod`-decorated
   actions are not actually undoable; only `cmd.undo`/`cmd.redo` against the C ring buffer work.
   The port keeps parity with open-source rather than inventing a bridge-side undo context.
3. **Sculpting is not streamed on a client timer.** `PyMOL_Idle` calls
   `ExecutiveSculptIterateAll(G)` whenever `ControlIdling(G)` is true
   (`packages/engine/layer5/PyMOL.cpp:2424`, `packages/engine/layer1/Control.cpp:397-403`), and the
   bridge's pump calls `idle()` every tick — so the engine sculpts with no client attached
   (measured: 0.68 A of drift in 2.0 s with no tick, no subscriber and no draw request; 0.0000 A
   after `set sculpting, 0`). Ticking `sculpt_iterate` with cycles on the client ran a second
   minimiser beside the engine's own, so `apps/web/src/features/builder/sculptTicker.ts` defaults
   to `cycles: 0` — a call that returns total strain and provably moves nothing. Moved atoms reach
   the user the same way every other engine-side change does.
4. **The `ss` combo exposes what the Qt combo exposes.** `ss=4` (flat) and raw
   `secondary_structure` values stay out of the panel; they remain reachable from the command line.
5. **`combine_monomer` / `combine_nucleotide` stay dead.** Both would need new backend functions,
   so the panel entries remain absent, as they are in Qt.
