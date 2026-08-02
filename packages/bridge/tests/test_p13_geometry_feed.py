"""Parity area 3 — four rows whose only citation was a symbol match.

Every test here was written after MEASURING that the previously cited test
stayed GREEN when the behaviour the row describes was broken.  What was
measured, and against which mutation:

* **RepSphere primitiveCGO** (`packages/engine/layer2/RepSphere.cpp:523`).  The cited files
  notice a spheres frame that is EMPTY — delete the whole ``CGO_SPHERE`` branch
  out of ``harvestCGO`` and ``test_cgo_simplify.py``'s
  ``test_spheres_arrive_as_PRIMITIVES_not_triangles`` goes red on ``status ==
  'ok'``.  They do not notice a frame that is WRONG.  Measured, twice, against
  ``test_render.py`` + ``test_cgo_simplify.py``: replacing every sphere radius
  with a constant ``1.0f`` = 56 passed; replacing every sphere colour with
  white = 56 passed.  Nothing read the eight floats.

* **``cmd.get_vrml`` / ``cmd.get_collada``**.  Making either return ``''``
  left ``test_geometry_exports.py`` green, because those two assertions are
  ``is_blob(...)`` and the encoder blobs the return of these symbols
  unconditionally — an empty string is still a blob handle.

* **``CoordSetAsPyList``**.  The 13-slot list is the whole of row "get_session
  contains NO rep geometry", and nothing asserted its shape;
  ``test_session_geometry.py`` infers it from PSE file SIZE, which a
  rep-dependent payload only moves if the rep happens to be BUILT at save time
  (``cmd.rebuild()`` alone does not build it).

* **``CGOAsPyList`` / ``CGONewFromPyList``**.  Emptying ``CGOArrayAsPyList``'s
  float list left ``test_session_geometry.py`` green: it asserts the object
  comes back with type ``object:cgo``, which an EMPTY CGO also satisfies.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p13_geometry_feed.py -q
"""

from __future__ import annotations

import array
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.render.modeg import (  # noqa: E402
    INSTANCE_ITEM_SIZE,
    GeometryService,
    rep_id,
)
from tenmol_bridge.session import decode_binary_frame  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
IL2 = REPO / "packages" / "engine" / "test" / "dat" / "il2.pdb"

SPHERES = rep_id("spheres")
CGO = rep_id("cgo")


@pytest.fixture
def service(bridge):
    """A private service, for the reason ``test_modeg.py`` records: the product
    one is polled by ``RenderService._on_tick`` at 4 Hz and sharing it races."""
    return GeometryService(bridge.pump)


def fetch(bridge, service: GeometryService, obj: str, rep: Any):
    return bridge.pump.call(
        lambda engine: service.fetch(engine, obj, rep, state=-1), timeout=300
    )


def floats(payload: bytes, ref: Dict[str, Any]) -> List[float]:
    out = array.array("f")
    out.frombytes(
        bytes(payload[ref["byteOffset"] : ref["byteOffset"] + ref["byteLength"]])
    )
    return list(out)


# =========================================================================== #
# row: RepSphere primitiveCGO (sphere impostor instance data)
# =========================================================================== #


@pytest.fixture
def sphere_scene(bridge):
    """One residue's worth of spheres, at a KNOWN ``sphere_scale``.

    ``resi 4-5`` because a small buffer makes a wrong stride obvious instead of
    merely improbable -- and because il2.pdb's first residue is 4, not 1
    (measured: ``resi 1`` selects nothing and the rep is never built).
    """

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(IL2), "zp13s")
        cmd.hide("everything")
        # OBJECT-level, and every setting the assertions read: this runs in a
        # session shared with ~1900 other tests and a leftover global
        # `transparency` / `sphere_transparency` / `sphere_scale` would
        # otherwise decide the numbers.  Measured: the alpha assertion failed
        # in a full-suite run and passed in isolation before these were pinned.
        cmd.set("sphere_scale", 1.0, "zp13s")
        cmd.set("sphere_transparency", 0.0, "zp13s")
        cmd.set("transparency", 0.0, "zp13s")
        cmd.show("spheres", "zp13s and resi 4-5")
        # Two named colours rather than the element defaults, so "the CGO_COLOR
        # state is tracked" is an equality and not a "more than one".
        cmd.color("red", "zp13s and resi 4")
        cmd.color("blue", "zp13s and resi 5")
        cmd.refresh()
        model = cmd.get_model("zp13s and resi 4-5")
        return {
            "n": cmd.count_atoms("zp13s and resi 4-5"),
            "coords": [tuple(round(c, 3) for c in a.coord) for a in model.atom],
            "vdw": sorted({round(a.vdw, 3) for a in model.atom}),
            "rgba": {
                tuple(round(c, 3) for c in cmd.get_color_tuple(name)) + (1.0,)
                for name in ("red", "blue")
            },
        }

    info = bridge.pump.call(setup, timeout=300)
    yield info
    bridge.pump.call(lambda e: e.cmd.delete("zp13s"), timeout=60)


