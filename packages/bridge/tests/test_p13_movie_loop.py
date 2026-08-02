"""Row 311 — movie playback: the loop/stop decision and the pacing readout.

WHY THIS FILE EXISTS.  The row's citation was a ``†`` fallback, and auditing it
found the coverage split in two uneven halves.  ``test_movie.py::
test_movie_playback_is_backend_driven`` proves the engine really advances
frames and that ``mtoggle`` flips playing on and off — MEASURED: rewriting
``cmd.mtoggle`` to ``_cmd.mplay(COb, 1)`` (play, never toggle) turns it red.
Nothing covered the two claims the row spends most of its words on:

* **the end-of-movie branch.** ``SceneIdle`` (``packages/engine/layer1/Scene.cpp:2432-2470``)
  at the last frame either wraps through ``SceneSetFrame(G,7,0)`` when
  ``movie_loop`` is set, or stops the movie.  Those are opposite outcomes from
  the same key press, chosen by a setting a user can flip from the Movie menu,
  and a client that assumes either one is wrong half the time.
* **the transport readout.** ``get_movie_status`` is the ONLY thing the client
  polls (plan §6 WP-20: the backend is the clock).  ``MoviePlaying``
  (``Movie.cpp:540``) is false while the movie is *locked*, which is why
  ``locked`` is reported beside ``playing`` instead of folded into it, and the
  three pacing settings — ``movie_fps``, ``movie_delay``, ``movie_loop`` — have
  to reach the client for the transport bar to say anything true.

WHAT IS AND IS NOT PROVEN HERE.  The readout half is mutation-proven: blanking
``playing`` or ``fps`` in ``panels/movie.py::movie_status`` turns the last two
tests red.  The loop/stop half is a live observation of C code that this tree
cannot mutate cheaply (``SceneIdle`` is compiled into ``_cmd``), so it is
written as a black-box assertion on the outcome instead — which is still the
first thing in the repo that would notice ``movie_loop`` ceasing to work.

THE SHARED ENGINE.  One PyMOL per pytest process, so every test here restores
``movie_fps``/``movie_loop``/``movie_delay``, stops the movie and clears the
program, whatever happens.
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

BOOTSTRAP = "/import tenmol_bridge.panels.movie"

#: Settings the pacing depends on; saved and put back by :func:`player`.
_PACING = ("movie_fps", "movie_delay", "movie_loop")


@pytest.fixture()
def player(ws: WSClient):
    """A 6-frame movie at 30 fps, and no trace left behind."""
    reply = ws.request(t="call", fn="cmd.do", args=[BOOTSTRAP], kwargs={"echo": 0, "log": 0})
    assert reply["t"] == "ok", reply
    saved = {name: ws.call("cmd.get", name) for name in _PACING}
    ws.call("cmd.mstop")
    ws.call("cmd.mset")
    ws.call("cmd.delete", "zp13mov")
    ws.call("cmd.fragment", "ala", "zp13mov")
    ws.call("cmd.mset", "1 x6")
    ws.call("cmd.set", "movie_fps", 30)
    ws.call("cmd.rewind")
    try:
        yield ws
    finally:
        ws.call("cmd.mstop")
        for name, value in saved.items():
            ws.call("cmd.set", name, value)
        ws.call("cmd.mset")
        ws.call("cmd.delete", "zp13mov")


def _watch(ws: WSClient, seconds: float) -> List[int]:
    """Every distinct frame index seen over ``seconds``, in the order seen."""
    seen: List[int] = []
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        frame = int(ws.call("cmd.get_frame"))
        if not seen or seen[-1] != frame:
            seen.append(frame)
        time.sleep(0.02)
    return seen


def test_playback_stops_at_the_last_frame_when_movie_loop_is_off(player: WSClient) -> None:
    """``movie_loop 0``: the movie ends, it does not restart.

    ``SceneIdle`` calls ``MovieStop`` at the last frame unless ``movie_loop``
    (``Scene.cpp:2455-2462``).  Asserted through the two observables a client
    has: the frame stops moving at ``count_frames()`` and
    ``get_movie_playing`` goes false on its own, with nobody sending
    ``cmd.mstop``.
    """
    ws = player
    ws.call("cmd.set", "movie_loop", 0)
    ws.call("cmd.rewind")
    assert ws.call("cmd.get_frame") == 1

    ws.call("cmd.mplay")
    assert ws.call("cmd.get_movie_playing") == 1

    deadline = time.monotonic() + 6.0
    while time.monotonic() < deadline and ws.call("cmd.get_movie_playing"):
        time.sleep(0.05)

    assert ws.call("cmd.get_movie_playing") == 0, "a non-looping movie never stopped"
    assert ws.call("cmd.get_frame") == ws.call("cmd.count_frames")


def test_playback_wraps_to_frame_one_when_movie_loop_is_on(player: WSClient) -> None:
    """``movie_loop 1``: the last frame is followed by frame 1, still playing.

    The wrap is ``SceneSetFrame(G, 7, 0)`` — mode 7 is absolute WITH the frame's
    movie command, so a looping movie re-runs frame 1's ``mdo`` on every lap.
    What is checked here is the observable half: the frame index goes back down
    and the movie is still playing afterwards.
    """
    ws = player
    ws.call("cmd.set", "movie_loop", 1)
    ws.call("cmd.rewind")
    ws.call("cmd.mplay")
    try:
        frames = _watch(ws, 3.0)
        assert len(frames) > 6, "the engine did not advance frames: %r" % (frames,)
        # a descent from a high frame to a lower one is a wrap; a movie that
        # merely stopped at the end would be monotonic.
        wrapped = any(b < a for a, b in zip(frames, frames[1:]))
        assert wrapped, "a looping movie never returned to an earlier frame: %r" % (frames,)
        assert ws.call("cmd.get_movie_playing") == 1, "the looping movie stopped at the end"
    finally:
        ws.call("cmd.mstop")


def test_the_transport_readout_reports_playing_and_locked_separately(player: WSClient) -> None:
    """``MoviePlaying`` is false while the movie is LOCKED, so both are sent.

    A client that only had ``playing`` would render "stopped" for a movie that
    is merely locked mid-command and then fight the engine over the frame.
    """
    ws = player
    status: Dict[str, Any] = ws.call("cmd.get_movie_status")
    assert status["playing"] is False
    assert status["locked"] is False
    assert status["nframes"] == 6

    ws.call("cmd.mplay")
    try:
        playing = ws.call("cmd.get_movie_status")
        assert playing["playing"] is True, playing
        assert playing["playing"] == bool(ws.call("cmd.get_movie_playing"))
        assert playing["locked"] == bool(ws.call("cmd.get_movie_locked"))
    finally:
        ws.call("cmd.mstop")

    assert ws.call("cmd.get_movie_status")["playing"] is False


@pytest.mark.parametrize("fps", [30, 15, 1])
def test_the_pacing_settings_reach_the_client(player: WSClient, fps: int) -> None:
    """``movie_fps`` (and its ``movie_delay`` fallback) are what the bar shows.

    ``SceneIdle`` reads ``movie_fps`` and falls back to ``movie_delay`` ms when
    it is <= 0 (``Scene.cpp:2436-2444``); the Frame Rate menu writes the same
    setting.  ``get_movie_status`` therefore has to carry BOTH — the top-level
    ``fps`` the bar renders and the raw settings the menu ticks — or the radio
    button and the readout disagree.
    """
    ws = player
    ws.call("cmd.set", "movie_fps", fps)
    status = ws.call("cmd.get_movie_status")
    assert status["fps"] == pytest.approx(float(fps))
    assert status["settings"]["movie_fps"] == pytest.approx(float(fps))
    assert status["settings"]["movie_delay"] == pytest.approx(
        float(ws.call("cmd.get_setting_float", "movie_delay"))
    )
    assert status["settings"]["movie_loop"] == bool(
        ws.call("cmd.get_setting_boolean", "movie_loop")
    )
