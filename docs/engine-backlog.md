# Engine + renderer backlog — "what's left"

A prioritized, categorized inventory of everything the in-browser TypeScript port
of PyMOL (`@tenmol/engine-ts` + `@tenmol/viewport`) does **not** do yet:
unported commands, missing and degraded rendering, deliberately deferred work,
and performance/architecture levers.

This is the _forward-looking_ companion to two existing docs:

- `docs/engine-port-gaps.md` — narrative of known gaps.
- `docs/feature-parity.md` — parity status.

## How this was produced

Compiled from a 6-way parallel audit of the codebase (Aug 2026): six agents each
swept a different slice — not-ported commands, missing reps, rendering-quality
gaps, in-code TODO/deferral markers, plan/docs deferrals, and
perf/architecture — producing 62 findings that were then deduped and ranked by
user-visible impact. Every claim was verified against the source, not inferred.

## How to read it

- **Effort tags** — `S` small/localized · `M` moderate · `L` large / new subsystem.
- **Ranking** — items are ordered by user-visible impact within each section
  (highest first).
- **Parity metric** — where a percentage is quoted, it is the TS render compared
  pixel-for-pixel (pixelmatch) against a **real-PyMOL reference PNG**. Current mean
  ≈ **92.7%** across 22 scenes (up from 89.4% after the SES surface shift);
  solid/line/cartoon reps sit at 90–99%, surfaces at 84–92%, mesh at 74% (worst).
  See the `packages/e2e` docs page /
  `apps/web/e2e/visual.e2e.mjs`.

### Where recent work landed (context)

**Backlog-closure effort (Waves 0–2, rolling PR).** A KPI-driven push to close this
list is underway; see `docs/parity-dashboard.md` for the live command/rep burndown.
Landed so far — the §1 items they close are marked **✅ ported** inline below:

- **Wave 0** — a committed command/rep coverage scoreboard + ratchet
  (`packages/engine-ts/test/coverage.test.ts`, `pnpm coverage`). Baseline: 271/506
  real command handlers.
- **Wave 1** — the `preset.*` (20/21), `util.*` remainder (+22), `movie.*` (20/20),
  and `gui.*` (7/7) namespaces, plus flat `check` / `fork` / `dist` / help verbs and
  British-spelling colour aliases — composed via a new `ctx.call(...)` seam. Coverage
  rose to **350/506 (69.2%)**.
- **Wave 2** — the console parser now handles `key=value` kwargs, quoted
  commas/`=`, and reports `@script` honestly.

The visual/perf regression suite and three fixes already shipped and set the
baseline the numbers above reflect:

- **F1** — engine memoizes each rep's built frame by a content hash, so `show`/
  `hide` and no-op publishes no longer rebuild unchanged reps.
- **F3** — the 4 Hz idle camera poll no longer forces a full repaint when the
  view is unchanged.
- **F5** — the surface mesh gets 3 Taubin smoothing passes for an SES-like look.
- **F4** (ambient occlusion) and **F2** (viewport pooling) were deliberately
  **not** done — see §4 for why.

---

## 1. Not supported / not ported commands

What a user hits as _"not ported by `@tenmol/engine-ts` yet"_ (a `NotPorted`
throw) — or, worse, a call that silently does nothing. Grouped by namespace.

### `editor.*` namespace — 🟡 residue growth ported (3/23) — L · was the reported bug

`cmd/editor.ts` now ports the headline build path: **`editor.attach_amino_acid`**
(the exact `cmd.editor.attach_amino_acid` that prompted this list), plus
`editor.attach_fragment` and `editor.build_peptide`. It grows a chemically-valid
residue — a trans peptide bond (omega ≈ 180°, C–N ≈ 1.33 Å, ideal backbone
angles, no clashes) by superposing the real chempy fragment geometry
(`model/aa-fragments.json`, all 20 amino acids, extracted by
`scripts/extract-fragments.py`) with a 3-point rigid fit (`model/superpose.ts`).
The low-level topology half of `editor.py` (`add_bond`, `attach`, `h_add`,
`fuse`, `invert`, `protonate`, `replace`, `rebond`, `fix_chemistry`, `sort`)
remains in `cmd/builder.ts`. Idealisation vs PyMOL: phi/psi are not applied (the
residue comes out extended), and native `fuse`/`set_dihedral` are replaced by the
direct rigid-fit construction.

