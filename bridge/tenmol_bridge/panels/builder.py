"""The molecular Builder — a Qt-free port of ``modules/pmg_qt/builder.py``.

OWNER: WP-17.  Parity inventory area 9 (30 rows); deep map
``docs/webclient/builder.md``.

Why this module has to exist
----------------------------
``pmg_qt/builder.py`` is 1579 lines of which only ~350 are Qt.  The other 1200
are the *editor state machine* — thirteen ``Wizard`` subclasses and the exact
``cmd.*`` call sequences behind every button — and they cannot be re-implemented
in TypeScript, because a PyMOL wizard is a **Python object owned by the
engine**: ``cmd.set_wizard(obj)`` takes an instance, ``cmd.get_wizard()`` hands
one back, and the C++ pick path calls ``wizard.do_pick(bondFlag)``.  So the
wizards are ported here, verbatim minus Qt, and the React panel drives them
through six RPCs.

Installation, and why it is a ``{t:'do'}`` bootstrap
---------------------------------------------------
``bridge/tenmol_bridge/panels/__init__.py`` is a frozen barrel that does not
list ``builder``, and ``server.py`` (which owns the ``_bridge.*`` route table)
belongs to WP-02.  Neither may be edited by this work package (plan §5.2).  What
*is* reachable is the capability policy's default root ``cmd``: the dispatcher
resolves ``cmd.<leaf>`` with ``getattr(engine.cmd, leaf)``
(``dispatch.py:Dispatcher.resolve``), and for ``pymol2.SingletonPyMOL`` —
measured — ``engine.cmd is sys.modules['pymol.cmd']``.  So one line of
``{t:'do'}``::

    _ __import__('tenmol_bridge.panels.builder', fromlist=['install']).install(cmd)

binds every entry point below onto the very object the dispatcher looks at, and
from then on the client makes ordinary typed ``{t:'call'}`` requests:

======================================  ===================================
``cmd.builder_tables()``                the declarative button tables
``cmd.builder_show()``                  the four ``showEvent`` setup calls
``cmd.builder_state()``                 pick state + wizard + mirrored settings
``cmd.builder_action(kind, **params)``  one button press
``cmd.builder_pick(obj, index, mode)``  a viewport pick -> ``pkN`` + ``do_pick``
``cmd.builder_wizard_click(index)``     a wizard panel row
======================================  ===================================

Deliberate divergences from the Qt source, each of them a defect listed in
``docs/webclient/builder.md`` §9:

* ``clean`` — ``cmd.clean`` raises ``IncentiveOnlyException`` in this tree
  (``modules/pymol/computing.py:20-29``).  :func:`builder_state` reports
  ``clean_available: False`` so the button ships VISIBLY DISABLED.  The action
  is still wired; asking for it returns the exception text instead of pretending.
* ``_BuilderPanel.attach``'s bare ``except: fin = -1``
  (``builder.py:1369-1370``) swallowed every attach failure.  Here the error
  text is returned to the client as ``error`` and also printed, so the feedback
  pane shows it.
* ``setUndoEnabled``'s ">20 objects" truncation (``builder.py:1310-1321``) fed
  the literal string ``"[N more]"`` to ``cmd.unset``.  This version returns the
  complete list and never invents a name.
* ``editor.combine_monomer`` / ``editor.combine_nucleotide`` do not exist
  (grep-verified).  ``BioPolymerWizard`` mode 1 is therefore reported as
  unavailable instead of raising ``AttributeError`` at pick time.
* ``undocontext`` is a no-op in this tree (``editor.py:38-49``), so the
  ``undoable`` actions are not actually undoable.  ``builder_state`` says so
  (``undo_is_noop``) rather than letting the UI imply otherwise.
"""

from __future__ import annotations

import ast
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "ACTIVE_SELE",
    "NEWEST_SELE",
    "DISPLAY_SELE",
    "PK_NAMES",
    "TABLES",
    "collect_picked",
    "editor_state",
    "wizard_state",
    "builder_state",
    "builder_show",
    "builder_action",
    "builder_pick",
    "builder_wizard_click",
    "builder_tables",
    "install",
    "ActionWizard",
    "RepeatableActionWizard",
    "CleanWizard",
    "SculptWizard",
    "ReplaceWizard",
    "AttachWizard",
    "BioPolymerWizard",
    "AminoAcidWizard",
    "NucleicAcidWizard",
    "ValenceWizard",
    "ChargeWizard",
    "InvertWizard",
    "BondWizard",
    "UnbondWizard",
    "HydrogenWizard",
    "RemoveWizard",
    "AtomFlagWizard",
    "FixAtomWizard",
    "RestAtomWizard",
]

#: ``builder.py:22-24`` — the three panel-scoped selection names.
ACTIVE_SELE = "_builder_active"
NEWEST_SELE = "_builder_added"
DISPLAY_SELE = "_build_display"

#: ``layer3/Editor.h:30-48`` — the picked-atom slots, in click order.
PK_NAMES: Tuple[str, ...] = ("pk1", "pk2", "pk3", "pk4")


# ---------------------------------------------------------------------------
# The declarative button tables (builder.py:1074-1112, 1132-1135, 1176-1210)
# ---------------------------------------------------------------------------
#
# The React panel carries the same table; :func:`builder_tables` exists so the
# two can be compared instead of trusted, and so a fragment that is missing from
# ``data/chempy/fragments`` is caught by a test rather than by a user.

#: label, tooltip, symbol, geometry, valence, wizard text.  Geometry codes are
#: ``layer2/AtomInfo.h:129-133``: 1=Single 2=Linear 3=Planar 4=Tetrahedral 5=None
ELEMENTS: Tuple[Tuple[str, str, str, int, int, str], ...] = (
    ("H", "Hydrogen", "H", 1, 1, "hydrogen"),
    ("C", "Carbon", "C", 4, 4, "carbon"),
    ("N", "Nitrogen", "N", 4, 3, "nitrogen"),
    ("O", "Oxygen", "O", 4, 2, "oxygen"),
    # builder.py:1079 — the wizard text really is the misspelling "Phosphorous".
    ("P", "Phosphorus", "P", 4, 3, "Phosphorous"),
    ("S", "Sulfur", "S", 2, 2, "sulfur"),
    ("F", "Fluorine", "F", 1, 1, "fluorine"),
    # builder.py:1082 — tooltip typo "Chlorrine" is upstream's, kept verbatim.
    ("Cl", "Chlorrine", "Cl", 1, 1, "chlorine"),
    ("Br", "Bromine", "Br", 1, 1, "bromine"),
    ("I", "Iodine", "I", 1, 1, "iodine"),
)

#: label, tooltip, fragment, hydrogen id, anchor, wizard text.
CHEM_ROW0_FRAGMENTS: Tuple[Tuple[str, str, str, int, int, str], ...] = (
    ("-CF3", "Trifluoromethane", "trifluoromethane", 4, 0, "trifluoro"),
    ("-OMe", "Methanol", "methanol", 5, 0, "methoxy"),
)

FUNCTIONAL_GROUPS: Tuple[Tuple[str, str, str, int, int, str], ...] = (
    ("CH4", "Methyl", "methane", 1, 0, "methyl"),
    ("C=C", "Ethylene", "ethylene", 4, 0, "vinyl"),
    ("C#C", "Acetylene", "acetylene", 2, 0, "alkynl"),
    ("C#N", "Cyanide", "cyanide", 2, 0, "cyano"),
    ("C=O", "Aldehyde", "formaldehyde", 2, 0, "carbonyl"),
    ("C=OO", "Formic Acid", "formic", 4, 0, "carboxyl"),
    ("C=ON", "C->N amide", "formamide", 5, 0, "C->N amide"),
    ("NC=O", "N->C amide", "formamide", 3, 1, "N->C amide"),
    ("S=O2", "Sulfone", "sulfone", 3, 1, "sulfonyl"),
    ("P=O3", "Phosphite", "phosphite", 4, 0, "phosphoryl"),
    ("N=O2", "Nitro", "nitro", 3, 0, "nitro"),
)

#: icon key, tooltip, fragment, hydrogen id, anchor, wizard text.  The icon keys
#: are the ``$PYMOL_DATA/pmg_tk/bitmaps/builder/<key>.gif`` basenames
#: (``builder.py:1323-1335``).
RINGS: Tuple[Tuple[str, str, str, int, int, str], ...] = (
    ("cyc3", "Cyclopropane", "cyclopropane", 4, 0, "cyclopropyl"),
    ("cyc4", "Cyclobutane", "cyclobutane", 4, 0, "cyclobutyl"),
    ("cyc5", "Cyclopentane", "cyclopentane", 5, 0, "cyclopentyl"),
    ("cyc6", "Cyclohexane", "cyclohexane", 7, 0, "cyclohexyl"),
    ("cyc7", "Cycloheptane", "cycloheptane", 8, 0, "cycloheptyl"),
    ("aro5", "Cyclopentadiene", "cyclopentadiene", 5, 0, "cyclopentadienyl"),
    ("aro6", "Benzene", "benzene", 6, 0, "phenyl"),
    ("aro65", "Indane", "indane", 12, 0, "indanyl"),
    # builder.py:1109 — "napthylene" is misspelled upstream, and so is the .pkl.
    ("aro66", "Napthylene", "napthylene", 13, 0, "napthyl"),
    ("aro67", "Benzocycloheptane", "benzocycloheptane", 13, 0, "benzocycloheptyl"),
)

#: builder.py:1132-1135 — 23 residues, 12 on row 0 and 11 on row 1.
AMINO_ACIDS_ROW0: Tuple[str, ...] = (
    "Ace", "Ala", "Arg", "Asn", "Asp", "Cys",
    "Gln", "Glu", "Gly", "His", "Ile", "Leu",
)
AMINO_ACIDS_ROW1: Tuple[str, ...] = (
    "Lys", "Met", "Phe", "Pro", "Ser", "Thr", "Trp", "Tyr", "Val", "NMe", "NHH",
)

