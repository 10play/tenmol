---
title: "Spike 06 — The C++ geometry accessor (_cmd.web_get_rep_geometry)"
description: "Status: IMPLEMENTED AND VERIFIED. Plan code-ownership.md §4 tasks 1 and 2 are done. The product owner moved Mode G onto the critical path; this is the C++…"
---

# Spike 06 — The C++ geometry accessor (`_cmd.web_get_rep_geometry`)

**Status: IMPLEMENTED AND VERIFIED.** Plan `code-ownership.md` §4 tasks 1 and 2 are done.
The product owner moved Mode G onto the critical path; this is the C++ that makes it possible.

Every number and transcript below was produced on this machine by running the scripts named in §9.
Nothing is inferred from source reading alone.

> ## STATUS — re-verified on 2026-08-02
>
> **§7 is the live contract and is unchanged.** `_cmd.web_get_rep_geometry(_self._COb, object,
> state, rep, update=1)`, the six-value `status` vocabulary, the `object|rep|state` cache key and
> the `kind` payload shapes are exactly what `packages/bridge/tenmol_bridge/render/modeg.py`
> consumes today — that module names this spike in its own docstring. **§5's fidelity numbers
> (10,472/10,472 and 6,454/6,454 triangles, max delta ~1.2e-5 Å against `get_vrml(2)`) and §6's
> speed-ups are the reason Mode G exists and have not been re-litigated.**
>
> **§0 counts are historical.** The file is **2,660 lines**, not 1,451, and `Cmd.cpp` now carries
> **10** guarded lines in 2 blocks, not 7 — spike 08 added `web_get_versions` and
> `web_resolve_pick` to the same two sentinel regions this spike created.
>
> **§10's gap list is largely CLOSED, by spike 08 and by the wave after it.** Read
> `08-native-changes.md` §4–§5 before acting on any of it:
>
> | §10 item | today |
> | --- | --- |
> | 1. `labels` unsupported | **still true, and deliberate** — a label is text plus a font stack, not geometry (08 §5.3). Mode P renders labels. |
> | 2. `slice`, `volume`, `callback` unsupported | **still true, and deliberate** (08 §5.3): all three are a texture, not vertices. |
> | 2. `cell`, `cgo`, `dashes`, `angles`, `dihedrals` unsupported | **CLOSED** (08 §5.1). Plus `extent`, which this spike does not list at all. |
> | 3. Non-molecular objects unsupported | **PARTLY CLOSED.** `ObjectCGO` and `ObjectMesh` (isomesh/isodot) are both served now; `ObjectSurface` and `ObjectMap` are not. |
> | 4. Pick colours unshippable | **still true, and it stopped mattering** — 08 §3 proved the `(atom index, bond)` pair resolves a pick client-side **exactly**: 18/18 on spheres, 15/15 on surface, against a real GL pick. |
> | 5. No dirty tracking | **CLOSED** — `_cmd.web_get_versions`, 1.5 µs per idle poll (08 §2). |
> | 6. `CGO_ALPHA_TRIANGLE` counted, not decoded | unchanged, and it has still never appeared in a measured rep. |
>
> §8.1's merge-check instruction still holds but the script is gone: run
> `packages/bridge/.venv/bin/python -m pytest packages/bridge/tests -q` instead, and if any rep
> reports `layout-mismatch`, re-diff that struct against `namespace mirror`. The nine mirrors in
> §8.1's table are all still present; spike 08 added a tenth, `mirror::RepDistLines`.

---

## 0. TL;DR

| | |
|---|---|
| New file | `packages/engine/layer4/CmdWebGeometry.cpp`, 1,451 lines |
| Upstream edit | `packages/engine/layer4/Cmd.cpp`, **+7 lines, 0 removed**, two sentinel-marked regions |
| Build-file edit | **none** — `setup.py:808-816` globs `packages/engine/layer4/*.cpp` (confirmed: it built with no change) |
| Python entry point | `_cmd.web_get_rep_geometry(_self._COb, object, state, rep, update=1)` |
| Reps extracted | cartoon, surface, sticks, spheres, lines, ribbon, mesh, dots, nonbonded, nb_spheres, ellipsoids |
| Reps explicitly refused | labels, slice, volume, cell, cgo, callback, dashes, angles, dihedrals (status `unsupported`) |
| Surface fidelity vs `cmd.get_vrml(2)` | 10,472 / 10,472 triangles, **max coordinate delta 1.2e-5 Å** |
| Cartoon fidelity vs `cmd.get_vrml(2)` | 6,454 / 6,454 triangles, **max coordinate delta 1.1e-5 Å** |
| 1AON cartoon (58,870 atoms) | **8 ms / 42.0 MB binary** vs `get_vrml(2)` **1.950 s / 246.0 MB ASCII** → 244× faster, 5.9× smaller |
| 1AON surface | **3 ms / 30.8 MB** vs **2.095 s / 259.1 MB** → 700× faster, 8.4× smaller |
| Upstream test suite | `Ran 961 tests ... FAILED (failures=1, errors=1, skipped=276)` + `57 passed, 31 skipped` — **byte-identical to the spike-00 baseline** |
| VBOs read back | **zero**, by construction (§3) |
| Primitives tessellated | **zero** — spheres/cylinders/ellipsoids/crosses are instance buffers (§4) |

