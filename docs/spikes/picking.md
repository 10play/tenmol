# Spike 04 — Picking (BLOCKER resolution)

**Status: RESOLVED. Recommendation: backend-authoritative picking on a headless CGL + FBO
OpenGL context.**

On macOS arm64 (M4 Max, macOS 15.6.1) a **hardware-accelerated, window-less, WindowServer-only
OpenGL 2.1 context** can be created from plain Python with ~20 lines of `ctypes` against
`OpenGL.framework`, an FBO bound as PyMOL's "default backbuffer", and **every picking path in
PyMOL then works unmodified**: single-atom click select, rubber-band multipick, editor `pk1`
picking, `get_click_string`, `cmd.png`, `cmd.draw`, `cmd.ray`, and `cmd.mpng`'s modal-draw loop.

**No new C++ is required for picking.** No OSMesa, no EGL, no ANGLE, no Qt, no GLUT, no window.

Everything below was executed on this machine. All transcripts are verbatim.
Scripts: `/private/tmp/claude-501/.../scratchpad/pick/e1..e14*.py` (throwaway, not in the repo).

> ## STATUS — re-read against the tree on 2026-08-02
>
> **§2 and §3 are the most load-bearing prose in `docs/`, because they are COPIED INTO SHIPPED
> CODE.** `packages/bridge/tenmol_bridge/glcontext/cgl.py` says in its own docstring that it is
> "`docs/spikes/picking.md` §2/§3 verbatim, promoted to a module", and `scripts/doctor.mjs:160`
> says "verbatim from docs/spikes/picking.md section 2" above a byte-for-byte copy of the
> pixel-format attribute tuple and the FBO loop. **Renumbering or rewriting §2 or §3 breaks the
> provenance of two shipped files.** Do not.
>
> **§7 and §8 are done, with two exceptions worth naming:**
>
> * §7.3's last residual risk — "**Linux/Windows parity is a separate spike**" — is **answered for
>   Linux**: [`07-cross-platform-gl.md`](./07-cross-platform-gl.md) §2.8 reproduces this spike's
>   picking result on real Linux under EGL, 3/3 clicks. Windows is still unanswered.
> * §8 item 8 ("gate the picking tests behind a logged-in macOS session") landed as the `gl`
>   pytest marker in `packages/bridge/pyproject.toml:69`, whose text is this item almost word for
>   word.
>
> **The one thing §6 got wrong, and it is worth knowing.** §6.5's verdict table says client-side
> picking "requires new C++ (pick-data extraction)" and is "strictly worse". The C++ was then
> written ([`08-native-changes.md`](./08-native-changes.md) §3) and the comparison was **measured
> rather than argued**: resolving the shipped `(atom index, bond)` pair client-side reproduces a
> real GL pick **18/18 on spheres and 15/15 on surface** — but only after porting two rules this
> spike's §5 half-names and 08 §3.3/§3.4 pin down: the `cRange = 7` outward **ring scan** (a click
> snaps to anything within ~7 px, so an exact ray test scores 16/18) and the **flat-shaded
> provoking vertex** (a triangle hit reports its LAST corner, not the nearest; nearest scores
> 10/15). Everything else in §6 — the 16 pick sources, `cPickableNoPick`/`Through`, and that
> picking drives 21 `ButMode` actions and not just selection — still stands.

## 0. TL;DR

| Question | Answer (measured) |
|---|---|
| Does clicking select in a headless process **without** a GL context? | **No.** The click is delivered and dequeued, but `SceneRender` is a no-op, so `LastPicked.context.object` stays `nullptr` and nothing is ever selected. Rotation/drag *do* work. |
| Offscreen GL on macOS arm64? | **Yes — CGL, no drawable, + `GL_EXT_framebuffer_object`.** `GL_RENDERER = Apple M4 Max`, `GL_VERSION = 2.1 Metal - 89.4`. Hardware, not software. |
| OSMesa / EGL / ANGLE in this tree? | **None.** Zero hits in `setup.py`, `packages/engine/layer0/`, anywhere. `brew search osmesa` → nothing; `brew search angle` → nothing relevant; `brew mesa` on macOS builds **without** `-Dosmesa` and **without** `-Degl`/`-Dglx`, so it ships no OpenGL frontend on mac. |
| Non-GL (CPU) picking path in the C++? | **None exists.** `SceneDoXYPick` → `SceneRender` → `glReadPixels` is the only path. `ScenePickAtomInWorld` (`packages/engine/layer1/Scene.cpp:5672`) also calls `SceneDoXYPick`. |
| Does `get_click_string` help? | It **reports** a pick, it does not **perform** one. It only fires when a button is bound to `cButModeSimpleClick`, and it is fed by the same GL pick. Useful as the wire payload; useless as a substitute. |
| Client-side (three.js) picking? | Possible but **strictly worse** — see §6. The CGO pick *colour* is a per-frame draw-order counter, not an atom id, so it cannot be shipped. The (index, bond) pair behind it can, but you would still have to reimplement 16 rep-specific pick sources and all click *actions* (not just selection). |
| Multipick cost, 5,684-atom cartoon, 900×600 box | **5.4 ms** → 668 atoms selected |
| Single-click latency | **150.4 ms**, of which **150 ms is the hard-coded `I->SingleClickDelay = 0.15`** (`packages/engine/layer1/SceneMouse.cpp:1152`). The GL work is sub-millisecond. |

