"""Adversarial re-check of ``cmd.movie_produce`` (inventory row ``00:326``).

``bridge/tests/test_wf_movie.py`` pins the encoder table, the ``.ppm``/``.png``
split, the two-pass GIF palette and the modal window.  What it does **not**
cover is the branch of ``movie.produce:939-951`` that fires when the caller
gives exactly ONE of width/height and lets the aspect ratio supply the other —
and that branch is where the bridge quietly stops reproducing upstream.

Upstream keeps the aspect result as a FLOAT::

    height = width * h / w          # 201 * 600 / 800 -> 150.75
    if height % 2: height -= 1      # 0.75 is truthy  -> 149.75

so ``mpng`` is handed ``149.75``, renders **odd** 200x149 frames, and ffmpeg
refuses them.  ``produce_plan`` truncates with ``int()`` first, so the same
request renders 200x150 and encodes.  Both halves are MEASURED here, from the
PNG headers in the preserved temp directory and from the size of the file
ffmpeg did or did not write, because a divergence that is only in a docstring
is a divergence nobody knows about.

``mode='ray'`` is used throughout: ``MoviePNG`` demotes ``modal=-1`` to 0 for
ray (``layer1/Movie.cpp:836``), so upstream ``produce`` runs synchronously and
this file never opens the ``APIEnterNotModal`` window that
``test_wf_movie.py`` deliberately does.

SHARED-PROCESS DISCIPLINE: ``produce`` sets ``opaque_background`` and never
unsets it, and sets ``keep_alive`` for the duration; both are saved and
restored, as are the movie program and the object list.
"""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import tempfile
from typing import Any, Dict, List, Optional, Tuple

import pytest

BOOTSTRAP = "/import tenmol_bridge.panels.movie"

HAVE_FFMPEG = bool(shutil.which("ffmpeg"))
HAVE_FFPROBE = bool(shutil.which("ffprobe"))

needs_ffmpeg = pytest.mark.skipif(
    not (HAVE_FFMPEG and HAVE_FFPROBE), reason="ffmpeg/ffprobe not on PATH"
)

#: ``produce`` writes both of these and only ever unsets the second one.
_SAVED_INT = ("opaque_background", "keep_alive", "movie_quality")


@pytest.fixture
def mws(ws: Any):
    reply = ws.request(t="call", fn="cmd.do", args=[BOOTSTRAP], kwargs={"echo": 0, "log": 0})
    assert reply["t"] == "ok", reply
    saved: Dict[str, Any] = {name: ws.call("cmd.get_setting_int", name) for name in _SAVED_INT}
    cwd = os.getcwd()
    ws.call("cmd.mset")
    ws.call("cmd.delete", "all")
    try:
        yield ws
    finally:
        ws.call("cmd.mset")
        ws.call("cmd.delete", "all")
        ws.call("cmd.frame", 1)
        for name, value in saved.items():
            ws.call("cmd.set", name, value)
        # `_encode` chdirs for the duration of the encode (`movie.py:748,763`).
        assert os.getcwd() == cwd, "movie encoding left the process in %s" % os.getcwd()


def _png_size(path: str) -> Tuple[int, int]:
    """Width/height straight out of the IHDR chunk."""
    with open(path, "rb") as handle:
        head = handle.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", path
    return struct.unpack(">II", head[16:24])


def _ffprobe(path: str) -> Dict[str, Any]:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,codec_name", "-of", "json", path,
        ],
        capture_output=True,
        text=True,
    )
    streams = json.loads(out.stdout or "{}").get("streams") or [{}]
    return streams[0]


def _aspect_width(viewport: List[int]) -> Optional[int]:
    """A width whose derived height upstream and the bridge disagree about.

    Upstream keeps the float and decrements it whenever ``h % 2`` is *truthy*,
    which a fraction always is; the bridge truncates first.  They differ exactly
    when ``width * vh / vw`` is not an integer and floors to an even number.
    Computed from the live viewport so the test does not depend on it.
    """
    vw, vh = viewport
    for width in range(9, 1024):
        exact = width * vh / vw
        if exact == int(exact):
            continue
        upstream = exact - 1 if exact % 2 else exact
        bridge = int(exact)
        if bridge % 2:
            bridge -= 1
        if int(upstream) != bridge and int(upstream) % 2:
            return width
    return None


