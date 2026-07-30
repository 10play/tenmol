# 03 — Implementation Plan

**Status: authoritative. This document SUPERSEDES `01-architecture.md`.** Where the two disagree,
this one wins. `01` is retained only as a historical record of what was believed before the spikes
ran.

**Inputs:** `00-parity-inventory.md` (the definition of done), `02-completeness-critique.md`
(A1–A9, B1–B9, C1–C6), the five executed spikes in `spikes/`, the monorepo verification pass, and
four experiments run while writing this document (§1.3, §1.6 — scripts in
`<scratch>/pick/g2_glraster.py`, `g3_encode.py`, `g4_drag.py`, `g6.py`).

**What changed, in one paragraph.** The previous plan was wrong about the single most load-bearing
thing in it. It said the bridge must never call `draw()`. In fact the bridge must call `draw()`
every tick, on a real hardware GL context that we can create from ~20 lines of `ctypes` with no
window, no Qt, no GLUT and no `NSApplication`. With that context PyMOL's own renderer draws a
58,870-atom cartoon at **1280×960 in 0.5 ms**, reads it back in **1.0 ms**, and JPEG-encodes it in
**1.9 ms** — a complete server-rendered frame in **3.4 ms**, measured on this machine. That single
fact demolishes the project's biggest risk: **a fully correct, 100 %-fidelity PyMOL viewport ships
in v1 with zero new C++**. Client-side WebGL (and therefore the new C++ geometry accessor) becomes
a latency/polish enhancement on a second track, not the critical path.

---

## 0. Table of contents

