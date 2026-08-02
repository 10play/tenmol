# Spike 07 — Cross-platform offscreen GL (Linux EGL, Windows WGL)

**Status: LINUX VERIFIED FOR REAL. WINDOWS STILL UNVERIFIED.**

* **Linux / `egl.py` — RUN, on real Linux, end to end.** In a `debian:bookworm-slim`
  container (linux/arm64) with Mesa 22.3.6, **no GPU, no `/dev/dri`, no `DISPLAY`,
  no X server at all**: `EGL_MESA_platform_surfaceless` gave a desktop
  **OpenGL 4.5 (Compatibility Profile)** llvmpipe context, one FBO bound before the
  first draw, `glReadPixels` returned the exact colour cleared, **PyMOL rendered a
  5,684-atom cartoon of `packages/engine/test/dat/1tii.pdb`** with `glGetError() == 0`, and the
  **backend pick pass selected an atom on 3 of 3 clicks**. Full transcript in §2.8.
  Reproduce with `bash scripts/test-gl-linux.sh`; CI runs the identical validator on
  `ubuntu-latest` via `.github/workflows/webclient-gl-linux.yml`.
  **Three real defects were found by running it and are fixed** — see §2.7.
* **Windows / `wgl.py` — NOT EXECUTED.** No Windows host was reachable. It has been
  re-reviewed line by line against the WGL/Win32 ABI, **six** defects were fixed by
  inspection (the authoritative list is §4.2), and the struct marshalling is verified
  portably. It must still be run.
  §6.4 is the manual procedure and §4.2 is the honest list of what that would settle.
  The fourth defect (found in the re-review recorded in §2.9) was a **cdecl-vs-`__stdcall`
  mismatch on every entry point resolved through `wglGetProcAddress`** — invisible on x64,
  stack-corrupting on win32, and it covered the whole framebuffer group. See §8.3.

Everything in §5 was executed on macOS and every transcript is verbatim; everything in
§2.8 was executed on Linux and is verbatim.

This closes the deferral in `03-implementation-plan.md:149` ("Linux (EGL surfaceless / GLX
pbuffer) and Windows (WGL + hidden window) are a **separate spike**") and in
`04-picking.md:600-601`. Product-owner decision 2: cross-platform offscreen GL is funded now.

Files delivered:

| file | owner | platform |
|---|---|---|
| `packages/bridge/tenmol_bridge/glcontext/__init__.py` | WP-02 | dispatch |
| `packages/bridge/tenmol_bridge/glcontext/cgl.py` | WP-02 | macOS — **working, hardware-verified** (spike 04) |
| `packages/bridge/tenmol_bridge/glcontext/egl.py` | this spike | Linux / BSD — **working, hardware-verified (§2.8)** |
| `packages/bridge/tenmol_bridge/glcontext/wgl.py` | this spike | Windows — **unverified** |
| `scripts/test-gl-linux.sh` | this spike | the Linux acceptance test, runnable anywhere Docker is |
| `.github/workflows/webclient-gl-linux.yml` | this spike | the same test on `ubuntu-latest` |

---

## 0. TL;DR

| Question | Answer |
|---|---|
| Linux windowless desktop GL without X? | **Yes** — `eglGetPlatformDisplayEXT(EGL_PLATFORM_SURFACELESS_MESA)` on Mesa, `EGL_EXT_platform_device` + `eglQueryDevicesEXT` on NVIDIA headless. Both implemented, tried in that order, with `eglGetDisplay(EGL_DEFAULT_DISPLAY)` as a last resort. |
| Windows windowless desktop GL? | **No such thing.** `wglCreateContext` needs an `HDC` with a pixel format, and the only universally-accelerated one is a window's. We create a `CS_OWNDC` window that is **never shown** and render only into an FBO. |
| ANGLE on Windows? | **Implemented but must not ship.** It gives OpenGL **ES**, and PyMOL's Windows build calls `glewInit()` (`packages/engine/layer0/ShaderMgr.cpp:566`), which on Windows resolves through `wglGetProcAddress` and returns nothing when no WGL context is current. Reachable only via `TENMOL_WGL_BACKEND=angle`; `info()` reports `desktopGL: False`. |
| GLES-only Linux driver? | Detected and reported. `eglBindAPI(EGL_OPENGL_API)` failure ⇒ `NoOffscreenGL(reason="gles-only")`, or `api: "gles"` / `desktopGL: False` in `info()` under `allow_gles=True` / `TENMOL_ALLOW_GLES=1`. |
| EXT vs ARB framebuffer objects | `egl.py`/`wgl.py` **prefer the unsuffixed ARB/core entry points**, unlike `cgl.py`. PyMOL binds the default framebuffer with `glBindFramebuffer` + `GL_FRAMEBUFFER_BINDING` (`packages/engine/layer0/ShaderMgr.cpp:1829-1831`, `packages/engine/layer1/ScenePicking.cpp:64-81`, `packages/engine/layer5/PyMOL.cpp:2237`), i.e. ARB. Handing it an `EXT` framebuffer *name* is undefined on drivers that do not alias the two namespaces. `*EXT` is kept as a whole-group fallback. |
| Does PyMOL's GLEW cope with EGL (no GLX)? | **Yes, and it was already coded for.** `packages/engine/layer0/ShaderMgr.cpp:566-573` calls `glewInit()` and explicitly swallows `GLEW_ERROR_NO_GLX_DISPLAY` — the exact error GLEW ≥ 2.2 returns under an EGL context with no X display. |
| New C++ needed? | **None.** Same conclusion as spike 04. `setup.py` is untouched: Linux already links `-lGL -lGLEW` (`setup.py:736-739`), Windows already links `glew32` + `opengl32` (`setup.py:728-734`). No EGL, no OSMesa, no ANGLE is added to the build. |
| Verified on real Linux? | **Yes.** Mesa 22.3.6 / llvmpipe, Debian bookworm, arm64, no GPU, no `/dev/dri`, no `DISPLAY`. Desktop GL 4.5 compat, FBO id 1, PyMOL cartoon rendered, picking works. §2.8. |
| Verified on real Windows? | **No.** Nothing has run `wgl.py`. §4.2 and §6.4. |
| Does the surfaceless path give GLES or desktop GL? | **Desktop GL** — `EGL_CLIENT_APIS` was `"OpenGL OpenGL_ES "`, `eglBindAPI(EGL_OPENGL_API)` succeeded, and `GL_VERSION` came back `4.5 (Compatibility Profile) Mesa 22.3.6`. The compatibility profile matters: it is what keeps `glPushMatrix`/`glShadeModel` legal. |
| Does GLEW complain under EGL with no X? | **No output at all.** `_cmd*.so` links `libGLEW.so.2.2`, `libGLX.so.0` and `libX11.so.6`, yet with `DISPLAY` unset a full PyMOL start + draw wrote **nothing** to stderr and `cmd.get("use_shaders")` was still `on`. `packages/engine/layer0/ShaderMgr.cpp:566-573` swallowing `GLEW_ERROR_NO_GLX_DISPLAY` is doing its job. |
| Can the backend be made GL-free entirely? | **Not with today's code**, and the blocker is picking, not rendering. Measured both ways in §10. |

---

## 1. The interface all three backends implement

Agreed with WP-02, which owns `glcontext/__init__.py` and `glcontext/cgl.py`:

```python
create_context(width: int, height: int) -> Context

class Context(Protocol):
    width: int; height: int; fbo: int; backend: str
    def make_current(self) -> None: ...
    def resize(self, width: int, height: int) -> None: ...
    def release(self) -> None: ...
    def info(self) -> Dict[str, Any]: ...
```

Failures are `tenmol_bridge.errors.NoOffscreenGL(message, **detail)` (`errors.py:132`), whose
`detail` always carries `platform`, `backend` and a machine-readable `reason`. Both new modules
import that symbol with a `try/except ImportError` local fallback so they stay importable if the
bridge package is ever vendored without `errors.py`.

`info()` from `egl.py` and `wgl.py` is a strict **superset** of `cgl.py`'s key set — verified in
§5.4 — so `/healthz` and the doctor script can render all three the same way.

The two invariants every backend honours, both inherited from spike 04:

1. **Contexts are per-thread.** `eglMakeCurrent` and `wglMakeCurrent` are per-thread exactly like
   `CGLSetCurrentContext`. Create on the engine thread. `info()["ownerThread"]` records the
   thread that last made it current.
2. **Never regenerate the FBO on resize.** `check_gl_stereo_capable` latches
   `G->ShaderMgr->defaultBackbuffer.framebuffer` from `GL_FRAMEBUFFER_BINDING` on the first draw
   (`packages/engine/layer5/PyMOL.cpp:2236-2239`). `resize()` only re-`glRenderbufferStorage`s the attachments of
   the *same* FBO name. Windows additionally never resizes the hidden window, and Linux never
   resizes the pbuffer — nothing is drawn to either.

---

## 2. Linux design (`egl.py`)

### 2.1 Why EGL, not GLX

GLX needs an X server. The deployment model is a local desktop replacement, but the same bridge
has to survive `ssh`, containers and headless workstations. EGL surfaceless has no such
dependency and is the standard headless-GL path on Linux today.

### 2.2 Display selection ladder

Tried in order; override the whole thing with `TENMOL_EGL_PLATFORM=surfaceless|device|default`.

1. **`EGL_MESA_platform_surfaceless`** (`0x31DD`) — `eglGetPlatformDisplayEXT(0x31DD,
   EGL_DEFAULT_DISPLAY, NULL)`. Gated on the string appearing in the **client** extension list
   (`eglQueryString(EGL_NO_DISPLAY, EGL_EXTENSIONS)`, per `EGL_EXT_client_extensions`). This is
   the Mesa path: llvmpipe, iris, radeonsi, zink. No DRM node, no X, no seat.
2. **`EGL_EXT_platform_device`** (`0x313F`) — `eglQueryDevicesEXT` then
   `eglGetPlatformDisplayEXT(0x313F, device, NULL)`. This is the NVIDIA proprietary headless
   path. Pick a specific GPU with `TENMOL_EGL_DEVICE=<index>`; the device is labelled from
   `eglQueryDeviceStringEXT(EGL_DRM_RENDER_NODE_FILE_EXT)` and surfaces in `info()["eglDevice"]`.
3. **`eglGetDisplay(EGL_DEFAULT_DISPLAY)`** — last resort. On Mesa this resolves to
   X11/Wayland/GBM depending on the environment, so it only works where a display server is
   reachable.

Each candidate is `eglInitialize`d; the first that initialises wins. If all fail, the error lists
every attempt *and* the client extension string, which is the single most useful diagnostic on a
broken box.

### 2.3 Desktop GL, enforced

