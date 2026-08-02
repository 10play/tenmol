"""Wave 8, parity area 9 (Builder) — the gaps wave 4 measured but left open.

Every test here closes one clause of a `[~]` row in
``docs/00-parity-inventory.md`` §9, and every claim is an OBSERVATION
of the live engine over the product WebSocket, not a reading of the source:

* the editor's ``_auto_measure`` / ``_pkdihe`` transients and the
  ``pkset``/``pkresi``/``pkchain``/``pkobject`` selections (row "Editor state
  machine"),
* ``doZoom``'s ``cmd.center('%pk1 extend 9')`` (row "doAutoPick / doZoom"),
* ``attach_amino_acid``'s omega=180, the ``nhh`` amide-H fix and the backward
  (pick N, resi-1) branch (row "attach_amino_acid backend semantics"),
* ``attach_nuc_acid``'s opposing-chain detection + naming and the A/B-form
  twist/rise, recovered from real coordinates with a Kabsch fit (row
  "attach_nuc_acid / extend_nuc_acid backend"),
* ``AttachWizard`` mode 1, "Combine w/ Existing Object" (row "ReplaceWizard /
  AttachWizard"),
* ``BioPolymerWizard``'s HIGHLIGHT_SELE attachment-point spheres, both branches
  (row "BioPolymerWizard / AminoAcidWizard / NucleicAcidWizard"),
* ``SculptWizard``'s "Switch Object" and what ``sculpt_vdw_vis_mode`` can and
  cannot reach the client (row "SculptWizard"),
* ``AtomFlagWizard``'s three reference-coords rows and ``do_select`` (row
  "AtomFlagWizard").

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p8_a9.py -q
"""

from __future__ import annotations

import base64
import math
import os
import sys
import time
from typing import Any, Dict, List, Optional, Sequence

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels.builder import BOOTSTRAP_COMMAND  # noqa: E402


# --------------------------------------------------------------------------
# fixtures + helpers
# --------------------------------------------------------------------------


@pytest.fixture
def builder(ws):
    """A connected client with ``cmd.builder_*`` installed and a clean slate.

    Same contract as ``test_builder.py``'s fixture: ONE PyMOL for the whole
    run, so every test dismisses its wizard and deletes its objects.
    """
    reply = ws.do(BOOTSTRAP_COMMAND)
    assert reply["t"] == "ok", reply
    ws.call("cmd.delete", "all")
    ws.call("cmd.builder_dismiss")
    ws.call("cmd.builder_show")
    yield ws
    try:
        ws.call("cmd.builder_dismiss")
        ws.call("cmd.delete", "all")
        ws.call("cmd.unpick")
    except AssertionError:
        pass


@pytest.fixture
def auto_measure(builder):
    """``editor_auto_measure`` is GLOBAL and ``builder_show`` forces it to 0.

    Turn it on for the test and put it back, or every later pick in the shared
    process starts creating measurement objects.
    """
    before = builder.call("cmd.get_setting_int", "editor_auto_measure")
    builder.call("cmd.set", "editor_auto_measure", 1)
    yield builder
    builder.call("cmd.set", "editor_auto_measure", before)
    builder.call("cmd.delete", "_auto_measure")


def slots(state: Dict[str, Any]) -> List[str]:
    return state["editor"]["slots"]


def pick(ws, obj: str, name: str, mode: str = "multi") -> Dict[str, Any]:
    """Pick the atom called ``name`` in ``obj``, the way the viewport would."""
    idx = ws.call("cmd.index", "%s and name %s" % (obj, name))
    assert idx, "no atom named %s in %s" % (name, obj)
    return ws.call("cmd.builder_pick", idx[0][0], idx[0][1], None, mode)


def click(ws, label: str) -> Dict[str, Any]:
    """Click the wizard panel row with this label."""
    state = ws.call("cmd.builder_state")
    rows = state["wizard"]["panel"]
    index = [i for i, row in enumerate(rows) if row[1] == label]
    assert index, "no %r row in %r" % (label, [row[1] for row in rows])
    return ws.call("cmd.builder_wizard_click", index[0])


def coords(ws, sele: str) -> Optional[Any]:
    """``cmd.get_coords`` comes back as the codec's ndarray envelope."""
    import numpy as np

    raw = ws.call("cmd.get_coords", sele)
    if raw is None:
        return None
    data = base64.b64decode(raw["data"])
    return (
        np.frombuffer(data, dtype=raw["dtype"]).reshape(raw["shape"]).astype(float)
    )


def midpoint(extent: Sequence[Sequence[float]]) -> List[float]:
    return [(extent[0][i] + extent[1][i]) / 2.0 for i in range(3)]


def new_duplex(builder, base: str = "gtp", form: str = "B", dbl: bool = True) -> str:
    """Arm NucleicAcidWizard with nothing picked, then "Create As New Object"."""
    builder.call("cmd.delete", "all")
    state = builder.call(
        "cmd.builder_action", "attachNA", base=base, nucType="DNA", form=form,
        dblHelix=dbl,
    )
    assert state["wizard"]["name"] == "NucleicAcidWizard"
    state = click(builder, "Create As New Object")
    assert state["error"] is None, state["error"]
    builder.call("cmd.builder_dismiss")
    return builder.call("cmd.get_object_list")[0]


def free_o3(builder, obj: str) -> Any:
    free = builder.call("cmd.index", "%s and name O3' and not neighbor name P" % obj)
    assert free, "no free O3' in %s" % obj
    return free[0]


# ==========================================================================
# Row: "Editor state machine: pk1..pk4 ... auto-measure"
# ==========================================================================


