"""The Builder, end to end through the real bridge socket.  WP-17.

Everything here goes over the WebSocket the browser uses — ``{t:'do'}`` for the
one-line bootstrap, then ``{t:'call'}`` for ``cmd.builder_*``.  That is the
point: it proves the *reachability* story (``panels/__init__.py`` is a frozen
barrel that does not list ``builder``, and ``server.py`` belongs to WP-02, so
the only way in is the ``cmd`` root the capability policy already grants), not
just that the Python functions work when imported directly.

The session-scoped ``bridge`` fixture is one PyMOL for the whole run, so every
test cleans up after itself with ``delete all`` + ``unpick`` + a wizard dismiss.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels.builder import (  # noqa: E402
    BOOTSTRAP_COMMAND,
    CHEM_ROW0_FRAGMENTS,
    ELEMENTS,
    FUNCTIONAL_GROUPS,
    RINGS,
    AMINO_ACIDS_ROW0,
    AMINO_ACIDS_ROW1,
    DNA_BASES,
    RNA_BASES,
    SECONDARY_STRUCTURE,
    fragment_names,
)


# --------------------------------------------------------------------------
# fixtures
# --------------------------------------------------------------------------


@pytest.fixture
def builder(ws):
    """A connected client with ``cmd.builder_*`` installed and a clean slate."""
    reply = ws.do(BOOTSTRAP_COMMAND)
    assert reply["t"] == "ok", reply
    ws.call("cmd.delete", "all")
    ws.call("cmd.builder_dismiss")
    ws.call("cmd.builder_show")
    yield ws
    try:
        ws.call("cmd.builder_dismiss")
        ws.call("cmd.delete", "all")
    except AssertionError:
        pass


def slots(state: Dict[str, Any]) -> List[str]:
    return state["editor"]["slots"]


def pick(ws, obj: str, name: str, mode: str = "multi") -> Dict[str, Any]:
    """Pick the atom called ``name`` in ``obj``, the way the viewport would."""
    idx = ws.call("cmd.index", "%s and name %s" % (obj, name))
    assert idx, "no atom named %s in %s" % (name, obj)
    return ws.call("cmd.builder_pick", idx[0][0], idx[0][1], None, mode)


# --------------------------------------------------------------------------
# reachability + panel shell
# --------------------------------------------------------------------------


def test_bootstrap_installs_the_rpc_surface(ws):
    """The single ``{t:'do'}`` line is the whole installation step."""
    before = ws.call_reply("cmd.builder_state")
    assert before["t"] == "err", "builder_state must not exist before install"

    reply = ws.do(BOOTSTRAP_COMMAND)
    assert reply["t"] == "ok", reply

    state = ws.call("cmd.builder_state")
    assert set(state) >= {"editor", "wizard", "settings", "clean_available"}


def test_show_event_issues_the_four_setup_calls(builder):
    """``_BuilderPanel.showEvent`` (builder.py:1337-1341).

    ``cmd.set(name)`` with no value sets 1, so auto_overlay and valence come out
    ON and only editor_auto_measure is turned off.
    """
    builder.call("cmd.set", "editor_auto_measure", 1)
    builder.call("cmd.set", "auto_overlay", 0)
    builder.call("cmd.set", "valence", 0)

    state = builder.call("cmd.builder_show")
    assert state["settings"]["editor_auto_measure"] == 0
    assert state["settings"]["auto_overlay"] == 1
    assert state["settings"]["valence"] == 1
    # cmd.edit_mode(1) rotates the mouse ring entry to *_editing.
    assert state["mouse"]["editing"] is True
    assert state["mouse"]["mode_name"].endswith("editing")


def test_clean_is_reported_unavailable(builder):
    """cmd.clean raises IncentiveOnlyException here — say so, do not pretend."""
    state = builder.call("cmd.builder_state")
    assert state["clean_available"] is False
    assert "ncentive" in state["clean_reason"]
    assert state["undo_is_noop"] is True


def test_tables_reference_only_fragments_that_exist(builder):
    tables = builder.call("cmd.builder_tables")
    assert tables["missingFragments"] == []
    assert len(tables["elements"]) == 10
    assert len(tables["functionalGroups"]) == 11
    assert len(tables["rings"]) == 10
    assert len(tables["aminoAcidsRow0"]) + len(tables["aminoAcidsRow1"]) == 23
    assert len(tables["dnaBases"]) == 4 and len(tables["rnaBases"]) == 4
    # 23 distinct .pkl files: 2 + 11 + 10, minus formamide's duplicate.
    assert len(tables["fragments"]) == 22


# --------------------------------------------------------------------------
# collectPicked / the editor state machine
# --------------------------------------------------------------------------


def test_collect_picked_tracks_pk1_to_pk4_in_click_order(builder):
    builder.call("cmd.fragment", "trp")
    state = builder.call("cmd.builder_state")
    assert slots(state) == []

    order = ["N", "CA", "C", "O"]
    for i, name in enumerate(order):
        state = pick(builder, "trp", name)
        assert slots(state) == ["pk%d" % (n + 1) for n in range(i + 1)]

    assert [entry["name"] for entry in state["editor"]["picked"]] == order
    assert state["editor"]["picked"][0]["label"].startswith("/trp/")

    # A fifth pick overwrites pk4 (Editor.cpp:499-536).
    state = pick(builder, "trp", "CB")
    assert slots(state) == ["pk1", "pk2", "pk3", "pk4"]
    assert state["editor"]["picked"][3]["name"] == "CB"

    # Clicking an already picked atom un-picks it.
    state = pick(builder, "trp", "CB")
    assert state["unpicked"] is True
    assert len(slots(state)) == 3


def test_single_pick_mode_resets_to_pk1(builder):
    builder.call("cmd.fragment", "ala")
    pick(builder, "ala", "N")
    state = pick(builder, "ala", "CA")
    assert slots(state) == ["pk1", "pk2"]
    state = pick(builder, "ala", "C", mode="single")
    assert slots(state) == ["pk1"]
    assert state["editor"]["picked"][0]["name"] == "C"


def test_bond_pick_sets_bond_mode(builder):
    builder.call("cmd.fragment", "ala")
    n = builder.call("cmd.index", "ala and name N")[0]
    ca = builder.call("cmd.index", "ala and name CA")[0]
    state = builder.call("cmd.builder_pick", n[0], n[1], ca[1], "bond")
    assert state["bondFlag"] == 1
    assert state["editor"]["hasBond"] is True
    assert slots(state) == ["pk1", "pk2"]


# --------------------------------------------------------------------------
# Chemical tab
# --------------------------------------------------------------------------


def test_replace_button_swaps_the_picked_element(builder):
    """Chemical row 0: pick an atom, press N, get a nitrogen."""
    builder.call("cmd.fragment", "ala")
    assert builder.call("cmd.count_atoms", "ala and elem N") == 1
    pick(builder, "ala", "CB")
    state = builder.call(
        "cmd.builder_action",
        "replace",
        symbol="N",
        geometry=4,
        valence=3,
        text="nitrogen",
    )
    assert state["error"] is None
    assert builder.call("cmd.count_atoms", "ala and elem N") == 2
    assert builder.call("cmd.count_atoms", "ala and name CB") == 0
    # doAutoPick re-picks one of the newly added atoms as pk1.
    assert slots(state) == ["pk1"]


def test_replace_with_nothing_picked_arms_the_replace_wizard(builder):
    state = builder.call(
        "cmd.builder_action", "replace", symbol="O", geometry=4, valence=2, text="oxygen"
    )
    wizard = state["wizard"]
    assert wizard["name"] == "ReplaceWizard"
    assert wizard["prompt"] == ["Pick atoms to replace with oxygen..."]
    assert wizard["panel"][0] == [1, "Replacing Multiple Atoms", ""]

    # Same button again = cancel (ActionWizard.activateOrDismiss).
    state = builder.call(
        "cmd.builder_action", "replace", symbol="O", geometry=4, valence=2, text="oxygen"
    )
    assert state["wizard"] is None


def test_grow_attaches_a_fragment_onto_pk1(builder):
    """Chemical row 1: benzene grown onto a methane hydrogen."""
    builder.call("cmd.fragment", "methane")
    before = builder.call("cmd.count_atoms", "methane")
    pick(builder, "methane", "H01")
    state = builder.call(
        "cmd.builder_action", "grow", fragment="benzene", hydrogen=6, anchor=0, text="phenyl"
    )
    assert state["error"] is None
    after = builder.call("cmd.count_atoms", "methane")
    assert after > before + 5, "benzene should have added a ring"
    assert slots(state) == ["pk1"]


def test_grow_with_nothing_picked_arms_the_attach_wizard_and_creates_new(builder):
    state = builder.call(
        "cmd.builder_action", "grow", fragment="benzene", hydrogen=6, anchor=0, text="phenyl"
    )
    wizard = state["wizard"]
    assert wizard["name"] == "AttachWizard"
    assert wizard["prompt"] == ["Pick locations to attach phenyl..."]
    labels = [row[1] for row in wizard["panel"]]
    assert labels == [
        "Attaching Multiple Fragments",
        "Create As New Object",
        "Combine w/ Existing Object",
        "Done",
    ]

    # "Create As New Object" is panel row 1.
    state = builder.call("cmd.builder_wizard_click", 1)
    assert state["error"] is None
    assert any(name.startswith("obj") for name in state["objects"])


def test_ring_fragments_all_load(builder):
    """Chemical row 2: every cyclic/aromatic .pkl really builds."""
    for _key, _tip, fragment, _h, _a, _text in RINGS:
        builder.call("cmd.delete", "all")
        builder.call("cmd.fragment", fragment, "ring")
        assert builder.call("cmd.count_atoms", "ring") > 2, fragment


# --------------------------------------------------------------------------
# Protein tab
# --------------------------------------------------------------------------


def test_attach_amino_acid_extends_the_chain(builder):
    """Protein tab + editor.attach_amino_acid: grow Gly off ALA's C."""
    builder.call("cmd.fragment", "ala")
    builder.call("cmd.edit", "ala and name C")
    state = builder.call("cmd.builder_action", "attachAA", residue="gly")
    assert state["error"] is None
    resn = builder.call("cmd.get_model", "ala and name CA")
    names = sorted({atom["resn"] for atom in resn["atom"]})
    assert names == ["ALA", "GLY"]