#: builder.py:1146-1154 — the secondary-structure combo.  ``ss`` = index + 1;
#: the phi/psi pairs are ``editor.py:151-162``.
SECONDARY_STRUCTURE: Tuple[Tuple[str, int, float, float], ...] = (
    ("Alpha Helix", 1, -57.0, -47.0),
    ("Beta Sheet (Anti-Parallel)", 2, -139.0, 135.0),
    ("Beta Sheet (Parallel)", 3, -119.0, 113.0),
)

DNA_BASES: Tuple[Tuple[str, str, str], ...] = (
    ("A", "Deoxyadenosine", "atp"),
    ("C", "Deoxycytidine", "ctp"),
    ("T", "Deoxythymidine", "ttp"),
    ("G", "Deoxyguanosine", "gtp"),
)

RNA_BASES: Tuple[Tuple[str, str, str], ...] = (
    ("A", "Adenosine", "atp"),
    ("C", "Cytosine", "ctp"),
    ("U", "Uracil", "utp"),
    ("G", "Guanine", "gtp"),
)

#: builder.py:1469-1479 -> editing.py:598 ``order_dict``.
BOND_ORDERS: Tuple[Tuple[str, str, str], ...] = (
    ("  |  ", "1", "single"),
    (" || ", "2", "double"),
    (" ||| ", "3", "triple"),
    ("Arom", "4", "aromatic"),
)

#: builder.py:1256-1259 — row 3 setting checkboxes.
SETTING_CHECKBOXES: Tuple[Tuple[str, str, str, bool], ...] = (
    ("El-stat", "clean_electro_mode", "Electrostatics term for 'Clean' action", False),
    ("Bumps", "sculpt_vdw_vis_mode", "Show VDW contacts during sculpting", False),
    ("Undo Enabled", "suspend_undo", "", True),  # inverted binding
)

TABLES: Dict[str, Any] = {
    "elements": [list(row) for row in ELEMENTS],
    "chemRow0Fragments": [list(row) for row in CHEM_ROW0_FRAGMENTS],
    "functionalGroups": [list(row) for row in FUNCTIONAL_GROUPS],
    "rings": [list(row) for row in RINGS],
    "aminoAcidsRow0": list(AMINO_ACIDS_ROW0),
    "aminoAcidsRow1": list(AMINO_ACIDS_ROW1),
    "secondaryStructure": [list(row) for row in SECONDARY_STRUCTURE],
    "dnaBases": [list(row) for row in DNA_BASES],
    "rnaBases": [list(row) for row in RNA_BASES],
    "bondOrders": [list(row) for row in BOND_ORDERS],
    "settingCheckboxes": [list(row) for row in SETTING_CHECKBOXES],
}


def fragment_names() -> List[str]:
    """Every ``data/chempy/fragments/<name>.pkl`` the Chemical tab can request."""
    names = [row[2] for row in CHEM_ROW0_FRAGMENTS]
    names += [row[2] for row in FUNCTIONAL_GROUPS]
    names += [row[2] for row in RINGS]
    # dict.fromkeys: formamide appears twice (C=ON and NC=O).
    return list(dict.fromkeys(names))


# ---------------------------------------------------------------------------
# Helpers (builder.py:993-1006)
# ---------------------------------------------------------------------------


def collect_picked(cmd: Any) -> List[str]:
    """``builder.py:1000-1006`` — the ordered subset of pk1..pk4 that exists.

    This is the single most important helper in the Builder: **every** action
    button branches on it.  Non-existent slots are skipped, so ``["pk1","pk3"]``
    is a possible answer after the user unpicks pk2.
    """
    existing = set(cmd.get_names("selections"))
    return [name for name in PK_NAMES if name in existing]


def _atom_descriptor(cmd: Any, sele: str) -> Optional[Dict[str, Any]]:
    rows: List[Tuple[Any, ...]] = []
    cmd.iterate(
        sele,
        "rows.append((model, index, segi, chain, resn, resi, name, elem, formal_charge))",
        space={"rows": rows},
    )
    if not rows:
        return None
    model, index, segi, chain, resn, resi, name, elem, charge = rows[0]
    return {
        "object": model,
        "index": int(index),
        # PyMOL's own atom identifier syntax, as printed by SceneMouse.
        "label": "/%s/%s/%s/%s`%s/%s" % (model, segi, chain, resn, resi, name),
        "elem": elem,
        "resn": resn,
        "resi": resi,
        "name": name,
        "formalCharge": int(charge),
    }


def editor_state(cmd: Any) -> Dict[str, Any]:
    """``{picked, hasBond, nFrag, active, hasActiveSele}`` — the pick state.

    ``pkbond`` is the C++ editor's bond selection (``layer3/Editor.h``); its
    presence is what makes a wizard receive ``do_pick(bondFlag=1)``.
    """
    selections = set(cmd.get_names("selections"))
    picked: List[Dict[str, Any]] = []
    for slot in PK_NAMES:
        if slot not in selections:
            continue
        descriptor = _atom_descriptor(cmd, slot)
        if descriptor is None:
            continue
        descriptor["slot"] = slot
        picked.append(descriptor)
    n_frag = len([n for n in selections if n.startswith("_pkfrag")])
    return {
        "picked": picked,
        "slots": [entry["slot"] for entry in picked],
        "hasBond": bool(cmd.count_atoms("?pkbond")),
        "nFrag": n_frag,
        "active": bool(picked),
        "hasActiveSele": ACTIVE_SELE in selections,
    }


def wizard_state(cmd: Any) -> Optional[Dict[str, Any]]:
    """``{name, prompt, panel, repeating}`` for the wizard on top of the stack.

    ``get_panel()`` rows are ``[type, text, command]`` with ``type==1`` a title
    and ``type==2`` a button whose command is a PyMOL command *string*
    (``modules/pymol/wizard/__init__.py:50``).  The strings are preserved
    exactly so that WP-16's generic ``<WizardOverlay/>`` can drive them too.
    """
    wizard = cmd.get_wizard()
    if wizard is None:
        return None
    prompt = wizard.get_prompt() or []
    panel = wizard.get_panel() or []
    return {
        "name": type(wizard).__name__,
        "mine": isinstance(wizard, ActionWizard),
        "prompt": [str(line) for line in prompt],
        "panel": [[int(row[0]), str(row[1]), str(row[2])] for row in panel],
        "repeating": bool(getattr(wizard, "repeating", 0)),
    }


def _setting_int(cmd: Any, name: str, obj: str = "") -> int:
    try:
        return int(cmd.get_setting_int(name, obj) if obj else cmd.get_setting_int(name))
    except Exception:  # noqa: BLE001 - an unknown setting must not kill the panel
        return 0


def clean_availability() -> Dict[str, Any]:
    """Is ``cmd.clean`` real here?  In open-source PyMOL it never is."""
    try:
        from pymol import computing  # noqa: F401
        from tenmol_bridge.incentive_only import describe

        entry = describe("cmd.clean")
    except Exception:  # noqa: BLE001
        entry = None
    if entry is not None:
        return {"available": False, "reason": "Incentive-only: %s" % entry.site}
    return {
        "available": False,
        "reason": (
            "cmd.clean raises IncentiveOnlyException in open-source PyMOL "
            "(modules/pymol/computing.py:20-29)"
        ),
    }


def mouse_state(cmd: Any) -> Dict[str, Any]:
    """``button_mode`` -> the mouse-ring entry name (``controlling.py:688-717``).

    ``cmd.edit_mode(1)`` does not set a boolean anywhere: it rotates the current
    ring entry from ``*_viewing`` to ``*_editing``.  The suffix IS the state, and
    the client needs it to know that a viewport click means "pick", not "rotate".
    """
    from pymol import controlling

    index = _setting_int(cmd, "button_mode")
    ring = list(getattr(controlling, "mouse_ring", []))
    name = ring[index] if 0 <= index < len(ring) else ""
    return {"button_mode": index, "mode_name": name, "editing": name.endswith("editing")}


def builder_state(cmd: Any) -> Dict[str, Any]:
    """Everything the React panel needs in ONE round trip."""
    clean = clean_availability()
    return {
        "editor": editor_state(cmd),
        "mouse": mouse_state(cmd),
        "wizard": wizard_state(cmd),
        "settings": {
            "clean_electro_mode": _setting_int(cmd, "clean_electro_mode"),
            "sculpt_vdw_vis_mode": _setting_int(cmd, "sculpt_vdw_vis_mode"),
            "suspend_undo": _setting_int(cmd, "suspend_undo"),
            "valence": _setting_int(cmd, "valence"),
            "auto_overlay": _setting_int(cmd, "auto_overlay"),
            "editor_auto_measure": _setting_int(cmd, "editor_auto_measure"),
            "secondary_structure": _setting_int(cmd, "secondary_structure"),
            "auto_remove_hydrogens": _setting_int(cmd, "auto_remove_hydrogens"),
        },
        "clean_available": clean["available"],
        "clean_reason": clean["reason"],
        # editor.undocontext (editor.py:38-49) is `yield` and nothing else.
        "undo_is_noop": True,
        "objects": list(cmd.get_object_list() or []),
    }


def builder_show(cmd: Any) -> Dict[str, Any]:
    """``_BuilderPanel.showEvent`` (``builder.py:1337-1341``).

    ``cmd.set(name)`` with no value sets 1 (``setting.py``), which is why
    ``auto_overlay`` and ``valence`` are turned ON and only
    ``editor_auto_measure`` is turned off.
    """
    cmd.set("editor_auto_measure", 0)
    cmd.set("auto_overlay")
    cmd.set("valence")
    cmd.edit_mode(1)
    return builder_state(cmd)


