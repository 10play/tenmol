---
name: representations
kind: feature
category: representations-display
subcategory: overview
summary: Every visual representation PyMOL can draw — lines, sticks, spheres, cartoon, surface, mesh, dots, ellipsoids, labels, cell, CGO, volume, slice and measurement dashes — plus the show/hide/as keywords and the geometry pipeline that feeds them to the viewport.
parity: partial
---

# Representations

A *representation* is one visual style PyMOL draws for a set of atoms/bonds. Every molecular
object carries an independent per-state array of reps (`CoordSet::Rep[cRepCnt]`, gated by
`Active[cRepCnt]`), each toggled with `show` / `hide` / `as` and tuned by its own family of
settings. This doc covers every rep, its show/hide/as keyword, the key controlling settings
(transparency, quality, radius, colour), and how its mesh/CGO geometry is produced and shipped to
the browser viewport.

## How geometry reaches the viewport

Reps are built on the CPU with no GL context: `SceneUpdate` drives `obj->update()` →
`Rep::rebuild()` → `fNew(cs, state)`, after which every rep's CPU geometry is final. Surfaces are
plain `std::vector<float>` triangle soup; every other rep is a **CGO** float-bytecode buffer. The
tenmol bridge extracts these via `_cmd.web_get_rep_geometry` (`layer4/CmdWebGeometry.cpp`), typed in
`packages/protocol/src/geometry.ts`, and the browser draws them in **Mode G** (`packages/viewport/src/modeG/`).
A parallel TypeScript engine rebuilds the same geometry directly from atoms in
`packages/engine-ts/src/geometry/` (registry at `geometry/registry.ts`). Anything Mode G cannot draw
falls back to a server-rendered raster (**Mode P**, `packages/viewport/src/modeP/`), with the
per-rep switch in `packages/viewport/src/renderPolicy.ts`. Reps rebuild whenever
`Rep::invalidate(cRepInv_t)` fires; the two Python triggers are `cmd.rebuild()` and `cmd.refresh()`.

The full geometry-extraction inventory lives in [geometry-extraction](../../../../docs/geometry-extraction.md).

---

## lines

Wireframe: one line segment per bond, coloured per-atom at the bond midpoint; the show/hide/as
keyword is `lines` (a.k.a. `wire`, the default for `show`/`as`). Non-bonded atoms are drawn by the
separate `nonbonded` rep, not by `lines`.

**Rep:** `cRepLine (7)`, CGO ops `CGO_LINE` / `CGO_SPLITLINE` in `primitiveCGO`
(`layer2/RepWireBond.cpp`). **Key settings:** `line_width` (default `1.49` — deliberately under 1.5
to keep SGI antialiasing), `line_radius` (when drawn as cylinders), `line_smooth`, `line_use_shader`,
`valence` (`1` — draw double/triple bonds as multiple lines), `line_stick_helper`. Colour follows the
atom colour unless overridden.

---

## sticks

Cylinders for bonds and small spheres at the joints — the classic "sticks" model; keyword `sticks`.
Half-bond colouring splits each cylinder at the midpoint into the two atom colours
(`CGO_SHADER_CYLINDER_WITH_2ND_COLOR`).

**Rep:** `cRepCyl (0)`, `primitiveCGO` built GL-free in `layer2/RepCylBond.cpp` with
`CGO_SHADER_CYLINDER` / `CGO_SPHERE` (zero-order-bond dots) ops. **Key settings:** `stick_radius`
(`0.25`), `stick_quality` (`8`), `stick_transparency` (`0`), `stick_valence_scale` (`1`), `stick_ball`
+ `stick_ball_ratio` (ball-and-stick), `stick_h_scale`, `stick_fixed_radius`, `stick_nub` /
`stick_round_nub`, `stick_color`, `stick_as_cylinders`, `stick_use_shader`, `valence`. Per-bond radius
can be set with `set_bond stick_radius, ...`.

---

## spheres

Space-filling / CPK: one sphere per atom, radius = VDW radius × `sphere_scale`; keyword `spheres`
(a.k.a. `vdw`).

