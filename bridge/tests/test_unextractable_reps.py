"""Parity area 3 — the two reps marked "structurally not extractable".

Both rows are dead ends by design, and both are worth an assertion rather than
a note, for opposite reasons:

* `cRepCallback` really has nothing to serialize, and the interesting question
  is whether the geometry path SAYS so or just returns nothing.
* Volume/slice have no mesh either, but their FIELD is fully Python-accessible,
  so "not extractable" would be the wrong summary to leave behind.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_unextractable_reps.py -q
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


# ------------------------------------------------------------ cRepCallback


def test_a_callback_object_reports_unsupported_instead_of_empty(ws: WSClient):
    """`cmd.load_callback` runs arbitrary user Python issuing raw GL calls.

    There is no CGO, no vertex array, no primitive list — by construction there
    is nothing to serialize. What matters for the client is that the geometry
    path says so: an empty mesh and an inextractable one look identical on the
    wire unless the reason travels with the answer, and the difference decides
    whether the viewport falls back to Mode P or silently draws nothing.
    """
    ws.call("cmd.delete", "all")
    ws.do("cmd.load_callback(lambda *a: None, 'zu_cb')")
    try:
        assert "zu_cb" in ws.call("cmd.get_names", "all")

        result = ws.call("_bridge.get_geometry", object="zu_cb", rep="callback")
        assert result["status"] == "unsupported", result
        assert result["bytes"] == 0
        assert result["fallbackReason"] == "unsupported-rep", result
        # And the message names what IS supported, so it is actionable.
        assert "no CPU-side geometry accessor" in result["message"], result
        for supported in ("molecular", "measurement", "CGO"):
            assert supported in result["message"], result["message"]
    finally:
        ws.call("cmd.delete", "zu_cb")


# --------------------------------------------------------- volume and slice


@pytest.fixture()
def a_map(ws: WSClient):
    """A real map object, generated rather than shipped as a fixture.

    `test/dat` carries no map file, and `map_new` builds one from the structure
    already there — so this needs no new binary in the tree.
    """
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zu_mol")
    ws.call("cmd.map_new", "zu_map", "gaussian", 1.0, "zu_mol and resi 1-10")
    assert "zu_map" in ws.call("cmd.get_names", "all")
    yield ws
    ws.call("cmd.delete", "zu_map")
    ws.call("cmd.delete", "zu_mol")


def test_the_volume_FIELD_is_fully_accessible_even_though_the_mesh_is_not(a_map):
    """cRepVolume/cRepSlice are ray-marched 3D textures — there is no mesh.

    But `get_volume_field` hands back the field itself as a blob, so "not
    extractable" would be a misleading summary: the data a client needs to
    ray-march it in a `THREE.Data3DTexture` is already reachable, with no new
    accessor. What is missing is the shader port, not the data.
    """
    field = a_map.call("cmd.get_volume_field", "zu_map")
    assert isinstance(field, dict) and field.get("__blob__") is True, field
    assert field["size"] > 1000, field
    assert field["mime"] == "application/octet-stream", field


def test_the_histogram_comes_back_inline(a_map):
    """It is 68 floats at the default 64 bins, not a blob.

    It WAS in `codec.BLOB_RETURNS`, which made it unusable: the blob writer
    accepts only a numpy array and this returns a plain list, so every call
    answered `NotSerializable: get_volume_histogram returned list, expected a
    numpy array`. Removed from that set; a value this small was never a blob.
    """
    histogram = a_map.call("cmd.get_volume_histogram", "zu_map")
    assert isinstance(histogram, list), histogram
    # min, max, mean, stdev + one entry per bin.
    assert len(histogram) == 64 + 4, len(histogram)
    assert all(isinstance(x, (int, float)) for x in histogram)


def test_reading_the_ramp_is_the_SETTER_called_with_no_ramp(a_map):
    """The row's `get_volume_ramp` does not exist, and neither does the wrapper.

    Measured, all three of the obvious spellings:

        cmd.get_volume_ramp            no such symbol (it is the C function)
        cmd.get_volume_color           no such symbol — `colorramping.py:87`
                                       defines it but `api.py` never exports it
        colorramping.get_volume_color  'colorramping' is not an addressable
                                       namespace

    What DOES work is `cmd.volume_color(name)` with the `ramp` argument
    omitted: `colorramping.py:123` returns the current ramp in that case. One
    symbol, reader or writer depending on arity. A port written from the row's
    name would fail at the first call, which is why this is pinned rather than
    corrected quietly in the row text.
    """
    for absent in ("cmd.get_volume_ramp", "cmd.get_volume_color"):
        assert a_map.call_reply(absent, "zu_map")["t"] == "err", absent

    a_map.call("cmd.volume", "zu_vol", "zu_map")
    try:
        ramp = a_map.call("cmd.volume_color", "zu_vol")
        assert isinstance(ramp, list) and ramp, ramp
        # 5 floats per stop: value + RGBA.
        assert len(ramp) % 5 == 0, len(ramp)
    finally:
        a_map.call("cmd.delete", "zu_vol")
