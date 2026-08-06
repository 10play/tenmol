---
title: "Spike 03 — Geometry Extraction: empirical test of "new C++ is mandatory""
description: "Status: BLOCKER RESOLVED — verdict below. Method: every number in this document was produced by running the commands in §11 on this machine. Nothing here is…"
---

# Spike 03 — Geometry Extraction: empirical test of "new C++ is mandatory"

**Status:** BLOCKER RESOLVED — verdict below.
**Method:** every number in this document was produced by running the commands in §11 on this machine.
Nothing here is inferred from source reading alone. Where I quote source, it is only to explain a
result I already measured.

> ## STATUS — one conclusion in here is WRONG, and it is in §0
>
> **The verdict stands: new C++ was mandatory, and it was written**
> (`06-geometry-accessor.md`). Everything this spike measured about
> the **existing exporters** is still true and is still the reason Mode G needs an accessor rather
> than `get_vrml` — identity loss (§4.2), silent drops of ellipsoids/labels/volume/alpha (§4.1,
> §4.3), primitive substitution for lines/mesh/dots (§4), ASCII blow-up (§8) and zero dirty
> tracking (§3.1). `packages/protocol/README.md` and `packages/protocol/src/geometry.ts` both cite
> this file for exactly those numbers.
>
> **What is OVERTURNED: §0's fourth paragraph and §9, "in a headless build there is no GL raster
> path at all" / "Pixel streaming is not a fallback; it is not a product".**
>
> That is an artefact of the harness, not a property of PyMOL. This spike ran with **no GL
> context** — §1 records `cmd.get_renderer() -> ('', '', '')` and §9 records it again — so
> `cmd.png(..., ray=0)` silently fell through to the CPU ray tracer, which is why `ray=0` and
> `ray=1` produced identical bytes in identical time. With the CGL context that
> `04-picking.md` §2 later proved exists, `cmd.get_renderer()` returns
> `('Apple', 'Apple M4 Max', '2.1 Metal - 89.4')` and **the same call is 0.075 s, a 123×
> difference**. `docs/code-ownership.md:201-215` is where the two spikes finally met and
> is the authority; server-side pixels ("Mode P") are a shipped render mode, not an impossibility.
>
> **The safe way to read §9:** every number in it is correct *for a bridge with no GL context*, and
> in that configuration it remains the reason a GL-free backend cannot serve interactive pixels
> — which is exactly the trade-off `07-cross-platform-gl.md` §10 later
> measured on both paths.
>
> Two smaller notes. §7's `pymol._cache` "stopgap" was **never shipped** and should not be
> revived — the accessor supersedes it entirely. §7.3's real bug (`TypeError: unhashable type:
> 'list'` on stderr for every surface build at `cache_mode >= 2`) is still live upstream —
> `PyObject_Hash` is still at `packages/engine/layer1/P.cpp:1321` and the swallowing `PyErr_Print`
> has drifted one line, to `:1375` — and is still a reason not to treat the bridge's stderr as a
> health signal.

---

## 0. Verdict

**New C++ is MANDATORY.** Confirmed empirically, but *not for the reason
`docs/geometry-extraction.md` gives.*

That document says (`geometry-extraction.md:22-23`) the existing exporters are *"multi-second"* and
that a 3k-atom cartoon+sticks scene costs `10^0 – 10^1 s` per `get_vrml` call
(`geometry-extraction.md:347`). **That is wrong by one to two orders of magnitude.**
Measured: `cmd.get_vrml(2)` on a 4,779-atom cartoon+surface+sticks scene is **0.820 s**, and on a
660-atom cartoon it is **0.036 s**. The exporters are much faster than the doc claims, and
`cmd.get_vrml(2)` *does* contain real, colored, per-vertex-normal cartoon **and** surface triangles —
which the doc's §4 verdict "Unusable per-frame; usable one-shot" understates.

The exporters are nevertheless unusable as the web client's geometry feed, for four measured
reasons that have nothing to do with raw speed:

1. **Total loss of identity.** Two objects with two different reps export as **one**
   `IndexedFaceSet`, zero `DEF` names, zero object names (§4.2). You cannot toggle a rep, recolor an
   object, or hide a chain client-side without re-exporting and re-parsing the entire scene.
   There are also no atom indices anywhere in any exporter output → **client-side picking is
   impossible** from exporter data.
2. **Silent data loss.** Ellipsoids: the ray tracer reports *"processed 367 graphics primitives"*
   and every exporter emits **0 bytes** of them (§4.3). Labels: **0 bytes**. Volume: **0 bytes**.
   Transparency: `get_vrml` emits the string `transparency` **0 times** for a surface at
   `transparency 0.5`. `lines`, `mesh`, `dots`, `isomesh` are silently converted from
   lines/dots into **3D cylinders and spheres** — 1UBQ `mesh` becomes 31,710 cylinders + 63,420
   spheres, a 31.9 MB `.wrl` / **133.7 MB** `.dae`; 1UBQ `dots` becomes a **658 MB** `.dae`.
3. **ASCII blow-up at real sizes.** 1AON (58,870 atoms), cartoon only: `get_vrml(2)` = **1.928 s**
   and **246,021,746 bytes** (860,040 triangles). Parsing that in V8 costs **2.25 s** and
   **1.77 GB RSS** (§7) for what is 93 MB of `float32`. A browser tab will not survive this on a
   routine structure.
4. **No dirty tracking.** Four consecutive `get_vrml(2)` calls on an unchanged 4HHB cartoon:
   0.166 / 0.165 / 0.164 / 0.163 s, byte-identical output every time. Every call is a full
   `SceneRay` re-expansion. A single `cmd.color('red','chain A')` on 1AON therefore costs a fresh
   1.92 s + 246 MB round trip.

And the reason a geometry feed is *required at all* (rather than "just stream pixels") is also now
measured: **in a headless build there is no GL raster path at all.** `cmd.png(..., ray=0)` is
bit-identical to `cmd.ray()` and takes the same time (§8). Server-side frames for 1AON cost
**9.241 s** at 640×480 and **29.253 s** at 1280×960. Pixel streaming is not a fallback; it is not a
product.

**What is genuinely reachable today with zero new C++:** the surface mesh, via `pymol._cache`
(§5) — real, exact, model-space, ~2× slower and ~4× fatter than a binary accessor, and **missing
colors, alpha, visibility flags and atom mapping**. Nothing else.

**Answer to task question 4 — "is there ANY Python-reachable route to cartoon triangles today?"**
**YES.** `cmd.get_vrml(2)`, `cmd.save('x.obj')` / `cmd.get_mtl_obj()`, `cmd.get_collada()`,
`cmd.get_povray()` and `cmd.get_idtf()` all emit real cartoon triangles with per-vertex normals
(and per-vertex colors, except OBJ). `geometry-extraction.md` does not state this clearly and its
§2 focus on `RepCartoon::preshader` implies the opposite. The route exists — it is just
scene-flattened, ASCII, identity-free and non-incremental, which is why it still cannot be the feed.

---

## 1. Environment and inputs

```
interpreter : <scratch>/venv/bin/python           (CPython 3.13.3, Homebrew)
pymol       : 3.2.0a0, git sha 159ed88baad87f6bcc61ee45ef0b9ffc208370fc
harness     : pymol2.PyMOL(); p.start()           — no finish_launching, no GLUT, no GL context
cmd.get_renderer() -> ('', '', '')                — confirms zero GL renderer in-process
node        : v22.22.0                            (browser-side parse benchmark)
```

Structures — network was available, so real PDB entries were fetched (`files.rcsb.org`):

| id | source | atoms | why |
|---|---|---|---|
| `1UBQ` | fetched | **660** | small reference |
| `4HHB` | fetched | **4,779** | the "realistic molecule" for the headline table |
| `1AON` | fetched | **58,870** | GroEL/GroES — realistic *large* desktop case |
| `1EJG` | fetched | **843** | 367 `ANISOU` records — the only way to get a non-empty `ellipsoids` rep |

Local alternatives in `packages/engine/test/dat/` (`1tii.pdb`, `il2.pdb`, `3al1.pdb`) and `packages/engine/data/tut/1hpv.pdb` were
identified as fallbacks but not needed.

Scripts: `<scratch>/geo/probe.py` … `probe8.py`, `drive.sh`, `parsebench.mjs`. Raw results:
`<scratch>/geo/results.jsonl`.

---

## 2. Precondition discovered: exporters build the reps themselves

This matters for the bridge design and was measured, not assumed:

```
A get_vrml with NO prior refresh: 0.014 s, 1722443 bytes (nonempty=True)
B cache entries immediately after show (no refresh): 0
B refresh: 0.075 s; cache entries now: 1
C after cmd.rebuild(): 0
C after get_vrml: 1
```

* `cmd.get_vrml()` / `cmd.ray()` run `SceneUpdate` internally, so **rep geometry is built with no
  GL context, no `draw()`, and no prior `refresh()`.**
* `cmd.rebuild()` alone builds **nothing** — it only invalidates. Anything that needs finished
  geometry must call `cmd.refresh()` or an exporter.

---

## 3. Table 1 — every export path, headless, on 4HHB (4,779 atoms)

Times are wall-clock for the export call only (setup excluded). `bytes` is the returned
string/tuple size, or file size for `cmd.save`. Full 150-row matrix (2 structures × 5 rep sets ×
15 paths) in `<scratch>/geo/results.jsonl`.

| path | headless | cartoon | surface | sticks | spheres | all three | reps actually covered |
|---|---|---|---|---|---|---|---|
| `cmd.get_vrml(2)` / `save .wrl` | **yes** | 0.421 s / 20.06 MB | 0.392 s / 18.59 MB | 0.057 s / 3.34 MB | 0.023 s / 1.40 MB | **0.820 s / 39.05 MB** | tri-reps as 1 `IndexedFaceSet` (per-vertex color+normal); spheres→`Sphere{}`; sticks/lines/mesh/dots→`Cylinder{}`/`Sphere{}`. **No alpha. No labels. No ellipsoids. No volume.** |
| `cmd.get_vrml(1)` | yes | 0.006 s / **278 B** | 0.006 s / **278 B** | 0.000 s / **278 B** | 0.015 s / 0.80 MB | 0.011 s / **278 B** | **spheres only** — everything else is a 278-byte empty stub. Useless. |
| `cmd.get_collada()` / `save .dae` | yes | 0.317 s / 18.50 MB | 0.294 s / 17.16 MB | 0.684 s / 35.48 MB | **1.516 s / 81.11 MB** | 0.650 s / 37.58 MB | triangles merged per material; **one `<geometry>` per sphere/cylinder** (4,779 nodes for spheres). Has transparency. `geometry id="geom0"` — anonymous. |
| `cmd.get_povray()` / `save .pov` | yes | 0.863 s / 39.40 MB | 0.803 s / 36.53 MB | 0.062 s / 2.72 MB | 0.012 s / 0.52 MB | 1.675 s / 76.09 MB | analytic `sphere{}`/`cylinder{}` (compact, colored, with `transmit`); triangles as **one `mesh2{}` block per triangle** (3× vertex duplication + a 3-entry `texture_list` each). Only exporter that honours `geometry_export_mode=1` exactly (§6). |
| `cmd.get_mtl_obj()` / `save .obj` | yes | 0.338 s / 17.02 MB | 0.311 s / 15.77 MB | **0.000 s / 0 B** | 0.011 s / 0.54 MB | 0.649 s / 33.01 MB | triangles only, `v`+`vn`+`f`. **Cylinders emit literally nothing (0 bytes).** Spheres become degenerate 3-vertex faces (`v`=3×N, `vn`=0). **No colors, no `usemtl`, no `o`/`g` groups.** `.mtl` half always empty. |
| `cmd.get_idtf()` | yes | 0.048 s / 5.77 MB | 0.052 s / 7.70 MB | **0.000 s / 1,322 B** | 0.000 s / 2,093 B | 0.099 s / 13.60 MB | triangles only. Sticks/spheres → empty stub. |
| `cmd.save('x.stl')` | **no** | — | — | — | — | — | `pymol.IncentiveOnlyException: STL export not supported by this PyMOL build` |
| `cmd.save('x.gltf')` / `get_gltf` | **no** | — | — | — | — | — | `CmdException: could not find collada2gltf` (external binary, not in the venv or on PATH) |
| `cmd.get_session()` | yes | 0.005 s / **1,356,363 B** | 0.005 s / **1,356,363 B** | 0.005 s / **1,356,363 B** | 0.005 s / **1,356,363 B** | 0.005 s / **1,356,363 B** | **none.** See §5.2 — byte-identical across all five rep sets. |
| `cmd.get_coordset(copy=0)` | yes | 0.021 s / 57,348 B | same | same | same | same | atom coords only, `(4779,3) float32` numpy **view** |
| `cmd.ray()` + `cmd.png()` @640×480 | yes | 1.131 s / 199 KB | 1.337 s / 299 KB | 0.836 s / 334 KB | 0.304 s / 315 KB | 2.233 s / 300 KB | pixels |
| `cmd.dump(file, obj)` | **partially** | — | — | — | — | — | `ExecutiveDump-Error: Invalid object type for this operation.` on any **molecular** object. Works only for `cObjectMesh`/`cObjectSurface`/`cObjectMap`: isosurface → **0.025 s / 2,912,628 B** ASCII, `x y z nx ny nz` per line. |

Same matrix on 1UBQ (660 atoms) is in `results.jsonl`; every path scales roughly linearly except
COLLADA-with-spheres, which is superlinear in primitive count.

### 3.1 No caching, no incremental mode — measured

```
get_vrml call 0: 0.166 s, 20063974 bytes     # 4HHB cartoon, nothing changed between calls
get_vrml call 1: 0.165 s, 20063974 bytes
get_vrml call 2: 0.164 s, 20063974 bytes
get_vrml call 3: 0.163 s, 20063974 bytes
turn y 1       : 0.000 s
get_vrml after turn: 0.163 s, changed=True
```

And on 1AON, a pure color change is as expensive as a rebuild:

```
recolor+refresh          : 0.038 s
get_vrml2 after recolor  : 1.921 s   (246 MB again)
```

---

## 4. Table 2 — rep coverage matrix (1UBQ, one rep at a time)

`wrl` empty baseline is **235–278 bytes** (viewpoint + light + navinfo only). "EMPTY" = at or below
that baseline, i.e. the rep produced no geometry at all.

| rep shown | `.wrl` bytes | what VRML2 contains | `.obj` faces | `.pov` bytes | `.dae` bytes | verdict |
|---|---|---|---|---|---|---|
| `cartoon` | 1,723,756 | **1 IndexedFaceSet**, per-vertex color + normal, 6,454 tris | 6,454 | 3,490,569 (6,444 `mesh2`) | 1,637,244 (1 geom) | real triangles ✅ |
| `surface` | 2,815,855 | **1 IndexedFaceSet**, 10,472 tris | 10,472 | 5,677,416 (10,471 `mesh2`) | 2,670,766 (1 geom) | real triangles ✅ |
| `sticks` | 427,283 | 1,127 `Cylinder{}` | **0** | 341,609 (1,127 cyl + 1,436 sph) | 4,524,804 (1,127 geoms) | analytic only |
| `spheres` | 192,917 | 660 `Sphere{}` | 660 *(degenerate)* | 71,544 (660 sph) | 11,150,160 (660 geoms) | analytic only |
| `lines` | 544,339 | **1,436 `Cylinder{}`** — lines become 3D tubes | 0 | 392,186 | 5,680,733 | wrong primitive ❌ |
| `mesh` | **31,904,592** | **31,710 `Cylinder{}` + 63,420 `Sphere{}`** | 0 | 12,151,078 | **133,683,130** | wrong primitive, explodes ❌ |
| `dots` | 11,259,657 | 38,567 `Sphere{}` | 38,567 | 4,180,530 | **658,272,625** | wrong primitive, explodes ❌ |
| `ribbon` | 57,072 | 150 `Cylinder{}` | 0 | 40,956 | 593,239 | analytic only |
| `nonbonded` | 175,424 | 348 `Sphere{}` + 174 `Cylinder{}` | 0 | 66,810 | 727,105 | crosses→tubes |
| `nb_spheres` | 17,200 | 58 `Sphere{}` | 58 | 6,307 | 976,639 | analytic |
| `cell` | 12,367 | 24 `Sphere{}` + 12 `Cylinder{}` | 0 | 4,638 | 52,921 | box→tubes |
| `distance` / `angle` / `dihedral` | 14,321 / 6,276 / 4,261 | dashes as spheres+cylinders | 0 | small | small | geometry ✅, **numeric label dropped** |
| user CGO (`cmd.load_cgo`) | 799 | 1 IndexedFaceSet | 1 | 547 | 6,053 | ✅ |
| `isosurface` | 4,283,706 | 1 IndexedFaceSet, 15,916 tris | 15,916 | 8,194,271 | 4,057,379 | ✅ (also via `cmd.dump`) |
| `isomesh` | 16,116,289 | 16,020 `Cylinder{}` + 32,040 `Sphere{}` | 0 | 6,130,852 | 67,417,085 | wrong primitive ❌ |
| `slice` | 7,349,125 | 1 IndexedFaceSet, 27,328 tris | 27,328 | 14,770,040 | 6,882,988 | ✅ |
| **`labels`** | **235 (EMPTY)** | nothing | 0 | **0** | 3,387 (no geom) | **dropped by every exporter** ❌ |
| **`ellipsoids`** (1EJG, 843 atoms, `rep ellipsoid` matches 843) | **234 (EMPTY)** | nothing | 0 | **0** | 3,387 (no geom) | **dropped by every exporter** ❌ |
| **`volume`** | **235 (EMPTY)** | nothing | 0 | 0 | 2,517 | **dropped** ❌ |
| `callback` | n/a | requires a real GL context to even construct | — | — | — | not extractable by construction |

### 4.1 The ellipsoid result is the sharpest evidence of silent loss

With 1EJG loaded and `show ellipsoids`:

```
rep ellipsoids -> 0 atoms          # note: the selection macro is singular
rep ellipsoid  -> 843 atoms        # rep IS on
RayRenderPovRay: processed 367 graphics primitives.
wrl bytes 234        pov bytes 0        obj f= 0        dae geometry nodes 0
```

The ray tracer sees the primitives. Every text exporter throws them away without an error, a
warning, or a nonzero exit. **An exporter-based feed would silently render an empty screen for a
rep that PyMOL draws fine.**

### 4.2 No object identity, no rep identity, no groups

Two objects (`A` = cartoon/red, `B_` = surface/blue), one export:

```
VRML2 Shape count: 1   IndexedFaceSet: 1
object names present in wrl: []      'DEF' occurrences: 0
DAE geometry nodes: 2   node ids: ['geom0', 'geom1']
OBJ 'o ' groups: 0   'g ' groups: 0   usemtl: 0
```

Everything triangular in the whole scene, across all objects and all reps, is welded into a single
`IndexedFaceSet`. COLLADA at least splits into two `<geometry>` nodes, but names them `geom0`,
`geom1` — no mapping back to `A` / `B_`.

Multi-state behaves the same way: with a 3-state object, `get_vrml` exports the **current state
only** (1,723,726 B); `set all_states, 1` exports **all states merged** into the same untagged blob
(5,214,522 B). No per-state tagging either way.

### 4.3 Transparency

Surface at `transparency 0.5`:

```
wrl 'transparency' occurrences : 0        # VRML2 drops alpha entirely
dae 'transparen'  occurrences : 9         # COLLADA keeps it
pov 'transmit'    occurrences : 31413     # POV keeps it, per vertex (3 per triangle)
```

---

## 5. What `cmd.get_session()`, `cmd.get_coordset()` and friends actually expose

### 5.1 The full accessor inventory (measured, not grepped)

`dir(pymol._cmd)` has **299** entries. Every one whose name suggests geometry was checked. The
complete set that returns anything geometric:

| `_cmd` symbol | returns |
|---|---|
| `get_vrml`, `get_collada`, `get_idtf`, `get_povray`, `get_mtl_obj` | the five ray-tracer text exporters of §3 |
| `get_coords`, `get_coordset` | atom coordinates only |
| `get_model` | chempy atom list — atoms, no rep geometry |
| `get_volume_field`, `get_volume_histogram`, `get_volume_ramp` | 3-D scalar field (maps only) |
| `dump` | mesh/surface/map **objects** only; errors on molecular objects |
| `get_session` | see 5.2 |

There is **no** `get_raw_alignment`-style geometry analogue. `get_raw_alignment` itself returns
`(model, index)` atom pairs — no coordinates, no geometry.

### 5.2 `cmd.get_session()` contains zero rep geometry — proved by byte-identity

Pickled session size for 1UBQ, with the rep set varied and everything else held constant:

```
cartoon  -> 185061 bytes
surface  -> 185061 bytes
sticks   -> 185061 bytes
spheres  -> 185061 bytes
all      -> 185061 bytes
```

…and for 4HHB, `1356363` bytes in all five cases. Showing a surface adds 10,472 triangles to the
scene and **zero bytes** to the session.

A recursive scan of the whole session object for any numeric list longer than 2,000 elements
returns `[]`. Top-level keys are
`['cache','color_ext','colors','editor','main','movie','moviescenes','names','selector_secrets','session','settings','unique_settings','version','view','view_dict','wizard']`.
`geometry-extraction.md:247-249` is correct on this point; this is the runtime confirmation.

### 5.3 `cmd.get_coordset(copy=0)` works and is the API-shape precedent

`(4779, 3) float32`, 57,348 bytes, 0.021 s, returned as a numpy **view** onto live C++ memory.
This is exactly the shape a `get_rep_geometry` accessor should have.

---

## 6. Coordinate space — `geometry_export_mode` measured precisely

Single pseudoatom at model-space `(10, 20, 30)`, camera rotated (`turn x 37; turn y 11`),
`get_view()[9:15] = [0,0,-14.1782, 10,20,30]`:

| exporter | `geometry_export_mode=0` | `geometry_export_mode=1` |
|---|---|---|
| `get_vrml(2)` sphere translation | `0.000000 0.000000 0.000001` (camera space) | `10.000000 20.000000 44.178204` — model space **plus the camera z-distance 14.1782** |
| `get_povray()` sphere centre | camera space | `<10.0000000000, 20.0000000000, 30.0000000000>` — **exact model space** |

So `get_povray` + `geometry_export_mode=1` is the only exporter that returns coordinates a client
can use directly with `cmd.get_view()`; VRML needs a per-scene z fix-up that the client must derive
from `get_view()[11]`. Neither is documented as such anywhere.

---

## 7. The surface cache route (`pymol._cache`) — the one real zero-C++ path

`cmd.cache('enable')` sets `cache_mode` 0 → 2. After `cmd.show('surface')` + `cmd.refresh()`
(the cache is **not** populated by `show` alone, nor by `cmd.rebuild()`; it needs a `SceneUpdate`):

```
len(_cache): 1  (accessed as p.cmd._pymol._cache)
entry 0: len 6, size 1235, access 1, input=tuple(24 items), output=tuple(6 items)
output elem types  ['int','list','list','int','list','list']
output elem lens   [5235, 15705, 15705, 10472, 31416, 41888]
N=5235  NT=10472  len(V)=15705  len(VN)=15705  len(T)=31416  len(S)=41888
3*N == len(V): True     3*NT == len(T): True
V element type: float   T element type: int
V[0:6]  = [28.154884338378906, 24.43000030517578, 1.2954914569854736,
           27.34000015258789,  24.43000030517578, 1.0640003681182861]
