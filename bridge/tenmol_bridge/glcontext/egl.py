"""Linux offscreen GL: EGL surfaceless (Mesa) or device-platform (NVIDIA) + one FBO.

This is the Linux twin of :mod:`tenmol_bridge.glcontext.cgl`.  It provides the
same thing CGL provides on macOS and that spike 04 proved PyMOL needs: a
**current, hardware, desktop-OpenGL context** with **one FBO bound before
PyMOL's first draw**, colour + depth attachments, and a working ``glReadPixels``.

Why EGL and not GLX
-------------------
GLX needs an X server.  The stated deployment model is a local desktop
replacement, but the same bridge has to work over ``ssh``, in a container and on
a headless workstation, so we go straight to the windowless path.  Two are
implemented, tried in this order (override with ``TENMOL_EGL_PLATFORM``):

1. ``EGL_MESA_platform_surfaceless`` — ``eglGetPlatformDisplayEXT(0x31DD,
   EGL_DEFAULT_DISPLAY, NULL)``.  Mesa only (llvmpipe, i965/iris, radeonsi,
   zink...).  Needs no DRM node and no X.  The spec says pbuffers are allowed
   if a config advertises ``EGL_PBUFFER_BIT``, and window/pixmap surfaces always
   fail — we render to an FBO, so neither matters.
2. ``EGL_EXT_platform_device`` — ``eglQueryDevicesEXT`` then
   ``eglGetPlatformDisplayEXT(0x313F, device, NULL)``.  This is the NVIDIA
   headless path (proprietary driver, no X, no DRM master needed).
3. ``eglGetDisplay(EGL_DEFAULT_DISPLAY)`` — last resort; on Mesa this resolves
   to X11/Wayland/GBM depending on the environment, so it only works when a
   display server is actually reachable.

Desktop GL, not GLES
--------------------
PyMOL's non-ES build calls ``glPushMatrix``/``glPopMatrix``
(``layer1/ScenePicking.cpp:283,306``) and ``glShadeModel`` (``:234,272``), and
``setup.py:736-739`` links ``-lGL -lGLEW``.  A GLES context cannot run it.  So
we ``eglBindAPI(EGL_OPENGL_API)`` and require ``EGL_OPENGL_BIT`` in
``EGL_RENDERABLE_TYPE``.  If the driver only offers GLES (common with ANGLE,
some ARM SoC stacks, and Mesa builds configured ``-Dgles-only``) we raise
:class:`~tenmol_bridge.errors.NoOffscreenGL` with ``reason="gles-only"`` — and,
if the caller passes ``allow_gles=True`` (or sets ``TENMOL_ALLOW_GLES=1``), we
create the GLES context anyway and report ``"api": "gles"`` /
``"desktopGL": False`` from :meth:`EGLContext.info` so the failure is legible
instead of a mystery segfault later.

EXT vs ARB framebuffer objects
------------------------------
Unlike ``cgl.py`` (which uses the ``*EXT`` entry points, as spike 04 did) this
module **prefers the unsuffixed ARB/core entry points**, because that is what
PyMOL itself calls: ``layer0/ShaderMgr.cpp:1829-1831`` and
``layer1/ScenePicking.cpp:64-81`` use ``glBindFramebuffer`` /
``GL_FRAMEBUFFER_BINDING``, resolved through GLEW to
``ARB_framebuffer_object``.  On Apple's GL the two object namespaces are
aliased so it makes no difference; on some Linux drivers they are not, and
handing PyMOL an ``EXT`` framebuffer name to bind with the ARB call is
undefined.  ``*EXT`` is kept as a fallback for pre-GL-3.0 drivers.

Constants in this file were taken from the Khronos registry, not from memory:
``EGL/egl.h``, ``EGL/eglext.h``, ``xml/gl.xml``.  See
``docs/webclient/spikes/07-cross-platform-gl.md`` §"Provenance".

Status
------
**EXECUTED AND VERIFIED ON LINUX.**  Ran in a ``debian:bookworm-slim`` container
(linux/arm64, no GPU, no ``/dev/dri``, no X) with Mesa 22.3.6: the surfaceless
platform gave a desktop **OpenGL 4.5 (Compatibility Profile)** llvmpipe context,
FBO id 1, ``glReadPixels`` returned the cleared colour, and a real PyMOL draw of
``test/dat/1tii.pdb`` (5,684 atoms, cartoon) rendered a non-blank image through
it -- 13,578 of 76,800 pixels non-black at 320x240 -- while the backend pick
pass selected a CA atom on 3 of 3 clicks.  Three defects found
by that run are fixed here: ``eglTerminate`` is now reference-counted per
``EGLDisplay`` (it is a process-global singleton and is *not* refcounted by the
driver), and cross-thread hand-off now has an explicit
:meth:`EGLContext.release_current`, because EGL -- unlike WGL -- refuses
``eglMakeCurrent`` with ``EGL_BAD_ACCESS`` while another thread holds the
context.  Full transcript: ``docs/webclient/spikes/07-cross-platform-gl.md``
§2.7 (the defects) and §2.8 (the run); §2.9 is an independent re-run by a second
session that was told to distrust this notice, and reproduced it.
Reproduce with ``bash scripts/test-gl-linux.sh``.

Note that :func:`_functype` -- the ``__stdcall`` fix -- is a **Windows** concern
living in this module only because ``wgl.py`` shares :class:`GLFunctions`.  It is
a no-op here; see §8.3.
"""

from __future__ import annotations

import ctypes
import os
import sys
import threading
from ctypes import POINTER, byref, c_char_p, c_int, c_ssize_t, c_uint, c_void_p
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

try:
    from ..errors import NoOffscreenGL
except ImportError:  # pragma: no cover - bridge-core owns errors.py

    class NoOffscreenGL(RuntimeError):  # type: ignore[no-redef]
        """Local fallback; see :mod:`tenmol_bridge.errors`."""

        kind = "NoOffscreenGL"

        def __init__(self, message: str, **detail: Any) -> None:
            super().__init__(message)
            self.detail: Dict[str, Any] = detail


__all__ = [
    "EGLContext",
    "create_context",
    "GLFunctions",
    "GLFramebuffer",
    "probe",
]

# ---------------------------------------------------------------------------
# EGL enums.  Source: https://registry.khronos.org/EGL/api/EGL/egl.h and
# .../EGL/eglext.h (downloaded and grepped; line numbers in the spike doc).
# ---------------------------------------------------------------------------

EGL_FALSE = 0
EGL_TRUE = 1
EGL_NONE = 0x3038
EGL_DEFAULT_DISPLAY = 0  # EGL_CAST(EGLNativeDisplayType, 0)

EGL_SUCCESS = 0x3000
EGL_NOT_INITIALIZED = 0x3001
EGL_BAD_ACCESS = 0x3002
EGL_BAD_ALLOC = 0x3003
EGL_BAD_ATTRIBUTE = 0x3004
EGL_BAD_CONFIG = 0x3005
EGL_BAD_CONTEXT = 0x3006
EGL_BAD_CURRENT_SURFACE = 0x3007
EGL_BAD_DISPLAY = 0x3008
EGL_BAD_MATCH = 0x3009
EGL_BAD_NATIVE_PIXMAP = 0x300A
EGL_BAD_NATIVE_WINDOW = 0x300B
EGL_BAD_PARAMETER = 0x300C
EGL_BAD_SURFACE = 0x300D
EGL_CONTEXT_LOST = 0x300E

