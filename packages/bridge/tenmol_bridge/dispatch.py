"""Resolve a wire ``fn`` to a PyMOL callable and run it on the engine thread.

Three entry points, all of which return a ``concurrent.futures.Future`` that the
asyncio side awaits:

``call(fn, args, kwargs)``   the typed API — ``cmd.fragment``, ``util.cbc``, ...
``do(cmdline)``             a raw command line.  **Allowed from the UI** (plan
                            §A6): every ``pymol.menu`` popup leaf and every
                            wizard button returns a *command string*
                            (``packages/engine/layer4/PopUp.cpp:471-475``), so declaring
                            ``t:'do'`` console-only made WP-13 and WP-16
                            unimplementable.
``input(msg)``              mouse/keyboard, forwarded 1:1 and drawn immediately.

Every one of them takes the **calling session**, and every one of them passes it
on to the ``_bridge.*`` routes.  That is not decoration: a ``_bridge.*`` route
may answer with an out-of-band *binary* frame (Mode G geometry), and without the
caller's identity the only thing it can do with that frame is broadcast it —
which is defect D4, N clients each paying for one client's 360 KB pull.  A route
that answers out of band must be able to address the answer, so the identity has
to survive the whole way down.  Genuinely shared state (``objects``, ``view``,
``frame``, ``feedback``) keeps fanning out through the topic subscriptions; it
never travels this path.

Two invariants worth stating out loud:

* **Encoding happens on the engine thread**, in the same task as the call, so
  the copy-before-unlock rule of plan §B8 holds: ``cmd.get_coordset(copy=0)``
  hands back a live view onto C++ memory (``packages/engine/layer2/CoordSet.cpp:326-361``).
* **Every executed command reports its invalidation classes** with the result.
  That is the command-echo channel of plan §1.5 — the only mechanism that can
  see per-atom colour and per-atom reps, which polling provably cannot
  (``cmd.get_vis()`` is object-level only).
"""

from __future__ import annotations

import concurrent.futures
import inspect
from typing import Any, Callable, Dict, Mapping, Optional

from .blobs import BlobStore, EngineBlobWriter
from .codec import encode_result
from .config import log
from .engine import Engine
from .errors import BadMessage, NotAllowed
from .incentive_only import describe as describe_incentive
from .policy import Policy, build_policy
from .pump import Pump
from .session import INPUT_BUTTON, INPUT_DRAG, INPUT_KINDS, INPUT_RESHAPE

__all__ = ["Dispatcher", "CallResult"]

#: ``root`` -> module path under ``pymol``.  A root not listed here resolves to
#: ``pymol.<root>``; this table exists for the two that do not follow the rule.
_ROOT_MODULES: Dict[str, str] = {
    "cmd": "pymol.cmd",
    "chempy": "chempy",
}


class CallResult(dict):
    """``{"result": ..., "invalidates": [...], "dangerous": bool}``."""


