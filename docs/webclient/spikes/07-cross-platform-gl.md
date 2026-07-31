# Spike 07 — Cross-platform offscreen GL (Linux EGL, Windows WGL)

**Status: IMPLEMENTED, PARTIALLY VERIFIED. Linux and Windows code paths are written
against the real EGL/WGL ABIs and exercised through mock drivers; they have NOT been run on
Linux or Windows hardware.** Everything in §5 was executed on macOS and every transcript is
verbatim. §6 is the exact, copy-pasteable command a Linux box and a Windows box must run.

This closes the deferral in `03-implementation-plan.md:149` ("Linux (EGL surfaceless / GLX
pbuffer) and Windows (WGL + hidden window) are a **separate spike**") and in
`04-picking.md:600-601`. Product-owner decision 2: cross-platform offscreen GL is funded now.

Files delivered:

| file | owner | platform |
|---|---|---|
| `bridge/tenmol_bridge/glcontext/__init__.py` | WP-02 | dispatch |
| `bridge/tenmol_bridge/glcontext/cgl.py` | WP-02 | macOS — **working, hardware-verified** (spike 04) |
| `bridge/tenmol_bridge/glcontext/egl.py` | this spike | Linux / BSD |
| `bridge/tenmol_bridge/glcontext/wgl.py` | this spike | Windows |

---

## 0. TL;DR

| Question | Answer |
|---|---|
| Linux windowless desktop GL without X? | **Yes** — `eglGetPlatformDisplayEXT(EGL_PLATFORM_SURFACELESS_MESA)` on Mesa, `EGL_EXT_platform_device` + `eglQueryDevicesEXT` on NVIDIA headless. Both implemented, tried in that order, with `eglGetDisplay(EGL_DEFAULT_DISPLAY)` as a last resort. |
| Windows windowless desktop GL? | **No such thing.** `wglCreateContext` needs an `HDC` with a pixel format, and the only universally-accelerated one is a window's. We create a `CS_OWNDC` window that is **never shown** and render only into an FBO. |
| ANGLE on Windows? | **Implemented but must not ship.** It gives OpenGL **ES**, and PyMOL's Windows build calls `glewInit()` (`layer0/ShaderMgr.cpp:566`), which on Windows resolves through `wglGetProcAddress` and returns nothing when no WGL context is current. Reachable only via `TENMOL_WGL_BACKEND=angle`; `info()` reports `desktopGL: False`. |
| GLES-only Linux driver? | Detected and reported. `eglBindAPI(EGL_OPENGL_API)` failure ⇒ `NoOffscreenGL(reason="gles-only")`, or `api: "gles"` / `desktopGL: False` in `info()` under `allow_gles=True` / `TENMOL_ALLOW_GLES=1`. |
| EXT vs ARB framebuffer objects | `egl.py`/`wgl.py` **prefer the unsuffixed ARB/core entry points**, unlike `cgl.py`. PyMOL binds the default framebuffer with `glBindFramebuffer` + `GL_FRAMEBUFFER_BINDING` (`layer0/ShaderMgr.cpp:1829-1831`, `layer1/ScenePicking.cpp:64-81`, `layer5/PyMOL.cpp:2237`), i.e. ARB. Handing it an `EXT` framebuffer *name* is undefined on drivers that do not alias the two namespaces. `*EXT` is kept as a whole-group fallback. |
| Does PyMOL's GLEW cope with EGL (no GLX)? | **Yes, and it was already coded for.** `layer0/ShaderMgr.cpp:566-573` calls `glewInit()` and explicitly swallows `GLEW_ERROR_NO_GLX_DISPLAY` — the exact error GLEW ≥ 2.2 returns under an EGL context with no X display. |
| New C++ needed? | **None.** Same conclusion as spike 04. `setup.py` is untouched: Linux already links `-lGL -lGLEW` (`setup.py:736-739`), Windows already links `glew32` + `opengl32` (`setup.py:728-734`). No EGL, no OSMesa, no ANGLE is added to the build. |
| Verified on real Linux/Windows hardware? | **No.** See §4 for exactly what is and is not proven, and §6 for the acceptance command. |

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
   (`layer5/PyMOL.cpp:2236-2239`). `resize()` only re-`glRenderbufferStorage`s the attachments of
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
PyMOL's non-ES path calls `glPushMatrix`/`glPopMatrix` (`layer1/ScenePicking.cpp:283,306`) and
`glShadeModel` (`:234,272`), and links `-lGL` — GLES cannot run it. Two independent checks:
the `eglBindAPI` return, and `GL_VERSION` not starting with `"OpenGL ES"` (some drivers hand back
an ES context anyway). A GL version below 2.0 is also rejected (`reason="gl-too-old"`), because
that means a software fallback with no shader and usually no FBO support.

### 2.4 Config and context ladders

