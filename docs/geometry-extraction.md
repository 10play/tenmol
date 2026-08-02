# Geometry Extraction — Feasibility Study

**Area:** `geometry-extraction`
**Repo:** `/Users/amirangel/Documents/GitHub/tenmol` (PyMOL open-source fork "tenmol")
**Question:** can PyMOL's *already-computed* render geometry be pulled out of the C++ backend and shipped
to a browser so that three.js draws it, without three.js recomputing representations from atoms?

Everything below is grounded in files that were actually read. Every claim carries a `file:line`.
Where I could not confirm something by reading code, I say so explicitly.

---

## 0. TL;DR

* **YES**, PyMOL keeps a complete, CPU-resident, GL-free description of every representation's geometry.
  It lives in two forms: (a) plain `std::vector<float>` triangle soup for surfaces
  (`packages/engine/layer2/RepSurface.cpp:71-83`), and (b) **CGO** buffers — a flat `float*` bytecode with a documented
  opcode set — for every other rep (`packages/engine/layer1/CGO.h:82-270`, `packages/engine/layer1/CGO.h:765-773`).
* **NO**, none of that is exposed to Python today for molecular reps. The only Python-visible geometry
  exports are `cmd.get_vrml / get_collada / get_idtf / get_povray / get_mtl_obj / get_gltf`
  (`packages/engine/modules/pymol/exporting.py:1012-1019`), and **all six of them route through the ray tracer**
  (`packages/engine/layer1/SceneRay.cpp:336-491`), not through the GL/CGO buffers. They are ASCII, per-primitive,
  camera-space, lossy, and multi-second. None is usable as an interactive feed.
* The **exception** is surfaces: `cache_mode >= 2` already serializes the surface triangle mesh
  `(N, V, VN, NT, T, S)` into a Python tuple that lands in `pymol._cache`
  (`packages/engine/layer2/RepSurface.cpp:3217-3229`, `packages/engine/layer2/RepSurface.cpp:4559-4574`, `packages/engine/modules/pymol/internal.py:101`).
  That is a real, existing, zero-new-C++ path to a surface mesh — but Python lists of boxed floats, and
  no colors.
* The correct engineering answer is a **new pybind/CPython accessor** that walks
  `CoordSet::Rep[cRepCnt]` (`packages/engine/layer2/CoordSet.h:107`), runs the existing CPU tessellators
  `CGOSimplify()` (`packages/engine/layer1/CGO.cpp:4444`) + `CGOCombineBeginEnd()` (`packages/engine/layer1/CGO.cpp:1539`), and hands
  back the resulting `CGO_DRAW_ARRAYS` float blocks as **raw `PyBytes`** using the primitive that
  already exists for `pse_binary_dump`: `PConvFloatArrayToPyList(f, l, dump_binary=true)` →
  `PyBytes_FromStringAndSize` (`packages/engine/layer1/PConv.cpp:971-977`). That block is *literally* a three.js
  `BufferGeometry`.
* **Visual parity is achievable for the interactive (GL) viewport and NOT for ray tracing.** See §8.

---

## 1. The two geometry pipelines inside PyMOL

PyMOL has three renderers behind one `Rep::render(RenderInfo*)` virtual (`packages/engine/layer1/Rep.h:198`):

| Renderer | Selected by | Consumes | Where geometry lives |
|---|---|---|---|
| GL / shader | `info->ray == nullptr && info->pick == nullptr`, `G->HaveGUI && G->ValidContext` | `renderCGO` / `shaderCGO` / `std` | **GPU VBOs**, CPU copy discarded |
| Ray tracer | `info->ray != nullptr` | `primitiveCGO` / `preshader` / `ray` / raw `V[]` | **CPU**, permanent |
| Picking | `info->pick != nullptr` | `pickingCGO` | GPU |

The critical structural fact, verified in `packages/engine/layer2/RepSphere.cpp:149-207`: `renderCGO` is generated
**lazily inside `render()` and only when `G->HaveGUI && G->ValidContext`** (line 164). The
build-time artifact (`primitiveCGO`) is generated in `RepSphereNew` (`packages/engine/layer2/RepSphere.cpp:523-582`)
with **no GL involvement at all**.

Same shape for cartoon: `I->preshader` is built in `RepCartoonNew`
(`packages/engine/layer2/RepCartoon.cpp:4287-4300`) with no GL, then consumed and destroyed by
`RepCartoonCGOGenerate()` at first GL render (`packages/engine/layer2/RepCartoon.cpp:263-274`, dispose at `:240`).
Note the salvage path `RepCartoon::disposePreshaderCGO()` (`packages/engine/layer2/RepCartoon.cpp:83-89`): if
`ray` is null the preshader is *moved into* `ray` rather than freed — so in a ray-capable build the
CPU cartoon geometry survives GL upload.

### Where the CPU copy is lost

`OptimizeVertsToVBONotIndexed()` builds an interleaved `std::vector<float> vertexValsVec(tot)` on the
stack (`packages/engine/layer1/CGO.cpp:2947-2948`), fills it via `CGOProcessCGOtoArrays()` (`:2968`), uploads with
`SetVertexBufferData()` (`:2998`), and lets the vector die at scope exit. `packages/engine/layer1/CGO.h:183-186`
states this explicitly: *"the geometry data is not kept in the CGO object for VBO objects (only on the
card)"* — which is why `CGO_BOUNDING_BOX` exists at all.

**Conclusion: do not try to read back VBOs. Read the pre-VBO CPU CGO.**

### The point in the pipeline where CPU geometry is complete

`SceneUpdate(G, force)` (`packages/engine/layer1/Scene.cpp:4664`) drives `obj->update()` for every object
(`packages/engine/layer1/Scene.cpp:4757-4760` single-threaded branch, `:4745-4751` threaded branch), which reaches
`Rep::update()` → `Rep::rebuild()` → `fNew(cs, state)` (`packages/engine/layer1/Rep.cpp:42-57, 65-101`).
**After `SceneUpdate` returns, every Rep's CPU geometry is final and no GL context was required.**
`cmd.rebuild()` (`packages/engine/modules/pymol/viewing.py:1837-1866` → `_cmd.rebuild`) and
`cmd.refresh()` (`packages/engine/modules/pymol/viewing.py:1750-1772`) are the Python triggers.

---

## 2. Per-Rep geometry inventory (what each Rep actually produces)

