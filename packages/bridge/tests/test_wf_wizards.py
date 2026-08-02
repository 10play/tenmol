"""Wave 6, area 8 — wizard session persistence, nucleic mutagenesis, the box
wizard, the command wizard and the builder wizards.

Everything here runs against the real PyMOL over the real WebSocket, because
the four rows this file closes are all claims about *behaviour*, not shape:

* **Session persistence** (`wizarding.py:176-196`) — a wizard stack really does
  survive `cmd.save(x.pse)` / `cmd.load(x.pse)`, sub-state and all, and the
  bridge's version counter moves when it happens (which is the whole of the
  "emit `wizard.changed`" mechanism: there is no callback, see
  `panels/wizards.py`).  One divergence is pinned rather than papered over:
  the restore ORPHANS `pymol.session.wizard_storage`.
* **`nucmutagenesis.py`** — pick -> `do_select('byres pk1')` -> fragment ->
  `pair_fit` -> chi transfer -> `apply()` -> `fuse` + `alter resn`, measured on
  a real ATP nucleotide, including the `D` prefix branch.
* **`box.py`** — the CGO box, the `do_scene` coordinate diff that rebuilds it,
  the `auto_position` frustum maths (asserted against numbers recomputed from
  `get_view` + `field_of_view`), and the inline line editor that flips the
  event mask.
* **`command.py`** — the generic command introspector, which is the best
  existing proof that the generic panel contract needs no per-wizard code.
* **The 16 builder wizards** — `packages/engine/modules/pmg_qt/builder.py` cannot be imported
  at all in this stack (no Qt), so the useful claim is that WP-17's Qt-free
  port pushes ordinary `Wizard` objects onto the same C++ stack and this area's
  generic protocol drives them with zero builder-specific code.

SHARED STATE.  One PyMOL serves the whole suite.  The ``wf`` fixture saves and
restores everything these wizards touch globally: the camera (``cmd.load`` of a
.pse restores the saved view; `nucmutagenesis` calls ``center(animate=1)``),
``button_mode`` (``charge`` enters edit mode at construction) and
``mouse_selection_mode`` (forced to 1 by `nucmutagenesis.get_panel`, to 0 by
`label`).  It also empties the wizard stack at both ends, because a wizard left
on the stack silently changes what the next test's ``wizards.*`` call sees.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_wf_wizards.py -q
"""

from __future__ import annotations

import math
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels.builder import BOOTSTRAP_COMMAND  # noqa: E402

# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def wf(ws):
    """A clean wizard stack, with every global these wizards move restored."""
    ws.call("wizards.dismiss", all=True)
    ws.call("cmd.unpick")
    view = ws.call("cmd.get_view")
    button_mode = ws.call("cmd.get_setting_int", "button_mode")
    selection_mode = ws.call("cmd.get_setting_int", "mouse_selection_mode")
    yield ws
    ws.call("wizards.dismiss", all=True)
    ws.call("cmd.unpick")
    ws.call("cmd.deselect")
    ws.call("cmd.delete", "all")
    ws.call("cmd.set", "button_mode", button_mode)
    ws.call("cmd.set", "mouse_selection_mode", selection_mode)
    ws.call("cmd.set_view", view)


def tagged(ws, tag, statement, wait=1.2):
    """Run a Python statement server-side and return the tagged output lines.

    The dispatcher only invokes CALLABLES, so an *attribute* like
    ``wiz.session`` or ``pymol.session.wizard_storage`` is unreachable through
    ``{t:'call'}``.  ``{t:'do'}`` + a tagged ``print`` is how it is read.  The
    echo line PyMOL prints before running the command carries the tag too, so
    it has to be dropped.
    """
    before = len(ws.feedback)
    ws.do(statement)
    ws.pump_frames(wait)
    lines = [
        line
        for line in ws.feedback[before:]
        if tag in line and not line.startswith("PyMOL>")
    ]
    assert lines, "no %s line in %r" % (tag, ws.feedback[before:])
    return lines


# ===========================================================================
# ROW 365 — session persistence of wizards
# ===========================================================================


def test_a_pse_round_trip_restores_the_whole_stack_and_the_wizard_substate(
    wf, tmp_path
):
    """`wizarding.py:176-196`: the stack is pickled into `session['wizard']`."""
    ws = wf
    ws.call("wizards.launch", "label")
    ws.call("wizards.exec_code", "cmd.get_wizard().toggle_messages()")
    ws.call("wizards.launch", "message", ["a note from before the save"])
    assert ws.call("wizards.probe")["depth"] == 2

    path = str(tmp_path / "wf_stack.pse")
    ws.call("cmd.save", path)
    ws.call("wizards.dismiss", all=True)
    assert ws.call("wizards.probe")["depth"] == 0
    empty_version = ws.call("wizards.probe")["version"]

    ws.call("cmd.load", path)

    probe = ws.call("wizards.probe")
    assert probe["depth"] == 2
    assert probe["cls"] == "Message"
    # `session_restore_wizard` reaches the stack through `set_wizard_stack`,
    # which `panels/wizards.py` wraps -- that bump IS the `wizard.changed`
    # signal the client polls for at 6 Hz.  Without it the restored panel would
    # never be pulled.
    assert probe["version"] > empty_version

    snap = ws.call("wizards.snapshot")
    assert [entry["cls"] for entry in snap["stack"]] == ["Label", "Message"]
    assert snap["prompt"] == ["a note from before the save"]

    # Pop the Message: the Label underneath came back with its INSTANCE state,
    # not the class default (`Label.messages = 1`, `label.py:12`).
    ws.call("wizards.dismiss")
    panel = ws.call("wizards.snapshot")["panel"]
    assert panel[2]["text"] == "Messages: Off"

    # The restored object is LIVE: a panel code runs against it and changes it.
    # (It is `Wizard.__init__` re-run through `__reduce__` that supplies
    # `wiz.cmd`, NOT `session_restore_wizard`'s reattachment -- measured, see
    # `test_the_restored_wizard_gets_cmd_from_its_constructor_not_the_restore`.)
    ws.call("wizards.exec_code", "cmd.get_wizard().toggle_messages()")
    assert ws.call("wizards.snapshot")["panel"][2]["text"] == "Messages: On"


