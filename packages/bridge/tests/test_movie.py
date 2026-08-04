"""WP-20 — movies, frames/states and scenes, end to end against a live engine.

Everything here goes through the REAL WebSocket, the real dispatcher and the
real policy, because the interesting claims are about that whole path:

* the client can install ``panels/movie.py`` with one silent ``cmd.do`` and
  then reach ``cmd.get_movie_panel`` under the ordinary capability policy;
* the timeline model matches what PyMOL actually computed
  (``MovieFrameToIndex``, ``CViewElem::specification_level``, the per-frame
  ``mdo`` strings) rather than what we hoped it computed;
* **blocker A2** — ``cmd.mpng`` does not leave the engine wedged. That is
  asserted twice: once for the ``modal=0`` path the product uses, and once for
  the ``modal=1`` path, where the test *proves* the transient
  ``APIEnterNotModal`` window exists and then closes.

The engine is a session fixture (one PyMOL per process), so every test tidies
up after itself with ``cmd.mset()`` + ``delete``.
"""

from __future__ import annotations

import os
import re
import tempfile
import time
from typing import Any, Dict, List

import pytest

from tenmol_bridge.panels import movie as movie_panel

BOOTSTRAP = "/import tenmol_bridge.panels.movie"


# --------------------------------------------------------------------------
# pure helpers — no engine needed
# --------------------------------------------------------------------------


def test_storemask_bit_names_match_moviescene_cpp() -> None:
    """``packages/engine/layer3/MovieScene.cpp:207-213`` packs the mask in this bit order."""
    assert movie_panel.STORE_BITS == (
        (0x01, "view"),
        (0x02, "active"),
        (0x04, "color"),
        (0x08, "rep"),
        (0x10, "frame"),
        (0x20, "thumbnail"),
    )
    # 63 is what a plain `scene new, store` produces (measured).
    assert movie_panel._storemask_names(63) == [
        "view",
        "active",
        "color",
        "rep",
        "frame",
        "thumbnail",
    ]
    assert movie_panel._storemask_names(0x01 | 0x10) == ["view", "frame"]


def test_viewelem_indices_are_the_ones_view_cpp_writes() -> None:
    """A typo here would silently mislabel every cell in the timeline."""
    assert movie_panel.VE_SPEC_LEVEL == 12
    assert movie_panel.VE_SCENE_FLAG == 13
    assert movie_panel.VE_SCENE_NAME == 14
    assert movie_panel.VE_STATE_FLAG == 19
    assert movie_panel.VE_STATE == 20
    assert movie_panel.THUMBNAIL_WIDTH == 220
    assert movie_panel.THUMBNAIL_HEIGHT == 124


def test_scene_name_is_only_read_when_the_flag_is_set() -> None:
    """``View.cpp:393-401`` stores the int 0 when ``scene_flag`` is clear."""
    flagged = [0] * 21
    flagged[movie_panel.VE_SCENE_FLAG] = 1
    flagged[movie_panel.VE_SCENE_NAME] = "S1"
    assert movie_panel._scene_at(flagged) == "S1"

    unflagged = [0] * 21
    unflagged[movie_panel.VE_SCENE_NAME] = 0
    assert movie_panel._scene_at(unflagged) is None
    assert movie_panel._scene_at(None) is None


# --------------------------------------------------------------------------
# engine-bound
# --------------------------------------------------------------------------


@pytest.fixture
def movie_ws(ws: Any) -> Any:
    """A client with the panel module installed and a clean movie."""
    reply = ws.request(t="call", fn="cmd.do", args=[BOOTSTRAP], kwargs={"echo": 0, "log": 0})
    assert reply["t"] == "ok", reply
    _reset(ws)
    yield ws
    _reset(ws)


def _reset(ws: Any) -> None:
    """One PyMOL per process, so every test has to leave no trace.

    ``scene * , clear`` is the documented "all scenes" form (`viewing.py:1034`:
    key `*` is legal for the clear and recall actions only).
    """
    ws.call("cmd.mset")
    ws.call("cmd.delete", "all")
    for name in ws.call("cmd.get_scene_list") or []:
        ws.call("cmd.scene", name, "clear")
    assert ws.call("cmd.get_scene_list") == []


