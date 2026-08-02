"""Wave 9, areas 2/3/4/11.

ROW 149 (GL-free operation end to end).  The remaining gap was: "the driver is
the camera only - it cannot pick and does not consult the ButMode table ...
there is no rubber-band path at all".  The client half now resolves every
gesture through ``butModeTranslate(tableForMode(mode), ...)`` and commits a
rubber band through ``pickIndex.box`` -- but a TypeScript unit test can only
prove that the client EMITS a particular call.  This file proves the other
half: that each of those calls, run on the real engine over the real socket,
actually performs the ButMode action it is supposed to stand for.

Every test restores what it touched.  ``get_view`` is snapshotted and written
back, the scratch objects and selections are deleted, and the editor is
unpicked -- the suite shares one PyMOL process and a left-over ``pk1`` breaks
picking everywhere else (see the notes in ``test_wf_files.py``).
"""

from __future__ import annotations

import contextlib

import pytest


# ---------------------------------------------------------------- helpers


@pytest.fixture
def scratch(ws):
    """A one-residue molecule and a restored global state afterwards."""
    view0 = ws.call("get_view")
    ws.call("unpick")
    ws.call("delete", "zz_p9")
    ws.call("fragment", "ala", "zz_p9")
    try:
        yield "zz_p9"
    finally:
        ws.call("unpick")
        with contextlib.suppress(AssertionError):
            ws.call("delete", "zz_p9")
        with contextlib.suppress(AssertionError):
            ws.call("delete", "zz_p9_sele")
        ws.call("set_view", view0)


def _view(ws):
    return list(ws.call("get_view"))


# ---------------------------------------------------------------- camera


def test_the_camera_actions_move_the_camera_the_way_the_table_names_them(ws, scratch):
    """Rota / Move / MovZ: the three unmodified slots of every viewing mode."""
    before = _view(ws)

    ws.call("turn", "y", 10.0)
    after_turn = _view(ws)
    assert abs(after_turn[0] - before[0]) > 1e-3, (before[0], after_turn[0])
    # cos(10 deg) = 0.9848 -- the rotation is real, not a no-op refresh.
    assert after_turn[0] == pytest.approx(0.9848, abs=1e-3)

    ws.call("set_view", before)
    ws.call("move", "x", 1.0)
    after_move = _view(ws)
    assert [round(a - b, 4) for a, b in zip(after_move, before)][12:15] != [0.0, 0.0, 0.0] or \
        after_move[9] != before[9], (before, after_move)

    ws.call("set_view", before)
    ws.call("move", "z", 5.0)
    after_z = _view(ws)
    # MEASURED: `move z, 5` is +5 on the camera position and -5 on the near
    # plane -- which is exactly `translate(0,0,factor); front -= factor`, the
    # body of cButModeZoomForward (`packages/engine/layer1/SceneMouse.cpp:752-780`).
    assert after_z[11] - before[11] == pytest.approx(5.0, abs=1e-4)
    assert after_z[15] - before[15] == pytest.approx(-5.0, abs=1e-4)


def test_clip_moves_the_planes_in_the_direction_the_drag_math_assumes(ws, scratch):
    """The signs the driver encodes for ClipNF / ClipN / ClipF."""
    before = _view(ws)

    ws.call("clip", "near", 1.0)
    v = _view(ws)
    assert v[15] - before[15] == pytest.approx(-1.0, abs=1e-4)
    assert v[16] - before[16] == pytest.approx(0.0, abs=1e-4)

    ws.call("set_view", before)
    ws.call("clip", "far", 1.0)
    v = _view(ws)
    assert v[15] - before[15] == pytest.approx(0.0, abs=1e-4)
    assert v[16] - before[16] == pytest.approx(-1.0, abs=1e-4)

    ws.call("set_view", before)
    ws.call("clip", "move", 1.0)
    v = _view(ws)
    assert v[15] - before[15] == pytest.approx(-1.0, abs=1e-4)
    assert v[16] - before[16] == pytest.approx(-1.0, abs=1e-4)