class Dispatcher:
    def __init__(
        self,
        pump: Pump,
        policy: Optional[Policy] = None,
        blobs: Optional[BlobStore] = None,
        on_shutdown: Optional[Callable[[], None]] = None,
        on_dangerous: Optional[Callable[[str, str], None]] = None,
        bridge_routes: Optional[Callable[[str, Any, Any], Any]] = None,
    ) -> None:
        self.pump = pump
        self.policy = policy or build_policy()
        self.blobs = blobs or BlobStore()
        self.on_shutdown = on_shutdown
        self.on_dangerous = on_dangerous
        #: ``fn(symbol, args, kwargs, session) -> value | Future`` for the
        #: ``_bridge.*`` namespace, which is served by the process itself and
        #: never reaches ``pymol``.  The policy would (correctly) refuse it as
        #: an un-addressable namespace, so it is checked FIRST.
        #:
        #: ``session`` is optional in the callable's signature: a route table
        #: that does not care (and every three-argument test double) still
        #: works, because :meth:`_bridge_call` introspects it once, here.
        self.bridge_routes = bridge_routes
        self._routes_take_session = _accepts_session(bridge_routes)

    # ------------------------------------------------------------------ call

    def call(
        self,
        fn: Any,
        args: Any = None,
        kwargs: Any = None,
        session: Any = None,
    ) -> "concurrent.futures.Future[CallResult]":
        if (
            self.bridge_routes is not None
            and isinstance(fn, str)
            and fn.startswith("_bridge.")
        ):
            return self._bridge_call(fn, args, kwargs, session)
        decision = self.policy.check(fn)
        try:
            decision.raise_if_denied()
        except NotAllowed as exc:
            return _failed(exc)
        if decision.dangerous and self.on_dangerous is not None:
            self.on_dangerous(decision.symbol, decision.danger_reason)

        call_args = list(args or ())
        call_kwargs = dict(kwargs or {})
        if not all(isinstance(key, str) for key in call_kwargs):
            return _failed(BadMessage("kwargs keys must be strings"))

        if decision.routed:
            return self._route(decision.symbol)

        symbol = decision.symbol
        invalidates = list(decision.invalidates)

        def body(engine: Engine) -> CallResult:
            engine.require_pymol()
            target = self.resolve(engine, symbol)
            value = target(*call_args, **call_kwargs)
            wire = encode_result(
                symbol, value, blob_writer=EngineBlobWriter(self.blobs, engine)
            )
            return CallResult(
                result=wire,
                invalidates=invalidates,
                dangerous=decision.dangerous,
            )

        return self.pump.submit(body, label="call:%s" % symbol)

    # -------------------------------------------------------------------- do

    def do(self, cmdline: Any, echo: bool = True) -> "concurrent.futures.Future[CallResult]":
        if not isinstance(cmdline, str) or not cmdline:
            return _failed(BadMessage("do requires a non-empty command string"))
        decision = self.policy.check("cmd.do")
        try:
            decision.raise_if_denied()
        except NotAllowed as exc:
            return _failed(exc)
        # `cmd.do` is NOT itself confirm-once — it is how the console runs every
        # typed command and how each panel bootstraps, so gating it would fire a
        # prompt before the user had done anything.  But it must not be a way
        # AROUND the gate: `cmd.system("true")` was refused pending confirmation
        # while `do("system true")` in the same session ran, which made the gate
        # theatre.  See `_confirm_once_keyword`.
        # ONLY the confirm-once gate is re-applied here, never the whole policy:
        # `check()` on every leading keyword would start refusing command lines
        # for unrelated reasons (an unknown or private first word would become a
        # policy denial instead of PyMOL's own "unknown command" message), and
        # this is about one specific inconsistency, not about parsing the
        # command language.
        for keyword in _command_keywords(cmdline):
            if not self.policy.needs_confirmation("cmd.%s" % keyword):
                continue
            try:
                self.policy.check("cmd.%s" % keyword).raise_if_denied()
            except NotAllowed as exc:
                return _failed(exc)
        if self.on_dangerous is not None:
            self.on_dangerous("cmd.do", cmdline)

        def body(engine: Engine) -> CallResult:
            cmd = engine.require_pymol()
            # cmd.do is where console parity lives: it emits the "PyMOL>" echo
            # and the C-origin summary into the same line buffer (spike 02 §8).
            # A direct API call is deliberately silent.
            cmd.do(cmdline, echo=1 if echo else 0)
            return CallResult(
                result=None,
                # A command line can do anything at all, including `run` and
                # `@script`, so it forces a full resync (plan §1.5).
                invalidates=["resync"],
                dangerous=True,
            )

        return self.pump.submit(body, tick_after=True, label="do")

    # ----------------------------------------------------------------- input

    def input(self, msg: Mapping[str, Any]) -> "concurrent.futures.Future[CallResult]":
        """Mouse/viewport input, forwarded 1:1 (plan §1.4).

        Coordinates are **PyMOL window coordinates: bottom-left origin**.  The
        client flips the browser's ``clientY``; WP-10 owns that transform.
        ``modifiers`` is the ``cOrtho`` bitmask ``SHIFT=1 CTRL=2 ALT=4``;
        buttons are ``P_GLUT_LEFT/MIDDLE/RIGHT = 0/1/2`` and states
        ``DOWN/UP = 0/1`` (``packages/engine/layer0/os_gl_glut_pretend.h:11-26``).

        ``tick_after=True`` on every one of these: click/drag/release only
        *enqueue* through ``OrthoDefer`` (``packages/engine/layer1/Scene.cpp:4113-4155``) and
        the queue is drained by ``OrthoExecDeferred``, reachable only from a
        real draw.
        """
        kind = msg.get("kind")
        if kind not in INPUT_KINDS:
            return _failed(BadMessage("unknown input kind %r" % (kind,)))

        if kind == INPUT_BUTTON:
            button = int(msg.get("button", 0))
            state = int(msg.get("state", 0))
            x = int(msg.get("x", 0))
            y = int(msg.get("y", 0))
            mod = int(msg.get("mod", msg.get("modifiers", 0)))

            def body(engine: Engine) -> CallResult:
                engine.require_pymol()
                engine.button(button, state, x, y, mod)
                return CallResult(result=None, invalidates=[], dangerous=False)

        elif kind == INPUT_DRAG:
            x = int(msg.get("x", 0))
            y = int(msg.get("y", 0))
            mod = int(msg.get("mod", msg.get("modifiers", 0)))

            def body(engine: Engine) -> CallResult:  # type: ignore[misc]
                engine.require_pymol()
                engine.drag(x, y, mod)
                return CallResult(result=None, invalidates=[], dangerous=False)

        elif kind == INPUT_RESHAPE:
            width = int(msg.get("width", 0))
            height = int(msg.get("height", 0))

            def body(engine: Engine) -> CallResult:  # type: ignore[misc]
                engine.require_pymol()
                engine.resize(width, height)
                return CallResult(
                    result={"width": engine.width, "height": engine.height},
                    invalidates=[],
                    dangerous=False,
                )

        else:
            # key / scroll are WP-10 and WP-23; the vocabulary is reserved here
            # so the client can be written against it, but the bridge answers
            # honestly instead of silently doing nothing.
            return _failed(
                BadMessage("input kind %r is not implemented by WP-02" % (kind,))
            )

        return self.pump.submit(body, tick_after=True, label="input:%s" % kind)

    # --------------------------------------------------------------- confirm

    def confirm(self, symbol: Any) -> "concurrent.futures.Future[CallResult]":
        if not isinstance(symbol, str):
            return _failed(BadMessage("confirm requires a symbol name"))
        self.policy.confirm(symbol.rsplit(".", 1)[-1])
        future: "concurrent.futures.Future[CallResult]" = concurrent.futures.Future()
        future.set_result(CallResult(result={"confirmed": symbol}, invalidates=[]))
        return future

    # -------------------------------------------------------------- resolve

    def resolve(self, engine: Engine, symbol: str) -> Callable[..., Any]:
        """Dotted name -> callable, inside the engine's own PyMOL instance."""
        segments = symbol.split(".")
        if len(segments) == 1:
            root_obj: Any = engine.cmd
            attrs = segments
        else:
            root = segments[0]
            module_path = _ROOT_MODULES.get(root, "pymol.%s" % root)
            if root == "cmd":
                root_obj = engine.cmd
            else:
                try:
                    root_obj = __import__(module_path, fromlist=["__name__"])
                except ImportError as exc:
                    raise NotAllowed(
                        "namespace %r is not importable: %s" % (root, exc),
                        symbol=symbol,
                    ) from exc
            attrs = segments[1:]

        target: Any = root_obj
        for attr in attrs:
            try:
                target = getattr(target, attr)
            except AttributeError as exc:
                raise NotAllowed(
                    "%s: no such symbol (%s)" % (symbol, exc), symbol=symbol
                ) from exc
        if not callable(target):
            raise NotAllowed("%s is not callable" % symbol, symbol=symbol)
        if isinstance(target, type):
            raise NotAllowed("%s is a class, not a function" % symbol, symbol=symbol)
        incentive = describe_incentive(symbol)
        if incentive is not None:
            # Not an error yet — the call is allowed to proceed and raise
            # IncentiveOnlyException so the message the user sees is PyMOL's
            # own.  We only annotate the log.
            log("calling Incentive-only symbol %s (%s)" % (symbol, incentive.site))
        return target

    # -------------------------------------------------------------- routing

    def _bridge_call(
        self, symbol: str, args: Any, kwargs: Any, session: Any = None
    ) -> "concurrent.futures.Future[CallResult]":
        """``_bridge.*`` -> the in-process service (today: RenderService).

        The handler may return a plain value (answer immediately) or a
        ``Future`` from ``pump.submit`` (answer when the engine gets to it).
        Either way the client sees an ordinary ``ok`` frame — and, for routes
        that answer with bulk data, a binary frame addressed to ``session``.

        ``session`` is never taken from the client's ``kwargs``: it is the
        connection the frame arrived on.  A client cannot name another client.
        """
        assert self.bridge_routes is not None
        future: "concurrent.futures.Future[CallResult]" = concurrent.futures.Future()
        try:
            if self._routes_take_session:
                outcome = self.bridge_routes(symbol, args, kwargs, session)
            else:
                outcome = self.bridge_routes(symbol, args, kwargs)
        except BaseException as exc:  # noqa: BLE001
            future.set_exception(exc)
            return future
        if isinstance(outcome, concurrent.futures.Future):
            wrapped: "concurrent.futures.Future[CallResult]" = (
                concurrent.futures.Future()
            )

            def _done(done: "concurrent.futures.Future[Any]") -> None:
                exc = done.exception()
                if exc is not None:
                    wrapped.set_exception(exc)
                else:
                    wrapped.set_result(
                        CallResult(result=done.result(), invalidates=[])
                    )

            outcome.add_done_callback(_done)
            return wrapped
        future.set_result(CallResult(result=outcome, invalidates=[]))
        return future

    def _route(self, symbol: str) -> "concurrent.futures.Future[CallResult]":
        """``quit`` / ``_quit`` -> bridge shutdown, never the C ``exit()`` path.

        ``spikes/00-build.md`` §6.2: PyMOL tears the process down with C
        ``exit()``, skipping ``atexit`` and ``Py_FinalizeEx``; the browser would
        see the socket vanish with no explanation and nothing would be flushed.
        """
        future: "concurrent.futures.Future[CallResult]" = concurrent.futures.Future()
        if self.on_shutdown is not None:
            try:
                self.on_shutdown()
            except Exception as exc:  # noqa: BLE001
                future.set_exception(exc)
                return future
        future.set_result(
            CallResult(result={"routed": symbol, "shutdown": True}, invalidates=[])
        )
        return future


