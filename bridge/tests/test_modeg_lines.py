"""``line`` and ``cross`` instance packers.

These two buckets were extracted by the C++ accessor from the start but had no
packer in ``render/modeg.py``, so eight reps (lines, ribbon, nonbonded, cell,
extent, dashes, angles, dihedrals) arrived with ``payloadBytes: 0`` and an
``unmapped`` census, and fell back to Mode P. Every rep pinned to Mode P keeps
the server's GL context load-bearing, which is what the GL-free work is trying
to remove -- so these assertions guard the north star, not just a wire format.

Runs against a real PyMOL built from this tree, with NO GL context.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Dict

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.render.modeg import (  # noqa: E402
    INSTANCE_ITEM_SIZE,
    GeometryService,
    rep_id,
)

REPO = Path(__file__).resolve().parents[2]
PDB = REPO / "test" / "dat" / "1tii.pdb"


@pytest.fixture(scope="module")
def geom():
    """Headless PyMOL + a bare GeometryService (no pump, we call _cgo directly)."""
    sys.argv = ["pymol"]
    import pymol

    opts = pymol.invocation.options
    opts.no_gui = 1
    opts.internal_gui = 0
    opts.internal_feedback = 0
    opts.external_gui = 0

    from pymol2 import SingletonPyMOL

    # Another test in this process may already own the singleton -- PyMOL allows
    # exactly one and raises on a second start(). Reuse it rather than making
    # this module order-dependent.
    started_here = pymol.cmd._COb is None
    if started_here:
        p = SingletonPyMOL()
        p.start()
        cmd = p.cmd
    else:
        p = None
        cmd = pymol.cmd
    import pymol._cmd as _c

    cmd.delete("all")
    cmd.load(str(PDB), "u")
    cmd.hide("everything", "u")
    for rep in ("lines", "ribbon", "nonbonded"):
        cmd.show(rep, "u")
    cmd.refresh()

    svc = GeometryService.__new__(GeometryService)

    def build(rep: str) -> Dict[str, Any]:
        idx = rep_id(rep)
        raw = _c.web_get_rep_geometry(cmd._COb, "u", -1, idx)
        header, payload, diagnostics = svc._cgo(raw, "u", idx, 0)
        return {
            "raw": raw,
            "header": header,
            "payload": payload,
            "diagnostics": diagnostics,
        }

    yield build
    cmd.delete("all")
    if started_here and p is not None:
        p.stop()


def _instance(header: Dict[str, Any], kind: str) -> Dict[str, Any]:
    for inst in header["instances"]:
        if inst["kind"] == kind:
            return inst
    raise AssertionError(
        "no %r instance; got %r" % (kind, [i["kind"] for i in header["instances"]])
    )


def test_the_item_sizes_match_the_typescript_table(geom):
    # geometry.ts INSTANCE_ITEM_SIZE. A drift here corrupts every buffer.
    assert INSTANCE_ITEM_SIZE["line"] == 14  # v1[3] v2[3] rgba1[4] rgba2[4]
    assert INSTANCE_ITEM_SIZE["cross"] == 7  # centre[3] rgba[4]


@pytest.mark.parametrize("rep", ["lines", "ribbon"])
def test_line_reps_produce_a_line_instance_buffer(geom, rep):
    built = geom(rep)
    assert built["raw"].get("status") == "ok"
    inst = _instance(built["header"], "line")
    assert inst["count"] > 0
    assert inst["itemSize"] == 14
    assert inst["data"]["byteLength"] == inst["count"] * 14 * 4


def test_nonbonded_produces_a_cross_instance_buffer(geom):
    inst = _instance(geom("nonbonded")["header"], "cross")
    assert inst["count"] > 0
    assert inst["itemSize"] == 7
    assert inst["data"]["byteLength"] == inst["count"] * 7 * 4


@pytest.mark.parametrize("rep", ["lines", "ribbon", "nonbonded"])
def test_nothing_is_reported_unmapped_any_more(geom, rep):
    """The regression this whole change exists to prevent."""
    built = geom(rep)
    assert "unmapped" not in built["header"], built["header"].get("unmapped")
    assert built["diagnostics"]["unmapped"] == {}
    # payloadBytes: 0 was the observable symptom in the browser.
    assert len(built["payload"]) > 0


@pytest.mark.parametrize("rep", ["lines", "ribbon", "nonbonded"])
def test_pick_indices_survive_so_client_picking_can_resolve_an_atom(geom, rep):
    kind = "cross" if rep == "nonbonded" else "line"
    inst = _instance(geom(rep)["header"], kind)
    assert "atom" in inst, "no atom indices -> Mode G cannot resolve a click"
    assert inst["atom"]["byteLength"] == inst["count"] * 4


def test_lines_are_never_tessellated_into_cylinders(geom):
    """The exporters turn a 660-atom mesh into 31,710 cylinders; we must not."""
    diagnostics = geom("lines")["diagnostics"]
    kinds = {i["kind"] for i in diagnostics["instances"]}
    assert "cylinder" not in kinds and "cylinder2" not in kinds
    assert diagnostics["blocks"] == 0