`eglBindAPI(EGL_OPENGL_API)` then `EGL_RENDERABLE_TYPE = EGL_OPENGL_BIT` in `eglChooseConfig`.
PyMOL's non-ES path calls `glPushMatrix`/`glPopMatrix` (`packages/engine/layer1/ScenePicking.cpp:283,306`) and
`glShadeModel` (`:234,272`), and links `-lGL` — GLES cannot run it. Two independent checks:
the `eglBindAPI` return, and `GL_VERSION` not starting with `"OpenGL ES"` (some drivers hand back
an ES context anyway). A GL version below 2.0 is also rejected (`reason="gl-too-old"`), because
that means a software fallback with no shader and usually no FBO support.

### 2.4 Config and context ladders

`eglChooseConfig` is retried with progressively weaker requests:
`8/8/8/8+D24+S8` → `+D24` → drop alpha → `D16` → don't-care. 8/8/8/8 matters: the FBO's `RGBA8`
colour renderbuffer is what `PickColorConverterSetRgbaBitsFromGL` (`packages/engine/layer1/ScenePicking.cpp:38-84`)
measures, and 32 bits total means a **one-pass** pick for any realistic scene.

`eglCreateContext` ladder — **the first entry is an empty attribute list on purpose**. The EGL
default is `MAJOR=1, MINOR=0`, and for the OpenGL API that means "any context compatible with GL
1.0", i.e. the driver's highest *compatibility* profile. That is exactly what PyMOL wants, and it
matches what a plain `wglCreateContext` gives on Windows. Fallbacks: explicit `2.1`, then `3.2 +
EGL_CONTEXT_OPENGL_COMPATIBILITY_PROFILE_BIT`.

### 2.5 Surface

A pbuffer sized to the viewport is created if the config offers one — `EGL_MESA_platform_surfaceless`
explicitly permits pbuffers ("The surfaceless platform imposes no platform-specific restrictions
on the creation of pbuffers"). If it fails we fall back to `eglMakeCurrent(dpy, EGL_NO_SURFACE,
EGL_NO_SURFACE, ctx)`, which requires `EGL_KHR_surfaceless_context` or EGL ≥ 1.5; if neither is
present that is a hard, explicit failure rather than a mysterious `EGL_BAD_SURFACE` later.
Nothing is ever drawn to the surface — PyMOL's default framebuffer is our FBO.

### 2.6 Which `libGL`

`libGL.so.1` first, then `libGL.so`, then `libOpenGL.so.0`; override with `TENMOL_GL_LIB`.
`libGL.so.1` is deliberate: that is the SONAME PyMOL's `_cmd` extension links (`setup.py:736-739`),
so loading it (with `RTLD_GLOBAL`) guarantees the bridge and the engine share one dispatch table.
GL entry points are resolved `dlsym(libGL)` first, `eglGetProcAddress` second — `eglGetProcAddress`
is only guaranteed to return *core* GL functions when `EGL_KHR_get_all_proc_addresses` is present.

Measured: `ldd` on the built `_cmd*.so` inside the Linux container shows it pulling in
`libGL.so.1`, `libGLEW.so.2.2`, `libGLdispatch.so.0`, `libGLX.so.0` **and** `libX11.so.6`.
Linking `libGLX`/`libX11` is not the same as *needing* an X server: nothing ever calls
`XOpenDisplay`, and the whole suite runs with `DISPLAY` unset. Do not try to "fix" this by
unlinking them; `setup.py` is upstream and stays untouched.

### 2.7 Three defects the first real run exposed (all fixed)

Every one of these was invisible to the mock-driver harness in §5, because a mock cannot
disagree with you. The transcripts are in §2.8.

**D-EGL-1 — `eglTerminate` was not reference-counted, and `EGLDisplay` is a process-global
singleton.** `eglGetPlatformDisplayEXT` with the same platform + native display returns the
*same* `EGLDisplay` to every caller, and the EGL 1.5 spec has `eglTerminate` mark **all**
resources on that display for deletion — there is no refcount in the driver. So the old
`release()`, which always terminated, killed every other context in the process. Measured:
with two contexts open, `a.release()` made `b.make_current()` fail with `EGL_BAD_DISPLAY`.
This was already listed as residual risk §8.7 ("if that ever changes, refcount the display");
it is now done rather than predicted. `_display_refs` in `egl.py` counts live contexts per
display and only the last one terminates (and only the last one calls `eglReleaseThread`,
which would otherwise unbind a sibling context from this thread).

**D-EGL-2 — `release()` deleted its FBO against whatever context happened to be current.**
`glDeleteFramebuffers`/`glDeleteRenderbuffers` act on the **current** context, not on the
context that owns the names. Releasing context A while B was current therefore deleted *B's*
FBO name 1 and renderbuffers 1 and 2. Measured: after the fix to D-EGL-1 alone, B survived but
its next draw returned `GL_INVALID_FRAMEBUFFER_OPERATION` (`0x0506`) and read back
`[0,0,0,0]`. `release()` now binds its own context before deleting, and if it cannot bind
(another thread holds it) it skips the deletes entirely — `eglDestroyContext` reclaims every
object in the context anyway. **`wgl.py` had the identical bug and it is fixed there too, by
inspection.** `cgl.py` should be checked; see §9.

**D-EGL-3 — cross-thread hand-off was impossible, and the docstring said the opposite.**
The old class docstring claimed only that `release()` unbinds first. In fact
`eglMakeCurrent` from thread B while thread A still holds the context returns
`EGL_BAD_ACCESS` — EGL has no "steal", the *owning* thread must unbind. Measured and now
asserted in the acceptance test. `EGLContext` grew `is_current()` and `release_current()`,
`make_current()` short-circuits when it is already current on the calling thread, and the
`EGL_BAD_ACCESS` message now names the owning thread and says what to do. `WGLContext` grew
the same two methods, because `wglMakeCurrent` documents the same one-thread-at-a-time rule
(unverified there).

Also added while here: `GLFunctions` now binds `glPixelStorei` and `glReadBuffer`, which
`render/framestream.py:PixelReadback` looks for on `ctx.gl` and silently degrades without.

### 2.8 The verbatim Linux transcript

Host: macOS arm64 with Docker Desktop 27.4.0. Guest: `debian:bookworm-slim`, linux/arm64,
Mesa 22.3.6, `python3` 3.11 / venv, PyMOL 3.2.0a built from **this tree** with the
`scripts/bootstrap.sh` recipe (`--config-settings use-msgpackc=c++11`, mmtf-cpp on
`PREFIX_PATH`). The container has **no GPU, no `/dev/dri`, no `DISPLAY`, no `WAYLAND_DISPLAY`**:

```
$ docker run --rm tenmol-gl-linux:test bash -c 'echo "DISPLAY=${DISPLAY:-<unset>}"; ls /dev/dri'
DISPLAY=<unset>
ls: cannot access '/dev/dri': No such file or directory
```

Command: `bash scripts/test-gl-linux.sh` (from the repo root, on macOS — the script packs the
tracked working tree, builds the image and runs the validator inside it).

```
==> runtime: docker (Docker version 27.4.0, build bde2b89)
==> packing sources (tracked files, working-tree state)
     32M of sources
==> building tenmol-gl-linux:test (Debian bookworm + Mesa + PyMOL from this tree)
#12 27.49 PyMOL 3.2.0a Open-Source, 2026-07-31
==> running the validator with NO GPU, NO X, NO /dev/dri

== 1. probe (no context created) =================================
  libEGL              : libEGL.so.1
  libGL               : libGL.so.1
  client extensions   : 16
  probe() reports ok                         PASS
  EGL_MESA_platform_surfaceless advertised   PASS
  libGL.so.1 loadable                        PASS

== 2. surfaceless desktop-GL context =============================
  backend             : egl
  eglPlatform         : surfaceless
  eglVersion          : 1.5
  eglVendor           : Mesa Project
  surface             : pbuffer
  api                 : gl
  desktopGL           : True
  vendor              : Mesa/X.org
  renderer            : llvmpipe (LLVM 15.0.6, 128 bits)
  version             : 4.5 (Compatibility Profile) Mesa 22.3.6
  glsl                : 4.50
  fbo                 : 1
  colorBits           : [8, 8, 8, 8]
  depthBits           : 24
  fboEntryPoints      : ARB
  extensionCount      : 302
  platform is surfaceless                    PASS  surfaceless
  DESKTOP GL, not GLES                       PASS
  GL_VERSION is not 'OpenGL ES'              PASS  4.5 (Compatibility Profile) Mesa 22.3.6
  GL >= 2.0 (PyMOL shader path)              PASS  (4, 5)
  ARB (not EXT) framebuffer entry points     PASS
  RGBA8 colour                               PASS  [8, 8, 8, 8]
  depth buffer present                       PASS  24
  FBO bound before any draw                  PASS

== 3. clear + glReadPixels =======================================
  glGetError          : 0
  pixel (0,0)         : [64, 128, 191, 255]
  glReadPixels raised no GL error            PASS  0
  readback == the colour we cleared to       PASS  [64, 128, 191, 255]
  every pixel is non-blank                   PASS

== 4. resize keeps the FBO NAME (packages/engine/layer5/PyMOL.cpp:2236) ==========
  fbo ids across 4 resizes: [1, 1, 1, 1, 1]
  FBO name never regenerated                 PASS  [1, 1, 1, 1, 1]
  size tracked                               PASS
  still bound after resize                   PASS

== 5. EGL thread affinity ========================================
  cross-thread steal  : refused: eglMakeCurrent failed: EGL_BAD_ACCESS -- this context is still current
  a second thread may NOT steal the context  PASS
  release_current()   : True
  hand-off binding    : 1
  release_current() then another thread binds it PASS  [1]
  owner re-binds afterwards                  PASS

== 6. two contexts on one EGLDisplay =============================
  same EGLDisplay     : True
  b after a.release() : pixel=[0, 255, 0, 255] glGetError=0
  releasing one context does not break the other PASS

== 7. a REAL PyMOL render through this context ===================
  1tii.pdb -> 5684 atoms
  draw                : 134.3 ms, glGetError=0
  PyMOL drew with no GL error                PASS  0
  PyMOL still draws into OUR fbo             PASS
  PixelReadback source: context.gl (2.28 ms)
  Mode P reads back through ctx.gl           PASS  context.gl
  non-black pixels    : 13578 / 76800 (17.7%)
  the rendered image is NOT blank            PASS  13578 px
  wrote               : /out/linux-egl-pymol.png (41532 bytes)

== 8. the backend pick pass (packages/engine/layer1/ScenePicking.cpp) ============
  clicks that selected: 3/3  [(160, 120, 'CA'), (180, 130, 'CA'), (130, 100, 'CA')]
  clicking selects an atom (this is what needs GL) PASS

== 9. cmd.ray -- the CPU tracer ==================================
  cmd.ray 320x240       : 0.244 s -> 73546 bytes
  cmd.ray produced an image                  PASS  73546 bytes

== RESULT ========================================================
  all checks passed