def sphere_instances(result) -> Dict[str, Any]:
    assert result.ok, "%s: %s" % (result.status, result.message)
    header, payload = decode_binary_frame(result.frame)
    assert header["kind"] == "cgo-draw-arrays", header["kind"]
    assert not header["blocks"], (
        "spheres came back as %d triangle block(s): the accessor took the "
        "SIMPLIFIED CGO, and geometry.ts' INSTANCED_ONLY_REPS rejects that"
        % len(header["blocks"])
    )
    found = [i for i in header["instances"] if i["kind"] == "sphere"]
    assert len(found) == 1, [i["kind"] for i in header["instances"]]
    return {"inst": found[0], "payload": bytes(payload)}


@pytest.mark.engine
def test_spheres_are_one_instance_per_atom_of_centre_radius_and_rgba(
    bridge, service, sphere_scene
) -> None:
    """``[cx,cy,cz,r, r,g,b,a]`` — 8 floats, and every one of them checked.

    This is the row's backend contract stated as an assertion: the accessor
    reads ``cgo::draw::sphere``'s ``center`` and ``diamter`` (upstream's typo;
    it holds the RADIUS) and pairs them with the CGO's colour/alpha state.
    Nothing else in the corpus reads those numbers, so a stride error or a
    dropped colour would have been invisible.
    """
    got = sphere_instances(fetch(bridge, service, "zp13s", SPHERES))
    inst = got["inst"]

    assert inst["count"] == sphere_scene["n"], (inst["count"], sphere_scene["n"])
    assert inst["itemSize"] == INSTANCE_ITEM_SIZE["sphere"] == 8
    assert inst["data"]["byteLength"] == inst["count"] * 8 * 4
    assert inst.get("atom"), "no per-instance atom index: client picking is dead"
    assert inst["atom"]["byteLength"] == inst["count"] * 4

    values = floats(got["payload"], inst["data"])
    centres = {
        tuple(round(x, 3) for x in values[i * 8 : i * 8 + 3])
        for i in range(inst["count"])
    }
    assert centres == set(sphere_scene["coords"]), (
        "sphere centres are not the atom coordinates -- sorted(theirs)[:3]=%r"
        % sorted(centres)[:3]
    )

    radii = sorted({round(values[i * 8 + 3], 3) for i in range(inst["count"])})
    assert radii == sphere_scene["vdw"], (radii, sphere_scene["vdw"])

    rgba = {
        tuple(round(x, 3) for x in values[i * 8 + 4 : i * 8 + 8])
        for i in range(inst["count"])
    }
    assert rgba == sphere_scene["rgba"], (
        "the CGO_COLOR/CGO_ALPHA state was not tracked per sphere: got %r, "
        "expected the two colours the scene was painted with %r"
        % (sorted(rgba), sorted(sphere_scene["rgba"]))
    )


@pytest.mark.engine
def test_the_sphere_radius_is_the_live_setting_not_a_baked_constant(
    bridge, service, sphere_scene
) -> None:
    """Halve ``sphere_scale``, and every radius halves.

    The cheap version of this row's test would assert "radius > 0", which a
    hard-coded 1.0 would pass.  Two fetches at two scales cannot be satisfied
    by a constant, and they prove the extractor is reading the rebuilt
    ``RepSphere::primitiveCGO`` rather than a cached buffer.
    """
    before = sphere_instances(fetch(bridge, service, "zp13s", SPHERES))
    full = [
        round(floats(before["payload"], before["inst"]["data"])[i * 8 + 3], 4)
        for i in range(before["inst"]["count"])
    ]

    def rescale(engine):
        engine.cmd.set("sphere_scale", 0.5, "zp13s")
        engine.cmd.refresh()

    bridge.pump.call(rescale, timeout=120)
    after = sphere_instances(fetch(bridge, service, "zp13s", SPHERES))
    half = [
        round(floats(after["payload"], after["inst"]["data"])[i * 8 + 3], 4)
        for i in range(after["inst"]["count"])
    ]

    assert len(half) == len(full)
    assert sorted(half) == pytest.approx([x / 2.0 for x in sorted(full)], abs=1e-3)


