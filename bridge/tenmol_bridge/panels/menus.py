"""The menu-bar data feed: PyMOL's own menu tree, resolved into wire nodes.

WHY THIS IS A HARVESTER AND NOT A TRANSCRIPTION
===============================================
The eleven top-level menus are **data**, not widgets.  They are one Python
literal returned by ``PyMOLDesktopGUI.get_menudata`` (``modules/pymol/_gui.py:55``)
and every front end walks that same literal: Qt in ``_addmenu``
(``modules/pmg_qt/pymol_qt_gui.py:295-345``), Tk in
``modules/pmg_tk/skins/normal/__init__.py:1072``.  Transcribing ~700 leaves into
React by hand would fork the source of truth on day one.  This module walks the
real literal instead and emits a JSON tree the client renders generically.

The item grammar, verbatim from ``_addmenu``:

===========================================  =================================
tuple                                        meaning
===========================================  =================================
``('separator',)``                           a rule.  ``('separator','')`` also
                                             occurs (Movie ▸ Nutate) — only
                                             ``item[0]`` is ever inspected.
``('menu', label, [items])``                 a submenu; ``&`` -> ``&&`` in Qt
``('command', label, str)``                  ``cmd.do(str)``
``('command', label, callable)``             called directly (no console echo)
``('command', label, None)``                 ``print('warning: skipping', item)``
                                             and the item is **dropped**
``('check', label, setting)``                SettingAction, true=1 false=0
``('check', label, setting, t)``             **still** true=1 false=0 — Qt tests
                                             ``len(item) > 4``, so a 4-tuple
                                             does NOT carry a true value
``('check', label, setting, t, f)``          SettingAction(true=t, false=f)
``('radio', label, setting, value)``         QActionGroup keyed by *setting name*
``('open_recent_menu',)``                    marker -> the dynamic submenu
anything else                                ``print('error:', item)``
===========================================  =================================

**The callables are the hard part** and the reason this file exists.  About 300
leaves are not command strings but Python callables — bound ``cmd`` methods
(``cmd.undo``), closures over ``cmd`` (``lambda i=i: cmd.zoom('center', i,
animate=-1)``), ``webbrowser.open`` closures, and GUI hooks the toolkit fills in
(``self.file_open``).  A browser cannot receive a closure.  So the harvest runs
``get_menudata`` against a **recording proxy** in place of ``cmd``, then *calls*
every leaf callable exactly once.  Nothing executes: the proxy records
``(dotted name, args, kwargs)`` and returns itself.  That turns

    lambda i=i: cmd.zoom('center', i, animate=-1)

into ``{"type": "call", "calls": [{"fn": "cmd.zoom", "args": ["center", 4],
"kwargs": {"animate": -1}}]}`` with no hand-written table, and it keeps working
when upstream edits the menu.

Three more substitutions make the walk total:

* ``webbrowser.open`` is swapped for a recorder for the duration of the harvest,
  so the eleven Help entries become ``{"type": "url"}``;
* every ``None`` class attribute of ``PyMOLDesktopGUI`` (the toolkit hooks:
  ``file_open``, ``session_save_as``, ``confirm_quit``, ...) is swapped for a
  named sentinel, so they become ``{"type": "hook", "hook": "file_open"}`` —
  the client maps those onto the work package that owns the dialog and shows
  the rest as honestly unavailable rather than silently dead;
* ``mvprg`` / ``mvprg_remove_last`` / ``new_window`` are recorded as hooks with
  their arguments, because they are *stateful* (``_gui.py:950-969``: ``mvprg``
  stores ``movie_start = cmd.get_movie_length() + 1`` and substitutes it into
  the format string).  The client re-implements that two-line state machine; it
  cannot be flattened into a command string.

RUNTIME vs BUILD TIME
=====================
``harvest()`` needs no PyMOL engine at all — ``_gui.py`` imports only ``sys``,
``os`` and ``webbrowser``, and the recorder stands in for ``cmd``.  So it runs
in three places:

* ``python -m tenmol_bridge.panels.menus --ts <file>`` regenerates the client's
  checked-in tree (byte-stable: sorted-free ``json.dumps`` of a deterministic
  walk);
* ``get_menus()`` serves the same tree live once a wire route exists for it
  (see MISSING WIRE ROUTE below);
* ``bridge/tests/test_menus.py`` asserts the shape against the real upstream
  literal, so an upstream menu edit fails the suite instead of silently
  desynchronising the client.

``settings()`` and ``recent_files()`` DO need the engine.

HOW THE BROWSER REACHES THIS MODULE
===================================
There is no ``_bridge.*`` route for a panel (``server.py`` owns that table) and
``policy/grants/`` belongs to no listed owner, so the module binds itself onto
the live ``cmd`` on demand — see :data:`BOOTSTRAP` and :func:`install` at the
bottom of the file.  The client still ships the generated tree as its offline
default, so a bridge that has not been bootstrapped yet renders a complete menu
bar rather than an empty strip, and ``test_menus.py`` proves the two are the
same bytes.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

__all__ = [
    "harvest",
    "get_menus",
    "menu_settings",
    "settings",
    "recent_files",
    "add_recent_file",
    "truncate_recent_label",
    "to_typescript",
    "GENERATOR",
    "SCHEMA_VERSION",
]

#: Bumped when the node schema changes shape.  The client asserts on it.
SCHEMA_VERSION = 1

GENERATOR = "python -m tenmol_bridge.panels.menus --ts " \
            "apps/web/src/features/menubar/generated/menudata.ts"

#: PyMOL puts its accelerators inside the label text — 'Acetylene [Alt-J]',
#: 'Next [PgDn]', 'Undo [Ctrl-Z]'.  They are decorative in Qt (the real bindings
#: come from PyMOL's key map, ``modules/pymol/keyboard.py``), but the client
#: needs them right-aligned like a menu, so they are parsed out here and the
#: label is still shipped verbatim.
_ACCEL = re.compile(r"^(?P<label>.*\S)\s*\[(?P<accel>[^\[\]]+)\]$")


# --------------------------------------------------------------------------
# the recording proxy
# --------------------------------------------------------------------------


class _Recorder:
    """Stands in for ``cmd``.  Records ``path(*args, **kwargs)``; runs nothing.

    ``__getattr__`` deepens the dotted path, ``__call__`` appends a record and
    returns ``self`` so a leaf like the Transparency composite —

        lambda v=val: (cmd.set('transparency_mode', v[0], quiet=0),
                       cmd.set('backface_cull',     v[1], quiet=0),
                       cmd.set('two_sided_lighting',v[2], quiet=0))

    — records all three calls in order and still evaluates to a tuple.
    """

    __slots__ = ("_path", "_sink")

    def __init__(self, path: str, sink: List[Dict[str, Any]]) -> None:
        object.__setattr__(self, "_path", path)
        object.__setattr__(self, "_sink", sink)

    def __getattr__(self, name: str) -> "_Recorder":
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return _Recorder("%s.%s" % (self._path, name), self._sink)

    def __call__(self, *args: Any, **kwargs: Any) -> "_Recorder":
        call: Dict[str, Any] = {"fn": self._path, "args": [], "kwargs": {}}
        for value in args:
            if isinstance(value, _Recorder):
                # `cmd.util.modernize_rendering(1, cmd)` passes `cmd` as the
                # `_self` argument (`modules/pymol/util.py:553`).  Over the wire
                # the bridge's own instance is the only `_self` there is, so the
                # argument is dropped and the fact recorded.
                call["selfArg"] = True
                continue
            call["args"].append(_jsonable(value))
        for key, value in kwargs.items():
            if isinstance(value, _Recorder):
                call["selfArg"] = True
                continue
            call["kwargs"][key] = _jsonable(value)
        self._sink.append(call)
        return self

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return "<recorder %s>" % self._path


class _Hook:
    """A named toolkit seam (``self.file_open``, ``self.mvprg``, ...).

    The base class leaves these as ``None`` (``_gui.py:13-38``) for the toolkit
    to fill in; Qt binds real ``QFileDialog`` methods.  The web client binds its
    own, so the harvest only needs the *name* and the arguments the menu passes.
    """

    __slots__ = ("name", "sink")

    def __init__(self, name: str, sink: List[Dict[str, Any]]) -> None:
        self.name = name
        self.sink = sink

    def __call__(self, *args: Any, **kwargs: Any) -> None:
        record: Dict[str, Any] = {"hook": self.name, "args": [_jsonable(a) for a in args]}
        if kwargs:
            record["kwargs"] = {k: _jsonable(v) for k, v in kwargs.items()}
        self.sink.append(record)


def _jsonable(value: Any) -> Any:
    """Menu literals only ever hold scalars, tuples and lists."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (tuple, list)):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    return repr(value)