Enumerated from `enum cRep_t` (`packages/engine/layer1/Rep.h:48-74`). Reps live in `CoordSet::Rep[cRepCnt]` with an
`Active[cRepCnt]` flag array (`packages/engine/layer2/CoordSet.h:107-108`).

### cRepSurface (2) — `packages/engine/layer2/RepSurface.cpp:59-101`
The richest and easiest target. **All arrays are `std::vector` members, CPU-resident, never freed
after GL upload:**

| Field | Line | Meaning | Size |
|---|---|---|---|
| `N` | `:71` | vertex count | — |
| `NT` | `:72` | triangle count | — |
| `V` | `:74` | vertex positions | `3*N` floats |
| `VN` | `:75` | vertex normals | `3*N` floats |
| `VC` | `:76` | vertex colors RGB | `3*N` floats |
| `VA` | `:77` | per-vertex alpha | `N` floats |
| `VAO` | `:78` | per-vertex ambient occlusion | `N` floats |
| `RC` | `:79` | ramp color indices | ints |
| `Vis` | `:80` | per-vertex visibility flag | `N` ints |
| `T` | `:81` | triangle indices | `3*NT` ints |
| `S` | `:82` | triangle-strip lengths | ints |
| `AT` | `:83` | closest atom per vertex | `N` ints |
| `proximity` | `:73` | `surface_proximity` setting | bool |
| `oneColorFlag` / `oneColor` | `:84-85` | single-color fast path | — |

`T` is produced by `TrianglePointsToSurface()` (`packages/engine/layer2/RepSurface.cpp:4035-4036`, declared
`packages/engine/layer0/Triangle.h:25-27`). Colors `VC`/`VA`/`RC` are (re)computed in `RepSurface::recolor()`
(`packages/engine/layer2/RepSurface.cpp:2363`). Per-triangle culling uses
`visibility_test(proximity, Vis, &T[3i])` (`packages/engine/layer2/RepSurface.cpp:209-216`) — the client MUST replicate
this or it will draw hidden surface patches.

**Direct three.js mapping:** `V` → `position`, `VN` → `normal`, `VC`+`VA` → `color` (RGBA),
`T` → index buffer, `VAO` → custom attribute, `AT` → picking id attribute. Nothing to recompute.

### cRepSphere (1) — `packages/engine/layer2/RepSphere.h:29-40`
`primitiveCGO` (`:38`) holds `CGO_SPHERE` ops (center xyz + radius) interleaved with `CGO_COLOR`,
`CGO_ALPHA`, `CGO_PICK_COLOR` (`packages/engine/layer2/RepSphere.cpp:290-313`). Built GL-free at
`packages/engine/layer2/RepSphere.cpp:523-582`. `spheroidCGO` (`:39`) is the anisotropic-spheroid variant built by
`RepSphereGeneratespheroidCGO()` (`packages/engine/layer2/RepSphere.cpp:366`) which emits real triangles.
GL path forks on `sphere_mode` (`packages/engine/layer2/RepSphereGenerate.cpp:24-102`):
- mode 9 (default) → GLSL impostor quads, `CGOOptimizeSpheresToVBONonIndexed` (`packages/engine/layer1/CGO.cpp:4357`)
- mode 0 / cube / tetrahedron → real triangles via `CGOSimplify(primitiveCGO, 0, sphere_quality)` (`packages/engine/layer2/RepSphereGenerate.cpp:36`)
- modes 1,2,3,6,7,8 → point sprites, `CGOConvertSpheresToPoints` (`packages/engine/layer2/RepSphereGenerate.cpp:75`)

### cRepCyl (0, sticks) — `packages/engine/layer2/RepCylBond.cpp:39-49`
`primitiveCGO` (`:47`) built GL-free (`packages/engine/layer2/RepCylBond.cpp:635` alloc, `:903` `CGOStop`). Contains
`CGO_SHADER_CYLINDER` / `CGO_SHADER_CYLINDER_WITH_2ND_COLOR` / `CGO_SPHERE` (for zero-order bond
dots, `:798`) plus color/alpha/pickcolor. `RepCylinder()` helper documented at `:51-68`.

### cRepCartoon (5) — `packages/engine/layer2/RepCartoon.cpp:65-92`
`preshader` (`:77`) is the CPU CGO. Built by `GenerateRepCartoonCGO()`
(`packages/engine/layer2/RepCartoon.cpp:4287-4290`), then immediately normalized with `CGOCombineBeginEnd()`
(`packages/engine/layer2/RepCartoon.cpp:4292-4294`) — meaning **cartoon geometry is already in `CGO_DRAW_ARRAYS`
interleaved-array form before anything GL happens.** The actual extrusion emits
`GL_TRIANGLE_STRIP` / `GL_TRIANGLE_FAN` / `GL_LINE_STRIP` blocks in `packages/engine/layer1/Extrude.cpp`
(`:839, :932, :1036, :1129, :1363, :1450, :1483, :1569, :1631, :1671, :1793, :1912, :1987, :2047, :2128, :2153`)
plus `cgo::draw::shadercylinder2ndcolor` for nucleic-acid-as-cylinders (`packages/engine/layer1/Extrude.cpp:1219`),
plus `CGOSphere` for ring centers (`packages/engine/layer2/RepCartoon.cpp:1295`) and `GL_TRIANGLES` for rings (`:1346`).

