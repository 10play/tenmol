"""Parity area 1, wave 7 — inventory rows 76 and 77, re-measured adversarially.

Row 76 is the legacy plugin *menu* machinery (``initializePlugins``,
``PmwMenuBar``, the ``mimic_tk`` shims); row 77 is ``execapp`` and the four
monkey-patch seams.  ``test_wf_plugins.py`` already pins the API-surface half of
both.  This file exists to answer the questions that file does **not**, by
running the code instead of reading it:

1.  What happens to a **real legacy plugin** — a file on the startup path whose
    ``__init_plugin__`` expects a PMGApp?  (Not ``plugins.addmenuitem`` called
    over the wire, which is the easy half.)
2.  Is ``PmwMenuBar`` actually unusable without Qt?  It is **not**: the class is
    pure Python over duck-typed menu objects and imports fine with no Qt in the
    process.  That matters, because the inventory's option (b) is "preserve
    ``addmenuitem`` semantics", and this is the code that defines them.
3.  Does ``mimic_tk``'s ``sys.meta_path`` hook really "still fire headlessly",
    as the row's plan column warns?  It **cannot**: the module dies on its
    ``from pymol.Qt import QtWidgets`` line, 90 lines before the
    ``sys.meta_path.insert``.
4.  Is the ``_call_with_opengl_context`` seam load-bearing, or is the upstream
    default good enough?  Load-bearing, measured with the counterfactual.

Everything asserted here was observed on this machine.  Three results are worth
the reader's attention because the source does not look like it does them:

*   ``PluginInfo.load`` **leaks ``cmd.extend``**.  It swaps in a recording
    wrapper and restores it on the *success* path only — no ``finally`` — so
    every failed plugin load leaves ``pymol.cmd.extend`` permanently wrapped,
    and the wrappers nest.  Headlessly every load that touches the PMGApp or Qt
    fails, including PyMOL's own bundled ``apbs_gui``.
*   ``PmwMenuBar``'s "exception safety" wrapper is not exception-safe without
    Qt: it catches the plugin's error, prints it, and then raises
    ``ImportError: pymol.Qt`` from the ``QMessageBox`` line.
*   A legacy plugin does not receive a *refusal*; it receives ``None`` as its
    PMGApp and dies on ``None.menuBar``.  The RPC caller is told nothing: the
    reply is ``ok``/``None`` and the error exists only on the console.

SAFETY.  Two rules this file obeys and the reader must keep obeying:

*   **Nothing here may import ``tkinter`` or ``pmg_qt`` into the shared engine
    process.**  ``test_wf_plugins.py`` asserts (correctly) that neither is ever
    reachable, and a real ``tkinter.filedialog`` call would block the engine
    forever.  Every experiment that needs ``pmg_qt`` runs in a **subprocess**.
*   ``plugins.set_pref_changed()`` writes the developer's real
    ``~/.pymolpluginsrc.py``.  :func:`legacy` replaces ``plugins.pref_save``
    itself, because ``pref_save``'s filename is a def-time default and
    repointing ``plugins.PYMOLPLUGINSRC`` does not move it.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_f7_startup.py -q
"""

from __future__ import annotations

import itertools
import os
import subprocess
import sys
import textwrap
import time
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

_SEQ = itertools.count(1)


def _pyval(bridge, ws: WSClient, expr: str, timeout: float = 8.0) -> str:
    """Evaluate ``expr`` in the engine and return what it printed.

    The dispatcher invokes CALLABLES only, so plain attributes (``sys.stdout``,
    ``options.no_gui``, the seam functions) cannot be fetched with ``t:'call'``.
    PyMOL echoes the command before running it, so the match is anchored at the
    start of the line where only the real output can be.
    """
    tag = "TENMOLF7S%d" % next(_SEQ)
    ws.do("print(%r, %s)" % (tag, expr))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for line in bridge.feedback_lines():
            if line.startswith(tag + " "):
                return line[len(tag) + 1:]
        time.sleep(0.05)
    raise AssertionError("no console output for %r" % (expr,))


