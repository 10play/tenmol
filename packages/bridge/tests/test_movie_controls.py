"""Parity area 4 — the movie control bar and the scene-button mouse behaviour.

Both rows are UI, but every button bottoms out in a `cmd.*` call, and two of
those calls do NOT do what their button does. That is what this file pins.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_movie_controls.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")


@pytest.fixture()
def movie(ws: WSClient):
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zmc_obj")
    ws.call("cmd.mset", "1 x30")
    saved = {name: ws.call("cmd.get", name) for name in ("sculpting", "rock", "seq_view")}
    yield ws
    ws.call("cmd.mstop")
    for name, value in saved.items():
        ws.call("cmd.set", name, value)
    ws.call("cmd.mset", "")
    ws.call("cmd.delete", "zmc_obj")


# ---------------------------------------------------------- the nine buttons


@pytest.mark.parametrize(
    "fn,args",
    [
        ("cmd.rewind", []),      # 0
        ("cmd.backward", []),    # 1
        ("cmd.mstop", []),       # 2
        ("cmd.mplay", []),       # 3
        ("cmd.mtoggle", []),
        ("cmd.forward", []),     # 4
        ("cmd.ending", []),      # 5
        ("cmd.middle", []),      # 5 with Ctrl
        ("cmd.rock", [1]),       # 7
        ("cmd.rock", [0]),
    ],
)
def test_each_transport_command_is_callable(movie: WSClient, fn, args) -> None:
    assert movie.call_reply(fn, *args)["t"] == "ok", (fn, args)


def test_the_scrollbar_seek_uses_mode_7(movie: WSClient) -> None:
    """`SceneSetFrame(G, 7, v)` — absolute, forced command.

    Mode matters: a plain `cmd.frame` does not carry the movie command, so
    dragging the scrollbar with it would move the frame without running what
    the movie says happens there.
    """
    movie.call("cmd.set_frame", 5, 7)
    assert movie.call("cmd.get_frame") == 5


def test_mstop_alone_does_NOT_clear_sculpting_or_rock(movie: WSClient) -> None:
    """Button 2 does three things; `cmd.mstop` is only one of them.

    `CControl::release` case 2 writes BOTH settings and then logs
    `cmd.mstop()`, so the log line understates what the button did. Measured:
    after `cmd.mstop`, `sculpting` and `rock` are both still on.

    A client wiring the Stop button to `cmd.mstop` alone would leave the model
    sculpting and the camera rocking — which is what the log line invites.
    `TransportBar.onStop` composes all three, in `CControl`'s order.
    """
    movie.call("cmd.set", "sculpting", 1)
    movie.call("cmd.rock", 1)
    movie.call("cmd.mstop")

    assert movie.call("cmd.get", "sculpting") == "on"
    assert movie.call("cmd.get", "rock") == "on"


def test_full_screen_is_not_available_headlessly(movie: WSClient) -> None:
    """Button 8 has nothing to make full screen.

    There is no window in this process, so `cmd.full_screen` fails. Recorded so
    the button's behaviour in the web client is a decision rather than a
    surprise: it cannot mean what it means on the desktop.
    """
    assert movie.call_reply("cmd.full_screen")["t"] == "err"


# ------------------------------------------------------------ scene buttons


@pytest.fixture()
def scenes(ws: WSClient):
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zmc_scene")
    for name in ws.call("cmd.get_scene_list") or []:
        ws.call("cmd.scene", name, "clear")
    yield ws
    for name in ws.call("cmd.get_scene_list") or []:
        ws.call("cmd.scene", name, "clear")
    ws.call("cmd.delete", "zmc_scene")


def test_left_click_recalls_WITH_interpolation_and_ctrl_browse_without(scenes) -> None:
    """Left = animated recall; middle+Ctrl = `animate=0` rapid browse.

    The `animate` argument is the whole difference between the two bindings, so
    both spellings are exercised rather than assumed interchangeable.
    """
    scenes.call("cmd.scene", "zsA", "store")
    scenes.call("cmd.turn", "y", 40)
    scenes.call("cmd.scene", "zsB", "store")

    assert scenes.call_reply("cmd.scene", "zsA", "recall")["t"] == "ok"
    assert scenes.call_reply("cmd.scene", "zsB", "recall", animate=0)["t"] == "ok"


def test_dragging_across_entries_reorders(scenes: WSClient) -> None:
    """Right-press-and-drag issues `cmd.scene_order`, and it really reorders."""
    for name in ("zs1", "zs2", "zs3"):
        scenes.call("cmd.scene", name, "store")
    assert scenes.call("cmd.get_scene_list") == ["zs1", "zs2", "zs3"]

    scenes.call("cmd.scene_order", "zs3 zs1 zs2")
    assert scenes.call("cmd.get_scene_list") == ["zs3", "zs1", "zs2"]


def test_scene_order_accepts_the_location_form(scenes: WSClient) -> None:
    """`scene_order(location='top')` is the drag-to-the-top case."""
    for name in ("zs1", "zs2", "zs3"):
        scenes.call("cmd.scene", name, "store")
    assert (
        scenes.call_reply("cmd.scene_order", "zs3", location="top")["t"] == "ok"
    )
    assert scenes.call("cmd.get_scene_list")[0] == "zs3"
