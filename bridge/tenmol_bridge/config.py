"""Bridge configuration, and the one logging function the bridge may use.

THE LOGGING RULE (plan §1.1, "Gotcha the bridge must honour")
-------------------------------------------------------------
After ``pcatch._install()`` the built-in ``pcatch`` module IS ``sys.stdout``
**and** ``sys.stderr`` (``modules/pmg_qt/pymol_gl_widget.py:99-105``; spike 02
§8).  So from that moment on, any ``print()`` or ``sys.stderr.write()`` in this
process lands in ``cmd._get_feedback()`` and pollutes the user's PyMOL console
— exactly what happened in the plan's own §1.1 transcript, where the harness's
``pmgui(no_gui)= 0`` / ``viewport (800, 600)`` diagnostics showed up in the
drained feedback list.

:func:`log` therefore writes to the *real* process stderr captured at import
time (before any engine exists), never to ``sys.stderr``.  WP-02's acceptance
test asserts that no bridge log line ever appears in ``_get_feedback()``.
"""

from __future__ import annotations

import os
import secrets
import sys
import time
from dataclasses import dataclass, field
from typing import IO, List, Optional, Sequence

__all__ = [
    "DEFAULT_HOST",
    "DEFAULT_PORT",
    "DEFAULT_WIDTH",
    "DEFAULT_HEIGHT",
    "BridgeConfig",
    "log",
    "real_stderr",
    "set_log_enabled",
    "mint_token",
    "write_token_file",
]

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_WIDTH = 1280
DEFAULT_HEIGHT = 960

# Captured at import time, i.e. before pcatch can replace sys.stderr.
_REAL_STDERR: Optional[IO[str]] = sys.stderr
_LOG_ENABLED = os.environ.get("TENMOL_BRIDGE_QUIET", "") not in ("1", "true", "yes")
_T0 = time.monotonic()


def real_stderr() -> Optional[IO[str]]:
    """The process stderr as it was before PyMOL/pcatch touched anything."""
    return _REAL_STDERR


def set_log_enabled(enabled: bool) -> None:
    global _LOG_ENABLED
    _LOG_ENABLED = bool(enabled)


def log(message: str) -> None:
    """Write one bridge log line to the real stderr. Never to stdout.

    Also flushes unconditionally: PyMOL tears the process down with C
    ``exit()`` (``layer5/main.cpp``; spike 00 §6.2), skipping ``atexit`` and
    ``Py_FinalizeEx``, so buffered output is lost.
    """
    if not _LOG_ENABLED:
        return
    line = "[tenmol-bridge %7.3f] %s\n" % (time.monotonic() - _T0, message)
    stream = _REAL_STDERR
    if stream is not None:
        try:
            stream.write(line)
            stream.flush()
            return
        except (ValueError, OSError):
            pass  # closed under us (pytest teardown); fall through to fd 2
    try:
        os.write(2, line.encode("utf-8", "replace"))
    except OSError:
        pass


# -- the session token ------------------------------------------------------


def mint_token() -> str:
    """A 256-bit session token (plan §A6: the boundary is the transport)."""
    return secrets.token_hex(32)


def write_token_file(path: str, token: str) -> str:
    """Persist the token with mode 0600 so only this user can read it."""
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    fd = os.open(path, flags, 0o600)
    try:
        os.write(fd, token.encode("ascii"))
    finally:
        os.close(fd)
    os.chmod(path, 0o600)
    return path


def _default_origins() -> List[str]:
    # Vite dev server + the packaged app, both loopback only.
    #
    # The RANGE matters: apps/web/vite.config.ts sets `strictPort: false`, so a
    # dev server that finds 5173 taken silently binds 5174, 5175, ... and the
    # socket would be rejected with 4403 for a reason no one can see from the
    # browser. Loopback + token are the actual boundary (plan §A6); Origin is a
    # CSRF nicety and must not be the thing that breaks `pnpm dev`.
    out: List[str] = []
    for port in list(range(5173, 5184)) + list(range(4173, 4184)):
        out.append("http://127.0.0.1:%d" % port)
        out.append("http://localhost:%d" % port)
    return out


@dataclass
class BridgeConfig:
    """Everything the bridge can be told at startup."""

    # -- transport ----------------------------------------------------------
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    #: extra allowed ``Origin`` values on top of :func:`_default_origins`
    origins: List[str] = field(default_factory=_default_origins)
    #: ``""`` means "mint one at startup". ``None`` disables token checking
    #: (tests only; the server logs loudly).
    token: Optional[str] = ""
    #: where to drop the token file (mode 0600) for the launcher to read
    token_path: Optional[str] = None
    #: refuse non-loopback peers, the way ``pymolhttpd.py:61-68`` does
    require_loopback_peer: bool = True

    # -- engine -------------------------------------------------------------
    width: int = DEFAULT_WIDTH
    height: int = DEFAULT_HEIGHT
    #: pump rate. 60 Hz per plan §1.1; MUST stay well under the 150 ms
    #: single-click floor (``I->SingleClickDelay``, layer1/SceneMouse.cpp:1152).
    tick_hz: float = 60.0
    #: the 10 Hz lock-ATTEMPTING status thread (plan §1.1 threading table)
    status_hz: float = 10.0
    #: >= 3 (IDLE_AND_READY == 3, layer5/PyMOL.cpp:105). 5 for margin.
    warmup_draws: int = 5
    #: PyMOL's splash banner in the console feedback
    splash: bool = False
    #: passed through to ``invocation.options.quiet``; NEVER forced to 1
    #: (critique C4 — several parity rows need quiet=0 output).
    quiet: bool = False
    #: run without a GL context (degraded: no picking, no Mode P). Only for
    #: environments where :func:`glcontext.create_context` cannot succeed.
    require_gl: bool = True

    # -- lifecycle ----------------------------------------------------------
    log_level: str = "info"
    #: force the "PyMOL is not importable" path (front-end development)
    force_no_pymol: bool = False

    def __post_init__(self) -> None:
        if not self.force_no_pymol:
            self.force_no_pymol = os.environ.get(
                "TENMOL_BRIDGE_FORCE_NO_PYMOL", ""
            ) in ("1", "true", "yes")
        if self.token == "":
            self.token = mint_token()

    # -- helpers ------------------------------------------------------------

    @property
    def tick_interval(self) -> float:
        return 1.0 / max(self.tick_hz, 1.0)

    @property
    def status_interval(self) -> float:
        return 1.0 / max(self.status_hz, 1.0)

    def origin_allowed(self, origin: Optional[str]) -> bool:
        """``Origin`` allow-list.

        A missing ``Origin`` header is allowed: non-browser clients (the
        bridge's own tests, ``curl``, the packaged shell) do not send one, and
        the loopback peer check plus the token are what actually gate access.
        """
        if not origin:
            return True
        return origin in self.origins

    def peer_allowed(self, host: Optional[str]) -> bool:
        if not self.require_loopback_peer:
            return True
        if not host:
            return False
        return host in ("127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1")

    def token_ok(self, presented: Optional[str]) -> bool:
        if self.token is None:
            return True
        if not presented:
            return False
        return secrets.compare_digest(str(presented), str(self.token))


def coerce_origins(values: Optional[Sequence[str]]) -> List[str]:
    out = _default_origins()
    for value in values or ():
        if value not in out:
            out.append(value)
    return out
