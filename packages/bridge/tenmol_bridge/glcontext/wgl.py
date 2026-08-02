"""Windows offscreen GL: a hidden window + ``wglCreateContext`` + one FBO.

The Windows twin of :mod:`tenmol_bridge.glcontext.cgl` and
:mod:`tenmol_bridge.glcontext.egl`.  Same contract: a current desktop-GL
context with one FBO bound before PyMOL's first draw, colour + depth
attachments, working ``glReadPixels``.

Why a hidden window and not a pbuffer / not ANGLE
-------------------------------------------------
Windows has no surfaceless GL.  ``wglCreateContext`` needs an ``HDC`` with a
pixel format set, and the only universally-available ``HDC`` that yields an
*accelerated* (ICD) format is a window's.  ``WGL_ARB_pbuffer`` also exists, but
it is itself obtained through ``wglGetProcAddress``, which needs a context,
which needs a window - so the window is unavoidable either way.  We therefore
create one ``WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN`` window that is
**never shown** (no ``WS_VISIBLE``, no ``ShowWindow``), take its DC, and render
exclusively into an FBO.  The window is a handle-holder; nothing is ever drawn
to it.  ``WS_POPUP`` rather than ``WS_OVERLAPPEDWINDOW`` on purpose: an
overlapped window carries a caption, border and system menu that we would only
be paying for and hiding, and its non-client area is what makes a stray
``ShowWindow`` visible on the user's desktop.

No message loop is pumped.  That is safe **only** because nothing is ever drawn
to the window and it is never shown: ``WM_PAINT`` is never generated for a
window that was not made visible, and ``wglMakeCurrent`` / FBO rendering do not
require message dispatch.  If this window is ever shown, a pump becomes
mandatory or the process will be flagged as hung.

``CS_OWNDC`` is required: without it ``GetDC`` hands back a DC from the common
pool, the pixel format set on it is not guaranteed to persist, and
``wglMakeCurrent`` on a later DC can fail with ERROR_INVALID_PIXEL_FORMAT.

**ANGLE is implemented but is a diagnostic path only, not a fallback.**
``libEGL.dll``/``libGLESv2.dll`` give an OpenGL **ES** context.  PyMOL's
Windows build links ``glew32`` and ``opengl32`` (``setup.py:728-734``) and calls
``glewInit()`` on the first draw (``packages/engine/layer0/ShaderMgr.cpp:566``); on Windows GLEW
resolves every non-1.1 entry point through ``wglGetProcAddress``, which returns
NULL when no WGL context is current.  Under ANGLE that means ``glewInit`` fails,
``disableShaders(G)`` runs (``ShaderMgr.cpp:590-597``), and the ES-only driver
still cannot service ``glPushMatrix``/``glShadeModel``
(``packages/engine/layer1/ScenePicking.cpp:283,306,234,272``).  So ANGLE is reachable only via
``TENMOL_WGL_BACKEND=angle`` and :meth:`info` reports ``"desktopGL": False``.

The other real failure mode this module detects
-----------------------------------------------
On a Windows Server / RDP / VM session with no vendor ICD installed,
``ChoosePixelFormat`` happily returns the **Microsoft GDI Generic**
implementation: ``PFD_GENERIC_FORMAT`` set, ``PFD_GENERIC_ACCELERATED`` clear,
``GL_VERSION == "1.1.0"``, ``GL_RENDERER == "GDI Generic"``.  That is a
software rasteriser with no FBO support at all, and PyMOL would fail late and
confusingly.  We detect it up front and raise ``NoOffscreenGL`` with
``reason="gdi-generic"``.

.. warning::
   **STILL NOT EXECUTED ON WINDOWS.**  No Windows host was available.  Do not
   describe this module as working.

   What *is* verified, portably, and re-verified after the review pass in
   spike 07 §4 (``packages/bridge/.venv/bin/python``, macOS):

   * the module imports on a non-Windows host -- every ``WinDLL`` reference is
     looked up lazily, so it does not explode at import;
   * ``ctypes.sizeof(PIXELFORMATDESCRIPTOR) == 40`` with every field at the
     mingw-w64 ``wingdi.h`` offset (``dwLayerMask`` at 28, ``dwVisibleMask`` at
     32, ``dwDamageMask`` at 36), and ``ctypes.sizeof(WNDCLASSW) == 72`` with
     the x64 pointer offsets;
   * every Win32 constant matches the mingw-w64 headers;
   * ``create_context`` and ``probe`` degrade to a typed ``NoOffscreenGL`` /
     ``ok: False`` off-Windows.

   Six defects were found by review and fixed without being able to run them (the
   authoritative list is spike 07 §4.2; the load-bearing ones are):
   ``DescribePixelFormat``'s return value was ignored (a failure would have
   silently reclassified the GDI-generic software rasteriser as a hardware
   ICD), ``release()`` deleted its FBO objects against whatever context was
   current rather than its own (the same bug, *measured*, on the EGL twin),
   ``RegisterClassW`` treated ``ERROR_CLASS_ALREADY_EXISTS`` as fatal, and --
   the one that would only ever have bitten win32 -- every entry point resolved
   through ``wglGetProcAddress`` was being called through a **cdecl** pointer
   although ``APIENTRY`` is ``__stdcall``.  See :func:`egl._functype`: it is
   invisible on x64 (one calling convention) and stack-corrupting on 32-bit x86,
   and it covered the entire framebuffer group, because ``opengl32.dll`` exports
   only OpenGL 1.1 and everything else comes from ``wglGetProcAddress``.

   The manual Windows acceptance procedure is
   ``docs/spikes/cross-platform-gl.md`` §4.
"""