EGL_ERROR_NAMES = {
    EGL_SUCCESS: "EGL_SUCCESS",
    EGL_NOT_INITIALIZED: "EGL_NOT_INITIALIZED",
    EGL_BAD_ACCESS: "EGL_BAD_ACCESS",
    EGL_BAD_ALLOC: "EGL_BAD_ALLOC",
    EGL_BAD_ATTRIBUTE: "EGL_BAD_ATTRIBUTE",
    EGL_BAD_CONFIG: "EGL_BAD_CONFIG",
    EGL_BAD_CONTEXT: "EGL_BAD_CONTEXT",
    EGL_BAD_CURRENT_SURFACE: "EGL_BAD_CURRENT_SURFACE",
    EGL_BAD_DISPLAY: "EGL_BAD_DISPLAY",
    EGL_BAD_MATCH: "EGL_BAD_MATCH",
    EGL_BAD_NATIVE_PIXMAP: "EGL_BAD_NATIVE_PIXMAP",
    EGL_BAD_NATIVE_WINDOW: "EGL_BAD_NATIVE_WINDOW",
    EGL_BAD_PARAMETER: "EGL_BAD_PARAMETER",
    EGL_BAD_SURFACE: "EGL_BAD_SURFACE",
    EGL_CONTEXT_LOST: "EGL_CONTEXT_LOST",
}

EGL_ALPHA_SIZE = 0x3021
EGL_BLUE_SIZE = 0x3022
EGL_GREEN_SIZE = 0x3023
EGL_RED_SIZE = 0x3024
EGL_DEPTH_SIZE = 0x3025
EGL_STENCIL_SIZE = 0x3026
EGL_CONFIG_ID = 0x3028
EGL_SURFACE_TYPE = 0x3033
EGL_RENDERABLE_TYPE = 0x3040
EGL_PBUFFER_BIT = 0x0001
EGL_OPENGL_ES2_BIT = 0x0004
EGL_OPENGL_BIT = 0x0008

EGL_VENDOR = 0x3053
EGL_VERSION = 0x3054
EGL_EXTENSIONS = 0x3055
EGL_CLIENT_APIS = 0x308D

EGL_HEIGHT = 0x3056
EGL_WIDTH = 0x3057

EGL_OPENGL_ES_API = 0x30A0
EGL_OPENGL_API = 0x30A2

EGL_CONTEXT_MAJOR_VERSION = 0x3098
EGL_CONTEXT_MINOR_VERSION = 0x30FB
EGL_CONTEXT_OPENGL_PROFILE_MASK = 0x30FD
EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT = 0x00000001
EGL_CONTEXT_OPENGL_COMPATIBILITY_PROFILE_BIT = 0x00000002

# eglext.h
EGL_PLATFORM_DEVICE_EXT = 0x313F
EGL_PLATFORM_SURFACELESS_MESA = 0x31DD
EGL_PLATFORM_GBM_KHR = 0x31D7
EGL_PLATFORM_X11_KHR = 0x31D5
EGL_DRM_DEVICE_FILE_EXT = 0x3233
EGL_DRM_RENDER_NODE_FILE_EXT = 0x3377

# ---------------------------------------------------------------------------
# GL enums.  Source: Khronos OpenGL-Registry xml/gl.xml + GL/glext.h.
# ---------------------------------------------------------------------------

GL_NO_ERROR = 0
GL_VENDOR = 0x1F00
GL_RENDERER = 0x1F01
GL_VERSION = 0x1F02
GL_EXTENSIONS = 0x1F03
GL_SHADING_LANGUAGE_VERSION = 0x8B8C
GL_NUM_EXTENSIONS = 0x821D

GL_RED_BITS = 0x0D52
GL_GREEN_BITS = 0x0D53
GL_BLUE_BITS = 0x0D54
GL_ALPHA_BITS = 0x0D55
GL_DEPTH_BITS = 0x0D56
GL_STENCIL_BITS = 0x0D57

GL_DEPTH_BUFFER_BIT = 0x00000100
GL_COLOR_BUFFER_BIT = 0x00004000

GL_RGBA = 0x1908
GL_RGBA8 = 0x8058
GL_UNSIGNED_BYTE = 0x1401
GL_DEPTH_COMPONENT24 = 0x81A6
GL_DEPTH24_STENCIL8 = 0x88F0

# ARB/core and EXT share numeric values for every token we use.
GL_FRAMEBUFFER = 0x8D40
GL_RENDERBUFFER = 0x8D41
GL_COLOR_ATTACHMENT0 = 0x8CE0
GL_DEPTH_ATTACHMENT = 0x8D00
GL_STENCIL_ATTACHMENT = 0x8D20
GL_DEPTH_STENCIL_ATTACHMENT = 0x821A
GL_FRAMEBUFFER_COMPLETE = 0x8CD5
GL_FRAMEBUFFER_BINDING = 0x8CA6
GL_MAX_RENDERBUFFER_SIZE = 0x84E8

GL_FRAMEBUFFER_STATUS_NAMES = {
    0x8CD5: "GL_FRAMEBUFFER_COMPLETE",
    0x8CD6: "GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT",
    0x8CD7: "GL_FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT",
    0x8CD9: "GL_FRAMEBUFFER_INCOMPLETE_DIMENSIONS",
    0x8CDA: "GL_FRAMEBUFFER_INCOMPLETE_FORMATS",
    0x8CDB: "GL_FRAMEBUFFER_INCOMPLETE_DRAW_BUFFER",
    0x8CDC: "GL_FRAMEBUFFER_INCOMPLETE_READ_BUFFER",
    0x8CDD: "GL_FRAMEBUFFER_UNSUPPORTED",
    0x8D56: "GL_FRAMEBUFFER_INCOMPLETE_MULTISAMPLE",
}

#: Tried in order.  ``libGL.so.1`` first *on purpose*: that is the SONAME
#: PyMOL's ``_cmd`` extension links (``setup.py:736-739``), so loading it makes
#: us share one dispatch table with the engine.  ``libOpenGL.so.0`` is the
#: libglvnd "desktop GL only" library and is the modern spelling.
GL_LIB_NAMES: Tuple[str, ...] = ("libGL.so.1", "libGL.so", "libOpenGL.so.0")
EGL_LIB_NAMES: Tuple[str, ...] = ("libEGL.so.1", "libEGL.so")

_load_lock = threading.Lock()
_egl_singletons: Dict[str, "_EGL"] = {}

#: ``EGLDisplay`` pointer value -> number of live :class:`EGLContext` objects.
#:
#: EGL displays are **process-global singletons**: ``eglGetPlatformDisplayEXT``
#: with the same platform+native display returns the same ``EGLDisplay`` to
#: every caller, and ``eglTerminate`` does *not* reference-count -- the EGL 1.5
#: spec says it marks *all* resources associated with the display for deletion.
#: So a naive ``release()`` that always terminates kills every other context on
#: the same display.  Measured on Mesa 22.3.6 / llvmpipe (Debian bookworm,
#: container): with two contexts open, ``a.release()`` made ``b.make_current()``
#: fail with ``EGL_BAD_DISPLAY``.  See spikes/07-cross-platform-gl.md §3.4.
_display_refs: Dict[int, int] = {}
_display_lock = threading.Lock()


def _display_retain(dpy: c_void_p) -> int:
    key = int(dpy.value or 0)
    with _display_lock:
        _display_refs[key] = _display_refs.get(key, 0) + 1
        return key