def test_auto_measure_is_a_distance_then_an_angle_then_a_dihedral(auto_measure):
    """``EditorAutoMeasure`` (``packages/engine/layer3/Editor.cpp:1765-1782``).

    The three branches are distinguished the only way they can be from Python:
    ``_auto_measure`` has no atoms, so its identity is its GEOMETRY.  Building
    the same measurement by hand with ``cmd.distance`` / ``cmd.angle`` /
    ``cmd.dihedral`` gives an extent that the transient must match EXACTLY —
    and the three controls have three different extents, so matching one is not
    matching the others (an angle's arc and a dihedral's wedge stick out).
    """
    b = auto_measure
    b.call("cmd.fragment", "ala")
    b.call("cmd.distance", "_p8ctl_d", "ala and name N", "ala and name CA")
    b.call("cmd.angle", "_p8ctl_a", "ala and name N", "ala and name CA", "ala and name C")
    b.call(
        "cmd.dihedral", "_p8ctl_h", "ala and name N", "ala and name CA",
        "ala and name C", "ala and name O",
    )
    control = {name: b.call("cmd.get_extent", name) for name in
               ("_p8ctl_d", "_p8ctl_a", "_p8ctl_h")}
    # The three controls really are three different shapes.
    assert control["_p8ctl_d"] != control["_p8ctl_a"] != control["_p8ctl_h"]

    try:
        pick(b, "ala", "N")
        assert "_auto_measure" not in b.call("cmd.get_names", "objects"), (
            "one pick is not a measurement"
        )
        pick(b, "ala", "CA")
        assert b.call("cmd.get_type", "_auto_measure") == "object:measurement"
        assert b.call("cmd.get_extent", "_auto_measure") == control["_p8ctl_d"]

        pick(b, "ala", "C")
        assert b.call("cmd.get_extent", "_auto_measure") == control["_p8ctl_a"]

        pick(b, "ala", "O")
        assert b.call("cmd.get_extent", "_auto_measure") == control["_p8ctl_h"]

        # ExecutiveColor(cEditorMeasure, "gray") — Editor.cpp:1781.
        assert b.call("cmd.get_object_color_index", "_auto_measure") == b.call(
            "cmd.get_color_index", "gray"
        )
    finally:
        for name in ("_p8ctl_d", "_p8ctl_a", "_p8ctl_h"):
            b.call("cmd.delete", name)


def test_auto_measure_is_off_when_the_setting_is_off(builder):
    """The control for the test above: ``builder_show`` turns the setting off,
    and with it off two picks create NO transient at all."""
    assert builder.call("cmd.builder_state")["settings"]["editor_auto_measure"] == 0
    builder.call("cmd.fragment", "ala")
    pick(builder, "ala", "N")
    pick(builder, "ala", "CA")
    assert "_auto_measure" not in builder.call("cmd.get_names", "objects")


def test_a_bond_pick_draws_pkdihe_but_only_after_the_pump_draws(builder):
    """``EditorDrawDihedral`` (``packages/engine/layer3/Editor.cpp:96-141``) runs from
    ``EditorUpdate``, i.e. from the RENDER loop — ``EditorActivate`` only sets
    ``DihedralInvalid``.  So ``_pkdihe`` is absent the instant the pick RPC
    returns and appears one draw later.  Measured here, not assumed.
    """
    b = builder
    assert b.subscribe("pixels")["t"] == "ok"
    time.sleep(1.2)
    b.call("cmd.fragment", "ala")
    assert b.call("cmd.get", "editor_auto_dihedral") == "on"

    n = b.call("cmd.index", "ala and name N")[0]
    ca = b.call("cmd.index", "ala and name CA")[0]
    state = b.call("cmd.builder_pick", n[0], n[1], ca[1], "bond")
    assert state["editor"]["hasBond"] is True
    assert state["bondFlag"] == 1
    assert "_pkdihe" not in b.call("cmd.get_names", "all"), (
        "_pkdihe must not exist before a draw"
    )

    deadline = time.monotonic() + 5.0
    names: List[str] = []
    while time.monotonic() < deadline:
        names = b.call("cmd.get_names", "all")
        if "_pkdihe" in names:
            break
        time.sleep(0.2)
    assert "_pkdihe" in names, names
    # _pkdihe1 / _pkdihe2 are the two outer atoms EditorDrawDihedral picks by
    # ObjectMoleculeGetTopNeighbor; the object itself is a dihedral measurement.
    assert "_pkdihe1" in names and "_pkdihe2" in names
    assert b.call("cmd.get_type", "_pkdihe") == "object:measurement"
    b.call("cmd.unpick")


def test_a_multi_pick_builds_pkset_and_a_single_pick_builds_pkresi(builder):
    """``EditorActivate`` -> ``SelectorSubdivide`` (``Editor.cpp:1786-1830``).

    The row claims pkmol/pkresi/pkchain/pkobject are all rebuilt.  MEASURED:
    which ones exist depends on the ``pkresi`` flag ``cmd.edit`` was given —
    ``multi`` (pkresi=0) yields ``pkset``+``pkmol``, ``single`` (pkresi=1)
    yields ``pkmol``+``pkresi``+``pkchain``+``pkobject`` and NO ``pkset``.
    """
    b = builder
    b.call("cmd.fragment", "ala")

    pick(b, "ala", "N")
    state = pick(b, "ala", "CA")
    names = b.call("cmd.get_names", "selections")
    assert slots(state) == ["pk1", "pk2"]
    assert "pkset" in names and "pkmol" in names
    assert b.call("cmd.count_atoms", "pkset") == 2, "pkset is the union of the picks"
    assert b.call("cmd.count_atoms", "pkmol") == 10, "pkmol is the whole molecule"
    assert "pkresi" not in names and "pkchain" not in names
    # _pkfragN is what builder_state reports as nFrag.
    assert state["editor"]["nFrag"] >= 1

    state = pick(b, "ala", "CB", "single")
    names = b.call("cmd.get_names", "selections")
    assert slots(state) == ["pk1"]
    assert "pkresi" in names and "pkchain" in names and "pkobject" in names
    assert "pkset" not in names
    for name in ("pkresi", "pkchain", "pkobject", "pkmol"):
        assert b.call("cmd.count_atoms", name) == 10, name
    b.call("cmd.unpick")


# ==========================================================================
# Row: "doAutoPick / doZoom post-edit re-pick"
# ==========================================================================