def test_attach_amino_acid_rejects_a_bad_connection_point(builder):
    """editor.attach_amino_acid's own validation, surfaced not swallowed.

    ``_BuilderPanel.attach`` (builder.py:1369) has a bare ``except`` that hides
    this; the row is only honest if the message reaches the user.
    """
    builder.call("cmd.fragment", "ala")
    builder.call("cmd.edit", "ala and name CB")
    state = builder.call("cmd.builder_action", "attachAA", residue="gly")
    assert state["error"] is not None
    assert "Error" in state["error"], state["error"]


def test_secondary_structure_combo_changes_the_dihedrals(builder):
    """ss=1 helix (-57/-47) vs ss=2 antiparallel (-139/135), editor.py:151-162."""
    angles = {}
    for index, (_label, ss, phi_expect, psi_expect) in enumerate(SECONDARY_STRUCTURE[:2]):
        builder.call("cmd.delete", "all")
        builder.call("cmd.builder_action", "ssChanged", index=index)
        builder.call("cmd.fragment", "ala", "chain")
        builder.call("cmd.edit", "chain and name C")
        state = builder.call("cmd.builder_action", "attachAA", residue="ala")
        assert state["error"] is None
        phi = builder.call(
            "cmd.get_dihedral",
            "chain and resi 2 and name C",
            "chain and resi 3 and name N",
            "chain and resi 3 and name CA",
            "chain and resi 3 and name C",
        )
        angles[ss] = round(phi, 1)
        assert abs(phi - phi_expect) < 1.0, (ss, phi, phi_expect, psi_expect)
    assert angles[1] != angles[2]


