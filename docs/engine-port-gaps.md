# TypeScript engine — coverage & remaining gaps

A map of the gap between the in-browser TypeScript engine (`@tenmol/engine-ts`,
used on `?backend=local`) and real PyMOL. The remote backend (`?backend=remote`)
drives real PyMOL; this document is only about the **client-side TypeScript port**.

Legend: ✅ implemented · 🟡 partial / approximate · ❌ not implemented.

> **Parity wave (2026-08, this session) — supersedes the per-command/per-selector
> lists below.** A KPI-driven push pinned every gap with a red parity suite
> (`packages/engine-ts/test/parity-*.test.ts`) and implemented the bulk of it.
> Now **real** (so the "❌ Not implemented" bullets in §2/§4 and the "fake"/"none"
> notes are historical, not current): structure-based **superposition**
> (`super`/`cealign`/`usalign`/`pair_fit`/`alignto`/`extra_fit`, identity-matched
> `fit`/`rms`/`rms_cur`/`intra_rms`); **selection** extras (`byring`, `bycalpha`,
> `pepseq`, `altloc`, real `fc.`/`pc.` charge comparisons); **measurement objects**
> (`distance`/`angle`/`dihedral` → `object:measurement`, the Dash rep, atom
> labels, `set_name`); **editing** (`edit`/`remove_picked` pk1 picking, `fab`,
> `torsion`, `uniquify`, `group`/`ungroup`); **export** writers (`get_str`
> `mol`/`sdf`/`mol2`, `multisave` HEADER, PyMOL-shaped `get_session`); **maps**
> (`map_new`/`ramp_new`/`isomesh`/`isosurface`/`gradient` registered as executive
> gadgets); **data model** (bond orders, ANISOU + object matrix in `get_model`,
> P 2 symmetry); and **util** (`sum_formal/partial_charges`,
> `protein_assign_charges_and_radii` (Amber-99), `b2vdw`, `ligand_zoom`,
> `interchain_distances`, `get_sasa_relative`). Command coverage rose 375→392/506
> (see `docs/parity-dashboard.md`). Still deferred (pinned `it.fails`): the
> nucleic-acid builders, the valence-chemistry edits (protonate/replace/
> cycle_valence/set_geometry/invert), `combine_fragment`, and byte-exact
> `color_by_area`.

## Status (after waves 1–5)

The port now registers the **entire public `cmd.*` surface** (~346 verbs): every
verb resolves to a handler — a real implementation where the browser allows it,
or a documented, side-effect-free no-op for genuinely environment-bound verbs
(file/network I/O, ray-to-disk). `NotPorted` now fires **only for unknown
symbols**. **15 of 21 representations render client-side**: lines, sticks,
spheres, nonbonded, nb_spheres, **cartoon, ribbon, surface, mesh, dots, dashes,
extent, cell, ellipsoids** (ANISOU with a B-factor fallback), and **labels**
(a camera-projected DOM text overlay in the viewport).

The remaining 6 rep slots are specialised or inapplicable, not core structure:
- **angles / dihedrals** — effectively drawn already: the `distance`/`angle`/
  `dihedral` commands create measurement objects rendered as dashes.
- **callback** — Python draw callbacks; **not applicable** to a JS engine.
- **cgo** — user-drawn CGO; no CGO-creation command is in the ported scope.
- **volume / slice** — volumetric electron-density rendering, a separate WebGL2
  3-D-texture raymarching subsystem (the protocol excludes volume from geometry
  frames; the map grid data exists via `get_volume_field`, but the renderer and
  its data channel are a distinct graphics workstream).

**Approximate / simplified (work, but not byte-parity — none are gated):**
- **surface/mesh** — solvent-*accessible* surface (probe not rolled), not the
  solvent-*excluded* surface; marching cubes at a fixed grid spacing.
- **dss** — φ/ψ heuristic, not PyMOL's H-bond assignment.
- **align/super** — LCS residue pairing + Kabsch, not the full DP sequence aligner
  (no iterative outlier refinement; raw_score/cycles = 0).