Linux offscreen GL: VALIDATED
```

The image `linux-egl-pymol.png` is a rainbow-spectrum cartoon of 1TII — visually
indistinguishable in structure and orientation from the `cmd.ray` render of the same scene,
which is the strongest available evidence that the GL path is not producing garbage.

**The `device` platform also works on the same box** (Mesa exposes a software `EGLDevice`, so
this exercises the code path the NVIDIA proprietary driver takes, even without NVIDIA):

```
$ docker run --rm -e TENMOL_EGL_PLATFORM=device tenmol-gl-linux:test /venv/bin/python -c "..."
device[0] | llvmpipe (LLVM 15.0.6, 128 bits) | 4.5 (Compatibility Profile) Mesa 22.3.6 | desktopGL= True
```

**GLEW is silent.** A full `SingletonPyMOL().start()` + load + draw with `DISPLAY` unset, with
stderr captured separately:

```
--- stderr:
--- (end stderr)
use_shaders = on
stereo_capable = off
```

Empty. `use_shaders` is still `on`, i.e. `glewInit()` succeeded and `disableShaders(G)`
(`packages/engine/layer0/ShaderMgr.cpp:590-597`) did **not** run. This settles residual risk §8.2 for
GLEW 2.2 on Mesa.

Both the `--quick` path (Mesa only, no PyMOL build, ~1 min) and the `--native` path that CI
uses were run and passed too.

### 2.9 Independent re-validation (second run, different session)

§2.8 was re-run from scratch by a second pass whose explicit brief was that these modules "have
NEVER executed" — i.e. it was told to distrust the claims above and re-measure. It reproduced
them. Recording it because "the docstring says it was verified" is not evidence, and this is:

```
$ bash scripts/test-gl-linux.sh --quick --image tenmol-gl-linux:quick --out <tmp>
  eglPlatform: surfaceless    eglVersion: 1.5     eglVendor: Mesa Project
  api: gl   desktopGL: True   renderer: llvmpipe (LLVM 15.0.6, 128 bits)
  version: 4.5 (Compatibility Profile) Mesa 22.3.6      fbo: 1
  colorBits: [8,8,8,8]  depthBits: 24  fboEntryPoints: ARB  extensionCount: 302
  pixel (0,0): [64, 128, 191, 255]        <- exactly the colour cleared
  fbo ids across 4 resizes: [1, 1, 1, 1, 1]
  cross-thread steal : refused: EGL_BAD_ACCESS
  all checks passed

$ bash scripts/test-gl-linux.sh --image tenmol-gl-linux:full --out <tmp>
  #12 28.06 PyMOL 3.2.0a Open-Source, 2026-07-31     <- built from this tree, in-container
  1tii.pdb -> 5684 atoms
  draw                : 158.3 ms, glGetError=0
  PixelReadback source: context.gl (2.92 ms)
  non-black pixels    : 13578 / 76800 (17.7%)
  clicks that selected: 3/3  [(160,120,'CA'), (180,130,'CA'), (130,100,'CA')]
  cmd.ray 320x240     : 0.218 s -> 73567 bytes
  all checks passed
```

Two things were checked that a passing test does not by itself establish:

* **The container really ran the working-tree file**, not a stale copy baked into an image layer:
  `sha256sum /src/bridge/tenmol_bridge/glcontext/egl.py` inside the container matched the host's
  (`ae886ddde399f334…`), and the imported module resolved to `/src/bridge/…/egl.py`.
* **PyMOL was really compiled in the image**, not imported from a wheel:
  `/venv/lib/python3.11/site-packages/pymol/_cmd.cpython-311-aarch64-linux-gnu.so`.

The `_functype` fix in §8.3 was made *after* this run and the full suite was then re-run with the
patched `egl.py` mounted over the built image: identical result, **13578/76800 non-black pixels**
to the pixel, 3/3 picks. The 129 bridge tests still pass (`129 passed in 30.20s`).

The CI workflow's apt list was also verified for real rather than assumed — every one of
`libegl1 libegl-mesa0 libgl1 libglx-mesa0 libgl1-mesa-dri libopengl0 libglvnd0 mesa-utils-bin`
resolves on both `ubuntu:22.04` and `ubuntu:24.04`, and `from tenmol_bridge.glcontext import egl`
was confirmed to import under a **bare `python3` with no bridge dependencies installed** (the
`egl-surfaceless` job installs no Python packages, so anything heavier in
`tenmol_bridge/__init__.py` would have made that job red on the first push).

---

## 3. Windows design (`wgl.py`)

### 3.1 A hidden window, not a pbuffer

`WGL_ARB_pbuffer` is itself obtained through `wglGetProcAddress`, which needs a current context,
which needs a window — so a window is unavoidable either way. We create one
`WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN` window, **without `WS_VISIBLE` and without
`ShowWindow`**, take its DC, set a pixel format on it once, and render only into an FBO.
`CS_OWNDC` is required: without it `GetDC` returns a DC from the common pool, the pixel format is
not guaranteed to persist, and a later `wglMakeCurrent` can fail with
`ERROR_INVALID_PIXEL_FORMAT (2000)` — which the module names explicitly in that error message.

The window class registers `DefWindowProcW`'s **address** as `lpfnWndProc` rather than a Python
callback, which sidesteps the usual ctypes callback-lifetime hazard entirely. Class names are
`TenmolOffscreenGL_<pid>_<n>` so repeated create/release cycles never collide.

No message pump is needed: the window is never shown and never drawn to.

### 3.2 The failure this module exists to catch

On a Windows Server / RDP / VM session with no vendor ICD, `ChoosePixelFormat` cheerfully returns
the **Microsoft GDI Generic** implementation — `PFD_GENERIC_FORMAT` set, `PFD_GENERIC_ACCELERATED`
clear, `GL_VERSION == "1.1.0"`, `GL_RENDERER == "GDI Generic"`. That is a software rasteriser with
no FBO support at all, and PyMOL would fail late and incomprehensibly. `wgl.py` calls
`DescribePixelFormat` on the chosen format (the only way to see those flags — `ChoosePixelFormat`
never reports them back), classifies the result as `icd` / `mcd` / `gdi-generic`, and raises
`NoOffscreenGL(reason="gdi-generic")` up front with a remediation hint.

### 3.3 Loading GL entry points

`opengl32.dll` exports **only OpenGL 1.1**. `glGetString`, `glGetIntegerv`, `glGetError`,
`glViewport`, `glFinish`, `glReadPixels`, `glClear`, `glClearColor` come from the DLL export
table; everything FBO-related must come from `wglGetProcAddress`, which requires a current context.
A family of older ICDs returns the sentinels `1`, `2`, `3` and `-1` instead of `NULL` on failure;
those are filtered.

The DLL export table is queried **first** and `wglGetProcAddress` second. That is deliberate and
it is the opposite of the Linux order: `wglGetProcAddress` is *specified* to return NULL for
OpenGL 1.1 entry points — which is exactly the list above — while `opengl32.dll` exports nothing
newer. The two sources are disjoint, so either order finds every name; asking the DLL first is
simply the order that never asks a function for something it is documented to refuse. (An earlier
docstring in `egl.py` asserted the reverse order was mandatory on Windows. It was wrong, and
`wgl.py` had always done the right thing; the docstring is corrected.)

**Calling convention.** Addresses from `wglGetProcAddress` carry no calling convention, and every
GL entry point is `APIENTRY` = `__stdcall`. Building those pointers with `ctypes.CFUNCTYPE`
(cdecl) — which is what the code did until the re-review in §2.9 — is a no-op on x86-64 and
stack corruption on 32-bit x86. `egl._functype()` now selects `WINFUNCTYPE` on Windows. Note this
hazard applies *only* to the `wglGetProcAddress`/`eglGetProcAddress` paths: functions taken
straight off a `WinDLL` already get `__stdcall` from ctypes. See §8.3.

### 3.4 ANGLE

Implemented (`TENMOL_WGL_BACKEND=angle`, reusing `egl.py` with `egl_libs=("libEGL.dll",)`,
`gl_libs=("libGLESv2.dll",)`) purely so a Windows box can *diagnose* with it. It must not ship:
ANGLE gives OpenGL ES, and `glewInit()` (`packages/engine/layer0/ShaderMgr.cpp:566`) resolves through
`wglGetProcAddress` with no WGL context current, so it fails and `disableShaders(G)`
(`ShaderMgr.cpp:590-597`) runs. The context adds a `warnings[]` entry saying exactly this.

---

## 4. Honesty: what is and is not proven

### 4.1 Linux — settled

Everything below moved from "not proven" to "measured" in §2.8:

* Surfaceless EGL exists and initialises with **no GPU, no DRI device, no display server**.
* `eglBindAPI(EGL_OPENGL_API)` succeeds and the resulting context is **desktop GL 4.5
  compatibility**, not GLES.
* Real drivers accept these attribute lists — both the `surfaceless` and the `device` ladders.
* The ARB framebuffer group resolves, the FBO is complete, and the name survives four resizes.
* **GLEW resolves under EGL and prints nothing**; `use_shaders` stays `on`.
* **PyMOL renders**, `glGetError()` is 0, and `render/framestream.py:PixelReadback` reads back
  through `ctx.gl` (`source == "context.gl"`).
* **PyMOL picks** — 3/3 clicks selected a CA atom. Spike 04's macOS-only picking result now has
  a Linux twin.
* Residual risk §8.1 (libglvnd hiding driver capability) did not bite: `fboEntryPoints` was
  `ARB` and the FBO was complete. On this stack glvnd's stubs and the driver agree. It remains
  a *theoretical* risk on a non-glvnd stack, which was not available to test.

Still not covered on Linux, honestly:

* **Only llvmpipe was exercised.** No NVIDIA proprietary `EGL_EXT_platform_device`, no
  radeonsi/iris, no `zink`. The `device` ladder ran, but against Mesa's software device.
* **Only Mesa 22.3.6 (Debian bookworm), arm64.** The CI workflow adds Ubuntu 22.04 and 24.04
  (Mesa 23.x/24.x, x86-64) on the next push, which is the cheapest way to widen this.
* **Only one PyMOL rep (cartoon) at one size.** This is a GL-context test, not a rendering
  parity test; image parity across platforms belongs to the ray image-diff suites.

### 4.2 Windows — NOT settled

`wgl.py` has still never executed. Do not describe it as working. What a Windows run would
settle, and nothing else can:

* That `ChoosePixelFormat`/`SetPixelFormat`/`wglCreateContext` succeed on a real ICD at all.
* That the `gdi-generic` detection fires when — and only when — it should.
* That `wglGetProcAddress` resolves the ARB framebuffer group under a legacy
  `wglCreateContext` context (it should; GLEW does the same thing), and that the
  1/2/3/-1 sentinel handling is not needed *and* not harmful.
* That `glewInit()` succeeds with a hidden `CS_OWNDC` window and no message pump.
* That `DestroyWindow` + `UnregisterClassW` at shutdown leave nothing behind.
* That PyMOL picks through it.

Reviewed and **fixed by inspection** in this pass, still unrun:

1. `DescribePixelFormat`'s return value was ignored. On failure it leaves the descriptor
   untouched, so `dwFlags` would read back as `0` — which has `PFD_GENERIC_FORMAT` **clear**,
   i.e. the Microsoft GDI Generic software rasteriser would have been misreported as a hardware
   ICD and the `gdi-generic` guard, the entire reason §3.2 exists, would never have fired. Now
   a hard `NoOffscreenGL(reason="describe-pixel-format-failed")`.
2. `release()` deleted the FBO against whatever context was current (D-EGL-2, *measured* on the
   EGL twin). Now binds its own context first, or skips the deletes.
3. `RegisterClassW` treated `ERROR_CLASS_ALREADY_EXISTS` as fatal. A hard kill between
   `CreateWindowExW` and `UnregisterClassW` leaves the atom registered; the class is then
   exactly what we want, so it is now a warning and `UnregisterClassW` is skipped for a class
   we did not register.
4. `create_context` honoured `TENMOL_WGL_BACKEND=angle` *before* the platform check, so on
   macOS/Linux it traded a clear "wrong platform" error for an obscure "cannot load libEGL".
5. `DestroyWindow` has Win32 **thread** affinity that is stricter than `wglMakeCurrent`'s — it
   only works on the thread that called `CreateWindowExW`. `creator_thread` is now recorded
   separately from `owner_thread` (which follows the GL context) and a mismatch at `release()`
   appends a warning naming both threads.
6. **Every entry point resolved through `wglGetProcAddress` was called through a cdecl pointer**
   although `APIENTRY` is `__stdcall` (`GLFunctions._bind`, shared with `egl.py`). Invisible on
   x86-64, where there is one calling convention — and therefore invisible to every review this
   file has had — but stack-corrupting on 32-bit x86, and it covered the **entire framebuffer
   group**, since `opengl32.dll` exports only OpenGL 1.1. Fixed by `egl._functype()`
   (`WINFUNCTYPE` on Windows, `CFUNCTYPE` elsewhere); the Linux suite was re-run after the change
   and is bit-identical, and the same helper now also covers `_EGL._proc`, which matters for the
   ANGLE diagnostic path. §8.3.

Re-verified portably after those edits (macOS, `packages/bridge/.venv/bin/python`):

```
sizeof PIXELFORMATDESCRIPTOR = 40   (mingw-w64 wingdi.h: 40)
  nSize off= 0  nVersion off= 2  dwFlags off= 4  iPixelType off= 8 ... bReserved off=27
  dwLayerMask off=28  dwVisibleMask off=32  dwDamageMask off=36
