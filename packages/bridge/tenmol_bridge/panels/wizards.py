"""The wizard protocol, served to the browser.  OWNER: WP-16.

A PyMOL wizard is a **plain Python object on a stack inside the C++ core**
(``CWizard::Wiz``, ``packages/engine/layer1/Wizard.cpp:69``).  It is not a widget.  The core
*pulls* a declarative panel and prompt out of it and *pushes* events into it,
through about fifteen optional methods.  Everything a front end needs is in
those methods, so this module ports the **protocol once** and all 26 bundled
wizards -- plus the 16 builder wizards in ``packages/engine/modules/pmg_qt/builder.py`` and any
third-party plugin wizard -- render with no per-wizard code anywhere.

============================  =========================================  =====
method                        C entry point                              gate
============================  =========================================  =====
``get_panel()``               ``WizardRefresh``  ``Wizard.cpp:227``       --
``get_prompt()``              ``WizardRefresh``  ``Wizard.cpp:205``       --
``get_event_mask()``          ``WizardRefresh``  ``Wizard.cpp:220``       --
``get_menu(tag)``             ``CWizard::click`` ``Wizard.cpp:501``       --
``do_pick(bondFlag)``         ``WizardDoPick``   ``Wizard.cpp:303``       1
``do_pick_state(state)``      ``Wizard.cpp:189``, ``:324``               pick/sel
``do_select(name)``           ``WizardDoSelect`` ``Wizard.cpp:172``       2
``do_key(k,x,y,mod)``         ``WizardDoKey``    ``Wizard.cpp:328``       4
``do_special(k,x,y,mod)``     ``WizardDoSpecial````Wizard.cpp:462``       8
``do_scene()``                ``WizardDoScene``  ``Wizard.cpp:396``       16
``do_state(state)``           ``WizardDoState``  ``Wizard.cpp:428``       32
``do_frame(frame)``           ``WizardDoFrame``  ``Wizard.cpp:445``       64
``do_dirty()``                ``WizardDoDirty``  ``Wizard.cpp:412``       128
``do_view()``                 ``WizardDoView``   ``Wizard.cpp:371``       256
``do_position()``             ``WizardDoPosition````Wizard.cpp:344``      512
``cleanup()``                 ``WizardSet``      ``Wizard.cpp:275``       --
============================  =========================================  =====

Every one of them is optional: ``WizardCallPython`` probes with
``PyObject_HasAttrString`` first (``packages/engine/layer1/Wizard.cpp:162``).  So does this
module.  ``toggle.py`` never calls ``Wizard.__init__`` at all, so it has no
``self.cmd``, no ``self.menu`` and no ``self.session`` -- a generic renderer
that assumes those attributes exist crashes on it.

HOW THE CLIENT REACHES THIS MODULE
----------------------------------
``tenmol_bridge.dispatch.Dispatcher.resolve`` maps a dotted ``fn`` whose root is
not ``cmd``/``chempy`` onto the module ``pymol.<root>`` and looks the leaf up
there.  ``_ROOT_MODULES`` lives in ``dispatch.py``, which WP-16 does not own, so
``policy/grants/wp-16.py`` registers this module in ``sys.modules`` under the
name ``pymol.wizards`` and grants the root ``wizards``.  ``__import__`` returns
a module already present in ``sys.modules`` without touching the filesystem and
**without importing the parent package** (verified), so seeding costs nothing
and does not drag ``pymol`` in on the asyncio thread at policy-build time.  The
cleaner fix -- one line in ``_ROOT_MODULES`` -- is reported upstream to WP-02.

Consequently **nothing in this module may import pymol at module scope**: it is
imported while the policy is built, long before the engine thread has booted
PyMOL.  Every entry point imports it lazily instead, and every entry point runs
on the engine thread because the dispatcher submits it to the pump.

WHY THERE IS A VERSION COUNTER AND NOT A PUSH TOPIC
---------------------------------------------------
There is **no Python-visible "wizard changed" callback**; the direction is C
pulling from Python (``WizardRefresh``, ``packages/engine/layer1/Wizard.cpp:195``).  The bridge
therefore wraps ``cmd.refresh_wizard`` / ``set_wizard`` / ``set_wizard_stack`` /
``dirty_wizard`` -- which is safe because *every* wizard method ends with
``self.cmd.refresh_wizard()`` -- and bumps a counter.  :func:`probe` reads that
counter and is **side-effect free**; :func:`snapshot` is not, and must never be
called speculatively:

* ``get_panel()`` has side effects -- ``mutagenesis.py:278`` and
  ``nucmutagenesis.py:147`` force ``mouse_selection_mode``; ``density.py:160``
  and ``filter.py:236`` rebuild their menus from live state.
* ``get_prompt()`` has side effects -- ``charge.py:124-128`` runs
  ``cmd.iterate`` over ``(byres wcharge)``.

So the client polls :func:`probe` and only pulls :func:`snapshot` when the
version, the stack depth or the top class actually changed.
"""