`eglChooseConfig` is retried with progressively weaker requests:
`8/8/8/8+D24+S8` → `+D24` → drop alpha → `D16` → don't-care. 8/8/8/8 matters: the FBO's `RGBA8`
colour renderbuffer is what `PickColorConverterSetRgbaBitsFromGL` (`layer1/ScenePicking.cpp:38-84`)
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

### 3.4 ANGLE

Implemented (`TENMOL_WGL_BACKEND=angle`, reusing `egl.py` with `egl_libs=("libEGL.dll",)`,
`gl_libs=("libGLESv2.dll",)`) purely so a Windows box can *diagnose* with it. It must not ship:
ANGLE gives OpenGL ES, and `glewInit()` (`layer0/ShaderMgr.cpp:566`) resolves through
`wglGetProcAddress` with no WGL context current, so it fails and `disableShaders(G)`
(`ShaderMgr.cpp:590-597`) runs. The context adds a `warnings[]` entry saying exactly this.

---

## 4. Honesty: what is and is not proven

**Proven, on this machine (macOS 15.6.1, arm64, Python 3.13.3) — transcripts in §5:**

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

**NOT proven — needs hardware:**

* That the **Windows calling convention** is honoured. Both sides of the mock harness are System V
  AMD64 on macOS. On x86-64 Windows this is very likely fine (uniform convention, and ctypes
  handles it), but on 32-bit Windows `__stdcall` vs `cdecl` genuinely differs — that is why every
  Win32 DLL is opened with `ctypes.WinDLL`, and why `egl.py` also uses `WinDLL` when
  `sys.platform` is Windows.
* That any real driver accepts these attribute lists, that surfaceless EGL exists on the target
  distro, that NVIDIA's `eglQueryDevicesEXT` enumerates anything, or that GLEW resolves under EGL.
* That PyMOL actually renders and **picks** through these contexts — spike 04's result is macOS
  only. §6.2 and §6.4 are the tests that settle it.
* `_load_gl()` does `dlsym` on `libGL.so.1` for the ARB framebuffer group. With libglvnd those
  symbols are always present as dispatch stubs regardless of what the vendor driver supports, so
  the ARB-vs-EXT group choice is decided by libglvnd, not by the driver. The FBO-completeness
  check immediately afterwards is the backstop, but on a non-glvnd stack this could behave
  differently. **Watch this one first if Linux misbehaves.**

---

## 5. What was executed here (verbatim)

Interpreter: `.../scratchpad/venv/bin/python` (Python 3.13.3, the venv PyMOL 3.2.0a0 is installed in).

### 5.1 Import, struct layout, and the failure paths

```
$ .../venv/bin/python -m py_compile bridge/tenmol_bridge/glcontext/egl.py bridge/tenmol_bridge/glcontext/wgl.py
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

## 6. THE VALIDATION COMMANDS — run these the moment hardware exists

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
returning a real atom name proves `SceneRender`'s body ran (`layer1/SceneRender.cpp:270`), which
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

### 6.3 Linux: exact commands

```bash
# --- prerequisites -------------------------------------------------------
# Debian / Ubuntu
sudo apt-get install -y libegl1 libgl1 libglew-dev mesa-utils
# with no GPU, add the software rasteriser (llvmpipe):
sudo apt-get install -y libgl1-mesa-dri
# RHEL / Fedora
sudo dnf install -y mesa-libEGL mesa-libGL glew-devel

# --- 0. is EGL even there? ----------------------------------------------
python -c "from tenmol_bridge.glcontext import egl; import json; print(json.dumps(egl.probe(), indent=2))"
# EXPECT: ok=True, clientExtensions containing EGL_MESA_platform_surfaceless
#         and/or EGL_EXT_platform_device, hasGetPlatformDisplayEXT=True,
#         libGL="libGL.so.1"

# --- 1. pure GL ----------------------------------------------------------
python check_offscreen_gl.py
# EXPECT: exit 0, "ALL CHECKS PASSED",
#         info.eglPlatform in {"surfaceless","device[N]"},
#         info.desktopGL == true, info.api == "gl",
#         info.renderer NOT "llvmpipe" on a GPU box,
#         info.fboEntryPoints == "ARB"

# --- 2. PyMOL end to end -------------------------------------------------
python check_pymol_pick.py
# EXPECT: exit 0, "PICKING WORKS", >= 3 distinct atoms, ray+png OK

# --- 3. the hard cases ---------------------------------------------------
env -u DISPLAY -u WAYLAND_DISPLAY python check_pymol_pick.py     # no display server at all
ssh -T localhost "cd $PWD && python check_pymol_pick.py"          # no session, no seat
TENMOL_EGL_PLATFORM=device python check_offscreen_gl.py           # NVIDIA proprietary path
TENMOL_EGL_PLATFORM=surfaceless python check_offscreen_gl.py      # Mesa path
LIBGL_ALWAYS_SOFTWARE=1 python check_offscreen_gl.py              # llvmpipe fallback still OK?
docker run --rm -v $PWD:/w -w /w python:3.12 bash -c \
  "apt-get update -qq && apt-get install -y -qq libegl1 libgl1 libgl1-mesa-dri && python check_offscreen_gl.py"