from __future__ import annotations

import ctypes
import os
import sys
import threading
from ctypes import (
    POINTER,
    byref,
    c_char_p,
    c_int,
    c_ubyte,
    c_uint,
    c_uint16,
    c_uint32,
    c_void_p,
    c_wchar_p,
)
from typing import Any, Dict, List, Optional

from .egl import (
    GL_ALPHA_BITS,
    GL_BLUE_BITS,
    GL_DEPTH_BITS,
    GL_GREEN_BITS,
    GL_MAX_RENDERBUFFER_SIZE,
    GL_RED_BITS,
    GL_RENDERER,
    GL_SHADING_LANGUAGE_VERSION,
    GL_VENDOR,
    GL_VERSION,
    GLFramebuffer,
    GLFunctions,
)

try:
    from ..errors import NoOffscreenGL
except ImportError:  # pragma: no cover - bridge-core owns errors.py

    class NoOffscreenGL(RuntimeError):  # type: ignore[no-redef]
        """Local fallback; see :mod:`tenmol_bridge.errors`."""

        kind = "NoOffscreenGL"

        def __init__(self, message: str, **detail: Any) -> None:
            super().__init__(message)
            self.detail: Dict[str, Any] = detail


__all__ = ["WGLContext", "create_context", "probe"]

# ---------------------------------------------------------------------------
# Win32 constants.  Source: mingw-w64 wingdi.h / winuser.h (grepped, see the
# spike doc §"Provenance"); values are ABI-frozen since Windows 95.
# ---------------------------------------------------------------------------

# wingdi.h
PFD_TYPE_RGBA = 0
PFD_MAIN_PLANE = 0
PFD_DOUBLEBUFFER = 0x00000001
PFD_STEREO = 0x00000002
PFD_DRAW_TO_WINDOW = 0x00000004
PFD_DRAW_TO_BITMAP = 0x00000008
PFD_SUPPORT_GDI = 0x00000010
PFD_SUPPORT_OPENGL = 0x00000020
PFD_GENERIC_FORMAT = 0x00000040
PFD_GENERIC_ACCELERATED = 0x00001000
PFD_DEPTH_DONTCARE = 0x20000000

# winuser.h
CS_OWNDC = 0x0020
CW_USEDEFAULT = -0x80000000  # ((int)0x80000000)
WS_OVERLAPPED = 0x00000000
WS_POPUP = 0x80000000
WS_VISIBLE = 0x10000000
WS_CLIPSIBLINGS = 0x04000000
WS_CLIPCHILDREN = 0x02000000

# winerror.h - the two that actually show up here
ERROR_CLASS_ALREADY_EXISTS = 1410
ERROR_INVALID_PIXEL_FORMAT = 2000

