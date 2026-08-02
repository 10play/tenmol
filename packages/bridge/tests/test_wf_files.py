"""WP-18 / parity area 6, wave 6 — inventory rows 259, 293, 295, 298.

Four features that all live at the seam between "PyMOL asks the desktop for
something" and "there is no desktop":

* **259** the legacy Tk map-generation dialog (``pmg_tk/PyMOLMapLoad.py``);
* **293** the macOS Finder "Open With" handler (``pymol_qt_gui.py:1136-1160``);
* **295** the tkinter file-dialog shim every legacy plugin imports
  (``pmg_qt/mimic_tk.py:36-108``);
* **298** the ``.pwg`` web-application launcher (``importing.py:516-615``).

Everything asserted here was RUN, not read.  Two results are worth the reader's
attention because they contradict what the source looks like it does:

1. ``cmd.map_generate`` **returns the map name even when it fails** and creates
   nothing (``creating.py:288``), so the Tk dialog's success test can never
   fire; and this build has the generator compiled out entirely
   (``packages/engine/layer3/Executive.cpp:6929-6935``, ``NO_MMLIBS``).
2. ``cmd.full_screen`` **always raises**: ``CmdFullScreen``
   (``packages/engine/layer4/Cmd.cpp:5352-5362``) never assigns the ``ok`` it returns.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_wf_files.py -q
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import files as files_panel  # noqa: E402

NS = "cmd.tenmol_files"
BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
MTZ = os.path.join(REPO, "packages", "engine", "testing", "data", "4rwb.mtz")

#: Tag counter, so two assertions never read each other's console line.
_TAG = [0]


def _next_tag(stem: str) -> str:
    _TAG[0] += 1
    return "TENMOL%s%d" % (stem, _TAG[0])


def _tagged(bridge: Any, tag: str, timeout: float = 8.0) -> str:
    """Read back a ``print('TAG', ...)`` from the console drain.

    Skips the ECHO line: PyMOL prints ``PyMOL>print('TAG', ...)`` before it runs
    the statement, so a naive ``needle in line`` matches the command instead of
    its output.  ``startswith(tag)`` cannot match the echo, which starts with
    ``PyMOL>``.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for line in bridge.feedback_lines():
            if line.startswith(tag + " "):
                return line[len(tag) + 1 :]
        time.sleep(0.05)
    raise AssertionError("no console line tagged %r within %.1fs" % (tag, timeout))


#: Anything under these roots that this test imports has to be un-imported
#: again.  MEASURED, and it cost a full-suite run to find: exercising the shim
#: through ``import tkinter.filedialog`` loads the REAL ``tkinter`` (and
#: ``tkinter.constants``) into the one shared PyMOL process, and
#: ``test_wf_plugins.py`` asserts —- correctly —- that no toolkit module is ever
#: reachable in this process.  Two of its tests failed, and the failure looked
#: like a plugin-manager bug.
_TK_ROOTS = ("tkinter",)
_TK_FLAT = ("tkFileDialog",)


def _tk_modules(ws, bridge) -> List[str]:
    tag = _next_tag("TKMODS")
    ws.do(
        "import sys; print('%s', repr(sorted(m for m in sys.modules "
        "if m.split('.')[0] in %r or m in %r)))" % (tag, _TK_ROOTS, _TK_FLAT)
    )
    import ast

    return list(ast.literal_eval(_tagged(bridge, tag)))


@pytest.fixture
def files(ws, bridge):
    """The service, installed; every process-global it touches put back."""
    ws.do(BOOTSTRAP)
    before = _tk_modules(ws, bridge)
    yield ws

    for request in ws.call(NS + ".dialog_pending"):
        ws.call(NS + ".dialog_cancel", request["dialogId"])
    ws.call(NS + ".uninstall_tk_dialogs")
    ws.do(
        "import sys; _tenmol_keep = %r; [sys.modules.pop(m, None) for m in "
        "list(sys.modules) if (m.split('.')[0] in %r or m in %r) "
        "and m not in _tenmol_keep]" % (before, _TK_ROOTS, _TK_FLAT)
    )
    # `{t:'do'}` execs in the `pymol` module namespace, so the probe slots this
    # file writes are attributes of `pymol`. Sweep them too.
    ws.do(
        "import pymol; [delattr(pymol, n) for n in list(vars(pymol)) "
        "if n.startswith('_tenmol_')]"
    )
    assert _tk_modules(ws, bridge) == before


