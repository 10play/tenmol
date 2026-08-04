"""Parity area 3 — `CGOSimplify`, and why this pipeline does not want it.

The row proposes a backend flag `geometry_mode='triangles'` that would run
`CGOSimplify` to bake analytic primitives (spheres, cylinders, cones,
ellipsoids, quadrics) into triangles before shipping them.

That is exactly what Mode G is built NOT to do for impostor reps, and the
reason is recorded in `render/modeg.py`: an exporter that tessellated instead
of instancing turned 1UBQ `mesh` into 31,710 cylinders + 63,420 spheres.
`INSTANCED_ONLY_REPS` in `geometry.ts` makes the client REJECT a spheres frame
that carries triangles and no instances.

So this file measures which CGO the accessor actually takes, per rep, because
that is the observable difference between "impostors preserved" and
"impostors baked".

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_cgo_simplify.py -q
"""

from __future__ import annotations

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

CGO_SPHERE = "7"


def geometry_for(ws: WSClient, rep: str) -> dict:
    """One rep on a fresh scene. See `test_geometry_exports.py` on why fresh."""
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zcs_obj")
    ws.call("cmd.hide", "everything")
    ws.call("cmd.show", rep, "zcs_obj and resi 1-5")
    ws.call("cmd.rebuild")
    result = ws.call("_bridge.get_geometry", object="zcs_obj", rep=rep)
    assert result["status"] == "ok", result
    return result


@pytest.mark.parametrize(
    "symbol", ["cmd.cgo_simplify", "cmd.simplify_cgo", "_cmd.CGOSimplify"]
)
def test_CGOSimplify_has_no_python_entry_point(ws: WSClient, symbol: str) -> None:
    """It is C-only. The row's `geometry_mode` flag would be new C, not glue."""
    assert ws.call_reply(symbol)["t"] == "err"


def test_spheres_arrive_as_PRIMITIVES_not_triangles(ws: WSClient) -> None:
    """The invariant, measured where it is decided.

    The accessor takes `RepSphere::primitiveCGO` — the CGO BEFORE
    `CGOSimplify` — so `CGO_SPHERE` (opcode 7) survives to the client, which
    draws it as an instanced impostor. 22 spheres in 1,312 bytes.

    Had the pipeline taken the simplified CGO instead, those 22 spheres would
    be some thousands of triangles at the current `sphere_quality`, and the
    client would REJECT the frame outright (`INSTANCED_ONLY_REPS`).
    """
    result = geometry_for(ws, "spheres")
    diagnostics = result["diagnostics"]
    assert diagnostics["source"] == "RepSphere::primitiveCGO", diagnostics
    assert CGO_SPHERE in diagnostics["ops"], diagnostics["ops"]
    assert diagnostics["ops"][CGO_SPHERE] > 0
    assert not diagnostics["unhandledOps"], diagnostics["unhandledOps"]
    # Small, because it is 22 analytic spheres rather than their tessellation.
    assert result["bytes"] < 10_000, result["bytes"]


def test_sticks_also_come_from_the_primitive_CGO(ws: WSClient) -> None:
    result = geometry_for(ws, "sticks")
    assert result["diagnostics"]["source"] == "RepCylBond::primitiveCGO"
    assert not result["diagnostics"]["unhandledOps"]


def test_cartoon_DOES_arrive_tessellated_and_that_is_correct(ws: WSClient) -> None:
    """The contrast that makes the rule legible.

    A cartoon has no impostor form — there is no analytic primitive for a
    ribbon — so the accessor takes `RepCartoon::preshader`, which is already
    triangles. "Impostors stay impostors" is a rule about reps that HAVE an
    impostor, not a blanket ban on triangles.
    """
    result = geometry_for(ws, "cartoon")
    assert result["diagnostics"]["source"] == "RepCartoon::preshader"
    assert CGO_SPHERE not in result["diagnostics"]["ops"]
    assert result["bytes"] > 1000


def test_dots_go_through_the_instance_path(ws: WSClient) -> None:
    """`Rep.Dot` is in `INSTANCED_ONLY_REPS`; a point cloud would be rejected."""
    result = geometry_for(ws, "dots")
    diagnostics = result["diagnostics"]
    assert diagnostics["source"] == "RepDot"
    assert diagnostics["dots"] > 0, diagnostics