### cRepRibbon (6) — `packages/engine/layer2/RepRibbon.cpp:37-50`: `primitiveCGO` (`:48`), CPU.
### cRepLine (7, wire) — `packages/engine/layer2/RepWireBond.cpp:34-45`: `primitiveCGO` (`:43`), CPU. `CGO_LINE`/`CGO_SPLITLINE`.
### cRepNonbonded (11) — `packages/engine/layer2/RepNonbonded.cpp:33-44`: `primitiveCGO` (`:41`), CPU.
### cRepNonbondedSphere (4) — `packages/engine/layer2/RepNonbondedSphere.cpp:35-44`: `primitiveCGO` (`:43`), CPU.
### cRepEllipsoid (19) — `packages/engine/layer2/RepEllipsoid.cpp:33-44`: `ray` (`:41`) and `std` (`:42`) CGOs. `CGO_ELLIPSOID` → `CGOSimpleEllipsoid` in `CGOSimplify` (`packages/engine/layer1/CGO.cpp:4535`).
### cRepMesh (8) — `packages/engine/layer2/RepMesh.cpp:39-63`: raw `pymol::vla<float> V` (`:51`), `N` strip lengths (`:49`), `NTot` (`:50`), `VC` colors (`:52`), `Dot`/`NDot` (`:53-54`). CPU, permanent.
### cRepDot (9) — `packages/engine/layer2/RepDot.h:26-45`: `V`, `VC`, `A` (area), `VN`, `T`, `F`, `Atom` raw float/int arrays (`:34-42`). CPU, permanent.
### cRepDash (10) — `packages/engine/layer2/RepDistDash.cpp:40-55`: raw `float* V` (`:48`), `N` (`:49`). CPU.
### cRepAngle (17) — `packages/engine/layer2/RepAngle.cpp:36-50`: `pymol::vla<float> V` (`:44`). CPU.
### cRepDihedral (18) — `packages/engine/layer2/RepDihedral.cpp:35-48`: `float* V` (`:43`). CPU.
### cRepLabel (3) — `packages/engine/layer2/RepLabel.cpp:90-104`: `labelV` vector + lexer indices `L` (`:98-99`).
Geometry is **texture-atlas quads**, not mesh. Glyph bitmaps are reachable CPU-side via
`CharacterGetPixmapBuffer()` (`packages/engine/layer1/Character.cpp:122-130`) and metrics via
`CharacterGetGeometry` / `CharacterGetWidth` / `CharacterGetHeight` / `CharacterGetAdvance`
(`packages/engine/layer1/Character.h:80-85`). Ops are `CGO_DRAW_LABEL` (`packages/engine/layer1/CGO.h:224-225`) and
`CGO_DRAW_LABELS` (`:228`).
### cRepDistLabel — `packages/engine/layer2/RepDistLabel.cpp:41-56`: same texture-quad story.
### cRepCGO (13) — user CGOs. `ObjectCGOState::origCGO` (`packages/engine/layer2/ObjectCGO.h:25`) is CPU and
**already round-trips to Python** — see §3.
### cRepCallback (14) — arbitrary Python `glDraw*` callbacks. **Not extractable, by definition.**
### cRepVolume (20) / cRepSlice (16) — 3D-texture ray-marching (`packages/engine/data/shaders/volume.fs`),
not triangle geometry. Out of scope for a mesh feed.
### cRepCell (12) / cRepExtent (15) — trivial line boxes.

---

## 3. CGO — the existing serialization format (this is the wire format, already)

`class CGO` (`packages/engine/layer1/CGO.h:765-773`) is a `float* op` array of length `c`. Opcodes are
`#define`s at `packages/engine/layer1/CGO.h:82-270`, each with a fixed `_SZ` payload length. The Python-side mirror
of the opcode table already exists at `packages/engine/modules/pymol/cgo.py:21-79`.

Key opcodes for a geometry feed:

| Opcode | Value | Size | Payload |
|---|---|---|---|
| `CGO_BEGIN` | 0x02 | 1 | GL mode |
| `CGO_VERTEX` | 0x04 | 3 | xyz |
| `CGO_NORMAL` | 0x05 | 3 | xyz |
| `CGO_COLOR` | 0x06 | 3 | rgb |
| `CGO_ALPHA` | 0x19 | 1 | a |
| `CGO_SPHERE` | 0x07 | 4 | xyz + r |
| `CGO_CYLINDER` | 0x09 | 13 | — |
| `CGO_SAUSAGE` | 0x0E | 13 | — |
| `CGO_CUSTOM_CYLINDER` | 0x0F | 15 | + caps |
| `CGO_CUSTOM_CYLINDER_ALPHA` | 0x41 | — | + per-end alpha |
| `CGO_CONE` | 0x1B | 16 | — |
| `CGO_ELLIPSOID` | 0x12 | 13 | — |
| `CGO_SHADER_CYLINDER` | 0x26 | 8 | origin, axis, r, capbits |
| `CGO_SHADER_CYLINDER_WITH_2ND_COLOR` | 0x27 | 13 | + 2nd color/alpha |
| `CGO_PICK_COLOR` | 0x1F | 2 | atom index, bond index |
| `CGO_ACCESSIBILITY` | 0x29 | 1 | AO term |
| **`CGO_DRAW_ARRAYS`** | **0x1C** | var | **interleaved arrays — see below** |
| `CGO_BOUNDING_BOX` | 0x22 | 6 | min/max |

### `CGO_DRAW_ARRAYS` payload layout — the money shot

`struct cgo::draw::arrays` (`packages/engine/layer1/CGO.h:338-355`) carries `{mode, arraybits, narrays, nverts}` plus
a heap block. `CGOCombineBeginEnd()` lays that block out at `packages/engine/layer1/CGO.cpp:1645-1672`:

```
[ vertex   : 3 * nverts floats ]                     always (CGO_VERTEX_ARRAY 0x01)
[ normal   : 3 * nverts floats ]                     if CGO_NORMAL_ARRAY 0x02
[ color    : 4 * nverts floats ]  (rgb + alpha)      if CGO_COLOR_ARRAY 0x04
[ pickcolor: 3 * nverts floats ]  (1 rgba + 2 idx)   if CGO_PICK_COLOR_ARRAY 0x08
[ access   : 1 * nverts floats ]                     if CGO_ACCESSIBILITY_ARRAY 0x10
```

Sizes: `VERTEX_POS_SIZE 3` / `VERTEX_COLOR_SIZE 4` (`packages/engine/layer0/ShaderMgr.h:430-431`),
`VERTEX_NORMAL_SIZE 3` (`packages/engine/layer1/CGO.cpp:55`), `VERTEX_PICKCOLOR_SIZE = 1 + 2` and
`VERTEX_ACCESSIBILITY_SIZE 1` (`packages/engine/layer1/CGO.cpp:60-65`). Array bit flags at `packages/engine/layer1/CGO.h:272-277`.

**This is a three.js `BufferGeometry` with zero transformation.** `mode` is a raw GL enum
(`GL_TRIANGLES`, `GL_TRIANGLE_STRIP`, `GL_TRIANGLE_FAN`, `GL_LINES`, `GL_LINE_STRIP`, `GL_POINTS` —
enumerated in `packages/engine/layer1/CGO.h:68-72` and mirrored in `packages/engine/modules/pymol/cgo.py:22-27`).

### The two CPU tessellators (no GL required)

