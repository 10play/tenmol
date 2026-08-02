"""An ``isomesh`` OBJECT reaches Mode G (parity row 372, the density wizard).

THE DEFECT, as wave 10 left it: ``_cmd.web_get_rep_geometry`` dispatched on
object type and, after its ObjectDist and ObjectCGO branches, did a
``dynamic_cast<ObjectMolecule*>`` and answered ``status: 'unsupported'``,
``"no CPU-side geometry accessor for this object type"`` for everything else.
``isomesh`` creates an object of type ``object:mesh`` -- no CoordSet, no Rep --
so the density wizard's whole reason to exist could not be drawn by the client,
and there was no Python route either: ``ObjectMeshStateAsPyList``
(``layer2/ObjectMesh.cpp:45-75``) serialises MapName / Level / Range / Crystal /
Extent / Field and NEVER ``V`` or ``N``, so not even a session pickle carries
the vertices.

THE FIX is an ObjectMesh branch in that same switch (``layer4/
CmdWebGeometry.cpp``) that emits ``ObjectMeshState::N`` / ``::V`` through the
*existing* ``kind: 'mesh'`` envelope -- the one ``RepMesh`` already uses -- plus
an ObjectMesh arm in ``walkObject`` so ``_cmd.web_get_versions`` lists a
``mesh|<state>`` row for the object (without it, client-side discovery has no
reason to pull, and a re-levelled isomesh would never be refetched).

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_p11_geom.py -q
"""

from __future__ import annotations

import os
import struct
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.session import decode_binary_frame  # noqa: E402
from tenmol_bridge.render.modeg import GeometryService, rep_id  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
PDB = REPO / "test" / "dat" / "pept.pdb"

MESH = rep_id("mesh")
EXTENT = rep_id("extent")

#: Unique to this file so nothing else in the shared process can collide.
MOL = "p11geom_mol"
MAP = "p11geom_map"
WIRE = "p11geom_w1"
DOTS = "p11geom_d1"


@pytest.fixture
def service(bridge):
    """A private service: the product one is polled by ``_on_tick`` at 4 Hz."""
    return GeometryService(bridge.pump)


@pytest.fixture
def density(bridge):
    """What ``wizard density`` builds: a map, and an isomesh cut around it.

    Deletes ONLY its own objects afterwards -- the bridge suite shares one
    PyMOL process.
    """

    def setup(engine):
        cmd = engine.cmd
        for name in (WIRE, DOTS, MAP, MOL):
            cmd.delete(name)
        cmd.load(str(PDB), MOL)
        cmd.map_new(MAP, "gaussian", 0.5, MOL, 3.0)
        cmd.isomesh(WIRE, MAP, 1.0, MOL, 4.0)
        cmd.refresh()
        return {
            "type": cmd.get_type(WIRE),
            "extent": cmd.get_extent(WIRE),
            "names": sorted(cmd.get_names("public")),
        }

    info = bridge.pump.call(setup, timeout=300)
    yield info

    def teardown(engine):
        for name in (WIRE, DOTS, MAP, MOL):
            engine.cmd.delete(name)

    bridge.pump.call(teardown, timeout=120)


def fetch(bridge, service: GeometryService, obj: str, rep: Any, state: int = -1):
    return bridge.pump.call(
        lambda engine: service.fetch(engine, obj, rep, state=state), timeout=300
    )


def payload_of(result) -> bytes:
    assert result.frame is not None
    _meta, body = decode_binary_frame(result.frame)
    return bytes(body)


def buffer_of(result, name: str, code: str):
    """One named buffer of an indexed-mesh frame, unpacked."""
    body = payload_of(result)
    spec = result.header["buffers"][name]
    off = spec["byteOffset"]
    n = spec["byteLength"] // 4
    return struct.unpack("<%d%s" % (n, code), body[off : off + spec["byteLength"]])


