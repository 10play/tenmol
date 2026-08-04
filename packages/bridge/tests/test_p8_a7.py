"""Wave 8, area 7 — the movie/scene gaps wave 4 left open, closed on the engine.

Every claim here is MEASURED over the real WebSocket against the shared PyMOL,
because the rows these tests close all say the same thing: the feature was read
in the source and reproduced in the client, but never run.

What is new here, and why it needed an engine:

* the seven ``mview`` actions nobody had run — ``interpolate``,
  ``reinterpolate``, ``uninterpolate``, ``smooth``, ``reset``, ``toggle``,
  ``toggle_interp`` — plus ``purge``, which turns out to do NOTHING to the
  camera track (``packages/engine/layer1/Movie.cpp:1153-1367`` has no ``MViewAction::Purge``
  case at all; only ``ObjectMotion`` implements it, ``PyMOLObject.cpp:441``);
* the difference between ``interpolate`` and ``reinterpolate``, which is
  invisible in a spec-level array and obvious in the matrices;
* the full ``CViewElem`` payload — the 4x4 matrix, pre/post translations, clip
  planes, ortho, view_mode, power and bias — none of which any getter returned
  before ``cmd.get_movie_key_frames``;
* the seven legacy ``mdo`` generators and the five key-frame generators that
  had never been run;
* ``scene insert_before`` / ``insert_after`` / ``first``, and the two special
  recall keys ``*`` and ``''``.

ONE PYMOL PER PROCESS: the fixture saves and restores the camera, the movie,
the scene bin and every setting it writes.
"""

from __future__ import annotations

import math
import os
import shutil
import tempfile
from typing import Any, Dict, List

import pytest

from tenmol_bridge.panels import movie as movie_panel

BOOTSTRAP = "/import tenmol_bridge.panels.movie"

needs_ffmpeg = pytest.mark.skipif(
    not shutil.which("ffmpeg"), reason="ffmpeg not on PATH"
)

#: Settings these tests write.  Saved and restored per test, because the engine
#: is shared and ``movie_auto_interpolate`` in particular changes what every
#: other movie test sees.
_INT_SETTINGS = ("movie_auto_interpolate", "movie_loop", "sweep_mode")
_FLOAT_SETTINGS = ("movie_fps", "scene_animation_duration")


@pytest.fixture
def mws(ws: Any) -> Any:
    """A client with the movie panel installed and everything global restored."""
    reply = ws.request(t="call", fn="cmd.do", args=[BOOTSTRAP], kwargs={"echo": 0, "log": 0})
    assert reply["t"] == "ok", reply
    view = ws.call("cmd.get_view")
    ints = {name: ws.call("cmd.get_setting_int", name) for name in _INT_SETTINGS}
    floats = {name: ws.call("cmd.get_setting_float", name) for name in _FLOAT_SETTINGS}
    _reset(ws)
    yield ws
    _reset(ws)
    for name, value in ints.items():
        ws.call("cmd.set", name, value)
    for name, value in floats.items():
        ws.call("cmd.set", name, value)
    # animate=0: an animated set_view returns with the camera where it was and
    # sweeps afterwards, which on a GL-free pump never arrives.
    ws.call("cmd.set_view", view, 0)


def _reset(ws: Any) -> None:
    ws.call("cmd.mset")
    ws.call("cmd.delete", "all")
    for name in ws.call("cmd.get_scene_list") or []:
        ws.call("cmd.scene", name, "clear")
    assert ws.call("cmd.get_scene_list") == []


def _spec(ws: Any, obj: str = "") -> List[int]:
    """Per-frame ``specification_level`` of one motion track."""
    return [f["specLevel"] for f in ws.call("cmd.get_movie_key_frames", obj)["frames"]]


def _m0(ws: Any) -> List[float]:
    """``matrix[0]`` per frame — cos(rotation) for a pure y turn."""
    return [f["matrix"][0] for f in ws.call("cmd.get_movie_key_frames")["frames"]]


def _commands(ws: Any) -> List[str]:
    return [cell["command"] for cell in ws.call("cmd.get_movie_panel")["cells"]]


def _scene_ala(ws: Any) -> None:
    """A tiny object and a KNOWN camera, so the matrices below are reproducible."""
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.reset")


# --------------------------------------------------------------------------
# `mview` — the seven actions nobody had run, plus purge
# --------------------------------------------------------------------------