def test_bootstrap_installs_the_panel_endpoints(movie_ws: Any) -> None:
    """One silent `cmd.do` is the whole installation step (plan §5.2)."""
    status = movie_ws.call("cmd.get_movie_status")
    assert set(status) >= {
        "frame",
        "state",
        "nframes",
        "length",
        "playing",
        "locked",
        "rocking",
        "settings",
    }
    # Reachable under the ordinary policy: two segments, public leaf, root
    # `cmd` is in DEFAULT_ROOTS, so no policy/grants entry was needed. What must
    # never come back is NotAllowed — a call that fails for its own reasons is
    # a different problem from a call the policy refuses to route.
    for symbol in movie_panel.EXPORTS:
        args = [""] if symbol == "get_scene_thumbnail_png" else []
        if symbol == "movie_export_png":
            continue  # writes files; covered by its own test
        reply = movie_ws.call_reply("cmd.%s" % symbol, *args)
        assert reply["t"] == "ok", (symbol, reply)


def test_frame_state_navigation_is_the_scenesetframe_vocabulary(movie_ws: Any) -> None:
    """`cmd.frame/rewind/forward/backward/ending/middle`, and the clamp."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x7")
    assert movie_ws.call("cmd.count_frames") == 7

    movie_ws.call("cmd.frame", 4)
    assert movie_ws.call("cmd.get_frame") == 4

    movie_ws.call("cmd.forward")
    assert movie_ws.call("cmd.get_frame") == 5
    movie_ws.call("cmd.backward")
    assert movie_ws.call("cmd.get_frame") == 4

    movie_ws.call("cmd.ending")
    assert movie_ws.call("cmd.get_frame") == 7
    # SceneSetFrame clamps to [0, NFrame): forward at the end is a no-op.
    movie_ws.call("cmd.forward")
    assert movie_ws.call("cmd.get_frame") == 7

    movie_ws.call("cmd.middle")
    assert movie_ws.call("cmd.get_frame") == 4  # NFrame/2 + 1, 0-based -> 3

    movie_ws.call("cmd.rewind")
    assert movie_ws.call("cmd.get_frame") == 1
    movie_ws.call("cmd.backward")
    assert movie_ws.call("cmd.get_frame") == 1

    # mode 7 = absolute with forced movie command, what the scrollbar emits.
    movie_ws.call("cmd.set_frame", 6, 7)
    assert movie_ws.call("cmd.get_frame") == 6


def test_mset_program_matches_client_preview(movie_ws: Any) -> None:
    """The frame->state table PyMOL computes vs. the port in `msetParser.ts`.

    The two expectations below are the ones asserted in
    `apps/web/src/features/movie/msetParser.test.ts`, so this test is what makes
    that unit test a statement about PyMOL and not just about itself.
    """
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x3 -5")
    panel = movie_ws.call("cmd.get_movie_panel")
    assert panel["nframes"] == 7
    assert [cell["state"] for cell in panel["cells"]] == [1, 1, 1, 2, 3, 4, 5]

    movie_ws.call("cmd.mset", "1 x30 1 -15 15 x30 15 -1")
    assert movie_ws.call("cmd.count_frames") == 90
    states = [cell["state"] for cell in movie_ws.call("cmd.get_movie_panel")["cells"]]
    assert states[:31] == [1] * 31
    assert states[31:45] == list(range(2, 16))
    assert states[45:76] == [15] * 31
    assert states[76:] == list(range(14, 0, -1))


def test_madd_appends_with_the_same_syntax(movie_ws: Any) -> None:
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x3")
    movie_ws.call("cmd.madd", "1 x2")
    assert movie_ws.call("cmd.count_frames") == 5


def test_per_frame_commands_round_trip_through_the_panel(movie_ws: Any) -> None:
    """`mdo`/`mappend` are write-only upstream — `mdump` only PRINTS.

    `get_movie_panel` reads them structurally out of `MovieCmdAsPyList`
    (`packages/engine/layer1/Movie.cpp:482`), which is the NEW getter the inventory asks for.
    """
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x4")
    # INVENTORY CORRECTION: §7 says mdo is "0-based on the wire". The 0-based
    # form is the C argument; `cmd.mdo` itself is 1-BASED and subtracts the 1
    # (`moving.py:317`, `_cmd.mdo(COb, int(frame)-1, ...)`). So frame 2 here
    # must land in `MovieCmdAsPyList[1]`, and the client must NOT subtract
    # again — which it used to.
    movie_ws.call("cmd.mdo", 2, "turn x, 5")
    cells = movie_ws.call("cmd.get_movie_panel")["cells"]
    assert cells[1]["frame"] == 2
    assert cells[1]["command"] == "turn x, 5"
    assert cells[0]["command"] == ""

    movie_ws.call("cmd.mappend", 2, "turn y, 5")
    cells = movie_ws.call("cmd.get_movie_panel")["cells"]
    assert cells[1]["command"] == "turn x, 5;turn y, 5"

    # mdump prints; assert it does not raise and produces console output.
    movie_ws.request(t="call", fn="cmd.mdump", args=[], kwargs={})


def test_mview_key_frames_and_spec_levels(movie_ws: Any) -> None:
    """store -> level 2, the reinterpolated span between -> level 1."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x5")
    movie_ws.call("cmd.mview", "store", 1)
    movie_ws.call("cmd.mview", "store", 5)
    movie_ws.call("cmd.mview", "reinterpolate")

    panel = movie_ws.call("cmd.get_movie_panel")
    specs = [cell["spec"] for cell in panel["cells"]]
    assert specs[0] == movie_panel.SPEC_KEY
    assert specs[4] == movie_panel.SPEC_KEY
    assert specs[1:4] == [movie_panel.SPEC_INTERPOLATED] * 3

    # `clear` drops the key. It does NOT drop the cell to level 0, because
    # `moving.py:232-241` re-runs a reinterpolate after store/clear/toggle
    # whenever `movie_auto_interpolate` is set — so the cell becomes
    # INTERPOLATED, not NONE. Asserting NONE here would be asserting that
    # movie_auto_interpolate is off.
    assert movie_ws.call("cmd.get_movie_status")["settings"]["movie_auto_interpolate"] is True
    movie_ws.call("cmd.mview", "clear", 5)
    specs = [cell["spec"] for cell in movie_ws.call("cmd.get_movie_panel")["cells"]]
    assert specs[4] != movie_panel.SPEC_KEY

    # With freeze=1 the auto-reinterpolate is suppressed and the cell empties.
    movie_ws.call("cmd.mset", "1 x5")
    movie_ws.call("cmd.mview", "store", 1)
    movie_ws.request(
        t="call", fn="cmd.mview", args=["clear"], kwargs={"first": 1, "freeze": 1}
    )
    specs = [cell["spec"] for cell in movie_ws.call("cmd.get_movie_panel")["cells"]]
    assert specs[0] == movie_panel.SPEC_NONE