def _display_release(key: int) -> bool:
    """Drop one reference; True when the caller must ``eglTerminate``."""
    with _display_lock:
        n = _display_refs.get(key, 0) - 1
        if n > 0:
            _display_refs[key] = n
            return False
        _display_refs.pop(key, None)
        return True


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _attrib_list(pairs: Sequence[int]) -> Any:
    """Build a NULL(``EGL_NONE``)-terminated ``EGLint[]``."""
    values = list(pairs) + [EGL_NONE]
    return (c_int * len(values))(*values)


def _egl_error_name(code: int) -> str:
    return EGL_ERROR_NAMES.get(code, "0x%04X" % code)


def _fail(message: str, **detail: Any) -> "NoOffscreenGL":
    detail.setdefault("platform", sys.platform)
    detail.setdefault("backend", "egl")
    return NoOffscreenGL(message, **detail)


def _functype(restype: Any, *argtypes: Any) -> Any:
    """``WINFUNCTYPE`` on Windows, ``CFUNCTYPE`` everywhere else.

    Calling convention, not cosmetics.  ``gl.xml`` declares every GL entry point
    ``APIENTRY``, and ``eglplatform.h`` declares every EGL one ``EGLAPIENTRY``;
    both expand to ``__stdcall`` on Windows.  On **x86-64 there is only one**
    convention, so ``CFUNCTYPE`` and ``WINFUNCTYPE`` are identical and the
    distinction is invisible -- which is exactly why this is easy to get wrong.
    On **32-bit x86 Windows** they differ in who pops the arguments, so calling a
    ``__stdcall`` function through a ``cdecl`` pointer corrupts the stack on
    every single call.

    This matters for :meth:`GLFunctions._bind` and :meth:`_EGL._proc` and *only*
    for them: functions taken straight off a ``WinDLL`` already get ``__stdcall``
    from ctypes, but these two build their pointers from a raw address returned
    by ``wglGetProcAddress`` / ``eglGetProcAddress``, and a raw address carries
    no convention with it.  Since that is precisely how the whole framebuffer
    group is resolved on Windows (``opengl32.dll`` exports only OpenGL 1.1), a
    cdecl pointer here would break every ``glGenFramebuffers`` /
    ``glBindFramebuffer`` call on win32.

    UNVERIFIED on Windows like the rest of :mod:`wgl` -- but it is the correct
    reading of the ABI, and it is a no-op on the x64 builds PyMOL actually ships.
    """
    factory = ctypes.CFUNCTYPE
    if _is_win():
        # Looked up, not referenced: ctypes.WINFUNCTYPE does not exist
        # off-Windows, so a mis-reported sys.platform degrades to cdecl (which
        # is correct on every non-Windows platform) instead of AttributeError.
        factory = getattr(ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE)
    return factory(restype, *argtypes)


# ---------------------------------------------------------------------------
# Shared GL plumbing (imported by wgl.py too - it is API-agnostic)
# ---------------------------------------------------------------------------


class GLFunctions:
    """Desktop-GL entry points resolved through a caller-supplied loader.

    ``loader(name) -> int | None`` returns the address of a GL function, or
    ``None``.  On Linux that is ``dlsym(libGL)`` then ``eglGetProcAddress``.

    On Windows the order is the other way round -- ``GetProcAddress(opengl32)``
    **first**, ``wglGetProcAddress`` second (:meth:`wgl.WGLContext._gl_loader`).
    That is not a style choice: ``wglGetProcAddress`` is documented to return
    NULL for OpenGL 1.1 entry points, which is every name in :data:`_CORE`, and
    ``opengl32.dll`` exports *only* OpenGL 1.1, which is none of the names in
    :data:`_FBO_GROUP`.  The two sources are disjoint, so each name is found by
    exactly one of them either way -- but querying the DLL first is the order
    that never asks a function for something it is specified to refuse.

    The framebuffer entry points are resolved as an all-or-nothing *group*:
    ARB/core first, ``EXT`` only if the whole ARB group is missing.  Mixing
    ``glGenFramebuffersEXT`` with ``glBindFramebuffer`` is undefined - the two
    extensions have separate object namespaces on drivers that do not alias
    them.
    """

    #: (attribute, C name, restype, argtypes)
    _CORE = (
        ("glGetString", "glGetString", c_char_p, (c_uint,)),
        ("glGetIntegerv", "glGetIntegerv", None, (c_uint, POINTER(c_int))),
        ("glGetError", "glGetError", c_uint, ()),
        ("glViewport", "glViewport", None, (c_int, c_int, c_int, c_int)),
        ("glFinish", "glFinish", None, ()),
        (
            "glReadPixels",
            "glReadPixels",
            None,
            (c_int, c_int, c_int, c_int, c_uint, c_uint, c_void_p),
        ),
    )

    _FBO_GROUP = (
        ("glGenFramebuffers", None, (c_int, POINTER(c_uint))),
        ("glDeleteFramebuffers", None, (c_int, POINTER(c_uint))),
        ("glBindFramebuffer", None, (c_uint, c_uint)),
        ("glCheckFramebufferStatus", c_uint, (c_uint,)),
        ("glGenRenderbuffers", None, (c_int, POINTER(c_uint))),
        ("glDeleteRenderbuffers", None, (c_int, POINTER(c_uint))),
        ("glBindRenderbuffer", None, (c_uint, c_uint)),
        ("glRenderbufferStorage", None, (c_uint, c_uint, c_int, c_int)),
        ("glFramebufferRenderbuffer", None, (c_uint, c_uint, c_uint, c_uint)),
    )

    def __init__(self, loader: Callable[[str], Optional[int]]) -> None:
        self._loader = loader
        self.fbo_suffix = ""
        missing: List[str] = []

        for attr, cname, restype, argtypes in self._CORE:
            fn = self._bind(cname, restype, argtypes)
            if fn is None:
                missing.append(cname)
            setattr(self, attr, fn)
        if missing:
            raise _fail(
                "core GL entry points not resolvable: %s" % ", ".join(missing),
                reason="gl-symbols-missing",
                missing=missing,
            )

        for suffix in ("", "EXT"):
            bound = {}
            for name, restype, argtypes in self._FBO_GROUP:
                fn = self._bind(name + suffix, restype, argtypes)
                if fn is None:
                    bound = {}
                    break
                bound[name] = fn
            if bound:
                self.fbo_suffix = suffix
                for name, fn in bound.items():
                    setattr(self, name, fn)
                break
        else:
            raise _fail(
                "neither ARB_framebuffer_object nor EXT_framebuffer_object "
                "entry points are available; PyMOL cannot render offscreen",
                reason="no-fbo",
            )

        # Optional extras.  glGetStringi only exists on GL 3.0+; glClear /
        # glClearColor are GL 1.0 and are here so the platform validation
        # scripts in docs/webclient/spikes/07-cross-platform-gl.md can prove
        # "render then glReadPixels" without booting PyMOL.
        self.glGetStringi = self._bind("glGetStringi", c_char_p, (c_uint, c_uint))
        # render/framestream.py:PixelReadback looks these two up on ctx.gl and
        # degrades silently when they are missing; supplying them lets Mode P
        # pin GL_PACK_ALIGNMENT and read GL_COLOR_ATTACHMENT0 explicitly instead
        # of trusting the driver default.
        self.glPixelStorei = self._bind("glPixelStorei", None, (c_uint, c_int))
        self.glReadBuffer = self._bind("glReadBuffer", None, (c_uint,))
        self.glClear = self._bind("glClear", None, (c_uint,))
        self.glClearColor = self._bind(
            "glClearColor",
            None,
            (ctypes.c_float, ctypes.c_float, ctypes.c_float, ctypes.c_float),
        )

    def _bind(self, name: str, restype: Any, argtypes: Any) -> Any:
        addr = self._loader(name)
        if not addr:
            return None
        proto = _functype(restype, *argtypes)
        return proto(addr)

    # -- convenience --------------------------------------------------------

    def get_string(self, enum: int) -> str:
        raw = self.glGetString(enum)
        return raw.decode("utf-8", "replace") if raw else ""

    def get_int(self, enum: int) -> int:
        out = c_int(0)
        self.glGetIntegerv(enum, byref(out))
        return int(out.value)

    def gl_version_tuple(self) -> Tuple[int, int]:
        """``(major, minor)`` parsed from ``GL_VERSION``; ``(0, 0)`` if unparsable.

        Handles both ``"4.6.0 NVIDIA 550.54"`` and ``"OpenGL ES 3.2 Mesa"``.
        """
        text = self.get_string(GL_VERSION)
        for token in text.replace("-", " ").split():
            head = token.split(".")
            if len(head) >= 2 and head[0].isdigit() and head[1].isdigit():
                return int(head[0]), int(head[1])
        return (0, 0)

    def is_gles(self) -> bool:
        return self.get_string(GL_VERSION).startswith("OpenGL ES")

    def extension_count(self) -> int:
        try:
            n = self.get_int(GL_NUM_EXTENSIONS)
        except Exception:  # noqa: BLE001
            n = 0
        if n:
            self.glGetError()
            return n
        self.glGetError()  # swallow GL_INVALID_ENUM on a 2.1 context
        text = self.get_string(GL_EXTENSIONS)
        return len(text.split()) if text else 0