> Still missing: `combine_fragment, fab, fnab, fit_sugars, fit_DS_fragment,
attach_nuc_acid, extend_nuc_acid, attach_O5_phosphate, bond_single_stranded,
bond_double_stranded, add2pO, move_atom_in_res, move_new_res,
rename_three_to_one, iterate_to_list, check_dummy_oriention, check_DNA_base_pair,
check_valid_attachment, get_chains_oppo, get_new_chain`

Files: `cmd/editor.ts`, `model/{aa-fragments,superpose}.ts`,
`scripts/extract-fragments.py`, ref `packages/engine/modules/pymol/editor.py`.

### File readers — ✅ core formats real (Wave 3); export partial — L

`load` is real (`cmd/fileio.ts`): it parses structured **content** for PDB, CIF/
mmCIF, MOL/SDF, MOL2 and XYZ — by an explicit `format` or by sniffing — and
`read_cifstr`/`read_mol2str`/`read_xyzstr` join the existing `read_pdbstr`/
`read_molstr`/`read_sdfstr`. `get_str` now serializes `pdb`/`fasta`/`xyz`.

> Still missing: reading from a **path/URL** or `fetch`-from-PDB (the sync
> browser engine has no filesystem/async network — belongs to the web-app/worker
> layer), MMTF/mmCIF maps + trajectories (`load_traj`, `load_mtz`), and session/
> mesh export (`get_session`, `multisave`, STL/OBJ/glTF/POV). `save` (disk write)
> stays a no-op — the web app downloads the `get_str` output instead.

Files: `cmd/fileio.ts`, `model/{cif,mol2,xyz,bonding}.ts`, ref `docs/engine-port-gaps.md`.

### Large batch of documented no-op verbs (callable, do nothing) — L

Return-placeholder stubs that mislead scripts because they neither throw nor act:

> logging (`log, log_open/close, resume`) · picking (`edit, edit_keys, drag,
release, unpick`) · movie edits (`mcopy, mdelete, mmove, mdo, minsert,
scene_order`) · maps/volumes (`map_set, slice_new, volume, volume_panel,
spheroid, vdw_fit`) · app/render (`cls, cache, callout, capture, quit,
meter_reset, focal_blur, decline, feedback, extend, alias, matrix_copy`) ·
> chemistry/typing (`assign_stereo, text_type, set_geometry, uniquify,
unset_deep, pbc_wrap/unwrap`) · export (`get_mtl_obj, get_povray, povray,
remove_picked`)

Files: `cmd/extras.ts:505`.

### `preset.*` namespace — ✅ ported (Wave 1, 20/21) — M

All one-click representation presets are ported in `cmd/preset.ts`, composing
`show`/`hide`/`color`/`set`/`spectrum`/`util.*` via `ctx.call`. Some steps that
depend on still-unported sub-verbs (`flag`, `set_bond`, the `extend` selector
operator, the `licorice` rep alias) are skipped and will fill in as those land.

> Ported: `simple, simple_no_solv, technical, pretty, pretty_solv, pretty_no_solv,
publication, pub_solv, pub_no_solv, default, ligands, ligand_cartoon,
ligand_sites (+_hq/_trans/_trans_hq/_mesh/_dots), ball_and_stick, b_factor_putty,
interface, classified`

Files: `cmd/preset.ts`, `registrars.ts`, ref `preset.py`.

### `util.*` — ✅ largely ported (Wave 1, 30/45) — M

Beyond the carbon/rainbow colorers in `cmd/coloring.ts` (`cbc, rainbow, cbag,
cbac, cbay, cbas, cbap, cbaw`), `cmd/util2.ts` now ports the coloring, analysis
and labeling helpers: `cnc, color_carbon, cbss, ss, chainbow, cba, cbh, cbab,
cbao, cbak, cbam, color_objs, color_deep, get_area, get_sasa, compute_mass,
find_surface_residues, find_surface_atoms, phipsi, mass_align, label_chains,
label_segments`.