@needs_ffmpeg
def test_the_aspect_branch_is_a_silent_fix_not_a_reproduction(mws: Any, gl_bridge: Any) -> None:
    """``movie.produce`` with only ``width=`` given renders ODD frames upstream.

    MEASURED on this machine (viewport 800x600, width=201):

    ==========================  ==============  ==================
    call                        frames written  output
    ==========================  ==============  ==================
    ``cmd.movie.produce``       200 x **149**   0 bytes, ffmpeg 187
    ``cmd.movie_produce``       200 x **150**   valid h264 200x150
    ==========================  ==============  ==================

    The bridge is the useful one, but it is a DIVERGENCE and not the "exact"
    reproduction of ``movie.py:906-951`` that ``produce_plan``'s docstring
    claims, so it is pinned here rather than left to be rediscovered.
    """
    viewport = [int(v) for v in mws.call("cmd.get_viewport")]
    width = _aspect_width(viewport)
    if width is None:
        pytest.skip("viewport %s has no fractional aspect width" % viewport)
    exact = width * viewport[1] / viewport[0]
    upstream_height = int(exact - 1)
    bridge_height = int(exact) - (int(exact) % 2)
    assert upstream_height != bridge_height

    mws.call("cmd.fragment", "ala")
    mws.call("cmd.mset", "1 x2")

    # The bridge's own answer, before anything renders.
    plan = mws.call("cmd.get_movie_produce_plan", "/tmp/tenmol-aspect.mp4", width=width)
    assert (plan["width"], plan["height"]) == (width - (width % 2), bridge_height)

    with tempfile.TemporaryDirectory(prefix="tenmol-aspect") as directory:
        # -- upstream ---------------------------------------------------
        # `mode='ray'` is the one mode `MoviePNG` demotes `modal=-1` to 0 for
        # (`Movie.cpp:836`), so this returns with the encode already done and
        # no `APIEnterNotModal` window behind it.
        upstream = os.path.join(directory, "u.mp4")
        mws.call(
            "cmd.movie.produce", upstream, mode="ray", width=width,
            quiet=1, preserve=1, timeout=300,
        )
        assert mws.call("cmd.get_modal_draw") == 0
        assert mws.call("cmd.count_atoms", "ala") == 10

        frame = os.path.join(directory, "u.tmp", "mov0001.png")
        assert _png_size(frame)[1] == upstream_height, _png_size(frame)
        assert upstream_height % 2 == 1, "the whole point is that it is odd"
        # ffmpeg refuses an odd height with `-pix_fmt yuv420p` and leaves the
        # file it opened empty; `produce` still prints " produce: finished."
        assert os.path.exists(upstream) and os.path.getsize(upstream) == 0
        shutil.rmtree(os.path.join(directory, "u.tmp"), ignore_errors=True)

        # -- the bridge, same request -----------------------------------
        out = mws.call(
            "cmd.movie_produce", os.path.join(directory, "b.mp4"), mode="ray",
            width=width, quiet=1, preserve=1, timeout=300,
        )
        assert (out["width"], out["height"]) == (width - (width % 2), bridge_height)
        assert out["ok"] is True, out
        assert out["bytes"] > 0
        frame = os.path.join(directory, "b.tmp", "mov0001.png")
        assert _png_size(frame)[1] == bridge_height
        stream = _ffprobe(out["filename"])
        assert (stream["codec_name"], stream["height"]) == ("h264", bridge_height)
        shutil.rmtree(os.path.join(directory, "b.tmp"), ignore_errors=True)


@needs_ffmpeg
def test_ok_is_false_when_ffmpeg_fails_on_a_format_that_is_not_even_forced(
    mws: Any, gl_bridge: Any
) -> None:
    """The failure half of the ``ok``/``bytes`` answer, which nothing else pins.

    ``EVEN_EXTENSIONS`` is only ``.mp4``/``.mov``/``.webm``, so any other
    container reaches ffmpeg with whatever size the caller asked for.  An odd
    height with ``-pix_fmt yuv420p`` (``_encode:784``) is a hard error; measured:
    ffmpeg exits 187, the container is 0 bytes and ``movie_produce`` answers
    ``ok=False, bytes=0`` instead of upstream's ``DEFAULT_SUCCESS``.

    The ``.mp4`` half of the pair is the control: the same odd 64x49 request
    becomes 64x48 and encodes.
    """
    mws.call("cmd.fragment", "ala")
    mws.call("cmd.mset", "1 x2")
    with tempfile.TemporaryDirectory(prefix="tenmol-okfalse") as directory:
        bad = mws.call(
            "cmd.movie_produce", os.path.join(directory, "f.mkv"), mode="ray",
            width=64, height=49, quiet=1, timeout=300,
        )
        assert (bad["width"], bad["height"]) == (64, 49), "no even-forcing for .mkv"
        assert bad["encoder"] == "ffmpeg"
        assert bad["ok"] is False
        assert bad["bytes"] == 0

        good = mws.call(
            "cmd.movie_produce", os.path.join(directory, "f.mp4"), mode="ray",
            width=64, height=49, quiet=1, timeout=300,
        )
        assert (good["width"], good["height"]) == (64, 48)
        assert good["ok"] is True, good
        assert _ffprobe(good["filename"])["height"] == 48

    # Neither call may leave the engine holding a modal draw.
    assert mws.call("cmd.get_modal_draw") == 0
    assert mws.call("cmd.count_atoms", "ala") == 10