* **`CGOSimplify(const CGO*, est, sphere_quality, stick_round_nub)`** — `packages/engine/layer1/CGO.cpp:4444`.
  Converts every analytic primitive into triangles:
  `CGO_SPHERE` → `CGOSimpleSphere` (`:4533`) using `G->Sphere->Sphere[sphere_quality]`;
  `CGO_SHADER_CYLINDER` / `CGO_CYLINDER` / `CGO_SAUSAGE` / `CGO_CUSTOM_CYLINDER` /
  `CGO_CUSTOM_CYLINDER_ALPHA` → `CGOSimpleCylinder` (`:4474-4530`);
  `CGO_CONE` → `CGOSimpleCone` (`:4511`); `CGO_ELLIPSOID` → `CGOSimpleEllipsoid` (`:4536`);
  `CGO_QUADRIC` → `CGOSimpleQuadric` (`:4539`).
  It also folds `BEGIN/…/END` blocks into `CGO_DRAW_ARRAYS` (`:4550-4620`).
* **`CGOCombineBeginEnd(const CGO*, est, do_not_split_lines)`** — `packages/engine/layer1/CGO.cpp:1539`.
  BEGIN/VERTEX/END → `CGO_DRAW_ARRAYS` only (no primitive tessellation).

Both are pure CPU. Both are already called from Rep code today.

### CGO ↔ Python already exists (for ObjectCGO only)

* `CGOAsPyList(CGO*)` (`packages/engine/layer1/CGO.cpp:289-297`) → `[len, flat_float_list]`, built by
  `CGOArrayAsPyList` (`packages/engine/layer1/CGO.cpp:241-287`). **It explicitly handles `CGO_DRAW_ARRAYS`**
  (`:255-265`), flattening `{mode, arraybits, narrays, nverts}` + the data block. So the serializer
  for the exact format we want *already exists in the tree*.
* `CGONewFromPyList()` (`packages/engine/layer1/CGO.cpp:392`) is the inverse.
* Reached from Python only via session save of `ObjectCGO` (`packages/engine/layer2/ObjectCGO.cpp:43, 151`,
  `packages/engine/layer3/Executive.cpp:5407`), `GadgetSet` (`packages/engine/layer2/GadgetSet.cpp:191, 197`), and
  `CoordSet::SculptCGO` (`packages/engine/layer2/CoordSet.cpp:392-394`).
* Import side: `cmd.load_cgo(list_of_floats, name, state)` (`packages/engine/modules/pymol/importing.py:307-324`) →
  `ObjectCGOFromFloatArray` (`packages/engine/layer2/ObjectCGO.h:47`) / `CGOFromFloatArray` (`packages/engine/layer1/CGO.h:1109`).

**`cmd.get_session()` does NOT contain molecular rep geometry.** `CoordSetAsPyList`
(`packages/engine/layer2/CoordSet.cpp:364-416`) writes coords, atom index maps, settings, symmetry, and `SculptCGO` —
no `Rep[]`. Verified by reading the whole function.

### Binary blob primitive already exists

`PConvFloatArrayToPyList(const float*, int, bool dump_binary)` returns
`PyBytes_FromStringAndSize(reinterpret_cast<const char*>(f), l * sizeof(float))` when
`dump_binary` is true (`packages/engine/layer1/PConv.cpp:971-977`). Used today by `pse_binary_dump`
(`packages/engine/layer2/CoordSet.cpp:371-372, 377`). This is exactly the zero-copy-ish primitive a binary geometry
accessor needs — no new serialization machinery to invent.

Zero-copy numpy precedent: `CoordSetAsNumPyArray(cs, copy)` (`packages/engine/layer2/CoordSet.cpp:326-361`) —
with `copy == 0` it returns `PyArray_SimpleNewFromData(2, dims, typenum, cs->Coord.data())`
(`:357`), a numpy **view** onto live C++ memory. Exposed as `cmd.get_coordset(name, state, copy)`
(`packages/engine/layer4/Cmd.cpp:2033-2056`, table entry `packages/engine/layer4/Cmd.cpp:6457`).

---

## 4. Complete inventory of existing Python-exposed export paths

Registered in `savefunctions` at `packages/engine/modules/pymol/exporting.py:988-1020`.

