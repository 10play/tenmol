"""Parity area 3 — the `cache_mode>=2` surface path, and the binary dump.

Row 124 asks whether a complete surface mesh can be got out of PyMOL with NO
C++ change, purely by turning on the existing job cache. It can, and this
measures exactly what comes out.

That matters because the surface is the one rep a client-side tessellator
cannot reasonably reproduce — spheres and cylinders are analytic, a molecular
surface is not.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_surface_cache.py -q
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


@pytest.fixture()
def surfaced(ws: WSClient, bridge):
    """A fresh surface built with the job cache on, and the cache emptied first."""
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zsc_obj")
    ws.do("pymol._cache = []")
    ws.call("cmd.set", "cache_mode", 2)
    ws.call("cmd.hide", "everything")
    ws.call("cmd.show", "surface", "zsc_obj and resi 1-20")
    ws.call("cmd.rebuild")
    ws.call("cmd.refresh")
    yield ws
    ws.call("cmd.set", "cache_mode", 0)
    ws.do("pymol._cache = []")
    ws.call("cmd.delete", "zsc_obj")


def ask(ws: WSClient, bridge, tag: str, expression: str):
    """Run a print in PyMOL and read the value back off the feedback stream.

    `pymol._cache` is a module global, not a `cmd` attribute, so there is no
    dotted path a client call can reach — printing is the way in without
    inventing a route for a prototype.
    """
    ws.do("print('%s', %s)" % (tag, expression))
    lines = bridge.wait_for_feedback(tag, timeout=5.0)
    for line in lines:
        # SKIP THE ECHO. PyMOL prints the command back before running it, so
        # the first line carrying the tag is the source text, not the value.
        if tag in line and 'print(' not in line:
            return line.split(tag, 1)[1].strip()
    raise AssertionError("no %s output in %r" % (tag, lines[-5:]))


def test_the_cache_holds_one_entry_with_the_documented_shape(surfaced, bridge):
    """`[size, hash, input_tuple, output_tuple, access_count, timestamp]`."""
    shape = ask(
        surfaced,
        bridge,
        "ZSCSHAPE",
        "[type(x).__name__ for x in pymol._cache[0]]",
    )
    assert shape == "['int', 'tuple', 'tuple', 'tuple', 'int', 'float']", shape


def test_the_output_tuple_IS_a_complete_surface_mesh(surfaced, bridge):
    """`(N, V, VN, NT, T, S)` — vertices, normals and triangles, in Python.

    Measured on il2.pdb resi 1-20, `entry[3]`:

        N   3312            vertex count
        V   9936 floats     = 3312 x 3  vertices
        VN  9936 floats     = 3312 x 3  vertex normals
        NT  6620            triangle count
        T   19860 ints      = 6620 x 3  triangle indices
        S   26480           strip/flag data

    The internal consistency is the assertion, not the absolute numbers: V and
    VN must each be 3N, and T must be 3 x NT. A path that returned the right
    LENGTHS with the wrong stride would still be useless, and those two ratios
    are what a consumer relies on.

    Missing, per the row and confirmed by the shape: no VC (vertex colour), so
    a client fed from here draws in a flat object colour.
    """
    counts = ask(
        surfaced,
        bridge,
        "ZSCOUT",
        "[len(x) if hasattr(x,'__len__') else x for x in pymol._cache[0][3]]",
    )
    n, v, vn, nt, t, s = eval(counts)  # noqa: S307 - our own print, our own tag

    assert n > 0 and nt > 0, counts
    assert v == n * 3, ("V is not 3N", v, n)
    assert vn == n * 3, ("VN is not 3N", vn, n)
    assert t == nt * 3, ("T is not 3*NT", t, nt)
    assert s > 0


def test_nothing_is_cached_when_cache_mode_is_off(ws: WSClient, bridge) -> None:
    """The default. Without this the row would read as "surfaces are free"."""
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zsc_off")
    ws.do("pymol._cache = []")
    ws.call("cmd.set", "cache_mode", 0)
    try:
        ws.call("cmd.show", "surface", "zsc_off and resi 1-20")
        ws.call("cmd.rebuild")
        ws.call("cmd.refresh")
        assert ask(ws, bridge, "ZSCEMPTY", "len(pymol._cache)") == "0"
    finally:
        ws.call("cmd.delete", "zsc_off")


# --------------------------------------------------------------- binary dump


def test_pse_binary_dump_really_does_shrink_the_file(ws: WSClient, tmp_path) -> None:
    """`PConvFloatArrayToPyList`'s binary mode, observed where it ships.

    With `dump_binary` on, float arrays go out as raw little-endian float32
    (`PyBytes_FromStringAndSize`) instead of boxed PyFloats. Measured on
    il2.pdb: 909,161 bytes off, 686,747 on — about 24% smaller.

    This is the production evidence that the PyBytes blob primitive works, and
    the reason a geometry feed can plan on it rather than on lists of Python
    floats.
    """
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zsc_dump")
    original = ws.call("cmd.get", "pse_binary_dump")
    try:
        sizes = {}
        for value in (0, 1):
            ws.call("cmd.set", "pse_binary_dump", value)
            path = tmp_path / ("dump%d.pse" % value)
            ws.call("cmd.save", str(path))
            sizes[value] = path.stat().st_size
        assert sizes[1] < sizes[0], sizes
        assert sizes[0] - sizes[1] > 100_000, sizes
    finally:
        ws.call("cmd.set", "pse_binary_dump", original)
        ws.call("cmd.delete", "zsc_dump")
