"""macOS offscreen GL: CGL legacy-2.1 context, no drawable, + one FBO.

This is ``docs/spikes/04-picking.md`` §2/§3 verbatim, promoted to a
module.  It is ~20 lines of ``ctypes`` against ``OpenGL.framework`` and needs
no window, no ``NSApplication``, no Qt, no GLUT, no OSMesa and no ANGLE (none
of which brew even ships on macOS — spike 04 §2).

Measured on this machine: ``GL_VENDOR = Apple``, ``GL_RENDERER = Apple M4 Max``,
``GL_VERSION = 2.1 Metal - 89.4``, 8/8/8/8 colour bits, 32 depth bits — i.e.
hardware, and enough colour bits for a one-pass 32-bit pick index
(``PickColorConverterSetRgbaBitsFromGL``, ``packages/engine/layer1/ScenePicking.cpp:38-84``).

Why the LEGACY profile: PyMOL's non-ES path calls ``glPushMatrix`` /
``glPopMatrix`` (``packages/engine/layer1/ScenePicking.cpp:283,306``) and ``glShadeModel``
(``:234,272``), all removed from core 3.2+.
"""

from __future__ import annotations

import ctypes
import sys
import threading
from typing import Any, Dict, Optional

from ..errors import NoOffscreenGL

__all__ = ["CGLContext", "create_context"]

_FRAMEWORK = "/System/Library/Frameworks/OpenGL.framework/OpenGL"
_LIBGL = "/System/Library/Frameworks/OpenGL.framework/Libraries/libGL.dylib"

# CGL pixel-format attributes (CGLTypes.h / CGLRenderers.h)
_kCGLPFAOpenGLProfile = 99
_kCGLOGLPVersion_Legacy = 0x1000
_kCGLPFAColorSize = 8
_kCGLPFADepthSize = 12

# GL / GL_EXT_framebuffer_object enums
_GL_VENDOR = 0x1F00
_GL_RENDERER = 0x1F01
_GL_VERSION = 0x1F02
_GL_SHADING_LANGUAGE_VERSION = 0x8B8C
_GL_FRAMEBUFFER_EXT = 0x8D40
_GL_RENDERBUFFER_EXT = 0x8D41
_GL_COLOR_ATTACHMENT0_EXT = 0x8CE0
_GL_DEPTH_ATTACHMENT_EXT = 0x8D00
_GL_RGBA8 = 0x8058
_GL_DEPTH_COMPONENT24 = 0x81A6
_GL_FRAMEBUFFER_COMPLETE_EXT = 0x8CD5
_GL_RED_BITS = 0x0D52
_GL_GREEN_BITS = 0x0D53
_GL_BLUE_BITS = 0x0D54
_GL_ALPHA_BITS = 0x0D55
_GL_DEPTH_BITS = 0x0D56
_GL_MAX_RENDERBUFFER_SIZE_EXT = 0x84E8

_load_lock = threading.Lock()
_libs: Optional[Any] = None


def _load_libs():
    global _libs
    with _load_lock:
        if _libs is None:
            try:
                cgl = ctypes.CDLL(_FRAMEWORK)
                gl = ctypes.CDLL(_LIBGL)
            except OSError as exc:
                raise NoOffscreenGL(
                    "cannot load OpenGL.framework: %s" % exc,
                    platform=sys.platform,
                    backend="cgl",
                    reason="framework-missing",
                ) from exc
            cgl.CGLErrorString.restype = ctypes.c_char_p
            gl.glGetString.restype = ctypes.c_char_p
            _libs = (cgl, gl)
    return _libs


def _cgl_check(cgl, err: int, what: str) -> None:
    if err:
        msg = cgl.CGLErrorString(err)
        raise NoOffscreenGL(
            "%s failed: CGLError %d (%s)"
            % (what, err, msg.decode("utf-8", "replace") if msg else "?"),
            platform=sys.platform,
            backend="cgl",
            reason="cgl-error",
            cgl_error=err,
        )


