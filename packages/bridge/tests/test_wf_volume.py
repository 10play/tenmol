"""Setting side effects — ``SettingGenerateSideEffects`` seen from the wire.

Parity row: *"Setting side effects / geometry invalidation"*
(``docs/feature-parity.md``), whose React plan reads

    "Bridge emits a geometry-invalidation event alongside ``settings.changed``
     so the three.js layer re-requests serialized meshes/CGO.  Settings must
     NOT be treated as cosmetic."

``SettingGenerateSideEffects`` (``packages/engine/layer1/Setting.cpp:1872-2400``) runs after
EVERY write and is a ~500-line ``switch`` over the setting index.  Three of its
behaviours are observable from a WebSocket client and are pinned here:

1. **Geometry invalidation.**  Dozens of its cases call
   ``ExecutiveInvalidateRep``/``SceneChanged``/``ExecutiveRebuildAll``.  The
   bridge does NOT mirror that switch — it does something strictly better and
   measured below: ``_cmd.web_get_versions`` (``packages/engine/layer4/CmdWebGeometry.cpp:2172``)
   re-hashes the CPU geometry of every built rep whenever one of the four
   ``CExecutive`` change counters moves, and ``RenderService._on_tick``
   (4 Hz, ``render/__init__.py:213-230``) emits the diff on the ``geometry``
   topic.  So the invalidation is CONTENT-addressed, not switch-addressed:

       set stick_radius, 0.4   -> geometry {object, state 0, rep 0, level 100}
       set sphere_scale, 0.6   -> geometry {object, state 0, rep 1, level 100}
       set ray_trace_mode, 1   -> nothing
       set pickable, 0         -> nothing, AND the serialized bytes are
                                  byte-identical (hash b6822a7a7cf6 both sides),
                                  so the silence is right, not a miss.

2. **The unused-level warning** (``Setting.cpp:1876-1887``), which is a real
   feedback line a client can show.

3. **The int clamp** (``Setting.cpp:1889-1911``), whose ``!(sele && sele[0])``
   guard means a PER-OBJECT write is NOT clamped.  ``test_settings.py`` covers
   the global half; the object half is here, because a settings UI that clamps
   its own inputs would be wrong about what PyMOL stores.

MEASURED GAP, deliberately not asserted as a permanent expectation: the
``settings`` topic accepts a subscription and NOTHING EVER PUBLISHES TO IT
(``grep -rn TOPIC_SETTINGS packages/bridge/tenmol_bridge`` finds only the registry
entries).  The client's only change channel is the cursor-addressed poll
``setting.tenmol_settings_drain``, which is what :func:`test_a_setting_write_
reaches_both_the_settings_drain_and_the_geometry_topic` pairs with the geometry
event.  Pinning "no settings event arrives" would break the day someone wires
the push up, which is the wrong incentive.

SHARED STATE: this module writes GLOBAL settings into the one PyMOL process the
whole suite shares.  Every index it touches is snapshotted with
``cmd.get_setting_tuple`` and written back verbatim in a fixture, and every
object it creates is prefixed ``wfv_`` and deleted.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Iterator, List, Tuple

import pytest

BOOTSTRAP = "/import tenmol_bridge.panels.settings as _s;_s.install()"

#: ``cRep_t`` (``packages/engine/layer1/Rep.h``) — the two reps this module builds.
REP_STICKS = 0
REP_SPHERES = 1

#: ``packages/engine/layer1/SettingInfo.h`` rows.  Resolved from the live catalogue in
#: :func:`test_the_indices_this_module_uses_are_the_ones_in_settinginfo_h`, so a
#: renumbered table fails loudly instead of silently testing the wrong setting.
IDX = {
    "stick_radius": 21,
    "sphere_scale": 155,
    "ray_trace_mode": 468,
    "pickable": 50,
    "sphere_quality": 87,
    "unused_boolean_def_true": 419,
}


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def settings_guard(ws: Any) -> Iterator[Any]:
    """Restore every global setting this module writes, whatever happens.

    ``cmd.unset`` would restore the DEFAULT, not the value another test left
    behind, so the raw ``(type, value)`` tuple is snapshotted and written back.
    """
    ws.do(BOOTSTRAP)
    saved: Dict[int, Any] = {}
    for index in IDX.values():
        # `SettingGetTuple` answers `(type, (value,))` — the value is wrapped
        # in a 1-tuple, so writing `tup[1]` straight back sets a LIST.
        saved[index] = setting_value(ws, index)
    try:
        yield ws
    finally:
        for index, value in saved.items():
            if value is None:
                continue
            try:
                ws.call("cmd.set", index, value)
            except AssertionError:  # noqa: PERF203 - teardown must not mask
                pass


@pytest.fixture
def scene(ws: Any) -> Iterator[str]:
    """One molecule with sticks AND spheres built, deleted afterwards.

    No ``cmd.reinitialize``: this process is shared, and wiping it would take
    every other test's objects, settings and camera with it.
    """
    name = "wfv_ala"
    ws.call("cmd.delete", name)
    ws.call("cmd.fragment", "ala", name)
    ws.call("cmd.show_as", "sticks", name)
    ws.call("cmd.show", "spheres", name)
    ws.call("cmd.refresh")
    try:
        yield name
    finally:
        ws.call("cmd.delete", name)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def drain_geometry(ws: Any, seconds: float) -> List[Dict[str, Any]]:
    """Read the socket for ``seconds`` and return every invalidation row."""
    ws.events.clear()
    ws.pump_frames(seconds)
    rows: List[Dict[str, Any]] = []
    for event in ws.events:
        if event.get("topic") == "geometry":
            rows.extend(event.get("payload", {}).get("invalidated", []))
    return rows


def wait_geometry(ws: Any, obj: str, timeout: float = 4.0) -> List[Dict[str, Any]]:
    """Invalidations naming ``obj``.  Returns as soon as one arrives."""
    deadline = time.monotonic() + timeout
    rows: List[Dict[str, Any]] = []
    while time.monotonic() < deadline:
        rows.extend(
            row for row in drain_geometry(ws, 0.4) if row.get("object") == obj
        )
        if rows:
            break
    return rows


def rep_hashes(ws: Any, obj: str) -> Tuple[str, str]:
    """The md5 of the serialized Mode-G payload for sticks and spheres.

    This is the number that decides whether an invalidation was NEEDED: it is
    the hash of the very bytes the three.js layer would re-request.
    """
    ws.call("cmd.refresh")
    out = []
    for rep in ("sticks", "spheres"):
        result = ws.call("_bridge.get_geometry", object=obj, rep=rep)
        assert result["status"] == "ok", (rep, result["status"], result["message"])
        out.append(str(result["hash"]))
    return out[0], out[1]


def setting_value(ws: Any, index: int) -> Any:
    """``cmd.get_setting_tuple(index)`` -> the scalar it wraps.

    ``SettingGetTuple`` (``packages/engine/layer1/Setting.cpp:1445``) returns ``(type, (v,))``
    for every scalar type, so the payload over the wire is ``[2, [4]]``, not
    ``[2, 4]``.
    """
    tup = ws.call("cmd.get_setting_tuple", index)
    assert isinstance(tup, (list, tuple)) and len(tup) == 2, tup
    value = tup[1]
    if isinstance(value, (list, tuple)) and len(value) == 1:
        return value[0]
    return value


def setting_type(ws: Any, index: int) -> int:
    return int(ws.call("cmd.get_setting_tuple", index)[0])


def feedback_count(bridge: Any, needle: str) -> int:
    return sum(1 for line in bridge.feedback_lines() if needle in line)


# ---------------------------------------------------------------------------
# 0. the table this module indexes into
# ---------------------------------------------------------------------------


def test_the_indices_this_module_uses_are_the_ones_in_settinginfo_h(ws: Any) -> None:
    """Indices are FROZEN (``packages/engine/layer1/SettingInfo.h:5-6``); names are not."""
    ws.do(BOOTSTRAP)
    catalogue = ws.call("setting.tenmol_settings_catalogue")
    by_index = {row["index"]: row for row in catalogue["settings"]}
    for name, index in IDX.items():
        if name == "unused_boolean_def_true":
            # Unused-level records are NOT in `cmd.setting.get_name_list()`, so
            # the catalogue cannot see them at all — measured: the catalogue
            # reports 0 rows at level 'unused' while `packages/engine/layer1/SettingInfo.h`
            # declares 19.  Checked through the engine instead.
            assert ws.call("cmd.get_setting_tuple", index)[0] == 1  # boolean
            continue
        assert by_index[index]["name"] == name, (index, by_index[index]["name"])


# ---------------------------------------------------------------------------
# 1. the row's actual claim
# ---------------------------------------------------------------------------


def test_a_setting_write_reaches_both_the_settings_drain_and_the_geometry_topic(
    ws: Any, settings_guard: Any, scene: str
) -> None:
    """"...alongside ``settings.changed``" — both channels, one ``cmd.set``."""
    ws.subscribe("geometry")
    drain_geometry(ws, 1.5)  # the 'created' rows for `scene`
    cursor = ws.call("setting.tenmol_settings_drain", 0)["cursor"]

    ws.call("cmd.set", "stick_radius", 0.4)

    rows = wait_geometry(ws, scene)
    assert rows, "no geometry invalidation for a rep-invalidating setting"
    sticks = [row for row in rows if row["rep"] == REP_STICKS]
    assert sticks, "sticks were not named: %r" % (rows,)
    entry = sticks[0]
    assert entry["state"] == 0
    assert entry["reason"] == "changed"
    assert entry["level"] == 100  # cRepInvAll — rebuild, not recolour
    assert entry["active"] is True

    deadline = time.monotonic() + 5.0
    seen: Dict[str, Any] = {"indices": []}
    while time.monotonic() < deadline:
        seen = ws.call("setting.tenmol_settings_drain", cursor)
        if IDX["stick_radius"] in seen["indices"]:
            break
        time.sleep(0.1)
    assert IDX["stick_radius"] in seen["indices"], (
        "the settings half never arrived: %r" % (seen,)
    )


def test_geometry_invalidation_tracks_the_serialized_bytes_not_the_switch(
    ws: Any, settings_guard: Any, scene: str
) -> None:
    """An invalidation is emitted EXACTLY when the shipped payload changes.

    The order is deliberate: a negative row is never last, so the final
    positive row proves the pipe was still alive when the negatives were
    measured (a dead scan would report "no invalidation" for everything).
    """
    ws.subscribe("geometry")
    drain_geometry(ws, 1.5)

    matrix = [
        ("ray_trace_mode", 1),
        ("stick_radius", 0.4),
        ("pickable", 0),
        ("sphere_scale", 0.6),
    ]

    outcomes: List[Tuple[str, bool, bool]] = []
    for name, value in matrix:
        before = rep_hashes(ws, scene)
        drain_geometry(ws, 0.6)  # the refresh above can move things itself
        ws.call("cmd.set", name, value)
        rows = wait_geometry(ws, scene, timeout=2.5)
        after = rep_hashes(ws, scene)
        outcomes.append((name, before != after, bool(rows)))

    for name, bytes_changed, invalidated in outcomes:
        assert bytes_changed == invalidated, (
            "%s: serialized bytes changed=%s but geometry event=%s (%r)"
            % (name, bytes_changed, invalidated, outcomes)
        )
    # The matrix proves nothing unless it contains both answers.
    assert any(row[1] for row in outcomes), outcomes
    assert any(not row[1] for row in outcomes), outcomes


def test_pickable_rebuilds_the_rep_without_changing_a_single_shipped_byte(
    ws: Any, settings_guard: Any, scene: str
) -> None:
    """The sharpest case, and the reason content-addressing is the right call.

    ``case cSetting_pickable`` (``Setting.cpp:1919-1922``) invalidates EVERY rep
    of every object at ``cRepInvAll`` and calls ``SceneChanged`` — the loudest
    thing in the switch.  The Mode-G payload is unaffected, and not by luck:
    for sticks and spheres the setting is read at DRAW time
    (``packages/engine/layer1/CGOGL.cpp:696,756,1890``), not while the primitive CGO is built,
    so the rebuilt CGO — pick slots and all — is byte-identical.  A bridge that
    mirrored the C switch would order a full re-pull of the whole scene here for
    nothing.

    PARITY NOTE, not this row's to fix: because the ``(index, bond)`` pairs are
    shipped regardless, a client that resolves picks itself
    (``_cmd.web_resolve_pick``) will still hit an atom the user set
    ``pickable=0`` on.  That belongs to the picking area, and is recorded here
    because this is where it is visible.
    """
    before = rep_hashes(ws, scene)
    ws.call("cmd.set", "pickable", 0)
    assert rep_hashes(ws, scene) == before
    ws.call("cmd.set", "pickable", 1)
    assert rep_hashes(ws, scene) == before


# ---------------------------------------------------------------------------
# 2. the two printed side effects
# ---------------------------------------------------------------------------


def test_an_unused_level_setting_warns_and_the_warning_obeys_quiet(
    ws: Any, bridge: Any, settings_guard: Any
) -> None:
    """``Setting.cpp:1876-1887``: warn, then RETURN before the whole switch."""
    index = IDX["unused_boolean_def_true"]
    needle = "'unused_boolean_def_true' is no longer used"

    quiet_before = feedback_count(bridge, needle)
    ws.call("cmd.set", index, 0, quiet=1)
    time.sleep(0.5)
    assert feedback_count(bridge, needle) == quiet_before, "quiet=1 still warned"

    ws.call("cmd.set", index, 1, quiet=0)
    bridge.wait_for_feedback(needle, timeout=5.0)
    assert feedback_count(bridge, needle) == quiet_before + 1

    # The value is still WRITTEN — the early return skips the side effects, not
    # the store (`ExecutiveSetSetting` has already committed by then).
    assert setting_value(ws, index) == 1


def test_int_settings_clamp_on_a_global_write_and_not_on_a_per_object_one(
    ws: Any, bridge: Any, settings_guard: Any, scene: str
) -> None:
    """``rec.hasMinMax() && !(sele && sele[0])`` (``Setting.cpp:1891``).

    ``sphere_quality`` declares 0..4.  A UI must NOT clamp its own input: the
    per-object channel really does store 99, and reads it back.
    """
    ws.call("cmd.set", "sphere_quality", 99, quiet=0)
    bridge.wait_for_feedback("sphere_quality range = [0,4]", timeout=5.0)
    assert any(
        "Setting-Warning: sphere_quality range = [0,4]; setting to 4." in line
        for line in bridge.feedback_lines()
    ), "the clamp warning never reached the feedback stream"
    assert setting_value(ws, IDX["sphere_quality"]) == 4

    ws.call("cmd.set", "sphere_quality", 99, scene, quiet=0)
    scope = ws.call("setting.tenmol_settings_scope", scene)
    assert [IDX["sphere_quality"], "int", 99] in [
        [row[0], row[1], row[2]] for row in scope["objectSettings"]
    ], "the per-object write was clamped, or never landed: %r" % (
        scope["objectSettings"],
    )
    # `cmd.get` renders through `SettingGetTextPtr` — `%d` as TEXT, not an int.
    assert ws.call("cmd.get", "sphere_quality", scene) == "99"
    ws.call("cmd.unset", "sphere_quality", scene)
