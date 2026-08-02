"""Parity area 1 — the legacy plugin machinery, the ``execapp`` seams, autoload.

Inventory rows 76 (legacy plugin menu machinery), 77 (``execapp`` + the four
monkey-patch seams) and 463 (the enabled-at-startup ``autoload`` toggle).

The three rows share one question: **what is left of PyMOL's plugin system when
there is no Qt window, no Tk root and no ``execapp``?**  The answer, measured
here rather than asserted from source:

* the *menu* half is gone and is gone SAFELY — ``plugins.addmenuitem`` is a
  silent no-op, ``addmenuitemqt`` raises ``QtNotAvailableError``, and the Tk
  helpers raise ``AttributeError`` instead of hanging on a hidden ``Tk()`` root;
* the *registry* half is entirely usable headlessly — ``plugins.initialize(-2)``
  registers every plugin, reads ``~/.pymolpluginsrc.py`` and executes **no**
  plugin code;
* the bridge never calls it, so today the rc file is never read and the plugin
  registry is empty for the life of the process.

SAFETY.  ``plugins.set_pref_changed()`` writes ``~/.pymolpluginsrc.py`` — the
user's real file — the moment it is called with ``instantsave`` on.  Writing
this test cost exactly that: a probe called it and created the file on a machine
that did not have one.  Worse, the obvious guard does not work: ``pref_save``'s
``filename`` is a def-time default, so repointing ``plugins.PYMOLPLUGINSRC``
changes nothing.  :func:`plugin_state` replaces ``plugins.pref_save`` itself.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_wf_plugins.py -q
"""

from __future__ import annotations

import itertools
import os
import sys
import time
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

#: The two plugins PyMOL ships on ``$PYMOL_DATA/startup`` in this build.
SHIPPED = ("apbs_gui", "lightingsettings_gui")


# --------------------------------------------------------------- plumbing


_SEQ = itertools.count(1)


def _pyval(bridge, ws: WSClient, expr: str, timeout: float = 6.0) -> str:
    """Evaluate ``expr`` inside the engine and return what it printed.

    The dispatcher only invokes CALLABLES, so plain module attributes
    (``plugins.HAVE_QT``, ``options.plugins``, ``sys.excepthook``, the seam
    functions themselves) answer ``... is not callable`` over ``t:'call'``.
    Printing them and parsing the console is the only route.

    The ``PyMOL>`` echo line is emitted BEFORE the command runs and contains the
    expression — including the tag — so matching must be anchored at the start
    of the line, where only the real output can be.
    """
    tag = "TENMOLWF%d" % next(_SEQ)
    ws.do("print(%r, %s)" % (tag, expr))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for line in bridge.feedback_lines():
            if line.startswith(tag + " "):
                return line[len(tag) + 1:]
        time.sleep(0.05)
    raise AssertionError("no console output for %r" % (expr,))