sizeof WNDCLASSW = 72               (x64: 72)
  style off=0  lpfnWndProc off=8  cbClsExtra off=16  cbWndExtra off=20
  hInstance off=24  hIcon off=32  hCursor off=40  hbrBackground off=48
  lpszMenuName off=56  lpszClassName off=64
wgl.probe()          -> {'backend':'wgl','platform':'darwin','ok':False,'error':"not Windows (sys.platform='darwin')"}
create_context off-Windows -> NoOffscreenGL: the WGL backend needs Windows; sys.platform is 'darwin'
TENMOL_WGL_BACKEND=angle off-Windows -> NoOffscreenGL: the WGL backend needs Windows (was: a libEGL.dll load error)
WGLContext methods   -> is_current, release_current, make_current, resize, release, info
EGLContext methods   -> is_current, release_current, make_current, resize, release, info
```

Reviewed and deliberately **left alone** (they are correct, recording so the next reviewer does
not re-litigate them):

* `wc.lpfnWndProc = ctypes.cast(user32.DefWindowProcW, c_void_p).value` — storing the real
  `DefWindowProcW` address rather than a Python callback is what removes the callback-lifetime
  hazard entirely. `wc` being a local is fine: `RegisterClassW` copies the class.
* `CS_OWNDC` + `ReleaseDC` — with `CS_OWNDC` the DC belongs to the window and `ReleaseDC` is a
  no-op, which is harmless and keeps the teardown symmetric.
* No message pump. `CreateWindowExW`/`DestroyWindow` dispatch `WM_CREATE`/`WM_DESTROY`
  synchronously to `DefWindowProcW`; a never-shown DC holder needs nothing else.
* `wglGetProcAddress` sentinel list `(1, 2, 3, 0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF, -1)` — with
  `restype = c_void_p` the negative entries are unreachable, but they cost nothing and document
  the quirk.
* `ATOM = c_uint16` for `RegisterClassW`'s return, `WPARAM = c_size_t`, `LPARAM = c_ssize_t` —
  all correct for x64 and x86.

### 4.3 Proven on macOS only (unchanged) — transcripts in §5:

* Both modules import cleanly on a host with no `libEGL` and no `ctypes.WinDLL`.
* Every `ctypes` prototype has the arity, argument order and argument types the EGL/WGL ABI
  specifies, and every enum matches the Khronos/mingw-w64 headers (§7 provenance).
* `PIXELFORMATDESCRIPTOR` marshals to **40 bytes** and `WNDCLASSW` to **72 bytes** (x86-64) —
  cross-checked against a C compiler compiling the same struct definitions.
* The full call *sequence* — display → API → config → context → surface → make-current → FBO →
  resize → release — is issued in the right order with the right enum values, driven through
  mock `libEGL`/`libGL`/`user32`/`gdi32`/`opengl32` shared objects.
* All 29 documented failure `reason`s fire, and none of them leaks an untyped exception.
* Platform dispatch selects `egl`/`wgl`/`cgl` correctly under a monkeypatched `sys.platform`.
* The real macOS CGL path still works after these changes (`Apple M4 Max`, `2.1 Metal - 89.4`).

**STILL NOT proven — needs Windows hardware** (the Linux entries that used to live here have
moved to §4.1; do not re-add them):

* That the **Windows calling convention** is honoured. Both sides of the mock harness are System V
  AMD64 on macOS. On x86-64 Windows this is very likely fine (uniform convention, and ctypes
  handles it), but on 32-bit Windows `__stdcall` vs `cdecl` genuinely differs — that is why every
  Win32 DLL is opened with `ctypes.WinDLL`, and why `egl.py` also uses `WinDLL` when
  `sys.platform` is Windows.
* That a real **Windows ICD** accepts these pixel-format ladders, that `wglGetProcAddress`
  resolves the ARB framebuffer group, and that GLEW initialises against a hidden window.
* That PyMOL renders and **picks** through a WGL context. §6.4 is the test that settles it.
* `NVIDIA's eglQueryDevicesEXT` on the proprietary Linux driver. The `device` ladder was
  exercised (§2.8) but only against Mesa's software `EGLDevice`.
* `_load_gl()` does `dlsym` on `libGL.so.1` for the ARB framebuffer group. With libglvnd those
  symbols are always present as dispatch stubs regardless of what the vendor driver supports, so
  the ARB-vs-EXT group choice is decided by libglvnd, not by the driver. On the stack in §2.8 the
  stubs and the driver agreed (`fboEntryPoints: ARB`, FBO complete), and the FBO-completeness
  check is the backstop — but a **non-glvnd** stack was not available. Still the first thing to
  check if Linux misbehaves.

---

## 5. What was executed here (verbatim)

Interpreter: `.../scratchpad/venv/bin/python` (Python 3.13.3, the venv PyMOL 3.2.0a0 is installed in).

### 5.1 Import, struct layout, and the failure paths

```
$ .../venv/bin/python -m py_compile packages/bridge/tenmol_bridge/glcontext/egl.py packages/bridge/tenmol_bridge/glcontext/wgl.py
PY_COMPILE OK
IMPORT OK tenmol_bridge.glcontext.egl tenmol_bridge.glcontext.wgl
egl.__all__ ['EGLContext', 'create_context', 'GLFunctions', 'GLFramebuffer', 'probe']
wgl.__all__ ['WGLContext', 'create_context', 'probe']
EGLContext.backend egl | WGLContext.backend wgl
sizeof PIXELFORMATDESCRIPTOR = 40 (expect 40)
sizeof WNDCLASSW = 72
```

```
=== 1. egl.create_context on macOS (no libEGL) ===
  NoOffscreenGL: cannot load libEGL (darwin). On Debian/Ubuntu install 'libegl1'; on RHEL/Fedora
  'mesa-libEGL'. Tried: libEGL.so.1: dlopen(...) (no such file); libEGL.so: dlopen(...)
  kind = NoOffscreenGL | detail = {'reason': 'libegl-missing', 'tried': ['libEGL.so.1', 'libEGL.so'],
                                   'platform': 'darwin', 'backend': 'egl'}
=== 2. wgl.create_context on macOS ===
  NoOffscreenGL: the WGL backend needs Windows; sys.platform is 'darwin'
  detail = {'reason': 'wrong-platform', 'platform': 'darwin', 'backend': 'wgl'}
=== 3. wgl.create_context with TENMOL_WGL_BACKEND=angle ===
  reason = libegl-missing | tried = ['libEGL.dll']
=== 4. probe() never raises ===
  wgl.probe() = {'backend': 'wgl', 'platform': 'darwin', 'ok': False,
                 'error': "not Windows (sys.platform='darwin')"}
=== 5. NoOffscreenGL is the shared typed error ===
  egl.NoOffscreenGL is errors.NoOffscreenGL: True
  wgl.NoOffscreenGL is errors.NoOffscreenGL: True
```

`pyflakes 3.4.0` reports nothing on either file (and does report both errors in a deliberately
broken control file, so it really ran).

### 5.2 Platform dispatch

```
=== backend_for_platform ===
  darwin       -> cgl
  linux        -> egl
  linux2       -> egl
  freebsd14    -> egl
  win32        -> wgl
  cygwin       -> wgl
  aix          -> NoOffscreenGL(unsupported-platform)
  emscripten   -> NoOffscreenGL(unsupported-platform)
=== create_context with sys.platform monkeypatched ===
  linux    -> NoOffscreenGL backend='egl' reason='libegl-missing'
  win32    -> NoOffscreenGL backend='wgl' reason='no-windll'
  cygwin   -> NoOffscreenGL backend='wgl' reason='no-windll'
  aix      -> NoOffscreenGL backend=None reason='unsupported-platform'
  restored sys.platform = darwin
=== real macOS path still works (cgl, owned by bridge-core) ===
   backend=cgl renderer='Apple M4 Max' version='2.1 Metal - 89.4' fbo=1
```

> The `no-windll` reason is a **bug this test found**: `ctypes.WinDLL` does not exist off-Windows,
> so referencing it directly leaked a raw `AttributeError` instead of a typed `NoOffscreenGL`.
> Both modules now look it up defensively.

### 5.3 Mock-driver harness

Three shared objects were compiled (`cc -shared -fPIC`) implementing the EGL, GL and Win32 ABIs,
logging every call with its arguments, and driven by env-var knobs. `egl.py` was pointed at them
with `TENMOL_EGL_LIB`/`TENMOL_GL_LIB`; `wgl.py` was driven with `sys.platform = "win32"` and
`ctypes.WinDLL` monkeypatched onto the mock.

The happy-path EGL trace, verbatim, is the call sequence a Linux driver will see:

```
eglGetPlatformDisplayEXT(platform=0x31DD native=0x0 attrs=0x0)
eglInitialize(dpy=surfaceless)
eglBindAPI(0x30A2)
eglChooseConfig(surface_type=0x1 renderable=0x8 rgba=8/8/8/8 depth=24 stencil=8)
eglCreateContext(attrs=[])
eglCreatePbufferSurface(w=640 h=480)
eglMakeCurrent(surface=pbuffer ctx=ctx)
glGenFramebuffers -> 1
glBindFramebuffer(0x8D40, 1)
glGenRenderbuffers -> 2
glGenRenderbuffers -> 3
glBindRenderbuffer(0x8D41, 2)
glRenderbufferStorage(0x8D41, fmt=0x8058, 640x480)      <- GL_RGBA8
glBindRenderbuffer(0x8D41, 3)
glRenderbufferStorage(0x8D41, fmt=0x81A6, 640x480)      <- GL_DEPTH_COMPONENT24
glFramebufferRenderbuffer(0x8D40, attachment=0x8CE0, 0x8D41, rb=2)
glFramebufferRenderbuffer(0x8D40, attachment=0x8D00, 0x8D41, rb=3)
glCheckFramebufferStatus -> 0x8CD5                       <- GL_FRAMEBUFFER_COMPLETE
glViewport(0,0,640,480)
... resize(1280,800): SAME fbo 1, only glRenderbufferStorage re-run ...
eglMakeCurrent(surface=NO_SURFACE ctx=NO_CONTEXT)
eglDestroyContext / eglDestroySurface / eglTerminate / eglReleaseThread
```

15 EGL scenarios, all as designed:

```
A. happy path: surfaceless + pbuffer + ARB FBO          ok=True  platform=surfaceless surface=pbuffer fboEP=ARB
B. no surfaceless -> EGL_EXT_platform_device            ok=True  platform=device[0] device=/dev/dri/renderD128
C. no platform extensions -> eglGetDisplay(DEFAULT)     ok=True  platform=default
D. TENMOL_EGL_PLATFORM=device TENMOL_EGL_DEVICE=1       ok=True  platform=device[1] device=/dev/dri/renderD129
E. no pbuffer + EGL 1.5 -> surfaceless context          ok=True  surface=none  (+warning)
F. no pbuffer + EGL 1.4, no KHR_surfaceless_context     ok=False reason='no-egl-surface'
G. GLES-only driver                                     ok=False reason='gles-only'
H. GLES-only + allow_gles=True                          ok=True  api=gles desktopGL=False (+warning)
I. GL 1.1 software stack                                ok=False reason='gl-too-old'
J. FBO incomplete                                       ok=False reason='fbo-incomplete'
K. first 3 eglChooseConfig attribute sets rejected      ok=True  (ladder relaxed)
L. first 2 eglCreateContext attribute sets rejected     ok=True  (fell through to 3.2 compat)
M. only EXT_framebuffer_object present                  ok=True  fboEP=EXT (+warning)
N. eglMakeCurrent fails                                 ok=False reason='make-current-failed'
O. every display candidate fails                        ok=False reason='no-egl-display'
```

14 WGL scenarios, all as designed. The happy-path trace shows the invariants:

```
RegisterClassW(style=0x20 wndproc=DefWindowProcW class=TenmolOffscreenGL_30480_1 sizeof=72)
CreateWindowExW(ex=0x0 style=0x86000000 x=0 y=0 w=800 h=600 parent=0x0)   <- no WS_VISIBLE
GetDC(hwnd=...)
ChoosePixelFormat(nSize=40 nVersion=1 dwFlags=0x00000025 iPixelType=0 color=32 alpha=8 depth=24 stencil=8 layer=0)
DescribePixelFormat(fmt=7 bytes=40)
SetPixelFormat(fmt=7 dwFlags=0x00000025)
wglCreateContext(hdc=...)
wglMakeCurrent(hdc=... hglrc=...)
glGenFramebuffers -> 1  [via wglGetProcAddress]     <- NOT an opengl32 export, as on real Windows
... FBO setup / resize / readback identical to the EGL trace ...
wglMakeCurrent(hdc=0x0 hglrc=0x0) / wglDeleteContext / ReleaseDC / DestroyWindow / UnregisterClassW
```

```
A. happy path: hidden window -> WGL -> ARB FBO       ok=True  accel=icd fboEP=ARB
B. GDI Generic (PFD_GENERIC_FORMAT, GL 1.1)          ok=False reason='gdi-generic'
C. MCD (GENERIC_FORMAT|GENERIC_ACCELERATED)          ok=True  accel=mcd
D. RegisterClassW fails                              ok=False reason='register-class-failed'
E. CreateWindowExW fails (service session)           ok=False reason='create-window-failed'
F. GetDC returns NULL                                ok=False reason='no-dc'
G. ChoosePixelFormat rejects 3 descriptors           ok=True  (ladder relaxed)
H. ChoosePixelFormat rejects all 4                   ok=False reason='no-pixel-format'
I. SetPixelFormat fails                              ok=False reason='set-pixel-format-failed'
J. wglCreateContext fails                            ok=False reason='no-context'
K. wglMakeCurrent fails w/ ERROR_INVALID_PIXEL_FORMAT ok=False reason='make-current-failed'
L. only EXT FBO via wglGetProcAddress                ok=True  fboEP=EXT (+warning)
M. broken ICD: wglGetProcAddress returns sentinel 1  ok=False reason='no-fbo'
N. FBO incomplete                                    ok=False reason='fbo-incomplete'
```

No `*** BUG` assertion in the mocks fired: `nSize` was always 40, `sizeof(WNDCLASSW)` matched the
C struct, `WS_VISIBLE` was never set, and the `lpfnWndProc` address round-tripped to
`DefWindowProcW`.

### 5.4 Structural parity with `cgl.py`

Real `CGLContext` (hardware) vs mock-backed `EGLContext`, same process:

```
isinstance(cgl, glcontext.Context) = True
isinstance(egl, glcontext.Context) = True
keys in cgl MISSING from egl: []
egl-only additive keys      : ['api', 'desktopGL', 'eglClientApis', 'eglDevice', 'eglLib',
                               'eglPlatform', 'eglVendor', 'eglVersion', 'extensionCount',
                               'fboEntryPoints', 'surface', 'warnings']
ownerThread follows make_current across threads: True (main=8550408384 worker=6187216896 reported=6187216896)
```

### 5.5 The acceptance script, run three ways

The script in §6.1 was run against the mock as Linux, against the mock as Windows, and **for real
on macOS/CGL**:

```
--- simulated linux/EGL ---     ALL CHECKS PASSED   (16 checks)
--- simulated win32/WGL ---     ALL CHECKS PASSED   (16 checks)
--- real darwin/CGL      ---    ALL CHECKS PASSED   (14 checks + 1 SKIP)
```

Real macOS run:

```
platform      : darwin
backend module: cgl
  [PASS] context created
  [PASS] desktop GL (not GLES) -- 2.1 Metal - 89.4
  [PASS] GL >= 2.0 -- 2.1 Metal - 89.4
  [PASS] FBO name is non-zero -- 1
  [PASS] 8/8/8/8 colour bits (1-pass 32-bit pick index) -- [8, 8, 8, 8]
  [PASS] depth >= 24 bits -- 32
  [PASS] ARB framebuffer entry points
  [SKIP] draw+readback (this backend does not expose .gl)
  [PASS] make_current is re-entrant
  [PASS] info() after release reports released
  [PASS] release is idempotent
ALL CHECKS PASSED
```

The `SKIP` is the one gap: `cgl.py` has no `.gl` accessor. See §9 item 1.

### 5.6 The stage-2 PyMOL script is itself verified — on macOS

The §6.2 script is platform-neutral (it only touches `glcontext.create_context`), so it was run
**unchanged and for real** through the CGL backend. This matters: it means a failure on Linux or
Windows is a platform failure, not a bug in the acceptance test.

```
$ PYTHONPATH=bridge .../venv/bin/python check_pymol_pick.py
 Detected OpenGL version 2.1. Shaders available.
 Detected GLSL version 1.20.
 You clicked /obj01///ALA`1/O
 Selector: selection "sele" defined with 1 atoms.
 ... 27 such lines ...
GL: 2.1 Metal - 89.4 | Apple M4 Max
 Detected 16 CPU cores.  Enabled multithreaded rendering.
viewport: (800, 600)
clicks=30  hits=27  distinct atoms=13
    ((120, 230), 'O')
    ((120, 300), 'CB')
    ((180, 300), 'N')
    ((240, 370), '3HB')
    ((300, 300), 'C')
    ...
ray+png OK
PICKING WORKS
EXIT=0
```

27 hits out of 30 clicks, 13 distinct atoms, `cmd.ray` + `cmd.png` fine — spike 04's result,
reproduced through the new platform-neutral entry point.

---

## 6. THE VALIDATION COMMANDS

**Linux: done and automated — go to §6.3.** `scripts/test-gl-linux.sh` is §6.1 and §6.2 plus
the thread and display checks, with the assertions baked in; §2.8 is its output.
**Windows: still to run — go to §6.4.**

§6.1 and §6.2 are kept because they are the standalone, copy-pasteable scripts the Windows
procedure needs, and because they document what the automated validator asserts.

### 6.1 Stage 1 (both platforms): pure GL, no PyMOL

Save as `check_offscreen_gl.py` next to the repo, run with the bridge venv's python.
**Exit code 0 = pass.** It is deliberately PyMOL-free so it can be run before PyMOL is built.

```python
"""Platform-agnostic offscreen-GL acceptance check for the tenmol bridge."""
import ctypes
import json
import sys

from tenmol_bridge import glcontext
from tenmol_bridge.errors import NoOffscreenGL
from tenmol_bridge.glcontext.egl import (
    GL_COLOR_BUFFER_BIT, GL_DEPTH_BUFFER_BIT, GL_RGBA, GL_UNSIGNED_BYTE,
)

W, H = 320, 240
FAIL = []


def check(label, ok, detail=""):
    print("  [%s] %s%s" % ("PASS" if ok else "FAIL", label,
                           (" -- " + str(detail)) if detail else ""))
    if not ok:
        FAIL.append(label)


print("platform      :", sys.platform)
print("backend module:", glcontext.backend_for_platform())

try:
    ctx = glcontext.create_context(W, H)
except NoOffscreenGL as exc:
    print("NoOffscreenGL: %s" % exc)
    print("detail: %r" % (getattr(exc, "detail", {}),))
    for mod in ("egl", "wgl"):
        try:
            m = __import__("tenmol_bridge.glcontext." + mod, fromlist=[mod])
            print("%s.probe() = %s" % (mod, json.dumps(m.probe(), indent=2, default=str)))
        except Exception as e:
            print("%s.probe() unavailable: %s" % (mod, e))
    raise SystemExit(1)

info = ctx.info()
print(json.dumps(info, indent=2, default=str))

check("context created", True)
check("desktop GL (not GLES)", info.get("desktopGL", True), info.get("version"))
check("GL >= 2.0", not info.get("version", "").startswith("1."), info.get("version"))
check("FBO name is non-zero", ctx.fbo != 0, ctx.fbo)
check("8/8/8/8 colour bits (1-pass 32-bit pick index)",
      info["colorBits"] == [8, 8, 8, 8], info["colorBits"])