def test_the_wheel_slab_math_is_scene_clips_own(ws, scratch):
    """`clip slab, f * thickness` IS `SceneClip(Scaling, f)`.

    `SceneClipMode::Scaling` (`packages/engine/layer1/Scene.cpp:1427`) keeps the midpoint and
    multiplies the half-width; `clip slab` sets a thickness about the midpoint.
    They are the same operation, which is what lets the client express the
    wheel action without a new entry point.
    """
    before = _view(ws)
    front, back = before[15], before[16]
    thickness = back - front
    midpoint = (front + back) / 2.0

    ws.call("clip", "slab", thickness * 1.2)
    v = _view(ws)
    assert v[16] - v[15] == pytest.approx(thickness * 1.2, abs=1e-3)
    assert (v[15] + v[16]) / 2.0 == pytest.approx(midpoint, abs=1e-3)

    # And `clip move` is `SceneClipMode::Proportional`: both planes shift by
    # the same amount, so the thickness survives.
    ws.call("set_view", before)
    ws.call("clip", "move", 0.1 * thickness)
    v = _view(ws)
    assert v[16] - v[15] == pytest.approx(thickness, abs=1e-3)
    assert v[15] - front == pytest.approx(-0.1 * thickness, abs=1e-3)


# ------------------------------------------------------- object motions


def test_roto_and_movo_write_the_object_matrix_and_nothing_else(ws, scratch):
    """RotO / MovO / MvOZ, as `cmd.rotate(object=)` / `cmd.translate(object=)`."""
    name = scratch
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    assert [round(x, 6) for x in ws.call("get_object_matrix", name)] == identity
    # PIN THE CAMERA. `camera=1` means the axis and the vector are in CAMERA
    # space, so with the suite's shared camera left wherever the previous test
    # put it the numbers below are unpredictable -- measured, `m[3]` came out
    # as -380 in a full-suite run and 1.0 alone.  The `scratch` fixture puts
    # the real view back afterwards.
    ws.call("set_view", [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 100, -20])

    coords_before = ws.call("get_atom_coords", "%s and name CA" % name)
    ws.call("rotate", "y", 10.0, "all", -1, 1, name)
    m = ws.call("get_object_matrix", name)
    assert m[0] == pytest.approx(0.9848, abs=1e-3)
    assert m[2] == pytest.approx(0.1736, abs=1e-3)
    moved = ws.call("get_atom_coords", "%s and name CA" % name)
    assert moved != coords_before  # `get_atom_coords` reports TRANSFORMED coords

    before_translate = ws.call("get_object_matrix", name)
    ws.call("translate", [1.0, 0.0, 0.0], "all", -1, 1, name)
    m = ws.call("get_object_matrix", name)
    assert m[3] - before_translate[3] == pytest.approx(1.0, abs=1e-4)

    # THE DISCRIMINATOR between the object actions and the atom actions is the
    # matrix itself: RotO/MovO put the whole motion in it (`ObjectTranslateTTT`)
    # and MovA/MovF do not touch it at all -- asserted in
    # `test_mova_moves_the_picked_atom_in_camera_space` below, which leaves this
    # matrix at the identity while moving an atom by exactly 1 A.
    #
    # NOTE, measured and not what the docs suggest: `matrix_reset` did NOT put
    # the matrix back in either mode (-1 or 0) here, and BOTH `get_atom_coords`
    # and `get_coords` report TRANSFORMED coordinates, so neither can be used to
    # show "the coordinates did not move".


# ---------------------------------------------------------- editor drags


def test_mova_moves_the_picked_atom_in_camera_space(ws, scratch):
    """MovA: `cmd.translate(v, 'pk1', camera=1)`, the pk1 the editor set."""
    name = scratch
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    ws.call("edit", "%s and name CA" % name)
    assert ws.call("count_atoms", "pk1") == 1
    before = ws.call("get_atom_coords", "pk1")
    # camera=1 with an identity view rotation is the identity transform, so the
    # displacement is readable directly.
    ws.call("set_view", [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 100, -20])
    ws.call("translate", [1.0, 0.0, 0.0], "pk1", -1, 1)
    after = ws.call("get_atom_coords", "pk1")
    assert [round(a - b, 4) for a, b in zip(after, before)] == [1.0, 0.0, 0.0]
    # And the object matrix is untouched -- this is a COORDINATE write, which
    # is what separates MovA from MovO.
    assert [round(x, 6) for x in ws.call("get_object_matrix", name)] == identity


def test_torf_is_cmd_torsion_on_the_bond_the_editor_picked(ws, scratch):
    """TorF: `EditorDrag` turns a drag into an angle about pk1-pk2."""
    name = scratch
    # The bond must SEPARATE the two ends of the dihedral, or the torsion
    # rotates a fragment that both ends belong to and nothing moves: measured,
    # `edit(N, CA)` + dihedral(C, N, CA, CB) changes by exactly 0.
    ws.call("edit", "%s and name CA" % name, "%s and name C" % name)
    quad = [
        "%s and name %s" % (name, atom) for atom in ("N", "CA", "C", "O")
    ]
    before = ws.call("get_dihedral", *quad)
    ws.call("torsion", 30.0)
    after = ws.call("get_dihedral", *quad)
    assert (after - before) == pytest.approx(30.0, abs=0.1), (before, after)