from __future__ import annotations

import functools
import os
import threading
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "EVENT_BITS",
    "EVENT_KINDS",
    "PANEL_TYPES",
    "MENU_CODES",
    "BUNDLED_WIZARDS",
    "MENUBAR",
    "probe",
    "snapshot",
    "menu",
    "exec_code",
    "event",
    "launch",
    "replace",
    "dismiss",
    "catalog",
    "install",
    "uninstall",
    "installed",
]

# ---------------------------------------------------------------------------
# the wire vocabulary (mirrors of real constants, not invented ones)
# ---------------------------------------------------------------------------

#: ``packages/engine/modules/pymol/wizard/__init__.py:6-15`` == ``packages/engine/layer1/Wizard.cpp:49-58``.
EVENT_BITS: Dict[str, int] = {
    "pick": 1,
    "select": 2,
    "key": 4,
    "special": 8,
    "scene": 16,
    "state": 32,
    "frame": 64,
    "dirty": 128,
    "view": 256,
    "position": 512,
}
EVENT_KINDS: Tuple[str, ...] = tuple(EVENT_BITS)

#: ``packages/engine/layer1/Wizard.cpp:44-47``.
PANEL_TYPES: Dict[int, str] = {0: "blank", 1: "text", 2: "button", 3: "popup"}

#: ``packages/engine/layer4/PopUp.cpp:231-248`` / ``:293-320``.
MENU_CODES: Dict[int, str] = {0: "separator", 1: "item", 2: "title"}

#: The Wizard menu of the Qt menubar, verbatim from ``packages/engine/modules/pymol/_gui.py:834``.
#: ``('sep',)`` is a separator; ``('sub', label, [...])`` a submenu.
MENUBAR: Tuple[Any, ...] = (
    ("cmd", "Appearance", "wizard appearance"),
    ("cmd", "Measurement", "wizard measurement"),
    (
        "sub",
        "Mutagenesis",
        (
            ("cmd", "Protein", "wizard mutagenesis"),
            ("cmd", "Nucleic Acids", "wizard nucmutagenesis"),
        ),
    ),
    ("cmd", "Pair Fitting", "wizard pair_fit"),
    ("sep",),
    ("cmd", "Density", "wizard density"),
    ("cmd", "Filter", "wizard filter"),
    ("cmd", "Sculpting", "wizard sculpting"),
    ("sep",),
    ("cmd", "Label", "wizard label"),
    ("cmd", "Charge", "wizard charge"),
    ("sep",),
    (
        "sub",
        "Demo",
        (
            ("cmd", "Representations", "wizard demo, reps"),
            ("cmd", "Cartoon Ribbons", "wizard demo, cartoon"),
            ("cmd", "Roving Detail", "wizard demo, roving"),
            ("cmd", "Roving Density", "wizard demo, roving_density"),
            ("cmd", "Transparency", "wizard demo, trans"),
            ("cmd", "Ray Tracing", "wizard demo, ray"),
            ("cmd", "Sculpting", "wizard demo, sculpt"),
            ("cmd", "Scripted Animation", "wizard demo, anime"),
            ("cmd", "Electrostatics", "wizard demo, elec"),
            ("cmd", "Compiled Graphics Objects", "wizard demo, cgo"),
            ("cmd", "Molscript/Raster3D Input", "wizard demo, raster3d"),
            ("sep",),
            ("cmd", "End Demonstration", "replace_wizard demo, finish"),
        ),
    ),
)