def test_the_stack_is_stored_as_an_opaque_double_pickle(wf):
    """`session['wizard'] = cPickle.dumps(stack, 1)` -- bytes, not a dict."""
    ws = wf
    ws.subscribe("feedback")
    ws.call("wizards.launch", "label")
    line = tagged(
        ws,
        "WFPICKLE",
        "print('WFPICKLE', type(cmd.get_session()['wizard']).__name__, "
        "len(cmd.get_session()['wizard']))",
    )[0]
    _, kind, length = line.split()
    assert kind == "bytes"
    # A few hundred bytes; the exact count is NOT a constant (772 for a Label
    # in a clean process, 769 mid-suite) because the pickle carries the
    # wizard's own `__dict__`, including whatever is in its per-class
    # `self.session` at the time.
    assert int(length) > 100


def test_the_restored_wizard_gets_cmd_from_its_constructor_not_the_restore(wf):
    """A correction, measured: `session_restore_wizard`'s `wiz.cmd = _self` is
    redundant for the singleton.

    `Wizard.__getstate__` strips `cmd`, but `__reduce__` (`wizard/__init__.py:33`)
    reconstructs through `cls()`, and `Wizard.__init__` sets `self.cmd = _self`
    (default `pymol.cmd`) BEFORE the default `__dict__.update` runs.  So an
    unpickle that never goes near `session_restore_wizard` already has a live
    `cmd` -- which is why the panel code in the round-trip test above cannot be
    used as evidence that the reattachment happened.
    """
    ws = wf
    ws.subscribe("feedback")
    ws.call("wizards.launch", "label")
    line = tagged(
        ws,
        "WFRAWCMD",
        "print('WFRAWCMD', [(hasattr(w, 'cmd'), getattr(w, 'cmd', None) is cmd)"
        " for w in __import__('chempy.io', fromlist=['pkl'])"
        ".pkl.fromString(cmd.get_session()['wizard'])])",
    )[0]
    assert line.endswith("[(True, True)]")


@pytest.mark.parametrize(
    "name",
    [
        "annotation",
        "appearance",
        "box",
        "charge",
        "command",
        "label",
        "measurement",
        "message",
        "mutagenesis",
        "nucmutagenesis",
        "pair_fit",
        "pseudoatom",
        "toggle",
    ],
)
def test_a_bundled_wizard_survives_a_pse_round_trip(wf, tmp_path, name):
    """No bundled wizard is un-picklable, including the awkward ones.

    `toggle.py` never calls `Wizard.__init__`, so it has no `self.cmd`,
    `self.menu` or `self.session` at all; `command.py:14-17` has to clear its
    `shortcut` dict in `__getstate__` because it holds live callables.  Both
    still round trip.

    Deliberately NOT in this list, though all of them were measured to round
    trip too: `density` and `filter` (they rebind pgup/pgdn/F1-F3 through
    `cmd.set_key`), `sculpting` (rewrites sculpting settings and edit mode),
    `dragging` (rewrites `button_mode`, and its `cleanup` raises in this tree),
    `security`, `demo`, `benchmark`.  Their constructors move global state that
    the rest of the suite reads.
    """
    ws = wf
    ws.call("wizards.launch", name)
    expected = ws.call("wizards.probe")["cls"]

    path = str(tmp_path / ("wf_%s.pse" % name))
    ws.call("cmd.save", path)
    ws.call("wizards.dismiss", all=True)
    ws.call("cmd.load", path)

    probe = ws.call("wizards.probe")
    assert probe["depth"] == 1
    assert probe["cls"] == expected
    # ... and the restored object answers the protocol, not just exists.
    snap = ws.call("wizards.snapshot")
    assert snap["errors"] == []
    assert "get_panel" in snap["methods"]


def test_a_restore_orphans_the_per_class_wizard_storage(wf, tmp_path):
    """MEASURED DIVERGENCE, not a bridge defect.

    `Wizard._validate_instance` (`wizard/__init__.py:39-47`) makes `self.session`
    BE the dict in `pymol.session.wizard_storage[str(cls)]`, so anything a
    wizard writes there outlives the wizard -- `measurement.py:209-210` stores
    `default_mode` that way.  `__reduce__` (`:33-34`) reconstructs through
    `cls()`, which re-runs `_validate_instance`, and then the default unpickle
    `__dict__.update` REPLACES `self.session` with the pickled dict, which is
    never written back to `wizard_storage`.  After a session load the two are
    different objects: whatever the restored wizard writes is invisible to the
    next wizard of that class.
    """
    ws = wf
    ws.subscribe("feedback")
    probe_expr = (
        "print('%s', cmd.get_wizard().session is "
        "__import__('pymol').session.wizard_storage[str(type(cmd.get_wizard()))])"
    )

    ws.call("wizards.launch", "label")
    assert tagged(ws, "WFSTORE1", probe_expr % "WFSTORE1")[0].split()[-1] == "True"

    path = str(tmp_path / "wf_storage.pse")
    ws.call("cmd.save", path)
    ws.call("wizards.dismiss", all=True)
    ws.call("cmd.load", path)

    assert tagged(ws, "WFSTORE2", probe_expr % "WFSTORE2")[0].split()[-1] == "False"

    # ... and that identity split is LOSSY, not cosmetic: what the restored
    # wizard writes into its per-class storage is invisible to the next wizard
    # of the same class, because `wizard_storage[key]` still points at the
    # pre-load dict.
    ws.do("cmd.get_wizard().session['wf_probe'] = 'written-after-load'")
    ws.call("wizards.dismiss", all=True)
    ws.call("wizards.launch", "label")
    line = tagged(
        ws, "WFSTORE3", "print('WFSTORE3', cmd.get_wizard().session.get('wf_probe'))"
    )[0]
    assert line.split()[-1] == "None"


# ===========================================================================
# ROW 368 — Mutagenesis (nucleic acid) wizard
# ===========================================================================

#: `nucmutagenesis.py:31-34` -- the purine chi torsion.
CHI = ("name O4'", "name C1'", "name N9", "name C4")


