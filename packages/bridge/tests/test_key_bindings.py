"""Parity area 11 — the key-binding contract, from `set_key` to invocation.

`test_shortcuts.py` covers what `cmd.set_key` ACCEPTS. This covers what happens
when a key is actually pressed, which is a different question and has two
surprises in it: the GLUT numeric codes, and the fallbacks that fire when a key
has no binding at all.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_key_bindings.py -q
"""

from __future__ import annotations

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")

#: `keyboard.get_default_keys()` GLUT codes, from the row.
GLUT_CODES = {
    "F1": 1, "F12": 12,
    "left": 100, "up": 101, "right": 102, "down": 103,
    "pgup": 104, "pgdn": 105, "home": 106, "end": 107, "insert": 108,
}


@pytest.fixture()
def still(ws: WSClient):
    """A scene with animation OFF and the view restored afterwards.

    ANIMATION IS NOT A DETAIL HERE. Both fallbacks below recall through
    `cmd.scene`/`cmd.view`, which animate by default — so reading `get_view`
    straight after a key press returns a MID-ANIMATION value and the
    assertions fail for a reason that has nothing to do with key handling.
    That is exactly how the first version of this file failed.
    """
    # BOTH settings, not just one. `scene_animation_duration` governs scene
    # recall; `animation` governs `cmd.view`. Setting only the first left the
    # view fallback mid-flight and the assertion failed on a number that was
    # simply not there yet.
    saved = {
        name: ws.call("cmd.get", name)
        for name in ("scene_animation_duration", "animation")
    }
    for name in saved:
        ws.call("cmd.set", name, 0)
    ws.call("cmd.delete", "all")
    # CLEAR SCENES AT SETUP, not just teardown. The parametrised GLUT-code test
    # presses `left`, `right`, `pgup` and `pgdn`, and those have DEFAULT
    # bindings — they move the camera and step scenes. Left behind, they made
    # the fallback assertions below land 2.5% off a stored view, which reads
    # exactly like an animation problem and is not one.
    for name in ws.call("cmd.get_scene_list") or []:
        ws.call("cmd.scene", name, "clear")
    ws.call("cmd.load", IL2, "zk_obj")
    view = ws.call("cmd.get_view")
    yield ws
    for name, value in saved.items():
        ws.call("cmd.set", name, value)
    ws.call("cmd.set_view", view)
    for name in ws.call("cmd.get_scene_list") or []:
        if name.startswith("F"):
            ws.call("cmd.scene", name, "clear")
    ws.call("cmd.delete", "zk_obj")


def settled(ws: WSClient, tries: int = 40) -> list:
    """`get_view` once it STOPS CHANGING.

    Polling rather than sleeping a guess. Both fallbacks recall through
    `cmd.scene`/`cmd.view`, which animate, and turning the animation settings
    off did not reliably make the recall instantaneous — measured, the view was
    still moving 1.2 s later. Waiting for the value to stabilise asks the
    question that actually matters ("where did it end up") instead of betting
    on a duration.
    """
    previous = ws.call("cmd.get_view")
    for _ in range(tries):
        time.sleep(0.1)
        current = ws.call("cmd.get_view")
        if all(abs(a - b) < 1e-6 for a, b in zip(current, previous)):
            return current
        previous = current
    return previous


# ----------------------------------------------------------------- mappings


def test_key_mappings_is_a_dict_of_defaults(ws: WSClient, bridge) -> None:
    """125 entries on this build, from `keyboard.get_default_keys()`."""
    ws.do(
        "print('ZKB_MAP', type(cmd.key_mappings).__name__, len(cmd.key_mappings))"
    )
    lines = bridge.wait_for_feedback("ZKB_MAP", timeout=5.0)
    got = [x for x in lines if "ZKB_MAP" in x and "print(" not in x]
    assert got, lines[-5:]
    assert "dict" in got[-1] and "125" in got[-1], got[-1]


