"""WP-18 / parity area 6, wave 7 — inventory rows 259 and 293.

Two desktop-only seams, re-examined against the running engine rather than the
source:

* **259** the legacy Tk map-generation dialog (``pmg_tk/PyMOLMapLoad.py``),
  whose OK button is ``cmd.map_generate``;
* **293** the macOS Finder "Open With" handler (``pymol_qt_gui.py:1136-1160``),
  whose only engine-visible content is the ``.psw`` presentation preset.

``test_wf_files.py`` (wave 6) pins the shapes these two produce.  THIS file
pins the things that can only be learned by running them, and that decide
whether either row is worth a line of React:

1. The generator really is compiled out here — not inferred from ``get_names``
   but read off the console: " Error: MTZ map loading not supported in this
   PyMOL build." followed by creating.py's " Error: Map generation failed",
   while the call still returns ``ok`` and the map name.
2. Everything BEFORE that C call is live.  A column name that is not in the MTZ
   raises ``CmdException: ' Error: no dataset found'`` from ``creating.py:247``
   — so the dialog's column pickers are validated by the engine, and a build
   WITH mmlibs would work.
3. And the half AFTER it is live too, demonstrated by substituting the one
   compiled-out call: the map appears, the default ``volume`` rep is built and
   named ``<map>-vol01``, and the FoFc ``isomesh`` branch really does produce
   two meshes coloured green and red.
4. A ``.psw`` is a ``.pse`` with a different extension, and the ENGINE — not
   the Qt handler — is what makes it a presentation: same bytes, loaded as
   ``.psw``, recall the session's first scene (measured: the camera lands on
   the stored view and ``scene_current_name`` becomes it), loaded as ``.pse``
   they do not.  That is what a browser gets for free through ``cmd.load``;
   the Finder handler's extra is three window settings and a
   ``cmd.full_screen`` that always raises.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_f7_legacyfiles.py -q
"""

from __future__ import annotations

import ast
import os
import sys
import time
from typing import Any, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import files as files_panel  # noqa: E402

NS = "cmd.tenmol_files"
BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
MTZ = os.path.join(REPO, "packages", "engine", "testing", "data", "4rwb.mtz")
CCP4 = os.path.join(REPO, "packages", "engine", "testing", "data", "emd_1155.ccp4")

#: Amplitudes/phases that really are in ``4rwb.mtz`` (measured in wave 6).
AMPL = "cryst_1/data_1/FC"
PHASES = "cryst_1/data_1/PHIC"

_TAG = [0]


def _next_tag(stem: str) -> str:
    _TAG[0] += 1
    return "F7LF%s%d" % (stem, _TAG[0])


def _tagged(bridge: Any, tag: str, timeout: float = 8.0) -> str:
    """Read back a ``print('TAG', ...)`` line, skipping PyMOL's echo.

    PyMOL prints ``PyMOL>print('TAG', ...)`` before it runs the statement, so
    a substring match would find the command instead of its output;
    ``startswith`` cannot, because the echo starts with ``PyMOL>``.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for line in bridge.feedback_lines():
            if line.startswith(tag + " "):
                return line[len(tag) + 1 :]
        time.sleep(0.05)
    raise AssertionError("no console line tagged %r within %.1fs" % (tag, timeout))


def _mark(ws, bridge, stem: str) -> str:
    """Print a unique line and wait for it, so a console window can start there.

    The status drain is a RING holding the whole run's scrollback, so "is this
    line present" would happily match a line an EARLIER test in this same file
    produced.  The marker makes the window exact.  Note the echo
    (``PyMOL>print('MARK')``) does not start with the marker, so ``startswith``
    finds the output line and not the command.
    """
    marker = _next_tag(stem)
    ws.do("print('%s')" % marker)
    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        if any(line.startswith(marker) for line in bridge.feedback_lines()):
            return marker
        time.sleep(0.05)
    raise AssertionError("marker %r never reached the console" % marker)


def _console_since(bridge, marker: str, needle: str,
                   timeout: float = 8.0) -> List[str]:
    """Console lines printed after ``marker``, once ``needle`` is among them."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        lines = bridge.feedback_lines()
        index = max(
            (i for i, line in enumerate(lines) if line.startswith(marker)),
            default=None,
        )
        if index is not None:
            after = lines[index + 1 :]
            if any(needle in line for line in after):
                return after
        time.sleep(0.05)
    raise AssertionError(
        "%r never appeared on the console after %r" % (needle, marker)
    )