@pytest.fixture
def still_camera(builder):
    """``cmd.center(..., animate=-1)`` means "use the ``animation`` setting".

    With animation ON the call returns with the camera byte-identical and
    sweeps over ``int(duration*30)`` later frames, so the assertion has to
    either poll or turn animation off.  Off is deterministic; the setting and
    the view are both global, so both are restored.
    """
    animation = builder.call("cmd.get", "animation")
    view = builder.call("cmd.get_view")
    builder.call("cmd.set", "animation", 0)
    yield builder
    builder.call("cmd.set", "animation", animation)
    builder.call("cmd.set_view", view)


PARKED = [40.0, -40.0, 40.0]


def test_dozoom_centers_the_view_on_pk1_after_a_grow(still_camera):
    """``doZoom`` (``builder.py:1428-1431``) — the last step of ``doAutoPick``.

    ``cmd.center`` sets the ORIGIN OF ROTATION, which is ``get_view()[12:15]``.
    The camera is parked far away first, so "it was already there" cannot pass,
    and the expected origin is not guessed from the extent: the same
    ``cmd.center("%pk1 extend 9")`` is issued by hand from the same parked
    origin and the two answers must agree to the last float.
    """
    b = still_camera
    b.call("cmd.fragment", "ala")
    b.call("cmd.origin", position=PARKED)
    assert [round(v, 3) for v in b.call("cmd.get_view")[12:15]] == PARKED

    idx = b.call("cmd.index", "ala and name HA")[0]
    b.call("cmd.builder_pick", idx[0], idx[1], None, "multi")
    state = b.call(
        "cmd.builder_action", "grow", fragment="methane", hydrogen=1, anchor=0,
        text="methyl",
    )
    assert state["error"] is None, state["error"]
    # doAutoPick's half of the row (already covered): pk1 is the new atom.
    assert slots(state) == ["pk1"]
    origin = b.call("cmd.get_view")[12:15]
    assert [round(v, 3) for v in origin] != PARKED, "doZoom never moved the origin"

    b.call("cmd.origin", position=PARKED)
    b.call("cmd.center", "%pk1 extend 9", animate=0)
    expected = b.call("cmd.get_view")[12:15]
    assert origin == expected, (origin, expected)
    b.call("cmd.unpick")


# ==========================================================================
# Row: "editor.attach_amino_acid backend semantics"
# ==========================================================================


def test_attach_amino_acid_grows_backward_off_a_picked_nitrogen(builder):
    """``editor.py:166-172`` — the N branch counts DOWN (resi-1).

    The ``ala`` fragment is residue 2 (measured), so growing off its N gives
    residue 1 and growing off its C gives residue 3.  Both directions are
    checked here so "resi-1" cannot be confused with "renumbered".
    """
    b = builder
    b.call("cmd.fragment", "ala")
    assert b.call("cmd.count_atoms", "ala and resi 2") == 10

    idx = b.call("cmd.index", "ala and name N")[0]
    b.call("cmd.builder_pick", idx[0], idx[1], None, "multi")
    state = b.call("cmd.builder_action", "attachAA", residue="gly")
    assert state["error"] is None, state["error"]

    assert b.call("cmd.count_atoms", "ala and resn GLY and resi 1") > 0, "not resi-1"
    assert b.call("cmd.count_atoms", "ala and resn ALA and resi 2") > 0
    assert b.call("cmd.count_atoms", "ala and resi 3") == 0, "grew the wrong way"
    # The C->N bond really formed.
    assert b.call("cmd.count_atoms", "(resi 1 and name C) and neighbor (resi 2 and name N)") == 1


def test_attach_amino_acid_sets_omega_to_180(builder):
    """``editor.py:184-186`` / ``:236-238`` — ``set_dihedral(CA,C,N,CA,180)``.

    Omega is measured with ``cmd.get_dihedral`` on the four atoms afterwards,
    in BOTH growth directions.
    """
    b = builder
    b.call("cmd.fragment", "ala")
    idx = b.call("cmd.index", "ala and name C")[0]
    b.call("cmd.builder_pick", idx[0], idx[1], None, "multi")
    assert b.call("cmd.builder_action", "attachAA", residue="gly")["error"] is None
    omega = b.call(
        "cmd.get_dihedral", "ala and resi 2 and name CA", "ala and resi 2 and name C",
        "ala and resi 3 and name N", "ala and resi 3 and name CA",
    )
    assert abs(abs(omega) - 180.0) < 0.5, omega

    b.call("cmd.delete", "all")
    b.call("cmd.unpick")
    b.call("cmd.fragment", "ala")
    idx = b.call("cmd.index", "ala and name N")[0]
    b.call("cmd.builder_pick", idx[0], idx[1], None, "multi")
    assert b.call("cmd.builder_action", "attachAA", residue="gly")["error"] is None
    omega = b.call(
        "cmd.get_dihedral", "ala and resi 1 and name CA", "ala and resi 1 and name C",
        "ala and resi 2 and name N", "ala and resi 2 and name CA",
    )
    assert abs(abs(omega) - 180.0) < 0.5, omega


def _torsions_of_an_attach(bridge, residue: str, terminus: str) -> List[Any]:
    """Every ``set_dihedral`` ``attach_amino_acid`` makes, with its atoms.

    WHY AN EXECUTION TRACE AND NOT A GEOMETRY CHECK.  Measured: the O-C-N-H1
    dihedral of an attached ``nhh`` is 180.000 whether or not the amide-H fix
    runs — passing ``NHH`` (which fails ``amino_acid[0:3]=='nhh'`` and skips the
    branch entirely) gives 180.000 too, because ``h_fix`` already places the
    hydrogen there.  A geometric assertion on that dihedral is therefore
    VACUOUS, and this file will not ship a vacuous assertion.  The set_dihedral
    calls are recorded on the engine thread instead, with the selections
    resolved to ``RESN/RESI/NAME`` at call time, and the spy is removed in a
    ``finally`` so nothing leaks into the shared process.
    """

    def body(engine: Any) -> List[Any]:
        cmd = engine.cmd
        from pymol import editor

        calls: List[Any] = []
        original = cmd.set_dihedral

        def spy(a1: Any, a2: Any, a3: Any, a4: Any, angle: Any, *rest: Any, **kw: Any):
            def label(sele: Any) -> str:
                rows: List[str] = []
                cmd.iterate(sele, "rows.append(resn+'/'+resi+'/'+name)",
                            space={"rows": rows})
                return rows[0] if len(rows) == 1 else repr(rows)

            calls.append(([label(a) for a in (a1, a2, a3, a4)], float(angle)))
            return original(a1, a2, a3, a4, angle, *rest, **kw)

        cmd.set_dihedral = spy
        try:
            cmd.delete("all")
            cmd.unpick()
            cmd.fragment("ala")
            cmd.edit("ala and name %s" % terminus)
            editor.attach_amino_acid("?pk1", residue, ss=1, _self=cmd)
        finally:
            cmd.set_dihedral = original
            cmd.unpick()
        return calls

    return bridge.pump.call(body, timeout=120)


