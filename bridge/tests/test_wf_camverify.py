"""Parity area 7 — INDEPENDENT re-measurement of the scene-recall/view/key rows.

This file exists because ``test_wf_camera.py`` asserts several things with
bounds much looser than the numbers its annotation quotes, and leaves three
halves of the C conditions untested.  Everything here was measured over the
socket on this build before it was written down:

``00:330``  scene recall — animation and frame policy
  * the storemask bit layout, read back one flag at a time
    (view->0x3E, active->0x3D, color->0x3B, rep->0x37, frame->0x2F), which is
    ``STORE_VIEW..STORE_THUMBNAIL = 1,2,4,8,16,32`` (``MovieScene.h:27-34``);
  * the PER-ATOM COLOUR half of the recall — 2084 blue atoms restored over red,
    and NOT restored when the caller passes ``color=0``.  ``test_wf_camera.py``
    only covers the camera and the frame;
  * the sweep length, timed to +-0.15 s instead of "under 1.5 / over 1.2":
    scene_animation_duration 2.25 -> settled in 2.245 s, 1.0 -> 0.999 s,
    0.4 -> 0.385 s, and the call returns with the camera still 1.2856 away;
  * ``scene_frame_mode = -1`` with NO movie defined, which is the other half of
    ``(scene_frame_mode < 0 && MovieDefined(G))`` (``MovieScene.cpp:414``) and
    behaves the OPPOSITE way round: the frame IS restored.

``00:336``  named camera views
  * ``cmd.get_session`` is a callable that really does contain ``view_dict``
    (``viewing.py:1187``) — but over the bridge it answers a ``__blob__``
    handle for a binary ``.pse``, so it is not a listing a panel can read.

``00:340``  keyboard bindings
  * SHFT-space = ``rewind;mplay`` (``Ortho.cpp:866-874``), which needs no
    presentation mode and was skipped upstream of this file;
  * SHFT-home / SHFT-end forwarded, not just read out of the key table.

SHARED-STATE NOTES, both measured rather than assumed:
  * ``test_shortcuts.py::test_set_key_accepts`` leaves ``left`` bound to
    ``print("tenmol shortcut probe")`` for the rest of the process — confirmed
    by printing ``cmd.key_mappings.get('left')`` after that file.  The fixture
    below resets the table to ``pymol.keyboard.get_default_keys()`` and puts
    the snapshot back verbatim.
  * every setting written here is process-global and is restored by value.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_wf_camverify.py -q
"""

from __future__ import annotations

import os
import sys
import time
from typing import List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")

#: ``cmd.get_scene_panel`` is the only reader of ``storemask``; importing the
#: panel module installs it (``bridge/tenmol_bridge/panels/movie.py:413``).
BOOTSTRAP = "/import tenmol_bridge.panels.movie"

TOUCHED_SETTINGS = (
    "animation",
    "animation_duration",
    "scene_animation",
    "scene_animation_duration",
    "scene_frame_mode",
)

#: GLUT special codes (``modules/pymol/internal.py:398-421``).
K_HOME, K_END = 106, 107
#: ``_button`` states (``layer5/PyMOL.cpp:2910-2916``).
ASCII, SPECIAL = -1, -2
#: ``internal.modifier_keys`` / ``cOrthoSHIFT`` (``layer1/Ortho.h:20``) agree: 1.
MOD_NONE, MOD_SHFT = 0, 1


def gap(a, b) -> float:
    return max(abs(float(x) - float(y)) for x, y in zip(a, b))


def settle_seconds(ws: WSClient, target, limit: float = 10.0) -> float:
    start = time.monotonic()
    while time.monotonic() - start < limit:
        if gap(ws.call("cmd.get_view"), target) < 1e-4:
            return time.monotonic() - start
        time.sleep(0.02)
    return float("inf")


def scene_names(ws: WSClient) -> List[str]:
    return list(ws.call("cmd.get_scene_list") or [])


def storemask(ws: WSClient, name: str) -> int:
    panel = ws.call("cmd.get_scene_panel")
    for scene in panel["scenes"]:
        if scene["name"] == name:
            return int(scene["storemask"])
    raise AssertionError("no scene %r in %r" % (name, panel["order"]))


def press(ws: WSClient, code: int, mod: int = MOD_NONE, state: int = SPECIAL) -> None:
    """One forwarded keystroke, the envelope ``KeyboardService.tsx`` sends."""
    ws.input("button", button=code, state=state, x=0, y=0, mod=mod)
    time.sleep(0.6)