def chi_of(ws, selection):
    return ws.call(
        "cmd.get_dihedral", *["(%s) & %s" % (selection, atom) for atom in CHI]
    )


def test_nucleic_panel_menus_prompt_and_mask(wf):
    ws = wf
    ws.call("wizards.launch", "nucmutagenesis")
    snap = ws.call("wizards.snapshot")

    assert snap["cls"] == "Nucmutagenesis"
    # nucmutagenesis.py:147-161 -- 7 rows: title, 3 popups, 3 buttons.
    assert [row["kind"] for row in snap["panel"]] == [
        "text",
        "popup",
        "popup",
        "popup",
        "button",
        "button",
        "button",
    ]
    assert [row["text"] for row in snap["panel"]] == [
        "Mutagenesis",
        "Mutate to Adenine",
        "Auto Center: ON",
        "Show Lines",
        "Apply",
        "Clear",
        "Done",
    ]
    assert snap["eventMask"] == 1 + 2  # the base default; no state/scene hooks
    assert snap["prompt"] == ["Pick a nucleotide position..."]  # Status.NO_SELECTION

    modes = [i["text"] for i in ws.call("wizards.menu", "mode")["items"]]
    assert modes == ["Mutant", "Adenine", "Cytosine", "Guanine", "Thymine", "Uracil"]
    centers = [i["text"] for i in ws.call("wizards.menu", "auto_center")["items"]]
    assert centers == ["Auto Center", "ON", "OFF"]
    reps = [i["text"] for i in ws.call("wizards.menu", "rep")["items"]]
    assert reps == ["Representation", "Show Lines", "Show Sticks", "Show Spheres",
                    "Show Dots"]

    # get_panel FORCES mouse_selection_mode=1 (nucmutagenesis.py:147-148) --
    # the reason `wizards.snapshot` must never be polled speculatively.
    assert ws.call("cmd.get_setting_int", "mouse_selection_mode") == 1


def test_a_pick_delegates_to_do_select_byres_and_builds_the_preview(wf):
    """`do_pick` -> `do_select('byres pk1')` -> `_do_mutation` (`:163-176`)."""
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("wizards.launch", "nucmutagenesis")
    ws.call("cmd.fragment", "atp", "nuc")

    result = ws.call("wizards.event", "pick", selection="nuc and name C1'")
    assert result["dispatched"] is True
    assert [call["method"] for call in result["calls"]] == ["do_pick_state", "do_pick"]
    # nucmutagenesis has no do_pick_state; the bridge probes and moves on.
    assert result["calls"][0]["present"] is False

    # `byres pk1` selected the whole ATP residue, not the clicked atom.
    assert ws.call("cmd.count_atoms", "_mutate_sel") == 47
    assert ws.call("cmd.count_atoms", "nuc") == 47

    # The preview fragment keeps ONLY the base: `_do_mutation` removes every
    # name in `_sugar_phos_atoms` after the pair_fit (`:296-297`).
    names = sorted({a["name"] for a in ws.call("cmd.get_model", "_tmp_mut")["atom"]})
    assert names == ["C2", "C4", "C5", "C6", "C8", "H2", "H8", "HN61", "HN62",
                     "N1", "N3", "N6", "N7", "N9"]

    # Status.MUTAGENIZING: the prompt now names the residue it will replace.
    prompt = ws.call("wizards.snapshot")["prompt"][0]
    assert prompt.startswith("Select a nucleotide for nuc///ATP`0")


@pytest.mark.parametrize("angle", [-155.0, 70.0])
def test_apply_transfers_the_source_chi_onto_the_new_base(wf, angle):
    """`_transfer_dihedral` (`:225-238`) is what keeps the base in register.

    Two very different source torsions are driven through the same mutation; if
    the transfer did not happen the fused base would land on GTP's own stored
    chi -- one fixed number -- and could not track both.
    """
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("wizards.launch", "nucmutagenesis")
    ws.call("cmd.fragment", "atp", "nuc")
    ws.call("cmd.set_dihedral", *["nuc & %s" % atom for atom in CHI], angle)
    before = chi_of(ws, "nuc")
    assert before == pytest.approx(angle, abs=0.01)

    ws.call("wizards.event", "pick", selection="nuc and name C1'")
    ws.call("wizards.exec_code", 'cmd.get_wizard().set_mode("Guanine")')
    ws.call("wizards.exec_code", "cmd.get_wizard().apply()")

    after = chi_of(ws, "nuc")
    # `cmd.fuse(..., 1)` re-idealises the new bond, so this is not exact; it is
    # within a handful of degrees of the source, which is the whole point.
    assert after == pytest.approx(before, abs=8.0)


def test_apply_fuses_the_base_and_rewrites_resn(wf):
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("wizards.launch", "nucmutagenesis")
    ws.call("cmd.fragment", "atp", "nuc")
    ws.subscribe("feedback")

    ws.call("wizards.event", "pick", selection="nuc and name C1'")
    ws.call("wizards.exec_code", 'cmd.get_wizard().set_mode("Guanine")')
    ws.call("wizards.exec_code", "cmd.get_wizard().apply()")

    # `_base3_to_1['gtp'] = 'g'`, and O2' is present, so NO `D` prefix (:412-421).
    line = tagged(ws, "WFRESN", "iterate nuc and name C1', print('WFRESN', resn)")[0]
    assert line.split()[-1] == "G"
    # The base really came across: N9/C8/N7 are adenine+guanine, O6/N2 are only
    # guanine, and the source ATP had neither.
    assert ws.call("cmd.count_atoms", "nuc and name O6") == 1
    assert ws.call("cmd.count_atoms", "nuc and name N2") == 1
    # apply() resets the wizard to NO_SELECTION (`clear()`, `:301-311`).
    assert ws.call("wizards.snapshot")["prompt"] == ["Pick a nucleotide position..."]