@pytest.fixture
def files(ws):
    """The service, installed."""
    ws.do(BOOTSTRAP)
    return ws


@pytest.fixture
def f7_objects(ws):
    """Delete every object this file creates, whatever the test did.

    ONE PYMOL PER SUITE: an ``f7lfgen…`` map or mesh left behind would show up in
    another area's ``get_names()`` assertions.
    """
    yield
    for name in list(ws.call("cmd.get_names", "all") or []):
        if name.startswith("f7lf"):
            ws.call("cmd.delete", name)


@pytest.fixture
def map_rep_settings(ws):
    """Save/restore the two GLOBAL settings that choose the representation."""
    names = ("default_fofc_map_rep", "default_2fofc_map_rep")
    before = {name: ws.call("cmd.get", name) for name in names}
    yield before
    for name, value in before.items():
        ws.call("cmd.set", name, value)


#: Substitute the ONE call this build compiles out, and nothing else.
#:
#: ``FilesAPI.map_generate_run`` is a sequence of engine calls with
#: ``cmd.map_generate`` in the middle; here that middle call loads a real CCP4
#: map under the requested name instead, which is exactly what a build with
#: mmlibs does (``creating.py:277`` ends in ``_self.load(r, name,
#: format="ccp4")``).  Everything else in the method — the prefix, the
#: ``get_names`` success test, ``suspend_updates``, the rep loop, the colours —
#: runs for real.  The swap is on the service INSTANCE and is put back in the
#: fixture teardown, along with the module-level "does this build work" memo.
_FAKE_SRC = "\n".join(
    [
        "import pymol",
        "import tenmol_bridge.panels.files as _tf",
        "_svc = pymol.cmd.tenmol_files",
        "class _F7Cmd(object):",
        "    def __init__(self, real, src):",
        "        self._real = real",
        "        self._src = src",
        "    def __getattr__(self, name):",
        "        return getattr(self._real, name)",
        "    def map_generate(self, name, reflection_file, *args, **kwargs):",
        "        pymol._tenmol_f7_args = (name, reflection_file) + tuple(args)",
        "        self._real.load(self._src, name, format='ccp4')",
        "        return name",
        "pymol._tenmol_f7_real = _svc.cmd",
        "pymol._tenmol_f7_status = dict(_tf._MAP_GENERATE_STATUS)",
        "_svc.cmd = _F7Cmd(_svc.cmd, %r)" % CCP4,
    ]
)

_UNFAKE_SRC = "\n".join(
    [
        "import pymol",
        "import tenmol_bridge.panels.files as _tf",
        "pymol.cmd.tenmol_files.cmd = pymol._tenmol_f7_real",
        "_tf._MAP_GENERATE_STATUS.update(pymol._tenmol_f7_status)",
        "del pymol._tenmol_f7_real",
        "del pymol._tenmol_f7_status",
        "pymol.__dict__.pop('_tenmol_f7_args', None)",
    ]
)


@pytest.fixture
def working_generator(ws, bridge):
    """``cmd.map_generate`` as a build with MMLIBS would behave."""
    assert os.path.isfile(CCP4), CCP4
    ws.do("exec(%r)" % _FAKE_SRC)
    tag = _next_tag("FAKE")
    ws.do("import pymol; print('%s', type(pymol.cmd.tenmol_files.cmd).__name__)" % tag)
    assert _tagged(bridge, tag) == "_F7Cmd", "the substitution did not install"

    yield

    ws.do("exec(%r)" % _UNFAKE_SRC)
    tag = _next_tag("UNFAKE")
    ws.do(
        "import pymol; print('%s', type(pymol.cmd.tenmol_files.cmd).__name__, "
        "hasattr(pymol, '_tenmol_f7_args'))" % tag
    )
    # `FilesAPI.cmd` is the `pymol.cmd` MODULE (`install()` passes it in), which
    # is why the substitute has to be a proxy object rather than a subclass.
    assert _tagged(bridge, tag) == "module False", "the real cmd was not put back"


