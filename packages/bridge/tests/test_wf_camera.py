"""Parity area 7 — camera, named views, scene-recall policy, frame keys.

Four inventory rows, all of them backend-observable, all of them measured over
the socket rather than read out of the C++:

  ``00:330``  Scene recall — animation and frame policy
  ``00:336``  Named camera views (``cmd.view``)
  ``00:337``  zoom / center / orient / origin / clip / turn / move / reset /
              viewport / stereo / full_screen
  ``00:340``  Keyboard bindings for frames, scenes and rocking

Findings that are defects rather than parity notes, each called out at its test:

  * ``cmd.viewport(w, h)`` is a **silent no-op** on the bridge.  ``CmdViewport``
    (``packages/engine/layer4/Cmd.cpp:4966``) ends in ``PyMOL_NeedReshape(..., mode 2, ...)``,
    which — because the bridge runs with ``no_gui=0``, so ``G->HaveGUI`` is true
    (``packages/engine/layer5/PyMOL.cpp:2537-2547``) — only *raises a flag* for the embedding
    application to read back with ``PyMOL_GetReshapeInfo``.  Nothing in the
    bridge reads it.  The size only changes through ``{t:'input',
    kind:'reshape'}``.
  * ``cmd.full_screen`` raises on this build, both directions.
  * ``cmd.stereo('off')`` does not put ``stereo_mode`` back; the last mode stays
    latched.  A UI that shows the mode from the setting will show "walleye"
    while stereo is off.
  * ``cmd.view(key, 'update')`` can never run: ``view_sc`` does not contain the
    word, so the branch handling it is dead.  ``store`` is the overwrite.
  * A view named ``_x`` becomes permanently unrecallable the next time any view
    is cleared, because the Shortcut index is rebuilt with a constructor that
    drops ``_``-prefixed keywords.
  * ``scene new, insert_before`` (CTRL-pgup) silently does not reorder when the
    current scene is the first one.

SUITE HAZARD, worked around in the fixture rather than by weakening anything:
``test_shortcuts.py::test_set_key_accepts`` permanently rebinds left, right,
pgup, pgdn, home, end, insert, up, down, F1, SHFT-F1, CTRL-F1 and CTRL-pgup to
``print("tenmol shortcut probe")``.  Every forwarded-key test below passes alone
and fails after that file until the key table is reset.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_wf_camera.py -q
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")

#: ``packages/bridge/tests/test_movie.py:32`` — one silent import installs the panel
#: endpoints, and ``cmd.get_scene_panel`` is the only reader of ``storemask``
#: anywhere (there is no ``cmd`` getter for it; ``panels/movie.py:413``).
BOOTSTRAP = "/import tenmol_bridge.panels.movie"

#: Settings this file writes.  EVERY ONE OF THEM IS PROCESS-GLOBAL and the whole
#: suite shares one PyMOL, so the fixture restores them by value.  ``stereo``
#: and ``stereo_mode`` are here because ``cmd.stereo('off')`` restores neither.
TOUCHED_SETTINGS = (
    "animation",
    "animation_duration",
    "scene_animation",
    "scene_animation_duration",
    "scene_frame_mode",
    "stereo",
    "stereo_mode",
)

#: GLUT special codes (``packages/engine/modules/pymol/internal.py:398-421``).
K_F1, K_F2, K_F3 = 1, 2, 3
K_LEFT, K_RIGHT = 100, 102
K_PGUP, K_PGDN = 104, 105
K_HOME, K_END, K_INSERT = 106, 107, 108
#: ``_button`` states (``packages/engine/layer5/PyMOL.cpp:2910-2916``).
ASCII, SPECIAL = -1, -2
#: ``internal.modifier_keys`` is indexed by the raw mask, so 3 is CTSH.
MOD_NONE, MOD_CTRL, MOD_CTSH, MOD_ALT = 0, 2, 3, 4


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def gap(a, b) -> float:
    """Largest per-element difference between two view vectors."""
    return max(abs(float(x) - float(y)) for x, y in zip(a, b))


def settled(ws: WSClient, tries: int = 60) -> List[float]:
    """``get_view`` once it stops changing — see ``test_key_bindings.settled``."""
    previous = ws.call("cmd.get_view")
    for _ in range(tries):
        time.sleep(0.05)
        current = ws.call("cmd.get_view")
        if gap(current, previous) < 1e-6:
            return current
        previous = current
    return previous


def settle_seconds(ws: WSClient, target, limit: float = 8.0) -> float:
    """Seconds until ``get_view`` reaches ``target``."""
    start = time.monotonic()
    while time.monotonic() - start < limit:
        if gap(ws.call("cmd.get_view"), target) < 1e-4:
            return time.monotonic() - start
        time.sleep(0.02)
    return float("inf")


_TAG_SEQ = [0]


def printed(ws: WSClient, bridge: Any, tag: str, expr: str) -> str:
    """``print(TAG, expr)`` and the line it produced, echo line skipped.

    Attributes are not fetchable over the bridge — the dispatcher only invokes
    CALLABLES — so ``cmd.key_mappings`` and ``pymol._view_dict`` can only be
    read this way.  PyMOL echoes the command *before* running it, hence the
    ``print(`` filter.

    THE TAG IS MADE UNIQUE per call.  ``feedback_lines()`` is a ring covering
    the whole session, so a tag used twice matches the OLD line as well and
    ``wait_for_feedback`` returns immediately with the previous answer — which
    is how the first version of the key-binding test "proved" that ``right``
    was bound to ``_ backward``.
    """
    _TAG_SEQ[0] += 1
    stamped = "%s#%d " % (tag, _TAG_SEQ[0])
    ws.do("print(%r, %s)" % (stamped, expr))
    lines = bridge.wait_for_feedback(stamped, timeout=5.0)
    # The echo is the prompt line, `PyMOL>print(...)`. Filtering on "print("
    # instead would also drop the ANSWER whenever the value being printed is
    # itself a command containing `print(` -- which is exactly what a key
    # binding left behind by test_shortcuts.py looks like.
    got = [line for line in lines if stamped in line and not line.startswith("PyMOL>")]
    assert got, (stamped, lines[-5:])
    return got[-1]


def scene_names(ws: WSClient) -> List[str]:
    return list(ws.call("cmd.get_scene_list") or [])


def storemask(ws: WSClient, name: str) -> int:
    panel = ws.call("cmd.get_scene_panel")
    for scene in panel["scenes"]:
        if scene["name"] == name:
            return int(scene["storemask"])
    raise AssertionError("no scene %r in %r" % (name, panel["order"]))


# --------------------------------------------------------------------------
# fixture
# --------------------------------------------------------------------------


@pytest.fixture()
def cam(ws: WSClient):
    """One molecule, no movie, no scenes, no views, no animation.

    ANIMATION OFF BY DEFAULT is not laziness: ``scene_animation`` falls back to
    ``animation`` (on) and ``scene_animation_duration`` is 2.25 s, so a recall
    in any test that is not *about* animation would still be in flight when the
    assertion runs.  The three tests that care turn it back on explicitly.
    """
    saved = {name: ws.call("cmd.get", name) for name in TOUCHED_SETTINGS}
    view = ws.call("cmd.get_view")
    ws.call("cmd.do", BOOTSTRAP, echo=0, log=0)

    ws.call("cmd.mstop")
    ws.call("cmd.rock", 0)
    ws.call("cmd.mset", "")
    ws.call("cmd.delete", "all")
    for name in scene_names(ws):
        ws.call("cmd.scene", name, "clear")
    ws.call("cmd.view", "*", "clear")
    ws.call("cmd.load", IL2, "zwf")
    # THE CAMERA ROTATION IS INHERITED AND `load` DOES NOT CLEAR IT.  Several
    # tests below do `turn y 40` / `turn y -80` and then assert that the two
    # views are more than 1.0 apart; that distance is
    # ``2*sin(40 deg) * max(|sin t0|, |cos t0|)`` for an inherited yaw ``t0``,
    # i.e. anywhere in 0.909..1.286.  MEASURED: run after test_movie_controls.py
    # it comes out at 0.9848 and those tests fail with what looks exactly like a
    # product bug.  One reset makes the starting orientation deterministic.
    ws.call("cmd.reset")
    for name in ("scene_animation", "animation"):
        ws.call("cmd.set", name, 0)

    # THE KEY TABLE IS PROCESS-GLOBAL AND ARRIVES DIRTY IN A FULL-SUITE RUN.
    # `test_shortcuts.py::test_set_key_accepts` binds left, right, pgup, pgdn,
    # home, end, insert, up, down, F1, SHFT-F1, CTRL-F1 and CTRL-pgup to
    # `print("tenmol shortcut probe")` and never restores them — measured: run
    # alone every forwarded-key test below passes, run after test_shortcuts.py
    # they all fail because the key prints instead of moving the engine.
    # Reset to the REAL defaults for the duration and put the snapshot back
    # verbatim afterwards, so this fixture changes nothing for anyone else.
    ws.do("/import pymol.keyboard")
    ws.do("pymol._zwf_keys = dict(cmd.key_mappings)")
    ws.do("cmd.key_mappings.clear()")
    ws.do("cmd.key_mappings.update(pymol.keyboard.get_default_keys())")

    yield ws

    ws.do("cmd.key_mappings.clear()")
    ws.do("cmd.key_mappings.update(pymol._zwf_keys)")
    ws.call("cmd.mstop")
    ws.call("cmd.rock", 0)
    ws.call("cmd.mset", "")
    for name in scene_names(ws):
        ws.call("cmd.scene", name, "clear")
    ws.call("cmd.view", "*", "clear")
    ws.call("cmd.delete", "all")
    for name, value in saved.items():
        ws.call("cmd.set", name, value)
    ws.call("cmd.set_view", view)


# ==========================================================================
# 00:330 — scene recall: animation and frame policy
# ==========================================================================


def test_a_recall_flag_is_ANDed_with_the_stored_storemask(cam: WSClient) -> None:
    """``MovieScene.cpp:487-491`` — both halves have to be true.

    Two directions, because only testing one of them passes with the AND
    written as either operand:

      * a scene stored WITHOUT the view (mask 47, no ``STORE_VIEW``) does not
        move the camera even though ``recall_view`` defaults to 1;
      * a scene stored WITH the view does not move it when the caller passes
        ``view=0``.
    """
    cam.call("cmd.turn", "y", 35)
    cam.call("cmd.scene", "noview", "store", view=0)
    parked = cam.call("cmd.get_view")
    cam.call("cmd.turn", "y", -70)
    moved = cam.call("cmd.get_view")

    assert storemask(cam, "noview") == 0x3E, "view bit must be clear"
    cam.call("cmd.scene", "noview", "recall")
    assert gap(cam.call("cmd.get_view"), moved) == 0.0
    assert gap(cam.call("cmd.get_view"), parked) > 1.0

    cam.call("cmd.scene", "withview", "store")
    target = cam.call("cmd.get_view")
    assert storemask(cam, "withview") == 0x3F
    cam.call("cmd.turn", "y", 55)
    elsewhere = cam.call("cmd.get_view")
    cam.call("cmd.scene", "withview", "recall", view=0)
    assert gap(cam.call("cmd.get_view"), elsewhere) == 0.0
    cam.call("cmd.scene", "withview", "recall")
    assert gap(cam.call("cmd.get_view"), target) == 0.0


def test_animate_minus_one_resolves_scene_animation_then_animation(cam: WSClient) -> None:
    """``get_scene_animation_duration`` (``MovieScene.cpp:428-437``).

    ``scene_animation`` < 0 delegates to ``animation``; 0 anywhere in that
    chain means the recall is instantaneous.  MEASURED on this build: with the
    stock settings (``scene_animation=-1``, ``animation=on``) the camera has
    NOT moved at all when ``cmd.scene(...,'recall')`` returns — the delta to the
    target is still the full 1.286 it was before the call — and it arrives
    2.25 s later, which is ``scene_animation_duration`` exactly.
    """
    cam.call("cmd.turn", "y", 40)
    cam.call("cmd.scene", "S", "store")
    target = cam.call("cmd.get_view")

    def recall_from_afar() -> None:
        cam.call("cmd.turn", "y", -80)
        assert gap(cam.call("cmd.get_view"), target) > 1.0
        cam.call("cmd.scene", "S", "recall", animate=-1)

    # scene_animation = 0 -> off, whatever `animation` says
    cam.call("cmd.set", "scene_animation", 0)
    cam.call("cmd.set", "animation", 1)
    recall_from_afar()
    assert gap(cam.call("cmd.get_view"), target) == 0.0

    # scene_animation = -1 -> read `animation`, which is off
    cam.call("cmd.set", "scene_animation", -1)
    cam.call("cmd.set", "animation", 0)
    recall_from_afar()
    assert gap(cam.call("cmd.get_view"), target) == 0.0

    # scene_animation = -1 -> read `animation`, which is now ON: animated.
    cam.call("cmd.set", "animation", 1)
    cam.call("cmd.set", "scene_animation_duration", 1.0)
    recall_from_afar()
    assert gap(cam.call("cmd.get_view"), target) > 1.0, "recall returned already there"
    took = settle_seconds(cam, target)
    assert 0.2 < took < 5.0, took
    assert gap(settled(cam), target) < 1e-4


def test_scene_animation_duration_is_the_sweep_length(cam: WSClient) -> None:
    """2.25 s by default (``SettingInfo.h:506``), and it really is the clock.

    Two sweeps of the same recall, 0.4 s and 2.25 s, timed over the socket.
    The bound is deliberately loose (the poll is 20 ms and the engine advances
    the interpolation on draws) — what is being pinned is that the setting
    drives the duration, not that the wall clock is exact.
    """
    assert float(cam.call("cmd.get", "scene_animation_duration")) == pytest.approx(2.25)

    cam.call("cmd.turn", "y", 40)
    cam.call("cmd.scene", "S", "store")
    target = cam.call("cmd.get_view")
    cam.call("cmd.set", "scene_animation", 1)

    def timed(duration: float) -> float:
        cam.call("cmd.set", "scene_animation_duration", duration)
        cam.call("cmd.turn", "y", -80)
        cam.call("cmd.scene", "S", "recall", animate=-1)
        return settle_seconds(cam, target)

    quick = timed(0.4)
    slow = timed(2.25)
    assert quick < 1.5, quick
    assert slow > 1.2, slow
    assert slow > quick


def test_an_explicit_animate_overrides_the_settings(cam: WSClient) -> None:
    """``animate`` only falls through to the settings when it is < -0.5."""
    cam.call("cmd.set", "scene_animation", 1)
    cam.call("cmd.set", "animation", 1)
    cam.call("cmd.turn", "y", 40)
    cam.call("cmd.scene", "S", "store")
    target = cam.call("cmd.get_view")
    cam.call("cmd.turn", "y", -80)
    cam.call("cmd.scene", "S", "recall", animate=0)
    assert gap(cam.call("cmd.get_view"), target) == 0.0


@pytest.fixture()
def frames(cam: WSClient):
    """A 60-frame movie with a scene stored at frame 20."""
    cam.call("cmd.mset", "1 x60")
    cam.call("cmd.frame", 20)
    cam.call("cmd.scene", "F", "store")
    assert cam.call("cmd.get_frame") == 20
    yield cam


@pytest.mark.parametrize(
    "mode,expected",
    [
        (-1, 3),  # the default: a movie IS defined here, so the frame is kept
        (0, 3),  # never
        (1, 20),  # always
    ],
)
def test_scene_frame_mode_decides_whether_the_frame_is_recalled(
    frames: WSClient, mode: int, expected: int
) -> None:
    """``MovieSceneRecallFrame`` (``MovieScene.cpp:406-417``).

    The default is -1, and with a movie defined that means the scene's frame is
    IGNORED — recalling a scene stored at frame 20 while sitting on frame 3
    leaves you on frame 3.  Worth knowing before building a UI that promises
    scenes restore the frame.
    """
    frames.call("cmd.set", "scene_frame_mode", mode)
    frames.call("cmd.frame", 3)
    frames.call("cmd.scene", "F", "recall")
    assert frames.call("cmd.get_frame") == expected


def test_the_frame_flag_is_ANDed_with_the_storemask_too(frames: WSClient) -> None:
    frames.call("cmd.set", "scene_frame_mode", 1)
    frames.call("cmd.frame", 44)
    frames.call("cmd.scene", "G", "store", frame=0)
    assert storemask(frames, "G") == 0x2F, "frame bit must be clear"
    frames.call("cmd.frame", 5)
    frames.call("cmd.scene", "G", "recall")
    assert frames.call("cmd.get_frame") == 5


@pytest.fixture()
def set_frame_spy(frames: WSClient):
    """Record every ``cmd.set_frame(frame, mode)`` the C recall path makes.

    ``MovieSceneRecallFrame`` cannot call ``SceneSetFrame`` directly — the
    comment at ``MovieScene.cpp:421-423`` says PBlock deadlocks — so it calls
    back out through ``G->P_inst->cmd.set_frame``.  ``P_inst->cmd`` IS the
    ``pymol.cmd`` module object the bridge dispatches into, so replacing the
    attribute observes the round trip, the 1-based frame and the mode.
    """
    frames.do("import pymol")
    frames.do("pymol._zwf_calls = []")
    frames.do("pymol._zwf_orig = cmd.set_frame")
    frames.do(
        "cmd.set_frame = lambda f, m=0, *a, **k: "
        "(pymol._zwf_calls.append((f, m)), pymol._zwf_orig(f, m, *a, **k))[1]"
    )
    try:
        yield frames
    finally:
        # A leaked monkeypatch here would follow the process into every other
        # test file, so it comes off even if the body raised.
        frames.do("cmd.set_frame = pymol._zwf_orig")


def test_the_frame_is_set_from_python_with_mode_4(set_frame_spy, bridge) -> None:
    ws = set_frame_spy
    ws.call("cmd.set", "scene_frame_mode", 1)
    ws.do("pymol._zwf_calls = []")
    ws.call("cmd.frame", 3)
    ws.call("cmd.scene", "F", "recall")
    time.sleep(0.2)
    # frame+1 because MovieScene stores the 0-based index (`MovieScene.cpp:427`)
    assert "[(20, 4)]" in printed(ws, bridge, "ZWF_MODE", "pymol._zwf_calls")


def test_an_unchanged_frame_is_not_set_at_all(set_frame_spy, bridge) -> None:
    """``if (frame == SceneGetFrame(G)) return;`` — no call, not a no-op call.

    The difference is visible: mode 4 carries the movie command for that frame,
    so re-running it on every scene recall would re-execute whatever the movie
    does there.
    """
    ws = set_frame_spy
    ws.call("cmd.set", "scene_frame_mode", 1)
    ws.call("cmd.frame", 20)
    ws.do("pymol._zwf_calls = []")
    ws.call("cmd.scene", "F", "recall")
    time.sleep(0.2)
    assert "[]" in printed(ws, bridge, "ZWF_NOOP", "pymol._zwf_calls")


def test_while_the_movie_plays_the_frame_is_seeked_with_mode_10(
    set_frame_spy, bridge
) -> None:
    """``MoviePlaying`` is tested FIRST, so it beats ``scene_frame_mode``.

    Measured with ``scene_frame_mode = 0`` — the value that suppresses the frame
    change entirely when the movie is stopped: while playing, the recall still
    fires ``set_frame(20, 10)``.  A client that mirrors "scene_frame_mode 0
    means scenes never touch the frame" would be wrong exactly when a movie is
    running.
    """
    ws = set_frame_spy
    ws.call("cmd.set", "scene_frame_mode", 0)
    ws.call("cmd.frame", 3)
    ws.do("pymol._zwf_calls = []")
    ws.call("cmd.mplay")
    time.sleep(0.2)
    ws.call("cmd.scene", "F", "recall")
    time.sleep(0.2)
    ws.call("cmd.mstop")
    assert "(20, 10)" in printed(ws, bridge, "ZWF_SEEK", "pymol._zwf_calls")


# ==========================================================================
# 00:336 — named camera views (cmd.view)
# ==========================================================================


def test_view_store_recall_and_clear_round_trip(cam: WSClient) -> None:
    cam.call("cmd.turn", "y", 45)
    stored = cam.call("cmd.get_view")
    cam.call("cmd.view", "alpha", "store")
    cam.call("cmd.turn", "y", -90)
    assert gap(cam.call("cmd.get_view"), stored) > 1.0

    cam.call("cmd.view", "alpha", "recall", animate=0)
    assert gap(cam.call("cmd.get_view"), stored) < 1e-5

    cam.call("cmd.view", "alpha", "clear")
    assert cam.call_reply("cmd.view", "alpha", "recall")["t"] == "err"


def test_a_unique_prefix_recalls_because_the_key_is_a_Shortcut(cam: WSClient) -> None:
    """``pymol._view_dict_sc.auto_err(key)`` (``viewing.py:835``).

    So ``view al`` recalls ``alpha`` — and adding a second view whose name
    starts with ``al`` turns that same call into an error.  A views panel that
    sends the user's raw text is sending a prefix, not a name.
    """
    cam.call("cmd.view", "alpha", "store")
    assert cam.call_reply("cmd.view", "al", "recall", animate=0)["t"] == "ok"
    cam.call("cmd.view", "album", "store")
    assert cam.call_reply("cmd.view", "al", "recall", animate=0)["t"] == "err"

    # An EXACT name always wins, even when it is also a prefix of another name:
    # `_rebuild_finalize` re-points every full keyword at itself last
    # (`shortcut.py:118-119`).  That is what makes a name button in a panel safe.
    cam.call("cmd.view", "al", "store")
    assert cam.call_reply("cmd.view", "al", "recall", animate=0)["t"] == "ok"


def test_a_leading_underscore_view_falls_out_of_the_index(cam: WSClient) -> None:
    """UPSTREAM QUIRK, measured — a view named ``_x`` becomes unrecallable.

    ``store`` uses ``_view_dict_sc.append`` (``shortcut.py:166``), which does NOT
    filter; ``clear`` rebuilds with ``Shortcut(pymol._view_dict.keys())``
    (``viewing.py:848``), and the constructor DROPS every keyword starting with
    ``_`` (``shortcut.py:27-31``).  So the view survives in the dict, vanishes
    from the index, and can never be recalled again.  A views panel should
    refuse the name rather than create one.
    """
    cam.call("cmd.view", "_hidden", "store")
    cam.call("cmd.view", "other", "store")
    assert cam.call_reply("cmd.view", "_hidden", "recall", animate=0)["t"] == "ok"

    cam.call("cmd.view", "other", "clear")  # rebuilds the index
    assert cam.call_reply("cmd.view", "_hidden", "recall", animate=0)["t"] == "err"


def test_the_only_machine_readable_listing_is_a_failed_lookup(cam: WSClient) -> None:
    """The contract the web Views panel parses, pinned here.

    ``Shortcut.auto_err`` (``shortcut.py:188-194``) puts the SORTED keyword list
    into the exception message when the lookup misses and there are fewer than
    100 of them.  Unlike ``cmd.view('*')`` — which only prints, so a client
    would have to scrape the shared feedback ring and race every other line —
    this arrives in the reply to the request that asked for it.

    Two shapes, both asserted, because the empty one is the one a naive parser
    gets wrong:

        "Error: unknown view: 'X'. Choices:\\n"
        "Error: unknown view: 'X'. Choices:\\n  alpha  beta   mu   "
    """
    probe = "__tenmol_view_probe__"
    empty = cam.call_reply("cmd.view", probe, "recall")
    assert empty["t"] == "err"
    assert empty["error"]["message"] == (
        "Error: unknown view: '%s'. Choices:\n" % probe
    ), empty["error"]["message"]

    for name in ("beta", "alpha", "mu"):
        cam.call("cmd.view", name, "store")
    full = cam.call_reply("cmd.view", probe, "recall")["error"]["message"]
    head, _, block = full.partition("Choices:\n")
    assert head == "Error: unknown view: '%s'. " % probe, full
    assert block.split() == ["alpha", "beta", "mu"], full


def test_star_lists_sorted_and_star_clear_empties(cam: WSClient, bridge) -> None:
    """``key='*'``: ``clear`` wipes the dict, anything else prints the names."""
    for name in ("zeta", "alpha", "mu"):
        cam.call("cmd.view", name, "store")
    assert "['alpha', 'mu', 'zeta']" in printed(
        cam, bridge, "ZWF_VIEWS", "sorted(pymol._view_dict)"
    )

    before = len(bridge.feedback_lines())
    cam.call("cmd.view", "*")
    # Use a polling loop instead of a fixed sleep — feedback lines are produced
    # asynchronously and 0.3 s is not always enough on a loaded CI runner.
    deadline = time.monotonic() + 5.0
    tail: list[str] = []
    while time.monotonic() < deadline:
        tail = bridge.feedback_lines()[before:]
        if any("view: stored views:" in line for line in tail):
            break
        time.sleep(0.05)
    assert any("view: stored views:" in line for line in tail), tail
    # `parsing.dump_str_list` lays the names out in columns, two leading spaces
    # and a trailing one -- this is the only listing the API offers.
    assert any(
        "alpha" in line and "mu" in line and "zeta" in line for line in tail
    ), tail

    cam.call("cmd.view", "*", "clear")
    assert "[]" in printed(cam, bridge, "ZWF_VIEWS2", "sorted(pymol._view_dict)")


def test_the_update_action_is_unreachable_dead_code(cam: WSClient) -> None:
    """``viewing.py:838`` handles ``action == 'update'``; nothing can send it.

    ``view_sc = Shortcut(['store','recall','clear'])`` (``viewing.py:64``) is
    applied first, and ``'update'`` is not a prefix of any of the three, so the
    branch is dead.  A UI must send ``store`` to overwrite an existing view.
    """
    cam.call("cmd.view", "alpha", "store")
    reply = cam.call_reply("cmd.view", "alpha", "update")
    assert reply["t"] == "err"
    assert "unknown action" in reply["error"]["message"], reply

    # store on an existing key overwrites in place -- that IS the update path.
    cam.call("cmd.turn", "x", 30)
    moved = cam.call("cmd.get_view")
    cam.call("cmd.view", "alpha", "store")
    cam.call("cmd.turn", "x", -60)
    cam.call("cmd.view", "alpha", "recall", animate=0)
    assert gap(cam.call("cmd.get_view"), moved) < 1e-5


def test_views_survive_a_session_save_and_load(cam: WSClient, bridge, tmp_path) -> None:
    """``session_save_views`` / ``session_restore_views`` (``viewing.py:1187``).

    They are registered as session tasks in ``cmd.py:41-45``, i.e. Python-side
    state riding in the ``.pse`` — nothing in C knows about it.
    """
    cam.call("cmd.turn", "y", 20)
    cam.call("cmd.view", "alpha", "store")
    cam.call("cmd.view", "beta", "store")
    path = str(tmp_path / "zwf_views.pse")
    cam.call("cmd.save", path)

    cam.call("cmd.view", "*", "clear")
    assert "[]" in printed(cam, bridge, "ZWF_S1", "sorted(pymol._view_dict)")

    cam.call("cmd.load", path)
    assert "['alpha', 'beta']" in printed(
        cam, bridge, "ZWF_S2", "sorted(pymol._view_dict)"
    )
    assert cam.call_reply("cmd.view", "alpha", "recall", animate=0)["t"] == "ok"


def test_there_is_no_call_that_returns_the_view_list(cam: WSClient) -> None:
    """The gap a Views panel runs into, pinned so it cannot be "fixed" silently.

    ``pymol._view_dict`` is a plain dict on a module, and the dispatcher only
    invokes CALLABLES, so every route to it is refused.  The listing therefore
    exists only as printed text (``cmd.view('*')``).  A ``get_view_list`` export
    alongside ``get_scene_panel`` in ``panels/movie.py`` is the fix; it is NOT
    applied here because that file is outside this slot.
    """
    cam.call("cmd.view", "alpha", "store")
    for symbol in ("cmd._pymol._view_dict", "pymol._view_dict", "cmd._view_dict"):
        reply = cam.call_reply(symbol)
        assert reply["t"] == "err", symbol
    assert cam.call_reply("cmd.get_view_list")["t"] == "err"


# ==========================================================================
# 00:337 — camera commands
# ==========================================================================


def test_reset_gives_identity_rotation_and_a_repeatable_view(cam: WSClient) -> None:
    cam.call("cmd.reset")
    view = cam.call("cmd.get_view")
    assert view[:9] == pytest.approx([1, 0, 0, 0, 1, 0, 0, 0, 1], abs=1e-6)
    # origin in model space is the object's centre; front/rear bracket it
    assert view[15] < -view[11] < view[16]

    cam.call("cmd.turn", "x", 33)
    cam.call("cmd.move", "z", 12)
    cam.call("cmd.reset")
    assert gap(cam.call("cmd.get_view"), view) == 0.0

    # reset(object) is a different operation: it resets that object's matrix
    # and leaves the camera alone.
    cam.call("cmd.translate", [7, 0, 0], object="zwf", camera=0)
    before = cam.call("cmd.get_view")
    assert cam.call_reply("cmd.reset", "zwf")["t"] == "ok"
    assert gap(cam.call("cmd.get_view"), before) == 0.0
    assert cam.call("cmd.get_object_matrix", "zwf") == pytest.approx(
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], abs=1e-6
    )


def test_turn_rotates_the_camera_about_a_primary_axis(cam: WSClient) -> None:
    """Exact numbers, because "the view changed" would pass for any bug."""
    cam.call("cmd.reset")
    home = cam.call("cmd.get_view")
    cam.call("cmd.turn", "y", 90)
    turned = cam.call("cmd.get_view")
    assert turned[:9] == pytest.approx([0, 0, -1, 0, 1, 0, 1, 0, 0], abs=1e-6)
    # only the rotation moved: origin, clipping planes and FOV are untouched
    assert turned[9:] == pytest.approx(home[9:], abs=1e-6)
    cam.call("cmd.turn", "y", -90)
    # not exactly 0: the round trip through the 3x3 costs 1.2e-7 (measured)
    assert gap(cam.call("cmd.get_view"), home) < 1e-6


def test_move_translates_the_camera_in_camera_space(cam: WSClient) -> None:
    """MEASURED deltas, `viewing.py:352`.

    ``move z, 10`` puts the origin 10 A further from the camera (``v[11]``
    +10) and pulls BOTH clipping planes in by 10 (``v[15]``, ``v[16]`` -10);
    ``move x, 5`` only shifts ``v[9]``.  Nothing else in the 18 floats moves.
    """
    cam.call("cmd.reset")
    before = cam.call("cmd.get_view")
    cam.call("cmd.move", "z", 10)
    after = cam.call("cmd.get_view")
    delta = [b - a for a, b in zip(before, after)]
    assert delta == pytest.approx(
        [0] * 11 + [10.0] + [0] * 3 + [-10.0, -10.0, 0.0], abs=1e-4
    )

    before = after
    cam.call("cmd.move", "x", 5)
    delta = [b - a for a, b in zip(before, cam.call("cmd.get_view"))]
    assert delta == pytest.approx([0] * 9 + [5.0] + [0] * 8, abs=1e-4)


def test_zoom_and_center_and_origin(cam: WSClient) -> None:
    """The three "point at something" commands, and how they differ.

    MEASURED on il2.pdb: ``zoom resi 20`` pulls the camera from 149.5 A to
    16.6 A and narrows the slab from 63.3 A to 7.0 A; ``center resi 20`` moves
    the origin to the same place but changes NEITHER the camera distance nor
    the slab; ``origin position=`` overrides the selection entirely.
    """
    cam.call("cmd.reset")
    home = cam.call("cmd.get_view")
    assert cam.call("cmd.count_atoms", "resi 20") == 12
    target = cam.call("cmd.get_position")  # centre of the current view, not resi 20

    cam.call("cmd.zoom", "resi 20", buffer=0)
    zoomed = cam.call("cmd.get_view")
    assert abs(zoomed[11]) < abs(home[11]) / 4
    assert (zoomed[16] - zoomed[15]) < (home[16] - home[15]) / 4
    assert zoomed[:9] == pytest.approx(home[:9], abs=1e-6), "zoom must not rotate"
    resi20 = zoomed[12:15]

    cam.call("cmd.reset")
    cam.call("cmd.center", "resi 20")
    centred = cam.call("cmd.get_view")
    assert centred[12:15] == pytest.approx(resi20, abs=1e-3)
    assert centred[11] == pytest.approx(home[11], abs=1e-4), "center must not zoom"
    assert (centred[16] - centred[15]) == pytest.approx(home[16] - home[15], abs=1e-3)
    assert cam.call("cmd.get_position") == pytest.approx(list(resi20), abs=1e-3)

    cam.call("cmd.origin", position=[1.0, 2.0, 3.0])
    assert cam.call("cmd.get_view")[12:15] == pytest.approx([1.0, 2.0, 3.0], abs=1e-5)
    assert list(target) != pytest.approx([1.0, 2.0, 3.0], abs=1e-5)


def test_orient_changes_the_rotation_and_reset_undoes_it(cam: WSClient) -> None:
    cam.call("cmd.reset")
    home = cam.call("cmd.get_view")
    cam.call("cmd.orient", "zwf")
    oriented = cam.call("cmd.get_view")
    assert gap(oriented[:9], home[:9]) > 0.1
    # still a rotation matrix: rows are unit length
    for row in (oriented[0:3], oriented[3:6], oriented[6:9]):
        assert sum(x * x for x in row) == pytest.approx(1.0, abs=1e-4)
    cam.call("cmd.reset")
    assert gap(cam.call("cmd.get_view"), home) == 0.0


def test_every_clip_mode_and_get_clip(cam: WSClient) -> None:
    """``clip_action_sc`` has SEVEN modes (``viewing.py:179``), not the five the
    docstring lists — ``near_set`` and ``far_set`` are absolute, the rest are
    relative.  ``get_clip`` returns ``(front, rear)`` == ``get_view()[15:17]``.
    """
    cam.call("cmd.reset")
    near0, far0 = cam.call("cmd.get_clip")
    assert [near0, far0] == pytest.approx(cam.call("cmd.get_view")[15:17], abs=1e-4)

    cam.call("cmd.clip", "near", -5)
    assert cam.call("cmd.get_clip") == pytest.approx([near0 + 5, far0], abs=1e-3)
    cam.call("cmd.clip", "far", 10)
    assert cam.call("cmd.get_clip") == pytest.approx([near0 + 5, far0 - 10], abs=1e-3)

    cam.call("cmd.clip", "slab", 20)
    near1, far1 = cam.call("cmd.get_clip")
    assert far1 - near1 == pytest.approx(20.0, abs=1e-3)
    cam.call("cmd.clip", "move", -5)
    assert cam.call("cmd.get_clip") == pytest.approx([near1 + 5, far1 + 5], abs=1e-3)

    assert cam.call_reply("cmd.clip", "atoms", 5, "zwf")["t"] == "ok"
    cam.call("cmd.clip", "near_set", 100)
    assert cam.call("cmd.get_clip")[0] == pytest.approx(100.0, abs=1e-3)
    cam.call("cmd.clip", "far_set", 200)
    assert cam.call("cmd.get_clip") == pytest.approx([100.0, 200.0], abs=1e-3)

    assert cam.call_reply("cmd.clip", "sideways", 1)["t"] == "err"


def test_stereo_modes_and_the_stereo_mode_that_stays_behind(cam: WSClient) -> None:
    """``cmd.stereo`` sets two settings and puts back only one.

    MEASURED: crosseye=2, walleye=3, geowall=4, sidebyside=5 all succeed and
    turn ``stereo`` on; ``quadbuffer`` and ``openvr`` are refused on this build;
    and after ``stereo off`` the ``stereo`` setting is off while ``stereo_mode``
    is still whatever was selected last.  A stereo menu that reads
    ``stereo_mode`` to draw its radio buttons will show a mode that is not in
    effect.
    """
    for name, expected in (
        ("crosseye", 2),
        ("walleye", 3),
        ("geowall", 4),
        ("sidebyside", 5),
    ):
        assert cam.call_reply("cmd.stereo", name)["t"] == "ok", name
        # `cmd.get` answers with the STRING form of an int setting.
        assert int(cam.call("cmd.get", "stereo_mode")) == expected, name
        assert cam.call("cmd.get", "stereo") == "on", name

    for name in ("quadbuffer", "openvr"):
        assert cam.call_reply("cmd.stereo", name)["t"] == "err", name

    cam.call("cmd.stereo", "off")
    assert cam.call("cmd.get", "stereo") == "off"
    assert int(cam.call("cmd.get", "stereo_mode")) == 5, "stereo_mode stays latched"


def test_every_stereo_mode_survives_the_draws_it_enables(cam: WSClient, gl_bridge):
    """REGRESSION, and it used to take the whole process down with SIGSEGV.

    The test above only sets the modes; whether the pump ever *drew* one is a
    race it does not control.  ``geowall`` is the mode that crashes, and on a
    fast machine all four round-trips can land inside a single 1/60 s tick, so
    the crash showed up as an intermittent exit-139 on the macOS CI runner and
    never locally.  This test closes the race by waiting for real draws with
    each mode active.

    THE DEFECT.  ``stereo_mode=geowall`` makes ``ExecutiveDrawNow``
    (``packages/engine/layer3/Executive.cpp:11559-11567``) call ``OrthoDoDraw``
    twice, the second time with ``OrthoRenderMode::GeoWallRight``.  For that
    mode ``OrthoGetBackbuffers`` returned an EMPTY vector, and ``OrthoDoDraw``
    then read ``backbuffers.front()`` (``Ortho.cpp:1868``) plus
    ``backbuffers[0]`` in both draw loops (``:1948``, ``:2077``) — three
    dereferences of an empty ``std::vector``'s null data pointer.  The empty
    return came from the ``PYMOL-5001`` DrawBuffer refactor (``d188d36b``),
    which collapsed "which buffers to clear up front" and "which buffer this
    pass draws into" into one vector; for the geowall right eye those differ —
    clear nothing, but still draw into ``GL_BACK``, which is what the
    pre-refactor ``OrthoDrawBuffer(G, GL_BACK)`` did.

    A dead process fails this test by killing the run, so the assertions here
    are only the second line of defence.
    """
    engine = gl_bridge.pump.engine
    try:
        for name in ("crosseye", "walleye", "geowall", "sidebyside"):
            before = engine.draws
            assert cam.call_reply("cmd.stereo", name)["t"] == "ok", name
            # Two draws, not one: the tick that was already in flight when the
            # setting landed does not count.
            deadline = time.monotonic() + 20.0
            while engine.draws < before + 2 and time.monotonic() < deadline:
                time.sleep(0.01)
            assert engine.draws >= before + 2, "%s: pump stopped drawing" % name
            assert cam.call("cmd.get", "stereo") == "on", name
    finally:
        cam.call("cmd.stereo", "off")


def test_full_screen_is_not_available_on_this_build(cam: WSClient) -> None:
    """``cmd.full_screen`` raises, both directions.

    ``is_gui_thread()`` is TRUE on the bridge pump thread (measured), so the
    call takes the direct ``_cmd.full_screen`` path rather than the deferred
    one, and ``ExecutiveFullScreen`` fails with no main window.  The browser
    equivalent is the Fullscreen API on the document, which is a client-side
    concern with no backend contract at all.
    """
    for toggle in (1, 0):
        reply = cam.call_reply("cmd.full_screen", toggle)
        assert reply["t"] == "err", toggle
        assert reply["error"]["kind"] == "CmdException", reply


def test_cmd_viewport_and_reshape_are_now_two_working_resizes(
    cam: WSClient, bridge
) -> None:
    """FIXED IN WAVE 10.  This test used to pin the silent no-op.

    ``CmdViewport`` ends at ``PyMOL_NeedReshape(G->PyMOL, 2, 0, 0, w, h)``
    (``packages/engine/layer4/Cmd.cpp:4966``).  The bridge runs ``no_gui=0`` (``engine.py:124``)
    so ``G->HaveGUI`` is true, and that branch only stores the request in
    ``I->Reshape[]`` and raises ``ReshapeFlag`` for the host to collect with
    ``PyMOL_GetReshapeInfo`` (``packages/engine/layer5/PyMOL.cpp:2537-2547``).  Nothing
    collected it, so ``get_viewport()`` and the offscreen FBO were unchanged.

    THE FIX IS NOT THE ONE WAVES 7-9 REPORTED.  "Drain the reshape request in
    the pump" is unreachable: ``PyMOL_GetReshape`` and ``PyMOL_GetReshapeInfo``
    are declared in ``packages/engine/layer5/PyMOL.h:294,300`` and wrapped nowhere in Python,
    so it would need a C++ change.  ``execapp`` does not drain the flag either
    — it REPLACES the command (``pymol_qt_gui.py:1229-1231``) — and the bridge
    now installs the same seam.  Both paths work and end in ``Engine.resize``.
    """
    before = list(cam.call("cmd.get_viewport"))
    engine = bridge.pump.engine
    assert [engine.width, engine.height] == before

    try:
        assert cam.call_reply("cmd.viewport", 640, 480)["t"] == "ok"
        time.sleep(0.4)
        assert list(cam.call("cmd.get_viewport")) == [640, 480]
        assert [engine.width, engine.height] == [640, 480]

        reply = cam.request(t="input", kind="reshape", width=640, height=480)
        assert reply["t"] == "ok" and reply["result"] == {"width": 640, "height": 480}
        time.sleep(0.4)
        assert list(cam.call("cmd.get_viewport")) == [640, 480]
        assert [engine.width, engine.height] == [640, 480]
    finally:
        cam.request(t="input", kind="reshape", width=before[0], height=before[1])
        time.sleep(0.4)
    assert list(cam.call("cmd.get_viewport")) == before


# ==========================================================================
# 00:340 — keyboard bindings for frames, scenes and rocking
# ==========================================================================


def test_the_default_bindings_are_the_ones_shortcut_dict_declares(
    cam: WSClient, bridge
) -> None:
    """``cmd.key_mappings`` is an attribute, so it is read by printing it.

    These strings are the whole of the row's first half.  They are asserted
    against the LIVE dict rather than against ``shortcut_dict.py`` so that a
    plugin or a ``set_key`` that shadowed one of them would fail here.
    """
    expected = {
        "left": "_ backward",
        "right": "_ forward",
        "pgup": "scene action=previous",
        "pgdn": "scene action=next",
        "home": "zoom animate=-1",
        "end": "mtoggle",
        "insert": "rock",
        "SHFT-home": "rewind",
        "SHFT-end": "ending",
        "CTRL-pgup": "_ scene new, insert_before",
        "CTRL-pgdn": "_ scene new, insert_after",
        "CTRL-end": "scene new, store",
        "CTRL-insert": "scene auto, store",
        "ALT-pgup": "rewind",
        "ALT-pgdn": "ending",
        "CTRL-F1": "scene F1, store",
        "CTSH-F1": "scene SHFT-F1, store",
        "CTRL-F12": "scene F12, store",
        "CTSH-F12": "scene SHFT-F12, store",
    }
    for key, command in expected.items():
        line = printed(cam, bridge, "ZWF_KEY", "cmd.key_mappings.get(%r)" % key)
        assert line.strip().endswith(command), (key, line)

    # F1..F12 have NO default binding: they only do something when a scene or a
    # view of that name exists (`internal.py:469-479`).
    for key in ("F1", "F5", "F12"):
        line = printed(cam, bridge, "ZWF_BARE", "cmd.key_mappings.get(%r)" % key)
        assert line.strip().endswith("None"), (key, line)


@pytest.fixture()
def keyed(cam: WSClient):
    """A movie plus two scenes, for the forwarded-key tests."""
    cam.call("cmd.mset", "1 x30")
    cam.call("cmd.scene", "one", "store")
    cam.call("cmd.turn", "y", 25)
    cam.call("cmd.scene", "two", "store")
    cam.call("cmd.scene", "one", "recall")
    yield cam


def press(ws: WSClient, code: int, mod: int = MOD_NONE, state: int = SPECIAL) -> None:
    """One forwarded keystroke, exactly as ``KeyboardService`` sends it.

    ``PyMOL_Special`` runs ``PParse("_special k,x,y,mod")`` inline
    (``packages/engine/layer5/PyMOL.cpp:2386-2391``), so unlike mouse input this does NOT wait
    for a draw.  ``PyMOL_Key`` queues through ``OrthoCommandIn``, which does —
    hence the sleep, which is generous enough for both.
    """
    ws.input("button", button=code, state=state, x=0, y=0, mod=mod)
    time.sleep(0.5)


def test_left_and_right_step_movie_frames(keyed: WSClient) -> None:
    keyed.call("cmd.frame", 5)
    press(keyed, K_LEFT)
    assert keyed.call("cmd.get_frame") == 4
    press(keyed, K_RIGHT)
    assert keyed.call("cmd.get_frame") == 5


def test_pgdn_and_pgup_step_scenes(keyed: WSClient) -> None:
    assert keyed.call("cmd.get", "scene_current_name") == "one"
    press(keyed, K_PGDN)
    assert keyed.call("cmd.get", "scene_current_name") == "two"
    press(keyed, K_PGUP)
    assert keyed.call("cmd.get", "scene_current_name") == "one"


def test_home_is_zoom_all_and_end_toggles_the_movie(keyed: WSClient) -> None:
    keyed.call("cmd.reset")
    zoom_all = keyed.call("cmd.get_view")
    keyed.call("cmd.zoom", "resi 20", buffer=0)
    assert gap(keyed.call("cmd.get_view"), zoom_all) > 10.0
    press(keyed, K_HOME)
    assert gap(settled(keyed), zoom_all) < 1e-4

    assert keyed.call("cmd.get_movie_playing") == 0
    press(keyed, K_END)
    assert keyed.call("cmd.get_movie_playing") == 1
    press(keyed, K_END)
    assert keyed.call("cmd.get_movie_playing") == 0


def test_insert_toggles_rocking(keyed: WSClient) -> None:
    assert keyed.call("cmd.rock", -2) == 0
    press(keyed, K_INSERT)
    assert keyed.call("cmd.rock", -2) == 1
    press(keyed, K_INSERT)
    assert keyed.call("cmd.rock", -2) == 0


def test_alt_pgup_and_pgdn_are_rewind_and_ending(keyed: WSClient) -> None:
    keyed.call("cmd.frame", 10)
    press(keyed, K_PGUP, MOD_ALT)
    assert keyed.call("cmd.get_frame") == 1
    press(keyed, K_PGDN, MOD_ALT)
    assert keyed.call("cmd.get_frame") == 30


def test_ctrl_page_keys_insert_scenes_around_the_current_one(keyed: WSClient) -> None:
    """CTRL-pgup/pgdn are ``scene new, insert_before`` / ``insert_after``.

    The auto key is NOT predictable: ``CMovieScenes::getUniqueKey``
    (``MovieScene.cpp:62``) counts up from a member that is never reset, so the
    number depends on what the rest of the process already created.  What is
    stable is the POSITION relative to ``scene_current_name``.

    UPSTREAM DEFECT, measured here: ``insert_before`` when the current scene is
    the FIRST one silently does not reorder.  ``MovieSceneOrderBeforeAfter``
    (``MovieScene.cpp:733-748``) sets ``key = ""`` plus ``location = "top"`` in
    that case, and ``MovieSceneOrder`` then rejects the whole call with
    ``Scene '' is not defined.`` (``MovieScene.cpp:106``) — a result the caller
    throws away.  The new scene stays appended at the end.
    """
    assert scene_names(keyed) == ["one", "two"]

    press(keyed, K_PGDN, MOD_CTRL)  # insert_after "one"
    after = scene_names(keyed)
    assert len(after) == 3 and after[0] == "one" and after[2] == "two"
    inserted = after[1]
    assert inserted.isdigit() and len(inserted) == 3, inserted

    keyed.call("cmd.scene", "two", "recall")  # NOT the first entry
    press(keyed, K_PGUP, MOD_CTRL)  # insert_before "two"
    before = scene_names(keyed)
    assert before[:2] == ["one", inserted]
    assert before[3] == "two", before
    assert before[2].isdigit(), before

    # ...and the same key with the FIRST scene current does nothing to order.
    keyed.call("cmd.scene", "one", "recall")
    order = scene_names(keyed)
    press(keyed, K_PGUP, MOD_CTRL)
    assert scene_names(keyed)[: len(order)] == order, "insert_before moved it?"
    assert len(scene_names(keyed)) == len(order) + 1


def test_ctrl_end_and_ctrl_insert_store_scenes(keyed: WSClient) -> None:
    press(keyed, K_END, MOD_CTRL)  # scene new, store
    names = scene_names(keyed)
    assert names[:2] == ["one", "two"] and len(names) == 3
    assert names[2].isdigit()

    # `scene auto, store` UPDATES the current scene rather than adding one:
    # key 'auto' becomes `scene_current_name` (`MovieScene.cpp:788-790`).
    keyed.call("cmd.scene", "two", "recall")
    press(keyed, K_INSERT, MOD_CTRL)
    assert scene_names(keyed) == names
    assert keyed.call("cmd.get", "scene_current_name") == "two"


def test_ctrl_and_ctsh_function_keys_store_F_and_SHFT_F_scenes(keyed: WSClient) -> None:
    """``CTRL-F1`` -> scene ``F1``; ``CTSH-F2`` -> scene ``SHFT-F2``.

    The mask index IS the modifier name: ``internal.modifier_keys[3] == 'CTSH'``
    (``internal.py:390-396``), so mod=3 is Ctrl+Shift, not Ctrl+Alt.
    """
    press(keyed, K_F1, MOD_CTRL)
    assert "F1" in scene_names(keyed)
    press(keyed, K_F2, MOD_CTSH)
    assert "SHFT-F2" in scene_names(keyed)


def test_a_bare_F_key_falls_back_to_a_scene_whose_name_it_prefixes(
    keyed: WSClient,
) -> None:
    """``sc.interpret(key + '-')`` (``internal.py:475``) — the second pass.

    A scene called ``F3-overview`` is recalled by bare F3 even though nothing is
    called ``F3``.  Nothing lists this binding anywhere; a shortcut editor built
    only from ``key_mappings`` will not show it.
    """
    keyed.call("cmd.scene", "F3-overview", "store")
    keyed.call("cmd.scene", "one", "recall")
    press(keyed, K_F3)
    assert keyed.call("cmd.get", "scene_current_name") == "F3-overview"


def test_spacebar_on_an_empty_command_line_toggles_the_movie(keyed: WSClient) -> None:
    """``packages/engine/layer1/Ortho.cpp:861-876`` — the ONE printable key with a meaning.

    It is an ascii key (``state = -1``), not a special, and it only fires when
    the ortho command line is empty; anything already typed makes it a space.
    Presentation mode swaps it for ``scene next``; that is a settings branch and
    is not exercised here because ``presentation`` also arms the auto-quit chain
    (see ``sceneActions.ts``).

    AN ASCII KEY IS NOT A SPECIAL KEY AND THIS TEST NEEDED BOTH GUARDS BELOW.
    ``PyMOL_Special`` runs ``PParse`` inline, so every other key test in this
    file lands without a draw; ``PyMOL_Key`` only queues, through
    ``OrthoCommandIn``, and the queue is drained by the pump's draw.  MEASURED:
    the first version of this test passed alone, passed after every subset of
    the suite that was tried, and FAILED in the full 1279-test run with
    ``get_movie_playing() == 0`` — the classic "forwarded input only applies
    when the pump draws".  Subscribing to ``pixels`` is what makes the pump
    draw (the same fixture line as ``test_picking.py:52``).  The backspaces are
    the second guard: the branch is also gated on ``I->CurChar ==
    I->PromptChar``, so ONE stray printable character left on the shared ortho
    command line by any earlier test turns this keystroke into a literal space
    for the rest of the process.  Backspace on an empty line is a no-op
    (``Ortho.cpp:893-894``), so clearing it costs nothing.
    """
    assert keyed.subscribe("pixels")["t"] == "ok"
    time.sleep(1.2)
    for _ in range(8):
        keyed.input("button", button=8, state=ASCII, x=0, y=0, mod=MOD_NONE)
    time.sleep(1.2)

    assert keyed.call("cmd.get_movie_playing") == 0
    press(keyed, ord(" "), MOD_NONE, ASCII)
    time.sleep(0.7)
    assert keyed.call("cmd.get_movie_playing") == 1
    press(keyed, ord(" "), MOD_NONE, ASCII)
    time.sleep(0.7)
    assert keyed.call("cmd.get_movie_playing") == 0