| Python API | C impl | SceneRay mode | Output | Fidelity | Verdict |
|---|---|---|---|---|---|
| `cmd.get_vrml(version=2)` `packages/engine/modules/pymol/querying.py:632-646` | `CmdGetVRML` `packages/engine/layer4/Cmd.cpp:2675-2693` | 4 (VRML2) or 6 (VRML1) `packages/engine/layer1/SceneRay.cpp:450-475` | ASCII `.wrl` string | **Best text export.** Triangles → `IndexedFaceSet` with per-vertex color AND per-vertex normal (`packages/engine/layer1/Ray.cpp:1350-1390`). Spheres → VRML `Sphere` node with diffuse color (`:1398-1415`). Cylinders/sausages → `Cylinder` node (`:1419-1430`). **`cPrimCone` = `/* TO DO */`, emits nothing (`packages/engine/layer1/Ray.cpp:1416-1418`).** Labels/ellipsoids dropped. Coordinates are **camera space** unless `geometry_export_mode=1`. `%6.4f`/`%8.6f` precision. | Unusable per-frame; usable one-shot |
| `cmd.get_collada(version=2)` `packages/engine/modules/pymol/querying.py:648-662` | `CmdGetCOLLADA` `packages/engine/layer4/Cmd.cpp:2698-2719` | 8 `packages/engine/layer1/SceneRay.cpp:483-489` | ASCII `.dae` XML | Sphere tessellated per-primitive with `sphere_quality` strips (`packages/engine/layer1/COLLADA.cpp:1053-1210`); cylinder/sausage/cone tessellated with `DAE_MAX_EDGE 50` (`:1215+`); triangles (`:1530`). **`cPrimCharacter` and `cPrimEllipsoid` are empty `break;` — dropped (`packages/engine/layer1/COLLADA.cpp:1603-1618`).** Emits **one `<geometry><mesh>` per primitive** — a 5k-atom sphere scene is 5k XML meshes. Node splitting at `XML_NODE_SIZE_LIMIT 1000000` chars (`packages/engine/layer1/COLLADA.cpp:42, 85-99, 1582`). Requires `_HAVE_LIBXML` (`setup.py:631-633`), else hard error (`packages/engine/layer1/COLLADA.cpp:681-684`). | Unusable |
| `cmd.get_gltf(filename)` `packages/engine/modules/pymol/querying.py:664-690` | *(pure Python)* | — | file | **Not a real glTF exporter.** It shells out: `shutil.which('collada2gltf')`, writes a `.dae`, then `subprocess.call([exe, '-i', f, '-o', f])` (`packages/engine/modules/pymol/querying.py:676-688`). Raises `CmdException('could not find collada2gltf')` if the binary is absent. Forces `collada_geometry_mode=1`. | Unusable |
| `cmd.get_povray()` `packages/engine/modules/pymol/querying.py:547-561` | `CmdGetPovRay` `packages/engine/layer4/Cmd.cpp:2742-2759` | 1 `packages/engine/layer1/SceneRay.cpp:391-412` | `(header, geom)` POV-SDL strings | Analytic POV primitives + `smooth_color_triangle`. Highest *rendering* fidelity, but it's a POV-Ray scene description, not mesh data. | Unusable |
| `cmd.get_idtf(quiet=1)` `packages/engine/modules/pymol/querying.py:563-582` | `CmdGetIdtf` `packages/engine/layer4/Cmd.cpp:2722-2740` | `cSceneRay_MODE_IDTF` = 7 (`packages/engine/layer1/Scene.h:39`), `packages/engine/layer1/SceneRay.cpp:476-482` | `(node, rsrc)` IDTF strings for U3D/PDF | **Triangles only.** `case cPrimSphere:`, `case cPrimCone:`, `case cPrimCylinder:`, `case cPrimSausage:` are all bare `break;` (`packages/engine/layer1/Ray.cpp:2333-2341`). Sticks and spheres silently vanish. | Unusable |
| `cmd.get_mtl_obj()` `packages/engine/modules/pymol/querying.py:585-601` | `CmdGetMtlObj` `packages/engine/layer4/Cmd.cpp:2761-2778` | 5 `packages/engine/layer1/SceneRay.cpp:458-467` | `(mtl, obj)` | Docstring itself says *"incomplete and unsupported"*. Triangles get `v`/`vn`/`f` (`packages/engine/layer1/Ray.cpp:2459-2491`); **spheres are written as three identical vertices forming a degenerate face** (`packages/engine/layer1/Ray.cpp:2492-2506`); **cylinders emit nothing**; **no colors at all** (the color `sprintf` is commented out, `packages/engine/layer1/Ray.cpp:2483-2489`). `.mtl` is never written — `_get_mtl_obj` raises `CmdException('.MTL export not implemented')` for `format=='mtl'` (`packages/engine/modules/pymol/exporting.py:981-986`). | Useless |
| `cmd.save('x.stl')` → `pymol.lazyio:get_stlstr` | — | — | — | **Raises `pymol.IncentiveOnlyException("STL export not supported by this PyMOL build")`** (`packages/engine/modules/pymol/lazyio.py:224-231`). Not available in this fork. | N/A |
| `cmd.get_session(...)` `packages/engine/modules/pymol/exporting.py:371-476` → `_cmd.get_session` (`packages/engine/layer4/Cmd.cpp:6491`) | — | — | dict | Atoms, coords, settings, `ObjectCGO` CGOs, gadgets. **No rep geometry** (`packages/engine/layer2/CoordSet.cpp:364-416`). | Not geometry |
| `cmd.get_coords(sel, state)` `packages/engine/layer4/Cmd.cpp:2009-2031` / `cmd.get_coordset(name, state, copy)` `:2033-2056` | — | — | numpy `(N,3)` float32/float64 | Atom coordinates only. `copy=0` gives a live **view** (`packages/engine/layer2/CoordSet.cpp:357`). | Not rep geometry, but the API-shape precedent |
| `cmd.png(...)` / `cmd.raw_image_callback` | `CmdPng`, `call_raw_image_callback` `packages/engine/layer1/Scene.cpp:4020-4051` | 0 | RGBA `numpy` uint8 `(W,H,4)` | Pixels, not geometry. Existing hook: set `cmd.raw_image_callback` (default `None`, `packages/engine/modules/pymol/cmd.py:384`) and PyMOL pushes every rendered frame to Python. | Pixel-streaming fallback |

**Shared cost model for all six geometry exporters.** Every one calls
`SceneRay(G, 0, 0, mode, …)` (`packages/engine/layer1/SceneRay.cpp:88`), which:
1. `SceneUpdate(G, false)` (`:152`) — rebuild all reps if dirty,
2. allocates a fresh `CRay` (`:213`) and re-runs `obj->render(&info)` for **every** object with
   `info.ray` set (`:284-323`), re-emitting every primitive from scratch,
3. `RayExpandPrimitives()` (`packages/engine/layer1/Ray.cpp:561`) — allocates vertex/normal/radius VLAs sized to the
   full primitive count,
4. `RayTransformFirst()` (`packages/engine/layer1/Ray.cpp:822`) — transforms **all** vertices by `ModelView`
   (skipped only when `geometry_export_mode == 1`, `packages/engine/layer1/Ray.cpp:876-881`),
5. `sprintf` everything into a `char*` VLA,
6. `RayFree(ray)` (`:492`) — throws the whole thing away.

There is **no incremental mode, no dirty-tracking, no caching**. A `CPrimitive` is 172 bytes
(`packages/engine/layer1/Basis.h:68-83`) and the header comment notes ~6.5M primitives/GB. Every call rebuilds
everything.

---

## 5. Which existing path is closest to usable, and what it costs

### 5a. Winner for surfaces (today, no C++ changes): the surface cache

`cmd.cache('enable')` sets `cache_mode=2` (`packages/engine/modules/pymol/exporting.py:87-88`). Then, in
`RepSurfaceNew`, after `SurfaceJobRun()` succeeds and `cache_mode > 1`, PyMOL calls
`SurfaceJobResultAsTuple()` and `PCacheSet()` (`packages/engine/layer2/RepSurface.cpp:4566-4574`).

`SurfaceJobResultAsTuple` (`packages/engine/layer2/RepSurface.cpp:3217-3229`) builds:

```python
(N, V, VN, NT, T, S)   # V,VN: flat lists of floats; T,S: flat lists of ints
```

`PCacheSet` (`packages/engine/layer1/P.cpp:1349-1376`) stores it as `entry[3]` on a list
`[size, hash_list, input_tuple, output_tuple, access_count, timestamp]` appended to
`pymol._cache` by `cmd._cache_set` (`packages/engine/modules/pymol/internal.py:101-125`). It is directly readable:

```python
import pymol
for entry in pymol._pymol._cache:
    N, V, VN, NT, T, S = entry[3]
```

**Fidelity:** exact surface mesh, exact normals. **Missing:** `VC` colors, `VA` alpha, `Vis`
visibility, `VAO` occlusion, `AT` atom mapping — all of which live on the `RepSurface` and are *not*
part of the cached `SurfaceJob` result. Missing colors is fatal for a viewer, so this is a
prototype-grade path only.

