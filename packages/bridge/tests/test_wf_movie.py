"""Movie export (``movie.produce``) and the movie timeline panel.

Three inventory rows, all of them about machinery that has no getter:

``00:326``  ``movie.produce`` — the encoder table, the frame format, the even
            dimensions, and the fact that upstream ``produce`` leaves the
            engine raising ``APIEnterNotModal`` behind it.
``00:104``  the timeline panel: ``ExecutiveCountMotions`` rows, the ``camera`` /
            object / ``states`` gutter labels, the 64 px label indent,
            presentation mode.
``00:105``  the panel's mouse grammar — specifically the ``object=`` argument,
            which is the only difference between "move the camera key" and
            "move every key in the movie".

WHAT IS *OBSERVED* HERE, not read out of the C or the Python:

* the produced files, through ``ffprobe`` — codec, pixel format and the exact
  frame size, which is the only way to prove the odd-dimension clamp happened;
* ``palette.png`` sitting in the preserved temp directory, which is the only
  externally visible trace of ffmpeg's two-pass GIF;
* ``mov%04d.ppm`` frames for the mpeg_encode path;
* ``cmd.get_modal_draw()`` and a real ``APIEnterNotModal`` error immediately
  after ``cmd.movie.produce``, and their absence after ``cmd.movie_produce``;
* the per-row spec levels before and after each gesture command, which is how
  ``object='none'`` vs ``object=''`` is told apart.

SHARED-PROCESS DISCIPLINE.  ``produce`` writes THREE global settings that no
other test would expect to change (``opaque_background`` on, ``keep_alive`` on
for the duration, and the frame ``mset`` program), the panel tests write
``presentation`` — which ``test_sessions.py`` asserts is ``off`` — and the
gesture tests write ``movie_panel_row_height``.  The fixture saves and restores
every one of them.  ``_encode`` additionally ``os.chdir``s the whole process for
the duration of the encode (``packages/engine/modules/pymol/movie.py:748,763``); the tests that
let that run on a background thread wait for it to finish before returning, and
assert the cwd came back.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from typing import Any, Dict, List, Optional

import pytest

from tenmol_bridge.panels import movie as movie_panel

BOOTSTRAP = "/import tenmol_bridge.panels.movie"

HAVE_FFMPEG = bool(shutil.which("ffmpeg"))
HAVE_FFPROBE = bool(shutil.which("ffprobe"))
HAVE_CONVERT = bool(shutil.which("convert"))
HAVE_MPEG_ENCODE = bool(shutil.which("mpeg_encode"))

needs_ffmpeg = pytest.mark.skipif(
    not (HAVE_FFMPEG and HAVE_FFPROBE), reason="ffmpeg/ffprobe not on PATH"
)

#: Settings that leak out of this file if they are not put back.  ``keep_alive``
#: is in the list because a ``produce`` that raises before ``_encode`` runs
#: never reaches the ``unset`` at ``movie.py:811``.
_SAVED_INT = (
    "presentation",
    "movie_panel",
    "movie_panel_row_height",
    "opaque_background",
    "ray_trace_frames",
    "movie_quality",
    "keep_alive",
)


@pytest.fixture
def mws(ws: Any):
    reply = ws.request(t="call", fn="cmd.do", args=[BOOTSTRAP], kwargs={"echo": 0, "log": 0})
    assert reply["t"] == "ok", reply
    saved: Dict[str, Any] = {name: ws.call("cmd.get_setting_int", name) for name in _SAVED_INT}
    saved_fps = ws.call("cmd.get_setting_float", "movie_fps")
    cwd = os.getcwd()
    _clean(ws)
    try:
        yield ws
    finally:
        _clean(ws)
        for name, value in saved.items():
            ws.call("cmd.set", name, value)
        ws.call("cmd.set", "movie_fps", saved_fps)
        # `_encode` chdirs the process (movie.py:748/763) and restores it in a
        # `finally`; if a test ever leaves it moved, every relative path in the
        # rest of the suite is wrong, so put it back loudly rather than never.
        assert os.getcwd() == cwd, "movie encoding left the process in %s" % os.getcwd()


def _clean(ws: Any) -> None:
    ws.call("cmd.mset")
    ws.call("cmd.delete", "all")
    ws.call("cmd.frame", 1)


def _ffprobe(path: str) -> Dict[str, Any]:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,codec_name,pix_fmt,nb_frames",
            "-of", "json", path,
        ],
        capture_output=True,
        text=True,
    )
    streams = json.loads(out.stdout or "{}").get("streams") or [{}]
    return streams[0]


def _movie(ws: Any, frames: int = 4) -> None:
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.mset", "1 x%d" % frames)


def _rows(ws: Any) -> Dict[str, List[int]]:
    panel = ws.call("cmd.get_movie_panel")
    return {row["object"]: row["spec"] for row in panel["rows"]}


def _wait_gone(path: str, timeout: float = 180.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not os.path.exists(path):
            return True
        time.sleep(0.1)
    return False


# ==========================================================================
# 00:326 -- movie export, `movie.produce`
# ==========================================================================


def test_produce_plan_matches_movie_py_decisions(mws: Any) -> None:
    """Every branch of ``produce``'s 45-line preamble, reported instead of printed.

    ``movie.produce`` returns ``DEFAULT_SUCCESS`` (``None``) and prints; a
    browser form cannot grey out a format or show a resolved size from that.
    ``cmd.get_movie_produce_plan`` re-runs the same arithmetic and hands it back.
    """
    _movie(mws)

    mp4 = mws.call("cmd.get_movie_produce_plan", "/tmp/tenmol-plan.mp4", width=161, height=121)
    assert mp4["ext"] == ".mp4"
    assert mp4["tmpdir"] == "/tmp/tenmol-plan.tmp"
    assert mp4["frameGlob"] == "mov%04d.png"
    # `movie.py:948-951`: mp4/mov/webm are forced even, and the clamp is a
    # DECREMENT, never a round -- 161 becomes 160, not 162.
    assert (mp4["width"], mp4["height"]) == (160, 120)
    if HAVE_FFMPEG:
        assert mp4["encoder"] == "ffmpeg"
        assert mp4["encoderGuessed"] is True
        assert mp4["available"] is True

    # No extension at all -> `.mpg` -> mpeg_encode -> `.ppm` frames (`:908`).
    noext = mws.call("cmd.get_movie_produce_plan", "/tmp/tenmol-plan")
    assert noext["filename"] == "/tmp/tenmol-plan.mpg"
    assert noext["encoder"] == "mpeg_encode"
    assert noext["frameGlob"] == "mov%04d.ppm"
    assert noext["available"] is HAVE_MPEG_ENCODE

    # `.mpg` never falls back to ffmpeg even when ffmpeg is right there.
    assert mws.call("cmd.get_movie_produce_plan", "/tmp/t.mpeg")["encoder"] == "mpeg_encode"

    # Dimensions are left alone for the formats that do not need macroblocks.
    gif = mws.call("cmd.get_movie_produce_plan", "/tmp/t.gif", width=161, height=121)
    assert (gif["width"], gif["height"]) == (161, 121)
    assert gif["twoPassPalette"] is HAVE_FFMPEG

    # `_encode:783` -- crf 10/15/20 by quality; `:779` -- webm is 65-quality/2.
    def crf(name: str, quality: int) -> str:
        return mws.call("cmd.get_movie_produce_plan", name, quality=quality)["crf"]

    assert (crf("/tmp/t.mp4", 100), crf("/tmp/t.mp4", 91)) == ("10", "10")
    assert (crf("/tmp/t.mp4", 90), crf("/tmp/t.mp4", 81)) == ("15", "15")
    assert (crf("/tmp/t.mp4", 80), crf("/tmp/t.mp4", 0)) == ("20", "20")
    assert (crf("/tmp/t.webm", 90), crf("/tmp/t.webm", 0)) == ("20", "65")

    # `:903` clamps above 100; `:901` falls back to the movie_quality setting.
    assert mws.call("cmd.get_movie_produce_plan", "/tmp/t.mp4", quality=250)["quality"] == 100
    mws.call("cmd.set", "movie_quality", 42)
    default = mws.call("cmd.get_movie_produce_plan", "/tmp/t.mp4")
    assert default["quality"] == 42
    # `_encode:732` -- mpeg_encode's inverted 1..30 scale.
    assert default["mpegQuality"] == 1 + int(((100 - 42) * 29) / 100) == 17

    # `_encode:736-743` snaps the frame rate to a legal MPEG-1 value and warns.
    assert movie_panel.FPS_LEGAL_VALUES == (23.976, 24, 25, 29.97, 30, 50, 59.94, 60)
    mws.call("cmd.set", "movie_fps", 26)
    snapped = mws.call("cmd.get_movie_produce_plan", "/tmp/t.mpg")
    assert (snapped["fps"], snapped["fpsLegal"], snapped["fpsAdjusted"]) == (26.0, 25, True)
    mws.call("cmd.set", "movie_fps", 30)
    assert mws.call("cmd.get_movie_produce_plan", "/tmp/t.mpg")["fpsAdjusted"] is False
    # `_encode:799` -- convert's delay is in hundredths of a second.
    assert mws.call("cmd.get_movie_produce_plan", "/tmp/t.gif")["convertDelay"] == "3.333"

    # width=0/height=0 on an even-format takes the viewport, then evens it.
    viewport = mws.call("cmd.get_viewport")
    auto = mws.call("cmd.get_movie_produce_plan", "/tmp/t.mp4")
    assert auto["viewport"] == list(viewport)
    assert auto["width"] == viewport[0] - (viewport[0] % 2)
    assert auto["height"] == viewport[1] - (viewport[1] % 2)


@needs_ffmpeg
def test_produce_writes_an_mp4_at_the_even_size(mws: Any, gl_bridge: Any) -> None:
    """The whole chain, measured with ffprobe: 161x121 asked, 160x120 written."""
    _movie(mws, 4)
    with tempfile.TemporaryDirectory(prefix="tenmol-mp4") as directory:
        target = os.path.join(directory, "m.mp4")
        out = mws.call(
            "cmd.movie_produce", target, mode="draw", width=161, height=121, quiet=1,
            timeout=300,
        )
        assert out["ok"] is True, out
        assert out["bytes"] > 0
        assert out["encoder"] == "ffmpeg"
        # `preserve=0` (`:812`) removes the temp directory, and it is gone by
        # the time the call returns because `modal=0` keeps `_encode` inline.
        assert out["tmpdirExists"] is False
        assert os.listdir(directory) == ["m.mp4"]

        stream = _ffprobe(target)
        assert stream["codec_name"] == "h264"
        assert (stream["width"], stream["height"]) == (160, 120)
        # `_encode:784` adds `-pix_fmt yuv420p` "needed for Mac support".
        assert stream["pix_fmt"] == "yuv420p"
        assert int(stream["nb_frames"]) == 4


@needs_ffmpeg
def test_produce_webm_is_vp9_and_gif_is_a_two_pass_palette(mws: Any, gl_bridge: Any) -> None:
    """The two ffmpeg branches that are not the default one.

    webm gets ``-c:v libvpx-vp9 -b:v 0 -crf 65-quality/2`` (``_encode:778-780``)
    and GIF gets the ``palettegen``/``paletteuse`` pair (``:765-771``).  The
    palette is an intermediate file the caller never sees -- unless
    ``preserve=1`` keeps the temp directory, which is exactly how it is proved
    here.
    """
    _movie(mws, 3)
    with tempfile.TemporaryDirectory(prefix="tenmol-vpx") as directory:
        webm = mws.call(
            "cmd.movie_produce", os.path.join(directory, "w.webm"),
            mode="draw", width=64, height=48, quiet=1, timeout=300,
        )
        assert webm["ok"] is True, webm
        assert _ffprobe(webm["filename"])["codec_name"] == "vp9"

        gif = mws.call(
            "cmd.movie_produce", os.path.join(directory, "g.gif"),
            mode="draw", width=64, height=48, quiet=1, preserve=1, timeout=300,
        )
        assert gif["ok"] is True, gif
        assert gif["twoPassPalette"] is True
        assert gif["tmpdirExists"] is True, "preserve=1 must keep the frames"
        assert gif["frames"] == [
            "mov0001.png", "mov0002.png", "mov0003.png", "palette.png",
        ], gif["frames"]
        assert _ffprobe(gif["filename"])["codec_name"] == "gif"
        shutil.rmtree(gif["tmpdir"], ignore_errors=True)


@pytest.mark.skipif(not (HAVE_CONVERT and HAVE_FFPROBE), reason="ImageMagick convert not on PATH")
def test_produce_through_convert_is_reachable_when_ffmpeg_is_not_chosen(
    mws: Any, gl_bridge: Any
) -> None:
    """``encoder='convert'`` -- ``_encode:794-801``, ``-delay 100/fps``.

    ``produce`` only *guesses* convert when ffmpeg is missing, but it accepts it
    explicitly, which is the only way to exercise this branch on a machine that
    has both.  The delay is what makes the GIF play at ``movie_fps``.
    """
    _movie(mws, 3)
    mws.call("cmd.set", "movie_fps", 25)
    with tempfile.TemporaryDirectory(prefix="tenmol-cvt") as directory:
        out = mws.call(
            "cmd.movie_produce", os.path.join(directory, "c.gif"),
            mode="draw", encoder="convert", width=64, height=48, quiet=1, timeout=300,
        )
        assert out["encoder"] == "convert"
        assert out["convertDelay"] == "4.000"  # 100 / 25
        assert out["ok"] is True, out
        assert _ffprobe(out["filename"])["codec_name"] == "gif"


def test_produce_mpeg_path_renders_ppm_frames_and_reports_its_own_failure(
    mws: Any, gl_bridge: Any
) -> None:
    """``.mpg`` uses ``.ppm`` frames, and fails *loudly* without mpeg_encode.

    This is the branch a browser must not offer silently: ``produce`` renders
    every frame first and only then discovers that ``pymol.mpeg_encode`` cannot
    validate itself (``movie.py:726-730``).  Measured: three ``mov%04d.ppm``
    files written, no ``.mpg``, and three lines in the console.
    """
    _movie(mws, 3)
    with tempfile.TemporaryDirectory(prefix="tenmol-mpg") as directory:
        out = mws.call(
            "cmd.movie_produce", os.path.join(directory, "x.mpg"),
            mode="draw", width=64, height=48, quiet=0, preserve=1, timeout=300,
        )
        assert out["encoder"] == "mpeg_encode"
        assert out["frameExt"] == ".ppm"
        assert out["frames"] == ["mov0001.ppm", "mov0002.ppm", "mov0003.ppm"], out["frames"]
        assert out["available"] is HAVE_MPEG_ENCODE
        assert out["ok"] is HAVE_MPEG_ENCODE
        shutil.rmtree(out["tmpdir"], ignore_errors=True)


def test_produce_rejects_an_unknown_encoder_as_a_cmdexception(mws: Any) -> None:
    """``movie.py:931`` -- the error the user should see, not a silent no-op."""
    reply = mws.call_reply("cmd.movie_produce", "/tmp/tenmol-nope.mp4", encoder="nope")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == "CmdException"
    assert 'unknown encoder "nope"' in reply["error"]["message"]
    # And the plan says so without running anything at all.
    plan = mws.call("cmd.get_movie_produce_plan", "/tmp/tenmol-nope.mp4", encoder="nope")
    assert (plan["known"], plan["available"]) == (False, False)


def test_an_empty_filename_is_a_dry_run_not_a_dot_mpg_in_the_cwd(mws: Any) -> None:
    """The capability probe in ``test_movie.py`` calls every export with no args.

    ``os.path.splitext('')`` is ``('', '')`` and ``produce:908`` turns that into
    ``.mpg``, so an argument-less call would create a hidden ``.tmp`` directory
    next to the process cwd, render the whole movie into it, and (on a machine
    that has mpeg_encode) leave a ``.mpg`` behind.  ``movie_produce`` short
    circuits instead and still answers with the plan.
    """
    _movie(mws, 2)
    before = sorted(os.listdir("."))
    out = mws.call("cmd.movie_produce")
    assert out["skipped"] is True
    assert out["ok"] is False
    assert out["filename"] == ".mpg"
    assert not os.path.exists(".mpg")
    assert not os.path.exists(".tmp")
    assert sorted(os.listdir(".")) == before


def test_produce_streams_the_encoder_stderr_into_the_console(
    mws: Any, gl_bridge: Any, bridge: Any
) -> None:
    """``colorprinting.warning(stderr)`` (``_encode:788``) reaches the feedback topic.

    That is the "long-running task channel streaming encoder stderr" the plan
    column asks for: there is no separate channel, the encoder's stderr is
    already ordinary PyMOL console output and the bridge's status poller
    forwards it.  The *byte-count* half of that plan (``_watch``, ``:658``) is a
    different story and is asserted below.
    """
    if not HAVE_FFMPEG:
        pytest.skip("ffmpeg not on PATH")
    _movie(mws, 2)
    with tempfile.TemporaryDirectory(prefix="tenmol-log") as directory:
        mws.call(
            "cmd.movie_produce", os.path.join(directory, "l.mp4"),
            mode="draw", width=64, height=48, quiet=0, timeout=300,
        )
    lines = bridge.wait_for_feedback("produce: finished", timeout=10.0)
    joined = "\n".join(lines)
    assert "produce: finished" in joined
    assert "ffmpeg version" in joined, "the encoder's own stderr never arrived"


def test_watch_only_ever_reports_bytes_for_mpeg_encode(mws: Any) -> None:
    """The byte-count progress the inventory row promises is mpeg_encode-only.

    ``_watch`` prints ``produce: %d bytes written...`` every two seconds, but
    it is started from exactly one place -- inside the ``mpeg_encode`` branch,
    behind ``if not quiet`` (``packages/engine/modules/pymol/movie.py:750-753``).  The ffmpeg
    and convert branches call ``subprocess`` and block; there is no progress to
    stream and no thread watching the file.  ASSERTED FROM SOURCE (the function
    is not reachable any other way), by reading the module back out of the
    process the engine is actually running.
    """
    import inspect

    import pymol.movie as pymol_movie

    source = inspect.getsource(pymol_movie._encode)
    assert source.count("_watch") == 1
    before, after = source.split("_watch", 1)
    # The single call site is inside the mpeg_encode arm: `elif encoder ==
    # 'ffmpeg'` has not been reached yet at that point in the function body.
    assert "encoder == 'mpeg_encode'" in before
    assert "elif encoder == 'ffmpeg'" not in before
    assert "elif encoder == 'ffmpeg'" in after


# -- the modal window ------------------------------------------------------


def test_upstream_produce_opens_a_modal_window_the_bridge_endpoint_does_not(
    mws: Any, gl_bridge: Any
) -> None:
    """Blocker A2, for ``produce`` this time.

    ``movie.produce`` hard-codes ``mpng(..., modal=-1)``
    (``packages/engine/modules/pymol/movie.py:973``) and ``MoviePNG`` only demotes a negative
    ``modal`` to 0 when the mode is ray (``packages/engine/layer1/Movie.cpp:836``).  So a plain
    ``cmd.movie.produce(f, mode='draw')`` returns in ~0 ms with
    ``MovieModalDraw`` installed, and **the next API call raises**.  Measured
    here on a 24-frame movie: ``get_modal_draw() == 1`` and
    ``cmd.count_atoms`` -> `` Error: APIEnterNotModal(G)``.

    ``cmd.movie_produce`` passes the same function a ``_self`` whose ``mpng``
    pins ``modal=0``, so ``MoviePNG`` runs its own completion loop inside the
    one pump task, ``produce`` then takes the synchronous ``_encode`` branch,
    and the call returns with the file already on disk.
    """
    if not HAVE_FFMPEG:
        pytest.skip("ffmpeg not on PATH")
    _movie(mws, 24)
    with tempfile.TemporaryDirectory(prefix="tenmol-modal") as directory:
        upstream = os.path.join(directory, "u.mp4")
        mws.call("cmd.movie.produce", upstream, mode="draw", width=64, height=48, quiet=1)
        assert mws.call("cmd.get_modal_draw") == 1
        wedged = mws.call_reply("cmd.count_atoms", "ala")
        assert wedged["t"] == "err"
        assert "APIEnterNotModal" in wedged["error"]["message"]

        # It is a *window*, not a wedge: it closes on its own once the pump has
        # drawn the remaining frames, and `_encode` then runs on its daemon
        # thread and removes the temp directory.
        assert _wait_gone(os.path.join(directory, "u.tmp")), sorted(os.listdir(directory))
        assert mws.call("cmd.count_atoms", "ala") == 10
        assert os.path.exists(upstream)

        # The bridge endpoint, same movie, same encoder, no window.
        out = mws.call(
            "cmd.movie_produce", os.path.join(directory, "b.mp4"),
            mode="draw", width=64, height=48, quiet=1, timeout=300,
        )
        assert out["ok"] is True, out
        assert mws.call("cmd.get_modal_draw") == 0
        assert mws.call("cmd.count_atoms", "ala") == 10


def test_produce_sets_opaque_background_and_clears_keep_alive(mws: Any, gl_bridge: Any) -> None:
    """Two global settings ``produce`` touches, one of which it never restores.

    ``movie.py:935`` sets ``opaque_background`` for every non-ppm export and
    leaves it set; ``:971`` sets ``keep_alive`` and ``_encode:811`` unsets it.
    Both are upstream behaviour, reproduced rather than fixed -- but a caller
    that does not know about the first one gets a permanently opaque viewport,
    so it is pinned here.
    """
    if not HAVE_FFMPEG:
        pytest.skip("ffmpeg not on PATH")
    _movie(mws, 2)
    mws.call("cmd.set", "opaque_background", 0)
    with tempfile.TemporaryDirectory(prefix="tenmol-bg") as directory:
        mws.call(
            "cmd.movie_produce", os.path.join(directory, "o.mp4"),
            mode="draw", width=64, height=48, quiet=1, timeout=300,
        )
    assert mws.call("cmd.get_setting_int", "opaque_background") == 1
    assert mws.call("cmd.get_setting_int", "keep_alive") == 0


# ==========================================================================
# 00:104 -- the movie timeline panel
# ==========================================================================


def test_panel_rows_are_executive_count_motions_not_camera_plus_objects(mws: Any) -> None:
    """``ExecutiveCountMotions`` (``packages/engine/layer3/Executive.cpp:664``), row for row.

    The camera row exists when ``MovieGetSpecLevel(G,0) >= 0``, i.e. when
    ``CMovie::ViewElem`` is allocated -- and MEASURED HERE, ``cmd.mset`` alone
    allocates it (``MovieSequence`` does ``I->ViewElem.resize(c)``,
    ``packages/engine/layer1/Movie.cpp:924-929``), so a movie program is enough; no ``mview``
    is needed.  Objects add a row each once they have their own ViewElem.
    """
    mws.call("cmd.fragment", "ala")
    mws.call("cmd.create", "m2", "ala")

    # No movie program at all: no rows, nothing to draw.
    empty = mws.call("cmd.get_movie_panel")
    assert empty["nframes"] == 1
    assert empty["rows"] == []
    assert empty["motions"] == 0
    assert empty["height"] == 0

    mws.call("cmd.mset", "1 x6")
    panel = mws.call("cmd.get_movie_panel")
    assert [row["label"] for row in panel["rows"]] == ["camera"]
    assert panel["motions"] == 1 == len(panel["rows"])
    assert panel["rows"][0]["object"] == ""
    assert panel["rows"][0]["spec"] == [movie_panel.SPEC_NONE] * 6

    mws.request(t="call", fn="cmd.mview", args=["store"], kwargs={"first": 1, "object": "m2"})
    panel = mws.call("cmd.get_movie_panel")
    assert [row["label"] for row in panel["rows"]] == ["camera", "m2"]
    assert [row["object"] for row in panel["rows"]] == ["", "m2"]
    assert panel["motions"] == 2
    assert panel["height"] == panel["rowHeight"] * 2


def test_the_gutter_label_is_states_when_there_is_no_movie_program(mws: Any) -> None:
    """``CMovie::draw:1845`` -- ``if (!ViewElem) ViewElemDrawLabel(G, "states")``.

    That branch is not "no key frames", it is "no ``mset``": with a multi-state
    object and no movie program, ``SceneGetNFrame() > 1`` drives
    ``ExecutiveCountMotions`` to its floor of 1 (``Executive.cpp:684``) and the
    single strip is the object's STATE axis, so the label says so.  Calling it
    ``camera`` -- which the first version of the React panel did, because it
    hard-coded the row 0 label -- claims a camera track that does not exist.
    """
    mws.call("cmd.fragment", "ala")
    mws.call("cmd.create", "ms", "ala", 1, 1)
    mws.call("cmd.create", "ms", "ala", 1, 2)
    mws.call("cmd.create", "ms", "ala", 1, 3)
    assert mws.call("cmd.count_states", "ms") == 3
    assert mws.call("cmd.get_movie_length") == 0
    assert mws.call("cmd.count_frames") == 3

    panel = mws.call("cmd.get_movie_panel")
    assert panel["label"] == "states"
    assert [row["label"] for row in panel["rows"]] == ["states"]
    assert panel["motions"] == 1
    assert panel["rows"][0]["spec"] == [movie_panel.SPEC_NONE] * 3
    # The frame->state map is still the useful part of the row.
    assert [cell["state"] for cell in panel["cells"]] == [1, 2, 3]

    # One `mset` and the same panel becomes a camera track.
    mws.call("cmd.mset", "1 x3")
    assert mws.call("cmd.get_movie_panel")["label"] == "camera"


def test_presentation_collapses_the_panel_to_the_camera_row(mws: Any) -> None:
    """``ExecutiveMotionDraw:711-720`` sets ``expected = 1`` then ``goto done``.

    ``MovieGetPanelHeight`` agrees (``packages/engine/layer1/Movie.cpp:1716``): one
    ``row_height``, whatever the object count.  ``CMovie::reshape:1865`` also
    zeroes ``LabelIndent`` in presentation mode, which is why the React gutter
    reads ``presentation`` rather than always reserving 64 px.
    """
    mws.call("cmd.fragment", "ala")
    mws.call("cmd.create", "m2", "ala")
    mws.call("cmd.mset", "1 x6")
    mws.request(t="call", fn="cmd.mview", args=["store"], kwargs={"first": 1, "object": "m2"})
    assert mws.call("cmd.get_movie_panel")["motions"] == 2

    mws.call("cmd.set", "presentation", 1)
    panel = mws.call("cmd.get_movie_panel")
    assert panel["presentation"] is True
    assert [row["label"] for row in panel["rows"]] == ["camera"]
    assert panel["motions"] == 1
    assert panel["height"] == panel["rowHeight"]

    mws.call("cmd.set", "presentation", 0)
    assert mws.call("cmd.get_movie_panel")["motions"] == 2


def test_the_c_panel_is_off_in_the_bridge_and_the_row_height_is_still_the_model(
    mws: Any,
) -> None:
    """Why ``visible``/``panelActive`` are false and ``height`` is not zero.

    ``engine.py:183`` sets ``movie_panel 0`` on purpose: ``OrthoReshape``
    subtracts ``MovieGetPanelHeight()`` from the scene rectangle
    (``packages/engine/layer1/Ortho.cpp:2383``), so leaving the GL panel on would silently cost
    the web canvas ~15 px the moment any object had more than one state.  The
    default is 1 (``packages/engine/layer1/SettingInfo.h:718``), so this is a deliberate
    divergence and the panel payload reports both numbers rather than one.
    """
    assert mws.call("cmd.get_setting_int", "movie_panel") == 0
    _movie(mws, 4)
    panel = mws.call("cmd.get_movie_panel")
    assert panel["visible"] is False
    assert panel["panelActive"] is False
    assert panel["panelHeight"] == 0
    # ...but the DOM timeline still has a height to lay itself out with.
    assert panel["rowHeight"] == mws.call("cmd.get_setting_int", "movie_panel_row_height")
    assert panel["height"] == panel["rowHeight"] * len(panel["rows"])

    # Turning it back on is what a GL-panel parity check would look like.
    mws.call("cmd.set", "movie_panel", 1)
    panel = mws.call("cmd.get_movie_panel")
    assert panel["panelActive"] is True
    assert panel["panelHeight"] == panel["rowHeight"] * panel["motions"]
    mws.call("cmd.set", "movie_panel", 0)


def test_label_indent_is_the_sixty_four_pixel_c_gutter(mws: Any) -> None:
    """``CMovie::LabelIndent = DIP2PIXEL(8 * 8)`` (``packages/engine/layer1/Movie.cpp:1867``).

    It is load-bearing, not cosmetic: ``MovieClick``/``MovieDrag``/``CMovie::draw``
    all do ``tmpRect.right -= I->LabelIndent`` before ``ViewElemXtoFrame``
    (``:1495``, ``:1632``, ``:1751``), so a client that draws the strip full
    width hit-tests 64 px of frames onto the wrong cells at the right-hand end.
    """
    _movie(mws, 4)
    assert movie_panel.LABEL_INDENT == 64
    assert mws.call("cmd.get_movie_panel")["labelIndent"] == 64


# ==========================================================================
# 00:105 -- the panel's mouse grammar, in terms of the commands it emits
# ==========================================================================


def _two_row_movie(mws: Any) -> None:
    """A 6-frame movie with key frames at 1/3/6 on BOTH the camera and ``m2``."""
    mws.call("cmd.mset")
    mws.call("cmd.delete", "all")
    mws.call("cmd.fragment", "ala")
    mws.call("cmd.create", "m2", "ala")
    mws.call("cmd.mset", "1 x6")
    for frame in (1, 3, 6):
        mws.call("cmd.mview", "store", frame)
        mws.request(
            t="call", fn="cmd.mview", args=["store"], kwargs={"first": frame, "object": "m2"}
        )
    mws.call("cmd.mview", "reinterpolate")
    mws.request(t="call", fn="cmd.mview", args=["reinterpolate"], kwargs={"object": "m2"})


def test_object_none_is_the_camera_row_and_empty_is_every_row(mws: Any) -> None:
    """The single most consequential argument in ``CMovie::release`` (``:1607``).

    A drag on the camera row emits ``object='none'``; Ctrl+Shift (``DragColumn``)
    emits ``object=''``.  ``ExecutiveMotionViewModify``
    (``packages/engine/layer3/Executive.cpp:538-560``) reads ``none`` as "camera, and stop" and
    ``''`` as "camera **then every object**".  Omitting the argument -- which is
    what a client does when it treats the camera row's empty object name as
    "nothing to send" -- lands on the ``''`` default, so a camera-row drag
    quietly rewrites every object's motion track too.
    """
    _two_row_movie(mws)
    base = _rows(mws)
    assert base[""] == base["m2"] == [2, 1, 2, 1, 1, 2]

    mws.request(t="call", fn="cmd.mmove", args=[2, 3, 1], kwargs={"object": "none"})
    only_camera = _rows(mws)
    assert only_camera[""] == [2, 2, 1, 1, 1, 2]
    assert only_camera["m2"] == base["m2"], "object='none' must not touch m2"

    _two_row_movie(mws)
    mws.request(t="call", fn="cmd.mmove", args=[2, 3, 1], kwargs={"object": ""})
    column = _rows(mws)
    assert column[""] == [2, 2, 1, 1, 1, 2]
    assert column["m2"] == [2, 2, 1, 1, 1, 2], "object='' is the COLUMN form"

    # And with no argument at all it is the column form -- the trap.
    _two_row_movie(mws)
    mws.call("cmd.mmove", 2, 3, 1)
    assert _rows(mws)["m2"] == [2, 2, 1, 1, 1, 2]


def test_mview_clear_column_uses_same_not_empty(mws: Any) -> None:
    """``cMovieDragModeOblate`` overrides the column argument to ``'same'`` (``:1665``)."""
    _two_row_movie(mws)
    mws.request(
        t="call", fn="cmd.mview", args=["clear"],
        kwargs={"first": 3, "last": 3, "object": "none"},
    )
    after = _rows(mws)
    assert after[""][2] != movie_panel.SPEC_KEY
    assert after["m2"][2] == movie_panel.SPEC_KEY, "object='none' is camera-only here too"

    _two_row_movie(mws)
    mws.request(
        t="call", fn="cmd.mview", args=["clear"],
        kwargs={"first": 3, "last": 3, "object": "same"},
    )
    after = _rows(mws)
    assert after[""][2] != movie_panel.SPEC_KEY
    assert after["m2"][2] != movie_panel.SPEC_KEY


def test_every_panel_gesture_command_executes_over_the_wire(mws: Any) -> None:
    """The six command shapes ``CMovie::release`` PParses, run for real.

    Argument ORDER is the hazard the React side has to get right and this test
    pins: ``mmove``/``mcopy`` are ``(target, source, count, freeze, object)`` and
    ``mdelete``/``minsert`` are ``(count, frame, freeze, object)`` --  the fourth
    POSITIONAL is ``freeze``, not ``object`` (``packages/engine/modules/pymol/moving.py:493,
    545, 591, 640``), so ``object`` has to travel as a keyword or it silently
    freezes the interpolation instead.
    """
    _two_row_movie(mws)
    before = mws.call("cmd.count_frames")

    # right-drag on an object row
    mws.request(t="call", fn="cmd.mmove", args=[5, 3, 1], kwargs={"object": "m2"})
    # shift+right-drag
    mws.request(t="call", fn="cmd.mcopy", args=[2, 1, 1], kwargs={"object": "m2"})
    assert _rows(mws)["m2"][1] == movie_panel.SPEC_KEY

    # ctrl+left-drag forward / backward, in COLUMN mode (Ctrl+Shift), which is
    # the only symmetric pair: see the asymmetry test below for object='none'.
    mws.request(t="call", fn="cmd.minsert", args=[3, 1], kwargs={"object": ""})
    assert mws.call("cmd.count_frames") == before + 3
    mws.request(t="call", fn="cmd.mdelete", args=[3, 1], kwargs={"object": ""})
    assert mws.call("cmd.count_frames") == before

    # ctrl+middle-drag
    mws.request(
        t="call", fn="cmd.mview", args=["clear"],
        kwargs={"first": 1, "last": before, "object": "same"},
    )
    assert _rows(mws)[""] == [movie_panel.SPEC_NONE] * before

    # plain left drag == the scrollbar, `SceneSetFrame(G, 7, v)` (`:1535`)
    mws.call("cmd.set_frame", 4, 7)
    assert mws.call("cmd.get_frame") == 4


def test_minsert_on_the_camera_row_alone_does_not_undo_with_mdelete(mws: Any) -> None:
    """A real asymmetry in ``object='none'`` that the panel gesture inherits.

    ``ExecutiveMotionViewModify`` (``packages/engine/layer3/Executive.cpp:544-560``) takes a
    different tail for ``none``: instead of applying the edit to every object
    and then ``ExecutiveMotionTrim``, it calls ``ExecutiveMotionExtend``, which
    pads every OTHER track out to the new longest one.  So a Ctrl+drag on the
    camera row inserts frames everywhere, and the mirror-image Ctrl+drag back
    does NOT remove them -- the objects are still 9 frames long, so the movie
    stays 9 frames long.

    MEASURED, not derived: 6 -> 9 on insert, 9 -> 9 on the matching delete, and
    9 -> 6 only once the delete runs in column mode.  The React panel emits
    exactly the same commands as the C, so it inherits this; the point of
    pinning it is that it is upstream behaviour and not a bug in the port.
    """
    _two_row_movie(mws)
    assert mws.call("cmd.count_frames") == 6
    mws.request(t="call", fn="cmd.minsert", args=[3, 1], kwargs={"object": "none"})
    assert mws.call("cmd.count_frames") == 9
    mws.request(t="call", fn="cmd.mdelete", args=[3, 1], kwargs={"object": "none"})
    assert mws.call("cmd.count_frames") == 9
    mws.request(t="call", fn="cmd.mdelete", args=[3, 1], kwargs={"object": ""})
    assert mws.call("cmd.count_frames") == 6


def test_a_zero_length_ctrl_drag_is_a_harmless_no_op_command(mws: Any) -> None:
    """Why the React classifier returns ``null`` where the C emits a command.

    ``CMovie::release:1683-1692`` has no "did it move" guard: a Ctrl+click that
    never leaves its cell takes the ``else`` arm and PParses
    ``cmd.mdelete(0, frame)``.  Measured: it succeeds and changes nothing, so
    the only thing it does is put a line in the user's ``.pml`` log --  which is
    why ``classifyGesture`` drops it instead of reproducing it.  If that
    ever stops being a no-op, this test says so.
    """
    _two_row_movie(mws)
    before = mws.call("cmd.count_frames")
    specs = _rows(mws)
    reply = mws.request(t="call", fn="cmd.mdelete", args=[0, 3], kwargs={"object": "none"})
    assert reply["t"] == "ok", reply
    assert mws.call("cmd.count_frames") == before
    assert _rows(mws) == specs


def test_row_height_is_a_settable_global_the_ctrl_shift_wheel_writes(mws: Any) -> None:
    """``MovieClick:1561`` -- Ctrl+Shift wheel writes ``movie_panel_row_height``.

    It is a global setting, not panel-local state, so the DOM timeline has to
    write it through ``cmd.set`` and re-read it from the panel payload rather
    than keeping its own number; otherwise the GL panel and the DOM panel
    disagree about how tall a row is.  The C applies ``row_height - scrolldir``
    with no floor at all -- 0 and negatives are reachable -- which is the one
    place the React side deliberately clamps.
    """
    _movie(mws, 4)
    original = mws.call("cmd.get_setting_int", "movie_panel_row_height")
    assert mws.call("cmd.get_movie_panel")["rowHeight"] == original

    mws.call("cmd.set", "movie_panel_row_height", original + 1)
    panel = mws.call("cmd.get_movie_panel")
    assert panel["rowHeight"] == original + 1
    assert panel["height"] == (original + 1) * len(panel["rows"])

    # The C's arithmetic is unclamped; proving that is why the client clamps.
    mws.call("cmd.set", "movie_panel_row_height", 0)
    assert mws.call("cmd.get_movie_panel")["rowHeight"] == 0
    mws.call("cmd.set", "movie_panel_row_height", original)


def test_the_motion_context_menu_targets_come_from_the_same_row(mws: Any) -> None:
    """A right-click that did not drag opens ``camera_motion``/``obj_motion``.

    ``ExecutiveMotionMenuActivate`` (``packages/engine/layer3/Executive.cpp:737``) passes
    ``cKeywordSame`` for a column click and the object's own name otherwise, and
    the leaves are command strings.  The React menus are built from
    ``packages/engine/modules/pymol/menu.py``; what is checked here is that the commands those
    leaves carry actually run for both row kinds.
    """
    _two_row_movie(mws)
    for line in (
        'cmd.mview("store",first=2)',
        'cmd.mview("clear",first=2)',
        'cmd.mview("store",object="m2",first=2)',
        'cmd.mview("clear",object="m2",first=2)',
        'cmd.mview("smooth",window=15,object="m2")',
        'cmd.mview("reinterpolate",object="m2")',
    ):
        reply = mws.do(line)
        assert reply["t"] == "ok", (line, reply)
