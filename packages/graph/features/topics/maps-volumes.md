---
name: maps-volumes
kind: feature
category: maps-volumes
subcategory: volumetric data
summary: Volumetric/electron-density data in PyMOL — map objects and map algebra, loading raster map formats, isosurface/mesh/dot/gradient contouring, direct volume rendering with color ramps, slice objects, molecular color ramps, and the interactive Volume Color Map Editor.
parity: partial
---

## Purpose

A *map object* (`ObjectMap`) is a regular 3-D grid of scalar values — an electron-density
map, an electrostatic-potential map, or a synthetic Gaussian/Coulomb field. You reach for
this domain whenever you want to look at density: build or import a grid, resample or crop
it, then render it as a contoured **isomesh/isosurface/isodot**, a **gradient**, a
directly ray-marched **volume**, or a **slice** plane; and color molecular surfaces by a
scalar field or by proximity with a **ramp**. Contouring commands consume a map and emit a
separate display object; the map itself carries the data. This reference covers the map
lifecycle, the contouring family, volume rendering with its named color ramps, and the
interactive Volume Color Map Editor.

## Syntax

Map-value contouring commands share the `name, map, level, selection, buffer, state,
carve, source_state` convention: `name` is the new display object, `map` is the source
map object, `level` is the contour value, and `selection`+`buffer`/`carve` restrict the
displayed brick to the neighbourhood of atoms. The `state`/`source_state` pair follows
PyMOL's 1-based-to-0-based translation (`int(state)-1`); `state=0` appends a new state,
`state>0` targets a specific state, `state=-1` is current.

See the per-feature `## Syntax` sections below for exact parameter tables copied from the
introspected signatures.

## Behaviour

- **Map objects vs. display objects.** `map_new`/`load`/`map_generate` create the grid
  (`ObjectMap`). `isomesh`, `isosurface`, `isodot`, `gradient`, `volume`, `slice_new`, and
  `ramp_new` create *separate* objects that reference a map by name. Deleting the map
  invalidates its dependents.
- **`carve` vs. `buffer`.** `buffer` extends the bounding box around `selection`; `carve`
  is a per-atom inclusion radius — only density within `carve` Å of a selection atom is
  drawn. Both default to showing the whole brick.
- **State append semantics.** For `isomesh`/`isosurface`/`isodot`, if the object already
  exists and you do not pin a `state`, the new geometry is appended as a new state (an
  animation of contours across map states). `volume` instead *overwrites* the existing
  object.
- **Ramps are objects.** A ramp created by `ramp_new` is a first-class object usable as a
  color: `color <ramp_name>, <selection>` colors atoms by the map value (or by proximity)
  at each atom's position. Ramps can be chained (the output color of one feeds another).
- **Named volume ramps** (`namedramps`, `colorramping.py:17-54`) ship five presets —
  `2fofc`, `fofc`, `esp`, `rainbow`, `rainbow2` — and extend via `volume_ramp_new`; they
  appear in the internal-GUI `A > volume` and `C` menus.

## Examples

```
# density from an MTZ, contoured as blue mesh at 1 sigma around the ligand
load_mtz refined.mtz, prefix=map
isomesh dens, map_2fofc, 1.0, resn LIG, carve=1.8

# direct volume render with a preset ramp
fetch 1oky, type=2fofc, async=0
volume 1okyVol, 1oky_2fofc, 2fofc

# electrostatic-potential coloring of a surface
ramp_new e_lvl, e_pot_map, [-10, 0, 10], [red, white, blue]
set surface_color, e_lvl, prot
```

---

## map_new

### Purpose
Creates a map object from atoms using a built-in field generator (Gaussian density,
van-der-Waals, or Coulomb potential). Upstream notes it is "not yet fully supported".