class GLFramebuffer:
    """One FBO with colour + depth renderbuffers, resized in place.

    The FBO *name* is created once and never regenerated, because
    ``check_gl_stereo_capable`` latches ``GL_FRAMEBUFFER_BINDING`` into
    ``G->ShaderMgr->defaultBackbuffer.framebuffer`` on PyMOL's first draw
    (``layer5/PyMOL.cpp:2236-2239``).  Spike 04 §4 verified this on macOS.
    """

    def __init__(
        self,
        gl: GLFunctions,
        width: int,
        height: int,
        backend: str = "egl",
        depth_format: int = GL_DEPTH_COMPONENT24,
    ) -> None:
        self._gl = gl
        self._backend = backend
        self._depth_format = depth_format
        self.width = int(width)
        self.height = int(height)

        fbo = c_uint()
        gl.glGenFramebuffers(1, byref(fbo))
        self.fbo = int(fbo.value)
        gl.glBindFramebuffer(GL_FRAMEBUFFER, self.fbo)

        color = c_uint()
        depth = c_uint()
        gl.glGenRenderbuffers(1, byref(color))
        gl.glGenRenderbuffers(1, byref(depth))
        self.color_rb = int(color.value)
        self.depth_rb = int(depth.value)

        # Allocate before attaching: glGenRenderbuffers only reserves a name,
        # the object does not exist until its first glBindRenderbuffer.  Same
        # trap cgl.py documents.
        self._storage(self.width, self.height, check=False)
        gl.glFramebufferRenderbuffer(
            GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, self.color_rb
        )
        gl.glFramebufferRenderbuffer(
            GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, self.depth_rb
        )
        self._storage(self.width, self.height)

    def bind(self) -> None:
        self._gl.glBindFramebuffer(GL_FRAMEBUFFER, self.fbo)
        self._gl.glViewport(0, 0, self.width, self.height)

    def resize(self, width: int, height: int) -> None:
        width = max(1, int(width))
        height = max(1, int(height))
        if (width, height) == (self.width, self.height):
            return
        self._storage(width, height)

    def destroy(self) -> None:
        gl = self._gl
        try:
            if self.color_rb:
                gl.glDeleteRenderbuffers(1, byref(c_uint(self.color_rb)))
            if self.depth_rb:
                gl.glDeleteRenderbuffers(1, byref(c_uint(self.depth_rb)))
            if self.fbo:
                gl.glDeleteFramebuffers(1, byref(c_uint(self.fbo)))
        except Exception:  # noqa: BLE001 - teardown must never raise
            pass
        self.color_rb = self.depth_rb = self.fbo = 0

    def _storage(self, width: int, height: int, check: bool = True) -> None:
        gl = self._gl
        gl.glBindFramebuffer(GL_FRAMEBUFFER, self.fbo)
        for rb, fmt in ((self.color_rb, GL_RGBA8), (self.depth_rb, self._depth_format)):
            gl.glBindRenderbuffer(GL_RENDERBUFFER, rb)
            gl.glRenderbufferStorage(GL_RENDERBUFFER, fmt, width, height)
        if check:
            status = int(gl.glCheckFramebufferStatus(GL_FRAMEBUFFER))
            if status != GL_FRAMEBUFFER_COMPLETE:
                raise _fail(
                    "FBO incomplete at %dx%d: %s (0x%X)"
                    % (
                        width,
                        height,
                        GL_FRAMEBUFFER_STATUS_NAMES.get(status, "?"),
                        status,
                    ),
                    backend=self._backend,
                    reason="fbo-incomplete",
                    status=status,
                )
        self.width, self.height = width, height
        gl.glViewport(0, 0, width, height)


# ---------------------------------------------------------------------------
# libEGL binding
# ---------------------------------------------------------------------------