---

## 1. Experiment 1 — headless click without a GL context (the blocker, reproduced)

`pymol2.PyMOL()` with default options, `cmd.viewport(640,480)`, `cmd.fragment('ala')`,
`cmd.show('spheres')`, click at the centre via `_cmd._button`, then `cmd.refresh()`:

```
$ .../venv/bin/python e1_click.py
names: ['ala']
selections before: []
_button down -> None
_button up -> None
selections after button, before refresh: []
calling cmd.refresh() to drain deferred queue ...
refresh returned OK
selections after refresh: []
get_click_string raised: CmdException  Error: not click-ready
DONE
EXIT=0
```

No crash — and no pick. With `cmd.feedback('enable','all','debugging')` the click is visibly
*queued* but the deferred lambda never runs:

```
--- sending click ---
 OrthoDirty: called.
 OrthoDirty: called.
 APIEnter-DEBUG: as thread 8550408384.
 SceneUpdate: entered.
 OrthoDoDraw: entered.
 OrthoDoDraw: leaving...
--- after refresh ---
selections: []
```

### Why the queue does not drain under `cmd.refresh()` alone

`ExecutiveDrawNow` guards the drain (`packages/engine/layer3/Executive.cpp:11521-11523`):

```cpp
if (PyMOL_GetIdleAndReady(G->PyMOL) && !SettingGetGlobal_b(G, cSetting_suspend_deferred))
    OrthoExecDeferred(G);
```

`PyMOL_GetIdleAndReady` is `I->IdleAndReady == 3` (`packages/engine/layer5/PyMOL.cpp:2560-2562`), and
`IdleAndReady` is only incremented inside `PyMOL_Idle` **and only if `I->DrawnFlag`**
(`packages/engine/layer5/PyMOL.cpp:2412-2416`). `DrawnFlag` is set only inside `PyMOL_Draw`
(`packages/engine/layer5/PyMOL.cpp:2325,2328`).