check("depth >= 24 bits", info["depthBits"] >= 24, info["depthBits"])
check("ARB framebuffer entry points",
      info.get("fboEntryPoints", "ARB") == "ARB", info.get("fboEntryPoints"))

gl = getattr(ctx, "gl", None)
if gl is None or gl.glClear is None or gl.glClearColor is None:
    print("  [SKIP] draw+readback (this backend does not expose .gl)")
else:
    def readback(w, h):
        gl.glClearColor(0.25, 0.5, 0.75, 1.0)
        gl.glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
        gl.glFinish()
        buf = (ctypes.c_ubyte * (w * h * 4))()
        gl.glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, ctypes.byref(buf))
        return list(buf[0:4]), int(gl.glGetError())

    px, err = readback(W, H)
    check("glReadPixels returns the cleared colour", px == [64, 128, 191, 255], px)
    check("glGetError == 0 after draw+readback", err == 0, hex(err))

    fbo_before = ctx.fbo
    ctx.resize(1280, 800)
    check("resize keeps the SAME FBO name (PyMOL latches it once)",
          ctx.fbo == fbo_before, "%s -> %s" % (fbo_before, ctx.fbo))
    check("resize applied", (ctx.width, ctx.height) == (1280, 800), (ctx.width, ctx.height))
    px, err = readback(1280, 800)
    check("readback still correct after resize", px == [64, 128, 191, 255], px)
    check("glGetError == 0 after resize", err == 0, hex(err))

ctx.make_current()
check("make_current is re-entrant", True)
ctx.release()
check("info() after release reports released", ctx.info().get("released") is True)
ctx.release()
check("release is idempotent", True)

print()
if FAIL:
    print("FAILED: %s" % ", ".join(FAIL))
    raise SystemExit(1)
print("ALL CHECKS PASSED")
```

### 6.2 Stage 2 (both platforms): PyMOL renders and PICKS through it

This is the real acceptance — it is spike 04 §3.2 ported to the platform-neutral API. A pick
returning a real atom name proves `SceneRender`'s body ran (`packages/engine/layer1/SceneRender.cpp:270`), which
is the entire point of having a context at all.

```python
"""Save as check_pymol_pick.py. Exit 0 = the platform is shippable."""
import sys, time
from tenmol_bridge import glcontext

W, H = 800, 600
ctx = glcontext.create_context(W, H)          # MUST come before PyMOL starts
print("GL:", ctx.info()["version"], "|", ctx.info()["renderer"])

import pymol
pymol.invocation.options.no_gui = 0            # -> HaveGUI = 1  (spike 04 §1)
import pymol2

p = pymol2.PyMOL()
p.invocation.options.no_gui = 0
p.start()
cmd = p.cmd
cmd.set("internal_gui", 0)
cmd.set("internal_feedback", 0)
p.reshape(W, H, 1)
for _ in range(5):                             # >= 3 to reach IDLE_AND_READY
    p.draw(); p.idle()
print("viewport:", cmd.get_viewport())

cmd.fab("AGCDEFG")
cmd.show("spheres")
cmd.show("sticks")
cmd.orient()
cmd.set("mouse_selection_mode", 0)
for _ in range(5):
    p.draw(); p.idle()


def pump(seconds):
    end = time.time() + seconds
    while time.time() < end:
        p.idle(); p.draw(); time.sleep(0.01)