### Syntax
`map_new(name, type='gaussian', grid=None, selection='(all)', buffer=None, box=None, state=0, quiet=1, zoom=0, normalize=-1, clamp=[1.0, -1.0], resolution=0.0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | map object to create/modify |
| `type` | string | `'gaussian'` | `vdw`, `gaussian`, `gaussian_max`, `coulomb`, `coulomb_neutral`, `coulomb_local` |
| `grid` | float | `None` | grid spacing; default `gaussian_resolution/3.0` |
| `selection` | string | `'(all)'` | atoms about which to generate the map |
| `buffer` | float | `None` | edge cutoff (default -1.0) |
| `box` | list | `None` | explicit `[[x1,y1,z1],[x2,y2,z2]]` box |
| `state` | int | `0` | 0=all states independently; -1 current; -2 effective; -3 all-in-one; -4 unified extent |
| `normalize` | int | `-1` | normalize field |
| `clamp` | list | `[1.0, -1.0]` | clamp `[low, high]` (high<low disables) |
| `resolution` | float | `0.0` | resolution |

### Behaviour
`grid=None` resolves to `gaussian_resolution/3.0`; `buffer=None` becomes -1.0. `box` may be
a string that is `safe_list_eval`'d. Common use is low-resolution surfaces of proteins.

### Source
`packages/engine/modules/pymol/creating.py:291`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:76`.

---

## map_set

### Purpose
Combines or transforms maps: minimum, maximum, average, sum, or difference across a set of
operand maps.

### Syntax
`map_set(name, operator, operands='', target_state=0, source_state=0, zoom=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | target map object |
| `operator` | string | — | `minimum`, `maximum`, `average`, `sum`, `difference` |
| `operands` | string | `''` | space-delimited source map names |
| `target_state` | int | `0` | -1 = current state |
| `source_state` | int | `0` | 0 = all states |

### Behaviour
Experimental. `operator` is validated through `map_op_sc.auto_err`. Example:
`map my_avg, average, map1 map2 map3`.

### Source
`packages/engine/modules/pymol/editing.py:2615`. Parity: unknown — not present in the
TypeScript engine registry.

---

## map_set_border

### Purpose
Sets the scalar level on the edge (border) points of a map — required by PDA workflows.

### Syntax
`map_set_border(name, level=0.0, state=0)`

### Behaviour
Marked "unsupported" upstream. Writes `level` to all perimeter grid points.

### Source
`packages/engine/modules/pymol/editing.py:2656`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:283`.

---

## map_double

### Purpose
Resamples a map at twice the current resolution (linear upsample). Memory cost rises
eight-fold.

### Syntax
`map_double(name, state=0)`