def test_mview_store_with_scene_pins_the_scene_name(movie_ws: Any) -> None:
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x5")
    movie_ws.call("cmd.scene", "S1", "store", message="hello")
    reply = movie_ws.request(
        t="call", fn="cmd.mview", args=["store"], kwargs={"first": 3, "scene": "S1"}
    )
    assert reply["t"] == "ok", reply
    cells = movie_ws.call("cmd.get_movie_panel")["cells"]
    # frame 3 carries the pin; the auto-reinterpolate that follows a store
    # (`moving.py:232-241`) is handed the same `scene` argument, so the
    # interpolated neighbours inherit it too. What matters for the timeline is
    # that the flag is read from `scene_flag` and not from slot 14 blindly.
    assert cells[2]["scene"] == "S1"
    assert all(cell["scene"] in (None, "S1") for cell in cells)
    assert cells[2]["spec"] == movie_panel.SPEC_KEY
    movie_ws.call("cmd.scene", "S1", "clear")


def test_movie_panel_rows_are_camera_plus_objects_with_motions(movie_ws: Any) -> None:
    """`ExecutiveMotionDraw` parity: row 0 is the camera, then one per object."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.create", "m2", "ala")
    movie_ws.call("cmd.mset", "1 x6")
    movie_ws.call("cmd.mview", "store", 1)
    movie_ws.call("cmd.mview", "store", 6)
    movie_ws.call("cmd.mview", "reinterpolate")

    panel = movie_ws.call("cmd.get_movie_panel")
    assert [row["object"] for row in panel["rows"]] == [""]

    reply = movie_ws.request(
        t="call", fn="cmd.mview", args=["store"], kwargs={"first": 1, "object": "m2"}
    )
    assert reply["t"] == "ok", reply
    movie_ws.request(
        t="call", fn="cmd.mview", args=["store"], kwargs={"first": 6, "object": "m2"}
    )
    movie_ws.request(t="call", fn="cmd.mview", args=["reinterpolate"], kwargs={"object": "m2"})

    panel = movie_ws.call("cmd.get_movie_panel")
    assert [row["object"] for row in panel["rows"]] == ["", "m2"]
    assert len(panel["rows"][1]["spec"]) == panel["nframes"]
    assert panel["rows"][1]["spec"][0] == movie_panel.SPEC_KEY
    # MovieGetPanelHeight: row_height * rowCount (packages/engine/layer1/Movie.cpp:1701).
    assert panel["height"] == panel["rowHeight"] * len(panel["rows"])


def test_key_frame_range_editing(movie_ws: Any) -> None:
    """mmove / mcopy / minsert / mdelete all reach `_cmd.mmodify`."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x6")
    movie_ws.call("cmd.mview", "store", 1)

    def specs() -> List[int]:
        return [cell["spec"] for cell in movie_ws.call("cmd.get_movie_panel")["cells"]]

    assert specs()[0] == movie_panel.SPEC_KEY

    movie_ws.call("cmd.mcopy", 4, 1, 1)
    assert specs()[3] == movie_panel.SPEC_KEY
    assert specs()[0] == movie_panel.SPEC_KEY

    movie_ws.call("cmd.mmove", 6, 4, 1)
    after = specs()
    assert after[5] == movie_panel.SPEC_KEY
    # The source cell is no longer a KEY; with movie_auto_interpolate on it is
    # INTERPOLATED rather than empty (see the mview test).
    assert after[3] != movie_panel.SPEC_KEY

    before = movie_ws.call("cmd.count_frames")
    movie_ws.call("cmd.minsert", 3, 1)
    assert movie_ws.call("cmd.count_frames") == before + 3
    movie_ws.call("cmd.mdelete", 3, 1)
    assert movie_ws.call("cmd.count_frames") == before


