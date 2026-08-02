"""Wave 10, parity row 415: WHO ACTUALLY SCULPTS, and does the client hear it.

Wave 9 claimed "the bridge pump DRAWS and never idles, so on this backend
``sculpting 1`` moved no atom at all", and built ``cmd.builder_sculpt_tick`` +
a 20 Hz client ticker on top of that claim.  Wave 9's auditor refuted the
premise by measurement and left the row with two open questions:

  1. is the pump's own idle sculpting enough (i.e. is the extra client ticker
     redundant)?
  2. does ONE sculpt delta ever reach the client on the geometry stream?

Both are answered here, against the real engine, with no client tick anywhere:

  * :func:`test_the_engine_idle_loop_sculpts_with_no_client_tick_at_all` —
    ``engine.py:236`` is ``self.p.idle()`` inside ``tick()``, i.e. ``PyMOL_Idle``
    at the pump rate, and ``PyMOL_Idle`` is where ``ExecutiveSculptIterateAll``
    lives (``packages/engine/layer5/PyMOL.cpp:2424``).  Measured drift, printed.
  * :func:`test_a_sculpt_delta_reaches_the_client_on_the_geometry_stream` —
    the content-addressed geometry the client pulls CHANGES while nothing but
    the idle loop runs, the invalidation scan announces it, and the actual
    float coordinates in the delivered buffer have moved.

and the consequence for the client is pinned by
:func:`test_zero_cycles_reads_the_strain_without_iterating`, which is what lets
``sculptTicker.ts`` show a converging strain WITHOUT running a second
minimiser beside the engine's own.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p10_viewport.py -q
"""

from __future__ import annotations

import os
import struct
import sys
import time
from typing import Any, Dict, List, Tuple

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.session import decode_binary_frame  # noqa: E402
from tenmol_bridge.render.modeg import GeometryService, rep_id  # noqa: E402

STICKS = rep_id("sticks")

#: The scratch object.  Named so a leak is obvious in any other test's output.
OBJ = "p10sculpt"


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def coords(bridge, name: str = OBJ) -> List[Tuple[float, float, float]]:
    def body(engine):
        out: List[Tuple[float, float, float]] = []
        engine.cmd.iterate_state(
            -1, name, "out.append((x, y, z))", space={"out": out}
        )
        return out

    return bridge.pump.call(body, timeout=120)


def max_delta(a, b) -> float:
    return max(
        max(abs(p[i] - q[i]) for i in range(3)) for p, q in zip(a, b)
    )


@pytest.fixture
def sculpting(bridge):
    """A displaced alanine with sculpting armed, and every global restored.

    The ``sculpting`` SETTING is exactly ``ControlIdling``
    (``packages/engine/layer1/Control.cpp:397-403``), i.e. leaving it on would make every later
    test in this shared process run a minimiser in the background.
    """
    before = bridge.pump.call(
        lambda engine: {
            "sculpting": int(engine.cmd.get_setting_int("sculpting")),
            "cycles": int(engine.cmd.get_setting_int("sculpting_cycles")),
            "names": list(engine.cmd.get_names("public")),
        },
        timeout=120,
    )

    def setup(engine):
        cmd = engine.cmd
        cmd.delete(OBJ)
        cmd.fragment("ala", OBJ)
        cmd.sculpt_activate(OBJ)
        # One atom pulled 1 A out of place: the strain the minimiser then works
        # off is what makes the drift measurable rather than numerical noise.
        cmd.alter_state(1, "%s and name CB" % OBJ, "x = x + 1.0")
        cmd.rebuild(OBJ)
        cmd.refresh()

    bridge.pump.call(setup, timeout=300)
    yield OBJ

    def teardown(engine):
        cmd = engine.cmd
        cmd.set("sculpting", before["sculpting"])
        cmd.set("sculpting_cycles", before["cycles"])
        try:
            cmd.sculpt_deactivate(OBJ)
        except Exception:  # noqa: BLE001
            pass
        cmd.delete(OBJ)
        cmd.refresh()
        return list(cmd.get_names("public"))

    after = bridge.pump.call(teardown, timeout=300)
    assert OBJ not in after, "the scratch object leaked into the shared session"
    assert sorted(after) == sorted(before["names"]), "the scene was not restored"


def set_sculpting(bridge, value: int) -> None:
    bridge.pump.call(lambda engine: engine.cmd.set("sculpting", value), timeout=120)