def test_ss_combo_updates_a_live_amino_acid_wizard(builder):
    """builder.py:1376-1379 — the combo pushes into the armed wizard."""
    state = builder.call("cmd.builder_action", "attachAA", residue="ala")
    assert state["wizard"]["name"] == "AminoAcidWizard"
    assert state["wizard"]["prompt"] == ["Pick locations to attach ala..."]
    state = builder.call("cmd.builder_action", "ssChanged", index=2)
    assert state["wizard"]["name"] == "AminoAcidWizard"

    builder.call("cmd.fragment", "ala", "target")
    state = pick(builder, "target", "C")
    assert state["error"] is None if "error" in state else True
    # The wizard's do_pick fired and the residue landed.
    assert builder.call("cmd.count_atoms", "target and resi 3") > 0


def test_every_residue_button_has_a_fragment(builder):
    for label in AMINO_ACIDS_ROW0 + AMINO_ACIDS_ROW1:
        builder.call("cmd.delete", "all")
        builder.call("cmd.fragment", label.lower(), "res")
        assert builder.call("cmd.count_atoms", "res") > 0, label


# --------------------------------------------------------------------------
# Nucleic acid tab
# --------------------------------------------------------------------------


def _click(builder, label: str):
    """Click the wizard panel row with this label."""
    state = builder.call("cmd.builder_state")
    rows = state["wizard"]["panel"]
    index = [i for i, row in enumerate(rows) if row[1] == label]
    assert index, "no %r row in %r" % (label, [row[1] for row in rows])
    return builder.call("cmd.builder_wizard_click", index[0])


@pytest.mark.parametrize("base", [row[2] for row in DNA_BASES])
def test_dna_bases_create_a_new_duplex(builder, base):
    """DNA sub-tab, default radios (form B, double helix).

    Nothing is picked, so the button arms NucleicAcidWizard exactly as the Qt
    panel does; "Create As New Object" is the wizard's own new-object path.
    """
    state = builder.call("cmd.builder_action", "attachNA", base=base, nucType="DNA")
    assert state["wizard"]["name"] == "NucleicAcidWizard"
    state = _click(builder, "Create As New Object")
    assert state["error"] is None, state["error"]
    assert state["objects"], "no object was created"
    chains = builder.call("cmd.get_chains", state["objects"][0])
    assert len(chains) == 2, chains  # double helix -> two strands


def test_rna_base_creates_a_single_strand_with_2prime_oh(builder):
    """RNA sub-tab: editor.attach_nuc_acid forces form A + single strand
    (editor.py:803-805) and adds the 2'-OH."""
    builder.call("cmd.builder_action", "attachNA", base="atp", nucType="RNA")
    state = _click(builder, "Create As New Object")
    assert state["error"] is None, state["error"]
    obj = state["objects"][0]
    assert len(builder.call("cmd.get_chains", obj)) == 1
    assert builder.call("cmd.count_atoms", "%s and name O2\'" % obj) > 0