@pytest.fixture
def reuse_helper(ws, bridge):
    """Drive ``pymol.invocation.options.reuse_helper``, then put it back.

    ONE PYMOL PER SUITE: ``invocation.options`` is a plain mutable process
    global — ``test_wf_shell.py`` documents another test leaking ``no_gui``
    through it and the failure looking like a product bug.  It is safe to WRITE
    only because the options are snapshotted into ``CPyMOLOptions`` at
    ``_cmd._new`` (``packages/engine/layer1/P.cpp:1800-1830``), so nothing about the running
    engine changes; what changes is what ``open_with_plan`` reads.
    """
    tag = _next_tag("REUSE")
    ws.do("import pymol; print('%s', int(pymol.invocation.options.reuse_helper))" % tag)
    before = int(_tagged(bridge, tag))

    def setter(value: int) -> None:
        ws.do(
            "import pymol; pymol.invocation.options.reuse_helper = %d" % int(value)
        )

    yield setter
    setter(before)


@pytest.fixture
def presentation_settings(ws):
    """Save/restore the three GLOBAL settings the .psw preset stamps on.

    ONE PYMOL PER SUITE: ``internal_gui`` and ``internal_feedback`` are process
    globals that other areas' tests read.  Leaving presentation mode on would
    silently change what they see.
    """
    names = ("presentation", "internal_gui", "internal_feedback")
    before = {name: ws.call("cmd.get", name) for name in names}
    yield before
    for name, value in before.items():
        ws.call("cmd.set", name, value)


# =========================================================================== #
# Row 298 — the .pwg launcher is refused
# =========================================================================== #


class TestPwgRefusal:
    def test_classify_marks_pwg_refused(self):
        info = files_panel.classify_filename("/tmp/app.pwg")
        assert info["format"] == "pwg"
        assert info["refused"] and "refused by the web client" in info["refused"]
        # `unavailable` stays None: the build CAN run a .pwg, we decline to.
        assert info["unavailable"] is None

    def test_a_url_pwg_is_refused_too(self):
        # `_processPWG` urlopens a remote .pwg (`importing.py:530-531`), so the
        # URL form is not safer than the local one.
        info = files_panel.classify_filename("https://example.org/app.pwg")
        assert info["isUrl"] is True
        assert info["refused"]

    def test_ordinary_formats_are_not_refused(self):
        for name in ("/tmp/a.pdb", "/tmp/a.cif", "/tmp/a.pse", "/tmp/a.pml"):
            assert files_panel.classify_filename(name)["refused"] is None

    def test_over_the_wire_and_in_the_open_plan(self, files):
        ws = files
        info = ws.call(NS + ".classify", "/tmp/app.pwg")
        assert info["refused"]
        plan = ws.call(NS + ".plan_open", ["/tmp/a.pdb", "/tmp/app.pwg"])
        assert plan["steps"][0]["refused"] is None
        assert plan["steps"][1]["refused"]
        assert "pwg" in ws.call(NS + ".refused")

    def test_cmd_load_really_does_execute_a_pwg(self, ws):
        """The reason the refusal exists, demonstrated instead of asserted.

        A ``.pwg`` containing the single directive ``delete`` makes
        ``_processPWG`` call ``os.unlink(fname)`` on the file it is reading
        (``importing.py:597-598``).  It sets no port and no root, so
        ``launch_flag`` stays 0 and no ``PymolHttpd`` is started — the file
        vanishing is the whole observable effect, and it is proof that arbitrary
        directives in a ``.pwg`` run with no confirmation whatsoever the moment
        the path reaches ``cmd.load``.

        This also pins WHERE the refusal has to live: ``cmd.load`` is a plain
        allowed call, so a client that skips the ``classify`` check (or a user
        who types ``load app.pwg`` into the console) still executes it.
        """
        workdir = tempfile.mkdtemp(prefix="tenmol-pwg-")
        try:
            path = os.path.join(workdir, "selfdestruct.pwg")
            with open(path, "w") as handle:
                handle.write("# no port, no root, no launch: nothing starts\ndelete\n")
            assert os.path.exists(path)

            reply = ws.call_reply("cmd.load", path)
            assert reply["t"] == "ok", reply
            assert not os.path.exists(path), (
                "the .pwg was NOT executed -- upstream importing.py:597 changed "
                "and this test's evidence needs redoing"
            )
        finally:
            shutil.rmtree(workdir, ignore_errors=True)