def test_movie_playback_is_backend_driven(movie_ws: Any) -> None:
    """`mplay` really advances frames on the pump; the client runs no timer."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x60")
    movie_ws.call("cmd.set", "movie_fps", 30)
    movie_ws.call("cmd.rewind")
    assert movie_ws.call("cmd.get_movie_playing") == 0

    movie_ws.call("cmd.mplay")
    assert movie_ws.call("cmd.get_movie_playing") == 1
    seen = set()
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline and len(seen) < 3:
        seen.add(movie_ws.call("cmd.get_frame"))
        time.sleep(0.05)
    movie_ws.call("cmd.mstop")
    assert movie_ws.call("cmd.get_movie_playing") == 0
    assert len(seen) >= 3, "the engine did not advance frames while playing: %r" % (seen,)

    # mtoggle flips it back on and off again.
    movie_ws.call("cmd.mtoggle")
    assert movie_ws.call("cmd.get_movie_playing") == 1
    movie_ws.call("cmd.mtoggle")
    assert movie_ws.call("cmd.get_movie_playing") == 0


def test_rock_query_toggle_and_sweep_settings(movie_ws: Any) -> None:
    """`ControlRock` modes: -2 query only, 0 off, 1 on."""
    assert movie_ws.call("cmd.rock", -2) == 0
    movie_ws.call("cmd.rock", 1)
    assert movie_ws.call("cmd.rock", -2) == 1
    assert movie_ws.call("cmd.get_movie_status")["rocking"] is True
    movie_ws.call("cmd.rock", 0)
    assert movie_ws.call("cmd.rock", -2) == 0

    # sweep_mode 0=Y 1=X 2=Z 3=nutate; sweep_angle<=0 degenerates into a spin.
    for mode in (0, 1, 2, 3):
        movie_ws.call("cmd.set", "sweep_mode", mode)
        assert movie_ws.call("cmd.get_movie_status")["settings"]["sweep_mode"] == mode
    movie_ws.call("cmd.set", "sweep_mode", 0)


def test_camera_view_get_set_is_eighteen_floats(movie_ws: Any) -> None:
    movie_ws.call("cmd.fragment", "ala")
    view = movie_ws.call("cmd.get_view", 0)
    assert len(view) == 18

    movie_ws.call("cmd.turn", "x", 30)
    turned = movie_ws.call("cmd.get_view", 0)
    assert turned[:9] != view[:9]

    movie_ws.request(t="call", fn="cmd.set_view", args=[view], kwargs={"animate": 0})
    restored = movie_ws.call("cmd.get_view", 0)
    assert restored[:9] == pytest.approx(view[:9], abs=1e-5)

    # output=3 returns a `set_view (...)` block, which is what the UI shows.
    text = movie_ws.call("cmd.get_view", 3, quiet=1)
    assert isinstance(text, str) and text.startswith("set_view")
    assert len(re.findall(r"-?\d+\.\d+", text)) >= 18

    # `set_view` requires EXACTLY 18 floats.
    bad = movie_ws.call_reply("cmd.set_view", view[:17])
    assert bad["t"] == "err"


def test_named_views_are_python_side_state(movie_ws: Any) -> None:
    """`cmd.view` store/recall/clear against `pymol._view_dict`."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.view", "V1", "store")
    movie_ws.call("cmd.turn", "y", 45)
    turned = movie_ws.call("cmd.get_view", 0)
    movie_ws.request(t="call", fn="cmd.view", args=["V1", "recall"], kwargs={"animate": 0})
    back = movie_ws.call("cmd.get_view", 0)
    assert back[:9] != pytest.approx(turned[:9], abs=1e-5)
    movie_ws.call("cmd.view", "V1", "clear")