# --------------------------------------------------------------------------- #
# 1. who sculpts
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_the_engine_idle_loop_sculpts_with_no_client_tick_at_all(bridge, sculpting):
    """THE PREMISE WAVE 9 GOT WRONG, measured both ways.

    Reading the coordinates in the same millisecond as the ``set`` shows
    nothing, which is exactly how the wave-9 test convinced itself that
    "sculpting 1 moved no atom at all".  Waiting SECONDS shows the minimiser
    running with no client, no tick and no pixel subscriber.
    """
    start = coords(bridge)
    set_sculpting(bridge, 1)

    # Same millisecond as the write: the pump has not ticked once.
    immediate = max_delta(start, coords(bridge))

    time.sleep(2.0)
    drifted = max_delta(start, coords(bridge))
    set_sculpting(bridge, 0)

    # And it STOPS when the flag goes off, which is the other half of
    # `ControlIdling` being the gate.
    settled = coords(bridge)
    time.sleep(1.0)
    after_off = max_delta(settled, coords(bridge))

    print(
        "idle sculpting: immediate=%.4f A, after 2.0 s=%.4f A, "
        "1.0 s after sculpting 0=%.4f A" % (immediate, drifted, after_off)
    )
    assert immediate < 0.01, "the pump had already ticked before the baseline read"
    assert drifted > 0.2, (
        "the engine's own idle loop did NOT sculpt: %.4f A of drift in 2 s" % drifted
    )
    assert after_off < 1e-4, "atoms kept moving after `set sculpting, 0`"


@pytest.mark.engine
def test_zero_cycles_reads_the_strain_without_iterating(bridge, sculpting):
    """``cmd.sculpt_iterate(obj, state, 0)`` is a MEASUREMENT, not a step.

    This is what lets the panel show a converging strain without running a
    second minimiser beside the engine's own — and it is the same call
    ``SculptWizard.sculpt_deactivate`` makes on the way out
    (``packages/engine/modules/pmg_qt/builder.py:158``).
    """
    before = coords(bridge)
    strain0 = bridge.pump.call(
        lambda engine: engine.cmd.sculpt_iterate(OBJ, engine.cmd.get_state(), 0),
        timeout=120,
    )
    moved_by_read = max_delta(before, coords(bridge))

    strain10 = bridge.pump.call(
        lambda engine: engine.cmd.sculpt_iterate(OBJ, engine.cmd.get_state(), 10),
        timeout=120,
    )
    moved_by_ten = max_delta(before, coords(bridge))

    print(
        "sculpt_iterate: 0 cycles -> strain %.4f, moved %.6f A; "
        "10 cycles -> strain %.4f, moved %.4f A"
        % (strain0, moved_by_read, strain10, moved_by_ten)
    )
    assert strain0 > 0.0, "a displaced atom must carry strain"
    assert moved_by_read == 0.0, "a 0-cycle read MOVED an atom"
    assert moved_by_ten > 1e-3, "10 cycles moved nothing"
    assert strain10 < strain0, "the minimiser did not reduce the strain"


@pytest.mark.engine
def test_builder_sculpt_tick_still_reports_the_engines_own_gate(bridge, ws, sculpting):
    """The client tick is still correct about WHEN, over the real socket.

    With the flag off it reports ``active: false`` and iterates nothing; with
    it on it reports the strain.  ``cycles=0`` is the redundancy fix:
    ``sculptTicker.ts`` polls with it, so the panel's number comes from the
    engine's own minimisation instead of a second one.
    """
    ws.do(
        "_ __import__('tenmol_bridge.panels.builder', fromlist=['install'])"
        ".install(cmd)"
    )
    off = ws.call("cmd.builder_sculpt_tick")
    assert off["active"] is False and off["strain"] == 0.0

    set_sculpting(bridge, 1)
    try:
        before = coords(bridge)
        polled = ws.call("cmd.builder_sculpt_tick", 0)
        moved = max_delta(before, coords(bridge))
        assert polled["active"] is True
        assert polled["cycles"] == 0
        assert polled["strain"] > 0.0
        print(
            "builder_sculpt_tick(0): strain %.4f, own movement %.6f A"
            % (polled["strain"], moved)
        )
        # It may have drifted between the two reads because the ENGINE is
        # sculpting; what matters is that the poll is not adding cycles of its
        # own — 0 cycles cannot move an atom (asserted exactly above).
    finally:
        set_sculpting(bridge, 0)


# --------------------------------------------------------------------------- #
# 2. does the client hear it
# --------------------------------------------------------------------------- #


def positions(result) -> List[Tuple[float, ...]]:
    """Every instance's first three floats — the cylinder origins of a stick."""
    _meta, body = decode_binary_frame(result.frame)
    payload = bytes(body)
    out: List[Tuple[float, ...]] = []
    for instance in result.header["instances"]:
        ref = instance["data"]
        item = instance["itemSize"]
        for i in range(instance["count"]):
            out.append(
                struct.unpack_from("<3f", payload, ref["byteOffset"] + i * item * 4)
            )
    return out