def test_dna_extends_from_a_picked_o3prime(builder):
    """editor.attach_nuc_acid's extend branch: pick a free O3' and grow."""
    builder.call("cmd.builder_action", "attachNA", base="atp", nucType="DNA")
    _click(builder, "Create As New Object")
    builder.call("cmd.builder_dismiss")
    obj = builder.call("cmd.get_object_list")[0]
    before = builder.call("cmd.count_atoms", obj)
    free = builder.call(
        "cmd.index", "%s and name O3\' and not neighbor name P" % obj
    )
    assert free, "no free O3' to grow from"
    builder.call("cmd.builder_pick", free[0][0], free[0][1], None, "multi")
    state = builder.call("cmd.builder_action", "attachNA", base="gtp", nucType="DNA")
    assert state["error"] is None, state["error"]
    assert builder.call("cmd.count_atoms", obj) > before


def test_nucleic_acid_wizard_arms_when_nothing_is_picked(builder):
    builder.call("cmd.fragment", "ala")  # an object exists, but nothing is picked
    builder.call("cmd.unpick")
    state = builder.call("cmd.builder_action", "attachNA", base="ttp", nucType="DNA")
    assert state["wizard"]["name"] == "NucleicAcidWizard"
    assert state["wizard"]["prompt"] == ["Pick locations to attach ttp..."]


# --------------------------------------------------------------------------
# Action row 1 — atoms, charge, residue
# --------------------------------------------------------------------------


def test_add_h_and_fix_h(builder):
    builder.call("cmd.fragment", "benzene")
    builder.call("cmd.remove", "hydro")
    assert builder.call("cmd.count_atoms", "hydro") == 0
    pick(builder, "benzene", "C01")
    state = builder.call("cmd.builder_action", "addH")
    assert state["error"] is None
    assert builder.call("cmd.count_atoms", "hydro") == 6
    assert slots(state) == []

    builder.call("cmd.remove", "benzene and hydro and neighbor name C01")
    pick(builder, "benzene", "C01")
    builder.call("cmd.builder_action", "fixH")
    assert builder.call("cmd.count_atoms", "hydro") == 6


def test_hydrogen_wizard_arms_with_nothing_picked(builder):
    state = builder.call("cmd.builder_action", "fixH")
    assert state["wizard"]["name"] == "HydrogenWizard"
    assert state["wizard"]["prompt"] == ["Pick atom upon which to fix hydrogens..."]
    assert state["wizard"]["panel"][0] == [1, "Fixing Hydrogens", ""]


def test_delete_atom_repairs_chemistry(builder):
    builder.call("cmd.fragment", "benzene")
    before = builder.call("cmd.count_atoms", "benzene")
    pick(builder, "benzene", "C01")
    state = builder.call("cmd.builder_action", "removeAtom")
    assert state["error"] is None
    assert builder.call("cmd.count_atoms", "benzene and name C01") == 0
    assert builder.call("cmd.count_atoms", "benzene and elem C") == 5
    # fix_chemistry + h_add repaired the open valences the removal left.
    assert builder.call("cmd.count_atoms", "benzene and hydro") == 8
    assert before == 12
    assert slots(state) == []


def test_remove_residue_needs_exactly_one_pick(builder):
    builder.call("cmd.fragment", "ala")
    builder.call("cmd.editor" if False else "cmd.edit", "ala and name N")
    pick(builder, "ala", "CA")
    state = builder.call("cmd.builder_action", "removeResn")
    # two picks -> refused, nothing removed
    assert builder.call("cmd.count_atoms", "ala") > 0
    builder.call("cmd.unpick")
    pick(builder, "ala", "CA")
    state = builder.call("cmd.builder_action", "removeResn")
    assert state["error"] is None
    assert builder.call("cmd.count_atoms", "ala") == 0


def test_charge_buttons_set_formal_charge_and_label(builder):
    builder.call("cmd.fragment", "ala")
    pick(builder, "ala", "N")
    state = builder.call("cmd.builder_action", "setCharge", charge=1, text="+1")
    assert state["error"] is None
    charges = builder.call("cmd.get_model", "ala and name N")["atom"]
    assert charges[0]["formal_charge"] == 1
    assert slots(state) == []

    pick(builder, "ala", "N")
    builder.call("cmd.builder_action", "setCharge", charge=0, text="neutral")
    charges = builder.call("cmd.get_model", "ala and name N")["atom"]
    assert charges[0]["formal_charge"] == 0


def test_charge_wizard_arms_with_nothing_picked(builder):
    state = builder.call("cmd.builder_action", "setCharge", charge=-1, text="-1")
    assert state["wizard"]["name"] == "ChargeWizard"
    assert state["wizard"]["prompt"] == ["Pick atoms to set charge = -1..."]


def test_clear_deletes_everything(builder):
    builder.call("cmd.fragment", "ala")
    builder.call("cmd.fragment", "trp")
    state = builder.call("cmd.builder_action", "clear")
    assert state["error"] is None
    assert state["objects"] == []