def test_apply_prefixes_D_when_the_ribose_2_prime_oxygen_is_absent(wf):
    """`nucmutagenesis.py:414-417` -- the DNA/RNA discriminator."""
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("wizards.launch", "nucmutagenesis")
    ws.call("cmd.fragment", "atp", "nuc")
    ws.call("cmd.remove", "nuc and name O2'+HO2'")
    ws.subscribe("feedback")

    ws.call("wizards.event", "pick", selection="nuc and name C1'")
    ws.call("wizards.exec_code", 'cmd.get_wizard().set_auto_center("OFF")')
    assert ws.call("wizards.snapshot")["panel"][2]["text"] == "Auto Center: OFF"

    ws.call("wizards.exec_code", 'cmd.get_wizard().set_mode("Thymine")')
    ws.call("wizards.exec_code", "cmd.get_wizard().apply()")

    line = tagged(ws, "WFDNA", "iterate nuc and name C1', print('WFDNA', resn)")[0]
    assert line.split()[-1] == "DT"


def test_a_non_nucleic_pick_is_refused_and_the_status_does_not_move(wf):
    """`_do_mutation` raises `WizardError`, `do_select` catches and prints."""
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala", "prot")
    ws.call("wizards.launch", "nucmutagenesis")
    ws.subscribe("feedback")

    before = len(ws.feedback)
    result = ws.call("wizards.event", "pick", selection="prot and name CA")
    ws.pump_frames(1.2)
    assert result["dispatched"] is True
    assert any(
        "Improper selection of nucleic acid." in line for line in ws.feedback[before:]
    )
    # Still NO_SELECTION, and no preview object was left behind.
    assert ws.call("wizards.snapshot")["prompt"] == ["Pick a nucleotide position..."]
    assert "_tmp_mut" not in ws.call("cmd.get_names", "all")


def test_the_nucleic_wizard_refuses_to_open_during_a_movie(wf):
    """`__init__` raises `WizardError`, which `_wizard()` turns into a Message."""
    ws = wf
    try:
        ws.call("cmd.mset", "1 x10")
        assert ws.call("cmd.get_movie_length") == 10
        ws.call("wizards.launch", "nucmutagenesis")
        snap = ws.call("wizards.snapshot")
        # wizarding.py:50-52 -- WizardError becomes a Message wizard, not an
        # exception, so the client sees the reason instead of an empty panel.
        assert snap["cls"] == "Message"
        assert snap["prompt"] == ["Error: Mutagenesis Wizard cannot be used with Movie"]
        assert [row["text"] for row in snap["panel"]] == ["Message", "Dismiss"]
    finally:
        ws.call("cmd.mset")
        assert ws.call("cmd.get_movie_length") == 0


# ===========================================================================
# ROW 379 — Box wizard (CGO box + inline text entry)
# ===========================================================================

#: A camera with an identity rotation, a distinct origin and non-default
#: clipping planes, so `auto_position`'s arithmetic cannot be right by accident.
BOX_VIEW = [
    1.0, 0.0, 0.0,
    0.0, 1.0, 0.0,
    0.0, 0.0, 1.0,
    0.0, 0.0, -60.0,
    1.0, 2.0, 3.0,
    30.0, 90.0, -20.0,
]


def test_box_panel_mode_menu_and_the_two_objects_it_creates(wf):
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("wizards.launch", "box")
    snap = ws.call("wizards.snapshot")

    # box.py:384-395 -- 8 rows: title, mode popup, 6 buttons.
    assert [row["text"] for row in snap["panel"]] == [
        "Box Wizard",
        "Box",
        "Change Name",
        "Copy Box",
        "Toggle Points",
        "Auto-Position (50%)",
        "Auto-Position (99%)",
        "Done",
    ]
    assert snap["panel"][1]["code"] == "mode"
    assert snap["panel"][3]["code"] == "cmd.get_wizard().edit_name(copying=1)"
    # box.py:397-403 -- ALWAYS listens for scene, even when not renaming.
    assert snap["eventMask"] == 1 + 2 + 16
    assert snap["prompt"] == []  # get_prompt returns [] outside the editor

    modes = [i["text"] for i in ws.call("wizards.menu", "mode")["items"]]
    assert modes == ["Box Mode", "Box", "Walls", "Plane", "Quad"]

    # The wizard builds a 4-atom pseudo-atom object plus the CGO it drives.
    assert sorted(ws.call("cmd.get_names", "all")) == ["box", "box_points"]
    assert ws.call("cmd.get_type", "box") == "object:cgo"
    assert ws.call("cmd.get_type", "box_points") == "object:molecule"
    assert ws.call("cmd.count_atoms", "box_points") == 4


#: Wrap the live wizard's ``update_box`` in a counter on ``pymol.stored``.
#: Counting rebuilds is the only way to tell "did not rebuild" from "rebuilt
#: the identical box": the CGO geometry is a pure function of the four
#: pseudo-atoms, so comparing extents cannot see a redundant rebuild.
REBUILD_COUNTER = (
    'exec("w = cmd.get_wizard()\\n'
    "stored.wf_box_rebuilds = 0\\n"
    "orig = w.update_box\\n"
    "def counted(*a, **k):\\n"
    "    stored.wf_box_rebuilds += 1\\n"
    "    return orig(*a, **k)\\n"
    'w.update_box = counted")'
)


def rebuilds(ws):
    return int(
        tagged(ws, "WFREBUILD", "print('WFREBUILD', stored.wf_box_rebuilds)")[0]
        .split()[-1]
    )