Three things this accessor gives the client that **no** PyMOL exporter can (spike 03 §0):

1. **Identity.** The payload is keyed `object|rep|state` and every vertex/instance carries the
   PyMOL atom index and bond flag. Client-side picking and per-object/per-rep toggling become
   possible.
2. **Reps the exporters silently drop.** Ellipsoids: `get_vrml`/`get_povray`/`get_idtf` emit
   **0 bytes**; the accessor returns **367 ellipsoid instances** on 1EJG — the exact count the ray
   tracer reports. Transparency: `get_vrml(2)` contains the word `transparency` **0 times**; the
   accessor returns a per-vertex alpha buffer. Ambient occlusion: not in any exporter; returned.
3. **Correct primitives for `mesh`/`dots`/`lines`.** 1UBQ `mesh` through the exporters becomes
   31,710 cylinders + 63,420 spheres / 31.9 MB `.wrl`. Through the accessor it is
   **542 line strips, 32,252 vertices, 0 cylinders, 0 spheres**.

---

## 1. The problem that shaped the design

Plan §4 task 1 says "emit `RepSurface::{V,VN,VC,VA,VAO,T,AT,Vis}` (`packages/engine/layer2/RepSurface.cpp:74-85`)".
The line reference is to the **.cpp**, and that is not an accident:

```
$ grep -rn "struct RepSurface" layer1 layer2 layer3 layer4 layer5
packages/engine/layer2/RepSurface.cpp:59:struct RepSurface : Rep {
```

`RepSurface` — and `RepCartoon`, `RepCylBond`, `RepWireBond`, `RepRibbon`, `RepNonbonded`,
`RepNonbondedSphere`, `RepEllipsoid`, `RepMesh` — are declared **inside their own translation
unit**. Only `RepSphere` (`packages/engine/layer2/RepSphere.h:27`) and `RepDot` (`packages/engine/layer2/RepDot.h:28`) have public
struct definitions. A new file in `packages/engine/layer4/` therefore cannot see nine of the eleven rep types
without either (a) editing `packages/engine/layer2/*`, which this work package does not own, or (b) a layout mirror.

### 1.1 Two routes were considered and one was rejected on evidence

**Rejected: harvest `CRay` primitives.** `Rep::render(info)` with `info->ray` set is public and
generic — it needs no mirrors at all, works for every rep, and even sees the ellipsoids. It is what
every text exporter uses. It was rejected because `CGORenderRay` converts lines to sausages and
points to spheres (`packages/engine/layer1/CGO.cpp:6067-6130`), which reproduces **exactly** the degradation the
task forbids: 1UBQ `mesh` → 31,710 cylinders. `CPrimitive` (`packages/engine/layer1/Basis.h:66-82`) also has no
atom index field, so identity is lost too. Both of the accessor's reasons to exist die on this
route.

**Chosen: layout mirrors + the primitive CGO.** `packages/engine/layer4/CmdWebGeometry.cpp` declares a
`namespace mirror` struct per rep that repeats, in order and with identical types, the data members
the upstream derived class declares. The `Rep` base sub-object comes from the real `packages/engine/layer1/Rep.h`,
so **only the derived tail can ever drift**.

### 1.2 Every mirror is validated before it is dereferenced

This is the part that makes the technique safe to carry across upstream merges.

* **CGO reps** — `cgoLooksSane()` checks `cgo->G == G` (`CGO::G` is the first data member,
  `packages/engine/layer1/CGO.h:772`), that `op` is non-null when `c > 0`, and that **every** opcode reached by
  walking the buffer is `< CGO_sz_size()` and that the walk terminates within `c + 2` steps.
* **Surface** — `checkSurfaceMirror()` requires `V.size() == 3N`, `VN.size() == 3N`,
  `T.size() == 3·NT`, `VC/VA/VAO/Vis/AT` either empty or exactly `3N`/`N`, and **every** triangle
  index in `[0, N)`.
* **Mesh** — strip lengths must be positive and sum to `NTot`, and the list must be
  zero-terminated within `NTot + 1` entries.
* **Dots** — the run-length stream must consume exactly `RepDot::N` dots.

If any check fails the call returns `status: "layout-mismatch"` with a message naming the file that
changed. It never reads garbage and never returns silently-empty buffers.