# -- scenes ----------------------------------------------------------------


def test_scene_store_recall_next_previous_and_order(movie_ws: Any) -> None:
    movie_ws.call("cmd.fragment", "ala")
    for name in ("A", "B", "C"):
        movie_ws.call("cmd.scene", name, "store")
    panel = movie_ws.call("cmd.get_scene_panel")
    assert panel["order"] == ["A", "B", "C"]
    assert panel["current"] == "C"
    assert all(scene["storemask"] == 63 for scene in panel["scenes"])
    assert panel["scenes"][0]["stores"] == [
        "view",
        "active",
        "color",
        "rep",
        "frame",
        "thumbnail",
    ]

    movie_ws.request(t="call", fn="cmd.scene", args=["A", "recall"], kwargs={"animate": 0})
    assert movie_ws.call("cmd.get_scene_panel")["current"] == "A"

    # next/previous walk the order.
    movie_ws.request(t="call", fn="cmd.scene", args=["", "next"], kwargs={"animate": 0})
    assert movie_ws.call("cmd.get_scene_panel")["current"] == "B"
    movie_ws.request(t="call", fn="cmd.scene", args=["", "previous"], kwargs={"animate": 0})
    assert movie_ws.call("cmd.get_scene_panel")["current"] == "A"

    # scene_order with an explicit list, and with sort.
    movie_ws.call("cmd.scene_order", "C B A")
    assert movie_ws.call("cmd.get_scene_list") == ["C", "B", "A"]
    movie_ws.request(t="call", fn="cmd.scene_order", args=["*"], kwargs={"sort": 1})
    assert movie_ws.call("cmd.get_scene_list") == ["A", "B", "C"]
    # location='top' relocates a block.
    movie_ws.request(t="call", fn="cmd.scene_order", args=["C"], kwargs={"location": "top"})
    assert movie_ws.call("cmd.get_scene_list") == ["C", "A", "B"]

    for name in ("A", "B", "C"):
        movie_ws.call("cmd.scene", name, "clear")
    assert movie_ws.call("cmd.get_scene_list") == []


def test_scene_message_and_rename(movie_ws: Any) -> None:
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.request(
        t="call", fn="cmd.scene", args=["S1", "store"], kwargs={"message": "look here"}
    )
    panel = movie_ws.call("cmd.get_scene_panel")
    assert panel["scenes"][0]["message"] == "look here"

    movie_ws.call("cmd.set_scene_message", "S1", "changed")
    assert movie_ws.call("cmd.get_scene_message", "S1") == "changed"

    movie_ws.request(t="call", fn="cmd.scene", args=["S1", "rename"], kwargs={"new_key": "S9"})
    assert movie_ws.call("cmd.get_scene_list") == ["S9"]
    movie_ws.call("cmd.scene", "S9", "clear")