def test_attach_nhh_applies_the_amide_hydrogen_fix(builder, bridge):
    """``editor.py:243-250`` — the ONLY residue-specific branch in the file.

    For ``nhh`` (with hydrogens and a secondary structure) the amide H1 is put
    trans to the carbonyl O: ``set_dihedral(O, C, N, H1, 180)``.  ``nhh`` has no
    CA, so omega and PHI select nothing and the trace is exactly the amide fix
    plus PSI — which is what makes it identifiable.
    """
    calls = _torsions_of_an_attach(bridge, "nhh", "C")
    amide = [c for c in calls if c[0] == ["ALA/2/O", "ALA/2/C", "NHH/3/N", "NHH/3/H1"]]
    assert amide, calls
    assert amide[0][1] == 180.0
    # PSI (-47 for the alpha helix) is the only other one: no CA on an amide
    # cap means no omega and no PHI.
    assert [c[1] for c in calls] == [180.0, -47.0], calls
    builder.call("cmd.delete", "all")


def test_attach_amino_acid_sets_omega_before_phi_and_psi(builder, bridge):
    """``editor.py:236-238`` — omega really is a ``set_dihedral(CA,C,N,CA,180)``
    and not just the geometry the fuse happens to leave behind.

    The trace pins the order too: omega, then PHI, then PSI (-57/-47 for the
    default alpha helix), all four atoms named.
    """
    calls = _torsions_of_an_attach(bridge, "gly", "C")
    assert [c[1] for c in calls] == [180.0, -57.0, -47.0], calls
    assert calls[0][0] == ["ALA/2/CA", "ALA/2/C", "GLY/3/N", "GLY/3/CA"], calls[0]
    assert calls[1][0][1:3] == ["GLY/3/N", "GLY/3/CA"], calls[1]  # PHI about N-CA
    assert calls[2][0][1:3] == ["ALA/2/CA", "ALA/2/C"], calls[2]  # PSI about CA-C
    builder.call("cmd.delete", "all")


def test_attach_amino_acid_refuses_the_wrong_terminus_for_a_cap(builder, bridge):
    """``editor.py:139-146`` — ``nhh``/``nme`` need a C, ``ace`` needs an N.

    The ``print()`` is the ONLY failure signal upstream has (the exception it
    raises is a ``QuietException`` with no text), which is why the row demands
    the bridge forward it to a feedback pane.  Asserted on the pane, not on the
    return value.
    """
    b = builder
    b.call("cmd.fragment", "ala")
    idx = b.call("cmd.index", "ala and name N")[0]
    b.call("cmd.builder_pick", idx[0], idx[1], None, "multi")
    state = b.call("cmd.builder_action", "attachAA", residue="nhh")
    assert state["error"] is not None
    lines = bridge.wait_for_feedback("must be C for residue")
    assert any("must be C for residue 'nhh'" in line for line in lines), lines[-6:]
    assert b.call("cmd.count_atoms", "ala and resn NHH") == 0


# ==========================================================================
# Row: "editor.attach_nuc_acid / extend_nuc_acid backend"
# ==========================================================================


def _screw(before: Any, after: Any) -> Dict[str, float]:
    """The rigid transform taking one residue onto the next, as (twist, rise).

    Kabsch on the matched atom names, then the rotation angle out of the trace
    and the screw translation along the rotation axis.  ``move_new_res``
    (``editor.py:529-585``) builds the new residue by rotating the previous one
    by ``twist`` about z and sliding it by ``rise``, then ``fit_sugars``
    superposes the whole thing onto the chain; the composite is a conjugate of
    that screw, so the angle and the axial translation survive unchanged.
    """
    import numpy as np

    center_b, center_a = before.mean(0), after.mean(0)
    cov = (before - center_b).T @ (after - center_a)
    u, _s, vt = np.linalg.svd(cov)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    rot = vt.T @ np.diag([1.0, 1.0, d]) @ u.T
    angle = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(rot) - 1) / 2))))
    translation = center_a - rot @ center_b
    values, vectors = np.linalg.eig(rot)
    axis = np.real(vectors[:, int(np.argmin(np.abs(values - 1)))])
    axis = axis / np.linalg.norm(axis)
    return {"twist": angle, "rise": abs(float(np.dot(translation, axis)))}


#: ``editor.py:541-546``.
FORM_GEOMETRY = {"B": (36.0, 3.375), "A": (32.7, 2.548)}