#: Launch names.  ``_wizard()`` imports ``pymol.wizard.<name>`` and instantiates
#: ``name.capitalize()`` (``packages/engine/modules/pymol/wizarding.py:35,41``), and rewrites
#: ``distance`` -> ``measurement`` (``:88``).  Discovered from the package
#: directory at runtime; this tuple is only the fallback ordering.
BUNDLED_WIZARDS: Tuple[str, ...] = (
    "annotation",
    "appearance",
    "benchmark",
    "box",
    "charge",
    "cleanup",
    "command",
    "demo",
    "density",
    "distance",
    "dragging",
    "filter",
    "label",
    "measurement",
    "message",
    "mutagenesis",
    "nucmutagenesis",
    "openvr",
    "pair_fit",
    "pseudoatom",
    "renaming",
    "sculpting",
    "security",
    "stereodemo",
    "toggle",
)

#: Guard rails for :func:`menu`.  ``mutagenesis`` nests one level; a malformed
#: or self-referential menu must not hang the engine thread.
MAX_MENU_DEPTH = 8
MAX_MENU_ITEMS = 2048


# ---------------------------------------------------------------------------
# refresh signalling
# ---------------------------------------------------------------------------

_lock = threading.RLock()
_version = 0
_wrapped: Dict[str, Callable[..., Any]] = {}

#: The four ``cmd`` entry points that can change what a panel looks like.
#: ``wizarding.py:110,120,130,146``.  Wrapping them is the substitute for the
#: callback PyMOL does not have.
_WRAPPED_NAMES = ("refresh_wizard", "dirty_wizard", "set_wizard", "set_wizard_stack")


def _pymol_cmd() -> Any:
    """The live ``cmd`` module.  Imported lazily -- see the module docstring."""
    import pymol  # noqa: WPS433 - deliberately late

    return pymol.cmd


def bump() -> int:
    """Mark the wizard state as changed and return the new version."""
    global _version
    with _lock:
        _version += 1
        return _version


def version() -> int:
    with _lock:
        return _version


def install(cmd: Any = None) -> bool:
    """Wrap the four refresh entry points.  Idempotent; safe to call per RPC."""
    cmd = cmd if cmd is not None else _pymol_cmd()
    with _lock:
        if _wrapped:
            return False
        for name in _WRAPPED_NAMES:
            original = getattr(cmd, name, None)
            if not callable(original):
                continue
            setattr(cmd, name, _make_wrapper(original))
            _wrapped[name] = original
        return True


def uninstall(cmd: Any = None) -> bool:
    """Put the originals back (tests; bridge shutdown)."""
    cmd = cmd if cmd is not None else _pymol_cmd()
    with _lock:
        if not _wrapped:
            return False
        for name, original in _wrapped.items():
            setattr(cmd, name, original)
        _wrapped.clear()
        return True


def installed() -> bool:
    with _lock:
        return bool(_wrapped)


def _make_wrapper(original: Callable[..., Any]) -> Callable[..., Any]:
    @functools.wraps(original)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return original(*args, **kwargs)
        finally:
            bump()

    wrapper.__tenmol_wizard_wrapper__ = True  # type: ignore[attr-defined]
    return wrapper


def _ensure(cmd: Any) -> None:
    if not installed():
        install(cmd)


# ---------------------------------------------------------------------------
# safe access to a wizard's optional methods
# ---------------------------------------------------------------------------


def _call(wiz: Any, name: str, *args: Any) -> Tuple[bool, Any, Optional[str]]:
    """``(present, value, error)`` -- the Python side of ``WizardCallPython``.

    ``packages/engine/layer1/Wizard.cpp:162`` probes with ``PyObject_HasAttrString`` before
    every dispatch, so a missing method is normal and not an error.  A method
    that *raises* is also not fatal to the panel: ``dragging.py`` can go invalid
    mid-session and ``toggle.py`` has no ``self.cmd``, and neither may take the
    whole UI down.  The error text is returned so the client can show it.
    """
    method = getattr(wiz, name, None)
    if method is None or not callable(method):
        return (False, None, None)
    try:
        return (True, method(*args), None)
    except Exception as exc:  # noqa: BLE001 - a broken wizard is not a broken bridge
        return (True, None, "%s: %s" % (type(exc).__name__, exc))