# =========================================================================== #
# Row 259 — the Tk map-generation dialog
# =========================================================================== #


class TestMapGeneratePure:
    """``PyMOLMapLoad.run``'s two pure decisions."""

    def test_blank_prefix_falls_back_to_the_dataset_not_the_column(self):
        # `:245-249` takes split('/')[1], i.e. the DATASET of
        # crystal/dataset/column -- not the column name a reader expects.
        assert files_panel.map_generate_prefix("cryst_1/data_1/FC") == "data_1"

    def test_blank_prefix_with_an_unqualified_column_uses_the_column(self):
        assert files_panel.map_generate_prefix("FWT") == "FWT"

    def test_an_explicit_prefix_wins(self):
        assert files_panel.map_generate_prefix("cryst_1/data_1/FC", "mine") == "mine"

    def test_fofc_isomesh_is_two_objects_green_and_red(self):
        plan = files_panel.map_rep_plan("isomesh", "m", True)
        assert [(s["stem"], s["level"], s["color"]) for s in plan] == [
            ("m-msh3", 3.0, "green"),
            ("m-msh-3", -3.0, "red"),
        ]

    def test_fofc_isosurface_is_the_one_uncoloured_branch(self):
        plan = files_panel.map_rep_plan("isosurface", "m", True)
        assert plan == [
            {"op": "isosurface", "stem": "m-srf", "level": 1.0, "color": None}
        ]

    def test_2fofc_isosurface_and_isomesh_are_blue_at_1(self):
        assert files_panel.map_rep_plan("isosurface", "m", False)[0]["color"] == "blue"
        mesh = files_panel.map_rep_plan("isomesh", "m", False)[0]
        assert (mesh["stem"], mesh["level"], mesh["color"]) == ("m-msh", 1.0, "blue")

    def test_the_default_rep_is_a_volume_with_the_matching_ramp(self):
        # Both settings default to "volume", so this is the branch that runs.
        assert files_panel.map_rep_plan("volume", "m", True)[0]["ramp"] == "fofc"
        assert files_panel.map_rep_plan("volume", "m", False)[0]["ramp"] == "2fofc"


class TestMapGenerateInfo:
    def test_header_columns_and_pmw_none_weight(self, files):
        assert os.path.exists(MTZ), MTZ
        info = files.call(NS + ".map_generate_info", MTZ)
        assert info["error"] is None
        assert info["headerClass"] == "MTZHeader"
        # MEASURED against packages/engine/testing/data/4rwb.mtz.
        assert info["amplitudes"] == ["cryst_1/data_1/FP", "cryst_1/data_1/FC"]
        assert info["phases"] == ["cryst_1/data_1/PHIC"]
        # `WCols = ["None"]` first (`PyMOLMapLoad.py:102`), then W then Q.
        assert info["weights"][0] == "None"
        assert "cryst_1/data_1/FOM" in info["weights"]
        assert round(info["minRes"], 5) == 19.38758
        assert round(info["maxRes"], 5) == 2.00037

    def test_the_two_rep_settings_and_autoclose_come_along(self, files):
        info = files.call(NS + ".map_generate_info", MTZ)
        assert info["fofcRep"] == files.call("cmd.get", "default_fofc_map_rep")
        assert info["twoFofcRep"] == files.call("cmd.get", "default_2fofc_map_rep")
        assert isinstance(info["autocloseDialogs"], bool)

    def test_a_non_mtz_is_rejected_with_the_reason(self, files):
        ccp4 = os.path.join(REPO, "packages", "engine", "testing", "data", "emd_1155.ccp4")
        info = files.call(NS + ".map_generate_info", ccp4)
        assert "MTZ only" in (info["error"] or "")

    def test_a_missing_file_says_so(self, files):
        info = files.call(NS + ".map_generate_info", "/tmp/nope-4rwb.mtz")
        assert info["error"] and "no such file" in info["error"]