- **sculpt/minimize** — a real steepest-descent MM minimizer with illustrative
  force constants, not PyMOL's exact `sculpt_*` field.
- **maps/isosurfaces** — gaussian/vdw density + marching cubes; not experimental
  map formats (MTZ/CCP4 loading is a no-op).
- **symexp** — space-group operators embedded for P1/P21/P212121/C2 (others fall
  back to identity + lattice).
- **h_add**, **get_area** (dot-SASA), **morph**, **ramps** — reasonable ports.

**Genuinely not modelled (documented no-ops):** file `load`/`fetch`/`save`/`png`,
`ray`/`draw` to disk (WebGL already renders on screen), and other FS/OS-bound verbs.

**Not yet rendered visually (data present, no viewport draw):**
- **labels** — the label text/positions are stored, but the viewport has no text
  overlay yet, so `label` shows nothing on screen.
- **cell / ellipsoids / slice / volume / callback / CGO objects** reps.
- Measurement **dash** styling is a solid line (no gap pattern) and the value
  label is not drawn (same viewport-text gap as labels).

The per-rep / per-command detail below predates waves 1–5 and is kept for
reference on the harder items still worth deepening (SES surface, label text,
volume rendering, ray tracing).

As of this writing the port implements ~30 of PyMOL's ~424 API commands, 5 of 21
representations, and a subset of the selection language. Everything else is
below. A symbol that isn't implemented rejects with a `PymolError` of type
`NotPorted` (never a silent no-op), so the UI shows exactly what's missing.

### Wave 1 (implemented + gated against real PyMOL)

The following are now implemented and proven 1:1 against a live PyMOL bridge by
the differential suite (`tools/parity`, live diff = zero divergence):

- **Coloring**: `spectrum`, `set_color`, `util.cbag/cbac/cbay/cbas/cbap/cbaw`,
  `util.cbc`, `util.rainbow`; colour-by-element uses PyMOL's element colours
  (`nitrogen`/`oxygen`/… ) so per-atom colour matches exactly.
- **Transforms**: `rotate` and `translate` (OBJECT transforms — they move the
  atoms' coordinates about the origin, camera unchanged, matching PyMOL; `turn`/
  `move` are the camera verbs), `center`, `move`, `clip`.
- **Analysis**: `dss`, `get_chains`, `count_states`, `identify`,
  `iterate`/`iterate_state`/`alter` (JS per-atom expressions).
- **Selection**: `s1 within N of s2` (infix), `around`/`expand`/`near_to`/
  `beyond`, `neighbor`/`bound_to`, `bymol`/`byobject`/`bychain`, `b`/`q` numeric
  comparisons, `ss H/S/L`, `visible`/`enabled`/`present`/`bonded`/`metals`/
  `donor`/`acceptor`, and `/object/segi/chain/resi/name` slash notation.

**Known parity divergences (deliberately NOT gated in the differential):**

- **Default representation after load.** TS shows `lines`; this PyMOL build's
  `auto_show` classifies into `cartoon + sticks + nb_spheres`. Blocked on
  `cartoon` (below). The differential establishes an explicit rep baseline
  rather than depending on the loaded default.
- **`ss` on unassigned atoms.** PyMOL pre-labels some backbone atoms `L`; TS
  leaves `ss` empty until `dss`. `dss` itself is a phi/psi heuristic, not
  PyMOL's full H-bond assignment, so exact SS counts are not gated.
- **`donor`/`acceptor`** selectors are element heuristics that over-count
  vs. PyMOL's chemistry-aware flags.
- **Element-colour RGB precision** beyond N/O/C/H/S (halogens, metals) uses the
  canonical /255 CPK values; only the fixture's elements (N/O/C) are gated.

---

## 1. Representations (rendering) — 5 of 21

Rendered client-side via Mode-G instance/mesh buffers:

