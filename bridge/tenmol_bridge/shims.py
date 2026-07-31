"""The five GUI seams PyMOL leaves for a front-end to fill in.

Complete in wave 0 and then frozen (plan §5.2): later work packages *register
handlers*, they never edit this file.

============================  ==============================================
seam                          why the bridge must own it
============================  ==============================================
``cmd._copy_image``           default raises ``NotImplementedError``
                              (``modules/pymol/internal.py:272-274``, "may be
                              monkey-patched by GUI implementations"); it is
                              what ``cmd.copy_image`` calls
                              (``modules/pymol/exporting.py:36``)
``cmd._call_in_gui_thread``   default ``lambda func: func()``
                              (``modules/pymol/cmd.py:164``) — correct only
                              when the caller already IS the GUI thread
``cmd._call_with_opengl_context``  default ``lambda func: func()`` is NOT
                              sufficient — see the MEASURED CORRECTION below
``pymol.gui.createlegacypmgapp``  would build a real hidden ``tkinter.Tk()``
                              root through
                              ``pymol.plugins.legacysupport`` (plan §7.2.8)
``window_cmd``                ``cmd.window()`` routes to
                              ``get_qtwindow().window_cmd(...)`` when a window
                              object exists (``modules/pymol/viewing.py:1449-1453``);
                              otherwise it calls ``_cmd.window`` on a window
                              that does not exist in this process
============================  ==============================================

MEASURED CORRECTION to plan §A4 ("leave ``_call_with_opengl_context`` at its
default")
--------------------------------------------------------------------------
The default is **not** correct, and the failure is silent.  ``G->ValidContext``
is a counter incremented ONLY inside ``PyMOL_Draw`` (``PyMOL_PushValidContext``,
``layer5/PyMOL.cpp:2940-2949``, called at ``:2281`` in the ``ModalDraw`` branch
and ``:2303`` in the normal branch).  Holding the CGL context current on the
engine thread does not set it — it is PyMOL's own flag, not GL state.  Every
render path gated on ``G->HaveGUI && G->ValidContext`` therefore does nothing
when reached from a plain ``cmd`` call:

* ``SceneMakeMovieImage``'s ``cSceneImage_Normal`` branch
  (``layer1/Scene.cpp:2347-2361``) — so ``cmd.png()`` **with no explicit size**
  writes no file, and ``cmd.mpng(prefix)`` (``modal=0``) prints
  ``MoviePNG-Error: Missing rendered image.`` once per frame and produces zero
  PNGs.  Both measured on this machine; the same ``mpng`` with ``modal=1``
  (which runs inside ``PyMOL_Draw``'s ModalDraw branch, where the context IS
  pushed) produced ``['f0001.png','f0002.png','f0003.png']``.

The fix is not the Qt shim.  ``modules/pmg_qt/pymol_gl_widget.py:51-62`` is
``makeCurrent()`` + ``pymol._cmd._pushValidContext(COb)``; the ``makeCurrent``
half is Qt-specific and irrelevant here (our CGL context is already current on
the engine thread and never unbound), but the push/pop half is a **real,
registered C API** — ``_pushValidContext`` / ``_popValidContext``,
``layer4/Cmd.cpp:6379-6380`` — and it is exactly what is missing.  So this
module installs::

    _call_with_opengl_context(func) = marshal onto the engine thread
                                    + _pushValidContext
                                    + func()
                                    + _popValidContext

which covers all five callers: ``png`` (``exporting.py:602``), ``refresh``
(``internal.py:555``), ``scene`` (``viewing.py:1125``), ``draw``
(``viewing.py:1660``) and ``mpng`` (``moving.py:434``).
"""

from __future__ import annotations

import threading
from typing import Any, Callable, Dict, List, Optional

from .config import log
from .errors import BridgeError

__all__ = ["BridgeWindow", "Shims", "HANDLER_NAMES"]

#: Handlers later work packages may register.  Registering an unknown name is
#: an error, so a typo cannot silently do nothing.
HANDLER_NAMES = (
    "copy_image",  # WP-19 (render pipeline / clipboard)
    "window",  # WP-07 (shell): show/hide/position the browser window
    "session_save_as",  # WP-18 (file dialogs)
    "file_save_png",  # WP-18 / WP-19
)