class TestMapGenerateRun:
    def test_blank_columns_return_the_dialogs_own_help_text(self, files):
        missing = files.call(NS + ".map_generate_run", MTZ, "", "PHIC")
        assert missing["ok"] is False
        assert missing["error"] == "Missing Amplitudes Column Name"
        assert "amplitudes column name was blank" in missing["help"]

        missing = files.call(NS + ".map_generate_run", MTZ, "FC", "")
        assert missing["error"] == "Missing Phases Column Name"
        assert "phases column\nname was blank" in missing["help"]

    def test_generation_fails_on_this_build_and_says_why(self, files):
        """MEASURED: ``NO_MMLIBS``, and the return value lies about it.

        ``cmd.map_generate`` answers with the map name it was given
        (``creating.py:288`` is an unconditional ``return name``), while
        ``ExecutiveMapGenerate`` printed " Error: MTZ map loading not supported
        in this PyMOL build." and produced nothing
        (``packages/engine/layer3/Executive.cpp:6929-6935``).  A port that trusts the return
        value — as ``PyMOLMapLoad.py:262`` does — then isomeshes a map object
        that does not exist.

        If this repository is ever built WITH mmlibs, this assertion flips and
        that is exactly the signal wanted: the row's "functional here" claim
        would finally be true.
        """
        before = set(files.call("cmd.get_names"))
        result = files.call(
            NS + ".map_generate_run", MTZ, "cryst_1/data_1/FC", "cryst_1/data_1/PHIC"
        )
        after = set(files.call("cmd.get_names"))

        # `cmd.get_unused_name(prefix)` defaults to `alwaysnumber=1`
        # (`querying.py:74`), so the dataset name always gains a suffix:
        # "data_1" -> "data_101". PyMOLMapLoad calls it the same way (`:255`).
        assert result["prefix"].startswith("data_1"), result
        assert result["prefix"] != "data_1"
        assert result["returned"] == result["prefix"], (
            "cmd.map_generate no longer returns its name argument on failure"
        )
        assert result["created"] is False
        assert result["ok"] is False
        assert "created no object" in result["error"]
        assert "NO_MMLIBS" in result["buildNote"]
        assert result["reps"] == []
        assert after == before, "a failed map_generate must leave no objects"

    def test_info_reports_the_probe_result_afterwards(self, files):
        files.call(
            NS + ".map_generate_run", MTZ, "cryst_1/data_1/FC", "cryst_1/data_1/PHIC"
        )
        assert files.call(NS + ".map_generate_info", MTZ)["supported"] is False


# =========================================================================== #
# Row 293 — macOS Finder "Open With"
# =========================================================================== #


class TestOpenWithPlan:
    def test_an_empty_session_loads_here(self, files):
        files.call("cmd.delete", "all")
        plan = files.call(NS + ".open_with_plan", "/tmp/thing.pdb")
        assert plan["names"] == []
        assert plan["action"] == "load-here"
        assert plan["presentation"] is False

    def test_the_new_window_branch_is_reuse_helper_AND_a_non_empty_session(
        self, files, reuse_helper
    ):
        """``if not options.reuse_helper and cmd.get_names()`` (``:1145-1147``).

        Both inputs are driven here rather than read, because the interesting
        branch is the one this bridge never takes by default: measured,
        ``reuse_helper`` is 0 (``pymol -R`` is not on), so a Finder open with
        anything loaded would spawn a second PyMOL — which a web client cannot
        do, and which is why the plan is returned as data instead of performed.
        """
        files.call("cmd.delete", "all")
        files.call("cmd.fragment", "ala", "openwith_probe")
        try:
            reuse_helper(0)
            plan = files.call(NS + ".open_with_plan", "/tmp/thing.pdb")
            assert plan["reuseHelper"] is False
            assert plan["names"] == ["openwith_probe"]
            assert plan["action"] == "new-window", plan
            # …and `presentation` is suppressed on that branch even for a .psw,
            # because upstream returns before it (`:1147`).
            assert files.call(NS + ".open_with_plan", "/tmp/s.psw")["presentation"] is False

            reuse_helper(1)
            plan = files.call(NS + ".open_with_plan", "/tmp/thing.pdb")
            assert plan["reuseHelper"] is True
            assert plan["action"] == "load-here", plan
        finally:
            files.call("cmd.delete", "openwith_probe")

    def test_a_psw_asks_for_presentation_mode(self, files):
        files.call("cmd.delete", "all")
        plan = files.call(NS + ".open_with_plan", "/tmp/show.psw")
        assert plan["presentation"] is True
        assert [step["name"] for step in plan["presetSteps"]] == [
            "presentation",
            "internal_gui",
            "internal_feedback",
            "full_screen",
        ]
        # The classification rides along so the caller does not need a second
        # round trip before it can open the session dialog.
        assert plan["classification"]["dialog"] == "session"

    def test_reinitialize_follows_auto_reinitialize(self, files):
        files.call("cmd.delete", "all")
        plan = files.call(NS + ".open_with_plan", "/tmp/thing.pdb")
        assert plan["reinitialize"] == plan["autoReinitialize"]