@pytest.fixture
def plugin_state(bridge, tmp_path):
    """Save/restore every global ``pymol.plugins`` owns, and disarm the rc write.

    ONE PYMOL PER PROCESS: ``plugins.autoload``, ``plugins.preferences``,
    ``plugins.plugins``, ``plugins.HAVE_QT``, ``pymol._ext_gui`` and
    ``pmg_tk.startup.__path__`` are process globals.  ``initialize()`` REBINDS
    the first three (the rc file assigns to them), so restoring has to rebind,
    not clear-and-update.

    MEASURED, THE HARD WAY: rebinding ``plugins.PYMOLPLUGINSRC`` is **not** a
    safety net.  ``def pref_save(filename=PYMOLPLUGINSRC, quiet=1)`` binds the
    path as a DEF-TIME DEFAULT, so ``set_pref_changed()`` keeps writing the real
    ``~/.pymolpluginsrc.py`` no matter what the module constant says.  The only
    thing that redirects it is replacing ``plugins.pref_save`` itself, which
    ``set_pref_changed`` looks up as a module global at call time.  A first
    version of this fixture redirected the constant, believed it, and created a
    file in the developer's home directory.

    The engine runs in this same process (conftest starts uvicorn on a thread),
    so this touches the very module objects the engine thread sees.  It only
    reads/writes plain Python containers and takes no PyMOL API lock; every
    behavioural assertion still goes over the socket.
    """
    import pymol
    import pymol.plugins as P
    from pmg_tk import startup

    saved = SimpleNamespace(
        rc=P.PYMOLPLUGINSRC,
        pref_save=P.pref_save,
        autoload=P.autoload,
        preferences=P.preferences,
        plugins=P.plugins,
        have_qt=P.HAVE_QT,
        ext_gui=pymol._ext_gui,
        path=list(startup.__path__),
    )

    rc = str(tmp_path / "pymolpluginsrc.py")

    def guarded_pref_save(filename=None, quiet=1):
        """Force EVERY save into tmp_path, whoever calls it and however."""
        return saved.pref_save(rc, quiet)

    P.PYMOLPLUGINSRC = rc
    P.pref_save = guarded_pref_save
    P.autoload = dict(saved.autoload)
    P.preferences = dict(saved.preferences)
    P.plugins = dict(saved.plugins)
    assert not os.path.exists(rc)

    try:
        yield SimpleNamespace(P=P, rc=rc, tmp=tmp_path, home_rc=saved.rc)
    finally:
        P.PYMOLPLUGINSRC = saved.rc
        P.pref_save = saved.pref_save
        P.autoload = saved.autoload
        P.preferences = saved.preferences
        P.plugins = saved.plugins
        P.HAVE_QT = saved.have_qt
        pymol._ext_gui = saved.ext_gui
        startup.__path__[:] = saved.path


# ============================================================ row 76
# Legacy plugin menu machinery: PmwMenuBar, mimic_pmg_tk, mimic_tk.


def test_createlegacypmgapp_is_refused_and_get_pmgapp_stays_None(
    bridge, ws: WSClient, plugin_state
) -> None:
    """The Tk root is never built, and nothing downstream gets a half-object.

    Upstream ``pymol.gui.get_pmgapp()`` memoises ``createlegacypmgapp()`` into
    ``pymol._ext_gui``; in ``pmg_tk`` that is a real hidden ``tkinter.Tk()``.
    ``shims.Shims._create_legacy_pmgapp`` returns None instead, so
    ``get_pmgapp()`` answers None every time rather than caching a stub.
    """
    assert "Shims._create_legacy_pmgapp" in _pyval(
        bridge, ws, "pymol.gui.createlegacypmgapp"
    )
    reply = ws.call_reply("plugins.get_pmgapp")
    assert reply["t"] == "ok" and reply["result"] is None, reply
    assert _pyval(bridge, ws, "pymol._ext_gui") == "None"


def test_addmenuitem_is_a_SILENT_no_op(bridge, ws: WSClient, plugin_state) -> None:
    """A legacy plugin's only entry point does nothing, and says nothing.

    ``addmenuitem`` is guarded by ``if pmgapp is not None`` (plugins/__init__.py),
    so with the Tk app refused it returns None for any label path.  This is the
    whole of row 76 in one assertion: the menu half of the plugin system is
    already gone, and it fails quietly rather than raising into PyMOL's lock.
    """
    for label in ("Plugin Manager", "A|B|C", "-"):
        reply = ws.call_reply("plugins.addmenuitem", label)
        assert reply["t"] == "ok" and reply["result"] is None, (label, reply)


def test_a_duck_typed_pmgapp_DOES_capture_the_label_path(
    bridge, ws: WSClient, plugin_state
) -> None:
    """Evidence for inventory option (b): nothing in ``addmenuitem`` needs Qt.

    ``addmenuitem`` only ever calls ``pmgapp.menuBar.addcascademenu`` and
    ``.addmenuitem``.  Pointing ``pymol._ext_gui`` at a recorder — three lines,
    no toolkit — yields the exact descriptor a JSON menu bridge would need:
    one cascade per interior level, keyed by the ``|``-joined path, then one
    leaf.  Measured, not argued.  It is NOT shipped: installing it needs a
    module under ``packages/bridge/tenmol_bridge/``, which this work package does not own.
    """
    import pymol

    rec = []
    pymol._ext_gui = SimpleNamespace(
        menuBar=SimpleNamespace(
            addcascademenu=lambda *a, **k: rec.append(("cascade", a, k)),
            addmenuitem=lambda *a, **k: rec.append(("item", a, k)),
        )
    )
    assert ws.call_reply("plugins.addmenuitem", "Tools|Deep|Leaf")["t"] == "ok"
    assert ws.call_reply("plugins.addmenuitem", "-")["t"] == "ok"

    assert [entry[0] for entry in rec] == ["cascade", "cascade", "item", "item"]
    # parent, new-menu-name, label= : the path separator is '|', menuName first.
    assert rec[0][1] == ("Plugin", "Plugin|Tools") and rec[0][2] == {"label": "Tools"}
    assert rec[1][1] == ("Plugin|Tools", "Plugin|Tools|Deep")
    assert rec[2][1][:2] == ("Plugin|Tools|Deep", "command")
    assert rec[2][2]["label"] == "Leaf"
    # A bare '-' leaf is a separator, not a command (plugins/__init__.py).
    assert rec[3][1] == ("Plugin", "separator")