class CGLContext:
    """A window-less CGL context owning exactly one FBO.

    Thread affinity: ``CGLSetCurrentContext`` is per-thread.  Construct this on
    the engine thread; if it is ever handed to another thread, that thread must
    call :meth:`make_current` first — and the original thread must then stop
    drawing.
    """

    backend = "cgl"

    def __init__(self, width: int, height: int) -> None:
        cgl, gl = _load_libs()
        self._cgl = cgl
        self._gl = gl
        self.width = int(width)
        self.height = int(height)
        self.fbo = 0
        self._color_rb = 0
        self._depth_rb = 0
        self._ctx = ctypes.c_void_p()
        self._pix = ctypes.c_void_p()
        self._released = False
        self.owner_thread = threading.get_ident()

        attrs = (ctypes.c_int * 7)(
            _kCGLPFAOpenGLProfile,
            _kCGLOGLPVersion_Legacy,
            _kCGLPFAColorSize,
            24,
            _kCGLPFADepthSize,
            24,
            0,
        )
        npix = ctypes.c_int()
        err = cgl.CGLChoosePixelFormat(
            attrs, ctypes.byref(self._pix), ctypes.byref(npix)
        )
        _cgl_check(cgl, err, "CGLChoosePixelFormat")
        if not self._pix:
            raise NoOffscreenGL(
                "CGLChoosePixelFormat returned no pixel format "
                "(no WindowServer session?)",
                platform=sys.platform,
                backend="cgl",
                reason="no-pixel-format",
            )
        err = cgl.CGLCreateContext(self._pix, None, ctypes.byref(self._ctx))
        _cgl_check(cgl, err, "CGLCreateContext")
        if not self._ctx:
            raise NoOffscreenGL(
                "CGLCreateContext returned NULL",
                platform=sys.platform,
                backend="cgl",
                reason="no-context",
            )
        self.make_current()

        # One FBO, created once and never regenerated (see package docstring).
        fbo = ctypes.c_uint()
        gl.glGenFramebuffersEXT(1, ctypes.byref(fbo))
        self.fbo = int(fbo.value)
        gl.glBindFramebufferEXT(_GL_FRAMEBUFFER_EXT, self.fbo)

        color_rb = ctypes.c_uint()
        depth_rb = ctypes.c_uint()
        gl.glGenRenderbuffersEXT(1, ctypes.byref(color_rb))
        gl.glGenRenderbuffersEXT(1, ctypes.byref(depth_rb))
        self._color_rb = int(color_rb.value)
        self._depth_rb = int(depth_rb.value)
        # Allocate BEFORE attaching: glGenRenderbuffersEXT only reserves a
        # name; the object does not exist until its first glBindRenderbuffer,
        # and attaching a name that is not yet an object gives
        # GL_INVALID_OPERATION + FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT
        # (0x8CD7) -- observed exactly once while writing this file.
        self._storage(self.width, self.height, check=False)
        gl.glFramebufferRenderbufferEXT(
            _GL_FRAMEBUFFER_EXT,
            _GL_COLOR_ATTACHMENT0_EXT,
            _GL_RENDERBUFFER_EXT,
            self._color_rb,
        )
        gl.glFramebufferRenderbufferEXT(
            _GL_FRAMEBUFFER_EXT,
            _GL_DEPTH_ATTACHMENT_EXT,
            _GL_RENDERBUFFER_EXT,
            self._depth_rb,
        )
        self._storage(self.width, self.height)

    # -- Context protocol ---------------------------------------------------

    def make_current(self) -> None:
        self._assert_live()
        err = self._cgl.CGLSetCurrentContext(self._ctx)
        _cgl_check(self._cgl, err, "CGLSetCurrentContext")
        self.owner_thread = threading.get_ident()
        if self.fbo:
            self._gl.glBindFramebufferEXT(_GL_FRAMEBUFFER_EXT, self.fbo)
            self._gl.glViewport(0, 0, self.width, self.height)

    def resize(self, width: int, height: int) -> None:
        """Re-storage the SAME FBO. Never regenerate it (see package docstring)."""
        self._assert_live()
        width = max(1, int(width))
        height = max(1, int(height))
        if (width, height) == (self.width, self.height):
            return
        self._storage(width, height)

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        gl, cgl = self._gl, self._cgl
        try:
            if self._color_rb:
                gl.glDeleteRenderbuffersEXT(
                    1, ctypes.byref(ctypes.c_uint(self._color_rb))
                )
            if self._depth_rb:
                gl.glDeleteRenderbuffersEXT(
                    1, ctypes.byref(ctypes.c_uint(self._depth_rb))
                )
            if self.fbo:
                gl.glDeleteFramebuffersEXT(1, ctypes.byref(ctypes.c_uint(self.fbo)))
        except Exception:  # noqa: BLE001 - teardown must never raise
            pass
        self._color_rb = self._depth_rb = self.fbo = 0
        try:
            cgl.CGLSetCurrentContext(None)
            if self._ctx:
                cgl.CGLDestroyContext(self._ctx)
            if self._pix:
                cgl.CGLDestroyPixelFormat(self._pix)
        except Exception:  # noqa: BLE001
            pass
        self._ctx = ctypes.c_void_p()
        self._pix = ctypes.c_void_p()

    def info(self) -> Dict[str, Any]:
        if self._released:
            return {"backend": self.backend, "released": True}
        return {
            "backend": self.backend,
            "vendor": self._get_string(_GL_VENDOR),
            "renderer": self._get_string(_GL_RENDERER),
            "version": self._get_string(_GL_VERSION),
            "glsl": self._get_string(_GL_SHADING_LANGUAGE_VERSION),
            "fbo": self.fbo,
            "width": self.width,
            "height": self.height,
            "colorBits": [
                self._get_int(_GL_RED_BITS),
                self._get_int(_GL_GREEN_BITS),
                self._get_int(_GL_BLUE_BITS),
                self._get_int(_GL_ALPHA_BITS),
            ],
            "depthBits": self._get_int(_GL_DEPTH_BITS),
            "maxRenderbuffer": self._get_int(_GL_MAX_RENDERBUFFER_SIZE_EXT),
            "ownerThread": self.owner_thread,
        }

    # -- internals ----------------------------------------------------------

    def _assert_live(self) -> None:
        if self._released:
            raise NoOffscreenGL(
                "GL context has been released",
                platform=sys.platform,
                backend="cgl",
                reason="released",
            )

    def _storage(self, width: int, height: int, check: bool = True) -> None:
        gl = self._gl
        gl.glBindFramebufferEXT(_GL_FRAMEBUFFER_EXT, self.fbo)
        for rb, fmt in (
            (self._color_rb, _GL_RGBA8),
            (self._depth_rb, _GL_DEPTH_COMPONENT24),
        ):
            gl.glBindRenderbufferEXT(_GL_RENDERBUFFER_EXT, rb)
            gl.glRenderbufferStorageEXT(_GL_RENDERBUFFER_EXT, fmt, width, height)
        if not check:
            self.width, self.height = width, height
            gl.glViewport(0, 0, width, height)
            return
        status = gl.glCheckFramebufferStatusEXT(_GL_FRAMEBUFFER_EXT)
        if status != _GL_FRAMEBUFFER_COMPLETE_EXT:
            raise NoOffscreenGL(
                "FBO incomplete at %dx%d: status 0x%x" % (width, height, status),
                platform=sys.platform,
                backend="cgl",
                reason="fbo-incomplete",
                status=status,
            )
        self.width, self.height = width, height
        gl.glViewport(0, 0, width, height)

    def _get_string(self, enum: int) -> str:
        raw = self._gl.glGetString(enum)
        return raw.decode("utf-8", "replace") if raw else ""

    def _get_int(self, enum: int) -> int:
        out = ctypes.c_int(0)
        self._gl.glGetIntegerv(enum, ctypes.byref(out))
        return int(out.value)


def create_context(width: int, height: int) -> CGLContext:
    return CGLContext(width, height)
