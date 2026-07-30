"""Resolve ``{"t":"call","fn":"..."}`` to a PyMOL callable, and run it on the pump.

Security posture (read ``bridge/README.md`` §Security before changing this)
---------------------------------------------------------------------------
This is a **local desktop replacement**: one PyMOL process, one browser, bound
to 127.0.0.1, driven by the user who already owns the shell that launched it.
Anything the bridge can do, that user can already do by typing it into PyMOL's
own command line.  So the goal of this module is *not* sandboxing - it is
(a) surface control, so a stray/hostile page cannot reach arbitrary Python by
accident, and (b) honesty about which calls are dangerous by nature.

Why a deny-list would be wrong (critique A6, 02-completeness-critique.md:100-116)
--------------------------------------------------------------------------------
``01-architecture.md:357-364`` proposed denying ``system``, ``run``, ``spawn``,
``quit``, ``_quit``, ``cd``, everything starting with ``_``, and declaring
``t:'do'`` console-only.  Each of those denials removes a feature that
``00-parity-inventory.md`` requires:

===========================  ==================================================
Denied                       Feature it breaks
===========================  ==================================================
``cmd.run`` / ``do('@f')``   File > Run Script (00:61, modules/pymol/_gui.py:118);
                             the demo wizard runs ``run $PYMOL_DATA/demo/cgo03.py``
                             (modules/pymol/wizard/demo.py:195)
``cmd.cd``                   File > Working Directory > Change (00:61)
``cmd.system``               File > Working Directory > File Browser (00:61)
``cmd.quit``                 File > Quit (00:61)
``cmd._ctrl/_alt/_ctsh``     ortho CLI chord fallback (00:110,
                             modules/pymol/internal.py:488,494,509,
                             registered in modules/pymol/keywords.py:46)
``t:'do'``                   EVERY pymol.menu popup leaf and wizard button - the
                             menu system returns *command strings*
                             (layer4/PopUp.cpp:471-475, modules/pymol/menu.py:824)
===========================  ==================================================

So: allow-list by **namespace and shape**, permit the dangerous commands, and
mark them.  :data:`DANGEROUS` is the marking; ``Policy.allow_dangerous``
(default ``True``) is the switch a paranoid deployment can flip; every
dangerous invocation is reported through ``Dispatcher.on_dangerous`` so the UI
and the log can show it.

The allow-list rule
-------------------
1. ``fn`` is a dotted path of 1..3 identifier segments.
2. No segment may start with ``__`` (blocks ``__globals__``/``__class__`` walks).
3. A bare name resolves against the ``pymol.cmd`` module - i.e. the same
   namespace the PyMOL command line has.
4. A dotted name's first segment must be in :data:`ALLOWED_ROOTS`; it resolves
   against ``pymol.<root>``.
5. A leading-underscore leaf is allowed only if it is in :data:`ALLOWED_PRIVATE`.
6. The result must be callable and must not be a module/class/type.
"""

from __future__ import annotations

import math
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from .pump import Engine, PyMOLPump

MAX_SEGMENTS = 3

#: Dotted roots the client may address, e.g. ``util.cbc``, ``preset.pretty``.
#: ``cmd`` is included so ``cmd.fragment`` and bare ``fragment`` both work.
ALLOWED_ROOTS: frozenset = frozenset(
    {
        "cmd",
        "util",  # modules/pymol/util.py - cbc, protein_vacuum_esp, ...
        "editor",  # modules/pymol/editor.py - builder actions
        "preset",  # modules/pymol/preset.py - preset menu
        "movie",  # modules/pymol/movie.py - movie menu / produce
        "menu",  # modules/pymol/menu.py - popup content providers
        "wizard",  # modules/pymol/wizard/ - wizard classes and helpers
        "plugins",  # modules/pymol/plugins/ - plugin manager (critique B2)
        "invocation",  # modules/pymol/invocation.py - option introspection
    }
)

#: Private leaf names the client is explicitly allowed to call.  Everything
#: else starting with ``_`` is refused.  Symbols verified in
#: ``modules/pymol/internal.py`` and ``modules/pymol/cmd.py:159-190``.
ALLOWED_PRIVATE: frozenset = frozenset(
    {
        "_alt",  # internal.py:494  - chord fallback (00:110)
        "_ctrl",  # internal.py:488
        "_ctsh",  # internal.py:509
        "_special",  # internal.py    - function/arrow keys
        "_do",  # internal.py     - raw command line
        "_get_feedback",  # SEE feedback.py: consume-once; pump owns it
        "_refresh",  # internal.py:544
        "_copy_image",  # internal.py    - needed by WP-18
        "_quit",  # shutdown
    }
)