---

## 2. Where each rep's CPU geometry actually lives

Measured, per rep, by asking the accessor which field it read (`source` in the payload):

| rep | source field | payload kind |
|---|---|---|
| `cartoon` | `RepCartoon::ray` (or `preshader` before the first render — see §3) | cgo → `draw_arrays` |
| `sticks` | `RepCylBond::primitiveCGO` | cgo → `cylinders` |
| `spheres` | `RepSphere::primitiveCGO` (public header) | cgo → `spheres` |
| `lines` | `RepWireBond::primitiveCGO` | cgo → `lines` |
| `ribbon` | `RepRibbon::primitiveCGO` | cgo → `lines` |
| `nonbonded` | `RepNonbonded::primitiveCGO` | cgo → `crosses` |
| `nb_spheres` | `RepNonbondedSphere::primitiveCGO` | cgo → `spheres` |
| `ellipsoids` | `RepEllipsoid::ray` (or `std`) | cgo → `ellipsoids` |
| `surface` | `RepSurface::{V,VN,VC,VA,VAO,T,AT,Vis}` | `surface` (indexed mesh) |
| `mesh` | `RepMesh::{N,V,VC}` | `mesh` (line strips) |
| `dots` | `RepDot::V` (run-length stream) | `dots` |

### 2.1 The exact CGO op histogram of every supported rep (1UBQ / 1EJG)

The payload always returns `ops` (opcode → count) and `unhandled_ops`. **`unhandled_ops` is empty
for every supported rep** — nothing is dropped silently.

```
sticks      RepCylBond::primitiveCGO         {'COLOR': 718, 'ALPHA': 1, 'PICK_COLOR': 718, 'SHADER_CYLINDER_WITH_2ND_COLOR': 718}
spheres     RepSphere::primitiveCGO          {'COLOR': 660, 'SPHERE': 660, 'ALPHA': 660, 'PICK_COLOR': 660}
lines       RepWireBond::primitiveCGO        {'BEGIN': 1, 'END': 1, 'COLOR': 718, 'PICK_COLOR': 718, 'SPECIAL': 1, 'SPECIAL_WITH_ARG': 2, 'SPLITLINE': 718}
ribbon      RepRibbon::primitiveCGO          {'BEGIN': 1, 'END': 1, 'COLOR': 75, 'ALPHA': 1, 'PICK_COLOR': 75, 'SPECIAL': 1, 'SPECIAL_WITH_ARG': 2, 'SPLITLINE': 75}
cartoon     RepCartoon::preshader            {'COLOR': 28, 'ALPHA': 28, 'DRAW_ARRAYS': 135, 'PICK_COLOR': 140}
nonbonded   RepNonbonded::primitiveCGO       {'BEGIN': 1, 'END': 1, 'COLOR': 1, 'PICK_COLOR': 58, 'SPECIAL': 1, 'SPECIAL_WITH_ARG': 2, 'VERTEX_CROSS': 58}
nb_spheres  RepNonbondedSphere::primitiveCGO {'COLOR': 58, 'SPHERE': 58, 'ALPHA': 58, 'PICK_COLOR': 58}
ellipsoids  RepEllipsoid::ray                {'COLOR': 367, 'ELLIPSOID': 367, 'PICK_COLOR': 367}
```

Note that **the cartoon preshader already contains `CGO_DRAW_ARRAYS`**, not `BEGIN`/`VERTEX`/`END`:
`RepCartoonNew` calls `CGOCombineBeginEnd(&preshadercgo)` when `has_begin_end`
(`packages/engine/layer2/RepCartoon.cpp:4292-4294`). That is exactly the block the plan says to emit verbatim, and
it is emitted verbatim.

---

## 3. Never reading a VBO — the two traps, and proof they are handled

`packages/engine/layer1/CGO.h:183-186`: once a CGO has been uploaded, the CPU copy is deliberately dropped. The
accessor only ever reads the *primitive* CGO each rep keeps for the ray tracer, and reports
`status: "vbo-only"` if only GPU buffers remain. Two specific hazards were called out in the task:

**Trap 1 — `RepCartoonCGOGenerate` calls `disposePreshaderCGO()`** (`packages/engine/layer2/RepCartoon.cpp:240`).
Reading the implementation (`:80-89`) shows it does not free the preshader when `ray` is null —
it **moves** it: `std::swap(ray, preshader)`. So the primitive geometry survives a GL render under
a different name. The accessor reads `ray ? ray : preshader` and reports which one it used.

**Trap 2 — `Rep::update` on worker threads when `async_builds` is on.** The accessor is a
`_cmd` entry point and follows the same "API is locked" contract as every other `Cmd*` function;
the bridge must call it from the engine thread with the API lock held (§7).