def test_do_scene_diffs_the_pseudoatoms_and_rebuilds_the_cgo(wf):
    """`box.py:405-418` -- the drag-the-corner round trip, measured.

    This is the row's "dragging the pseudo-atoms is an editor interaction that
    must round-trip so do_scene fires": moving one corner and firing the scene
    event through the generic `wizards.event` really re-emits the CGO.

    NOTHING HERE MAY DEPEND ON TIMING.  The C core fires `do_scene` on its own
    once the pump draws (`Scene.cpp:4812` inside `SceneUpdate`, reached from
    `Executive.cpp:11554` on every draw) -- measured at 21-29 ms after the
    atoms move, see
    `test_the_core_fires_do_scene_by_itself_with_no_client_event`.  An earlier
    version of this test asserted "the CGO has not moved yet" one round trip
    after `alter_state`; that held only because the round trip took 0.7 ms, and
    it was a race against a ~25 ms deadline.
    """
    ws = wf
    ws.subscribe("feedback")
    ws.call("cmd.delete", "all")
    ws.call("cmd.set_view", BOX_VIEW)
    ws.call("wizards.launch", "box")
    ws.do(REBUILD_COUNTER)

    before = ws.call("cmd.get_extent", "box")
    ws.call("cmd.alter_state", 1, "box_points`4", "z = z + 12.0")

    result = ws.call("wizards.event", "scene")
    assert result["dispatched"] is True
    assert result["calls"][0]["method"] == "do_scene"

    after = ws.call("cmd.get_extent", "box")
    assert after[1][2] == pytest.approx(before[1][2] + 12.0, abs=1e-3)
    assert after[0] == pytest.approx(before[0], abs=1e-3)

    # ... and the four-coordinate diff really IS a diff: two more scene events
    # with nothing moved do not rebuild anything at all.
    settled = rebuilds(ws)
    ws.call("wizards.event", "scene")
    ws.call("wizards.event", "scene")
    assert rebuilds(ws) == settled
    assert ws.call("cmd.get_extent", "box") == after


def test_the_core_fires_do_scene_by_itself_with_no_client_event(wf, gl_bridge):
    """MEASURED, and it corrects the wave-4 note on the scene-dispatch row.

    `SceneUpdate` calls `WizardDoScene` (`packages/engine/layer1/Scene.cpp:4812`) and every
    draw calls `SceneUpdate` + `WizardUpdate` (`packages/engine/layer3/Executive.cpp:11554`).
    The bridge runs a real render pump, so `box.do_scene` fires server-side
    with **no** `wizards.event('scene')` from the browser: moving a pseudo-atom
    and then doing nothing at all rebuilt the CGO in 21, 29 and 21 ms over
    three trials here.  A browser-side drag therefore round-trips even if the
    client never sends the event; sending it only makes the rebuild immediate.

    Gated on `gl_bridge` because it is the DRAW that carries it: with no
    offscreen context there is no `ExecutiveDraw`, hence no `WizardUpdate`.
    """
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("cmd.set_view", BOX_VIEW)
    ws.call("wizards.launch", "box")
    time.sleep(0.5)  # let the launch-time do_scene settle

    before = ws.call("cmd.get_extent", "box")
    ws.call("cmd.alter_state", 1, "box_points`4", "z = z + 12.0")

    deadline = time.monotonic() + 10.0
    after = before
    while time.monotonic() < deadline:
        after = ws.call("cmd.get_extent", "box")
        if after != before:
            break
        time.sleep(0.02)

    assert after[1][2] == pytest.approx(before[1][2] + 12.0, abs=1e-3), (
        "the core never rebuilt the CGO on its own within 10 s"
    )


#: The same camera turned 90 degrees about z.  With the identity rotation the
#: model-space transform in `box.py:127-140` is a no-op and the frustum maths
#: could be transposed, mirrored or skipped entirely without showing; this one
#: is antisymmetric, so it pins the matrix orientation too.
BOX_VIEW_TURNED = [
    0.0, 1.0, 0.0,
    -1.0, 0.0, 0.0,
    0.0, 0.0, 1.0,
] + BOX_VIEW[9:]


@pytest.mark.parametrize("view", [BOX_VIEW, BOX_VIEW_TURNED], ids=["identity", "turned"])
def test_auto_position_is_computed_from_field_of_view_and_get_view(wf, view):
    """`box.py:104-149` -- recomputed here from the two live inputs."""
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("cmd.set_view", view)
    # The expectation below is written against `view`, so a camera that is
    # still MOVING (a `center(animate=1)` left in flight by another test) would
    # show up as an unexplained one-coordinate mismatch.  Fail loudly instead.
    assert ws.call("cmd.get_view") == pytest.approx(view, abs=1e-4)
    ws.call("wizards.launch", "box")
    fov = ws.call("cmd.get_setting_float", "field_of_view")

    ws.call("wizards.exec_code", "cmd.get_wizard().auto_position(0.99)")
    coords = [a["coord"] for a in ws.call("cmd.get_model", "box_points")["atom"]]

    fract, size = 0.99, 1.0
    near, far, z_off = view[15], view[16], view[11]
    origin = view[12:15]
    tan_half_fov = math.tan(math.pi * fov / 360.0)
    far_mix = (1.0 - fract) * near + fract * far
    near_mix = fract * near + (1.0 - fract) * far
    plane_size = size * far_mix * tan_half_fov
    z1 = -(z_off + far_mix)
    z2 = -(z_off + near_mix)
    plane = [
        [-plane_size, -plane_size, z1],
        [-plane_size, plane_size, z1],
        [plane_size, -plane_size, z1],
        [-plane_size, -plane_size, z2],
    ]
    expected = [
        [
            view[0] * p[0] + view[1] * p[1] + view[2] * p[2] + origin[0],
            view[3] * p[0] + view[4] * p[1] + view[5] * p[2] + origin[1],
            view[6] * p[0] + view[7] * p[1] + view[8] * p[2] + origin[2],
        ]
        for p in plane
    ]

    for got, want in zip(coords, expected):
        assert got == pytest.approx(want, abs=1e-3)
    # And the numbers are not degenerate: fov 20 deg, near 30, far 90.
    assert plane_size == pytest.approx(15.763632, abs=1e-4)
    assert [round(p[2], 3) for p in expected] == [-26.4, -26.4, -26.4, 32.4]