def test_a_callable_binding_fires_through_the_special_path(still, bridge) -> None:
    """`cmd._special(code, x, y)` is how C invokes a special key.

    F4 is code 4 — the codes are GLUT's, not ASCII, and not the position in
    some list. Getting that wrong fires the wrong binding silently.
    """
    still.do("cmd.set_key('F4', lambda: print('ZKB_F4 fired'))")
    try:
        assert still.call_reply("cmd._special", 4, 0, 0)["t"] == "ok"
        lines = bridge.wait_for_feedback("ZKB_F4", timeout=5.0)
        assert any("ZKB_F4 fired" in line for line in lines), lines[-5:]
    finally:
        still.call("cmd.set_key", "F4", "")


@pytest.mark.parametrize("name,code", sorted(GLUT_CODES.items()))
def test_each_glut_code_really_maps_to_the_key_it_claims(still, bridge, name, code):
    """Bind, press, assert, unbind — which proves the MAPPING, not just the call.

    An earlier version just asserted `_special(code)` returned ok. That was
    weak (an unbound key is a no-op, so every code "passed") and it was
    DESTRUCTIVE: `left`, `right`, `pgup`, `pgdn`, `home`, `end` and `insert`
    all have default bindings that move the camera, step frames or toggle
    editing. Pressing them for real left state behind that made the fallback
    tests below land 2.5 % off a stored view — a failure that looks exactly
    like an animation bug and is not one.

    Binding each key to a print first tests the code-to-name mapping exactly
    and shadows the default binding while doing it.
    """
    tag = "ZKB_%s" % name
    # SAVE THE ORIGINAL ENTRY, not `set_key(name, '')` afterwards: for a key
    # with a default binding that does not restore it, it DELETES it, and the
    # arrows and page keys would stay dead for the rest of the process.
    still.do("zk_saved = cmd.key_mappings.get(%r)" % name)
    still.do("cmd.set_key(%r, lambda: print(%r))" % (name, tag + " fired"))
    try:
        assert still.call_reply("cmd._special", code, 0, 0)["t"] == "ok", (name, code)
        lines = bridge.wait_for_feedback(tag, timeout=5.0)
        assert any(tag + " fired" in line for line in lines), (name, code, lines[-4:])
    finally:
        still.do(
            "cmd.key_mappings[%r] = zk_saved if zk_saved is not None "
            "else cmd.key_mappings.pop(%r, None)" % (name, name)
        )


# ---------------------------------------------------------------- fallbacks


def test_an_unbound_key_falls_back_to_a_SCENE_of_the_same_name(still) -> None:
    """`_invoke_key` tries scene names before giving up.

    So creating a scene called "F6" silently makes F6 recall it, with no
    `set_key` anywhere. A shortcut editor that lists only `key_mappings` will
    not show this binding, and a user who wonders why F6 "does something" will
    not find it there.
    """
    still.call("cmd.turn", "y", 60)
    still.call("cmd.scene", "F6", "store")
    stored = still.call("cmd.get_view")

    still.call("cmd.turn", "y", -120)
    moved_away = still.call("cmd.get_view")

    still.call("cmd._special", 6, 0, 0)
    after = settled(still)

    assert all(abs(a - b) < 1e-3 for a, b in zip(after, stored)), (after, stored)
    assert any(abs(a - b) > 1e-3 for a, b in zip(after, moved_away))


def test_and_then_to_a_VIEW_of_the_same_name(still) -> None:
    """The second fallback, after scenes."""
    still.call("cmd.turn", "x", 45)
    stored = still.call("cmd.get_view")
    still.call("cmd.view", "F7", "store")

    still.call("cmd.turn", "x", -90)
    still.call("cmd._special", 7, 0, 0)
    after = settled(still)

    assert all(abs(a - b) < 1e-2 for a, b in zip(after, stored)), (after, stored)


def test_the_modifier_entry_points_take_fewer_arguments(ws: WSClient) -> None:
    """`_ctrl`/`_alt`/`_ctsh` are NOT `_special`'s signature.

    Measured: they take 1 to 2 positional arguments where `_special` takes 3.
    A client that called them uniformly would get a TypeError on three of the
    four chord paths.
    """
    for symbol in ("cmd._ctrl", "cmd._alt", "cmd._ctsh"):
        reply = ws.call_reply(symbol, 4, 0, 0)
        assert reply["t"] == "err", symbol
        assert "positional argument" in reply["error"]["message"], reply