class _EGL:
    """``ctypes`` prototypes for the EGL 1.4/1.5 core + the extensions we use."""

    def __init__(self, lib: ctypes.CDLL, lib_name: str) -> None:
        self.lib = lib
        self.lib_name = lib_name
        d = lib

        def sig(name: str, restype: Any, argtypes: Any) -> Any:
            fn = getattr(d, name)
            fn.restype = restype
            fn.argtypes = argtypes
            return fn

        # EGLDisplay / EGLConfig / EGLSurface / EGLContext are all void*.
        self.eglGetError = sig("eglGetError", c_int, ())
        self.eglGetDisplay = sig("eglGetDisplay", c_void_p, (c_void_p,))
        self.eglInitialize = sig(
            "eglInitialize", c_uint, (c_void_p, POINTER(c_int), POINTER(c_int))
        )
        self.eglTerminate = sig("eglTerminate", c_uint, (c_void_p,))
        self.eglQueryString = sig("eglQueryString", c_char_p, (c_void_p, c_int))
        self.eglBindAPI = sig("eglBindAPI", c_uint, (c_uint,))
        self.eglChooseConfig = sig(
            "eglChooseConfig",
            c_uint,
            (c_void_p, POINTER(c_int), POINTER(c_void_p), c_int, POINTER(c_int)),
        )
        self.eglGetConfigAttrib = sig(
            "eglGetConfigAttrib", c_uint, (c_void_p, c_void_p, c_int, POINTER(c_int))
        )
        self.eglCreateContext = sig(
            "eglCreateContext", c_void_p, (c_void_p, c_void_p, c_void_p, POINTER(c_int))
        )
        self.eglDestroyContext = sig("eglDestroyContext", c_uint, (c_void_p, c_void_p))
        self.eglCreatePbufferSurface = sig(
            "eglCreatePbufferSurface", c_void_p, (c_void_p, c_void_p, POINTER(c_int))
        )
        self.eglDestroySurface = sig("eglDestroySurface", c_uint, (c_void_p, c_void_p))
        self.eglMakeCurrent = sig(
            "eglMakeCurrent", c_uint, (c_void_p, c_void_p, c_void_p, c_void_p)
        )
        self.eglGetCurrentContext = sig("eglGetCurrentContext", c_void_p, ())
        self.eglReleaseThread = sig("eglReleaseThread", c_uint, ())
        self.eglGetProcAddress = sig("eglGetProcAddress", c_void_p, (c_char_p,))

        # EGL 1.5 core; may be absent on a 1.4 libEGL.
        self.eglGetPlatformDisplay = None
        if hasattr(d, "eglGetPlatformDisplay"):
            self.eglGetPlatformDisplay = sig(
                "eglGetPlatformDisplay",
                c_void_p,
                (c_uint, c_void_p, POINTER(c_ssize_t)),  # EGLAttrib == intptr_t
            )

        # EGL_EXT_platform_base.  NOTE the attrib type differs from the 1.5
        # core call: EXT takes ``const EGLint *`` (eglext.h:912), core takes
        # ``const EGLAttrib *`` (egl.h:331).  Passing the wrong one is a silent
        # ABI bug on 64-bit, so they are separate prototypes here.
        self.eglGetPlatformDisplayEXT = self._proc(
            "eglGetPlatformDisplayEXT", c_void_p, (c_uint, c_void_p, POINTER(c_int))
        )
        # EGL_EXT_device_enumeration / EGL_EXT_device_query
        self.eglQueryDevicesEXT = self._proc(
            "eglQueryDevicesEXT", c_uint, (c_int, POINTER(c_void_p), POINTER(c_int))
        )
        self.eglQueryDeviceStringEXT = self._proc(
            "eglQueryDeviceStringEXT", c_char_p, (c_void_p, c_int)
        )

    def _proc(self, name: str, restype: Any, argtypes: Any) -> Any:
        addr = self.eglGetProcAddress(name.encode("ascii"))
        if not addr:
            return None
        return _functype(restype, *argtypes)(addr)

    # -- helpers ------------------------------------------------------------

    def client_extensions(self) -> List[str]:
        """``EGL_EXTENSIONS`` of ``EGL_NO_DISPLAY`` (EGL_EXT_client_extensions).

        Returns ``[]`` when the implementation predates that extension, which
        is itself the signal that no platform extensions are available.
        """
        raw = self.eglQueryString(None, EGL_EXTENSIONS)
        return raw.decode("ascii", "replace").split() if raw else []

    def display_extensions(self, dpy: c_void_p) -> List[str]:
        raw = self.eglQueryString(dpy, EGL_EXTENSIONS)
        return raw.decode("ascii", "replace").split() if raw else []

    def query(self, dpy: Optional[c_void_p], enum: int) -> str:
        raw = self.eglQueryString(dpy, enum)
        return raw.decode("utf-8", "replace") if raw else ""


def _is_win() -> bool:
    return sys.platform.startswith("win") or sys.platform == "cygwin"


def _dll(name: str) -> ctypes.CDLL:
    """``WinDLL`` on Windows (EGLAPIENTRY is ``__stdcall`` on x86), else ``CDLL``.

    ``ctypes.WinDLL`` does not exist off-Windows, so it is looked up
    defensively rather than referenced: that keeps a mis-reported
    ``sys.platform`` a typed ``NoOffscreenGL`` instead of an ``AttributeError``.
    """
    windll = getattr(ctypes, "WinDLL", None)
    if _is_win() and windll is not None:
        return windll(name)
    return ctypes.CDLL(name)


def _load_egl(names: Optional[Sequence[str]] = None) -> _EGL:
    """Load and bind libEGL.  ``names`` overrides the default search order.

    ``wgl.py`` passes ``("libEGL.dll",)`` for the ANGLE diagnostic path.
    """
    if names is None:
        override = os.environ.get("TENMOL_EGL_LIB", "").strip()
        names = (override,) if override else EGL_LIB_NAMES
    names = tuple(names)
    key = "\x00".join(names)
    with _load_lock:
        cached = _egl_singletons.get(key)
        if cached is not None:
            return cached
        errors: List[str] = []
        for name in names:
            try:
                lib = _dll(name)
            except OSError as exc:
                errors.append("%s: %s" % (name, exc))
                continue
            try:
                bound = _EGL(lib, name)
            except AttributeError as exc:
                errors.append("%s: missing EGL core symbol (%s)" % (name, exc))
                continue
            _egl_singletons[key] = bound
            return bound
        raise _fail(
            "cannot load libEGL (%s). On Debian/Ubuntu install "
            "'libegl1'; on RHEL/Fedora 'mesa-libEGL'. Tried: %s"
            % (sys.platform, "; ".join(errors) or "nothing"),
            reason="libegl-missing",
            tried=list(names),
            errors=errors,
        )


def _load_gl(names: Optional[Sequence[str]] = None) -> ctypes.CDLL:
    if names is None:
        override = os.environ.get("TENMOL_GL_LIB", "").strip()
        names = (override,) if override else GL_LIB_NAMES
    names = tuple(names)
    errors: List[str] = []
    for name in names:
        try:
            if _is_win():
                return _dll(name)
            # RTLD_GLOBAL so that a later dlopen of PyMOL's _cmd extension
            # resolves against the very same libGL we just probed.
            return ctypes.CDLL(name, mode=ctypes.RTLD_GLOBAL)
        except OSError as exc:
            errors.append("%s: %s" % (name, exc))
    raise _fail(
        "cannot load libGL (tried %s). PyMOL links -lGL (setup.py:736-739), so "
        "this is required even though EGL loaded. Errors: %s"
        % (", ".join(names), "; ".join(errors)),
        reason="libgl-missing",
        tried=list(names),
        errors=errors,
    )


# ---------------------------------------------------------------------------
# Display selection
# ---------------------------------------------------------------------------


def _enumerate_devices(egl: _EGL) -> List[c_void_p]:
    if egl.eglQueryDevicesEXT is None:
        return []
    n = c_int(0)
    if not egl.eglQueryDevicesEXT(0, None, byref(n)) or n.value <= 0:
        return []
    buf = (c_void_p * n.value)()
    got = c_int(0)
    if not egl.eglQueryDevicesEXT(n.value, buf, byref(got)):
        return []
    return [c_void_p(buf[i]) for i in range(got.value)]


def _device_label(egl: _EGL, device: c_void_p) -> str:
    if egl.eglQueryDeviceStringEXT is None:
        return "?"
    for enum in (EGL_DRM_RENDER_NODE_FILE_EXT, EGL_DRM_DEVICE_FILE_EXT, EGL_VENDOR):
        raw = egl.eglQueryDeviceStringEXT(device, enum)
        if raw:
            return raw.decode("utf-8", "replace")
    return "?"