VN[0:6] = [0.5257309675216675, 0.0, -0.8506508469581604, ...]
T[0:9]  = [1421, 1426, 1379, 1371, 1379, 1426, 1425, 1371, 1426]
```

**Confirmed:** layout is `(N, V, VN, NT, T, S)`; `V`/`VN` are flat `3*N` Python float lists,
`T` is a flat `3*NT` int index list, `S` is triangle-strip lengths. **Coordinates are model space**
(`V[3:6] = (27.34, 24.43, 1.06)` vs. atom 0 at `(27.34, 24.43, 2.614)`) — no camera transform to
undo. This is a genuinely usable indexed mesh.

**Confirmed missing:** the tuple has exactly 6 elements. There is **no `VC` (colors), no `VA`
(alpha), no `VAO` (ambient occlusion), no `Vis` (per-vertex visibility), no `AT` (atom mapping)**.
`geometry-extraction.md:325-328` is correct. A viewer with no colors is not a viewer.

### 7.1 Cost, measured (4HHB chain A surface: N=12,503, NT=25,002)

| serialization | time | bytes |
|---|---|---|
| `json.dumps(tuple)` | 0.024 s | 2,381,026 |
| `pickle.dumps(tuple, 2)` | 0.002 s | 1,136,069 |
| `numpy` → `float32`/`int32` bytes (pos+nrm+idx) | **0.002 s** | **600,096** |

So JSON is ~4× the size and ~12× the time of the binary form of the *same* data. The `PyFloat`
boxing cost predicted in `geometry-extraction.md:330-333` is real but smaller than claimed at this
scale (the 1UBQ surface tuple's flat lists occupy 837,936 bytes shallow for 62,820 bytes of actual
float32).

### 7.2 Cache identity problem — measured

```
n cache entries: 2                      # 4HHB chain A surface + 1UBQ surface
entry 0: N=12503 NT=25002   input tuple len=24
entry 1: N=5235  NT=10472   input tuple len=24
-> any object name in entry? [False, False]
```

The entry carries **no object name, no state, no rep id** — only a 24-element input tuple of surface
job parameters and a hash. With N surfaces on screen you cannot tell which entry belongs to which
object without re-deriving each job's input tuple in Python. Also measured: recoloring produces
**no** new entry and **no** change (`sig same=True`) — as expected, since colors are not in there.

Cache *hits* do work: deleting and reloading an identical object rebuilt the surface in **0.003 s**
(vs 0.077 s cold) with the entry's access count going `1 → 2`.

### 7.3 A real bug on this path

Every surface build with `cache_mode ≥ 2` prints to stderr:

```
TypeError: unhashable type: 'list'
```

`CacheCreateEntry` calls `PyObject_Hash(item)` on each element of the surface-job input tuple
(`packages/engine/layer1/P.cpp:1321`), and elements 2, 7 and 14 of that tuple are Python **lists** (measured:
`['str','int','list','tuple','float','int','int','list',...]`). The exception is swallowed by
`PyErr_Print()` at `packages/engine/layer1/P.cpp:1374`, so the cache still functions (equality on `entry[2]` saves
it), but every hash for a list element collapses to the same value and stderr is polluted once per
surface. Any bridge that treats stderr as a health signal will see this constantly.

---

## 8. Scaling: 1AON (58,870 atoms), the case that decides it

```
load 1AON                : 0.087 s, 58870 atoms
refresh (build cartoon)  : 0.037 s
get_vrml2                : 1.928 s   246,021,746 bytes   860,040 triangles
get_mtl_obj              : 1.952 s   209,899,530 bytes   f=860040  v=2580120
recolor + refresh        : 0.038 s
get_vrml2 after recolor  : 1.921 s   (full re-export)
cmd.get_view() x1000     : 0.0020 s  (2.0 us per call)
```

Browser-side parse of that 246 MB `.wrl` (node v22, `--max-old-space-size=8192`):

```
readFileSync utf8   : 0.078 s, 246,021,746 chars
point [   slice 0.002 s  split 0.371 s  parse 0.318 s -> 7,740,362 floats (31.0 MB float32)
vector [  slice 0.004 s  split 0.371 s  parse 0.354 s -> 7,740,362 floats (31.0 MB float32)
color [   slice 0.003 s  split 0.356 s  parse 0.234 s -> 7,740,362 floats (31.0 MB float32)
coordIndex parse 0.155 s -> 3,440,162 tokens
total wall 2.247 s
rss 1,765 MB
```

**246 MB of ASCII, 1.93 s to produce, 2.25 s to parse, 1.77 GB peak RSS — to deliver 93 MB of
`float32` that PyMOL already had in RAM as `float32`.** The overhead factor is ~2.6× in bytes and
effectively infinite in the sense that a memcpy accessor would be ~10 ms.

Note also that `point`/`vector`/`color` are 7.74 M floats each = 2.58 M vertices = 3 × 860,040
triangles: the exporter has **expanded PyMOL's triangle strips into fully independent triangles**,
tripling the vertex count before it ever reaches the wire.

---

## 9. Why "just stream pixels" is not an escape hatch

```
cmd.get_renderer()                     -> ('', '', '')          # no GL renderer in-process
cmd.png(f, 640, 480, ray=0)  #0        : 1.160 s -> 199243 bytes
cmd.png(f, 640, 480, ray=0)  #1        : 1.169 s -> 199243 bytes
cmd.png(f, 640, 480, ray=0)  #2        : 1.156 s -> 199243 bytes
cmd.ray(640, 480)                      : 1.123 s
```

`ray=0` and `ray=1` produce the same bytes in the same time: **in a headless build `cmd.png` is the
CPU ray tracer.** Pixel content confirmed non-trivial (1,225 unique RGB values for a 320×240 green
cartoon), so it is a real render, not a background fill — just an extremely expensive one.

On 1AON: `cmd.ray(640,480)` = **9.241 s**; `cmd.ray(1280,960)` = **29.253 s**.

Therefore the interactive viewport *must* be client-side WebGL, and therefore the geometry feed is
on the critical path. (`cmd.draw(320,240)` also returns without crashing in this build, unlike
`_cmd._draw` — but it does not produce a GL raster either.)

---

## 10. Corrections required to existing documents

These are reported, not applied — I do not own those files.

1. `docs/geometry-extraction.md:347` — the per-call cost table (`10^0 – 10^1 s` for
   `get_vrml`, `10^1 – 10^2 s` for `get_collada`) is wrong by 1–2 orders of magnitude. Measured:
   `get_vrml` 0.82 s and `get_collada` 0.65 s for a 4,779-atom 3-rep scene. Replace with Table 1.
2. `geometry-extraction.md:22-23,272` — "None is usable as an interactive feed" is the right
   conclusion but the stated reason (speed) is wrong. The real reasons are: no object/rep/atom
   identity (§4.2), silent drop of ellipsoids/labels/volume/alpha (§4.1, §4.3), primitive-type
   substitution for lines/mesh/dots (§4), ASCII blow-up (§8) and no dirty tracking (§3.1).
3. `geometry-extraction.md` §4 table, `get_idtf` row — the claim "Triangles only … sticks and
   spheres silently vanish" is confirmed (1,322 B / 2,093 B stubs), but the doc omits that IDTF's
   mesh data lands in the **second** tuple element (`get_idtf()[1]`, 474 KB for a 1UBQ cartoon),
   not the first (1,046 B node list).
4. `geometry-extraction.md` §8 item 8 — `volume` is listed as out of scope; add that
   `slice` **does** export as real triangles (27,328 for 1UBQ) and is not in the same category.
5. `geometry-extraction.md:600-602` open question about `pymol._cache` survivability — answered:
   entries survive `cmd.delete` + reload and are **hit** (0.003 s vs 0.077 s, access count 1→2), but
   they carry no object/state identity (§7.2) and the hash path raises `TypeError: unhashable type:
   'list'` on every write (§7.3).
6. `geometry-extraction.md:597-599` open question about `_PYMOL_NO_RAY` — answered: ray export is
   compiled in (all five exporters and `cmd.ray` run).
7. `architecture.md` — any work package that assumes a server-side raster fallback must be
   re-costed at ray-tracer speed: **9.2 s/frame at 640×480 for a 59k-atom cartoon** (§9).
8. `architecture.md` WP for geometry — must state that `cmd.rebuild()` does **not** build
   geometry (§2); the trigger is `cmd.refresh()` or any exporter call.

---

## 11. Verdict and the minimum new C++ required

### Is new C++ mandatory? **Yes.**

There is no combination of existing Python-reachable calls that yields, for an arbitrary scene:
per-object/per-rep separation, per-vertex colors **and** alpha, atom indices for picking,
model-space coordinates, ellipsoids/labels, and incremental updates. Each existing path fails at
least three of those, measured above. The surface cache gets closest and still has no colors and no
object identity.

### Minimum viable accessor (scope for the C++ work package)

Everything below is a memcpy of data that already exists CPU-side after `SceneUpdate`, which §2
proves runs headless.

1. `_cmd.get_rep_geometry(G, object, state, rep_id, flags)` → dict of `PyBytes` blobs.
   * **Surface** (`cRepSurface`): `V, VN, VC, VA, VAO, T, AT, Vis` + `proximity` +
     `oneColorFlag/oneColor`. This alone closes the largest single gap (the cache route's missing
     colors) and is a pure `memcpy` of eight `std::vector`s.
   * **CGO reps** (cartoon, sticks, spheres, ribbon, lines, mesh, dots, nonbonded, ellipsoids,
     dashes): walk `primitiveCGO`/`preshader`/`ray`, emit `CGO_DRAW_ARRAYS` blocks as raw bytes,
     and emit `CGO_SPHERE` / `CGO_SHADER_CYLINDER*` as instance buffers rather than tessellating —
     that is what preserves the `mesh`/`dots`/`lines` reps that the exporters destroy (§4).
2. `_cmd.get_scene_geometry(G, flags)` — the same, for all visible objects, plus per-object
   matrices.
3. A rep-invalidation callback into Python, so the client re-pulls only what changed. Without it,
   §3.1 (no dirty tracking) is reproduced in the new API.

### What the accessor is worth, in the numbers above

| scenario | existing best path | with accessor (measured lower bound) |
|---|---|---|
| 4HHB cartoon+surface+sticks, first load | 0.820 s, 39.0 MB ASCII | memcpy of the same triangles ≈ 10 MB `float32` |
| 1AON cartoon, first load | 1.928 s, **246.0 MB**, +2.25 s / 1.77 GB in the browser | ~93 MB `float32` unindexed, less if strips are preserved |
| recolor one chain of 1AON | 1.921 s + 246 MB (full re-export) | re-send the color array only |
| 4HHB surface, colors | **not available at all** (cache has no `VC`) | 4 arrays |
| ellipsoids / labels / volume | **0 bytes, silently** | present |
| picking | impossible (no atom indices anywhere) | `AT` / `CGO_PICK_COLOR` |

### Stopgap while the C++ lands

`pymol._cache` surface tuples (§7) + `cmd.get_vrml(2)` for cartoon are a usable *prototype* feed for
small structures (≤ ~5k atoms): grey/uniform-colored surfaces, colored cartoon, no picking, full
re-export on any change. Do not ship it and do not build the client's data model around its shape.

---

## 12. Reproduction

```bash
S=<scratch>                      # the session scratchpad
PY=$S/venv/bin/python

# structures
cd $S && curl -sO https://files.rcsb.org/download/1UBQ.pdb \
             -O https://files.rcsb.org/download/4HHB.pdb \
             -O https://files.rcsb.org/download/1AON.pdb \
             -O https://files.rcsb.org/download/1EJG.pdb

bash  $S/geo/drive.sh                  # Table 1 -> $S/geo/results.jsonl (150 rows)
$PY   $S/geo/probe2.py                 # coordinate space, identity, transparency, session, caching, dump
$PY   $S/geo/probe3.py 1UBQ            # surface cache layout
$PY   $S/geo/probe4.py                 # cache identity / hits / serialization cost
$PY   $S/geo/probe5.py                 # 1AON scaling + ray timings
$PY   $S/geo/probe6.py                 # Table 2 rep-coverage matrix
$PY   $S/geo/probe7.py                 # ellipsoids w/ ANISOU, geometry_export_mode, multi-state
$PY   $S/geo/probe8.py                 # headless png(ray=0) vs cmd.draw
node --max-old-space-size=8192 $S/geo/parsebench.mjs $S/geo/1aon_cartoon.wrl
```

All probes use `pymol2.PyMOL()` (never `finish_launching`) and run one export per subprocess so a
crash in one path cannot corrupt another's timing. No PyMOL source was modified; the only file this
spike creates in the repo is this document.