# =========================================================================== #
# row: cmd.get_vrml(version) — highest-fidelity existing text export
# =========================================================================== #


def scene(bridge, rep: str, name: str = "zp13x") -> None:
    """A FRESH scene showing exactly one rep.  ``test_geometry_exports.py``'s
    module docstring records why anything measured on a shared scene is not
    evidence."""

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(IL2), name)
        cmd.hide("everything")
        cmd.show(rep, "%s and resi 4-8" % name)
        cmd.rebuild()
        cmd.refresh()

    bridge.pump.call(setup, timeout=300)


def engine_call(bridge, fn, *args):
    return bridge.pump.call(lambda e: getattr(e.cmd, fn)(*args), timeout=300)


@pytest.mark.engine
def test_get_vrml_v2_carries_real_geometry_with_per_vertex_colour_and_normals(
    bridge,
) -> None:
    """``RayRenderVRML2`` on a surface: ``IndexedFaceSet`` + ``color`` +
    ``normal``, which is what makes this the highest-fidelity text export.

    The previously cited assertion was ``is_blob(...)``, and ``get_vrml`` is in
    ``codec.BLOB_RETURNS`` — so it answers a blob handle even for the 235-byte
    viewpoint-only preamble PyMOL emits when the scene has no primitives at
    all.  Measured: with the export gutted to ``return ''`` that assertion
    still passed.  These do not.
    """
    scene(bridge, "surface")
    text = engine_call(bridge, "get_vrml", 2)
    assert text.startswith("#VRML V2.0 utf8"), text[:40]
    assert len(text) > 10_000, "only %d bytes: no primitives reached the ray" % len(text)
    assert "IndexedFaceSet" in text, "triangles are not an IndexedFaceSet"
    assert "color Color" in text and "normal Normal" in text, (
        "per-vertex colour AND normal is the whole reason this row exists"
    )


@pytest.mark.engine
def test_get_vrml_v1_carries_ONLY_spheres_and_v2_carries_everything(bridge) -> None:
    """The ``version`` argument is not decoration: 1 and 2 are two writers, and
    only one of them is usable.

    MEASURED on il2.pdb resi 4-8, ``len(get_vrml(1))`` / ``len(get_vrml(2))``::

        sticks     278 / 50,264        lines     278 /  55,568
        spheres  11,808 / 20,390       surface   278 / 309,764
        cartoon    278 / 140,070

    278 bytes is the header plus the ``Viewpoint``/``Material`` preamble and no
    geometry at all -- so ``RayRenderVRML1`` emits spheres and nothing else, and
    a client that asked for version 1 would silently lose every other rep.
    That is the finding the row's "VRML1/VRML2" needs attached to it, and it is
    invisible to an assertion that only checks a string came back.
    """
    scene(bridge, "spheres")
    assert "Sphere {" in engine_call(bridge, "get_vrml", 1)

    scene(bridge, "surface")
    v1 = engine_call(bridge, "get_vrml", 1)
    v2 = engine_call(bridge, "get_vrml", 2)
    assert v1.startswith("#VRML V1.0 ascii"), v1[:40]
    assert v2.startswith("#VRML V2.0 utf8"), v2[:40]
    assert len(v1) < 1000, "VRML1 grew a surface writer: %d bytes" % len(v1)
    assert "IndexedFaceSet" not in v1
    assert len(v2) > 100_000 and "IndexedFaceSet" in v2


@pytest.mark.engine
def test_get_vrml_writes_spheres_as_vrml_sphere_nodes(bridge) -> None:
    """Analytic, not tessellated — the one thing VRML does better than OBJ."""
    scene(bridge, "spheres")
    text = engine_call(bridge, "get_vrml", 2)
    assert "Sphere {" in text, "spheres were not emitted as VRML Sphere nodes"
    assert "IndexedFaceSet" not in text, "spheres arrived tessellated"


# =========================================================================== #
# row: cmd.get_collada(version) — COLLADA .dae export
# =========================================================================== #


@pytest.mark.engine
def test_get_collada_is_a_1_4_1_document_with_a_geometry_library(bridge) -> None:
    """Same measurement as VRML: ``is_blob`` passed with the writer returning
    ``''``.  A COLLADA consumer needs the root version and the geometry
    library, so those are what this asserts."""
    scene(bridge, "surface")
    text = engine_call(bridge, "get_collada", 2)
    assert text.startswith('<?xml version="1.0" encoding="UTF-8"?>'), text[:40]
    assert 'version="1.4.1"' in text, "not COLLADA 1.4.1"
    assert "<library_geometries>" in text
    assert "<mesh>" in text
    assert len(text) > 50_000, "only %d bytes: no primitives were tessellated" % len(text)