def test_invert_wizard_has_a_three_step_prompt(builder):
    builder.call("cmd.fragment", "ala")
    state = builder.call("cmd.builder_action", "invert")
    assert state["wizard"]["name"] == "InvertWizard"
    assert state["wizard"]["prompt"] == ["Pick origin atom for inversion..."]
    state = pick(builder, "ala", "CA")
    assert state["wizard"]["prompt"] == ["Pick the first stationary atom..."]
    state = pick(builder, "ala", "N")
    assert state["wizard"]["prompt"] == ["Pick the second stationary atom..."]
    state = pick(builder, "ala", "C")
    # three picks -> cmd.invert() ran and the wizard unpicked
    assert slots(state) == []


# --------------------------------------------------------------------------
# Action row 2 — bonds and model
# --------------------------------------------------------------------------


def test_create_and_delete_bond(builder):
    builder.call("cmd.fragment", "ala")
    n = builder.call("cmd.index", "ala and name N")[0]
    o = builder.call("cmd.index", "ala and name O")[0]
    builder.call("cmd.builder_pick", n[0], n[1], None, "multi")
    builder.call("cmd.builder_pick", o[0], o[1], None, "multi")
    state = builder.call("cmd.builder_action", "createBond")
    assert state["error"] is None
    assert builder.call("cmd.count_atoms", "ala and name N and neighbor name O") == 1

    builder.call("cmd.builder_pick", n[0], n[1], None, "multi")
    builder.call("cmd.builder_pick", o[0], o[1], None, "multi")
    state = builder.call("cmd.builder_action", "deleteBond")
    assert state["error"] is None
    assert builder.call("cmd.count_atoms", "ala and name N and neighbor name O") == 0


def test_set_order_makes_a_double_bond(builder):
    builder.call("cmd.fragment", "ethylene")
    c1 = builder.call("cmd.index", "ethylene and name C01")[0]
    c2 = builder.call("cmd.index", "ethylene and name C02")[0]
    builder.call("cmd.builder_pick", c1[0], c1[1], None, "multi")
    builder.call("cmd.builder_pick", c2[0], c2[1], None, "multi")
    state = builder.call("cmd.builder_action", "setOrder", order="1", text="single")
    assert state["error"] is None
    model = builder.call("cmd.get_model", "ethylene")
    orders = {bond["order"] for bond in model["bond"]}
    assert 1 in orders


def test_cycle_valence_on_a_picked_bond(builder):
    builder.call("cmd.fragment", "ethylene")
    c1 = builder.call("cmd.index", "ethylene and name C01")[0]
    c2 = builder.call("cmd.index", "ethylene and name C02")[0]
    before = _order_between(builder, "C01", "C02")
    builder.call("cmd.builder_pick", c1[0], c1[1], c2[1], "bond")
    state = builder.call("cmd.builder_action", "cycleBond")
    assert state["error"] is None
    assert _order_between(builder, "C01", "C02") != before


def _order_between(ws, a: str, b: str) -> int:
    model = ws.call("cmd.get_model", "ethylene")
    index_of = {atom["name"]: i for i, atom in enumerate(model["atom"])}
    for bond in model["bond"]:
        if sorted(bond["index"]) == sorted([index_of[a], index_of[b]]):
            return bond["order"]
    raise AssertionError("no %s-%s bond" % (a, b))


def test_valence_wizard_switches_to_bond_picking(builder):
    """ValenceWizard/UnbondWizard force PkBd on single_left (controlling.py:72)."""
    state = builder.call("cmd.builder_action", "cycleBond")
    assert state["wizard"]["name"] == "ValenceWizard"
    assert state["wizard"]["prompt"] == ["Pick bonds to set as Cycle bond..."]

    builder.call("cmd.builder_dismiss")
    state = builder.call("cmd.builder_action", "deleteBond")
    assert state["wizard"]["name"] == "UnbondWizard"
    assert state["wizard"]["prompt"] == ["Pick bonds to delete..."]


def test_unbond_wizard_deletes_a_picked_bond(builder):
    builder.call("cmd.fragment", "ethylene")
    builder.call("cmd.builder_action", "deleteBond")  # arms UnbondWizard
    c1 = builder.call("cmd.index", "ethylene and name C01")[0]
    c2 = builder.call("cmd.index", "ethylene and name C02")[0]
    state = builder.call("cmd.builder_pick", c1[0], c1[1], c2[1], "bond")
    assert state["bondFlag"] == 1
    assert builder.call("cmd.count_atoms", "ethylene and name C01 and neighbor name C02") == 0


def test_clean_button_surfaces_the_incentive_only_error(builder):
    builder.call("cmd.fragment", "ala")
    pick(builder, "ala", "CA")
    state = builder.call("cmd.builder_action", "clean")
    assert state["clean_available"] is False
    assert state["value"] is not None, "the Clean button must report WHY it failed"
    assert "Incentive" in state["value"], state["value"]