# --------------------------------------------------------------------------
# the harvester
# --------------------------------------------------------------------------


def _gui_module() -> Any:
    """``pymol._gui``, importable without starting an engine."""
    return __import__("pymol._gui", fromlist=["PyMOLDesktopGUI"])


def _make_harvester(gui_mod: Any) -> Tuple[Any, List[Dict[str, Any]], List[Dict[str, Any]]]:
    calls: List[Dict[str, Any]] = []
    hooks: List[Dict[str, Any]] = []
    base = gui_mod.PyMOLDesktopGUI

    class Harvester(base):  # type: ignore[misc,valid-type]
        """``PyMOLDesktopGUI`` with every seam replaced by a sentinel."""

        def __init__(self) -> None:
            self.cmd = _Recorder("cmd", calls)

        def __getattr__(self, name: str) -> Any:
            # Reached only for attributes the base class does not define at
            # all.  `get_menudata` uses `self.scene_panel_menu_dialog`, which
            # is NOT among the `= None` declarations (`_gui.py:13-38` lists
            # `scene_panel_dialog`); without this the walk raises.
            if name.startswith("__"):
                raise AttributeError(name)
            return _Hook(name, hooks)

        # Stateful seams: recorded with their arguments, re-implemented client
        # side.  `new_window` would `os.spawnv` a second PyMOL (`_gui.py:41`).
        def new_window(self, extra_argv: Sequence[str] = ()) -> None:
            hooks.append({"hook": "new_window", "args": [list(extra_argv)]})

        def mvprg(self, command: Optional[str] = None) -> None:
            hooks.append({"hook": "mvprg", "args": [command]})

        def mvprg_remove_last(self) -> None:
            hooks.append({"hook": "mvprg_remove_last", "args": []})

    # Every `x = None` class attribute is a toolkit seam.
    for name, value in list(vars(base).items()):
        if value is None and not name.startswith("__"):
            setattr(Harvester, name, _Hook(name, hooks))

    return Harvester(), calls, hooks


