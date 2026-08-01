"""Parity area 3 — what PyMOL's existing exporters can actually give us.

These rows are RESEARCH rows: the question is not "does the React port call
this" but "is this a viable source of GL-free geometry", which is the whole
cross-platform bet. An answer of "no" is as useful as a yes, provided it is
measured rather than assumed — so the negative results here are asserted just
as hard as the positive ones.

A METHOD NOTE, learned the hard way three times in this branch. Every test
below rebuilds its scene from scratch. An earlier draft looped
`hide everything; show <rep>` over one object and concluded that `get_povray`
returned EMPTY geometry for spheres — it does not; the emptiness came from the
loop's own leftover state. Anything measured against a scene another assertion
touched is not evidence.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_geometry_exports.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")

REPS = ("sticks", "spheres", "surface", "cartoon", "lines")


def scene_with(ws: WSClient, rep: str, sele: str = "zg_obj and resi 1-5") -> None:
    """A FRESH scene showing exactly one rep. See the module docstring."""
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zg_obj")
    ws.call("cmd.hide", "everything")
    ws.call("cmd.show", rep, sele)


def is_blob(value: object) -> bool:
    return isinstance(value, dict) and value.get("__blob__") is True


# ------------------------------------------------------------------ VRML


@pytest.mark.parametrize("version", [1, 2])
def test_get_vrml_produces_a_blob_for_both_versions(ws: WSClient, version: int) -> None:
    """The highest-fidelity TEXT export, and big enough to need a blob.

    That it arrives as a blob handle rather than inline is itself the finding:
    any pipeline built on this pays a fetch, it is not a cheap poll.
    """
    scene_with(ws, "sticks")
    assert is_blob(ws.call("cmd.get_vrml", version))


# --------------------------------------------------------------- COLLADA


def test_get_collada_produces_a_blob(ws: WSClient) -> None:
    scene_with(ws, "sticks")
    assert is_blob(ws.call("cmd.get_collada"))


# ------------------------------------------------------------------ glTF


def test_get_gltf_is_not_an_exporter_and_says_so(ws: WSClient, tmp_path) -> None:
    """UNAVAILABLE, and for a reason worth recording.

    `cmd.get_gltf` is a pure-Python shim that shells out to `collada2gltf`. No
    such binary here, so it fails cleanly — it is not a glTF writer that could
    be fixed by passing different arguments, and no geometry pipeline should be
    planned around it.
    """
    scene_with(ws, "sticks")
    reply = ws.call_reply("cmd.get_gltf", str(tmp_path / "x.gltf"))
    assert reply["t"] == "err"
    assert "collada2gltf" in reply["error"]["message"], reply


# --------------------------------------------------------------- POV-Ray


@pytest.mark.parametrize("rep", REPS)
def test_get_povray_returns_header_and_geometry_for_every_rep(ws: WSClient, rep: str):
    """`(header, geometry)` INLINE — no blob, and never empty.

    This is the one text export that answers for all five reps, which makes it
    the most useful of the group as a geometry source. Sizes measured on
    il2.pdb resi 1-5: sticks 9,786 / spheres 2,354 / surface 266,856 /
    cartoon 51,600 / lines 12,374 characters.
    """
    scene_with(ws, rep)
    result = ws.call("cmd.get_povray")
    assert isinstance(result, (list, tuple)) and len(result) == 2, result
    header, geometry = result
    assert isinstance(header, str) and header, "empty POV header"
    assert isinstance(geometry, str) and len(geometry) > 100, (rep, len(geometry))


# ------------------------------------------------------------------ IDTF


def test_get_idtf_returns_two_blobs(ws: WSClient) -> None:
    """`(node, rsrc)` — a PAIR, and both large enough to be blobbed.

    Worth pinning the arity: a caller that treated this as a single string
    would silently get the node and drop every resource.
    """
    scene_with(ws, "sticks")
    result = ws.call("cmd.get_idtf")
    blobs = result.get("__blobs__") if isinstance(result, dict) else None
    assert isinstance(blobs, list) and len(blobs) == 2, result
    assert all(is_blob(b) for b in blobs), blobs


# --------------------------------------------------- Wavefront OBJ (broken)


#: Measured on il2.pdb resi 1-5. `get_mtl_obj` exports the TESSELLATED reps and
#: nothing at all for the line-based ones.
OBJ_SIZES = {
    "sticks": 0,
    "lines": 0,
    "spheres": 2279,
    "surface": 108402,
    "cartoon": 20568,
}


@pytest.mark.parametrize("rep", REPS)
def test_get_mtl_obj_exports_TRIANGLES_ONLY_and_no_materials(ws: WSClient, rep: str):
    """Its docstring says "incomplete and unsupported"; here is what that means.

    NOT uniformly broken, which is what an earlier draft of this test asserted
    after measuring all five reps in one loop over a shared scene. Measured
    properly, one fresh scene each:

        sticks   0 bytes      lines    0 bytes
        spheres  2,279        surface  108,402      cartoon  20,568

    So it exports the reps that are already triangles and emits nothing for the
    line-based ones — and the MTL half is EMPTY in every case, so the geometry
    arrives with no materials and therefore no colour. That is the part that
    disqualifies it as a colour-carrying geometry source, and it is a much more
    useful statement than "broken".
    """
    scene_with(ws, rep)
    result = ws.call("cmd.get_mtl_obj")
    assert isinstance(result, (list, tuple)) and len(result) == 2, result
    mtl, obj = result

    # The material half never carries anything, for any rep.
    assert mtl == "", (rep, len(mtl))

    if OBJ_SIZES[rep] == 0:
        assert obj == "", (rep, len(obj))
    else:
        assert len(obj) > 1000, (rep, len(obj))
        assert obj.startswith("v "), obj[:40]
        assert "\nf " in obj, "vertices but no faces"


# ------------------------------------------------------------------- STL


def test_stl_export_raises_in_this_build(ws: WSClient, tmp_path) -> None:
    """`get_stlstr` is not even on `cmd`; the save path raises Incentive-only.

    Matches the LOAD side (`test_files.py`'s capability list), so STL is
    unavailable in both directions and neither is a packaging accident this
    build could be talked out of.
    """
    scene_with(ws, "sticks")
    assert ws.call_reply("cmd.get_stlstr")["t"] == "err"

    reply = ws.call_reply("cmd.save", str(tmp_path / "x.stl"))
    assert reply["t"] == "err"
    assert reply["error"]["type"] == "IncentiveOnlyException", reply["error"]
    assert "STL export" in reply["error"]["message"]