# =========================================================================== #
# Row 259 — what this build actually does with reflection data
# =========================================================================== #


class TestTheGeneratorIsCompiledOut:
    def test_the_console_says_why_while_the_call_reports_success(
        self, files, bridge
    ):
        """The single fact that decides row 259, read off the console.

        ``ExecutiveMapGenerate`` (``packages/engine/layer3/Executive.cpp:6929-6935``) prints
        this line and returns ``nullptr`` under ``NO_MMLIBS``; ``creating.py``
        then prints its own " Error: Map generation failed" (``:279``) and —
        the trap — falls through to a bare ``return name`` (``:289``).  So the
        WebSocket reply is ``t: ok`` with the map name in it, and nothing was
        created.  The Tk dialog tests exactly that value
        (``PyMOLMapLoad.py:288``) and goes on to isomesh a map that does not
        exist.

        If this repository is ever built WITH mmlibs this test fails, which is
        the signal wanted: the inventory row's "functional here" claim would
        finally be true.
        """
        assert os.path.isfile(MTZ), MTZ
        before = set(files.call("cmd.get_names", "all"))
        marker = _mark(files, bridge, "GEN")
        reply = files.call_reply("cmd.map_generate", "f7lfdirect", MTZ, AMPL, PHASES)

        assert reply["t"] == "ok", reply
        assert reply["result"] == "f7lfdirect", (
            "cmd.map_generate no longer returns its name argument on failure"
        )
        after = _console_since(bridge, marker, "MTZ map loading not supported")
        assert any("Map generation failed" in line for line in after), after
        assert set(files.call("cmd.get_names", "all")) == before
        assert "f7lfdirect" not in files.call("cmd.get_names", "all")

    def test_the_positional_call_the_pmw_dialog_makes_is_still_the_signature(
        self, files, bridge
    ):
        """``cmd.map_generate(prefix, file, ampl, phases, weights, lo, hi, 1, 1)``.

        ``PyMOLMapLoad.py:281-283`` and ``FilesAPI.map_generate_run`` both call
        it POSITIONALLY, so a reordered upstream signature would silently pass
        the phases as weights.  Read from the live function object.
        """
        tag = _next_tag("SIG")
        files.do(
            "import inspect; from pymol import cmd as _c; print('%s', "
            "','.join(inspect.signature(_c.map_generate).parameters))" % tag
        )
        assert _tagged(bridge, tag).split(",") == [
            "name", "reflection_file", "amplitudes", "phases", "weights",
            "reso_low", "reso_high", "quiet", "zoom", "_self",
        ]

    def test_a_column_not_in_the_file_fails_before_the_compiled_out_call(
        self, files
    ):
        """Everything the dialog collects IS validated, by the engine.

        ``creating.py:236-247`` parses the MTZ header itself, walks the
        datasets looking for the amplitudes column and raises ``no dataset
        found`` — Python-side, before ``_cmd.map_generate``.  So the column
        pickers are not decoration: on a build with mmlibs they are the
        difference between a map and an exception, and the port must surface
        this error rather than the build note.
        """
        reply = files.call_reply(
            "cmd.map_generate", "f7lfbad", MTZ, "cryst_1/data_1/NOPE", PHASES
        )
        assert reply["t"] == "err"
        assert reply["error"]["kind"] == "CmdException"
        assert "no dataset found" in reply["error"]["message"]

        report = files.call(NS + ".map_generate_run", MTZ, "cryst_1/data_1/NOPE",
                            PHASES)
        assert report["ok"] is False
        assert report["created"] is False
        assert "no dataset found" in report["error"]
        # NOT the build note: this one is the user's mistake, and it is fixable
        # from the dialog by picking another column.
        assert "NO_MMLIBS" not in report["error"]

    def test_a_missing_reflection_file_reports_a_path_not_an_empty_error(
        self, files
    ):
        """MEASURED, and the reason for the guard in ``map_generate_run``.

        ``cmd.map_generate`` prints " MapGenerate-Error: Could not find file
        '<path>'" to the CONSOLE and raises a bare ``pymol.CmdException``
        (``creating.py:230-232``) whose ``str()`` is ``' Error: '`` — measured
        over the socket.  The dialog would have shown the user "Error:" and
        nothing else, so the file is checked here instead.
        """
        report = files.call(
            NS + ".map_generate_run", "/tmp/f7-does-not-exist.mtz", AMPL, PHASES
        )
        assert report["ok"] is False
        assert report["error"] == "no such file: /tmp/f7-does-not-exist.mtz"
        # …and the two column checks still come first (the Pmw order).
        blank = files.call(
            NS + ".map_generate_run", "/tmp/f7-does-not-exist.mtz", "", PHASES
        )
        assert blank["error"] == "Missing Amplitudes Column Name"