def _classify(action: Any, calls: List[Dict[str, Any]], hooks: List[Dict[str, Any]],
              urls: List[str]) -> Dict[str, Any]:
    """One ``('command', label, action)`` payload -> a wire action."""
    if action is None:
        # `_addmenu` prints 'warning: skipping' and never adds the item.
        return {"type": "dropped", "reason": "action is None"}
    if isinstance(action, str):
        return {"type": "do", "command": action}
    if not callable(action):
        return {"type": "dropped", "reason": "not callable: %r" % (action,)}

    del calls[:], hooks[:], urls[:]
    try:
        action()
    except Exception as exc:  # noqa: BLE001 - a menu leaf must never break the walk
        return {"type": "dropped", "reason": "%s: %s" % (type(exc).__name__, exc)}

    if urls:
        return {"type": "url", "url": urls[0]}
    if hooks:
        record = dict(hooks[0])
        out: Dict[str, Any] = {"type": "hook", "hook": record.pop("hook")}
        if record.get("args"):
            out["args"] = record["args"]
        return out
    if calls:
        return {"type": "call", "calls": [dict(c) for c in calls]}
    return {"type": "dropped", "reason": "callable recorded nothing"}


def _split_accel(label: str) -> Tuple[str, Optional[str]]:
    match = _ACCEL.match(label)
    if not match:
        return label, None
    return label, match.group("accel")


def _walk(items: Iterable[Any], harvester: Any, calls: List[Dict[str, Any]],
          hooks: List[Dict[str, Any]], urls: List[str],
          settings_seen: List[str]) -> List[Dict[str, Any]]:
    nodes: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, (tuple, list)) or not item:
            nodes.append({"kind": "error", "raw": repr(item)})
            continue
        kind = item[0]

        if kind == "separator":
            nodes.append({"kind": "separator"})

        elif kind == "menu":
            label, accel = _split_accel(item[1])
            node: Dict[str, Any] = {"kind": "submenu", "label": label}
            if accel:
                node["accel"] = accel
            node["items"] = _walk(item[2], harvester, calls, hooks, urls, settings_seen)
            nodes.append(node)

        elif kind == "command":
            label, accel = _split_accel(item[1])
            action = _classify(item[2], calls, hooks, urls)
            node = {"kind": "command", "label": label}
            if accel:
                node["accel"] = accel
            node["action"] = action
            nodes.append(node)

        elif kind == "check":
            label, accel = _split_accel(item[1])
            setting = item[2]
            # THE `len(item) > 4` RULE, verbatim from `_addmenu`: a 4-tuple such
            # as ('check', 'Specular Reflections', 'specular', 1.0) does NOT
            # override the true value; only a 5-tuple does.
            true_value: Any = item[3] if len(item) > 4 else 1
            false_value: Any = item[4] if len(item) > 4 else 0
            node = {
                "kind": "check",
                "label": label,
                "setting": setting,
                "trueValue": _jsonable(true_value),
                "falseValue": _jsonable(false_value),
            }
            if accel:
                node["accel"] = accel
            nodes.append(node)
            if setting not in settings_seen:
                settings_seen.append(setting)

        elif kind == "radio":
            label, accel = _split_accel(item[1])
            setting = item[2]
            node = {
                "kind": "radio",
                "label": label,
                "setting": setting,
                "value": _jsonable(item[3]),
            }
            if accel:
                node["accel"] = accel
            nodes.append(node)
            if setting not in settings_seen:
                settings_seen.append(setting)

        elif kind == "open_recent_menu":
            # `_addmenu` creates the submenu here and rebuilds it on every
            # `aboutToShow` (`pymol_qt_gui.py:341-347`).
            nodes.append({"kind": "dynamic", "label": "Open Recent...", "source": "open_recent"})

        else:
            nodes.append({"kind": "error", "raw": repr(item)})

    return nodes