def test_addmenuitemqt_raises_QtNotAvailableError_over_the_wire(
    bridge, ws: WSClient, plugin_state
) -> None:
    """``HAVE_QT`` is False here and the failure is a clean typed error frame.

    ``pymol_qt_gui.initializePlugins`` sets ``plugins.HAVE_QT = True``; the
    bridge has no equivalent, deliberately — every plugin that opens a PyQt
    window would open it on the SERVER's display, not the user's browser.
    """
    assert _pyval(bridge, ws, "pymol.plugins.HAVE_QT") == "False"
    reply = ws.call_reply("plugins.addmenuitemqt", "Lighting Settings")
    assert reply["t"] == "err"
    assert reply["error"]["type"] == "QtNotAvailableError"


def test_the_tk_helpers_fail_LOUDLY_rather_than_hanging(
    bridge, ws: WSClient, plugin_state
) -> None:
    """``get_tk_root``/``get_tk_focused`` are the two functions that would block.

    In ``pmg_tk`` they reach into a live Tk root pumped by a 50 ms timer.  Here
    they hit ``None.root`` and come back as an ``AttributeError`` frame in
    milliseconds.  A hang would look identical to a wedged engine, so the mode
    of failure is the point.
    """
    for symbol in ("plugins.get_tk_root", "plugins.get_tk_focused"):
        reply = ws.call_reply(symbol)
        assert reply["t"] == "err", (symbol, reply)
        assert reply["error"]["type"] == "AttributeError"
        assert "'NoneType' object has no attribute 'root'" in reply["error"]["message"]


def test_mimic_tk_never_fires_because_pmg_qt_is_never_imported(
    bridge, ws: WSClient
) -> None:
    """The inventory's live worry: the ``sys.meta_path`` hook in ``mimic_tk``.

    ``pmg_qt/mimic_tk.py`` injects Qt-backed ``tkMessageBox``/``tkFileDialog``
    into ``sys.modules`` and installs a meta_path finder for
    ``tkinter.messagebox``/``tkinter.filedialog``.  It is imported by
    ``pymol_qt_gui``, which this process never touches — so the hook does not
    exist and no dialog module is reachable.  ``pmg_tk``/``pmg_tk.startup`` ARE
    imported: they are the namespace package that carries the startup path,
    and they pull in no toolkit.
    """
    modules = _pyval(
        bridge,
        ws,
        "sorted(m for m in sys.modules if m.split('.')[0] in "
        "('tkinter', 'pmg_qt', 'pmg_tk') or m in ('tkMessageBox', 'tkFileDialog'))",
    )
    assert modules == "['pmg_tk', 'pmg_tk.startup']", modules
    assert _pyval(bridge, ws, "'pmg_qt.mimic_tk' in sys.modules") == "False"
    finders = _pyval(bridge, ws, "[type(f).__name__ for f in sys.meta_path]")
    assert "PmgTkFinder" not in finders and "mimic" not in finders.lower(), finders