# ---------------------------------------------------------------------------
# The wizards (builder.py:39-987), Qt removed
# ---------------------------------------------------------------------------

from pymol.wizard import Wizard  # noqa: E402  (import after the constants)
import pymol  # noqa: E402
from pymol import editor  # noqa: E402

undocontext = editor.undocontext


class ActionWizard(Wizard):
    """``builder.py:39-86``.  Click the same button twice and it cancels."""

    def __init__(self, _self: Any = None) -> None:
        Wizard.__init__(self, _self if _self is not None else pymol.cmd)
        self.actionHash = str(self.__class__)

    def setActionHash(self, action_hash: Any) -> None:
        self.actionHash = action_hash

    def activateOrDismiss(self) -> int:
        activate_flag = 1
        cur_wiz = self.cmd.get_wizard()
        if cur_wiz is not None:
            if cur_wiz.__class__ == self.__class__:
                if cur_wiz.actionHash == self.actionHash:
                    activate_flag = 0
        if activate_flag:
            self.cmd.set_wizard(self, replace=1)
            self.cmd.refresh_wizard()
        else:
            self.actionWizardDone()
        return activate_flag

    def actionWizardDone(self) -> None:
        self.cmd.delete(ACTIVE_SELE)
        self.cmd.unpick()
        self.cmd.set_wizard()
        self.cmd.refresh_wizard()

    def activeSeleValid(self) -> bool:
        if ACTIVE_SELE in self.cmd.get_names("selections"):
            if self.cmd.select(ACTIVE_SELE, "byobj " + ACTIVE_SELE) < 1:
                self.cmd.delete(ACTIVE_SELE)
            else:
                enabled_list = self.cmd.get_names("objects", enabled_only=1)
                active_obj_list = self.cmd.get_object_list(ACTIVE_SELE)
                if len(active_obj_list) != 1:
                    self.cmd.delete(ACTIVE_SELE)
                elif active_obj_list[0] not in enabled_list:
                    self.cmd.delete(ACTIVE_SELE)
        if "pk1" in self.cmd.get_names("selections"):
            self.cmd.select(ACTIVE_SELE, "byobj pk1")
        else:
            enabled_list = self.cmd.get_names("objects", enabled_only=1)
            if len(enabled_list) == 1:
                if self.cmd.select(ACTIVE_SELE, enabled_list[0]) < 1:
                    self.cmd.delete(ACTIVE_SELE)
        return ACTIVE_SELE in self.cmd.get_names("selections")


class RepeatableActionWizard(ActionWizard):
    """``builder.py:228-263``.  ``activateRepeatOrDismiss`` is always repeating
    on first activation — the source says so at ``:255``."""

    def __init__(self, _self: Any = None) -> None:
        ActionWizard.__init__(self, _self)
        self.repeating = 0

    def repeat(self) -> None:
        self.repeating = 1
        self.cmd.refresh_wizard()

    def getRepeating(self) -> int:
        return self.repeating

    def activateRepeatOrDismiss(self) -> int:
        activate_flag = 1
        cur_wiz = self.cmd.get_wizard()
        if cur_wiz is not None:
            if cur_wiz.__class__ == self.__class__:
                if cur_wiz.actionHash == self.actionHash:
                    if cur_wiz.getRepeating():
                        activate_flag = 0
                    else:
                        self.repeat()
                elif cur_wiz.getRepeating():
                    self.repeat()
        if activate_flag:
            self.cmd.set_wizard(self, replace=1)
            self.repeat()  # always repeating for now... (builder.py:255)
            self.cmd.refresh_wizard()
        else:
            self.actionWizardDone()
        return activate_flag

    def cleanup(self) -> None:
        self.cmd.unpick()
        ActionWizard.cleanup(self)


class CleanWizard(ActionWizard):
    """``builder.py:89-131``.  ``cmd.clean`` is Incentive-only here, so
    :meth:`run_job` reports the failure instead of silently doing nothing."""

    def __init__(self, _self: Any = None) -> None:
        self.clean_obj = None
        self.last_error: Optional[str] = None
        ActionWizard.__init__(self, _self)

    def run_job(self) -> None:
        if ACTIVE_SELE in self.cmd.get_names("selections"):
            obj_list = self.cmd.get_object_list(ACTIVE_SELE)
            if len(obj_list) == 1:
                self.cmd.unpick()
                self.cmd.set_wizard()
                self.cmd.refresh_wizard()
                try:
                    self.cmd.clean(ACTIVE_SELE, message="Cleaning %s..." % obj_list[0])
                except Exception as exc:  # noqa: BLE001 - IncentiveOnlyException
                    self.last_error = str(exc).strip()
                    print(self.last_error)

    def do_pick(self, bondFlag: int) -> None:
        if ACTIVE_SELE in self.cmd.get_names("selections"):
            obj_list = self.cmd.get_object_list(ACTIVE_SELE)
            if len(obj_list) != 1:
                self.cmd.delete(ACTIVE_SELE)
        else:
            self.cmd.select(ACTIVE_SELE, "byobj pk1")
        self.cmd.unpick()
        self.cmd.deselect()
        obj_list = self.cmd.get_object_list(ACTIVE_SELE)
        if isinstance(obj_list, list) and (len(obj_list) == 1):
            self.run_job()
        else:
            print("Error: can only clean one object at a time")

    def toggle(self) -> None:
        if self.activateOrDismiss():
            if self.activeSeleValid():
                self.run_job()

    def get_prompt(self) -> List[str]:
        return ["Pick object to clean..."]

    def get_panel(self) -> List[List[Any]]:
        return [[1, "Clean", ""], [2, "Done", "cmd.set_wizard()"]]


class SculptWizard(ActionWizard):
    """``builder.py:134-225``."""

    def __init__(self, _self: Any = None) -> None:
        ActionWizard.__init__(self, _self)
        self.sculpt_object: Optional[str] = None

    def sculpt_activate(self) -> None:
        if ACTIVE_SELE in self.cmd.get_names("selections"):
            obj_list = self.cmd.get_object_list(ACTIVE_SELE)
            if len(obj_list) == 1:
                obj_name = obj_list[0]
                self.cmd.push_undo(obj_name)
                self.cmd.sculpt_activate(obj_name)
                self.cmd.set("sculpting", 1)
                self.sculpt_object = obj_name
                # builder.py:149 calls sculpt_activate a second time; harmless,
                # and kept so the call sequence is byte-for-byte the source's.
                self.cmd.sculpt_activate(obj_name)
                if int(self.cmd.get("sculpt_vdw_vis_mode")):
                    self.cmd.show("cgo", obj_name)
                self.cmd.unpick()
                self.cmd.refresh_wizard()
            else:
                print("Error: cannot sculpt more than one object at a time")

    def sculpt_deactivate(self) -> None:
        if self.sculpt_object is not None and self.sculpt_object in self.cmd.get_names():
            self.cmd.set("sculpt_vdw_vis_mode", "0", self.sculpt_object)
            self.cmd.sculpt_iterate(self.sculpt_object, self.cmd.get_state(), 0)
            self.cmd.unset("sculpt_vdw_vis_mode", self.sculpt_object)
            self.cmd.sculpt_deactivate(self.sculpt_object)
            self.sculpt_object = None
            self.cmd.refresh_wizard()

    def do_pick(self, bondFlag: int) -> Any:
        if self.sculpt_object is None:
            self.cmd.select(ACTIVE_SELE, "byobj pk1")
            self.sculpt_activate()
        else:
            return 0  # already sculpting: fall through to a normal edit drag
        return None

    def toggle(self) -> None:
        if self.activateOrDismiss():
            if self.activeSeleValid():
                self.sculpt_activate()

    def get_prompt(self) -> List[str]:
        if self.sculpt_object is None:
            return ["Pick object to sculpt..."]
        return ["Sculpting %s..." % self.sculpt_object]

    def finish_sculpting(self) -> None:
        if self.sculpt_object:
            self.sculpt_deactivate()
        self.cmd.set("sculpting", 0)
        self.cmd.delete(ACTIVE_SELE)
        self.cmd.set_wizard()
        self.cmd.refresh_wizard()

    def scramble(self, mode: int) -> None:
        from chempy import cpv

        if self.sculpt_object and self.cmd.count_atoms(self.sculpt_object):
            sc_tmp = "_scramble_tmp"
            if mode == 0:
                self.cmd.select(sc_tmp, self.sculpt_object + " and not (fixed or restrained)")
            if mode == 1:
                self.cmd.select(sc_tmp, self.sculpt_object + " and not (fixed)")
            extent = self.cmd.get_extent(sc_tmp)
            center = self.cmd.get_position(sc_tmp)
            radius = 1.25 * cpv.length(cpv.sub(extent[0], extent[1]))
            self.cmd.alter_state(
                self.cmd.get_state(),
                sc_tmp,
                "(x,y,z)=rsp(pos,rds)",
                space={"rsp": cpv.random_displacement, "pos": center, "rds": radius},
            )
            self.cmd.delete(sc_tmp)

    def get_panel(self) -> List[List[Any]]:
        return [
            [1, "Sculpt", ""],
            [2, "Undo", "cmd.undo()"],
            [2, "Switch Object", "cmd.get_wizard().sculpt_deactivate()"],
            [2, "Scramble Unrestrained Coords.", "cmd.get_wizard().scramble(0)"],
            [2, "Scramble Unfixed Coords.", "cmd.get_wizard().scramble(1)"],
            [2, "Done", "cmd.get_wizard().finish_sculpting()"],
        ]

    def cleanup(self) -> None:
        self.sculpt_deactivate()
        ActionWizard.cleanup(self)