#: Names that are dangerous *by nature*.  Permitted (see module docstring), but
#: always marked, always reported.  value = why.
DANGEROUS: Dict[str, str] = {
    "system": "runs an arbitrary shell command (File > Working Directory > Browser)",
    "run": "executes an arbitrary Python file (File > Run Script)",
    "spawn": "executes an arbitrary Python file on a new thread",
    "cd": "changes the process working directory",
    "quit": "terminates the PyMOL process",
    "_quit": "terminates the PyMOL process",
    "load": "reads an arbitrary path from the filesystem",
    "save": "writes an arbitrary path on the filesystem",
    "png": "writes an arbitrary path on the filesystem",
    "alias": "binds a command name to arbitrary text (insecure per keywords.py:19)",
    "alter": "evaluates a Python expression per atom (insecure per keywords.py:21)",
    "alter_state": "evaluates a Python expression per atom (keywords.py:23)",
    "iterate": "evaluates a Python expression per atom",
    "iterate_state": "evaluates a Python expression per atom",
    "set_key": "binds a key to an arbitrary callable/command",
    "extend": "registers an arbitrary callable as a command",
}

#: Raw command lines are ALSO dangerous by nature - ``do`` is how every menu
#: leaf and wizard button is expressed (critique A6).  This is not a block list;
#: it decides which ``t:"do"`` messages get marked.
DANGEROUS_DO_PREFIXES: Tuple[str, ...] = (
    "run ", "@", "system ", "cd ", "quit", "_quit", "spawn ", "alias ",
)


class DispatchError(Exception):
    """Base class for refusals that are the client's fault (not PyMOL's)."""

    type_name = "DispatchError"


class UnknownFunction(DispatchError):
    type_name = "UnknownFunction"


class NotAllowed(DispatchError):
    type_name = "NotAllowed"


class BadMessage(DispatchError):
    type_name = "BadMessage"


@dataclass
class Policy:
    allowed_roots: frozenset = ALLOWED_ROOTS
    allowed_private: frozenset = ALLOWED_PRIVATE
    #: local desktop app -> dangerous commands are ON by default
    allow_dangerous: bool = True
    max_segments: int = MAX_SEGMENTS

    def check_path(self, fn: str) -> List[str]:
        if not isinstance(fn, str) or not fn:
            raise BadMessage("'fn' must be a non-empty string")
        segments = fn.split(".")
        if len(segments) > self.max_segments:
            raise NotAllowed(
                "%r has %d segments; at most %d are allowed"
                % (fn, len(segments), self.max_segments)
            )
        for seg in segments:
            if not seg.isidentifier():
                raise BadMessage("%r is not a valid dotted identifier" % fn)
            if seg.startswith("__"):
                raise NotAllowed(
                    "%r: dunder attribute access is never allowed" % fn
                )
        if len(segments) > 1 and segments[0] not in self.allowed_roots:
            raise NotAllowed(
                "%r: root %r is not an allowed namespace (allowed: %s)"
                % (fn, segments[0], ", ".join(sorted(self.allowed_roots)))
            )
        leaf = segments[-1]
        if leaf.startswith("_") and leaf not in self.allowed_private:
            raise NotAllowed(
                "%r: private symbol %r is not on the allow-list "
                "(see dispatch.ALLOWED_PRIVATE)" % (fn, leaf)
            )
        return segments

    def danger(self, fn: str) -> Optional[str]:
        return DANGEROUS.get(fn.split(".")[-1])


def resolve(engine: Engine, fn: str, policy: Policy) -> Callable[..., Any]:
    """Resolve a dotted path to a callable.  Pump thread only."""
    segments = policy.check_path(fn)
    if len(segments) == 1:
        base: Any = engine.cmd
        rest: Iterable[str] = segments
    elif segments[0] == "cmd":
        base = engine.cmd
        rest = segments[1:]
    else:
        base = getattr(engine.pymol, segments[0], None)
        if base is None:
            try:
                import importlib

                base = importlib.import_module("pymol." + segments[0])
            except Exception as exc:  # noqa: BLE001
                raise UnknownFunction(
                    "cannot import namespace pymol.%s (%s)" % (segments[0], exc)
                ) from None
        rest = segments[1:]

    obj = base
    for seg in rest:
        try:
            obj = getattr(obj, seg)
        except AttributeError:
            raise UnknownFunction("%r: no attribute %r" % (fn, seg)) from None
    if not callable(obj):
        raise NotAllowed("%r resolves to %r which is not callable" % (fn, type(obj).__name__))
    if isinstance(obj, type):
        raise NotAllowed("%r resolves to a class; only functions are callable" % fn)
    return obj


# --------------------------------------------------------------------------
# Result serialisation
# --------------------------------------------------------------------------
#
# TODO(WP-04 / critique B8): several ``cmd`` functions return objects JSON
# cannot express - ``get_model()`` -> chempy.models.Indexed,
# ``get_session()`` -> nested dict containing binary, ``get_coords``/
# ``get_coordset`` -> numpy arrays and, with ``copy=0``, a LIVE VIEW onto C++
# memory (layer2/CoordSet.cpp:326-361).  The view MUST be copied before it
# leaves the pump thread; ``_ndarray`` below does that via ``.tolist()``.
# A typed codec table belongs here once WP-04 exists; until then the fallback is
# a marked ``{"__repr__": ...}`` so nothing silently disappears.

