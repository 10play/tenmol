"""Defect **D1** — Mode G must not leave stale geometry on screen.

The reproduction, end to end::

    load 1ubq; show cartoon        -> Mode G draws the cartoon
    hide everything                -> the cartoon MUST disappear
    show sticks; show spheres      -> sticks + spheres MUST appear

Wave 1 got the first line right and neither of the other two: the bridge's
invalidation was a 4 Hz fingerprint of ``cmd.get_vis() + get_state() +
get_frame()`` which (a) carries no identity, so it could say "something moved"
but never "drop the cartoon", and (b) is object-level, so it cannot see a
recolour at all.  Both are asserted below against a real PyMOL.

Layout::

    part 1   tenmol_bridge.state.repversions — pure, no PyMOL, no GL
    part 2   GeometryService.scan against a live engine (``engine`` mark)
    part 3   the payload a polling client reads out of ``_bridge.render_stats``

Run with the venv that has the PyMOL built from this tree::

    bridge/.venv/bin/python -m pytest bridge/tests/test_modeg.py -q
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.render.modeg import (  # noqa: E402
    REP_IDS,
    GeometryService,
    RepInv,
    rep_id,
)
from tenmol_bridge.state import repversions  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
PDB_SMALL = REPO / "testing" / "data" / "1rx1.pdb"

CARTOON = rep_id("cartoon")
STICKS = rep_id("sticks")
SPHERES = rep_id("spheres")


# --------------------------------------------------------------------------- #
# part 1 — the pure diff.  No PyMOL, no GL, no bridge.
# --------------------------------------------------------------------------- #


def raw(objects: Dict[str, Any]) -> Dict[str, Any]:
    """Shape one ``_cmd.web_get_versions()`` answer."""
    out: Dict[str, Any] = {"changed": True, "objects": {}}
    for name, spec in objects.items():
        reps = {
            key: {"version": value[0], "active": value[1]}
            for key, value in spec.get("reps", {}).items()
        }
        out["objects"][name] = {
            "version": spec.get("version", 1),
            "enabled": spec.get("enabled", True),
            "reps": reps,
        }
    return out


def table(objects: Dict[str, Any]):
    return repversions.build_table(raw(objects), REP_IDS)


def by_rep(changes: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    return {change["rep"]: change for change in changes}


def test_the_key_is_byte_identical_to_the_typescript_one():
    """``geometryKey()`` in ``packages/protocol/src/geometry.ts`` joins on NUL.

    A PyMOL object name may contain spaces, slashes and dots, so any other
    separator eventually collides and the client silently draws the wrong
    object's buffers.
    """
    key = repversions.make_key("a b/c.d", 2, CARTOON)
    assert key == "a b/c.d\x00" + "2" + "\x00" + str(CARTOON)
    assert repversions.parse_key(key) == ("a b/c.d", 2, CARTOON)
    # and the two implementations in this repo agree
    assert key == GeometryService.key("a b/c.d", 2, "cartoon")


def test_an_unknown_rep_name_is_skipped_rather_than_guessed():
    built = table({"u": {"reps": {"cartoon|0": (1, True), "warp_drive|0": (1, True)}}})
    assert [entry.rep for entry in built.values()] == [CARTOON]


def test_hiding_a_rep_produces_a_drop_and_not_a_refetch():
    """THE defect.  ``active: false`` is the only signal that says "drop it"."""
    before = table({"u": {"reps": {"cartoon|0": (1, True)}}})
    after = table({"u": {"reps": {"cartoon|0": (2, False)}}})
    changes = repversions.diff_tables(before, after)
    assert len(changes) == 1
    change = changes[0]
    assert change["active"] is False
    assert change["reason"] == "hidden"
    assert change["level"] == RepInv.VISIB
    assert change["object"] == "u" and change["rep"] == CARTOON


def test_showing_a_new_rep_produces_a_refetch():
    before = table({"u": {"reps": {"cartoon|0": (2, False)}}})
    after = table(
        {"u": {"reps": {"cartoon|0": (2, False), "sticks|0": (1, True)}}}
    )
    changes = by_rep(repversions.diff_tables(before, after))
    assert set(changes) == {STICKS}
    assert changes[STICKS]["active"] is True
    assert changes[STICKS]["reason"] == "created"
    assert changes[STICKS]["level"] == RepInv.ALL


def test_a_rep_that_appears_already_hidden_is_absorbed_silently():
    """Otherwise every ``hide`` produces a pull that answers ``not-built``."""
    changes = repversions.diff_tables(
        {}, table({"u": {"reps": {"cartoon|0": (2, False)}}})
    )
    assert changes == []


def test_a_version_bump_with_no_visibility_change_is_a_refetch():
    before = table({"u": {"reps": {"sticks|0": (1, True)}}})
    after = table({"u": {"reps": {"sticks|0": (2, True)}}})
    changes = repversions.diff_tables(before, after)
    assert [c["reason"] for c in changes] == ["changed"]
    assert changes[0]["level"] == RepInv.ALL


def test_an_identical_table_produces_nothing():
    one = table({"u": {"reps": {"sticks|0": (7, True), "cartoon|0": (3, False)}}})
    two = table({"u": {"reps": {"sticks|0": (7, True), "cartoon|0": (3, False)}}})
    assert repversions.diff_tables(one, two) == []


def test_deleting_an_object_drops_every_key_it_owned():
    before = table(
        {"u": {"reps": {"sticks|0": (1, True), "cartoon|1": (1, True)}}}
    )
    changes = repversions.diff_tables(before, {})
    assert len(changes) == 2
    assert {c["reason"] for c in changes} == {"deleted"}
    assert all(c["active"] is False for c in changes)
    assert {(c["state"], c["rep"]) for c in changes} == {(0, STICKS), (1, CARTOON)}


def test_renaming_is_a_delete_plus_a_create():
    before = table({"u": {"reps": {"sticks|0": (1, True)}}})
    after = table({"v": {"reps": {"sticks|0": (1, True)}}})
    changes = repversions.diff_tables(before, after)
    assert [(c["object"], c["reason"]) for c in changes] == [
        ("u", "deleted"),
        ("v", "created"),
    ]


def test_disabling_an_object_hides_every_rep_it_owns():
    """``disable`` leaves ``rep.active`` true in the C++ but must not draw.

    ``active`` on the wire is EFFECTIVE visibility; ``rep_active`` and
    ``enabled`` are kept separately so the reason is never lost.
    """
    before = table({"u": {"reps": {"sticks|0": (1, True)}}})
    after = table({"u": {"enabled": False, "reps": {"sticks|0": (1, True)}}})
    changes = repversions.diff_tables(before, after)
    assert [c["reason"] for c in changes] == ["hidden"]
    entry = list(after.values())[0]
    assert entry.rep_active is True and entry.enabled is False
    assert entry.active is False


def test_the_diff_is_ordered_and_carries_cached_sizes():
    before = table({"b": {"reps": {"sticks|0": (1, True)}}})
    after = table(
        {
            "b": {"reps": {"sticks|0": (2, True)}},
            "a": {"reps": {"cartoon|0": (1, True)}},
        }
    )
    sizes = {repversions.make_key("b", 0, STICKS): 4096}
    changes = repversions.diff_tables(before, after, sizes)
    assert [c["object"] for c in changes] == ["a", "b"]
    assert by_rep(changes)[STICKS]["estimatedBytes"] == 4096


def test_the_compact_row_form_is_what_the_client_parses():
    rows = repversions.table_rows(table({"u": {"reps": {"cartoon|0": (3, True)}}}))
    assert repversions.ROW_FORMAT == ("object", "state", "rep", "version", "active")
    assert rows == [["u", 0, CARTOON, 3, 1]]


# --------------------------------------------------------------------------- #
# part 2 — against a live engine
# --------------------------------------------------------------------------- #


def scan(bridge, service: GeometryService) -> List[Dict[str, Any]]:
    return bridge.pump.call(lambda engine: service.scan(engine), timeout=120)


def do(bridge, *lines: str) -> None:
    def body(engine):
        for line in lines:
            engine.cmd.do(line)

    bridge.pump.call(body, timeout=120)
    # cmd.do is DEFERRED (OrthoCommandIn -> PyMOL_Idle); give the queue a tick.
    bridge.pump.call(lambda engine: engine.cmd.refresh(), timeout=120)


@pytest.fixture
def service(bridge):
    """A private :class:`GeometryService` on the product pump.

    Private deliberately: the product one is polled by ``RenderService._on_tick``
    at 4 Hz, and a test that shares it races the tick for the diff.  A second
    *GeometryService* is harmless — unlike a second ``FrameStream``, it owns no
    destructive flag; it only reads ``_cmd.web_get_versions``.
    """
    return GeometryService(bridge.pump)


@pytest.mark.engine
def test_the_counters_are_present_and_capabilities_says_so(bridge, service):
    caps = service.capabilities(bridge.pump.engine)
    if not caps["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")
    assert caps["exactInvalidation"] is True, (
        "this PyMOL build has no _cmd.web_get_versions; Mode G invalidation is "
        "the old inexact fingerprint and D1 cannot be fixed"
    )
    assert caps["invalidationSources"][0] == "rep-version-counters"


@pytest.mark.engine
def test_hide_everything_then_show_sticks_names_exactly_the_right_keys(
    bridge, service
):
    """The D1 reproduction, bridge side."""
    if not service.capabilities(bridge.pump.engine)["exactInvalidation"]:
        pytest.skip("no version counters")

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(PDB_SMALL), "m")
        cmd.hide("everything")
        cmd.show("cartoon", "m")
        cmd.refresh()

    bridge.pump.call(setup, timeout=300)
    assert scan(bridge, service) == [], "the first scan must only prime"
    assert scan(bridge, service) == []

    do(bridge, "hide everything", "show sticks", "show spheres")
    changes = by_rep(scan(bridge, service))
    print("D1 diff: %s" % json.dumps(sorted(changes.values(), key=lambda c: c["rep"])))

    assert CARTOON in changes, "nothing told the client to drop the cartoon"
    assert changes[CARTOON]["active"] is False
    assert changes[CARTOON]["reason"] == "hidden"
    assert changes[CARTOON]["object"] == "m"

    for rep in (STICKS, SPHERES):
        assert rep in changes, "the newly shown rep was not announced"
        assert changes[rep]["active"] is True

    # and it settles immediately: no repeat, no oscillation
    assert scan(bridge, service) == []


@pytest.mark.engine
def test_an_idle_scene_never_refetches(bridge, service):
    """No false positives, measured over hundreds of ticks."""
    if not service.capabilities(bridge.pump.engine)["exactInvalidation"]:
        pytest.skip("no version counters")

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(PDB_SMALL), "m")
        cmd.hide("everything")
        cmd.show("cartoon", "m")
        cmd.refresh()

    bridge.pump.call(setup, timeout=300)
    scan(bridge, service)

    ticks = 600
    started = time.perf_counter()

    def loop(engine):
        spurious = 0
        for _ in range(ticks):
            if service.scan(engine):
                spurious += 1
        return spurious

    spurious = bridge.pump.call(loop, timeout=300)
    elapsed = time.perf_counter() - started
    print(
        "idle: %d scans, %d spurious, %.1f us/scan"
        % (ticks, spurious, elapsed / ticks * 1e6)
    )
    assert spurious == 0
    assert service.versions_payload()["walks"] <= 2, (
        "an idle scene made the C++ walk every Rep; the counter fast path is "
        "not being hit"
    )


@pytest.mark.engine
def test_a_recolour_is_seen_even_though_get_vis_cannot_see_it(bridge, service):
    """The hole the fingerprint could not close, reproduced both ways."""
    if not service.capabilities(bridge.pump.engine)["exactInvalidation"]:
        pytest.skip("no version counters")

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(PDB_SMALL), "m")
        cmd.hide("everything")
        cmd.show("sticks", "m")
        cmd.refresh()

    bridge.pump.call(setup, timeout=300)
    scan(bridge, service)

    before = bridge.pump.call(
        lambda engine: repr(sorted((engine.cmd.get_vis() or {}).items())), timeout=120
    )
    do(bridge, "color red, resi 1-20")
    after = bridge.pump.call(
        lambda engine: repr(sorted((engine.cmd.get_vis() or {}).items())), timeout=120
    )
    changes = by_rep(scan(bridge, service))

    assert before == after, "get_vis() moved; pick a command it really cannot see"
    assert STICKS in changes, "the recolour was invisible to the version counters"
    assert changes[STICKS]["active"] is True
    assert changes[STICKS]["reason"] == "changed"


@pytest.mark.engine
def test_deleting_an_object_drops_its_keys_and_frees_the_server_cache(
    bridge, service
):
    """No leak across a load/delete cycle."""
    caps = service.capabilities(bridge.pump.engine)
    if not caps["accessor"] or not caps["exactInvalidation"]:
        pytest.skip("no accessor / no version counters")

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(PDB_SMALL), "m")
        cmd.hide("everything")
        cmd.show("sticks", "m")
        cmd.refresh()

    for cycle in range(3):
        bridge.pump.call(setup, timeout=300)
        scan(bridge, service)
        result = bridge.pump.call(
            lambda engine: service.fetch(engine, "m", "sticks"), timeout=300
        )
        assert result.status in ("ok", "unchanged"), result.status
        assert service.stats()["cachedKeys"] >= 1

        do(bridge, "delete m")
        changes = scan(bridge, service)
        assert any(
            c["object"] == "m" and c["active"] is False and c["reason"] == "deleted"
            for c in changes
        ), "cycle %d: delete produced %r" % (cycle, changes)
        assert service.stats()["cachedKeys"] == 0, (
            "cycle %d: the server-side cache kept a key for a deleted object; "
            "a later `show` would be answered `unchanged` against buffers the "
            "client has thrown away" % cycle
        )
        assert service.versions_payload()["reps"] == []


# --------------------------------------------------------------------------- #
# part 3 — what a polling client reads
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_the_render_stats_payload_is_what_the_client_parses(bridge, service):
    """The shape ``parseVersionTable()`` in ``modeG/cache.ts`` demands."""
    if not service.capabilities(bridge.pump.engine)["exactInvalidation"]:
        pytest.skip("no version counters")

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(PDB_SMALL), "m")
        cmd.hide("everything")
        cmd.show("cartoon", "m")
        cmd.refresh()

    bridge.pump.call(setup, timeout=300)
    scan(bridge, service)
    payload = service.versions_payload()

    assert payload["exact"] is True
    assert payload["primed"] is True
    assert payload["rowFormat"] == ["object", "state", "rep", "version", "active"]
    assert isinstance(payload["epoch"], int)
    rows = payload["reps"]
    assert rows, "no rows for a scene with a visible cartoon"
    for row in rows:
        assert len(row) == 5
        assert isinstance(row[0], str)
        assert all(isinstance(value, int) for value in row[1:])
    assert any(row[2] == CARTOON and row[4] == 1 for row in rows)
    # It is polled by every Mode-G client at 4 Hz, so it has to stay small.
    print("versions payload: %d bytes, %d rows" % (len(json.dumps(payload)), len(rows)))
    assert len(json.dumps(payload)) < 64 * 1024


@pytest.mark.engine
def test_the_epoch_moves_only_when_something_really_changed(bridge, service):
    if not service.capabilities(bridge.pump.engine)["exactInvalidation"]:
        pytest.skip("no version counters")

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(PDB_SMALL), "m")
        cmd.hide("everything")
        cmd.show("cartoon", "m")
        cmd.refresh()

    bridge.pump.call(setup, timeout=300)
    scan(bridge, service)
    start = service.versions_payload()["epoch"]

    def idle(engine):
        for _ in range(200):
            service.scan(engine)

    bridge.pump.call(idle, timeout=300)
    assert service.versions_payload()["epoch"] == start, (
        "the epoch moved on an idle scene; every polling client would re-diff"
    )

    do(bridge, "show sticks")
    scan(bridge, service)
    assert service.versions_payload()["epoch"] > start


def test_forget_everything_reprimes_rather_than_diffing(bridge=None):
    """A pure-state guard: ``forget()`` must not leave a table with no cache."""
    service = GeometryService(pump=None)
    service._table = table({"u": {"reps": {"sticks|0": (1, True)}}})
    service._table_primed = True
    service.forget()
    assert service._table == {}
    assert service._table_primed is False
    assert service.versions_payload()["reps"] == []