def test_interpolate_fills_the_gap_and_uninterpolate_takes_it_back(mws: Any) -> None:
    """``MViewAction`` 2 and 6 (``Movie.cpp:1212``, ``:1349``), on the engine.

    ``uninterpolate`` is the one that is easy to get backwards: it deletes
    every cell with ``specification_level < 2``, which is the interpolated
    ones, and leaves the keys alone.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_auto_interpolate", 0)
    ws.call("cmd.mset", "1 x10")

    ws.call("cmd.mview", "store", 1, object="none")
    ws.call("cmd.mview", "store", 10, object="none")
    assert _spec(ws) == [2, 0, 0, 0, 0, 0, 0, 0, 0, 2]

    ws.call("cmd.mview", "interpolate", object="none")
    assert _spec(ws) == [2, 1, 1, 1, 1, 1, 1, 1, 1, 2]

    ws.call("cmd.mview", "uninterpolate", object="none")
    assert _spec(ws) == [2, 0, 0, 0, 0, 0, 0, 0, 0, 2]

    ws.call("cmd.mview", "reinterpolate", object="none")
    assert _spec(ws) == [2, 1, 1, 1, 1, 1, 1, 1, 1, 2]


def test_interpolate_only_fills_gaps_where_reinterpolate_recomputes(mws: Any) -> None:
    """The difference between actions 2 and 3, which spec levels cannot show.

    ``Movie.cpp:1302-1313``: ``interpolate`` sets ``interpolate_flag`` only
    when some cell between two keys has ``specification_level == 0``;
    ``reinterpolate`` sets it unconditionally.  So after a track is already
    interpolated, moving a key and running ``interpolate`` leaves every
    in-between matrix STALE.

    MEASURED, keys at 1/5/9 with the camera turned 60 deg between each:
    frame 3's ``matrix[0]`` is cos(30) = 0.86603 after the first interpolate;
    re-storing key 1 with the camera turned a further 90 deg about x and
    running ``interpolate`` leaves frame 3 at 0.86603, while ``reinterpolate``
    moves it to 0.0.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_auto_interpolate", 0)
    ws.call("cmd.mset", "1 x9")

    ws.call("cmd.mview", "store", 1, object="none")
    ws.call("cmd.turn", "y", 60)
    ws.call("cmd.mview", "store", 5, object="none")
    ws.call("cmd.turn", "y", 60)
    ws.call("cmd.mview", "store", 9, object="none")
    ws.call("cmd.mview", "interpolate", object="none")

    interpolated = _m0(ws)
    assert interpolated[0] == pytest.approx(1.0, abs=1e-4)
    assert interpolated[4] == pytest.approx(math.cos(math.radians(60)), abs=1e-4)
    assert interpolated[8] == pytest.approx(math.cos(math.radians(120)), abs=1e-4)
    assert interpolated[2] == pytest.approx(math.cos(math.radians(30)), abs=1e-4)

    ws.call("cmd.turn", "x", 90)
    ws.call("cmd.mview", "store", 1, object="none")
    ws.call("cmd.mview", "interpolate", object="none")
    stale = _m0(ws)
    assert stale[0] == pytest.approx(-0.5, abs=1e-4)  # the new key DID land
    assert stale[2] == pytest.approx(interpolated[2], abs=1e-6)  # ... and nothing else moved

    ws.call("cmd.mview", "reinterpolate", object="none")
    fresh = _m0(ws)
    assert fresh[2] == pytest.approx(0.0, abs=1e-4)
    assert abs(fresh[2] - stale[2]) > 0.5


def test_smooth_rewrites_the_matrices_and_leaves_every_spec_level_alone(mws: Any) -> None:
    """``MViewAction::Smooth`` (``Movie.cpp:1129-1152``) — action 4.

    ``ViewElemSmooth`` runs a moving average over the range, ``cycles`` times.
    It is invisible in the timeline (no cell changes level) and very visible in
    the camera: with wrap on, MEASURED with window=5 over 9 frames, the key
    frame at 1 moves from matrix[0] = 1.0 to 0.32986, and the interpolated
    frame 2 from 0.98038 to 0.83811.  A smoothing pass that ignored the keys
    would leave 1.0 there, which is the bug this pins.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_auto_interpolate", 0)
    ws.call("cmd.mset", "1 x9")
    ws.call("cmd.mview", "store", 1, object="none")
    ws.call("cmd.turn", "y", 60)
    ws.call("cmd.mview", "store", 5, object="none")
    ws.call("cmd.turn", "y", 60)
    ws.call("cmd.mview", "store", 9, object="none")
    ws.call("cmd.mview", "interpolate", wrap=1, object="none")

    before = _m0(ws)
    ws.call("cmd.mview", "smooth", 1, 9, window=5, cycles=1, wrap=1, object="none")
    after = _m0(ws)

    assert _spec(ws) == [2, 1, 1, 1, 2, 1, 1, 1, 2]
    assert before[0] == pytest.approx(1.0, abs=1e-4)
    assert after[0] == pytest.approx(0.32986, abs=1e-4)
    assert before[1] == pytest.approx(0.98038, abs=1e-4)
    assert after[1] == pytest.approx(0.83811, abs=1e-4)


def test_toggle_flips_a_key_and_toggle_interp_flips_the_whole_track(mws: Any) -> None:
    """Actions 7 and 8 (``Movie.cpp:1100-1128``).

    ``toggle`` is per frame: level>1 becomes Clear, anything else becomes
    Store.  ``toggle_interp`` is per TRACK: on a key frame it becomes
    ``uninterpolate`` when ANY cell in the movie is interpolated, and
    ``reinterpolate`` otherwise — that scan over ``I->NFrame`` is the part a
    client-side reimplementation would miss.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_auto_interpolate", 0)
    ws.call("cmd.mset", "1 x10")
    ws.call("cmd.mview", "store", 1, object="none")
    ws.call("cmd.mview", "store", 10, object="none")
    ws.call("cmd.mview", "reinterpolate", object="none")

    ws.call("cmd.mview", "toggle", 5, object="none")
    assert _spec(ws) == [2, 1, 1, 1, 2, 1, 1, 1, 1, 2]
    ws.call("cmd.mview", "toggle", 5, object="none")
    # Clear zeroes the cell: it does NOT fall back to the interpolated level.
    assert _spec(ws) == [2, 1, 1, 1, 0, 1, 1, 1, 1, 2]

    ws.call("cmd.mview", "toggle_interp", 1, object="none")
    assert _spec(ws) == [2, 0, 0, 0, 0, 0, 0, 0, 0, 2]
    ws.call("cmd.mview", "toggle_interp", 1, object="none")
    assert _spec(ws) == [2, 1, 1, 1, 1, 1, 1, 1, 1, 2]