def skip_without_accessor(bridge, service: GeometryService) -> None:
    if not service.capabilities(bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")


# --------------------------------------------------------------------------- #
# 1. the object really is the thing wave 10 could not serve
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_the_fixture_really_builds_an_object_of_type_mesh(density):
    assert density["type"] == "object:mesh"
    assert WIRE in density["names"] and MAP in density["names"]
    lo, hi = density["extent"]
    assert hi[0] > lo[0] and hi[1] > lo[1] and hi[2] > lo[2]


# --------------------------------------------------------------------------- #
# 2. the C++ branch: status ok, and the numbers are self-consistent
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_an_isomesh_object_now_serves_its_line_strips(bridge, service, density):
    skip_without_accessor(bridge, service)
    result = fetch(bridge, service, WIRE, MESH)

    # This is the exact assertion wave 10 could not make.
    assert result.status == "ok", (result.status, result.message)
    assert result.fallback is None
    assert result.diagnostics["source"] == "ObjectMeshState::V"
    assert result.diagnostics["mapName"] == MAP
    assert result.diagnostics["level"] == 1.0

    header = result.header
    assert header["kind"] == "indexed-mesh"
    assert header["meshType"] == 0  # cIsomeshMode::isomesh
    assert set(header["buffers"]) == {"position", "strip"}

    verts = header["counts"]["verts"]
    strips = header["nStrip"]
    assert verts > 1000 and strips > 1
    assert header["buffers"]["position"]["byteLength"] == verts * 12
    assert header["buffers"]["position"]["itemSize"] == 3
    assert header["buffers"]["position"]["dtype"] == "f32"
    assert header["buffers"]["strip"]["byteLength"] == strips * 4
    assert header["buffers"]["strip"]["dtype"] == "i32"

    # N is a run-length list over V: it must partition the vertices EXACTLY.
    runs = buffer_of(result, "strip", "i")
    assert sum(runs) == verts
    assert min(runs) >= 1

    # The payload is the whole thing and nothing but: 12 bytes/vertex + 4/run,
    # rounded up to the packer's 4-byte alignment (which 12 and 4 already are).
    assert len(payload_of(result)) == verts * 12 + strips * 4


@pytest.mark.engine
def test_the_vertices_are_the_isosurface_and_not_junk(bridge, service, density):
    skip_without_accessor(bridge, service)
    result = fetch(bridge, service, WIRE, MESH)
    assert result.status == "ok"

    xyz = buffer_of(result, "position", "f")
    lo, hi = density["extent"]
    for axis in range(3):
        column = xyz[axis::3]
        assert min(column) >= lo[axis] - 1e-3, axis
        assert max(column) <= hi[axis] + 1e-3, axis
        # a real isosurface spans a good part of the box it was cut from
        assert max(column) - min(column) > 0.5 * (hi[axis] - lo[axis]), axis


@pytest.mark.engine
def test_it_is_one_uniform_colour_because_nothing_ramps_it(bridge, service, density):
    skip_without_accessor(bridge, service)
    result = fetch(bridge, service, WIRE, MESH)
    # `ObjectMeshStateUpdateColors` CLEARS VC when the colour is uniform
    # (layer2/ObjectMesh.cpp:470-476), so an unramped isomesh must arrive with
    # a constant `oneColor` and no per-vertex colour buffer at all.
    assert "color" not in result.header["buffers"]
    assert result.header["oneColor"] == [1.0, 1.0, 1.0]


# --------------------------------------------------------------------------- #
# 3. the same route the client actually uses
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_pull_geometry_over_the_socket_answers_ok_not_unsupported(ws, density):
    """Wave 10 measured this exact call answering 'unsupported'."""
    reply = ws.call("_bridge.pull_geometry", WIRE, "mesh", -1)
    assert reply["status"] == "ok", reply
    assert reply["fallbackReason"] is None
    assert reply["diagnostics"]["source"] == "ObjectMeshState::V"
    assert reply["bytes"] > 10000
    # `GeometryService.key`: NUL-separated object / state / rep index.
    assert reply["key"] == "\x00".join((WIRE, "0", str(MESH)))


@pytest.mark.engine
def test_every_other_rep_is_refused_with_a_reason_that_names_the_type(
    bridge, service, density
):
    skip_without_accessor(bridge, service)
    for rep in ("surface", "lines", "cartoon", "dots"):
        result = fetch(bridge, service, WIRE, rep)
        assert result.status == "unsupported", (rep, result.status)
        assert "mesh objects only carry the mesh and extent reps" in result.message

    # extent needs no Rep at all and is now served for a mesh object too.
    extent = fetch(bridge, service, WIRE, EXTENT)
    assert extent.status == "ok", extent.message
    assert extent.header["kind"] == "cgo-draw-arrays"


# --------------------------------------------------------------------------- #
# 4. lifecycle: hidden, shown, re-levelled
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_a_hidden_isomesh_is_not_built_rather_than_ok(bridge, service, density):
    skip_without_accessor(bridge, service)
    try:
        bridge.pump.call(lambda e: (e.cmd.hide("mesh", WIRE), e.cmd.refresh()), timeout=120)
        hidden = fetch(bridge, service, WIRE, MESH)
        assert hidden.status == "not-built", hidden.status
        assert "hidden" in hidden.message
        assert hidden.frame is None
    finally:
        bridge.pump.call(lambda e: (e.cmd.show("mesh", WIRE), e.cmd.refresh()), timeout=120)
    back = fetch(bridge, service, WIRE, MESH)
    assert back.status == "ok"
    assert back.header["counts"]["verts"] > 1000


@pytest.mark.engine
def test_the_version_table_lists_the_mesh_and_a_new_level_bumps_it(
    bridge, service, density
):
    """Without this row, client-side discovery never pulls the mesh."""
    skip_without_accessor(bridge, service)
    versions = service.versions_fn()
    if versions is None:
        pytest.skip("this PyMOL build has no _cmd.web_get_versions")

    def read(engine):
        cmd = engine.cmd
        cmd.lock(_self=cmd)
        try:
            return versions(cmd._COb, 1, 1)
        finally:
            cmd.unlock(-1, _self=cmd)

    before = bridge.pump.call(read, timeout=300)["objects"][WIRE]
    assert before["reps"]["mesh|0"]["active"] is True
    assert before["n_state"] == 1

    first = fetch(bridge, service, WIRE, MESH)

    bridge.pump.call(
        lambda e: (e.cmd.isomesh(WIRE, MAP, 2.5, MOL, 4.0), e.cmd.refresh()),
        timeout=300,
    )
    after = bridge.pump.call(read, timeout=300)["objects"][WIRE]
    assert after["reps"]["mesh|0"]["version"] > before["reps"]["mesh|0"]["version"]

    # ... and the payload really did change: a higher sigma cuts a smaller mesh.
    second = fetch(bridge, service, WIRE, MESH)
    assert second.status == "ok"
    assert second.header["counts"]["verts"] < first.header["counts"]["verts"]
    assert second.content_hash != first.content_hash
    assert second.diagnostics["level"] == 2.5


# --------------------------------------------------------------------------- #
# 5. isodot: the same object type, the WRONG primitive if the client guesses
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_isodot_says_so_in_mesh_type_because_lines_would_be_wrong(
    bridge, service, density
):
    skip_without_accessor(bridge, service)
    bridge.pump.call(
        lambda e: (e.cmd.isodot(DOTS, MAP, 1.0, MOL, 4.0), e.cmd.refresh()), timeout=300
    )
    result = fetch(bridge, service, DOTS, MESH)
    assert result.status == "ok", result.message
    # cIsomeshMode::isodot == 1 (layer0/PyMOLEnums.h:9-13).  ObjectMesh::render
    # opens GL_POINTS, not GL_LINE_STRIP, for this mode (ObjectMesh.cpp:768,803)
    # -- and the run list is ONE run over every dot, so a client that expanded
    # it as a line strip would draw one polyline through the whole cloud.
    assert result.header["meshType"] == 1
    runs = buffer_of(result, "strip", "i")
    assert len(runs) == 1
    assert runs[0] == result.header["counts"]["verts"]


# --------------------------------------------------------------------------- #
# 6. the GATE, not the payload — the wave-11 audit's downgrade of row 131
# --------------------------------------------------------------------------- #


@pytest.mark.engine
def test_a_width_only_change_bumps_the_version_so_the_client_refetches(
    bridge, service, density
):
    """`set mesh_width, 3` must move the version, and it did not.

    HOW THIS WAS MISSED, because it is the interesting part. Three tests already
    asserted that `mesh_width` reaches the client: they call `service.fetch(...)`
    DIRECTLY, and `_set_width` calls `cmd.rebuild` itself, so they proved the
    header and the content hash — both of which were right — and never the thing
    in front of them. The client does not call `fetch`; it polls
    `web_get_versions` and only pulls when a version moves. Neither
    `repSignature`'s `cRepMesh` arm nor `walkObject`'s `ObjectMesh` arm hashed
    the width, and a width change alters not one vertex, so the poll saw an
    identical signature and never refetched.

    MEASURED before the fix (`layer4/CmdWebGeometry.cpp`): mesh_width 1 -> 3 left
    the version at 1 while `color red` bumped 1 -> 2 and `mesh_quality` 1 -> 3
    bumped 2 -> 3; in Chromium, Mode G ink stayed at 22,771 px over an 8 s wait
    with `geometryFrames` stuck at 1 while Mode P went 22,780 -> 36,444.

    The controls are here on purpose: a test that only asserts "the version
    moved" passes just as well against a signature that changes on every poll.
    """
    skip_without_accessor(bridge, service)
    versions = service.versions_fn()
    if versions is None:
        pytest.skip("this PyMOL build has no _cmd.web_get_versions")

    def read(engine):
        cmd = engine.cmd
        cmd.lock(_self=cmd)
        try:
            return versions(cmd._COb, 1, 1)
        finally:
            cmd.unlock(-1, _self=cmd)

    def version() -> int:
        return bridge.pump.call(read, timeout=300)["objects"][WIRE]["reps"]["mesh|0"][
            "version"
        ]

    def apply(line: str) -> None:
        bridge.pump.call(
            lambda e: (e.cmd.do(line, 0), e.cmd.rebuild(), e.cmd.refresh()), timeout=300
        )

    apply("set mesh_width, 1, %s" % WIRE)
    base = version()

    # CONTROL 1: polling twice with nothing changed must NOT move it, or the
    # assertion below would be satisfied by noise.
    assert version() == base, "the signature is unstable across identical polls"

    apply("set mesh_width, 3, %s" % WIRE)
    widened = version()
    assert widened > base, (
        "mesh_width 1 -> 3 did not bump mesh|0 (%d -> %d): the client's version "
        "poll gates every pull, so the wider mesh never reaches it" % (base, widened)
    )

    # CONTROL 2: and it is the WIDTH that did it — going back moves it again.
    apply("set mesh_width, 1, %s" % WIRE)
    assert version() > widened

    # CONTROL 3: the geometry really is untouched by a width change, which is
    # exactly why the signature had to carry the width explicitly.
    apply("set mesh_width, 3, %s" % WIRE)
    wide = fetch(bridge, service, WIRE, MESH)
    apply("set mesh_width, 1, %s" % WIRE)
    thin = fetch(bridge, service, WIRE, MESH)
    assert wide.header["counts"]["verts"] == thin.header["counts"]["verts"]
    assert payload_of(wide) == payload_of(thin), (
        "if a width change moved a vertex, the old signature would have caught "
        "it and this row would never have been downgraded"
    )
