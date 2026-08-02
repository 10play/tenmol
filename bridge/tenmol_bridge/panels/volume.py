"""The volume colour-map editor's server half — ``cmd.volume_panel`` without Qt.

WHAT WAS BROKEN.  ``modules/pymol/colorramping.py:183-227`` is the entry point
PyMOL's own internal menu emits (``menu.py:648`` builds the leaf
``cmd.volume_panel('<name>')``), and on a build with no Qt binding it cannot
run at all::

    >>> cmd.volume_panel('vol')
    ImportError: pymol.Qt

``gui.get_qtwindow()`` answers with the bridge's ``BridgeWindow``
(``tenmol_bridge/shims.py:187``), so ``volume_panel`` takes the ``qt_window``
branch and does ``from pmg_qt import volume``, whose first line is
``from pymol.Qt import QtGui``.  Two consequences, both measured:

* the command is dead, so the React panel could only ever be opened by the
  client's own launcher -- never by the menu leaf, a script or the prompt;
* ``from pmg_qt import volume`` imports the ``pmg_qt`` PACKAGE successfully
  before failing on the submodule, so one call leaves ``pmg_qt`` in
  ``sys.modules`` for the life of the process.  ``test_wf_plugins.py`` asserts
  that module is NEVER imported (it is what installs ``mimic_tk``'s
  ``sys.meta_path`` hook for ``tkinter.filedialog``), so the old measurement
  test had to pop it by hand.  **This module never imports pmg_qt, pmg_tk or
  tkinter at all**, and ``test_p10_volume.py`` asserts that.

WHAT THIS DOES INSTEAD.  ``install()`` rebinds two callables:

    cmd.volume_panel   -> a Qt-free shim that RECORDS an open request
    cmd.volume_color   -> the original, plus a ``volume_ramp_changed`` event

and rebinds the same two entries in ``cmd.keyword`` so the typed command
language (``keywords.py:300-301``) reaches the shims too -- that table holds
FUNCTION OBJECTS captured when ``pymol.cmd`` was initialised, so patching the
module attribute alone would leave ``PyMOL>volume_panel vol`` on the old,
crashing function.  Both shims keep upstream's exact signature, because
``parsing.STRICT`` introspects it to map ``vol, rainbow`` onto keyword
arguments; a ``*args, **kwargs`` wrapper breaks the prompt.

THE EVENT SEAM, AND WHY IT IS NOT THE ONE THE INVENTORY ROW SUGGESTED.  Row 431
proposed "replacing the direct ``setColors()`` callback at
``colorramping.py:170-179``", i.e. putting a duck-typed panel into
``colorramping._volume_windows_qt`` and letting ``volume_color``'s own
``_guiupdate`` branch call it.  THAT SEAM IS DEAD HERE, measured: the branch
opens with ``app = gui.get_pmgapp()`` and then calls ``app.execute(...)``.
``get_pmgapp`` memoises ``pymol._ext_gui``, which the bridge pins to ``None``
(``shims.py:190``) while ``gui.createlegacypmgapp`` is replaced by a function
that REFUSES and returns ``None`` (``shims.py:289-300``), so ``app`` is
``None`` and the branch raises ``AttributeError: 'NoneType' object has no
attribute 'execute'``.  Making ``get_pmgapp()`` answer with a shim instead is
not a local change: ``plugins.addmenuitem`` does ``if pmgapp is not None:
pmgapp.menuBar.addcascademenu(...)`` (``modules/pymol/plugins/__init__.py:118``),
so every plugin that registers a menu item would start crashing.  Wrapping
``volume_color`` reproduces the same callback at the same moment with none of
that blast radius.

The wrapper fires only for names a client has ``watch()``ed -- which is exactly
what ``name in _volume_windows_qt`` means upstream: ONE open panel per volume
name, and no callback for a volume nobody is looking at.  It also honours
``_guiupdate``, so the panel's own pushes (``features/volume/service.ts`` sends
``_guiupdate: 0``, as ``pmg_qt/volume.py`` does) never bounce back at it.

DELIVERY, and there is no new protocol topic anywhere.
``packages/protocol/src/topics/index.ts`` is frozen, so ``volume_ramp_changed``
cannot BE a topic; ``feedback`` is the one server->client stream a feature can
reach without editing it.  ``install(echo=1)`` therefore prints one tagged line
per event, and that line is what the browser listens for
(``apps/web/src/features/volume/menuBridge.ts``).  It is a FLAG and not a
constant because the cost is real and visible: the marker shows up in the
user's PyMOL console.  ``echo`` is off by default and the tenmol web client
turns it on explicitly, so the cost is paid by the client that wants the push.

``drain(cursor)`` is the same events as a cursor-addressed, NON-DESTRUCTIVE log
— the shape of the settings tap, where the cursor is the caller's rather than
server state, so two consumers never steal from one another and a client that
reconnects catches up from its own position.  It is the interface a client that
would rather poll than read the console uses, and it is what the tests here
assert against, because a console line cannot carry a sequence number.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, List, Optional

#: Attribute this service attaches to ``pymol.cmd`` as.  Not underscored: the
#: policy refuses a private interior segment, so ``cmd._tenmol_volume.x`` would
#: be unreachable from the browser (same reasoning as ``panels/compute.py``).
ATTR = "tenmol_volume"

#: Console marker for the pushed form of an event.  One line, machine first, so
#: a client can filter it out of the console it renders.
TAG = "TENMOL_VOLUME"

#: Ring size for the event log.  A drag can push hundreds of ramps a second;
#: the log is a catch-up device, not a history.
MAX_EVENTS = 256


class VolumeAPI:
    """``cmd.tenmol_volume`` -- the panel's server-side seam."""

    def __init__(self, cmd: Any) -> None:
        self._cmd = cmd
        self._lock = threading.Lock()
        self._events: List[Dict[str, Any]] = []
        self._seq = 0
        self._watching: List[str] = []
        self._echo = False
        #: What ``install()`` displaced, so ``uninstall()`` can put it back
        #: byte for byte.  Populated by ``install()``.
        self.saved: Dict[str, Any] = {}

    # ------------------------------------------------------------------ #
    # introspection
    # ------------------------------------------------------------------ #

    def hello(self) -> Dict[str, Any]:
        return {
            "ok": True,
            "attr": ATTR,
            "tag": TAG,
            "echo": self._echo,
            "methods": [
                "hello",
                "status",
                "open",
                "watch",
                "unwatch",
                "drain",
                "ramps",
            ],
        }

    def status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "ok": True,
                "attr": ATTR,
                "tag": TAG,
                "echo": self._echo,
                "cursor": self._seq,
                "pending": len(self._events),
                "watching": list(self._watching),
            }

    # ------------------------------------------------------------------ #
    # the event log
    # ------------------------------------------------------------------ #

    def _emit(self, kind: str, name: str, stops: int) -> Dict[str, Any]:
        with self._lock:
            self._seq += 1
            event = {
                "seq": self._seq,
                "kind": kind,
                "name": name,
                "stops": int(stops),
                "at": time.time(),
            }
            self._events.append(event)
            del self._events[:-MAX_EVENTS]
            echo = self._echo
        if echo:
            # Reaches the browser on the `feedback` topic, drained from
            # `cmd._get_feedback()` by the bridge's status thread at 10 Hz.
            print("%s %s %s %d" % (TAG, kind, name, int(stops)))
        return event

    def drain(self, cursor: int = 0) -> Dict[str, Any]:
        """Everything with ``seq > cursor``.  NON-DESTRUCTIVE, like the
        settings tap: the cursor is the caller's, not server state, so two
        consumers never steal from one another.

        ``lost`` is true when the ring dropped events the caller had not seen
        yet -- the honest answer is "re-read everything", not a short list.
        """
        try:
            cursor = int(cursor)
        except (TypeError, ValueError):
            cursor = 0
        with self._lock:
            events = [dict(e) for e in self._events if e["seq"] > cursor]
            oldest = self._events[0]["seq"] if self._events else self._seq + 1
            return {
                "ok": True,
                "cursor": self._seq,
                "lost": bool(cursor and oldest > cursor + 1),
                "events": events,
            }

    # ------------------------------------------------------------------ #
    # the panel registry -- `_volume_windows_qt`, without Qt
    # ------------------------------------------------------------------ #

    def open(self, name: str) -> Dict[str, Any]:
        """Record an open request for ``name`` and report whether it exists.

        ``cmd.volume_panel`` returns ``None`` upstream and this shim keeps that,
        so this is the form a client calls when it wants an answer.
        """
        name = str(name)
        exists = False
        try:
            exists = name in (self._cmd.get_names_of_type("object:volume") or [])
        except Exception:  # noqa: BLE001 - a name check must never raise here
            exists = False
        event = self._emit("panel", name, 0)
        return {"ok": True, "name": name, "exists": exists, "seq": event["seq"]}

    def watch(self, name: str) -> Dict[str, Any]:
        """"A panel for ``name`` is open" -- the ``_volume_windows_qt`` key."""
        name = str(name)
        with self._lock:
            if name not in self._watching:
                self._watching.append(name)
            watching = list(self._watching)
        return {"ok": True, "name": name, "watching": watching}

    def unwatch(self, name: str) -> Dict[str, Any]:
        name = str(name)
        with self._lock:
            if name in self._watching:
                self._watching.remove(name)
            watching = list(self._watching)
        return {"ok": True, "name": name, "watching": watching}

    def watching(self) -> List[str]:
        with self._lock:
            return list(self._watching)

    # ------------------------------------------------------------------ #
    # named ramps
    # ------------------------------------------------------------------ #

    def ramps(self) -> Dict[str, Any]:
        """``sorted(pymol.colorramping.namedramps)`` -- the preset list, live.

        The dict itself is NOT addressable over the wire: ``colorramping`` is
        not one of ``policy/base.py``'s roots, so ``colorramping.namedramps.copy``
        is refused with ``'colorramping' is not an addressable namespace``.  The
        client's other live source is ``menu.vol_color``, which returns the same
        names wrapped in popup rows; this is the direct read the inventory row
        asked for, and it says which are built in so a client can show the
        difference between PyMOL's five and a ``volume_ramp_new`` registration.
        """
        from pymol import colorramping

        names = sorted(colorramping.namedramps)
        builtin = ["2fofc", "esp", "fofc", "rainbow", "rainbow2"]
        return {
            "ok": True,
            "names": names,
            "builtin": [n for n in builtin if n in names],
            "extra": [n for n in names if n not in builtin],
        }

    # ------------------------------------------------------------------ #
    # the shims themselves
    # ------------------------------------------------------------------ #

    def _on_ramp_set(self, name: str, guiupdate: Any) -> None:
        """``colorramping.py:170-179``, with the event in place of ``setColors``."""
        if not guiupdate:
            return
        name = str(name)
        with self._lock:
            if name not in self._watching:
                return
        # THE ORIGINAL GETTER, not `self._cmd.volume_color`.  The shim would
        # work — the getter form does not emit — but the difference is one
        # mutation wide: relaxing the `if ramp:` guard by hand turned this into
        # unbounded recursion and produced 1725 events from one set before the
        # test caught it.  Reading through the saved function makes the event
        # path structurally unable to re-enter the shim.
        getter = self.saved.get("volume_color") or self._cmd.volume_color
        stops = -1
        try:
            flat = getter(name)
            if isinstance(flat, list):
                stops = len(flat) // 5
        except Exception:  # noqa: BLE001 - an event must not break the setter
            stops = -1
        self._emit("ramp", name, stops)