class BridgeWindow:
    """Duck-types just enough of ``pmg_qt``'s window for ``modules/pymol``.

    ``pymol/gui.py`` calls exactly three methods on the object returned by
    ``get_qtwindow()``: ``window_cmd`` (from ``cmd.window``),
    ``session_save_as`` and ``file_save_png``.  Anything it cannot service is
    reported to the console rather than raising into PyMOL's lock.
    """

    def __init__(self, shims: "Shims") -> None:
        self._shims = shims

    def window_cmd(self, action: int, x: int, y: int, width: int, height: int) -> None:
        self._shims.dispatch(
            "window",
            {"action": int(action), "x": int(x), "y": int(y),
             "width": int(width), "height": int(height)},
        )

    def session_save_as(self) -> None:
        self._shims.dispatch("session_save_as", {})

    def file_save_png(self) -> None:
        self._shims.dispatch("file_save_png", {})

    def __repr__(self) -> str:  # shows up in PyMOL tracebacks
        return "<tenmol BridgeWindow>"


class Shims:
    """Installs and removes the five seams.  One instance per process."""

    def __init__(self, pump: Any = None) -> None:
        self.pump = pump
        self.window = BridgeWindow(self)
        self._handlers: Dict[str, Callable[[Dict[str, Any]], Any]] = {}
        self._installed = False
        self._saved: Dict[str, Any] = {}
        self._pending: List[Dict[str, Any]] = []
        self._lock = threading.Lock()

    # -- handler registry (later WPs use this; they do not edit this file) --

    def set_handler(
        self, name: str, handler: Optional[Callable[[Dict[str, Any]], Any]]
    ) -> None:
        if name not in HANDLER_NAMES:
            raise BridgeError(
                "unknown shim handler %r; known handlers are %s"
                % (name, ", ".join(HANDLER_NAMES))
            )
        with self._lock:
            if handler is None:
                self._handlers.pop(name, None)
            else:
                self._handlers[name] = handler

    def dispatch(self, name: str, payload: Dict[str, Any]) -> Any:
        with self._lock:
            handler = self._handlers.get(name)
        if handler is None:
            # Record it so the UI can show "PyMOL asked for X and nothing was
            # listening" instead of the request vanishing.
            with self._lock:
                self._pending.append({"handler": name, "payload": payload})
                del self._pending[:-64]
            log("shim %r fired with no handler registered: %r" % (name, payload))
            return None
        return handler(payload)

    def pending(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._pending)

    # -- install / uninstall ------------------------------------------------

    def install(self) -> "Shims":
        """Patch the five seams.  Call on the engine thread, after boot."""
        if self._installed:
            return self
        try:
            import pymol
            from pymol import cmd as cmd_module
            from pymol import gui as gui_module
        except Exception as exc:  # noqa: BLE001
            log("shims not installed, PyMOL unavailable: %r" % (exc,))
            return self

        self._saved = {
            "_copy_image": getattr(cmd_module, "_copy_image", None),
            "_call_in_gui_thread": getattr(cmd_module, "_call_in_gui_thread", None),
            "_call_with_opengl_context": getattr(
                cmd_module, "_call_with_opengl_context", None
            ),
            "get_qtwindow": getattr(gui_module, "get_qtwindow", None),
            "createlegacypmgapp": getattr(gui_module, "createlegacypmgapp", None),
        }

        cmd_module._copy_image = self._copy_image
        cmd_module._call_in_gui_thread = self._call_in_gui_thread
        cmd_module._call_with_opengl_context = self._call_with_opengl_context
        gui_module.get_qtwindow = lambda: self.window
        gui_module.createlegacypmgapp = self._create_legacy_pmgapp
        # pymol._ext_gui is what gui.get_pmgapp() memoises; pinning it to our
        # window keeps the legacy Tk path from ever being reached.
        pymol._ext_gui = None

        self._installed = True
        log("shims installed: _copy_image, _call_in_gui_thread, get_qtwindow, "
            "createlegacypmgapp (window_cmd via BridgeWindow)")
        return self

    def uninstall(self) -> None:
        if not self._installed:
            return
        try:
            from pymol import cmd as cmd_module
            from pymol import gui as gui_module
        except Exception:  # noqa: BLE001
            self._installed = False
            return
        for attr in ("_copy_image", "_call_in_gui_thread",
                     "_call_with_opengl_context"):
            saved = self._saved.get(attr)
            if saved is not None:
                setattr(cmd_module, attr, saved)
        for attr in ("get_qtwindow", "createlegacypmgapp"):
            saved = self._saved.get(attr)
            if saved is not None:
                setattr(gui_module, attr, saved)
        self._installed = False

    @property
    def installed(self) -> bool:
        return self._installed

    def info(self) -> Dict[str, Any]:
        return {
            "installed": self._installed,
            "handlers": sorted(self._handlers),
            "known": list(HANDLER_NAMES),
            "pending": len(self._pending),
        }

    # -- the shims themselves ----------------------------------------------

    def _copy_image(self, _self: Any = None, quiet: int = 1) -> Any:
        """``cmd.copy_image`` -> here.  The browser owns the clipboard.

        Signature matches ``internal._copy_image(_self=cmd, quiet=1)`` and the
        call site ``_self._copy_image(_self, int(quiet))``
        (``modules/pymol/exporting.py:36``), which passes ``_self``
        positionally.
        """
        return self.dispatch("copy_image", {"quiet": int(quiet)})

    def _call_in_gui_thread(self, func: Callable[[], Any]) -> Any:
        """Run ``func`` on the engine thread.

        Degenerates to the upstream default (``func()``) when the caller is
        already the engine thread, which is the normal case because every
        ``cmd`` call is marshalled there.  The off-thread branch exists for
        PyMOL's own worker threads (``_ray_spawn``, ``_object_update_spawn``,
        plugin threads), which would otherwise touch the GL context from the
        wrong thread and segfault at ``glGetString``
        (``layer5/PyMOL.cpp:2307``).
        """
        pump = self.pump
        if pump is None or getattr(pump.engine, "thread_ident", None) is None:
            return func()
        if threading.get_ident() == pump.engine.thread_ident:
            return func()
        return pump.call(lambda _engine: func(), label="_call_in_gui_thread")

    def _call_with_opengl_context(self, func: Callable[[], Any]) -> Any:
        """Run ``func`` on the engine thread with ``G->ValidContext`` pushed.

        See the MEASURED CORRECTION in the module docstring.  ``_pushValidContext``
        / ``_popValidContext`` are registered C entry points
        (``layer4/Cmd.cpp:6379-6380``); they take the raw ``_COb`` handle and do
        no locking, so calling them around ``func`` is safe even though ``func``
        itself takes the API lock.
        """
        return self._call_in_gui_thread(lambda: self._with_valid_context(func))

    @staticmethod
    def _with_valid_context(func: Callable[[], Any]) -> Any:
        try:
            import pymol
            from pymol import cmd as cmd_module

            cob = cmd_module._COb
            push = pymol._cmd._pushValidContext
            pop = pymol._cmd._popValidContext
        except Exception:  # noqa: BLE001 - degrade to the upstream default
            return func()
        if cob is None:
            return func()
        push(cob)
        try:
            return func()
        finally:
            pop(cob)

    def _create_legacy_pmgapp(self, *args: Any, **kwargs: Any) -> Any:
        """Refuse to build a Tk PMGApp.

        ``pymol.plugins.legacysupport.createlegacypmgapp`` creates a real
        hidden ``tkinter.Tk()`` root, and ``pmg_tk.mimic_tk`` installs a global
        ``sys.meta_path`` hook that still fires headlessly and hands plugins
        invisible dialogs (plan §7.2.8).  In a web client that is a hang, not a
        feature.
        """
        log("refused createlegacypmgapp(): the Tk skin does not exist in the "
            "web client (plan §7.2.7-8)")
        return None
