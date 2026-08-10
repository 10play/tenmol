"""Parity area 7 — the camera command surface, and WHEN it lands.

Inventory row ``feature-parity.md:337``: zoom / center / orient / origin /
clip / turn / move / reset / viewport / stereo / full_screen.

``test_wf_camera.py`` already pins what each command *does* to the 18-float view
vector (and reports ``cmd.viewport`` as a no-op, ``cmd.full_screen`` as broken,
``cmd.stereo('off')`` as leaving ``stereo_mode`` latched).  This file pins the
other half — the half a client trips over — measured over the socket against
``packages/engine/test/dat/il2.pdb`` and the 10-state ``packages/engine/test/dat/ligs3d.sdf``:

  1. WHEN the camera lands.  EVERY camera command returns in well under a
     millisecond (0.2-0.5 ms measured), so the reply is never the "done"
     signal.  ``zoom``/``center``/``orient``/``set_view`` with ``animate != 0``
     return with the camera **byte-identical to where it started** and sweep to
     the target afterwards; ``turn``, ``move``, ``clip``, ``origin`` and
     ``reset`` take no ``animate`` argument at all and land instantly.

  2. THE SWEEP IS NOT CONTINUOUS.  ``SceneLoadAnimation`` builds
     ``int(duration * 30)`` key frames (``packages/engine/layer1/Scene.cpp:401``, capped at
     ``MAX_ANI_ELEM`` 300) and ``SceneUpdateAnimation`` SNAPS to the current one
     (``:4523-4531``) — it does not blend between them.  Measured distinct
     ``get_view()[11]`` values while polling at ~4 kHz: 4 for ``animate=0.1``,
     16 for ``0.5``, 31 for ``1.0`` — exactly ``int(d*30)+1``.

  3. THEREFORE "POLL UNTIL IT STOPS CHANGING" IS A BUG.  A ``get_view`` round
     trip is 0.24 ms measured; two consecutive samples inside the same 33 ms key
     frame are equal, so a two-sample settle detector declares victory on the
     FIRST poll while the camera is still 161 A from the target.  The correct
     test is "unchanged for longer than one key frame" (> 1/30 s) or, better,
     "equal to the target I asked for".  ``quiet_view()`` below is the former.

  4. ``SceneUpdateAnimation`` IS ONLY CALLED FROM ``SceneRender``
     (``packages/engine/layer1/SceneRender.cpp:246``) AND ``SceneRay`` (``SceneRay.cpp:125``).
     SOURCE-ONLY CLAIM, not observed here because this session has a GL context:
     on a bridge whose engine never reaches ``EngineState.RUNNING``,
     ``Engine.tick`` skips ``p.draw()`` (``engine.py:237-239``) and an animated
     ``zoom`` would prime, load, snap the camera back to key frame 0 and then
     never advance — i.e. the command would appear to do nothing at all.  A
     GL-free backend must either force ``animate=0`` or drive the sweep itself.

Defects found here, none of them fixed in this slot:

  * ``cmd.turn('w', 45)`` — and ``'q'``, and ``''`` — returns ok and silently
    does nothing.  ``cmd.move('w', 1)`` raises.  A typo'd axis is a silent no-op
    on one command and an error on its twin.
  * ``cmd.zoom('nosuchobject')`` and ``cmd.orient('nosuchobject')`` return ok
    (the Selector error only reaches the feedback ring) while
    ``cmd.center('nosuchobject')`` raises.  Three commands, two error contracts.
  * Nothing in the ``cmd`` API reports "a camera sweep is in flight".  Polling
    ``get_view`` is the only signal a client has.
  * Interrupting a sweep with a second animated command ABANDONS the first
    where it stands: its target is never reached, and no error is raised.
  * A ``turn`` during a sweep is silently overwritten by the sweep's own
    rotation track, because the interpolation carries all 18 floats.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_f7_camera.py -q
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Dict, List, Sequence

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")
#: 10 states, 337 atoms — the only multi-state fixture the state arguments need.
LIGS = os.path.join(DATA, "ligs3d.sdf")

PROT = "f7cam_pro"
LIG = "f7cam_lig"

#: PROCESS-GLOBAL, every one of them; the suite shares one PyMOL.
TOUCHED_SETTINGS = (
    "animation",
    "animation_duration",
    "scene_animation",
    "scene_animation_duration",
)

#: ``SceneLoadAnimation`` (``packages/engine/layer1/Scene.cpp:401``): ``int(duration * 30)``.
ANI_ELEM_HZ = 30
#: ``packages/engine/layer1/SceneDef.h:39``.
MAX_ANI_ELEM = 300


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def gap(a: Sequence[float], b: Sequence[float]) -> float:
    """Largest per-element difference between two view vectors."""
    return max(abs(float(x) - float(y)) for x, y in zip(a, b))


def quiet_view(ws: WSClient, quiet: float = 0.15, limit: float = 10.0) -> List[float]:
    """``get_view()`` once it has held still for longer than ONE key frame.

    ``quiet`` must exceed ``1 / ANI_ELEM_HZ`` = 33 ms.  The whole point of this
    file is that the obvious alternative — "two consecutive reads agree" —
    fires on the first poll of a sweep that has not started moving yet; see
    ``test_two_equal_samples_is_not_settled``.
    """
    assert quiet > 1.0 / ANI_ELEM_HZ, "quiet window shorter than one key frame"
    deadline = time.monotonic() + limit
    previous = ws.call("cmd.get_view")
    still_since = time.monotonic()
    while time.monotonic() < deadline:
        current = ws.call("cmd.get_view")
        if gap(current, previous) > 0.0:
            previous = current
            still_since = time.monotonic()
        elif time.monotonic() - still_since >= quiet:
            return current
        time.sleep(0.01)
    raise AssertionError("camera never settled within %.1f s" % limit)


def timed_call(ws: WSClient, fn: str, *args: Any, **kwargs: Any) -> float:
    start = time.monotonic()
    ws.call(fn, *args, **kwargs)
    return time.monotonic() - start


# --------------------------------------------------------------------------
# fixture
# --------------------------------------------------------------------------


@pytest.fixture()
def cam(ws: WSClient):
    """One protein, one 10-state ligand set, no movie, animation ON at 0.75 s.

    EVERYTHING THIS TOUCHES IS GLOBAL.  The view, the four animation settings
    and the movie are restored by value; the objects are deleted.  ``mset('')``
    matters more than it looks: with a movie defined,
    ``SceneUpdateAnimation`` takes the frame-clock branch
    (``packages/engine/layer1/Scene.cpp:4504-4520``) instead of the wall-clock one and every
    duration measured below would be wrong.
    """
    saved_settings = {name: ws.call("cmd.get", name) for name in TOUCHED_SETTINGS}
    saved_view = ws.call("cmd.get_view")

    ws.call("cmd.mstop")
    ws.call("cmd.rock", 0)
    ws.call("cmd.mset", "")
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, PROT)
    ws.call("cmd.load", LIGS, LIG)
    ws.call("cmd.disable", LIG)
    ws.call("cmd.frame", 1)
    # `load` does NOT reset the camera; without this the inherited orientation
    # makes every distance below depend on which file ran before this one.
    ws.call("cmd.reset")
    ws.call("cmd.set", "animation", 1)
    ws.call("cmd.set", "animation_duration", 0.75)

    yield ws

    # `set_view(..., animate=0)` calls SceneAbortAnimation (`Scene.cpp:930-934`),
    # so this both kills a sweep left in flight and puts the camera back.
    ws.call("cmd.set", "animation", 0)
    ws.call("cmd.set_view", saved_view, animate=0)
    ws.call("cmd.mstop")
    ws.call("cmd.rock", 0)
    ws.call("cmd.mset", "")
    ws.call("cmd.delete", "all")
    for name, value in saved_settings.items():
        ws.call("cmd.set", name, value)
    ws.call("cmd.set_view", saved_view, animate=0)


@pytest.fixture()
def target(cam: WSClient) -> List[float]:
    """Where ``zoom resi 20`` ends up, computed WITHOUT animation."""
    cam.call("cmd.zoom", "resi 20", animate=0)
    view = cam.call("cmd.get_view")
    cam.call("cmd.reset")
    return list(view)


# ==========================================================================
# 1. when does it land?
# ==========================================================================


def test_no_camera_command_waits_for_the_camera(cam: WSClient) -> None:
    """MEASURED: every one of them replies in 0.2-0.5 ms, animated or not.

    The reply to a camera call says "accepted", never "finished".  A client
    that refreshes its own camera in the ``.then()`` of a ``zoom animate=1``
    reads the view the sweep has not started from yet.
    """
    calls = [
        ("cmd.zoom", ("resi 20",), {"animate": 0}),
        ("cmd.zoom", ("resi 20",), {"animate": 1.0}),
        ("cmd.center", ("resi 20",), {"animate": 1.0}),
        ("cmd.orient", (PROT,), {"animate": 1.0}),
        ("cmd.turn", ("y", 30), {}),
        ("cmd.move", ("z", 10), {}),
        ("cmd.clip", ("slab", 20), {}),
        ("cmd.origin", (), {"position": [1.0, 2.0, 3.0]}),
        ("cmd.reset", (), {}),
    ]
    slowest = 0.0
    for fn, args, kwargs in calls:
        cam.call("cmd.set", "animation", 0)
        cam.call("cmd.reset")
        cam.call("cmd.set", "animation", 1)
        took = timed_call(cam, fn, *args, **kwargs)
        slowest = max(slowest, took)
        assert took < 0.05, (fn, kwargs, took)
    assert slowest < 0.05
    cam.call("cmd.set_view", cam.call("cmd.get_view"), animate=0)


def test_an_animated_command_has_not_moved_the_camera_when_it_returns(
    cam: WSClient, target: List[float], gl_bridge
) -> None:
    """``ScenePrimeAnimation`` + ``SceneLoadAnimation`` put the camera BACK.

    ``ExecutiveWindowZoom`` primes, applies the final view, then
    ``SceneLoadAnimation`` ends with ``SceneFromViewElem(G, I->ani_elem, true)``
    (``packages/engine/layer1/Scene.cpp:420``) — key frame 0, i.e. exactly where the camera
    already was.  MEASURED gap at return: 0.0 for all three, to the last bit.

    Gated on ``gl_bridge``: this asserts the sweep ADVANCES past key frame 0
    (``gap(moved, home) > 1.0``), and ``SceneUpdateAnimation`` only runs from the
    draw (docstring §4).  With no GL context ``Engine.tick`` skips ``p.draw()``,
    the camera snaps back to key frame 0 and never moves, so the assertion is a
    property of the missing GL, not the command — skip rather than fail.
    """
    for fn, args in (
        ("cmd.zoom", ("resi 20",)),
        ("cmd.center", ("resi 20",)),
        ("cmd.orient", (PROT,)),
    ):
        cam.call("cmd.reset")
        home = cam.call("cmd.get_view")
        cam.call(fn, *args, animate=1.0)
        assert gap(cam.call("cmd.get_view"), home) == 0.0, fn
        moved = quiet_view(cam)
        assert gap(moved, home) > 1.0, fn
    cam.call("cmd.reset")
    assert gap(target, cam.call("cmd.get_view")) > 1.0


def test_instant_commands_land_before_the_reply(cam: WSClient) -> None:
    """``animate=0`` and the five commands that have no ``animate`` at all.

    MEASURED deltas on il2.pdb after ``reset``: ``zoom resi 20`` 328.3,
    ``center resi 20`` 6.15, ``orient`` 167.3, ``turn y 30`` 0.5,
    ``move z 10`` 10.0, ``clip slab 20`` 50.9, ``origin position=`` 17.9.
    Each one is already in ``get_view()`` when the call returns and does not
    move afterwards.
    """
    cases = [
        ("cmd.zoom", ("resi 20",), {"animate": 0}),
        ("cmd.center", ("resi 20",), {"animate": 0}),
        ("cmd.orient", (PROT,), {"animate": 0}),
        ("cmd.turn", ("y", 30), {}),
        ("cmd.move", ("z", 10), {}),
        ("cmd.clip", ("slab", 20), {}),
        ("cmd.origin", (), {"position": [1.0, 2.0, 3.0]}),
    ]
    for fn, args, kwargs in cases:
        cam.call("cmd.reset")
        home = cam.call("cmd.get_view")
        cam.call(fn, *args, **kwargs)
        immediate = cam.call("cmd.get_view")
        assert gap(immediate, home) > 0.4, (fn, kwargs)
        time.sleep(0.25)
        assert gap(cam.call("cmd.get_view"), immediate) == 0.0, (fn, kwargs)

    # `turn`/`move`/`clip`/`origin`/`reset` do not even accept `animate`.
    for fn in ("cmd.turn", "cmd.move"):
        assert cam.call_reply(fn, "y", 1, animate=1.0)["t"] == "err", fn
    assert cam.call_reply("cmd.clip", "slab", 10, animate=1.0)["t"] == "err"
    assert cam.call_reply("cmd.origin", animate=1.0)["t"] == "err"
    assert cam.call_reply("cmd.reset", animate=1.0)["t"] == "err"


def test_animate_minus_one_is_animation_times_animation_duration(
    cam: WSClient, target: List[float]
) -> None:
    """``animate < 0`` -> ``animation ? animation_duration : 0``.

    ``ExecutiveWindowZoom`` (``packages/engine/layer3/Executive.cpp:13433-13438``), and the
    identical block in ``ExecutiveCenter`` (``:13494``), ``ExecutiveOrient``
    (``:10065``) and ``SceneSetView`` (``packages/engine/layer1/Scene.cpp:924-929``).
    MEASURED: ``animation off`` lands instantly; ``animation_duration 0.3``
    settles in 0.30 s and ``1.5`` in 1.51 s.
    """
    cam.call("cmd.set", "animation", 0)
    cam.call("cmd.reset")
    cam.call("cmd.zoom", "resi 20", animate=-1)
    assert gap(cam.call("cmd.get_view"), target) == 0.0, "animation off must be instant"

    cam.call("cmd.set", "animation", 1)
    took = {}
    for duration in (0.3, 1.5):
        cam.call("cmd.set", "animation_duration", duration)
        cam.call("cmd.reset")
        start = time.monotonic()
        cam.call("cmd.zoom", "resi 20", animate=-1)
        assert gap(cam.call("cmd.get_view"), target) > 1.0
        while gap(cam.call("cmd.get_view"), target) > 1e-4:
            assert time.monotonic() - start < 8.0, duration
            time.sleep(0.005)
        took[duration] = time.monotonic() - start

    assert 0.15 < took[0.3] < 0.9, took
    assert 1.2 < took[1.5] < 2.5, took
    assert took[1.5] > took[0.3] * 2


def test_the_sweep_is_thirty_discrete_key_frames_per_second(
    cam: WSClient, target: List[float]
) -> None:
    """``int(duration * 30)`` key frames, SNAPPED to, never blended.

    ``SceneLoadAnimation`` (``packages/engine/layer1/Scene.cpp:401``) sizes the key-frame array
    and ``SceneUpdateAnimation`` walks to the current element and calls
    ``SceneFromViewElem`` on THAT element (``:4523-4531``).  Polled at ~4 kHz
    the number of distinct ``view[11]`` values is therefore bounded by
    ``int(d*30)+1``; a continuous interpolation would give thousands.
    MEASURED: 4 / 16 / 31 for 0.1 / 0.5 / 1.0 s, i.e. the bound, exactly.
    """
    cam.call("cmd.set", "animation", 1)
    counts: Dict[float, int] = {}
    for duration in (0.5, 1.0):
        cam.call("cmd.reset")
        cam.call("cmd.zoom", "resi 20", animate=duration)
        seen: List[float] = []
        deadline = time.monotonic() + duration + 0.5
        while time.monotonic() < deadline:
            value = cam.call("cmd.get_view")[11]
            if not seen or value != seen[-1]:
                seen.append(value)
        counts[duration] = len(seen)
        assert seen[-1] == pytest.approx(target[11], abs=1e-4)
        steps = int(duration * ANI_ELEM_HZ)
        assert 4 <= len(seen) <= steps + 1, (duration, len(seen), steps)
    assert counts[1.0] > counts[0.5], counts


def test_two_equal_samples_is_not_settled(cam: WSClient, target: List[float]) -> None:
    """THE ONE THAT BITES.  A 2-sample settle detector fires immediately.

    MEASURED: a ``cmd.get_view`` round trip over the WebSocket is 0.24 ms, one
    key frame is 33.3 ms, so the second read of a freshly-started sweep is
    bit-identical to the first.  The detector reports "settled" after ONE poll
    with the camera still 161 A (in ``view[11]``) from where the user asked it
    to go.  ``quiet_view`` — unchanged for longer than one key frame — gets it
    right on the same sweep.
    """
    cam.call("cmd.set", "animation", 1)
    cam.call("cmd.reset")
    cam.call("cmd.zoom", "resi 20", animate=1.0)

    polls = 0
    previous = cam.call("cmd.get_view")
    while True:
        current = cam.call("cmd.get_view")
        polls += 1
        if gap(current, previous) < 1e-6:
            break
        previous = current
    naive_error = gap(current, target)
    assert polls <= 5, polls
    assert naive_error > 50.0, naive_error

    assert gap(quiet_view(cam), target) == 0.0


def test_the_animated_endpoint_equals_the_instant_endpoint_exactly(
    cam: WSClient, target: List[float], gl_bridge
) -> None:
    """A sweep is not an approximation: the last key frame IS the target.

    MEASURED gap between ``zoom animate=0.3`` (settled) and ``zoom animate=0``:
    0.0 across all 18 floats.

    Gated on ``gl_bridge``: the sweep only reaches its last key frame if the
    draw runs ``SceneUpdateAnimation`` (docstring §4).  With no GL context the
    camera stays snapped at key frame 0, so ``quiet_view`` settles far from the
    target — a property of the missing GL, not the endpoint — skip rather than fail.
    """
    for duration in (0.1, 0.3):
        cam.call("cmd.reset")
        cam.call("cmd.zoom", "resi 20", animate=duration)
        assert gap(quiet_view(cam), target) == 0.0, duration


def test_an_instant_command_aborts_a_sweep_but_turn_does_not(
    cam: WSClient, target: List[float]
) -> None:
    """``animate=0`` calls ``SceneAbortAnimation``; ``cmd.turn`` does not.

    ``ExecutiveWindowZoom``'s else-branch (``packages/engine/layer3/Executive.cpp:13443``) and
    ``SceneSetView`` (``packages/engine/layer1/Scene.cpp:933``) abort.  ``_cmd.turn`` does not
    touch ``cur_ani_elem``, so the sweep keeps running and OVERWRITES the
    rotation the user just asked for: the next key frame — at most 33 ms later
    — restores the whole 18 floats from ``ani_elem[cur]``.  MEASURED: the same
    ``turn y 15`` moves the rotation by 0.259 when nothing is animating and
    leaves ``view[0:9]`` bit-identical to ``home`` when issued 0.3 s into a 1 s
    ``zoom``.  (The intermediate state is deliberately NOT asserted: whether a
    draw lands between the ``turn`` and the next ``get_view`` is a race.)
    """
    cam.call("cmd.set", "animation", 1)

    cam.call("cmd.reset")
    cam.call("cmd.zoom", "resi 20", animate=2.0)
    time.sleep(0.4)
    mid = cam.call("cmd.get_view")
    assert gap(mid, target) > 1.0, "sweep already finished; test is meaningless"
    cam.call("cmd.zoom", "resi 20", animate=0)
    landed = cam.call("cmd.get_view")
    # NOT bit-identity, and the difference is not the sweep still running.
    # ``target`` is computed from a RESET camera; this zoom is computed from
    # wherever the sweep had got to, so it inherits an interpolated rotation
    # that is one float32 quantum off the identity ``target`` was built on.
    # MEASURED over 40 aborts spread across the sweep: the landing error is
    # either 0.0 or exactly 2**-19 (1.9073486328125e-06) and never anything
    # else — 38 of the 40 showed the quantum. So this bound is ~50x the noise
    # and still ~10^4 below the >1.0 gap a sweep in flight shows on the line
    # above, which is the thing being distinguished.
    assert gap(landed, target) < 1e-4, landed
    time.sleep(0.4)
    # This one IS exact: the claim is that nothing moved after the abort, and
    # ``landed`` — not ``target`` — is the position it would have to depart
    # from. Bit-identical in all 40 of the measured aborts.
    assert gap(cam.call("cmd.get_view"), landed) == 0.0, "aborted sweep resumed"

    # control: the same turn, with nothing animating, really does rotate.
    cam.call("cmd.reset")
    home = cam.call("cmd.get_view")
    cam.call("cmd.turn", "y", 15)
    assert gap(cam.call("cmd.get_view")[:9], home[:9]) == pytest.approx(0.259, abs=1e-2)

    cam.call("cmd.reset")
    cam.call("cmd.zoom", "resi 20", animate=1.0)
    time.sleep(0.3)
    cam.call("cmd.turn", "y", 15)
    final = quiet_view(cam)
    assert gap(final, target) < 1e-4, "the sweep did not finish"
    assert final[:9] == pytest.approx(home[:9], abs=1e-6), "turn survived the sweep"


def test_a_second_animated_command_abandons_the_first_where_it_stands(
    cam: WSClient, target: List[float]
) -> None:
    """``ScenePrimeAnimation`` stops the old sweep; it does not complete it.

    ``packages/engine/layer1/Scene.cpp:326-328`` sets ``cur_ani_elem = n_ani_elem`` and then
    snapshots the CURRENT view as the new key frame 0 — so the interrupted
    zoom's target is simply never reached, silently.  MEASURED: no jump at all
    at the moment of interruption (gap 0.0), and the first target is still
    153.8 away.
    """
    cam.call("cmd.set", "animation", 1)
    cam.call("cmd.reset")
    cam.call("cmd.zoom", "resi 20", animate=2.0)
    time.sleep(0.3)
    mid = cam.call("cmd.get_view")
    assert gap(mid, target) > 1.0

    cam.call("cmd.center", "resi 20", animate=0.5)
    after = cam.call("cmd.get_view")
    # NOT `== 0.0`. The interrupted zoom is a 2 s sweep in 30 fps key frames, so
    # between reading `mid` and reading `after` the OLD animation legitimately
    # advances a frame or two — on an idle machine none elapse and the gap is
    # exactly 0, on a loaded runner some do, and the test was asserting the
    # machine was idle rather than that the engine did not jump.
    #
    # The claim is that interruption does not JUMP: `ScenePrimeAnimation`
    # snapshots the CURRENT view as the new key frame 0 instead of completing
    # the old sweep. A jump would land at or near the abandoned target, which is
    # the whole remaining distance away. A few frames of sweep is a small
    # fraction of it, so the two are separated by an order of magnitude.
    remaining = gap(mid, target)
    assert gap(after, mid) < remaining * 0.1, (
        "interruption jumped: moved %.3f toward a target %.3f away"
        % (gap(after, mid), remaining)
    )
    settled = quiet_view(cam)
    assert gap(settled, target) > 1.0, "the abandoned zoom reached its target"


def test_nothing_in_the_api_reports_a_sweep_in_flight(cam: WSClient) -> None:
    """There is no ``is_animating``.  Polling ``get_view`` is the only signal.

    Checked over the socket because a name that does not resolve is refused by
    the dispatcher with ``t == 'err'``; ``cmd.get_movie_playing`` is included as
    the positive control that the probe can tell the two apart.
    """
    assert cam.call_reply("cmd.get_movie_playing")["t"] == "ok"
    for name in (
        "cmd.is_animating",
        "cmd.animating",
        "cmd.get_animation",
        "cmd.get_ani_elem",
        "cmd.scene_animating",
        "cmd.get_camera_animation",
    ):
        assert cam.call_reply(name)["t"] == "err", name


# ==========================================================================
# 2. argument semantics
# ==========================================================================


def test_the_state_argument_is_one_based_and_zero_means_all_states(
    cam: WSClient,
) -> None:
    """Python sends ``int(state) - 1`` to C, for all four commands.

    ``viewing.py:127`` (zoom), ``:176`` (center), ``:350`` (orient), ``:305``
    (origin).  So the PYTHON contract is: 0 = every state, -1 = the current
    state, N = state N.  MEASURED on the 10-state ``ligs3d.sdf`` with the
    current state 1 — origin of rotation, model space:

        state=0   [55.227, 31.643, 20.303]   (the union of all 10)
        state=-1  [52.075, 32.623, 19.953]   == state=1
        state=1   [52.075, 32.623, 19.953]
        state=5   [57.679, 30.916, 20.092]
        state=10  [55.886, 30.910, 20.932]
    """
    cam.call("cmd.disable", PROT)
    cam.call("cmd.enable", LIG)
    assert cam.call("cmd.count_states", LIG) == 10
    assert cam.call("cmd.get_state") == 1

    def origin_after(fn: str, state: int) -> List[float]:
        cam.call("cmd.reset")
        if fn == "cmd.origin":
            cam.call(fn, LIG, state=state)
        else:
            cam.call(fn, LIG, state=state, animate=0)
        return list(cam.call("cmd.get_view")[12:15])

    for fn in ("cmd.zoom", "cmd.center", "cmd.orient", "cmd.origin"):
        all_states = origin_after(fn, 0)
        current = origin_after(fn, -1)
        first = origin_after(fn, 1)
        fifth = origin_after(fn, 5)
        assert current == pytest.approx(first, abs=1e-4), fn
        assert all_states == pytest.approx([55.227, 31.643, 20.303], abs=1e-2), fn
        assert first == pytest.approx([52.075, 32.623, 19.953], abs=1e-2), fn
        assert fifth == pytest.approx([57.679, 30.916, 20.092], abs=1e-2), fn
        assert gap(all_states, first) > 1.0, fn

    # zoom also pulls the camera in by a different amount per state.
    cam.call("cmd.reset")
    cam.call("cmd.zoom", LIG, state=0, animate=0)
    assert cam.call("cmd.get_view")[11] == pytest.approx(-66.764, abs=0.05)
    cam.call("cmd.reset")
    cam.call("cmd.zoom", LIG, state=1, animate=0)
    assert cam.call("cmd.get_view")[11] == pytest.approx(-38.696, abs=0.05)

    # `clip atoms` takes the same state argument.
    cam.call("cmd.reset")
    cam.call("cmd.clip", "atoms", 3, LIG, 5)
    fifth_clip = list(cam.call("cmd.get_clip"))
    cam.call("cmd.reset")
    cam.call("cmd.clip", "atoms", 3, LIG, 0)
    assert gap(fifth_clip, cam.call("cmd.get_clip")) > 1.0


def test_center_origin_zero_moves_the_camera_and_leaves_the_origin(
    cam: WSClient,
) -> None:
    """``center(..., origin=0)`` skips ``SceneOriginSet`` (``Executive:13503``).

    MEASURED: with ``origin=1`` (the default) ``view[12:15]`` becomes the
    ligand centre; with ``origin=0`` it stays at the reset value and only the
    camera position ``view[9:12]`` moves.  A UI that centres for a close-up and
    then lets the user drag-rotate gets a very different rotation pivot from
    the two.
    """
    cam.call("cmd.disable", PROT)
    cam.call("cmd.enable", LIG)

    cam.call("cmd.reset")
    home = cam.call("cmd.get_view")
    cam.call("cmd.center", LIG, origin=1, animate=0)
    with_origin = cam.call("cmd.get_view")
    assert gap(with_origin[12:15], home[12:15]) > 1.0

    cam.call("cmd.reset")
    cam.call("cmd.center", LIG, origin=0, animate=0)
    without = cam.call("cmd.get_view")
    assert without[12:15] == pytest.approx(home[12:15], abs=1e-6)
    assert gap(without[9:12], home[9:12]) > 1.0


def test_zoom_buffer_and_complete(cam: WSClient) -> None:
    """``buffer`` pads the extent box; ``complete`` uses the max distance.

    ``ExecutiveWindowZoom`` (``packages/engine/layer3/Executive.cpp:13404-13419``): ``buffer``
    is added to every face of the box AND to the radius, ``complete=1`` swaps
    the half-box radius for ``ExecutiveGetMaxDistance``.  MEASURED on
    ``resi 20``: buffer 0 -> ``view[11]`` -16.646, slab 7.044; buffer 10 ->
    -73.359, slab 31.044 (the slab grows by exactly 4x buffer / ... 24.0);
    complete=1 -> -16.789, slab 7.105, i.e. a hair further out than buffer 0.
    """
    cam.call("cmd.reset")
    cam.call("cmd.zoom", "resi 20", buffer=0, animate=0)
    plain = cam.call("cmd.get_view")
    cam.call("cmd.reset")
    cam.call("cmd.zoom", "resi 20", buffer=10, animate=0)
    padded = cam.call("cmd.get_view")
    cam.call("cmd.reset")
    cam.call("cmd.zoom", "resi 20", complete=1, animate=0)
    complete = cam.call("cmd.get_view")

    assert plain[11] == pytest.approx(-16.646, abs=0.05)
    assert padded[11] == pytest.approx(-73.359, abs=0.05)
    assert complete[11] == pytest.approx(-16.789, abs=0.05)
    assert (padded[16] - padded[15]) - (plain[16] - plain[15]) == pytest.approx(
        24.0, abs=0.05
    )
    # complete never crops tighter than the plain box
    assert abs(complete[11]) > abs(plain[11])
    # neither of them rotates
    assert plain[:9] == pytest.approx(complete[:9], abs=1e-6)


def test_origin_position_overrides_the_selection(cam: WSClient) -> None:
    """``position`` blanks the selection outright (``viewing.py:299-302``).

    So ``origin('resi 20', position=[1,2,3])`` is ``origin(position=[1,2,3])``:
    the selection is discarded without a warning.
    """
    cam.call("cmd.reset")
    cam.call("cmd.origin", "resi 20")
    from_selection = list(cam.call("cmd.get_view")[12:15])
    assert from_selection == pytest.approx([10.129, -1.825, 17.918], abs=1e-2)

    cam.call("cmd.origin", "resi 20", position=[1.0, 2.0, 3.0])
    assert cam.call("cmd.get_view")[12:15] == pytest.approx([1.0, 2.0, 3.0], abs=1e-5)

    # a string position is parsed by safe_list_eval
    cam.call("cmd.origin", position="[4.0, 5.0, 6.0]")
    assert cam.call("cmd.get_view")[12:15] == pytest.approx([4.0, 5.0, 6.0], abs=1e-5)

    # `object=` retargets the object's TTT and leaves the scene origin alone
    before = cam.call("cmd.get_view")
    assert cam.call_reply("cmd.origin", PROT, object=PROT)["t"] == "ok"
    assert gap(cam.call("cmd.get_view"), before) == 0.0
    cam.call("cmd.reset", PROT)


def test_reset_origin_is_weighted_not_the_raw_extent_midpoint(cam: WSClient) -> None:
    """"origin ~ centre of mass" in the row is right, and it is NOT get_extent.

    ``ExecutiveReset`` -> ``ExecutiveWindowZoom(all, 0, -1, 0, 0, quiet)``
    (``packages/engine/layer3/Executive.cpp:11494-11496``) and that call asks
    ``ExecutiveGetExtent(..., weighted=true)``, while ``cmd.get_extent`` does
    not.  MEASURED on il2.pdb: reset origin [9.9853, -9.3177, 20.9760];
    ``centerofmass`` [9.9418, -9.4741, 20.9708] — 0.157 A away; the
    ``get_extent`` midpoint [10.054, -11.5925, 19.9435] — 2.27 A away in y.

    AND ``reset`` COVERS OBJECTS THAT ARE SWITCHED OFF.  ``ExecutiveReset``
    zooms ``cKeywordAll``, and ``all`` is every atom in the session, not every
    VISIBLE atom.  MEASURED: with the disabled 10-state ligand set still
    loaded the reset origin is [16.2829, -3.6160, 20.8824]; deleting it moves
    the origin 6.3 A.  A "Zoom" toolbar button frames hidden objects too.
    """
    cam.call("cmd.disable", LIG)
    cam.call("cmd.enable", PROT)
    cam.call("cmd.reset")
    with_hidden = list(cam.call("cmd.get_view")[12:15])
    assert with_hidden == pytest.approx([16.2829, -3.6160, 20.8824], abs=1e-2)

    cam.call("cmd.delete", LIG)
    cam.call("cmd.reset")
    origin = list(cam.call("cmd.get_view")[12:15])
    assert gap(origin, with_hidden) > 6.0
    assert origin == pytest.approx([9.9853, -9.3177, 20.9760], abs=1e-2)

    com = list(cam.call("cmd.centerofmass", PROT))
    assert gap(origin, com) < 0.3, (origin, com)

    lo, hi = cam.call("cmd.get_extent", PROT)
    midpoint = [(a + b) / 2.0 for a, b in zip(lo, hi)]
    assert gap(origin, midpoint) > 2.0, (origin, midpoint)

    # reset is also idempotent and repeatable to the bit
    view = cam.call("cmd.get_view")
    cam.call("cmd.turn", "x", 33)
    cam.call("cmd.move", "z", 12)
    cam.call("cmd.clip", "slab", 5)
    cam.call("cmd.reset")
    assert gap(cam.call("cmd.get_view"), view) == 0.0


def test_turn_swallows_a_bogus_axis_and_move_refuses_it(cam: WSClient) -> None:
    """DEFECT: the two twins disagree about what an axis is.

    ``_cmd.turn`` takes the axis as a string and ignores anything that is not
    x/y/z; ``_cmd.move`` raises.  MEASURED: ``turn w,45``/``turn q,45``/
    ``turn '',45`` all return ok with the view bit-identical, and ``move w,1``
    is a ``CmdException``.  A React axis control must validate client-side --
    the backend will not tell it.
    """
    cam.call("cmd.reset")
    home = cam.call("cmd.get_view")
    for axis in ("w", "q", ""):
        assert cam.call_reply("cmd.turn", axis, 45)["t"] == "ok", axis
        assert gap(cam.call("cmd.get_view"), home) == 0.0, axis

    for axis in ("x", "y", "z"):
        cam.call("cmd.reset")
        cam.call("cmd.turn", axis, 45)
        assert gap(cam.call("cmd.get_view"), home) > 0.1, axis

    cam.call("cmd.reset")
    for axis in ("x", "y", "z"):
        assert cam.call_reply("cmd.move", axis, 1)["t"] == "ok", axis
    reply = cam.call_reply("cmd.move", "w", 1)
    assert reply["t"] == "err", reply
    assert reply["error"]["kind"] == "CmdException", reply


def test_zoom_and_orient_swallow_an_unknown_name_but_center_raises(
    cam: WSClient,
) -> None:
    """DEFECT: three commands, two error contracts, one silent no-op.

    MEASURED: ``zoom nosuchobject`` and ``orient nosuchobject`` reply ``ok``
    with the camera untouched (the ``Selector-Error`` only reaches the shared
    feedback ring), ``center nosuchobject`` replies ``err``.  An empty but
    VALID selection is ``ok`` + a warning for all three, which is the
    documented behaviour ("no longer an error to zoom on an empty selection").
    """
    cam.call("cmd.reset")
    home = cam.call("cmd.get_view")

    assert cam.call_reply("cmd.zoom", "f7_no_such_object")["t"] == "ok"
    assert gap(cam.call("cmd.get_view"), home) == 0.0
    assert cam.call_reply("cmd.orient", "f7_no_such_object")["t"] == "ok"
    assert gap(cam.call("cmd.get_view"), home) == 0.0
    assert cam.call_reply("cmd.center", "f7_no_such_object")["t"] == "err"
    assert gap(cam.call("cmd.get_view"), home) == 0.0

    for fn in ("cmd.zoom", "cmd.center", "cmd.orient"):
        assert cam.call_reply(fn, "resi 9999")["t"] == "ok", fn
        assert gap(cam.call("cmd.get_view"), home) == 0.0, fn


def test_set_view_animates_and_lands_on_the_exact_eighteen_floats(
    cam: WSClient,
) -> None:
    """``cmd.set_view(view, animate=d)`` is the same sweep, same endpoint.

    MEASURED: gap at return 0.0, gap after ``quiet_view`` 0.0 against the
    requested 18 floats.  ``animate=0`` (the default) lands before the reply
    AND aborts a sweep already running (``packages/engine/layer1/Scene.cpp:930-934``).
    """
    cam.call("cmd.reset")
    home = cam.call("cmd.get_view")
    wanted = list(home)
    wanted[11] = home[11] / 2.0

    cam.call("cmd.set_view", wanted, animate=1.0)
    assert gap(cam.call("cmd.get_view"), home) == 0.0
    assert gap(quiet_view(cam), wanted) == 0.0

    cam.call("cmd.reset")
    cam.call("cmd.set_view", wanted, animate=0)
    assert gap(cam.call("cmd.get_view"), wanted) == 0.0

    # abort: a sweep in flight is killed by the next animate=0 set_view
    cam.call("cmd.reset")
    cam.call("cmd.zoom", "resi 20", animate=2.0)
    time.sleep(0.3)
    cam.call("cmd.set_view", home, animate=0)
    assert gap(cam.call("cmd.get_view"), home) == 0.0
    time.sleep(0.4)
    assert gap(cam.call("cmd.get_view"), home) == 0.0

    assert cam.call_reply("cmd.set_view", wanted[:17])["t"] == "err"


# ==========================================================================
# 3. viewport
# ==========================================================================


def test_get_viewport_output_modes_and_the_deprecated_tuple_syntax(
    cam: WSClient, bridge
) -> None:
    """``get_viewport`` output 0/1/2 -> a pair; 3 -> a deprecated STRING.

    ``viewing.py:853``.  MEASURED at the suite's 800x600: modes 0, 1 and 2 all
    return ``[800, 600]`` (mode 0 also prints), mode 3 returns
    ``'viewport (  800,  600 )\\n'`` and emits
    ``Warning: get_viewport(3) is deprecated``.

    The tuple syntax of ``cmd.viewport`` is a COMMAND-LINE-only affordance: the
    deprecation branch (``viewing.py:1473-1478``) only fires when ``width`` is a
    STRING and ``height`` is still -1, so ``cmd.viewport([640, 480])`` over the
    socket is a plain ``TypeError`` from ``int(list)``, not a deprecation.
    Either way nothing resizes — see
    ``test_wf_camera.py::test_cmd_viewport_is_a_no_op_and_reshape_is_the_real_resize``.
    """
    size = list(cam.call("cmd.get_viewport"))
    assert len(size) == 2 and size[0] > 0 and size[1] > 0

    for output in (0, 1, 2):
        assert list(cam.call("cmd.get_viewport", output)) == size, output

    as_string = cam.call("cmd.get_viewport", 3)
    assert isinstance(as_string, str)
    assert as_string.strip().startswith("viewport")
    assert str(size[0]) in as_string and str(size[1]) in as_string
    assert any(
        "get_viewport(3) is deprecated" in line
        for line in bridge.wait_for_feedback("get_viewport(3) is deprecated", 5.0)
    )

    # a JSON list is not the tuple syntax
    reply = cam.call_reply("cmd.viewport", [640, 480])
    assert reply["t"] == "err" and reply["error"]["type"] == "TypeError"

    # the real tuple syntax: a string, height left at the default
    before = list(cam.call("cmd.get_viewport"))
    assert cam.call_reply("cmd.viewport", "(%d,%d)" % (before[0], before[1]))["t"] == "ok"
    assert any(
        "Tuple-syntax" in line
        for line in bridge.wait_for_feedback("Tuple-syntax", 5.0)
    )
    time.sleep(0.3)
    assert list(cam.call("cmd.get_viewport")) == before