@pytest.mark.engine
def test_collada_geometry_mode_switches_triangles_for_polylist(bridge) -> None:
    """``collada_geometry_mode`` 0 = valid COLLADA, 1 = Blender polylist.

    The setting is in the row and is what ``cmd.get_gltf`` forces on before
    calling here, so a port that ignored it would silently emit the wrong
    dialect into the glTF path.
    """
    scene(bridge, "surface")
    original = engine_call(bridge, "get", "collada_geometry_mode")
    try:
        bridge.pump.call(
            lambda e: e.cmd.set("collada_geometry_mode", 0), timeout=120
        )
        valid = engine_call(bridge, "get_collada", 2)
        bridge.pump.call(
            lambda e: e.cmd.set("collada_geometry_mode", 1), timeout=120
        )
        blender = engine_call(bridge, "get_collada", 2)
    finally:
        bridge.pump.call(
            lambda e: e.cmd.set("collada_geometry_mode", original), timeout=120
        )

    assert "<triangles" in valid, "mode 0 must emit <triangles>"
    assert "<polylist" in blender, "mode 1 must emit <polylist>"
    assert "<polylist" not in valid and "<triangles" not in blender


# =========================================================================== #
# row: cmd.get_session() — contains NO rep geometry
# =========================================================================== #


def coordset_of(bridge, rep: str) -> List[Any]:
    """The first CoordSet list out of a live session, for a scene showing
    exactly ``rep``.

    Route: ``session['names'][i]`` = SpecRec (7 items, ``[5]`` is the object),
    object ``[4]`` is the CSet list (``ObjectMoleculeAsPyList``), and each entry
    is the ``CoordSetAsPyList`` list this row is about.
    """

    def setup(engine):
        cmd = engine.cmd
        cmd.delete("all")
        cmd.load(str(IL2), "zp13c")
        cmd.hide("everything")
        cmd.show(rep, "zp13c and resi 4-8")
        cmd.rebuild()
        cmd.refresh()
        session = cmd.get_session()
        rec = [r for r in session["names"] if r and r[0] == "zp13c"][0]
        return rec[5][4][0]

    return bridge.pump.call(setup, timeout=300)


@pytest.mark.engine
def test_a_coordset_in_a_session_is_exactly_the_documented_13_slots(bridge) -> None:
    """``CoordSetAsPyList`` writes 13 entries and NO ``Rep[]``.

    Asserted structurally rather than by file size, because the size assertion
    in ``test_session_geometry.py`` is blind to a rep-dependent payload unless
    that rep is BUILT at save time -- measured: a mutation appending a
    200,000-float block whenever ``CoordSet::Rep[cRepSurface]`` is non-null did
    not move any size, because ``cmd.rebuild()`` invalidates without building.

    Slots, ``packages/engine/layer2/CoordSet.cpp:364-416``: 0 NIndex, 1 NAtIndex, 2 Coord,
    3 IdxToAtm, 4 AtmToIdx, 5 name, 6 object state, 7 settings, 8 LabPos,
    9 properties, 10 SculptCGO, 11 per-atom-state settings, 12 symmetry.
    """
    cset = coordset_of(bridge, "surface")
    assert isinstance(cset, list)
    assert len(cset) == 13, (
        "CoordSetAsPyList grew to %d slots -- if that is deliberate the row "
        "and its 'nothing else' claim need re-reading" % len(cset)
    )

    n_index = cset[0]
    assert isinstance(n_index, int) and n_index > 1000, n_index
    assert len(cset[2]) == n_index * 3, ("Coord is not 3*NIndex", len(cset[2]))
    assert len(cset[3]) == n_index, ("IdxToAtm is not NIndex", len(cset[3]))
    assert cset[5] == ""  # CoordSet::Name, empty for a single-state molecule
    assert isinstance(cset[6], list)  # ObjectStateAsPyList
    assert cset[10] is None, "slot 10 is SculptCGO and there is no sculpting here"


@pytest.mark.engine
def test_the_coordset_is_byte_for_byte_the_same_whatever_rep_is_shown(bridge) -> None:
    """The load-bearing claim, stated where it can actually be violated.

    A surface is ~9,900 vertices of mesh and lines are none, so if ANY rep
    geometry rode along in the coordset the two lists could not be equal.
    """
    surface = coordset_of(bridge, "surface")
    lines = coordset_of(bridge, "lines")
    assert len(surface) == len(lines) == 13
    assert surface == lines, "the session's coordset depends on which rep is shown"