_DEFAULT_WINDOW_STYLE = WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN

_class_counter = 0
_class_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Portable ctypes aliases.  ctypes.wintypes is deliberately NOT imported: it is
# only guaranteed to exist on Windows, and this module must import on macOS and
# Linux so that glcontext/__init__.py's "backend-missing" path stays honest.
# ---------------------------------------------------------------------------

HANDLE = c_void_p  # HWND / HDC / HGLRC / HINSTANCE / HICON / HBRUSH / HMENU
UINT = c_uint
DWORD = c_uint32
WORD = c_uint16
BYTE = c_ubyte
ATOM = c_uint16
LONG_PTR = ctypes.c_ssize_t
UINT_PTR = ctypes.c_size_t


class PIXELFORMATDESCRIPTOR(ctypes.Structure):
    """``wingdi.h`` ``tagPIXELFORMATDESCRIPTOR`` - 40 bytes, no padding."""

    _fields_ = [
        ("nSize", WORD),
        ("nVersion", WORD),
        ("dwFlags", DWORD),
        ("iPixelType", BYTE),
        ("cColorBits", BYTE),
        ("cRedBits", BYTE),
        ("cRedShift", BYTE),
        ("cGreenBits", BYTE),
        ("cGreenShift", BYTE),
        ("cBlueBits", BYTE),
        ("cBlueShift", BYTE),
        ("cAlphaBits", BYTE),
        ("cAlphaShift", BYTE),
        ("cAccumBits", BYTE),
        ("cAccumRedBits", BYTE),
        ("cAccumGreenBits", BYTE),
        ("cAccumBlueBits", BYTE),
        ("cAccumAlphaBits", BYTE),
        ("cDepthBits", BYTE),
        ("cStencilBits", BYTE),
        ("cAuxBuffers", BYTE),
        ("iLayerType", BYTE),
        ("bReserved", BYTE),
        ("dwLayerMask", DWORD),
        ("dwVisibleMask", DWORD),
        ("dwDamageMask", DWORD),
    ]


class WNDCLASSW(ctypes.Structure):
    """``winuser.h`` ``tagWNDCLASSW``.

    ``lpfnWndProc`` is typed as ``c_void_p`` rather than a ``WINFUNCTYPE`` so
    that this class body is importable off-Windows.  We store the address of
    ``user32.DefWindowProcW`` in it, which also sidesteps the usual Python
    callback-lifetime hazard: there is no Python callback to keep alive.
    """

    _fields_ = [
        ("style", UINT),
        ("lpfnWndProc", c_void_p),
        ("cbClsExtra", c_int),
        ("cbWndExtra", c_int),
        ("hInstance", HANDLE),
        ("hIcon", HANDLE),
        ("hCursor", HANDLE),
        ("hbrBackground", HANDLE),
        ("lpszMenuName", c_wchar_p),
        ("lpszClassName", c_wchar_p),
    ]


def _fail(message: str, **detail: Any) -> "NoOffscreenGL":
    detail.setdefault("platform", sys.platform)
    detail.setdefault("backend", "wgl")
    return NoOffscreenGL(message, **detail)


def _is_windows() -> bool:
    return sys.platform.startswith("win") or sys.platform == "cygwin"


def _require_windows() -> None:
    if not _is_windows():
        raise _fail(
            "the WGL backend needs Windows; sys.platform is %r" % sys.platform,
            reason="wrong-platform",
        )


def _last_error() -> int:
    getter = getattr(ctypes, "get_last_error", None)
    return int(getter()) if getter is not None else 0


def _win_error_text(code: int) -> str:
    maker = getattr(ctypes, "WinError", None)
    if maker is None or not code:
        return "error %d" % code
    try:
        return str(maker(code))
    except Exception:  # noqa: BLE001
        return "error %d" % code


# ---------------------------------------------------------------------------
# Lazily-bound Win32 DLLs
# ---------------------------------------------------------------------------