### 3.1 Empirically: the payload is byte-identical before and after 30 real GL frames

Run on the headless CGL + FBO context from `spikes/picking.md` §3 (`GL: ('Apple', 'Apple M4 Max',
'2.1 Metal - 89.4')`, `use_shaders=on`, so the reps genuinely were converted to VBOs):

```
--- BEFORE any GL draw (reps built by refresh) ---
  cartoon  ok  RepCartoon::ray              draw_arrays=135/6724v
  surface  ok  surface n_vert=5235 n_tri=10472
  sticks   ok  RepCylBond::primitiveCGO     cylinders=718

--- 30 real p.draw() frames (this is what converts CGOs to VBOs) ---
  30 frames in 0.016 s ; use_shaders=on

--- AFTER GL draws ---
  cartoon  ok  RepCartoon::ray              draw_arrays=135/6724v   (0.0002 s)
           identical to pre-draw payload: True
  surface  ok  surface n_vert=5235 n_tri=10472   (0.0000 s)
           identical to pre-draw payload: True
  sticks   ok  RepCylBond::primitiveCGO     cylinders=718   (0.0000 s)
           identical to pre-draw payload: True

--- verify the frame really rendered (not a fill) ---
  unique RGB values in framebuffer: 44781
```

---

## 4. Instance buffers, never tessellation

`CGO_SPHERE`, `CGO_SHADER_CYLINDER`, `CGO_SHADER_CYLINDER_WITH_2ND_COLOR`, `CGO_CYLINDER`,
`CGO_SAUSAGE`, `CGO_CUSTOM_CYLINDER[_ALPHA]`, `CGO_CONE`, `CGO_ELLIPSOID` and `CGO_VERTEX_CROSS`
are decoded into flat typed instance buffers. Nothing is expanded into triangles.

```
1UBQ sticks : cylinders n=718
  first origin=[27.34, 24.43, 2.614]  axis=[-1.074, 0.983, 0.228]  radius=0.2500  cap=15
  pick1[0:3]=[[0, 0], [1, 1], [1, 2]]   rgba1[0]=[0.2, 0.2, 1.0, 1.0]
  cylinder[0].origin == coord of atom pick1[0] (N): True
```

Compare with the exporters on the same scene (spike 03 §4): `.wrl` emits **1,127 `Cylinder{}`
nodes** for the same 718 bonds (half-bonds are split), `.obj` emits **0 bytes**, and `.dae` emits
**1,127 separate `<geometry>` nodes / 4.5 MB**.

`mesh` and `dots` never enter the CGO path at all — they are read from `RepMesh::{N,V,VC}` and
`RepDot::V` as line strips and points:

```
mesh    ok  mesh n_vert=32252 n_strip=542 (NO cylinders emitted)
dots    ok  dots n_vert=38567
```

(38,567 is exactly the sphere count the exporters produce for the same rep — spike 03 §4 —
so no dot is lost; they are simply points instead of 658 MB of `.dae` spheres.)

`CGO_VERTEX_CROSS` is emitted as a **centre point** plus the `nonbonded_size` setting, so the
client expands it to three axis-aligned segments exactly as `CGORenderRay` does
(`packages/engine/layer1/CGO.cpp:5879-5896`):

```
nonbonded: status=ok crosses.n=58 nonbonded_size=0.250 begin_end=0 unhandled={}
  xyz[0:2] = [[45.747, 30.081, 19.708], [19.168, 31.868, 17.050]]
  pick[0:2]= [[602, -1], [603, -1]]
  cross[0].xyz == coord of atom pick[0] (O HOH77): True
```

---

## 5. Correctness — agreement with `cmd.get_vrml(2)`

### 5.1 Triangle counts, three structures, both triangle reps

```
pdb    rep         atoms   acc_tris    acc_bytes      acc_s   vrml_bytes    vrml_s
1UBQ   cartoon       660       6454       318752      0.000      1722443     0.014   vrml_tris=6454  MATCH=True
1UBQ   surface       660      10472       356004      0.000      2818393     0.024   vrml_tris=10472  MATCH=True
4HHB   cartoon      4779      72464      3520256      0.001     20059100     0.165   vrml_tris=72464  MATCH=True
4HHB   surface      4779      67162      2283420      0.000     18582783     0.150   vrml_tris=67162  MATCH=True
1AON   cartoon     58870     860040     41997952      0.008    245985071     1.950   vrml_tris=860040  MATCH=True
1AON   surface     58870     905126     30764472      0.003    259085998     2.095   vrml_tris=905126  MATCH=True
```