class TestTheRestOfTheDialogIsLive:
    """With the one compiled-out call substituted, the port runs end to end."""

    def test_the_default_volume_rep_is_built_and_named_after_the_map(
        self, files, bridge, working_generator, f7_objects
    ):
        before = files.call("cmd.get", "suspend_updates")
        report = files.call(
            NS + ".map_generate_run", MTZ, AMPL, PHASES, "None", "", "",
            "f7lfgen", False,
        )
        assert report["ok"] is True
        assert report["created"] is True
        assert report["error"] is None
        # `get_unused_name` defaults to alwaysnumber=1 (`querying.py:74`), so
        # the explicit prefix gains a number here exactly as it does upstream.
        assert report["prefix"] == "f7lfgen01"
        # Both `default_*_map_rep` settings ship as "volume" (measured), so
        # this — not isomesh — is what a user actually gets.
        assert report["rep"] == "volume"
        assert [step["op"] for step in report["reps"]] == ["volume"]
        assert report["reps"][0]["name"] == "f7lfgen01-vol01"
        assert files.call("cmd.get_type", "f7lfgen01") == "object:map"
        assert files.call("cmd.get_type", "f7lfgen01-vol01") == "object:volume"
        # `suspend_updates` is a GLOBAL: the `finally` really does put it back.
        assert files.call("cmd.get", "suspend_updates") == before

        # …and the "has this build got a generator" memo now says yes, which is
        # what the dialog banner reads.
        assert files.call(NS + ".map_generate_info", MTZ)["supported"] is True

    def test_the_nine_arguments_that_reach_cmd_map_generate(
        self, files, bridge, working_generator, f7_objects
    ):
        """Blank resolution fields are 0.0/0.0, and that is not "no resolution".

        ``creating.py:251`` reads ``reso_low, reso_high`` out of the MTZ header
        whenever the two are EQUAL, so the Pmw dialog's empty entry fields mean
        "use the file's range" rather than a zero-width shell.
        """
        files.call(NS + ".map_generate_run", MTZ, AMPL, PHASES, "None", "", "",
                   "f7lfargs", False)
        tag = _next_tag("ARGS")
        files.do("import pymol; print('%s', repr(pymol._tenmol_f7_args))" % tag)
        args = ast.literal_eval(_tagged(bridge, tag))
        assert args == (
            "f7lfargs01", MTZ, AMPL, PHASES, "None", 0.0, 0.0, 1, 1,
        )
        assert files_panel._reso_float("") == 0.0

    def test_the_fofc_isomesh_branch_is_two_meshes_green_and_red(
        self, files, working_generator, map_rep_settings, f7_objects
    ):
        """``PyMOLMapLoad.py:302-310``, the only branch that makes two objects.

        Run rather than asserted from ``map_rep_plan``: the levels are +3.0 and
        -3.0 on the same map and the colours are applied by NAME, so a typo in
        either would produce two identically coloured meshes and no error.
        """
        files.call("cmd.set", "default_fofc_map_rep", "isomesh")
        report = files.call(
            NS + ".map_generate_run", MTZ, AMPL, PHASES, "None", "", "",
            "f7lfmesh", True,
        )
        assert report["ok"] is True
        assert report["rep"] == "isomesh"
        names = [step["name"] for step in report["reps"]]
        assert names == ["f7lfmesh01-msh301", "f7lfmesh01-msh-301"], report
        assert [files.call("cmd.get_type", name) for name in names] == [
            "object:mesh", "object:mesh",
        ]
        assert files.call("cmd.get_object_color_index", names[0]) == files.call(
            "cmd.get_color_index", "green"
        )
        assert files.call("cmd.get_object_color_index", names[1]) == files.call(
            "cmd.get_color_index", "red"
        )