class _Win32:
    """``user32`` / ``gdi32`` / ``opengl32`` with explicit prototypes.

    All three are opened with ``use_last_error=True`` so ``ctypes.get_last_error``
    reports the value from *our* call and not from whatever ran in between.
    """

    def __init__(self) -> None:
        _require_windows()
        # Looked up, not referenced: ctypes.WinDLL does not exist off-Windows,
        # so a mis-reported sys.platform must still give a typed error.
        windll = getattr(ctypes, "WinDLL", None)
        if windll is None:
            raise _fail(
                "sys.platform is %r but this Python's ctypes has no WinDLL; "
                "the WGL backend cannot be used" % sys.platform,
                reason="no-windll",
            )
        try:
            self.user32 = windll("user32", use_last_error=True)
            self.gdi32 = windll("gdi32", use_last_error=True)
            self.opengl32 = windll("opengl32", use_last_error=True)
        except OSError as exc:
            raise _fail(
                "cannot load user32/gdi32/opengl32: %s" % exc,
                reason="dll-missing",
            ) from exc
        self.kernel32 = windll("kernel32", use_last_error=True)

        u, g, o, k = self.user32, self.gdi32, self.opengl32, self.kernel32

        k.GetModuleHandleW.restype = HANDLE
        k.GetModuleHandleW.argtypes = (c_wchar_p,)

        u.DefWindowProcW.restype = LONG_PTR
        u.DefWindowProcW.argtypes = (HANDLE, UINT, UINT_PTR, LONG_PTR)
        u.RegisterClassW.restype = ATOM
        u.RegisterClassW.argtypes = (POINTER(WNDCLASSW),)
        u.UnregisterClassW.restype = c_int
        u.UnregisterClassW.argtypes = (c_wchar_p, HANDLE)
        u.CreateWindowExW.restype = HANDLE
        u.CreateWindowExW.argtypes = (
            DWORD,  # dwExStyle
            c_wchar_p,  # lpClassName
            c_wchar_p,  # lpWindowName
            DWORD,  # dwStyle
            c_int,  # X
            c_int,  # Y
            c_int,  # nWidth
            c_int,  # nHeight
            HANDLE,  # hWndParent
            HANDLE,  # hMenu
            HANDLE,  # hInstance
            c_void_p,  # lpParam
        )
        u.DestroyWindow.restype = c_int
        u.DestroyWindow.argtypes = (HANDLE,)
        u.GetDC.restype = HANDLE
        u.GetDC.argtypes = (HANDLE,)
        u.ReleaseDC.restype = c_int
        u.ReleaseDC.argtypes = (HANDLE, HANDLE)

        g.ChoosePixelFormat.restype = c_int
        g.ChoosePixelFormat.argtypes = (HANDLE, POINTER(PIXELFORMATDESCRIPTOR))
        g.SetPixelFormat.restype = c_int
        g.SetPixelFormat.argtypes = (HANDLE, c_int, POINTER(PIXELFORMATDESCRIPTOR))
        g.DescribePixelFormat.restype = c_int
        g.DescribePixelFormat.argtypes = (
            HANDLE,
            c_int,
            UINT,
            POINTER(PIXELFORMATDESCRIPTOR),
        )

        o.wglCreateContext.restype = HANDLE
        o.wglCreateContext.argtypes = (HANDLE,)
        o.wglDeleteContext.restype = c_int
        o.wglDeleteContext.argtypes = (HANDLE,)
        o.wglMakeCurrent.restype = c_int
        o.wglMakeCurrent.argtypes = (HANDLE, HANDLE)
        o.wglGetCurrentContext.restype = HANDLE
        o.wglGetCurrentContext.argtypes = ()
        o.wglGetProcAddress.restype = c_void_p
        o.wglGetProcAddress.argtypes = (c_char_p,)


_win32_lock = threading.Lock()
_win32: Optional[_Win32] = None


def _load_win32() -> _Win32:
    global _win32
    with _win32_lock:
        if _win32 is None:
            _win32 = _Win32()
        return _win32


# ---------------------------------------------------------------------------
# The context
# ---------------------------------------------------------------------------