| Rep | Status | Notes |
| --- | --- | --- |
| `lines` | ✅ | one line-instance per bond |
| `sticks` | ✅ | split-colour `cylinder2` per bond |
| `spheres` | ✅ | vdw · `sphere_scale` |
| `nonbonded` | ✅ | crosses, unbonded atoms only |
| `nb_spheres` | ✅ | small spheres, unbonded atoms only |
| `cartoon` | ❌ | **the big one** — needs secondary-structure assignment (`dss`) + spline/tube/arrow mesh generation (`RepCartoon`) |
| `ribbon` | ❌ | Cα spline |
| `surface` | ❌ | molecular surface (marching cubes over an SES/SAS grid, `RepSurface`) |
| `mesh` | ❌ | wireframe surface |
| `dots` | ❌ | dot surface |
| `dashes` | ❌ | distance/H-bond dashes |
| `labels` | ❌ | text — needs a DOM/atlas overlay, not geometry |
| `cell` | ❌ | unit-cell box (needs crystal symmetry) |
| `ellipsoids` | ❌ | ADP/anisotropy ellipsoids |
| `angles` / `dihedrals` | ❌ | measurement geometry |
| `cgo` / `callback` | ❌ | user CGO objects / Python-drawn callbacks |
| `slice` / `volume` | ❌ | map/volume rendering |
| `extent` | ❌ | bounding-box wireframe |

Also missing at the render level: per-atom **transparency/alpha**, `cartoon_*`
/ `stick_*` style settings actually affecting geometry, `set_bond`, ambient
occlusion, and **ray tracing** (`cmd.ray`) — there is no CPU ray tracer.

---

## 2. Command API — ~30 of ~424

### ✅ Implemented (real behaviour)
`read_pdbstr`, `fragment` (ala/gly/ser/cys/phe/leu only), `get_names`,
`count_atoms`, `select`, `delete`, `color`, `show`, `hide`, `show_as`,
`get_view`/`set_view`, `turn`, `zoom`, `orient`, `reset`, `set`,
`get_setting[_float/int/boolean/text/tuple]`, `get`, `get_color_index`,
`get_color_tuple`, `bg_color`, `view` (store/recall/clear), `get_model`,
`get_viewport`, `tenmol_objects` (object-panel snapshot).

### 🟡 Stubs (return an empty/default value so panels stay clean, but do nothing)
`get_frame`→1, `count_frames`→0, `count_states`, `get_movie_*`, `get_scene_list`→[],
`get_vis`→{}, `get_type`, `get_object_list`, `get_object_matrix`→identity,
`get_setting_updates`→[], `get_version`, `get_renderer`, `set_title`,
`matrix_reset`, `scene`→null (see the bug in §7), `wizards.catalog`→[], etc.

### ❌ Not implemented — by category
- **Loading / fetching**: `load` (server-path based — the local engine has no
  filesystem; only `read_pdbstr` works), `fetch`, `load_traj`, `read_molstr`,
  `read_mmodstr`, `read_sdfstr`, `read_mol2str`, CIF/mmCIF/MMTF/PDBx, `set_name`,
  `create`, `copy`, `extract`, `split_states`, `join_states`.
- **Saving / exporting**: `save`, `png`, `get_pdbstr` (writer), `get_session`,
  `multisave`, `export_coords`, STL/OBJ/COLLADA/glTF/POV/VRML, `mpng`, movie
  export — **nothing can be exported**.
- **Selections / naming**: `select` exists but `deselect`, `indicate`,
  `get_area`, `get_extent`, `pseq_align`/`align`/`super`/`cealign`/`fit`/`rms*`,
  `pair_fit`, `intra_fit`.
- **Editing / building (Builder)**: the entire `editor.*` namespace —
  `editor.attach_amino_acid`, `attach_fragment`, `replace`, `remove`, `bond`,
  `unbond`, `cycle_valence`, `h_add`/`h_fill`, `fuse`, `sculpt_*`, `clean`,
  `undo`/`redo`, `set_dihedral`/`set_geometry`, `flip`, `invert`.
- **Coloring helpers**: `spectrum`, `util.cbc`/`cbag`/`cbss`/`rainbow`,
  `set_color` (define custom), color ramps, `recolor`.