1. [Five settled decisions](#1-five-settled-decisions)
2. [Blocker resolutions — A1–A9](#2-blocker-resolutions--a1a9)
3. [Unmapped surface — B1–B9 and C1–C6](#3-unmapped-surface--b1b9-and-c1c6)
4. [C++ work](#4-c-work)
5. [Repository layout and the anti-collision mechanism](#5-repository-layout-and-the-anti-collision-mechanism)
6. [Work packages with full file ownership](#6-work-packages-with-full-file-ownership)
7. [What is not achievable](#7-what-is-not-achievable)
8. [Decisions the product owner must make](#8-decisions-the-product-owner-must-make)
9. [Sequencing and gates](#9-sequencing-and-gates)

---

## 1. Five settled decisions

These five were the open guesses. They are now closed. No work package may reopen them without an
experiment that contradicts the evidence cited here.

### 1.1 SETTLED — The pump

**Decision.** One thread ("the engine thread") owns a real OpenGL context, the PyMOL engine, every
`cmd.*` call, and a `draw()`-driven pump at 60 Hz. `01-architecture.md:47-52` and `:251` ("the
bridge pump **never** calls `p.draw()`") is **DELETED**. It was wrong.

Exact boot sequence, in order, all on the engine thread, before anything else runs:

```python
# 1. GL context FIRST — before pymol2.PyMOL().start()
#    CGL legacy 2.1 profile, no drawable; one FBO (RGBA8 colour + DEPTH24 renderbuffers).
GLF, gl, ctx, fbo = make_gl_context(W, H)          # ~20 lines of ctypes, see spike 04 E4/E5

# 2. pmgui must be 1 or the feedback queue is dead forever (layer1/Ortho.cpp:492-499,
#    layer1/P.cpp:1820). Options are snapshotted at _cmd._new, so this must precede start().
pymol.invocation.options.no_gui = 0

# 3. SingletonPyMOL, never pymol2.PyMOL — pcatch writes through the file-scope
#    SingletonPyMOLGlobals pointer (layer1/P.cpp:2667); with a non-singleton it silently
#    DISCARDS every print(), which is worse than not installing it (spike 02 §2c).
p = pymol2.SingletonPyMOL(); p.start()

# 4. Python-origin output into the same line buffer as C-origin output, correctly interleaved.
import pcatch; pcatch._install()

# 5. Critique A4. locking.is_gui_thread() is `gui_ident is None or gui_ident == get_ident()`
#    (modules/pymol/locking.py:80-86) and pymol.glutThread is module-level None
#    (modules/pymol/__init__.py:543); SingletonPyMOL.start() never sets it. Without this line
#    EVERY thread is "the GUI thread" and the ordering guarantee is fiction.
pymol.glutThread = threading.get_ident()

# 6. Window coords == viewport coords. With the defaults, reshape(640,480) yields
#    get_viewport() == (420,462) and every mouse coordinate is wrong (spike 04).
cmd.set('internal_gui', 0); cmd.set('internal_feedback', 0)
p.reshape(W, H, 1)

# 7. >= 3 warm-up draws. IDLE_AND_READY == 3 (layer5/PyMOL.cpp:105); IdleAndReady only
#    increments when DrawnFlag is set (:2413-2415), and DrawnFlag is only set inside
#    PyMOL_DrawWithoutLock (:2325,:2328). Until then OrthoExecDeferred never runs.
for _ in range(5): p.draw(); p.idle()
```

Steady-state tick (60 Hz, ~16 ms budget):

```
drain the command FIFO (one request at a time, execute, reply)
p.idle()
p.draw()                      # MANDATORY — this is what drains OrthoDefer
if pixel mode subscribed and the scene is dirty:  readback → encode → emit
every 2nd tick:               state snapshot diff (§1.5)
```

**Why `draw()` is mandatory.** Every click, drag, release, deferred `cmd.png`, deferred `cmd.ray`,
`SeqUpdate` and `ModalDraw` completion is *queued* through `OrthoDefer` and drained only by
`OrthoExecDeferred` (`layer1/Ortho.cpp:268-277`), whose only caller in the tree is
`ExecutiveDrawNow` (`layer3/Executive.cpp:11521-11523`). Reaching `ExecutiveDrawNow` via
`cmd.refresh()` is **not** a substitute: `CmdRefresh` never sets `I->DrawnFlag`, so
`PyMOL_GetIdleAndReady` stays false and the deferred queue stays permanently locked (spike 04 E1:
a click produces two `OrthoDirty: called.` lines and the deferred lambda never runs).

**`spikes/00-build.md` §6.1 is AMENDED, not overturned.** `_cmd._draw` does not segfault "headless"
per se. It segfaults only when `options.no_gui == 0` (⇒ `HaveGUI = pmgui = 1`,
`layer1/P.cpp:1820` + `layer5/PyMOL.cpp:2248`) **and** no GL context is current, at the
`glGetString` on `layer5/PyMOL.cpp:2307`. With a current CGL context it is required, not forbidden.

**Verified by me, this session** (`<scratch>/pick/g4_drag.py`, one process, one configuration):

```
pmgui(no_gui)= 0
viewport (800, 600)
view0 rot [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
view1 rot [0.7577, 0.0, -0.6526, 0.0, 1.0, 0.0, 0.6526, 0.0, 0.7577]
ROTATION HAPPENED: True
PyMOL>print('hello-from-pixel-mode')
hello-from-pixel-mode
```

That is the combination the monorepo verification listed as an open blocker ("I did NOT re-measure
whether a drag rotates the camera under `pmgui=1`"): a rubber-band drag rotates the camera **and**
the feedback queue delivers both the C-origin echo and the Python-origin `print` in the same
process. There is no trade-off. `pmgui=0 + tick=draw` is abandoned.

**Gotcha the bridge must honour.** After `pcatch._install()` the bridge's own `print()` calls land
in `cmd._get_feedback()` and pollute the user's console. In the run above, `pmgui(no_gui)= 0`,
`viewport (800, 600)` and `ROTATION HAPPENED: True` — my script's own diagnostics — all appeared in
the drained feedback list. **The bridge logs to `stderr` only, never `stdout`, after step 4.**

**Threading.** Exactly two threads may touch PyMOL:

| Thread | May call | Rate |
|---|---|---|
| engine | everything: `cmd.*`, `p.draw`, `p.idle`, `p.button`, `p.drag`, GL | 60 Hz |
| status | **only** `cmd.get_progress()`, `cmd._get_feedback()`, `cmd.get_setting_updates()` | 10 Hz |
| uvicorn/asyncio | nothing. Ever. | — |

The status thread exists because those three are the only lock-*attempting* calls
(`modules/pymol/monitoring.py:5-7` `lock_api_status`; `modules/pymol/internal.py:596-606` and
`modules/pymol/setting.py:440-447` `lock_attempt` = `acquire(blocking=0)`,
`modules/pymol/locking.py:29-30`). They returned in 0.0–0.1 ms *during* a 4.3 s `cmd.ray()`, while
`cmd.get_names()` from the same probe **blocked for 3,808.8 ms** (spike 05 §6). A generic "poller
thread" design stalls for the full duration of any long C++ call. `cmd.get_progress()` produced
real fractions (0.25 → 0.386 → 0.440 → 0.495 → 0.577 → 0.734) throughout that ray — it is the only
liveness signal available while PyMOL is busy, and the UI's busy indicator is built on it.

**Platform.** The `ctypes` GL shim is macOS/CGL today. `brew` ships no OSMesa and no ANGLE, and
Homebrew's `mesa` formula enables `-Dosmesa`/`-Degl`/`-Dglx` only on its Linux branch (spike 04).
Linux (EGL surfaceless / GLX pbuffer) and Windows (WGL + hidden window) are a **separate spike**,
not a v1 deliverable. The shim is platform-dispatched from day one so the seam exists.

### 1.2 SETTLED — Feedback capture

**Decision.** `pmgui = 1` + `SingletonPyMOL` + `pcatch._install()`, drained unconditionally on the
10 Hz status tick. This is spike 02's answer and nothing has changed it.

Non-negotiable rules for the bridge:

* `cmd._get_feedback()` returning `None` means **"locked, retry"**, not "no output"
  (`modules/pymol/internal.py:596-606`). Treating `None` as empty silently drops console lines.
* `cmd.get_setting_updates()` returning `[]` on a lock miss is indistinguishable from "nothing
  changed" (`modules/pymol/setting.py:440-447`). Never build quiescence/settle detection on it.
* Drain **every** status tick regardless of client presence. `layer1/Ortho.cpp:492-499` pushes into
  an uncapped `std::queue<std::string>`; 20,000 undrained lines cost +2.98 MB RSS (spike 05 §4). A
  disconnected browser must not leak PyMOL memory. The bridge holds its own capped ring buffer.
* The bridge is the **exclusive** consumer of all three destructive drains: `_get_feedback()`,
  `get_setting_updates()` (global **and** the separate per-object channel), and
  `getRedisplay(reset=True)`. Proven destructive: two interleaved consumers gave
  `consumerA saw: [468]`, `consumerB saw: []`. No `pymol.rpc`, no `pymol.pymolhttpd`, no Qt GUI,
  no plugin may run in this process. **Enforced by a lint rule** (§6, WP-27) that fails CI if those
  three symbols appear anywhere outside `bridge/tenmol_bridge/feedback.py` and `status.py`.

Severity is heuristic and tagged `inferred: true` at the boundary — `modules/pymol/colorprinting.py`
assigns `error`, `warning`, `suggest` and `parrot` all directly to `print`, so severity is destroyed
before the string reaches the Ortho queue.

### 1.3 SETTLED — The geometry / render feed: two modes, pixel mode first

This is the decision that restructures the whole project.

#### Mode P — server-rendered pixels (v1 default, zero C++)

PyMOL renders into the offscreen FBO with its own shaders; the bridge reads the framebuffer back
and streams encoded frames to a `<canvas>` in the browser.

**Measured on this machine** (M4 Max, `GL_RENDERER = "Apple M4 Max"`, `GL_VERSION = "2.1 Metal -
89.4"`), 1AON = **58,870 atoms**, cartoon, `<scratch>/pick/g2_glraster.py` and `g3_encode.py`:

| Stage | 1280×960 | 2560×1920 (retina) |
|---|---|---|
| `cmd.turn` + `p.draw()` + `glFinish` | **0.5 ms** (median of 60; p95 1.0 ms; 1,880 fps) | — |
| `+ glReadPixels` RGBA (4.9 MB) | **1.0 ms** (1,005 fps) | — |
| JPEG q80 encode | **1.9 ms** → 209,186 B | — |
| **full frame draw+readback+encode** | **3.4 ms ≈ 290 fps** | **13.9 ms ≈ 72 fps**, 599,555 B |
| WebP q80 encode | 18.8 ms → 175,370 B | — |
| PNG `compress_level=1` | 10.5 ms → 746,205 B | — |
| `cmd.png(ray=0)` end-to-end (pumped to file) | **0.075 s** → 644,245 B (3,394 unique RGB) | — |
| surface, 2 chains of 1AON, draw+glFinish | 0.8 ms (1,253 fps) | — |
| `cmd.ray(640,480)` for comparison | 1.283 s | — |

**This overturns `spikes/03-geometry.md` §"NO SERVER RASTER".** That spike measured
`cmd.png(ray=0)` at 9.241 s/frame for 1AON and concluded "server-side pixel streaming is not a
viable interactive mode; client-side WebGL is mandatory and the geometry accessor is on the
critical path". It measured that because it ran **with no GL context** — `cmd.get_renderer()`
returned `('', '', '')` — so `cmd.png(ray=0)` silently fell through to the CPU ray tracer. With the
context from spike 04, `cmd.get_renderer()` returns `('Apple', 'Apple M4 Max', '2.1 Metal - 89.4')`
and the same call is **0.075 s**, a 123× difference. The two spikes never ran in the same process;
this document is the first place they meet.

Mode P's transport policy, derived from the numbers above:

* Render at **CSS pixels during motion**, at `devicePixelRatio` on settle (13.9 ms retina frames
  are fine for a still, not for a drag).
* **JPEG q80 during motion** (1.9 ms, 209 KB), **PNG `compress_level=1` on settle** (10.5 ms,
  746 KB, lossless — text, thin lines and `ray_trace_mode` outlines survive intact). This is the
  only place lossy compression touches the product and it is bounded to the motion window.
* At 30 fps / 1280×960 / JPEG that is **6.3 MB/s** over a loopback WebSocket. At retina 30 fps it
  is 18 MB/s. Both are fine on loopback; neither would be over a network, and this product is
  localhost by definition.
* Frames are dropped, never queued: the bridge emits at most one un-acknowledged frame per client.

**What Mode P buys, and it is enormous:** every rep renders exactly as PyMOL renders it, because it
*is* PyMOL rendering it. Transparency and OIT, `volume`, `slice`, `cRepCallback` CGOs, labels with
real font atlases, ellipsoids, `ray_trace_mode` cel shading, stereo modes, ambient occlusion,
`use_shaders=0` legacy paths, every one of the 46 shaders in `data/shaders/`. Nothing in the
351-row parity inventory renders wrong, because nothing is re-implemented.

**What Mode P costs:** one round-trip of camera latency (browser event → WS → engine → draw →
readback → encode → WS → decode → paint; ~3.4 ms server + 2×1–3 ms loopback RTT + browser decode,
so roughly 10–20 ms), and a JPEG-quality viewport during motion. Both are acceptable for a local
desktop replacement; neither is acceptable as the permanent end state, which is why Mode G exists.

#### Mode G — client-side WebGL (enhancement, requires new C++)

`layer4/CmdWebGeometry.cpp` (§4) feeds three.js. Enabled per-rep with automatic fallback to Mode P
for any rep it cannot express. It removes the round-trip, gives DOM-crisp overlays and free camera
motion, and is the long-term target — but **no v1 feature blocks on it**.

Everything `spikes/03-geometry.md` proved about the *existing* export paths still stands and is why
Mode G needs C++ rather than `get_vrml`:

* **Total identity loss.** Two objects with two reps export as ONE `IndexedFaceSet`, 0 `DEF` names,
  0 object names, no atom indices. Measured: `VRML2 Shape count: 1`, `object names present in wrl:
  []`, `'DEF' occurrences: 0`.
* **Silent data loss.** Ellipsoids produce 0 bytes in every exporter while the ray tracer reports
  "processed 367 graphics primitives". Labels 0 bytes. Volume 0 bytes. A 0.5-transparent surface
  emits the string `transparency` **0 times** in VRML.
* **Primitive substitution.** `lines`/`mesh`/`dots`/`isomesh` become 3D cylinders and spheres: a
  660-atom 1UBQ `mesh` becomes 31,710 cylinders + 63,420 spheres = 31.9 MB `.wrl` / 133.7 MB
  `.dae`; `dots` = 658 MB `.dae`.
* **ASCII blow-up.** 1AON cartoon = 246,021,746 bytes in 1.928 s, costing 2.25 s and **1.77 GB
  RSS** to parse in V8 for what is 93 MB of float32.
* **Zero dirty tracking.** Four consecutive identical `get_vrml` calls: 0.166/0.165/0.164/0.163 s,
  byte-identical each time. A single `cmd.color` on 1AON costs a fresh 1.92 s + 246 MB.

Corrections to `geometry-extraction.md` that the spike proved and that WP-26 must carry:

* `geometry-extraction.md:347` — the per-call cost table (`get_vrml` 10⁰–10¹ s, `get_collada`
  10¹–10² s) is **wrong by 1–2 orders of magnitude**. Measured on a 4,779-atom three-rep scene:
  `get_vrml(2)` 0.820 s, `get_collada` 0.650 s. Replace with `spikes/03-geometry.md` §3 Table 1.
* `geometry-extraction.md:22-23,272` — keep the conclusion, replace the justification. The reason
  is identity loss + silent drops + primitive substitution + ASCII blow-up + no dirty tracking, not
  speed.
* `geometry-extraction.md` §4 — IDTF mesh data is in `get_idtf()[1]` (474 KB for a 1UBQ cartoon),
  not `[0]` (a 1,046 B node list).
* `geometry-extraction.md` §8 item 8 — `slice` is **not** `volume`. `slice` exports 27,328 real
  triangles; `volume` exports 0 bytes.
* `geometry-extraction.md:597-599` — closed: `_PYMOL_NO_RAY` is not set in this build; all five
  exporters and `cmd.ray` work headless.
* `geometry-extraction.md:600-602` — closed: `pymol._cache` entries survive delete+reload and are
  hit (0.003 s vs 0.077 s cold, access count 1→2), but carry no object/state/rep identity and every
  write raises `TypeError: unhashable type: 'list'` (`layer1/P.cpp:1321`, swallowed by `PyErr_Print`
  at `:1374`).
* `cmd.rebuild()` does **not** build geometry (`C after cmd.rebuild(): 0`). The trigger is
  `cmd.refresh()` or any exporter (`C after get_vrml: 1`). Both run `SceneUpdate` with no draw.

Three constraints on the accessor's design, each from a measured failure of the export path:

1. It must emit `CGO_SPHERE` (`layer1/CGO.h:99`) and `CGO_SHADER_CYLINDER` /
   `CGO_SHADER_CYLINDER_WITH_2ND_COLOR` (`:197`, `:200`) as **instance buffers**, never tessellated,
   or `mesh`/`dots`/`lines` degrade exactly the way the exporters degrade them.
2. Payloads must be keyed **per object, per rep, per state**, and carry atom indices
   (`RepSurface::AT`, `layer2/RepSurface.cpp:84`; `CGO_PICK_COLOR`, `layer1/CGO.h:150-151`).
   Without that there is no per-rep update, no recolour-only update, and every change forces a full
   scene re-pull.
3. It must never read back a VBO — `layer1/CGO.h:183-186` documents that the CPU copy is
   deliberately destroyed after upload. It reads `primitiveCGO` / `preshader` / `ray` and the
   `RepSurface` vectors only. **New hazard in Mode G**: because we now *do* render, `RepCartoon`'s
   `disposePreshaderCGO` (`layer2/RepCartoon.cpp:83-89,240`) **will** fire. The previous plan's
   assumption ("in our process no GL render ever happens, so the preshader survives") is dead. WP-26
   must extract from `primitiveCGO`, or re-`cmd.rebuild()` before extraction, and prove it in a test.

`pymol._cache` is not an interim substitute: the tuple has exactly 6 elements
`(N, V, VN, NT, T, S)` — no `VC` colours, no `VA` alpha, no `VAO`, no `Vis`, no `AT`, no object
identity (`-> any object name in entry? [False, False]`).

### 1.4 SETTLED — Picking is backend-authoritative

**Decision.** `01-architecture.md:497-504` ("Our picking is therefore client-side (three.js
raycast)") and §3.7 in full are **DELETED**. `00-parity-inventory.md:519` was right. Critique A5
resolves in favour of `00`.

Mouse events forward 1:1 to the engine; PyMOL does the picking in its own GL context and the client
renders the result. Measured working, unmodified and unpatched (spike 04):

* single-atom click select — 11 distinct atoms from 11 grid clicks on an 82-atom peptide, spatially
  correct (`(500,320) -> PHE'6/N`, `(620,320) -> GLY'7/CA`, 21 background clicks → `None`)
* rubber-band multipick — 668 atoms on a 5,684-atom structure in **5.4 ms**
* editor `pk1`/`_pkfrag` picking, `get_click_string`, `cmd.draw`, `cmd.png`, `cmd.ray`
* `cmd.mpng`'s `ModalDraw` loop, with the engine still alive afterwards
* all of it on a worker thread; the main thread never touches GL
* `use_shaders=0` and `pick32bit=1` both pick correctly
* resize works by re-storaging the **same** FBO name (id stable at 1 across 640×480 → 1280×800 →
  400×300 → 1920×1080) — the FBO must never be regenerated, because
  `G->ShaderMgr->defaultBackbuffer.framebuffer` is latched at first draw
  (`layer5/PyMOL.cpp:2236-2239`)

Why client-side raycasting loses decisively: the CGO pick colour is a per-frame draw-order counter
(`PickColorManager::colorNext`, `layer1/Picking.cpp:150-186`) whose reverse map holds raw
`pymol::CObject*` and is invalidated on every geometry rebuild — **it is not shippable at all**.
Only the underlying `(index, bond)` pair is, and shipping that needs new C++ *plus* re-implementing
16 rep-specific pick sources (`ObjectCGO ObjectCurve ObjectGadget ObjectGadgetRamp ObjectSlice
RepCartoon RepCylBond RepDistLabel RepEllipsoid RepLabel RepNonbonded RepNonbondedSphere RepRibbon
RepSphere RepSurface RepWireBond`), `cPickableNoPick`/`Through`, `mouse_selection_mode`, `cmd.mask`,
the 15×15 px spiral tolerance, and a brand-new inject-pick API for drag-based editing (`RotF`/`TorF`
/`MovA`/`DrgM` consume `LastPicked` on every mouse-move frame).

Protocol consequences, all mandatory:

* Mouse input maps 1:1 to `PyMOL_Button(button, state, x, y, modifiers)` / `PyMOL_Drag(x, y,
  modifiers)`. `P_GLUT_LEFT/MIDDLE/RIGHT = 0/1/2`, `DOWN/UP = 0/1`
  (`layer0/os_gl_glut_pretend.h:11-26`); `modifiers` is the `cOrtho` bitmask `SHIFT=1 CTRL=2 ALT=4`.
* **PyMOL window coordinates are bottom-left origin.** Flip the browser `clientY`.
* **The client must not debounce clicks below 150 ms.** `SceneIdle` only promotes press+release to
  `P_GLUT_SINGLE_LEFT` after `I->SingleClickDelay = 0.15` (`layer1/SceneMouse.cpp:1152`, consumed at
  `layer1/Scene.cpp:2441`). Measured single-click end-to-end latency: 0.1504–0.1505 s, ten times out
  of ten — 0.15 s of which is that hard-coded delay. This is a floor, not a bug to fix.
* Pick result shape (from a real `get_click_string` dump): `{type: 'none' | 'object:molecule' |
  'object:cgo', object, state (1-based), index (**1-based**, per `layer4/Cmd.cpp:2689`; note
  `Picking::src.index` is 0-based), bond (0-based, or `cPickable_t` −1…−5), rank, id, segi, chain,
  resn, resi, name, alt, pos: [px, py, pz]}`.

`00-parity-inventory.md` §14 item 6 is **wrong**: `cmd.get_click_string` needs **no C++**. The
implementation is at `layer4/Cmd.cpp:1420-1436` and it is already registered in the method table at
`:6451` (verified). What is missing is a Python wrapper in `modules/` — which we cannot add — so the
bridge calls `_cmd.get_click_string(...)` directly, plus a `cmd.button('single_left', 'none',
'clik')` binding to arm `cButModeSimpleClick`.

**CI constraint.** Offscreen-GL picking tests require a logged-in macOS user session
(WindowServer). They cannot run on a headless runner with no console session. Gate them exactly the
way the ray image-diff tests are gated.

### 1.5 SETTLED — Change detection is polling; no C++ for v1

**Decision.** A 30 Hz tick (4 Hz when `document.hidden`, driven by a client `poll.rate` message)
that snapshots `names/enabled/groups/view/frame/state/scenes/vis/movie/wizard` and drains the
global + per-object setting channels. **No C++ change counters in v1.**

Measured on a 52,569-atom, 11-object scene (spike 05 §3): tick cost **median 67.7 µs, p95 97.3 µs,
max 229.6 µs**; 11.00 s wall for 0.027 s process CPU = **0.25 % of one core** including the status
thread; **zero** false-positive emissions over 300 idle ticks. Per-call medians: `get_names()`
1.3 µs, `get_view()` 2.0 µs, `get_vis()` 3.1 µs, `get_setting_updates()` 1.0 µs, `get_frame()`
0.2 µs, `get_scene_list()` 0.7 µs, `get_wizard()` 0.9 µs. Sum of the whole poll set = 437 µs against
a 33,333 µs budget.

Rules that fall out of the measurements:

* **`cmd.count_atoms()` is banned from the hot tick** — 5,902 µs for a selection at 500k atoms, 18 %
  of a 30 Hz budget, and the only call in the set that scales. Selection counts are a debounced
  client request ~150 ms after the `names`/`enabled` diff settles.
* Above 30 Hz buys nothing. The camera is driven from the browser; the client already knows its own
  view.
* **Polling cannot see per-atom state.** `cmd.get_vis()` is object-level only — proven:
  `show spheres, m and name CA` leaves `get_vis` byte-identical while 574 atoms carry the rep.
  Per-atom colour is equally invisible. These come from the **command-echo invalidation channel**
  (below), never from a poll.
* **Add the command-echo invalidation channel.** Every command the bridge executes emits its
  invalidation classes (`color` / `reps` / `geometry` / `coords` / `names`) alongside the result;
  `cmd.do`, `cmd.run` and `@script` emit `resync: full`. This is the only mechanism that covers
  per-atom colour, per-atom reps, `alter`, and coordinate edits.
* A session load produces `len(get_setting_updates()) == 798` — a usable full-resync signal.
* `scenes_changed` (setting 254, `layer1/SettingInfo.h:339`) and `session_changed` (setting 521,
  `:621`) already ride the setting drain. Critique B4 is correct; `00 §14 item 17` over-scopes and
  `00 §15 risk 20` ("shutdown has no safe hook") is wrong.

**Rejected push mechanisms, with reasons:**

| Mechanism | Verdict |
|---|---|
| wizard event mask (`layer1/Wizard.cpp:49-58`) | **Unusable.** Draw-pumped (`p.idle()` delivers nothing); misses `delete`/`select`/`ungroup` entirely; costs 38,313 µs per pump after a recolour-all; and there is **one** user-owned wizard stack — after `cmd.wizard('measurement')` the bridge's spy wizard received **zero** events. Wizards stay a proxied *feature*, never a transport. |
| `cmd.load_callback` | Never fires headless (0 hits after refresh / idle / ray). |
| `cmd.set_key` | GUI key events only. |
| `cmd.log_open` | Not a command stream — `cmd.do("turn x, 5")` logged nothing; only `log=1` calls appear. |
| C++ change counters | **v2 optimisation.** Insertion points identified but not applied: `layer1/Setting.h:67-70` `SettingRec::setChanged()`; `layer3/Executive.cpp:1513` `ExecutiveInvalidatePanelList` (11 call sites, **not** covering `ExecutiveSpecEnable` `:15376` or `ExecutiveSetName` `:3580`); `layer3/Executive.cpp:14001` `ExecutiveInvalidateRep`; field on `struct CExecutive`, `layer3/ExecutiveDef.h:54`. |

One item on that list is real new *capability*, not optimisation: a `ReprVersion` bump in
`ExecutiveInvalidateRep` would make per-atom rep and colour state visible to a cheap poll. It is
listed in §4 as optional C++ Task 3.

### 1.6 Summary of the five

| # | Decision | Evidence |
|---|---|---|
| 1 | `draw()` every tick on a CGL+FBO context; 3 warm-up draws; `pmgui=1`; `glutThread` set | spike 04 E1/E4/E6/E12; §1.1 run |
| 2 | `SingletonPyMOL` + `pcatch._install()`; bridge logs to stderr; exclusive drain owner | spike 02 §2b/§2c; §1.1 run |
| 3 | Mode P (server pixels) ships v1; Mode G (WebGL + new C++) is an enhancement | §1.3 table; spike 03 |
| 4 | Picking backend-authoritative; full mouse forwarding; 150 ms click floor | spike 04 E8/E9/E10/E13 |
| 5 | 30 Hz polling + command-echo invalidation; no C++ counters in v1 | spike 05 §2/§3/§6 |

---

## 2. Blocker resolutions — A1–A9

### A1 — "Never call `draw()`" disables all viewport input · **RESOLVED, the plan was wrong**

The critique was right and understated it. The plan's core assumption is deleted; see §1.1. The
pump calls `PyMOL_Draw` every tick on the GL-owning thread at ≥ 33 Hz and ≥ 3 times before accepting
any input. This single change also resolves A2 and A3.

### A2 — `ModalDraw` hangs the engine · **RESOLVED**

`cmd.mpng` completes and the engine survives. Measured (spike 04 E14):

```
== cmd.mpng (ModalDraw path) ==
 Movie: frame    1 of    5, 0.07 sec.
 Movie: frame    5 of    5, 0.01 sec.
mpng produced: 5 ['f0001.png',…,'f0005.png']
engine still alive? count_atoms= 10
 You clicked /ala///ALA`2/2HB
post-mpng selections: ['sele']
p.stop() returned cleanly
```

`I->ModalDraw` is cleared inside `PyMOL_Draw` (`layer5/PyMOL.cpp:2279-2286`); a pump that draws
clears it on the next tick. `movie.produce` is unblocked.

### A3 — Sequence-viewer model only built in the draw path · **RESOLVED**

`SeqUpdate`'s only call site is `OrthoDoDrawUpdateSeqView` (`layer1/Ortho.cpp:1470-1478`) inside
`OrthoDoDraw` (`:1882`), gated on the `seq_view` setting. Since we draw every tick, the Seeker model
is built and invalidated normally. WP-21 has a working data source. Reading it out still needs
either a new accessor (Mode G / C++ Task 5) or the Mode-P fallback of letting PyMOL draw the
sequence viewer into the framebuffer — see §7.

### A4 — "One ordered PyMOL thread" is not enforced · **RESOLVED, and already implemented**

The bridge sets `pymol.glutThread` to the engine thread's ident before `start()` and re-asserts
after. `bridge/tenmol_bridge/pump.py:1-38` already documents and does this. Verified live:
`/healthz` reports `"glutThread":12901707776, "threadIdent":12901707776`.

Additionally: leave `cmd._call_with_opengl_context` at its default `lambda f: f()`
(`modules/pymol/cmd.py:164-165`). It is already correct once every `cmd` call is marshalled onto the
GL-owning thread. **Do not** copy `modules/pmg_qt/pymol_qt_gui.py:1245-1252`.

### A5 — The two documents contradict each other on picking · **RESOLVED in favour of `00`**

See §1.4. Client-side raycasting survives only as an optional hover-highlight optimisation — never
as the source of truth, never driving a selection or an edit.

### A6 — The dispatcher deny-list forbids required features · **RESOLVED, deny-list replaced**

`01-architecture.md:357-364` is deleted. The replacement is a **capability policy with explicit
grants**, not a blanket deny-list.

| Symbol class | v1 policy |
|---|---|
| `cmd.run`, `cmd.do('@file')` | **Allowed.** Required by File ▸ Run Script (`00:61`) and by the demo wizard (`modules/pymol/wizard/demo.py:195`). Runs a local file the local user chose. |
| `cmd.cd` | **Allowed.** File ▸ Working Directory ▸ Change (`00:61`). |
| `cmd.system` | **Allowed, confirmed.** File ▸ Working Directory ▸ File Browser (`00:61`). First call in a session raises a client confirmation. |
| `cmd.quit` / `_quit` | **Allowed, routed.** Mapped to bridge shutdown, not to the C `exit()` path (`spikes/00-build.md` §6.2: PyMOL tears the process down with C `exit()`, skipping `atexit` and `Py_FinalizeEx`). |
| `cmd._ctrl` / `_alt` / `_ctsh` | **Allowed.** Real symbols at `modules/pymol/internal.py:488,494,509`, registered at `modules/pymol/keywords.py:46`; the ortho CLI chord fallback (`00:110`) needs them. The "anything starting with `_`" rule is deleted. |
| `t:'do'` | **Allowed from the UI.** Every `pymol.menu` popup leaf and every wizard button returns a *command string* (`layer4/PopUp.cpp:471-475`, e.g. `modules/pymol/menu.py:824`). Declaring it console-only made WP-13 and WP-16 unimplementable. |

The security boundary is **not** the symbol list — it is the transport: `127.0.0.1` bind only, a
256-bit token minted at startup with mode `0600`, an `Origin` allow-list, and the loopback peer
check (the precedent is `modules/pymol/pymolhttpd.py:61-68`). This product executes arbitrary local
code *by design*; pretending otherwise with a deny-list bought nothing and cost six features.

`quiet` is **passed through, not forced to 1** (critique C4). Several parity rows depend on
`quiet=0` output reaching the console: `cmd.get_view(2, quiet=0)` (`00:58`), and
`cmd.set(..., log=1, quiet=0)` for every check/radio menu item (`00:59`).

### A7 — Ownership lists were never written to disk · **RESOLVED by this document**

§6 below contains the complete list, in this file, in the repo. There is no out-of-band artifact.

### A8 — Twelve concrete file collisions · **RESOLVED structurally**

Not by re-assigning owners, but by removing the shared files. See §5: every would-be shared file
becomes either (a) a directory of one-file-per-owner modules with a **barrel written once in wave 0
and never touched again**, or (b) a single owner with the other consumers going through a public
export. Each of the twelve is addressed by name in §5.2.

### A9 — New C++ scheduled after the packages that need it · **DISSOLVED**

Three of the four claimed dependencies do not exist:

* `cmd.get_click_string` — C exists (`layer4/Cmd.cpp:1420-1436`) and is in the method table
  (`:6451`). **No C++.** (Verified.)
* `_cmd.get_setting_level` — already in the method table (`layer4/Cmd.cpp:6494`, impl `:4403`).
  **No C++.** (Verified; critique C2 is right.)
* `ButModeGet` / `ButModeTranslate` and the 5-char code table — **no C++ needed.** The
  authoritative binding table is Python: `mode_dict` / `mouse_ring` / `mode_name_dict` in
  `modules/pymol/controlling.py:127-206`, which is what `cmd.mouse()` itself applies via
  `cmd.button()` (`:640-680`). The current mode is readable as `cmd.get('button_mode')` (int) and
  `cmd.get('button_mode_name')` (setting 330, `layer1/SettingInfo.h:424`). (Verified.)
* Setting default/min/max/help — `SettingInfo[]` and `hasMinMax()` (`layer1/SettingInfo.h:46-58`)
  are compile-time C data with no Python route. This is the **one** real gap, and it is cosmetic
  (slider bounds and help text in the advanced settings table). Scoped as optional C++ Task 4;
  v1 ships the advanced table without min/max clamping and reads help from `data/setting_help.csv`.

The remaining C++ (the geometry accessor) is now on the Mode-G track, behind everything, blocking
nothing. **The ordering hazard is gone.**

---

## 3. Unmapped surface — B1–B9 and C1–C6

### B1 — APBS Electrostatics plugin · **SCOPED, deferred to v1.1 (WP-25 stub, WP-30 full)**

`data/startup/apbs_gui/` is real, autoloads (`modules/pymol/plugins/__init__.py:39`,
`PluginInfo.autoload` defaults True at `:174-175`, loaded at `:408-431`), registers a menu item
(`data/startup/apbs_gui/__init__.py:448-450`), and is 5 stacked pages / 86 `<widget>` elements in
`apbs.ui` (1,405 lines).

**v1 behaviour:** the `Plugin ▸ APBS Electrostatics` menu entry **exists and is visible**, and
selecting it opens a dialog that states the feature is not yet available in the web client, with the
equivalent `cmd` script the user can paste. It does not silently disappear. Rationale: the plugin
subprocess-shells `pdb2pqr` and `apbs`, external binaries most users do not have; porting 86 widgets
for a feature gated on unavailable executables is the wrong v1 investment.

**What v1 *does* build**, because it is shared infrastructure: the bridge streams subprocess
stdout/stderr into the `feedback` topic (`StdOutCapture`, `data/startup/apbs_gui/__init__.py:24-49`).
That same machinery is what B9 needs, so it is not wasted.

### B2 — Plugin Manager · **PARTIALLY DESCOPED (WP-25), with a stated reason**

**v1 ships:** a read-only Plugin panel — installed plugins, version, enabled-at-startup toggle
(`plugins/__init__.py:214-217` semantics), the startup-path list (`get_startup_path` `:50-62`), and
the preferences table (`pref_get`/`pref_set`/`pref_save` → `~/.pymolpluginsrc.py`, `:20`, `:64-99`).
`Plugin ▸ Legacy Plugins` menu items registered by `addmenuitem` still appear and still fire.

**v1 explicitly does NOT ship:** install-from-file, install-from-URL/PyMOLWiki (`fetchplugin`),
repository browse/add/remove (`plugins/repository.py:51-266`), or multi-select repo install
(`managergui_qt.py:134-156`). **Reason:** those paths download and execute arbitrary Python from the
network into the user's interpreter, guarded only by `confirm_network_access()`
(`managergui_qt.py:11`). Adding a browser-driven remote-code-install path to a localhost web service
is a materially worse security posture than the desktop app has, and it is not required by any
workflow in `00`. Full manager = WP-30, v1.1, after a security review.

`plugins/installation.py:22-234` (`installPluginFromFile`, `extract_zipfile`, `cmp_version`,
`check_valid_name`, `InstallationCancelled`, `BadInstallationFile`) is unused in v1.

### B3 — `cmd.get_setting_str` is invented · **FIXED**

Verified: `grep -rn "get_setting_str\b" modules/ layer1/ layer4/` → **0 hits**. The real family is
`get_setting_boolean/int/float/text/tuple/updates` (`modules/pymol/setting.py:408-447`). Both parity
rows that cite it (`00:92`, `00:106`, `00:107`) resolve to plain settings:

* `button_mode_name` = setting **330**, string, global (`layer1/SettingInfo.h:424`)
* `scene_current_name` = setting **396**, string, global (`:491`)

Both are readable with `cmd.get(name)` and both arrive on the `settings` drain for free. Recorded as
a required correction to `00-parity-inventory.md`.

### B4 — `scenes_changed` / `session_changed` already exist · **ACCEPTED**

Verified: settings 254 and 521. Both ride the existing `cmd.get_setting_updates()` drain. `00 §14
item 17` is over-scoped (not a new event) and `00 §15 risk 20` is wrong (the unsaved-session guard
exists; the Qt GUI lost it, PyMOL did not — `modules/pmg_tk/skins/normal/__init__.py:207-221`).
The bridge's shutdown guard reads `session_changed`.

### B5 — The parity inventory is truncated · **ACCEPTED as a gate**

`00-parity-inventory.md:499` records that build-and-tooling arrived "truncated at feature 2 of 22".
The 351-row total (`:43`) is therefore **provisional**. WP-27 must reconcile the build-and-tooling
area before any sign-off, and the parity matrix carries a `provisional: true` flag on that area until
it does. `pnpm parity` fails on any `unclaimed` row *and* on a `provisional` area at release-gate
time.

### B6 — The Tk skin · **OUT OF SCOPE, stated in one line**

**The web client is a `pmg_qt` replacement only. `modules/pmg_tk/**` is out of scope in its
entirety** — `skins/normal/__init__.py` (1,298), `skins/normal/builder.py` (1,507), `volume.py`
(1,088), `PMGApp.py` (371), `SetEditor.py`, `ColorEditor.py`, `Demo.py`, `TextEditor.py`,
`skins/demo/`. The bridge never sets `invocation.options.gui = 'pmg_tk'` and never imports `pmg_tk`.
The `ImportError` fallback at `modules/pymol/__init__.py:415-426` is unreachable in our entry point
because we never call `pymol.launch()`.

### B7 — The broken-in-open-source list · **SCOPED into a single manifest**

One file, `bridge/tenmol_bridge/incentive_only.py` (owner WP-02), enumerates every symbol that
raises `IncentiveOnlyException` in this tree. The bridge answers those calls with a typed
`{kind:'IncentiveOnly'}` error and the client **disables or annotates** the affected control rather
than letting it throw. Verified inventory:

| Symbol | Site | UI reach |
|---|---|---|
| `clean` | `modules/pymol/computing.py:29` | Builder ▸ Clean |
| `assign_stereo` | `modules/pymol/stereochemistry/__init__.py:29` | L-menu "stereochemistry" (`modules/pymol/menu.py:1536`) — silently blank today |
| `morph` | `modules/pymol/morphing.py:53` | api symbol |
| `focal_blur`, `callout`, `desaturate` | `modules/pymol/experimenting.py:244,266,280` | api symbols |
| `find_pi_interactions` | `modules/pymol/querying.py:545` | `find ▸ pi interactions` popup leaf — **always throws** |
| `help_setting` | `modules/pymol/helping.py:99` | intended consumer of `data/setting_help.csv` |
| `read_stlstr`, `read_collada` | `modules/pymol/lazyio.py:240,250` | import filters |
| `load_mtz` | `modules/pymol/importing.py:1511` | File ▸ Open |
| `.mae` load | `modules/pymol/importing.py:32` | File ▸ Open |
| STL export | (build-gated) `save .stl` → `IncentiveOnlyException` (spike 03) | File ▸ Export |
| `.mtl`/glTF export | `save .gltf` → `CmdException: could not find collada2gltf` (spike 03) | File ▸ Export |

### B8 — No serialization policy for non-JSON returns · **RESOLVED, typed codec table**

`bridge/tenmol_bridge/codec.py` (owner WP-02) holds an explicit table. Anything not in it is a
`{kind:'NotSerializable'}` error, never a silent `repr()`.

| Return | Wire form |
|---|---|
| `cmd.get_model()` → `chempy.models.Indexed` | structured record: `{atom: [...], bond: [...]}`, fields whitelisted |
| `cmd.get_session()` | never returned over the wire; write to a file, hand back a path/blob id |
| `cmd.get_coords` / `get_coordset` (numpy) | msgpack `bin` + `{shape, dtype}` header |
| `cmd.get_volume_field` (numpy) | blob id + header; never inline |
| `cmd.get_raw_alignment` | list of tuples → array of arrays |
| everything else | JSON/msgpack scalars, lists, dicts |

**Hard rule:** `cmd.get_coordset(..., copy=0)` returns a **live view onto C++ memory**
(`layer2/CoordSet.cpp:326-361`) — measured as a `(4779,3)` float32 view in 0.021 s. The codec
**copies before releasing the API lock**, always. A view that escapes the lock is a use-after-free.

### B9 — `util.py` compute/electrostatics contract · **SCOPED into WP-24**

Named backend symbols, all in `modules/pymol/util.py`: `protein_vacuum_esp` (`:385`) →
`protein_assign_charges_and_radii` (`:335-383`) → `from chempy.champ import assign` (`:338`), i.e.
the compiled `chempy.champ._champ` extension (`setup.py:860-878`). It **mutates the model** (deletes
alt-confs and unassigned residues), prints multi-line diagnostics, and creates three new objects
`_e_chg` / `_e_map` / `_e_pot`. The UI must warn before the mutation and must surface the
diagnostics.

Also in scope for WP-24, previously unnamed anywhere: `get_area`, `get_sasa`, `get_sasa_relative`,
`compute_mass`, `sum_formal_charges`, `sum_partial_charges`, `find_surface_residues`,
`find_surface_atoms`, `label_chains`, `label_segments`, `phipsi`, `b2vdw`, `interchain_distances`,
`enable_all_shaders`, `mass_align`, `ff_copy`.

### C1–C6

* **C1** — Answered. `pmg_qt/file_dialogs.load_dialog` **does** call `recent_filenames_add`
  (`modules/pmg_qt/file_dialogs.py:42` and `:593`, verified). No bug to clone.
* **C2** — Accepted; see A9. Removed from the critical-path gap list.
* **C3** — Accepted. `tools/parity/extract-features.mjs` must handle escaped pipes inside table
  cells (`\|`, e.g. `00-parity-inventory.md:55,59,98`). A naive `split('|')` mis-columns dozens of
  rows. WP-27 acceptance includes a fixture with escaped pipes.
* **C4** — Accepted; `quiet` passes through (§A6).
* **C5** — Accepted and resolved by demotion. The principle "a git merge from upstream must never
  touch a web-client file" now holds for **all of v1**, because v1 adds **zero** files to
  `layer0/`–`layer5/`. The two C++ touch-points move to WP-26 (Mode G), which is explicitly a
  post-v1 track with its own upstream-merge policy stated in §4.
* **C6** — Scoped. The invocation flags with no web analogue are enumerated once, in WP-28's
  `--help` mapping table: `-p` (read commands from stdin), `-X`/`-Y` (window position), `-A`
  (preset profiles), `-t`/`-o` (stereo), `-m`/`-M` (mouse profiles,
  `modules/pymol/invocation.py:344,346`), `-d`/`-l`/`-r`/`-u` (deferred command hooks, `:250,286,
  423-436`). Each is either mapped, ignored with a warning, or rejected with a message — never
  silently dropped.

---

## 4. C++ work

**On the critical path for v1: none.** This is the biggest single change from `01-architecture.md`,
which had the geometry accessor as risk #2 and a blocker for the entire viewport.

All C++ below belongs to the Mode-G track (WP-26) and is scheduled after v1 feature-complete. Each
task is a discrete change against a real file.

| # | File | Change | Needed by | Size |
|---|---|---|---|---|
| **1** | `layer4/CmdWebGeometry.cpp` (**new**) | `CmdGetRepGeometry(object, state, rep)`. Surface path: emit `RepSurface::{V,VN,VC,VA,VAO,T,AT,Vis}` (`layer2/RepSurface.cpp:74-85`) via `PConvFloatArrayToPyList(ptr, len, /*dump_binary=*/true)` (`layer1/PConv.cpp:971-977`) and `PConvIntArrayToPyList` (`:1061-1064`). CGO path: walk `primitiveCGO`/`preshader` using `CGOArrayAsPyList` (`layer1/CGO.cpp:241`) as the reference implementation, emitting `CGO_DRAW_ARRAYS` blocks (`layer1/CGO.h:167`) verbatim, and `CGO_SPHERE` (`:99`) / `CGO_SHADER_CYLINDER` (`:197`) / `CGO_SHADER_CYLINDER_WITH_2ND_COLOR` (`:200`) as **instance buffers, not tessellated**. Never read a VBO (`layer1/CGO.h:183-186`). | WP-26 | large |
| **2** | `layer4/Cmd.cpp` | Method-table insertion beside `{"get_click_string", …}` (`:6451`) / `{"get_feedback", …}` (`:6463`), plus forward decls. Pure insertion, ~8 lines, one contiguous region. **No build-file edit needed**: `setup.py:808-816` globs `layer4/*.cpp` and `setup.py:559-568` lists `"layer4"`, feeding `${ALL_SRC}` at `CMakeLists.txt:7` (verified). | WP-26 | trivial |
| **3** | `layer4/CmdWebGeometry.cpp` | `CmdGetPickData(object, state, rep)` — per-vertex `(index, bond)` behind `CGO_PICK_COLOR` (`layer1/CGO.h:150-151`; sentinels `modules/pymol/cgo.py:73-77`). **Optional.** Only needed for hover-highlight without a round-trip. The pick *colour* itself is unshippable (§1.4). | WP-26 (opt) | medium |
| **4** | `layer4/CmdWebGeometry.cpp` | `CmdGetSettingInfo(index)` → `{default, min, max, hasMinMax, level}` from `SettingInfo[]` / `hasMinMax()` (`layer1/SettingInfo.h:46-58`). **Optional, cosmetic** (advanced-settings slider bounds). | WP-26 (opt) | small |
| **5** | `layer4/CmdWebGeometry.cpp` | `CmdGetSeqView()` — Seeker model readout (`layer3/Seeker.cpp`). **Optional**: v1 renders the sequence viewer through Mode P instead (§7). | WP-26 (opt) | medium |
| **6** | `layer3/Executive.cpp` + `layer3/ExecutiveDef.h` | Change counters: field on `struct CExecutive` (`ExecutiveDef.h:54`), bumps in `ExecutiveInvalidatePanelList` (`Executive.cpp:1513`), `ExecutiveSpecEnable` (`:15376`), `ExecutiveSetName` (`:3580`), `ExecutiveInvalidateRep` (`:14001`), and `SettingRec::setChanged()` (`layer1/Setting.h:67-70`). **v2 optimisation** — polling costs 0.25 % of a core, so this buys almost nothing except the one real capability: a `ReprVersion` makes per-atom rep/colour visible to a poll. | v2 | medium |
| **7** | `layer1/P.cpp:1321` | Guard `PyObject_Hash` against non-hashable list elements. Every surface build prints `TypeError: unhashable type: 'list'` to stderr (swallowed by `PyErr_Print` at `:1374`). **Cosmetic bug fix, upstreamable.** Not required. | — | trivial |

**Upstream-merge policy for the Mode-G track.** Tasks 1 and 3–5 live in one new file that upstream
does not have, so it can never conflict. Task 2 is an insertion into an upstream file and **will**
conflict on merge. It is confined to a single contiguous ~8-line region, marked with
`/* tenmol web client — begin/end */` sentinels, and re-applied by hand at each merge. Task 6 and 7
touch upstream hot files and are therefore *not* undertaken without a decision to carry a permanent
patch (see §8, decision 6).

---

## 5. Repository layout and the anti-collision mechanism

### 5.1 The mechanism

Critique A8 found twelve file collisions. Re-assigning owners does not fix that class of problem; it
just moves it. The fix is structural, and it has exactly two rules.

**Rule 1 — no file has two writers, because shared files become directories.** Anywhere the old
plan had one file that many work packages needed to append to (`topics.ts`, `panels.ts`,
`stores/index.ts`, `allowlist.py`, `overrides.ts`, `App.tsx`), the plan now has a **directory of
single-owner modules** plus a **barrel**.

**Rule 2 — every barrel is written once, in wave 0, complete, and then frozen.** WP-00 writes the
barrels listing *all* planned modules up front, with each target module created as a typed stub. A
feature WP fills in its own stub. Nobody ever edits a barrel again. If a WP needs a barrel entry
that does not exist, that is a plan change, and it goes through the plan owner — it is not an edit
another agent makes.

A CI check (`pnpm ownership`, WP-27) parses the ownership tables in §6 of this document and fails on
any commit that touches a file outside the committing WP's list. This document is the machine-readable
source of truth; that is the answer to A7.

### 5.2 The twelve collisions, by name

| A8 collision | Resolution |
|---|---|
| `packages/protocol/src/panels.ts` | **Deleted.** Split into `src/topics/{objects,movie_panel,seqview,menu}.ts`, one owner each. |
| `packages/protocol/src/topics.ts` | **Becomes `src/topics/`**, one file per topic, 18 files, one owner each. `src/topics/index.ts` written once by WP-01. |
| `packages/stores/src/**` (unassigned) | **Assigned.** WP-08 owns the package skeleton + frozen `index.ts`; each store file is owned by its feature WP (table in §6). |
| `packages/client/src/keymap.ts` | **Deleted from `client`.** Wire-level key tables → `packages/protocol/src/keys.ts` (WP-23). UI key handling → `apps/web/src/features/keyboard/**` (WP-23). |
| `packages/viewport/src/input/**`, `picking/**` | **Directory-level carve-out.** WP-09 owns `packages/viewport/src/**` *except* `input/` and `picking/`, which are WP-10's. Stated, not implied. |
| `packages/ui/src/{Menu,Popover}.tsx` | **Carve-out.** WP-13 owns `packages/ui/src/menu/**`; WP-07 owns the rest of `packages/ui/src/**`. |
| `bridge/.../panels/{objects,movie,seqview,menus}.py` | **Assigned** to WP-12 / WP-20 / WP-21 / WP-13 respectively. `panels/__init__.py` written once by WP-02. |
| `bridge/.../allowlist.py` + `dispatch.py` | **Replaced by `policy/`.** WP-02 owns `policy/base.py` and the loader; each WP that needs a grant writes `policy/grants/wp-NN.py`, which the loader merges. No shared file. |
| `bridge/.../shims.py` | WP-02 owns it and it is **complete in wave 0** (`_copy_image`, `_call_in_gui_thread`, `_call_with_opengl_context`, `gui.createlegacypmgapp`, `window_cmd`). Later WPs consume, never edit. |
| `tools/gen-api/overrides.ts` | **Becomes `overrides/`**, one file per API area, `overrides/index.ts` written once by WP-05. |
| `apps/web/src/App.tsx` + generated barrel | WP-07 owns `src/app/**` and `src/shell/**`. `src/features/registry.ts` is written once by WP-07 in wave 0 listing every planned feature; each feature WP writes only `src/features/<name>/**` including its own `register.ts`. |
| `layer4/Cmd.cpp` + `CmdWebGeometry.cpp` | WP-26 only, and WP-26 is the last package. No concurrency. |

### 5.3 Tree

```
tenmol/
├─ layer0/ … layer5/  modules/  data/  ov/  setup.py   # UNTOUCHED in v1
├─ layer4/CmdWebGeometry.cpp                            # WP-26 only, post-v1
├─ package.json  pnpm-workspace.yaml  tsconfig.base.json
├─ .npmrc  .prettierrc  eslint.config.js  .gitignore  vitest.workspace.ts
├─ scripts/{bootstrap.sh,dev-bridge.sh,doctor.mjs}
├─ docs/webclient/03-implementation-plan.md              # this file
├─ bridge/
│  ├─ pyproject.toml  README.md  tests/
│  └─ tenmol_bridge/
│     ├─ __init__.py __main__.py config.py errors.py codec.py
│     ├─ glcontext.py           # ctypes CGL/FBO, platform-dispatched
│     ├─ engine.py pump.py      # the engine thread + 60 Hz draw pump
│     ├─ status.py feedback.py  # the 10 Hz lock-attempt thread
│     ├─ dispatch.py server.py session.py blobs.py shims.py incentive_only.py
│     ├─ raster.py              # Mode P: readback + encode + throttle
│     ├─ input.py picking.py
│     ├─ state/{__init__,snapshot,diff}.py
│     ├─ panels/{__init__,objects,movie,seqview,menus}.py
│     ├─ policy/{__init__,base}.py + policy/grants/wp-NN.py
│     ├─ settings_service.py fs.py dialogs.py render.py plugins_service.py
│     └─ geometry/              # WP-26 only
├─ packages/
│  ├─ protocol/src/{index,envelope,errors,codec,keys,pick}.ts + src/topics/*.ts
│  ├─ client/src/{index,connection,events,cmd,reconnect,blob}.ts + src/generated/**
│  ├─ stores/src/*.ts
│  ├─ ui/src/**            (+ ui/src/menu/** carved out)
│  ├─ viewport/src/**      (+ viewport/src/{input,picking}/** carved out)
│  ├─ menu-data/src/**
│  └─ testing/src/**
├─ tools/{gen-api,gen-menus,gen-shaders,parity}/**
└─ apps/web/{index.html,vite.config.ts,src/{main.tsx,app,shell,styles,features}}
```

Note the deviations from `01-architecture.md` §6 that are already true on disk and are hereby
ratified: pnpm root at the **repo root** (not `webclient/`), `@tenmol/*` scope (not `@pymol/*`),
`pnpm@9.15.4` + node ≥ 22, `pnpm -r run build` (no Turborepo), `apps/*` + `packages/*` globs
(`tools/*` is added by WP-05 when it lands).

---

## 6. Work packages with full file ownership

**Legend.** `dependsOn` is a hard gate. Every path listed is owned exclusively; a WP that needs a
change elsewhere reports it, it does not make it.

### Wave 0 — foundation

#### WP-00 — Monorepo, bootstrap, and the frozen skeleton
**Depends on:** —
**Owns:**
```
package.json  pnpm-workspace.yaml  tsconfig.base.json  .npmrc  .prettierrc
eslint.config.js  .gitignore  vitest.workspace.ts
scripts/bootstrap.sh  scripts/dev-bridge.sh  scripts/doctor.mjs
.github/workflows/webclient-*.yml
```
**Scope.** (a) `scripts/bootstrap.sh` creates `bridge/.venv`, builds PyMOL from this tree into it
with `--config-settings use-msgpackc=c++11` **plus** a vendored `mmtf-cpp` on `PREFIX_PATH` (the
`use-msgpackc=no` path silently disables MMTF/BCIF, which are parity rows), `pip install -e bridge/`,
`pnpm install`, and appends `modules/pymol.egg-info/`, `testing/timings.tab`,
`modules/pymol/_cmd*.so`, `modules/chempy/champ/_champ*.so` to `.git/info/exclude`. This closes the
verification finding that `pnpm dev` cannot work out of the box. (b) `doctor.mjs` preflights python,
`import pymol`, GL context creation, pnpm, node. (c) Fix `apps/web/vite.config.ts` `strictPort: true`
→ port probing (measured collision risk: an unrelated Vite server was already on `[::1]:5173`).
(d) Add `build` scripts to `packages/*` or document why they are source-only. (e) Add a `.gitignore`
negation for `packages/*/src/generated/` — the upstream bare pattern `generated` on `.gitignore:3`
matches at any depth (`git check-ignore -v packages/client/src/generated/cmd.ts` → `.gitignore:3`).
(f) Root `pnpm ownership` and `pnpm parity` script stubs.
**Acceptance.** On a clean clone with only `brew` deps: `bash scripts/bootstrap.sh && pnpm dev`
brings up both processes and `curl 127.0.0.1:8765/healthz` reports `"state":"running"` — with no
`TENMOL_VENV` set. `pnpm -r run build` builds all four projects. `pnpm ownership` passes.

#### WP-01 — `@tenmol/protocol` wire contract
**Depends on:** WP-00
**Owns:**
```
packages/protocol/package.json  packages/protocol/tsconfig.json
packages/protocol/src/index.ts  src/envelope.ts  src/errors.ts  src/codec.ts
packages/protocol/src/topics/index.ts  src/topics/_registry.ts
packages/protocol/src/geometry.ts        (binary frame header + zero-copy views)
```
*(migrates the existing `src/messages.ts`, `src/topics.ts`, `src/geometry.ts`)*
**Scope.** Envelope, error kinds (`CmdException | QuietException | IncentiveOnly | NotAllowed |
NotSerializable | PythonError`), the msgpack codec config, the binary-frame header contract
(**keep the 4-byte header alignment already implemented and verified** — it makes `viewOf()`
zero-copy; regressing it forces a memcpy of every buffer), the topic registry, and **the frozen
`topics/index.ts` barrel listing all 18 topic modules with typed stubs**. Also: add a `viewOf(frame,
ref)` overload or guard — passing the `GeometryFrame` instead of the payload currently fails at
runtime with `TypeError: payload.slice is not a function` instead of a type error.
**Acceptance.** `pnpm typecheck` green; every topic module in the barrel exists as a compiling stub;
a round-trip test encodes in Python and decodes in TS with `zeroCopyPos === true`.

#### WP-02 — Bridge core: GL context, engine thread, pump, dispatch, policy, codec
**Depends on:** WP-01
**Owns:**
```
bridge/pyproject.toml  bridge/README.md  bridge/tests/conftest.py
bridge/tests/test_process_model.py  bridge/tests/test_dispatch.py
bridge/tenmol_bridge/{__init__,__main__,config,errors,codec}.py
bridge/tenmol_bridge/glcontext.py  engine.py  pump.py
bridge/tenmol_bridge/{dispatch,server,session,blobs,shims,incentive_only}.py
bridge/tenmol_bridge/policy/{__init__,base}.py
bridge/tenmol_bridge/panels/__init__.py          (frozen barrel)
bridge/tenmol_bridge/state/__init__.py           (frozen barrel)
```
**Scope.** §1.1 boot sequence and pump, verbatim. `glcontext.py` is platform-dispatched with only
the CGL implementation present; other platforms raise a typed `NoOffscreenGL`. Resize re-storages
the **same** FBO name. The capability policy of §A6, with the grant-file loader. The codec table of
§B8, including the copy-before-unlock rule. `shims.py` complete in this wave. Logs to `stderr` only.
`incentive_only.py` manifest (§B7).
**Acceptance.** A pytest that, in one process: creates the context, boots the engine, drags the
mouse and asserts `get_view()[:9]` changed; asserts `cmd._get_feedback()` contains both
`PyMOL>print(...)` and the printed value; runs `cmd.mpng` and asserts the engine still responds
afterwards; asserts `/healthz` reports `glutThread == threadIdent`; asserts no bridge log line
appears in `_get_feedback()`.

### Wave 1 — spines

#### WP-03 — Feedback, status thread, state tick
**Depends on:** WP-02
**Owns:**
```
bridge/tenmol_bridge/feedback.py  status.py
bridge/tenmol_bridge/state/{snapshot,diff}.py
bridge/tests/test_events.py
packages/protocol/src/topics/{feedback,progress,redisplay}.ts
packages/stores/src/feedback.ts        (shared with WP-11? NO — see note)
```
*Note: `packages/stores/src/feedback.ts` is WP-11's. WP-03 owns none of `packages/stores/`.*
**Scope.** §1.2 and §1.5. 10 Hz status thread restricted to the three lock-attempting calls; 30/4 Hz
state tick with the measured field set; command-echo invalidation channel; capped ring buffer;
`None`-means-retry; per-object setting drain as a separate channel (21.6 µs for 31 objects — do it
every tick).
**Acceptance.** A test drives 300 idle ticks and asserts **zero** emissions; drives each of the
mutations from spike 05 §3 and asserts the expected key set; asserts a `cmd.ray()` on the engine
thread does not stall the status thread beyond 1 ms.

#### WP-04 — Mode P: server-rendered pixel stream (bridge side)
**Depends on:** WP-02
**Owns:**
```
bridge/tenmol_bridge/raster.py
bridge/tests/test_raster.py
packages/protocol/src/topics/pixels.ts
```
**Scope.** FBO readback, orientation flip, JPEG-during-motion / lossless-on-settle policy, dpr
switching, at-most-one-unacked-frame flow control, dirty gating off `getRedisplay()`, and a
resolution/quality control message. Targets the §1.3 budget: ≤ 4 ms/frame at 1280×960.
**Acceptance.** A test loads 1AON, drives 100 `turn`+frame cycles, and asserts median end-to-end
frame time ≤ 6 ms at 1280×960 and that the decoded image has > 1,000 unique RGB values (a real
render, not a fill — the check used in §1.3).

#### WP-05 — API schema extraction + TS codegen
**Depends on:** WP-00, WP-02
**Owns:**
```
tools/gen-api/**  (extract.py, emit.ts, package.json, overrides/index.ts — frozen barrel)
packages/client/src/generated/**
```
*(each `tools/gen-api/overrides/<area>.ts` is owned by that area's WP)*
**Scope.** Reflect `dir(cmd)` inside the built PyMOL; emit one typed wrapper per symbol; parser-mode
`LITERAL1/LITERAL2/PYTHON/SECURE` symbols emitted into `generated/unsafe.ts` so importing one is a
greppable decision; CI drift check. Also emits the `IncentiveOnly` annotations from WP-02's manifest.
**Acceptance.** Regenerating produces a byte-identical `schema.json`; ≥ 400 symbols emitted;
`pnpm typecheck` green; the two surviving `no-explicit-any` warnings in
`packages/client/src/cmd.ts:70` disappear.

#### WP-06 — `@tenmol/client` transport
**Depends on:** WP-01, WP-05
**Owns:**
```
packages/client/package.json  tsconfig.json
packages/client/src/{index,connection,events,cmd,reconnect,blob}.ts
```
**Scope.** WS lifecycle, id allocation, request map, subscription bookkeeping, reconnect with full
state resync, bounded outbound queue with input-event coalescing. **Keep the verified
double-subscribe fix** in `connection.ts` (the first connect used to send 8 `sub` frames for 4
topics; it now sends exactly 4, re-verified across a forced reconnect).
**Acceptance.** Wire-log test: exactly one `sub` frame per topic on first connect and exactly one
per topic on reconnect; `feedback` still flows after a forced socket close.

#### WP-07 — App shell, `@tenmol/ui`, theme, feature registry
**Depends on:** WP-00, WP-06
**Owns:**
```
apps/web/{index.html,vite.config.ts,tsconfig.json,package.json,README.md,.gitignore}
apps/web/src/main.tsx
apps/web/src/app/**            (App.tsx, BridgeProvider, routing)
apps/web/src/shell/**          (AppShell, ExternalGuiPanel, InternalGuiColumn, StatusBar, Docking)
apps/web/src/styles/**
apps/web/src/features/registry.ts        (FROZEN barrel, written once, lists every feature)
packages/ui/package.json  tsconfig.json  packages/ui/src/**   EXCEPT packages/ui/src/menu/**
```
*(migrates the existing `apps/web/src/layout/**` and `apps/web/src/bridge/**`)*
**Scope.** CSS-grid root, dockview panel host, design tokens, and every `@tenmol/ui` primitive
except the menu family. Writes the frozen feature registry naming all 18 feature directories.
**Acceptance.** `pnpm build` green; headless-browser smoke test renders the 11 top-level menus, the
viewport canvas and the status line against a live bridge, with `pageerrors: []`.

#### WP-08 — `@tenmol/stores` skeleton
**Depends on:** WP-06
**Owns:**
```
packages/stores/package.json  tsconfig.json
packages/stores/src/index.ts        (FROZEN barrel listing all 14 stores)
packages/stores/src/createStore.ts  bridgeBinding.ts  ui.ts
```
**Scope.** The Zustand factory, the topic→store binding helper (subscribe, seq-gap detection,
forced resync), the local-only `ui` store (dock layout, fonts, "don't ask again"), and typed stubs
for all 14 stores. **Nothing is optimistic except pure-UI state**: every PyMOL mutation is
round-tripped, because a setting write can silently no-op at the wrong level and
`SettingGenerateSideEffects` can invalidate geometry.
**Acceptance.** A store bound to a topic replays a seq gap by requesting a resync; `pnpm typecheck`
green with every stub present.

### Wave 2 — viewport and core UI

#### WP-09 — Viewport (Mode P presenter), camera, resize
**Depends on:** WP-04, WP-07, WP-08
**Owns:**
```
packages/viewport/package.json  tsconfig.json
packages/viewport/src/**  EXCEPT src/input/**, src/picking/**, src/webgl/**, src/materials/**, src/shaders/**
apps/web/src/features/viewport/**
packages/protocol/src/topics/view.ts
packages/stores/src/view.ts
```
**Scope.** Canvas + pixel presenter (decode, blit, tear-free swap), resolution/dpr negotiation with
`cmd.viewport`, the DOM overlay layer (wizard prompt, scene buttons, marquee, busy, splash), and the
camera contract: `cmd.get_view()` returns 25 floats while `cmd.set_view` requires **exactly 18** —
that slice lives in exactly one file with a golden test.
**Acceptance.** Dragging in the browser rotates the molecule and the returned frames change; a
window resize round-trips through `reshape` and `get_viewport()` matches the canvas CSS size
(`internal_gui=0` guarantees this); median browser-observed frame latency ≤ 25 ms at 1280×960 on
1AON.

#### WP-10 — Input and picking
**Depends on:** WP-09
**Owns:**
```
bridge/tenmol_bridge/input.py  picking.py
packages/viewport/src/input/**  packages/viewport/src/picking/**
packages/protocol/src/pick.ts  packages/protocol/src/topics/selection.ts
packages/stores/src/selection.ts
apps/web/src/features/picking/**
bridge/tests/test_picking.py
```
**Scope.** §1.4 verbatim: 1:1 `button`/`drag` forwarding, bottom-left Y flip, modifier bitmask,
the ≥ 150 ms click floor, rubber-band multipick, `get_click_string` via `_cmd`, editor pick routing,
and rendering the backend's pick result. Optional hover-highlight raycast is explicitly *not* a
source of truth.
**Acceptance.** A GL-session-gated test reproduces spike 04 E8: 11 distinct atoms from 11 grid
clicks, 21 background clicks → `None`; and E10: multipick on 5,684 atoms ≤ 20 ms.

#### WP-11 — Console
**Depends on:** WP-03, WP-07, WP-08
**Owns:**
```
apps/web/src/features/console/**
packages/stores/src/feedback.ts
```
**Scope.** Command line with history and tab completion, feedback log (virtualized, ring buffer
5,000 lines, autoscroll only when already at the bottom, selectable, monospace, user font size,
HTML-escaping equivalent to `colorprinting.text2html`), quick buttons, progress bar + abort.
**Fix already found and applied, keep it:** the local `PyMOL>` echo must only fire when the bridge
is *not* connected — the bridge emits `{"t":"feedback","lines":["PyMOL>fragment ala"]}` for every
`{t:'do'}`, and echoing locally too produced the line twice.
**Acceptance.** Typing `fragment ala` in the real UI against a real bridge produces exactly one
`PyMOL>fragment ala` line, followed by ` Executive: object "ala" created.`

#### WP-12 — Object panel
**Depends on:** WP-03, WP-07, WP-08, WP-13
**Owns:**
```
bridge/tenmol_bridge/panels/objects.py
packages/protocol/src/topics/objects.ts
packages/stores/src/objects.ts
apps/web/src/features/objects/**
tools/gen-api/overrides/executive.ts
```
**Scope.** Tree, group nesting, A/S/H/L/C/M buttons, enable/disable, drag reorder, the "cloaked"
state (enabled object inside a disabled group) derived client-side. **`00-parity-inventory.md` must
be flagged**: the object panel, wizard panel, scene bin and internal command line have **no Python
data feed today** — they are C++ `Block::draw` surfaces (`struct CExecutive : public Block`,
`layer3/ExecutiveDef.h:54`, `:99`) redrawn from the live `Spec` list at up to 50 Hz. Those rows need
"new bridge endpoint required", not "wire up existing API". `panels/objects.py` is that endpoint,
built from `get_names`/`get_type`/`get_vis`/group queries.
**Acceptance.** Command-trace equivalence against Qt for toggle, group, ungroup, reorder, delete.

#### WP-13 — PyMOL popup-menu engine
**Depends on:** WP-06, WP-07
**Owns:**
```
bridge/tenmol_bridge/panels/menus.py
packages/protocol/src/topics/menu.ts
packages/stores/src/menu.ts
packages/ui/src/menu/**        (Menu, MenuItem, SubMenu, Popover, Separator)
apps/web/src/features/pymol-menu/**
bridge/tenmol_bridge/policy/grants/wp-13.py
```
**Scope.** `pymol.menu.*` resolved over the wire, returning command strings executed via `t:'do'`
(now allowed, §A6). Radix-based submenu semantics incl. the 0.25 s submenu delay and sticky mode.
**Acceptance.** Every leaf of the A/S/H/L/C/M menus resolves and fires the same `cmd` call Qt fires.

#### WP-14 — Menu bar + menu-data codegen
**Depends on:** WP-05, WP-07, WP-15
**Owns:**
```
tools/gen-menus/**
packages/menu-data/**
apps/web/src/features/menubar/**
```
**Acceptance.** All 11 top-level menus and every leaf present; checkmarks/radios driven only by the
settings store; regeneration is byte-stable.

#### WP-15 — Settings
**Depends on:** WP-03, WP-06, WP-08
**Owns:**
```
bridge/tenmol_bridge/settings_service.py
packages/protocol/src/topics/settings.ts
packages/stores/src/settings.ts
apps/web/src/features/settings/**
tools/gen-api/overrides/setting.ts
```
**Scope.** The settings store is the **only** source of truth for every checkbox and radio in every
menu. Advanced settings table (779 rows, virtualized), lighting panel. Help text from
`data/setting_help.csv`; **min/max unavailable in v1** (C++ Task 4) — sliders are unclamped and
annotated.
**Acceptance.** Every menu check/radio state matches `cmd.get(...)` after an arbitrary command
sequence; state-snapshot equivalence over all 779 values.

### Wave 3 — feature surfaces (parallel)

#### WP-16 — Wizards
**Depends on:** WP-10, WP-13
**Owns:** `packages/protocol/src/topics/wizard.ts`, `packages/stores/src/wizard.ts`,
`apps/web/src/features/wizards/**`, `bridge/tenmol_bridge/policy/grants/wp-16.py`
**Scope.** Generic panel/prompt/menu renderer over `cmd.get_wizard()`; never interprets `code`;
26 bundled wizard modules proxied. The wizard event mask is **not** used as a transport (§1.5).

#### WP-17 — Builder
**Depends on:** WP-10, WP-16
**Owns:** `packages/protocol/src/topics/editor.ts`, `packages/stores/src/editor.ts`,
`apps/web/src/features/builder/**`
**Scope.** Every button's pick-state branching driven by the `editor` topic. `cmd.clean` is
`IncentiveOnly` — the Clean button is visibly disabled with a tooltip, not silently broken.

#### WP-18 — File I/O and blocking dialogs
**Depends on:** WP-06, WP-07
**Owns:** `bridge/tenmol_bridge/fs.py`, `dialogs.py`, `packages/protocol/src/topics/dialog.ts`,
`packages/stores/src/dialog.ts`, `apps/web/src/features/files/**`,
`apps/web/src/features/dialogs/shared/**`, `bridge/tenmol_bridge/policy/grants/wp-18.py`
**Scope.** Server file picker, load/save/export filters, fetch, drag-and-drop, `POST /upload`,
recent files. Blocking Python dialogs (`ask_partial`, `file_dialogs.py:88` uses `exec()`; the
tkinter shim `pmg_qt/mimic_tk.py:36-90` blocks the calling thread) resolve via a `dialog` event + a
`Future`. **Hard rule with a dedicated test: the request must be issued from a worker thread, never
the engine thread**, or the pump deadlocks and the whole UI freezes.

#### WP-19 — Render pipeline
**Depends on:** WP-06, WP-09
**Owns:** `bridge/tenmol_bridge/render.py`, `apps/web/src/features/render/**`
**Scope.** Draw/Ray panel, `cmd.ray` + `cmd.png` to a blob, progress via `cmd.get_progress()` (the
only mid-op liveness signal, measured working through a 4.3 s ray), clipboard, cancel.
**Note:** with the GL context, `cmd.draw` is now a genuine fast path (0.075 s for a 1280×960 PNG of
1AON) distinct from `cmd.ray` (1.283 s at 640×480). Both are exposed.

#### WP-20 — Movies, scenes, states
**Depends on:** WP-06, WP-07, WP-08
**Owns:** `bridge/tenmol_bridge/panels/movie.py`, `packages/protocol/src/topics/{frame,scenes,
movie_panel}.ts`, `packages/stores/src/{movie,scenes}.ts`, `apps/web/src/features/{movie,scenes}/**`
**Scope.** The backend is the movie clock; the client never runs a frame timer (measured: 1 s of
`idle()`+`refresh()` at `movie_fps 30` advances 28 distinct frames). `scenes_changed` (setting 254)
rides the settings drain — no new event. `movie.produce`/`cmd.mpng` work (§A2).

#### WP-21 — Sequence viewer
**Depends on:** WP-09, WP-12
**Owns:** `bridge/tenmol_bridge/panels/seqview.py`, `packages/protocol/src/topics/seqview.ts`,
`packages/stores/src/seqview.ts`, `apps/web/src/features/seqview/**`
**Scope.** v1 renders the sequence viewer **through Mode P** (PyMOL draws it into the framebuffer;
the client positions a hit-testing overlay) because the Seeker model has no Python readout without
C++ Task 5. DOM sequence viewer is a Mode-G follow-on. See §7.

#### WP-22 — Dialogs: volume, properties, colors, text editor
**Depends on:** WP-07, WP-15, WP-18
**Owns:** `packages/protocol/src/topics/colors.ts`, `packages/stores/src/colors.ts`,
`apps/web/src/features/{colors,volume,properties,texteditor}/**`

#### WP-23 — Keyboard and mouse configuration
**Depends on:** WP-10
**Owns:** `packages/protocol/src/keys.ts`, `apps/web/src/features/keyboard/**`,
`apps/web/src/features/shortcuts/**`
**Scope.** Key translation, shortcut editor, and the ButMode grid — reconstructed **without C++**
from `modules/pymol/controlling.py` `mode_dict`/`mouse_ring`/`mode_name_dict` plus
`cmd.get('button_mode')` / `cmd.get('button_mode_name')` (§A9).

#### WP-24 — Compute and analysis menus
**Depends on:** WP-13, WP-15
**Owns:** `apps/web/src/features/compute/**`, `tools/gen-api/overrides/util.ts`,
`bridge/tenmol_bridge/policy/grants/wp-24.py`
**Scope.** §B9 in full, including the mutation warning for `protein_vacuum_esp` and streaming its
multi-line diagnostics.

#### WP-25 — Plugin surface (read-only)
**Depends on:** WP-07, WP-14
**Owns:** `bridge/tenmol_bridge/plugins_service.py`, `packages/protocol/src/topics/plugin.ts`,
`packages/stores/src/plugins.ts`, `apps/web/src/features/plugins/**`
**Scope.** §B2 v1 subset + the APBS stub entry of §B1.

### Wave 4 — post-v1 and quality

#### WP-26 — Mode G: C++ geometry accessor + WebGL viewport
**Depends on:** WP-09, WP-10 (v1 feature-complete)
**Owns:**
```
layer4/CmdWebGeometry.cpp        (new)
layer4/Cmd.cpp                   (method-table insertion ONLY, sentinel-marked)
bridge/tenmol_bridge/geometry/**
packages/protocol/src/topics/geometry.ts
packages/viewport/src/webgl/**  src/materials/**  src/shaders/**  src/geometryCache.ts
tools/gen-shaders/**
```
**Scope.** §4 tasks 1–5 and the three design constraints of §1.3. Per-rep enablement with automatic
Mode-P fallback. **Must prove at runtime** that `RepCartoon`'s preshader survives our now-real
render, or extract from `primitiveCGO` instead.
**Acceptance.** A cartoon+surface+sticks scene renders in three.js within the documented per-rep
perceptual tolerance of the Mode-P frame for the same view; toggling a rep updates only that rep;
`cmd.color` re-ships only the colour attribute.

#### WP-27 — Parity harness, ownership lint, CI
**Depends on:** WP-00, incrementally all
**Owns:** `tools/parity/**`, `packages/testing/**`, `apps/web/e2e/**`, `bridge/tests/test_parity.py`
**Scope.** The four parity levels from `01` §7 (feature matrix, command-trace equivalence,
state-snapshot equivalence, visual parity), plus two new gates: (a) `pnpm ownership` parses §6 of
this document and fails on cross-WP writes; (b) the drain lint — `_get_feedback`,
`get_setting_updates`, `getRedisplay` may not appear outside `bridge/tenmol_bridge/{feedback,status}.py`.
Must handle escaped pipes in the markdown tables (C3). Must reconcile the truncated
build-and-tooling area (B5) before release gate. GL-dependent suites gated on a logged-in macOS
session, like the ray image-diff tests.
**Note on visual parity:** ray parity is now *exact and free* for both modes (both call the same
`cmd.ray`), and in Mode P **GL parity is also exact**, because the pixels are PyMOL's. The
perceptual-tolerance budget only applies to Mode G.

#### WP-28 — Packaging and entry point
**Depends on:** WP-02, WP-07
**Owns:** `bridge/tenmol_bridge/cli.py`, packaging config, `docs/webclient/USAGE.md`
**Scope.** `pymol --web` equivalent, the §C6 invocation-flag mapping table, token/`Origin`/loopback
enforcement, and shutdown: **a browser tab close cannot reliably run `cmd.quit()`**, so the bridge
outlives the tab by default (heartbeat, explicit `POST /shutdown` with the session token, unsaved-
session guard on setting 521). Also: PyMOL tears the process down with C `exit()` skipping
`atexit`/`Py_FinalizeEx` (`spikes/00-build.md` §6.2) — flush and persist eagerly, never rely on
`atexit` or `finally`.

#### WP-30 — APBS Electrostatics (v1.1)
**Depends on:** WP-25 · **Owns:** `apps/web/src/features/apbs/**`, `bridge/tenmol_bridge/apbs.py`

#### WP-31 — Full Plugin Manager (v1.1, after security review)
**Depends on:** WP-25 · **Owns:** `apps/web/src/features/plugin-manager/**`,
`bridge/tenmol_bridge/plugin_install.py`

---

## 7. What is not achievable

Stated plainly. Each is either a server-rendered fallback or an accepted difference.

### 7.1 Permanently server-rendered (Mode P only, never client WebGL)

| Surface | Why | Fallback |
|---|---|---|
| `cmd.ray` output | A 7,800-line CPU ray tracer with `ray_trace_mode` cel shading/outlines, true shadows and interior colours that have **no GL path at all** | Bitmap over `GET /blob/{id}`. Interactive = WebGL/pixels, publication = server bitmap. This is a **product constraint**, not an implementation detail. |
| `volume` rep | Exports 0 bytes from every text exporter; needs 3D texture + transfer-function machinery | Mode P |
| `cRepCallback` | Arbitrary user Python that draws with raw GL | Mode P |
| `slice` | Real triangles exist (27,328 for 1UBQ) but ramp/texture state does not survive | Mode P v1; Mode G possible later |
| Ellipsoids | 0 bytes from every exporter despite the ray tracer seeing 367 primitives | Mode P |
| Stereo `quadbuffer`, `byrow` (Zalman), `openvr` | No WebGL equivalent | **Dropped**, with a feedback message. Anaglyph and side-by-side are portable. |
| Sequence viewer (v1) | Seeker model is built only in the draw path and has no Python readout | Mode P + hit-testing overlay (WP-21); DOM version needs C++ Task 5 |

### 7.2 Accepted differences from the Qt front-end

1. **The internal GUI moves to DOM.** The object panel, movie panel, mouse-mode block, wizard panel
   and prompt, scene buttons, command prompt, feedback scrollback, busy box, splash and selection
   marquee are all drawn by the Ortho layer *inside* the GL viewport in PyMOL. In the web client
   they are DOM. Consequence: `internal_gui_width`, `internal_gui_control_size` and
   `internal_gui_mode` become **hints the CSS layout honours for `.pse` round-trip parity**, not
   layout drivers. We additionally force `internal_gui=0`/`internal_feedback=0` in the engine so
   window coordinates equal viewport coordinates (with defaults, `reshape(640,480)` yields
   `get_viewport() == (420,462)` and every mouse coordinate is wrong).
2. **Viewport quality during motion.** Mode P sends JPEG q80 while the camera moves and lossless on
   settle. Thin lines, labels and `ray_trace_mode` outlines are momentarily softened during a drag.
3. **`cmd.viewport w,h` cannot resize the window.** A browser cannot resize itself. It resizes the
   canvas and reports the achieved size back, which is observably different for scripts.
4. **Single-click latency has a 150 ms floor**, imposed by `I->SingleClickDelay`
   (`layer1/SceneMouse.cpp:1152`). Measured 0.1504 s, ten out of ten. Not fixable client-side.
5. **`File ▸ New PyMOL Window`** contradicts one-process/one-client. See §8.
6. **Browser keyboard hijacking.** PyMOL binds `CTRL-T`, `CTRL-F`, `CTRL-N`, `CTRL-W`; several
   cannot be `preventDefault`-ed in a normal tab. Needs the §8 decision.
7. **The Tk skin is gone** (§B6). The web client replaces `pmg_qt` only.
8. **Legacy Tk plugins cannot be ported.** `mimic_pmg_tk.PMGApp` creates a real hidden `tkinter.Tk()`
   root and `mimic_tk.py` installs a global `sys.meta_path` hook that still fires headlessly and
   hands plugins invisible dialogs.
9. **Transparency in Mode G will not match.** OIT mode 3 uses a multi-draw-buffer accumulation FBO;
   the other modes CPU-sort triangles every frame, and per-frame sorting of 10⁶ triangles in JS will
   not hold 60 fps. Mode P has no such problem, which is one more reason it is the default.
10. **Offscreen GL is macOS-only in v1.** Linux and Windows offscreen provisioning is a separate
    spike; on those platforms v1 does not run. The shim seam exists; the implementations do not.
11. **Generated API types are ~70 % heuristic.** Only a handful of type annotations exist across
    ~404 API symbols. The override table plus the CI drift check are the only mitigation.
12. **Undo is at open-source parity.** `editor.undocontext` is a no-op stub, so most "undoable"
    Builder actions are not undoable today. See §8.

---

## 8. Decisions the product owner must make

Reduced from `01`'s twelve to seven; five were answered by the spikes.

1. **Mode G at all?** Mode P is measured at 3.4 ms/frame and is 100 % faithful. Mode G costs a large
   C++ file, a shader port of 46 GLSL sources, and a permanent divergence in transparency and
   labels. Is the latency/polish win worth it, or is v2 better spent elsewhere?
2. **Linux/Windows.** v1 is macOS-only because offscreen GL is. Fund the EGL/WGL spike now, ship
   macOS-only, or block v1 on cross-platform?
3. **`File ▸ New PyMOL Window`** (`os.spawnv`, two entry points). Hide it, or spawn a second bridge
   on another port and open a tab?
4. **Browser keyboard.** Remap the conflicting chords, require a capture mode, or ship as an
   installed PWA (where more chords are capturable)?
5. **`cmd.clean`** is `IncentiveOnly` here. Ship the Builder's Clean button disabled, or wire an
   open-source MMFF94 minimizer behind the same signature?
6. **Upstream patch tolerance.** C++ Tasks 6 (change counters) and 7 (the `P.cpp:1321` `TypeError`
   printed on every surface build) touch upstream hot files. Carry a permanent patch, upstream them,
   or live with the polling cost and the stderr noise?
7. **Upstream bug fidelity.** Clone the known upstream bugs (duplicate mouse-mode rows, the
   `'[N more]'` unset bug, swapped singular/plural wizard prompts, the `Chlorrine` typo) for
   byte-level fidelity, or fix them and maintain a documented divergence list?

Answered by the spikes, no longer open: undo (ship at open-source parity, §7.2.12), export
destination (server paths — multi-file patterns and movie encoding force it), `.pwg` files (refuse;
they start a second HTTP server), camera prediction (unnecessary — Mode P is 3.4 ms and Mode G is
client-side anyway), `internal_gui_*` (hints, §7.2.1), movie timeline in v1 (yes — `ModalDraw` is
resolved and the backend is the clock), recent files/shortcuts persistence (server-side, shared with
desktop PyMOL).

---

## 9. Sequencing and gates

```
wave 0   WP-00 ─┬─ WP-01 ─── WP-02
                │
wave 1          ├─ WP-03 ─┐
                ├─ WP-04 ─┤
                ├─ WP-05 ─┴─ WP-06 ─┬─ WP-07 ─── WP-08
                                     │
wave 2                               ├─ WP-09 ─── WP-10
                                     ├─ WP-11  WP-12  WP-13  WP-14  WP-15
wave 3                               └─ WP-16 … WP-25   (fully parallel)
wave 4   WP-26 (Mode G)   WP-27 (parity/CI, continuous)   WP-28 (packaging)
         WP-30 / WP-31 (v1.1)
```

**Gate 0 → 1.** WP-02's acceptance test passes: one process, GL context, drag rotates, feedback
carries both C and Python output, `mpng` survives, `glutThread == threadIdent`, no bridge log leaks
into the console.

**Gate 1 → 2.** A browser drags a molecule and sees it move (WP-04 + WP-09), and a typed command
echoes exactly once (WP-11 dependency satisfied by WP-03 + WP-06).

**Gate 2 → 3.** Command-trace equivalence green for load-and-show, object-panel toggle, and every
Setting-menu leaf.

**Gate 3 → release.** `pnpm parity` reports zero `unclaimed` rows and zero `provisional` areas
(B5 reconciled), `pnpm ownership` green, and the GL-gated picking suite green on a real macOS
session.

**Continuous.** WP-27 runs from wave 0. The ownership lint and the drain lint are the two checks
that keep a 25-agent fleet from re-creating A8 and the double-consumer bug.