**Cost:** `PConvToPyObject(std::vector<float>)` (`packages/engine/layer1/PConv.h:251-259`) builds a `PyList` of boxed
`PyFloat`s — one object per float. A 500k-vertex surface = 3M `PyFloat`s ≈ 70+ MB and hundreds of ms
just to materialize, plus the same again to JSON/msgpack it. Only acceptable once per surface build,
never per frame.

### 5b. Winner for everything else (today): `cmd.get_vrml(2)`

Highest-fidelity general export. Still one full `SceneRay` per call, ASCII, camera-space, cones
dropped, labels dropped, ellipsoids dropped.

### 5c. Per-frame cost verdict

**None of the existing paths can run per frame.** Rough shape of the cost for a modest 3k-atom
cartoon+sticks scene:

| Path | Work per call | Order of magnitude |
|---|---|---|
| `get_vrml` | full SceneRay + primitive expansion + sprintf of ~10^5-10^6 primitives | 10^0 – 10^1 s |
| `get_collada` | same + one XML `<geometry>` node per primitive + libxml tree | 10^1 – 10^2 s |
| `get_idtf` / `get_mtl_obj` | full SceneRay, then discards most primitives | 10^0 s, wrong output |
| surface cache read | zero (already computed), but `PyList` materialization | 10^-1 – 10^0 s per surface |
| **target for a real feed** | memcpy of existing float arrays | 10^-3 s |

**Conclusion for the architecture: geometry must NOT be re-derived per frame at all.** The client
should hold the mesh and only receive (a) camera/view updates via `cmd.get_view()`
(`packages/engine/modules/pymol/viewing.py:634-679`, 18 floats: 3x3 rotation, camera-space origin, model-space origin,
front/back clip, ortho-flag/FOV) and (b) *invalidation events* when a rep is rebuilt.

---

## 6. Proposed new C++/Python accessor (the actual recommendation)

### 6a. Design

Add one new `_cmd` method, e.g. `_cmd.get_rep_geometry(G, object_name, state, rep_id, flags)`,
registered in the method table alongside the existing `get_*` entries
(`packages/engine/layer4/Cmd.cpp:6446-6514`). Follow the exact shape of `CmdGetCoordSetAsNumPy`
(`packages/engine/layer4/Cmd.cpp:2033-2056`): `API_SETUP_ARGS` → `APIEnterBlocked` → `ExecutiveGetCoordSet`
(`packages/engine/layer3/Executive.h:869`) → build result → `APIExitBlocked`.

Resolution path (all already public):
```
ExecutiveFindObject<ObjectMolecule>(G, name)   packages/engine/layer3/Executive.h:338-343
  → ObjectMolecule::CSet[state]                (CoordSet*)
    → cs->Rep[cRepSurface] / cs->Active[...]   packages/engine/layer2/CoordSet.h:107-108
```
Preconditions: call `SceneUpdate(G, true)` (`packages/engine/layer1/Scene.cpp:4664`) first, or require the caller to
have called `cmd.rebuild()` — otherwise `Rep[]` may be stale or null.

### 6b. Return payload

A `dict` per rep, with **`PyBytes` blobs**, not lists:

```python
{
  "object": "1ubq", "state": 0, "rep": 2,             # cRepSurface
  "kind": "indexed-mesh",
  "counts": {"verts": 512331, "tris": 1023114},
  "position":  <bytes>,   # float32 x 3N   memcpy from RepSurface::V
  "normal":    <bytes>,   # float32 x 3N   memcpy from RepSurface::VN
  "color":     <bytes>,   # float32 x 3N   memcpy from RepSurface::VC
  "alpha":     <bytes>,   # float32 x  N   memcpy from RepSurface::VA
  "ao":        <bytes>,   # float32 x  N   memcpy from RepSurface::VAO
  "index":     <bytes>,   # int32   x 3NT  memcpy from RepSurface::T
  "atom":      <bytes>,   # int32   x  N   memcpy from RepSurface::AT
  "vis":       <bytes>,   # int32   x  N   memcpy from RepSurface::Vis
  "proximity": True,                        # RepSurface::proximity
  "one_color": None,
}
```

For CGO-backed reps:

```python
{
  "object": "1ubq", "state": 0, "rep": 5,             # cRepCartoon
  "kind": "cgo-draw-arrays",
  "blocks": [
     {"mode": 5,                                       # GL_TRIANGLE_STRIP
      "arraybits": 0x0F, "nverts": 41230,
      "data": <bytes>},                                # the raw cgo::draw::arrays heap block
     ...
  ],
  "spheres":   <bytes>,   # float32 x 8N: cx,cy,cz,r,rr,gg,bb,aa
  "cylinders": <bytes>,   # float32 x N*M for CGO_SHADER_CYLINDER(+2nd color)
}
```

### 6c. Implementation, entirely from existing functions

```cpp
// pseudo-code, all callees verified to exist
CGO* src = /* rep-specific: primitiveCGO | preshader | ray | std | shaderCGO-source */;

// 1. tessellate analytic primitives on the CPU (no GL)
CGO* simple = CGOSimplify(src, 0, sphere_quality, stick_round_nub);   // packages/engine/layer1/CGO.cpp:4444
// 2. fold BEGIN/END into interleaved arrays (idempotent if already folded)
if (simple->has_begin_end) CGOCombineBeginEnd(&simple);              // packages/engine/layer1/CGO.cpp:1539

// 3. walk with the public iterator and emit PyBytes per CGO_DRAW_ARRAYS
for (auto it = simple->begin(); !it.is_stop(); ++it) {               // packages/engine/layer1/CGO.h:800-830
  if (it.op_code() == CGO_DRAW_ARRAYS) {
    auto* sp = it.cast<cgo::draw::arrays>();                         // packages/engine/layer1/CGO.h:338
    PyObject* blob = PConvFloatArrayToPyList(                        // packages/engine/layer1/PConv.cpp:971
        sp->get_data(), sp->get_data_length(), /*dump_binary=*/true);
    // + sp->mode, sp->arraybits, sp->nverts
  }
}
```

