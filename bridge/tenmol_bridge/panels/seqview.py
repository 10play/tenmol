"""The sequence viewer ("Seeker") — a Python reconstruction of the C++ model.

OWNER: WP-21.  Inventory row §7 "In-viewport sequence viewer (Seeker)".

WHY THIS FILE EXISTS
--------------------
``layer3/Seeker.cpp:969`` (``SeekerUpdate``) builds the whole viewer — rows,
columns, colors, per-column atom lists, selection highlight — inside
``OrthoDoDraw``.  Nothing about it is reachable from Python:

* ``G->Seeker`` and ``G->Seq->Row`` are C++ structures with no accessor;
  ``SeqUpdate`` (``layer1/Seq.cpp:88``) is only ever called from ``OrthoDoDraw``.
* ``cmd.get_fastastr`` (``modules/pymol/exporting.py:170``) covers polymers only
  and carries no colors, no atom indices, no selection state, no gaps.

Our pump *does* draw every tick, so the C++ model really is built — but it is
built into a framebuffer, not into anything addressable.  Rather than invent an
accessor, this module **reconstructs the same model from `cmd.iterate`**, which
is the only per-atom readout that exposes ``color`` and ``flags``.
(``cmd.get_model`` is not a substitute: ``CoordSetAtomToChemPyAtom``,
``layer2/CoordSet.cpp:1057-1140``, emits no ``color`` field at all — verified on
this build.)

Every rule below is transcribed from the C++, with the line number:

  ``SeekerGetAbbr``            ``layer3/Seeker.cpp:685-906``   one-letter codes
  ``codes`` 0..5              ``:1259-1484``                  display modes
  gap insertion               ``:1230-1258``, ``MAXCONSECUTIVEGAPS`` ``:983``
  ``SeekerFindColor``         ``:908-926``
  label pass                  ``:1820-1914``
  offset pass                 ``:1548-1581``
  ``SeekerRefresh``           ``:475-525``  (``col->inverse``)
  ``SeekerSelectionToggle``   ``:169-246``  selection algebra
  ``SeekerSelectionCenter``   ``:248-315``
  ``ExecutiveGetActiveSeleName`` ``layer3/Executive.cpp:3433``
  ``SceneGetSeleModeKeyword`` ``layer1/Scene.cpp:504``

HOW THE CLIENT REACHES IT
-------------------------
The bridge dispatcher resolves ``{t:'call', fn:'cmd.<leaf>'}`` against
``engine.cmd``, which for ``pymol2.SingletonPyMOL`` **is** the ``pymol.cmd``
module (``modules/pymol2/__init__.py:53``).  :func:`install` binds this module's
entry points there, exactly the way a PyMOL plugin installs a command, so the
client bootstraps with one allowed call::

    cmd.do("from tenmol_bridge.panels import seqview; seqview.install()", 0, 0)
    cmd.tenmol_seqview('rows')

No edit to ``server.py`` and no policy grant is needed: ``cmd.do`` is an
explicitly allowed capability (plan §A6) and ``cmd.tenmol_seqview`` is an
ordinary two-segment name under the ``cmd`` root.  A ``_bridge.seqview`` route
would be tidier and is listed in this wave's hand-off notes.

Everything here is READ-ONLY with respect to PyMOL state except
:func:`select` / :func:`center` / :func:`set_state`, which are the three writes
Seeker itself performs.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

__all__ = [
    "ABBR",
    "ACTIONS",
    "ENTRY_POINT",
    "clear",
    "dispatch",
    "GAP_MODE_NONE",
    "GAP_MODE_ALL",
    "GAP_MODE_SINGLE",
    "MAXCONSECUTIVEGAPS",
    "MAX_ROWS",
    "SEL_MODE_KW",
    "TEMP_SELE",
    "TEMP_CENTER_SELE",
    "abbr",
    "active_sele_name",
    "build",
    "center",
    "collect_atoms",
    "install",
    "sele_mode_keyword",
    "select",
    "select_expression",
    "select_range",
    "set_state",
    "row_model",
    "DEFAULT_WINDOW",
    "MAX_CELLS_PER_FRAME",
]

# --------------------------------------------------------------------------
# Constants transcribed from C++
# --------------------------------------------------------------------------

#: ``layer3/Seeker.cpp:983``
MAXCONSECUTIVEGAPS = 9
#: ``layer3/Seeker.cpp:980`` ``max_row = 50``
MAX_ROWS = 50

GAP_MODE_NONE = 0
GAP_MODE_ALL = 1
GAP_MODE_SINGLE = 2

#: ``layer3/Seeker.h:25-27``
TEMP_SELE = "_seeker"
TEMP_CENTER_SELE = "_seeker_center"

#: ``SelModeKW``, ``layer1/Scene.cpp:459-467``.  Indexed by
#: ``mouse_selection_mode`` (setting 354, default 1).
SEL_MODE_KW: Tuple[str, ...] = (
    "",
    "byresi",
    "bychain",
    "bysegi",
    "byobject",
    "bymol",
    "bca.",
)

#: ``layer2/AtomInfo.h:103-116``
FLAG_POLYMER = 0x08000000
FLAG_SOLVENT = 0x10000000
FLAG_ORGANIC = 0x20000000
FLAG_INORGANIC = 0x40000000
FLAG_GUIDE = 0x80000000

#: ``SeekerGetAbbr``, ``layer3/Seeker.cpp:685-906``.  The C is a hand-written
#: nested switch on the first three characters; this is that switch as a table,
#: keyed by ``resn[:3]``.  ``None`` means "the water character" (``'O'`` at the
#: only call site, ``:1285``).  A resn absent from the table returns the
#: ``unknown`` argument — ``0`` at the call site, which makes the caller fall
#: back to the full residue name (``:1291-1303``).  That is why nucleic acids
#: ("A", "DA", "G") render as their full ``resn``: ``abbr[1]`` is NUL and no
#: branch matches.
ABBR: Dict[str, Optional[str]] = {
    "ALA": "A",
    "ARG": "R",
    "ASP": "D",
    "ASN": "N",
    "CYS": "C",
    "CYX": "C",
    "GLN": "Q",
    "GLU": "E",
    "GLY": "G",
    "HIS": "H",
    "HID": "H",
    "HIE": "H",
    "HOH": None,
    "H2O": None,
    "ILE": "I",
    "LEU": "L",
    "LYS": "K",
    "MET": "M",
    "MSE": "M",  # selenomethionine
    "PHE": "F",
    "PRO": "P",
    "SER": "S",
    "SEC": "U",  # selenocysteine
    "SOL": None,  # gromacs solvent
    "THR": "T",
    "TIP": None,
    "TRP": "W",
    "TYR": "Y",
    "VAL": "V",
    "WAT": None,
}


def abbr(resn: str, water: str = "O", unknown: str = "") -> str:
    """``SeekerGetAbbr`` (``layer3/Seeker.cpp:685``)."""
    hit = ABBR.get((resn or "")[:3].upper(), "\x00")
    if hit == "\x00":
        return unknown
    return water if hit is None else hit


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------


def _int(cmd: Any, name: str, obj: str = "", default: int = 0) -> int:
    try:
        value = cmd.get_setting_int(name, obj)
    except Exception:  # noqa: BLE001 - a missing setting must not kill the panel
        return default
    return default if value is None else int(value)


def _text(cmd: Any, name: str, obj: str = "", default: str = "") -> str:
    try:
        value = cmd.get_setting_text(name, obj)
    except Exception:  # noqa: BLE001
        return default
    return default if value is None else str(value)


def sele_mode_keyword(cmd: Any) -> str:
    """``SceneGetSeleModeKeyword`` (``layer1/Scene.cpp:504``)."""
    mode = _int(cmd, "mouse_selection_mode", "", 1)
    if 0 <= mode < len(SEL_MODE_KW):
        return SEL_MODE_KW[mode]
    return SEL_MODE_KW[0]


def active_sele_name(cmd: Any, create_new: bool = False) -> str:
    """``ExecutiveGetActiveSeleName`` (``layer3/Executive.cpp:3433``).

    The C walks the Spec list and keeps the **last** visible selection, then —
    only with ``create_new`` — mints ``sel%02d`` from ``sel_counter`` when
    ``auto_number_selections`` is on, else the literal name ``sele``.
    ``cmd.get_names('selections', enabled_only=1)`` walks the same list in the
    same order, so "the last one" is the same selection.
    """
    try:
        enabled = cmd.get_names("selections", enabled_only=1)
    except Exception:  # noqa: BLE001
        enabled = []
    if enabled:
        return str(enabled[-1])
    if not create_new:
        return ""
    if _int(cmd, "auto_number_selections", "", 0):
        number = _int(cmd, "sel_counter", "", 0) + 1
        cmd.set("sel_counter", number)
        name = "sel%02d" % number
    else:
        name = "sele"
    cmd.select(name, "none", enable=1)
    return name


# --------------------------------------------------------------------------
# Atom readout
# --------------------------------------------------------------------------

#: What one ``cmd.iterate`` pass collects, in object atom order.  ``index`` is
#: 1-based and is exactly what the ``index`` selection keyword takes.
_ITERATE_EXPR = (
    "_rows.append((index,chain,segi,resi,resv,resn,name,elem,color,flags,"
    "1 if type=='HETATM' else 0))"
)


class Atom(object):
    """One row of the ``cmd.iterate`` readout."""

    __slots__ = (
        "index",
        "chain",
        "segi",
        "resi",
        "resv",
        "resn",
        "name",
        "elem",
        "color",
        "flags",
        "hetatm",
    )

    def __init__(self, record: Sequence[Any]) -> None:
        (
            self.index,
            self.chain,
            self.segi,
            self.resi,
            self.resv,
            self.resn,
            self.name,
            self.elem,
            self.color,
            self.flags,
            self.hetatm,
        ) = record

    # ``AtomInfoSameResidue`` (``layer2/AtomInfo.cpp:2080``): resv, chain,
    # hetatm, discrete_state, inscode, segi, resn.  ``resi`` carries the
    # insertion code, so it stands in for resv+inscode.
    @property
    def residue_key(self) -> Tuple[Any, ...]:
        return (self.resv, self.resi, self.chain, self.segi, self.resn, self.hetatm)

    # ``AtomInfoSameChainP`` (``:2099``): chain AND segi.
    @property
    def chain_key(self) -> Tuple[Any, ...]:
        return (self.chain, self.segi)

    @property
    def is_polymer(self) -> bool:
        return bool(self.flags & FLAG_POLYMER)

    @property
    def is_guide(self) -> bool:
        return bool(self.flags & FLAG_GUIDE)

    @property
    def is_hetero_group(self) -> bool:
        """``organic | inorganic`` — the classes that get no abbreviation."""
        return bool(self.flags & (FLAG_ORGANIC | FLAG_INORGANIC))


def collect_atoms(cmd: Any, obj: str) -> List[Atom]:
    """One ``cmd.iterate`` pass over one object, in atom order."""
    rows: List[Any] = []
    cmd.iterate("%" + obj, _ITERATE_EXPR, space={"_rows": rows}, quiet=1)
    return [Atom(record) for record in rows]


def _atoms_in_state(cmd: Any, obj: str, state: int) -> Optional[set]:
    """1-based indices present in ``state`` — ``cs->atmToIdx(a) >= 0`` (``:1228``).

    ``None`` means "could not tell", and the caller then treats every atom as
    present rather than painting the whole row in ``seq_view_fill_color``.
    """
    present: set = set()
    try:
        cmd.iterate_state(
            state, "%" + obj, "_p.add(index)", space={"_p": present}, quiet=1
        )
    except Exception:  # noqa: BLE001
        return None
    return present or None


# --------------------------------------------------------------------------
# Column construction
# --------------------------------------------------------------------------


def _cell(
    text: str,
    color: int,
    atoms: Optional[List[int]] = None,
    spacer: bool = False,
    is_abbr: bool = False,
    hint_no_space: bool = False,
    state: int = 0,
    tag: int = 0,
    resi: str = "",
    chain: str = "",
    resn: str = "",
) -> Dict[str, Any]:
    return {
        "text": text,
        "color": int(color),
        "atoms": atoms or [],
        "spacer": spacer,
        "isAbbr": is_abbr,
        "hintNoSpace": hint_no_space,
        "selected": False,
        "state": state,
        "tag": tag,
        "resi": resi,
        "chain": chain,
        "resn": resn,
        "start": 0,
        "offset": 0,
    }


def _find_color(group: Sequence[Atom]) -> int:
    """``SeekerFindColor`` (``layer3/Seeker.cpp:908``).

    guide atom wins; else the LAST carbon in the residue; else the first atom.
    """
    result = group[0].color
    for atom in group:
        if atom.is_guide:
            return int(atom.color)
        if (atom.elem or "").upper() == "C":  # ``ai->protons == cAN_C``
            result = atom.color
    return int(result)


def _gaps_needed(previous: Optional[Atom], atom: Atom, gap_mode: int) -> int:
    """``layer3/Seeker.cpp:1230-1240`` — same chain, both polymer, no alignment."""
    if gap_mode == GAP_MODE_NONE or previous is None:
        return 0
    if previous.chain_key != atom.chain_key:
        return 0
    if not (previous.is_polymer and atom.is_polymer):
        return 0
    needed = int(atom.resv) - int(previous.resv) - 1
    if needed > 1 and gap_mode == GAP_MODE_SINGLE:
        return 1
    return max(needed, 0)


def _push_gaps(cells: List[Dict[str, Any]], needed: int, unit: str, collapsed: str,
               fill_color: int) -> None:
    """``push_gap`` (``layer3/Seeker.cpp:1249-1258``): one column per character."""
    if needed <= 0:
        return
    text = unit * needed if needed <= MAXCONSECUTIVEGAPS else collapsed
    for char in text:
        cells.append(_cell(char, fill_color, spacer=True))


def _residue_groups(atoms: Sequence[Atom]) -> List[List[Atom]]:
    groups: List[List[Atom]] = []
    key = object()
    for atom in atoms:
        if not groups or atom.residue_key != key:
            groups.append([atom])
            key = atom.residue_key
        else:
            groups[-1].append(atom)
    return groups


def _build_cells(
    cmd: Any,
    obj: str,
    atoms: Sequence[Atom],
    codes: int,
    gap_mode: int,
    default_color: int,
    fill_color: int,
    present: Optional[set],
) -> List[Dict[str, Any]]:
    cells: List[Dict[str, Any]] = []

    def colour_for(group: Sequence[Atom]) -> int:
        in_state = present is None or any(a.index in present for a in group)
        if not in_state:
            return fill_color
        if default_color < 0:
            return _find_color(group)
        return default_color

    if codes in (0, 1):
        previous: Optional[Atom] = None
        last_abbr = ""
        for group in _residue_groups(atoms):
            head = group[0]
            needed = _gaps_needed(previous, head, gap_mode)
            if codes == 0:
                _push_gaps(cells, needed, "-", "---...---", fill_color)
            else:
                _push_gaps(cells, needed, "--- ", "---...--- ", fill_color)
            previous = head

            if codes == 0:
                one = "" if head.is_hetero_group else abbr(head.resn, "O", "")
                if one:
                    cells.append(
                        _cell(
                            one,
                            colour_for(group),
                            [a.index for a in group],
                            is_abbr=True,
                            hint_no_space=bool(last_abbr) or needed > 0,
                            resi=head.resi,
                            chain=head.chain,
                            resn=head.resn,
                        )
                    )
                    last_abbr = one
                else:
                    cells.append(
                        _cell(
                            head.resn or "''",
                            colour_for(group),
                            [a.index for a in group],
                            hint_no_space=bool(last_abbr) or needed > 0,
                            resi=head.resi,
                            chain=head.chain,
                            resn=head.resn,
                        )
                    )
                    last_abbr = ""
            else:
                cells.append(
                    _cell(
                        head.resn or "''",
                        colour_for(group),
                        [a.index for a in group],
                        resi=head.resi,
                        chain=head.chain,
                        resn=head.resn,
                    )
                )
        return cells

    if codes == 2:  # atom names — one column per atom (``:1371-1395``)
        for atom in atoms:
            in_state = present is None or atom.index in present
            if not in_state:
                color = fill_color
            elif default_color < 0:
                color = int(atom.color)
            else:
                color = default_color
            cells.append(
                _cell(
                    atom.name or "''",
                    color,
                    [atom.index],
                    resi=atom.resi,
                    chain=atom.chain,
                    resn=atom.resn,
                )
            )
        return cells

    if codes == 3:  # chains (``:1396-1422``)
        key = object()
        group: List[Atom] = []
        for atom in atoms:
            if atom.chain_key != key:
                if group:
                    cells.append(_chain_cell(group, default_color))
                group = [atom]
                key = atom.chain_key
            else:
                group.append(atom)
        if group:
            cells.append(_chain_cell(group, default_color))
        return cells

    if codes == 4:  # state names (``:1423-1482``)
        n_states = 1
        try:
            n_states = max(int(cmd.count_states(obj)), 1)
        except Exception:  # noqa: BLE001
            n_states = 1
        all_atoms = [a.index for a in atoms]
        for number in range(1, n_states + 1):
            title = ""
            try:
                title = cmd.get_title(obj, number) or ""
            except Exception:  # noqa: BLE001
                title = ""
            cells.append(
                _cell(title or str(number), default_color, all_atoms, state=number)
            )
        return cells

    # codes == 5 (movie frames) is declared but empty in the C (``:1483-1484``).
    return cells


def _chain_cell(group: Sequence[Atom], default_color: int) -> Dict[str, Any]:
    head = group[0]
    color = _find_color(group) if default_color < 0 else default_color
    return _cell(
        head.chain or "''",
        color,
        [a.index for a in group],
        chain=head.chain,
    )


def _lay_out(cells: List[Dict[str, Any]], codes: int) -> int:
    """Character offsets — the FOURTH pass (``layer3/Seeker.cpp:1917-1943``).

    ``txt`` is one flat buffer per row; a column's ``start`` is its position in
    it and modes 1/2/3 append a trailing space after every column, mode 0 only
    after a non-abbreviated one.  Returns ``ext_len``.
    """
    position = 0
    for cell in cells:
        cell["start"] = position
        cell["offset"] = position
        position += len(cell["text"])
        if cell["spacer"]:
            continue
        if codes == 0:
            if not cell["isAbbr"]:
                position += 1
        else:
            position += 1
    return position


def _labels(
    cells: Sequence[Dict[str, Any]],
    atoms_by_index: Dict[int, Atom],
    codes: int,
    div: int,
    sub: int,
) -> List[Dict[str, Any]]:
    """The THIRD pass (``layer3/Seeker.cpp:1820-1914``).

    Draw every ``div`` residues offset by ``sub``; force at a sequence gap;
    force after ``2*div`` skips; never twice for the same residue; drop the
    label if it would overrun into a following one.
    """
    out: List[Dict[str, Any]] = []
    if codes == 4:
        return out
    next_open = 0
    n_skipped = 0
    last_resv: Optional[int] = None
    last_key: Optional[Tuple[Any, ...]] = None

    for column, cell in enumerate(cells):
        atom = None
        if cell["atoms"]:
            atom = atoms_by_index.get(cell["atoms"][0])
        if atom is not None and cell["offset"] >= next_open:
            if div > 1 and codes != 2:
                draw = (int(atom.resv) - sub) % div == 0
            else:
                draw = True
            if last_resv is None or int(atom.resv) != last_resv + 1:
                draw = True
            if n_skipped >= div + div:
                draw = True
            if last_key is not None and atom.residue_key == last_key:
                draw = False

            if draw:
                n_skipped = 0
                last_key = atom.residue_key
                text = (
                    "%s`%s" % (atom.resn, atom.resi) if codes == 2 else str(atom.resi)
                )
                out.append({"col": column, "offset": cell["offset"], "text": text})
                next_open = cell["offset"] + len(text) + 1
            else:
                n_skipped += 1
        if atom is not None:
            last_resv = int(atom.resv)
    return out


def _breadcrumbs(cells: Sequence[Dict[str, Any]],
                 atoms_by_index: Dict[int, Atom]) -> List[Dict[str, Any]]:
    """``/segi/chain/`` markers, re-emitted at every change (``:1147-1215``)."""
    out: List[Dict[str, Any]] = []
    last: Optional[Tuple[Any, ...]] = None
    for column, cell in enumerate(cells):
        if not cell["atoms"]:
            continue
        atom = atoms_by_index.get(cell["atoms"][0])
        if atom is None:
            continue
        key = (atom.segi, atom.chain)
        if key != last:
            last = key
            out.append(
                {
                    "col": column,
                    "offset": cell["offset"],
                    "text": "/%s/%s/" % (atom.segi or "", atom.chain or ""),
                }
            )
    return out


# --------------------------------------------------------------------------
# The payload
# --------------------------------------------------------------------------


#: Columns per row in one wire frame.  Seeker draws the whole row because it
#: draws into a framebuffer; a JSON frame cannot, and the WebSocket peers cap
#: at 1 MiB.  ``codes == 2`` on 1tii is 6,058 columns, so the payload is a
#: WINDOW and the client virtualises — which is what the React plan asks for
#: anyway ("a virtualized canvas/WebGL grid using the same offset math").
DEFAULT_WINDOW = 1200

#: Ceiling across all rows in one frame, so 50 objects cannot each send 1200.
MAX_CELLS_PER_FRAME = 4000


def _object_rows(cmd: Any, hide_underscore: int) -> List[str]:
    """Enabled molecular objects with ``seq_view`` on (``:991-993``, ``:980``)."""
    try:
        names = list(cmd.get_names("objects", enabled_only=1))
    except Exception:  # noqa: BLE001
        return []
    out: List[str] = []
    for name in names:
        if len(out) >= MAX_ROWS:
            break
        if hide_underscore and name.startswith("_"):
            continue
        try:
            if cmd.get_type(name) != "object:molecule":
                continue
        except Exception:  # noqa: BLE001
            continue
        if not _int(cmd, "seq_view", name, 0):
            continue
        out.append(name)
    return out


def row_model(cmd: Any, name: str, state: int = -1) -> Optional[Dict[str, Any]]:
    """The FULL, un-windowed column model for one object.

    Split out of :func:`build` because :func:`select_range` needs the same model
    the way ``SeekerSelectionToggleRange`` (``:70-167``) reads the row it is
    already holding — the client must never have to ship 6,000 atom indices back
    to name a range.
    """
    codes = _int(cmd, "seq_view_format", name, _int(cmd, "seq_view_format", "", 0))
    try:
        discrete = bool(cmd.count_discrete(name))
    except Exception:  # noqa: BLE001
        discrete = False
    # ``:1017-1020`` — discrete objects flip to state names.
    if discrete and _int(cmd, "seq_view_discrete_by_state", name, 1):
        codes = 4

    atoms = collect_atoms(cmd, name)
    if not atoms:
        return None

    gap_mode = _int(cmd, "seq_view_gap_mode", "", GAP_MODE_ALL)
    fill_color = _int(cmd, "seq_view_fill_color", "", 104)
    default_color = _int(cmd, "seq_view_color", name, -1)
    present = _atoms_in_state(cmd, name, state)

    cells = _build_cells(
        cmd, name, atoms, codes, gap_mode, default_color, fill_color, present
    )
    ext_len = _lay_out(cells, codes)
    atoms_by_index = {atom.index: atom for atom in atoms}
    div = max(_int(cmd, "seq_view_label_spacing", name, 5), 1)
    sub = _int(cmd, "seq_view_label_start", name, 1)

    try:
        object_color = int(cmd.get_object_color_index(name))
    except Exception:  # noqa: BLE001
        object_color = -1

    return {
        "object": name,
        "objectColor": object_color,
        "codes": codes,
        # ``:427`` — a non-discrete object in state mode is NOT selectable.
        "selectable": not (codes == 4 and not discrete),
        "discrete": discrete,
        "extLen": ext_len,
        "cells": cells,
        "labels": _labels(cells, atoms_by_index, codes, div, sub),
        "breadcrumbs": _breadcrumbs(cells, atoms_by_index),
    }


def _window(row: Dict[str, Any], first: int, count: int) -> Dict[str, Any]:
    """Slice a full row model down to the columns the client asked for."""
    cells = row["cells"]
    first = max(0, min(int(first), len(cells)))
    last = max(first, min(first + max(int(count), 0), len(cells)))
    windowed = dict(row)
    windowed["cells"] = [_wire_cell(cell) for cell in cells[first:last]]
    windowed["nCols"] = len(cells)
    windowed["first"] = first
    windowed["truncated"] = last < len(cells) or first > 0
    windowed["labels"] = [
        dict(label, col=label["col"] - first)
        for label in row["labels"]
        if first <= label["col"] < last
    ]
    windowed["breadcrumbs"] = [
        dict(mark, col=mark["col"] - first)
        for mark in row["breadcrumbs"]
        if first <= mark["col"] < last
    ]
    return windowed


def _wire_cell(cell: Dict[str, Any]) -> Dict[str, Any]:
    """Drop the fields that are internal or at their default, to halve the frame."""
    out: Dict[str, Any] = {
        "text": cell["text"],
        "color": cell["color"],
        "offset": cell["offset"],
        "atoms": cell["atoms"],
    }
    for key in ("spacer", "isAbbr", "hintNoSpace", "selected"):
        if cell[key]:
            out[key] = True
    for key in ("state", "tag"):
        if cell[key]:
            out[key] = cell[key]
    for key in ("resi", "chain", "resn"):
        if cell[key]:
            out[key] = cell[key]
    return out


def build(
    cmd: Any,
    state: int = -1,
    first: int = 0,
    count: int = DEFAULT_WINDOW,
) -> Dict[str, Any]:
    """The whole viewer, as one JSON-safe dict.

    Mirrors ``SeekerUpdate`` (``layer3/Seeker.cpp:969``) plus ``SeekerRefresh``
    (``:475``) for the per-column ``inverse`` (selected) flag.  ``first``/
    ``count`` are the horizontal scroll window; ``nCols`` on every row is the
    true column count so the client can size its scrollbar.
    """
    codes_global = _int(cmd, "seq_view_format", "", 0)
    label_mode = _int(cmd, "seq_view_label_mode", "", 2)
    gap_mode = _int(cmd, "seq_view_gap_mode", "", GAP_MODE_ALL)
    location = _int(cmd, "seq_view_location", "", 0)
    overlay = _int(cmd, "seq_view_overlay", "", 0)
    fill_color = _int(cmd, "seq_view_fill_color", "", 104)
    hide_underscore = _int(cmd, "hide_underscore_names", "", 1)
    sele_kw = sele_mode_keyword(cmd)
    sele_name = active_sele_name(cmd, create_new=False)

    names = _object_rows(cmd, hide_underscore)

    selected_indices: Dict[str, set] = {}
    if sele_name:
        try:
            for obj_name, index in cmd.index(sele_name):
                selected_indices.setdefault(obj_name, set()).add(int(index))
        except Exception:  # noqa: BLE001
            selected_indices = {}

    rows: List[Dict[str, Any]] = []
    used_colors: set = set()
    budget = MAX_CELLS_PER_FRAME

    for name in names:
        full = row_model(cmd, name, state)
        if full is None:
            continue

        member = selected_indices.get(name, set())
        for cell in full["cells"]:
            if cell["spacer"] or not member:
                cell["selected"] = False
            else:
                cell["selected"] = any(index in member for index in cell["atoms"])

        row = _window(full, first, min(count, budget))
        budget -= len(row["cells"])
        for cell in row["cells"]:
            used_colors.add(cell["color"])
        used_colors.add(row["objectColor"])
        rows.append(row)
        if budget <= 0:
            break

    colors: Dict[str, List[float]] = {}
    for index in used_colors:
        if index is None or index < 0:
            continue
        try:
            rgb = cmd.get_color_tuple(int(index))
        except Exception:  # noqa: BLE001
            rgb = None
        if rgb:
            colors[str(int(index))] = [float(component) for component in rgb]

    return {
        "visible": bool(rows),
        "location": location,
        "overlay": bool(overlay),
        "format": codes_global,
        "labelMode": label_mode,
        "gapMode": gap_mode,
        "fillColor": fill_color,
        "activeSele": sele_name,
        "seleMode": sele_kw,
        "rows": rows,
        "colors": colors,
        "window": {"first": first, "count": count, "max": MAX_CELLS_PER_FRAME},
    }


# --------------------------------------------------------------------------
# Writes — the three things Seeker itself does
# --------------------------------------------------------------------------


def _index_expression(obj: str, atoms: Iterable[int]) -> str:
    """``SeekerBuildSeleFromAtomList`` (``:38-68``) as a selection string.

    ``CoordSetAtomToChemPyAtom`` (``layer2/CoordSet.cpp:1136``) and
    ``cmd.iterate``'s ``index`` are both ``index + 1``, which is exactly what
    the ``index`` selection keyword takes.
    """
    joined = "+".join(str(int(index)) for index in atoms)
    return "%s and index %s" % (obj, joined) if joined else "none"


def select_expression(sele_kw: str, sele_name: str, inc_or_excl: int,
                      start_over: int, temp: str = TEMP_SELE) -> str:
    """The three algebra forms of ``SeekerSelectionToggle`` (``:203-221``)."""
    if start_over:
        return "%s(%s)" % (sele_kw, temp)
    if inc_or_excl:
        return "((%s(?%s)) or %s(%s))" % (sele_kw, sele_name, sele_kw, temp)
    return "((%s(?%s)) and not %s(%s))" % (sele_kw, sele_name, sele_kw, temp)


def select(
    cmd: Any,
    obj: str,
    atoms: Sequence[int],
    inc_or_excl: int = 1,
    start_over: int = 0,
) -> Dict[str, Any]:
    """``SeekerSelectionToggle`` / ``...ToggleRange`` (``:169``, ``:70``).

    Performs the same three steps in the same order — build ``_seeker`` from the
    object's atom indices, rewrite the active selection with the algebra above,
    delete ``_seeker`` — and returns the ``cmd.select(...)`` line the C would
    have written to the log (``:227-230``), so the client can echo it.
    """
    if not atoms:
        return {"name": "", "expression": "", "log": "", "count": 0}
    sele_kw = sele_mode_keyword(cmd)
    cmd.select(TEMP_SELE, _index_expression(obj, atoms), enable=0, quiet=1)
    name = active_sele_name(cmd, create_new=True)
    expression = select_expression(sele_kw, name, inc_or_excl, start_over)
    cmd.select(name, expression, enable=1, quiet=1)
    cmd.delete(TEMP_SELE)
    if _int(cmd, "auto_show_selections", "", 1):
        cmd.enable(name)
    count = 0
    try:
        count = int(cmd.count_atoms(name, quiet=1))
    except Exception:  # noqa: BLE001
        count = 0
    return {
        "name": name,
        "expression": expression,
        "log": 'cmd.select("%s","%s",enable=1)' % (name, expression),
        "count": count,
    }


def select_range(
    cmd: Any,
    obj: str,
    col_first: int,
    col_last: int,
    inc_or_excl: int = 1,
    start_over: int = 0,
    state: int = -1,
) -> Dict[str, Any]:
    """``SeekerSelectionToggleRange`` (``layer3/Seeker.cpp:70-167``).

    The C walks ``col_first..col_last`` of the row it is holding, skips spacers,
    and concatenates every column's atom list into ONE selector call — "so that
    we only call selector once" (``:92``).  The row is rebuilt here rather than
    shipped back from the browser, so a drag across 6,000 columns costs two
    integers on the wire.
    """
    full = row_model(cmd, obj, state)
    if full is None:
        return {"name": "", "expression": "", "log": "", "count": 0}
    cells = full["cells"]
    lo, hi = sorted((int(col_first), int(col_last)))
    lo = max(lo, 0)
    hi = min(hi, len(cells) - 1)
    atoms: List[int] = []
    for cell in cells[lo : hi + 1]:
        if cell["spacer"]:
            continue
        atoms.extend(cell["atoms"])
    result = select(cmd, obj, atoms, inc_or_excl, start_over)
    result["columns"] = [lo, hi]
    return result


def clear(cmd: Any) -> Dict[str, Any]:
    """Left double-click outside a cell (``layer3/Seeker.cpp:328-341``)."""
    name = active_sele_name(cmd, create_new=False)
    if not name:
        return {"name": "", "log": ""}
    cmd.select(name, "none", enable=1, quiet=1)
    return {"name": name, "log": 'cmd.select("%s","none",enable=1)' % name}


def center(cmd: Any, obj: str, atoms: Sequence[int], action: int = 0) -> Dict[str, Any]:
    """Middle click = center, Ctrl+middle = zoom (``:275-315``)."""
    if not atoms:
        return {"log": ""}
    cmd.select(TEMP_CENTER_SELE, _index_expression(obj, atoms), enable=0, quiet=1)
    if action:
        cmd.zoom(TEMP_CENTER_SELE, animate=-1)
        log = 'cmd.zoom("%s",animate=-1)' % TEMP_CENTER_SELE
    else:
        cmd.center(TEMP_CENTER_SELE, animate=-1)
        log = 'cmd.center("%s",animate=-1)' % TEMP_CENTER_SELE
    cmd.delete(TEMP_CENTER_SELE)
    return {"log": log}


def set_state(cmd: Any, obj: str, state: int) -> Dict[str, Any]:
    """Clicking a cell that carries a state (``:463-466``)."""
    cmd.set("state", int(state), obj)
    return {"log": 'cmd.set("state",%d,"%s")' % (int(state), obj)}


# --------------------------------------------------------------------------
# Installation
# --------------------------------------------------------------------------

#: The leaf the client addresses, and the one dispatch table behind it.  One
#: leaf rather than five keeps this work package's footprint on the ``cmd``
#: namespace to a single name (WP-12 installs ``cmd.tenmol_objects`` the same
#: way).
ENTRY_POINT = "tenmol_seqview"

ACTIONS: Dict[str, str] = {
    "rows": "build",
    "select": "select",
    "select_range": "select_range",
    "clear": "clear",
    "center": "center",
    "set_state": "set_state",
    "install": "_installed",
}


def _installed(cmd: Any) -> Dict[str, Any]:
    """``tenmol_seqview('install')`` — a liveness probe for the client."""
    return {"installed": True, "module": __name__, "actions": sorted(ACTIONS)}


def dispatch(cmd: Any, action: str, *args: Any, **kwargs: Any) -> Any:
    """``cmd.tenmol_seqview(action, ...)``."""
    target = ACTIONS.get(action)
    if target is None:
        raise ValueError(
            "unknown seqview action %r; expected one of %s"
            % (action, ", ".join(sorted(ACTIONS)))
        )
    return globals()[target](cmd, *args, **kwargs)


def install(cmd: Any = None) -> Dict[str, Any]:
    """Bind :func:`dispatch` onto ``pymol.cmd`` and report what landed.

    Idempotent.  Returns a dict so the caller — a ``cmd.do`` one-liner from the
    browser — can be checked with a follow-up call instead of guessing.
    """
    if cmd is None:
        from pymol import cmd as pymol_cmd  # noqa: WPS433 - deliberately late

        cmd = pymol_cmd

    def bound(action: str = "rows", *args: Any, **kwargs: Any) -> Any:
        return dispatch(cmd, action, *args, **kwargs)

    bound.__name__ = ENTRY_POINT
    bound.__doc__ = dispatch.__doc__
    setattr(cmd, ENTRY_POINT, bound)
    return _installed(cmd)