def _open_display(egl: _EGL, wanted: str = "") -> Tuple[c_void_p, str, str, Tuple[int, int]]:
    """Return ``(display, platform_name, device_label, (egl_major, egl_minor))``.

    Tries surfaceless, then device, then the legacy default display.  Every
    candidate is ``eglInitialize``d; the first one that initialises wins.
    """
    client_exts = egl.client_extensions()
    tried: List[str] = []

    def try_display(dpy_ptr: Any, label: str, device_label: str = "") -> Optional[Tuple]:
        if not dpy_ptr:
            tried.append("%s: eglGetPlatformDisplay -> EGL_NO_DISPLAY (%s)"
                         % (label, _egl_error_name(egl.eglGetError())))
            return None
        dpy = c_void_p(dpy_ptr)
        major, minor = c_int(0), c_int(0)
        if not egl.eglInitialize(dpy, byref(major), byref(minor)):
            tried.append("%s: eglInitialize failed (%s)"
                         % (label, _egl_error_name(egl.eglGetError())))
            return None
        return (dpy, label, device_label, (int(major.value), int(minor.value)))

    order: List[str]
    if wanted:
        order = [wanted]
    else:
        order = ["surfaceless", "device", "default"]

    for kind in order:
        if kind == "surfaceless":
            if egl.eglGetPlatformDisplayEXT is None:
                tried.append("surfaceless: no eglGetPlatformDisplayEXT")
                continue
            if "EGL_MESA_platform_surfaceless" not in client_exts and not wanted:
                tried.append("surfaceless: EGL_MESA_platform_surfaceless not advertised")
                continue
            got = try_display(
                egl.eglGetPlatformDisplayEXT(
                    EGL_PLATFORM_SURFACELESS_MESA, c_void_p(EGL_DEFAULT_DISPLAY), None
                ),
                "surfaceless",
            )
            if got:
                return got

        elif kind == "device":
            if egl.eglGetPlatformDisplayEXT is None:
                tried.append("device: no eglGetPlatformDisplayEXT")
                continue
            if "EGL_EXT_platform_device" not in client_exts and not wanted:
                tried.append("device: EGL_EXT_platform_device not advertised")
                continue
            devices = _enumerate_devices(egl)
            if not devices:
                tried.append("device: eglQueryDevicesEXT returned no devices")
                continue
            indexed = list(enumerate(devices))
            want_index = os.environ.get("TENMOL_EGL_DEVICE", "").strip()
            if want_index.isdigit():
                idx = int(want_index)
                indexed = [p for p in indexed if p[0] == idx]
                if not indexed:
                    tried.append(
                        "device: TENMOL_EGL_DEVICE=%d out of range (%d devices)"
                        % (idx, len(devices))
                    )
                    continue
            for i, dev in indexed:
                label = _device_label(egl, dev)
                got = try_display(
                    egl.eglGetPlatformDisplayEXT(EGL_PLATFORM_DEVICE_EXT, dev, None),
                    "device[%d]" % i,
                    label,
                )
                if got:
                    return got

        elif kind == "default":
            got = try_display(
                egl.eglGetDisplay(c_void_p(EGL_DEFAULT_DISPLAY)), "default"
            )
            if got:
                return got

        else:
            tried.append("%s: unknown platform name" % kind)

    raise _fail(
        "no usable EGL display. Tried: %s. Client extensions: %s"
        % ("; ".join(tried) or "nothing", " ".join(client_exts) or "(none)"),
        reason="no-egl-display",
        tried=tried,
        clientExtensions=client_exts,
    )


def _choose_config(
    egl: _EGL, dpy: c_void_p, renderable: int
) -> Tuple[c_void_p, Dict[str, int]]:
    """Pick an 8/8/8/8 + depth config, relaxing the request until one matches."""
    ladders = (
        (8, 8, 8, 8, 24, 8),
        (8, 8, 8, 8, 24, 0),
        (8, 8, 8, 0, 24, 0),
        (8, 8, 8, 8, 16, 0),
        (0, 0, 0, 0, 0, 0),
    )
    for r, g, b, a, depth, stencil in ladders:
        attrs = [
            EGL_SURFACE_TYPE,
            EGL_PBUFFER_BIT,
            EGL_RENDERABLE_TYPE,
            renderable,
            EGL_RED_SIZE,
            r,
            EGL_GREEN_SIZE,
            g,
            EGL_BLUE_SIZE,
            b,
            EGL_ALPHA_SIZE,
            a,
            EGL_DEPTH_SIZE,
            depth,
            EGL_STENCIL_SIZE,
            stencil,
        ]
        configs = (c_void_p * 1)()
        n = c_int(0)
        ok = egl.eglChooseConfig(
            dpy, _attrib_list(attrs), configs, 1, byref(n)
        )
        if ok and n.value > 0 and configs[0]:
            cfg = c_void_p(configs[0])
            got = {}
            for key, enum in (
                ("red", EGL_RED_SIZE),
                ("green", EGL_GREEN_SIZE),
                ("blue", EGL_BLUE_SIZE),
                ("alpha", EGL_ALPHA_SIZE),
                ("depth", EGL_DEPTH_SIZE),
                ("stencil", EGL_STENCIL_SIZE),
                ("id", EGL_CONFIG_ID),
            ):
                out = c_int(0)
                if egl.eglGetConfigAttrib(dpy, cfg, enum, byref(out)):
                    got[key] = int(out.value)
            return cfg, got
    raise _fail(
        "eglChooseConfig found no config with EGL_RENDERABLE_TYPE=0x%X and "
        "EGL_PBUFFER_BIT (last EGL error %s)"
        % (renderable, _egl_error_name(egl.eglGetError())),
        reason="no-egl-config",
        renderableType=renderable,
    )


# ---------------------------------------------------------------------------
# The context
# ---------------------------------------------------------------------------