# =========================================================================== #
# Row 293 — what a Finder double-click gives that a drop does not
# =========================================================================== #


@pytest.fixture
def reuse_helper(ws, bridge):
    """Drive ``pymol.invocation.options.reuse_helper``, then put it back.

    ``invocation.options`` is a plain mutable process global, and it is only
    safe to WRITE because the options were snapshotted into ``CPyMOLOptions``
    at ``_cmd._new`` (``packages/engine/layer1/P.cpp:1800-1830``) — nothing about the running
    engine changes, only what ``open_with_plan`` reads.  Attributes are not
    fetchable through the dispatcher (it invokes callables), hence the console
    round trip.
    """
    tag = _next_tag("REUSE")
    ws.do("import pymol; print('%s', int(pymol.invocation.options.reuse_helper))" % tag)
    before = int(_tagged(bridge, tag))

    def setter(value: int) -> None:
        ws.do("import pymol; pymol.invocation.options.reuse_helper = %d" % int(value))

    yield setter
    setter(before)


@pytest.fixture
def presentation_session(ws):
    """A scratch session, and the process globals a session load overwrites.

    ONE PYMOL PER SUITE, and this is the most invasive fixture in the file:
    ``cmd.load`` of a ``.pse``/``.psw`` REPLACES the object list, the scene
    list, the camera and every global setting (``set_session(steal=1)``,
    ``importing.py:836``).  The camera and ``session_file`` are snapshotted and
    put back; the objects and scenes this test creates are deleted.  The same
    hazard is already accepted by ``test_sessions.py``, which round-trips a
    real PSE through the shared engine.
    """
    view = ws.call("cmd.get_view")
    session_file = ws.call("cmd.get", "session_file")
    yield
    for name in list(ws.call("cmd.get_scene_list") or []):
        ws.call("cmd.scene", name, "delete")
    for name in list(ws.call("cmd.get_names", "all") or []):
        if name.startswith("f7lf"):
            ws.call("cmd.delete", name)
    ws.call("cmd.set", "session_file", session_file)
    ws.call("cmd.set_view", view)


