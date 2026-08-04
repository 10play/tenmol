"""The sequence viewer ("Seeker") — a Python reconstruction of the C++ model.

OWNER: WP-21.  Inventory row §7 "In-viewport sequence viewer (Seeker)".

WHY THIS FILE EXISTS
--------------------
``packages/engine/layer3/Seeker.cpp:969`` (``SeekerUpdate``) builds the whole viewer — rows,
columns, colors, per-column atom lists, selection highlight — inside
``OrthoDoDraw``.  Nothing about it is reachable from Python:

* ``G->Seeker`` and ``G->Seq->Row`` are C++ structures with no accessor;
  ``SeqUpdate`` (``packages/engine/layer1/Seq.cpp:88``) is only ever called from ``OrthoDoDraw``.
* ``cmd.get_fastastr`` (``packages/engine/modules/pymol/exporting.py:170``) covers polymers only
  and carries no colors, no atom indices, no selection state, no gaps.

Our pump *does* draw every tick, so the C++ model really is built — but it is
built into a framebuffer, not into anything addressable.  Rather than invent an
accessor, this module **reconstructs the same model from `cmd.iterate`**, which
is the only per-atom readout that exposes ``color`` and ``flags``.
(``cmd.get_model`` is not a substitute: ``CoordSetAtomToChemPyAtom``,
``packages/engine/layer2/CoordSet.cpp:1057-1140``, emits no ``color`` field at all — verified on
this build.)

Every rule below is transcribed from the C++, with the line number:

  ``SeekerGetAbbr``            ``packages/engine/layer3/Seeker.cpp:685-906``   one-letter codes
  ``codes`` 0..5              ``:1259-1484``                  display modes
  gap insertion               ``:1230-1258``, ``MAXCONSECUTIVEGAPS`` ``:983``
  ``SeekerFindColor``         ``:908-926``
  ``SeekerFindTag``           ``:928-966``   alignment tags
  label pass                  ``:1820-1914``
  offset pass, no alignment   ``:1548-1581``
  offset pass, alignment      ``:1583-1793``  (tag line-up, stagger, fill)
  ``SeekerRefresh``           ``:475-525``  (``col->inverse``)
  ``SeekerSelectionToggle``   ``:169-246``  selection algebra
  ``SeekerSelectionCenter``   ``:248-315``
  ``ExecutiveGetActiveSeleName`` ``packages/engine/layer3/Executive.cpp:3433``
  ``ExecutiveGetActiveAlignment`` ``packages/engine/layer3/Executive.cpp:3403``
  ``SceneGetSeleModeKeyword`` ``packages/engine/layer1/Scene.cpp:504``

ALIGNMENT MODE, AND THE ONE DELIBERATE DIFFERENCE
-------------------------------------------------
``SeekerFindTag`` reads ``SelectorIsMember(ai->selEntry, align_sele)``, i.e. the
per-atom *tag* the alignment object stored when it registered itself as a
selection (``ObjectAlignment.cpp:1035`` ``SelectorCreateFromTagDict``).  Those
tags are handed out one per alignment COLUMN, strictly increasing along the
alignment (``ObjectAlignment.cpp:920-1000``), and the layout only ever compares
them (``min_tag``).  ``cmd.get_raw_alignment(name)`` returns exactly those
columns, in the same order, so the column ordinal is an order-equivalent tag and
no new C accessor is needed.

The C's residue columns start at index **2**: ``col[0]`` is the object-name
title and ``col[1]`` the ``/segi/chain/`` breadcrumb, both spacers, always
exactly two (``:1055-1140``, every ``label_mode`` branch).  This model does not
carry them — the client draws the object name in its own gutter and the
breadcrumb in the label row — so ``_align_rows`` starts its cursor at 0 where
the C starts it after those two columns.  That is a constant shift shared by
every row, which is what alignment means; nothing about the relative line-up
changes.


HOW THE CLIENT REACHES IT
-------------------------
The bridge dispatcher resolves ``{t:'call', fn:'cmd.<leaf>'}`` against
``engine.cmd``, which for ``pymol2.SingletonPyMOL`` **is** the ``pymol.cmd``
module (``packages/engine/modules/pymol2/__init__.py:53``).  :func:`install` binds this module's
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
    "active_alignment",
    "active_sele_name",
    "alignment_context",
    "alignment_tags",
    "build",
    "center",
    "collect_atoms",
    "install",
    "menu",
    "menu_expand",
    "sele_mode_keyword",
    "select",
    "select_expression",
    "select_range",
    "set_state",
    "row_model",
    "DEFAULT_WINDOW",
    "MAX_CELLS_PER_FRAME",
    "C_LEAD_COLS",
    "find_tag",
    "align_rows",
    "fill_char",
    "unaligned_color",
]

# --------------------------------------------------------------------------
# Constants transcribed from C++
# --------------------------------------------------------------------------

#: ``packages/engine/layer3/Seeker.cpp:983``
MAXCONSECUTIVEGAPS = 9
#: ``packages/engine/layer3/Seeker.cpp:980`` ``max_row = 50``
MAX_ROWS = 50

GAP_MODE_NONE = 0
GAP_MODE_ALL = 1
GAP_MODE_SINGLE = 2

#: ``packages/engine/layer3/Seeker.h:25-27``
TEMP_SELE = "_seeker"
TEMP_CENTER_SELE = "_seeker_center"

#: ``SelModeKW``, ``packages/engine/layer1/Scene.cpp:459-467``.  Indexed by
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

#: ``packages/engine/layer2/AtomInfo.h:103-116``
FLAG_POLYMER = 0x08000000
FLAG_SOLVENT = 0x10000000
FLAG_ORGANIC = 0x20000000
FLAG_INORGANIC = 0x40000000
FLAG_GUIDE = 0x80000000

#: ``SeekerGetAbbr``, ``packages/engine/layer3/Seeker.cpp:685-906``.  The C is a hand-written
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
    """``SeekerGetAbbr`` (``packages/engine/layer3/Seeker.cpp:685``)."""
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
    """``SceneGetSeleModeKeyword`` (``packages/engine/layer1/Scene.cpp:504``)."""
    mode = _int(cmd, "mouse_selection_mode", "", 1)
    if 0 <= mode < len(SEL_MODE_KW):
        return SEL_MODE_KW[mode]
    return SEL_MODE_KW[0]


def active_sele_name(cmd: Any, create_new: bool = False) -> str:
    """``ExecutiveGetActiveSeleName`` (``packages/engine/layer3/Executive.cpp:3433``).

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