def test_the_fragment_probe_the_driver_runs_finds_the_right_pkfrag(ws, scratch):
    """RotF / MovF: `_pkfragN` is a REAL selection, and `(?...)` is required.

    `EditorPrepareDrag` (`packages/engine/layer3/Editor.cpp:1928-1940`) keeps the fragment that
    contains the dragged atom, walking 1..NFrag.  The client cannot see NFrag,
    so it probes at most four names -- and the probe MUST use the `?` prefix:
    measured, `count_atoms('_pkfrag3')` RAISES ` Error: Invalid selection name`
    when the editor made only two, which would abort the walk on its third step.
    """
    name = scratch
    ws.call("edit", "%s and name CA" % name, "%s and name CB" % name)

    sizes = [ws.call("count_atoms", "(?_pkfrag%d)" % n) for n in (1, 2, 3, 4)]
    assert sizes[0] > 0 and sizes[1] > 0, sizes
    assert sizes[2] == 0 and sizes[3] == 0, sizes

    # The un-prefixed form is the trap, asserted rather than described.  A name
    # the editor never creates is used, because `_pkfrag3` may still EXIST (and
    # be empty) from an earlier edit in this shared process.
    reply = ws.call_reply("count_atoms", "_pkfrag9")
    assert reply["t"] == "err", reply
    assert "Invalid selection name" in reply["error"]["message"]
    assert ws.call("count_atoms", "(?_pkfrag9)") == 0

    # The exact expression the driver builds, for the atom it picked.
    cb_index = ws.call("index", "%s and name CB" % name)[0][1]
    target = "%s`%d" % (name, cb_index)
    hits = [
        n
        for n in (1, 2, 3, 4)
        if ws.call("count_atoms", "(?_pkfrag%d) and (%s)" % (n, target)) > 0
    ]
    assert hits == [2], hits

    # And moving that fragment moves COORDINATES, unlike RotO above.
    before = ws.call("get_atom_coords", "%s and name CB" % name)
    ws.call("set_view", [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -50, 0, 0, 0, 40, 100, -20])
    ws.call("translate", [1.0, 0.0, 0.0], "_pkfrag2", -1, 1)
    after = ws.call("get_atom_coords", "%s and name CB" % name)
    assert [round(a - b, 4) for a, b in zip(after, before)] == [1.0, 0.0, 0.0]


# ------------------------------------------------------------ rubber band


def test_the_three_rubber_band_expressions_select_what_the_C_selects(ws, scratch):
    """`+Box` / `-Box` / `Box`, as `ExecutiveSelectRect` spells them.

    The client builds the same strings with the atom list in place of the C's
    temporary rectangle selection (`Executive.cpp:7480-7520`).  This runs those
    strings against the engine and counts the atoms, so the SET/ADD/SUB
    difference is measured rather than asserted from the source.
    """
    name = scratch
    sele = "zz_p9_sele"
    # `cmd.index` gives the 1-based INDEX the backtick form addresses;
    # `cmd.identify` gives the atom ID, which starts at 0 here and would
    # silently select the whole object (`obj`0`).
    indices = dict(
        (atom, ws.call("index", "%s and name %s" % (name, atom))[0][1])
        for atom in ("N", "CB")
    )
    n_sel = "%s`%d" % (name, indices["N"])
    cb_sel = "%s`%d" % (name, indices["CB"])

    # SET, at the Atoms level (no keyword at all).
    ws.call("select", sele, "((%s))" % n_sel)
    assert ws.call("count_atoms", sele) == 1

    # ADD one more atom.
    ws.call("select", sele, "(?%s or (%s))" % (sele, cb_sel))
    assert ws.call("count_atoms", sele) == 2

    # SUBTRACT it again.
    ws.call("select", sele, "((?%s) and not (%s))" % (sele, cb_sel))
    assert ws.call("count_atoms", sele) == 1
    assert ws.call("count_atoms", "%s and (%s)" % (sele, n_sel)) == 1

    # The selection LEVEL is not decoration: `byresi` promotes one atom to the
    # whole residue, which is what `SceneGetSeleModeKeyword` feeds the C.
    total = ws.call("count_atoms", name)
    ws.call("select", sele, "(byresi (%s))" % n_sel)
    assert ws.call("count_atoms", sele) == total

    # ADDING to a selection that does not exist yet must not raise: that is
    # what the `?` prefix in the C's own format string is for.
    reply = ws.call_reply("select", sele, "(?zz_p9_never or (%s))" % n_sel)
    assert reply["t"] == "ok", reply
    assert ws.call("count_atoms", sele) == 1