class EGLContext:
    """A windowless EGL context owning exactly one FBO.

    Thread affinity is **stricter than CGL's**, and this was measured, not
    assumed (Mesa 22.3.6/llvmpipe, spikes/07-cross-platform-gl.md §3.4):

    * ``eglMakeCurrent`` binds to the calling thread, so construct on the
      engine thread.
    * A *second* thread calling :meth:`make_current` while the first still
      holds the context gets ``EGL_BAD_ACCESS``.  There is no "steal"; the
      owning thread must call :meth:`release_current` first.  (``wglMakeCurrent``
      documents the same one-thread-at-a-time rule, so this is not an EGL
      quirk to route around -- but only the EGL half is measured.  Keep PyMOL
      pinned to one thread and it never bites.)
    * :meth:`release` unbinds before destroying, and only ``eglTerminate``s the
      display when it is the last context on it (see :data:`_display_refs`).
    """

    backend = "egl"

    def __init__(
        self,
        width: int,
        height: int,
        allow_gles: bool = False,
        platform_name: str = "",
        egl_libs: Optional[Sequence[str]] = None,
        gl_libs: Optional[Sequence[str]] = None,
        backend_name: str = "egl",
    ) -> None:
        self.backend = backend_name
        self.width = max(1, int(width))
        self.height = max(1, int(height))
        self.fbo = 0
        self.owner_thread = threading.get_ident()
        self.warnings: List[str] = []

        self._released = False
        self._dpy: Optional[c_void_p] = None
        self._ctx: Optional[c_void_p] = None
        self._surface: Optional[c_void_p] = None
        self._cfg: Optional[c_void_p] = None
        self._fb: Optional[GLFramebuffer] = None
        self._gl: Optional[GLFunctions] = None

        allow_gles = bool(allow_gles) or _env_flag("TENMOL_ALLOW_GLES")
        platform_name = (
            platform_name or os.environ.get("TENMOL_EGL_PLATFORM", "").strip()
        )

        egl = _load_egl(egl_libs)
        self._egl = egl
        self._gl_lib = _load_gl(gl_libs)

        self._dpy_key: Optional[int] = None

        dpy, plat, device_label, egl_version = _open_display(egl, platform_name)
        self._dpy = dpy
        # Retain BEFORE anything can throw, so the release() in the except
        # block below balances exactly one reference.
        self._dpy_key = _display_retain(dpy)
        self.platform_name = plat
        self.device_label = device_label
        self.egl_version = egl_version
        self.egl_vendor = egl.query(dpy, EGL_VENDOR)
        self.egl_version_string = egl.query(dpy, EGL_VERSION)
        self.display_extensions = egl.display_extensions(dpy)
        self.client_apis = egl.query(dpy, EGL_CLIENT_APIS)

        try:
            self._create(allow_gles)
        except BaseException:
            self.release()
            raise

    # -- construction -------------------------------------------------------

    def _create(self, allow_gles: bool) -> None:
        egl, dpy = self._egl, self._dpy

        desktop = bool(egl.eglBindAPI(EGL_OPENGL_API))
        if not desktop:
            egl.eglGetError()
        self.api = "gl" if desktop else "gles"

        if not desktop:
            message = (
                "this EGL implementation has no OpenGL (desktop) API - "
                "eglBindAPI(EGL_OPENGL_API) failed and EGL_CLIENT_APIS is %r. "
                "PyMOL's non-ES build calls glPushMatrix/glShadeModel "
                "(layer1/ScenePicking.cpp:283,306,234,272) and links -lGL "
                "(setup.py:736-739), so GLES cannot run it."
                % (self.client_apis or "?")
            )
            if not allow_gles:
                raise _fail(
                    message,
                    reason="gles-only",
                    clientApis=self.client_apis,
                    eglVendor=self.egl_vendor,
                )
            self.warnings.append(message)
            if not egl.eglBindAPI(EGL_OPENGL_ES_API):
                raise _fail(
                    "eglBindAPI failed for both OpenGL and OpenGL ES (%s)"
                    % _egl_error_name(egl.eglGetError()),
                    reason="no-client-api",
                )

        renderable = EGL_OPENGL_BIT if desktop else EGL_OPENGL_ES2_BIT
        self._cfg, self.config_attribs = _choose_config(egl, dpy, renderable)

        # Context-attribute ladder.  The FIRST entry is empty on purpose: the
        # EGL default is MAJOR=1/MINOR=0, and for the OpenGL API that means
        # "any context compatible with GL 1.0", i.e. the driver's highest
        # COMPATIBILITY profile.  That is exactly what PyMOL wants, and it is
        # what a plain wglCreateContext gives on Windows too.
        if desktop:
            ladder: Tuple[Tuple[int, ...], ...] = (
                (),
                (EGL_CONTEXT_MAJOR_VERSION, 2, EGL_CONTEXT_MINOR_VERSION, 1),
                (
                    EGL_CONTEXT_MAJOR_VERSION,
                    3,
                    EGL_CONTEXT_MINOR_VERSION,
                    2,
                    EGL_CONTEXT_OPENGL_PROFILE_MASK,
                    EGL_CONTEXT_OPENGL_COMPATIBILITY_PROFILE_BIT,
                ),
            )
        else:
            ladder = ((EGL_CONTEXT_MAJOR_VERSION, 2),)

        last_err = EGL_SUCCESS
        for attrs in ladder:
            ptr = egl.eglCreateContext(
                dpy, self._cfg, None, _attrib_list(attrs)
            )
            if ptr:
                self._ctx = c_void_p(ptr)
                self.context_attribs = list(attrs)
                break
            last_err = egl.eglGetError()
        else:
            raise _fail(
                "eglCreateContext failed for every attribute set (last error %s)"
                % _egl_error_name(last_err),
                reason="no-egl-context",
            )

        # A pbuffer is not strictly needed (we draw to an FBO) but drivers
        # without EGL_KHR_surfaceless_context refuse eglMakeCurrent with
        # EGL_NO_SURFACE.  Try the pbuffer first, fall back to surfaceless.
        ptr = egl.eglCreatePbufferSurface(
            dpy,
            self._cfg,
            _attrib_list([EGL_WIDTH, self.width, EGL_HEIGHT, self.height]),
        )
        if ptr:
            self._surface = c_void_p(ptr)
            self.surface_kind = "pbuffer"
        else:
            err = egl.eglGetError()
            self._surface = None
            self.surface_kind = "none"
            has_surfaceless = (
                "EGL_KHR_surfaceless_context" in self.display_extensions
                or self.egl_version >= (1, 5)
            )
            if not has_surfaceless:
                raise _fail(
                    "eglCreatePbufferSurface failed (%s) and this EGL is %d.%d "
                    "without EGL_KHR_surfaceless_context, so there is no way "
                    "to make a context current"
                    % (_egl_error_name(err), self.egl_version[0], self.egl_version[1]),
                    reason="no-egl-surface",
                )
            self.warnings.append(
                "no pbuffer (%s); using a surfaceless context"
                % _egl_error_name(err)
            )

        self.make_current()

        self._gl = GLFunctions(self._gl_loader)
        gl = self._gl
        self.gl_version = gl.gl_version_tuple()
        if gl.is_gles() and not allow_gles:
            raise _fail(
                "the EGL driver gave us an OpenGL ES context (%r) despite "
                "eglBindAPI(EGL_OPENGL_API) succeeding; PyMOL needs desktop GL"
                % gl.get_string(GL_VERSION),
                reason="gles-only",
                glVersion=gl.get_string(GL_VERSION),
            )
        if self.gl_version < (2, 0):
            raise _fail(
                "OpenGL %d.%d is too old for PyMOL's shader path (%r, renderer "
                "%r). Expect GL >= 2.0; a 1.x version usually means a software "
                "fallback or a missing driver."
                % (
                    self.gl_version[0],
                    self.gl_version[1],
                    gl.get_string(GL_VERSION),
                    gl.get_string(GL_RENDERER),
                ),
                reason="gl-too-old",
                glVersion=gl.get_string(GL_VERSION),
                renderer=gl.get_string(GL_RENDERER),
            )
        if gl.fbo_suffix == "EXT":
            self.warnings.append(
                "only EXT_framebuffer_object is available; PyMOL binds with "
                "the ARB entry points (layer0/ShaderMgr.cpp:1829), which may "
                "reject an EXT framebuffer name on some drivers"
            )

        self._fb = GLFramebuffer(gl, self.width, self.height, backend=self.backend)
        self.fbo = self._fb.fbo
        self._fb.bind()

    def _gl_loader(self, name: str) -> Optional[int]:
        """dlsym(libGL) first, eglGetProcAddress second.

        Order matters: libglvnd's ``libGL.so.1`` exports real, context-agnostic
        stubs, whereas ``eglGetProcAddress`` is only guaranteed to return core
        GL functions when ``EGL_KHR_get_all_proc_addresses`` is present.
        """
        try:
            fn = getattr(self._gl_lib, name)
        except AttributeError:
            fn = None
        if fn is not None:
            addr = ctypes.cast(fn, c_void_p).value
            if addr:
                return int(addr)
        addr2 = self._egl.eglGetProcAddress(name.encode("ascii"))
        return int(addr2) if addr2 else None

    # -- Context protocol ---------------------------------------------------

    def is_current(self) -> bool:
        """True if this context is current on the **calling** thread.

        ``eglGetCurrentContext`` is per-thread, so this returns False on a
        thread that does not hold the context even while another thread does.
        """
        if self._released or self._ctx is None:
            return False
        cur = self._egl.eglGetCurrentContext()
        return bool(cur) and int(cur) == int(self._ctx.value or 0)

    def make_current(self) -> None:
        self._assert_live()
        if self.is_current():
            # Already ours on this thread.  Re-binding is legal but pointless,
            # and skipping it keeps the per-frame path free of a driver call.
            self.owner_thread = threading.get_ident()
            if self._fb is not None:
                self._fb.bind()
            return
        surf = self._surface  # None == EGL_NO_SURFACE
        if not self._egl.eglMakeCurrent(self._dpy, surf, surf, self._ctx):
            err = self._egl.eglGetError()
            hint = ""
            if err == EGL_BAD_ACCESS:
                # Reproduced on Mesa 22.3.6/llvmpipe: binding from thread B
                # while thread A still holds it gives EGL_BAD_ACCESS.  The EGL
                # spec requires the *owning* thread to unbind first; unlike
                # wglMakeCurrent there is no way for B to steal it.
                hint = (
                    " -- this context is still current on thread %s. EGL "
                    "forbids stealing a context from another thread: the "
                    "owning thread must call release_current() first."
                    % self.owner_thread
                )
            raise _fail(
                "eglMakeCurrent failed: %s%s" % (_egl_error_name(err), hint),
                reason="make-current-failed",
                eglError=_egl_error_name(err),
                ownerThread=self.owner_thread,
            )
        self.owner_thread = threading.get_ident()
        if self._fb is not None:
            self._fb.bind()

    def release_current(self) -> bool:
        """Unbind this context from the **calling** thread.

        Required before another thread may :meth:`make_current` it -- see the
        ``EGL_BAD_ACCESS`` note there.  Safe to call when nothing is current.
        Returns True if the unbind call succeeded.
        """
        if self._released or self._dpy is None:
            return False
        ok = bool(self._egl.eglMakeCurrent(self._dpy, None, None, None))
        if not ok:
            self._egl.eglGetError()  # swallow, this is a best-effort unbind
        return ok

    def resize(self, width: int, height: int) -> None:
        """Re-storage the SAME FBO. Never regenerate it (see package docstring).

        The pbuffer surface is deliberately *not* resized: nothing is ever
        drawn to it, PyMOL's default framebuffer is our FBO.
        """
        self._assert_live()
        if self._fb is None:
            return
        self._fb.resize(width, height)
        self.width, self.height = self._fb.width, self._fb.height

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        egl = getattr(self, "_egl", None)
        # glDeleteFramebuffers acts on whatever context is CURRENT, not on the
        # context that owns the names.  Releasing context A while context B was
        # current therefore deleted B's FBO name out from under it -- measured:
        # B's next draw returned GL_INVALID_FRAMEBUFFER_OPERATION (0x0506).  So
        # bind ourselves first, and if we cannot, skip the deletes entirely:
        # eglDestroyContext reclaims every object in the context anyway.
        if self._fb is not None:
            bound = True
            if egl is not None and self._dpy and self._ctx:
                cur = egl.eglGetCurrentContext()
                if not cur or int(cur) != int(self._ctx.value or 0):
                    surf = self._surface
                    bound = bool(egl.eglMakeCurrent(self._dpy, surf, surf, self._ctx))
                    if not bound:
                        egl.eglGetError()
            if bound:
                self._fb.destroy()
            self._fb = None
        self.fbo = 0
        if egl is None:
            return
        try:
            if self._dpy:
                egl.eglMakeCurrent(self._dpy, None, None, None)
                if self._ctx:
                    egl.eglDestroyContext(self._dpy, self._ctx)
                if self._surface:
                    egl.eglDestroySurface(self._dpy, self._surface)
                # Only the LAST context on this EGLDisplay may terminate it:
                # eglTerminate is not reference-counted and tears down every
                # other context sharing the display.  Same reasoning for
                # eglReleaseThread, which unbinds whatever this thread holds.
                key = getattr(self, "_dpy_key", None)
                if key is None or _display_release(key):
                    egl.eglTerminate(self._dpy)
                    egl.eglReleaseThread()
                self._dpy_key = None
        except Exception:  # noqa: BLE001 - teardown must never raise
            pass
        self._ctx = None
        self._surface = None
        self._dpy = None

    def info(self) -> Dict[str, Any]:
        if self._released or self._gl is None:
            return {"backend": self.backend, "released": True}
        gl = self._gl
        return {
            "backend": self.backend,
            "vendor": gl.get_string(GL_VENDOR),
            "renderer": gl.get_string(GL_RENDERER),
            "version": gl.get_string(GL_VERSION),
            "glsl": gl.get_string(GL_SHADING_LANGUAGE_VERSION),
            "fbo": self.fbo,
            "width": self.width,
            "height": self.height,
            "colorBits": [
                gl.get_int(GL_RED_BITS),
                gl.get_int(GL_GREEN_BITS),
                gl.get_int(GL_BLUE_BITS),
                gl.get_int(GL_ALPHA_BITS),
            ],
            "depthBits": gl.get_int(GL_DEPTH_BITS),
            "maxRenderbuffer": gl.get_int(GL_MAX_RENDERBUFFER_SIZE),
            "ownerThread": self.owner_thread,
            # EGL-specific, additive to the cgl.py key set
            "api": self.api,
            "desktopGL": self.api == "gl",
            "eglPlatform": self.platform_name,
            "eglDevice": self.device_label,
            "eglVersion": "%d.%d" % self.egl_version,
            "eglVendor": self.egl_vendor,
            "eglClientApis": self.client_apis,
            "eglLib": self._egl.lib_name,
            "surface": self.surface_kind,
            "fboEntryPoints": "EXT" if gl.fbo_suffix else "ARB",
            "extensionCount": gl.extension_count(),
            "warnings": list(self.warnings),
        }

    @property
    def gl(self) -> Optional[GLFunctions]:
        """Resolved GL entry points, for diagnostics and validation scripts."""
        return self._gl

    # -- internals ----------------------------------------------------------

    def _assert_live(self) -> None:
        if self._released:
            raise _fail("GL context has been released", reason="released")