def active_alignment(cmd: Any) -> str:
    """``ExecutiveGetActiveAlignment`` (``packages/engine/layer3/Executive.cpp:3403``).

    1) ``seq_view_alignment`` if it is set, 2) else the name of the FIRST
    enabled alignment object, 3) else ``''``.  The C walks the Spec list keeping
    ``rec->visible`` entries whose object type is ``cObjectAlignment``;
    ``cmd.get_names('objects', enabled_only=1)`` walks the same list in the same
    order, and ``cmd.get_type`` names that type ``object:alignment``.
    """
    named = _text(cmd, "seq_view_alignment", "", "")
    if named:
        return named
    try:
        names = list(cmd.get_names("objects", enabled_only=1))
    except Exception:  # noqa: BLE001
        return ""
    for name in names:
        try:
            if cmd.get_type(name) == "object:alignment":
                return str(name)
        except Exception:  # noqa: BLE001
            continue
    return ""


def alignment_tags(cmd: Any, name: str) -> Dict[str, Dict[int, int]]:
    """Per-object ``{atom index: tag}`` for one alignment object.

    ``ObjectAlignment.cpp:920-1000`` hands out one tag per alignment column,
    strictly increasing along the alignment, and stores them in ``id2tag`` which
    ``SelectorCreateFromTagDict`` (``:1035``) turns into the tags
    ``SelectorIsMember`` returns.  ``cmd.get_raw_alignment`` returns the same
    columns in the same order, so the 1-based column ordinal is an
    order-equivalent tag — and the layout only ever compares tags (``min_tag``,
    ``Seeker.cpp:1725``), never uses their magnitude.
    """
    if not name:
        return {}
    try:
        raw = cmd.get_raw_alignment(name)
    except Exception:  # noqa: BLE001 - a stale seq_view_alignment must not throw
        return {}
    out: Dict[str, Dict[int, int]] = {}
    for ordinal, column in enumerate(raw or (), start=1):
        for entry in column:
            try:
                obj, index = str(entry[0]), int(entry[1])
            except Exception:  # noqa: BLE001
                continue
            out.setdefault(obj, {})[index] = ordinal
    return out


