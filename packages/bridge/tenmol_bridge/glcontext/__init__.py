"""Offscreen OpenGL provisioning, platform-dispatched.

The engine thread needs a *real* hardware GL context before PyMOL starts,
because ``PyMOL_DrawWithoutLock`` assigns ``G->HaveGUI = G->Option->pmgui``
(``packages/engine/layer5/PyMOL.cpp:2248``) and then calls ``glGetString``
(``packages/engine/layer5/PyMOL.cpp:2307``) — and because with ``HaveGUI == 0`` the entire body
of ``SceneRender`` is skipped (``packages/engine/layer1/SceneRender.cpp:270``), which silently
kills every pick.  See ``docs/spikes/04-picking.md``.

THE INTERFACE (agreed across WP-02 and the EGL/WGL work package)
----------------------------------------------------------------
``create_context(width, height) -> Context`` where ``Context`` provides:

    ``make_current()``      bind this context to the *calling* thread
    ``resize(w, h)``        re-storage the SAME FBO's renderbuffers
    ``release()``           unbind + destroy
    ``info() -> dict``      vendor/renderer/version/backend/fbo/size/...

and the attributes ``width``, ``height``, ``fbo``, ``backend``.

Two rules every backend must honour:

1. **Contexts are per-thread.**  ``create_context`` must be called on the
   thread that will own PyMOL, and ``make_current`` re-binds on that thread.
   Calling ``PyMOL_Draw`` from a thread that does not hold the context
   segfaults at ``glGetString`` (spike 04 §7.1 item 9).
2. **Never regenerate the FBO on resize.**  ``check_gl_stereo_capable``
   latches ``G->ShaderMgr->defaultBackbuffer.framebuffer`` from
   ``GL_FRAMEBUFFER_BINDING`` on the first draw (``packages/engine/layer5/PyMOL.cpp:2236-2239``).
   Resize re-storages the attachments of the *same* FBO name; spike 04 §4
   verified the id stays 1 across 640x480 -> 1280x800 -> 400x300 -> 1920x1080.

Backends
--------
======== ============================ ===================================
platform module                       owner
======== ============================ ===================================
darwin   ``glcontext.cgl``            WP-02 (this package) — implemented
linux    ``glcontext.egl``            cross-platform GL work package
win32    ``glcontext.wgl``            cross-platform GL work package
======== ============================ ===================================

Missing backends raise :class:`tenmol_bridge.errors.NoOffscreenGL`; they are
imported **lazily** so this package imports cleanly on every platform.
"""

from __future__ import annotations

import importlib
import sys
from typing import Any, Dict, Optional, Protocol, runtime_checkable

from ..errors import NoOffscreenGL

__all__ = [
    "Context",
    "create_context",
    "backend_for_platform",
    "available",
    "NoOffscreenGL",
]


@runtime_checkable
class Context(Protocol):
    """The offscreen GL context interface (see the module docstring)."""

    width: int
    height: int
    fbo: int
    backend: str

    def make_current(self) -> None:
        ...

    def resize(self, width: int, height: int) -> None:
        ...

    def release(self) -> None:
        ...

    def info(self) -> Dict[str, Any]:
        ...


#: platform prefix -> submodule name.  Matched with ``str.startswith`` so
#: ``linux``/``linux2`` and ``freebsd*`` behave.
_BACKENDS = (
    ("darwin", "cgl"),
    ("linux", "egl"),
    ("freebsd", "egl"),
    ("win32", "wgl"),
    ("cygwin", "wgl"),
)


def backend_for_platform(platform: Optional[str] = None) -> str:
    """Return the backend module name for ``platform`` (default ``sys.platform``)."""
    platform = platform or sys.platform
    for prefix, module in _BACKENDS:
        if platform.startswith(prefix):
            return module
    raise NoOffscreenGL(
        "no offscreen GL backend for platform %r" % platform,
        platform=platform,
        reason="unsupported-platform",
    )


def _load_backend(platform: Optional[str] = None):
    name = backend_for_platform(platform)
    try:
        return importlib.import_module("%s.%s" % (__name__, name))
    except NoOffscreenGL:
        raise
    except ImportError as exc:
        raise NoOffscreenGL(
            "offscreen GL backend %r is not implemented in this build "
            "(platform %r): %s" % (name, platform or sys.platform, exc),
            platform=platform or sys.platform,
            backend=name,
            reason="backend-missing",
        ) from exc


def create_context(width: int, height: int) -> Context:
    """Create an offscreen GL context + FBO, current on the CALLING thread.

    Raises :class:`~tenmol_bridge.errors.NoOffscreenGL` if this platform has no
    implementation or the driver refuses (e.g. a macOS ``launchd`` daemon with
    no WindowServer session — spike 04 §7.3).
    """
    if width <= 0 or height <= 0:
        raise NoOffscreenGL(
            "invalid offscreen size %dx%d" % (width, height),
            platform=sys.platform,
            reason="bad-size",
        )
    backend = _load_backend()
    return backend.create_context(int(width), int(height))


def available(platform: Optional[str] = None) -> bool:
    """True if a backend module for ``platform`` can be imported.

    Does **not** create a context, so it is cheap and side-effect free; a
    successful import still does not guarantee a WindowServer/EGL device.
    """
    try:
        _load_backend(platform)
    except NoOffscreenGL:
        return False
    return True