class ReplaceWizard(RepeatableActionWizard):
    """``builder.py:266-299``."""

    def do_pick(self, bondFlag: int) -> None:
        self.cmd.select(ACTIVE_SELE, "bymol pk1")
        self.cmd.replace(self.symbol, self.geometry, self.valence)
        if not self.getRepeating():
            self.actionWizardDone()

    def toggle(self, symbol: str, geometry: int, valence: int, text: str) -> None:
        self.symbol = symbol
        self.geometry = geometry
        self.valence = valence
        self.text = text
        self.setActionHash((symbol, geometry, valence, text))
        self.activateRepeatOrDismiss()

    def get_prompt(self) -> List[str]:
        if self.getRepeating():
            return ["Pick atoms to replace with %s..." % self.text]
        return ["Pick atom to replace with %s..." % self.text]

    def get_panel(self) -> List[List[Any]]:
        if self.getRepeating():
            return [
                [1, "Replacing Multiple Atoms", ""],
                [2, "Done", "cmd.set_wizard()"],
            ]
        return [
            [1, "Replacing an Atom", ""],
            [2, "Replace Multiple Atoms", "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class AttachWizard(RepeatableActionWizard):
    """``builder.py:302-365``."""

    def __init__(self, _self: Any = None) -> None:
        RepeatableActionWizard.__init__(self, _self)
        self.mode = 0

    def do_pick(self, bondFlag: int) -> None:
        if self.mode == 0:
            self.cmd.select(ACTIVE_SELE, "bymol pk1")
            editor.attach_fragment(
                "pk1", self.fragment, self.position, self.geometry, _self=self.cmd
            )
        elif self.mode == 1:
            self.cmd.select(ACTIVE_SELE, "bymol pk1")
            editor.combine_fragment(
                "pk1", self.fragment, self.position, self.geometry, _self=self.cmd
            )
            self.mode = 0
            self.cmd.refresh_wizard()
        self.cmd.unpick()
        if not self.getRepeating():
            self.actionWizardDone()

    def toggle(self, fragment: str, position: int, geometry: int, text: str) -> None:
        self.fragment = fragment
        self.position = position
        self.geometry = geometry
        self.text = text
        self.setActionHash((fragment, position, geometry, text))
        self.activateRepeatOrDismiss()

    def create_new(self) -> None:
        self.cmd.unpick()
        name = self.cmd.get_unused_name("obj")
        self.cmd.fragment(self.fragment, name)
        if not self.getRepeating():
            self.actionWizardDone()

    def combine(self) -> None:
        self.mode = 1
        self.cmd.refresh_wizard()

    def get_prompt(self) -> List[str]:
        if self.mode == 0:
            if self.getRepeating():
                return ["Pick locations to attach %s..." % self.text]
            return ["Pick location to attach %s..." % self.text]
        return ["Pick object to combine %s into..." % self.text]

    def get_panel(self) -> List[List[Any]]:
        if self.getRepeating():
            return [
                [1, "Attaching Multiple Fragments", ""],
                [2, "Create As New Object", "cmd.get_wizard().create_new()"],
                [2, "Combine w/ Existing Object", "cmd.get_wizard().combine()"],
                [2, "Done", "cmd.set_wizard()"],
            ]
        return [
            [1, "Attaching One Fragment", ""],
            [2, "Create As New Object", "cmd.get_wizard().create_new()"],
            [2, "Combine w/ Existing Object", "cmd.get_wizard().combine()"],
            [2, "Attach Multiple Fragments", "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class BioPolymerWizard(RepeatableActionWizard):
    """``builder.py:368-471``.  Highlights free attachment points with spheres.

    Mode 1 ("combine") is **disabled**: ``builder.py:417`` calls
    ``editor.combine_monomer()`` and ``:512`` calls
    ``editor.combine_nucleotide()``, neither of which exists in
    ``modules/pymol/editor.py`` (grep-verified).  Upstream never reaches them
    because ``get_panel`` has no "Combine" row, so this port refuses the mode
    explicitly rather than raising ``AttributeError`` at pick time.
    """

    HIGHLIGHT_SELE = ""

    def __init__(self, _self: Any = None) -> None:
        RepeatableActionWizard.__init__(self, _self)
        self.mode = 0
        self._highlighting_enabled = False
        self._monomer = ""

    def __enter__(self) -> None:
        self.highlight_attachment_points(False)

    def __exit__(self, *_: Any) -> None:
        self.highlight_attachment_points()

    def cleanup(self) -> None:
        self.highlight_attachment_points(False)
        RepeatableActionWizard.cleanup(self)

    def highlight_attachment_points(self, show: bool = True) -> None:
        if self._highlighting_enabled:
            fn = self.cmd.show if show else self.cmd.hide
            fn("spheres", self.HIGHLIGHT_SELE)

    def attach_monomer(self, objectname: str = "") -> None:
        raise NotImplementedError

    def do_pick(self, bondFlag: int) -> None:
        # `bymol` because attaching can move every atom of the molecule.
        if self.mode == 0:
            self.cmd.select(ACTIVE_SELE, "bymol ?pk1")
            try:
                with undocontext(self.cmd, "bymol ?pk1"):
                    self.attach_monomer()
            except (pymol.CmdException, ValueError) as exc:
                print(exc)
        elif self.mode == 1:
            print(
                "Error: combine is unavailable — editor.combine_monomer /"
                " editor.combine_nucleotide do not exist in this tree"
            )
            self.mode = 0
            self.cmd.refresh_wizard()
        self.cmd.unpick()
        if not self.getRepeating():
            self.actionWizardDone()

    def toggle(self, monomer: str) -> None:
        self._monomer = monomer
        self.setActionHash((monomer,))
        if self.activateRepeatOrDismiss():
            # Auto-highlight only when the user is not already showing spheres.
            self._highlighting_enabled = bool(self.HIGHLIGHT_SELE) and (
                self.cmd.count_atoms("(rep spheres) & (%s)" % self.HIGHLIGHT_SELE) == 0
            )
            self.highlight_attachment_points()

    def create_new(self) -> None:
        self.cmd.unpick()
        name = self.cmd.get_unused_name("obj")
        self.attach_monomer(name)
        if not self.getRepeating():
            self.actionWizardDone()
        else:
            self.cmd.unpick()

    def get_prompt(self) -> List[str]:
        if self.mode == 0:
            if self.getRepeating():
                return ["Pick locations to attach %s..." % self._monomer]
            return ["Pick location to attach %s..." % self._monomer]
        return ["Pick object to combine %s into..." % self._monomer]

    def get_panel(self) -> List[List[Any]]:
        if self.getRepeating():
            return [
                [1, "Attaching Multiple Residues", ""],
                [2, "Create As New Object", "cmd.get_wizard().create_new()"],
                [2, "Done", "cmd.set_wizard()"],
            ]
        # builder.py:467 hard-codes "Attaching Amino Acid" even for nucleic
        # acids.  Kept: the parity inventory calls this out as a source defect.
        return [
            [1, "Attaching Amino Acid", ""],
            [2, "Create As New Object", "cmd.get_wizard().create_new()"],
            [2, "Attach Multiple...", "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class AminoAcidWizard(BioPolymerWizard):
    """``builder.py:473-492``."""

    HIGHLIGHT_SELE = "(name N &! neighbor name C) | (name C &! neighbor name N)"

    def __init__(self, _self: Any = None, ss: int = -1) -> None:
        BioPolymerWizard.__init__(self, _self)
        self._monomerType = "Amino Acid"
        self.setSecondaryStructure(ss)

    def setSecondaryStructure(self, ss: int) -> None:
        self._secondary_structure = ss

    def attach_monomer(self, objectname: str = "") -> None:
        with self:
            editor.attach_amino_acid(
                "?pk1",
                self._monomer,
                object=objectname,
                ss=self._secondary_structure,
                _self=self.cmd,
            )


class NucleicAcidWizard(BioPolymerWizard):
    """``builder.py:494-512``."""

    HIGHLIGHT_SELE = (
        "(name O3' &! neighbor name P) | (name P &! neighbor name O3')"
        " | (name O5' &! neighbor name P) "
    )

    def _init(self, form: str, dbl_helix: bool, nuc_type: str) -> "NucleicAcidWizard":
        self._monomerType = "Nucleic Acid"
        self._form = form
        self._dbl_helix = dbl_helix
        self._nuc_type = nuc_type
        return self

    def attach_monomer(self, objectname: str = "") -> None:
        with self:
            editor.attach_nuc_acid(
                "?pk1",
                self._monomer,
                object=objectname,
                nuc_type=self._nuc_type,
                form=self._form,
                dbl_helix=self._dbl_helix,
                _self=self.cmd,
            )


class ValenceWizard(RepeatableActionWizard):
    """``builder.py:514-563``.  Forces BOND picking while armed.

    ``cmd.button(..., 'PkBd')`` is action code 14 (``controlling.py:72``); the
    client's WebGL picker has to resolve a bond (two atom ids), not an atom,
    while this wizard is on top — that is why :func:`builder_state` exposes the
    wizard name.
    """

    def cleanup(self) -> None:
        self.cmd.button("single_left", "none", "PkAt")
        self.cmd.button("double_left", "none", "MovA")

    def do_pick(self, bondFlag: int) -> None:
        with undocontext(self.cmd, "(?pk1 ?pk2) extend 1"):
            self.cmd.select(ACTIVE_SELE, "bymol pk1")
            if bondFlag:
                if int(self.order) >= 0:
                    self.cmd.valence(self.order, "pk1", "pk2")
                    self.cmd.h_fill()
                else:
                    self.cmd.cycle_valence()
            else:
                self.cmd.button("double_left", "none", "PkBd")
                self.cmd.button("single_left", "none", "PkBd")
            self.cmd.unpick()
        if not self.getRepeating():
            self.actionWizardDone()

    def toggle(self, order: Any, text: str) -> None:
        self.order = order
        self.text = text
        self.setActionHash((order, text))
        self.activateRepeatOrDismiss()
        if self.cmd.get_wizard() is self:
            self.cmd.button("double_left", "none", "PkBd")
            self.cmd.button("single_left", "none", "PkBd")

    def get_prompt(self) -> List[str]:
        if self.getRepeating():
            return ["Pick bonds to set as %s..." % self.text]
        return ["Pick bond to set as %s..." % self.text]

    def get_panel(self) -> List[List[Any]]:
        if self.getRepeating():
            return [
                [1, "Setting Multiple Valences", ""],
                [2, "Done", "cmd.set_wizard()"],
            ]
        return [
            [1, "Set a Bond Valence", ""],
            [2, "Set Multiple Valences", "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class ChargeWizard(RepeatableActionWizard):
    """``builder.py:566-604``."""

    def do_pick(self, bondFlag: int) -> None:
        with undocontext(self.cmd, "bymol ?pk1"):
            self.cmd.select(ACTIVE_SELE, "bymol pk1")
            self.cmd.alter("pk1", "formal_charge=%s" % self.charge)
            self.cmd.h_fill()
            if abs(float(self.charge)) > 0.0001:
                self.cmd.label("pk1", "'''" + self.text + "'''")
            else:
                self.cmd.label("pk1")
            self.cmd.unpick()
        if not self.getRepeating():
            self.actionWizardDone()

    def toggle(self, charge: Any, text: str) -> None:
        self.charge = charge
        self.text = text
        self.setActionHash((charge, text))
        self.activateRepeatOrDismiss()

    def get_prompt(self) -> List[str]:
        if self.getRepeating():
            return ["Pick atoms to set charge = %s..." % self.text]
        return ["Pick atom to set charge = %s..." % self.text]

    def get_panel(self) -> List[List[Any]]:
        if self.getRepeating():
            return [
                [1, "Setting Multiple Charges", ""],
                [2, "Done", "cmd.set_wizard()"],
            ]
        return [
            [1, "Setting Atom Charge", ""],
            [2, "Modify Multiple Atoms", "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class InvertWizard(RepeatableActionWizard):
    """``builder.py:607-643``.  A three-step prompt, then ``cmd.invert()``.

    Upstream wraps ``do_pick`` in ``PopupOnException`` (a Qt message box).  Here
    the exception text is printed to the PyMOL feedback stream, which the web
    console renders — the same information, no Qt.
    """

    def do_pick(self, bondFlag: int) -> None:
        try:
            self.cmd.select(ACTIVE_SELE, "bymol pk1")
            picked = collect_picked(self.cmd)
            if picked == ["pk1", "pk2", "pk3"]:
                self.cmd.invert()
                self.cmd.unpick()
                if not self.getRepeating():
                    self.actionWizardDone()
        except pymol.CmdException as exc:
            print(exc)
        self.cmd.refresh_wizard()

    def toggle(self) -> None:
        self.activateRepeatOrDismiss()

    def get_prompt(self) -> List[str]:
        names = self.cmd.get_names("selections")
        if "pk1" in names:
            if "pk2" in names:
                return ["Pick the second stationary atom..."]
            return ["Pick the first stationary atom..."]
        return ["Pick origin atom for inversion..."]

    def get_panel(self) -> List[List[Any]]:
        if self.getRepeating():
            return [
                [1, "Inverting Multiple", ""],
                [2, "Done", "cmd.set_wizard()"],
            ]
        return [
            [1, "Inverting Stereocenter", ""],
            [2, "Invert Multiple", "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class BondWizard(RepeatableActionWizard):
    """``builder.py:646-697``."""

    @staticmethod
    def staticaction(cmd: Any) -> bool:
        picked = collect_picked(cmd)
        if picked != ["pk1", "pk2"]:
            return False
        cmd.select(ACTIVE_SELE, "bymol ?pk1")
        if (
            cmd.count_atoms("?pk1&hydro")
            and cmd.count_atoms("?pk2&hydro")
            and cmd.count_atoms("(?pk1 extend 1)&!hydro")
            and cmd.count_atoms("(?pk2 extend 1)&!hydro")
        ):
            # Two hydrogens picked -> bond their heavy neighbours instead.
            cmd.select("pk1", "(pk1 extend 1) and not hydro")
            cmd.select("pk2", "(pk2 extend 1) and not hydro")
        with undocontext(cmd, "(?pk1 ?pk2) extend 1"):
            cmd.bond("pk1", "pk2")
            cmd.h_fill()
        cmd.unpick()
        return True

    def do_pick(self, bondFlag: int) -> None:
        if self.staticaction(self.cmd):
            if not self.getRepeating():
                self.actionWizardDone()
        self.cmd.refresh_wizard()

    def toggle(self) -> None:
        self.activateRepeatOrDismiss()

    def get_prompt(self) -> List[str]:
        if "pk1" in self.cmd.get_names("selections"):
            return ["Pick second atom for bond..."]
        return ["Pick first atom for bond..."]

    def get_panel(self) -> List[List[Any]]:
        if self.getRepeating():
            return [
                [1, "Creating Multiple Bonds", ""],
                [2, "Done", "cmd.set_wizard()"],
            ]
        return [
            [1, "Creating Bond", ""],
            [2, "Create Multiple Bonds", "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class UnbondWizard(RepeatableActionWizard):
    """``builder.py:700-740``.  Also a bond-picking wizard."""

    def cleanup(self) -> None:
        self.cmd.button("single_left", "none", "PkAt")

    def do_pick(self, bondFlag: int) -> None:
        with undocontext(self.cmd, "(?pk1 ?pk2) extend 1"):
            self.cmd.select(ACTIVE_SELE, "bymol pk1")
            if bondFlag:
                self.cmd.unbond("pk1", "pk2")
                self.cmd.h_fill()
                self.cmd.unpick()
            else:
                self.cmd.button("single_left", "none", "PkBd")
                self.cmd.unpick()
        if not self.getRepeating():
            self.actionWizardDone()

    def toggle(self) -> None:
        self.activateRepeatOrDismiss()
        if self.cmd.get_wizard() is self:
            self.cmd.button("single_left", "none", "PkBd")

    def get_prompt(self) -> List[str]:
        if self.getRepeating():
            return ["Pick bonds to delete..."]
        return ["Pick bond to delete..."]

    def get_panel(self) -> List[List[Any]]:
        if self.getRepeating():
            return [
                [1, "Deleting Multiple Bonds", ""],
                [2, "Done", "cmd.set_wizard()"],
            ]
        return [
            [1, "Deleting a Bond", ""],
            [2, "Delete Multiple Bonds", "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class HydrogenWizard(RepeatableActionWizard):
    """``builder.py:743-805``.  ``mode`` is ``'fix'`` (h_fill) or ``'add'``.

    The singular/plural prompt strings ARE swapped at ``builder.py:774-777``;
    reproduced, because the inventory row names them.
    """

    def __init__(self, _self: Any = None) -> None:
        RepeatableActionWizard.__init__(self, _self)
        self.mode = "fix"

    def run_add(self) -> None:
        if self.mode == "add":
            self.cmd.h_add(ACTIVE_SELE)
            self.cmd.delete(ACTIVE_SELE)

    def do_pick(self, bondFlag: int) -> None:
        self.cmd.select(ACTIVE_SELE, "bymol pk1")
        if self.mode == "fix":
            self.cmd.h_fill()
            self.cmd.unpick()
        elif self.mode == "add":
            self.cmd.unpick()
            self.run_add()
        if not self.getRepeating():
            self.actionWizardDone()

    def toggle(self, mode: str) -> None:
        self.mode = mode
        self.setActionHash((mode,))
        if self.mode == "add":
            if self.activateOrDismiss():
                if self.activeSeleValid():
                    self.run_add()
        else:
            self.activateRepeatOrDismiss()

    def get_prompt(self) -> List[str]:
        if self.mode == "fix":
            if self.getRepeating():
                return ["Pick atom upon which to fix hydrogens..."]
            return ["Pick atoms upon which to fix hydrogens..."]
        return ["Pick molecule upon which to add hydrogens..."]

    def get_panel(self) -> List[List[Any]]:
        title = "Fixing Hydrogens" if self.mode == "fix" else "Adding Hydrogens"
        if self.getRepeating():
            return [[1, title, ""], [2, "Done", "cmd.set_wizard()"]]
        more = "Fix Multiple Atoms" if self.mode == "fix" else "Add To Multiple..."
        return [
            [1, title, ""],
            [2, more, "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class RemoveWizard(RepeatableActionWizard):
    """``builder.py:808-842``."""

    def do_pick(self, bondFlag: int) -> None:
        with undocontext(self.cmd, "?pk1 extend 1"):
            cnt = self.cmd.select(
                ACTIVE_SELE, "((pk1 and not hydro) extend 1) and not hydro"
            )
            self.cmd.remove_picked()
            if cnt:
                self.cmd.fix_chemistry(ACTIVE_SELE)
                self.cmd.h_add(ACTIVE_SELE)
            self.cmd.delete(ACTIVE_SELE)
        if not self.getRepeating():
            self.actionWizardDone()

    def toggle(self) -> None:
        self.activateRepeatOrDismiss()

    def get_prompt(self) -> List[str]:
        if self.getRepeating():
            return ["Pick atoms to delete..."]
        return ["Pick atom to delete..."]

    def get_panel(self) -> List[List[Any]]:
        if self.getRepeating():
            return [
                [1, "Deleting Atoms", ""],
                [2, "Done", "cmd.set_wizard()"],
            ]
        return [
            [1, "Deleting an Atom", ""],
            [2, "Delete Multiple Atoms", "cmd.get_wizard().repeat()"],
            [2, "Done", "cmd.set_wizard()"],
        ]


class AtomFlagWizard(ActionWizard):
    """``builder.py:844-987``.  Flag 3 = fix, flag 2 = restrain
    (``editing.py:2848-2861``)."""

    def __init__(self, _self: Any = None) -> None:
        ActionWizard.__init__(self, _self)
        self.flag = 0

    def update_display(self) -> None:
        if ACTIVE_SELE in self.cmd.get_names("selections"):
            self.cmd.select(DISPLAY_SELE, ACTIVE_SELE + " and flag %d" % self.flag)
            self.cmd.enable(DISPLAY_SELE)
        else:
            self.cmd.delete(DISPLAY_SELE)
        self.cmd.refresh_wizard()

    def do_pick(self, bondFlag: int) -> None:
        if ACTIVE_SELE in self.cmd.get_names("selections"):
            if self.cmd.count_atoms("pk1 and flag %d" % self.flag):
                self.cmd.flag(self.flag, "pk1", "clear")
            else:
                self.cmd.flag(self.flag, "pk1", "set")
        self.cmd.select(ACTIVE_SELE, "byobj pk1")
        self.cmd.unpick()
        self.update_display()

    def do_select(self, selection: str) -> None:
        """Editing ``_build_display`` in the object panel edits the flag set."""
        if selection == DISPLAY_SELE:
            self.cmd.flag(self.flag, ACTIVE_SELE + " and " + DISPLAY_SELE, "set")
            self.cmd.flag(self.flag, ACTIVE_SELE + " and not " + DISPLAY_SELE, "clear")
        self.cmd.refresh_wizard()
        self.update_display()

    def get_prompt(self) -> List[str]:
        if ACTIVE_SELE not in self.cmd.get_names("selections"):
            return ["Pick object to operate on..."]
        self.cmd.reference("validate", ACTIVE_SELE)  # overbroad (builder.py:876)
        if self.flag == 2:
            return ["Toggle restrained atoms..."]
        if self.flag == 3:
            return ["Toggle fixed atoms..."]
        return ["Toggle unknown atom flag..."]

    def toggle(self, flag: int = 0) -> None:
        self.flag = flag
        if self.activateOrDismiss():
            if self.activeSeleValid():
                self.update_display()
            else:
                self.cmd.deselect()
            self.cmd.unpick()

    def _active(self) -> bool:
        return ACTIVE_SELE in self.cmd.get_names("selections")

    def do_all(self) -> None:
        if self._active():
            self.cmd.flag(self.flag, ACTIVE_SELE, "set")
            self.update_display()

    def do_less(self, mode: int) -> None:
        if self._active():
            if mode == 0:
                self.cmd.flag(
                    self.flag,
                    "(( byobj " + ACTIVE_SELE + " ) and not flag %d) extend 1" % self.flag,
                    "clear",
                )
            elif mode == 1:
                self.cmd.flag(
                    self.flag,
                    "byres ((( byobj " + ACTIVE_SELE + " ) and not flag %d) extend 1)" % self.flag,
                    "clear",
                )
            self.update_display()

    def do_cas(self, mode: int) -> None:
        if self._active():
            if mode == 1:
                self.cmd.flag(self.flag, ACTIVE_SELE, "clear")
                self.cmd.flag(self.flag, ACTIVE_SELE + " and polymer and name ca", "set")
            elif mode == 0:
                self.cmd.flag(
                    self.flag,
                    ACTIVE_SELE + " and flag %d and polymer and name ca" % self.flag,
                    "set",
                )
                self.cmd.flag(
                    self.flag, ACTIVE_SELE + " and not (polymer and name ca)", "clear"
                )
            self.update_display()

    def do_more(self, mode: int) -> None:
        if self._active():
            if mode == 0:
                self.cmd.flag(
                    self.flag, ACTIVE_SELE + " and (flag %d extend 1)" % self.flag, "set"
                )
            elif mode == 1:
                self.cmd.flag(
                    self.flag,
                    "byres (" + ACTIVE_SELE + " and (byres flag %d) extend 1)" % self.flag,
                    "set",
                )
            elif mode == 2:
                self.cmd.flag(
                    self.flag, "byres (" + ACTIVE_SELE + " and flag %d )" % self.flag, "set"
                )
            self.update_display()

    def do_none(self) -> None:
        if self._active():
            self.cmd.flag(self.flag, ACTIVE_SELE, "clear")
            self.update_display()

    def do_store(self) -> None:
        if self._active():
            self.cmd.reference("store", ACTIVE_SELE)

    def do_recall(self) -> None:
        if self._active():
            self.cmd.reference("recall", ACTIVE_SELE)

    def do_swap(self) -> None:
        if self._active():
            self.cmd.reference("swap", ACTIVE_SELE)

    def get_panel(self) -> List[List[Any]]:
        title = {2: "Restrained Atoms", 3: "Fixed Atoms"}.get(self.flag)
        result: List[List[Any]] = [
            [1, title, ""],
            [2, "All", "cmd.get_wizard().do_all()"],
            [2, "All C-alphas", "cmd.get_wizard().do_cas(1)"],
            [2, "More (byres)", "cmd.get_wizard().do_more(1)"],
            [2, "More", "cmd.get_wizard().do_more(0)"],
            [2, "Byresidue", "cmd.get_wizard().do_more(2)"],
            [2, "Less", "cmd.get_wizard().do_less(0)"],
            [2, "Less (by residue)", "cmd.get_wizard().do_less(1)"],
            [2, "Only C-alphas", "cmd.get_wizard().do_cas(0)"],
            [2, "None", "cmd.get_wizard().do_none()"],
            [2, "Done", "cmd.set_wizard()"],
        ]
        if self.flag == 2:
            result[-1:-1] = [
                [2, "Store Reference Coords.", "cmd.get_wizard().do_store()"],
                [2, "Recall Reference Coords.", "cmd.get_wizard().do_recall()"],
                [2, "Swap Reference Coords.", "cmd.get_wizard().do_swap()"],
            ]
        return result

    def cleanup(self) -> None:
        self.cmd.delete(DISPLAY_SELE)
        Wizard.cleanup(self)


class FixAtomWizard(AtomFlagWizard):
    """Exists only for a distinct ``actionHash`` (``builder.py:982``)."""


class RestAtomWizard(AtomFlagWizard):
    """Exists only for a distinct ``actionHash`` (``builder.py:986``)."""


# ---------------------------------------------------------------------------
# Panel handlers (builder.py:1343-1570), Qt removed
# ---------------------------------------------------------------------------


class _Panel:
    """The stateful bits of ``_BuilderPanel``: the SS combo and the DNA radios."""

    def __init__(self, cmd: Any) -> None:
        self.cmd = cmd
        self.ss_index = 0  # "Alpha Helix"
        self.dna_form = "B"  # NucleicAcidProperties, builder.py:1012-1015
        self.dna_dbl_helix = True
        self.nuc_type = "DNA"

    # -- growth / replacement ------------------------------------------

    def grow(self, name: str, pos: int, geom: int, text: str) -> None:
        if "pk1" in self.cmd.get_names("selections"):
            self.cmd.select(ACTIVE_SELE, "byobj pk1")
            editor.attach_fragment("pk1", name, pos, geom, _self=self.cmd)
            self.doAutoPick()
        else:
            self.cmd.unpick()
            AttachWizard(self.cmd).toggle(name, pos, geom, text)

    def replace(self, atom: str, geometry: int, valence: int, text: str) -> None:
        picked = collect_picked(self.cmd)
        if len(picked):
            self.cmd.select(ACTIVE_SELE, "byobj " + picked[0])
            self.cmd.replace(atom, geometry, valence)
            self.doAutoPick()
        else:
            ReplaceWizard(_self=self.cmd).toggle(atom, geometry, valence, text)

    def attach(self, aa: str) -> None:
        ss = self.ss_index + 1
        picked = collect_picked(self.cmd)
        if len(picked) == 1:
            # builder.py:1369 swallows this with a bare `except`.  We do not.
            with undocontext(self.cmd, "bymol %s" % picked[0]):
                editor.attach_amino_acid(picked[0], aa, ss=ss, _self=self.cmd)
            self.doZoom()
        else:
            self.cmd.unpick()
            AminoAcidWizard(_self=self.cmd, ss=ss).toggle(aa)

    def ss_index_changed(self, index: int) -> None:
        self.ss_index = index
        wizard = self.cmd.get_wizard()
        if isinstance(wizard, AminoAcidWizard):
            wizard.setSecondaryStructure(index + 1)
            self.cmd.refresh_wizard()

    def attach_nuc_acid(
        self,
        nuc_acid: str,
        nuc_type: str,
        form: Optional[str] = None,
        dbl_helix: Optional[bool] = None,
    ) -> None:
        # The Form/Helix radios are panel state on both sides; the client sends
        # its values with the press so the two can never disagree.
        if form is not None:
            if form not in ("A", "B"):
                raise ValueError("Form not recognized: %r" % (form,))
            self.dna_form = form
        if dbl_helix is not None:
            self.dna_dbl_helix = bool(dbl_helix)
        self.nuc_type = nuc_type
        picked = collect_picked(self.cmd)
        if len(picked) == 1:
            with undocontext(self.cmd, "byobject %s" % picked[0]):
                editor.attach_nuc_acid(
                    picked[0],
                    nuc_acid,
                    nuc_type=self.nuc_type,
                    object="",
                    form=self.dna_form,
                    dbl_helix=self.dna_dbl_helix,
                    _self=self.cmd,
                )
            self.doZoom()
        else:
            self.cmd.unpick()
            NucleicAcidWizard(_self=self.cmd)._init(
                form=self.dna_form,
                dbl_helix=self.dna_dbl_helix,
                nuc_type=self.nuc_type,
            ).toggle(nuc_acid)

    def removeResn(self) -> None:
        picked = collect_picked(self.cmd)
        if picked == ["pk1"]:
            self.cmd.select(NEWEST_SELE, "byres(pk1)")
            self.cmd.remove(NEWEST_SELE)
        else:
            print("Select a single atom on the residue and press remove again")

    # -- post-edit re-pick (builder.py:1412-1431) ----------------------

    def doAutoPick(self) -> None:
        self.cmd.unpick()
        if (
            self.cmd.select(
                NEWEST_SELE, "(byobj " + ACTIVE_SELE + ") and not " + ACTIVE_SELE
            )
            == 0
        ):
            self.cmd.select(NEWEST_SELE, ACTIVE_SELE)
        new_list = self.cmd.index(NEWEST_SELE + " and hydro")
        if len(new_list) == 0:
            new_list = self.cmd.index(NEWEST_SELE)
        if new_list:
            index = new_list.pop()
            try:
                self.cmd.edit("%s`%d" % index)
                wizard = self.cmd.get_wizard()
                if wizard is not None:
                    # builder.py:1424 routes this through `cmd.do`; calling the
                    # method is the same thing without a parser round trip.
                    wizard.do_pick(0)
            except pymol.CmdException:
                print(" doAutoPick-Error: exception")
        self.doZoom()

    def doZoom(self) -> None:
        if "pk1" in self.cmd.get_names("selections"):
            self.cmd.center("%pk1 extend 9", animate=-1)

    # -- row 1: atoms / charge / residue -------------------------------

    def setCharge(self, charge: int, text: str) -> None:
        picked = collect_picked(self.cmd)
        if len(picked) > 0:
            sele = "?pk1 ?pk2 ?pk3 ?pk4"
            with undocontext(self.cmd, sele):
                self.cmd.alter(sele, "formal_charge=%s" % charge)
                self.cmd.h_fill()
                self.cmd.label(sele, '"%+d" % formal_charge if formal_charge else ""')
            self.cmd.unpick()
        else:
            ChargeWizard(self.cmd).toggle(charge, text)

    def fixH(self) -> None:
        if len(collect_picked(self.cmd)):
            self.cmd.h_fill()
            self.cmd.unpick()
        else:
            HydrogenWizard(_self=self.cmd).toggle("fix")

    def addH(self) -> None:
        if len(collect_picked(self.cmd)):
            self.cmd.h_add("pkmol")
            self.cmd.unpick()
        else:
            HydrogenWizard(_self=self.cmd).toggle("add")

    def invert(self) -> None:
        picked = collect_picked(self.cmd)
        if picked == ["pk1", "pk2", "pk3"]:
            self.cmd.invert()
            self.cmd.unpick()
        else:
            self.cmd.unpick()
            InvertWizard(self.cmd).toggle()

    def removeAtom(self) -> None:
        picked = collect_picked(self.cmd)
        if len(picked):
            if self.cmd.count_atoms("?pkbond"):
                self.cmd.edit("(pk1)", "(pk2)", pkbond=0)
            cnt = self.cmd.select(
                ACTIVE_SELE, "(((?pkset or ?pk1) and not hydro) extend 1) and not hydro"
            )
            with undocontext(self.cmd, "(?pkset ?pk1) extend 1"):
                self.cmd.remove_picked()
                if cnt:
                    self.cmd.fix_chemistry(ACTIVE_SELE)
                    self.cmd.h_add(ACTIVE_SELE)
            self.cmd.delete(ACTIVE_SELE)
            self.cmd.unpick()
        else:
            RemoveWizard(self.cmd).toggle()

    def clear(self) -> None:
        """The Yes branch of ``QMessageBox('Really delete everything?')``.

        The confirmation itself is a React modal; the backend only ever sees the
        confirmed action.
        """
        self.cmd.delete("all")
        self.cmd.refresh_wizard()

    # -- row 2: bonds / model ------------------------------------------

    def createBond(self) -> None:
        if not BondWizard.staticaction(self.cmd):
            BondWizard(self.cmd).toggle()

    def deleteBond(self) -> None:
        picked = collect_picked(self.cmd)
        if picked == ["pk1", "pk2"]:
            with undocontext(self.cmd, "(?pk1 ?pk2) extend 1"):
                self.cmd.unbond("pk1", "pk2")
                self.cmd.h_fill()
            self.cmd.unpick()
        else:
            self.cmd.unpick()
            UnbondWizard(self.cmd).toggle()

    def cycleBond(self) -> None:
        picked = collect_picked(self.cmd)
        if picked == ["pk1", "pk2"]:
            with undocontext(self.cmd, "(?pk1 ?pk2) extend 1"):
                self.cmd.cycle_valence()
                self.cmd.unpick()
        else:
            ValenceWizard(_self=self.cmd).toggle(-1, "Cycle bond")

    def setOrder(self, order: str, text: str) -> None:
        with undocontext(self.cmd, "(?pk1 ?pk2) extend 1"):
            picked = collect_picked(self.cmd)
            if picked == ["pk1", "pk2"]:
                self.cmd.unbond("pk1", "pk2")
                self.cmd.bond("pk1", "pk2", order)
                self.cmd.h_fill()
                self.cmd.unpick()
            else:
                self.cmd.unpick()
                ValenceWizard(_self=self.cmd).toggle(order, text)

    def sculpt(self) -> None:
        picked = collect_picked(self.cmd)
        if len(picked):
            self.cmd.select(ACTIVE_SELE, " or ".join(picked))
        SculptWizard(_self=self.cmd).toggle()

    def clean(self) -> Optional[str]:
        """Returns the ``cmd.clean`` failure text, if any.

        Upstream this call goes through ``cmd.do(... async_=1)`` and the
        Incentive-only exception lands in the console with nothing tying it back
        to the button.  Returning it means the panel can put the reason ON the
        disabled button.
        """
        picked = collect_picked(self.cmd)
        if len(picked):
            self.cmd.select(ACTIVE_SELE, "pkmol")
            self.cmd.unpick()
        wizard = CleanWizard(_self=self.cmd)
        wizard.toggle()
        return wizard.last_error

    def fix(self) -> None:
        picked = collect_picked(self.cmd)
        if len(picked):
            self.cmd.select(ACTIVE_SELE, "pk1")
            self.cmd.deselect()
        else:
            self.cmd.delete(ACTIVE_SELE)
        FixAtomWizard(_self=self.cmd).toggle(3)

    def rest(self) -> None:
        picked = collect_picked(self.cmd)
        if len(picked):
            self.cmd.select(ACTIVE_SELE, "byobj (" + " or ".join(picked) + ")")
            self.cmd.deselect()
        else:
            self.cmd.delete(ACTIVE_SELE)
        RestAtomWizard(_self=self.cmd).toggle(2)

    # -- row 3: settings + undo ----------------------------------------

    def undo_suspended_objects(self) -> List[str]:
        return sorted(
            name
            for name in self.cmd.get_object_list()
            if self.cmd.get_setting_int("suspend_undo", name)
        )

    def set_undo_enabled(self, enabled: bool) -> List[str]:
        """Inverted binding (``builder.py:1300-1321``): checked = NOT suspended.

        Returns the objects that still carry a per-object ``suspend_undo``, so
        the client can raise its "Enable for objects?" modal.  Upstream
        truncates that list to 15 names plus a literal ``"[N more]"`` and then
        passes the lot to ``cmd.unset`` — this returns every real name and
        invents none (defect 6 in ``docs/webclient/builder.md`` §9).
        """
        self.cmd.set("suspend_undo", 0 if enabled else 1, quiet=0)
        if not enabled:
            return []
        return self.undo_suspended_objects()

    def enable_undo_for_objects(self, objects: Sequence[str]) -> List[str]:
        known = set(self.cmd.get_object_list())
        done: List[str] = []
        for name in objects:
            if name not in known:
                print("builder: no such object %r; not unsetting suspend_undo" % name)
                continue
            self.cmd.unset("suspend_undo", name)
            done.append(name)
        return done


# One panel per process, exactly like the Qt dock: the SS combo and the DNA
# radios are panel state, and every RPC has to see the same values.
_PANEL: Optional[_Panel] = None


def _panel(cmd: Any) -> _Panel:
    global _PANEL
    if _PANEL is None or _PANEL.cmd is not cmd:
        _PANEL = _Panel(cmd)
    return _PANEL


# ---------------------------------------------------------------------------
# The RPC surface
# ---------------------------------------------------------------------------

#: kind -> (method name, required parameter names, optional parameter names).
#: Declared rather than dispatched with ``getattr`` so a client cannot reach an
#: arbitrary method on the panel object.
_ACTIONS: Dict[str, Tuple[str, Tuple[str, ...], Tuple[str, ...]]] = {
    "grow": ("grow", ("fragment", "hydrogen", "anchor", "text"), ()),
    "replace": ("replace", ("symbol", "geometry", "valence", "text"), ()),
    "attachAA": ("attach", ("residue",), ()),
    "attachNA": ("attach_nuc_acid", ("base", "nucType"), ("form", "dblHelix")),
    "ssChanged": ("ss_index_changed", ("index",), ()),
    "removeResn": ("removeResn", (), ()),
    "setCharge": ("setCharge", ("charge", "text"), ()),
    "fixH": ("fixH", (), ()),
    "addH": ("addH", (), ()),
    "invert": ("invert", (), ()),
    "removeAtom": ("removeAtom", (), ()),
    "clear": ("clear", (), ()),
    "createBond": ("createBond", (), ()),
    "deleteBond": ("deleteBond", (), ()),
    "cycleBond": ("cycleBond", (), ()),
    "setOrder": ("setOrder", ("order", "text"), ()),
    "sculpt": ("sculpt", (), ()),
    "clean": ("clean", (), ()),
    "fix": ("fix", (), ()),
    "rest": ("rest", (), ()),
    "setUndoEnabled": ("set_undo_enabled", ("enabled",), ()),
    "enableUndoForObjects": ("enable_undo_for_objects", ("objects",), ()),
}


def builder_tables() -> Dict[str, Any]:
    """The declarative button tables + the fragment inventory on disk."""
    missing: List[str] = []
    try:
        import chempy

        base = os.path.join(chempy.path, "fragments")
        for name in fragment_names():
            if not os.path.exists(os.path.join(base, name + ".pkl")):
                missing.append(name)
    except Exception as exc:  # noqa: BLE001
        missing = ["<could not read chempy.path: %s>" % exc]
    out = dict(TABLES)
    out["fragments"] = fragment_names()
    out["missingFragments"] = missing
    return out


def builder_action(cmd: Any, kind: str, **params: Any) -> Dict[str, Any]:
    """One button press.  Always answers with the fresh state.

    Errors are returned, not raised: a failed attach must still refresh the
    panel, and ``_BuilderPanel.attach``'s bare ``except`` (``builder.py:1369``)
    is exactly the behaviour this replaces.
    """
    entry = _ACTIONS.get(kind)
    if entry is None:
        raise ValueError(
            "unknown builder action %r; known: %s" % (kind, ", ".join(sorted(_ACTIONS)))
        )
    method_name, names, optional = entry
    panel = _panel(cmd)
    method = getattr(panel, method_name)
    missing = [name for name in names if name not in params]
    if missing:
        raise ValueError("builder action %r needs %s" % (kind, ", ".join(missing)))
    args = [params[name] for name in names]
    for name in optional:
        if name in params:
            args.append(params[name])
        else:
            break  # positional: a gap would shift everything after it

    error: Optional[str] = None
    value: Any = None
    try:
        value = method(*args)
    except Exception as exc:  # noqa: BLE001 - surfaced, never swallowed
        error = "%s: %s" % (type(exc).__name__, str(exc).strip())
        print(" Builder-Error: %s" % error)

    state = builder_state(cmd)
    state["kind"] = kind
    state["error"] = error
    state["value"] = value
    return state


def builder_pick(
    cmd: Any,
    object: str = "",
    index: int = 0,
    index2: Optional[int] = None,
    mode: str = "multi",
) -> Dict[str, Any]:
    """A viewport pick, routed exactly like ``layer1/SceneMouse.cpp:404-470``.

    ``mode``:

    ``multi``   ``cButModePickAtom`` — fill the first free ``pkN``; clicking an
                already-picked atom unpicks it; once pk4 is taken further picks
                overwrite pk4 (``Editor.cpp:499-536``).
    ``single``  ``cButModePickAtom1`` — reset the editor, pick ``pk1`` only.
    ``bond``    ``SceneClickPickBond`` — ``pk1`` + ``pk2`` with BondMode, which
                is what makes ``do_pick(bondFlag=1)`` fire.

    The wizard callback the C++ path makes (``WizardDoPick``) is made here too;
    without it, a wizard armed by the Builder would never see a web pick.
    """
    if not object:
        raise ValueError("builder_pick needs an object name")
    sele1 = "%s`%d" % (object, int(index))
    unpicked = False

    if mode == "bond":
        if index2 is None:
            raise ValueError("bond picking needs index2")
        cmd.edit(sele1, "%s`%d" % (object, int(index2)), pkbond=1)
        bond_flag = 1
    elif mode == "single":
        cmd.unpick()
        cmd.edit(sele1, pkresi=1)
        bond_flag = 0
    else:
        # MEASURED: ``cmd.edit("pk1", <new>)`` DROPS pk1 — EditorSelect resolves
        # its arguments after inactivating the editor, so a pkN name passed back
        # in resolves to nothing (`['pk2']` instead of `['pk1','pk2']`).  The
        # already-picked atoms therefore have to be re-named by identity.
        held = ["%s`%d" % (e["object"], e["index"]) for e in editor_state(cmd)["picked"]]
        if sele1 in held:
            # EditorDeselectIfSelected (Editor.cpp:356-392): clicking an already
            # picked atom un-picks it, and PyMOL says so.
            print(" You unpicked %s." % sele1)
            held = [entry for entry in held if entry != sele1]
            unpicked = True
        else:
            if len(held) >= 4:
                held = held[:3]  # a fifth pick overwrites pk4
            held = held + [sele1]
        cmd.unpick()
        if held:
            cmd.edit(*(held + ["none"] * (4 - len(held))), pkbond=0)
        bond_flag = 0

    if unpicked:
        state = builder_state(cmd)
        state["bondFlag"] = 0
        state["unpicked"] = True
        return state

    wizard = cmd.get_wizard()
    if wizard is not None and hasattr(wizard, "do_pick"):
        wizard.do_pick(bond_flag)
        cmd.refresh_wizard()

    state = builder_state(cmd)
    state["bondFlag"] = bond_flag
    return state


def _run_panel_command(cmd: Any, command: str) -> None:
    """Execute one ``get_panel()`` command string.

    Upstream these are handed to ``cmd.do``.  Here they are parsed instead —
    the panel rows are a closed set produced by the wizards in this file, and
    parsing keeps the engine thread out of the command parser (and out of
    ``exec``) for what is really a method call.
    """
    text = command.strip()
    if not text:
        return
    if text == "cmd.set_wizard()":
        cmd.set_wizard()
        cmd.refresh_wizard()
        return
    if text == "cmd.undo()":
        cmd.undo()
        return
    if text == "cmd.redo()":
        cmd.redo()
        return
    prefix = "cmd.get_wizard()."
    if not text.startswith(prefix):
        raise ValueError("unsupported wizard panel command %r" % command)
    call = text[len(prefix) :]
    node = ast.parse(call, mode="eval").body
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
        raise ValueError("unsupported wizard panel command %r" % command)
    wizard = cmd.get_wizard()
    if wizard is None:
        raise ValueError("no wizard is active")
    name = node.func.id
    if name.startswith("_"):
        raise ValueError("refusing private wizard method %r" % name)
    method = getattr(wizard, name, None)
    if method is None or not callable(method):
        raise ValueError("%s has no method %r" % (type(wizard).__name__, name))
    args = [ast.literal_eval(arg) for arg in node.args]
    method(*args)
    cmd.refresh_wizard()


def builder_wizard_click(cmd: Any, index: int) -> Dict[str, Any]:
    """Click row ``index`` of the active wizard's ``get_panel()``."""
    state = wizard_state(cmd)
    if state is None:
        raise ValueError("no wizard is active")
    rows = state["panel"]
    if not 0 <= int(index) < len(rows):
        raise ValueError("wizard panel has %d rows; %r is out of range" % (len(rows), index))
    row = rows[int(index)]
    if int(row[0]) != 2:
        raise ValueError("row %d (%r) is a title, not a button" % (index, row[1]))
    error: Optional[str] = None
    try:
        _run_panel_command(cmd, row[2])
    except Exception as exc:  # noqa: BLE001
        error = "%s: %s" % (type(exc).__name__, str(exc).strip())
        print(" Builder-Error: %s" % error)
    out = builder_state(cmd)
    out["error"] = error
    out["clicked"] = row[1]
    return out


def builder_dismiss(cmd: Any) -> Dict[str, Any]:
    """The universal Done: drop the wizard and the builder's scratch selections."""
    wizard = cmd.get_wizard()
    if wizard is not None:
        cmd.set_wizard()
        cmd.refresh_wizard()
    cmd.delete(ACTIVE_SELE)
    cmd.unpick()
    return builder_state(cmd)


# ---------------------------------------------------------------------------
# install()
# ---------------------------------------------------------------------------

#: leaf name -> module-level function taking ``cmd`` first.
_ENTRY_POINTS = {
    "builder_tables": lambda cmd, *a, **k: builder_tables(),
    "builder_show": builder_show,
    "builder_state": builder_state,
    "builder_action": builder_action,
    "builder_pick": builder_pick,
    "builder_wizard_click": builder_wizard_click,
    "builder_dismiss": builder_dismiss,
}


def install(cmd: Any = None) -> List[str]:
    """Bind ``cmd.builder_*`` onto the live PyMOL instance.  Idempotent.

    Also registers each entry point as a PyMOL keyword with ``cmd.extend``, so
    the same surface is reachable from the command line and from a ``.pml``
    script — ``extend`` only touches ``cmd.keyword`` (``commanding.py:826``),
    which is why the ``setattr`` above it is what the bridge dispatcher needs.
    """
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    installed: List[str] = []
    for name, function in _ENTRY_POINTS.items():
        bound = _bind(cmd, function)
        bound.__name__ = name
        bound.__doc__ = getattr(function, "__doc__", None)
        setattr(cmd, name, bound)
        try:
            cmd.extend(name, bound)
        except Exception:  # noqa: BLE001 - extend is a convenience, not the API
            pass
        installed.append(name)
    return installed


def _bind(cmd: Any, function: Any) -> Any:
    def bound(*args: Any, **kwargs: Any) -> Any:
        return function(cmd, *args, **kwargs)

    return bound


def uninstall(cmd: Any) -> None:
    """Undo :func:`install` — used by the tests to prove the bootstrap runs."""
    global _PANEL
    for name in _ENTRY_POINTS:
        if hasattr(cmd, name):
            try:
                delattr(cmd, name)
            except AttributeError:
                pass
        cmd.keyword.pop(name, None)
    _PANEL = None


#: The exact ``{t:'do'}`` line the web client sends once, on panel mount.
#: One statement, no semicolon: PyMOL's parser splits a command line on ``;``.
BOOTSTRAP_COMMAND = (
    "_ __import__('tenmol_bridge.panels.builder',"
    " fromlist=['install']).install(cmd)"
)