`acc_tris` for `cartoon` is derived from the `CGO_DRAW_ARRAYS` GL modes actually present
(`GL_TRIANGLE_STRIP` → `nverts − 2`, `GL_TRIANGLE_FAN` → `nverts − 2`, `GL_TRIANGLES` → `nverts/3`);
on 1UBQ the modes are `{GL_TRIANGLE_STRIP: 6564 verts, GL_TRIANGLE_FAN: 160 verts}` → 6,454
triangles. 860,040 for 1AON cartoon is the same number spike 03 §0 measured out of `get_vrml(2)`.

### 5.2 Not just counts — the actual coordinates

`get_vrml` emits **camera space** (`SceneRay` applies the view matrix), the accessor emits **model
space**. Applying `cmd.get_view()`'s rotation about `get_view()[12:15]` puts them in the same frame;
the residual centroid offset is `[0, 0, -4e-06]`. Triangles were then lexicographically ordered on
both sides, corner order canonicalised, and compared element-wise:

```
=== surface : 10472 triangles both sides ===
  max |accessor - get_vrml| per coordinate : 0.000012 A
  mean|accessor - get_vrml|                : 0.00000152 A
  triangles agreeing to 1e-3 A             : 10472 / 10472

=== cartoon : 6454 triangles both sides ===
  max |accessor - get_vrml| per coordinate : 0.000011 A
  mean|accessor - get_vrml|                : 0.00000148 A
  triangles agreeing to 1e-3 A             : 6454 / 6454
```

`get_vrml` prints 4 decimals, so ~1e-4 Å is its own quantisation floor. **The two agree to within
the exporter's printing precision.**

### 5.3 The accessor's surface is *indexed*; the exporter's is not

`get_vrml(2)` emits 31,416 `point[]` entries for 10,472 triangles — 3 unduplicated corners each.
The accessor emits **5,235 unique vertices** plus a 3×10,472 `int32` index buffer, a **6× vertex
reduction**, and that is why the binary payload is 356 KB against 2.8 MB of ASCII.

### 5.4 Atom mapping is real

`RepSurface::AT[v]` is a 0-based index into the object's `AtomInfo` array (it is fed straight into
`AtomInfoIsMasked(obj, I->AT[idx])` at `packages/engine/layer2/RepSurface.cpp:402`). Verified against
`cmd.get_model()`:

```
atom-index sanity (surface):
  vertex     0 -> AT=   0  A/MET1/N     dist(vertex,atom)=1.550 A (vdw=1.55)
  vertex  1000 -> AT= 115  A/LEU15/CD1  dist(vertex,atom)=2.109 A (vdw=1.70)
  vertex  5000 -> AT= 589  A/ARG74/NE   dist(vertex,atom)=1.550 A (vdw=1.55)
```

Two of the three sit exactly at the atom's van der Waals radius, which is what a solvent-excluded
surface vertex assigned to its closest atom should do.

### 5.5 Data no exporter carries

```
opaque                     alpha_buf=False  n=0      unique_alpha=-                        default_alpha=1.00
global transparency 0.5    alpha_buf=False  n=0      unique_alpha=-                        default_alpha=0.50
per-atom transparency 0.8  alpha_buf=True   n=5235   unique_alpha=[0.2, 0.5]               default_alpha=0.50
get_vrml(2) mentions 'transparency': 0 times   (spike 03 s0 item 2)
ambient_occlusion_mode=1  ao_buf=True n=5235 range=(0.009,0.771)
```

Note the semantics: PyMOL only materialises `RepSurface::VA` when transparency varies per atom. A
uniform transparency is carried in `default_alpha` instead, so the client must use
`alpha[i] if alpha else default_alpha`.

Colours are per-vertex and include `surface_color_smoothing` interpolation — colouring resi 1-20 red
and 21-76 blue produced **17** distinct vertex colours, not 2.

### 5.6 The rep the exporters throw away

1EJG has 367 `ANISOU` records. Spike 03 §4.1 measured: ray tracer *"processed 367 graphics
primitives"*, `.wrl` 234 bytes, `.pov` 0 bytes, `.obj` 0 faces, `.dae` 0 geometry nodes.

```
ellipsoids  ok  0.0003s  RepEllipsoid::ray  ellipsoids=367
```

---

## 6. Performance

Wall-clock for the accessor call only, all reps built beforehand, headless, single call:

| structure | rep | accessor | `get_vrml(2)` | speed-up |
|---|---|---|---|---|
| 1UBQ (660 at.) | cartoon | 0.0001 s | 0.014 s | 140× |
| 1UBQ | surface | &lt; 0.0001 s | 0.024 s | > 240× |
| 4HHB (4,779 at.) | cartoon | 0.001 s | 0.165 s | 165× |
| 4HHB | surface | &lt; 0.001 s | 0.150 s | > 150× |
| **1AON (58,870 at.)** | **cartoon** | **0.008 s** | **1.950 s** | **244×** |
| **1AON** | **surface** | **0.003 s** | **2.095 s** | **698×** |