> Still missing (need machinery the port lacks — charges, ESP maps, shader/render
> settings): `protein_vacuum_esp, protein_assign_charges_and_radii, color_by_area,
get_sasa_relative, sum_formal/partial_charges, ray_shadows, b2vdw, ff_copy,
colors, interchain_distances, ligand_zoom, enable_all_shaders,
modernize_rendering, performance`

Files: `cmd/util2.ts`, `cmd/coloring.ts`, ref `util.py`.

### `movie.*` namespace — ✅ ported (Wave 1, 20/20) — M

`cmd/movie3.ts` ports the whole `movie.*` namespace, composing the top-level
`mview`/`mset`/`mplay`/`mdo` verbs. The frame-table / camera-keyframe side effects
are faithful; per-frame motion via `mdo` and file encoding (`produce`, `find_exe`)
are in-engine no-ops (no ffmpeg / filesystem), noted in the module.

> Ported: `produce, roll, tdroll, timed_roll, rock, nutate, screw, sweep, zoom,
pause, load, add_blank, add_roll, add_rock, add_state_sweep, add_state_loop,
add_nutate, add_scenes, get_movie_fps, find_exe`

Files: `cmd/movie3.ts`, ref `movie.py`, `_gui.py:236`.

### Structure-based superposition non-functional — M

`super` is a bare alias for sequence-based `align`; `cealign`/`usalign` return
`{}`, `alignto`/`extra_fit` return `[]`, `pair_fit` returns `0` — all fake.
Superposing low-identity structures gives wrong or empty results.

Files: `cmd/align.ts:470`, `cmd/extras.ts:505`.

### `fab` / `fnab` / `h_fix` are silent no-op stubs — M

Registered as documented no-ops (return `null`, build nothing) —
`cmd.fab('ACDEF')` does **not** throw but produces no geometry. No
fragment/monomer library exists in the port.

Files: `cmd/extras.ts:515`.

### Top-level verbs that throw `NotPorted` — M · partly landed (Wave 1)

`cmd/topics.ts` now ports `check` (a real atom/bond structure summary), `fork`
(→`spawn`), `dist` (→`distance`), and the flat help verbs re-exported by `api.py`
(`commands, show_help, help_setting, editing_ring`), plus British-spelling colour
aliases (`colour, bg_colour, recolour, set_colour`).

Wave 4a (`cmd/xform.ts`, `cmd/misc2.ts`) additionally ports
`transform_object`/`transform_selection`, `set_state_order`, `get_coordset`,
`load_coordset`, `set_frame`, `set_discrete`, `label2`, `get_phipsi`, and the
`get`/`set`/`del_colorection` set.

> Still throwing: `torsion` (interactive torsion edit) and functional verbs left
> for later waves (`map_generate, auto_measure, copy_image, set_object_ttt`, …).
> Python-language keywords and disabled vendored verbs (`slice_lock`,
> `rgbfunction`) stay intentionally absent.

Files: `cmd/topics.ts`, ref `keywords.py`, `engine.ts`.

### `gui.*` namespace — ✅ ported (Wave 1, 7/7) — S