**Rep:** `cRepSphere (1)`. `primitiveCGO` holds `CGO_SPHERE` (xyz+r) ops built GL-free
(`layer2/RepSphere.cpp`). The GL/Mode-G path forks on `sphere_mode`: mode `9` (default) draws GLSL
impostor quads (ray-sphere in `sphere.fs`, exact and cheap); modes 0/cube/tetrahedron tessellate real
triangles via `CGOSimplify(primitiveCGO, 0, sphere_quality)`; modes 1,2,3,6,7,8 are point sprites.
**Key settings:** `sphere_scale` (`1.0`), `sphere_mode` (`9`), `sphere_quality` (`1`),
`sphere_transparency` (`0`), `sphere_solvent` (`0` — add `solvent_radius` to each radius),
`sphere_color`, `sphere_use_shader`. Anisotropic ADP spheroids use `spheroid_scale` / `spheroid_fill`
via the `spheroidCGO`.

---

## nonbonded

Small 3D crosses ("stars") marking atoms that have no bonds (ions, waters, HETATM singletons);
keyword `nonbonded` (a.k.a. `nb`). Shown automatically when `auto_show_nonbonded` is on.

**Rep:** `cRepNonbonded (11)`, `primitiveCGO` (`layer2/RepNonbonded.cpp`). **Key settings:**
`nonbonded_size` (`0.25` — half-length of each cross arm), `nonbonded_transparency` (`0`),
`nonbonded_as_cylinders`, `nonbonded_use_shader`.

---

## nb_spheres

Non-bonded spheres: small solid spheres (not crosses) at non-bonded atoms — a compact alternative to
`nonbonded`; keyword `nb_spheres`.

**Rep:** `cRepNonbondedSphere (4)`, `primitiveCGO` (`layer2/RepNonbondedSphere.cpp`). **Key
settings:** `nb_spheres_size` (`0.25`), `nb_spheres_quality` (`1`), `nb_spheres_use_shader`. Unlike
`spheres`, radius is a fixed size, not VDW-scaled.

---

## cartoon

