# Spike 08 — Native (C++) wave 2: change counters, pick data, missing instances

**Status: IMPLEMENTED AND VERIFIED.** Plan `03-implementation-plan.md` §4 Task 6 (ReprVersion),
§4 Task 3 (pick data) and the instance half of defect D6 are done.

Every number, transcript and table below was produced on this machine by running the scripts
named in §7. Nothing is inferred from source reading alone. Where something is *not* verified it
says so in those words.

---

## 0. TL;DR

| | |
|---|---|
| Files changed | `layer4/CmdWebGeometry.cpp` (+1012/−5), `layer3/Executive.cpp` (+69/−0), `layer3/ExecutiveDef.h` (+20/−0), `layer4/Cmd.cpp` (+4/−0) |
| Lines **removed** from upstream files | **0** |
| Upstream lines added outside a `tenmol web client` sentinel | **0** (audited programmatically, §6) |
| New Python entry points | `_cmd.web_get_versions()`, `_cmd.web_resolve_pick()` |
| D1 — stale Mode-G geometry | **fixed.** `hide everything` flips `cartoon\|0` to `{version: 2, active: false}` on the very next poll |
| Idle poll cost | **1.5 µs**, and it dereferences **zero** `Rep` pointers — 0 false positives across 700 idle polls (plus 1000 more for the timing) |
| Recolour visibility | `color red, resi 1-20` bumps `sticks\|0` 1 → 2. `get_vis()+get_state()` (today's 4 Hz probe) cannot see this at all |
| Client-side pick vs a **real GL pick**, spheres | **18 / 18 exact** on 1UBQ (was 16/18 before porting PyMOL's ±7 px snap) |
| Client-side pick vs a **real GL pick**, surface | **15 / 15 exact** (was 10/15 before porting the GL_FLAT provoking-vertex rule) |
| Cones | emitted as **instances**, 8 f32 + 2 i32 + 2×RGBA per cone; **0 triangles** generated |
| Ellipsoids | 367 instances on 1EJG, every centre == its atom's coordinate, axes orthogonal to 6.2e-08 |
| Newly supported reps | `cell`, `extent`, `dashes`, `angles`, `dihedrals`, standalone `cgo` objects |
| Still unsupported, on purpose | `labels`, `slice`, `volume`, `callback` (§5.3) |
| Upstream test suite | `Ran 961 tests / FAILED (failures=1, errors=1, skipped=276)` + `57 passed, 31 skipped` — **byte-identical to the spike-00 baseline** |
| Bridge test suite | `129 passed` |

**GL-free scorecard.** The backend needed a GL context for (a) Mode P rasterising and (b) the pick
pass. This spike removes the *need* for (b): the geometry payload already carries stable
`(atom index, bond index)` per vertex/instance, and §3 proves that resolving those client-side
reproduces the backend pick **exactly**, on the same screen positions, for both an instance rep and
a triangle-mesh rep. Nothing in `web_get_versions` or `web_resolve_pick` touches GL — both were run
under `pymol2.PyMOL()` with `no_gui=1` and no context at all.

---

## 1. What was added, and where

### 1.1 `struct CExecutive` (`layer3/ExecutiveDef.h`)

Four monotonic `unsigned` counters. They are *hints*, not content hashes:

| field | bumped when |
|---|---|
| `m_web_panel_version` | object list / order / group structure changed |
| `m_web_enable_version` | an object was enabled or disabled |
| `m_web_name_version` | an object was renamed |
| `m_web_rep_version` | a representation was invalidated (show/hide/colour/setting/coords) |

### 1.2 Bump sites (`layer3/Executive.cpp`, 10 sentinel blocks, 0 lines removed)

The plan named five sites. Three of them are the right ones; two would have missed the single most
common change of all. What actually landed, and why:

| site | line | why |
|---|---|---|
| `ExecutiveInvalidatePanelList` | :1521 | as the plan said |
| `ReportEnabledChange` | :315 | the plan named `ExecutiveSpecEnable` (:15376); `ReportEnabledChange` is its choke point **and** covers *disable* (14 call sites) |
| `ExecutiveSetName` | :3686 | as the plan said |
| `ExecutiveInvalidateRep` | :14053 | as the plan said — and it is reached from `layer1/Setting.cpp` (113 call sites), which is **why `SettingRec::setChanged()` is NOT patched** (§1.3) |
| `ExecutiveSetRepVisMask` | :13908 | **`show`/`hide` does not go through `ExecutiveInvalidateRep`.** It drives `OMOP_VISI` + `OMOP_INVA` / `ObjectSetRepVisMask` directly. Without this bump the plan's five sites miss D1 entirely |
| `ExecutiveObjMolSeleOp` | :12945 | per-atom `color`, per-atom rep visibility and `alter` reach the reps through this dispatcher. Only `OMOP_COLR`/`VISI`/`ALTR`/`INVA` bump — read-only ops must not, or `cmd.count_atoms()` would look like a change |
| `ExecutiveUpdateCoordDepends` | :1931 | coordinates moved |
| `ExecutiveTransformSelection`, `ExecutiveTransformObjectSelection2` | :7695, :7717 | `translate`/`rotate`/`matrix_copy`/`align` |
| `ExecutiveWebGetChangeCounters` | :17811 | the read accessor, defined in the .cpp so `Executive.h` is untouched |

### 1.3 `SettingRec::setChanged()` was deliberately NOT patched

The plan offered it as optional. It is not needed and it is the worst place to touch: `Setting.h`
is included by ~everything, so a field there is a full-tree rebuild at every upstream merge, and
`setChanged()` fires for **every** setting including `bg_rgb`, `ray_trace_mode` and the movie
panel — i.e. it would manufacture false wake-ups. Instead, the 113 `ExecutiveInvalidateRep` call
sites inside `layer1/Setting.cpp` are what actually rebuild a rep, and the single bump at
`ExecutiveInvalidateRep` covers all of them. Measured:

```
--- a setting that rebuilds a rep (stick_radius) -------------------
  sticks|0 version 1 -> 2   changed=True
  rep counter 9 -> 13

--- a global setting that does not touch geometry (bg_rgb) ---------
  serial 9 -> 9  changed=False (must be False)
```

### 1.4 `layer4/Cmd.cpp` — 4 lines, both inside the sentinel blocks WP-26 already created

```
line 6371  PyObject* CmdWebGetVersions(PyObject* self, PyObject* args);
line 6372  PyObject* CmdWebResolvePick(PyObject* self, PyObject* args);
line 6472  {"web_get_versions", CmdWebGetVersions, METH_VARARGS},
line 6473  {"web_resolve_pick", CmdWebResolvePick, METH_VARARGS},
```

---

## 2. Task 6 — `_cmd.web_get_versions()`

```python
cmd.lock(_self=cmd)
try:
    v = cmd._cmd.web_get_versions(cmd._COb, update=1, force=0)
finally:
    cmd.unlock(-1, _self=cmd)
```

```
{
  "counters":   [panel, enable, name, rep],   # monotonic, from CExecutive
  "serial":     N,      # bumps iff some version below bumped
  "recomputed": bool,   # False = fast path, not one Rep was touched
  "rehashed":   bool,   # == recomputed (see s2.5)
  "changed":    bool,
  "walks":      N,
  "objects": { "<name>": { "version": N, "type": int, "enabled": bool,
                           "n_atom": int, "n_state": int,
                           "reps": { "<rep>|<state>": {"version": N, "active": bool} } } }
}
```

A rep entry appears the first time it is ever active; when it goes away it **stays in the map with
`active: false` and a bumped version**. That is precisely the signal D1 needs.

### 2.1 The counters are cheap *and* exact

`counters` alone is a hint. The versions are derived from a 64-bit FNV-1a **content signature** of
each rep's CPU geometry, computed only when a counter moved. The signature is deliberately
pointer-free: `Rep*` is recycled by the allocator across a rebuild, and a CGO's out-of-line
`floatdata` blocks move, so hashing either would produce phantom changes. For `CGO_DRAW_ARRAYS` the
signature hashes `mode`, `arraybits`, `nverts` and the out-of-line data block — never the pointer
that holds it.

### 2.2 D1, reproduced and fixed

```
--- D1: `hide everything; show sticks` -----------------------------
  counters [1, 1, 0, 2] -> [1, 1, 0, 3]
  serial   1 -> 2   changed=True
  cartoon|0  {'version': 1, 'active': True} -> {'version': 2, 'active': False}
  active reps now: []
  after `show sticks`:
    cartoon|0 {'version': 2, 'active': False}
    sticks|0  {'version': 1, 'active': True}
    active reps now: ['sticks|0']
  100 idle polls after the change: changed=True 0 times (must be 0)
```

The bridge's invalidation can now be: *"for every `(object, rep, state)` whose `version` differs
from the one I cached, refetch; for every one that is `active: false`, drop."* No content hash, no
`get_vis()`/`get_state()` fingerprint, no self-declared inexactness.

### 2.3 No false positives — 700 idle polls, zero

```
--- 200 IDLE polls -------------------------------------------------
  polls reporting changed=True : 0   (must be 0)
  polls that walked any Rep    : 0   (must be 0 -> fast path)
  full payload identical       : True
  serial 1 -> 1 ; counters [1, 1, 0, 2] -> [1, 1, 0, 2]
  1000 idle polls in 0.0015 s  (1.5 us/poll)
...
--- final 300 idle polls ------------------------------------------
  changed=True: 0/300   recomputed=True: 0/300   (both must be 0)
  total full walks over the whole run: 15
```

Read-only commands do not fake a change (they *can* move the panel counter, which costs a walk, but
`changed` stays false):

```
--- read-only commands must not look like a change -----------------
  count_atoms/get_model/get_view/iterate
  counters [8, 1, 0, 8] -> [20, 1, 0, 9]
  serial 4 -> 4  changed=False (must be False)
```

And a no-op recolour bumps a counter (work *was* queued) but **not** a version:

```
--- recolour to the SAME colour (must NOT bump the version) --------
  counters [4, 1, 0, 6] -> [8, 1, 0, 8]   (an executive counter DID move: work was queued)
  sticks|0 version 2 -> 2   (must be equal: identical geometry+colour)
  changed=False (must be False)
```

### 2.4 The change the old poll *cannot* see

```
--- per-atom recolour (the case a get_vis()/get_state() poll misses) 
  sticks|0 version 1 -> 2  (colour changed, geometry did not)
```

`get_vis()` returns the same dict before and after `color red, resi 1-20`; `get_state()` is
unchanged. This is the single row that makes a `ReprVersion` worth having, exactly as the plan says.

### 2.5 An optimisation that was measured, then REJECTED

Full disclosure, because it is the only place this design is knowingly slower than it could be.

| | |
|---|---|
| idle poll (no counter moved) | **1.8 µs** |
| full walk on 1AON, 58,870 atoms, cartoon + surface built | **47.6 ms** |
| ratio | 26,467× |

The panel counter moves on *every* `SelectorTmp` construction — `count_atoms`, `iterate`, `select`,
`get_model` all bump it — so any of those costs one 47 ms walk on a structure that size. The obvious
fix is to gate the expensive per-`Rep` hashing on counters 1..3 only (enable / name / rep) and let a
panel-only move do just the cheap object-list pass.

It was implemented, and then a differential harness killed it: two PyMOL instances, the identical
400-command random sequence, one polling gated and one polling `force=1` (which always re-hashes).

```
  polls that walked          : 335
  walks that SKIPPED rehash  : 45  (the panel-only fast path)
  divergences                : 8
    step 153 after 'create copy'
      cpy gated=(1, True, 43, 1, {...}) truth=(1, True, 44, 1, {...})
```

Every divergence was `create <name>` onto an **existing** object name, whose atom count changed with
no counter but the panel one moving. That is a D1-class stale-geometry hole, so the conservative
rule stands: **any counter moving triggers a full re-hash.** `rehashed` is therefore always equal to
`recomputed`; it is kept in the payload so the decision stays observable.

With the fast path reverted, the same harness over **800** random commands:

```
  polls that walked          : 665
  walks that SKIPPED rehash  : 0
  divergences                : 0
  final tables identical     : True
T1c DONE  ->  PASS
```

One hardening did survive the revert: `n_atom`/`n_state` are now read and compared *before* the rep
walk and are part of the object-level change test in their own right, because `remove` can drop an
atom that no built rep was drawing, leaving every rep signature identical.

> **For the bridge:** poll `web_get_versions` at whatever rate you like when idle (1.5 µs), but
> treat a `recomputed: true` as costing up to ~50 ms on a very large structure. That is the same
> moment the client is about to refetch geometry anyway.

---

## 3. Task 3 — pick data, and why the backend no longer needs a pick pass

### 3.1 What is shipped, and what is deliberately not

**Not shipped: the pick colour.** `PickColorManager::colorNext` (`layer1/Picking.cpp:150-186`) is a
per-frame draw-order counter whose reverse map holds raw `CObject*` and is invalidated on every
rebuild. It is meaningless outside the frame that produced it.

**Shipped: the identifiers behind `CGO_PICK_COLOR`** (`layer1/CGO.h:150-151`) — a 0-based atom index
inside the object plus a bond index or a `cPickable_t` sentinel, aligned per vertex and per instance
with the geometry buffers WP-26 already emits (`spheres.pick`, `cylinders.pick1/pick2`,
`cones.pick`, `ellipsoids.pick`, `lines.pick1/pick2`, `crosses.pick`, `draw_arrays[].pick`, and
`surface.atom` from `RepSurface::AT`).

`_cmd.web_resolve_pick(_self._COb, object, index, bond, state=-1)` turns one back into a selection,
with no GL context:

```
  resolve(u, index=10, bond=cPickableAtom) ->
      status     ok
      selection  u`11
      describe   /u//A/GLN`2/C
      coord      [26.100000381469727, 29.253000259399414, 5.202000141143799]
      pick_kind  atom
      atom     {'name': 'C', 'resn': 'GLN', 'resi': '2', 'chain': 'A', 'elem': 'C', 'index1': 11}
  cmd.select('u`11') -> 1 atoms, index=[('u', 11)]
```

`u`11` is byte-for-byte what `layer1/SceneMouse.cpp:245` builds for a real backend pick
(`"%s`%d" % (obj->Name, index + 1)`). Half-bond picks additionally get `bond_atoms` and a ready
`bond_selection`:

```
  cylinder[0].pick1 = (index=0, bond=0) -> bond
      selection      u`1
      bond_atoms     [0, 1]
      bond_selection (u`1 or u`2)
      cmd.select(bond_selection) -> 2 atoms [('u', 1), ('u', 2)]
  all 718 cylinder pick1 entries resolve; bond end-points consistent: True
```

Sentinels behave:

```
  resolve(index=5, bond=cPickableNoPick=-4) -> status=no-pick
      this vertex was emitted with cPickableNoPick (masked atom); it blocks the pick but selects nothing
  resolve(index=99999) -> status=unsupported  atom index out of range
  resolve('nosuch')    -> status=unsupported  no such object
```

### 3.2 The round trip, against a REAL GL pick

Ground truth is a genuine `ScenePicking.cpp` pick-colour render + `glReadPixels` on the headless
CGL + FBO context from `spikes/04-picking.md` §3 (`GL: 2.1 Metal - 89.4 / Apple M4 Max`), read out
through `_cmd.get_click_string`. The client-side answer is produced in pure Python from **only** the
`web_get_rep_geometry` buffers plus `packages/viewport/src/camera.ts`'s view maths — it never looks
at the GL result.

```
pixel        GL pick (ground truth) client-side + resolve  verdict
------------------------------------------------------------------------------------------
(217,256)    O idx=470              O idx=470              MATCH
(217,339)    C idx=485              C idx=485              MATCH
...
(702,256)    O idx=597              O idx=597              MATCH
------------------------------------------------------------------------------------------
spheres: agree=18  differ=0  both-miss=38

--- surface: RepSurface::AT round trip vs a real GL pick -------------
  surface n_vert=5235 n_tri=10472  atom buffer=5235 ints
  (200,247)  GL idx=474    client idx=474     MATCH
  ...
  (684,247)  GL idx=578    client idx=578     MATCH
  surface: agree=15 differ=0 both-miss=10
```

**18/18 and 15/15.** They did *not* agree at first, and the two reasons are the important part of
this section — a client that ignores either will disagree with the backend a few percent of the time.

### 3.3 Disagreement #1 — PyMOL's pick has a ±7 px snap radius

A naive exact ray-sphere test scored **16/18**. Both misses were pixels where the ray passed just
*outside* the sphere the GL pick returned:

```
  (508,339) gl_idx=544   silhouette_dist= +1.243 px   r=13.58 px  DIFFER
  (702,256) gl_idx=597   silhouette_dist= +0.416 px   r=13.24 px  DIFFER
  ... every agreeing pixel had a NEGATIVE distance (inside the sphere)
```

A pixel-centre offset sweep from −1.5 to +1.5 px in 0.25 px steps never reached 18/18, so it is not
a convention error. The cause is in the source:

```
layer1/ScenePicking.cpp:15    #define cRange 7
layer1/ScenePicking.cpp:190   const int cRangeVal = DIP2PIXEL(cRange);
                              const int h = (cRangeVal * 2 + 1), w = (cRangeVal * 2 + 1);
layer1/ScenePicking.cpp:200   for (int d = 0; (d < cRangeVal); ++d)
                                for (int a = -d; a <= d; ++a)
                                  for (int b = -d; b <= d; ++b)
                                    index = indices[...]; if (index) { ...break; }
```

`SceneRenderPickingSinglePick` reads a **15×15 px window** around the click and walks **outward in
square rings**, taking the first non-zero pick index. So a PyMOL click snaps to anything within
~7 px (scaled by `DIP2PIXEL`). Porting that ring scan client-side:

```
  exact ray-sphere only : 16/18
  with the cRange=7 snap: 18/18
```

For an isolated 16.18 px-radius sphere the silhouettes are otherwise **identical to the pixel** —
a horizontal scan found the last GL hit and the last analytic hit both at +16 px.

> **For the WebGL agent:** implement the outward ring scan with `cRange = 7 * devicePixelRatio`, in
> the same order (rings `d = 0..6`, row-major within a ring). Without it, clicks near a silhouette
> or on a thin rep will differ from Mode P.

### 3.4 Disagreement #2 — the pick pass is FLAT-shaded: use the LAST triangle corner

A naive "nearest barycentric corner" surface picker scored **10/15**, and the disagreements were
always a *neighbouring* atom (360 vs 361, 31 vs 32, 345 vs 346). The pick pass is **flat-shaded**:
`SceneSetupGLPicking` does `glShadeModel(GL_FLAT)` (`layer1/Scene.cpp:5186`), the pick colour
travels through `gl_FrontColor` precisely so that `glShadeModel` applies to it
(`data/shaders/default.vs:15-16`, *"using the built-in allows to use glShadeModel"*), and
`ScenePicking.cpp:229-234` restores `GL_SMOOTH` afterwards with the comment *"Picking changes the
Shading model to GL_FLAT"* (`cSetting_pick_shading` defaults to 0, so the restore is to
`GL_SMOOTH`). A flat-shaded triangle takes the colour of its **provoking vertex**, which for
`GL_TRIANGLES` is the last one. Measured over 72 GL picks on the 1UBQ surface:

```
  n=72  agreement: {'first': 50, 'second': 49, 'third': 72, 'nearest': 57, 'any-corner': 72}
```

**`third` = 72/72.** So the rule is: for a triangle hit, report `atom[index[3*t + 2]]`, not the
nearest corner. With that rule plus the ±7 px snap, the surface round trip is 15/15.

### 3.5 A finding the client must know: the backend cannot pick a surface by default

`cSetting_pick_surface` defaults to **0** (`layer1/SettingInfo.h:812`), and
`RepSurface.cpp:1565` does `I->shaderCGO->no_pick = !pick_surface`. Verified: with the default,
clicking dead centre of an opaque 1UBQ surface returns `type=none`. The `pick_surface, on` setting
had to be switched on to obtain any ground truth at all in §3.2.

Client-side picking has no such limit — it can pick the surface whether or not the setting is on.
**That is a behavioural difference from Mode P, and the client should honour `pick_surface` to stay
consistent**, or the same click will select an atom in Mode G and nothing in Mode P.

### 3.6 What is still NOT verified

* `mesh`, `dots`, `ribbon`, `nonbonded` and `nb_spheres` were probed for backend pickability at a
  single centre pixel and all returned `type=none`; that is most likely because those reps are
  sparse/thin and the pixel missed, **not** a proven "unpickable". Not investigated further, and
  therefore **not verified** either way.
* Multi-object and multi-state scenes were not part of the pick comparison. `web_resolve_pick`
  takes an explicit object name and state and was exercised with `state=-1`; other states are
  **unverified**.
* Orthoscopic projection was not exercised in the pick comparison (the view was perspective,
  `view[17] = -20`). The ortho branch of the ray construction is **unverified**.

---

## 4. Task 3 (D6) — cone and ellipsoid instances

Both are decoded into flat typed **instance** buffers. Nothing is tessellated.

### 4.1 Cones

```
  status=ok  source=ObjectCGO::origCGO
  ops={7: 1, 9: 1, 27: 2}
  unhandled_ops={}   (must be {})
  cones n=3   spheres n=1   cylinders n=0
  cone[0] v1=(0.00,0.00,0.00) v2=(3.00,0.00,0.00) r1=1.000 r2=0.000 cap=(1,1)
          rgba1=(1.0, 0.2, 0.2, 1.0) rgba2=(0.2, 1.0, 0.2, 1.0)
  cone[1] v1=(0.00,5.00,0.00) v2=(0.00,8.00,0.00) r1=0.700 r2=0.350 cap=(0,0)
          rgba1=(0.0, 0.0, 1.0, 1.0) rgba2=(1.0, 1.0, 0.0, 1.0)
  cone[2] v1=(0.00,0.00,0.00) v2=(0.00,0.00,4.00) r1=0.150 r2=0.150 cap=(1,1)
     triangles n=0  draw_arrays=0  begin_end=0
```

Note `cone[2]`: `CGO_CYLINDER` and every `*_CYLINDER*` variant land in the **same** `cones` bucket
with `r1 == r2`. A client that implements the truncated-cone instance gets cylinders for free.

Per-instance layout (`cones` bucket):

| field | type | count |
|---|---|---|
| `v1v2_r1r2` | f32 | 8 · n — `v1[3], v2[3], radius1, radius2` |
| `cap` | i32 | 2 · n — `cCylCap` for each end |
| `rgba1`, `rgba2` | f32 | 4 · n each |
| `pick` | i32 | 2 · n — `(atom index, bond)` |

### 4.2 Ellipsoids

1EJG, 367 `ANISOU` records — the rep every text exporter drops (spike 03 §4.1: `.wrl` 234 bytes,
`.pov` 0, `.obj` 0 faces, `.dae` 0 geometry nodes):

```
  status=ok source=RepEllipsoid::ray  ops={6: 367, 18: 367, 31: 367}
  unhandled_ops={}
  ellipsoid instances n=367   payload=27892 bytes (27.2 KB)
  buffers: xyzr=1468 f32  axes=3303 f32  rgba=1468 f32  pick=734 i32
  [0] centre=(16.885, 14.078, 3.427)  size=0.4343
      axes row0=(0.4334, -0.3178, -0.1358)
      axes row1=(0.3895, 0.7083, -0.4147)
      axes row2=(0.4527, 0.2519, 0.8553)
      pick=(index=0, bond=-1)
  every ellipsoid centre == coord of the atom its pick index names: True (0 bad)
  worst |dot(axis_i, axis_j)| over all 367x3 pairs: 6.16e-08 (must be ~0)
```

`axes` is the 3×3 from `CGOSimpleEllipsoid` (`layer1/CGO.cpp:4535`): three **non-unit** row vectors
whose lengths are the semi-axes. Draw as a unit sphere transformed by that matrix, translated to
`xyzr[0:3]`. `xyzr[3]` is the ellipsoid *scale* factor PyMOL passes alongside.

> `axes=3303` is 9 × 367 = 3303 floats. The buffer is correct; the odd-looking number is just
> 9 per instance.

---

## 5. The rest of D6 — audit of the previously `unsupported` reps

### 5.1 Now supported

```
--- cell: the unit cell box ---------------------------------------
  status=ok source=CoordSet::UnitCellCGO
  ops={12: 1, 13: 1, 28: 1} unhandled={}
    draw_arrays mode=1 (GL_LINES=1) nverts=24 arraybits=0x1
    box min=(0.000,0.000,0.000) max=(50.840,42.770,28.950)
  symmetry: [50.84, 42.77, 28.95, 90.0, 90.0, 90.0, 'P 21 21 21']

--- extent: the AABB ----------------------------------------------
  status=ok source=CObject::ExtentMin/ExtentMax  lines n=12 (12 box edges)
  box  min=(14.882, 13.048, -1.744)  max=(45.747, 46.814, 36.251)
  cmd.get_extent('u') = [[14.882, 13.048, -1.744], [45.747, 46.814, 36.251]]

--- measurement objects: dashes, angles, dihedrals -----------------
  d1   dashes     status=ok  source=RepDistDash::V  segments=14  radius=0.000 linewidth=2.5
  a1   angles     status=ok  source=RepAngle::V     segments=12  radius=0.000 linewidth=2.5
  h1   dihedrals  status=ok  source=RepDihedral::V  segments=17  radius=0.000 linewidth=2.5
  cmd.get_distance = 8.7592 A ; cmd.get_angle = 99.71 deg ; cmd.get_dihedral = 143.30 deg
  every dash vertex lies on the a-b segment: worst deviation 2.31e-12 A
```

* **`cell`** comes out of `CoordSet::UnitCellCGO`, which is a `CGO_DRAW_ARRAYS` with
  `mode = GL_LINES` and 24 vertices (12 edges). It is *not* a `lines` bucket — the client reads it
  from `draw_arrays`, which it already supports. Measured on 1UBQ the box spans
  `(0,0,0) .. (50.840, 42.770, 28.950)` Å, i.e. it is the crystal cell with its origin corner at the
  model-space origin, and the extents equal `cmd.get_symmetry()[0:3]` exactly.
* **`extent`** is synthesised from `CObject::ExtentMin/ExtentMax`, falling back to
  `ExecutiveGetExtent` because `ObjectMolecule` never latches `CObject::ExtentFlag`. 12 segments in
  the `lines` bucket. Verified equal to `cmd.get_extent()`.
* **`dashes` / `angles` / `dihedrals`** read the raw `float* V` of `RepDistDash` / `RepAngle` /
  `RepDihedral` (one mirror covers all three; `RepAngle` uses `pymol::vla<float>`, which holds
  exactly one `float*`, `layer0/vla.h:42`). The dash **pattern is already baked into `V`** by the
  rep builder, so the client draws the segments verbatim — no `dash_gap` arithmetic client-side.
  The strongest validator available is `I->ds == ds`; it must equal the `DistSet` the rep was
  reached through, or the call returns `layout-mismatch`.
* **`cgo`** (standalone `ObjectCGO`) is harvested from `ObjectCGO::State[s].origCGO`.

**One real trap, found by running it.** `RepDistDash::radius` and `::linewidth` are only assigned
*inside* `render()` (`layer2/RepDistDash.cpp:340`, `RepAngle.cpp:70`, `RepDihedral.cpp:75`), so on a
never-rendered rep — which is exactly the GL-free case this accessor exists for — they read **0**.
The accessor now reports the two settings those lines read from (`dash_radius`, `dash_width`)
under `radius`/`linewidth`, and the raw members under `rep_radius`/`rep_linewidth` so a layout
drift stays visible. The signature hashes the settings for the same reason, so `set dash_radius`
bumps the version.

### 5.2 Full status table (1UBQ, one object, one state)

```
  labels      -> unsupported     rep 'labels' has no CPU-side geometry accessor
  slice       -> not-built
  volume      -> not-built
  callback    -> not-built
  cgo         -> not-built       (an ObjectCGO returns ok; a molecule has no cgo rep)
  surface     -> ok
  mesh        -> ok
  dots        -> ok
  lines       -> ok
  ribbon      -> ok
  nonbonded   -> ok
  nb_spheres  -> ok
  cartoon     -> ok
  sticks      -> ok
  spheres     -> ok
  ellipsoids  -> empty           (1UBQ has no ANISOU; 1EJG returns 367)
  cell        -> ok
  extent      -> ok
```

### 5.3 Still unsupported, and why — these are not laziness

* **`labels`** — a label is not geometry. `RepLabel` holds text plus a `cSetting_label_*` font
  stack; drawing it means rasterising a font, and the on-screen result is a screen-space billboard
  whose size does not scale with the model. The right answer is DOM/canvas text in the client
  driven by `cmd.get_model()`'s `label` field, not a vertex buffer. Shipping a vertex buffer here
  would be actively wrong.
* **`volume`** — a 3-D texture plus a transfer function. There is no CPU triangle geometry to
  extract at all; the whole rep is a ray-marching shader over a `GL_TEXTURE_3D`. Porting it means
  porting a volume renderer to WebGL2 and shipping the map, which is a work package of its own.
* **`slice`** — a textured quad sampled from a map, regenerated per frame from the slice plane. Same
  problem as volume: the payload is a texture, not vertices.
* **`callback`** — by definition arbitrary user C/Python code that issues GL calls at render time.
  There is nothing to serialise.

Everything else the plan listed is now supported.

---

## 6. Upstream-merge surface

```
 layer3/Executive.cpp      |   69 ++++
 layer3/ExecutiveDef.h     |   20 +
 layer4/Cmd.cpp            |    4 +
 layer4/CmdWebGeometry.cpp | 1012 +++++++++++++++++++++++++++++++++++++++++++
 4 files changed, 1100 insertions(+), 5 deletions(-)
```

Audited programmatically:

```
added lines: 93 removed lines: 0
layer3/Executive.cpp   blocks=10 guarded_lines=64  unterminated=False
layer3/ExecutiveDef.h  blocks=1  guarded_lines=19  unterminated=False
layer4/Cmd.cpp         blocks=2  guarded_lines=10  unterminated=False
   line 6472 guarded=True : {"web_get_versions", CmdWebGetVersions, METH_VARARGS},
   line 6473 guarded=True : {"web_resolve_pick", CmdWebResolvePick, METH_VARARGS},
```

**Zero lines removed from any upstream file, and every added line sits inside a
`tenmol web client -- BEGIN … END` block.** No build-file change was needed — `setup.py:808-816`
globs `layer4/*.cpp`.

`layer4/CmdWebGeometry.cpp` gained one more layout mirror, which is the only thing that can drift:

| mirror | upstream |
|---|---|
| `mirror::RepDistLines` | `layer2/RepDistDash.cpp:40-55`, `layer2/RepAngle.cpp:36-51`, `layer2/RepDihedral.cpp:35-48` |

Run `t3_instances.py` at each merge; a `layout-mismatch` names the file that changed.

---

## 7. Reproducing

Build (unchanged from `spikes/00-build.md`):

```bash
bash scripts/bootstrap.sh --force-pymol
```

Scripts, all in `<scratch>/nat/`:

| script | proves |
|---|---|
| `t1_counters.py` | §2.2 §2.3 §2.4 — D1, no false positives, recolour visibility |
| `t1b_cost.py` | §2.5 — idle vs walk cost on 1AON |
| `t1c_differential.py 800` | §2.5 — gated vs `force=1` over 800 random commands |
| `t2_pick.py` | §3.1 §3.2 — the pick round trip against a real GL pick |
| `t2b_disagree.py` | §3.3 §3.4 — the silhouette scan and the corner-convention table |
| `t2c_offset.py` | §3.3 — the pixel-centre offset sweep that ruled out a convention error |
| `t2d_ring.py` | §3.3 — 16/18 → 18/18 with the `cRange = 7` snap |
| `t3_instances.py` | §4 §5 — cones, ellipsoids, cell, extent, measurements, the audit |
| `probe_surfpick.py` | §3.5 — `pick_surface` defaults to off |

Test suites:

```
$ bridge/.venv/bin/python -m pytest bridge/tests -q
129 passed, 64 warnings in 30.26s

$ bridge/.venv/bin/pymol -ckq testing/testing.py --run all
Ran 961 tests in 6.788s
FAILED (failures=1, errors=1, skipped=276)
======================== 57 passed, 31 skipped in 0.21s ========================
```

The single failure (`symop_py.TestBondSymOp.test_commands`) and the single error
(`exporting_py.TestExporting.testglTF`) are **byte-identical to the spike-00 baseline** and predate
this work. `requests` and `biopython` must be present in the venv or the suite reports 3–4 extra
import errors that have nothing to do with these changes.

---

## 8. What this leaves for the other agents

1. **Bridge** — replace the 4 Hz `get_vis()`+`get_state()`+content-hash fingerprint with
   `web_get_versions()`. Cache per `(object, rep, state)` version; refetch only on a bump; drop on
   `active: false`. That is D1, done properly.
2. **Bridge / protocol** — plumb `spheres.pick`, `cylinders.pick1/pick2`, `cones.pick`,
   `ellipsoids.pick`, `lines.pick1/pick2`, `crosses.pick`, `draw_arrays[].pick` and `surface.atom`
   through the wire format; add a `resolve_pick` RPC over `_cmd.web_resolve_pick`.
3. **WebGL** — add the `cone` and `ellipsoid` instance draws (`packages/viewport/src/modeG/instances.ts`
   currently lists both as "NOT DRAWN — reported as a fallback reason"). The buffer layouts are §4.
   Then implement picking with **both** rules from §3.3/§3.4 — the `cRange = 7` outward ring scan and
   the last-triangle-corner convention — or clicks will disagree with Mode P near silhouettes.
4. **WebGL** — `cell` arrives as a `draw_arrays` block with `mode = GL_LINES`, not in the `lines`
   bucket; `extent`, `dashes`, `angles`, `dihedrals` all arrive in the `lines` bucket.
5. **Product** — decide whether Mode G should honour `pick_surface` (§3.5). Client-side picking is
   strictly more capable than the backend here, which is a parity *difference*, not a parity gap.