`cmd/guins.ts` registers the whole `gui.*` namespace. The verbs are external-GUI
window controls; the browser has no such window, so most are faithfully modelled
as env-bound (`ext_show`/`ext_hide` track visibility intent; accessors return
`null` exactly as PyMOL's `ImportError` branch does).

Files: `cmd/guins.ts`, `packages/client/src/cmd.ts:286`, ref `gui.py`.

---

## 2. Rendering — missing representations

Reps with no builder at all: the command may run and mutate state, but nothing is
ever drawn.

### Volume rep never rendered — L

`Rep.Volume` has no builder and `volume` / `volume_panel` are no-ops.
`isomesh` / `isosurface` / `isodot` run marching cubes and publish state but never
emit a Mode-G geometry frame — map surfaces are computed and then dropped. Direct
3D-texture ray-march is entirely absent, so any density workflow shows nothing.

Files: `geometry/registry.ts:43-61`, `cmd/maps.ts:298-343`, `cmd/extras.ts:517`.

### CGO rep never rendered — L

`Rep.CGO` has no builder and there is no `load_cgo` / CGO object model. User
compiled-graphics objects (`cgo.*` primitives, pseudoatom CGO, ramp/gradient
CGOs) can't be created or drawn.

Files: `geometry/registry.ts:43-61`.

### Slice rep not implemented — M

`Rep.Slice` has no builder and `slice_new` is a no-op; no planar map-slice quad is
generated.

Files: `geometry/registry.ts`, `cmd/extras.ts:518`.

### Callback rep not implemented — S

`Rep.Callback` (axes / gadget / internal draw callbacks) has no builder or object
path. Niche, but absent.

Files: `geometry/registry.ts:43-61`.

---

## 3. Rendering — quality gaps

Reps that **do** render but don't yet match desktop PyMOL. Mean parity ≈ 92.7%;
surfaces 84–92%, mesh 74% (worst), everything else 90–99%.

### Surface — 🟡 SES-approximated (shift toward vdW); true probe-rolling still absent — M

The raw field `min(|p−c|−(vdw+probe))` is the solvent-_accessible_ surface (puffy).
It is now **shifted inward by ~0.9·probe** toward the vdW surface — a cheap
solvent-_excluded_ approximation that removed most of the puffiness and lifted the
surface/mesh scenes sharply: **3al1-surface 75.1→87.2%, bfactor 68.5→83.7%,
helix 72.2→88.4%, pept-surface 71.7→91.7%, pept-mesh 64.6→74.0%** (mean **89.4→
92.7%**). Still not modelled: true probe-rolling of re-entrant toroidal saddles,
`surface_type` dot/mesh modes, `surface_cavity_mode`, per-atom surface flags; the
faceting-vs-resolution lever was tried (finer grid + spatial index) and found NOT
to matter — the gap was shape (SES), not tessellation.

Files: `geometry/surface_gen.ts` (`SES_SHRINK`), `geometry/surface.ts`.

### Cartoon heavily simplified — L

Splines through CA only with a parallel-transport frame (no carbonyl /
peptide-plane orientation), so the flat ribbon can rotate about the backbone and
present its edge. Helix and strand share one hard-coded rectangular cross-section
(`RIBBON_HALF_WIDTH=0.9`, `HALF_THICKNESS=0.2`); only strands taper to a simple
arrow. No fancy/dumbbell helices, flat sheets, nucleic-acid cartoon
(ring/ladder/base), or subtype variants (tube, putty/b-factor, oval, skip).
Ignores `cartoon_*` width settings.

Files: `geometry/cartoon.ts:32-349`.

### Transparency is plain sorted alpha, not OIT — L

three.js default alpha blend + per-object painter sort with `DoubleSide`, so a
single transparent surface blends its own front/back in raster order. No depth
peeling / weighted-blended OIT / `transparency_mode` → wrong front-back ordering
and popping as the camera turns on any transparent surface or sphere. (Unmeasured
— no transparent scene in the suite yet — but real.)

Files: `viewport/modeG/materials/vertex.ts:48`, `lighting.ts:24`.

### Mesh — the worst-scoring scene (64.6%) — M

Reuses the same approximate SAS generator but does **not** smooth (surface gets 3
Taubin passes; mesh doesn't) and emits every deduplicated marching-cubes edge as a
`line`. Ignores `mesh_width` / `mesh_quality` / `mesh_type`, so the coarse faceted
edges look little like PyMOL's finer tessellation.

Files: `geometry/mesh.ts:28`.

### Sticks — no bond-valence rendering — M

One split-colour `cylinder2` per bond regardless of order (no double/triple twin
cylinders when `valence` is on). Ignores every stick setting except
`stick_radius`; isolated sticks atoms get no stub, so they're invisible.

Files: `geometry/frames.ts:201-256`.

### Lines — no valence; isolated atoms invisible — M

One `line` per bond, no double/triple valence offsets, ignores `line_width`; an
atom with no bond draws nothing (PyMOL draws a small cross).

Files: `geometry/frames.ts:143-193`.

### Dashes / measurements — solid lines, values dropped — M

Distance/angle/dihedral render as **solid** lines (no gap pattern; ignores
`dash_gap`/`length`/`radius`/`color`) and the computed numeric value text is
discarded — never shown on screen. Angle arc is a 6-segment polyline.

Files: `exec/measurement.ts:91-160`.

### Atom labels — DOM overlay, no depth occlusion — M

Labels are absolutely-positioned DOM `<span>`s with hard-coded style, so
`label_color`/`size`/`font_id`/`bg_color`/`outline_color`/`offset` are all
ignored. Only culled behind the camera, never occluded by geometry (always on
top); no connector lines.

Files: `viewport/src/labels.ts:37-84`, `cmd/display.ts:210-255`.

### Anti-aliasing — impostor silhouettes not smoothed — M

MSAA only smooths triangles; sphere/cylinder impostor edges come from shader
`discard` + `gl_FragDepth`, so silhouettes are hard 1-sample cutouts, and
`pixelRatio` is pinned to 1 (no supersampling headroom). Jaggy edges on
otherwise-strong scenes. Wants analytic edge-AA in the impostor shaders or a
supersampled offscreen target.

Files: `viewport/modeG/renderer.ts:118-162`, `materials/sphere.ts`, `cylinder.ts`.

### Ambient occlusion — shader path exists, no geometry feeds it — M · matches default PyMOL

Full AO plumbing in the material (`u_hasAo`, `in float ao`, `color.rgb *= v_ao`)
but no builder emits an `ao` buffer, so `v_ao` is pinned to 1.0. **This MATCHES
default GL PyMOL** (`ambient_occlusion_mode 0`) and only diverges from the
ray-traced reference — see §4.

Files: `materials/vertex.ts:11-82`, `surface.ts:32`.

---

## 4. Deliberately deferred / declined

Items consciously **not** done, with the reason — so they don't get
re-litigated. Most trace to the parity target being real-time GL, not the
ray-tracer.

### F4 per-vertex ambient occlusion — declined — M

Desktop PyMOL's real-time GL path (the chosen parity target) ships AO **off** by
default, so adding it would move the render _away_ from the "looks like a fresh
PyMOL install" target. The shader already consumes it; a spike measured it live on
5,235 verts. Revisit only if the quality bar shifts to the ray-traced look.

Files: `plan:58`, `materials/vertex.ts:50`, `surface_gen.ts`.

### True SES surface generation — deferred (F5 residual) — L

F5 only Taubin-smoothed the SAS mesh to _look_ SES-like; real rolled-probe
re-entrant surfaces are a substantial two-pass algorithm (or an EDT inward
offset) left as follow-up. Surface similarity plateaued ~71–75%. Same root cause
as the §3 surface item.

Files: `surface_gen.ts:11-14`, `docs/engine-port-gaps.md:31`.

### Ray tracing (`cmd.ray`) — likely permanent, punted to remote backend — L

There is no CPU ray tracer in the port; ray-traced PyMOL is explicitly **not**
the parity gate, kept only as an aspirational reference. `ray` / `draw`-to-disk
are side-effect-free no-ops.

Files: `docs/engine-port-gaps.md:124`, `plan:7`.

### Shadows / silhouette outline / OIT — out of scope — L

A real-time WebGL renderer can't reproduce ray shadows/AO/SES pixel-for-pixel;
only F4/F5 were scoped as quality fixes. This is the constant ceiling on the
parity metric across _all_ scenes — even strong sticks/cartoon top out ~95–98%
partly because of the shadowless flat lighting.

Files: `plan:13`, `lighting.ts:22`.

### F2 viewport material/geometry pooling — subsumed by F1 — M

F1 memoizes rep frames at the engine push boundary, so an unchanged rep is neither
rebuilt nor re-emitted — that stops the re-emit before it reaches the viewport,
absorbing most of F2's intended win. Viewport-side pooling stays available if
per-frame `BufferGeometry`/material re-allocation still costs under interaction
(see §5).

Files: `plan:57`, `renderer.ts:136`.

### TS-vs-PyMOL similarity left informational, not gated — S

Only the strict TS-vs-golden self-regression is enforced; the TS-vs-PyMOL
similarity was meant to be a "threshold that tightens as fixes land" but was never
converted to an enforced floor, so SES/cartoon work has no hard regression gate
against the refs.

Files: `plan:46`, `apps/web/e2e/visual.e2e.mjs`.

---

## 5. Performance & architecture

The structural levers on interactivity and scale — the biggest is getting the
engine off the UI thread.

### Move the TS engine off the main thread to a Web Worker — L · biggest interactivity win

`LocalBackend` is fully synchronous — every command (PDB parse, selection eval,
whole Mode-G geometry build) runs on the UI thread, so a ~1.4s surface build
freezes input and rendering. The `Backend` interface is already async/worker-
shaped and geometry frames are already typed arrays that can post back as
transferable `ArrayBuffer`s (zero-copy). Large refactor.

Files: `backend.ts:31-60`, `engine.ts:855`.

### Surface/mesh build has no spatial index — ~1.4 s dominant cost — L

`fieldAt()` and `nearest()` each linearly scan **all** atoms; per emitted vertex
the code calls `fieldAt` 6× (central-difference gradient) + `nearest` once + a
second `O(atoms)` argmin fallback → ≈ 7·V·N distance evals with zero
acceleration. A uniform grid / cell list / kd-tree over atom centers cuts each
lookup from `O(N)` to ~`O(1)` — the dominant lever on surface latency. The grid
also silently loses resolution above 90³ rather than scaling.

Files: `surface_gen.ts:171,184,240`, `surface_gen.ts:122`.

### Mode-G picking is approximate (~93.5%) and non-authoritative — L

The client-side geometric pick index is used only on the GL-free bridge (~1 click
in 15 lands on a neighbouring atom); on a GL backend Mode-G has no independent
pick. A real pick needs an offscreen id-buffer render + `glReadPixels` — a GL
context the Web Worker can't own, so it's entangled with the worker move.

Files: `viewport.ts:508,515`, `viewport/src/picking`.

### Camera polled over transport at RTT — remote drag ~1–2 fps — M

Mode-G polls `cmd.get_view()` one request in flight, re-issued per input (+250 ms
keep-alive), capping a drag at one frame per round trip. Optimistic local rotation
exists but only on the GL-free path; against a GL backend the drag still tracks at
RTT. Fix: extend optimistic local turn/move/zoom to the GL path, or push view
deltas instead of polling.

Files: `viewport.ts:390,456`, `camera.ts:191`.

### No material/geometry pooling (F2) — M

`renderer.apply()` disposes and rebuilds GPU objects wholesale; each new
`RawShaderMaterial` forces a shader recompile/relink and each dispose frees VBOs,
so a rep that re-pulls (color change, compositor churn) pays full shader + buffer
allocation. Pooling materials by static key and reusing `setAttribute`-updated
buffers removes per-frame GC and compile pressure.

Files: `webgl/builder.ts:106,134`, `modeG/renderer.ts:332`.

### `setView` allocates a Matrix4 + re-pushes all uniforms per camera update — S

`new Matrix4().fromArray(mv).invert()` per call plus an `O(keys×materials)`
`pushUniforms` walk (fog/ortho/bg) fired even on pure rotation, during active drag

- the 4 Hz poll. Hoist a reusable scratch `Matrix4` and gate the uniform fan-out
  on fog/ortho/bg actually changing.

Files: `modeG/renderer.ts:276,282,289`.

### DPR / large-scene scaling gaps — M

Renderer fed device pixels with `setPixelRatio(1)`; only dots re-apply DPR by
hand, so other CSS-pixel primitives mis-size on HiDPI. Wide lines expand to
instanced quads (geometry scaling with bond count, since WebGL2 clamps
`gl.lineWidth` to 1). Mode-P server raster is `glReadPixels`-bound and scales with
area×DPR. Not correctness bugs, but each caps how big / high-DPI a scene stays
interactive.

Files: `modeG/renderer.ts:159,245`, `webgl/quadlines.ts:174`.

---

## 6. Loose code TODOs worth tracking

Meaningful in-code markers and half-wired features surfaced across the engine,
bridge, and web app.

### Console command language — ✅ mostly resolved (Wave 2)

`isCommandWord` accepts any registered handler and `runKeyword`'s default case
dispatches it generically, so every ported verb (`scene new, store`; `spectrum
count`; `dss`; `rotate x, 90`; `label …`; `distance d, …`) is already a console
verb — the old "13 verbs" limit is gone. Remaining: verbs that are themselves
still unported (`ray` → remote backend; `torsion`, etc.) naturally still report.

Files: `packages/engine-ts/src/engine.ts` (`runKeyword`), ref `docs/engine-port-gaps.md`.

### `cmd.do` parser — ✅ kwargs + `@script` handled (Wave 2) — remaining: python-escape

`cmd/parser.ts` now splits `keyword arg1, arg2, key=value` into positional args +
kwargs (quote-aware, so commas/`=` inside quotes are preserved), and `@file.pml`
is reported honestly (no browser filesystem). Still out of scope: arbitrary
python-escape expressions (those run as JavaScript via the `/expr` path).

Files: `cmd/parser.ts`.

### Menu tree is a hand-written truncated excerpt — L

`menuData.ts` needs the `tools/gen-menus` extractor (run `get_menudata()` in real
PyMOL → JSON); the full tree is hundreds of leaves + radio groups and must not be
grown by hand.

Files: `apps/web/src/layout/menuData.ts:16`.

### Object panel / mouse-mode / wizard blocks are static placeholders — L

`placeholderData.ts` values await the bridge `objects` topic; mouse-mode 5-char
binding codes need `ButModeGet`/`Translate`; object-panel toggles are
optimistic-only and the row A/S/H/L/C context menus are unbuilt; the Wizard block
is absent; External-GUI docking has only the bottom dock.

Files: `placeholderData.ts:4,128`, `ObjectPanel.tsx:39`, `MouseModeBlock.tsx:17`.

### Fragment coordinates aren't exact-parity with chempy fragments — M

Ships a hand-built heavy-atom library instead of reading
`data/chempy/fragments/*.pkl` — enough for `fragment ala` to load and render, not
coordinate-exact.

Files: `model/fragments.ts:8`.

### `intra_rms` / `intra_rms_cur` are unsuperposed — M

Should least-squares-fit each state before RMSD; the port skips the fit
(documented approximation; reference state reports −1.0 like PyMOL).

Files: `cmd/extras.ts:423`.

### Command line has no Tab completion or drag-and-drop — M

Completion needs server-side `cmd.kwhash` / `cmd.auto_arg` + local filesystem
(can't be done in-browser); DnD live-preview insert is also missing.

Files: `apps/web/src/layout/CommandLine.tsx:21,26`.

### `map_generate` only accepts MTZ — M

Hard-codes `MTZHeader`; CIF/CNS/HKL reflection files are rejected with a canned
message (upstream TODO).

Files: `packages/bridge/tenmol_bridge/panels/files.py:309`.

### Feedback broker needs a stdout/stderr tee — M

Python `print()` from `cmd.do` goes to process stdout, not the Ortho queue, so the
web console misses every print from scripts/wizards/`util.*`. `FeedbackBroker`
accepts plural sources but the tee isn't wired.

Files: `packages/bridge/tenmol_bridge/feedback.py:16`.

### Dots use a Fibonacci-sphere approximation + O(N²) cull — S

Reproduces PyMOL's Sphere0–4 dot counts (42/92/162/252/642) with a Fibonacci
sphere instead of exact icosahedral point sets; the buried-point test scans every
dot against all atoms with no acceleration; `dot_normals` / `dot_lighting` /
connected-dot-surface not modelled.

Files: `geometry/dots.ts:45,99`.

### Viewport reshape reports CSS pixels, not framebuffer pixels — S

PyMOL wants framebuffer pixels; reshape currently sends CSS px → wrong on HiDPI
(likely needs `rect.width × devicePixelRatio`).

Files: `apps/web/src/layout/Viewport.tsx:34`.

### Feedback log doesn't translate PyMOL colour escape codes — S

`\933`-style escapes aren't translated by `text2html`, so raw escape codes can
leak into the console.

Files: `apps/web/src/layout/FeedbackLog.tsx:16`.

### Draw/Ray quick button rendered as a TODO (WP-19) — S

Shows `quickbutton--todo` and prints "not implemented in this wave" whenever no
`render_dialog` hook is registered.

Files: `QuickButtons.tsx:54`, `RenderDialog.tsx:73`.
