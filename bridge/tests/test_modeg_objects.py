"""Mode G for objects that are not molecules, and for geometry that is not
coloured by the geometry.

Three defects, all of them "the accessor works and nothing draws it":

1. **Measurement objects never reached Mode G.**  ``distance`` / ``angle`` /
   ``dihedral`` create objects of type ``object:measurement`` whose only rep is
   ``dashes`` (10) / ``angles`` (17) / ``dihedrals`` (18).
   ``_cmd.web_get_rep_geometry`` has served them all along -- ``RepDistDash::V``,
   ``RepAngle::V``, ``RepDihedral::V``, straight into the ``lines`` bucket -- but
   :data:`MODE_G_CAPABLE_REPS` did not list those three reps, so
   ``RenderService._resolve`` answered every ``set_render_mode`` for them with
   ``unsupported-rep`` and ``capabilities()['capableReps']`` told clients not to
   ask.  The server kept rasterising geometry the client could draw.

2. **The unit cell rendered white.**  ``CrystalGetUnitCellCGO`` emits vertices
   and nothing else; PyMOL colours it at render time from ``ResolveCellColor``
   (``layer2/CoordSet.cpp:1281-1291``), i.e. the ``cell_color`` setting or, when
   that is negative -- the default -- the OBJECT's own colour.  The bridge now
   resolves that and ships it as a constant colour array.

3. **Dots are unlit, and this file says exactly why** so the next person does
   not have to re-derive it: the accessor DOES return per-dot normals; the wire
   has nowhere to put them.  See the last test.

Runs against a real PyMOL built from this tree, on the product pump::

    bridge/.venv/bin/python -m pytest bridge/tests/test_modeg_objects.py -q
"""

from __future__ import annotations

import json
import os
import struct
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.session import decode_binary_frame  # noqa: E402
from tenmol_bridge.render.modeg import (  # noqa: E402
    BIT_COLOR,
    BIT_VERTEX,
    INSTANCE_ITEM_SIZE,
    MODE_G_CAPABLE_REPS,
    REP_NAMES,
    GeometryService,
    rep_id,
)

REPO = Path(__file__).resolve().parents[2]
PDB = REPO / "testing" / "data" / "1rx1.pdb"

DASHES = rep_id("dashes")
ANGLES = rep_id("angles")
DIHEDRALS = rep_id("dihedrals")
CELL = rep_id("cell")
EXTENT = rep_id("extent")
CGO = rep_id("cgo")
DOTS = rep_id("dots")

#: Two atoms far enough apart that PyMOL definitely dashes the line, picked by
#: ``first`` so a multi-chain file cannot turn one distance into hundreds.
A = "first (m and resi 10 and name CA)"
B = "first (m and resi 20 and name CA)"
C = "first (m and resi 30 and name CA)"
D = "first (m and resi 40 and name CA)"


@pytest.fixture
def service(bridge):
    """A private :class:`GeometryService` on the product pump.

    Private for the same reason ``test_modeg.py`` gives: the product one is
    polled by ``RenderService._on_tick`` at 4 Hz and a test that shares it races
    the tick.  A second service owns no destructive state.
    """
    return GeometryService(bridge.pump)


@pytest.fixture
def scene(bridge):
    """1RX1 with a distance, an angle, a dihedral, a unit cell and a CGO."""

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(PDB), "m")
        cmd.hide("everything")
        cmd.show("cell", "m")
        cmd.show("dots", "m and resi 10")
        cmd.distance("dd", A, B)
        cmd.angle("aa", A, B, C)
        cmd.dihedral("hh", A, B, C, D)
        from pymol import cgo as _cgo

        cmd.load_cgo(
            [
                _cgo.BEGIN, _cgo.LINES,
                _cgo.COLOR, 1.0, 0.0, 0.0,
                _cgo.VERTEX, 0.0, 0.0, 0.0,
                _cgo.VERTEX, 10.0, 10.0, 10.0,
                _cgo.END,
            ],
            "gg",
        )
        cmd.refresh()
        return sorted(cmd.get_names("public"))

    return bridge.pump.call(setup, timeout=300)