def test_reset_empties_every_cell_but_keeps_the_track(mws: Any) -> None:
    """Action 5 reallocates the VLA at the same size (``Movie.cpp:1343-1348``).

    The track survives — ``get_movie_panel`` still draws a camera row — which
    is exactly what makes it different from ``purge``.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.mset", "1 x10")
    ws.call("cmd.mview", "store", 1, object="none")
    ws.call("cmd.mview", "store", 10, object="none")
    assert max(_spec(ws)) == 2

    ws.call("cmd.mview", "reset", object="none")
    assert _spec(ws) == [0] * 10
    payload = ws.call("cmd.get_movie_key_frames")
    assert payload["track"] is True
    assert [row["label"] for row in ws.call("cmd.get_movie_panel")["rows"]] == ["camera"]


def test_purge_does_nothing_to_the_camera_and_frees_an_object_track(mws: Any) -> None:
    """Action 9 is implemented for OBJECTS ONLY — a real asymmetry.

    ``MovieView``'s switch (``Movie.cpp:1153-1367``) has cases for Store,
    Clear, Interpolate, Reinterpolate, Reset and Uninterpolate and **no**
    ``MViewAction::Purge``; ``ObjectMotion``'s switch does
    (``PyMOLObject.cpp:441-445``, ``VLAFreeP(I->ViewElem)``).  So
    ``cmd.mview('purge')`` reports success either way and only the object row
    disappears.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.mset", "1 x10")
    ws.call("cmd.mview", "store", 1, object="none")
    ws.call("cmd.mview", "store", 1, object="ala")
    ws.call("cmd.mview", "store", 6, object="ala")
    assert _spec(ws, "ala")[0] == 2
    assert [row["label"] for row in ws.call("cmd.get_movie_panel")["rows"]] == ["camera", "ala"]

    camera_before = _spec(ws)
    assert ws.call_reply("cmd.mview", "purge", object="none")["t"] == "ok"
    assert _spec(ws) == camera_before  # the camera track is untouched

    ws.call("cmd.mview", "purge", object="ala")
    assert ws.call("cmd.get_movie_key_frames", "ala")["track"] is False
    assert [row["label"] for row in ws.call("cmd.get_movie_panel")["rows"]] == ["camera"]


# --------------------------------------------------------------------------
# the full CViewElem payload
# --------------------------------------------------------------------------


def test_key_frame_payload_decodes_a_synthetic_element_without_an_engine() -> None:
    """The slot map, pinned once, off the engine."""
    element: List[Any] = [0] * movie_panel.VE_LENGTH
    element[movie_panel.VE_MATRIX_FLAG] = 1
    element[movie_panel.VE_MATRIX] = [float(i) for i in range(16)]
    element[movie_panel.VE_PRE_FLAG] = 1
    element[movie_panel.VE_PRE] = [1.0, 2.0, 3.0]
    element[movie_panel.VE_POST_FLAG] = 1
    element[movie_panel.VE_POST] = [4.0, 5.0, 6.0]
    element[movie_panel.VE_CLIP_FLAG] = 1
    element[movie_panel.VE_FRONT] = 40.0
    element[movie_panel.VE_BACK] = 100.0
    element[movie_panel.VE_ORTHO_FLAG] = 1
    element[movie_panel.VE_ORTHO] = -20.0
    element[movie_panel.VE_VIEW_MODE] = 1
    element[movie_panel.VE_SPEC_LEVEL] = 2
    element[movie_panel.VE_POWER_FLAG] = 1
    element[movie_panel.VE_POWER] = -1.0
    element[movie_panel.VE_BIAS_FLAG] = 1
    element[movie_panel.VE_BIAS] = 2.0
    element[movie_panel.VE_STATE_FLAG] = 1
    element[movie_panel.VE_STATE] = 2

    payload = movie_panel.key_frame_payload(element)
    assert payload["matrix"] == [float(i) for i in range(16)]
    assert payload["pre"] == [1.0, 2.0, 3.0]
    assert payload["post"] == [4.0, 5.0, 6.0]
    assert (payload["front"], payload["back"]) == (40.0, 100.0)
    assert payload["ortho"] == -20.0
    assert payload["viewMode"] == 1
    assert (payload["power"], payload["bias"]) == (-1.0, 2.0)
    assert payload["state"] == 2
    assert movie_panel.key_frame_payload(None) == {"specLevel": 0, "present": False}