- **Transform / camera**: `rotate`, `translate`, `move`, `center`, `origin`,
  `set_object_ttt`, `transform_object`, `zoom`/`orient` exist but with a
  simplified bounding-sphere (exact PyMOL clip/dist parity is a follow-up),
  `clip`, `pan`, `dolly`, `roll`, `rock`, camera animation / `mview`.
- **Measurement**: `distance`, `angle`, `dihedral`, `get_distance`,
  `get_angle`, `get_dihedral`, `pseudoatom`.
- **Analysis**: `dss` (secondary structure), `get_chains`, `count_states`,
  `identify`, `index`, `iterate`/`iterate_state`/`alter`/`alter_state` (the
  per-atom Python callbacks — a large surface), `phi_psi`, `get_symmetry`,
  `set_symmetry`, `get_raw_alignment`.
- **Maps / volumes**: `load` of `.ccp4`/`.mtz`/`.map`, `isomesh`, `isosurface`,
  `volume`, `gradient`, `ramp_new`, `map_*`.
- **Symmetry / assemblies**: `symexp`, `set_symmetry`, biological assemblies.
- **Console / scripting**: `do` runs JS (not `run`/`@script`/`spawn`), no
  `alias`, `extend`, `set_key`, `python`/`cmd._parser.complete` (tab
  completion), `feedback`, `log_open`.

---

## 3. Console command language — 13 verbs

The console recognizes these as PyMOL commands: `fragment show hide as color
select delete zoom orient turn set bg_color reset`. **Anything else is evaluated
as JavaScript** (with `cmd` in scope). That means valid PyMOL command lines like
`scene new, store`, `spectrum count`, `distance d, ...`, `dss`, `rotate x, 90`,
`ray`, `png ...`, `label ...` are NOT recognized as commands — they either hit a
`NotPorted` `cmd.*` or (for bare verbs) fail as JavaScript (see §7). Only the JS
form (`cmd.show_as("sticks","all")`) is fully general.

Missing: PyMOL's real parser — argument keywords (`selection=`, `state=`),
`;`-and-`\`-continuation nuances, `@script`, `/`-python is JS here (by design),
tab completion, command aliases, `help`.

---

## 4. Selection language

✅ Implemented: `all`/`none`, property selectors `name/elem/chain/resn/resi
(+ranges)/index/id/segi/alt/color/rep` (with `+` grouping and `n.`/`e.`/… dot
aliases), keyword selectors `hetatm/hydro/polymer/solvent/backbone/sidechain`,
set operators `and`/`or`/`not`/`( )` + implicit-and, `byres`, `within N of`,
`first`, `last`, `*`/`?` wildcards, object-name and named-selection references.

❌ Not implemented:
- **Numeric comparisons**: `b > 50`, `q < 1`, `pc.`/`partial charge`, `formal_charge`.
- **Proximity**: `around`, `expand`, `gap`, `near_to`, `beyond`, `neighbor` /
  `bound_to`, `byring`, `bymolecule`/`bm.`, `byfragment`, `bycalpha`, `bychain`,
  `byobject`.
- **Chemistry/flags**: `donor`, `acceptor`, `metals`, `polymer.protein` /
  `polymer.nucleic`, `guide`, `ss H/S/L` (secondary structure), `flag`,
  `fixed`/`restrained`/`masked`, `bonded`, `present`.
- **State/UI**: `visible`, `enabled`, `pk1`/`pkat`/`pkbond`/`lb`/`rb` (picked),
  `sele`-as-`(sele)`, `origin`, `center`, `visible`.
- **Sequence / ranges**: `pepseq ABC`, `resi 5-10+20`, `?name` optional,
  `%objname`, `/obj//chain/resi/name` **slash notation**, `model X`, altloc
  priorities.

---

## 5. File I/O — essentially none