def alignment_context(cmd: Any) -> Tuple[str, Dict[str, Dict[int, int]]]:
    """``('', {})`` when ``align_sele < 0``, i.e. alignment mode is OFF.

    The C's gate is ``ExecutiveGetActiveAlignmentSele() >= 0``, which is false
    both when there is no alignment and when ``seq_view_alignment`` names
    something that is not a registered selector.  An empty tag map is the same
    condition on this side.
    """
    name = active_alignment(cmd)
    tags = alignment_tags(cmd, name)
    if not tags:
        return "", {}
    return name, tags


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

    # ``AtomInfoSameResidue`` (``packages/engine/layer2/AtomInfo.cpp:2080``): resv, chain,
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
        "unaligned": False,
        "resi": resi,
        "chain": chain,
        "resn": resn,
        "start": 0,
        "offset": 0,
    }


def _find_color(group: Sequence[Atom]) -> int:
    """``SeekerFindColor`` (``packages/engine/layer3/Seeker.cpp:908``).

    guide atom wins; else the LAST carbon in the residue; else the first atom.
    """
    result = group[0].color
    for atom in group:
        if atom.is_guide:
            return int(atom.color)
        if (atom.elem or "").upper() == "C":  # ``ai->protons == cAN_C``
            result = atom.color
    return int(result)


def find_tag(group: Sequence[Atom], tags: Dict[int, int], codes: int) -> int:
    """``SeekerFindTag`` (``packages/engine/layer3/Seeker.cpp:928-966``).

    Walks the atoms the column stands for — the residue for ``codes`` 0/1, the
    single atom for 2, the chain for 3 — and returns:  the tag of a GUIDE atom
    if one carries a tag and the column is residue-based (``codes < 2``), else
    the first non-zero tag seen.  (``result < tag`` can only fire again once
    ``result`` is non-zero, and only for a guide atom, which the early return
    has already taken; so after the first hit the value is frozen.)
    """
    result = 0
    for atom in group:
        tag = int(tags.get(atom.index, 0))
        if tag and codes < 2 and atom.is_guide:
            return tag
        if result < tag:
            if not result:
                result = tag
            elif codes < 2 and atom.is_guide:
                result = tag
    return result


def _gaps_needed(previous: Optional[Atom], atom: Atom, gap_mode: int) -> int:
    """``packages/engine/layer3/Seeker.cpp:1230-1240`` — same chain, both polymer, no alignment."""
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
    """``push_gap`` (``packages/engine/layer3/Seeker.cpp:1249-1258``): one column per character."""
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
    tags: Optional[Dict[int, int]] = None,
) -> List[Dict[str, Any]]:
    cells: List[Dict[str, Any]] = []
    #: ``:1319,1363,1389,1415`` — the tag is only read when ``align_sele >= 0``.
    tag_map: Dict[int, int] = tags or {}

    def tag_for(group: Sequence[Atom]) -> int:
        return find_tag(group, tag_map, codes) if tag_map else 0

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
                            tag=tag_for(group),
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
                            tag=tag_for(group),
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
                        tag=tag_for(group),
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
                    tag=tag_for((atom,)),
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
                    cells.append(_chain_cell(group, default_color, tag_for(group)))
                group = [atom]
                key = atom.chain_key
            else:
                group.append(atom)
        if group:
            cells.append(_chain_cell(group, default_color, tag_for(group)))
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