@pytest.mark.engine
def test_a_sculpt_delta_reaches_the_client_on_the_geometry_stream(bridge, sculpting):
    """Row 415's actual clause: a sculpt delta on the stream, on a timer.

    Nothing here ticks the sculptor.  The pump's idle loop moves the atoms, the
    rep version counters see it, ``GeometryService.scan`` — the same call
    ``RenderService._on_tick`` makes at 4 Hz — announces the key, and the
    geometry the client would then pull carries DIFFERENT float coordinates.
    """
    service = GeometryService(bridge.pump)
    if not service.capabilities(bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")
    if not service.capabilities(bridge.pump.engine)["exactInvalidation"]:
        pytest.skip("no version counters")

    def show(engine):
        engine.cmd.show("sticks", OBJ)
        engine.cmd.refresh()

    bridge.pump.call(show, timeout=300)

    # Prime the invalidation table, then prove it is quiet.
    service.scan(bridge.pump.engine)
    bridge.pump.call(lambda engine: service.scan(engine), timeout=120)
    assert bridge.pump.call(lambda engine: service.scan(engine), timeout=120) == [], (
        "the scene is not quiet before the measurement"
    )

    first = bridge.pump.call(
        lambda engine: service.fetch(engine, OBJ, "sticks", state=-1), timeout=300
    )
    assert first.status == "ok", first.to_json()
    before = positions(first)
    assert before, "no stick instances to watch"

    set_sculpting(bridge, 1)
    time.sleep(1.5)
    set_sculpting(bridge, 0)

    changes = bridge.pump.call(lambda engine: service.scan(engine), timeout=120)
    keys = {(c["object"], c["rep"]) for c in changes}
    print("scan after 1.5 s of idle sculpting: %r" % (sorted(str(k) for k in keys),))

    second = bridge.pump.call(
        lambda engine: service.fetch(engine, OBJ, "sticks", state=-1), timeout=300
    )
    after = positions(second)
    moved = max(
        max(abs(p[i] - q[i]) for i in range(3)) for p, q in zip(before, after)
    )
    print(
        "geometry stream: hash %s -> %s, %d instances, max vertex delta %.4f A"
        % (first.content_hash[:12], second.content_hash[:12], len(after), moved)
    )

    assert (OBJ, STICKS) in keys, (
        "the 4 Hz invalidation scan never told the client the sticks changed"
    )
    assert second.content_hash != first.content_hash, (
        "the content-addressed geometry is byte-identical, so a client holding "
        "the old hash would be answered `unchanged` and never see the sculpt"
    )
    assert moved > 1e-3, "the delivered geometry did not move"


# --------------------------------------------------------------------------- #
# 3. row 131: the dot normals the accessor always had
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_dots_now_ship_the_normal_the_accessor_returns(bridge, sculpting):
    """Row 131's dots half: `RepDot::VN` reaches the client.

    It rides as an OPTIONAL SUB-BUFFER on the instance -- the shape ``atom``,
    ``bond`` and ``atom2`` already use -- so the 8-float ``sphere`` record is
    untouched and `test_modeg_objects.py`'s size guard still holds. Both facts
    are asserted here together, because the second is what makes the first
    additive rather than a wire break.
    """
    service = GeometryService(bridge.pump)
    if not service.capabilities(bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")

    def show(engine):
        engine.cmd.show("dots", OBJ)
        engine.cmd.refresh()

    bridge.pump.call(show, timeout=300)
    result = bridge.pump.call(
        lambda engine: service.fetch(engine, OBJ, "dots", state=-1), timeout=300
    )
    if result.status != "ok":
        pytest.skip("dots not built: %s" % result.message)

    instance = result.header["instances"][0]
    count = instance["count"]
    assert count > 0
    # UNCHANGED, and this is the compatibility half of the claim.
    assert instance["kind"] == "sphere"
    assert instance["itemSize"] == 8
    assert instance["data"]["byteLength"] == count * 8 * 4

    ref = instance.get("normal")
    assert ref is not None, "the dot normals are still being dropped"
    assert ref["dtype"] == "f32" and ref["itemSize"] == 3
    assert ref["byteLength"] == count * 3 * 4

    _meta, body = decode_binary_frame(result.frame)
    payload = bytes(body)
    lengths = []
    for i in range(min(count, 64)):
        n = struct.unpack_from("<3f", payload, ref["byteOffset"] + i * 3 * 4)
        lengths.append((n[0] ** 2 + n[1] ** 2 + n[2] ** 2) ** 0.5)
    print(
        "dots: %d normals, |n| in [%.4f, %.4f]"
        % (count, min(lengths), max(lengths))
    )
    # Unit normals, not zeros: a zero normal would shade every dot black and
    # would be indistinguishable from "the buffer is there" on size alone.
    assert min(lengths) > 0.9 and max(lengths) < 1.1


@pytest.mark.engine
def test_an_unchanged_scene_still_answers_unchanged(bridge, sculpting):
    """The counterexample that makes the one above mean something.

    Without sculpting the same fetch is byte-identical and a client that sends
    its `have` hash is told so — i.e. the hash change measured above is the
    sculpt, not the fetch being non-deterministic.
    """
    service = GeometryService(bridge.pump)
    if not service.capabilities(bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")

    bridge.pump.call(
        lambda engine: (engine.cmd.show("sticks", OBJ), engine.cmd.refresh()),
        timeout=300,
    )
    first = bridge.pump.call(
        lambda engine: service.fetch(engine, OBJ, "sticks", state=-1), timeout=300
    )
    time.sleep(1.5)
    second = bridge.pump.call(
        lambda engine: service.fetch(
            engine, OBJ, "sticks", state=-1, have=first.content_hash
        ),
        timeout=300,
    )
    print("idle 1.5 s: status=%s hash=%s" % (second.status, first.content_hash[:12]))
    assert second.status == "unchanged"