@pytest.mark.parametrize("form", ["B", "A"])
def test_extend_places_the_new_residue_by_the_form_twist_and_rise(builder, form):
    """``move_new_res`` + ``fit_sugars`` (``editor.py:436-455,529-585``).

    Recovering 36.000 deg / 3.3750 A for B and 32.700 deg / 2.5480 A for A from
    the ATOM COORDINATES also proves ``pair_fit`` did its job: if the sugar fit
    had been sloppy the composite transform would not be a clean screw and the
    numbers would drift off the constants.
    """
    b = builder
    obj = new_duplex(b, form=form)
    free = free_o3(b, obj)
    b.call("cmd.builder_pick", free[0], free[1], None, "multi")
    state = b.call(
        "cmd.builder_action", "attachNA", base="gtp", nucType="DNA", form=form,
        dblHelix=True,
    )
    assert state["error"] is None, state["error"]

    names = ["P", "O5'", "C5'", "C4'", "C3'", "O3'", "C1'", "N9", "C8", "N7"]
    first, second = [], []
    for name in names:
        escaped = name.replace("'", "\\'")
        one = coords(b, "%s and chain A and resi 1 and name %s" % (obj, escaped))
        two = coords(b, "%s and chain A and resi 2 and name %s" % (obj, escaped))
        if one is not None and two is not None and len(one) == 1 and len(two) == 1:
            first.append(one[0])
            second.append(two[0])
    assert len(first) == len(names), "the two residues are not the same base"

    import numpy as np

    screw = _screw(np.array(first), np.array(second))
    twist, rise = FORM_GEOMETRY[form]
    assert abs(screw["twist"] - twist) < 0.05, screw
    assert abs(screw["rise"] - rise) < 0.01, screw


def test_extend_detects_the_opposing_strand_and_grows_it_too(builder):
    """``extend_nuc_acid``'s ``get_chains_oppo`` + ``check_DNA_base_pair``
    (``editor.py:648-675``): chains within 15 A, base pairs within 3.5 A.

    A duplex grows on BOTH strands from one pick; the opposing residue is
    numbered ``last_resv_oppo - 1`` and no third chain is invented.
    """
    b = builder
    obj = new_duplex(b)
    assert b.call("cmd.get_chains", obj) == ["A", "B"]
    before_a = b.call("cmd.count_atoms", "%s and chain A" % obj)
    before_b = b.call("cmd.count_atoms", "%s and chain B" % obj)

    free = free_o3(b, obj)
    b.call("cmd.builder_pick", free[0], free[1], None, "multi")
    state = b.call(
        "cmd.builder_action", "attachNA", base="gtp", nucType="DNA", form="B",
        dblHelix=True,
    )
    assert state["error"] is None, state["error"]

    assert b.call("cmd.get_chains", obj) == ["A", "B"], "invented a new chain"
    assert b.call("cmd.count_atoms", "%s and chain A" % obj) > before_a
    assert b.call("cmd.count_atoms", "%s and chain B" % obj) > before_b, (
        "the opposing strand was not detected"
    )
    # The pair really is a pair: the new bases are within hydrogen-bonding
    # distance of each other.
    assert b.call(
        "cmd.count_atoms",
        "(%s and chain A and resi 2) within 3.5 of (%s and chain B)" % (obj, obj),
    ) > 0


def test_a_new_opposing_chain_is_named_by_incrementing_the_last_letter(builder):
    """``get_new_chain`` (``editor.py:676-698``): A -> B, and Z -> ZA.

    Reached by extending a SINGLE strand with the double-helix radio on: no
    base pair is found, so the opposing strand has to be named from scratch.
    """
    b = builder
    obj = new_duplex(b, base="atp", dbl=False)
    assert b.call("cmd.get_chains", obj) == ["A"]
    free = free_o3(b, obj)
    b.call("cmd.builder_pick", free[0], free[1], None, "multi")
    state = b.call(
        "cmd.builder_action", "attachNA", base="gtp", nucType="DNA", form="B",
        dblHelix=True,
    )
    assert state["error"] is None, state["error"]
    assert b.call("cmd.get_chains", obj) == ["A", "B"]
    # last_resv_oppo = -last_resv, then -1 for an O3' extension (editor.py:996).
    assert b.call("cmd.count_atoms", "%s and chain B and resi -2" % obj) > 0

    b.call("cmd.builder_dismiss")
    obj = new_duplex(b, base="atp", dbl=False)
    b.call("cmd.alter", obj, "chain='Z'")
    b.call("cmd.sort", obj)
    free = free_o3(b, obj)
    b.call("cmd.builder_pick", free[0], free[1], None, "multi")
    state = b.call(
        "cmd.builder_action", "attachNA", base="gtp", nucType="DNA", form="B",
        dblHelix=True,
    )
    assert state["error"] is None, state["error"]
    assert b.call("cmd.get_chains", obj) == ["Z", "ZA"], "Z must append A, not wrap"


# ==========================================================================
# Row: "ReplaceWizard / AttachWizard"
# ==========================================================================


def test_attach_wizard_combine_merges_the_fragment_into_the_picked_object(builder):
    """``AttachWizard`` mode 1 (``builder.py:322-330``) -> ``combine_fragment``
    (``editor.py:88-96``), which is ``cmd.fuse(..., mode=3)``: the atoms join
    the picked OBJECT without a bond and without a new object.
    """
    b = builder
    b.call("cmd.fragment", "ala")
    b.call("cmd.unpick")
    state = b.call(
        "cmd.builder_action", "grow", fragment="benzene", hydrogen=6, anchor=0,
        text="phenyl",
    )
    assert state["wizard"]["name"] == "AttachWizard"

    state = click(b, "Combine w/ Existing Object")
    assert state["error"] is None, state["error"]
    assert state["wizard"]["prompt"] == ["Pick object to combine phenyl into..."]

    before_atoms = b.call("cmd.count_atoms", "ala")
    before_objects = b.call("cmd.get_object_list")
    state = pick(b, "ala", "CB")
    assert state["error"] is None if "error" in state else True

    assert b.call("cmd.get_object_list") == before_objects, "combine made an object"
    assert b.call("cmd.count_atoms", "ala") == before_atoms + 12, "benzene is 12 atoms"
    # mode=3 fuses without bonding: the ring joins the object as its own
    # fragment, so the picked CB gained no neighbour.
    assert b.call("cmd.count_atoms", "neighbor (ala and name CB)") == 4
    # The wizard drops back to mode 0 (builder.py:329).
    state = b.call("cmd.builder_state")
    if state["wizard"] is not None:
        assert "combine" not in state["wizard"]["prompt"][0]


# ==========================================================================
# Row: "BioPolymerWizard / AminoAcidWizard / NucleicAcidWizard"
# ==========================================================================