def test_edit_name_adds_the_key_bit_and_runs_the_hand_rolled_line_editor(wf):
    """`box.py:85-89`, `:397-403`, `:421-437` -- the inline text entry.

    The event mask is the ONLY thing that tells the client to grab the
    keyboard, and here it changes with wizard sub-state rather than with the
    wizard's identity -- which is why `<WizardKeyCapture/>` is mask-gated.
    """
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("cmd.set_view", BOX_VIEW)
    ws.call("wizards.launch", "box")
    assert ws.call("wizards.snapshot")["eventMask"] == 19

    # Drag a corner first, so the rename can be asked what happened to it.
    ws.call("cmd.alter_state", 1, "box_points`4", "z = z + 12.0")
    ws.call("wizards.event", "scene")
    dragged = [a["coord"] for a in ws.call("cmd.get_model", "box_points")["atom"]]

    ws.call("wizards.exec_code", "cmd.get_wizard().edit_name()")
    snap = ws.call("wizards.snapshot")
    assert snap["eventMask"] == 19 + 4  # pick|select|scene|KEY
    assert snap["prompt"] == ["Enter box name: "]

    for char in "cage":
        assert ws.call("wizards.event", "key", k=ord(char))["dispatched"] is True
    assert ws.call("wizards.snapshot")["prompt"] == ["Enter box name: cage"]

    ws.call("wizards.event", "key", k=8)  # backspace
    assert ws.call("wizards.snapshot")["prompt"] == ["Enter box name: cag"]

    ws.call("wizards.event", "key", k=13)  # enter -> set_name + update_box
    after = ws.call("wizards.snapshot")
    assert after["eventMask"] == 19  # the key bit is dropped again
    assert after["prompt"] == []
    names = ws.call("cmd.get_names", "all")
    assert "cag" in names and "cag_points" in names
    assert ws.call("cmd.get_type", "cag") == "object:cgo"

    # MEASURED DIVERGENCE, three parts, all of them upstream `box.py:152-171`:
    #
    # 1. the old CGO is ORPHANED -- `set_name` renames only the pseudo-atom
    #    object, so `box` stays in the object list forever;
    # 2. so is the old pseudo-atom object, parked under the leading-underscore
    #    name `_box`, which `get_names()` hides but `get_names('all')` shows;
    # 3. and the rename LOSES THE BOX: the code looks for `_<new name>` to
    #    restore, never `_<old name>`, so `cag_points` is built fresh from
    #    `pseudo_atoms` + `auto_position(0.75, 0.5)` and the dragged corner is
    #    gone.  Only `Copy Box` (`edit_name(copying=1)`) carries geometry over.
    assert "box" in names
    assert "_box" in names
    assert "_box" not in ws.call("cmd.get_names")
    renamed = [a["coord"] for a in ws.call("cmd.get_model", "cag_points")["atom"]]
    assert renamed[3][2] != pytest.approx(dragged[3][2], abs=1e-3)
    assert ws.call("cmd.get_extent", "box") != ws.call("cmd.get_extent", "cag")


def test_box_do_pick_is_an_explicit_no_op(wf):
    """`box.py:419-420` -- present, dispatched, and deliberately does nothing."""
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("wizards.launch", "box")
    extent = ws.call("cmd.get_extent", "box")

    result = ws.call("wizards.event", "pick", selection="ala and name CA")
    assert result["dispatched"] is True
    pick = [call for call in result["calls"] if call["method"] == "do_pick"][0]
    assert pick["present"] is True
    assert pick["error"] is None
    assert pick["result"] is None
    assert ws.call("cmd.get_extent", "box") == extent


# ===========================================================================
# ROW 380 — Command wizard (generic command introspector)
# ===========================================================================


def stored_name(ws):
    """The `stored._wizardN` handle the wizard put its own panel codes on."""
    code = ws.call("wizards.snapshot")["panel"][-2]["code"]
    assert code.startswith("stored._wizard")
    return code.split(".")[1]


def test_command_wizard_chooser_shape_and_the_commands_magic_tag(wf):
    ws = wf
    ws.call("wizards.launch", "command")
    snap = ws.call("wizards.snapshot")

    # command.py:119-123 -- panel shape 1 of 3.
    assert [row["kind"] for row in snap["panel"]] == ["popup", "button"]
    assert snap["panel"][0]["text"] == "Select a command..."
    assert snap["panel"][0]["code"] == "_commands"
    # command.py:149-152 -- no events at all unless text is being entered.
    assert snap["eventMask"] == 0
    assert snap["prompt"] == []

    items = ws.call("wizards.menu", "_commands")["items"]
    labels = [item["text"] for item in items]
    assert len(labels) > 250
    assert "color" in labels and "fragment" in labels
    # `get_command_keywords()` includes the Python statement keywords, mapped to
    # `helping.python_help`; command.py:88-96 filters exactly those out.
    assert not ({"import", "def", "class", "for", "if", "exec"} & set(labels))
    assert not any(label.startswith("_") for label in labels)
    # The leaf command drives the wizard through its own `stored` handle.
    color = next(item for item in items if item["text"] == "color")
    assert color["command"].endswith(".set_command('color')")


def test_one_popup_row_per_positional_or_keyword_arg_skipping_underscore_and_quiet(wf):
    """`command.py:47-66` -- `inspect.signature`, verbatim."""
    ws = wf
    # `png(filename, width=0, height=0, dpi=-1.0, ray=0, quiet=1, prior=0,
    #      format=0, *, _self=cmd)`
    ws.call("wizards.launch", "command", ["png"])
    rows = [row["text"] for row in ws.call("wizards.snapshot")["panel"]]
    assert rows == [
        "Png Wizard",
        "filename: ",
        "width: 0",
        "height: 0",
        "dpi: -1.0",
        "ray: 0",
        "prior: 0",
        "format: 0",
        "Run",
        "Done",
    ]
    assert "quiet" not in " ".join(rows)  # `ignored_args`
    assert "_self" not in " ".join(rows)  # `_`-prefixed

    # `pair_fit(*args, **kwargs)`: the first non POSITIONAL_OR_KEYWORD
    # parameter BREAKS the loop, so the panel has no argument rows at all.
    ws.call("wizards.dismiss", all=True)
    ws.call("wizards.launch", "command", ["pair_fit"])
    assert [row["text"] for row in ws.call("wizards.snapshot")["panel"]] == [
        "Pair_Fit Wizard",
        "Run",
        "Done",
    ]