Payload size (sum of all `bytes` buffers) vs the ASCII the exporter produces for the same scene:

| structure | rep | accessor | `.wrl` | ratio |
|---|---|---|---|---|
| 1AON | cartoon | 42.0 MB | 246.0 MB | 5.9× |
| 1AON | surface | 30.8 MB | 259.1 MB | 8.4× |

Spike 03 §7 measured that parsing the 246 MB of 1AON cartoon VRML costs **2.25 s and 1.77 GB RSS**
in V8. The 42.0 MB the accessor returns is already `float32`/`int32` and needs **no parsing at
all** — it is `bytes` that the bridge forwards straight into a `Float32Array` view.

Both numbers still argue for the plan's incremental strategy: 42 MB is a lot to push per frame, so
the client must cache on `key` and only re-fetch on a `ReprVersion` bump (plan §4 task 6). The
accessor makes that cheap because the payload is already keyed and self-describing.

---

## 7. The Python API

```python
d = _cmd.web_get_rep_geometry(_self._COb, object_name, state, rep, update=1)
```

* `object_name` — molecular objects only; anything else returns `status: "unsupported"`.
* `state` — 0-indexed, or `-1` for the object's current state (resolved via
  `CObject::getCurrentState()`, so `static_singletons` is honoured). The resolved value comes back
  in the payload.
* `rep` — a name (`"cartoon"`, `"surface"`, `"sticks"`, `"nb_spheres"`, …; singular aliases
  accepted) **or** an integer `cRep_t`. An unknown name or an out-of-range index raises
  `CmdException`.
* `update` — when true, runs `SceneUpdate(G, false)` first. That is what `cmd.refresh()` and the
  exporters do, and spike 03 §2 established it builds rep geometry with **no GL context**.

**Locking.** Like every other `_cmd` entry point, it assumes the API lock is held. Callers do:

```python
cmd.lock(_self=cmd)
try:
    d = cmd._cmd.web_get_rep_geometry(cmd._COb, "1ubq", 0, "surface", 1)
finally:
    cmd.unlock(-1, _self=cmd)
```

It uses the *blocked* entry convention (the GIL is retained) because it builds large `PyObject`s.

### 7.1 Status vocabulary

| `status` | meaning |
|---|---|
| `ok` | geometry follows |
| `not-built` | rep is not shown, or there is no coordinate set for that state |
| `empty` | rep is built but produced no geometry (e.g. `ellipsoids` with no `ANISOU`) |
| `vbo-only` | only GPU buffers remain; the CPU copy was dropped on upload |
| `unsupported` | no accessor for this rep or object type / no such object |
| `layout-mismatch` | an upstream `Rep` struct moved under a layout mirror; nothing was read |

Observed:

```
('nosuchobject', 'cartoon', 0) -> unsupported  no such object
('a', 'cartoon', 7)            -> not-built    no coordinate set for this state
('a', 'surface', 0)            -> not-built    rep is not shown or not built for this object/state
rep='bogusrep'                 -> CmdException:  Error: web_get_rep_geometry: unknown rep 'bogusrep'
rep=99                         -> CmdException:  Error: web_get_rep_geometry: rep index 99 out of range
labels                         -> unsupported   rep 'labels' has no CPU-side geometry accessor
ellipsoids (1UBQ, no ANISOU)   -> empty         CGO contains no geometry ops we can extract
```

Multi-state, 3 states:

```
  state=-1  -> key=s|sticks|0     status=ok         cylinders=718
  state=0   -> key=s|sticks|0     status=ok         cylinders=718
  state=1   -> key=s|sticks|1     status=ok         cylinders=718
  state=2   -> key=s|sticks|2     status=ok         cylinders=718
  state=9   -> key=s|sticks|9     status=not-built  cylinders=-
```

### 7.2 Payload shape

Always present:

```
key            "1ubq|surface|0"     -- the client cache key
object, rep, rep_index, state, n_atom
status, message, ok, kind
```

`kind == "surface"` — indexed triangle mesh:

| field | type | size |
|---|---|---|
| `n_vert`, `n_tri` | int | |
| `vertex`, `normal` | `bytes` f32 | `3·n_vert` |
| `index` | `bytes` i32 | `3·n_tri` |
| `atom` | `bytes` i32 | `n_vert` — 0-based atom index, `-1` if none |
| `visible` | `bytes` i32 | `n_vert` |
| `color` | `bytes` f32 or `None` | `3·n_vert`; `None` when `one_color_flag`, then use `rgb` |
| `alpha`, `ao` | `bytes` f32 or `None` | `n_vert` |
| `one_color_flag`, `rgb`, `default_alpha`, `surface_mode`, `surface_type` | | |