def _accepts_session(route: Optional[Callable[..., Any]]) -> bool:
    """Does ``route`` take a fourth, positional, session argument?

    Introspected ONCE at construction.  ``bridge_routes`` is a bound method in
    the product and a lambda in the tests, and neither should have to be
    rewritten in lockstep with the other; guessing per call with ``TypeError``
    would also swallow a genuine ``TypeError`` raised *inside* a route.
    """
    if route is None:
        return False
    try:
        signature = inspect.signature(route)
    except (TypeError, ValueError):  # C callables have no signature
        return False
    positional = 0
    for parameter in signature.parameters.values():
        if parameter.kind is inspect.Parameter.VAR_POSITIONAL:
            return True  # *args swallows anything
        if parameter.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ):
            positional += 1
    return positional >= 4


def _failed(exc: BaseException) -> "concurrent.futures.Future[Any]":
    future: "concurrent.futures.Future[Any]" = concurrent.futures.Future()
    future.set_exception(exc)
    return future


def _command_keywords(cmdline: str) -> tuple:
    """The leading keyword of each command on a `cmd.do` line.

    `viewing.py`'s parser splits a line on newlines and on `;`
    (`parsing.py:split`), so `zoom; system rm -rf /` is two commands and the
    second one is the one that matters.  Returns them lowercased and
    deduplicated, in order.

    WHAT THIS IS AND IS NOT.  It is a CONSISTENCY gate, matching what
    `cmd.system` has always done, so that the same capability is not reachable
    ungated under a second spelling.  It is NOT a sandbox, and pretending
    otherwise would be worse than not having it:

     * `alias x, system rm` then `x` defeats it, as does `run script.py`,
       `@script.pml`, and the `/`-prefixed Python escape.  All three are in
       `DANGEROUS` and permitted by design — this is a local desktop
       replacement, and a client that can call `cmd.save` can already write any
       path on the machine.
     * It reads only the first token, so it cannot see a keyword produced by
       Python evaluation.

    The threat it actually removes is the one that was measured and written
    down in `policy/grants/wp-25-apbs.py`: an identical capability answering
    with a confirmation prompt under one name and running silently under
    another, which teaches a user that the prompt means nothing.
    """
    seen: Dict[str, None] = {}
    for line in cmdline.splitlines():
        for part in line.split(";"):
            token = part.strip().split(None, 1)[0:1]
            if not token:
                continue
            word = token[0].lower()
            # `/python_expr` and `@script` are not keywords; they are escapes,
            # and `_command_keywords` deliberately does not chase them.
            if word[:1] in ("/", "@"):
                continue
            seen.setdefault(word, None)
    return tuple(seen)