def test_the_two_shipped_plugins_are_both_unreachable_and_here_is_why(
    bridge, ws: WSClient, plugin_state
) -> None:
    """Row 76's practical consequence, for the plugins this build actually ships.

    Measured in a throwaway interpreter (``initialize(-1)``, which imports but
    does not legacyinit):

    * ``apbs_gui``  — fails at import: ``pymol.Qt`` -> no PyQt in this venv, so
      ``Unable to initialize plugin 'apbs_gui'``;
    * ``lightingsettings_gui`` — imports fine (loaded=True, no Qt module in
      ``sys.modules``), but its whole ``__init_plugin__`` is one
      ``addmenuitemqt('Lighting Settings', ...)`` call, which raises
      ``QtNotAvailableError`` here.

    So loading legacy plugins headlessly buys nothing: there is no surface for
    them to appear on.  Both are replaced by native features (`features/apbs`,
    the settings panel) rather than ported.  This test pins the two facts that
    the client depends on: the plugins are discoverable, and nothing loads them.
    """
    found = ws.call("plugins.findPlugins", ws.call("plugins.get_startup_path"))
    assert sorted(found) == sorted(SHIPPED), found
    for name in SHIPPED:
        assert _pyval(
            bridge, ws, "'pmg_tk.startup.%s' in sys.modules" % name
        ) == "False", name


# ============================================================ row 77
# execapp and the four monkey-patch seams.


def test_all_five_execapp_seams_are_filled_by_the_bridge(bridge, ws: WSClient) -> None:
    """``execapp``'s four assignments plus ``get_qtwindow``, verified live.

    ``pymol_qt_gui.execapp`` sets ``pymol.gui.createlegacypmgapp``,
    ``cmd._copy_image``, ``cmd._call_in_gui_thread`` and
    ``cmd._call_with_opengl_context``; ``get_qtwindow()`` is the fifth, reached
    from ``cmd.window`` / ``gui.save_as`` / ``gui.save_image``.  Every one of
    them here belongs to ``tenmol_bridge.shims.Shims``.
    """
    for expr in (
        "pymol.cmd._copy_image",
        "pymol.cmd._call_in_gui_thread",
        "pymol.cmd._call_with_opengl_context",
        "pymol.gui.createlegacypmgapp",
    ):
        assert "tenmol_bridge.shims.Shims" in _pyval(bridge, ws, expr), expr
    assert _pyval(bridge, ws, "pymol.gui.get_qtwindow()") == "<tenmol BridgeWindow>"

    shims = bridge.healthz()["shims"]
    assert shims["installed"] is True
    assert shims["known"] == ["copy_image", "window", "session_save_as",
                              "file_save_png"], shims


def test_the_two_thread_seams_run_func_on_the_ENGINE_thread(
    bridge, ws: WSClient
) -> None:
    """Not just installed — they execute, and they execute in the right place.

    Qt's ``MainThreadCaller`` marshals onto the GUI thread.  The bridge's
    equivalent marshals onto the engine thread, which is ``pymol.glutThread``
    (set in ``engine.boot``).  Both seams must return the callable's value, or
    ``cmd.png`` / ``cmd.refresh`` / ``cmd.draw`` silently return None.
    """
    ident = _pyval(bridge, ws, "pymol.glutThread")
    for seam in ("_call_in_gui_thread", "_call_with_opengl_context"):
        got = _pyval(
            bridge,
            ws,
            "pymol.cmd.%s(lambda: __import__('threading').get_ident())" % seam,
        )
        assert got == ident, (seam, got, ident)


def test_no_excepthook_is_installed_and_the_traceback_still_reaches_the_console(
    bridge, ws: WSClient
) -> None:
    """``execapp``'s ``sys.excepthook = traceback.print_exception`` has no analogue.

    It exists so a stray exception cannot kill the Qt event loop.  Here every
    RPC is already wrapped by the pump and answered as an ``err`` frame, and
    Python-origin tracebacks reach the console through ``pcatch`` instead — so
    the hook is genuinely unnecessary, not merely missing.  Both halves are
    asserted, because "we didn't install it" is only safe with the second half.
    """
    assert _pyval(bridge, ws, "sys.excepthook") == "<built-in function excepthook>"
    ws.do("raise ValueError('tenmol-wf-plugins-boom')")
    lines = bridge.wait_for_feedback("tenmol-wf-plugins-boom", timeout=6.0)
    assert any("ValueError" in line for line in lines), lines[-8:]
    # ...and the engine is still answering.
    assert ws.call("cmd.get_version")[0]


