"""Typed errors for the bridge.

Every failure that reaches the wire is one of the ``kind`` values below.  The
TypeScript side (``packages/protocol/src/errors.ts``, WP-01) mirrors this exact
set:

    CmdException | QuietException | IncentiveOnly | NotAllowed
    | NotSerializable | PythonError

plus the transport/lifecycle kinds this module adds for the bridge itself
(``PyMOLUnavailable``, ``NoOffscreenGL``, ``BadMessage``, ``Timeout``,
``EngineNotRunning``, ``Shutdown``).

Nothing here imports PyMOL, asyncio or FastAPI: ``errors`` is the bottom of the
import graph so tests can exercise it with no engine.
"""

from __future__ import annotations

import traceback as _traceback
from typing import Any, Dict, Optional

__all__ = [
    "KIND_CMD_EXCEPTION",
    "KIND_QUIET_EXCEPTION",
    "KIND_INCENTIVE_ONLY",
    "KIND_NOT_ALLOWED",
    "KIND_NOT_SERIALIZABLE",
    "KIND_PYTHON_ERROR",
    "KIND_PYMOL_UNAVAILABLE",
    "KIND_NO_OFFSCREEN_GL",
    "KIND_BAD_MESSAGE",
    "KIND_TIMEOUT",
    "KIND_ENGINE_NOT_RUNNING",
    "KIND_SHUTDOWN",
    "WIRE_KINDS",
    "BridgeError",
    "NotAllowed",
    "NotSerializable",
    "IncentiveOnly",
    "PyMOLUnavailable",
    "NoOffscreenGL",
    "BadMessage",
    "EngineNotRunning",
    "EngineTimeout",
    "Shutdown",
    "classify",
    "error_payload",
]

# -- the wire vocabulary ----------------------------------------------------

KIND_CMD_EXCEPTION = "CmdException"
KIND_QUIET_EXCEPTION = "QuietException"
KIND_INCENTIVE_ONLY = "IncentiveOnly"
KIND_NOT_ALLOWED = "NotAllowed"
KIND_NOT_SERIALIZABLE = "NotSerializable"
KIND_PYTHON_ERROR = "PythonError"
KIND_PYMOL_UNAVAILABLE = "PyMOLUnavailable"
KIND_NO_OFFSCREEN_GL = "NoOffscreenGL"
KIND_BAD_MESSAGE = "BadMessage"
KIND_TIMEOUT = "Timeout"
KIND_ENGINE_NOT_RUNNING = "EngineNotRunning"
KIND_SHUTDOWN = "Shutdown"

#: Frozen. A new kind is a protocol change, agreed with WP-01.
WIRE_KINDS = frozenset(
    {
        KIND_CMD_EXCEPTION,
        KIND_QUIET_EXCEPTION,
        KIND_INCENTIVE_ONLY,
        KIND_NOT_ALLOWED,
        KIND_NOT_SERIALIZABLE,
        KIND_PYTHON_ERROR,
        KIND_PYMOL_UNAVAILABLE,
        KIND_NO_OFFSCREEN_GL,
        KIND_BAD_MESSAGE,
        KIND_TIMEOUT,
        KIND_ENGINE_NOT_RUNNING,
        KIND_SHUTDOWN,
    }
)


# -- exception types --------------------------------------------------------


class BridgeError(Exception):
    """Base for every error the bridge raises on purpose."""

    kind = KIND_PYTHON_ERROR

    def __init__(self, message: str, **detail: Any) -> None:
        super().__init__(message)
        self.detail: Dict[str, Any] = detail


class NotAllowed(BridgeError):
    """The capability policy refused the call (see :mod:`tenmol_bridge.policy`).

    Note that the v1 policy is a *grant* policy, not a deny-list: ``system``,
    ``run``, ``cd``, ``quit`` and ``t:'do'`` are all allowed (plan §A6).  This
    is raised for malformed/unresolvable symbols and for the small set of
    calls that require an unconfirmed confirmation.
    """

    kind = KIND_NOT_ALLOWED


class NotSerializable(BridgeError):
    """A return value has no entry in the codec table (plan §B8)."""

    kind = KIND_NOT_SERIALIZABLE


class IncentiveOnly(BridgeError):
    """The symbol exists but raises ``IncentiveOnlyException`` in this tree."""

    kind = KIND_INCENTIVE_ONLY


class PyMOLUnavailable(BridgeError):
    """PyMOL could not be imported or started; the bridge runs degraded.

    The server stays up so the front-end is developable on a machine that has
    never built PyMOL; every engine-bound RPC answers with this kind.
    """

    kind = KIND_PYMOL_UNAVAILABLE


class NoOffscreenGL(BridgeError):
    """No offscreen OpenGL context is available on this platform/session.

    Raised by :func:`tenmol_bridge.glcontext.create_context`.  Carries
    ``platform`` and ``reason`` in :attr:`detail`.
    """

    kind = KIND_NO_OFFSCREEN_GL


class BadMessage(BridgeError):
    """A client frame is malformed."""

    kind = KIND_BAD_MESSAGE


class EngineNotRunning(BridgeError):
    """An engine-bound RPC arrived before the engine thread was ready to serve it."""

    kind = KIND_ENGINE_NOT_RUNNING


class EngineTimeout(BridgeError):
    """An engine call did not complete within its deadline."""

    kind = KIND_TIMEOUT


class Shutdown(BridgeError):
    """The bridge is shutting down and refused the request."""

    kind = KIND_SHUTDOWN


# -- classification of foreign exceptions -----------------------------------


def classify(exc: BaseException) -> str:
    """Map any exception onto a wire ``kind``.

    PyMOL's own exception classes live in ``pymol.CmdException`` /
    ``pymol.QuietException`` (``packages/engine/modules/pymol/__init__.py``) and
    ``IncentiveOnlyException`` is a subclass of ``CmdException``
    (``packages/engine/modules/pymol/__init__.py``), so the subclass check must come first.
    We match by class *name* walking the MRO so this module never has to
    import PyMOL.
    """
    if isinstance(exc, BridgeError):
        return exc.kind
    names = {klass.__name__ for klass in type(exc).__mro__}
    if "IncentiveOnlyException" in names:
        return KIND_INCENTIVE_ONLY
    if "QuietException" in names:
        return KIND_QUIET_EXCEPTION
    if "CmdException" in names:
        return KIND_CMD_EXCEPTION
    return KIND_PYTHON_ERROR


def error_payload(exc: BaseException, include_traceback: bool = True) -> Dict[str, Any]:
    """The ``error`` object of an ``err`` frame."""
    kind = classify(exc)
    message = str(exc) or type(exc).__name__
    payload: Dict[str, Any] = {
        "kind": kind,
        # ``type`` is the concrete Python class, kept for debuggability; the
        # client switches on ``kind``, never on ``type``.
        "type": type(exc).__name__,
        "message": message,
    }
    detail: Optional[Dict[str, Any]] = getattr(exc, "detail", None)
    if detail:
        payload["detail"] = detail
    if include_traceback and kind in (KIND_PYTHON_ERROR, KIND_CMD_EXCEPTION):
        payload["traceback"] = "".join(
            _traceback.format_exception(type(exc), exc, exc.__traceback__)
        )
    else:
        payload["traceback"] = ""
    return payload
