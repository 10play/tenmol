"""The PyMOL engine: GL context + boot sequence + the per-tick draw.

Everything in this module runs on ONE thread — the engine thread owned by
:mod:`tenmol_bridge.pump`.  It is a direct transcription of
``docs/webclient/03-implementation-plan.md`` §1.1, whose steps are reproduced
in :meth:`Engine.boot` in order, with the citations that justify each one.

The single most important fact in the project: **the pump must call
``PyMOL_Draw`` every tick**.  ``cmd.refresh()`` is not a substitute.
``ExecutiveDrawNow`` drains ``OrthoDefer`` only when ``PyMOL_GetIdleAndReady``
(``layer3/Executive.cpp:11521-11523``), which is ``IdleAndReady == 3``
(``layer5/PyMOL.cpp:2560-2562``, ``IDLE_AND_READY`` at ``:105``); ``IdleAndReady``
only increments inside ``PyMOL_Idle`` while ``I->DrawnFlag`` is set
(``:2412-2416``) and ``DrawnFlag`` is only ever set inside ``PyMOL_Draw``
(``:2325``, ``:2328``).  ``CmdRefresh`` never sets it.  A bridge that does not
draw drains no clicks, no drags, no deferred ``png``, no deferred ``ray``, and
no ``ModalDraw`` — silently.
"""

from __future__ import annotations

import sys
import threading
import time
from typing import Any, Dict, Optional

from .config import BridgeConfig, log
from .errors import NoOffscreenGL, PyMOLUnavailable

__all__ = ["Engine", "EngineState"]


class EngineState:
    NEW = "new"
    BOOTING = "booting"
    RUNNING = "running"
    #: PyMOL is up but there is no GL context: no picking, no Mode P, and the
    #: deferred queue never drains.  Console feedback still works.
    HEADLESS = "headless"
    #: PyMOL itself is unavailable; the server stays up so the front-end is
    #: developable on a machine that never built PyMOL.
    DEGRADED = "degraded"
    STOPPED = "stopped"