def test_view_elem_has_21_slots_and_none_of_them_is_timing(mws: Any, bridge: Any) -> None:
    """``PyList_New(21)`` (``View.cpp:348``) — ``timing`` has no slot.

    ``CViewElem`` declares ``timing_flag``/``timing`` (``View.h:50-51``) and
    ``ViewElemAsPyList`` never writes them, so no getter built on
    ``get_session`` can expose them and there is no other structured readout of
    a ``CViewElem`` in the tree.  This asserts the LENGTH against the live
    engine so an upstream merge that adds the slot fails here instead of
    silently shifting every index in ``panels/movie.py``.

    The length is read by PRINTING it: ``cmd.get_session``'s return value does
    not survive the wire (the reply this call produces has no ``movie`` key at
    all — the codec drops what it cannot encode), so the only honest place to
    measure it is inside the engine.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.mset", "1 x3")
    ws.call("cmd.mview", "store", 1, object="none")

    tag = "P8VELEN"
    ws.do(
        "print('%s', len(cmd.get_session(partial=0,quiet=1,cache=0,version=0)"
        "['movie'][%d][0]))" % (tag, movie_panel.MV_VIEWELEM)
    )
    lines = bridge.wait_for_feedback(tag, timeout=5.0)
    # SKIP THE ECHO: PyMOL prints the command back before running it.
    values = [
        int(line.split(tag, 1)[1].strip())
        for line in lines
        if tag in line and "print(" not in line
    ]
    assert values and values[0] == movie_panel.VE_LENGTH == 21
    assert ws.call("cmd.get_movie_key_frames")["timingExposed"] is False


def test_key_frames_expose_the_whole_view_elem(mws: Any) -> None:
    """The row's payload list, field by field, off a real stored key frame.

    MEASURED on a freshly ``cmd.reset`` camera: matrix = identity,
    pre = (0, 0, -distance), post = -origin, live clip planes, a negative
    ortho and view_mode 0 (relative).

    Two upstream serialisation bugs are pinned as behaviour, not repaired:
    slot 16 (``power``) is written whenever ``ortho_flag`` is set rather than
    ``power_flag`` (``View.cpp:404``), so ``power`` reads 0.0 with
    ``powerFlag`` false; ``bias`` — guarded correctly — reads None instead.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_auto_interpolate", 0)
    ws.call("cmd.mset", "1 x5")
    ws.call("cmd.mview", "store", 2, power=-1.0, bias=2.0, state=3, object="none")

    frame = ws.call("cmd.get_movie_key_frames", "", 2, 2)["frames"][0]
    assert frame["frame"] == 2 and frame["specLevel"] == 2
    assert frame["matrixFlag"] is True
    assert frame["matrix"] == pytest.approx(
        [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0], abs=1e-5
    )
    assert frame["preFlag"] is True and len(frame["pre"]) == 3
    assert frame["pre"][2] < 0.0  # -distance
    assert frame["postFlag"] is True and len(frame["post"]) == 3
    assert frame["clipFlag"] is True
    # The clip planes are the LIVE ones `cmd.reset` computed for this object,
    # not the 40/100 defaults: measured 11.18 / 39.31 on `ala`.
    assert 0.0 < frame["front"] < frame["back"]
    assert frame["orthoFlag"] is True and frame["ortho"] < 0.0
    assert frame["viewMode"] == 0
    assert frame["powerFlag"] is True and frame["power"] == pytest.approx(-1.0)
    assert frame["biasFlag"] is True and frame["bias"] == pytest.approx(2.0)
    # `moving.py:228` sends `state - 1`, and the C stores that 0-based value.
    assert frame["stateFlag"] is True and frame["state"] == 2

    # An unstored frame of an ALLOCATED track still serialises — 21 zeroed
    # slots — so `present` stays true and every flag is false.  `present` is
    # false only when the track itself is gone (see the purge test).
    plain = ws.call("cmd.get_movie_key_frames", "", 1, 1)["frames"][0]
    assert plain["present"] is True and plain["specLevel"] == 0
    assert plain["matrixFlag"] is False and plain["matrix"] is None

    ws.call("cmd.mview", "store", 4, object="none")
    unset = ws.call("cmd.get_movie_key_frames", "", 4, 4)["frames"][0]
    assert unset["powerFlag"] is False and unset["power"] == 0.0  # View.cpp:404 bug
    assert unset["biasFlag"] is False and unset["bias"] is None


def test_key_frames_carry_the_scene_name_of_a_scene_pinned_key(mws: Any) -> None:
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_auto_interpolate", 0)
    ws.call("cmd.mset", "1 x5")
    ws.call("cmd.scene", "SX", "store")
    ws.call("cmd.mview", "store", 3, scene="SX", object="none")

    frame = ws.call("cmd.get_movie_key_frames", "", 3, 3)["frames"][0]
    assert frame["sceneFlag"] is True and frame["scene"] == "SX"
    other = ws.call("cmd.get_movie_key_frames", "", 1, 1)["frames"][0]
    assert other["specLevel"] == 0


# --------------------------------------------------------------------------
# `pymol.movie` — the legacy mdo generators
# --------------------------------------------------------------------------