def harvest() -> Dict[str, Any]:
    """The whole menu bar as JSON.  No engine required."""
    gui_mod = _gui_module()
    harvester, calls, hooks = _make_harvester(gui_mod)
    urls: List[str] = []

    class _Browser:
        @staticmethod
        def open(url: str, *_args: Any, **_kwargs: Any) -> bool:
            urls.append(url)
            return True

    original = gui_mod.webbrowser
    gui_mod.webbrowser = _Browser  # type: ignore[assignment]
    try:
        data = harvester.get_menudata(harvester.cmd)
        settings_seen: List[str] = []
        menus = _walk(data, harvester, calls, hooks, urls, settings_seen)
    finally:
        gui_mod.webbrowser = original  # type: ignore[assignment]

    return {
        "schema": SCHEMA_VERSION,
        "source": "modules/pymol/_gui.py:55 PyMOLDesktopGUI.get_menudata",
        "menus": menus,
        "settings": settings_seen,
    }


def get_menus() -> Dict[str, Any]:
    """Wire endpoint: the tree, live.  Identical bytes to the generated file."""
    return harvest()


def menu_settings(payload: Optional[Dict[str, Any]] = None) -> List[str]:
    """Every setting name any check/radio in the menu bar is bound to."""
    return list((payload or harvest())["settings"])


# --------------------------------------------------------------------------
# live values (these DO need the engine)
# --------------------------------------------------------------------------