To keep spheres/sticks as GPU impostors instead of tessellated triangles (much smaller payload,
matches PyMOL's own default `sphere_mode 9` / `render_as_cylinders`), **skip `CGOSimplify` and instead
walk the `CGO_SPHERE` / `CGO_SHADER_CYLINDER` / `CGO_SHADER_CYLINDER_WITH_2ND_COLOR` ops directly**
and pack them into instance buffers. That mirrors what
`CGOOptimizeSpheresToVBONonIndexed` (`packages/engine/layer1/CGO.cpp:4357-4394`) does for GL.

### 6d. Bulk / streaming variant

Add `_cmd.get_scene_geometry(G, flags)` that iterates `G->Scene->Obj` the same way `SceneRay` does
(`packages/engine/layer1/SceneRay.cpp:284-323`) and returns a list of the per-rep dicts above, plus per-object
transforms from `cmd.get_object_matrix` (`packages/engine/layer4/Cmd.cpp:6480`) — required because
`ObjectMolecule::render` applies `ObjectStatePushAndApplyMatrix` when `matrix_mode != 0`
(`packages/engine/layer2/ObjectMolecule.cpp:11265-11269`).

### 6e. Invalidation events

The bridge must know when to re-pull. `Rep::invalidate(cRepInv_t)` (`packages/engine/layer1/Rep.h:199`) and the
`cRepInv_t` ladder (`packages/engine/layer1/Rep.h:133-184`) are the natural hook:
`cRepInvColor(15)` → re-send colors only; `cRepInvRep(35)`/`cRepInvAll(100)` → re-send everything.
There is **no existing Python callback for rep invalidation** — I grepped and found none. This must
be added (a `PYOBJECT_CALLMETHOD` into `G->P_inst->cmd`, following the pattern of
`call_raw_image_callback` at `packages/engine/layer1/Scene.cpp:4020-4051`).

### 6f. Effort estimate

* Surface accessor (memcpy of 8 existing vectors): **~150 lines, low risk.**
* CGO accessor (CGOSimplify + iterate + PyBytes): **~300 lines**, mostly a variant of the already-existing
  `CGOArrayAsPyList` (`packages/engine/layer1/CGO.cpp:241-287`).
* Invalidation callback: **~80 lines**, plus threading care (`Rep::update()` runs on worker threads
  when `async_builds` is on, `packages/engine/layer1/Scene.cpp:4740-4757` — the callback must not touch Python from a
  non-GIL thread; use `PAutoBlock`/`PAutoUnblock` as `RepSurface` already does at
  `packages/engine/layer2/RepSurface.cpp:4569-4581`).

---

## 7. Shader parity assets already in the repo

`packages/engine/data/shaders/` contains PyMOL's GLSL, and the preprocessor already has WebGL/ES2 code paths:
`m_shaderPreprocessor.setVar("PURE_OPENGL_ES_2"/"PYMOL_WEBGL"/"PYMOL_WEBGL_IOS", true)`
under `#ifdef PURE_OPENGL_ES_2` (`packages/engine/layer0/ShaderMgr.cpp:604-607`), with
`packages/engine/data/shaders/webgl_header.vs` and `packages/engine/data/shaders/webgl_header.fs` supplying the uniform block
(`g_NormalMatrix`, `g_ModelViewMatrix`, `g_ProjectionMatrix`, `g_Fog_end`, `g_Fog_scale`).

Programs registered (`packages/engine/layer0/ShaderMgr.cpp:617-658`): `bg`, `label`, `default`, `surface`, `line`,
`screen`, `connector`, `bezier`, `cylinder`, `sphere`, `ramp`, `oit`, `trilines`.
Shared includes: `compute_color_for_light.fs` (101 lines), `compute_fog_color.fs` (52),
`anaglyph_header.fs` (161), `call_compute_color_for_light.fs`.

`sphere.fs` (94 lines) is a genuine ray-sphere impostor writing `gl_FragDepth` — requires
`GL_EXT_frag_depth` on WebGL1, native on WebGL2 (`packages/engine/data/shaders/sphere.fs:1-3, 55-60`).
`cylinder.fs` is 187 lines of impostor math. **These are directly portable to three.js
`RawShaderMaterial` / `ShaderMaterial` with matched uniform names.** ~1840 lines of GLSL total across
all shaders — this is the single biggest lever for visual parity and it is copy-adaptable, not
reinventable.

---

## 8. HONEST VERDICT

**Can a three.js client reach visual parity with PyMOL by drawing PyMOL's own geometry?**

**For the interactive OpenGL viewport: yes, ~95%, and the remaining 5% is a long tail of small
mismatches, not a wall.** The mesh data is exact (it *is* PyMOL's data), the shaders are portable, and
the camera model is fully specified by `cmd.get_view()`. This is a real, buildable product.

**For ray-traced output: no, not ever, and you should not try.** See risks.

### Where it will definitively NOT match

1. **Ray tracing (`cmd.ray`) — irreproducible in three.js.** `RayRender` (`packages/engine/layer1/Ray.cpp`, 7827 lines)
   is a CPU ray tracer with real shadows, multi-light specular, interior colors, and
   `ray_trace_mode` cel-shading/outlines (`packages/engine/layer1/Ray.cpp:5570-5607, 6472-6474`). `ray_trace_mode`
   exists **only** in the ray tracer — grep of `packages/engine/layer1/SceneRay.cpp` and `packages/engine/layer1/SceneRender.cpp`
   found zero references to it in the GL path. There is no path to parity here. The web client must
   call `cmd.ray()` + `cmd.png()` server-side and display the resulting bitmap. This is a **mode
   switch, not a rendering feature** — and the UX must make that explicit.

2. **Order-independent transparency (`transparency_mode 3`).** PyMOL binds an OIT accumulation
   framebuffer with multiple draw buffers and a dedicated `oit` shader
   (`packages/engine/layer1/SceneRender.cpp:939-995`, `packages/engine/data/shaders/oit.vs/.fs`, `packages/engine/layer0/PostProcess.cpp:60, 86`,
   `TM3_IS_ONEBUF` handling at `packages/engine/layer1/SceneRender.cpp:979, 1101, 1466`). WebGL2 has no
   `GL_EXT_draw_buffers`-style MRT parity issues but *does* lack per-sample control PyMOL relies on;
   an approximate WBOIT is achievable but will not be pixel-identical.

3. **CPU depth-sorted alpha triangles (`transparency_mode != 3`).** The other transparency path
   sorts triangles on the CPU per frame:
   `CGOOptimizeToVBOIndexedWithColorEmbedTransparentInfo` embeds `z_value`, `ix`, and `sort_mem`
   arrays into the CGO (`packages/engine/layer1/CGO.cpp:3395-3405`), and `RepSurface::render` allocates
   `t_buf`/`z_value`/`ix` sized `NT` and re-sorts every frame
   (`packages/engine/layer2/RepSurface.cpp:1969-1984`). **Reproducing this in JS means per-frame triangle sorting of
   up to 10^6 triangles in the browser — that will not hold 60 fps.** Either accept sort artifacts or
   ship the sorted index buffer from Python each frame (which reintroduces per-frame cost).

4. **Stereo.** PyMOL implements 9 stereo modes: quadbuffer, crosseye, walleye, geowall, sidebyside,
   stencil-by-row/column/checkerboard/custom, anaglyph, openvr
   (`packages/engine/layer1/SceneRay.cpp:154-175, 515-713`). Quad-buffer stereo and stencil-parity stereo are
   impossible in a browser. Anaglyph and side-by-side are reproducible. OpenVR is out.

5. **Post-process antialiasing.** `antialias_shader` selects FXAA (1 stage) or **SMAA (3 stages)**
   (`packages/engine/layer1/SceneRender.cpp:613-627, 1791`). Reproducible with effort, but PyMOL's exact SMAA
   parameters must be ported or edges will differ visibly at high zoom.

6. **Labels.** `cRepLabel` is texture-atlas quads driven by `CGO_DRAW_LABEL` / `CGO_DRAW_LABELS`
   (`packages/engine/layer1/CGO.h:224-228`) and a texture-size heuristic
   (`InvalidateShaderCGOIfTextureNeedsUpdate`, `packages/engine/layer2/RepLabel.cpp:117`,
   `MAX_LABEL_TEXTURE_SIZE 256`, `:114`). Glyphs are CPU-reachable
   (`packages/engine/layer1/Character.cpp:122`) but the atlas must be rebuilt client-side. Font rasterization will
   differ from PyMOL's FreeType output at the pixel level. Expect near-miss, not match.

7. **`cRepCallback` (14).** Objects created by `cmd.load_callback` execute arbitrary Python that
   issues raw OpenGL. `packages/engine/layer2/ObjectCallback.cpp` exists for exactly this. **There is no geometry to
   extract — by construction.** Any plugin using it is unsupported in the web client.

8. **`cRepVolume` (20) and `cRepSlice` (16).** 3D-texture ray marching (`packages/engine/data/shaders/volume.fs`,
   47 lines). Not mesh geometry. Requires a separate 3D-texture upload path
   (`cmd.get_volume_field` exists, `packages/engine/layer4/Cmd.cpp:6510`, `packages/engine/layer4/Cmd.cpp:727` →
   `FieldAsNumPyArray`) and a hand-ported volume shader. Treat as a separate epic.

9. **Ambient occlusion.** `VAO` per-vertex occlusion is computed on the surface
   (`packages/engine/layer2/RepSurface.cpp:2780-2800`) and shipped as a vertex attribute — that part transfers fine.
   But `ambient_occlusion_mode` also has a smoothing pass with its own map
   (`ambient_occlusion_map`, `packages/engine/layer2/RepSurface.cpp:2368`) whose result is baked into `VAO`, so as
   long as the client reads `VAO` *after* rebuild, this one actually matches.

10. **Grid mode.** `GridMode::ByObject / ByObjectStates / ByObjectByState`
    (`packages/engine/layer1/SceneRay.cpp:179-211, 306-320`) splits the viewport into N sub-viewports with adjusted
    aspect ratios. Reproducible with N three.js viewports, but the layout math
    (`GridUpdate`, `grid.asp_adjust`) must be ported exactly or panels will misalign.

11. **Precision.** All PyMOL geometry is `float32` and all colors are `float32` RGB in [0,1]
    (`CLIP_COLOR_VALUE` / `CONVERT_COLOR_VALUE`, `packages/engine/layer1/CGO.h:54-55`). Optional byte-packed
    normals/colors are gated on `cgo_shader_ub_color` / `cgo_shader_ub_normal`
    (`packages/engine/layer1/CGO.cpp:2939-2961`, `CLIP_NORMAL_VALUE` at `packages/engine/layer1/CGO.h:58-61`). If the accessor emits
    float32 and the client uses float32, this is exact.

12. **Picking.** PyMOL picks by rendering a pick-color buffer (`CGORenderPicking`,
    `packages/engine/layer2/RepSphere.cpp:120`, `packages/engine/layer1/ScenePicking.cpp`). The `CGO_PICK_COLOR` payload
    (`atom index, bond index`, `packages/engine/layer1/CGO.h:141-142`) is in the extracted arrays, so client-side
    GPU picking is achievable — but the encoding (`Picking.h`, `cPickableAtom = -1` …
    `cPickableThrough = -5`, `packages/engine/modules/pymol/cgo.py:73-77`) must be replicated bit-for-bit or
    selections will land on the wrong atoms.

---

## 9. Open questions I could not resolve by reading

* I found **no existing Python hook fired on Rep rebuild/invalidation**. Grepped `packages/engine/layer1/P.cpp`,
  `packages/engine/layer4/Cmd.cpp`, `packages/engine/modules/pymol/*.py`. If one exists under a name I did not guess, it would remove
  the need for §6e.
* I did **not** verify whether `RepSurface::AT` is populated in all surface modes or only when
  `pick_surface` is on. `AT` is declared at `packages/engine/layer2/RepSurface.cpp:83` but I did not trace every
  write site.
* I did **not** confirm the exact byte layout of the pick-color sub-block inside `CGO_DRAW_ARRAYS`
  (`VERTEX_PICKCOLOR_RGBA_SIZE = 1` float holding 4 packed bytes + 2 index floats,
  `packages/engine/layer1/CGO.cpp:60-64`). The offset arithmetic at `packages/engine/layer1/CGO.cpp:1664-1666`
  (`pickColorVals = nxtVals + VERTEX_PICKCOLOR_RGBA_SIZE * nverts`) implies the RGBA sub-array
  precedes the index sub-array within the same block; this needs a runtime check before relying on it.
* `_PYMOL_NO_RAY` guards `SceneRay` entirely (`packages/engine/layer1/SceneRay.cpp:94-96`). I did **not** find a
  `setup.py` flag setting it, so ray export is presumably always compiled in this fork — but I did not
  confirm via a build.
* Whether `pymol._cache` surface entries survive `cmd.delete` / rebuild cycles cleanly enough to be a
  reliable feed — `_cache_purge` (`packages/engine/modules/pymol/internal.py:48-78`) evicts by size and access time.