def test_a_backtick_index_selection_addresses_exactly_one_atom(ws, scratch):
    """The client's `obj\\`N` is 1-based; the pick payload is 0-based.

    The band would silently select the neighbouring atom if this were wrong,
    which is the kind of off-by-one no unit test on the client can catch.
    """
    name = scratch
    pairs = ws.call("index", name)
    indices = sorted(pair[1] for pair in pairs)
    assert indices[0] == 1, indices  # 1-based, exactly as the pick payload is not
    for index in indices[:3]:
        assert ws.call("count_atoms", "%s`%d" % (name, index)) == 1
    assert ws.call("count_atoms", "%s`%d" % (name, indices[-1] + 1)) == 0
    # AND the trap: index 0 is not "no atom", it is the WHOLE OBJECT, which is
    # what a 0-based client index would silently select.
    assert ws.call("count_atoms", "%s`0" % name) == ws.call("count_atoms", name)


# ==========================================================================
# ROW 108 (wizard panel block): the six wizards the wave-8 walk skipped
# ==========================================================================
#
# The audit's finding was that `test_p8_a2.py:562` carries a hardcoded
# `_SKIP = {openvr, security, dragging, sculpting, demo, stereodemo}` that
# `continue`s BEFORE the launch, so the walk covered about 16 of 24 stock
# wizards and the row's "every wizard" claim was too strong.  The instruction
# was: "drop or justify the six skips".
#
# This does both, per wizard, with a measurement rather than a description.


#: Globals the stock wizards write while merely being CONSTRUCTED.  Same list
#: as `test_p8_a2.py::_WIZARD_GLOBALS`, and for the same reason: `sculpting`
#: turns on editing and `mouse_selection_mode` leaking to 0 breaks
#: `test_selection_modes.py` a thousand tests later.
_WIZARD_GLOBALS = (
    "mouse_selection_mode",
    "button_mode",
    "button_mode_name",
    "auto_zoom",
    "sculpting",
    "auto_sculpt",
    "suspend_updates",
    "editor_auto_dihedral",
    "valence",
    "stereo_mode",
)

_SKIPPED_BY_WAVE_8 = ("openvr", "security", "dragging", "sculpting", "demo", "stereodemo")


@pytest.fixture
def wizard_guard(ws):
    """Snapshot every global these wizards can write, and assert it came back."""
    before = {name: ws.call("cmd.get", name) for name in _WIZARD_GLOBALS}
    names_before = set(ws.call("get_names", "all", 0) or ())
    scheme_before = ws.call("get_editor_scheme")
    yield
    ws.do("/cmd.set_wizard_stack([])")
    assert ws.call("wizards.probe")["depth"] == 0
    ws.call("unpick")
    for name, value in before.items():
        if ws.call("cmd.get", name) != value:
            ws.call("set", name, value, quiet=1)
    for name in set(ws.call("get_names", "all", 0) or ()) - names_before:
        ws.call("delete", name)
    assert set(ws.call("get_names", "all", 0) or ()) == names_before
    after = {name: ws.call("cmd.get", name) for name in _WIZARD_GLOBALS}
    assert after == before, {
        name: (before[name], after[name]) for name in before if before[name] != after[name]
    }
    assert ws.call("get_editor_scheme") == scheme_before


def test_stereodemo_is_the_one_skip_that_is_justified_not_lazy(ws, bridge):
    """It DELETES THE SESSION and turns stereo on, in its constructor.

    Not read off the file: read off the CLASS OBJECT in the running engine, so
    it stays true if the module moves.  `Stereodemo.__init__` calls
    `full_screen`, `stereo` and `launch`, and `launch` calls `cmd.delete` --
    with `"all"` as its only string constant.  Launching it inside a suite that
    shares one PyMOL process would destroy every other test's objects.
    """
    ws.do(
        "/from pymol.wizard.stereodemo import Stereodemo;"
        "print('P9WIZ_INIT', sorted(Stereodemo.__init__.__code__.co_names));"
        "print('P9WIZ_LAUNCH', sorted(Stereodemo.launch.__code__.co_names));"
        "print('P9WIZ_CONSTS', [c for c in Stereodemo.launch.__code__.co_consts if isinstance(c, str)][:4])"
    )
    # SKIP THE ECHO: `cmd.do` prints the command line itself first, and it
    # contains every tag we are looking for.
    lines = [
        line
        for line in bridge.wait_for_feedback("P9WIZ_CONSTS")
        if "P9WIZ_" in line and not line.lstrip().startswith("PyMOL>")
    ]
    init = next(line for line in lines if "P9WIZ_INIT" in line)
    launch = next(line for line in lines if "P9WIZ_LAUNCH" in line)
    consts = next(line for line in lines if "P9WIZ_CONSTS" in line)
    assert "stereo" in init, init
    assert "full_screen" in init, init
    assert "launch" in init, init
    assert "delete" in launch, launch
    assert "'all'" in consts, consts


