"""Wave 11, parity row 131: ``mesh_width`` on the wire.

The row's remaining gap was that ``mesh_width`` has no effect in Mode G at all.
Two things were missing and both are fixed here:

  * ``RepMesh::Width`` was in the accessor's layout mirror but never returned
    (``layer4/CmdWebGeometry.cpp``, ``extractMesh``).  It is now
    ``raw["width"]``, exactly as ``extractDots`` has always returned
    ``RepDot::Width``.
  * ``render/modeg.py``'s ``_strip_mesh`` now carries it as ``meshWidth`` on
    the ``indexed-mesh`` header, additively -- every existing key is untouched.

What is deliberately NOT done here is scaling it.  PyMOL draws a mesh with
``SceneGetDynamicLineWidth(info, I->Width)`` (``layer2/RepMesh.cpp:535``,
``layer1/CGOGL.cpp:1095`` for the shader path), whose factor depends on the
CAMERA; baking that into a cached geometry frame would freeze the width at
whatever the camera was when the rep was packed.  The client applies it per
render -- see ``packages/viewport/src/webgl/quadlines.ts``.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_p11_mesh.py -q
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.render.modeg import GeometryService  # noqa: E402

#: Scratch object.  Named so a leak is obvious in any other test's output.
OBJ = "p11mesh"


@pytest.fixture
def meshed(bridge):
    """A tiny molecule showing ``mesh``, with ``mesh_width`` restored after."""
    before = bridge.pump.call(
        lambda engine: {
            "mesh_width": float(engine.cmd.get_setting_float("mesh_width")),
            "names": list(engine.cmd.get_names("public")),
        },
        timeout=120,
    )

    def setup(engine):
        cmd = engine.cmd
        cmd.delete(OBJ)
        cmd.fragment("ala", OBJ)
        cmd.show("mesh", OBJ)
        cmd.refresh()

    bridge.pump.call(setup, timeout=300)
    yield OBJ

    def teardown(engine):
        cmd = engine.cmd
        cmd.set("mesh_width", before["mesh_width"])
        cmd.delete(OBJ)
        cmd.refresh()
        return list(cmd.get_names("public"))

    after = bridge.pump.call(teardown, timeout=300)
    assert OBJ not in after, "the scratch object leaked into the shared session"
    assert sorted(after) == sorted(before["names"]), "the scene was not restored"


def _mesh(bridge, service: GeometryService, have: str = ""):
    result = bridge.pump.call(
        lambda engine: service.fetch(engine, OBJ, "mesh", state=-1, have=have),
        timeout=300,
    )
    if result.status not in ("ok", "unchanged"):
        pytest.skip("mesh not built: %s" % result.message)
    return result


def _mesh_header(bridge, service: GeometryService) -> Dict[str, Any]:
    return _mesh(bridge, service).header


def _set_width(bridge, value: float) -> None:
    def body(engine):
        engine.cmd.set("mesh_width", value)
        # The width is read in RepMesh's builder (layer2/RepMesh.cpp:612), so
        # the rep has to be rebuilt before the accessor can see the new value.
        engine.cmd.rebuild(OBJ)
        engine.cmd.refresh()

    bridge.pump.call(body, timeout=300)


@pytest.mark.engine
def test_the_mesh_header_carries_mesh_width(bridge, meshed):
    """``RepMesh::Width`` reaches the client, and follows the setting."""
    service = GeometryService(bridge.pump)
    if not service.capabilities(bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")

    _set_width(bridge, 1.0)
    one = _mesh_header(bridge, service)
    _set_width(bridge, 3.0)
    three = _mesh_header(bridge, service)

    print(
        "mesh header: meshWidth %r -> %r (verts %r)"
        % (one.get("meshWidth"), three.get("meshWidth"), three["counts"]["verts"])
    )
    assert one.get("meshWidth") == 1.0, (
        "the mesh header does not carry mesh_width; the client cannot honour "
        "a width it never receives"
    )
    assert three.get("meshWidth") == 3.0

    # ADDITIVE: nothing the previous wire shape promised may have moved.
    assert three["kind"] == "indexed-mesh"
    assert three["counts"]["verts"] > 0
    assert three["counts"]["tris"] == 0
    assert three["nStrip"] > 0
    assert three["buffers"]["strip"]["dtype"] == "i32"
    assert three["buffers"]["strip"]["itemSize"] == 1
    assert three["buffers"]["position"]["itemSize"] == 3
    assert three["buffers"]["position"]["byteLength"] == (
        three["counts"]["verts"] * 3 * 4
    )
    assert "index" not in three["buffers"], "a mesh has strips, not triangles"


@pytest.mark.engine
def test_mesh_width_is_the_raw_setting_not_the_dynamic_one(bridge, meshed):
    """The header value is ``I->Width``, unscaled.

    ``dynamic_width`` is ON by default (``layer1/SettingInfo.h:710``), so what
    PyMOL actually rasterises is ``clamp(0.06 / vertex_scale, 0.75, 2.5) *
    mesh_width`` -- a camera-dependent number.  If the packer had sent the
    scaled value instead, this test would read something other than 2.0 for
    every camera but one, and a cached frame would keep a stale width forever.
    """
    service = GeometryService(bridge.pump)
    if not service.capabilities(bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")

    _set_width(bridge, 2.0)
    at_rest = _mesh_header(bridge, service)["meshWidth"]

    # Move the camera far enough to change vertex_scale by a large factor, and
    # fetch again.  `zoom buffer=N` changes the camera distance, which is the
    # only input to the dynamic factor besides the viewport height.
    def zoom_out(engine):
        engine.cmd.zoom(OBJ, buffer=60.0)
        engine.cmd.refresh()

    bridge.pump.call(zoom_out, timeout=300)
    zoomed = _mesh_header(bridge, service)["meshWidth"]
    bridge.pump.call(lambda engine: engine.cmd.zoom(OBJ), timeout=300)

    print("meshWidth at rest %r, zoomed out %r" % (at_rest, zoomed))
    assert at_rest == 2.0 and zoomed == 2.0


@pytest.mark.engine
def test_a_width_change_is_not_answered_unchanged(bridge, meshed):
    """The half of row 131 that source reading would have missed.

    ``mesh_width`` moves NO VERTEX, so the payload is byte-identical across a
    width change.  The content hash was taken over the payload alone, so the
    bridge answered ``unchanged`` and the client kept the old header -- MEASURED
    in a browser before the fix: Mode G laid down exactly 144,047 ink pixels at
    ``mesh_width`` 1 AND at 3.  The digest now covers the stable part of the
    header too, which is what lets a live ``set mesh_width`` reach the screen.

    The same trap was set for every other header-only field: ``pointSize``
    (``dot_width``), ``nonbondedSize``, ``defaultAlpha``, ``oneColor``.
    """
    service = GeometryService(bridge.pump)
    if not service.capabilities(bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")

    _set_width(bridge, 1.0)
    one = _mesh(bridge, service)
    assert one.status == "ok"
    payload_one = one.header["payloadBytes"]

    _set_width(bridge, 4.0)
    four = _mesh(bridge, service)

    print(
        "hash %s (w=1) -> %s (w=4), payloadBytes %d -> %d"
        % (
            one.content_hash[:12],
            four.content_hash[:12],
            payload_one,
            four.header["payloadBytes"],
        )
    )
    # The premise: the geometry really is identical, so this is a HEADER-only
    # change and nothing else could have moved the hash.
    assert four.header["payloadBytes"] == payload_one
    assert four.header["meshWidth"] == 4.0
    assert four.content_hash != one.content_hash, (
        "a width change hashes the same, so a client holding the old frame is "
        "answered `unchanged` and keeps the old width forever"
    )

    # And the counterexample that makes it mean something: with nothing
    # touched, the same fetch is still answered `unchanged`.
    again = _mesh(bridge, service, have=four.content_hash)
    assert again.status == "unchanged", again.status