def _chain_cell(group: Sequence[Atom], default_color: int, tag: int = 0) -> Dict[str, Any]:
    head = group[0]
    color = _find_color(group) if default_color < 0 else default_color
    return _cell(
        head.chain or "''",
        color,
        [a.index for a in group],
        tag=tag,
        chain=head.chain,
    )


def _lay_out(cells: List[Dict[str, Any]], codes: int) -> int:
    """Character offsets — the FOURTH pass (``packages/engine/layer3/Seeker.cpp:1917-1943``).

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


# --------------------------------------------------------------------------
# The SECOND pass, alignment mode
# --------------------------------------------------------------------------

#: The two spacer columns every C row starts with — the object-name title and
#: the ``/segi/chain/`` breadcrumb (``packages/engine/layer3/Seeker.cpp:1055-1140``; all five
#: ``label_mode`` branches leave ``nCol == 2``).  This model does not carry
#: them, so every column index the C compares against is shifted by this much.
C_LEAD_COLS = 2


def align_rows(rows: Sequence[Dict[str, Any]], unaligned_mode: int) -> None:
    """``SeekerUpdate``'s SECOND PASS in alignment mode (``:1583-1793``).

    Rewrites ``cell['offset']`` on every row so that columns carrying the same
    tag land in the same character column, marks every untagged column
    ``unaligned``, and appends to ``row['fill']`` the ``{offset, width}`` runs
    the C stores in ``row->fill`` and ``CSeq::draw`` paints with
    ``seq_view_fill_char`` (``packages/engine/layer1/Seq.cpp:488-504``).

    ``seq_view_unaligned_mode`` 0/1/2 pack the untagged columns of every row
    into ONE shared column (``stagger == false``); 3/4/5 give each row its own
    (``stagger == true``).  The mode also drives the COLOUR, but that is
    ``CSeq::draw``'s half and is applied by the client from the flags here.

    ``codes`` is the C's file-scope variable, still holding the value it was
    last assigned in the first pass — the format of the LAST visible row.  It is
    reproduced rather than fixed, because it decides where spaces go.
    """
    if not rows:
        return
    stagger = int(unaligned_mode) not in (0, 1, 2)
    codes = int(rows[-1].get("codes", 0))
    cells = [row["cells"] for row in rows]
    n_col = [len(column) for column in cells]
    n_row = len(rows)
    for row in rows:
        row["fill"] = []
    fill = [row["fill"] for row in rows]

    def width(cell: Dict[str, Any]) -> int:
        return len(cell["text"])

    c_col = [0] * n_row
    current = 0
    first = True
    done_flag = False

    while not done_flag:
        hint_tagged_no_space = True
        done_flag = True

        # ---- insert untagged entries into their own columns (``:1618-1712``)
        untagged_flag = True
        hint_untagged_space = False
        while untagged_flag:
            space_added = False
            max_width = 0
            untagged_flag = False
            saw_untagged_no_abbr = False

            # first get the spaces in...
            for a in range(n_row):
                if c_col[a] >= n_col[a]:
                    continue
                r1 = cells[a][c_col[a]]
                if r1["tag"]:
                    continue
                text_len = width(r1)
                if (
                    (not first)
                    and (not space_added)
                    and (c_col[a] + C_LEAD_COLS > 2)
                    and (
                        codes
                        or ((not r1["isAbbr"]) and (not r1["spacer"]))
                        or hint_untagged_space
                        or (r1["isAbbr"] and (not r1["hintNoSpace"]))
                    )
                ):
                    current += 1
                    space_added = True
                if max_width < text_len:
                    max_width = text_len

            # then do the rest
            for a in range(n_row):
                if c_col[a] >= n_col[a]:
                    continue
                r1 = cells[a][c_col[a]]
                if r1["tag"]:
                    continue
                text_len = width(r1)
                untagged_flag = True
                done_flag = False
                saw_untagged_no_abbr |= (not r1["isAbbr"]) and (not r1["spacer"])
                first = False
                r1["offset"] = current
                r1["unaligned"] = True

                if not r1["spacer"]:
                    # infill populate other rows with dashes
                    for aa in range(n_row):
                        if aa == a:
                            continue
                        if c_col[aa] < n_col[aa]:
                            r2 = cells[aa][c_col[aa]]
                            if stagger or r2["tag"] or r2["spacer"]:
                                fill[aa].append({"offset": current, "width": text_len})
                        else:
                            fill[aa].append({"offset": current, "width": text_len})

                if stagger:
                    current += text_len
                elif max_width < text_len:
                    max_width = text_len

            if not stagger:
                current += max_width
            if saw_untagged_no_abbr:
                hint_untagged_space = True
                hint_tagged_no_space = False
            else:
                hint_untagged_space = False
                hint_tagged_no_space = True

            for a in range(n_row):
                if c_col[a] < n_col[a] and not cells[a][c_col[a]]["tag"]:
                    c_col[a] += 1

        # ---- then the lowest tag still pending, in ONE column (``:1714-1792``)
        min_tag = 0
        for a in range(n_row):
            if c_col[a] >= n_col[a]:
                continue
            tag = cells[a][c_col[a]]["tag"]
            if tag and ((min_tag > tag) or (not min_tag)):
                min_tag = tag
        if not min_tag:
            continue

        max_width = 0
        space_added = False
        # TWICE, because the space is inserted part way through the first sweep
        # and every row placed before it would otherwise keep the old offset.
        for _rep in range(2):
            for a in range(n_row):
                if c_col[a] >= n_col[a]:
                    continue
                r1 = cells[a][c_col[a]]
                if r1["tag"] != min_tag:
                    continue
                if (
                    (not first)
                    and (not space_added)
                    and (
                        codes
                        or ((not r1["isAbbr"]) and (not r1["spacer"]))
                        or (
                            r1["isAbbr"]
                            and (not (r1["hintNoSpace"] or hint_tagged_no_space))
                        )
                    )
                ):
                    current += 1
                    space_added = True
                done_flag = False
                first = False
                r1["offset"] = current
                if max_width < width(r1):
                    max_width = width(r1)

        for aa in range(n_row):
            if c_col[aa] < n_col[aa]:
                if cells[aa][c_col[aa]]["tag"] != min_tag:
                    fill[aa].append({"offset": current, "width": max_width})
            else:
                fill[aa].append({"offset": current, "width": max_width})

        for a in range(n_row):
            if c_col[a] < n_col[a] and cells[a][c_col[a]]["tag"] == min_tag:
                c_col[a] += 1
        current += max_width


def _labels(
    cells: Sequence[Dict[str, Any]],
    atoms_by_index: Dict[int, Atom],
    codes: int,
    div: int,
    sub: int,
) -> List[Dict[str, Any]]:
    """The THIRD pass (``packages/engine/layer3/Seeker.cpp:1820-1914``).

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