def fetch(bridge, service: GeometryService, obj: str, rep: Any):
    return bridge.pump.call(
        lambda engine: service.fetch(engine, obj, rep, state=-1), timeout=300
    )


def frame_payload(result) -> bytes:
    """The buffer block of an encoded frame; `byteOffset`s index into this."""
    assert result.frame is not None
    _meta, body = decode_binary_frame(result.frame)
    return bytes(body)


def skip_without_accessor(bridge, service: GeometryService) -> None:
    if not service.capabilities(bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")


# --------------------------------------------------------------------------- #
# 1. measurement objects
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_the_scene_really_contains_three_measurement_objects(bridge, scene):
    assert scene == ["aa", "dd", "gg", "hh", "m"]
    types = bridge.pump.call(
        lambda engine: {n: engine.cmd.get_type(n) for n in ("dd", "aa", "hh")},
        timeout=120,
    )
    # `cObjectMeasurement` == 4.  These are NOT molecules, which is the whole
    # reason a client that enumerates molecules never saw them.
    assert set(types.values()) == {"object:measurement"}


@pytest.mark.engine
@pytest.mark.parametrize(
    "obj,rep,source",
    [
        ("dd", DASHES, "RepDistDash::V"),
        ("aa", ANGLES, "RepAngle::V"),
        ("hh", DIHEDRALS, "RepDihedral::V"),
    ],
)
def test_a_measurement_object_serves_line_instances(
    bridge, service, scene, obj, rep, source
):
    skip_without_accessor(bridge, service)
    result = fetch(bridge, service, obj, rep)
    payload = result.to_json()
    print("%s/%s -> %s" % (obj, REP_NAMES[rep], json.dumps(payload)[:400]))

    assert result.status == "ok", payload
    assert result.fallback is None
    assert result.diagnostics["source"] == source
    lines = [i for i in result.diagnostics["instances"] if i["kind"] == "line"]
    assert lines and lines[0]["count"] > 0, "no line segments to draw"
    # Nothing may be left in the "the accessor gave us this and we dropped it"
    # census: a measurement that half-arrives is worse than one that does not.
    assert result.diagnostics["unmapped"] == {}

    # The instance buffer is exactly count * 14 float32 (v1[3] v2[3] rgba1[4]
    # rgba2[4]), and it describes real segments: distinct endpoints, opaque
    # colour.  A buffer of the right SIZE full of zeros would draw nothing and
    # look identical to "it works" from the outside.
    instance = result.header["instances"][0]
    assert instance["itemSize"] == INSTANCE_ITEM_SIZE["line"]
    count = instance["count"]
    ref = instance["data"]
    assert ref["byteLength"] == count * INSTANCE_ITEM_SIZE["line"] * 4

    payload = frame_payload(result)
    first = struct.unpack_from("<14f", payload, ref["byteOffset"])
    assert first[0:3] != first[3:6], "segment 0 is degenerate"
    assert first[9] == pytest.approx(1.0), "segment 0 is fully transparent"
    lengths = []
    for i in range(count):
        v = struct.unpack_from("<14f", payload, ref["byteOffset"] + i * 14 * 4)
        lengths.append(sum((v[j] - v[j + 3]) ** 2 for j in range(3)) ** 0.5)
    assert min(lengths) > 0.0, "at least one segment has zero length"


@pytest.mark.engine
def test_the_capable_list_now_admits_every_rep_the_accessor_serves(
    bridge, service, scene
):
    """The bug: a rep missing here is a rep the bridge refuses for ever.

    ``RenderService._resolve`` returns ``('pixel', 'unsupported-rep')`` for
    anything not in :data:`MODE_G_CAPABLE_REPS`, whatever the accessor says.
    """
    skip_without_accessor(bridge, service)
    checks = [
        ("dd", DASHES),
        ("aa", ANGLES),
        ("hh", DIHEDRALS),
        ("m", CELL),
        ("m", EXTENT),
        ("gg", CGO),
    ]
    served: List[int] = []
    for obj, rep in checks:
        result = fetch(bridge, service, obj, rep)
        print("%s/%s -> %s" % (obj, REP_NAMES[rep], result.status))
        if result.status == "ok":
            served.append(rep)
    assert served, "the accessor served none of them; the premise is gone"
    missing = sorted(set(served) - set(MODE_G_CAPABLE_REPS))
    assert not missing, (
        "the accessor serves %s but MODE_G_CAPABLE_REPS omits them, so "
        "set_render_mode answers unsupported-rep and they stay on Mode P"
        % [REP_NAMES[r] for r in missing]
    )
    caps = service.capabilities(bridge.pump.engine)
    advertised = {entry["rep"] for entry in caps["capableReps"]}
    assert set(served) <= advertised


@pytest.mark.engine
def test_labels_are_still_honestly_unsupported(bridge, service, scene):
    """The list must not become "everything": a rep it cannot serve must say so."""
    skip_without_accessor(bridge, service)
    assert rep_id("labels") not in MODE_G_CAPABLE_REPS
    assert rep_id("callback") not in MODE_G_CAPABLE_REPS
    assert rep_id("volume") not in MODE_G_CAPABLE_REPS


# --------------------------------------------------------------------------- #
# 2. the unit cell colour
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_the_raw_cell_block_carries_no_colour_of_its_own(bridge, service, scene):
    """Why this fix has to exist at all."""
    skip_without_accessor(bridge, service)

    def read(engine):
        from pymol import _cmd

        engine.cmd.lock(_self=engine.cmd)
        try:
            return _cmd.web_get_rep_geometry(engine.cmd._COb, "m", -1, CELL, 1)
        finally:
            engine.cmd.unlock(-1, _self=engine.cmd)

    raw = bridge.pump.call(read, timeout=300)
    assert raw["status"] == "ok", raw
    blocks = raw["draw_arrays"]
    assert len(blocks) == 1
    assert blocks[0]["arraybits"] == BIT_VERTEX, "the accessor grew a colour array"
    assert raw.get("rgb") is None, "the accessor grew an rgb field"
    assert blocks[0]["nverts"] == 24, "a unit cell is 12 GL_LINES"


@pytest.mark.engine
def test_the_cell_is_drawn_in_the_colour_pymol_draws_it(bridge, service, scene):
    skip_without_accessor(bridge, service)
    result = fetch(bridge, service, "m", CELL)
    assert result.status == "ok", result.to_json()
    block = result.header["blocks"][0]
    assert block["arraybits"] & BIT_COLOR, "the cell still has no colour: it draws white"

    expected = bridge.pump.call(
        lambda engine: GeometryService._cell_rgb(engine.cmd, "m"), timeout=120
    )
    # `cell_color` is -1 by default, so this is the OBJECT's colour.
    settings = bridge.pump.call(
        lambda engine: (
            engine.cmd.get_setting_int("cell_color", "m"),
            engine.cmd.get_object_color_index("m"),
        ),
        timeout=120,
    )
    assert settings[0] < 0
    assert expected == bridge.pump.call(
        lambda engine: tuple(engine.cmd.get_color_tuple(settings[1])), timeout=120
    )

    nverts = block["nverts"]
    ref = block["data"]
    assert ref["byteLength"] == nverts * 7 * 4, "[vertex 3N][color 4N]"

    # Read the colours back out of the payload: EVERY vertex must carry the
    # resolved colour, not just the first.
    payload = frame_payload(result)
    base = ref["byteOffset"] + nverts * 3 * 4
    colours = struct.unpack_from("<%df" % (nverts * 4), payload, base)
    print("cell colour %r for %d verts" % (expected, nverts))
    for i in range(nverts):
        assert colours[i * 4 : i * 4 + 3] == pytest.approx(expected)
        assert colours[i * 4 + 3] == pytest.approx(1.0)


@pytest.mark.engine
def test_an_explicit_cell_color_setting_wins(bridge, service, scene):
    skip_without_accessor(bridge, service)

    def paint(engine):
        engine.cmd.set("cell_color", "blue", "m")
        engine.cmd.refresh()
        return GeometryService._cell_rgb(engine.cmd, "m")

    try:
        rgb = bridge.pump.call(paint, timeout=300)
        assert rgb == (0.0, 0.0, 1.0), rgb
    finally:
        bridge.pump.call(
            lambda engine: engine.cmd.unset("cell_color", "m"), timeout=120
        )


def test_a_colourless_block_without_an_rgb_is_left_alone():
    """No `rgb`, no invention: the pure half, no PyMOL needed."""
    svc = GeometryService.__new__(GeometryService)
    raw: Dict[str, Any] = {
        "draw_arrays": [
            {"mode": 1, "arraybits": 1, "nverts": 2, "vertex": struct.pack("<6f", *range(6))}
        ],
        "begin_end": [],
    }
    header, payload, _diag = svc._cgo(raw, "x", CELL, 0)
    assert header["blocks"][0]["arraybits"] == BIT_VERTEX
    assert len(payload) == 2 * 3 * 4

    raw["rgb"] = (0.25, 0.5, 0.75)
    header, payload, _diag = svc._cgo(raw, "x", CELL, 0)
    block = header["blocks"][0]
    assert block["arraybits"] == BIT_VERTEX | BIT_COLOR
    off = block["data"]["byteOffset"]
    colours = struct.unpack_from("<8f", payload, off + 2 * 3 * 4)
    assert colours == (0.25, 0.5, 0.75, 1.0, 0.25, 0.5, 0.75, 1.0)


# --------------------------------------------------------------------------- #
# 3. dots: the gap, written down
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_dots_ship_without_the_normals_the_accessor_already_has(
    bridge, service, scene
):
    """Dots are UNLIT, and this is the whole reason.

    ``RepDot`` keeps ``VN`` and the accessor returns it -- there is a normal per
    dot sitting in the answer.  The v1 wire has one instance kind that fits a
    dot, ``sphere``, and it is 8 floats: ``[cx,cy,cz,r,rr,gg,bb,aa]``.  There is
    no normal slot, and ``INSTANCED_ONLY_REPS`` in
    ``packages/protocol/src/geometry.ts`` FAILS a dots frame that carries
    draw-arrays blocks instead of instances, so the normals cannot ride along as
    a block either.

    Fixing it needs a protocol change (a ``dot`` instance kind, or a normal on
    ``sphere``) plus the point material in
    ``packages/viewport/src/materials/point.ts`` -- neither of which is this
    module's to make.  This test pins the two halves of the fact so the gap
    stays visible and cannot be "fixed" by quietly dropping the normals.
    """
    skip_without_accessor(bridge, service)

    def read(engine):
        from pymol import _cmd

        engine.cmd.lock(_self=engine.cmd)
        try:
            return _cmd.web_get_rep_geometry(engine.cmd._COb, "m", -1, DOTS, 1)
        finally:
            engine.cmd.unlock(-1, _self=engine.cmd)

    raw = bridge.pump.call(read, timeout=300)
    if raw["status"] != "ok":
        pytest.skip("dots not built: %s" % raw.get("message"))
    n = int(raw["n_vert"])
    assert n > 0
    assert raw["normal"] is not None, "the accessor stopped returning dot normals"
    assert len(bytes(memoryview(raw["normal"]).cast("B"))) == n * 3 * 4

    result = fetch(bridge, service, "m", DOTS)
    assert result.status == "ok", result.to_json()
    instance = result.header["instances"][0]
    assert instance["kind"] == "sphere"
    assert instance["itemSize"] == INSTANCE_ITEM_SIZE["sphere"] == 8
    assert instance["data"]["byteLength"] == n * 8 * 4, (
        "the dots buffer changed size: if a normal was added, the protocol and "
        "the point material have to be updated with it"
    )