Only `read_pdbstr` (PDB text → object). Missing: reading any other format (CIF,
mmCIF, MMTF, SDF, MOL2, XYZ, maps, trajectories), `load` from a path, `fetch`
from the PDB, drag-and-drop of real files into the local engine, and **all**
saving/exporting (structures, images, sessions, movies, meshes).

---

## 6. Movies · states · scenes · wizards · builder — none

- **Multiple states**: `read_pdbstr` stores MODEL states, but there is no state
  navigation (`frame`, `set_state`, `mset`, `mplay`, `count_states` is a stub),
  no morphing, no trajectory playback.
- **Movies**: `mset`, `mview`, `mplay`, `mpng`, `movie.produce`, roll/nutate —
  all missing (movie panel shows "not ported").
- **Scenes**: `scene` is a null stub — store/recall/next/rename/clear/`scene_order`
  and thumbnails are not implemented (the Scenes panel shows "no scenes"). Views
  (`cmd.view`) ARE implemented; scenes are not.
- **Wizards**: none — `wizard`, `wizards.*` (measurement, mutagenesis, pair
  fitting, sculpting, density, …). Wizard panel shows "not ported".
- **Builder**: none — the whole `editor.*` fragment-building / sculpting surface
  (see §2). Builder buttons error.

---

## 7. Known bugs / rough edges

- **`scene new, store` fails in the console.** `scene` is a registered `cmd`
  handler but is NOT in the console's `KNOWN_KEYWORDS`, so a typed `scene …` line
  falls through to the JavaScript evaluator and throws `Unexpected token 'new'`.
  Fix: add `scene` (and any other registered verbs meant for the console) to
  `KNOWN_KEYWORDS` with a `runKeyword` case — or, better, implement scenes.
- **Mixed command+JS on one line**: `fragment ala; console.log(x)` runs only the
  command half (the JS clause is skipped) because a line with any known verb
  takes the command path.
- **`zoom`/`orient` framing** is a simplified bounding-sphere, not PyMOL's exact
  `SceneWindowSphere`, so the camera distance/clip can differ from real PyMOL
  (rotation/`set_view`/`turn` are exact; this is gated in the differential suite
  accordingly).
- **Default atom colour** is white, not PyMOL's by-element/auto scheme (the port
  has no `util.cbag` default), so colour parity is only asserted after an
  explicit `color`.
- **Bonding** is a distance heuristic (`connect_cutoff`), not PyMOL's exact
  chemistry-aware `ObjectMoleculeConnect`, so bond sets (and therefore line/stick
  geometry) can differ from real PyMOL for edge cases.

---

## 8. Data model gaps

- No **bond orders** (single/double/aromatic), formal/partial charges,
  secondary-structure records, anisotropy (ANISOU), or per-atom flags.
- No **crystal symmetry** / unit cell / space group.
- No **object matrix / TTT** transforms applied to geometry (`get_object_matrix`
  returns identity).
- No **groups** (object grouping / `group`/`ungroup`), no **discrete** objects,
  no **alignments**, no **maps/meshes/surfaces/CGO/measurement** object types —
  only `object:molecule`.

---

## Priority order (suggested)

1. **Console parity fixes** — wire `scene` + other verbs into the parser (kills
   the "Unexpected token" class of errors), broaden `KNOWN_KEYWORDS`.
2. **`util.cbag`/`spectrum`/`set_color`** and **by-element default colour** —
   biggest visual-correctness win for little code.
3. **`dss` + `cartoon`/`ribbon`** — the representation users most expect for
   proteins.
4. **Selection language**: `byobj`/`bymol`, `around`/`expand`/`neighbor`,
   `b`/`q` comparisons, slash notation.
5. **Transforms**: `rotate`/`translate`/`center`/`origin`, exact `zoom` framing.
6. **`iterate`/`alter`** (per-atom access) — unlocks a large scripting surface.
7. **Surfaces** (`surface`/`mesh`/`dots`) — marching cubes.
8. **States/trajectories → movies → scenes → wizards → builder → maps/volumes**.
9. **File I/O** (more readers) and **export/save**.
10. **Ray tracing** — likely permanently deferred to the remote backend.
