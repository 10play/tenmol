"""Parity area 3 — the coordinate primitives, over the wire.

`cmd.get_coords` / `cmd.get_coordset` are the zero-copy coordinate path
(`CoordSetAsNumPyArray`), and the most obvious source of geometry for a
GL-free client. They did not work.

The encoder in `codec.py` was written against msgpack, which has a `bin` type,
and put raw `bytes` in the array's `data` field. RPC replies go out through
`ws.send_json`, which cannot encode `bytes` at all — so every call failed on
the wire from the day it was written, and before the `Session.writer` fix
earlier in this branch it did not even fail, it hung the connection. The unit
test in `test_dispatch.py` passed throughout, because it asserted the dict and
never put it on a wire. That is why these tests go over the socket.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_coords.py -q
"""

from __future__ import annotations

import base64
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")


@pytest.fixture()
def loaded(ws: WSClient):
    ws.call("cmd.load", IL2, "zc_coords")
    yield ws
    ws.call("cmd.delete", "zc_coords")


def decode(array: dict):
    numpy = pytest.importorskip("numpy")
    assert array["__ndarray__"] is True, array
    assert array["encoding"] == "base64", array
    raw = base64.b64decode(array["data"])
    return numpy.frombuffer(raw, dtype=array["dtype"]).reshape(array["shape"])


def test_get_coords_survives_the_json_reply(loaded: WSClient) -> None:
    """The whole point: it comes back at all."""
    array = loaded.call("cmd.get_coords", "zc_coords")
    assert isinstance(array, dict) and array["__ndarray__"] is True, array


def test_the_shape_matches_the_atom_count(loaded: WSClient) -> None:
    natoms = loaded.call("cmd.count_atoms", "zc_coords")
    array = loaded.call("cmd.get_coords", "zc_coords")
    assert array["shape"] == [natoms, 3], (array["shape"], natoms)
    assert array["dtype"] == "float32"


def test_the_values_are_the_real_coordinates(loaded: WSClient) -> None:
    """Decoded numbers, checked against a value read a different way.

    `get_extent` comes from a separate C path, so agreeing with it means the
    bytes were decoded correctly rather than merely being the right LENGTH —
    which a wrong dtype would also satisfy.
    """
    coords = decode(loaded.call("cmd.get_coords", "zc_coords"))
    (min_x, min_y, min_z), (max_x, max_y, max_z) = loaded.call(
        "cmd.get_extent", "zc_coords"
    )
    assert coords[:, 0].min() == pytest.approx(min_x, abs=1e-3)
    assert coords[:, 1].min() == pytest.approx(min_y, abs=1e-3)
    assert coords[:, 2].max() == pytest.approx(max_z, abs=1e-3)


def test_get_coordset_answers_for_both_copy_modes(loaded: WSClient) -> None:
    """`copy=0` is a live VIEW in C; the bridge must copy before unlocking.

    Both modes have to arrive intact here — if `copy=0` leaked a view past the
    API lock, this is where it would show up as garbage rather than as a crash.
    """
    for copy in (0, 1):
        array = loaded.call("cmd.get_coordset", "zc_coords", 1, copy)
        decoded = decode(array)
        assert decoded.shape[1] == 3
        assert bool((decoded != 0).any()), copy


def test_a_moved_object_reports_moved_coordinates(loaded: WSClient) -> None:
    """Not a snapshot of something stale: the numbers track the model.

    `camera=0` IS THE TEST, not a detail. `cmd.translate` defaults to
    `camera=1`, i.e. the vector is in CAMERA space — so this assertion used to
    depend on the camera happening to be at its default orientation, and it
    broke the moment another test in the shared process ran `orient` (measured:
    +10 became +2.88). In model space the answer is +10 whatever the view.
    """
    before = decode(loaded.call("cmd.get_coords", "zc_coords"))[:, 0].mean()
    loaded.call("cmd.translate", [10.0, 0.0, 0.0], "zc_coords", -1, 0)
    after = decode(loaded.call("cmd.get_coords", "zc_coords"))[:, 0].mean()
    assert after - before == pytest.approx(10.0, abs=1e-2)


def test_a_selection_narrows_the_array(loaded: WSClient) -> None:
    array = loaded.call("cmd.get_coords", "zc_coords and name CA")
    expected = loaded.call("cmd.count_atoms", "zc_coords and name CA")
    assert array["shape"] == [expected, 3]
    assert expected < loaded.call("cmd.count_atoms", "zc_coords")


def test_capabilities_is_not_on_cmd(ws: WSClient) -> None:
    """Recorded because the row cites it: it is `pymol.get_capabilities`.

    `packages/engine/modules/pymol/__init__.py:561` assigns it at MODULE level, not onto `cmd`,
    and the dispatcher resolves an unlisted root to `pymol.<root>` — so there
    is no dotted path from the client that reaches it. The numpy support it
    advertises is instead demonstrated directly by the tests above.
    """
    assert ws.call_reply("cmd.get_capabilities")["t"] == "err"