def test_the_W_H_invocation_options_are_NOT_what_sizes_this_engine(
    bridge, ws: WSClient
) -> None:
    """``execapp`` applies ``-W/-H`` via ``viewport(fb_scale * win_x, ...)``.

    The bridge does not read ``options.win_x`` at all: the size comes from
    ``BridgeConfig.width/height`` through ``p.reshape``, and ``cmd.viewport`` is
    inert here (pinned in ``test_window_control.py``).  Anyone mapping the
    ``pymol --web`` command line (WP-28) has to wire ``-W/-H`` to
    ``--width/--height`` explicitly; ``win_xy_set`` stays False.
    """
    assert _pyval(bridge, ws, "pymol.invocation.options.win_xy_set") == "False"
    assert _pyval(
        bridge, ws, "(pymol.invocation.options.win_x, pymol.invocation.options.win_y)"
    ) == "(640, 480)"
    # The size that was actually applied came from BridgeConfig, and it is not
    # the invocation default.  `config` is immutable, so this holds whatever
    # another test in this process has reshaped the live viewport to.
    config = bridge.pump.engine.config
    assert (config.width, config.height) != (640, 480)
    # The live surface and the number the client polls stay in lockstep.
    health = bridge.healthz()
    assert ws.call("cmd.get_viewport")[:2] == [health["width"], health["height"]]


def test_closing_a_client_does_NOT_stop_the_engine_there_is_no_heartbeat(
    bridge, ws: WSClient
) -> None:
    """Row 77's open question, answered honestly: nothing watches the tab.

    ``shutdown_requested`` is set only by ``cmd.quit`` (routed).  A closed tab
    drops the session and leaves the engine running — deliberate, because a
    browser reload would otherwise destroy the session — but it also means a
    forgotten bridge lives forever.  No heartbeat or idle-exit exists.
    """
    before = bridge.healthz()
    extra = WSClient(bridge.ws_url)
    try:
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and bridge.healthz()["clients"] <= before["clients"]:
            time.sleep(0.05)
        assert bridge.healthz()["clients"] == before["clients"] + 1
    finally:
        extra.close()

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and bridge.healthz()["clients"] > before["clients"]:
        time.sleep(0.05)
    after = bridge.healthz()
    assert after["clients"] == before["clients"]
    assert after["shutdownRequested"] is False
    assert after["state"] == before["state"]


# ============================================================ row 463
# The enabled-at-startup toggle.


def test_the_plugin_system_is_NEVER_initialized_by_the_bridge(
    bridge, ws: WSClient, plugin_state
) -> None:
    """THE finding behind rows 76 and 463.

    ``invocation.options.plugins == 2`` — the desktop app would autoload and
    legacyinit at startup (``execapp``: ``if options.plugins:
    window.initializePlugins()``).  ``SingletonPyMOL.start()`` does no such
    thing and the bridge never calls ``plugins.initialize``, so:

    * ``plugins.plugins`` is empty for the life of the process, and
    * ``~/.pymolpluginsrc.py`` — where autoload state, the ``verbose`` /
      ``instantsave`` preferences and any user startup path live — is never read.

    The Plugin Manager panel therefore has to initialize the registry itself
    (``plugins.initialize(-2)``), and it MUST do so before writing autoload;
    see the clobber test below.
    """
    assert _pyval(bridge, ws, "pymol.invocation.options.plugins") == "2"
    assert _pyval(bridge, ws, "len(pymol.plugins.plugins)") == "0"
    # The durable half: nothing has been imported off the startup path.
    for name in SHIPPED:
        assert _pyval(bridge, ws, "'pmg_tk.startup.%s' in sys.modules" % name) == "False"