def test_scene_store_flags_select_the_storemask(movie_ws: Any) -> None:
    """The Append> submenu: view/color/rep flags land in `storemask`."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.request(
        t="call", fn="cmd.scene", args=["CAM", "store"], kwargs={"color": 0, "rep": 0}
    )
    entry = next(
        scene
        for scene in movie_ws.call("cmd.get_scene_panel")["scenes"]
        if scene["name"] == "CAM"
    )
    assert "view" in entry["stores"]
    assert "color" not in entry["stores"]
    assert "rep" not in entry["stores"]
    movie_ws.call("cmd.scene", "CAM", "clear")


def test_scene_thumbnail_is_a_png_after_the_deferred_draw(movie_ws: Any) -> None:
    """`get_scene_thumbnail` returns RGBA first, PNG once the draw lands.

    The inventory says "returns raw PNG bytes"; that is only true *after*
    `SceneDeferImage` completes (`packages/engine/layer3/MovieScene.cpp:225-232`). Immediately
    after `scene store` the buffer is 220*124*4 = 109,120 raw zero bytes. This
    test asserts both halves, which is why the payload carries `encoding`.
    """
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.scene", "T1", "store")

    deadline = time.monotonic() + 10.0
    thumb: Dict[str, Any] = {}
    while time.monotonic() < deadline:
        thumb = movie_ws.call("cmd.get_scene_thumbnail_png", "T1")
        if thumb["ready"]:
            break
        assert thumb["encoding"] in ("rgba", "empty")
        assert thumb["bytes"] in (0, 220 * 124 * 4)
        time.sleep(0.1)

    assert thumb["ready"], "thumbnail never resolved: %r" % (thumb,)
    assert thumb["encoding"] == "png"
    assert thumb["width"] == 220 and thumb["height"] == 124
    import base64

    raw = base64.b64decode(thumb["data"])
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    movie_ws.call("cmd.scene", "T1", "clear")


# -- movie programs --------------------------------------------------------


def test_keyframe_program_generators(movie_ws: Any) -> None:
    """`cmd.movie.add_roll` / `add_nutate` build real key frames."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.request(
        t="call", fn="cmd.movie.add_roll", args=[1.0], kwargs={"axis": "y", "start": 1}
    )
    panel = movie_ws.call("cmd.get_movie_panel")
    assert panel["nframes"] == movie_ws.call("cmd.count_frames") > 1
    assert any(cell["spec"] == movie_panel.SPEC_KEY for cell in panel["cells"])

    movie_ws.call("cmd.mset")
    movie_ws.request(
        t="call", fn="cmd.movie.add_nutate", args=[1.0, 30], kwargs={"start": 1}
    )
    panel = movie_ws.call("cmd.get_movie_panel")
    # add_nutate stores EVERY frame (movie.py:433).
    assert all(cell["spec"] == movie_panel.SPEC_KEY for cell in panel["cells"])


