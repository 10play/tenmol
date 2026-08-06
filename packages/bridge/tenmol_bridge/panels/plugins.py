"""The legacy plugin menu, as JSON descriptors over the bridge.

INVENTORY ROW 76, OPTION (b)
----------------------------
The row offered two ways out of the Tk/Qt plugin surface:

    (a) drop ``Plugin > Legacy Plugins`` and define a new React plugin API;
    (b) keep plugins headless in Python and have them register JSON menu
        descriptors (label path with ``|``, id) over the bridge, clicks RPC'd
        back — option (b) preserves ``addmenuitem`` semantics.

This is (b).  A plugin calls the one entry point it has always had,

    pymol.plugins.addmenuitem('My Tool|Run', my_function)

and the browser gets

    {"key": "Plugin|My Tool", "label": "My Tool",
     "items": [{"kind": "command", "index": 0, "label": "Run"}]}

with ``cmd.tenmol_plugins.invoke("Plugin|My Tool", 0)`` calling ``my_function``
on the engine thread.  No Tk, no Qt, no ``sys.meta_path`` hook, no window on the
server's display.

WHY THE SEMANTICS ARE NOT REIMPLEMENTED HERE
--------------------------------------------
``pmg_qt.mimic_pmg_tk.PmwMenuBar`` **is not Qt code**.  It imports with zero Qt
bindings present and only ever calls ``actions`` / ``removeAction`` /
``addSeparator`` / ``addAction`` / ``addMenu`` / ``setTearOffEnabled`` on
whatever its ``menudict`` holds.  So this module supplies a recording
``menudict`` and drives the REAL upstream class, and every semantic the
inventory row lists is upstream's rather than a paraphrase:

  * cascade keys are the pipe-joined label path (``plugins/__init__.py:112-127``)
  * a bare ``-`` leaf becomes a separator
  * a duplicate cascade raises ``ValueError``, which ``plugins.addmenuitem``
    swallows — so re-adding a menu is idempotent
  * an unknown parent prints ``Error: no such menu: 'X'`` and registers nothing
  * ``deletemenuitems`` is 1-based and INCLUSIVE

THE ONE PIECE THAT HAD TO BE REPLACED
-------------------------------------
``PmwMenuBar.addmenuitem`` wraps every command for exception safety — the
comment says "PyMOL would crash if an exception is not caught!" — and the
wrapper's second half is ``QtWidgets.QMessageBox.critical``, reached by
``from pymol.Qt import QtWidgets``.  With no Qt binding installed that import
raises ``ImportError: pymol.Qt`` FROM INSIDE the handler, so a plugin that
raises produces: its own traceback printed by ``colorprinting.print_exc`` (which
does reach the client, as console feedback), and then an ImportError instead of
a dialog.  :meth:`PluginMenuAPI.invoke` catches that and reports it as a
structured failure, which is the replacement wave 7 said a reuser would need.

WHAT IS DELIBERATELY NOT DONE, AND WHY
--------------------------------------
``plugins.HAVE_QT`` is left **False**.  Setting it would make
``plugins.addmenuitemqt`` register too, and that call is a plugin ASSERTING that
its callback opens a PyQt window — which, run here, would open a window on the
SERVER's display for a user who is in a browser somewhere else.  Such plugins
are listed by :meth:`PluginMenuAPI.status` as refused, with that reason, rather
than being silently half-supported.

``cmd.extend`` IS GUARDED, and this is the mitigation for a real upstream
defect: ``PluginInfo.load`` swaps ``cmd.extend`` for a recording wrapper and
restores it on the SUCCESS path only (no ``finally``), so every failed load
leaves the wrapper installed and the wrappers NEST.  :meth:`load` snapshots
``pymol.cmd.extend`` and restores it in a ``finally``, so a failing plugin can
no longer corrupt command registration for the life of the process.  The defect
itself is in ``packages/engine/modules/pymol/plugins/__init__.py`` and is not edited here.
"""

from __future__ import annotations

import traceback
from typing import Any, Callable, Dict, List, Optional

#: Attribute this service attaches to ``pymol.cmd`` as.  Not underscored: the
#: policy refuses a private interior segment (``policy/base.py``), so
#: ``cmd._tenmol_plugins.menu`` would be unreachable from the browser.
ATTR = "tenmol_plugins"

#: One ``{t:'do'}`` line, the way every panel added since wave 5 bootstraps.
BOOTSTRAP = "/import tenmol_bridge.panels.plugins as _p;_p.install()"