def _subprocess(source: str) -> subprocess.CompletedProcess:
    """Run ``source`` in a fresh interpreter — the only safe place for ``pmg_qt``.

    ``sys.executable`` is ``bridge/.venv/bin/python``, the same interpreter the
    suite runs in, so ``pymol``/``pmg_qt`` resolve to the same files.  Nothing
    it imports can reach the shared engine.
    """
    proc = subprocess.run(
        [sys.executable, "-c", textwrap.dedent(source)],
        capture_output=True, text=True, timeout=180,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return proc


# --------------------------------------------------------------- fixtures


#: Three plugins covering the three ways a plugin can ask for a menu entry.
PLUGIN_SOURCES = {
    # (a) the pmg_tk-era API: the PMGApp is handed in and carries the menu bar.
    "f7legacy_pmgapp": '''\
"""f7 legacy plugin: expects a PMGApp with a menuBar."""
def __init_plugin__(app):
    app.menuBar.addmenuitem('Plugin', 'command', label='F7 legacy',
                            command=lambda: None)
''',
    # (b) the modern toolkit-neutral API.
    "f7legacy_addmenuitem": '''\
"""f7 legacy plugin: uses pymol.plugins.addmenuitem."""
import pymol.plugins
def __init_plugin__(app=None):
    pymol.plugins.addmenuitem('F7|Deep|Leaf', lambda: None)
''',
    # (c) the Qt-only API, which is what PyMOL's own bundled plugins use.
    "f7legacy_qt": '''\
"""f7 legacy plugin: uses addmenuitemqt, like lightingsettings_gui."""
import pymol.plugins
def __init_plugin__(app=None):
    pymol.plugins.addmenuitemqt('F7 Qt', lambda: None)
''',
}


@pytest.fixture
def legacy(bridge, tmp_path):
    """Put three synthetic plugins on the startup path; put every global back.

    ONE PYMOL PER PROCESS.  This touches ``plugins.plugins``,
    ``plugins.autoload``, ``plugins.preferences``, ``plugins.HAVE_QT``,
    ``pymol._ext_gui``, ``pmg_tk.startup.__path__``, ``sys.modules`` **and**
    ``pymol.cmd.extend`` — the last one because the code under test corrupts it
    (see :func:`test_a_failed_plugin_load_LEAKS_cmd_extend`).  All of them are
    restored, and the ``sys.modules`` purge is what keeps
    ``test_wf_plugins.py::test_mimic_tk_never_fires...`` green: it asserts the
    exact list ``['pmg_tk', 'pmg_tk.startup']``.
    """
    import pymol
    import pymol.plugins as P
    from pymol import cmd as cmd_module
    from pmg_tk import startup

    plugdir = tmp_path / "startup"
    plugdir.mkdir()
    for name, source in PLUGIN_SOURCES.items():
        (plugdir / (name + ".py")).write_text(source)

    saved = SimpleNamespace(
        rc=P.PYMOLPLUGINSRC,
        pref_save=P.pref_save,
        autoload=P.autoload,
        preferences=P.preferences,
        plugins=P.plugins,
        have_qt=P.HAVE_QT,
        ext_gui=pymol._ext_gui,
        path=list(startup.__path__),
        extend=cmd_module.extend,
        modules=sorted(m for m in sys.modules if m.startswith("pmg_tk.startup.")),
    )

    rc = str(tmp_path / "pymolpluginsrc.py")

    def guarded_pref_save(filename=None, quiet=1):
        return saved.pref_save(rc, quiet)

    P.PYMOLPLUGINSRC = rc
    P.pref_save = guarded_pref_save
    P.autoload = {}
    P.preferences = dict(saved.preferences)
    P.plugins = {}
    startup.__path__.insert(0, str(plugdir))
    assert not os.path.exists(rc)

    try:
        yield SimpleNamespace(P=P, rc=rc, dir=str(plugdir), names=tuple(PLUGIN_SOURCES))
    finally:
        P.PYMOLPLUGINSRC = saved.rc
        P.pref_save = saved.pref_save
        P.autoload = saved.autoload
        P.preferences = saved.preferences
        P.plugins = saved.plugins
        P.HAVE_QT = saved.have_qt
        pymol._ext_gui = saved.ext_gui
        startup.__path__[:] = saved.path
        cmd_module.extend = saved.extend
        for module in [m for m in sys.modules if m.startswith("pmg_tk.startup.")]:
            if module not in saved.modules:
                del sys.modules[module]


# ===================================================================== row 76
# What a legacy plugin actually experiences.


def test_a_legacy_plugin_is_handed_None_as_its_PMGApp_and_dies_on_None_menuBar(
    bridge, ws: WSClient, legacy
) -> None:
    """The row's central question, answered by running a plugin, not by reading.

    ``PluginInfo.load`` does ``if pmgapp is None: pmgapp = get_pmgapp()``.  The
    bridge's ``createlegacypmgapp`` returns None, so the plugin's
    ``__init_plugin__`` is called with **None** — it is not skipped, and it is
    not told why.  ``app.menuBar`` therefore raises ``AttributeError``, which
    ``load()``'s bare ``except`` turns into two console lines.

    MEASURED, and it is the part that matters for a client: the RPC reply is
    ``ok`` with ``result: None``.  ``plugin_load`` discards ``info.load()``'s
    boolean, so nothing on the wire says the plugin failed — the only evidence
    is the console.
    """
    assert ws.call_reply("plugins.initialize", -2)["t"] == "ok"
    reply = ws.call_reply("plugins.plugin_load", "f7legacy_pmgapp")
    assert reply["t"] == "ok" and reply["result"] is None, reply

    lines = bridge.wait_for_feedback("f7legacy_pmgapp", timeout=8.0)
    joined = "\n".join(lines)
    assert "'NoneType' object has no attribute 'menuBar'" in joined, lines[-8:]
    assert "Unable to initialize plugin 'f7legacy_pmgapp'" in joined, lines[-8:]
    # ...and the engine is unharmed.
    assert ws.call("cmd.get_version")[0]


def test_the_modern_addmenuitem_API_loads_CLEANLY_and_registers_NOTHING(
    bridge, ws: WSClient, legacy
) -> None:
    """The silent half of row 76, and the reason the panel has to say so in prose.

    A plugin written against ``pymol.plugins.addmenuitem`` — the toolkit-neutral
    API — loads with no error at all: ``addmenuitem`` is guarded by
    ``if pmgapp is not None`` and simply returns.  ``loaded`` goes True, a
    ``loadtime`` is recorded, and the user has a plugin that is "installed and
    enabled" with no way to invoke it and no message anywhere.

    Contrast with the ``pmgapp`` plugin above, which at least fails loudly.
    """
    assert ws.call_reply("plugins.initialize", -2)["t"] == "ok"
    before = len(bridge.feedback_lines())
    assert ws.call_reply("plugins.plugin_load", "f7legacy_addmenuitem")["t"] == "ok"

    assert _pyval(
        bridge, ws, "pymol.plugins.plugins['f7legacy_addmenuitem'].loaded"
    ) == "True"
    assert _pyval(
        bridge, ws, "pymol.plugins.plugins['f7legacy_addmenuitem'].loadtime is not None"
    ) == "True"
    new = bridge.feedback_lines()[before:]
    assert not [line for line in new if "f7legacy_addmenuitem" in line
                and "print(" not in line and "plugin_load" not in line], new
    # "registers NOTHING" concretely: the plugin's addmenuitem hit the
    # `if pmgapp is not None` guard, and no PMGApp was memoised on the way past.
    assert _pyval(bridge, ws, "pymol._ext_gui") == "None"
    assert _pyval(bridge, ws, "pymol.gui.get_pmgapp()") == "None"


def test_addmenuitemqt_leaves_a_plugin_in_THREE_contradictory_states(
    bridge, ws: WSClient, legacy
) -> None:
    """The ``lightingsettings_gui`` shape: imported, "not loaded", load() == True.

    ``except QtNotAvailableError: colorprinting.warning(...)`` falls off the end
    of the ``try`` into ``return True`` — but ``self.loadtime = ...`` sits
    *inside* the ``try``, after ``legacyinit``, so it never runs.  ``loaded`` is
    ``loadtime is not None``.  MEASURED, all three at once:

    * ``load()`` returns **True** (the caller is told it worked);
    * ``info.loaded`` is **False** (the manager UI is told it did not);
    * ``sys.modules['pmg_tk.startup.f7legacy_qt']`` **exists** (the module's
      top-level code really did run).

    A UI that offers "load" per row will therefore re-run the module's
    ``__init_plugin__`` every time it is clicked and never change the checkbox.
    """
    assert ws.call_reply("plugins.initialize", -2)["t"] == "ok"
    assert ws.call_reply("plugins.plugin_load", "f7legacy_qt")["t"] == "ok"

    lines = bridge.wait_for_feedback("only available with PyQt GUI", timeout=8.0)
    assert any("f7legacy_qt" in line and "only available with PyQt GUI" in line
               for line in lines), lines[-8:]

    assert _pyval(bridge, ws, "pymol.plugins.plugins['f7legacy_qt'].loaded") == "False"
    assert _pyval(bridge, ws, "pymol.plugins.plugins['f7legacy_qt'].loadtime") == "None"
    assert _pyval(
        bridge, ws, "'pmg_tk.startup.f7legacy_qt' in sys.modules"
    ) == "True"
    assert _pyval(bridge, ws, "pymol.plugins.plugins['f7legacy_qt'].load()") == "True"
    # HAVE_QT is what gates it, and nothing here ever sets it.
    assert _pyval(bridge, ws, "pymol.plugins.HAVE_QT") == "False"


def test_a_failed_plugin_load_LEAKS_cmd_extend(bridge, ws: WSClient, legacy) -> None:
    """UPSTREAM DEFECT, measured: ``PluginInfo.load`` has no ``finally``.

    ``load()`` swaps ``cmd.extend`` for a wrapper that records the plugin's
    commands and restores it *after* ``legacyinit``::

        extend_orig = cmd.extend
        cmd.extend = extend_overload
        __import__(self.mod_name)
        if pmgapp != -1: self.legacyinit(pmgapp)
        cmd.extend = extend_orig      # <- only reached on success
        ...
        except: ...

    Every headless legacy load takes the ``except`` branch, so
    ``pymol.cmd.extend`` stays wrapped **for the life of the process**, and a
    second failure wraps the wrapper.  Measured here: name goes
    ``extend`` -> ``extend_overload``, and the two failed loads nest, so a later
    ``cmd.extend`` call appends to a dead plugin's ``commands`` list.

    Reported, not fixed: ``modules/pymol/plugins/__init__.py`` is upstream code,
    not bridge code.  The fixture restores ``cmd.extend`` so the rest of the
    suite never sees it.
    """
    assert _pyval(bridge, ws, "pymol.cmd.extend.__name__") == "extend"
    assert ws.call_reply("plugins.initialize", -2)["t"] == "ok"

    assert ws.call_reply("plugins.plugin_load", "f7legacy_pmgapp")["t"] == "ok"
    assert _pyval(bridge, ws, "pymol.cmd.extend.__name__") == "extend_overload"
    first = _pyval(bridge, ws, "pymol.cmd.extend.__closure__ is not None")
    assert first == "True"

    # A second failure wraps the wrapper: the closure of the new extend_overload
    # holds the previous one as its extend_orig.
    assert ws.call_reply("plugins.plugin_load", "f7legacy_qt")["t"] == "ok"
    assert _pyval(
        bridge, ws,
        "[c.cell_contents.__name__ for c in pymol.cmd.extend.__closure__ "
        "if callable(c.cell_contents)]",
    ) == "['extend_overload']"

    # The user-visible consequence: a command registered now is filed under a
    # plugin that failed to load.
    ws.do("pymol.cmd.extend('f7_leaked_cmd', lambda: None)")
    assert _pyval(
        bridge, ws, "'f7_leaked_cmd' in pymol.plugins.plugins['f7legacy_qt'].commands"
    ) == "True"
    ws.do("pymol.cmd.keyword.pop('f7_leaked_cmd', None)")


def test_initialize_minus_1_autoloads_and_therefore_leaks_too(
    bridge, ws: WSClient, legacy
) -> None:
    """Why the client uses ``initialize(-2)`` and must keep using it.

    ``initialize(-1)`` autoloads every discovered plugin (``autoload =
    (pmgapp != -2)``) but skips ``legacyinit``.  Measured on this build, one
    call is enough to do real damage:

    * every file on the startup path is imported — arbitrary module-level
      Python, here the three synthetic plugins, which all import cleanly;
    * PyMOL's own bundled ``apbs_gui`` does **not** import (it needs
      ``pymol.Qt``), so ``load()`` takes its bare ``except`` and leaves
      ``cmd.extend`` permanently wrapped — the defect pinned in the previous
      test, triggered here by a *shipped* plugin rather than a synthetic one.

    That is the concrete reason ``pluginSystem.ts`` must keep passing ``-2``:
    the mode difference is not "a bit more work", it is one irreversible global
    mutation per broken plugin.
    """
    assert _pyval(bridge, ws, "pymol.cmd.extend.__name__") == "extend"
    assert ws.call_reply("plugins.initialize", -1)["t"] == "ok"

    for name in legacy.names:
        assert _pyval(
            bridge, ws, "'pmg_tk.startup.%s' in sys.modules" % name
        ) == "True", name
    # -1 skips legacyinit, so these three record a loadtime and claim success.
    assert _pyval(
        bridge, ws,
        "[i.loaded for _, i in sorted(pymol.plugins.plugins.items()) "
        "if _.startswith('f7')]",
    ) == "[True, True, True]"

    lines = bridge.wait_for_feedback("Unable to initialize plugin", timeout=8.0)
    assert any("apbs_gui" in line for line in lines), lines[-8:]
    assert _pyval(bridge, ws, "pymol.plugins.plugins['apbs_gui'].loaded") == "False"
    assert _pyval(bridge, ws, "pymol.cmd.extend.__name__") == "extend_overload"


def test_PmwMenuBar_runs_headlessly_and_here_are_its_exact_semantics() -> None:
    """``PmwMenuBar`` is **not** Qt code.  Run in a subprocess, no Qt installed.

    The inventory files ``PmwMenuBar`` under "Qt machinery that cannot exist in
    a browser".  Measured: ``pmg_qt.mimic_pmg_tk`` imports fine with no Qt
    binding in the interpreter (``mimic_tk`` does not — see the next test), and
    ``PmwMenuBar`` is 60 lines of pure Python that only ever calls
    ``actions`` / ``removeAction`` / ``addSeparator`` / ``addAction`` /
    ``addMenu`` / ``setTearOffEnabled`` on whatever objects the ``menudict``
    holds.  A recorder satisfies all six.

    That makes it the **specification** for the inventory's option (b), and it
    is reusable as-is.  What this pins, all observed:

    * ``addmenuitem('Tools|Deep|Leaf')`` creates cascades keyed
      ``Plugin|Tools`` and ``Plugin|Tools|Deep`` and one leaf labelled ``Leaf``;
    * a bare ``'-'`` leaf becomes a separator;
    * a duplicate cascade raises ``ValueError: menu 'Plugin|Tools' exists``
      (which ``plugins.addmenuitem`` swallows, so re-adding is idempotent);
    * an unknown parent prints ``Error: no such menu: 'Nope'`` and returns;
    * ``deletemenuitems(name, start, end)`` is **1-based and inclusive**
      (``actions()[start-1:end]``);
    * every cascade gets ``setTearOffEnabled(True)``.

    AND THE DEFECT: the "exception safety" wrapper — the one whose comment says
    "PyMOL would crash if an exception is not caught!" — catches the plugin's
    error, prints it, and then raises ``ImportError: pymol.Qt`` from its
    ``QMessageBox.critical`` line.  Anyone reusing ``PmwMenuBar`` for option (b)
    must replace that wrapper, not just the menu objects.
    """
    out = _subprocess('''
        import sys
        import pymol
        from pymol import plugins
        from pmg_qt.mimic_pmg_tk import PmwMenuBar

        class Menu:
            def __init__(self, label=""):
                self.label, self._actions, self.tearoff = label, [], None
            def actions(self): return list(self._actions)
            def removeAction(self, a): self._actions.remove(a)
            def addSeparator(self): self._actions.append(("separator", None, None))
            def addAction(self, label, fn): self._actions.append(("action", label, fn))
            def addMenu(self, label):
                m = Menu(label); self._actions.append(("menu", label, m)); return m
            def setTearOffEnabled(self, v): self.tearoff = v

        menudict = {"": Menu("menubar"), "Plugin": Menu("Plugin")}
        bar = PmwMenuBar(menudict)
        pymol._ext_gui = type("App", (), {"menuBar": bar})()

        def boom(): raise RuntimeError("plugin blew up")

        plugins.addmenuitem("Tools|Deep|Leaf", boom)
        plugins.addmenuitem("-", None)
        print("KEYS", sorted(menudict))

        tools = menudict["Plugin"].actions()
        deep = tools[0][2].actions()
        leaf = deep[0][2].actions()
        print("SHAPE", [a[0] for a in tools], [a[0] for a in deep], [a[0] for a in leaf])
        print("LABELS", tools[0][1], deep[0][1], leaf[0][1])
        print("TEAROFF", tools[0][2].tearoff, deep[0][2].tearoff)

        try:
            bar.addcascademenu("Plugin", "Plugin|Tools", label="Tools")
        except ValueError as e:
            print("DUP", e)
        # plugins.addmenuitem swallows that ValueError, so re-adding is a no-op.
        plugins.addmenuitem("Tools|Deep|Leaf2", None)
        print("IDEMPOTENT", [a[1] for a in deep[0][2].actions()])

        bar.addmenuitem("Nope", "command", label="x", command=boom)

        try:
            leaf[0][2]()
        except BaseException as e:
            print("WRAPPER", type(e).__name__, e)

        bar.deletemenuitems("Plugin", 1, 2)
        print("DELETED", menudict["Plugin"].actions())
        print("METAPATH", [type(f).__name__ for f in sys.meta_path])
        print("TK", "tkinter" in sys.modules)
    ''')
    got = out.stdout

    assert "KEYS ['', 'Plugin', 'Plugin|Tools', 'Plugin|Tools|Deep']" in got, got
    assert "SHAPE ['menu', 'separator'] ['menu'] ['action']" in got, got
    assert "LABELS Tools Deep Leaf" in got, got
    assert "TEAROFF True True" in got, got
    assert "DUP menu 'Plugin|Tools' exists" in got, got
    assert "IDEMPOTENT ['Leaf', 'Leaf2']" in got, got
    assert "Error: no such menu: 'Nope'" in got, got
    # The plugin's own error is printed and then LOST behind an ImportError.
    assert "RuntimeError: plugin blew up" in got, got
    assert "WRAPPER ImportError pymol.Qt" in got, got
    assert "DELETED []" in got, got
    assert "TK False" in got, got
    assert "MimicTkImporter" not in got, got


def test_mimic_tk_CANNOT_install_its_meta_path_hook_without_a_Qt_binding() -> None:
    """CORRECTION to the row's plan column, measured.

    The row warns: "``mimic_tk``'s global ``sys.meta_path`` hook still fires
    headlessly and would hand plugins invisible Qt dialogs".  It cannot.
    ``pmg_qt/mimic_tk.py`` line 9 is ``from pymol.Qt import QtWidgets``, and the
    ``sys.modules`` injections and ``sys.meta_path.insert`` are at lines 99-128.
    With no PyQt/PySide in this interpreter the import dies at line 9, so:

    * ``sys.modules['tkMessageBox']`` / ``['tkFileDialog']`` are never set;
    * no ``MimicTkImporter`` reaches ``sys.meta_path``;
    * ``tkinter`` is never imported as a side effect.

    So the risk in a *browser* deployment is not "invisible Qt dialogs" — it is
    that ``tkinter.filedialog`` resolves to the REAL one and blocks the engine
    forever.  That is what ``tenmol_files.install_tk_dialogs`` exists for
    (row 295, ``test_wf_files.py``): the bridge installs its own Qt-free
    replacement in exactly the two ``sys.modules`` slots ``mimic_tk`` would
    have used.

    All four Qt bindings are checked here so that a machine that later grows a
    PyQt5 install fails this test loudly instead of quietly changing meaning.
    """
    out = _subprocess('''
        import sys
        for binding in ("PyQt5", "PyQt6", "PySide2", "PySide6"):
            try:
                __import__(binding)
                print("BINDING", binding)
            except ImportError:
                print("NOBINDING", binding)
        try:
            import pmg_qt.mimic_tk
            print("IMPORTED")
        except ImportError as e:
            print("IMPORTERROR", e)
        print("METAPATH", [type(f).__name__ for f in sys.meta_path])
        print("INJECTED", [m for m in ("tkMessageBox", "tkFileDialog",
                                       "tkinter.messagebox", "tkinter.filedialog")
                           if m in sys.modules])
        print("TK", "tkinter" in sys.modules)
    ''')
    got = out.stdout

    for binding in ("PyQt5", "PyQt6", "PySide2", "PySide6"):
        assert "NOBINDING " + binding in got, got
    assert "IMPORTERROR pymol.Qt" in got, got
    assert "IMPORTED" not in got, got
    assert "MimicTkImporter" not in got, got
    assert "INJECTED []" in got, got
    assert "TK False" in got, got


def test_no_tkinter_and_no_pmg_qt_leaked_into_the_ENGINE(bridge, ws: WSClient) -> None:
    """The guard rail for this whole file, asserted after the experiments above.

    Everything that needed ``pmg_qt`` ran in a subprocess; the three synthetic
    plugins are pure Python.  If a future edit imports a toolkit here it takes
    down the shared engine, so the check is part of the file rather than part of
    somebody's memory.  ``pmg_tk``/``pmg_tk.startup`` are the namespace package
    that carries the startup path and pull in no toolkit.
    """
    modules = _pyval(
        bridge, ws,
        "sorted(m for m in sys.modules if m.split('.')[0] in "
        "('tkinter', 'pmg_qt') or m in ('tkMessageBox', 'tkFileDialog'))",
    )
    assert modules == "[]", modules
    assert _pyval(bridge, ws, "sorted(m for m in sys.modules "
                              "if m.startswith('pmg_tk'))") == "['pmg_tk', 'pmg_tk.startup']"


# ===================================================================== row 77
# execapp: the seams that do work, and the ones that are not there.


@pytest.fixture
def background(bridge, ws: WSClient):
    """``bg_rgb`` is a process global; the counterfactual below dirties the scene.

    The restore passes the value back as a STRING.  ``cmd.get`` answers
    ``'0x000000'`` and handing that back as a bare Python literal would be the
    integer 0 — which is colour *index* 0, i.e. white, not black.  One shared
    PyMOL: a white viewport would leak into every pixel comparison in the suite.
    """
    before = _pyval(bridge, ws, "pymol.cmd.get('bg_rgb')")
    try:
        yield before
    finally:
        ws.do("cmd.set('bg_rgb', %r)" % before)
        ws.pump_frames(0.4)
        assert _pyval(bridge, ws, "pymol.cmd.get('bg_rgb')") == before
        # The seam must be back whatever happened, or the whole suite drifts.
        assert "tenmol_bridge.shims.Shims" in _pyval(
            bridge, ws, "pymol.cmd._call_with_opengl_context"
        )


def test_call_with_opengl_context_is_LOAD_BEARING_and_here_is_exactly_when(
    bridge, ws: WSClient, tmp_path, background
) -> None:
    """``shims.py``'s MEASURED CORRECTION, re-run as a counterfactual — and refined.

    ``shims.py`` says the upstream default (``lambda func: func()``) is silently
    wrong because ``G->ValidContext`` is PyMOL's own counter, pushed only inside
    ``PyMOL_Draw``, so ``cmd.png()`` with no explicit size finds
    ``SceneMakeMovieImage``'s ``cSceneImage_Normal`` branch gated off
    (``layer1/Scene.cpp:2347-2361``) and writes nothing.

    RE-MEASURED HERE, and the docstring is right about the mechanism but too
    absolute about the symptom.  With this bridge's draw pump running, a
    ``cmd.png()`` on a CLEAN scene succeeds even with upstream's seam — because
    ``SceneMakeMovieImage`` still runs ``MovieSetImage(G, ..., I->Image)`` after
    the skipped branch, so the pump's last drawn image is silently written
    instead of a fresh render.  Measured: identity seam, clean scene, file on
    disk, ``png`` returned 1.

    The failure is real the moment the scene is DIRTY, which is the only case
    anybody cares about — you render because something changed.  This test does
    ``set bg_rgb, red`` and both ``png`` calls inside ONE engine statement, so
    the pump (which runs on that same thread) cannot draw in between:

    * upstream's seam: **no file at all**, then and ever;
    * the bridge's seam: a file, and its bytes differ from the pre-change
      capture, i.e. a genuine re-render happened.

    Also measured while writing this, worth knowing: with an explicit
    ``width``/``height`` and upstream's seam the file does not exist when
    ``png`` returns but appears ~20 ms later, when the pump next draws.  So the
    seam converts three different silent behaviours — stale image, nothing at
    all, and race — into one synchronous write.
    """
    base = str(tmp_path / "before.png")
    without = str(tmp_path / "without-seam.png")
    with_seam = str(tmp_path / "with-seam.png")

    ws.call("cmd.png", base, quiet=1)
    ws.pump_frames(0.8)
    assert os.path.exists(base)
    with open(base, "rb") as handle:
        assert handle.read(8) == b"\x89PNG\r\n\x1a\n"

    # One statement: dirty the scene, png without the seam, png with it.  The
    # try/finally means the seam is wrong for two engine statements at most,
    # even if this test dies in the middle.
    counterfactual = (
        "import pymol, os\n"
        "_f7_seam = pymol.cmd._call_with_opengl_context\n"
        "pymol.cmd.set('bg_rgb', 'red')\n"
        "pymol.cmd._call_with_opengl_context = (lambda f: f())\n"
        "try:\n"
        "    pymol.cmd.png(%r, quiet=1)\n"
        "finally:\n"
        "    pymol.cmd._call_with_opengl_context = _f7_seam\n"
        "pymol.cmd.png(%r, quiet=1)\n"
        "print('F7SEAM', os.path.exists(%r), os.path.exists(%r))\n"
    ) % (without, with_seam, without, with_seam)
    ws.do("exec(%r)" % counterfactual)

    deadline = time.monotonic() + 10.0
    verdict = None
    while verdict is None and time.monotonic() < deadline:
        for line in bridge.feedback_lines():
            if line.startswith("F7SEAM "):
                verdict = line
                break
        time.sleep(0.05)
    assert verdict == "F7SEAM False True", verdict

    ws.pump_frames(1.0)
    assert not os.path.exists(without), (
        "upstream's default seam eventually wrote a file; the MEASURED "
        "CORRECTION in shims.py no longer holds and must be re-stated"
    )
    assert os.path.exists(with_seam)
    with open(base, "rb") as a, open(with_seam, "rb") as b:
        assert a.read() != b.read(), (
            "the seam's png is byte-identical to the pre-change capture, so no "
            "re-render happened and this test is not measuring what it claims"
        )


def test_pcatch_owns_stdout_which_is_how_a_plugin_print_reaches_the_browser(
    bridge, ws: WSClient
) -> None:
    """``execapp``'s ``pcatch._install()``, done by ``engine.py`` instead.

    ``pcatch`` is a built-in MODULE created by the PyMOL C extension (so
    ``sys.stdout`` is a module object, not an instance — measured:
    ``type(sys.stdout).__name__`` is ``'module'``).  ``_install()`` does
    ``sys.stderr = sys.stdout = pcatch`` so Python-side ``print`` lands in
    PyMOL's feedback buffer rather than the server's terminal.  That is the only
    reason a legacy plugin's ``print`` is visible to a browser client at all,
    and it is why ``conftest.py`` refuses to run without ``-s``.
    """
    assert _pyval(bridge, ws, "sys.stdout.__name__") == "pcatch"
    assert _pyval(bridge, ws, "sys.stdout is sys.modules.get('pcatch')") == "True"
    assert _pyval(bridge, ws, "sys.stderr is sys.stdout") == "True"

    ws.do("import sys; sys.stdout.write('f7-pcatch-marker\\n')")
    lines = bridge.wait_for_feedback("f7-pcatch-marker", timeout=6.0)
    assert any("f7-pcatch-marker" in line for line in lines), lines[-8:]


def test_the_gui_options_execapp_would_read_are_all_still_at_their_defaults(
    bridge, ws: WSClient
) -> None:
    """The bridge does NOT go through ``pymol.launch``, and the options show it.

    ``launch()`` picks ``_launch_no_gui()`` when ``options.no_gui``, otherwise
    ``execapp``.  Neither ran: ``engine.py`` constructs ``SingletonPyMOL``
    directly.  So every option ``execapp`` consults still holds its compiled-in
    default, and they describe a launch that never happened:

    * ``no_gui`` 0 — i.e. the options say this is a GUI session;
    * ``gui`` ``'pmg_qt'`` — the options even name the skin that would have been
      started, the one whose ``execapp`` this bridge replaces;
    * ``plugins`` 2 — "autoload and legacyinit at startup", which nothing does.

    Anyone wiring a ``pymol --web`` command line (WP-28) must map the flags
    explicitly; reading ``options`` to find out how this process was started
    gives an answer about a launch that never happened.
    """
    assert _pyval(bridge, ws, "pymol.invocation.options.no_gui") == "0"
    assert _pyval(bridge, ws, "pymol.invocation.options.gui") == "pmg_qt"
    assert _pyval(bridge, ws, "pymol.invocation.options.plugins") == "2"
    assert _pyval(bridge, ws, "pymol.invocation.options.incentive_product") == "0"


def test_the_seams_survive_everything_this_file_did(bridge, ws: WSClient) -> None:
    """Ordering guard: run last-ish, assert the five seams are still ours.

    Two tests above deliberately mutate process state that the rest of the suite
    depends on — ``cmd.extend`` (restored by the fixture) and
    ``_call_with_opengl_context`` (restored by the engine statement's
    ``finally``).  If either restore ever regresses, this fails here instead of
    somewhere unrelated three files later.
    """
    for expr in (
        "pymol.cmd._copy_image",
        "pymol.cmd._call_in_gui_thread",
        "pymol.cmd._call_with_opengl_context",
        "pymol.gui.createlegacypmgapp",
    ):
        assert "tenmol_bridge.shims.Shims" in _pyval(bridge, ws, expr), expr
    assert _pyval(bridge, ws, "pymol.gui.get_qtwindow()") == "<tenmol BridgeWindow>"
    assert _pyval(bridge, ws, "pymol.cmd.extend.__name__") == "extend"
    assert _pyval(bridge, ws, "pymol._ext_gui") == "None"
    assert bridge.healthz()["shims"]["installed"] is True