def test_an_argument_menu_splices_live_auto_arg_completions(wf):
    """`get_menu` (`command.py:98-104`) calls the shortcut and takes 20."""
    ws = wf
    ws.call("wizards.launch", "command", ["color"])
    handle = stored_name(ws)
    items = ws.call("wizards.menu", "color")["items"]

    assert items[0]["kind"] == "title" and items[0]["text"] == "Color"
    values = [i["text"] for i in items if i["kind"] == "item"]
    assert "red" in values and "white" in values
    assert len([i for i in items if i["kind"] == "item"]) <= 21  # 20 + "Enter value..."
    assert items[-2]["kind"] == "separator"
    assert items[-1]["command"] == 'stored.%s.set_input_arg("color")' % handle
    # The leaf writes back through the wizard, and the panel label follows.
    ws.call("wizards.exec_code", "stored.%s.set_current('color', 'red')" % handle)
    assert ws.call("wizards.snapshot")["panel"][1]["text"] == "color: red"


def test_text_entry_mode_is_the_third_panel_shape_and_filters_numerics(wf):
    ws = wf
    ws.call("wizards.launch", "command", ["color"])
    handle = stored_name(ws)

    ws.call("wizards.exec_code", "stored.%s.set_input_arg('selection')" % handle)
    snap = ws.call("wizards.snapshot")
    # command.py:125-130 -- panel shape 2 of 3.
    assert [row["text"] for row in snap["panel"]] == ["Input", "Apply", "Cancel "]
    assert snap["eventMask"] == 4  # key only, while and only while inputting
    assert snap["prompt"] == [
        "Please enter value for \\999selection\\---: \\990(all)"
    ]

    for _ in range(5):
        ws.call("wizards.event", "key", k=127)  # clear "(all)"
    for char in "ala":
        ws.call("wizards.event", "key", k=ord(char))
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Please enter value for \\999selection\\---: \\990ala"
    ]
    ws.call("wizards.event", "key", k=13)  # enter -> apply_input
    assert ws.call("wizards.snapshot")["panel"][2]["text"] == "selection: ala"

    # numeric=True: letters are rejected, digits and '.' pass (command.py:171).
    ws.call("wizards.exec_code",
            "stored.%s.set_input_arg('flags', numeric=True)" % handle)
    for _ in range(3):
        ws.call("wizards.event", "key", k=127)
    for char in "1a2.5":
        ws.call("wizards.event", "key", k=ord(char))
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Please enter value for \\999flags\\---: \\99012.5"
    ]
    ws.call("wizards.event", "key", k=27)  # escape -> back to the normal panel
    assert ws.call("wizards.snapshot")["panel"][0]["text"] == "Color Wizard"
    assert ws.call("wizards.snapshot")["eventMask"] == 0


def test_run_goes_through_cmd_async_and_really_runs_the_command(wf):
    """`command.py:108-112`; `commanding.py:900-935` is what `async_` does."""
    ws = wf
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.subscribe("feedback")
    ws.call("wizards.launch", "command", ["color"])
    handle = stored_name(ws)
    ws.call("wizards.exec_code", "stored.%s.set_current('color', 'blue')" % handle)
    ws.call("wizards.exec_code", "stored.%s.set_current('selection', 'ala')" % handle)

    before = len(ws.feedback)
    ws.call("wizards.exec_code", "stored.%s.run()" % handle)
    ws.pump_frames(2.0)

    # `cmd.async_` PUSHES a dismiss=0 Message wizard while the job runs and pops
    # it in its `finally` -- so a client can see the stack grow and shrink under
    # it with no user action.  The Message echoes its own line on construction
    # (`message.py:18-19`), which is the proof it was pushed.
    assert any("please wait" in line for line in ws.feedback[before:])
    assert ws.call("wizards.probe")["depth"] == 1  # ... and popped again

    line = tagged(ws, "WFCOLOR", "iterate first ala, print('WFCOLOR', color)")[0]
    assert int(line.split()[-1]) == ws.call("cmd.get_color_index", "blue")

    handle2 = tagged(
        ws, "WFASYNC", "print('WFASYNC', cmd.get_wizard().async_)"
    )[0]
    assert handle2.split()[-1] == "1"


def test_the_command_wizard_cleans_its_stored_handle_up(wf):
    """`cleanup()` (`command.py:114-115`) does `delattr(stored, name)`."""
    ws = wf
    ws.subscribe("feedback")
    ws.call("wizards.launch", "command", ["color"])
    handle = stored_name(ws)
    assert tagged(
        ws, "WFSTORED", "print('WFSTORED', hasattr(stored, %r))" % handle
    )[0].split()[-1] == "True"
    ws.call("wizards.dismiss")
    assert tagged(
        ws, "WFSTORED2",
        "print('WFSTORED2', hasattr(stored, %r))" % handle
    )[0].split()[-1] == "False"


# ===========================================================================
# ROW 382 — Builder wizards (cross-area dependency)
# ===========================================================================


def test_the_qt_builder_module_cannot_be_imported_in_this_stack(wf):
    """`pmg_qt/builder.py:8` -> `pymol_gl_widget` -> `pymol.Qt` -> ImportError.

    This is why "port the 16 builder wizards" is not the answer to this row:
    the module that defines them is unreachable without a Qt binding.  WP-17
    re-declared them Qt-free in `tenmol_bridge/panels/builder.py`; the tests
    below prove this area's generic protocol drives THOSE with no extra code.
    """
    ws = wf
    ws.subscribe("feedback")
    line = tagged(
        ws,
        "WFQT",
        'exec("try:\\n import pmg_qt.builder\\n print(\'WFQT ok\')\\n'
        "except Exception as e:\\n print('WFQT', type(e).__name__, e)\")",
    )[0]
    assert line.split()[1:] == ["ImportError", "pymol.Qt"]


@pytest.fixture
def builder(wf):
    """The Qt-free builder installed on `cmd`, with nothing else touched.

    Deliberately NOT calling `cmd.builder_show()`: that mirrors Qt's
    `showEvent` and would set `auto_overlay`, `valence`, `editor_auto_measure`
    and `edit_mode(1)` globally.  Arming a wizard needs none of it.

    The bootstrap binds `cmd.builder_*` onto the shared `cmd` module and
    registers keywords, so it is UNDONE afterwards: WP-17's
    `test_bootstrap_installs_the_rpc_surface` asserts the surface does not
    exist before its own install, and leaving it bound would make that test
    depend on file order.
    """
    ws = wf
    reply = ws.do(BOOTSTRAP_COMMAND)
    assert reply["t"] == "ok", reply
    ws.call("cmd.builder_dismiss")
    ws.call("cmd.delete", "all")
    yield ws
    ws.call("cmd.builder_dismiss")
    ws.do(
        "_ __import__('tenmol_bridge.panels.builder',"
        " fromlist=['uninstall']).uninstall(cmd)"
    )
    assert ws.call_reply("cmd.builder_state")["t"] == "err"