def test_initialize_minus_2_registers_every_plugin_and_runs_NO_plugin_code(
    bridge, ws: WSClient, plugin_state
) -> None:
    """``initialize(-2)`` is the headless-safe mode, and it is enough.

    ``autoload = (pmgapp != -2)`` (plugins/__init__.py), so ``-2`` builds a
    ``PluginInfo`` for every discovered file and loads none of them.  Upstream
    uses the same idiom in ``plugin_load`` (``if len(plugins) == 0:
    initialize(-2)``).  After it, name / version / docstring / autoload are all
    readable — which is exactly what the manager UI shows.
    """
    assert ws.call_reply("plugins.initialize", -2)["t"] == "ok"
    assert _pyval(bridge, ws, "sorted(pymol.plugins.plugins)") == repr(sorted(SHIPPED))
    for name in SHIPPED:
        assert _pyval(bridge, ws, "'pmg_tk.startup.%s' in sys.modules" % name) == "False"
    assert _pyval(
        bridge, ws, "[m for m in sys.modules if m.split('.')[0] in ('tkinter','pmg_qt')]"
    ) == "[]"
    # ...and the metadata the panel would show is real.
    docs = _pyval(
        bridge,
        ws,
        "[(n, bool(i.get_docstring()), i.loaded) "
        "for n, i in sorted(pymol.plugins.plugins.items())]",
    )
    assert docs == "[('apbs_gui', True, False), ('lightingsettings_gui', True, False)]"


def test_PluginInfo_objects_cannot_cross_the_wire(ws: WSClient, plugin_state) -> None:
    """Why the client reads ``plugins.autoload``, not ``plugins.plugins``.

    The codec has no entry for ``PluginInfo`` and refuses rather than
    ``repr()``-ing it.  ``codec.py`` is frozen, so the accessor row 463 asks for
    is built from the plain containers instead — which turns out to be enough.
    """
    assert ws.call_reply("plugins.initialize", -2)["t"] == "ok"
    reply = ws.call_reply("plugins.plugins.copy")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == "NotSerializable"
    assert reply["error"]["detail"]["type"] == "PluginInfo"


def test_autoload_is_READ_through_the_plain_dict_and_matches_PluginInfo(
    bridge, ws: WSClient, plugin_state
) -> None:
    """Row 463's missing accessor already exists: ``plugins.autoload.copy()``.

    ``PluginInfo.autoload`` is ``autoload.get(self.name, True)``, so an absent
    key means enabled.  ``plugins.autoload`` is three segments and a plain
    ``dict``, both of which the generic dispatcher allows, so no new bridge
    surface is needed — the property's read semantics are reproducible exactly.
    """
    assert ws.call_reply("plugins.initialize", -2)["t"] == "ok"
    assert ws.call("plugins.autoload.copy") == {}
    assert _pyval(
        bridge,
        ws,
        "[i.autoload for _, i in sorted(pymol.plugins.plugins.items())]",
    ) == "[True, True]"

    assert ws.call_reply("plugins.autoload.update", {"apbs_gui": False})["t"] == "ok"
    assert ws.call("plugins.autoload.copy") == {"apbs_gui": False}
    assert _pyval(
        bridge,
        ws,
        "[i.autoload for _, i in sorted(pymol.plugins.plugins.items())]",
    ) == "[False, True]"


def test_autoload_is_WRITTEN_the_same_way_the_property_setter_writes_it(
    bridge, ws: WSClient, plugin_state
) -> None:
    """``update`` + ``set_pref_changed`` == the ``@autoload.setter``, byte for byte.

    The setter is ``autoload[name] = bool(value); set_pref_changed()``.  With
    ``instantsave`` on (PyMOL's default) that writes the rc file immediately —
    here redirected to ``tmp_path`` by the fixture, so the user's real
    ``~/.pymolpluginsrc.py`` is untouched.
    """
    rc = plugin_state.rc
    plugin_state.P.preferences["instantsave"] = True
    assert ws.call_reply("plugins.initialize", -2)["t"] == "ok"

    assert ws.call_reply("plugins.autoload.update", {"apbs_gui": False})["t"] == "ok"
    assert ws.call_reply("plugins.set_pref_changed")["t"] == "ok"

    assert os.path.exists(rc), rc
    text = open(rc).read()
    assert "# AUTOGENERATED FILE" in text
    assert "pymol.plugins.autoload = {'apbs_gui': False}" in text
    assert "pymol.plugins.set_startup_path( [] , False)" in text

    # instantsave off => in-memory only, exactly as in the desktop manager.
    os.unlink(rc)
    plugin_state.P.preferences["instantsave"] = False
    assert ws.call_reply("plugins.autoload.update", {"apbs_gui": True})["t"] == "ok"
    assert ws.call_reply("plugins.set_pref_changed")["t"] == "ok"
    assert not os.path.exists(rc)
    assert ws.call("plugins.autoload.copy") == {"apbs_gui": True}