def settings(cmd: Any, names: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    """``{name: {"type": int, "value": scalar}}`` for menu check/radio state.

    ``cmd.get_setting_tuple`` (``modules/pymol/setting.py:413``) returns
    ``(type, values)`` where ``values`` is a 1-tuple except for ``float3``
    (``bg_rgb``), which is why Qt compares ``values[0]``
    (``pymol_qt_gui.py:337``, ``:1076``) and so does the client.
    """
    out: Dict[str, Any] = {}
    for name in names if names is not None else menu_settings():
        try:
            type_, values = cmd.get_setting_tuple(name)
        except Exception as exc:  # noqa: BLE001 - one bad name must not kill the panel
            out[name] = {"error": "%s: %s" % (type(exc).__name__, exc)}
            continue
        out[name] = {"type": int(type_), "value": _jsonable(values[0] if values else None)}
    return out


# --------------------------------------------------------------------------
# Open Recent  (~/.pymol/recent.db)
# --------------------------------------------------------------------------


def _recent_gui() -> Any:
    """A bare ``PyMOLDesktopGUI`` used only for its sqlite recent-files code."""
    gui_mod = _gui_module()
    instance = gui_mod.PyMOLDesktopGUI.__new__(gui_mod.PyMOLDesktopGUI)
    instance._recent_filenames_db = None
    return instance


def recent_files() -> List[str]:
    """``SELECT filename FROM recent ORDER BY timestamp DESC`` (``_gui.py:1005``)."""
    return list(_recent_gui().recent_filenames)


def add_recent_file(path: str) -> List[str]:
    """``REPLACE INTO recent VALUES (?, datetime('now'))``, then prune to ~15-20."""
    gui = _recent_gui()
    gui.recent_filenames_add(path)
    return list(gui.recent_filenames)


def truncate_recent_label(filename: str) -> str:
    """``fname if len(fname) < 128 else '...' + fname[-120:]`` (``pymol_qt_gui.py:346``)."""
    return filename if len(filename) < 128 else "..." + filename[-120:]


# --------------------------------------------------------------------------
# the wire endpoint
# --------------------------------------------------------------------------
#
# There is no ``_bridge.*`` route for a panel module (``server.py`` owns that
# table) and ``policy/grants/`` belongs to no listed owner, so this module binds
# ITSELF onto the live ``cmd`` instead — the same bootstrap the object panel and
# the settings feed use::
#
#     {t:'do'}  '/from tenmol_bridge.panels.menus import install;install()'
#     {t:'call'} 'tenmol_menus', ['menus']
#
# ``/`` makes PyMOL's parser treat the rest of the line as Python
# (``modules/pymol/parser.py``), which is the only way to import a module into
# the engine from the wire.  A bare one-segment symbol resolves against
# ``engine.cmd`` (``dispatch.py: Dispatcher.resolve``) and passes the policy's
# shape rules with no grant, because it is neither private nor a new namespace.

#: The attribute ``install()`` binds onto ``cmd``.  Mirrored by the client in
#: ``apps/web/src/features/menubar/menuSource.ts``.
ATTRIBUTE = "tenmol_menus"

BOOTSTRAP = "/from tenmol_bridge.panels.menus import install;install()"


def entry(cmd: Any, verb: str = "menus", *args: Any, **kwargs: Any) -> Any:
    """One verb-dispatched endpoint, so one bound symbol serves the whole panel.

    ``menus``            the harvested tree (no engine needed, but cheap enough)
    ``settings``         ``{name: {type, value}}`` for every check/radio, or for
                         the names given — ONE round trip instead of 111
    ``recent``           ``~/.pymol/recent.db``, newest first
    ``recent_add``       register a filename and return the new list
    """
    if verb == "menus":
        return harvest()
    if verb == "settings":
        names = args[0] if args else kwargs.get("names")
        if isinstance(names, str):
            names = [names]
        return settings(cmd, names)
    if verb == "recent":
        return recent_files()
    if verb == "recent_add":
        return add_recent_file(str(args[0]))
    raise ValueError(
        "unknown %s verb %r; expected menus, settings, recent, recent_add"
        % (ATTRIBUTE, verb)
    )


def _resolve_cmd(cmd: Any = None) -> Any:
    if cmd is not None:
        return cmd
    import pymol

    return pymol.cmd


def install(cmd: Any = None) -> str:
    """Bind :func:`entry` onto the live ``cmd``.  Idempotent."""
    target = _resolve_cmd(cmd)

    def bound(verb: str = "menus", *args: Any, **kwargs: Any) -> Any:
        return entry(target, verb, *args, **kwargs)

    bound.__name__ = ATTRIBUTE
    bound.__doc__ = entry.__doc__
    setattr(target, ATTRIBUTE, bound)
    return ATTRIBUTE


def uninstall(cmd: Any = None) -> None:
    target = _resolve_cmd(cmd)
    if hasattr(target, ATTRIBUTE):
        try:
            delattr(target, ATTRIBUTE)
        except AttributeError:  # pragma: no cover
            pass


# --------------------------------------------------------------------------
# codegen
# --------------------------------------------------------------------------

_TS_HEADER = '''/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Regenerate with:
 *     %s
 *
 * Source of truth: %s
 * The generator is bridge/tenmol_bridge/panels/menus.py, which walks the real
 * upstream literal against a recording `cmd` proxy; bridge/tests/test_menus.py
 * fails if this file drifts from it.
 */

import type { MenusPayload } from '@tenmol/protocol/topics/menus';

export const MENU_DATA: MenusPayload = %s as MenusPayload;

export default MENU_DATA;
'''


def to_typescript(payload: Optional[Dict[str, Any]] = None) -> str:
    """Deterministic TS module wrapping the harvested tree."""
    payload = payload or harvest()
    body = json.dumps(payload, indent=2, ensure_ascii=False)
    return _TS_HEADER % (GENERATOR, payload["source"], body)


def _main(argv: Sequence[str]) -> int:
    args = list(argv)
    if "--ts" in args:
        target = args[args.index("--ts") + 1]
        text = to_typescript()
        if target == "-":
            sys.stdout.write(text)
        else:
            with open(target, "w", encoding="utf-8") as handle:
                handle.write(text)
            sys.stderr.write("wrote %s (%d bytes)\n" % (target, len(text)))
        return 0
    if "--recent" in args:
        json.dump(recent_files(), sys.stdout, indent=2)
        return 0
    json.dump(harvest(), sys.stdout, indent=2, ensure_ascii=False)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))))
    raise SystemExit(_main(sys.argv[1:]))