class Engine:
    """Owns the GL context, the PyMOL instance and the draw pump's tick.

    Not thread-safe by design: every method must be called on the thread that
    called :meth:`boot`.  :meth:`assert_thread` enforces it in debug paths.
    """

    def __init__(self, config: Optional[BridgeConfig] = None) -> None:
        self.config = config or BridgeConfig()
        self.state = EngineState.NEW
        self.error: Optional[BaseException] = None

        self.pymol: Any = None
        self.p: Any = None  # pymol2.SingletonPyMOL
        self.cmd: Any = None
        self._cmd: Any = None  # the C extension, for symbols with no wrapper
        self.context: Any = None  # glcontext.Context

        self.width = self.config.width
        self.height = self.config.height
        self.thread_ident: Optional[int] = None
        self.glut_thread: Optional[int] = None

        self.ticks = 0
        self.draws = 0
        self.last_tick_ms = 0.0
        self.boot_seconds = 0.0
        self.gl_info: Dict[str, Any] = {}
        self.pymol_version = "unavailable"

        self._pcatch_installed = False
        self._saved_stdout = None
        self._saved_stderr = None

    # ------------------------------------------------------------------ boot

    def boot(self) -> None:
        """Plan §1.1, in order.  Call once, on the engine thread."""
        t0 = time.monotonic()
        self.thread_ident = threading.get_ident()
        self.state = EngineState.BOOTING

        # -- 1. GL context FIRST, before pymol2.SingletonPyMOL().start().
        # PyMOL adopts whatever framebuffer is bound at its first draw:
        # check_gl_stereo_capable reads GL_FRAMEBUFFER_BINDING into
        # G->ShaderMgr->defaultBackbuffer.framebuffer (layer5/PyMOL.cpp:2236-2239).
        # So our FBO must already be bound and current on THIS thread.
        have_gl = self._create_context()

        if self.config.force_no_pymol:
            # TENMOL_BRIDGE_FORCE_NO_PYMOL=1 / --no-pymol: prove the degraded
            # path on a machine that HAS PyMOL, so the front-end's
            # "PyMOLUnavailable" handling stays exercised.
            self.state = EngineState.DEGRADED
            self.error = ImportError("PyMOL disabled by configuration")
            self.boot_seconds = time.monotonic() - t0
            log("engine degraded on purpose (force_no_pymol)")
            return

        try:
            import pymol  # noqa: WPS433 - deliberately late
            import pymol2
        except Exception as exc:  # noqa: BLE001
            self.state = EngineState.DEGRADED
            self.error = exc
            log("PyMOL unavailable: %r - running degraded" % (exc,))
            self._release_context()
            return

        self.pymol = pymol

        # -- 2. Options are snapshotted into CPyMOLOptions at _cmd._new
        # (layer1/P.cpp:1800-1830), so every option must be set BEFORE start().
        # Setting them afterwards has no effect at all.
        options = pymol.invocation.options
        #  no_gui = 0  =>  pmgui = 1  =>  OrthoFeedbackIn() queues console text
        #  (layer1/Ortho.cpp:492-499, layer1/P.cpp:1820).  NEVER use -c/-cq:
        #  it sets no_gui=1 (modules/pymol/invocation.py:401) and the feedback
        #  queue is then dead for the life of the process (spike 02 §2a).
        options.no_gui = 0
        #  Window coords == viewport coords.  With the defaults on,
        #  reshape(640,480) yields get_viewport() == (420,462) and every mouse
        #  coordinate the browser sends is wrong (spike 04 §7.1 item 3).
        options.internal_gui = 0
        options.internal_feedback = 0
        options.external_gui = 0
        options.show_splash = 1 if self.config.splash else 0
        options.read_stdin = 0
        options.sigint_handler = 0  # a server owns its own signal handling
        options.quiet = 1 if self.config.quiet else 0

        # -- 3. SingletonPyMOL, never pymol2.PyMOL.  pcatch writes through the
        # file-scope SingletonPyMOLGlobals pointer (layer1/P.cpp:2667); with a
        # non-singleton that pointer is null and pcatch silently DISCARDS every
        # print() - worse than not installing it (spike 02 §2c).
        try:
            self.p = pymol2.SingletonPyMOL()
            self.p.start()
        except Exception as exc:  # noqa: BLE001
            self.state = EngineState.DEGRADED
            self.error = exc
            log("PyMOL failed to start: %r" % (exc,))
            self._release_context()
            return

        self.cmd = self.p.cmd
        try:
            from pymol import _cmd as _cmd_module

            self._cmd = _cmd_module
        except Exception:  # noqa: BLE001
            self._cmd = None

        # -- 4. Python-origin output into the same line buffer as C-origin
        # output, correctly interleaved (spike 02 §2b: `iterate`'s user print
        # lands between the PyMOL> echo and the C summary).
        self._install_pcatch()

        # -- 5. Critique A4.  locking.is_gui_thread() is
        # `gui_ident is None or gui_ident == get_ident()`
        # (modules/pymol/locking.py:80-86) reading pymol.glutThread, which is
        # module-level None (modules/pymol/__init__.py:543) and which
        # SingletonPyMOL.start() never sets.  Without this line EVERY thread is
        # "the GUI thread" and the ordering guarantee is fiction.
        pymol.glutThread = self.thread_ident
        self.glut_thread = pymol.glutThread

        # -- 6. Belt and braces on top of the options above.
        try:
            self.cmd.set("internal_gui", 0)
            self.cmd.set("internal_feedback", 0)
            # internal_gui/internal_feedback are NOT sufficient: OrthoReshape
            # (layer1/Ortho.cpp:2383-2390) also subtracts MovieGetPanelHeight(),
            # so the moment any object has >1 state cmd.get_viewport() silently
            # loses ~15 px against the window and the web client's canvas no
            # longer matches the scene rectangle. The web client draws its own
            # movie controls, so the built-in panel is dead weight.
            self.cmd.set("movie_panel", 0)
        except Exception as exc:  # noqa: BLE001
            log("could not clear internal_gui/internal_feedback: %r" % (exc,))
        self.p.reshape(self.width, self.height, 1)

        # -- 7. >= 3 warm-up draws before accepting input.  IDLE_AND_READY == 3
        # (layer5/PyMOL.cpp:105); until IdleAndReady reaches it,
        # OrthoExecDeferred never runs and the first click is swallowed.
        if have_gl:
            for _ in range(max(3, self.config.warmup_draws)):
                self.p.draw()
                self.draws += 1
                self.p.idle()
            self.state = EngineState.RUNNING
        else:
            for _ in range(max(3, self.config.warmup_draws)):
                self.p.idle()
            self.state = EngineState.HEADLESS

        try:
            version = self.cmd.get_version()
            self.pymol_version = str(version[0])
        except Exception:  # noqa: BLE001
            self.pymol_version = "unknown"

        self.boot_seconds = time.monotonic() - t0
        log(
            "engine %s: PyMOL %s, thread %s, glutThread %s, %dx%d, gl=%s"
            % (
                self.state,
                self.pymol_version,
                self.thread_ident,
                self.glut_thread,
                self.width,
                self.height,
                self.gl_info.get("renderer", "none"),
            )
        )

    # ----------------------------------------------------------------- tick

    def tick(self) -> bool:
        """One pump tick: ``p.idle()`` then ``p.draw()``.

        Returns True if PyMOL reported it did idle work.  ``draw()`` is
        unconditional and MANDATORY (see the module docstring) — it is what
        drains ``OrthoDefer``, clears ``I->ModalDraw``
        (``layer5/PyMOL.cpp:2279-2286``) and runs ``SeqUpdate``
        (``layer1/Ortho.cpp:1470-1478,1882``).
        """
        t0 = time.perf_counter()
        did_work = False
        if self.p is not None:
            did_work = bool(self.p.idle())
            if self.state == EngineState.RUNNING:
                self.p.draw()
                self.draws += 1
        self.ticks += 1
        self.last_tick_ms = (time.perf_counter() - t0) * 1000.0
        return did_work

    def resize(self, width: int, height: int) -> None:
        """Resize the offscreen surface and PyMOL's window in lockstep.

        The FBO NAME must survive: ``defaultBackbuffer.framebuffer`` is latched
        at the first draw (``layer5/PyMOL.cpp:2236-2239``); regenerating the FBO
        would leave PyMOL drawing into a deleted object.  ``Context.resize``
        re-storages the same name (spike 04 §4: id stable at 1 across four
        resizes).
        """
        width = max(1, int(width))
        height = max(1, int(height))
        if self.context is not None:
            self.context.resize(width, height)
        self.width, self.height = width, height
        if self.p is not None:
            self.p.reshape(width, height, 1)

    # -------------------------------------------------------------- shutdown

    def shutdown(self) -> None:
        if self.state == EngineState.STOPPED:
            return
        # pcatch MUST come out before p.stop(): SingletonPyMOLGlobals is nulled
        # in PyMOL_Stop (layer5/PyMOL.cpp:2075-2076) and a still-installed
        # pcatch then drops every subsequent write on the floor (spike 02 §9).
        self._uninstall_pcatch()
        if self.p is not None:
            try:
                self.p.stop()
            except Exception as exc:  # noqa: BLE001
                log("p.stop() raised: %r" % (exc,))
            self.p = None
            self.cmd = None
        if self.pymol is not None:
            try:
                self.pymol.glutThread = None
            except Exception:  # noqa: BLE001
                pass
        self._release_context()
        self.state = EngineState.STOPPED

    # --------------------------------------------------------------- status

    def status(self) -> Dict[str, Any]:
        return {
            "state": self.state,
            "pymolVersion": self.pymol_version,
            "threadIdent": self.thread_ident,
            "glutThread": self.glut_thread,
            "ticks": self.ticks,
            "draws": self.draws,
            "lastTickMs": round(self.last_tick_ms, 3),
            "bootSeconds": round(self.boot_seconds, 3),
            "width": self.width,
            "height": self.height,
            "gl": self.gl_info,
            "error": repr(self.error) if self.error is not None else None,
        }

    def assert_thread(self) -> None:
        if self.thread_ident is not None and threading.get_ident() != self.thread_ident:
            raise RuntimeError(
                "PyMOL touched from thread %s; the engine thread is %s"
                % (threading.get_ident(), self.thread_ident)
            )

    def require_pymol(self) -> Any:
        if self.cmd is None:
            raise PyMOLUnavailable(
                "PyMOL is not available in this bridge process: %r" % (self.error,)
            )
        return self.cmd

    # -------------------------------------------------------------- internals

    def _create_context(self) -> bool:
        if self.config.force_no_pymol:
            return False
        from . import glcontext

        try:
            self.context = glcontext.create_context(self.width, self.height)
        except NoOffscreenGL as exc:
            self.context = None
            self.gl_info = {"available": False, "reason": str(exc)}
            if self.config.require_gl:
                # Not fatal: a bridge with no GL is still useful for RPC and
                # for the console, it just cannot pick or stream pixels.  We
                # log loudly instead of refusing to start.
                log("NO OFFSCREEN GL: %s - picking and Mode P are disabled" % exc)
            return False
        info = self.context.info()
        info["available"] = True
        self.gl_info = info
        return True

    def _release_context(self) -> None:
        if self.context is not None:
            try:
                self.context.release()
            except Exception:  # noqa: BLE001
                pass
            self.context = None

    def _install_pcatch(self) -> None:
        """Route Python-origin output into PyMOL's own line buffer.

        ``pcatch`` is a built-in module created by the PyMOL C extension, so it
        is only importable after ``start()``.  ``_install()`` assigns
        ``sys.stderr = sys.stdout = pcatch`` — which is exactly why
        :func:`tenmol_bridge.config.log` writes to the *saved* real stderr.
        """
        try:
            import pcatch
        except Exception as exc:  # noqa: BLE001
            log("pcatch unavailable (%r): Python console output will be lost" % (exc,))
            return
        self._saved_stdout, self._saved_stderr = sys.stdout, sys.stderr
        pcatch._install()
        self._pcatch_installed = True

    def _uninstall_pcatch(self) -> None:
        if not self._pcatch_installed:
            return
        sys.stdout = self._saved_stdout or sys.__stdout__
        sys.stderr = self._saved_stderr or sys.__stderr__
        self._pcatch_installed = False

    # -- convenience used by the pump and by later work packages ------------

    def button(self, button: int, state: int, x: int, y: int, modifiers: int) -> None:
        """``PyMOL_Button``.  Bottom-left origin; flip the browser's clientY.

        ``P_GLUT_LEFT/MIDDLE/RIGHT = 0/1/2``, ``DOWN/UP = 0/1``
        (``layer0/os_gl_glut_pretend.h:11-26``); ``modifiers`` is the ``cOrtho``
        bitmask ``SHIFT=1 CTRL=2 ALT=4``.
        """
        self.p.button(int(button), int(state), int(x), int(y), int(modifiers))

    def drag(self, x: int, y: int, modifiers: int) -> None:
        """``PyMOL_Drag``."""
        self.p.drag(int(x), int(y), int(modifiers))

    def redisplay(self, reset: bool = True) -> bool:
        """``PyMOL_GetRedisplay``.

        DESTRUCTIVE when ``reset`` is true — the bridge is the exclusive
        consumer (plan §1.2).  Mode P (WP-04) gates frame emission on it.
        """
        return bool(self.p.getRedisplay(reset))