def _implemented(wiz: Any) -> List[str]:
    """Which optional methods this wizard actually has (``hasattr`` semantics)."""
    names = ["get_panel", "get_prompt", "get_menu", "get_event_mask", "cleanup"]
    names += ["do_pick", "do_pick_state", "do_select"]
    names += ["do_%s" % kind for kind in EVENT_KINDS if kind not in ("pick", "select")]
    return [name for name in names if callable(getattr(wiz, name, None))]


def _panel_rows(raw: Any) -> List[Dict[str, Any]]:
    """``[[int type, str text, str code], ...]`` -> wire rows.

    ``packages/engine/layer1/Wizard.cpp:241`` requires at least three items per row and reads
    only the first three.  ``dragging.py:104`` returns ``None`` and
    ``message.py:36`` returns ``[]`` for a prompt-only overlay; both are legal
    and both mean "no panel" (``Wizard.cpp:254-259`` gives them height 0).
    """
    if not raw:
        return []
    rows: List[Dict[str, Any]] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, (list, tuple)) or len(entry) < 3:
            continue
        try:
            row_type = int(entry[0])
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "index": index,
                "type": row_type,
                "kind": PANEL_TYPES.get(row_type, "unknown"),
                "text": "" if entry[1] is None else str(entry[1]),
                "code": "" if entry[2] is None else str(entry[2]),
            }
        )
    return rows