@pytest.fixture()
def camv(ws: WSClient):
    saved = {name: ws.call("cmd.get", name) for name in TOUCHED_SETTINGS}
    view = ws.call("cmd.get_view")
    ws.call("cmd.do", BOOTSTRAP, echo=0, log=0)

    ws.call("cmd.mstop")
    ws.call("cmd.rock", 0)
    ws.call("cmd.mset", "")
    ws.call("cmd.delete", "all")
    for name in scene_names(ws):
        ws.call("cmd.scene", name, "clear")
    ws.call("cmd.load", IL2, "zcv")
    # THE CAMERA ROTATION IS INHERITED AND `load` DOES NOT CLEAR IT.  With an
    # inherited yaw t0, `turn y 40` then `turn y -80` land
    # ``2*sin(40 deg)*max(|sin t0|,|cos t0|)`` apart, i.e. 0.909..1.286 —
    # measured at 0.9848 after test_movie_controls.py.  Reset first so the
    # sweep test can assert the distance to three decimals.
    ws.call("cmd.reset")
    # Animation OFF unless a test asks for it: `scene_animation` falls back to
    # `animation` (on) with a 2.25 s duration, so any recall in a test that is
    # not about animation would still be in flight at the assertion.
    for name in ("scene_animation", "animation"):
        ws.call("cmd.set", name, 0)

    # `test_shortcuts.py` leaves thirteen of these keys bound to a print.
    ws.do("/import pymol.keyboard")
    ws.do("pymol._zcv_keys = dict(cmd.key_mappings)")
    ws.do("cmd.key_mappings.clear()")
    ws.do("cmd.key_mappings.update(pymol.keyboard.get_default_keys())")

    yield ws

    ws.do("cmd.key_mappings.clear()")
    ws.do("cmd.key_mappings.update(pymol._zcv_keys)")
    ws.call("cmd.mstop")
    ws.call("cmd.rock", 0)
    ws.call("cmd.mset", "")
    for name in scene_names(ws):
        ws.call("cmd.scene", name, "clear")
    ws.call("cmd.delete", "all")
    for name, value in saved.items():
        ws.call("cmd.set", name, value)
    ws.call("cmd.set_view", view)


# ==========================================================================
# 00:330 — storemask, and the AND on the colour half
# ==========================================================================


def test_the_storemask_bit_layout_is_view_active_color_rep_frame(camv: WSClient) -> None:
    """Five scenes, one flag off each — the masks name the bits.

    MEASURED: 0x3E / 0x3D / 0x3B / 0x37 / 0x2F, i.e. bit0 VIEW, bit1 ACTIVE,
    bit2 COLOR, bit3 REP, bit4 FRAME, bit5 THUMBNAIL always on because
    ``cmd.scene`` has no ``thumbnail`` keyword at all (asserted below — a UI
    cannot ask for a scene without one).
    """
    expected = {
        "view": 0x3E,
        "active": 0x3D,
        "color": 0x3B,
        "rep": 0x37,
        "frame": 0x2F,
    }
    for flag, mask in expected.items():
        name = "zcv_" + flag
        camv.call("cmd.scene", name, "store", **{flag: 0})
        assert storemask(camv, name) == mask, flag

    camv.call("cmd.scene", "zcv_all", "store")
    assert storemask(camv, "zcv_all") == 0x3F

    reply = camv.call_reply("cmd.scene", "zcv_nothumb", "store", thumbnail=0)
    assert reply["t"] == "err"
    assert "unexpected keyword argument 'thumbnail'" in reply["error"]["message"]