def test_a_builder_wizard_is_just_a_wizard_on_the_same_stack(builder):
    ws = builder
    ws.call("cmd.fragment", "ala", "bw")
    ws.call("cmd.builder_action", "addH")

    probe = ws.call("wizards.probe")
    assert probe["depth"] == 1
    assert probe["cls"] == "HydrogenWizard"
    # The class lives in the bridge, NOT in pymol.wizard -- and the generic
    # protocol neither knows nor cares.
    assert probe["module"] == "tenmol_bridge.panels.builder"

    snap = ws.call("wizards.snapshot")
    assert snap["errors"] == []
    assert [row["kind"] for row in snap["panel"]] == ["text", "button", "button"]
    assert [row["text"] for row in snap["panel"]] == [
        "Adding Hydrogens",
        "Add To Multiple...",
        "Done",
    ]
    assert snap["panel"][-1]["code"] == "cmd.set_wizard()"
    assert snap["prompt"] == ["Pick molecule upon which to add hydrogens..."]
    assert snap["eventMask"] == 1 + 2  # the Wizard base default


def test_the_generic_pick_event_drives_a_builder_wizard_to_completion(builder):
    """The cross-area seam, end to end: WP-17 arms it, WP-16 delivers the pick."""
    ws = builder
    ws.call("cmd.fragment", "ala", "bw")
    ws.call("cmd.remove", "bw and hydro")
    assert ws.call("cmd.count_atoms", "bw") == 5

    ws.call("cmd.builder_action", "addH")
    result = ws.call("wizards.event", "pick", selection="bw and name CA")
    assert result["dispatched"] is True
    assert [call["method"] for call in result["calls"]] == ["do_pick_state", "do_pick"]
    assert result["calls"][1]["error"] is None

    assert ws.call("cmd.count_atoms", "bw") == 12  # h_add ran
    # `actionWizardDone` pops the wizard itself -- a wizard may dismiss itself
    # mid-event, which the client must tolerate (`builder.py:60-64`).
    assert ws.call("wizards.probe")["depth"] == 0


def test_builder_panel_row_codes_execute_through_the_generic_exec(builder):
    ws = builder
    ws.call("cmd.fragment", "ala", "bw")
    ws.call("cmd.builder_action", "addH")

    # `repeat()` is the RepeatableActionWizard vocabulary; the row disappears
    # once repeating, which is a row-count change the renderer must diff.
    ws.call("wizards.exec_code", "cmd.get_wizard().repeat()")
    assert [row["text"] for row in ws.call("wizards.snapshot")["panel"]] == [
        "Adding Hydrogens",
        "Done",
    ]

    ws.call("wizards.exec_code", "cmd.set_wizard()")
    assert ws.call("wizards.probe")["depth"] == 0


@pytest.mark.parametrize(
    "kind,cls,head",
    [
        ("addH", "HydrogenWizard", "Adding Hydrogens"),
        ("invert", "InvertWizard", "Inverting Multiple"),
        ("removeAtom", "RemoveWizard", "Deleting Atoms"),
        ("createBond", "BondWizard", "Creating Multiple Bonds"),
        ("fix", "FixAtomWizard", "Fixed Atoms"),
    ],
)
def test_every_armed_builder_wizard_renders_through_the_generic_panel(
    builder, kind, cls, head
):
    """"They come for free once the generic renderer exists" -- measured."""
    ws = builder
    ws.call("cmd.fragment", "ala", "bw")
    ws.call("cmd.builder_action", kind)
    snap = ws.call("wizards.snapshot")
    assert snap["cls"] == cls
    assert snap["module"] == "tenmol_bridge.panels.builder"
    assert snap["errors"] == []
    assert snap["panel"][0]["text"] == head
    assert snap["panel"][-1]["code"] == "cmd.set_wizard()"
    assert snap["prompt"]


def test_a_live_command_wizard_reloaded_into_itself_loses_its_stored_handle(
    wf, tmp_path
):
    """MEASURED DIVERGENCE (upstream `command.py`), reported not fixed.

    `Command` publishes itself on `pymol.stored` under a generated name and
    puts that name into its own panel codes (`command.py:32-34`).  Unpickling
    goes through `__reduce__` -> `Command()`, which allocates a FRESH name, and
    the default `__dict__.update` then overwrites `stored_name`/`varname` with
    the pickled ones.  When the previous instance is still alive -- i.e. loading
    a .pse without dismissing first, which is exactly what a user does -- the
    old name is still occupied, so the restored panel's `Run`/`Apply` codes
    address the ORPHANED wizard while the panel shows the restored one.

    Dismissing first (which runs `cleanup()`'s `delattr`) frees the name and
    the two line up again, which is why
    `test_a_bundled_wizard_survives_a_pse_round_trip[command]` passes.
    """
    ws = wf
    ws.subscribe("feedback")
    ws.call("wizards.launch", "command", ["color"])
    first = stored_name(ws)
    ws.call("wizards.exec_code", "stored.%s.set_current('color', 'red')" % first)

    path = str(tmp_path / "wf_cmdlive.pse")
    ws.call("cmd.save", path)
    ws.call("cmd.load", path)  # deliberately WITHOUT dismissing

    assert ws.call("wizards.probe")["cls"] == "Command"
    restored = stored_name(ws)
    assert restored == first  # the panel still advertises the OLD handle
    line = tagged(
        ws,
        "WFGHOST",
        "print('WFGHOST', stored.%s is cmd.get_wizard())" % restored,
    )[0]
    assert line.split()[-1] == "False", (
        "if this ever says True, upstream command.py was fixed and this "
        "divergence can be dropped from the inventory"
    )