AA_HIGHLIGHT = "(name N &! neighbor name C) | (name C &! neighbor name N)"
NA_HIGHLIGHT = (
    "(name O3' &! neighbor name P) | (name P &! neighbor name O3')"
    " | (name O5' &! neighbor name P) "
)


def test_the_amino_acid_wizard_spheres_the_free_termini_while_armed(builder):
    """``BioPolymerWizard.highlight_attachment_points`` (``builder.py:389-397``).

    The spheres are ordinary rep changes, so they are counted with ``rep
    spheres`` — on while armed, off again on cleanup.
    """
    b = builder
    b.call("cmd.fragment", "ala")
    b.call("cmd.hide", "everything")
    b.call("cmd.show", "sticks", "ala")
    b.call("cmd.unpick")
    assert b.call("cmd.count_atoms", "ala and rep spheres") == 0

    state = b.call("cmd.builder_action", "attachAA", residue="gly")
    assert state["wizard"]["name"] == "AminoAcidWizard"
    highlighted = b.call("cmd.count_atoms", "ala and rep spheres")
    expected = b.call("cmd.count_atoms", "ala and (%s)" % AA_HIGHLIGHT)
    assert expected == 2, "ala has a free N and a free C"
    assert highlighted == expected, (highlighted, expected)

    b.call("cmd.builder_dismiss")
    assert b.call("cmd.count_atoms", "ala and rep spheres") == 0, (
        "cleanup must take the highlights away"
    )


def test_the_nucleic_acid_wizard_spheres_only_when_nothing_is_already_spheres(builder):
    """``builder.py:429-433`` — the highlight is suppressed entirely when the
    user already has spheres on those atoms, and then cleanup must NOT hide
    them.  Both halves, on the NucleicAcid selection this time.
    """
    b = builder
    obj = new_duplex(b)
    b.call("cmd.hide", "everything")
    b.call("cmd.show", "sticks", obj)
    b.call("cmd.unpick")
    candidates = b.call("cmd.count_atoms", "%s and (%s)" % (obj, NA_HIGHLIGHT))
    assert candidates > 0

    # 1. nothing shown as spheres -> the wizard highlights.
    state = b.call("cmd.builder_action", "attachNA", base="gtp", nucType="DNA")
    assert state["wizard"]["name"] == "NucleicAcidWizard"
    assert b.call("cmd.count_atoms", "%s and rep spheres" % obj) == candidates
    b.call("cmd.builder_dismiss")
    assert b.call("cmd.count_atoms", "%s and rep spheres" % obj) == 0

    # 2. the user shows one of them -> no auto-highlight, and it survives.
    b.call("cmd.show", "spheres", "%s and (%s)" % (obj, NA_HIGHLIGHT))
    b.call("cmd.builder_action", "attachNA", base="gtp", nucType="DNA")
    assert b.call("cmd.count_atoms", "%s and rep spheres" % obj) == candidates
    b.call("cmd.builder_dismiss")
    assert b.call("cmd.count_atoms", "%s and rep spheres" % obj) == candidates, (
        "cleanup hid spheres the user had shown"
    )


def test_the_biopolymer_panel_has_no_combine_row(builder):
    """The mode-1 dead end, stated as a test.

    ``BioPolymerWizard.get_panel`` (``builder.py:456-471``) offers no "Combine"
    row, so ``do_pick``'s ``mode == 1`` branch is unreachable from the UI —
    which is lucky, because upstream it calls ``editor.combine_monomer()`` /
    ``editor.combine_nucleotide()`` and NEITHER EXISTS in this tree.  This port
    reports that instead of raising ``AttributeError`` at pick time.
    """
    from pymol import editor

    assert not hasattr(editor, "combine_monomer")
    assert not hasattr(editor, "combine_nucleotide")

    b = builder
    b.call("cmd.fragment", "ala")
    b.call("cmd.unpick")
    state = b.call("cmd.builder_action", "attachAA", residue="gly")
    labels = [row[1] for row in state["wizard"]["panel"]]
    # `activateRepeatOrDismiss` is always repeating on first activation
    # (builder.py:255), so this is the branch a user ever sees.
    assert labels == ["Attaching Multiple Residues", "Create As New Object", "Done"]
    assert not any("Combine" in label for label in labels)

    # The other branch of get_panel — the one AttachWizard puts a Combine row
    # into (builder.py:349-364) — has none either.  Only reachable by
    # instantiating the class, because nothing sets `repeating` back to 0.
    from tenmol_bridge.panels.builder import AminoAcidWizard

    other = AminoAcidWizard.get_panel(_FakeNonRepeating())
    assert [row[1] for row in other] == [
        "Attaching Amino Acid", "Create As New Object", "Attach Multiple...", "Done",
    ]


class _FakeNonRepeating:
    """Just enough of a wizard for ``get_panel``'s non-repeating branch."""

    def getRepeating(self) -> int:
        return 0


# ==========================================================================
# Row: "ValenceWizard / UnbondWizard (bond-picking mouse mode switching)"
# ==========================================================================