def test_sweep_and_pause_build_state_sequences_not_key_frames(mws: Any) -> None:
    """``movie.sweep`` (:32) and ``movie.pause`` (:44) write an mset string.

    MEASURED with a 3-state object: ``sweep`` gives 1 2 3 3 2 1 and ``pause``
    with pause=2 gives 1 1 1 2 3 3 3 — the ``x2`` runs at both ends.  Neither
    touches the camera track, which is the whole difference between these and
    the ``add_*`` family.
    """
    ws = mws
    ws.call("cmd.fragment", "ala")
    for state in (1, 2, 3):
        ws.call("cmd.create", "multi", "ala", 1, state)
    ws.call("cmd.delete", "ala")
    assert ws.call("cmd.count_states", "all") == 3

    ws.call("cmd.movie.sweep", 0, 1)
    assert ws.call("cmd.count_frames") == 6
    assert [c["state"] for c in ws.call("cmd.get_movie_panel")["cells"]] == [1, 2, 3, 3, 2, 1]

    ws.call("cmd.movie.pause", 2, 1)
    assert ws.call("cmd.count_frames") == 7
    assert [c["state"] for c in ws.call("cmd.get_movie_panel")["cells"]] == [1, 1, 1, 2, 3, 3, 3]
    # No key frames anywhere: these two write the STATE sequence only.  (The
    # camera VLA itself survives a `mset` — `MovieView` has no way to free it,
    # see `test_purge_...` — so the claim is about the levels, not the track.)
    assert _spec(ws) == [0] * 7


def test_zoom_screw_and_tdroll_write_per_frame_mdo_commands(mws: Any) -> None:
    """``movie.zoom`` (:167), ``movie.screw`` (:214), ``movie.tdroll`` (:118).

    The strings are the product: they are what ``cmd.mdo`` stores and what the
    movie panel shows in each cell.  ``zoom`` reverses at the halfway point
    when ``loop=1`` — MEASURED as three ``move z, 2.000`` then three
    ``move z, -2.000``.  ``tdroll`` fills only as many frames as the range
    needs (90 deg at 45 deg per frame = 2), leaving the rest empty.
    """
    ws = mws
    _scene_ala(ws)

    ws.call("cmd.mset", "1 x6")
    ws.call("cmd.movie.zoom", 1, 6, 2, 1, "z")
    assert _commands(ws) == [
        "move z,   2.000",
        "move z,   2.000",
        "move z,   2.000",
        "move z,  -2.000",
        "move z,  -2.000",
        "move z,  -2.000",
    ]

    ws.call("cmd.mset", "1 x6")
    ws.call("cmd.movie.screw", 1, 6, 1, 30, 0, 1, "y")
    screw = _commands(ws)
    assert screw[0] == "turn y,  12.990; move z,   1.000"
    assert screw[3] == "turn y, -12.990; move z,  -1.000"

    ws.call("cmd.mset", "1 x8")
    ws.call("cmd.movie.tdroll", 1, 90, 0, 0, 45)
    assert _commands(ws) == ["turn x,  45.000", "turn x,  45.000", "", "", "", "", "", ""]


def test_timed_roll_builds_a_key_frame_per_frame_from_movie_fps(mws: Any) -> None:
    """``movie.timed_roll`` (:247) is the odd one out of the legacy family.

    It is mdo-era code that nevertheless uses ``mview store``: ``mset 1 xN``
    with N = int(period * movie_fps), then one ``turn`` + ``mview store`` per
    frame with ``freeze=1``.  MEASURED at fps=30, period=0.1: 3 frames, every
    one a KEY.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_fps", 30)
    ws.call("cmd.movie.timed_roll", 0.1, 1, "y")
    assert ws.call("cmd.count_frames") == 3
    assert _spec(ws) == [2, 2, 2]


def test_movie_load_globs_a_pattern_into_one_multi_state_object(mws: Any) -> None:
    """``movie.load`` (:56) — ``glob`` + one ``cmd.load`` per match, sorted."""
    ws = mws
    ws.call("cmd.fragment", "ala")
    with tempfile.TemporaryDirectory() as tmp:
        for i in (1, 2, 3):
            ws.call("cmd.save", os.path.join(tmp, "f%d.pdb" % i), "ala")
        ws.call("cmd.delete", "ala")
        ws.call("cmd.movie.load", os.path.join(tmp, "f*.pdb"), "mov")
    assert ws.call("cmd.get_names") == ["mov"]
    assert ws.call("cmd.count_states", "mov") == 3


# --------------------------------------------------------------------------
# `pymol.movie` — the key-frame generators
# --------------------------------------------------------------------------


def test_add_blank_adds_frames_and_deliberately_no_keys(mws: Any) -> None:
    """``movie.add_blank`` (:268) — ``mset 1 xN`` at ``start``, nothing else."""
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_fps", 30)
    ws.call("cmd.movie.add_blank", 0.2, 0)
    assert ws.call("cmd.count_frames") == 6
    assert ws.call("cmd.get_movie_length") == 6
    assert _spec(ws) == [0] * 6
    assert ws.call("cmd.get_frame") == 1


def test_add_rock_stores_two_keys_at_the_quarter_marks_with_power_minus_one(mws: Any) -> None:
    """``movie.add_rock`` (:346).

    Keys at ``start + n/4`` and ``start + 3n/4`` with ``power=-1``, then one
    ``interpolate`` — with ``wrap=1`` because ``start == 1``.  MEASURED at
    fps=30, duration=0.4: 12 frames, keys at 4 and 10, and every cell carries
    power -1 because ``ViewElemInterpolate`` copies it into the in-betweens.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_fps", 30)
    ws.call("cmd.movie.add_rock", 0.4, 30.0, 1, "y", 0)
    assert ws.call("cmd.count_frames") == 12
    assert _spec(ws) == [1, 1, 1, 2, 1, 1, 1, 1, 1, 2, 1, 1]
    powers = [f["power"] for f in ws.call("cmd.get_movie_key_frames")["frames"]]
    assert powers == [-1.0] * 12


