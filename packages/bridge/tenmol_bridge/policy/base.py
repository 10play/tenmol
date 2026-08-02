"""The capability policy (plan §A6).  A grant policy, NOT a deny-list.

``architecture.md:357-364`` proposed denying ``system``, ``run``, ``spawn``,
``quit``, ``_quit``, ``cd``, everything starting with ``_``, and declaring
``t:'do'`` console-only.  That is **deleted**.  Each of those denials removed a
feature ``feature-parity.md`` requires:

=========================  ====================================================
denied                     feature it broke
=========================  ====================================================
``run`` / ``do('@file')``  File ▸ Run Script (``00:61``); the demo wizard runs
                           ``run $PYMOL_DATA/demo/cgo03.py``
                           (``packages/engine/modules/pymol/wizard/demo.py:195``)
``cd``                     File ▸ Working Directory ▸ Change (``00:61``)
``system``                 File ▸ Working Directory ▸ File Browser (``00:61``)
``quit`` / ``_quit``       File ▸ Quit — routed to bridge shutdown, not to the
                           C ``exit()`` path (spike 00 §6.2)
``_ctrl``/``_alt``/``_ctsh``  the ortho CLI chord fallback (``00:110``;
                           ``packages/engine/modules/pymol/internal.py:488,494,509``)
``t:'do'``                 EVERY ``pymol.menu`` popup leaf and wizard button —
                           they return *command strings*
                           (``packages/engine/layer4/PopUp.cpp:471-475``)
=========================  ====================================================

**The security boundary is the transport, not the symbol list**: 127.0.0.1
bind, a 256-bit token minted at startup with mode 0600, an ``Origin``
allow-list, and the loopback peer check (precedent:
``packages/engine/modules/pymol/pymolhttpd.py:61-68``).  This product executes arbitrary local
code by design — it is a desktop replacement for a program with a Python
console.  Pretending otherwise with a deny-list bought nothing and cost six
features.

What is left for the policy to do:

1. **Shape** — reject anything that is not a 1..3 segment dotted identifier
   path, and reject ``__dunder__`` segments so no ``__globals__`` walk exists.
2. **Namespace** — a dotted name's root must be a known PyMOL namespace, and a
   private *interior* segment (``cmd._parser.complete``) must be granted by
   name.  Interior segments used to be unchecked, which meant the whole private
   attribute surface of every allowed root was reachable by accident; that hole
   is closed and the one capability that needed it (tab completion) is now an
   explicit grant instead.
3. **Grants** — work packages add symbols/roots through
   ``policy/grants/wp-NN.py``; nobody edits a shared file (plan §5.2).
   ``Grant.symbols`` names a *whole dotted path* and is the only way to reach a
   private interior segment.
4. **Confirmation** — the handful of calls that get a one-time client
   confirmation (``cmd.system``), and the calls that are *routed* rather than
   executed (``quit``).
5. **Marking** — every call carries ``dangerous`` and the invalidation classes
   the command-echo channel (plan §1.5) needs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, FrozenSet, Iterable, List, Optional, Set

from ..errors import NotAllowed

__all__ = [
    "Decision",
    "Grant",
    "Policy",
    "DEFAULT_ROOTS",
    "DEFAULT_PRIVATE",
    "DANGEROUS",
    "CONFIRM_ONCE",
    "ROUTED",
    "INVALIDATES",
]

_SEGMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_SEGMENTS = 3

#: Dotted roots the client may address.  These are real modules under
#: ``packages/engine/modules/pymol/``; ``cmd`` is included so ``cmd.fragment`` and bare
#: ``fragment`` both resolve.
DEFAULT_ROOTS: FrozenSet[str] = frozenset(
    {
        "cmd",
        "util",  # packages/engine/modules/pymol/util.py       - cbc, protein_vacuum_esp, ...
        "editor",  # packages/engine/modules/pymol/editor.py     - builder actions
        "preset",  # packages/engine/modules/pymol/preset.py     - preset menu
        "movie",  # packages/engine/modules/pymol/movie.py      - movie menu / produce
        "menu",  # packages/engine/modules/pymol/menu.py       - popup content providers
        "wizard",  # packages/engine/modules/pymol/wizard/       - wizard modules
        "plugins",  # packages/engine/modules/pymol/plugins/      - plugin surface (read-only v1)
        "invocation",  # packages/engine/modules/pymol/invocation.py - option introspection
        "setting",  # packages/engine/modules/pymol/setting.py
        "selector",  # packages/engine/modules/pymol/selector.py
        "chempy",
        "colorprinting",  # packages/engine/modules/pymol/colorprinting.py
        "controlling",  # packages/engine/modules/pymol/controlling.py - mode_dict/mouse_ring (§A9)
    }
)

#: Leading-underscore leaves that are explicitly reachable.  The old
#: "anything starting with ``_`` is denied" rule is deleted (§A6): these are
#: real, registered symbols the UI needs.
DEFAULT_PRIVATE: FrozenSet[str] = frozenset(
    {
        "_alt",  # packages/engine/modules/pymol/internal.py:494
        "_ctrl",  # packages/engine/modules/pymol/internal.py:488
        "_ctsh",  # packages/engine/modules/pymol/internal.py:509
        "_special",  # function / arrow keys
        "_do",
        "_quit",
        "_copy_image",
        "_get_feedback",  # see below: reserved to the status thread
        "_refresh",
        "_sgi_stereo",
        "_get_color_sc",
    }
)

#: Symbols the bridge owns exclusively and refuses to expose, because a second
#: consumer silently splits the stream (plan §1.2; measured
#: ``consumerA saw: [468] / consumerB saw: []``).  This is the ONLY hard
#: refusal list in the policy and it exists for correctness, not security.
EXCLUSIVE_TO_BRIDGE: FrozenSet[str] = frozenset(
    {
        "_get_feedback",
        "get_setting_updates",
        "getRedisplay",
    }
)

#: Dangerous by nature.  Permitted; always marked; reported to the client so
#: the UI can show what happened.  value = why.
DANGEROUS: Dict[str, str] = {
    "system": "runs an arbitrary shell command",
    "run": "executes an arbitrary Python file",
    "spawn": "executes an arbitrary Python file on a new thread",
    "cd": "changes the process working directory",
    "quit": "terminates the session",
    "_quit": "terminates the session",
    "load": "reads an arbitrary path",
    "save": "writes an arbitrary path",
    "png": "writes an arbitrary path",
    "alias": "binds a command name to arbitrary text",
    "alter": "evaluates a Python expression per atom",
    "alter_state": "evaluates a Python expression per atom",
    "iterate": "evaluates a Python expression per atom",
    "iterate_state": "evaluates a Python expression per atom",
    "set_key": "binds a key to an arbitrary callable",
    "extend": "registers an arbitrary callable as a command",
    "do": "runs an arbitrary PyMOL command line",
}

#: Requires ONE client confirmation per session, then flows freely (§A6).
#:
#: A work package adds to this through ``Grant.confirm_once`` — see
#: :meth:`Policy.add_grant`.  It used to be reachable ONLY by editing this file,
#: which is why ``policy/grants/wp-25-apbs.py`` documents at length that it
#: could not gate ``subproc.execute`` even though it wanted to argue about
#: whether it should.  "The work package cannot express the decision" and "the
#: work package decided not to" are different states and the policy should be
#: able to tell them apart.
#:
#: THE POLICY IS NOW SETTLED (inventory row 467).  The product owner's decision,
#: 2026-08-02: an authenticated localhost client MAY start local processes, and
#: the three routes that do so must be CONSISTENT — confirm once per session,
#: then flow.  ``system`` is here; ``subproc.execute`` is added by
#: ``policy/grants/wp-25-apbs.py`` through ``Grant.confirm_once``.  ``cmd.do``
#: is deliberately NOT gated as a whole (it is how the console runs every typed
#: command and how each panel bootstraps, so a prompt would fire before the user
#: had done anything); instead ``Dispatcher.do`` re-applies this gate to a
#: command line's leading keyword, which is what stops ``do("system true")``
#: being a way around ``cmd.system``.
CONFIRM_ONCE: FrozenSet[str] = frozenset({"system"})

#: Executed by the bridge, not by PyMOL.  ``cmd.quit`` would take the C
#: ``exit()`` path (``spikes/build.md`` §6.2), skipping ``atexit`` and
#: ``Py_FinalizeEx`` and killing the server with the browser still attached.
ROUTED: FrozenSet[str] = frozenset({"quit", "_quit"})

#: Command-echo invalidation classes (plan §1.5).  Polling cannot see per-atom
#: colour or per-atom reps (``cmd.get_vis()`` is object-level only — proven:
#: ``show spheres, m and name CA`` leaves it byte-identical while 574 atoms
#: carry the rep), so every executed command declares what it invalidated.
INVALIDATES: Dict[str, Iterable[str]] = {
    "color": ("color",),
    "set_color": ("color",),
    "spectrum": ("color",),
    "recolor": ("color",),
    "show": ("reps",),
    "hide": ("reps",),
    "show_as": ("reps",),
    "set_bond": ("reps", "geometry"),
    "rebuild": ("geometry",),
    "refresh": ("geometry",),
    "alter": ("names", "color", "reps"),
    "alter_state": ("coords",),
    "load": ("names", "geometry", "coords"),
    "fragment": ("names", "geometry", "coords"),
    "fab": ("names", "geometry", "coords"),
    "create": ("names", "geometry"),
    "delete": ("names",),
    "set_name": ("names",),
    "group": ("names",),
    "ungroup": ("names",),
    "enable": ("names",),
    "disable": ("names",),
    "order": ("names",),
    "select": ("names",),
    "translate": ("coords",),
    "rotate": ("coords",),
    "protect": ("coords",),
    "sculpt_iterate": ("coords",),
    "undo": ("coords", "geometry", "names"),
    "redo": ("coords", "geometry", "names"),
    # cmd.do / cmd.run / @script can do anything at all.
    "do": ("resync",),
    "run": ("resync",),
    "spawn": ("resync",),
    "load_png": ("resync",),
    "read_pdbstr": ("names", "geometry", "coords"),
    "read_molstr": ("names", "geometry", "coords"),
}


@dataclass(frozen=True)
class Decision:
    """The answer to "may the client call this, and what does it mean?"."""

    symbol: str
    allowed: bool
    reason: str = ""
    dangerous: bool = False
    danger_reason: str = ""
    needs_confirmation: bool = False
    routed: bool = False
    invalidates: tuple = ()

    def raise_if_denied(self) -> "Decision":
        if not self.allowed:
            raise NotAllowed(self.reason or "not allowed: %s" % self.symbol,
                             symbol=self.symbol)
        if self.needs_confirmation:
            raise NotAllowed(
                "%s needs a one-time confirmation in this session" % self.symbol,
                symbol=self.symbol,
                confirm=self.symbol,
                why=self.danger_reason,
            )
        return self


@dataclass
class Grant:
    """One work package's addition to the policy.

    Written as ``packages/bridge/tenmol_bridge/policy/grants/wp-NN.py``, one file per
    owner, merged by :func:`tenmol_bridge.policy.load_grants`.  No shared file,
    so no collision (plan §5.2).
    """

    wp: str
    note: str = ""
    roots: Set[str] = field(default_factory=set)
    #: Whole dotted paths, e.g. ``cmd._parser.complete``.  A granted symbol
    #: satisfies the namespace-root check and the private-segment check (both
    #: the leaf and any interior segment); it does NOT bypass the shape rules,
    #: the dunder rule or :data:`EXCLUSIVE_TO_BRIDGE`.
    symbols: Set[str] = field(default_factory=set)
    private: Set[str] = field(default_factory=set)
    #: ``leaf`` OR a whole dotted path -> why it is dangerous.  Both work; the
    #: dotted form wins when both match (see :meth:`Policy.check`).
    dangerous: Dict[str, str] = field(default_factory=dict)
    invalidates: Dict[str, Iterable[str]] = field(default_factory=dict)
    #: Symbols this work package wants gated behind one client confirmation,
    #: on top of :data:`CONFIRM_ONCE`.  Same keying as ``dangerous``.
    confirm_once: Set[str] = field(default_factory=set)


class Policy:
    """Shape + namespace + grants.  See the module docstring."""

    def __init__(
        self,
        roots: Optional[Iterable[str]] = None,
        private: Optional[Iterable[str]] = None,
        allow_dangerous: bool = True,
        require_confirmation: bool = True,
    ) -> None:
        self.roots: Set[str] = set(roots or DEFAULT_ROOTS)
        self.private: Set[str] = set(private or DEFAULT_PRIVATE)
        self.symbols: Set[str] = set()
        self.dangerous: Dict[str, str] = dict(DANGEROUS)
        self.invalidates: Dict[str, tuple] = {
            key: tuple(value) for key, value in INVALIDATES.items()
        }
        self.allow_dangerous = allow_dangerous
        self.require_confirmation = require_confirmation
        self.confirm_once: Set[str] = set(CONFIRM_ONCE)
        self._confirmed: Set[str] = set()
        self.grants: List[Grant] = []

    # -- grants ------------------------------------------------------------

    def add_grant(self, grant: Grant) -> "Policy":
        self.roots |= set(grant.roots)
        self.symbols |= set(grant.symbols)
        self.private |= set(grant.private)
        self.dangerous.update(grant.dangerous)
        self.confirm_once |= set(grant.confirm_once)
        for key, value in grant.invalidates.items():
            self.invalidates[key] = tuple(value)
        self.grants.append(grant)
        return self

    def confirm(self, symbol: str) -> None:
        """Record the client's one-time confirmation for ``symbol``."""
        self._confirmed.add(symbol)

    def is_confirmed(self, symbol: str) -> bool:
        return symbol in self._confirmed

    def needs_confirmation(self, symbol: str) -> bool:
        """Is ``symbol`` gated and not yet confirmed in this session?

        Separate from :meth:`check` so a caller can ask the narrow question
        without running the whole policy: ``Dispatcher.do`` re-applies the
        confirm-once gate to a command line's leading keyword, and must not turn
        an unknown first word into a policy denial while doing it.
        """
        if not isinstance(symbol, str) or not symbol:
            return False
        leaf = symbol.rsplit(".", 1)[-1]
        return (
            self.require_confirmation
            and (leaf in self.confirm_once or symbol in self.confirm_once)
            and leaf not in self._confirmed
            and symbol not in self._confirmed
        )

    # -- the check ---------------------------------------------------------

    def check(self, symbol: Any) -> Decision:  # noqa: ANN401 - client input
        if not isinstance(symbol, str) or not symbol:
            return Decision(
                symbol=str(symbol),
                allowed=False,
                reason="fn must be a non-empty dotted name",
            )
        segments = symbol.split(".")
        if len(segments) > MAX_SEGMENTS:
            return Decision(
                symbol=symbol,
                allowed=False,
                reason="fn has %d segments; at most %d are addressable"
                % (len(segments), MAX_SEGMENTS),
            )
        for segment in segments:
            if not _SEGMENT.match(segment):
                return Decision(
                    symbol=symbol,
                    allowed=False,
                    reason="%r is not an identifier" % segment,
                )
            if segment.startswith("__"):
                return Decision(
                    symbol=symbol,
                    allowed=False,
                    reason="dunder segment %r is never addressable" % segment,
                )
        leaf = segments[-1]
        #: An exact dotted grant (``Grant.symbols``) is the capability itself:
        #: it answers the namespace question and the private-segment question
        #: for this one path, and nothing wider.
        granted = symbol in self.symbols
        if not granted and len(segments) > 1 and segments[0] not in self.roots:
            return Decision(
                symbol=symbol,
                allowed=False,
                reason="%r is not an addressable namespace" % segments[0],
            )
        # Interior segments: `cmd._parser.complete` reaches a private attribute
        # of an allowed root.  Leaving that unchecked made every `_`-prefixed
        # attribute of `cmd`, `util`, `editor`, ... addressable for free, which
        # is a hole, not a capability.  DEFAULT_PRIVATE is a list of *leaf*
        # commands and deliberately does not apply here.
        for segment in segments[1:-1]:
            if segment.startswith("_") and not granted:
                return Decision(
                    symbol=symbol,
                    allowed=False,
                    reason=(
                        "private interior segment %r needs an explicit grant "
                        "for the whole path %r (policy/grants/wp-NN.py, "
                        "Grant.symbols)" % (segment, symbol)
                    ),
                )
        if leaf.startswith("_") and leaf not in self.private and not granted:
            return Decision(
                symbol=symbol,
                allowed=False,
                reason="private symbol %r is not granted" % leaf,
            )
        if leaf in EXCLUSIVE_TO_BRIDGE:
            return Decision(
                symbol=symbol,
                allowed=False,
                reason=(
                    "%s is a destructive drain owned exclusively by the bridge "
                    "status thread; a second consumer silently splits the "
                    "stream (plan §1.2)" % leaf
                ),
            )

        # DOTTED PATH FIRST, LEAF SECOND.  This used to be `get(leaf)` alone,
        # and the consequence was a silent one: a work package writing
        # `Grant(dangerous={"subproc.execute": "..."})` — the obvious spelling,
        # and the one `Grant.symbols` uses — got a rule that could NEVER fire,
        # with no error anywhere.  `policy/grants/wp-25-apbs.py` carries a
        # ten-line comment working around it, and the comment is now the only
        # record of a problem that no longer exists.
        #
        # Leaf keying stays, and stays the default: `DANGEROUS` is deliberately
        # leaf-keyed, because `cmd.load` and a panel's `load` are the same
        # capability under two names.  The dotted form is the narrower rule, so
        # it wins where both match.
        danger_reason = self.dangerous.get(symbol) or self.dangerous.get(leaf, "")
        dangerous = bool(danger_reason)
        if dangerous and not self.allow_dangerous:
            return Decision(
                symbol=symbol,
                allowed=False,
                reason="dangerous symbols are refused in this deployment: %s"
                % danger_reason,
                dangerous=True,
                danger_reason=danger_reason,
            )
        # One implementation, called from both places: `Dispatcher.do` asks the
        # same question about a command line's leading keyword, and two copies
        # of this predicate would drift.
        needs_confirmation = self.needs_confirmation(symbol)
        return Decision(
            symbol=symbol,
            allowed=True,
            dangerous=dangerous,
            danger_reason=danger_reason,
            needs_confirmation=needs_confirmation,
            routed=leaf in ROUTED,
            invalidates=self.invalidates.get(symbol) or self.invalidates.get(leaf, ()),
        )

    def invalidation_for(self, symbol: str) -> tuple:
        return self.invalidates.get(symbol) or self.invalidates.get(
            symbol.rsplit(".", 1)[-1], ()
        )