def test_a_real_click_deletes_a_BOND_while_the_unbond_wizard_is_armed(builder):
    """``cmd.button('single_left','none','PkBd')`` (``builder.py:722,738``),
    read back the only way it can be read back.

    MEASURED: there is NO Python getter for the button table.  ``ButModeGet`` is
    declared at ``packages/engine/layer1/ButMode.h:225`` and never bound in ``packages/engine/layer4/Cmd.cpp``;
    ``cmd.get_vis()`` carries visibility and colour only
    (``Executive.cpp:4496-4526``).  So the PkAt -> PkBd transition is only
    observable as a change in WHAT A CLICK DOES — and this forwards a real one
    through ``{t:'input'}``, the same path ``test_picking.py`` uses.

    The discriminator is exact: with ``bondFlag=1`` UnbondWizard deletes the
    C01-C02 bond; with ``bondFlag=0`` it re-arms PkBd and unpicks, leaving the
    molecule untouched (``builder.py:735-737``).
    """
    b = builder
    view = b.call("cmd.get_view")
    try:
        assert b.subscribe("pixels")["t"] == "ok"
        b.call("cmd.delete", "all")
        b.call("cmd.fragment", "ethylene", "pkbd_obj")
        b.call("cmd.hide", "everything")
        b.call("cmd.show", "sticks", "pkbd_obj")
        b.call("cmd.reset")
        b.call("cmd.zoom", "pkbd_obj", 1.0)
        # cmd.center puts the midpoint of the two carbons on the optical axis,
        # so the C01-C02 bond is exactly under the middle pixel.
        b.call("cmd.center", "pkbd_obj and name C01+C02", animate=0)
        b.call("cmd.unpick")
        time.sleep(1.2)

        state = b.call("cmd.builder_action", "deleteBond")
        assert state["wizard"]["name"] == "UnbondWizard"
        assert b.call("cmd.count_atoms", "pkbd_obj and name C01 and neighbor name C02") == 1

        width, height = b.call("cmd.get_viewport")[:2]
        x, y = width // 2, height // 2
        b.input("button", button=0, state=0, x=x, y=y, mod=0, when=0.0)
        b.input("button", button=0, state=1, x=x, y=y, mod=0, when=0.0)

        deadline = time.monotonic() + 6.0
        gone = False
        while time.monotonic() < deadline:
            gone = b.call(
                "cmd.count_atoms", "pkbd_obj and name C01 and neighbor name C02"
            ) == 0
            if gone:
                break
            time.sleep(0.2)
        assert gone, (
            "a left click did not resolve to a BOND; names=%r"
            % (b.call("cmd.get_names", "all"),)
        )
    finally:
        b.call("cmd.builder_dismiss")
        b.call("cmd.delete", "pkbd_obj")
        b.call("cmd.set_view", view)


# ==========================================================================
# Row: "SculptWizard"
# ==========================================================================


def test_switch_object_deactivates_and_the_next_pick_sculpts_the_other_object(builder):
    """``SculptWizard.sculpt_deactivate`` behind the "Switch Object" row
    (``builder.py:214``).  The prompt IS the state machine.
    """
    b = builder
    b.call("cmd.fragment", "ala", "sc_one")
    b.call("cmd.fragment", "trp", "sc_two")
    b.call("cmd.unpick")

    state = b.call("cmd.builder_action", "sculpt")
    assert state["wizard"]["name"] == "SculptWizard"
    assert state["wizard"]["prompt"] == ["Pick object to sculpt..."]

    state = pick(b, "sc_one", "CB")
    assert state["wizard"]["prompt"] == ["Sculpting sc_one..."]
    assert b.call("cmd.get", "sculpting") == "on"

    state = click(b, "Switch Object")
    assert state["error"] is None, state["error"]
    assert state["wizard"]["prompt"] == ["Pick object to sculpt..."], "still bound"

    state = pick(b, "sc_two", "CB")
    assert state["wizard"]["prompt"] == ["Sculpting sc_two..."]

    state = click(b, "Done")
    assert state["wizard"] is None
    assert b.call("cmd.get", "sculpting") == "off"
    b.call("cmd.delete", "sc_one")
    b.call("cmd.delete", "sc_two")


@pytest.fixture
def vdw_vis(builder):
    before = builder.call("cmd.get_setting_int", "sculpt_vdw_vis_mode")
    builder.call("cmd.set", "sculpt_vdw_vis_mode", 1)
    yield builder
    builder.call("cmd.set", "sculpt_vdw_vis_mode", before)


def test_sculpting_with_vdw_vis_on_moves_atoms_and_keeps_the_cgo_rep_on(vdw_vis):
    """``sculpt_activate`` with ``sculpt_vdw_vis_mode`` (``builder.py:150-151``).

    Two measurements:

    1. the activation branch runs — the setting reads back as 1 and
       ``cmd.show('cgo', obj)`` leaves the object's CGO rep bit on (rep 13 in
       ``cmd.get_vis()``);
    2. ``cmd.sculpt_iterate`` really moves coordinates, which is the "stream"
       the client has to consume.  It is driven per call, not by a timer.
    """
    b = vdw_vis
    b.call("cmd.fragment", "trp", "sc_vdw")
    b.call("cmd.unpick")
    b.call("cmd.builder_action", "sculpt")
    state = pick(b, "sc_vdw", "CB")
    assert state["wizard"]["prompt"] == ["Sculpting sc_vdw..."]
    assert state["settings"]["sculpt_vdw_vis_mode"] == 1
    assert 13 in b.call("cmd.get_vis")["sc_vdw"][2], "the CGO rep bit is off"

    before = coords(b, "sc_vdw")
    b.call("cmd.sculpt_iterate", "sc_vdw", 1, 20)
    after = coords(b, "sc_vdw")
    import numpy as np

    moved = float(np.abs(after - before).max())
    assert moved > 1e-4, "sculpt_iterate did nothing (max delta %g)" % moved

    click(b, "Done")
    assert b.call("cmd.get", "sculpting") == "off"
    b.call("cmd.delete", "sc_vdw")


# ==========================================================================
# Row: "AtomFlagWizard"
# ==========================================================================