class WGLContext:
    """A hidden-window WGL context owning exactly one FBO.

    Thread affinity is stricter than on macOS/Linux: ``wglMakeCurrent`` is
    per-thread *and* ``DestroyWindow`` must be called on the thread that called
    ``CreateWindowExW`` (Win32 windows have thread affinity).  So construct
    **and** :meth:`release` this on the engine thread.
    """

    backend = "wgl"

    def __init__(self, width: int, height: int) -> None:
        self.width = max(1, int(width))
        self.height = max(1, int(height))
        self.fbo = 0
        self.owner_thread = threading.get_ident()
        self.warnings: List[str] = []

        self._released = False
        self._hwnd: Optional[int] = None
        self._hdc: Optional[int] = None
        self._hglrc: Optional[int] = None
        self._class_name: Optional[str] = None
        self._class_registered = False
        # DestroyWindow/UnregisterClassW have Win32 *thread* affinity, which is
        # stricter than wglMakeCurrent's: they must run on the thread that
        # called CreateWindowExW, whatever thread happens to hold the GL
        # context at the time.  Recorded separately from owner_thread, which
        # tracks the GL context and moves with make_current().
        self.creator_thread = threading.get_ident()
        self._hinstance: Optional[int] = None
        self._fb: Optional[GLFramebuffer] = None
        self._gl: Optional[GLFunctions] = None
        self.pixel_format = 0
        self.pfd_flags = 0

        self._w = _load_win32()
        try:
            self._create()
        except BaseException:
            self.release()
            raise

    # -- construction -------------------------------------------------------

    def _create(self) -> None:
        global _class_counter
        w = self._w
        self._hinstance = w.kernel32.GetModuleHandleW(None)

        with _class_lock:
            _class_counter += 1
            index = _class_counter
        self._class_name = "TenmolOffscreenGL_%d_%d" % (os.getpid(), index)

        wc = WNDCLASSW()
        wc.style = CS_OWNDC
        # Address of DefWindowProcW: no Python callback, no lifetime hazard.
        wc.lpfnWndProc = ctypes.cast(w.user32.DefWindowProcW, c_void_p).value
        wc.cbClsExtra = 0
        wc.cbWndExtra = 0
        wc.hInstance = self._hinstance
        wc.hIcon = None
        wc.hCursor = None
        wc.hbrBackground = None
        wc.lpszMenuName = None
        wc.lpszClassName = self._class_name

        if not w.user32.RegisterClassW(byref(wc)):
            err = _last_error()
            # A class name can survive a torn-down process image (a hard kill
            # between CreateWindowExW and UnregisterClassW leaves the atom
            # registered until the module unloads).  The class is then already
            # exactly what we want, so treat it as success rather than
            # refusing to start.
            if err != ERROR_CLASS_ALREADY_EXISTS:
                self._class_name = None
                raise _fail(
                    "RegisterClassW failed: %s" % _win_error_text(err),
                    reason="register-class-failed",
                    winError=err,
                )
            self._class_registered = False
            self.warnings.append(
                "window class %r was already registered; reusing it"
                % self._class_name
            )
        else:
            self._class_registered = True

        hwnd = w.user32.CreateWindowExW(
            0,
            self._class_name,
            "tenmol offscreen GL",
            _DEFAULT_WINDOW_STYLE,  # NOTE: no WS_VISIBLE - never shown
            0,
            0,
            self.width,
            self.height,
            None,
            None,
            self._hinstance,
            None,
        )
        if not hwnd:
            err = _last_error()
            raise _fail(
                "CreateWindowExW failed: %s. A session with no window station "
                "(a Windows *service* rather than an interactive session) "
                "cannot create windows - run the bridge as the logged-in user."
                % _win_error_text(err),
                reason="create-window-failed",
                winError=err,
            )
        self._hwnd = hwnd

        hdc = w.user32.GetDC(hwnd)
        if not hdc:
            raise _fail("GetDC returned NULL", reason="no-dc")
        self._hdc = hdc

        self._set_pixel_format()

        hglrc = w.opengl32.wglCreateContext(self._hdc)
        if not hglrc:
            err = _last_error()
            raise _fail(
                "wglCreateContext failed: %s" % _win_error_text(err),
                reason="no-context",
                winError=err,
            )
        self._hglrc = hglrc

        self.make_current()

        self._gl = GLFunctions(self._gl_loader)
        gl = self._gl
        self.gl_version = gl.gl_version_tuple()
        renderer = gl.get_string(GL_RENDERER)

        generic = bool(self.pfd_flags & PFD_GENERIC_FORMAT)
        accelerated = bool(self.pfd_flags & PFD_GENERIC_ACCELERATED)
        self.acceleration = (
            "icd" if not generic else ("mcd" if accelerated else "gdi-generic")
        )
        if self.acceleration == "gdi-generic" or self.gl_version < (2, 0):
            raise _fail(
                "got the software OpenGL implementation (renderer %r, version "
                "%r, acceleration %r). No vendor ICD is installed, or this is "
                "an RDP/VM session with GPU acceleration disabled. PyMOL needs "
                "OpenGL >= 2.0 with FBO support. Install the GPU vendor driver, "
                "or use a Mesa llvmpipe opengl32.dll drop-in (mesa3d "
                "'opengl32.dll' from the msys2 mesa package or the "
                "pal1000/mesa-dist-win build) placed next to python.exe."
                % (renderer, gl.get_string(GL_VERSION), self.acceleration),
                reason="gdi-generic" if self.acceleration == "gdi-generic" else "gl-too-old",
                renderer=renderer,
                glVersion=gl.get_string(GL_VERSION),
                acceleration=self.acceleration,
            )
        if gl.fbo_suffix == "EXT":
            self.warnings.append(
                "only EXT_framebuffer_object is available; PyMOL binds with "
                "the ARB entry points (packages/engine/layer0/ShaderMgr.cpp:1829)"
            )

        self._fb = GLFramebuffer(gl, self.width, self.height, backend="wgl")
        self.fbo = self._fb.fbo
        self._fb.bind()

    def _set_pixel_format(self) -> None:
        """``ChoosePixelFormat`` + ``SetPixelFormat``, relaxing until one sticks.

        ``SetPixelFormat`` may be called **exactly once per HDC** for the life
        of the window (documented Win32 behaviour), which is why the ladder
        chooses first and only sets the winner.
        """
        w = self._w
        ladders = (
            (PFD_DOUBLEBUFFER, 32, 8, 24, 8),
            (PFD_DOUBLEBUFFER, 32, 8, 24, 0),
            (0, 32, 8, 24, 0),
            (0, 24, 0, 16, 0),
        )
        chosen = 0
        pfd = PIXELFORMATDESCRIPTOR()
        for extra, color, alpha, depth, stencil in ladders:
            ctypes.memset(byref(pfd), 0, ctypes.sizeof(pfd))
            pfd.nSize = ctypes.sizeof(PIXELFORMATDESCRIPTOR)
            pfd.nVersion = 1
            pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | extra
            pfd.iPixelType = PFD_TYPE_RGBA
            pfd.cColorBits = color
            pfd.cAlphaBits = alpha
            pfd.cDepthBits = depth
            pfd.cStencilBits = stencil
            pfd.iLayerType = PFD_MAIN_PLANE
            chosen = w.gdi32.ChoosePixelFormat(self._hdc, byref(pfd))
            if chosen:
                break
        if not chosen:
            err = _last_error()
            raise _fail(
                "ChoosePixelFormat found no OpenGL pixel format: %s"
                % _win_error_text(err),
                reason="no-pixel-format",
                winError=err,
            )

        # What did we actually get?  DescribePixelFormat is the only way to see
        # PFD_GENERIC_FORMAT, which ChoosePixelFormat never reports back.
        actual = PIXELFORMATDESCRIPTOR()
        actual.nSize = ctypes.sizeof(PIXELFORMATDESCRIPTOR)
        actual.nVersion = 1
        if not w.gdi32.DescribePixelFormat(
            self._hdc, chosen, ctypes.sizeof(PIXELFORMATDESCRIPTOR), byref(actual)
        ):
            # DescribePixelFormat returns 0 on failure and leaves `actual`
            # untouched.  Left unchecked, dwFlags would read back as 0, which
            # has PFD_GENERIC_FORMAT clear -- i.e. a *software* format would be
            # misreported as a hardware ICD and the gdi-generic guard below
            # would never fire.  Refuse instead of guessing.
            err = _last_error()
            raise _fail(
                "DescribePixelFormat(%d) failed: %s" % (chosen, _win_error_text(err)),
                reason="describe-pixel-format-failed",
                winError=err,
            )
        self.pixel_format = int(chosen)
        self.pfd_flags = int(actual.dwFlags)
        self.pfd = {
            "colorBits": int(actual.cColorBits),
            "alphaBits": int(actual.cAlphaBits),
            "depthBits": int(actual.cDepthBits),
            "stencilBits": int(actual.cStencilBits),
            "doubleBuffer": bool(actual.dwFlags & PFD_DOUBLEBUFFER),
        }

        if not w.gdi32.SetPixelFormat(self._hdc, chosen, byref(actual)):
            err = _last_error()
            raise _fail(
                "SetPixelFormat(%d) failed: %s" % (chosen, _win_error_text(err)),
                reason="set-pixel-format-failed",
                winError=err,
            )

    def _gl_loader(self, name: str) -> Optional[int]:
        """``opengl32`` export first, then ``wglGetProcAddress``.

        ``opengl32.dll`` only exports OpenGL 1.1, so everything FBO-related
        comes from ``wglGetProcAddress`` - which requires a current context
        (we are called after :meth:`make_current`) and which, on a family of
        older ICDs, returns the sentinel values 1, 2, 3 and -1 instead of NULL
        on failure.  Both quirks are handled here.
        """
        w = self._w
        try:
            fn = getattr(w.opengl32, name)
        except AttributeError:
            fn = None
        if fn is not None:
            addr = ctypes.cast(fn, c_void_p).value
            if addr:
                return int(addr)
        raw = w.opengl32.wglGetProcAddress(name.encode("ascii"))
        if not raw:
            return None
        value = int(raw)
        if value in (1, 2, 3, 0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF, -1):
            return None
        return value

    # -- Context protocol ---------------------------------------------------

    def is_current(self) -> bool:
        """True if this context is current on the **calling** thread.

        ``wglGetCurrentContext`` is per-thread, so this is False on a thread
        that does not hold the context even while another thread does.
        """
        if self._released or not self._hglrc:
            return False
        cur = self._w.opengl32.wglGetCurrentContext()
        return bool(cur) and int(cur) == int(self._hglrc)

    def release_current(self) -> bool:
        """Unbind this context from the **calling** thread.

        ``wglMakeCurrent`` documents that a rendering context is current to at
        most one thread, so the owning thread must unbind before another may
        bind -- the same rule :meth:`EGLContext.release_current` exists for
        (that one is measured; this one is from the WGL docs and is UNVERIFIED
        on real hardware).
        """
        if self._released:
            return False
        return bool(self._w.opengl32.wglMakeCurrent(None, None))

    def make_current(self) -> None:
        self._assert_live()
        if self.is_current():
            self.owner_thread = threading.get_ident()
            if self._fb is not None:
                self._fb.bind()
            return
        if not self._w.opengl32.wglMakeCurrent(self._hdc, self._hglrc):
            err = _last_error()
            raise _fail(
                "wglMakeCurrent failed: %s%s"
                % (
                    _win_error_text(err),
                    " (ERROR_INVALID_PIXEL_FORMAT - the HDC lost its pixel "
                    "format; CS_OWNDC should have prevented this)"
                    if err == ERROR_INVALID_PIXEL_FORMAT
                    else "",
                ),
                reason="make-current-failed",
                winError=err,
            )
        self.owner_thread = threading.get_ident()
        if self._fb is not None:
            self._fb.bind()

    def resize(self, width: int, height: int) -> None:
        """Re-storage the SAME FBO. Never regenerate it (see package docstring).

        The hidden window is deliberately not resized: nothing is drawn to it.
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
        w = getattr(self, "_w", None)
        # glDeleteFramebuffers acts on the CURRENT context, not on the context
        # that owns the names.  Deleting while a *different* context is current
        # destroys that context's objects instead -- reproduced on the EGL twin
        # (Mesa/llvmpipe), where the victim's next draw returned
        # GL_INVALID_FRAMEBUFFER_OPERATION.  Bind ourselves first; if we
        # cannot, skip the deletes, because wglDeleteContext reclaims every
        # object in the context anyway.
        if self._fb is not None:
            bound = True
            if w is not None and self._hdc and self._hglrc:
                cur = w.opengl32.wglGetCurrentContext()
                if not cur or int(cur) != int(self._hglrc):
                    bound = bool(w.opengl32.wglMakeCurrent(self._hdc, self._hglrc))
            if bound:
                self._fb.destroy()
            self._fb = None
        self.fbo = 0
        if w is None:
            return
        try:
            w.opengl32.wglMakeCurrent(None, None)
            if self._hglrc:
                w.opengl32.wglDeleteContext(self._hglrc)
            if self._hdc and self._hwnd:
                w.user32.ReleaseDC(self._hwnd, self._hdc)
            if self._hwnd:
                # Win32 windows have thread affinity: DestroyWindow only works
                # on the thread that called CreateWindowExW.  From any other
                # thread it fails with ERROR_ACCESS_DENIED and the window (and
                # its DC) leak for the life of the process.
                if threading.get_ident() != self.creator_thread:
                    self.warnings.append(
                        "release() ran on thread %s but the window was created "
                        "on thread %s; DestroyWindow will fail and the HWND "
                        "will leak. Release on the engine thread."
                        % (threading.get_ident(), self.creator_thread)
                    )
                w.user32.DestroyWindow(self._hwnd)
            if self._class_name and self._class_registered:
                # Only unregister a class we actually registered, and only
                # after DestroyWindow: UnregisterClassW fails while any window
                # of the class still exists.
                w.user32.UnregisterClassW(self._class_name, self._hinstance)
        except Exception:  # noqa: BLE001 - teardown must never raise
            pass
        self._hglrc = self._hdc = self._hwnd = None
        self._class_name = None

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
            # WGL-specific, additive to the cgl.py key set
            "api": "gl",
            "desktopGL": True,
            "pixelFormat": self.pixel_format,
            "pixelFormatFlags": "0x%08X" % self.pfd_flags,
            "acceleration": self.acceleration,
            "pfd": self.pfd,
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


def _angle_context(width: int, height: int):
    """ANGLE via ``libEGL.dll``.  Diagnostic only - see the module docstring."""
    from . import egl as _egl

    ctx = _egl.EGLContext(
        width,
        height,
        allow_gles=True,
        platform_name="default",
        egl_libs=("libEGL.dll",),
        gl_libs=("libGLESv2.dll",),
        backend_name="angle",
    )
    ctx.warnings.append(
        "ANGLE gives an OpenGL ES context. PyMOL's Windows build links glew32 "
        "and calls glewInit() (packages/engine/layer0/ShaderMgr.cpp:566), which resolves "
        "through wglGetProcAddress and will fail with no WGL context current. "
        "Do not ship this path."
    )
    return ctx


def create_context(width: int, height: int) -> Any:
    """Create an offscreen desktop-GL context, current on the CALLING thread."""
    # Before the ANGLE branch, not after: libEGL.dll/libGLESv2.dll only exist
    # on Windows, so honouring TENMOL_WGL_BACKEND=angle elsewhere would trade a
    # clear "wrong platform" error for an obscure "cannot load libEGL".
    _require_windows()
    if os.environ.get("TENMOL_WGL_BACKEND", "").strip().lower() == "angle":
        return _angle_context(width, height)
    return WGLContext(width, height)


def probe() -> Dict[str, Any]:
    """Diagnostics without creating a context.  Never raises."""
    out: Dict[str, Any] = {"backend": "wgl", "platform": sys.platform}
    if not _is_windows():
        out["ok"] = False
        out["error"] = "not Windows (sys.platform=%r)" % sys.platform
        return out
    try:
        w = _load_win32()
    except Exception as exc:  # noqa: BLE001
        out["ok"] = False
        out["error"] = str(exc)
        return out
    out["ok"] = True
    out["opengl32"] = True
    out["currentContext"] = bool(w.opengl32.wglGetCurrentContext())
    for dll in ("libEGL.dll", "libGLESv2.dll"):
        try:
            getattr(ctypes, "WinDLL")(dll)
            out[dll] = True
        except OSError:
            out[dll] = False
    return out