`kind == "cgo"` — instance buffers plus verbatim vertex arrays:

| bucket | fields |
|---|---|
| `spheres` | `n`, `xyzr` (f32 4n), `rgba` (f32 4n), `pick` (i32 2n) |
| `cylinders` | `n`, `origin_axis_radius` (f32 7n), `cap` (i32 n), `rgba1`/`rgba2` (f32 4n), `pick1`/`pick2` (i32 2n) |
| `cones` | `n`, `v1v2_r1r2` (f32 8n), `cap` (i32 2n), `rgba1`/`rgba2`, `pick` |
| `ellipsoids` | `n`, `xyzr` (f32 4n), `axes` (f32 9n), `rgba`, `pick` |
| `triangles` | `n`, `vertex` (f32 9n), `normal` (f32 9n), `rgba` (f32 12n), `pick` |
| `lines` | `n`, `vertex` (f32 6n), `rgba1`/`rgba2`, `pick1`/`pick2` |
| `crosses` | `n`, `xyz` (f32 3n), `rgba`, `pick` — expand with `nonbonded_size` |
| `draw_arrays` | list of `{mode, arraybits, nverts, vertex, normal, rgba, pick, accessibility}` |
| `begin_end` | densified `CGO_BEGIN..CGO_END` runs, same shape minus `arraybits` |
| `ops`, `unhandled_ops`, `vbo_ops`, `source`, `nonbonded_size` | diagnostics |

`draw_arrays` block layout mirrors `packages/engine/layer1/CGO.cpp:1645-1672` exactly: vertex `3·nverts`, normal
`3·nverts`, colour `4·nverts` (RGBA), then a packed-RGBA slot of `1·nverts` that is **skipped**
(it is regenerated at pick time), then `2·nverts` of `(atom index, bond)` returned as `int32`,
then accessibility `1·nverts`.

`kind == "mesh"` — `n_vert`, `n_strip`, `strips` (i32, per-strip vertex counts), `vertex` (f32 3n),
`color`/`rgb`/`one_color_flag`, `mesh_type` (`cIsomeshMode`: 0 = isomesh/line strips, 1 = isodot).

`kind == "dots"` — `n_vert`, `vertex`/`normal`/`color` (f32 3n each), `atom` (i32 n or `None`),
`dot_size`, `width`. In the normal (rendering) flavour `RepDot::V` is a run-length encoded
interleaved stream `[count, r, g, b, (nx ny nz x y z)*count]…` (`packages/engine/layer2/RepDot.cpp:402-425`) and
`Atom` is null; the accessor decodes the stream into flat arrays. Only the `cRepDotAreaType` flavour
carries a per-dot atom index.

---

## 8. Upstream-merge surface

`packages/engine/layer4/Cmd.cpp` gains **7 lines and loses none**, in two sentinel-marked regions:

```diff
+/* tenmol web client -- BEGIN (WP-26; impl in packages/engine/layer4/CmdWebGeometry.cpp) */
+PyObject* CmdWebGetRepGeometry(PyObject* self, PyObject* args);
+/* tenmol web client -- END */
+
 static PyMethodDef Cmd_methods[] = {
@@
   {"get_feedback", CmdGetFeedback, METH_VARARGS},
+  /* tenmol web client -- BEGIN */
+  {"web_get_rep_geometry", CmdWebGetRepGeometry, METH_VARARGS},
+  /* tenmol web client -- END */
   {"get_idtf", CmdGetIdtf, METH_VARARGS},
```

Two regions rather than one is a hard C++ constraint: a forward declaration cannot live inside an
array initialiser. Both are `grep`-able on `tenmol web client`.

`packages/engine/layer4/CmdWebGeometry.cpp` is a file upstream does not have and can never conflict.
**No build-file change was needed** — the build succeeded on the first attempt, confirming
`setup.py:808-816`'s `packages/engine/layer4/*.cpp` glob.

### 8.1 What to check at each upstream merge

Run `wp26/probe_reps.py`. If any rep reports `layout-mismatch`, re-diff the corresponding struct
against `namespace mirror` in `CmdWebGeometry.cpp`. The mirrored structs, with their upstream
homes, are listed in one block at the top of the file:

| mirror | upstream |
|---|---|
| `mirror::RepSurface` | `packages/engine/layer2/RepSurface.cpp:59-100` |
| `mirror::RepCartoon` | `packages/engine/layer2/RepCartoon.cpp:65-91` |
| `mirror::RepCylBond` | `packages/engine/layer2/RepCylBond.cpp:39-49` |
| `mirror::RepWireBond` | `packages/engine/layer2/RepWireBond.cpp:34-45` |
| `mirror::RepRibbon` | `packages/engine/layer2/RepRibbon.cpp:37-50` |
| `mirror::RepNonbonded` | `packages/engine/layer2/RepNonbonded.cpp:33-44` |
| `mirror::RepNonbondedSphere` | `packages/engine/layer2/RepNonbondedSphere.cpp:35-44` |
| `mirror::RepEllipsoid` | `packages/engine/layer2/RepEllipsoid.cpp:33-44` |
| `mirror::RepMesh` | `packages/engine/layer2/RepMesh.cpp:39-63` |