def test_reference_coords_rows_store_recall_and_swap(builder):
    """The three flag-2-only rows (``builder.py:962-964``) -> ``cmd.reference``
    (``editing.py:77-84``).  Store, move, recall, and then swap twice.
    """
    b = builder
    b.call("cmd.fragment", "ala", "ref_obj")
    b.call("cmd.unpick")
    state = b.call("cmd.builder_action", "rest")
    assert state["wizard"]["name"] == "RestAtomWizard"
    state = pick(b, "ref_obj", "CB")
    labels = [row[1] for row in state["wizard"]["panel"]]
    assert "Store Reference Coords." in labels

    # NOTE: ``get_prompt`` calls ``cmd.reference("validate")`` on every state
    # read (builder.py:876), which CREATES the reference array at the current
    # coordinates.  A test that stored at the home position and recalled from
    # there would therefore pass with "Store" deleted.  So the atom is moved
    # FIRST, and the stored position is one no other step could produce.
    home = b.call("cmd.get_atom_coords", "ref_obj and name CB")
    b.call("cmd.translate", [1.0, 0.0, 0.0], "ref_obj and name CB", camera=0)
    stored = b.call("cmd.get_atom_coords", "ref_obj and name CB")
    assert abs(stored[0] - home[0] - 1.0) < 1e-4
    click(b, "Store Reference Coords.")

    b.call("cmd.translate", [0.0, 2.0, 0.0], "ref_obj and name CB", camera=0)
    click(b, "Recall Reference Coords.")
    back = b.call("cmd.get_atom_coords", "ref_obj and name CB")
    assert all(abs(a - c) < 1e-4 for a, c in zip(back, stored)), (back, stored, home)

    # Swap exchanges current <-> reference, so from the stored position a move
    # and one swap show the reference again, and a second swap brings the moved
    # copy back.
    b.call("cmd.translate", [0.0, 0.0, 3.0], "ref_obj and name CB", camera=0)
    click(b, "Swap Reference Coords.")
    swapped = b.call("cmd.get_atom_coords", "ref_obj and name CB")
    assert all(abs(a - c) < 1e-4 for a, c in zip(swapped, stored)), swapped
    click(b, "Swap Reference Coords.")
    again = b.call("cmd.get_atom_coords", "ref_obj and name CB")
    assert abs(again[2] - stored[2] - 3.0) < 1e-4, again
    b.call("cmd.delete", "ref_obj")


def test_do_select_rewrites_the_flag_set_from_the_build_display_selection(builder):
    """``AtomFlagWizard.do_select`` (``builder.py:906-913``).

    The engine only fires ``WizardDoSelect`` from the MOUSE paths
    (``SceneMouse.cpp:135,357``, ``Seeker.cpp:150,231``,
    ``Executive.cpp:7563`` — the box/rect select), never from ``cmd.select``,
    so the web object panel needs an explicit hook: ``cmd.builder_select``.
    This drives it exactly as that panel will.
    """
    b = builder
    b.call("cmd.fragment", "trp", "flag_obj")
    b.call("cmd.unpick")
    b.call("cmd.builder_action", "fix")
    state = pick(b, "flag_obj", "CB")
    assert state["wizard"]["name"] == "FixAtomWizard"
    click(b, "All")
    total = b.call("cmd.count_atoms", "flag_obj")
    assert b.call("cmd.count_atoms", "flag_obj and flag 3") == total

    # The user narrows _build_display to the backbone in the object panel...
    b.call("cmd.select", "_build_display", "flag_obj and name N+CA+C+O")
    backbone = b.call("cmd.count_atoms", "_build_display")
    assert 0 < backbone < total
    # ...and the panel reports the edit.
    state = b.call("cmd.builder_select", "_build_display")
    assert state["error"] is None, state["error"]
    assert b.call("cmd.count_atoms", "flag_obj and flag 3") == backbone
    assert b.call("cmd.count_atoms", "flag_obj and not name N+CA+C+O and flag 3") == 0

    # A different selection name is ignored (builder.py:907).
    b.call("cmd.select", "_p8_other", "flag_obj and name CB")
    b.call("cmd.builder_select", "_p8_other")
    assert b.call("cmd.count_atoms", "flag_obj and flag 3") == backbone
    b.call("cmd.delete", "_p8_other")
    b.call("cmd.builder_dismiss")
    b.call("cmd.flag", 3, "flag_obj", "clear")
    b.call("cmd.delete", "flag_obj")


def test_builder_select_is_a_no_op_without_a_wizard(builder):
    """It must never explode: the object panel does not know what is armed."""
    b = builder
    b.call("cmd.builder_dismiss")
    state = b.call("cmd.builder_select", "_build_display")
    assert state["error"] is None
    assert state["wizard"] is None


# ==========================================================================
# Row: "Action row 3 — Undo / Redo"
# ==========================================================================


def test_undo_restores_coordinates_but_not_topology(builder):
    """What ``Undo`` actually does in this tree, measured both ways.

    ``editor.undocontext`` is an empty class (``editor.py:38-49``), so no
    Builder action pushes an undo state.  The engine's undo itself is REAL for
    coordinates — ``cmd.push_undo`` + a move + ``cmd.undo`` restores them and
    ``cmd.redo`` re-applies — but it does NOT restore an atom count, so a grow
    stays grown even when an undo state was pushed first.  That is why the
    panel ships an ``undo_is_noop`` warning next to the two buttons.
    """
    b = builder
    b.call("cmd.fragment", "ala", "undo_obj")
    home = b.call("cmd.get_atom_coords", "undo_obj and name CB")

    b.call("cmd.push_undo", "undo_obj")
    b.call("cmd.translate", [1.0, 0.0, 0.0], "undo_obj and name CB", camera=0)
    assert b.call("cmd.get_atom_coords", "undo_obj and name CB")[0] - home[0] > 0.9
    b.call("cmd.undo")
    assert all(
        abs(a - c) < 1e-4
        for a, c in zip(b.call("cmd.get_atom_coords", "undo_obj and name CB"), home)
    ), "coordinate undo is broken"
    b.call("cmd.redo")
    assert b.call("cmd.get_atom_coords", "undo_obj and name CB")[0] - home[0] > 0.9

    # Topology: push an undo state, grow, and watch undo NOT take it back.
    before = b.call("cmd.count_atoms", "undo_obj")
    b.call("cmd.push_undo", "undo_obj")
    idx = b.call("cmd.index", "undo_obj and name HA")[0]
    b.call("cmd.builder_pick", idx[0], idx[1], None, "multi")
    state = b.call(
        "cmd.builder_action", "grow", fragment="benzene", hydrogen=6, anchor=0,
        text="phenyl",
    )
    assert state["error"] is None, state["error"]
    grown = b.call("cmd.count_atoms", "undo_obj")
    assert grown > before
    b.call("cmd.undo")
    assert b.call("cmd.count_atoms", "undo_obj") == grown, (
        "if this ever fails, builder actions became undoable and the row's "
        "undo_is_noop warning can go"
    )
    assert b.call("cmd.builder_state")["undo_is_noop"] is True
    b.call("cmd.unpick")
    b.call("cmd.delete", "undo_obj")