#: ``plugins.addmenuitem``'s default menu, and the one ``addmenuitemqt`` uses.
ROOT_MENUS = ("Plugin", "PluginQt")


class _Action:
    """One entry of a menu: what ``QMenu.addAction`` / ``addSeparator`` made."""

    __slots__ = ("kind", "label", "callback", "submenu")

    def __init__(
        self,
        kind: str,
        label: str = "",
        callback: Optional[Callable[[], Any]] = None,
        submenu: Optional["_Menu"] = None,
    ) -> None:
        self.kind = kind  # 'command' | 'separator' | 'menu'
        self.label = label
        self.callback = callback
        self.submenu = submenu


class _Menu:
    """The ``QMenu`` subset ``PmwMenuBar`` actually uses.  Nothing more.

    Six methods, because six is what ``mimic_pmg_tk.py:29-88`` calls.  Anything
    else a future upstream version reaches for will raise ``AttributeError``
    here, loudly, instead of being silently ignored.
    """

    def __init__(self, label: str = "") -> None:
        self.label = label
        self._actions: List[_Action] = []
        self.tear_off = False

    # -- the Qt surface ------------------------------------------------- #

    def actions(self) -> List[_Action]:
        """This menu's actions in insertion order, mirroring ``QMenu.actions``."""
        return self._actions

    def removeAction(self, action: _Action) -> None:  # noqa: N802 - Qt's name
        """Remove ``action`` from this menu if present, like ``QMenu.removeAction``."""
        if action in self._actions:
            self._actions.remove(action)

    def addSeparator(self) -> _Action:  # noqa: N802 - Qt's name
        """Append a separator action and return it, like ``QMenu.addSeparator``."""
        action = _Action("separator")
        self._actions.append(action)
        return action

    def addAction(  # noqa: N802 - Qt's name
        self, label: str, callback: Optional[Callable[[], Any]] = None
    ) -> _Action:
        """Append a command action bound to ``callback``, like ``QMenu.addAction``."""
        action = _Action("command", label, callback)
        self._actions.append(action)
        return action

    def addMenu(self, label: str) -> "_Menu":  # noqa: N802 - Qt's name
        """Append a submenu named ``label`` and return it, like ``QMenu.addMenu``."""
        child = _Menu(label)
        self._actions.append(_Action("menu", label, submenu=child))
        return child

    def setTearOffEnabled(self, on: bool) -> None:  # noqa: N802 - Qt's name
        """Record the tear-off flag; accepted for API parity but otherwise inert."""
        self.tear_off = bool(on)


class HeadlessPMGApp:
    """What ``pymol.gui.get_pmgapp()`` hands a plugin here.

    ``createlegacypmgapp`` builds a ``Scratch_Storage`` with ``root``, ``fifo``
    and a ``menuBar``; the bridge's shim refuses to build it at all and returns
    None, which is why ``plugins.addmenuitem`` has been a no-op and a pmg_tk-era
    ``__init_plugin__(None)`` died on ``'NoneType' object has no attribute
    'menuBar'`` (wave 7).  This is the smallest object that makes the REGISTRY
    half work while keeping the toolkit half absent:

    ``root`` is None ON PURPOSE.  ``plugins.get_tk_root()`` therefore still
    fails immediately with an AttributeError instead of blocking on a hidden Tk
    root — the failure mode a headless server wants.
    """

    def __init__(self) -> None:
        import pymol
        from pmg_qt.mimic_pmg_tk import PmwMenuBar

        self.pymol = pymol
        self.root = None
        self.skin = None
        #: `''` is the menu bar itself, as in `pymol_qt_gui.py`'s menudict.
        self.menudict: Dict[str, _Menu] = {"": _Menu("")}
        for name in ROOT_MENUS:
            self.menudict[name] = self.menudict[""].addMenu(name)
        self.menuBar = PmwMenuBar(self.menudict)

    # NOTE: upstream's `PMGApp.execute` is `eval(c) if isinstance(c, str) else
    # c()` (`mimic_pmg_tk.py:163`). It is deliberately NOT reproduced: nothing
    # in this path calls it, and an `eval` of a string arriving from a plugin
    # (or, through it, from the wire) is a code-execution surface this module
    # does not need in order to register menus.