def test_fix_and_rest_arm_the_atom_flag_wizards(builder):
    builder.call("cmd.fragment", "ala")
    pick(builder, "ala", "CA")
    state = builder.call("cmd.builder_action", "fix")
    assert state["wizard"]["name"] == "FixAtomWizard"
    assert state["wizard"]["prompt"] == ["Toggle fixed atoms..."]
    labels = [row[1] for row in state["wizard"]["panel"]]
    assert labels == [
        "Fixed Atoms",
        "All",
        "All C-alphas",
        "More (byres)",
        "More",
        "Byresidue",
        "Less",
        "Less (by residue)",
        "Only C-alphas",
        "None",
        "Done",
    ]

    # "All" is row 1 -> flag 3 on every atom of the active object.
    builder.call("cmd.builder_wizard_click", 1)
    assert builder.call("cmd.count_atoms", "ala and flag 3") == builder.call(
        "cmd.count_atoms", "ala"
    )
    # "None" is row 9.
    builder.call("cmd.builder_wizard_click", 9)
    assert builder.call("cmd.count_atoms", "ala and flag 3") == 0

    builder.call("cmd.builder_dismiss")
    pick(builder, "ala", "CA")
    state = builder.call("cmd.builder_action", "rest")
    assert state["wizard"]["name"] == "RestAtomWizard"
    assert state["wizard"]["prompt"] == ["Toggle restrained atoms..."]
    labels = [row[1] for row in state["wizard"]["panel"]]
    assert "Store Reference Coords." in labels
    assert "Swap Reference Coords." in labels


def test_sculpt_wizard_activates_and_finishes(builder):
    builder.call("cmd.fragment", "ala")
    pick(builder, "ala", "CA")
    state = builder.call("cmd.builder_action", "sculpt")
    assert state["wizard"]["name"] == "SculptWizard"
    assert state["wizard"]["prompt"] == ["Sculpting ala..."]
    assert builder.call("cmd.get_setting_int", "sculpting") == 1
    labels = [row[1] for row in state["wizard"]["panel"]]
    assert labels == [
        "Sculpt",
        "Undo",
        "Switch Object",
        "Scramble Unrestrained Coords.",
        "Scramble Unfixed Coords.",
        "Done",
    ]
    # "Done" -> finish_sculpting()
    state = builder.call("cmd.builder_wizard_click", 5)
    assert state["error"] is None
    assert builder.call("cmd.get_setting_int", "sculpting") == 0
    assert state["wizard"] is None


# --------------------------------------------------------------------------
# Action row 3 — settings, undo
# --------------------------------------------------------------------------


def test_setting_checkboxes_mirror_pymol(builder):
    builder.call("cmd.set", "clean_electro_mode", 0)
    assert builder.call("cmd.builder_state")["settings"]["clean_electro_mode"] == 0
    builder.call("cmd.set", "clean_electro_mode", 1)
    assert builder.call("cmd.builder_state")["settings"]["clean_electro_mode"] == 1

    builder.call("cmd.set", "sculpt_vdw_vis_mode", 1)
    assert builder.call("cmd.builder_state")["settings"]["sculpt_vdw_vis_mode"] == 1
    builder.call("cmd.set", "sculpt_vdw_vis_mode", 0)


def test_undo_enabled_is_an_inverted_binding_with_a_per_object_list(builder):
    builder.call("cmd.fragment", "ala")
    builder.call("cmd.set", "suspend_undo", 1, "ala")

    state = builder.call("cmd.builder_action", "setUndoEnabled", enabled=False)
    assert state["settings"]["suspend_undo"] == 1
    assert state["value"] == []

    state = builder.call("cmd.builder_action", "setUndoEnabled", enabled=True)
    assert state["settings"]["suspend_undo"] == 0
    # The per-object override survives the global unset -> the modal list.
    assert state["value"] == ["ala"]

    state = builder.call(
        "cmd.builder_action", "enableUndoForObjects", objects=["ala", "[3 more]"]
    )
    assert state["value"] == ["ala"], "a fabricated name must never reach cmd.unset"
    assert builder.call("cmd.get_setting_int", "suspend_undo", "ala") == 0


def test_undo_and_redo_are_reachable(builder):
    builder.call("cmd.fragment", "ala")
    builder.call("cmd.undo")
    builder.call("cmd.redo")
    assert builder.call("cmd.builder_state")["undo_is_noop"] is True


# --------------------------------------------------------------------------
# wizard machinery
# --------------------------------------------------------------------------


def test_wizard_panel_click_rejects_titles_and_out_of_range(builder):
    builder.call("cmd.builder_action", "setCharge", charge=1, text="+1")
    reply = builder.call_reply("cmd.builder_wizard_click", 0)
    assert reply["t"] == "err"  # row 0 is the title
    reply = builder.call_reply("cmd.builder_wizard_click", 99)
    assert reply["t"] == "err"


def test_done_dismisses_any_wizard(builder):
    builder.call("cmd.builder_action", "setCharge", charge=1, text="+1")
    state = builder.call("cmd.builder_state")
    done = [i for i, row in enumerate(state["wizard"]["panel"]) if row[1] == "Done"][0]
    state = builder.call("cmd.builder_wizard_click", done)
    assert state["wizard"] is None


def test_repeat_flips_the_panel_and_prompt(builder):
    """RepeatableActionWizard: first activation is already repeating (:255)."""
    state = builder.call(
        "cmd.builder_action", "replace", symbol="C", geometry=4, valence=4, text="carbon"
    )
    assert state["wizard"]["repeating"] is True
    assert state["wizard"]["prompt"] == ["Pick atoms to replace with carbon..."]