class TestPresentationFiles:
    def test_the_same_bytes_are_a_presentation_only_when_named_psw(
        self, files, tmp_path, presentation_session
    ):
        """The engine, not the Qt handler, is what makes a ``.psw`` special.

        ``load_pse`` rewinds the movie and recalls the first scene when the
        FORMAT is ``psw`` and ``presentation_auto_start`` is on
        (``importing.py:843-852``); both files here are written by the same
        ``cmd.save(..., format='pse')`` the web client uses for Save Session
        As, so the only difference is the extension.

        MEASURED: after the ``.pse`` the camera is the one that was saved;
        after the ``.psw`` it is the scene's, and ``scene_current_name`` is the
        scene.  A browser gets this from a plain ``cmd.load`` — there is no
        Finder handler and none is needed.
        """
        assert files.call("cmd.get", "presentation_auto_start") == "on"
        files.call("cmd.delete", "all")
        files.call("cmd.fragment", "ala", "f7lfshow")
        files.call("cmd.reset")
        files.call("cmd.turn", "x", 90)
        files.call("cmd.scene", "F7LFSCENE", "store")
        scene_view = files.call("cmd.get_view")

        # Move the camera AWAY from the scene before saving, so "the scene was
        # recalled" and "the session's own camera was restored" are different
        # answers.
        files.call("cmd.turn", "y", 45)
        saved_view = files.call("cmd.get_view")
        assert [round(v, 3) for v in saved_view[:3]] != [
            round(v, 3) for v in scene_view[:3]
        ]

        pse = str(tmp_path / "f7lfshow.pse")
        psw = str(tmp_path / "f7lfshow.psw")
        files.call("cmd.save", pse, "", -1, "pse")
        files.call("cmd.save", psw, "", -1, "pse")
        assert os.path.getsize(pse) > 1000 and os.path.getsize(psw) > 1000

        files.call("cmd.turn", "y", -80)
        files.call("cmd.load", pse)
        assert [round(v, 3) for v in files.call("cmd.get_view")[:9]] == [
            round(v, 3) for v in saved_view[:9]
        ], "loading a .pse must NOT recall a scene"

        files.call("cmd.turn", "y", -80)
        files.call("cmd.load", psw)
        assert [round(v, 3) for v in files.call("cmd.get_view")[:9]] == [
            round(v, 3) for v in scene_view[:9]
        ], "loading a .psw must recall the first scene"
        assert files.call("cmd.get", "scene_current_name") == "F7LFSCENE"

    def test_every_pymol_show_extension_asks_for_the_preset(
        self, files, reuse_helper
    ):
        """``.pzw`` and ``.psw.gz`` are PyMOL Show files too.

        Upstream's handler asks ``endswith('.psw')`` (``:1154``), which is
        narrower than Qt's own open filter ``PyMOL Show File (*.psw *.pzw
        *.psw.gz)`` (``:660``) and narrower than the engine, which maps all
        three to format ``psw`` (``importing.py:43-47,63-65``) and starts the
        presentation for all three.  The plan keys off the parsed format, so
        the three agree here.

        ``reuse_helper`` is driven to 1 rather than the object list being
        emptied: ``presentation`` is suppressed on the ``new-window`` branch
        (``:1147`` returns first), and deleting every object to get there would
        take this file's blast radius well past its own fixtures.
        """
        reuse_helper(1)
        for name in ("/tmp/f7lf.psw", "/tmp/f7lf.pzw", "/tmp/f7lf.psw.gz"):
            info = files.call(NS + ".classify", name)
            assert info["format"] == "psw", name
            assert info["dialog"] == "session", name
            plan = files.call(NS + ".open_with_plan", name)
            assert plan["presentation"] is True, name
            assert plan["action"] == "load-here", name

        for name in ("/tmp/f7lf.pse", "/tmp/f7lf.pze", "/tmp/f7lf.pdb"):
            plan = files.call(NS + ".open_with_plan", name)
            assert plan["presentation"] is False, name

    def test_the_preset_is_the_whole_of_what_the_handler_adds(self, files):
        """Four steps, of which one cannot succeed anywhere.

        ``cmd.full_screen`` raises on every platform and every build —
        ``CmdFullScreen`` (``packages/engine/layer4/Cmd.cpp:5352-5362``) returns an ``ok`` it
        never assigns — so the Finder ``.psw`` path throws at
        ``pymol_qt_gui.py:1156`` BEFORE ``load_dialog``, and the presentation
        file never opens at all.  The other three are plain settings a browser
        can apply and, unlike a Qt window, must be able to undo.
        """
        assert [step["name"] for step in
                files.call(NS + ".open_with_plan", "/tmp/f7lf.psw")["presetSteps"]] == [
            "presentation", "internal_gui", "internal_feedback", "full_screen",
        ]
        reply = files.call_reply("cmd.full_screen", "on")
        assert reply["t"] == "err", "cmd.full_screen stopped raising"
        assert reply["error"]["kind"] == "CmdException"

    def test_the_first_preset_step_is_the_one_that_arms_the_quit_path(
        self, files
    ):
        """Why the preset is a routine nobody calls yet, stated as a test.

        ``presentation`` is not a cosmetic flag: with it ON, a second
        consecutive ``scene next`` past the end of the list calls
        ``chain_session`` and then ``cmd.quit()`` (``viewing.py:1107-1114``) —
        which here ends the bridge process for every connected client.  Its
        OFF default is the only safety, and step one of this preset is exactly
        what removes it.  The four preconditions are pinned, deliberately
        untriggered, by ``test_sessions.py::
        test_the_presentation_quit_path_is_DORMANT_by_default``; the client's
        own scene actions carry the same warning
        (``apps/web/src/features/scenes/sceneActions.ts:56-73``).

        So: a browser CAN have the Finder handler's presentation preset, and
        nothing may turn it on until ``scene next`` is guarded.  Asserted here
        as "still off", so a panel that starts calling it lands on this test.
        """
        steps = files.call(NS + ".open_with_plan", "/tmp/f7lf.psw")["presetSteps"]
        assert steps[0] == {"kind": "set", "name": "presentation", "value": 1}
        assert files.call("cmd.get", "presentation") == "off"
        assert files.call("cmd.get", "presentation_auto_quit") == "on"