> **Correction to `docs/spikes/build.md` §6.1 and to
> the deferred-draw blocker.** (This bullet used to cite a section of
> `00-build.md`; there has never been one — the finding it means is §6.1, "`_cmd._draw()`
> SEGFAULTS without a GL context", and the recommendations it means are §7.)
> A never-`draw()` bridge does not merely lose picking — it
> never drains *any* deferred work: no clicks, no drags, no deferred `cmd.png`, no deferred ray.
> The pump **must** call `PyMOL_Draw` (`_cmd._draw`) at least 3 times interleaved with
> `PyMOL_Idle` before the first user event, and then on every tick.

### Why `_cmd._draw` segfaults headless (and how to stop it)

`PyMOL_DrawWithoutLock` does `I->G->HaveGUI = I->G->Option->pmgui;` on first call
(`packages/engine/layer5/PyMOL.cpp:2248`). `pmgui` comes from `rec->pmgui = !PyInt_AsLong(... "no_gui")`
(`packages/engine/layer1/P.cpp:1820`) and `pymol.invocation.options.no_gui` defaults to `0`
(`packages/engine/modules/pymol/invocation.py:134`). So **the default `pymol2.PyMOL()` sets `HaveGUI=1`** and
`PyMOL_Draw` immediately calls `glGetString(GL_VENDOR)` etc. (`packages/engine/layer5/PyMOL.cpp:2307-2325`) —
that is the segfault, not `_draw` itself.

Two safe configurations, both verified:

| `options.no_gui` | `HaveGUI` | `_cmd._draw` | picking | verdict |
|---|---|---|---|---|
| `1` | 0 | safe, no GL touched (`PyMOL.cpp:2327-2328`) | **silently dead** | degraded mode |
| `0` (default) **+ a current GL context** | 1 | safe, renders | **works** | **the recommendation** |

### Experiment 3 — proof that the deferred queue works headless, and that only picking is dead

`no_gui=1`, 5× `draw()`+`idle()`, then a left-button drag:

```
$ .../venv/bin/python e3_drag.py
view0 rot: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
view1 rot: [0.6032, -0.0798, -0.7936, -0.4215, 0.8128, -0.4021, 0.6771, 0.5771, 0.4566]
ROTATION HAPPENED: True
selections: []
```

Rotation works; selection does not. The single line responsible is `packages/engine/layer1/SceneRender.cpp:270`:

```cpp
if (G->HaveGUI && G->ValidContext) {   // <-- the ENTIRE body of SceneRender, incl. picking
```

`SceneDoXYPick` (`packages/engine/layer1/ScenePicking.cpp:17-38`) sets `I->LastPicked.context.object = nullptr`,
calls `SceneRender`, and returns `object != nullptr`. With the body skipped it always returns
"nothing picked". Same for `SceneMultipick` (`:332-360`). **Picking fails silently, with no error,
no exception and no log line.** That is the worst possible failure mode for a UI, and it is
exactly what a never-draw / no-context bridge gets.

---

## 2. Experiment 4/5 — offscreen GL on macOS arm64 actually exists and is fast

No window, no `NSApplication`, no Qt, no GLUT. Pure `ctypes` on `OpenGL.framework`:

```
$ .../venv/bin/python e4_cgl.py
=== legacy 2.1 profile, no drawable ===
legacy: context created OK, CGLSetCurrentContext err=0
   GL_VENDOR = b'Apple'
   GL_RENDERER = b'Apple M4 Max'
   GL_VERSION = b'2.1 Metal - 89.4'
   GLSL_VERSION = b'1.20'
=== core 3.2 profile ===
core32: context created OK, CGLSetCurrentContext err=0
   GL_VERSION = b'4.1 Metal - 89.4'
   GLSL_VERSION = b'4.10'
```

Use the **legacy 2.1 profile** — PyMOL's non-ES path calls `glPushMatrix`/`glPopMatrix`
(`packages/engine/layer1/ScenePicking.cpp:283,306`) and `glShadeModel` (`:234,272`), all removed from core.

FBO + readback in that context:

```
$ .../venv/bin/python e5_ext.py
GL_EXT_framebuffer_object: True
GL_ARB_framebuffer_object: True
GL_EXT_gpu_shader4: True
GL_EXT_geometry_shader4: True
GL_ARB_tessellation_shader: False
n_exts: 133
FBO status: 0x8cd5 COMPLETE
pixel(0,0) RGBA: [64, 128, 191, 255]
glGetError: 0x0
GL_RED_BITS=8  GL_GREEN_BITS=8  GL_BLUE_BITS=8  GL_ALPHA_BITS=8  GL_DEPTH_BITS=32
```

8/8/8/8 colour bits matters: `PickColorConverterSetRgbaBitsFromGL`
(`packages/engine/layer1/ScenePicking.cpp:38-84`) reads exactly these `glGetIntegerv(GL_*_BITS)` values to size the
pick index. 32 bits total = one pick pass for any realistic scene (vs. the 12-bit default
fallback, which needs 2 passes).

### What the tree supports, and what brew offers

```
$ grep -rni "osmesa|EGL|surfaceless|pbuffer|CGL|NSOpenGL" --include=*.py --include=*.cpp --include=*.h .
(zero real hits — only false positives such as "SettingFreeGlobal", "SceneGLClear", "TextureGL")
```

`setup.py:673-690` is the whole macOS GL story: `libs += ["GLEW"]` and, under
`--osx-frameworks` (default `True`, `setup.py:194`), `-framework OpenGL` plus
`-framework GLUT` **only if `--glut`** (default `False`, `setup.py:197`). Our build has
`_PYMOL_NO_MAIN` defined, so `packages/engine/layer5/main.cpp` (the GLUT main loop) is compiled out entirely.
There is nothing to un-wire and nothing to port: `-framework OpenGL` **is** CGL.

```
$ brew search osmesa      →  omega                (no osmesa formula)
$ brew search angle       →  angle-grinder, ...   (no ANGLE formula)
$ brew list --formula | grep -iE 'glew|glfw|mesa|angle|glut'
glew
```

Homebrew's `mesa` formula on macOS
(`Formula/m/mesa.rb:147-159`) passes only
`-Dgallium-drivers=llvmpipe,zink -Dmoltenvk-dir=... -Dvulkan-drivers=... -Dvulkan-layers=...`.
`-Dosmesa`, `-Degl` and `-Dglx` appear **only in the Linux branch** (`:166-173`). So brew mesa on
mac gives Vulkan/rusticl and no `libOSMesa` and no GLX/EGL `libGL`. **OSMesa is not an option on
this platform and does not need to be** — CGL is better (hardware, zero extra dependency).

---

## 3. Experiment 6/7/8 — PyMOL picking through that context, for real

Setup (this is the entire "offscreen provisioning" the architecture needs):

```python
import ctypes
GLF = ctypes.CDLL("/System/Library/Frameworks/OpenGL.framework/OpenGL")
gl  = ctypes.CDLL("/System/Library/Frameworks/OpenGL.framework/Libraries/libGL.dylib")

# kCGLPFAOpenGLProfile=99, kCGLOGLPVersion_Legacy=0x1000, ColorSize=8, DepthSize=12
attrs = (ctypes.c_int * 7)(99, 0x1000, 8, 24, 12, 24, 0)
pix = ctypes.c_void_p(); n = ctypes.c_int()
GLF.CGLChoosePixelFormat(attrs, ctypes.byref(pix), ctypes.byref(n))
ctx = ctypes.c_void_p(); GLF.CGLCreateContext(pix, None, ctypes.byref(ctx))
GLF.CGLSetCurrentContext(ctx)                      # per-thread! see §5

fbo = ctypes.c_uint(); gl.glGenFramebuffersEXT(1, ctypes.byref(fbo))
gl.glBindFramebufferEXT(0x8D40, fbo)               # GL_FRAMEBUFFER_EXT
for att, fmt in ((0x8CE0, 0x8058),                 # COLOR_ATTACHMENT0, GL_RGBA8
                 (0x8D00, 0x81A6)):                # DEPTH_ATTACHMENT, GL_DEPTH_COMPONENT24
    rb = ctypes.c_uint(); gl.glGenRenderbuffersEXT(1, ctypes.byref(rb))
    gl.glBindRenderbufferEXT(0x8D41, rb)
    gl.glRenderbufferStorageEXT(0x8D41, fmt, W, H)
    gl.glFramebufferRenderbufferEXT(0x8D40, att, 0x8D41, rb)
assert gl.glCheckFramebufferStatusEXT(0x8D40) == 0x8CD5   # FRAMEBUFFER_COMPLETE
gl.glViewport(0, 0, W, H)

# ONLY NOW start PyMOL, with no_gui left at 0 so HaveGUI becomes 1
import pymol; pymol.invocation.options.no_gui = 0
import pymol2
p = pymol2.PyMOL(); p.invocation.options.no_gui = 0; p.start()
p.cmd.set('internal_gui', 0); p.cmd.set('internal_feedback', 0)
p.reshape(W, H, 1)
for _ in range(5): p.draw(); p.idle()      # 3 needed to reach IdleAndReady
```

PyMOL picks up our FBO as its default backbuffer automatically: `check_gl_stereo_capable`
does `glGetIntegerv(GL_FRAMEBUFFER_BINDING, &buf); G->ShaderMgr->defaultBackbuffer.framebuffer = buf;`
(`packages/engine/layer5/PyMOL.cpp:2236-2239`), which runs on first `PyMOL_Draw` — i.e. after we bound it.

Startup transcript (real):

```
GL: b'2.1 Metal - 89.4' b'Apple M4 Max'
FBO id: 1 complete
 Detected OpenGL version 2.1. Shaders available.
 Detected GLSL version 1.20.
viewport: (640, 480)
glGetError after draws: 0x0
non-background-ish pixels in FBO readback: 158318 of 307200
```

### 3.1 Rubber-band multipick (`SceneMultipick`, `packages/engine/layer1/ScenePicking.cpp:332-360`)

Shift + left drag from (200,150) to (450,350) over `fragment ala`:

```
 Selector: selection "sele" defined with 10 atoms.
selections after box drag: ['sele']
sele atom count: 10
glGetError final: 0x0
```

### 3.2 Single-atom click select — spatially correct

`cmd.fab('AGCDEFG')` (82 atoms), spheres+sticks, `mouse_selection_mode=0` (atom), a 8×4 grid
of clicks. Each click = `button(0,DOWN)`, pump 30 ms, `button(0,UP)`, pump 450 ms:

```
atoms: 82 viewport: (800, 600)
clicks: 32  hits: 11  DISTINCT ATOMS PICKED: 11
   (200, 320) -> GLY`2/H
   (260, 320) -> GLY`2/O
   (380, 250) -> ASP`4/CB
   (440, 320) -> GLU`5/N
   (500, 180) -> PHE`6/2HE
   (500, 250) -> PHE`6/CD1
   (500, 320) -> PHE`6/N
   (500, 390) -> GLU`5/CD
   (560, 250) -> PHE`6/2HB
   (560, 320) -> PHE`6/C
   (620, 320) -> GLY`7/CA
   ... (21 clicks on background -> None)
```

11 hits, **11 distinct atoms**, background correctly reported as a miss. This is the real GL
pick buffer, not a coincidence.

> The 450 ms pump is mandatory and is **not** GL cost. `SceneIdle` promotes a press+release into
> `P_GLUT_SINGLE_LEFT` only after `now - LastReleaseTime > I->SingleClickDelay`
> (`packages/engine/layer1/Scene.cpp:2438-2450`), and `SingleClickDelay = 0.15` s
> (`packages/engine/layer1/SceneMouse.cpp:1152`). **The bridge's idle pump must tick faster than 150 ms or every
> single click is dropped.** A 10 ms tick is what I used.

### 3.3 `get_click_string` — what it actually is

It is **not** a pick API. `PyMOL_SetClickReady` has exactly two call sites
(`packages/engine/layer1/SceneMouse.cpp:587` and `:1055`), both inside `case cButModeSimpleClick`. Until a button
is bound to `Clik` (`cButModeSimpleClick = 35`, `packages/engine/layer1/ButMode.h:65`,
`cmd.button(..., 'clik')` → `but_act_code['clik'] = 35`, `packages/engine/modules/pymol/controlling.py:96`), it
always fails. It has **zero callers in `packages/engine/modules/`** (verified: `grep -rn get_click_string packages/engine/modules/`
→ nothing).

Once bound, it is an excellent wire payload — verified output after `cmd.button('single_left','none','clik')`:

```
--- click(500,320) ---
type=object:molecule
object=pep
index=42
bond=-1
rank=-1
id=41
segi=
chain=
resn=GLU
resi=5
name=CA
alt=
click=single_left
mod_keys=
x=500
y=279
px=12.73624
py=6.800309
pz=-0.4043613
state=1

--- click(320,180) ---
type=none
click=single_left
mod_keys=
x=320
y=419
```

Notes for the protocol: `index` is **1-based** (`packages/engine/layer4/Cmd.cpp:2689`, `I->ClickedIndex + 1`)
while `Picking::src.index` is 0-based; `bond` is 0-based or a `cPickable_t` sentinel; `y` is
flipped to top-left origin (`I->Height - (I->LastWinY + 1)`, `packages/engine/layer1/SceneMouse.cpp:1055`);
`px/py/pz` is the transformed atom position; `state` is 1-based.

### 3.4 Editor picking, `cmd.draw`, `cmd.png`, `cmd.ray`, `cmd.mpng`

`cmd.button('left','ctrl','pkat')` then ctrl+click:

```
 You clicked /pep///ASP`4/C
 You clicked /pep///GLU`5/N
all selections now: ['_pkbase1', '_pkfrag1', '_pkbase2', '_pkfrag2']
```

The editor pick fires and builds the `_pkbase*/_pkfrag*` machinery — Builder parity works
through the same context.

```
cmd.draw(400,300)  -> OK, then cmd.png -> 29330 bytes
cmd.ray(800,600)   -> 0.020 s
cmd.png            -> 95613 bytes at 1920x1080
```

`cmd.mpng` (the `ModalDraw` path, which hangs without a draw pump):

```
== cmd.mpng (ModalDraw path) ==
 Movie: frame    1 of    5, 0.07 sec.
 ... frame 5 of 5 ...
mpng produced: 5 ['f0001.png','f0002.png','f0003.png','f0004.png','f0005.png']
engine still alive? count_atoms= 10
 You clicked /ala///ALA`2/2HB
post-mpng selections: ['sele']
p.stop() returned cleanly
context destroyed. DONE
```

> **This resolves critique blocker A2.** `ModalDraw` only wedges the engine if nothing calls
> `PyMOL_Draw`. With a real draw pump it self-clears (`packages/engine/layer5/PyMOL.cpp:2279-2286`) and picking
> works again immediately after.

Also note `pymol.cmd._call_with_opengl_context` defaults to `lambda func: func()`
(`packages/engine/modules/pymol/cmd.py:164-165`). Its five callers — `exporting.py:602` (`png`),
`internal.py:555` (`refresh`), `viewing.py:1125` (`scene`), `viewing.py:1660` (`draw`),
`moving.py:434` (`mpng`) — therefore run inline and are correct **as long as the calling thread
is the thread that holds the CGL context**. The `pmg_qt` override
(`packages/engine/modules/pmg_qt/pymol_qt_gui.py:1245-1252`) is a Qt-specific marshalling shim we do not need,
and must not copy.

---

## 4. Experiment 11/12 — thread affinity and resize

CGL contexts are **per-thread**. Verified: create the context *inside* the worker thread, main
thread never touches GL:

```
ctx = ok on thread 6151041024
pick = (['sele'], 1, ['CD1'])
pick_noshaders = (['sele'], ['CG'])       # use_shaders=0 immediate-mode fallback also picks
pick_32bit = (['sele'], ['CD1'])          # pick32bit=1 also picks
MAIN THREAD NEVER TOUCHED GL. DONE
```

Resize: **keep the FBO id stable** and only re-`glRenderbufferStorageEXT` its attachments,
because `G->ShaderMgr->defaultBackbuffer.framebuffer` is latched once at first draw.

```
FBO id (stable across resizes): 1
size 640x480:   viewport=(640, 480)   picks=['C','H','H','C']   glerr=0x0
size 1280x800:  viewport=(1280, 800)  picks=['C','H','H','C']   glerr=0x0
size 400x300:   viewport=(400, 300)   picks=['C','H','H','C']   glerr=0x0
size 1920x1080: viewport=(1920, 1080) picks=['C','H',None,'C']  glerr=0x0
ray 0.020s ; png bytes: 95613
```

## 4b. Performance (1tii.pdb, 5,684 atoms, cartoon + sticks, 1200×900)

```
atoms: 5684
MULTIPICK 900x600 box: 0.0054 s -> sele atoms=668
single-click end-to-end latency (s): [0.1504, 0.1505, ... x10]
min=0.1504 (0.15 s of this is the hard-coded SingleClickDelay)
glGetError: 0x0
```

A full-screen rubber-band multipick over 5,684 atoms costs **5.4 ms**. Over localhost that is
imperceptible. There is no performance argument for moving picking to the client.

---

## 5. There is no CPU / ray-based picking path

Exhaustive check of the C++:

* `SceneDoXYPick` (`packages/engine/layer1/ScenePicking.cpp:17-38`) → `SceneRender(renderInfo.pick=…)`.
* `SceneMultipick` (`:332-360`) → `SceneRender(renderInfo.sceneMultipick=…)`.
* Both land in `SceneGetPickIndices` (`:87-175`) → N passes of `SceneRenderAll` + `PyMOLReadPixels`.
* `ScenePickAtomInWorld` (`packages/engine/layer1/Scene.cpp:5672-5685`) — OpenVR only, and itself calls `SceneDoXYPick`.
* The ray tracer has no pick entry point at all.
* `SceneRenderPickingSinglePick` (`:176-238`) then spirals outward over a `DIP2PIXEL(7)`-radius
  square (`cRange 7`, `:13`) looking for the first non-zero index — i.e. PyMOL's "click near an
  atom" tolerance is a **15×15 px pick-buffer read**, not a distance test in atom space. Any
  reimplementation has to match that or clicks will feel different.

So the choice really is: give the backend a GL context, or reimplement picking somewhere else.

---

## 6. Evaluating the client-side alternative (and why it loses)

`architecture.md:497-504` proposes three.js raycasting. Concretely, here is what that costs.

### 6.1 The CGO pick *colour* cannot be shipped — it is a per-frame draw-order counter

`PickColorManager::colorNext` (`packages/engine/layer1/Picking.cpp:150-186`):

```cpp
const Picking p_new = {{index, bond}, *context};
if (m_count == 0 || m_identifiers[m_count - 1] != p_new) ++m_count;
unsigned j = m_count;
...
colorFromIndex(color, j);
```

The colour encodes `m_count` — a **1-based running counter of distinct pickables in the order
they are emitted during this picking render pass**. The reverse map is
`PickColorManager::m_identifiers`, a process-local `std::vector<Picking>` where
`Picking::context.object` is a raw `pymol::CObject*`. It is thrown away by `invalidate()`
(`packages/engine/layer1/Picking.h`, `PickColorManager::invalidate`) on every geometry rebuild. `colorFromIndex`
(`Picking.cpp:104-117`) additionally packs check bits sized from the live framebuffer's
`GL_*_BITS`.

**Conclusion: the pick colour is meaningless outside the backend process and outside the current
frame. Shipping `CGO_PICK_COLOR` values to a browser is not a thing that can work.**

### 6.2 What *is* shippable

The underlying pair is. `CGO_PICK_COLOR` is `[op, index, bond]` (`packages/engine/layer1/CGO.h:150-151`,
`CGO_PICK_COLOR_SZ 2`), and in the shader path it is materialised as a per-vertex interleaved
`(unsigned index, int bond)` in the CGO's pick data buffer
(`packages/engine/layer1/CGO.cpp:8688-8689`, `:8763-8764`, `:9202-9310`). So a client-side scheme would ship, per
vertex:

```
(object_name: string-interned id, state: int, index: uint32 /*0-based*/, bond: int32)
```

`bond >= 0` = half-bond, `bond == cPickableAtom(-1)` = atom, and `-2..-5` are
`cPickableLabel / cPickableGadget / cPickableNoPick / cPickableThrough`
(`packages/engine/layer1/Picking.h`, mirrored in `packages/engine/modules/pymol/cgo.py:73-77`). That is expressible over the
wire, and the resolve call `pick_resolve(object, state, index, bond)` is trivial.

**But no such extraction exists today** — it requires new C++ in exactly the files WP-06 claims
exclusively (`packages/engine/layer4/CmdWebGeometry.cpp` + the `Cmd.cpp` method table), which re-creates the
ordering hazard: the pick buffer must be rebuilt before it is read.

### 6.3 What the client would have to reimplement

Pick colours are emitted by **16 different rep/object sources**:

```
$ grep -rln "cPickableAtom|pick_color_bond|PickColor" packages/engine/layer2/*.cpp
ObjectCGO.cpp  ObjectCurve.cpp  ObjectGadget.cpp  ObjectGadgetRamp.cpp  ObjectSlice.cpp
RepCartoon.cpp RepCylBond.cpp   RepDistLabel.cpp  RepEllipsoid.cpp      RepLabel.cpp
RepNonbonded.cpp RepNonbondedSphere.cpp RepRibbon.cpp RepSphere.cpp RepSurface.cpp RepWireBond.cpp
```

That includes the colour-ramp gadget, slice objects, curve objects, labels and distance labels —
none of which a three.js molecular raycaster models. Plus, the client must honour:

* `cPickableNoPick` (blocks, picks nothing) and `cPickableThrough` (transparent, pick what's
  behind) — the latter only works because the *shader discards* the fragment
  (`packages/engine/layer1/Picking.cpp:141-146`), with `PICKABLE_THROUGH_CUTOFF = 0.1f` and
  `transparency_picking_mode` (`packages/engine/layer1/Picking.h`);
* `pick32bit`, `pick_shading`, `mouse_selection_mode` → `SceneGetSeleModeKeyword`
  (`packages/engine/layer1/Scene.cpp:503-510`, e.g. `2 -> "bychain"`);
* `cmd.mask` / protected atoms;
* the 15×15 px spiral tolerance (§5).

### 6.4 And picking is not only selection

`SceneClick` dispatches on `ButMode`, and the picked identity drives **all** of these
(`packages/engine/layer1/ButMode.cpp:499-545`): `PkAt` `Pk1` `PkBd` `PkTB` `Sele` `+/-` `+Box` `-Box` `Orig`
`Cent` `Menu` `MovA` `MvAZ` `RotF` `TorF` `MovF` `MvFZ` `DrgM` `RotO` `MovO` `Clik`.
Torsion drag, fragment rotation and molecule drag consume `I->LastPicked` **continuously during
the drag** (`packages/engine/layer1/SceneMouse.cpp`), not once at click time. A client-side picker would have to
round-trip a synthetic pick into the C++ on every mouse-move frame — i.e. it would be slower than
the 5.4 ms backend pick it was supposed to replace, and would need a *new* C++ API to inject
`LastPicked` that does not exist.

### 6.5 Verdict

| | backend pick (CGL+FBO) | client pick (three.js) |
|---|---|---|
| New C++ | **none** | required (pick-data extraction) |
| Reps covered | all 16, automatically | those the client models |
| `cPickableNoPick`/`Through` | free | must reimplement |
| Rubber-band multipick | free, 5.4 ms / 5.7k atoms | must reimplement per rep |
| Editor drag (`RotF`/`TorF`/`MovA`/`DrgM`) | free | needs a new inject-pick API |
| Gadgets, ramps, labels, slices, curves | free | not modelled |
| `mouse_selection_mode`, `mask` | free | must reimplement |
| Wire cost per click | ~200 B | 0 (but +N bytes/vertex on every geometry push) |
| Divergence risk from upstream PyMOL | zero | permanent |

---

## 7. RECOMMENDATION

**Backend-authoritative picking, on a process-owned headless CGL context with an FBO.**

Client-side raycasting may still be used as a *hover-highlight optimisation* (no backend
round-trip for the tooltip), but it must never be the source of truth and must never drive a
selection or an edit.

### 7.1 What the bridge must do (design contract)

1. **On the PyMOL thread, before starting PyMOL**: create the CGL legacy-2.1 context, make it
   current on *that* thread, create one FBO, bind it, size its renderbuffers to the initial
   viewport, `glViewport`. Assert `GL_FRAMEBUFFER_COMPLETE`.
2. Start `pymol2.PyMOL()` with `invocation.options.no_gui = 0` (so `HaveGUI = 1`).
   Do **not** use `pymol.finish_launching`.
3. Set `internal_gui = 0`, `internal_feedback = 0` so window coords == viewport coords
   (otherwise the scene block is inset by 220 px / 18 px and all client mouse coordinates need a
   correction; measured: `reshape(640,480)` → `get_viewport() == (420, 462)` with defaults on).
4. `p.reshape(W, H, 1)` then **`p.draw(); p.idle()` at least 3 times** before accepting input
   (`IDLE_AND_READY == 3`, `packages/engine/layer5/PyMOL.cpp:105`).
5. **Pump loop on the PyMOL thread, tick ≤ 30 ms** (must be < 150 ms, see §3.2):
   `PyMOL_Idle()` then `PyMOL_Draw()`; publish a frame when `PyMOL_GetRedisplay()` is true.
6. All `cmd.*` calls must be marshalled onto that same thread — set
   `pymol.glutThread = <that thread ident>` (critique A4) and override
   `cmd._call_in_gui_thread`; leave `cmd._call_with_opengl_context` at its default
   (`lambda f: f()`), which is then already correct.
7. **Resize**: keep the same FBO name, only re-storage its renderbuffers, then `glViewport`,
   then `p.reshape(W,H,1)`.
8. Mouse events map 1:1: `PyMOL_Button(button, state, x, y, modifiers)` via `_cmd._button`,
   `PyMOL_Drag(x, y, modifiers)` via `_cmd._drag`. `P_GLUT_LEFT/MIDDLE/RIGHT = 0/1/2`,
   `DOWN/UP = 0/1` (`packages/engine/layer0/os_gl_glut_pretend.h:11-26`); modifiers are the `cOrtho*` bitmask
   (SHIFT=1, CTRL=2, ALT=4). **PyMOL window coords are bottom-left origin** — flip the browser's
   `clientY`.
9. **Never** call `PyMOL_Draw` from a thread that does not hold the CGL context. It will segfault
   (`glGetString` at `packages/engine/layer5/PyMOL.cpp:2307`).

### 7.2 Selection results come back for free

No new C++: `cmd.get_names('selections')`, `cmd.count_atoms('sele')`, `cmd.get_model('sele')`,
`cmd.index('sele')` all work immediately after the pick drains. For the richer
"what did I just click" payload, bind a button to `clik` and read `_cmd.get_click_string(G, 1)`
(§3.3) — it already carries object/state/index/bond/resn/resi/name/alt/segi/chain and the 3D
position. **`feature-parity.md` §14 item 6 ("new C for `get_click_string`") is wrong: the C
already exists and is already in the method table (`packages/engine/layer4/Cmd.cpp:6451`). All that is missing is
a Python wrapper.**

### 7.3 Residual risks (be honest about these)

* **Untested: a session with no WindowServer access** (LaunchDaemon, `ssh` with no console
  session). CGL hardware contexts normally require a WindowServer connection. The stated
  deployment model is "local desktop replacement, one browser, localhost", i.e. a logged-in user
  session, where this is fine — but a `launchd` *daemon* (as opposed to a per-user *agent*) may
  fail. Test before shipping any daemonised mode.
* **Linux/Windows parity is a separate spike.** On Linux the equivalent is EGL surfaceless
  (`EGL_MESA_platform_surfaceless`) or GLX pbuffer; on Windows, WGL + a hidden window. None of it
  exists in this tree. The `ctypes` shim must be platform-dispatched.
* One benign driver log line appears on every start and can be ignored:
  `UNSUPPORTED (log once): POSSIBLE ISSUE: unit 0 GLD_TEXTURE_INDEX_2D is unloadable...`.
* `GL_ARB_tessellation_shader` is **False** on Apple's 2.1 profile → PyMOL logs
  `Tessellation shaders not available` and takes the non-tessellated path
  (`packages/engine/layer0/ShaderMgr.cpp:638-...`). Nothing in picking depends on it.
* Antialiasing must stay off in the pick pass — it already is; PyMOL only adds check bits under
  `_WEBGL` (`packages/engine/layer1/ScenePicking.cpp:47-51`), and our 8/8/8/8 buffer gives 0 check bits.

---

## 8. Changes other owners must make (reported, not applied)

1. **`architecture.md:497-504`** — "Our picking is therefore client-side (three.js raycast)"
   must be replaced by backend-authoritative picking. `feature-parity.md:519` is correct.
   Critique **A5 resolves in favour of 00**.
2. **`architecture.md:47-52,251`** — "never calls `p.draw()`" must be deleted. The pump
   **must** call `PyMOL_Draw` every tick, on the GL-owning thread, at ≥ 33 Hz. Without it nothing
   deferred ever executes (§1). This also resolves critique **A1** and **A3** (`SeqUpdate` runs
   from `OrthoDoDraw`, `packages/engine/layer1/Ortho.cpp:1882`) and **A2** (`ModalDraw`, §3.4).
3. **`docs/spikes/build.md` §6.1 and §6.3** (this item used to cite an `"ACTION REQUIRED"`
   section that does not exist in that file) are wrong and must
   be amended: `_cmd._draw` does **not** segfault "headless" — it segfaults when
   `options.no_gui == 0` *and no GL context is current*. With a CGL context it is required.
   `_cmd._refresh` does not exist, but `cmd.refresh()` is **not** a substitute for `_draw`
   (`CmdRefresh` never sets `DrawnFlag`, so the deferred queue stays locked at
   `IdleAndReady < 3`).
4. **WP-01 / protocol owner** — add a `pick` result shape:
   `{object, state /*1-based*/, index /*1-based, as get_click_string reports*/, bond,
   resn, resi, chain, segi, name, alt, rank, id, pos:[x,y,z]}` plus `type: 'none'|'object'|
   'object:molecule'|'object:cgo'`.
5. **WP-02 / bridge owner** — owns the CGL provisioning; the pump; `pymol.glutThread`; and
   thread-affinity for all `cmd` calls. Must **not** copy
   `packages/engine/modules/pmg_qt/pymol_qt_gui.py:1245-1252`.
6. **WP-06 (geometry)** — no longer blocks picking. Per-vertex pick data extraction is now
   optional (hover-highlight only).
7. **`feature-parity.md` §14 item 6** — drop "new C++ needed for `get_click_string`"; only a
   Python wrapper is missing.
8. **CI** — the offscreen-GL picking tests require a logged-in macOS user session. They cannot
   run on a headless CI runner without a console session; gate them the same way the ray
   image-diff tests are gated.