def test_the_per_atom_colour_half_of_the_recall_is_ANDed_too(camv: WSClient) -> None:
    """``recall_color &= storemask & STORE_COLOR`` (``MovieScene.cpp:493``).

    The camera is the easy half.  The per-atom half is what makes a scene a
    scene: MEASURED on il2.pdb, 2084 atoms coloured blue are restored over red
    by a plain recall, are NOT restored when the caller passes ``color=0``, and
    are NOT restored by a scene stored with ``color=0`` even when the caller
    asks for colour.
    """
    total = camv.call("cmd.count_atoms", "zcv")
    assert total == 2084

    def blue() -> int:
        return camv.call("cmd.count_atoms", "zcv and color blue")

    camv.call("cmd.color", "blue", "zcv")
    assert blue() == total
    camv.call("cmd.scene", "C", "store")

    camv.call("cmd.color", "red", "zcv")
    assert blue() == 0
    camv.call("cmd.scene", "C", "recall")
    assert blue() == total, "the scene did not restore per-atom colour"

    # caller side of the AND
    camv.call("cmd.color", "red", "zcv")
    camv.call("cmd.scene", "C", "recall", color=0)
    assert blue() == 0

    # stored side of the AND: a scene with the COLOR bit clear
    camv.call("cmd.color", "blue", "zcv")
    camv.call("cmd.scene", "NC", "store", color=0)
    assert storemask(camv, "NC") == 0x3B
    camv.call("cmd.color", "red", "zcv")
    camv.call("cmd.scene", "NC", "recall")
    assert blue() == 0, "a scene stored with color=0 restored colour anyway"


# ==========================================================================
# 00:330 — the sweep really is scene_animation_duration seconds long
# ==========================================================================


@pytest.mark.parametrize("duration", [0.4, 1.0, 2.25])
def test_the_sweep_lasts_scene_animation_duration_seconds(
    camv: WSClient, duration: float
) -> None:
    """Timed to +-0.15 s low / +1.2 s high, so 0.4 and 2.25 cannot swap.

    MEASURED on this build: 2.25 -> 2.245 s, 1.0 -> 0.999 s, 0.4 -> 0.385 s.
    And in every case ``cmd.scene(..., 'recall', animate=-1)`` RETURNS FIRST:
    the delta to the target is still the full 1.2856 the instant the reply
    arrives.  That is the whole reason the client must not tween — the server
    is already interpolating and the client would only be told about it through
    ``get_view`` polling.
    """
    camv.call("cmd.set", "scene_animation", 1)
    camv.call("cmd.set", "animation", 1)
    camv.call("cmd.set", "scene_animation_duration", duration)

    camv.call("cmd.turn", "y", 40)
    camv.call("cmd.scene", "S", "store")
    target = camv.call("cmd.get_view")
    camv.call("cmd.turn", "y", -80)
    away = gap(camv.call("cmd.get_view"), target)
    assert away == pytest.approx(1.2856, abs=1e-3), away

    camv.call("cmd.scene", "S", "recall", animate=-1)
    at_return = gap(camv.call("cmd.get_view"), target)
    assert at_return > 1.0, ("the recall was already finished", at_return)

    took = settle_seconds(camv, target)
    assert duration - 0.15 < took < duration + 1.2, (duration, took)
    assert gap(camv.call("cmd.get_view"), target) < 1e-4


# ==========================================================================
# 00:330 — the OTHER half of `scene_frame_mode < 0 && MovieDefined`
# ==========================================================================


def test_scene_frame_mode_minus_one_restores_the_frame_with_no_movie_defined(
    camv: WSClient,
) -> None:
    """``MovieScene.cpp:414`` is a CONJUNCTION and both halves matter.

    With a movie defined, the default ``scene_frame_mode = -1`` suppresses the
    frame change.  With no movie defined — a multi-state object and no ``mset``
    — the same setting RESTORES it.  MEASURED: -1 -> frame 3, 0 -> frame 1,
    1 -> frame 3.  A client that shows "scenes do not restore the frame by
    default" is right only half the time.
    """
    for state in (1, 2, 3):
        camv.call("cmd.create", "zcvmulti", "zcv", 1, state)
    assert camv.call("cmd.count_states", "zcvmulti") == 3
    # frames exist because states do; `mset` was never called, so MovieDefined
    # is false -- that is the distinction the C tests.
    assert camv.call("cmd.count_frames") == 3
    assert camv.call("cmd.get_movie_length") == 0

    camv.call("cmd.frame", 3)
    assert camv.call("cmd.get_frame") == 3
    camv.call("cmd.scene", "NF", "store")

    for mode, expected in ((-1, 3), (0, 1), (1, 3)):
        camv.call("cmd.set", "scene_frame_mode", mode)
        camv.call("cmd.frame", 1)
        assert camv.call("cmd.get_frame") == 1
        camv.call("cmd.scene", "NF", "recall")
        assert camv.call("cmd.get_frame") == expected, mode


# ==========================================================================
# 00:336 — the one callable that DOES carry the views, and why it is no help
# ==========================================================================