# --- 4. record the answer ------------------------------------------------
python -c "from tenmol_bridge import glcontext; import json; c=glcontext.create_context(640,480); print(json.dumps(c.info(), indent=2)); c.release()" \
  | tee docs/webclient/spikes/07-linux-result.json
```

**Report back:** the `info()` JSON, which `eglPlatform` won, whether `fboEntryPoints` was `ARB`,
the distinct-atom count from stage 2, and whether GLEW emitted
`GLEW-Error: Unknown error` / `No GLX display` on stderr.

### 6.4 Windows: exact commands

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
#      This is the ONLY configuration where __stdcall vs cdecl can bite.
py -3.12-32 check_offscreen_gl.py

# --- 5. record the answer ------------------------------------------------
python -c "from tenmol_bridge import glcontext; import json; c=glcontext.create_context(640,480); print(json.dumps(c.info(), indent=2)); c.release()" > docs\webclient\spikes\07-windows-result.json
```

**Report back:** the `info()` JSON, `acceleration`, whether stage 2 picked, the RDP result, and
whether 32-bit Python (if tested) behaved identically.

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

1. **libglvnd hides driver capability (Linux, highest risk).** `dlsym(libGL.so.1,
   "glGenFramebuffers")` succeeds on any glvnd system regardless of the vendor driver, so the
   ARB-vs-EXT group choice is decided by glvnd. The FBO-completeness check is the backstop.
2. **GLEW flavour (Linux).** Distro `libGLEW.so` is normally the GLX flavour and links `libGL`.
   With an EGL context current, `glXGetProcAddressARB` still returns valid pointers on
   Mesa/libglvnd, which is why this works in practice. `layer0/ShaderMgr.cpp:566-573` already
   swallows `GLEW_ERROR_NO_GLX_DISPLAY` (GLEW ≥ 2.2). On GLEW < 2.2 with a hostile stack this
   could still fail — the stage-2 test's stderr is where it will show.
3. **32-bit Windows calling convention.** Untested and untestable here. `WinDLL` is used
   everywhere it matters; verify with `py -3.12-32` if 32-bit is ever a target.
4. **Windows services have no window station.** `CreateWindowExW` fails. This is detected and
   reported with the right advice, but it means the Windows bridge, like the macOS one
   (spike 04 §7.3), must run as the logged-in user, not as a service.
5. **RDP degrades the GPU stack.** A machine that passes on the console may return GDI Generic
   over RDP. Detected, not worked around.
6. **Pbuffer size is fixed at creation and never resized.** Correct as long as nothing is ever
   drawn to the surface. If some future code path renders to the default framebuffer instead of
   the FBO, it will silently get the wrong size — do not add such a path.
7. **`eglTerminate` is called in `release()`.** If two contexts are ever created on the same
   `EGLDisplay` in one process, terminating one invalidates the other. The bridge creates exactly
   one; if that ever changes, refcount the display.
8. **No CI.** These tests need a GPU (or at least a DRI device) and, on Windows, an interactive
   session. Gate them exactly the way spike 04 §8 asks for the macOS picking tests.

---

## 9. Changes other owners must make (reported, not applied)

1. **WP-02 / `glcontext/cgl.py`** — add a `gl` property (or an equivalent accessor for
   `glClear`/`glClearColor`/`glReadPixels`) to `CGLContext` so §6.1 runs its draw+readback check
   on macOS too. It currently reports `[SKIP]`. Optionally also add the additive `info()` keys
   `api`/`desktopGL`/`fboEntryPoints`/`warnings` so all three backends return the same shape;
   `egl.py` and `wgl.py` already emit every key `cgl.py` does.
2. **WP-02 / `glcontext/cgl.py`** — `cgl.py` uses the `*EXT` framebuffer entry points, but PyMOL
   binds the default framebuffer with the ARB call `glBindFramebuffer`
   (`layer0/ShaderMgr.cpp:1829-1831`). On Apple's driver the namespaces are aliased so it works,
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
8. **WP-04 / `raster.py`** — read back through `ctx.gl.glReadPixels` rather than dlopening GL
   again, so Mode P shares one dispatch table with the context on all three platforms. `GL_RGBA`
   and `GL_UNSIGNED_BYTE` are exported from `glcontext.egl`.
9. **CI owner** — mark the platform tests with the existing `gl` pytest marker
   (`bridge/pyproject.toml`), which already says "needs a real offscreen GL context".