# ---------------------------------------------------------------------- #
# install / uninstall -- the `panels/compute.py` bootstrap pattern, so nothing
# in the frozen barrel or in `server.py` has to change to reach this.
# ---------------------------------------------------------------------- #


def _resolve_cmd(cmd: Optional[Any]) -> Any:
    if cmd is not None:
        return cmd
    import pymol

    return pymol.cmd


def _make_shims(api: VolumeAPI, cmd: Any, original_color: Any):
    """Build the two replacements.

    SIGNATURES ARE COPIED EXACTLY from ``colorramping.volume_color`` and
    ``colorramping.volume_panel``.  ``parsing.STRICT`` reads them to turn
    ``volume_color vol, rainbow`` into a call, so a ``*args`` wrapper would
    break the command language even though the Python API kept working.
    """
    from pymol.constants import CURRENT_STATE

    def volume_color(
        name,
        ramp="",
        state=CURRENT_STATE,
        quiet=1,
        _guiupdate=True,
        _self=cmd,
    ):
        result = original_color(
            name, ramp, state, quiet, _guiupdate=_guiupdate, _self=_self
        )
        # The GETTER form changes nothing and must not fire.  The test is
        # upstream's own -- `if not ramp: return get_volume_color(...)`
        # (`colorramping.py:147`) -- so an empty list reads as a get here too.
        if ramp:
            api._on_ramp_set(name, _guiupdate)
        return result

    volume_color.__doc__ = getattr(original_color, "__doc__", None)
    volume_color.__name__ = "volume_color"

    def volume_panel(name, quiet=1, _self=cmd, _noqt=0):
        """Open the volume colour map editor.

        The browser owns the window, so this records the request and returns
        ``None`` -- the same thing upstream's Qt branch returns after handing
        the panel to the event loop.
        """
        api.open(name)
        return None

    volume_panel.__name__ = "volume_panel"
    return volume_color, volume_panel