def test_get_session_carries_the_views_but_only_as_an_opaque_blob(
    camv: WSClient,
) -> None:
    """``cmd.get_session`` is allowed and it does contain ``view_dict``.

    ``session_save_views`` (``viewing.py:1187``) is a registered session task,
    so the dict really is in there — but the bridge answers ``get_session``
    with a ``__blob__`` handle for a binary ``.pse``, not with the Python dict,
    so a panel would have to download and unpickle a half-megabyte file to read
    two names.  The failed-lookup message stays the only usable listing.

    ``cmd.session_save_views`` itself is not on ``pymol.cmd`` at all (it lives
    in the ``viewing`` module and is registered by reference), so it cannot be
    called to fill a caller-supplied dict either.
    """
    camv.call("cmd.view", "*", "clear")
    camv.call("cmd.view", "zalpha", "store")
    try:
        result = camv.call("cmd.get_session")
        assert isinstance(result, dict), result
        assert result.get("__blob__") is True, result
        assert sorted(result) == ["__blob__", "id", "mime", "name", "size", "url"]
        assert result["mime"] == "application/octet-stream"
        assert "view_dict" not in result

        assert camv.call_reply("cmd.session_save_views", {})["t"] == "err"
        assert camv.call_reply("cmd.get_view_list")["t"] == "err"
    finally:
        camv.call("cmd.view", "*", "clear")


# ==========================================================================
# 00:340 — the shifted keys nobody forwarded
# ==========================================================================


@pytest.fixture()
def movied(camv: WSClient):
    camv.call("cmd.mset", "1 x30")
    camv.call("cmd.frame", 10)
    camv.call("cmd.mstop")
    yield camv
    camv.call("cmd.mstop")


def test_shift_space_is_rewind_then_play(movied: WSClient) -> None:
    """``Ortho.cpp:866-874`` — ``mod & cOrthoSHIFT`` on an empty command line.

    Not the same key as bare space (``mtoggle``), and it needs NO presentation
    mode: the shift branch is outside the ``presentation`` test, so it can be
    exercised without arming ``presentation_auto_quit`` (default 1,
    ``SettingInfo.h:510``), which is what makes bare space in presentation mode
    unsafe to test.

    MEASURED: from a stopped movie sitting on frame 10, one SHFT-space leaves
    ``get_movie_playing() == 1`` and the frame past the rewind (26 when the
    sample was taken 1 s later) — i.e. it rewound to 1 and started playing,
    which is exactly ``rewind;mplay``.

    TWO GUARDS, both needed and both measured in the full-suite run: an ascii
    key only QUEUES (``OrthoCommandIn``) and is drained by a draw, so the
    ``pixels`` subscription is what makes the pump draw; and the branch is gated
    on ``I->CurChar == I->PromptChar``, so one stray printable character left on
    the shared ortho command line by an earlier test turns this into a literal
    space.  Backspace on an empty line is a no-op (``Ortho.cpp:893-894``).
    """
    assert movied.subscribe("pixels")["t"] == "ok"
    time.sleep(1.2)
    for _ in range(8):
        movied.input("button", button=8, state=ASCII, x=0, y=0, mod=MOD_NONE)
    time.sleep(1.2)

    assert movied.call("cmd.get_movie_playing") == 0
    assert movied.call("cmd.get_frame") == 10

    press(movied, ord(" "), MOD_SHFT, ASCII)
    time.sleep(0.7)
    assert movied.call("cmd.get_movie_playing") == 1, "SHFT-space did not play"
    first = movied.call("cmd.get_frame")
    time.sleep(0.4)
    assert movied.call("cmd.get_frame") != first, "the movie is not advancing"

    movied.call("cmd.mstop")
    assert movied.call("cmd.get_movie_playing") == 0


def test_shft_home_and_shft_end_are_rewind_and_ending(movied: WSClient) -> None:
    """The SHFT- specials differ from the bare keys and were only read, not sent.

    bare home = ``zoom animate=-1``, SHFT-home = ``rewind``;
    bare end = ``mtoggle``, SHFT-end = ``ending``.  MEASURED: frame 10 -> 1 -> 30
    with the movie left stopped throughout.
    """
    press(movied, K_HOME, MOD_SHFT)
    assert movied.call("cmd.get_frame") == 1
    assert movied.call("cmd.get_movie_playing") == 0, "rewind must not start it"

    press(movied, K_END, MOD_SHFT)
    assert movied.call("cmd.get_frame") == 30
    assert movied.call("cmd.get_movie_playing") == 0, "ending must not start it"