class TestPresentationPreset:
    def test_the_three_settings_are_applied_and_reversible(
        self, files, presentation_settings
    ):
        result = files.call(NS + ".presentation_preset", False)
        assert result["current"]["presentation"] == "on"
        assert result["current"]["internal_gui"] == "off"
        assert result["current"]["internal_feedback"] == "0"
        assert result["previous"] == presentation_settings

        back = files.call(NS + ".presentation_restore", result["previous"])
        assert back == presentation_settings

    def test_full_screen_always_fails_and_the_preset_survives_it(
        self, files, presentation_settings
    ):
        """``CmdFullScreen`` returns an ``ok`` it never assigns.

        ``packages/engine/layer4/Cmd.cpp:5352-5362``: ``int ok = false;`` … ``return
        APIResultOk(G, ok);`` with nothing in between touching ``ok``.
        ``APIResultOk`` raises ``CmdException`` on false, so the call ALWAYS
        raises — in the Qt build too, which means the Finder ``.psw`` handler
        (``pymol_qt_gui.py:1156``) throws before it reaches ``load_dialog`` and
        the presentation file never opens.  Asserted here so the web client's
        preset is not written to depend on it.
        """
        reply = files.call_reply("cmd.full_screen", "on")
        assert reply["t"] == "err", "cmd.full_screen stopped raising"
        assert reply["error"]["kind"] == "CmdException"

        result = files.call(NS + ".presentation_preset", True)
        assert result["fullScreen"]["attempted"] is True
        assert result["fullScreen"]["ok"] is False
        assert "never assigned" in result["fullScreen"]["error"]
        # …and the three settings that CAN be applied still were.
        assert result["current"]["internal_gui"] == "off"
        files.call(NS + ".presentation_restore", result["previous"])


# =========================================================================== #
# Row 295 — the blocking tkinter file-dialog shim
# =========================================================================== #


class TestFilterTranslation:
    """``_qtFileDialog._getfilter`` (``mimic_tk.py:37-48``), kept verbatim."""

    def test_repeated_labels_accumulate_extensions(self):
        assert files_panel.BridgeFileDialog._getfilter(
            [("PDB", ".pdb"), ("PDB", ".ent"), ("All files", "*")]
        ) == "PDB (*.pdb *.ent);;All files (*)"

    def test_a_bare_star_is_left_alone_but_a_dot_gains_one(self):
        assert files_panel.BridgeFileDialog._getfilter([("X", "*.xyz")]) == "X (*.xyz)"
        assert files_panel.BridgeFileDialog._getfilter([("X", ".xyz")]) == "X (*.xyz)"

    def test_no_filetypes_is_the_empty_filter(self):
        assert files_panel.BridgeFileDialog._getfilter("") == ""


def _spawn_plugin_call(ws, method: str, options: Dict[str, Any], slot: str) -> None:
    """Run ``tkinter.filedialog.<method>`` on a WORKER thread inside PyMOL.

    That is the whole point of row 295: the shim blocks its caller, so the call
    has to come from somewhere that is not the draw pump.  ``{t:'do'}`` executes
    in the ``pymol`` module namespace, so the result lands on ``pymol.<slot>``
    and a later ``print`` can read it back.
    """
    ws.do(
        "import threading, tkinter.filedialog as _fd; %s = {}; "
        "threading.Thread(target=lambda: %s.update({'v': _fd.%s(**%r)}), "
        "daemon=True).start()" % (slot, slot, method, options)
    )


def _await_pending(ws, timeout: float = 10.0) -> List[Dict[str, Any]]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pending = ws.call(NS + ".dialog_pending")
        if pending:
            return pending
        time.sleep(0.05)
    raise AssertionError("no dialog request arrived within %.1fs" % timeout)