A cleaner permanent fix, if the project ever decides to carry a larger patch (plan §8 decision 6),
is a one-line accessor on each rep or moving those structs into their headers. That would delete
`namespace mirror` entirely. It is deliberately *not* done here because this work package does not
own `packages/engine/layer2/`.

---

## 9. Reproducing

Build (identical to `spikes/build.md` §3, no additional flags):

```bash
SCRATCH=/private/tmp/claude-501/-Users-amirangel-Documents-GitHub-tenmol/177b7067-f921-4a11-839c-84d8a16f6415/scratchpad
cd /Users/amirangel/Documents/GitHub/tenmol
PREFIX_PATH="/opt/homebrew:/opt/homebrew/opt/libxml2:$SCRATCH/deps/mmtf-cpp" \
MACOSX_DEPLOYMENT_TARGET=15.0 \
"$SCRATCH/venv/bin/pip" install -v --no-build-isolation \
  --config-settings use-msgpackc=c++11 .
rm -rf packages/engine/modules/pymol.egg-info      # pip leaves this behind, it is not gitignored
```

Probes (all in `<scratch>/wp26/`, combined transcript in `<scratch>/wp26/ALL.txt`):

| script | what it proves |
|---|---|
| `probe_headless.py` | cartoon + surface + sticks in one scene, buffer lengths, real vertices, VRML triangle-count cross-check |
| `probe_reps.py` | every rep one at a time on 1UBQ and 1EJG; atom-index sanity against `cmd.get_model()` |
| `probe_gl.py` | payload identical before/after 30 real `p.draw()` frames on a CGL+FBO context |
| `probe_scale.py` | 1UBQ/4HHB/1AON timing + payload size vs `get_vrml(2)`; error paths; multi-state |
| `probe_content3.py` | per-triangle coordinate agreement with `get_vrml(2)` after the model→camera transform |
| `probe_alpha2.py` | per-vertex alpha and ambient occlusion, which every exporter drops |
| `probe_ops.py` | CGO opcode histogram per rep; `unhandled_ops` empty everywhere |

Regression:

```bash
$ venv/bin/pymol -ckq packages/engine/testing/testing.py --run all      # from the repo root
Ran 961 tests in 5.458s
FAILED (failures=1, errors=1, skipped=276)
======================== 57 passed, 31 skipped in 0.21s ========================
```

Identical to the `spikes/build.md` §0 baseline (`testglTF` needs an external `collada2gltf`
binary; `symop_py` is a pre-existing upstream failure). `git status --porcelain` shows only
`M packages/engine/layer4/Cmd.cpp` and `?? packages/engine/layer4/CmdWebGeometry.cpp` from this work package.

---

## 10. Known gaps, stated rather than hidden

1. **`labels` are not extracted.** `RepLabel::shaderCGO` is the only geometry and it is built at
   render time from a texture atlas; there is no primitive CGO. The accessor returns
   `status: "unsupported"`. Mode P must render labels, or a future task must emit
   `RepLabel::labelV` (positions + `lexidx_t` text ids) plus the glyph metrics.
2. **`slice`, `volume`, `cell`, `cgo`, `callback`, `dashes`, `angles`, `dihedrals`** are likewise
   `unsupported`. `dashes`/`angles`/`dihedrals` hang off `DistSet`, not `CoordSet`, so they need a
   different lookup path; `cell`/`cgo`/`slice`/`volume` hang off non-molecular objects.
   All of them are a bounded follow-up, not a design problem.
3. **Non-molecular objects** (`ObjectSurface`, `ObjectMesh`, `ObjectMap`, `ObjectCGO`) return
   `unsupported`. `cmd.dump()` already covers isosurface/isomesh (spike 03 §3).
4. **Pick *colours* remain unshippable** (plan §1.4); only the `(atom index, bond)` pair is
   exported. That is what the client needs anyway, and it is present on every bucket.
5. **No dirty tracking yet.** Every call re-reads the rep. That is 3-8 ms on 1AON, so polling is
   viable, but the `ReprVersion` counter of plan §4 task 6 is what makes it free.
6. **`CGO_ALPHA_TRIANGLE`** (35 floats, transparency-sorted triangles) is counted in
   `unhandled_ops` rather than decoded. It did not appear in any rep measured here; if it shows up,
   the histogram will say so instead of dropping it silently.