def test_initialize_reads_the_rc_file_and_skipping_it_CLOBBERS_the_user(
    bridge, ws: WSClient, plugin_state
) -> None:
    """The reason the panel must initialize before it offers a checkbox.

    ``pref_save`` serialises the WHOLE in-memory ``autoload`` dict.  A client
    that toggles one plugin without having read the rc file first writes a file
    containing only that one entry — every other choice the user made is gone.
    Both halves are measured here: the loss, and the fix.
    """
    rc = plugin_state.rc
    P = plugin_state.P
    with open(rc, "w") as handle:
        handle.write("import pymol.plugins\n")
        handle.write(
            "pymol.plugins.autoload = "
            "{'user_favourite': False, 'apbs_gui': True}\n"
        )
        handle.write(
            "pymol.plugins.preferences = {'verbose': True, 'instantsave': True}\n"
        )

    # (a) never initialized -> the rc is invisible and the save destroys it.
    assert ws.call("plugins.autoload.copy") == {}
    assert ws.call("plugins.pref_get", "verbose") is False
    assert ws.call_reply("plugins.autoload.update", {"apbs_gui": False})["t"] == "ok"
    assert ws.call_reply("plugins.set_pref_changed")["t"] == "ok"
    assert "user_favourite" not in open(rc).read()

    # (b) initialize first -> the rc is honoured and the save preserves it.
    with open(rc, "w") as handle:
        handle.write("import pymol.plugins\n")
        handle.write(
            "pymol.plugins.autoload = "
            "{'user_favourite': False, 'apbs_gui': True}\n"
        )
        handle.write(
            "pymol.plugins.preferences = {'verbose': True, 'instantsave': True}\n"
        )
    P.autoload = {}
    P.preferences = {"verbose": False, "instantsave": True}
    assert ws.call_reply("plugins.initialize", -2)["t"] == "ok"
    assert ws.call("plugins.autoload.copy") == {
        "user_favourite": False, "apbs_gui": True
    }
    assert ws.call("plugins.pref_get", "verbose") is True

    assert ws.call_reply("plugins.autoload.update", {"apbs_gui": False})["t"] == "ok"
    assert ws.call_reply("plugins.set_pref_changed")["t"] == "ok"
    saved = open(rc).read()
    assert "'user_favourite': False" in saved and "'apbs_gui': False" in saved


def test_PYMOLPLUGINSRC_cannot_be_redirected_at_runtime(bridge, ws: WSClient) -> None:
    """A trap worth pinning: the rc path is frozen at import time.

    ``def pref_save(filename=PYMOLPLUGINSRC, quiet=1)`` evaluates the default
    once, when ``pymol.plugins`` is imported.  Assigning to
    ``plugins.PYMOLPLUGINSRC`` afterwards leaves ``pref_save``'s default — and
    therefore every ``set_pref_changed()`` — pointed at the ORIGINAL path.  Any
    code (a test, a sandbox, a per-project prefs feature) that expects to move
    PyMOL's plugin preferences by setting that constant is silently wrong.
    """
    assert _pyval(
        bridge, ws, "pymol.plugins.pref_save.__defaults__[0]"
    ) == _pyval(bridge, ws, "__import__('os').path.expanduser('~/.pymolpluginsrc.py')")


def test_the_rc_write_is_NOT_flagged_dangerous_by_the_policy(
    ws: WSClient, plugin_state
) -> None:
    """Recorded, not fixed: ``initialize`` and ``set_pref_changed`` look harmless.

    ``initialize`` runs ``~/.pymolpluginsrc.py`` through ``parsing.run_file`` —
    arbitrary Python from the user's home — and ``set_pref_changed`` rewrites
    that file.  Neither leaf is in ``policy/base.py: DANGEROUS``, so neither
    reply carries ``dangerous: true`` and the client cannot tell the user what
    just happened.  Adding a grant would mark EVERY ``*.initialize`` symbol
    (wizards have one), so it is reported rather than applied.
    """
    for symbol in ("plugins.initialize", "plugins.set_pref_changed"):
        reply = ws.call_reply(symbol, *([-2] if symbol.endswith("initialize") else []))
        assert reply["t"] == "ok", reply
        assert reply.get("dangerous", False) is False, reply