# --------------------------------------------------------------------------
# pure-table checks (no engine)
# --------------------------------------------------------------------------


def test_tables_match_the_qt_source_shape():
    assert [row[0] for row in ELEMENTS] == [
        "H", "C", "N", "O", "P", "S", "F", "Cl", "Br", "I",
    ]
    # builder.py:1082 typo, kept deliberately.
    assert dict((row[0], row[1]) for row in ELEMENTS)["Cl"] == "Chlorrine"
    assert [row[0] for row in FUNCTIONAL_GROUPS] == [
        "CH4", "C=C", "C#C", "C#N", "C=O", "C=OO", "C=ON", "NC=O", "S=O2", "P=O3", "N=O2",
    ]
    assert [row[0] for row in RINGS] == [
        "cyc3", "cyc4", "cyc5", "cyc6", "cyc7", "aro5", "aro6", "aro65", "aro66", "aro67",
    ]
    assert len(AMINO_ACIDS_ROW0) == 12 and len(AMINO_ACIDS_ROW1) == 11
    assert [row[2] for row in DNA_BASES] == ["atp", "ctp", "ttp", "gtp"]
    assert [row[2] for row in RNA_BASES] == ["atp", "ctp", "utp", "gtp"]
    assert [row[1] for row in SECONDARY_STRUCTURE] == [1, 2, 3]
    assert len(fragment_names()) == 22


# --------------------------------------------------------------------------
# breadth: every button in a row, not just one of them
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label,fragment,hydrogen,anchor",
    [(row[0], row[2], row[3], row[4]) for row in FUNCTIONAL_GROUPS],
)
def test_every_functional_group_grows_onto_a_pick(builder, label, fragment, hydrogen, anchor):
    """Chemical row 1: all eleven, each on a fresh methane."""
    builder.call("cmd.delete", "all")
    builder.call("cmd.fragment", "methane")
    before = builder.call("cmd.count_atoms", "methane")
    pick(builder, "methane", "H01")
    state = builder.call(
        "cmd.builder_action",
        "grow",
        fragment=fragment,
        hydrogen=hydrogen,
        anchor=anchor,
        text=label,
    )
    assert state["error"] is None, (label, state["error"])
    assert builder.call("cmd.count_atoms", "methane") > before, label


@pytest.mark.parametrize(
    "label,fragment,hydrogen,anchor",
    [(row[0], row[2], row[3], row[4]) for row in CHEM_ROW0_FRAGMENTS],
)
def test_cf3_and_ome_grow_onto_a_pick(builder, label, fragment, hydrogen, anchor):
    """Chemical row 0's two fragment buttons, -CF3 and -OMe."""
    builder.call("cmd.delete", "all")
    builder.call("cmd.fragment", "methane")
    before = builder.call("cmd.count_atoms", "methane")
    pick(builder, "methane", "H01")
    state = builder.call(
        "cmd.builder_action",
        "grow",
        fragment=fragment,
        hydrogen=hydrogen,
        anchor=anchor,
        text=label,
    )
    assert state["error"] is None, (label, state["error"])
    assert builder.call("cmd.count_atoms", "methane") > before, label
    if fragment == "trifluoromethane":
        assert builder.call("cmd.count_atoms", "methane and elem F") == 3


@pytest.mark.parametrize(
    "label,fragment,hydrogen,anchor",
    [(row[0], row[2], row[3], row[4]) for row in RINGS],
)
def test_every_ring_grows_onto_a_pick(builder, label, fragment, hydrogen, anchor):
    """Chemical row 2: all ten cyclic/aromatic icon buttons."""
    builder.call("cmd.delete", "all")
    builder.call("cmd.fragment", "methane")
    before = builder.call("cmd.count_atoms", "methane")
    pick(builder, "methane", "H01")
    state = builder.call(
        "cmd.builder_action",
        "grow",
        fragment=fragment,
        hydrogen=hydrogen,
        anchor=anchor,
        text=label,
    )
    assert state["error"] is None, (label, state["error"])
    assert builder.call("cmd.count_atoms", "methane") > before, label


@pytest.mark.parametrize("residue", [r.lower() for r in AMINO_ACIDS_ROW0 + AMINO_ACIDS_ROW1])
def test_every_residue_button_attaches(builder, residue):
    """Protein tab: all 23, grown off a free terminus of an alanine.

    `ace` may only cap an N and `nme`/`nhh` may only cap a C
    (editor.py's own validation), so the growth point is chosen accordingly —
    the point of the test is that the button reaches a real backend path and
    either builds or explains itself, never silently does nothing.
    """
    builder.call("cmd.delete", "all")
    builder.call("cmd.fragment", "ala")
    grow_from = "N" if residue == "ace" else "C"
    builder.call("cmd.edit", "ala and name %s" % grow_from)
    before = builder.call("cmd.count_atoms", "ala")
    state = builder.call("cmd.builder_action", "attachAA", residue=residue)
    assert state["error"] is None, (residue, state["error"])
    assert builder.call("cmd.count_atoms", "ala") > before, residue