def _prompt_lines(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    return [("" if line is None else str(line)) for line in raw]


# ---------------------------------------------------------------------------
# the RPCs
# ---------------------------------------------------------------------------


def probe() -> Dict[str, Any]:
    """Cheap, SIDE-EFFECT FREE liveness poll.

    Reads only the stack (``WizardGet``/``WizardGetStack``, C list walks) and
    the local version counter.  It never calls ``get_panel``/``get_prompt``,
    which is the whole point -- see the module docstring.
    """
    cmd = _pymol_cmd()
    _ensure(cmd)
    stack = cmd.get_wizard_stack() or []
    top = stack[-1] if stack else None
    return {
        "version": version(),
        "depth": len(stack),
        "cls": type(top).__name__ if top is not None else None,
        "module": type(top).__module__ if top is not None else None,
    }


def snapshot() -> Dict[str, Any]:
    """The full render state of the top wizard.

    HAS SIDE EFFECTS (``get_panel`` / ``get_prompt``); call it on a real change,
    never on a timer.  Mirrors ``WizardRefresh`` (``packages/engine/layer1/Wizard.cpp:195``),
    which pulls prompt, event mask and panel in exactly this order.
    """
    cmd = _pymol_cmd()
    _ensure(cmd)
    stack = cmd.get_wizard_stack() or []
    errors: List[str] = []

    out: Dict[str, Any] = {
        "version": version(),
        "depth": len(stack),
        "stack": [
            {"cls": type(w).__name__, "module": type(w).__module__} for w in stack
        ],
        "cls": None,
        "module": None,
        "panel": [],
        "prompt": [],
        "eventMask": 0,
        "methods": [],
        "errors": errors,
        "promptMode": _prompt_mode(cmd),
    }
    if not stack:
        return out

    top = stack[-1]
    out["cls"] = type(top).__name__
    out["module"] = type(top).__module__
    out["methods"] = _implemented(top)

    present, value, error = _call(top, "get_prompt")
    if error:
        errors.append("get_prompt %s" % error)
    out["prompt"] = _prompt_lines(value) if present else []

    present, value, error = _call(top, "get_event_mask")
    if error:
        errors.append("get_event_mask %s" % error)
    try:
        # Default is pick|select (``wizard/__init__.py:56``), which is what the
        # base class returns; a wizard with no method at all gets the same.
        out["eventMask"] = int(value) if present and value is not None else 3
    except (TypeError, ValueError):
        out["eventMask"] = 3

    present, value, error = _call(top, "get_panel")
    if error:
        errors.append("get_panel %s" % error)
    out["panel"] = _panel_rows(value) if present else []

    return out


def _prompt_mode(cmd: Any) -> int:
    """Setting ``wizard_prompt_mode`` (``packages/engine/layer1/SettingInfo.h:461``, default 1).

    0 = off, 1 = text + opaque backdrop, 2 = text only, 3 = text only flush to
    the top-left corner (``packages/engine/layer1/Ortho.cpp:2136-2190``).
    """
    try:
        return int(cmd.get_setting_int("wizard_prompt_mode"))
    except Exception:  # noqa: BLE001
        return 1


def menu(tag: str = "", depth: int = 0) -> Dict[str, Any]:
    """``get_menu(tag)`` for the top wizard, with callables resolved.

    ``density.py:160``, ``filter.py:236`` and ``command.py:87`` rebuild their
    menus from live state on every open, so this must be called at open time
    and its result must never be cached.
    """
    cmd = _pymol_cmd()
    _ensure(cmd)
    stack = cmd.get_wizard_stack() or []
    if not stack:
        return {"tag": tag, "items": None, "error": "no wizard"}
    present, value, error = _call(stack[-1], "get_menu", str(tag))
    if not present:
        return {"tag": tag, "items": None, "error": "wizard has no get_menu"}
    if error:
        return {"tag": tag, "items": None, "error": error}
    if value is None:
        return {"tag": tag, "items": None, "error": None}
    budget = [MAX_MENU_ITEMS]
    return {"tag": tag, "items": _encode_menu(value, 0, budget), "error": None}


def _encode_menu(raw: Any, level: int, budget: List[int]) -> List[Dict[str, Any]]:
    """``[[code, text, str|list|callable], ...]`` -> wire items.

    ``packages/engine/layer4/PopUp.cpp:231-248``: code 0 is a separator bar (text and command
    are ignored), 1 a selectable item, 2 a non-selectable title.  The third
    element is a **command string**, a **nested list** (submenu), or a
    **callable** -- the lazy submenu form, which ``SubGetItem``
    (``PopUp.cpp:88-105``) resolves by calling it.  No wizard in
    ``packages/engine/modules/pymol/wizard/`` uses the callable form today (``menu.py`` does),
    but ``get_menu`` is user-extensible, so the bridge resolves it here: a
    callable cannot be serialized and must never reach the browser.
    """
    items: List[Dict[str, Any]] = []
    if not isinstance(raw, (list, tuple)):
        return items
    for entry in raw:
        if budget[0] <= 0:
            break
        if not isinstance(entry, (list, tuple)) or len(entry) < 2:
            continue
        budget[0] -= 1
        try:
            code = int(entry[0])
        except (TypeError, ValueError):
            continue
        text = "" if code == 0 or entry[1] is None else str(entry[1])
        item: Dict[str, Any] = {
            "code": code,
            "kind": MENU_CODES.get(code, "unknown"),
            "text": text,
        }
        third = entry[2] if len(entry) > 2 else None
        if code in (0, 2) or third is None:
            items.append(item)
            continue
        if callable(third) and not isinstance(third, (str, bytes)):
            if level >= MAX_MENU_DEPTH:
                item["error"] = "lazy submenu exceeded MAX_MENU_DEPTH"
                items.append(item)
                continue
            try:
                third = third()
            except Exception as exc:  # noqa: BLE001
                item["error"] = "lazy submenu: %s: %s" % (type(exc).__name__, exc)
                items.append(item)
                continue
        if isinstance(third, (list, tuple)):
            if level >= MAX_MENU_DEPTH:
                item["error"] = "submenu exceeded MAX_MENU_DEPTH"
            else:
                item["submenu"] = _encode_menu(third, level + 1, budget)
        else:
            item["command"] = str(third)
        items.append(item)
    return items


def exec_code(code: str) -> Dict[str, Any]:
    """Run a panel row's / menu leaf's ``code`` string.

    ``packages/engine/layer1/Wizard.cpp:573-577`` PLogs it and hands it to ``PParse`` -- the
    **PyMOL command language**, not Python and emphatically not JavaScript.
    ``cmd.do`` is the same parser (``packages/engine/modules/pymol/parser.py``), which is why
    ``sculpting.py:175`` (`cmd.set("sculpting",...)`, raw inline Python) and
    ``demo.py:42`` (`replace_wizard demo,reps`, a keyword) both work through
    one entry point.  The client NEVER evaluates ``code``.
    """
    if not isinstance(code, str) or not code.strip():
        raise ValueError("wizards.exec_code needs a non-empty command string")
    cmd = _pymol_cmd()
    _ensure(cmd)
    cmd.do(code)
    bump()
    return {"executed": code, "version": version()}


def event(kind: str, **payload: Any) -> Dict[str, Any]:
    """Dispatch one wizard event, gated on the event mask exactly like C.

    ``CWizard::isEventType`` (``packages/engine/layer1/Wizard.cpp:140``) is checked *before*
    crossing into Python for every event, and the mask changes with wizard
    sub-state (``box.py:398-403`` adds ``key`` while renaming;
    ``command.py:149-152`` returns 0 unless text is being entered), so it is
    re-read here on every event rather than trusted from a stale snapshot.

    ``do_pick`` and ``do_select`` are both preceded by ``do_pick_state(state)``
    with a **1-based** state (``Wizard.cpp:189``, ``:324`` pass ``state + 1``);
    only ``measurement.py:292`` implements it.
    """
    if kind not in EVENT_BITS:
        raise ValueError(
            "unknown wizard event %r; expected one of %s"
            % (kind, ", ".join(EVENT_KINDS))
        )
    cmd = _pymol_cmd()
    _ensure(cmd)
    stack = cmd.get_wizard_stack() or []
    if not stack:
        return _event_result(kind, False, "no wizard on the stack", 0)
    top = stack[-1]

    present, mask, error = _call(top, "get_event_mask")
    if error:
        return _event_result(kind, False, "get_event_mask %s" % error, 0)
    try:
        mask_value = int(mask) if present and mask is not None else 3
    except (TypeError, ValueError):
        mask_value = 3
    if not (mask_value & EVENT_BITS[kind]):
        return _event_result(kind, False, "masked out", mask_value)

    calls: List[Dict[str, Any]] = []

    if kind in ("pick", "select"):
        selection = payload.get("selection")
        if kind == "pick" and selection:
            # The C editor path creates pk1 (SelectorCreate/EditorActivate) long
            # before WizardDoPick runs; every picking wizard reads `pk1`
            # (measurement.py:310, mutagenesis.py:715, label.py:79, ...).  A
            # browser-side ray pick has to reproduce that here.
            second = payload.get("selection2")
            if second:
                cmd.edit(selection, second)
            else:
                cmd.edit(selection)
        state = payload.get("state")
        if state is None:
            state = _picked_state(cmd)
        _record(calls, top, "do_pick_state", int(state))
        if kind == "pick":
            bond = 1 if payload.get("bond") else 0
            _record(calls, top, "do_pick", bond)
        else:
            name = payload.get("name")
            if not name:
                return _event_result(kind, False, "select needs `name`", mask_value)
            _record(calls, top, "do_select", str(name))
    elif kind in ("key", "special"):
        _record(
            calls,
            top,
            "do_key" if kind == "key" else "do_special",
            int(payload.get("k", 0)),
            int(payload.get("x", 0)),
            int(payload.get("y", 0)),
            int(payload.get("mod", 0)),
        )
    elif kind == "state":
        _record(calls, top, "do_state", int(payload.get("state", cmd.get_state())))
    elif kind == "frame":
        _record(calls, top, "do_frame", int(payload.get("frame", cmd.get_frame())))
    else:
        _record(calls, top, "do_%s" % kind)

    bump()
    result = _event_result(kind, True, None, mask_value)
    result["calls"] = calls
    return result


def _record(calls: List[Dict[str, Any]], wiz: Any, name: str, *args: Any) -> None:
    present, value, error = _call(wiz, name, *args)
    calls.append(
        {
            "method": name,
            "args": [_jsonable(arg) for arg in args],
            "present": present,
            "error": error,
            "result": _jsonable(value),
        }
    )


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return repr(value)


def _event_result(
    kind: str, dispatched: bool, reason: Optional[str], mask: int
) -> Dict[str, Any]:
    return {
        "kind": kind,
        "bit": EVENT_BITS.get(kind, 0),
        "mask": mask,
        "dispatched": dispatched,
        "reason": reason,
        "version": version(),
        "calls": [],
    }


def _picked_state(cmd: Any) -> int:
    """The 1-based state of the object ``pk1`` lives in.

    ``WizardDoPick``/``WizardDoSelect`` pass the picked object's state + 1
    (``packages/engine/layer1/Wizard.cpp:189``, ``:324``).  ``cmd.get_object_state`` is the
    Python equivalent (``filter.py:113`` uses it for the same purpose); the
    global state is the fallback for a pick that resolved to nothing.
    """
    try:
        names = cmd.get_object_list("?pk1")
        if names:
            return int(cmd.get_object_state(names[0]))
    except Exception:  # noqa: BLE001
        pass
    try:
        return int(cmd.get_state())
    except Exception:  # noqa: BLE001
        return 1


def launch(name: str, args: Sequence[Any] = (), kwargs: Any = None) -> Dict[str, Any]:
    """``cmd.wizard(name, *args, **kwargs)`` -- ``packages/engine/modules/pymol/wizarding.py:62``.

    Errors are NOT swallowed.  ``cleanup.py:52-54`` raises ``CmdException``
    ("cannot find \\"szybki\\" executable") when OpenEye is absent, and
    ``mutagenesis``/``nucmutagenesis`` raise ``WizardError`` inside a movie --
    which ``_wizard()`` itself converts into a ``Message`` wizard
    (``wizarding.py:50-52``).  Letting the first kind propagate is how the
    client gets to say so out loud instead of showing an empty panel.
    """
    cmd = _pymol_cmd()
    _ensure(cmd)
    cmd.wizard(str(name), *list(args or ()), **dict(kwargs or {}))
    bump()
    return probe()


def replace(name: str, args: Sequence[Any] = (), kwargs: Any = None) -> Dict[str, Any]:
    """``cmd.replace_wizard(...)`` -- pop + cleanup, then push (``wizarding.py:94``)."""
    cmd = _pymol_cmd()
    _ensure(cmd)
    cmd.replace_wizard(str(name), *list(args or ()), **dict(kwargs or {}))
    bump()
    return probe()


def dismiss(all: bool = False) -> Dict[str, Any]:
    """``cmd.set_wizard()`` pops the top and calls its ``cleanup()``.

    ``WizardSet`` (``packages/engine/layer1/Wizard.cpp:264-283``) pops exactly one; ``all=True``
    empties the stack the way ``cmd.reinitialize`` does
    (``packages/engine/layer3/Executive.cpp:16586``) but without touching anything else.
    """
    cmd = _pymol_cmd()
    _ensure(cmd)
    if all:
        while cmd.get_wizard_stack():
            cmd.set_wizard()
    else:
        cmd.set_wizard()
    bump()
    return probe()


def catalog() -> Dict[str, Any]:
    """Launchable wizard modules + the Qt Wizard menu, for the launcher UI.

    The list is discovered from ``packages/engine/modules/pymol/wizard/`` rather than hardcoded,
    so a third-party module dropped in there shows up.  ``available`` is a
    *static* check (module + ``name.capitalize()`` class present) -- it does NOT
    construct the wizard, because construction has side effects (``charge.py:50``
    enters edit mode, ``sculpting.py:39-62`` reconfigures sculpting).
    """
    import pymol.wizard as wizard_pkg  # noqa: WPS433 - deliberately late

    names = set(BUNDLED_WIZARDS)
    for directory in getattr(wizard_pkg, "__path__", []):
        try:
            for filename in os.listdir(directory):
                if filename.endswith(".py") and not filename.startswith("_"):
                    names.add(filename[:-3])
        except OSError:
            continue

    entries: List[Dict[str, Any]] = []
    for name in sorted(names):
        entry: Dict[str, Any] = {
            "name": name,
            "cls": name.capitalize(),
            "available": True,
            "note": "",
        }
        try:
            module = __import__("pymol.wizard." + name, fromlist=["__name__"])
        except Exception as exc:  # noqa: BLE001
            entry["available"] = False
            entry["note"] = "%s: %s" % (type(exc).__name__, exc)
        else:
            if not hasattr(module, name.capitalize()):
                entry["available"] = False
                entry["note"] = "module has no class %r" % name.capitalize()
        entries.append(entry)

    return {
        "wizards": entries,
        "menubar": _menubar_json(MENUBAR),
        # `wizarding.py:88-89`: cmd.wizard('distance') is rewritten.
        "aliases": {"distance": "measurement"},
    }


def _menubar_json(items: Sequence[Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in items:
        if item[0] == "sep":
            out.append({"kind": "separator"})
        elif item[0] == "sub":
            out.append(
                {"kind": "submenu", "label": item[1], "items": _menubar_json(item[2])}
            )
        else:
            out.append({"kind": "command", "label": item[1], "command": item[2]})
    return out