def row_model(
    cmd: Any,
    name: str,
    state: int = -1,
    align_active: bool = False,
    tags: Optional[Dict[int, int]] = None,
) -> Optional[Dict[str, Any]]:
    """The FULL, un-windowed column model for one object.

    Split out of :func:`build` because :func:`select_range` needs the same model
    the way ``SeekerSelectionToggleRange`` (``:70-167``) reads the row it is
    already holding — the client must never have to ship 6,000 atom indices back
    to name a range.  ``align_active`` and ``tags`` MUST be passed the same way
    both callers see them: alignment mode suppresses gaps entirely
    (``:1235`` ``&& align_sele < 0``), which changes the column indices a drag
    is addressed by.
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

    # ``:1235`` — "Only include non-consecutive gaps when not doing alignment":
    # the whole gap arithmetic is gated on ``align_sele < 0``.
    gap_mode = (
        GAP_MODE_NONE
        if align_active
        else _int(cmd, "seq_view_gap_mode", "", GAP_MODE_ALL)
    )
    fill_color = _int(cmd, "seq_view_fill_color", "", 104)
    default_color = _int(cmd, "seq_view_color", name, -1)
    present = _atoms_in_state(cmd, name, state)

    cells = _build_cells(
        cmd, name, atoms, codes, gap_mode, default_color, fill_color, present, tags
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
        "fill": [],
        "labels": _labels(cells, atoms_by_index, codes, div, sub),
        "breadcrumbs": _breadcrumbs(cells, atoms_by_index),
        # Kept only so :func:`build` can redo the label pass after the alignment
        # pass has moved every offset.  :func:`_window` drops it.
        "_atoms": atoms_by_index,
        "_labelPass": (div, sub),
    }


def _window(row: Dict[str, Any], first: int, count: int) -> Dict[str, Any]:
    """Slice a full row model down to the columns the client asked for."""
    cells = row["cells"]
    first = max(0, min(int(first), len(cells)))
    last = max(first, min(first + max(int(count), 0), len(cells)))
    windowed = dict(row)
    windowed.pop("_atoms", None)
    windowed.pop("_labelPass", None)
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
    for key in ("spacer", "isAbbr", "hintNoSpace", "selected", "unaligned"):
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

    Mirrors ``SeekerUpdate`` (``packages/engine/layer3/Seeker.cpp:969``) plus ``SeekerRefresh``
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

    align_name, align_tags = alignment_context(cmd)
    unaligned_mode = _int(cmd, "seq_view_unaligned_mode", "", 0)

    names = _object_rows(cmd, hide_underscore)

    selected_indices: Dict[str, set] = {}
    if sele_name:
        try:
            for obj_name, index in cmd.index(sele_name):
                selected_indices.setdefault(obj_name, set()).add(int(index))
        except Exception:  # noqa: BLE001
            selected_indices = {}

    full_rows: List[Dict[str, Any]] = []
    for name in names:
        full = row_model(
            cmd, name, state, bool(align_name), align_tags.get(name, {})
        )
        if full is None:
            continue

        member = selected_indices.get(name, set())
        for cell in full["cells"]:
            if cell["spacer"] or not member:
                cell["selected"] = False
            else:
                cell["selected"] = any(index in member for index in cell["atoms"])
        full_rows.append(full)

    # The alignment pass is CROSS-ROW, so it can only run once every row exists
    # — and it moves every offset, so the label and breadcrumb passes (the C's
    # THIRD pass, which runs after the second) have to be redone from the new
    # ones.
    if align_name and full_rows:
        align_rows(full_rows, unaligned_mode)
        for full in full_rows:
            div, sub = full["_labelPass"]
            full["labels"] = _labels(
                full["cells"], full["_atoms"], full["codes"], div, sub
            )
            full["breadcrumbs"] = _breadcrumbs(full["cells"], full["_atoms"])

    rows: List[Dict[str, Any]] = []
    used_colors: set = set()
    budget = MAX_CELLS_PER_FRAME
    for full in full_rows:
        row = _window(full, first, min(count, budget))
        budget -= len(row["cells"])
        for cell in row["cells"]:
            used_colors.add(cell["color"])
        used_colors.add(row["objectColor"])
        rows.append(row)
        if budget <= 0:
            break

    # A fill run is addressed by CHARACTER OFFSET, not by column, so it is
    # windowed against the offset span the windowed cells actually cover.
    if align_name and rows:
        lo, hi = _offset_span(rows)
        for row in rows:
            row["fill"] = [
                run
                for run in row["fill"]
                if run["offset"] + run["width"] > lo and run["offset"] < hi
            ]

    unaligned = unaligned_color(cmd, unaligned_mode, fill_color)
    used_colors.add(fill_color)
    if unaligned >= 0:
        used_colors.add(unaligned)

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
        "alignment": align_name,
        "unalignedMode": unaligned_mode,
        "unalignedColor": unaligned,
        "fillChar": fill_char(cmd),
        "bgColor": _bg_color(cmd, location),
        "rows": rows,
        "colors": colors,
        "window": {"first": first, "count": count, "max": MAX_CELLS_PER_FRAME},
    }


def _offset_span(rows: Sequence[Dict[str, Any]]) -> Tuple[int, int]:
    """The character range the windowed cells of ALL rows span."""
    lo: Optional[int] = None
    hi: Optional[int] = None
    for row in rows:
        cells = row["cells"]
        if not cells:
            continue
        start = int(cells[0]["offset"])
        end = int(cells[-1]["offset"]) + len(cells[-1]["text"])
        lo = start if lo is None else min(lo, start)
        hi = end if hi is None else max(hi, end)
    return (0, 0) if lo is None or hi is None else (lo, hi)


def fill_char(cmd: Any) -> str:
    """``seq_view_fill_char`` as ``CSeq::draw`` reads it (``packages/engine/layer1/Seq.cpp:316``).

    Only the FIRST character is used, and a space means "draw no fill at all"
    (``fill_char = 0`` at ``:342``), which this reports as the empty string.
    """
    text = _text(cmd, "seq_view_fill_char", "", "-")
    if not text:
        return ""
    return "" if text[0] == " " else text[0]


def unaligned_color(cmd: Any, unaligned_mode: int, fill_color: int) -> int:
    """``packages/engine/layer1/Seq.cpp:322-338`` — resolve ``seq_view_unaligned_color``.

    Left at its default of -1 it becomes ``seq_view_fill_color``, EXCEPT in
    ``seq_view_unaligned_mode`` 3, where it stays -1 and the column keeps its
    own colour.
    """
    index = _int(cmd, "seq_view_unaligned_color", "", -1)
    if index == -1:
        return -1 if int(unaligned_mode) == 3 else int(fill_color)
    return index


def _bg_color(cmd: Any, location: int) -> List[float]:
    """The background the unaligned blend averages against (``Seq.cpp:273-280``)."""
    if _int(cmd, "bg_gradient", "", 0):
        name = "bg_rgb_bottom" if location else "bg_rgb_top"
    else:
        name = "bg_rgb"
    try:
        rgb = cmd.get_color_tuple(_int(cmd, name, "", 0))
    except Exception:  # noqa: BLE001
        rgb = None
    return [float(component) for component in rgb] if rgb else [0.0, 0.0, 0.0]


# --------------------------------------------------------------------------
# Writes — the three things Seeker itself does
# --------------------------------------------------------------------------


def _index_expression(obj: str, atoms: Iterable[int]) -> str:
    """``SeekerBuildSeleFromAtomList`` (``:38-68``) as a selection string.

    ``CoordSetAtomToChemPyAtom`` (``packages/engine/layer2/CoordSet.cpp:1136``) and
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
    """``SeekerSelectionToggleRange`` (``packages/engine/layer3/Seeker.cpp:70-167``).

    The C walks ``col_first..col_last`` of the row it is holding, skips spacers,
    and concatenates every column's atom list into ONE selector call — "so that
    we only call selector once" (``:92``).  The row is rebuilt here rather than
    shipped back from the browser, so a drag across 6,000 columns costs two
    integers on the wire.  It is rebuilt WITH the alignment context, because
    alignment mode drops the gap columns and every column index shifts.
    """
    align_name, align_tags = alignment_context(cmd)
    full = row_model(
        cmd, obj, state, bool(align_name), align_tags.get(obj, {})
    )
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
    """Left double-click outside a cell (``packages/engine/layer3/Seeker.cpp:328-341``)."""
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