def test_add_state_sweep_and_add_state_loop_write_state_key_frames(mws: Any) -> None:
    """``movie.add_state_sweep`` (:384) and ``add_state_loop`` (:409).

    Both store ``state=`` key frames rather than camera motion.  MEASURED on a
    3-state object at fps=30 with pause=0.1: the sweep is 5 keys running
    1 -> 3 -> 1 over 12 frames, the loop is 4 keys running 1 -> 3 over 6.
    The states come back 0-BASED, because ``moving.py:228`` sends ``state-1``.
    """
    ws = mws
    ws.call("cmd.fragment", "ala")
    for state in (1, 2, 3):
        ws.call("cmd.create", "multi", "ala", 1, state)
    ws.call("cmd.delete", "ala")
    ws.call("cmd.set", "movie_fps", 30)

    ws.call("cmd.movie.add_state_sweep", 1, 0.1, -1, -1, 1, 0)
    assert ws.call("cmd.count_frames") == 12
    assert _spec(ws) == [2, 1, 1, 2, 1, 2, 1, 1, 1, 2, 1, 2]
    sweep_states = [f["state"] for f in ws.call("cmd.get_movie_key_frames")["frames"]]
    assert sweep_states == [0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 1, 0]

    ws.call("cmd.mset")
    ws.call("cmd.movie.add_state_loop", 1, 0.1, -1, -1, 1, 0)
    assert ws.call("cmd.count_frames") == 6
    assert _spec(ws) == [2, 2, 1, 1, 2, 2]
    assert [f["state"] for f in ws.call("cmd.get_movie_key_frames")["frames"]] == [0, 0, 1, 1, 2, 2]