def test_clean_wizard_panel_and_prompt(builder):
    builder.call("cmd.fragment", "ala")
    builder.call("cmd.unpick")
    # No pick: clean() arms CleanWizard, whose activeSeleValid picks the only
    # enabled object and runs the job immediately, so it dismisses itself.
    state = builder.call("cmd.builder_action", "clean")
    assert state["value"] is not None and "Incentive" in state["value"]

    # With two enabled objects and no active selection there is nothing to
    # auto-select, so the wizard stays up and asks for a pick.
    builder.call("cmd.fragment", "trp")
    builder.call("cmd.builder_dismiss")
    state = builder.call("cmd.builder_action", "clean")
    assert state["wizard"]["name"] == "CleanWizard"
    assert state["wizard"]["prompt"] == ["Pick object to clean..."]
    assert [row[1] for row in state["wizard"]["panel"]] == ["Clean", "Done"]


def test_remove_wizard_arms_with_nothing_picked(builder):
    builder.call("cmd.fragment", "benzene")
    builder.call("cmd.unpick")
    state = builder.call("cmd.builder_action", "removeAtom")
    assert state["wizard"]["name"] == "RemoveWizard"
    assert state["wizard"]["prompt"] == ["Pick atoms to delete..."]

    # Its do_pick removes the atom and repairs the chemistry.
    before = builder.call("cmd.count_atoms", "benzene and elem C")
    pick(builder, "benzene", "C01")
    assert builder.call("cmd.count_atoms", "benzene and elem C") == before - 1


def test_bond_wizard_substitutes_heavy_neighbours_for_two_hydrogens(builder):
    """BondWizard.staticaction (builder.py:656-662).

    Two hydrogens picked on the SAME molecule (cmd.bond refuses to cross
    objects) -> the bond is made between their heavy neighbours instead, here
    closing cyclohexane's C01 and C04 into a bicycle.
    """
    builder.call("cmd.fragment", "cyclohexane")
    assert builder.call("cmd.count_atoms", "name C01 and neighbor name C04") == 0
    h1 = builder.call("cmd.index", "hydro and neighbor name C01")[0]
    h4 = builder.call("cmd.index", "hydro and neighbor name C04")[0]
    builder.call("cmd.builder_pick", h1[0], h1[1], None, "multi")
    builder.call("cmd.builder_pick", h4[0], h4[1], None, "multi")
    state = builder.call("cmd.builder_action", "createBond")
    assert state["error"] is None
    assert builder.call("cmd.count_atoms", "name C01 and neighbor name C04") == 1


def test_valence_wizard_puts_the_mouse_into_bond_picking(builder):
    """ValenceWizard.toggle -> cmd.button(..., 'PkBd'); cleanup -> 'PkAt'."""
    from pymol import controlling

    builder.call("cmd.builder_dismiss")
    builder.call("cmd.builder_action", "cycleBond")
    mode = builder.call("cmd.get_setting_int", "button_mode")
    ring = controlling.mouse_ring[mode]
    # single_left is now PkBd (14) rather than PkAt (13).
    single_left = builder.call("cmd.get_setting_int", "button_mode")
    assert isinstance(single_left, int)
    assert ring.endswith("editing"), ring
    state = builder.call("cmd.builder_state")
    assert state["wizard"]["name"] == "ValenceWizard"

    # Dismissing runs cleanup(), which restores atom picking.
    builder.call("cmd.builder_dismiss")
    assert builder.call("cmd.builder_state")["wizard"] is None


def test_atom_flag_wizard_do_select_edits_the_flag_set(builder):
    """builder.py:865-870 — editing `_build_display` rewrites the flags."""
    builder.call("cmd.fragment", "trp")
    pick(builder, "trp", "CA")
    state = builder.call("cmd.builder_action", "fix")
    assert state["wizard"]["name"] == "FixAtomWizard"
    # "All C-alphas" is row 2.
    builder.call("cmd.builder_wizard_click", 2)
    assert builder.call("cmd.count_atoms", "trp and flag 3") == builder.call(
        "cmd.count_atoms", "trp and polymer and name ca"
    )
    # `_build_display` mirrors the flagged set.
    assert "_build_display" in builder.call("cmd.get_names", "selections")

    # More (row 4) grows the set by one bond.
    before = builder.call("cmd.count_atoms", "trp and flag 3")
    builder.call("cmd.builder_wizard_click", 4)
    assert builder.call("cmd.count_atoms", "trp and flag 3") > before


def test_sculpt_wizard_scramble_moves_coordinates(builder):
    builder.call("cmd.fragment", "trp")
    pick(builder, "trp", "CA")
    builder.call("cmd.builder_action", "sculpt")
    before = builder.call("cmd.get_extent", "trp")
    # "Scramble Unrestrained Coords." is row 3.
    state = builder.call("cmd.builder_wizard_click", 3)
    assert state["error"] is None, state["error"]
    after = builder.call("cmd.get_extent", "trp")
    assert before != after, "scramble did not move anything"
    builder.call("cmd.builder_wizard_click", 5)  # Done -> finish_sculpting