### Source
`packages/engine/modules/pymol/editing.py:2685`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:265`.

---

## map_halve

### Purpose
Resamples a map at half the current resolution; memory drops eight-fold. Inverse of
`map_double`.

### Syntax
`map_halve(name, state=0, smooth=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | | — | map object |
| `state` | int | `0` | map state |
| `smooth` | int | `1` | apply smoothing on downsample |

### Source
`packages/engine/modules/pymol/editing.py:2709`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:274`.

---

## map_trim

### Purpose
Reduces the extent of a map to just cover a selection (crop to the atoms' neighbourhood).

### Syntax
`map_trim(name, selection, buffer=0.0, map_state=0, sele_state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | | — | map object to crop |
| `selection` | | — | atoms defining the retained region |
| `buffer` | float | `0.0` | padding around the selection |
| `map_state` | int | `0` | map state |
| `sele_state` | int | `0` | selection state |

### Behaviour
Upstream describes it as "unsupported … reducing the extent of a map to cover just a
single selection".

### Source
`packages/engine/modules/pymol/editing.py:2739`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:213`.

---

## map_generate

### Purpose
Synthesizes an x-ray map object from a reflection (MTZ) file given amplitude/phase/weight
columns and a resolution window. Experimental.

### Syntax
`map_generate(name, reflection_file, amplitudes, phases, weights='None', reso_low=50.0, reso_high=1.0, quiet=1, zoom=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | map object to create/modify |
| `reflection_file` | string | — | MTZ file on disk (or None to try PDB download) |
| `amplitudes` | string | — | fully-qualified `project/crystal/column` amplitudes |
| `phases` | string | — | fully-qualified phases column |
| `weights` | string | `'None'` | optional weights column |
| `reso_low` | float | `50.0` | min resolution; equal to `reso_high` ⇒ read from file |
| `reso_high` | float | `1.0` | max resolution |

### Behaviour
Reads cell/space-group via `headering.MTZHeader`, runs `_cmd.map_generate` into a temp
file, then `load(..., format='ccp4')`. Only MTZ reflection files supported. Requires the
`headering` module.

### Source
`packages/engine/modules/pymol/creating.py:176`. Parity:
`packages/engine-ts/src/cmd/maps.ts` registers `map_generate` as a blanket stub —
engine-ts has no MTZ reader, so it raises the same bare `CmdException` Open-Source PyMOL
surfaces for an unreadable reflection file (`creating.py:55-57`) for every call.

---

## load_map

### Purpose
API-only loader for a ChemPy map object (the "Phenix project" temporary routine).

### Syntax
`load_map(*arg, **kw)` — thin wrapper over `load_object(loadable.chempymap, ...)`.

### Behaviour
Prepends `loadable.chempymap` and delegates to `load_object`. Marked "Temporary routine".

### Source
`packages/engine/modules/pymol/importing.py:218`. Parity: unknown — not in the TypeScript
engine registry.

---

## load_brick

### Purpose
API-only loader for a brick (grid) object — the "GAMESS-UK project" temporary routine.

### Syntax
`load_brick(*arg, **kw)` — thin wrapper over `load_object(loadable.brick, ...)`.

### Source
`packages/engine/modules/pymol/importing.py:210`. Parity: unknown — not in the TypeScript
engine registry.

---

## load_mtz

### Purpose
Loads an MTZ reflection file as map objects — two maps (`fofc`, `2fofc`) by default, or a
single map when amplitude/phase columns are named.

### Syntax
`load_mtz(filename, prefix='', amplitudes='', phases='', weights='None', reso_low=0, reso_high=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | — | MTZ filename |
| `prefix` | str | `''` | object name/prefix (default: filename stem) |
| `amplitudes` | str | `''` | amplitudes column; guessed if blank |
| `phases` | str | `''` | phases column; required if amplitudes given |
| `weights` | str | `'None'` | optional weights column |
| `reso_low` | float | `0` | min resolution (0 = read from file) |
| `reso_high` | float | `0` | max resolution (0 = read from file) |

### Behaviour
In this open-source engine the body is `raise pymol.IncentiveOnlyException()` — the actual
MTZ reader ships only in Incentive PyMOL.

### Source
`packages/engine/modules/pymol/importing.py:1481`. Parity: planned — Incentive-only
upstream; not in the TypeScript engine registry.

---

## CCP4

### Purpose
CCP4 (`.ccp4`, `.map`, `.mrc`) is the primary binary electron-density raster format; maps
are loaded through `cmd.load` with `format='ccp4'` (auto-detected by extension). `fetch
<code>, type=2fofc/fofc` downloads CCP4 maps from PDBe.

### Behaviour
`load` dispatches map rasters by extension: brix/DSN6 (`o`, `dsn6`, `omap` → `brix`),
`dx`/`dxbin`, `xplor`, `phi`, and CCP4. `map_generate` emits a CCP4 temp file it then
loads. Upstream: "Supported map formats include: xplor, ccp4, phi, and others."

### Source
`packages/engine/modules/pymol/importing.py:649-694`, fetch URLs at
`importing.py:1142-1143`. Parity: partial — `cmd.load` exists in
`packages/engine-ts/src/cmd/*`, but native CCP4 raster parsing coverage is uncertain.

---

## XPLOR

### Purpose
XPLOR/CNS ASCII density map format, loaded via `cmd.load` (`format='xplor'`) or the
API-only `read_xplorstr` for in-memory XPLOR text.

### Behaviour
`read_xplorstr(xplor, name, state, finish, discrete)` loads XPLOR content directly through
`loadable.xplorstr` without touching disk.

### Source
`packages/engine/modules/pymol/importing.py:1074-1095`. Parity: partial — via `cmd.load`;
native XPLOR parsing coverage uncertain.

---

## DX

### Purpose
OpenDX / APBS grid format (`.dx`, `.dxbin`), the usual output of electrostatics tools;
loaded through `cmd.load` (`format='dx'`).

### Behaviour
`.dxbin` maps to `format='dx'`. Note `load` explicitly asserts `format not in ('cif',
'pdb', 'dx')` in some partial-load paths (`importing.py:914`).

### Source
`packages/engine/modules/pymol/importing.py:104-105`. Parity: partial — via `cmd.load`;
native DX parsing coverage uncertain.

---

## isomesh

### Purpose
Creates a wireframe mesh isosurface from a map at a contour `level`. The canonical way to
show 2fofc density as a cage.

### Syntax
`isomesh(name, map, level=1.0, selection='', buffer=0.0, state=1, carve=None, source_state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | | — | new mesh object |
| `map` | | — | source map object |
| `level` | float | `1.0` | contour level (sigma) |
| `selection` | | `''` | atoms to restrict display around |
| `buffer` | float | `0.0` | extra box padding around selection |
| `state` | int | `1` | 0=append new state; -1=current |
| `carve` | float | `None` | per-atom inclusion radius |
| `source_state` | int | `0` | map state to read (0=all, -1=current, -2=last) |

### Behaviour
If the object already exists and `state` is not pinned, the new mesh is appended as a new
state. `selection` (unless `center`/`origin`) is forced molecular so name patterns can't
be misread as maps.

### Source
`packages/engine/modules/pymol/creating.py:514`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:345`.

---

## isosurface

### Purpose
Creates a solid (triangulated) surface object from a map — the filled counterpart to
`isomesh`.

### Syntax
`isosurface(name, map, level=1.0, selection='', buffer=0.0, state=1, carve=None, source_state=0, side=1, mode=3, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `level` | float | `1.0` | contour level |
| `side` | int | `1` | front/back face — triangle winding / normal direction |
| `mode` | int | `3` | geometry: 0 dots, 1 lines, 2 triangle-normals, 3 gradient-normals |
| *(others)* | | | as `isomesh` |

### Behaviour
`mode` selects the marching-cubes normal style; `mode=3` (gradient normals) is smoothest.
Appends as a new state if the object exists and no `state` given.

### Source
`packages/engine/modules/pymol/creating.py:719`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:346`.

---

## isodot

### Purpose
Creates a dot isosurface — sampled points on the isosurface rather than a mesh or solid.

### Syntax
`isodot(name, map, level=1.0, selection='', buffer=0.0, state=0, carve=None, source_state=0, quiet=1)`

### Behaviour
Note `state` defaults to `0` (all/append) here, unlike `isomesh`/`isosurface` (`1`).
Implemented by calling `_cmd.isomesh` with the dot flag (`1`) and `level` as both min and
max.

### Source
`packages/engine/modules/pymol/creating.py:779`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:347`.

---

## isolevel

### Purpose
Changes the contour level of an existing isodot / isosurface / isomesh object in place —
cheaper than recontouring, and animatable.

### Syntax
`isolevel(name, level=1.0, state=0, query=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | | — | contour object to adjust |
| `level` | float | `1.0` | new contour level |
| `state` | int | `0` | target state |
| `query` | int | `0` | if 1, return the current level instead of setting |

### Behaviour
With `query=1` it reads back the level and suppresses the raise-on-error path.

### Source
`packages/engine/modules/pymol/creating.py:822`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:198`.

---

## gradient

### Purpose
Creates a gradient object (field-line/arrow representation of a map's gradient) between a
`minimum` and `maximum` level.

### Syntax
`gradient(name, map, minimum=1.0, maximum=-1.0, selection='', buffer=0.0, state=0, carve=None, source_state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `minimum` | float | `1.0` | low level (default: full map range when max<min) |
| `maximum` | float | `-1.0` | high level |
| *(others)* | | | as `isomesh` |

### Behaviour
Internally calls `_cmd.isomesh` with mode `3` and `minimum`/`maximum` as the level pair.
`maximum < minimum` ⇒ full map range.

### Source
`packages/engine/modules/pymol/creating.py:843`. Parity: implemented in
`packages/engine-ts/src/cmd/ramps.ts:218`.

---

## volume

### Purpose
Creates a direct volume-rendering object from a map — ray-marched density colored by a
transfer function (color ramp), rather than a contour surface.

### Syntax
`volume(name, map, ramp='', selection='', buffer=0.0, state=1, carve=None, source_state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | | — | new volume object |
| `map` | | — | source map object |
| `ramp` | str | `''` | named color ramp (e.g. `2fofc`); a bare float is treated as a legacy level |
| `selection` | | `''` | atoms to restrict around |
| `buffer` | float | `0.0` | box padding |
| `state` | int | `1` | which state to create |
| `carve` | float | `None` | per-atom inclusion radius |

### Behaviour
If `ramp` parses as a float it is consumed as a legacy `level` and ignored as a ramp.
After creation, a non-empty `ramp` triggers `volume_color(name, ramp, state)`. Unlike the
iso* family, `volume` *overwrites* an existing object.

### Source
`packages/engine/modules/pymol/creating.py:577`. Parity: unknown — `volume_color`/
`volume_ramp_new` exist in the TypeScript engine, but the `volume` object creator itself
is not registered.

---

## volume_color

### Purpose
Sets or gets the value→RGBA transfer function (color ramp) of a volume object.

### Syntax
`volume_color(name, ramp='', state=-1, quiet=1, _guiupdate=True)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | volume object name |
| `ramp` | | `''` | ramp spec; **empty ⇒ getter** (returns flat `[v,r,g,b,a]*N`, RGB 0..1) |
| `state` | int | `-1` | state of volume to color (CURRENT_STATE) |
| `_guiupdate` | | `True` | push change back into an open Volume Color Map Editor |

### Behaviour
Named ramps (`2fofc`, `fofc`, `esp`, `rainbow`, `rainbow2`, or any `volume_ramp_new`) are
resolved from `namedramps`. When a matching editor panel is open, the getter/setter syncs
it (`_volume_windows_qt`). Ramp strings parse as `v color a …` or `v r g b a …`.

### Source
`packages/engine/modules/pymol/colorramping.py:123`. Parity: implemented in
`packages/engine-ts/src/cmd/ramps.ts:264`.

---

## volume_ramp_new

### Purpose
Registers a named volume color ramp reusable as a preset when creating/coloring volumes;
the name appears in the internal `A > volume` and `C` menus.

### Syntax
`volume_ramp_new(name, ramp)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | name of the new ramp |
| `ramp` | list/str | — | space-delimited `value, color, alpha` triples |

### Behaviour
A string `ramp` is `split()`; stored into the module-level `namedramps` dict. Example:
`volume_ramp_new pink1sigma, 0.9 violet 0.0 1.0 magenta 0.3 1.5 pink 0.0`.

### Source
`packages/engine/modules/pymol/colorramping.py:56`. Parity: implemented in
`packages/engine-ts/src/cmd/ramps.ts:256`.

---

## volume_panel

### Purpose
Opens the interactive Volume Color Map Editor for a volume object (Qt window upstream;
reimplemented as a web panel in the port).

### Syntax
`volume_panel(name, quiet=1, _noqt=0)`

### Behaviour
Caches one panel per volume name (`_volume_windows_qt`, `_volume_windows`); re-`show()`s
if already open. Falls back to a Tk window when Qt is unavailable. See the Volume Color
Map Editor feature below for the widget contract.

### Source
`packages/engine/modules/pymol/colorramping.py:183`. Parity: partial — the editor UI is
reimplemented on the web side (`apps/web/src/features/volume/`), but the `volume_panel`
command is not in the TypeScript engine registry.

---

## get_volume_field

### Purpose
API-only accessor returning the raw scalar grid of a map or volume object as an array.
Experimental and subject to change.

### Syntax
`get_volume_field(objName, state=1, copy=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `objName` | str | — | map/volume object name |
| `state` | int | `1` | state index |
| `copy` | 0/1 | `1` | 0 returns a live view of internal memory (dangerous) |

### Behaviour
`copy=0` returns a numpy wrapper over internal memory that becomes invalid if the map is
freed/reallocated — only use knowingly.

### Source
`packages/engine/modules/pymol/querying.py:40`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:161`.

---

## get_volume_histogram

### Purpose
API-only: returns `[min, max, mean, stdev, h0…h(bins-1)]` (length `bins+4`) for a map or
volume — the data the Volume Color Map Editor plots behind the ramp.

### Syntax
`get_volume_histogram(objName, bins=64, range=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `objName` | | — | map/volume object |
| `bins` | int | `64` | histogram bin count |
| `range` | tuple | `None` | value range (defaults to `(0.,0.)` ⇒ full data range) |

### Source
`packages/engine/modules/pymol/querying.py:62`. Parity: implemented in
`packages/engine-ts/src/cmd/maps.ts:170`.

---

## slice_new

### Purpose
Creates a slice object — a single 2-D cutting plane through a map colored by a ramp. Good
for a flat cross-section of density/potential.

### Syntax
`slice_new(name, map, state=1, source_state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | | — | new slice object |
| `map` | | — | source map object |
| `state` | int | `1` | target state (0 appends) |
| `source_state` | int | `0` | map state to read |

### Behaviour
Docstring references opacity/resolution args that the actual signature no longer exposes;
slice appearance is driven by `slice_*` settings and an attached ramp.

### Source
`packages/engine/modules/pymol/creating.py:680`. Parity: unknown — not in the TypeScript
engine registry.

---

## ramp_new

### Purpose
Creates a color-ramp object from a map potential value, or from proximity to a molecular
object. Usable anywhere a color is expected (`color <ramp>, <sele>`, `surface_color`, …).

### Syntax
`ramp_new(name, map_name, range=[-1.0, 0.0, 1.0], color=['red', [1.0,1.0,1.0], 'blue'], state=1, selection='', beyond=2.0, within=6.0, sigma=2.0, zero=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | ramp object name |
| `map_name` | string | — | map (potential) or molecular object (proximity) |
| `range` | list | `[-1.0, 0.0, 1.0]` | values at ramp slots |
| `color` | list | `['red',[1,1,1],'blue']` | colors at ramp slots (or a named spectrum) |
| `state` | int | `1` | state identifier |
| `selection` | selection | `''` | for automatic ranging |
| `beyond` | number | `2.0` | auto-range: exclude values beyond this distance |
| `within` | number | `6.0` | auto-range: include only within this distance |
| `sigma` | number | `2.0` | auto-range: std-deviations from mean |
| `zero` | int | `1` | auto-range: force central value to zero |

### Behaviour
`color` may be a list (mixed named colors and RGB triples, including special negative-index
colors) or a named spectrum string. Ramps can be recursive (one ramp's output color feeds
another). Proximity targets must be real objects, not selections — use `create` first.

### Source
`packages/engine/modules/pymol/creating.py:374`. Parity: implemented in
`packages/engine-ts/src/cmd/ramps.ts:178`.

---

## ramp_update

### Purpose
Updates the range and/or colors of an existing ramp without recreating it (keeps the same
map binding).

### Syntax
`ramp_update(name, range=[], color=[], quiet=1)`

### Behaviour
Delegates to `ramp_new(name, '', range, color)` — passing an empty `map_name` reuses the
current map. Update either axis independently: `ramp_update e_pot_color, range=[-15,0,15]`.

### Source
`packages/engine/modules/pymol/creating.py:492`. Parity: implemented in
`packages/engine-ts/src/cmd/ramps.ts:190`.

---

## Volume Color Map Editor

### Purpose
The interactive panel (opened by `volume_panel` / the `A > volume > panel` menu) for
editing a volume's transfer function: a 2-D plot of the map histogram with draggable
color/alpha control points over a logarithmic alpha axis.

### Behaviour
Loads data via `get_volume_histogram(name)` and `volume_color(name)`; pushes edits back
through `volume_color(name, colors)`. The alpha axis is logarithmic (base 10, scaled by
`amax`). Control points carry `(value, alpha, r, g, b)`; left-click adds a point,
ctrl+click adds an isosurface-style triple, drag moves, middle/shift-click removes,
right-click edits value, shift+right-click edits alpha. "Real-time" only suppresses
updates *during* a drag/preview — the release always pushes. "Get colors as script" emits
a `volume_ramp_new(...)` snippet. See the full widget contract in
`docs/dialogs-volume-properties-scenes.md` §1.

### Source
`packages/engine/modules/pmg_qt/volume.py:69-877`, menu at
`packages/engine/modules/pymol/menu.py:644-654`. Parity: implemented — reimplemented in
`apps/web/src/features/volume/` over `packages/bridge/tenmol_bridge/panels/volume.py`
(area 10 marked 37/37 in `docs/feature-parity.md`).

## Related

- [representations](../topics/representations.md) — mesh/surface/dots reps that iso*
  objects feed into.
- [selection-algebra](../topics/selection-algebra.md) — the `selection`/`carve` targeting
  used by every contouring command.
- `color`, `set surface_color` — consume `ramp_new` ramps.
- `docs/file-io.md`, `docs/dialogs-volume-properties-scenes.md` — map loading and the
  Volume Color Map Editor.