def test_add_scenes_pins_every_scene_and_sweep_mode_3_stores_every_frame(mws: Any) -> None:
    """``movie.add_scenes`` (:562) — the generator with the most moving parts.

    With ``rock=0`` it stores one key per scene and interpolates with
    ``cut``/``wrap``; MEASURED with 2 scenes, pause=0.2 s, animate=0 at fps 30:
    12 frames, keys at 1 and 7, and the scene name of every INTERPOLATED cell
    is the one it is heading to, because ``cut=0.0`` switches at the start of
    the transition.  With ``sweep_mode=3`` (nutate) the ``_nutate`` helper
    stores EVERY frame instead (``movie.py:543``).
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.set", "movie_fps", 30)
    ws.call("cmd.set", "scene_animation_duration", 0.0)
    ws.call("cmd.scene", "S1", "store")
    ws.call("cmd.turn", "y", 45)
    ws.call("cmd.scene", "S2", "store")
    assert ws.call("cmd.get_scene_list") == ["S1", "S2"]

    ws.call("cmd.movie.add_scenes", None, 0.2, 0.0, 1, 0, 0.1, 0.0, 0)
    assert ws.call("cmd.count_frames") == 12
    assert _spec(ws) == [2, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1]
    scenes = [f["scene"] for f in ws.call("cmd.get_movie_key_frames")["frames"]]
    assert scenes[0] == "S1" and scenes[6] == "S2"
    assert scenes == ["S1"] + ["S2"] * 6 + ["S1"] * 5

    ws.call("cmd.mset")
    ws.call("cmd.set", "sweep_mode", 3)
    ws.call("cmd.movie.add_scenes", None, 0.2, 0.0, 1, -1, 0.1, 0.0, 0)
    assert ws.call("cmd.count_frames") == 12
    assert _spec(ws).count(2) == 10


# --------------------------------------------------------------------------
# `cmd.scene` — the actions wave 4 left out
# --------------------------------------------------------------------------


def test_insert_before_and_insert_after_place_the_new_scene_around_the_current(
    mws: Any,
) -> None:
    """``MovieSceneOrderBeforeAfter`` (``MovieScene.cpp:733``).

    Both are a ``store`` followed by a reorder relative to
    ``scene_current_name`` — so the RECALL is what decides where the new scene
    lands, and a client that stores without recalling first inserts in the
    wrong place.

    MEASURED DIVERGENCE, and the reason this is a test and not a reading:
    ``insert_before`` the FIRST scene is BROKEN upstream.  It takes the
    ``location='top'`` branch (``MovieScene.cpp:739``), which sets ``key=""``
    and then calls ``MovieSceneOrder({"", current}, false, "top")`` — the empty
    name makes the reorder fail, so the new scene stays where ``store`` put it,
    at the END.  A UI that trusts the action would show the new scene jumping
    to the bottom of the list.
    """
    ws = mws
    _scene_ala(ws)
    for name in ("A", "B", "C"):
        ws.call("cmd.scene", name, "store")
    assert ws.call("cmd.get_scene_list") == ["A", "B", "C"]

    ws.call("cmd.scene", "A", "recall", animate=0)
    ws.call("cmd.scene", "X", "insert_after")
    assert ws.call("cmd.get_scene_list") == ["A", "X", "B", "C"]

    ws.call("cmd.scene", "B", "recall", animate=0)
    ws.call("cmd.scene", "Y", "insert_before")
    assert ws.call("cmd.get_scene_list") == ["A", "X", "Y", "B", "C"]

    ws.call("cmd.scene", "A", "recall", animate=0)
    ws.call("cmd.scene", "Z", "insert_before")
    assert ws.call("cmd.get_scene_list") == ["A", "X", "Y", "B", "C", "Z"]


def test_first_moves_a_scene_to_the_top_of_the_order(mws: Any) -> None:
    """``action='first'`` is ``MovieSceneOrder(key, false, "top")`` (:824)."""
    ws = mws
    _scene_ala(ws)
    for name in ("A", "B", "C"):
        ws.call("cmd.scene", name, "store")
    ws.call("cmd.scene", "C", "first")
    assert ws.call("cmd.get_scene_list") == ["C", "A", "B"]
    ws.call("cmd.scene", "B", "first")
    assert ws.call("cmd.get_scene_list") == ["B", "C", "A"]


def test_recall_star_prints_the_order_and_recall_blank_disables_everything(mws: Any) -> None:
    """The two special recall keys (``MovieScene.cpp:796-804``).

    ``*`` prints the order and returns without touching the scene; ``''``
    blanks the screen — ``scene_current_name`` is cleared and
    ``ExecutiveSetObjVisib('*', false)`` disables every object.
    """
    ws = mws
    _scene_ala(ws)
    for name in ("A", "B"):
        ws.call("cmd.scene", name, "store")
    assert ws.call("cmd.get_names", "public_objects", 1) == ["ala"]

    ws.call("cmd.scene", "A", "recall", animate=0)
    assert ws.call_reply("cmd.scene", "*", "recall")["t"] == "ok"
    assert ws.call("cmd.get", "scene_current_name") == "A"

    ws.call("cmd.scene", "", "recall", animate=0)
    assert ws.call("cmd.get", "scene_current_name") == ""
    assert ws.call("cmd.get_names", "public_objects", 1) == []


def test_next_past_the_end_blanks_the_screen_unless_scene_loop_is_set(mws: Any) -> None:
    """``MovieSceneGetNextKey`` (``MovieScene.cpp:699``) returns ``""``.

    And an empty key is not "do nothing" — it falls into the blank-screen
    branch of ``recall``, so with ``scene_loop`` off, Next on the last scene
    DISABLES EVERY OBJECT.  MEASURED: ``scene_current_name`` goes to ``''`` and
    ``get_names('public_objects', 1)`` to ``[]``; with ``scene_loop`` on the
    same call wraps to the first scene instead.

    This is also the gate in front of the presentation auto-quit chain
    (``viewing.py:1152-1176``: ``presentation`` + ``presentation_auto_quit`` +
    a next key that came back empty -> load the next numbered session file, or
    ``cmd.quit()``).  That branch is deliberately NOT executed here — it would
    end the process every other test in this run shares.
    """
    ws = mws
    loop = ws.call("cmd.get_setting_int", "scene_loop")
    try:
        _scene_ala(ws)
        for name in ("A", "B"):
            ws.call("cmd.scene", name, "store")
        assert ws.call("cmd.get_names", "public_objects", 1) == ["ala"]

        ws.call("cmd.set", "scene_loop", 0)
        ws.call("cmd.scene", "B", "recall", animate=0)
        ws.call("cmd.scene", "auto", "next", animate=0)
        assert ws.call("cmd.get", "scene_current_name") == ""
        assert ws.call("cmd.get_names", "public_objects", 1) == []

        ws.call("cmd.set", "scene_loop", 1)
        ws.call("cmd.scene", "B", "recall", animate=0)
        ws.call("cmd.scene", "auto", "next", animate=0)
        assert ws.call("cmd.get", "scene_current_name") == "A"

        # Presentation is off, which is what keeps the auto-quit chain shut.
        assert ws.call("cmd.get_setting_boolean", "presentation") is False
    finally:
        ws.call("cmd.set", "scene_loop", loop)


# --------------------------------------------------------------------------
# the export dialog's encoded formats, end to end
# --------------------------------------------------------------------------


@needs_ffmpeg
def test_the_dialogs_mov_and_gif_requests_really_encode(mws: Any, gl_bridge: Any) -> None:
    """``.mov`` and ``.gif`` through ``cmd.movie_produce``, byte-checked.

    These are the exact kwargs ``ExportDialog.doExport`` sends —
    ``mode='ray'`` when the ray box is ticked, an explicit ``encoder``, and the
    width/height from the form — so what runs here is what the button runs.
    The mp4 half of the same path is pinned by ``test_wf_movieverify.py``
    (a real 200x150 h264); this covers the two containers that behave
    differently:

    * ``.mov`` IS in ``EVEN_EXTENSIONS``, so an odd height is forced even;
    * ``.gif`` is NOT, and takes the two-pass palette branch
      (``movie.py:_encode``), which is the one that runs ffmpeg twice.

    The result is checked by MAGIC BYTES rather than by ``ok``: ``ok`` is
    computed from the file size, and a 0-byte container would still be a file.
    """
    ws = mws
    _scene_ala(ws)
    ws.call("cmd.mset", "1 x2")
    saved = {
        name: ws.call("cmd.get_setting_int", name)
        for name in ("opaque_background", "keep_alive", "movie_quality")
    }
    cwd = os.getcwd()
    try:
        with tempfile.TemporaryDirectory(prefix="tenmol-p8a7") as directory:
            mov = ws.call(
                "cmd.movie_produce", os.path.join(directory, "frame.mov"),
                mode="ray", encoder="ffmpeg", quality=80,
                width=64, height=49, quiet=1, timeout=300,
            )
            assert mov["encoder"] == "ffmpeg"
            # `.mov` is even-forced (`EVEN_EXTENSIONS`), 49 -> 48.
            assert (mov["width"], mov["height"]) == (64, 48)
            assert mov["ok"] is True and mov["bytes"] > 0, mov
            with open(mov["filename"], "rb") as handle:
                head = handle.read(12)
            assert head[4:8] == b"ftyp", head  # a real QuickTime/ISO container

            gif = ws.call(
                "cmd.movie_produce", os.path.join(directory, "frame.gif"),
                mode="ray", encoder="ffmpeg", quality=80,
                width=64, height=48, quiet=1, timeout=300,
            )
            assert gif["twoPassPalette"] is True
            assert gif["ok"] is True and gif["bytes"] > 0, gif
            with open(gif["filename"], "rb") as handle:
                assert handle.read(6) in (b"GIF87a", b"GIF89a")
    finally:
        for name, value in saved.items():
            ws.call("cmd.set", name, value)
        # `_encode` chdirs for the duration (`movie.py:748,763`).
        assert os.getcwd() == cwd
    assert ws.call("cmd.get_modal_draw") == 0


# --------------------------------------------------------------------------
# the F-key scene bindings
# --------------------------------------------------------------------------


def test_f_keys_recall_scenes_through_the_special_key_fallback(mws: Any) -> None:
    """Nothing "binds" F1..F12 — ``_special`` looks them up in the scene list.

    ``packages/engine/modules/pymol/internal.py:447-483``: a special key with no explicit
    ``set_key`` mapping falls through to a ``Shortcut`` over
    ``cmd.get_scene_list()`` and then over the view dict, and calls
    ``cmd.scene(key)`` — a RECALL — when the name matches.  So the whole
    "F-key scene bindings" feature is a naming convention plus that fallback,
    and a client only has to deliver the GLUT special code.

    The two hops in front of this one are already pinned elsewhere:
    ``packages/viewport/src/input/keys.ts``'s ``specialMap`` is asserted equal
    to ``keymapping.py``'s by ``packages/bridge/tests/test_key_translation.py``, and
    ``cmd._special(4, 0, 0)`` is proven to fire an F4 binding by
    ``packages/bridge/tests/test_key_bindings.py``.  This is the last hop.

    ``cmd.key_mappings`` IS PROCESS-GLOBAL AND LEAKY: the filter wizard binds
    F1/F2/F3 and its ``cleanup()`` calls ``set_key('F1', None)``, which unbinds
    nothing in this build (measured and documented in
    ``packages/bridge/tests/test_p8_a8.py:1451``).  A leftover F1 binding SHADOWS the
    scene fallback completely — ``_invoke_key`` returns True and ``_special``
    returns before it ever looks at the scene list — so this test pops the
    three entries it needs, restores them, and asserts the shadowing itself.
    """
    ws = mws
    _scene_ala(ws)
    ws.do(
        "import pymol; pymol._p8a7_keys = "
        "{k: cmd.key_mappings.pop(k, None) for k in ('F1', 'F2', 'F3')}"
    )
    try:
        for name in ("F1", "F2"):
            ws.call("cmd.scene", name, "store")
        ws.call("cmd.scene", "F2", "recall", animate=0)
        assert ws.call("cmd.get", "scene_current_name") == "F2"

        # GLUT special code 1 is F1 (`internal.special_key_codes`).
        assert ws.call_reply("cmd._special", 1, 0, 0)["t"] == "ok"
        assert ws.call("cmd.get", "scene_current_name") == "F1"

        assert ws.call_reply("cmd._special", 2, 0, 0)["t"] == "ok"
        assert ws.call("cmd.get", "scene_current_name") == "F2"

        # A code with no scene behind it changes nothing.
        assert ws.call_reply("cmd._special", 3, 0, 0)["t"] == "ok"
        assert ws.call("cmd.get", "scene_current_name") == "F2"

        # And through the ENTRY POINT the web client actually uses:
        # `KeyboardService.tsx:74-86` sends `{t:'input', kind:'button',
        # button:k, state:-2}` for anything in `specialMap`
        # (`keymapping.py:61-97`; state -2 is the PyMOL_Special branch).
        # MEASURED: the recall lands on the dispatcher's own `tick_after`, with
        # no draw needed — unlike a mouse drag.
        assert ws.input("button", button=1, state=-2, x=0, y=0, mod=0)["t"] == "ok"
        assert ws.call("cmd.get", "scene_current_name") == "F1"

        # An explicit binding wins: the scene fallback is never reached.
        ws.call("cmd.scene", "F2", "recall", animate=0)
        ws.call("cmd.set_key", "F1", "print('P8A7 F1 mapping ran')")
        assert ws.call_reply("cmd._special", 1, 0, 0)["t"] == "ok"
        assert ws.call("cmd.get", "scene_current_name") == "F2"
    finally:
        ws.do(
            "import pymol; cmd.key_mappings.pop('F1', None); "
            "cmd.key_mappings.update("
            "{k: v for k, v in pymol._p8a7_keys.items() if v is not None})"
        )