_JSON_SCALARS = (str, bool, int)


def to_jsonable(value: Any, _depth: int = 0) -> Any:
    if value is None or isinstance(value, _JSON_SCALARS):
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return {"__float__": repr(value)}
        return value
    if _depth > 32:
        return {"__truncated__": type(value).__name__}
    if isinstance(value, (bytes, bytearray, memoryview)):
        import base64

        return {"__bytes__": base64.b64encode(bytes(value)).decode("ascii")}
    if isinstance(value, dict):
        return {str(k): to_jsonable(v, _depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [to_jsonable(v, _depth + 1) for v in value]
    tolist = getattr(value, "tolist", None)  # numpy scalars and arrays
    if callable(tolist):
        try:
            return to_jsonable(tolist(), _depth + 1)
        except Exception:  # noqa: BLE001
            pass
    return {"__repr__": repr(value)[:4096], "__type__": type(value).__name__}


# --------------------------------------------------------------------------
# Dispatcher
# --------------------------------------------------------------------------


@dataclass
class Dispatcher:
    pump: PyMOLPump
    policy: Policy = field(default_factory=Policy)
    #: called (from the pump thread) with (fn, reason) whenever a dangerous
    #: symbol is invoked - wire it to the log and/or a UI banner.
    on_dangerous: Optional[Callable[[str, str], None]] = None

    # -- t:"call" ----------------------------------------------------------
    def call(self, fn: str, args: Optional[List[Any]] = None,
             kwargs: Optional[Dict[str, Any]] = None):
        args = list(args or [])
        kwargs = dict(kwargs or {})
        if not all(isinstance(k, str) for k in kwargs):
            raise BadMessage("'kwargs' keys must be strings")
        # Fail fast on the asyncio thread for shape/policy errors so a typo
        # never occupies a pump slot.
        self.policy.check_path(fn)

        def _run(engine: Engine) -> Any:
            target = resolve(engine, fn, self.policy)
            reason = self.policy.danger(fn)
            if reason:
                if not self.policy.allow_dangerous:
                    raise NotAllowed(
                        "%r is marked dangerous (%s) and allow_dangerous is off"
                        % (fn, reason)
                    )
                if self.on_dangerous:
                    self.on_dangerous(fn, reason)
            return to_jsonable(target(*args, **kwargs))

        return self.pump.submit(_run, label="call:" + fn)

    # -- t:"do" ------------------------------------------------------------
    def do(self, cmdline: str):
        """Run a raw PyMOL command line.

        NOT console-only: every popup-menu leaf and wizard button in PyMOL is
        literally a command string (layer4/PopUp.cpp:471-475,
        modules/pymol/menu.py:824), so the UI must be able to send these.
        ``cmd.do`` swallows return values and exceptions
        (modules/pymol/commanding.py:441-461) - the result of the command shows
        up on the ``feedback`` topic, not in the ``ok`` frame.
        """
        if not isinstance(cmdline, str):
            raise BadMessage("'cmd' must be a string")
        stripped = cmdline.lstrip()

        def _run(engine: Engine) -> Any:
            if stripped.startswith(DANGEROUS_DO_PREFIXES):
                if not self.policy.allow_dangerous:
                    raise NotAllowed(
                        "raw command %r is marked dangerous and "
                        "allow_dangerous is off" % (stripped.split(" ")[0],)
                    )
                if self.on_dangerous:
                    self.on_dangerous("do", stripped[:200])
            engine.cmd.do(cmdline)
            return None

        return self.pump.submit(_run, label="do")

    # -- t:"input" ---------------------------------------------------------
    def input(self, msg: Dict[str, Any]):
        kind = msg.get("kind")
        if kind == "button":
            return self.pump.button(
                int(msg["button"]), int(msg["state"]),
                int(msg["x"]), int(msg["y"]), int(msg.get("mod", 0)),
            )
        if kind == "drag":
            return self.pump.drag(
                int(msg["x"]), int(msg["y"]), int(msg.get("mod", 0))
            )
        if kind == "reshape":
            return self.pump.reshape(
                int(msg["width"]), int(msg["height"]), bool(msg.get("force", False))
            )
        raise BadMessage("unknown input kind %r" % (kind,))


def error_payload(exc: BaseException) -> Dict[str, str]:
    """Build the ``err.error`` object for any exception."""
    type_name = getattr(exc, "type_name", None) or type(exc).__name__
    return {
        "type": str(type_name),
        "message": str(exc) or type(exc).__name__,
        "traceback": "".join(
            traceback.format_exception(type(exc), exc, exc.__traceback__)
        ),
    }
