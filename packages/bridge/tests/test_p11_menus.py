"""Rows 61 and 65 — the File leaf that was dead and the submenu that lied.

ROW 65.  ``Display > Stereo Mode`` issues nine literal command lines
(``packages/engine/modules/pymol/_gui.py:377``, harvested into
``apps/web/src/features/menubar/generated/menudata.ts``).  Waves 8 and 9 refused
to measure them in this shared process; wave 10 measured them against the e2e
harness's engine.  This file pins the measurement HERE, in the suite that ships,
so the client's table (``features/menubar/stereo.ts``) is checked against the
engine rather than against a comment.

ROW 61.  ``File > Edit pymolrc`` needs three bridge answers and this asserts the
shape of all three, including the one that only shows up on a machine with no rc
file — which is this machine, and the normal case.

WHAT IS RESTORED.  ``cmd.stereo`` writes four settings between them: ``stereo``,
``stereo_mode`` (latched — ``stereo off`` does NOT put it back), ``chromadepth``
(``stereo chromadepth`` sets it to 1) and ``stereo_shift`` (``stereo swap``
negates it).  The suite shares one PyMOL, so every one of them is saved by value
and restored in a ``finally``.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Iterator, Tuple

import pytest

FILES_BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"

#: `apps/web/src/features/menubar/stereo.ts` — the client's table, as data.
#: command line -> (stereo after, stereo_mode after or None = unchanged)
STEREO_TABLE: Tuple[Tuple[str, str, Any], ...] = (
    ("stereo anaglyph", "on", 10),
    ("stereo crosseye", "on", 2),
    ("stereo walleye", "on", 3),
    ("stereo byrow", "on", 6),
    ("stereo chromadepth", "off", None),
    ("stereo swap", None, None),
    ("stereo quadbuffer", "off", None),
    ("stereo openvr", "off", None),
    ("stereo off", "off", None),
)

#: The two the ENGINE refuses, with the sentence it refuses with.  Quoted in
#: `STEREO_UNAVAILABLE` as corroboration; the client's own reason is the
#: transport, not the build.
ENGINE_REFUSALS = {
    "stereo quadbuffer": "no 'quadbuffer' support detected",
    "stereo openvr": "'openvr' stereo mode not available in this build",
}


@pytest.fixture
def stereo_restored(ws) -> Iterator[None]:
    """Save the four settings ``cmd.stereo`` writes, and put them all back."""
    names = ("stereo", "stereo_mode", "chromadepth", "stereo_shift")
    before = {name: ws.call("cmd.get", name) for name in names}
    try:
        yield
    finally:
        # `stereo` last: setting `stereo_mode` while stereo is on would leave
        # the scene in the mode we are trying to leave.
        ws.call("cmd.set", "stereo_mode", before["stereo_mode"])
        ws.call("cmd.set", "chromadepth", before["chromadepth"])
        ws.call("cmd.set", "stereo_shift", before["stereo_shift"])
        ws.call("cmd.stereo", "on" if before["stereo"] == "on" else "off")


# --------------------------------------------------------------------------- #
# Row 65 — the nine Stereo Mode leaves
# --------------------------------------------------------------------------- #


def test_stereo_leaves_do_exactly_what_the_client_table_says(
    ws, bridge, stereo_restored
) -> None:
    """Every leaf, issued the way the menu issues it: ``{t:'do'}``.

    The reply is ``ok`` for ALL NINE, including the two PyMOL rejects — that is
    why ``MenuBar`` reads the state back instead of trusting the reply, and why
    the two impossible leaves are refused in the client rather than sent.
    """
    ws.do("stereo off")
    seen: Dict[str, Tuple[str, str, float]] = {}
    for command, _expect_stereo, _expect_mode in STEREO_TABLE:
        before_mode = ws.call("cmd.get", "stereo_mode")
        t0 = time.monotonic()
        reply = ws.do(command)
        elapsed = (time.monotonic() - t0) * 1000.0
        assert reply["t"] == "ok", (command, reply)
        stereo = ws.call("cmd.get", "stereo")
        mode = ws.call("cmd.get", "stereo_mode")
        seen[command] = (stereo, mode, elapsed)

        expected_stereo = _expect_stereo
        if expected_stereo is not None:
            assert stereo == expected_stereo, (command, stereo)
        if _expect_mode is None:
            assert mode == before_mode, (command, mode, before_mode)
        else:
            assert int(mode) == _expect_mode, (command, mode)

    # Sub-millisecond, every one of them: nothing here blocks on a GL context.
    assert all(elapsed < 50.0 for _, _, elapsed in seen.values()), seen

    # And the engine is still alive and still drawing — waves 8 and 9 refused
    # this measurement because they expected `quadbuffer`/`openvr` to take the
    # process down.  They do not reach anything: `ExecutiveStereo` returns an
    # error before `OpenVRInit` (`packages/engine/layer3/Executive.cpp:9559-9571`).
    health = bridge.healthz()
    assert health["state"] == "running", health
    draws = int(health["draws"])
    time.sleep(1.0)
    later = bridge.healthz()
    assert later["state"] == "running"
    assert int(later["draws"]) > draws, (draws, later["draws"])


def test_the_two_impossible_leaves_are_the_ones_pymol_itself_rejects(
    ws, bridge, stereo_restored
) -> None:
    """`quadbuffer` and `openvr` change nothing and print their own error.

    The client refuses them for a different and stronger reason (the frame
    transport is one 2-D raster, so there is no second buffer for the second
    eye) — this pins the corroboration `STEREO_UNAVAILABLE` quotes.
    """
    ws.do("stereo crosseye")
    assert ws.call("cmd.get", "stereo") == "on"
    latched = ws.call("cmd.get", "stereo_mode")

    for command, needle in ENGINE_REFUSALS.items():
        assert ws.do(command)["t"] == "ok", command
        lines = bridge.wait_for_feedback(needle, timeout=5.0)
        # The drain's buffer is bounded, so "after the echo of THIS line" is the
        # window, not "after a count taken earlier".
        echo = "PyMOL>" + command
        assert echo in lines, (command, lines[-4:])
        after = lines[len(lines) - 1 - lines[::-1].index(echo):]
        assert any(needle in line for line in after), (command, after)
        # Nothing moved: not the mode, not the toggle.
        assert ws.call("cmd.get", "stereo_mode") == latched, command
        assert ws.call("cmd.get", "stereo") == "on", command


def test_chromadepth_is_not_a_stereo_mode_and_swap_needs_stereo_on(
    ws, stereo_restored
) -> None:
    """The two leaves whose LABEL is the lie, not the transport.

    `stereo chromadepth` is flag -3: `SettingSet(chromadepth, 1)` +
    `SceneSetStereo(G, 0)` (`packages/engine/layer3/Executive.cpp:9548-9550`).  `stereo swap` is
    flag -1 and only negates `stereo_shift`.  `stereo.ts` says both of these in
    the tooltip and in the console note; here is the engine agreeing.
    """
    ws.do("stereo walleye")
    assert ws.call("cmd.get", "stereo") == "on"
    shift_on = float(ws.call("cmd.get", "stereo_shift"))

    assert ws.do("stereo swap")["t"] == "ok"
    assert float(ws.call("cmd.get", "stereo_shift")) == pytest.approx(-shift_on)
    assert ws.call("cmd.get", "stereo") == "on", "swap does not touch `stereo`"
    assert int(ws.call("cmd.get", "stereo_mode")) == 3, "swap does not touch the mode"

    # `chromadepth` is an int setting, so `cmd.get` answers '0'/'1' — not the
    # 'on'/'off' that `stereo` answers with.
    assert int(ws.call("cmd.get", "chromadepth")) == 0
    assert ws.do("stereo chromadepth")["t"] == "ok"
    assert int(ws.call("cmd.get", "chromadepth")) == 1
    assert ws.call("cmd.get", "stereo") == "off", "chromadepth TURNS STEREO OFF"
    assert int(ws.call("cmd.get", "stereo_mode")) == 3, "and leaves the mode latched"

    # `stereo off` after a mode does not put `stereo_mode` back either — the
    # reason `stereoNote` says "stereo_mode stays latched at N".
    ws.do("stereo anaglyph")
    assert int(ws.call("cmd.get", "stereo_mode")) == 10
    ws.do("stereo off")
    assert ws.call("cmd.get", "stereo") == "off"
    assert int(ws.call("cmd.get", "stereo_mode")) == 10


def test_render_stats_reports_the_reps_the_client_draws_itself(ws) -> None:
    """The read `MenuBar` makes to say WHERE a stereo mode will be visible.

    `_bridge.render_stats` is read-only (`packages/viewport/src/stream/pause.ts`
    says so and this asserts it: two calls either side of a declaration see only
    what the declaration changed).  `modeP.params.geometryReps` is the list the
    compositor declared on `_bridge.set_pixel_stream`
    (`packages/viewport/src/compositor/wiring.ts:125`), which is exactly "the
    reps this browser is drawing itself".
    """
    stats = ws.call("_bridge.render_stats")
    params = stats["modeP"]["params"]
    assert "geometryReps" in params, sorted(params)
    before = list(params["geometryReps"])

    # Declare cartoon (rep 8) the way the viewport does, then read it back.
    ws.request(t="call", fn="_bridge.set_pixel_stream", args=[],
               kwargs={"geometryReps": [8]})
    try:
        again = ws.call("_bridge.render_stats")
        assert list(again["modeP"]["params"]["geometryReps"]) == [8]
        # Read-only: asking twice does not change it.
        assert list(
            ws.call("_bridge.render_stats")["modeP"]["params"]["geometryReps"]
        ) == [8]
    finally:
        ws.request(t="call", fn="_bridge.set_pixel_stream", args=[],
                   kwargs={"geometryReps": before})
    assert list(
        ws.call("_bridge.render_stats")["modeP"]["params"]["geometryReps"]
    ) == before


# --------------------------------------------------------------------------- #
# Row 61 — Edit pymolrc
# --------------------------------------------------------------------------- #


def test_pymolrc_and_read_text_give_the_editor_what_it_needs(ws) -> None:
    """The three answers `File > Edit pymolrc` is built out of.

    MEASURED on this tree: `pymolrc()` is `{'paths': [], 'home': '/Users/…'}`
    (no rc file loaded), so the client falls back to `$HOME/.pymolrc` exactly as
    `_edit_pymolrc` does (`TextEditor.py:170-174`), and `read_text` on it
    answers `ok: False` with an ENOENT string.  THAT STRING IS A CONTRACT: the
    client's `NOT_FOUND` regex turns it into "empty buffer, Save will create
    it"; anything else it turns into a refusal, so an unreadable file is never
    shown as an empty one.
    """
    ws.do(FILES_BOOTSTRAP)

    rc = ws.call("cmd.tenmol_files.pymolrc")
    assert sorted(rc) == ["home", "paths"], rc
    assert isinstance(rc["paths"], list)
    assert isinstance(rc["home"], str) and rc["home"]
    for entry in rc["paths"]:
        assert isinstance(entry, str)

    target = rc["paths"][0] if rc["paths"] else rc["home"] + "/.pymolrc"
    answer = ws.call("cmd.tenmol_files.read_text", target)
    assert answer["path"] == target, answer
    if answer["ok"]:
        assert isinstance(answer["text"], str)
    else:
        # The ENOENT shape the client matches on.
        assert "No such file or directory" in answer["error"], answer
        assert answer["text"] == ""

    # A path that exists but is a DIRECTORY must not look like "not there yet".
    directory = ws.call("cmd.tenmol_files.read_text", rc["home"])
    assert directory["ok"] is False
    assert "No such file or directory" not in (directory["error"] or ""), directory


def test_read_text_round_trips_the_editor_buffer(ws, tmp_path) -> None:
    """`Save` on a file that did not exist creates it — the pymolrc case."""
    ws.do(FILES_BOOTSTRAP)
    target = str(tmp_path / "pymolrc.pml")

    missing = ws.call("cmd.tenmol_files.read_text", target)
    assert missing["ok"] is False and "No such file" in missing["error"]

    body = "set ray_opaque_background, 0\nbg_rgb white\n"
    wrote = ws.call("cmd.tenmol_files.write_text", target, body)
    assert wrote["ok"] is True, wrote

    back = ws.call("cmd.tenmol_files.read_text", target)
    assert back["ok"] is True and back["text"] == body, back
    assert back["path"] == target