hits = []
for x in range(120, W - 120, 60):
    for y in (H // 2 - 70, H // 2, H // 2 + 70):
        cmd.delete("sele")
        p._cmd._button(p._COb, 0, 0, x, y, 0)   # left, DOWN
        pump(0.03)
        p._cmd._button(p._COb, 0, 1, x, y, 0)   # left, UP
        pump(0.45)                              # > SingleClickDelay 0.15 s
        if "sele" in cmd.get_names("selections"):
            hits.append(((x, y), cmd.get_model("sele").atom[0].name))

print("clicks=%d  hits=%d  distinct atoms=%d"
      % (len(range(120, W - 120, 60)) * 3, len(hits), len({h[1] for h in hits})))
for h in hits[:10]:
    print("   ", h)

cmd.ray(400, 300)
cmd.png("/tmp/tenmol_gl_check.png", dpi=72)
pump(0.2)
print("ray+png OK")

ok = len(hits) >= 3 and len({h[1] for h in hits}) >= 3
p.stop()
ctx.release()
print("PICKING WORKS" if ok else "PICKING BROKEN")
raise SystemExit(0 if ok else 1)
```

### 6.3 Linux: DONE — one command, and it is automated

Superseded by `scripts/test-gl-linux.sh`, which is the §6.1 and §6.2 stages plus the
thread/display checks, in one file, with the assertions baked in. It runs anywhere:

```bash
# From any host with Docker/podman/nerdctl (this is how §2.8 was produced).
# Packs the tracked working tree, builds Debian + Mesa + PyMOL, runs the validator.
bash scripts/test-gl-linux.sh

# EGL only, no PyMOL build (~1 minute):
bash scripts/test-gl-linux.sh --quick

# On an actual Linux box with packages/bridge/.venv already built:
bash scripts/test-gl-linux.sh --native
```

Exit status is the validator's; every check prints `PASS`/`FAIL` with the measured value, and
the rendered PNGs land in `--out` (default `.tenmol-gl-out/`).

`.github/workflows/webclient-gl-linux.yml` runs the identical script on `ubuntu-latest`:
`egl-surfaceless` (matrix over ubuntu-22.04 and ubuntu-24.04, `--native --quick`, ~2 min) and
`egl-pymol` (bootstrap then `--native`, uploads the render as an artifact). Both were verified
locally by running the exact same invocations inside a Linux container before the workflow was
committed.

Prerequisites, if you are setting a machine up by hand rather than using the script:

```bash
# Debian / Ubuntu — this exact list is what the container installs
sudo apt-get install -y libegl1 libegl-mesa0 libgl1 libglx-mesa0 \
                        libgl1-mesa-dri libopengl0 libglvnd0
# RHEL / Fedora
sudo dnf install -y mesa-libEGL mesa-libGL mesa-dri-drivers

# diagnostics first, always; this never raises
python -c "from tenmol_bridge.glcontext import egl; import json; print(json.dumps(egl.probe(), indent=2))"
```

**Still worth running by hand, on hardware the container cannot provide:**

```bash
TENMOL_EGL_PLATFORM=device bash scripts/test-gl-linux.sh --native   # NVIDIA proprietary, headless
TENMOL_EGL_PLATFORM=surfaceless bash scripts/test-gl-linux.sh --native
ssh -T box "cd repo && bash scripts/test-gl-linux.sh --native"      # no seat, no session
```

**Report back** if any of those differ from §2.8: the `info()` JSON, which `eglPlatform` won,
whether `fboEntryPoints` was still `ARB`, and anything GLEW printed on stderr.

### 6.4 Windows: the manual procedure (NOT AUTOMATED, NOT RUN)

There is no `scripts/test-gl-windows.ps1` on purpose: writing an unrun automation script for an
unrun code path just adds a second unverified artefact. Do this by hand, once, on real Windows,
and then automate what you learned.

**What you need first.** A Windows 10/11 box with a **vendor GPU driver installed** (the whole
point of §3.2 is that Microsoft's fallback is not good enough), logged in **interactively** —
not a service, not a scheduled task. Then build the tree the way `.github/workflows/build.yml`
builds it on Windows (Miniforge, `catch2`/`freetype`/`glew`/`glm`/`libpng`/`libxml2-devel`/
`libnetcdf`, mmtf-cpp and msgpack-c headers copied into `%CONDA_PREFIX%\Library\include`, then
`pip install .`), and `pip install -e bridge`.

Save §6.1's script as `check_offscreen_gl.py` and §6.2's as `check_pymol_pick.py`. Note that
§6.2 loads a structure with `cmd.fab(...)`; if the `chempy` fragment data is missing in your
build, point it at `test\dat\1tii.pdb` instead — that is what the Linux run used.

Then, in order:

```powershell
# --- 0. is there an ICD? -------------------------------------------------
python -c "from tenmol_bridge.glcontext import wgl; import json; print(json.dumps(wgl.probe(), indent=2))"
# EXPECT: ok=True, opengl32=True

# --- 1. pure GL ----------------------------------------------------------
python check_offscreen_gl.py
# EXPECT: exit 0, "ALL CHECKS PASSED",
#         info.acceleration == "icd"          <-- NOT "gdi-generic"
#         info.renderer == the GPU name       <-- NOT "GDI Generic"
#         info.version >= "2.1"
#         info.pixelFormatFlags without bit 0x40 (PFD_GENERIC_FORMAT)

# --- 2. PyMOL end to end -------------------------------------------------
python check_pymol_pick.py
# EXPECT: exit 0, "PICKING WORKS"

# --- 3. the hard cases ---------------------------------------------------
#   a) over Remote Desktop (RDP switches the session's GPU stack)
mstsc /v:localhost      # then, in the RDP session:
python check_offscreen_gl.py
#      A "gdi-generic" failure HERE and a pass on the console is the expected,
#      documented behaviour. Record it; do not "fix" it by allowing GDI Generic.
#   b) from a non-interactive session (this is EXPECTED TO FAIL, prove it fails cleanly)
schtasks /create /tn tenmolgl /tr "python C:\path\check_offscreen_gl.py" /sc once /st 00:00 /ru SYSTEM
schtasks /run /tn tenmolgl
#      EXPECT reason='create-window-failed' -- a service has no window station.
#   c) ANGLE, for the record only
set TENMOL_WGL_BACKEND=angle
python check_offscreen_gl.py
#      EXPECT desktopGL=false and the "do not ship this path" warning.
set TENMOL_WGL_BACKEND=

# --- 4. 32-bit Python, if it is ever a target ----------------------------
#      This is the ONLY configuration where __stdcall vs cdecl can bite, and it
#      is now a REGRESSION TEST rather than a fishing trip: the cdecl bug was
#      real, was found in review, and is fixed by egl._functype() (§8.3).
#      Before that fix this line would have corrupted the stack inside
#      glGenFramebuffers; if it still misbehaves, _functype is not being used
#      on some path and that path is the bug.
py -3.12-32 check_offscreen_gl.py

# --- 5. record the answer ------------------------------------------------
python -c "from tenmol_bridge import glcontext; import json; c=glcontext.create_context(640,480); print(json.dumps(c.info(), indent=2)); c.release()" > docs\webclient\spikes\07-windows-result.json
```

**Report back — the checklist, in this order.** Anything that is not `PASS` is a finding, not a
nuisance; the Linux run found three real defects and they were all in the "surely this is fine"
category.

| # | check | expected | why it matters |
|---|---|---|---|
| 1 | `wgl.probe()` | `ok: True`, `opengl32: True`, `currentContext: False` | opengl32 loads and nothing is current yet |
| 2 | `info()["acceleration"]` | `"icd"` | `"gdi-generic"` means no vendor driver; **do not** relax the guard to make it pass |
| 3 | `info()["renderer"]` | the GPU name | `"GDI Generic"` is the failure this module exists to catch |
| 4 | `info()["pixelFormatFlags"]` | bit `0x40` (`PFD_GENERIC_FORMAT`) **clear** | this is the bit defect §4.2.1 could have hidden |
| 5 | `info()["fboEntryPoints"]` | `"ARB"` | `"EXT"` means `wglGetProcAddress` only found the old group; PyMOL binds with ARB |
| 6 | `info()["version"]`, `["glsl"]` | GL ≥ 2.1, GLSL present | below 2.0 `_create` refuses |
| 7 | FBO id across four resizes | identical every time | `packages/engine/layer5/PyMOL.cpp:2236-2239` latches it |
| 8 | `glReadPixels` after a known `glClearColor` | the exact byte quad | proves the FBO is really the draw target |
| 9 | stage 2: PyMOL draws | `glGetError() == 0`, image not blank | |
| 10 | stage 2: **picking** | ≥ 3 distinct atoms | the second GL consumer (§10) |
| 11 | stderr during stage 2 | GLEW quiet, `cmd.get("use_shaders") == "on"` | on Linux it was silent; Windows GLEW goes through `wglGetProcAddress` instead |
| 12 | two contexts, release one | the other still draws | this is defect D-EGL-1/2, ported blind to `wgl.py` |
| 13 | `release()` then process exit | no leaked HWND (`Get-Process`/handle count stable) | `DestroyWindow` thread affinity, §4.2.5 |
| 14 | RDP session | `gdi-generic` refusal is **correct** if it happens | record it; do not work around it |
| 15 | `SYSTEM` scheduled task | `reason='create-window-failed'` | a service has no window station; must fail *cleanly* |
| 16 | `TENMOL_WGL_BACKEND=angle` | `desktopGL: False` + the "do not ship" warning | diagnostic path only |
| 17 | 32-bit Python, if ever a target | identical to 64-bit | the only place `__stdcall` vs `cdecl` can bite — and it *did*: §8.3 was a real cdecl bug over the whole FBO group, fixed blind. This row now verifies that fix |

Paste the `info()` JSON verbatim into this file as §2.8's Windows twin, note the driver version,
and only then may §4.2 be rewritten.

---

## 7. Provenance of every constant

No value in either module was written from memory. Reproduce:

```bash
curl -sO https://registry.khronos.org/EGL/api/EGL/egl.h
curl -sO https://registry.khronos.org/EGL/api/EGL/eglext.h
curl -sO https://registry.khronos.org/OpenGL/api/GL/wglext.h
curl -sO https://registry.khronos.org/OpenGL/api/GL/glext.h
curl -sO https://raw.githubusercontent.com/KhronosGroup/OpenGL-Registry/main/xml/gl.xml
curl -sO https://raw.githubusercontent.com/mingw-w64/mingw-w64/master/mingw-w64-headers/include/wingdi.h
curl -sO https://raw.githubusercontent.com/mingw-w64/mingw-w64/master/mingw-w64-headers/include/winuser.h
curl -s -A Mozilla https://registry.khronos.org/EGL/extensions/MESA/EGL_MESA_platform_surfaceless.txt
curl -s -A Mozilla https://registry.khronos.org/EGL/extensions/EXT/EGL_EXT_platform_device.txt
```

| constant | value | source |
|---|---|---|
| `EGL_PLATFORM_SURFACELESS_MESA` | `0x31DD` | `eglext.h:1129` |
| `EGL_PLATFORM_DEVICE_EXT` | `0x313F` | `eglext.h:920` |
| `EGL_DRM_RENDER_NODE_FILE_EXT` | `0x3377` | `eglext.h:698` |
| `EGL_OPENGL_API` / `EGL_OPENGL_ES_API` | `0x30A2` / `0x30A0` | `egl.h:256,208` |
| `EGL_OPENGL_BIT` / `EGL_OPENGL_ES2_BIT` | `0x0008` / `0x0004` | `egl.h:257,238` |
| `EGL_CONTEXT_MAJOR_VERSION` / `MINOR` / `PROFILE_MASK` | `0x3098` / `0x30FB` / `0x30FD` | `egl.h:271-273` |
| `EGL_CONTEXT_OPENGL_{CORE,COMPATIBILITY}_PROFILE_BIT` | `1` / `2` | `egl.h:277-278` |
| `EGL_SURFACE_TYPE` / `EGL_PBUFFER_BIT` / `EGL_RENDERABLE_TYPE` | `0x3033` / `0x0001` / `0x3040` | `egl.h:95,86,212` |
| `EGL_WIDTH` / `EGL_HEIGHT` | `0x3057` / `0x3056` | `egl.h:104,71` |
| all `EGL_BAD_*` | `0x3001`-`0x300E` | `egl.h:48-59,82,163` |
| `GL_RED_BITS` … `GL_STENCIL_BITS` | `0x0D52`-`0x0D57` | `gl.xml` |
| `GL_FRAMEBUFFER` / `GL_RENDERBUFFER` | `0x8D40` / `0x8D41` | `glext.h:1044-1045` |
| `GL_COLOR_ATTACHMENT0` / `GL_DEPTH_ATTACHMENT` | `0x8CE0` / `0x8D00` | `glext.h:1010,1042` |
| `GL_FRAMEBUFFER_COMPLETE` | `0x8CD5` | `glext.h:1003` |
| `GL_FRAMEBUFFER_BINDING(_EXT)` | `0x8CA6` | `glext.h:7445` |
| `GL_RGBA8` / `GL_DEPTH_COMPONENT24` | `0x8058` / `0x81A6` | `glcorearb.h:375`, `glext.h:306` |
| `PFD_DOUBLEBUFFER` … `PFD_GENERIC_ACCELERATED` | `0x1`,`0x2`,`0x4`,`0x8`,`0x10`,`0x20`,`0x40`,`0x1000` | `wingdi.h:2823-2835` |
| `PFD_TYPE_RGBA` / `PFD_MAIN_PLANE` | `0` / `0` | `wingdi.h:2816,2819` |
| `CS_OWNDC` | `0x0020` | `winuser.h:1643` |
| `WS_POPUP` / `WS_VISIBLE` / `WS_CLIPSIBLINGS` / `WS_CLIPCHILDREN` | `0x80000000` / `0x10000000` / `0x04000000` / `0x02000000` | `winuser.h:1581,1584,1586,1587` |
| `PIXELFORMATDESCRIPTOR` layout | 26 fields, 40 bytes | `wingdi.h:2786-2814` |
| `WNDCLASSW` layout | 10 fields, 72 bytes (x64) | `winuser.h:931-942` |

`WGL_ARB_create_context` tokens were also read (`wglext.h:63-83`) but are **not used**: plain
`wglCreateContext` already yields the driver's highest compatibility profile, which is what PyMOL
wants, and using it avoids the two-context dance that `wglCreateContextAttribsARB` requires.

---

## 8. Residual risks

1. **libglvnd hides driver capability (Linux).** ~~highest risk~~ — **downgraded.** `dlsym(libGL.so.1,
   "glGenFramebuffers")` succeeds on any glvnd system regardless of the vendor driver, so the
   ARB-vs-EXT group choice is decided by glvnd. Measured on Mesa/glvnd in §2.8: the stubs and the
   driver agreed (`fboEntryPoints: ARB`, FBO complete, PyMOL rendered). The FBO-completeness check
   remains the backstop. Untested on a **non-glvnd** stack.
2. **GLEW flavour (Linux).** ~~could still fail~~ — **resolved for GLEW 2.2 on Mesa.** The built
   `_cmd*.so` links `libGLEW.so.2.2`, `libGLX.so.0` and `libX11.so.6`, and with `DISPLAY` unset a
   full start + load + draw wrote **nothing** to stderr and left `use_shaders` `on` (§2.8).
   `packages/engine/layer0/ShaderMgr.cpp:566-573` swallowing `GLEW_ERROR_NO_GLX_DISPLAY` is doing exactly its job.
   GLEW < 2.2 is still untested.
3. ~~**32-bit Windows calling convention.**~~ **BUG FOUND AND FIXED — this risk was real, and
   "`WinDLL` is used everywhere it matters" was wrong.** `WinDLL` gives `__stdcall` only to
   functions fetched as *DLL exports*. Both `GLFunctions._bind` and `_EGL._proc` build their
   pointers from a **raw address** returned by `wglGetProcAddress`/`eglGetProcAddress`, and a raw
   address carries no calling convention — they used `ctypes.CFUNCTYPE`, i.e. **cdecl**, while
   `gl.xml` declares every GL entry point `APIENTRY` and `eglplatform.h` declares every EGL one
   `EGLAPIENTRY`, both `__stdcall` on Windows. On x86-64 there is only one convention so this is
   a no-op (which is exactly why it survived review twice); on **32-bit x86 Windows** it corrupts
   the stack on every call. It covered the **entire framebuffer group**, because `opengl32.dll`
   exports only OpenGL 1.1 and everything else necessarily comes from `wglGetProcAddress`.
   Fixed by `egl._functype()`, which selects `WINFUNCTYPE` on Windows and `CFUNCTYPE` elsewhere.
   Still unverified on Windows like the rest of `wgl.py`, and still worth the `py -3.12-32` run
   in §6.4 step 4 — but the ABI reading is now correct rather than accidentally correct.
4. **Windows services have no window station.** `CreateWindowExW` fails. This is detected and
   reported with the right advice, but it means the Windows bridge, like the macOS one
   (spike 04 §7.3), must run as the logged-in user, not as a service.
5. **RDP degrades the GPU stack.** A machine that passes on the console may return GDI Generic
   over RDP. Detected, not worked around.
6. **Pbuffer size is fixed at creation and never resized.** Correct as long as nothing is ever
   drawn to the surface. If some future code path renders to the default framebuffer instead of
   the FBO, it will silently get the wrong size — do not add such a path.
7. ~~**`eglTerminate` is called in `release()`.**~~ **FIXED** — this prediction was correct and it
   was reproduced (`EGL_BAD_DISPLAY`) the first time two contexts existed. `egl.py` now
   reference-counts the display and only the last context terminates it. `wgl.py` has no
   equivalent (each context owns its own window/DC/HGLRC), but the *related* bug — deleting the
   FBO against a foreign current context — was ported blind. See §2.7 and §4.2.2.
8. ~~**No CI.**~~ **FIXED for Linux.** These tests turned out to need **no GPU and no DRI device
   at all**: Mesa's `EGL_MESA_platform_surfaceless` + llvmpipe is enough, which is what makes
   `.github/workflows/webclient-gl-linux.yml` possible on a stock `ubuntu-latest` runner.
   Windows still needs an interactive session with a vendor ICD and is still ungated; gate it the
   way spike 04 §8 asks for the macOS picking tests when a runner exists.
9. **llvmpipe is a software rasteriser, and the bridge cannot tell.** `info()["renderer"]` says
   `llvmpipe`, but nothing refuses it. On a headless server that is exactly right (it is the
   reason Linux works at all); on a workstation that was *supposed* to have a GPU it is a silent
   20× performance cliff — a 320×240 cartoon draw took **134 ms** here versus single-digit
   milliseconds on hardware. If Mode P frame budgets are ever missed on Linux, read
   `renderer` before anything else. Deliberately not made fatal: a slow bridge beats no bridge.
10. **Only one Mesa version and one architecture were tested** (22.3.6, arm64). The CI matrix
    (ubuntu-22.04 / ubuntu-24.04, x86-64) widens that on the next push and costs ~2 minutes.

---

## 9. Changes other owners must make (reported, not applied)

1. **WP-02 / `glcontext/cgl.py`** — add a `gl` property (or an equivalent accessor for
   `glClear`/`glClearColor`/`glReadPixels`) to `CGLContext` so §6.1 runs its draw+readback check
   on macOS too. It currently reports `[SKIP]`. Optionally also add the additive `info()` keys
   `api`/`desktopGL`/`fboEntryPoints`/`warnings` so all three backends return the same shape;
   `egl.py` and `wgl.py` already emit every key `cgl.py` does.
2. **WP-02 / `glcontext/cgl.py`** — `cgl.py` uses the `*EXT` framebuffer entry points, but PyMOL
   binds the default framebuffer with the ARB call `glBindFramebuffer`
   (`packages/engine/layer0/ShaderMgr.cpp:1829-1831`). On Apple's driver the namespaces are aliased so it works,
   and spike 04 proved it empirically — but consider switching to the ARB names for consistency
   with the other two backends.
3. **WP-00 / `scripts/doctor.mjs`** — its "GL context creation" preflight should call
   `tenmol_bridge.glcontext.create_context` and print `info()`, and on failure print
   `egl.probe()` / `wgl.probe()`. Those two functions exist precisely for it and never raise.
4. **WP-00 / `scripts/bootstrap.sh`** — on Linux, check for `libEGL.so.1` and `libGL.so.1` and
   print the `apt-get`/`dnf` line from §6.3 if missing. PyMOL's own build already needs
   `libglew-dev`.
5. **`03-implementation-plan.md:149` and `:1256-1257`** — "Linux (EGL surfaceless / GLX pbuffer)
   and Windows (WGL + hidden window) are a **separate spike**" and open question 2 are resolved:
   funded and implemented, pending hardware validation. Also `:746` and `:835` still say
   `glcontext.py`; it is a package, `glcontext/`, with four modules.
6. **`03-implementation-plan.md:841-842`** — "`glcontext.py` is platform-dispatched with only the
   CGL implementation present; other platforms raise a typed `NoOffscreenGL`" is superseded: all
   three implementations are present.
7. **`04-picking.md:600-601`** — the "Linux/Windows parity is a separate spike" bullet can point
   here.
8. ~~**WP-04 / `raster.py`**~~ — **DONE by WP-04.** `render/framestream.py:PixelReadback`
   already prefers `ctx.gl`; the Linux run confirms it (`PixelReadback source: context.gl`).
   `GLFunctions` has been given `glPixelStorei` and `glReadBuffer` so the two optional lookups
   `PixelReadback._resolve` makes now succeed on Linux and Windows instead of silently
   degrading.
9. **CI owner** — mark the platform tests with the existing `gl` pytest marker
   (`packages/bridge/pyproject.toml`), which already says "needs a real offscreen GL context".
10. **WP-02 / `glcontext/cgl.py`** — **check for defect D-EGL-2** (§2.7). If `CGLContext.release()`
    deletes its FBO/renderbuffers without first calling `CGLSetCurrentContext(self)`, it has the
    same bug: the deletes land in whatever context is current. Measured on EGL, fixed in `egl.py`
    and `wgl.py`; `cgl.py` is not mine to touch.
11. **WP-02 / `glcontext/__init__.py`** — the `Context` protocol should grow `is_current()` and
    `release_current()`. `egl.py` and `wgl.py` both have them now; they are what makes a
    thread hand-off legal (EGL returns `EGL_BAD_ACCESS` without them, measured), and callers
    should be able to rely on them existing.
12. **WP-00 / `scripts/bootstrap.sh:156-158`** — the Linux branch still prints *"offscreen GL on
    Linux (EGL surfaceless) is NOT implemented yet; the bridge will start but the viewport will
    be degraded"*. That is now false. It should check for `libEGL.so.1`/`libGL.so.1` and print
    the `apt-get`/`dnf` line from §6.3 if they are missing, and otherwise say nothing.
13. **WP-00 / `scripts/doctor.mjs`** — same as item 3, and it can now also suggest
    `bash scripts/test-gl-linux.sh --quick` when the Linux GL preflight fails.
14. **Screenshots owner** — `docs/screenshots/` has no Linux evidence. The artefact
    from `.github/workflows/webclient-gl-linux.yml` (`linux-egl-render`) or a local
    `.tenmol-gl-out/linux-egl-pymol.png` is a ready-made one.
15. **`.gitignore` owner** — add `/.tenmol-gl-out/`. That is `scripts/test-gl-linux.sh`'s default
    `--out` directory, and it is currently **not** ignored, so a developer who runs the script
    with defaults dirties the working tree with two PNGs. Verified: `git check-ignore -v
    .tenmol-gl-out` matches nothing, while `.deps` and `packages/bridge/.venv` are correctly ignored. CI
    is unaffected (the workflow passes `--out "$RUNNER_TEMP/gl-out"`), and so is the
    `egl-pymol` job's "the build did not dirty the tree" gate, which runs *before* the
    acceptance step. The script was left with its repo-local default on purpose — the images are
    the evidence and developers should find them — so the fix belongs in `.gitignore`, which is
    not this spike's file to edit.

---

## 10. Does the backend still need a GL context at all?

The wave's north star: if Mode G becomes complete and picking moves client-side, the backend
needs no GL context, and `egl.py`/`wgl.py` become optional rather than load-bearing. This
section answers "what would still break" with **measurements, not opinion**.

### 10.1 The experiment

The same script, the same structure (`packages/engine/test/dat/1tii.pdb`, 5,684 atoms, cartoon, 320×240), run
twice in the same Linux container:

* **GL** — `egl.create_context()` first, then `invocation.options.no_gui = 0` (⇒ `pmgui = 1` ⇒
  `G->HaveGUI = 1`, `packages/engine/layer5/PyMOL.cpp:2248`).
* **NO-GL** — no EGL context is created at all, `no_gui = 1` (⇒ `HaveGUI = 0`, which makes the
  entire body of `SceneRender` a no-op, `packages/engine/layer1/SceneRender.cpp:270`).

```
                 GL (EGL surfaceless)              NO-GL (no context, HaveGUI=0)
cmd.ray          0.311 s -> 19365 bytes            0.409 s -> 19365 bytes
cmd.png ray=0    41143 bytes                       57964 bytes
cmd.draw         no file produced                  57952 bytes
cmd.mpng         no frames produced                mov0001.png mov0002.png mov0003.png
pick (5 clicks)  5/5 selected a CA atom            0/5 — nothing selected, no error
stereo on/off    accepted                          accepted
glReadPixels     nonblack 25990/76800              n/a
```

### 10.2 What that means, feature by feature

| feature | needs GL? | evidence |
|---|---|---|
| **`cmd.ray`** | **No.** | Byte-identical output (19,365 bytes) with and without a context, and it is the *only* row that is identical. It is a CPU tracer; spike 00 measured 0.006 s for a trivial scene, this one is 0.3 s for 5,684 atoms. **This is the single most important fact for the GL-free plan.** |
| **`cmd.png` with `ray=0`** | **No — but it silently changes meaning.** With GL it is a 41 KB GL screenshot. Without GL it is a **57,964-byte file, byte-for-byte the size of the ray render of the same scene** — PyMOL quietly ray-traces instead. So it does not *break*; it becomes 1000× slower and stops being "what the screen shows". Anything that promises `ray=0` means "fast" is wrong on a GL-free backend. |
| **`cmd.draw`** | **No, and it is *better* without GL.** Measured inversion: with a GL context `cmd.draw(...)` + `cmd.png(f)` produced **no file at all** even after 200 pump iterations, while `cmd.draw()` + `cmd.png(f, ray=0)` produced 49,390 bytes. Without GL, `cmd.draw` produced a file directly (ray fallback). Whatever the bridge exposes for `draw`, it must be tested on both paths — the obvious call sequence works on exactly one of them. |
| **`cmd.mpng`** | **No.** 3/3 frames written on the GL-free path (ray fallback); 0 frames on the GL path with this call sequence, same caveat as `cmd.draw`. |
| **Backend picking** | **YES. This is the blocker.** 5/5 clicks selected an atom with EGL, **0/5 without**, and — worse — it fails *silently*: no exception, no error, `get_names('selections')` just stays empty. Root cause is not new (spike 04 §2, `packages/engine/layer1/SceneRender.cpp:270`); what is new is that it now reproduces on Linux under EGL exactly as it did on macOS under CGL. |
| **Mode P (server-rendered pixels)** | **YES, by definition.** It *is* `glReadPixels` on the FBO. If Mode G covers every rep, Mode P is unnecessary; until then it is the fallback and it needs a context. |
| **Stereo** | **Unresolved — and the test above proves nothing.** `cmd.stereo("on")` was *accepted* in both modes, so the setting is not a signal. Real quad-buffer stereo needs `PFD_STEREO` (Windows) or an `EGL`/`CGL` stereo pixel format; anaglyph/side-by-side are just extra GL draws. Nobody has rendered stereo through any of these three backends. Treat as unknown, not as working. |

### 10.3 The honest verdict

**A GL-free backend is reachable, and picking is the only real blocker.**

* Mode G completeness (defect D6) removes the *rendering* need for GL. `cmd.ray` covers
  high-quality stills with no context. `cmd.png`/`cmd.draw`/`cmd.mpng` all keep working via the
  ray fallback — slower, and with different semantics that must be documented, but not broken.
* Client-side picking (per-vertex pick data shipped with the geometry) removes the *last* need.
  Spike 04 §6 argues it is "strictly worse" and enumerates the cost — 16 rep-specific pick
  sources and all the click *actions*, not just selection. That argument stands; this section
  only establishes that it is the **only** thing standing between the product and a GL-free
  backend, and that everything else has been measured rather than assumed.
* Until both land, `egl.py` and `wgl.py` are **load-bearing on Linux and Windows**, and the
  silent-failure mode is the dangerous part: a Linux bridge with no `libEGL` starts fine, logs
  one line, renders nothing in Mode P and **picks nothing without ever raising**.

**What this work changes regardless of the north star:** Linux no longer needs EGL *hardware* —
it needs Mesa, which every distro ships and which needs no GPU, no DRI node and no X server.
That is a much cheaper dependency than "a GPU and a display server", and it is why the CI
workflow can exist at all. Windows is the platform that still genuinely requires a real vendor
ICD and an interactive session, and it is also the one still unverified.