def _node(key: str, menu: _Menu, by_id: Dict[int, str]) -> Dict[str, Any]:
    """One menu as wire JSON.  ``index`` is the address ``invoke`` takes."""
    items: List[Dict[str, Any]] = []
    for index, action in enumerate(menu.actions()):
        item: Dict[str, Any] = {
            "kind": action.kind,
            "index": index,
            "label": action.label,
        }
        if action.kind == "menu" and action.submenu is not None:
            child_key = by_id.get(id(action.submenu))
            # A submenu the menudict does not know is one nothing can address;
            # it is still shown, with its own items, but has no key.
            item["key"] = child_key
            item["items"] = _node(child_key or "", action.submenu, by_id)["items"]
        items.append(item)
    return {"key": key, "label": menu.label, "items": items}


class PluginMenuAPI:
    """The wire-facing panel API for the plugin menu registry.

    Exposes the plugin menu tree, leaf invocation, plugin loading/discovery,
    and status over the bridge's ``cmd``-attached RPC surface.
    """

    def __init__(self, cmd: Any) -> None:
        self._cmd = cmd

    # ------------------------------------------------------------------ #

    def hello(self) -> Dict[str, Any]:
        """A capability handshake: the attach attr, method names, and install state."""
        return {
            "ok": True,
            "attr": ATTR,
            "methods": ["menu", "invoke", "load", "discover", "status"],
            "installed": _app() is not None,
        }

    def menu(self) -> Dict[str, Any]:
        """Every registered menu, as a tree, keyed by the pipe-joined path."""
        app = _app()
        if app is None:
            return {"ok": False, "reason": "the registry is not installed", "menus": []}
        by_id = {id(menu): key for key, menu in app.menudict.items()}
        menus = [
            _node(key, menu, by_id)
            for key, menu in app.menudict.items()
            if key != ""
        ]
        return {
            "ok": True,
            "menus": menus,
            "root": _node("", app.menudict[""], by_id),
            "keys": [key for key in app.menudict if key != ""],
        }

    def invoke(self, key: str, index: int) -> Dict[str, Any]:
        """Run one leaf.  The click half of "clicks RPC'd back".

        Failure is a RESULT, not an exception: a plugin that raises must not
        take a WebSocket call down with it, and the caller wants to know which
        leaf failed.  The plugin's own traceback has already been printed to the
        console by ``PmwMenuBar``'s wrapper, so it reaches the client's feedback
        pane as well.
        """
        app = _app()
        if app is None:
            return {"ok": False, "error": "the registry is not installed"}
        menu = app.menudict.get(str(key))
        if menu is None:
            return {"ok": False, "error": "no such menu: %r" % (key,)}
        actions = menu.actions()
        position = int(index)
        if position < 0 or position >= len(actions):
            return {"ok": False, "error": "no item %d in %r" % (position, key)}
        action = actions[position]
        if action.kind != "command" or action.callback is None:
            return {"ok": False, "error": "%r item %d is a %s" % (key, position, action.kind)}
        try:
            action.callback()
        except BaseException as exc:  # noqa: BLE001 - a plugin may raise anything
            # `PmwMenuBar`'s wrapper has already printed the plugin's traceback;
            # what arrives here is usually the ImportError its QMessageBox line
            # raises with no Qt binding installed.  Both are reported.
            return {
                "ok": False,
                "label": action.label,
                "error": "%s: %s" % (type(exc).__name__, exc),
                "note": (
                    "the plugin's own traceback was printed to the console by "
                    "pmg_qt.mimic_pmg_tk's exception wrapper"
                ),
                "traceback": traceback.format_exc().splitlines()[-3:],
            }
        return {"ok": True, "label": action.label}

    def discover(self) -> Dict[str, Any]:
        """``plugins.initialize(-2)`` — register, import nothing.

        ``autoload = (pmgapp != -2)``, so ``-2`` is the one mode that reads
        ``~/.pymolpluginsrc.py`` and builds a ``PluginInfo`` per file WITHOUT
        importing any plugin module.  Never ``-1``: that imports every plugin
        off the startup path, and on this build ``apbs_gui`` cannot import
        (it needs ``pymol.Qt``), which trips the ``cmd.extend`` defect below.
        """
        from pymol import plugins

        plugins.initialize(-2)
        return self.status()

    def status(self) -> Dict[str, Any]:
        """The registered plugins as wire rows, each with its loaded/autoload flags."""
        from pymol import plugins

        rows = []
        for name in sorted(plugins.plugins):
            info = plugins.plugins[name]
            rows.append(
                {
                    "name": name,
                    "loaded": bool(getattr(info, "loaded", False)),
                    "autoload": bool(getattr(info, "autoload", True)),
                }
            )
        return {
            "ok": True,
            "installed": _app() is not None,
            "plugins": rows,
            # Stated, not implied: the Qt-flavoured entry point stays refused.
            "haveQt": bool(plugins.HAVE_QT),
            "qtNote": (
                "plugins.addmenuitemqt is refused (HAVE_QT stays False): that "
                "call asserts the plugin opens a PyQt window, which would open "
                "on the server's display, not in the browser."
            ),
        }

    def load(self, name: str, quiet: int = 1) -> Dict[str, Any]:
        """``plugins.plugin_load`` with ``cmd.extend`` restored afterwards.

        THE DEFECT THIS GUARDS (``packages/engine/modules/pymol/plugins/__init__.py``,
        ``PluginInfo.load``): ``cmd.extend`` is swapped for a recording wrapper
        and put back on the SUCCESS path only.  A failed load therefore leaves
        the wrapper installed for the life of the process, the wrappers NEST on
        each subsequent failure, and a command registered later is filed under a
        dead plugin.  One ``plugins.initialize(-1)`` with the shipped
        ``apbs_gui`` (which cannot import without PyQt) is enough to do it.
        """
        import pymol
        from pymol import plugins

        before = pymol.cmd.extend
        try:
            plugins.plugin_load(str(name), quiet=int(quiet))
            ok, error = True, None
        except BaseException as exc:  # noqa: BLE001 - plugins raise anything
            ok, error = False, "%s: %s" % (type(exc).__name__, exc)
        finally:
            restored = pymol.cmd.extend is not before
            pymol.cmd.extend = before
        # `plugin_load` DISCARDS `PluginInfo.load()`'s boolean, so a plugin
        # whose `__init_plugin__` raised comes back as a clean reply and the
        # client is told nothing (measured in wave 7).  The registry knows:
        # report it.
        info = plugins.plugins.get(str(name))
        return {
            "ok": ok,
            "error": error,
            "name": str(name),
            "loaded": bool(getattr(info, "loaded", False)) if info else False,
            # True when upstream really did leave its wrapper behind.
            "extendWasWrapped": restored,
            "menus": self.menu().get("keys", []),
        }