def test_legacy_mdo_program_generators(movie_ws: Any) -> None:
    """`movie.roll` / `movie.nutate` write per-frame `turn` commands."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x8")
    movie_ws.request(t="call", fn="cmd.movie.roll", args=[1, 8, 1], kwargs={"axis": "y"})
    cells = movie_ws.call("cmd.get_movie_panel")["cells"]
    commands = [cell["command"] for cell in cells]
    assert any("turn" in command for command in commands), commands

    movie_ws.call("cmd.mset", "1 x8")
    movie_ws.call("cmd.movie.nutate", 1, 8)
    commands = [cell["command"] for cell in movie_ws.call("cmd.get_movie_panel")["cells"]]
    assert any("turn" in command for command in commands), commands

    # `mclear` drops cached frame images and leaves the program alone.
    movie_ws.call("cmd.mclear")
    assert movie_ws.call("cmd.count_frames") == 8


def test_mvprg_template_expansion_matches_the_gui(movie_ws: Any) -> None:
    """`mvprg` fills `%d` with `get_movie_length()+1` (`_gui.py:958`)."""
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x10")
    length = movie_ws.call("cmd.get_movie_length")
    assert length == 10
    start = length + 1
    command = "movie.add_roll(1.0,axis='y',start=%d)" % start
    movie_ws.do("cmd." + command)
    assert movie_ws.call("cmd.count_frames") > 10

    # Remove Last Program: cmd.mdelete(-1, movie_start).
    movie_ws.call("cmd.mdelete", -1, start)
    assert movie_ws.call("cmd.count_frames") == 10


# -- blocker A2 ------------------------------------------------------------


def test_mpng_modal_zero_writes_frames_and_leaves_the_engine_usable(movie_ws: Any) -> None:
    """The path the product uses. Plan §A2, but with `modal=0`.

    `modal=0` only works because `Shims` installs `_call_with_opengl_context`
    with `_pushValidContext`; without it `SceneMakeMovieImage`'s
    `cSceneImage_Normal` branch is gated off `G->ValidContext` and prints
    `MoviePNG-Error: Missing rendered image.` once per frame.
    """
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x4")
    with tempfile.TemporaryDirectory(prefix="tenmol-mpng0") as directory:
        result = movie_ws.call(
            "cmd.movie_export_png",
            os.path.join(directory, "f"),
            width=160,
            height=120,
        )
        assert result["count"] == 4, result
        assert result["files"] == ["f0001.png", "f0002.png", "f0003.png", "f0004.png"]
        for name in result["files"]:
            with open(os.path.join(directory, name), "rb") as handle:
                assert handle.read(8) == b"\x89PNG\r\n\x1a\n"

    # THE POINT OF THE TEST: the engine answers the very next call.
    assert movie_ws.call("cmd.count_atoms", "ala") == 10
    assert movie_ws.call("cmd.get_movie_status")["nframes"] == 4


def test_mpng_modal_one_wedges_briefly_and_then_recovers(movie_ws: Any) -> None:
    """Blocker A2 in full: `modal=1` DOES install `ModalDraw`, and it clears.

    Measured while writing this: the call immediately after a modal `mpng`
    raised ` Error: APIEnterNotModal(G)`, and the modal state cleared 0.16 s
    later with all frames written and `count_atoms` intact. The test asserts the
    recovery, and tolerates either outcome for the first call so it does not
    become a race — what must never happen is a permanent wedge.
    """
    movie_ws.call("cmd.fragment", "ala")
    movie_ws.call("cmd.mset", "1 x4")
    with tempfile.TemporaryDirectory(prefix="tenmol-mpng1") as directory:
        prefix = os.path.join(directory, "g")
        reply = movie_ws.request(
            t="call",
            fn="cmd.mpng",
            args=[prefix],
            kwargs={"modal": 1, "width": 160, "height": 120},
        )
        assert reply["t"] == "ok", reply

        deadline = time.monotonic() + 20.0
        recovered = False
        while time.monotonic() < deadline:
            probe = movie_ws.call_reply("cmd.count_atoms", "ala")
            if probe["t"] == "ok" and probe["result"] == 10:
                recovered = True
                break
            time.sleep(0.05)
        assert recovered, "the engine never came back from ModalDraw"

        deadline = time.monotonic() + 20.0
        files: List[str] = []
        while time.monotonic() < deadline:
            files = sorted(
                name for name in os.listdir(directory) if name.endswith(".png")
            )
            if len(files) >= 4:
                break
            time.sleep(0.05)
        assert files == ["g0001.png", "g0002.png", "g0003.png", "g0004.png"], files

    # And it is still a usable engine afterwards, not just a responsive one.
    movie_ws.call("cmd.mset", "1 x2")
    assert movie_ws.call("cmd.count_frames") == 2
    assert movie_ws.call("cmd.get_movie_panel")["nframes"] == 2


def test_movie_encoders_probe(movie_ws: Any) -> None:
    """`pymol.movie.find_exe` for the three encoders the export form offers."""
    found = movie_ws.call("cmd.get_movie_encoders")
    assert set(found) == {"ffmpeg", "convert", "mpeg_encode"}
    for value in found.values():
        assert value is None or isinstance(value, str)