The schematic secondary-structure ribbon: flat arrowed strands, wide helices, thin loop tubes,
nucleic-acid ladders and rings; keyword `cartoon`. Cross-section is chosen per residue from secondary
structure (`atom.ss`, assigned by `dss`), then overridden per residue by the [cartoon](#cartoon-command)
command. This is the single richest rep.

**Rep:** `cRepCartoon (5)`. The CPU CGO (`preshader`) is built by `GenerateRepCartoonCGO`
(`layer2/RepCartoon.cpp`) and immediately normalised with `CGOCombineBeginEnd()`, so cartoon geometry
is already interleaved `CGO_DRAW_ARRAYS` before any GL. Extrusion emits `GL_TRIANGLE_STRIP` /
`GL_TRIANGLE_FAN` / `GL_LINE_STRIP` blocks in `layer1/Extrude.cpp`, plus cylinders for
nucleic-acid-as-cylinders and spheres/triangles for base rings. The TS port (`geometry/cartoon.ts`)
extrudes a fixed 8-point cross-section along a Cα spline, with two PyMOL pre-passes: refine (smooth
the peptide-plane orientation vectors) and flatten-sheets (`cartoon_flat_sheets`).

**Key settings (selected):** `cartoon_transparency` (`0`); loop `cartoon_loop_radius` (`0.2`) /
`cartoon_loop_quality`; tube `cartoon_tube_radius` (`0.5`); oval `cartoon_oval_length` (`1.35`) /
`cartoon_oval_width` (`0.25`); rectangle `cartoon_rect_length` (`1.40`) / `cartoon_rect_width` (`0.4`);
helix `cartoon_helix_radius` (`2.25`), `cartoon_fancy_helices` (`0`), `cartoon_cylindrical_helices`
(`0`); sheet `cartoon_flat_sheets` (`1`), `cartoon_fancy_sheets` (`1`); putty
`cartoon_putty_radius` (`0.40`), `cartoon_putty_scale_min` (`0.6`) / `cartoon_putty_scale_max` (`4.0`)
/ `cartoon_putty_range` (`2.0`); `cartoon_sampling` (`-1`), `cartoon_smooth_loops`,
`cartoon_side_chain_helper` (`0`), `cartoon_ring_mode` / `cartoon_ring_finder`, `cartoon_ladder_mode`,
`cartoon_nucleic_acid_as_cylinders` (`1`), `cartoon_color`.

### cartoon automatic

`cartoon automatic` (type `0`, the default) picks the cross-section per residue from secondary
structure: rectangle+arrow for strands ('S'), rectangle/cylinder for helices ('H'), tube for loops.
This is why `cartoon` is rarely needed explicitly — HELIX/SHEET records drive it.

### cartoon loop

`cartoon loop` (type `1`) forces a thin round tube of radius `cartoon_loop_radius` (`0.2`) for the
selection, ignoring secondary structure — useful for drawing an entire chain as a smooth worm.

### cartoon tube

`cartoon tube` (type `4`) forces a fat round tube of radius `cartoon_tube_radius` (`0.5`) with
`cartoon_tube_cap` / `cartoon_tube_quality` end styling — the "putty-less" backbone tube.

### cartoon oval

`cartoon oval` (type `3`) extrudes an elliptical cross-section sized by `cartoon_oval_length`
(`1.35`) × `cartoon_oval_width` (`0.25`), quality `cartoon_oval_quality` — a rounded flat ribbon.

### cartoon rectangle

`cartoon rectangle` (type `2`) extrudes a flat rectangular slab sized by `cartoon_rect_length`
(`1.40`) × `cartoon_rect_width` (`0.4`). PyMOL's `ExtrudeRectangle` puts corners at
`sin(π/4)·cartoon_rect_length`, so effective half-width ≈ `0.99`, not `1.40`.

### cartoon arrow

`cartoon arrow` (type `5`) is the rectangle slab with a C-terminal arrowhead — the β-strand look. The
arrowhead base widens to `~1.9×` the strand half-width before tapering to the tip
(`cartoon_fancy_sheets`).

### cartoon dumbbell

`cartoon dumbbell` (type `6`) draws a flat ribbon edged with round rails ("dumbbell" cross-section):
`cartoon_dumbbell_length`, `cartoon_dumbbell_width`, and rail radius `cartoon_dumbbell_radius`
(`0.16`).

### cartoon putty

`cartoon putty` (type `7`, "b-factor sausage") is a variable-radius tube whose thickness maps a
per-atom property (default B-factor). Radius = `cartoon_putty_radius` (`0.40`) scaled between
`cartoon_putty_scale_min` (`0.6`) and `cartoon_putty_scale_max` (`4.0`) over `cartoon_putty_range`
(`2.0`), transformed by `cartoon_putty_transform` (default normalized-nonlinear) with exponent
`cartoon_putty_scale_power`; quality `cartoon_putty_quality`.

---

## ribbon

A thin backbone trace — a single line or thin cylinder through Cα/C4' atoms, with no
secondary-structure cross-section; keyword `ribbon`. Cheaper and flatter than `cartoon`.

**Rep:** `cRepRibbon (6)`, `primitiveCGO` (`layer2/RepRibbon.cpp`); TS port `geometry/ribbon.ts`.
**Key settings:** `ribbon_width` (`3.0`, line width), `ribbon_radius` (`0.0` — when `0`, width is used;
non-zero draws a 3D cylinder), `ribbon_sampling` (`1`, spline points per residue), `ribbon_transparency`
(`0`), `ribbon_color`, `ribbon_side_chain_helper`, `ribbon_trace_atoms`, `ribbon_as_cylinders`,
`ribbon_nucleic_acid_mode`, `ribbon_power` / `ribbon_power_b` (spline tension).

---

## surface

A smooth solvent-excluded / solvent-accessible molecular surface; keyword `surface`. The heaviest rep
to compute and the richest geometry (positions, normals, per-vertex colour, alpha, ambient occlusion,
atom mapping).

**Rep:** `cRepSurface (2)`. Unlike other reps, geometry is plain `std::vector` triangle soup
(`layer2/RepSurface.cpp`): `V` positions, `VN` normals, `VC` colours, `VA` alpha, `VAO` ambient
occlusion, `T` triangle indices, `Vis` per-vertex visibility, `AT` closest-atom map. Triangulated by
`TrianglePointsToSurface`; recoloured in `RepSurface::recolor()`. Per-triangle culling
(`visibility_test` with `surface_proximity`) must be replicated by the client or hidden patches leak.
TS port: `geometry/surface.ts` + `geometry/surface_gen.ts`.

**Molecular vs solvent surface.** `surface_type` (`0`) selects solid surface; `surface_solvent` (`0`)
switches between the solvent-*excluded* surface (probe-rolled, default) and the solvent-*accessible*
surface. `solvent_radius` (`1.4`) is the probe radius; `dot_solvent` similarly governs the dot rep.
`surface_mode` (`0`, "by flag") controls which atoms surface. **Key settings:** `transparency` (`0`,
the global surface alpha), `transparency_mode` (`2`), `surface_quality` (`0`), `surface_color`,
`surface_proximity` (`1`), `surface_cavity_mode` (`0`) / `surface_cavity_radius`, `surface_carve_*` /
`surface_clear_*` (proximity carving), `surface_negative_visible` (`0`) / `surface_negative_color`
(for map-potential surfaces), `surface_ramp_above_mode`, `surface_color_smoothing`,
`ambient_occlusion_mode` (`0`). Transparent surfaces sort per-frame on the CPU (or use OIT under
`transparency_mode 3`).

---

## mesh

A wireframe isomesh over the molecular surface or a map — the surface drawn as edges instead of solid
triangles; keyword `mesh`. Also produced by `isomesh` for volumetric maps.

**Rep:** `cRepMesh (8)`, raw `vla<float> V` + strip lengths `N` + colours `VC`
(`layer2/RepMesh.cpp`); TS port `geometry/mesh.ts`. **Key settings:** `mesh_width` (`1.0`, line
width), `mesh_quality` (`2`), `mesh_type` (`0` = isomesh / `1` = isodot), `mesh_solvent` (`0`),
`mesh_mode`, `mesh_color`, `mesh_negative_visible` (`0`) / `mesh_negative_color`, `mesh_cutoff`,
`mesh_carve_*` / `mesh_clear_*`, `mesh_as_cylinders`, `mesh_use_shader`, `min_mesh_spacing`.

---

## dots

A cloud of dots sampling the molecular / VDW surface; keyword `dots`. Each dot carries a normal and
an accessible-area value.

**Rep:** `cRepDot (9)`, raw `V` / `VC` / `VN` / area `A` / atom `Atom` arrays (`layer2/RepDot.h`); TS
port `geometry/dots.ts`. **Key settings:** `dot_solvent` (`0` — surface-accessible vs VDW dots),
`dot_density` (`2`, 0–4 sampling density), `dot_radius` (`0.0`; when `0`, `dot_width` in pixels is
used), `dot_width` (`2.0`), `dot_mode`, `dot_color`, `dot_hydrogens`, `dot_normals`, `dot_lighting`,
`dot_as_spheres`, `solvent_radius`.

---

## ellipsoids

Thermal-displacement (ADP / ANISOU) ellipsoids: one probability ellipsoid per atom, oriented by its
anisotropic B-tensor; keyword `ellipsoids`. Requires ANISOU records.

**Rep:** `cRepEllipsoid (19)`, `CGO_ELLIPSOID` ops tessellated by `CGOSimpleEllipsoid`
(`layer2/RepEllipsoid.cpp`); TS port `geometry/ellipsoids.ts` (scale multiplied by `1.5382` to match
PyMOL's probability geometry). **Key settings:** `ellipsoid_scale` (`1.0`), `ellipsoid_probability`
(`0.5` — the isoprobability contour, e.g. 50%), `ellipsoid_quality` (`1`), `cgo_ellipsoid_quality`
(`-1`), `ellipsoid_transparency` (`0`), `ellipsoid_color`.

---

## labels

Per-atom text drawn as camera-facing textured quads (a texture atlas of glyphs), not mesh; keyword
`labels`. Created/edited by the `label` command.

**Rep:** `cRepLabel (3)`, `labelV` quad buffer + lexer string indices `L` (`layer2/RepLabel.cpp`).
Ops are `CGO_DRAW_LABEL` / `CGO_DRAW_LABELS`; glyph bitmaps come from `CharacterGetPixmapBuffer`. The
atlas is rebuilt client-side, so font rasterization is a near-miss vs PyMOL's FreeType output — labels
therefore route through the raster fallback rather than Mode G. **Key settings:** `label_size`
(`14.0`), `label_color`, `label_font_id`, `label_position` / `label_placement_offset`,
`label_bg_color` / `label_bg_transparency`, `label_outline_color`, `label_shadow_mode`,
`label_connector` + `label_connector_mode` / `_color` / `_width`, `label_relative_mode`,
`label_multiline_justification` / `_spacing`, `label_digits`.

---

## cell

The crystallographic unit-cell box: a wireframe parallelepiped from the object's CRYST1
symmetry; keyword `cell`. Toggled with `show cell` on an object that has a space group.

**Rep:** `cRepCell (12)`, a trivial line box; TS port `geometry/cell.ts`. **Key settings:**
`cell_color`, `cell_centered`.

---

## extent

The axis-aligned bounding box of a selection/object — a wireframe box around its coordinate extent;
keyword `extent`. Distinct from `cell` (which is the crystal lattice).

**Rep:** `cRepExtent (15)`, a trivial line box; TS port `geometry/extent.ts`.

---

## dashes

Dashed-line geometry for measurement objects — the segments that `distance`, `angle` and `dihedral`
draw; keyword `dashes`. Not shown on molecules directly; it is the render rep of measurement
(`cMeasure*`) objects.

**Rep:** `cRepDash (10)` (+ `cRepAngle 17`, `cRepDihedral 18`), raw `float* V` (`layer2/RepDistDash.cpp`);
TS port `geometry/../exec/measurement.ts`, which draws through the `line` rep. Each segment is split
into short solid dashes separated by gaps. **Key settings:** `dash_length` (`0.15`), `dash_gap`
(`0.45`), `dash_radius` (`0.0`), `dash_width`, `dash_color`, `dash_transparency` (`0`),
`dash_round_ends`, `dash_as_cylinders`. (The TS measurement port uses its own `0.1`/`0.4`
length/gap constants rather than the settings.)

---

## cgo

User-supplied Compiled Graphics Objects — arbitrary triangles/lines/spheres/cylinders a script builds
from the opcode constants in `cgo.py` and loads with `load_cgo`; keyword `cgo`. The rep that draws
`ObjectCGO` objects.

**Rep:** `cRepCGO (13)`. `ObjectCGOState::origCGO` (`layer2/ObjectCGO.h`) is CPU-resident and already
round-trips to Python via `CGOAsPyList` / `CGONewFromPyList`, so a loaded CGO is fully serializable.
`load_cgo(list_of_floats, name, state)` builds one. **Key settings:** `cgo_transparency` (`0`),
`cgo_line_width` (`1.0`), `cgo_line_radius`, `cgo_dot_width` (`2.0`) / `cgo_dot_radius` (`-1.0`),
`cgo_sphere_quality` (`1`), `cgo_ellipsoid_quality`, `cgo_lighting`, `cgo_use_shader`,
`cgo_ray_width_scale`. Related: `cRepCallback (14)` runs arbitrary Python OpenGL — by construction it
has no extractable geometry and is unsupported in the web client.

---

## volume

Direct volume rendering of a map via 3D-texture ray-marching with a transfer function; keyword
`volume`, object created by `cmd.volume`. Not triangle geometry.

**Rep:** `cRepVolume (20)`, driven by `data/shaders/volume.fs`; requires a separate 3D-texture upload
path (`cmd.get_volume_field` → `FieldAsNumPyArray`) and a hand-ported volume shader. **Key settings:**
`volume_mode`, `volume_layers`, `volume_bit_depth`, `volume_data_range`; the transfer function is set
with `volume_color` / `volume_ramp_new`. Treated as a separate epic — not drawn client-side today.

---

## slice

A 2D coloured slice plane through a map, sampling the field on a plane and false-colouring it; keyword
`slice`, object created by `cmd.slice_new`. Not triangle geometry (a textured quad / height map).

**Rep:** `cRepSlice (16)`. **Key settings:** `slice_grid`, `slice_dynamic_grid` /
`slice_dynamic_grid_resolution`, `slice_height_map` / `slice_height_scale`, `slice_track_camera`. Like
volume, it needs the field upload path and is not drawn client-side today.

---

## ramp (color gadget)

A colour-ramp legend gadget created by `ramp_new` — a floating scale bar that both documents and
*drives* colouring: reps coloured by the ramp object recolour continuously along a map potential or by
proximity to a molecular object. Rendered as a `GadgetSet` CGO (which round-trips to Python), not a
molecular rep. **Key settings:** `ray_color_ramps`, `surface_ramp_above_mode`. See
[ramp_new](#ramp_new).

---

## Commands

### show

`show(representation="wire", selection="")` — turns a rep on for atoms/bonds. With no arguments,
`show` alone turns on `lines` for all bonds and `nonbonded` for all atoms in every molecular object.
`representation` is any keyword above plus `everything`. See also `hide`, `enable`, `disable`.

### hide

`hide(representation="everything", selection="")` — turns a rep off. `hide` alone (no args) hides
everything.

### show_as

`as(representation="wire", selection="")` — exclusive show: turns the given rep on and hides all
others for the selection. `as` alone turns on `lines` + `nonbonded` and hides everything else.

### cartoon (command)

`cartoon(type, selection="(all)")` — overrides the per-residue cartoon cross-section without changing
which atoms show cartoon. `type` ∈ `automatic`(0), `skip`(-1), `loop`(1), `rectangle`(2), `oval`(3),
`tube`(4), `arrow`(5), `dumbbell`(6), `putty`(7). `skip` blanks the cartoon for that stretch. Rarely
needed since `automatic` reads HELIX/SHEET records. See the [cartoon subtype sections](#cartoon-automatic).

### set_bond

`set_bond(name, value, selection1, selection2=None, ...)` — sets a **per-bond** setting (e.g.
`stick_radius`, `stick_color`, `valence`, `line_width`) on every bond between the two selections,
overriding the object/global value for those bonds only. `unset_bond` reverts it.

### rebuild

`rebuild(selection='all', representation='everything')` — forces PyMOL to recreate geometric objects
that have gone out of sync, discarding cached rep geometry so it is regenerated on the next update.
This is the Python trigger that makes fresh CPU geometry available for extraction.

### refresh

`refresh()` — requests a redraw as soon as the OS allows; unlike `rebuild` it does not discard
geometry, only re-renders. See also `rebuild`.

---

## Related

- [geometry-extraction](../../../../docs/geometry-extraction.md) — full per-rep CPU-geometry inventory and the CGO wire format.
- Coloring domain — `color`, ramps, and per-rep `*_color` settings.
- Settings domain — the exhaustive `*_transparency` / `*_quality` / `*_radius` families.

## Source

- `packages/engine/modules/pymol/viewing.py:52` (rep_list), `:520` (show), `:557` (show_as), `:597` (hide), `:1527` (cartoon_dict), `:1543` (cartoon), `:1837` (rebuild)
- `packages/engine/layer1/Rep.h:48-74` (`enum cRep_t`); per-rep classes under `packages/engine/layer2/Rep*.cpp`
- `packages/engine/layer1/SettingInfo.h` (setting defaults quoted above)
- `packages/engine-ts/src/geometry/registry.ts` (Mode-G rep builders) and the per-rep `geometry/*.ts` modules
- `docs/geometry-extraction.md` (extraction pipeline, CGO format, parity verdict)
- Parity note: Mode-G client builders exist for lines, sticks, spheres, nonbonded, nb_spheres, cartoon, ribbon, surface, mesh, dots, ellipsoids, cell, extent. Labels/cgo route through the raster (Mode P) fallback; cartoon oval/tube/dumbbell/putty subtypes are approximated client-side; volume and slice are not drawn client-side (separate 3D-texture epic).