def _atom_sele_label(cmd: Any, obj: str, index: int) -> str:
    """``ObjectMoleculeGetAtomSele`` (``packages/engine/layer2/ObjectMolecule.cpp``).

    PyMOL's own atom identifier, ``/object/segi/chain/resn`resi/name``, which
    ``SeekerClick`` hands to ``seq_option`` as the menu TITLE
    (``packages/engine/layer3/Seeker.cpp:379-390``).  ``menu.seq_option`` then cuts it back to
    the last ``/`` (``packages/engine/modules/pymol/menu.py:1801-1804``), so the residue path is
    what the user sees at the top of the popup.
    """
    rows: List[Tuple[Any, ...]] = []
    cmd.iterate(
        "%s and index %d" % (obj, int(index)),
        "rows.append((model, segi, chain, resn, resi, name))",
        space={"rows": rows},
    )
    if not rows:
        return "/%s" % obj
    model, segi, chain, resn, resi, name = rows[0]
    return "/%s/%s/%s/%s`%s/%s" % (model, segi, chain, resn, resi, name)


def menu(
    cmd: Any,
    obj: str = "",
    atoms: Sequence[int] = (),
    selected: int = 0,
) -> Dict[str, Any]:
    """The two right-click popups of ``SeekerClick`` (``Seeker.cpp:357-395``).

    The C branches on ONE condition: an active selection exists AND the column
    under the pointer is in it (``col->inverse``).  If so the menu is
    ``pick_sele`` on the SELECTION (``menu.py:1709``); otherwise ``_seeker`` is
    built from the column's atom list and the menu is ``seq_option`` on that
    temporary, titled with the first atom's identifier (``menu.py:1800``).  A
    right click OUTSIDE any cell takes the first branch too (``:330-340``).

    ``_seeker`` is left in place, exactly as the C does: the leaves of the menu
    are command strings referring to it (``cmd.zoom("_seeker")``), so deleting
    it here would make every one of them a no-op.  The next ``select`` /
    ``select_range`` / ``menu`` call overwrites it.
    """
    from pymol import menu as pymol_menu  # late: needs a started PyMOL

    from .objects import _encode_items

    name = active_sele_name(cmd, create_new=False)
    if int(selected) and name:
        entries = pymol_menu.pick_sele(cmd, name, name)
        return {
            "menu": "pick_sele",
            "sele": name,
            "title": name,
            "items": _encode_items(entries, ()),
        }
    indices = [int(index) for index in atoms]
    if not obj or not indices:
        return {"menu": "", "sele": "", "title": "", "items": []}
    cmd.select(TEMP_SELE, _index_expression(obj, indices), enable=0, quiet=1)
    title = _atom_sele_label(cmd, obj, indices[0])
    entries = pymol_menu.seq_option(cmd, TEMP_SELE, title)
    return {
        "menu": "seq_option",
        "sele": TEMP_SELE,
        "title": title,
        "items": _encode_items(entries, ()),
    }


def menu_expand(
    cmd: Any,
    path: Sequence[int],
    obj: str = "",
    atoms: Sequence[int] = (),
    selected: int = 0,
) -> Dict[str, Any]:
    """Resolve one lazy submenu of the popup above -- PyMOL's ``SubGetItem``.

    The menu is REBUILT and then walked, because the leaves are Python objects
    that cannot cross the wire; the path is the only thing the client keeps.
    """
    from pymol import menu as pymol_menu

    from .objects import _encode_items, _walk

    name = active_sele_name(cmd, create_new=False)
    if int(selected) and name:
        entries: Any = pymol_menu.pick_sele(cmd, name, name)
    else:
        indices = [int(index) for index in atoms]
        cmd.select(TEMP_SELE, _index_expression(obj, indices), enable=0, quiet=1)
        entries = pymol_menu.seq_option(
            cmd, TEMP_SELE, _atom_sele_label(cmd, obj, indices[0]) if indices else obj
        )
    command = _walk(entries, list(path))
    if not callable(command):
        raise ValueError("menu path %r is not a lazy submenu" % (list(path),))
    return {"path": list(path), "items": _encode_items(command(), list(path))}


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
    "menu": "menu",
    "menu_expand": "menu_expand",
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