def _await_slot(ws, bridge, slot: str, timeout: float = 10.0) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        tag = _next_tag("SLOT")
        ws.do("print('%s', repr(%s))" % (tag, slot))
        value = _tagged(bridge, tag)
        if value != "{}":
            return value
        time.sleep(0.1)
    raise AssertionError("%s never filled in" % slot)


class TestPluginFileDialogs:
    def test_install_puts_the_shim_where_plugins_look(self, files, bridge):
        state = files.call(NS + ".install_tk_dialogs")
        assert state["installed"] is True
        status = files.call(NS + ".tk_dialogs_status")
        assert status["installed"] is True
        assert status["engineThread"], "pymol.glutThread is how the guard works"

        tag = _next_tag("MOD")
        files.do(
            "import sys, tkinter, tkinter.filedialog, tkFileDialog; print('%s', "
            "type(sys.modules['tkinter.filedialog']).__name__, "
            "type(sys.modules['tkFileDialog']).__name__, "
            "type(tkinter.filedialog).__name__)" % tag
        )
        # THREE routes, because plugins in the wild use all of them: the flat
        # legacy name (`import tkFileDialog`), the dotted module
        # (`import tkinter.filedialog`) and the package attribute
        # (`import tkinter; tkinter.filedialog...`). If any one of them missed
        # the shim, that plugin would get a native dialog nobody can see.
        assert _tagged(bridge, tag).split() == [
            "BridgeFileDialog",
            "BridgeFileDialog",
            "BridgeFileDialog",
        ]

    def test_askopenfilename_blocks_then_returns_the_chosen_path(
        self, files, bridge
    ):
        files.call(NS + ".install_tk_dialogs")
        _spawn_plugin_call(
            files,
            "askopenfilename",
            {"title": "Pick a structure", "initialdir": "/tmp",
             "filetypes": [("PDB", ".pdb"), ("PDB", ".ent"), ("All", "*")]},
            "_tenmol_open1",
        )
        pending = _await_pending(files)
        assert len(pending) == 1
        request = pending[0]
        assert request["kind"] == "askopenfilename"
        assert request["options"]["title"] == "Pick a structure"
        assert request["options"]["initialdir"] == "/tmp"
        # The Qt filter string, byte-identical, plus the split form the React
        # picker consumes.
        assert request["options"]["filter"] == "PDB (*.pdb *.ent);;All (*)"
        assert request["options"]["filters"] == ["PDB (*.pdb *.ent)", "All (*)"]
        assert request["options"]["multiple"] is False

        assert files.call(NS + ".dialog_answer", request["dialogId"], "/tmp/x.pdb") == {
            "answered": True,
            "error": None,
        }
        assert _await_slot(files, bridge, "_tenmol_open1") == "{'v': '/tmp/x.pdb'}"
        assert files.call(NS + ".dialog_pending") == []

    def test_cancel_returns_the_empty_string_plugins_test_for(self, files, bridge):
        files.call(NS + ".install_tk_dialogs")
        _spawn_plugin_call(files, "askopenfilename", {}, "_tenmol_open2")
        request = _await_pending(files)[0]
        files.call(NS + ".dialog_cancel", request["dialogId"])
        assert _await_slot(files, bridge, "_tenmol_open2") == "{'v': ''}"

    def test_askopenfilenames_returns_a_list_and_cancels_to_an_empty_one(
        self, files, bridge
    ):
        files.call(NS + ".install_tk_dialogs")
        _spawn_plugin_call(files, "askopenfilenames", {}, "_tenmol_many1")
        request = _await_pending(files)[0]
        assert request["kind"] == "askopenfilenames"
        assert request["options"]["multiple"] is True
        files.call(NS + ".dialog_answer", request["dialogId"], ["/tmp/a.pdb", "/tmp/b.pdb"])
        assert (
            _await_slot(files, bridge, "_tenmol_many1")
            == "{'v': ['/tmp/a.pdb', '/tmp/b.pdb']}"
        )

        _spawn_plugin_call(files, "askopenfilenames", {}, "_tenmol_many2")
        request = _await_pending(files)[0]
        files.call(NS + ".dialog_cancel", request["dialogId"])
        assert _await_slot(files, bridge, "_tenmol_many2") == "{'v': []}"

    def test_askopenfile_hands_back_a_real_open_file_object(self, files, bridge):
        files.call(NS + ".install_tk_dialogs")
        workdir = tempfile.mkdtemp(prefix="tenmol-tkdlg-")
        try:
            path = os.path.join(workdir, "hello.txt")
            with open(path, "w") as handle:
                handle.write("REMARK tenmol\n")

            files.do(
                "import threading, tkinter.filedialog as _fd; _tenmol_file1 = {}; "
                "threading.Thread(target=lambda: _tenmol_file1.update("
                "{'v': _fd.askopenfile().read()}), daemon=True).start()"
            )
            request = _await_pending(files)[0]
            files.call(NS + ".dialog_answer", request["dialogId"], path)
            assert (
                _await_slot(files, bridge, "_tenmol_file1")
                == "{'v': 'REMARK tenmol\\n'}"
            )
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def test_asksaveasfilename_and_askdirectory_are_plain_strings(
        self, files, bridge
    ):
        files.call(NS + ".install_tk_dialogs")
        _spawn_plugin_call(
            files, "asksaveasfilename",
            {"title": "Save", "filetypes": [("Text", ".txt")]}, "_tenmol_save1",
        )
        request = _await_pending(files)[0]
        assert request["kind"] == "asksaveasfilename"
        assert request["options"]["filter"] == "Text (*.txt)"
        files.call(NS + ".dialog_answer", request["dialogId"], "/tmp/out.txt")
        assert _await_slot(files, bridge, "_tenmol_save1") == "{'v': '/tmp/out.txt'}"

        _spawn_plugin_call(files, "askdirectory", {}, "_tenmol_dir1")
        request = _await_pending(files)[0]
        assert request["kind"] == "askdirectory"
        files.call(NS + ".dialog_answer", request["dialogId"], "/tmp")
        assert _await_slot(files, bridge, "_tenmol_dir1") == "{'v': '/tmp'}"

    def test_the_engine_thread_is_refused_instead_of_deadlocked(
        self, files, bridge
    ):
        """The hard rule of ``topics/dialog.ts``, enforced.

        A plugin that calls ``askopenfilename`` straight from a ``{t:'do'}``
        runs on the draw pump.  Blocking there would freeze the viewport AND the
        answer path (``dialog_answer`` is itself a pump call), so it is a
        deadlock, not a slow dialog.  The shim raises immediately instead — and
        the next call still returns, which is the part that matters.
        """
        files.call(NS + ".install_tk_dialogs")
        reply = files.request(
            t="do", cmd="import tkinter.filedialog as _fd; _fd.askopenfilename()",
            timeout=20.0,
        )
        assert reply["t"] in ("ok", "err")
        assert bridge.wait_for_feedback("engine thread", timeout=8.0)
        assert any("engine thread" in line for line in bridge.feedback_lines())
        # No request was parked, and the pump is alive.
        assert files.call(NS + ".dialog_pending") == []
        assert files.call("cmd.get_names") is not None

    def test_uninstall_puts_the_real_tkinter_back(self, files, bridge):
        """``sys.modules`` and ``sys.meta_path`` are process-global.

        ONE PYMOL PER SUITE: a shim left behind here would hand every other
        test's ``tkinter.filedialog`` to a broker nobody is polling, and the
        failure would look like a hang somewhere else entirely.
        """
        files.call(NS + ".install_tk_dialogs")
        assert files.call(NS + ".tk_dialogs_status")["installed"] is True
        files.call(NS + ".uninstall_tk_dialogs")
        assert files.call(NS + ".tk_dialogs_status")["installed"] is False

        tag = _next_tag("REST")
        files.do(
            "import sys; print('%s', type(sys.modules.get('tkinter.filedialog'))"
            ".__name__, 'tkFileDialog' in sys.modules, "
            "any(type(f).__name__ == '_TkFileDialogFinder' for f in sys.meta_path))"
            % tag
        )
        kind, flat, finder = _tagged(bridge, tag).split()
        # Either the real module is back or the slot is empty again -- what must
        # NOT be true is that the shim is still there. Same for the flat legacy
        # alias (which stock Python never defines) and the meta_path hook.
        assert kind in ("module", "NoneType"), kind
        assert flat == "False"
        assert finder == "False"