def create_context(width: int, height: int) -> EGLContext:
    """Create an offscreen desktop-GL context, current on the CALLING thread."""
    return EGLContext(width, height)


def probe() -> Dict[str, Any]:
    """Diagnostics without creating a context. Never raises.

    ``python -c "from tenmol_bridge.glcontext import egl; print(egl.probe())"``
    is the first thing to run on a Linux box that misbehaves.
    """
    out: Dict[str, Any] = {"backend": "egl", "platform": sys.platform}
    try:
        egl = _load_egl()
    except Exception as exc:  # noqa: BLE001
        out["ok"] = False
        out["error"] = str(exc)
        return out
    out["eglLib"] = egl.lib_name
    out["clientExtensions"] = egl.client_extensions()
    out["hasGetPlatformDisplayEXT"] = egl.eglGetPlatformDisplayEXT is not None
    out["hasQueryDevicesEXT"] = egl.eglQueryDevicesEXT is not None
    try:
        out["devices"] = [_device_label(egl, d) for d in _enumerate_devices(egl)]
    except Exception as exc:  # noqa: BLE001
        out["devices"] = "error: %s" % exc
    try:
        ctypes.CDLL(GL_LIB_NAMES[0])
        out["libGL"] = GL_LIB_NAMES[0]
    except OSError as exc:
        out["libGL"] = "missing: %s" % exc
    out["ok"] = True
    return out