def install(cmd: Optional[Any] = None, echo: int = 0) -> Dict[str, Any]:
    """Attach to ``pymol.cmd`` and patch the two entry points; idempotent."""
    cmd = _resolve_cmd(cmd)
    existing = getattr(cmd, ATTR, None)
    if isinstance(existing, VolumeAPI):
        existing._echo = bool(int(echo))
        return existing.hello()

    api = VolumeAPI(cmd)
    api._echo = bool(int(echo))

    original_color = cmd.volume_color
    original_panel = cmd.volume_panel
    shim_color, shim_panel = _make_shims(api, cmd, original_color)

    api.saved = {
        "volume_color": original_color,
        "volume_panel": original_panel,
        "keyword": {},
    }

    cmd.volume_color = shim_color
    cmd.volume_panel = shim_panel

    # The command language holds its own reference, captured at cmd-module init
    # (`keywords.py:300-301`).  Without this, `PyMOL>volume_panel vol` would
    # still reach the crashing original.
    table = getattr(cmd, "keyword", None)
    if isinstance(table, dict):
        for key, shim in (("volume_color", shim_color), ("volume_panel", shim_panel)):
            entry = table.get(key)
            if isinstance(entry, list) and entry:
                api.saved["keyword"][key] = entry[0]
                entry[0] = shim

    setattr(cmd, ATTR, api)
    return api.hello()


def uninstall(cmd: Optional[Any] = None) -> bool:
    """Put ``volume_color`` / ``volume_panel`` back exactly as they were."""
    cmd = _resolve_cmd(cmd)
    api = getattr(cmd, ATTR, None)
    if not isinstance(api, VolumeAPI):
        return False
    saved = api.saved or {}
    if saved.get("volume_color") is not None:
        cmd.volume_color = saved["volume_color"]
    if saved.get("volume_panel") is not None:
        cmd.volume_panel = saved["volume_panel"]
    table = getattr(cmd, "keyword", None)
    if isinstance(table, dict):
        for key, func in (saved.get("keyword") or {}).items():
            entry = table.get(key)
            if isinstance(entry, list) and entry:
                entry[0] = func
    delattr(cmd, ATTR)
    return True


def installed(cmd: Optional[Any] = None) -> bool:
    return isinstance(getattr(_resolve_cmd(cmd), ATTR, None), VolumeAPI)