# ---------------------------------------------------------------------- #
# install / uninstall
# ---------------------------------------------------------------------- #


def _app() -> Optional[HeadlessPMGApp]:
    import pymol

    app = getattr(pymol, "_ext_gui", None)
    return app if isinstance(app, HeadlessPMGApp) else None


def install(cmd: Optional[Any] = None) -> Dict[str, Any]:
    """Attach the API and become ``pymol._ext_gui``.  Idempotent.

    ``pymol.gui.get_pmgapp()`` returns ``pymol._ext_gui`` when it is not None
    (``packages/engine/modules/pymol/gui.py:20-25``) and only then falls back to
    ``createlegacypmgapp``, which the bridge shims to a refusal.  Setting it is
    therefore the whole seam: ``plugins.addmenuitem`` starts registering and
    every plugin that uses it becomes reachable, with no edit to
    ``packages/engine/modules/pymol/plugins``.
    """
    import pymol

    if cmd is None:
        cmd = pymol.cmd
    api = getattr(cmd, ATTR, None)
    if not isinstance(api, PluginMenuAPI):
        api = PluginMenuAPI(cmd)
        setattr(cmd, ATTR, api)
    if _app() is None:
        pymol._ext_gui = HeadlessPMGApp()
    return api.hello()


def uninstall(cmd: Optional[Any] = None) -> bool:
    """Detach.  ``pymol._ext_gui`` is process-global; tests must call this."""
    import pymol

    if cmd is None:
        cmd = pymol.cmd
    had = isinstance(getattr(cmd, ATTR, None), PluginMenuAPI)
    if had:
        delattr(cmd, ATTR)
    if _app() is not None:
        pymol._ext_gui = None
    return had


def installed(cmd: Optional[Any] = None) -> bool:
    """True if the plugin menu API is attached to ``cmd`` (defaulting to ``pymol.cmd``)."""
    import pymol

    if cmd is None:
        cmd = pymol.cmd
    return isinstance(getattr(cmd, ATTR, None), PluginMenuAPI)