# =========================================================================== #
# row: CGOAsPyList / CGONewFromPyList — the CGO <-> Python round trip
# =========================================================================== #


#: A CGO with values chosen so a truncation, a reorder or a float/int confusion
#: all show up: two segments, distinct endpoints, distinct colours.
def cgo_source() -> list:
    from pymol import cgo as _cgo

    return [
        _cgo.BEGIN, _cgo.LINES,
        _cgo.COLOR, 1.0, 0.0, 0.0,
        _cgo.VERTEX, 1.0, 2.0, 3.0,
        _cgo.VERTEX, 4.0, 5.0, 6.0,
        _cgo.COLOR, 0.0, 0.0, 1.0,
        _cgo.VERTEX, -7.0, -8.0, -9.0,
        _cgo.VERTEX, 10.0, 11.0, 12.0,
        _cgo.END,
    ]


#: MEASURED.  ``load_cgo`` of the list above arrives as ONE ``CGO_DRAW_ARRAYS``
#: block -- ``CGOCombineBeginEnd`` folds the BEGIN..END span into interleaved
#: arrays -- with ``mode`` 1 (GL_LINES), ``arraybits`` 15 (vertex|normal|colour|
#: pick) and 4 vertices.  The block layout is ``[vertex 3n][normal 3n]
#: [colour 4n][pick ...]``, so these are the first 24 floats.
EXPECT_VERTEX = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, -7.0, -8.0, -9.0, 10.0, 11.0, 12.0]
EXPECT_COLOR = [
    1.0, 0.0, 0.0, 1.0,
    1.0, 0.0, 0.0, 1.0,
    0.0, 0.0, 1.0, 1.0,
    0.0, 0.0, 1.0, 1.0,
]


def cgo_block(bridge, service: GeometryService):
    result = fetch(bridge, service, "zp13g", CGO)
    assert result.ok, "%s: %s" % (result.status, result.message)
    header, payload = decode_binary_frame(result.frame)
    assert len(header["blocks"]) == 1, header["blocks"]
    block = header["blocks"][0]
    values = floats(bytes(payload), block["data"])
    n = block["nverts"]
    return {
        "mode": block["mode"],
        "arraybits": block["arraybits"],
        "nverts": n,
        "vertex": [round(x, 4) for x in values[0 : 3 * n]],
        "color": [round(x, 4) for x in values[6 * n : 10 * n]],
    }


@pytest.mark.engine
def test_a_cgo_keeps_its_vertices_and_colours_across_a_session(
    bridge, service, tmp_path
) -> None:
    """The round trip, checked on the NUMBERS rather than on the object type.

    ``test_session_geometry.py`` asserts the object comes back as
    ``object:cgo``; measured, that also passes when ``CGOArrayAsPyList`` is
    made to emit an EMPTY float list, because an empty CGO is still an
    ObjectCGO.  What has to survive is the content, and the only way to read it
    back is the Mode-G accessor over ``ObjectCGO::origCGO`` -- there is no
    ``cmd.get_cgo``.
    """

    def build(engine):
        engine.cmd.delete("all")
        engine.cmd.load_cgo(cgo_source(), "zp13g")
        engine.cmd.refresh()
        return engine.cmd.get_type("zp13g")

    assert bridge.pump.call(build, timeout=300) == "object:cgo"
    before = cgo_block(bridge, service)
    assert before["mode"] == 1, "CGO_BEGIN's int operand (GL_LINES) was mangled"
    assert before["nverts"] == 4
    assert before["vertex"] == EXPECT_VERTEX, before["vertex"]
    assert before["color"] == EXPECT_COLOR, before["color"]

    path = str(tmp_path / "zp13g.pse")

    def roundtrip(engine):
        engine.cmd.save(path)
        engine.cmd.delete("all")
        engine.cmd.load(path)
        engine.cmd.refresh()
        return engine.cmd.get_names("all")

    try:
        assert "zp13g" in bridge.pump.call(roundtrip, timeout=300)
        after = cgo_block(bridge, service)
        assert after == before, (
            "the CGO changed across CGOAsPyList -> CGONewFromPyList:\n"
            "  before %r\n  after  %r" % (before, after)
        )
    finally:
        bridge.pump.call(lambda e: e.cmd.delete("zp13g"), timeout=60)