def test_the_other_five_skipped_wizards_do_launch_and_ship_a_real_panel(ws, wizard_guard):
    """openvr / security / dragging / sculpting / demo, walked for real.

    The same assertions the wave-8 walk makes on the sixteen it did cover: the
    panel is a list of `[type, text, code]` rows with `type` in 1/2/3
    (`packages/engine/layer1/Wizard.cpp:195-580`), the event mask is an int, and every type-3
    row's `get_menu(code)` returns a well-formed `[code, text, command]` list
    with no callable on the wire.
    """
    # Anchor the arithmetic: these six really are in the catalogue the panel
    # offers, so "16 of 24" and "21 of 24" mean something.
    catalog = {entry["name"] for entry in ws.call("wizards.catalog")["wizards"]}
    assert set(_SKIPPED_BY_WAVE_8) <= catalog, sorted(catalog)
    assert len(catalog) >= 24, sorted(catalog)

    walked = {}
    refused = {}
    for name in _SKIPPED_BY_WAVE_8:
        if name == "stereodemo":
            continue  # see the test above: it deletes the session
        launched = ws.call_reply("wizards.launch", name)
        if launched["t"] != "ok" or launched["result"].get("depth", 0) == 0:
            error = launched.get("error") or {}
            refused[name] = str(error.get("message", error))[:160]
            continue
        snapshot = ws.call("wizards.snapshot")
        assert snapshot["cls"], (name, snapshot)
        assert isinstance(snapshot["eventMask"], int), (name, snapshot)
        for row in snapshot["panel"]:
            assert row["type"] in (1, 2, 3), (name, row)
            assert isinstance(row["text"], str), (name, row)
            assert isinstance(row["code"], str), (name, row)
        popups = [row for row in snapshot["panel"] if row["type"] == 3]
        for row in popups:
            result = ws.call("wizards.menu", row["code"])
            assert result["items"] is not None, (name, row, result.get("error"))
            for item in result["items"]:
                assert item["code"] in (0, 1, 2), (name, row, item)
                assert isinstance(item["text"], str), (name, row, item)
                assert isinstance(item.get("command", ""), str), (name, row, item)
        walked[name] = {
            "rows": len(snapshot["panel"]),
            "popups": len(popups),
            "mask": snapshot["eventMask"],
        }
        ws.call("wizards.dismiss", all=True)

    # MEASURED on this build, and it CONTRADICTS the reason wave 8 gave for
    # the skip list: all five launch, including `dragging` -- whose
    # `check_valid` was expected to pop it when `get_editor_scheme() != 3`.
    assert refused == {}, refused
    assert set(walked) == {"openvr", "security", "sculpting", "demo", "dragging"}, walked

    # `dragging` is the one that carries no panel: `Dragging.check_valid`
    # invalidates itself unless `get_editor_scheme() == 3` (a drag really in
    # progress), and an invalid Dragging returns no rows at all.  So it IS
    # walkable -- it just has nothing to draw, which is a fact about the wizard
    # and not a hole in the panel protocol.
    assert walked["dragging"]["rows"] == 0, walked
    assert ws.call("get_editor_scheme") != 3

    # The other four ship real panels.
    for name in ("openvr", "security", "sculpting", "demo"):
        assert walked[name]["rows"] >= 3, (name, walked[name])
    assert walked["openvr"]["popups"] >= 1, walked  # scene / wizard / gui menus
    assert walked["security"]["rows"] == 6, walked  # accept / decline / mdump
    assert walked["demo"]["rows"] == 13, walked  # 12 demos plus the title row

    # And the event masks are per-wizard answers, not one constant: `dragging`
    # asks for 129 (pick | a bit the others do not set) where `demo` takes the
    # base-class default.
    assert len({info["mask"] for info in walked.values()}) > 1, walked
