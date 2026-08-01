"""WP-21 — the sequence viewer, reconstructed from ``cmd`` and proved here.

Run with the venv that has the PyMOL built from this tree::

    bridge/.venv/bin/python -m pytest bridge/tests/test_seqview.py -q

Part 1 is pure: the abbreviation table, the gap arithmetic, the character-offset
pass and the three selection-algebra strings, none of which need an engine.

Part 2 goes through the REAL bridge from ``conftest.py`` — real uvicorn, real
WebSocket, real PyMOL — because the two claims that matter are only true end to
end:

* the reconstruction agrees with PyMOL's own ``cmd.get_fastastr`` on the
  one-letter codes, and with ``cmd.count_atoms`` on the atom lists, and
* the click grammar drives *real* PyMOL selections: the same
  ``((byresi(?sele)) or byresi(_seeker))`` algebra ``SeekerSelectionToggle``
  (``layer3/Seeker.cpp:203-221``) writes to the log.
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import seqview  # noqa: E402

from conftest import WSClient  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PDB_1TII = os.path.join(REPO, "test", "dat", "1tii.pdb")

BOOTSTRAP = "from tenmol_bridge.panels import seqview; seqview.install()"


# =========================================================================== #
# Part 1 — pure
# =========================================================================== #


@pytest.mark.parametrize(
    "resn,expected",
    [
        ("ALA", "A"),
        ("ARG", "R"),
        ("ASP", "D"),
        ("ASN", "N"),
        ("CYS", "C"),
        ("CYX", "C"),
        ("GLN", "Q"),
        ("GLU", "E"),
        ("GLY", "G"),
        ("HIS", "H"),
        ("HID", "H"),
        ("HIE", "H"),
        ("ILE", "I"),
        ("LEU", "L"),
        ("LYS", "K"),
        ("MET", "M"),
        ("MSE", "M"),
        ("PHE", "F"),
        ("PRO", "P"),
        ("SEC", "U"),
        ("SER", "S"),
        ("THR", "T"),
        ("TRP", "W"),
        ("TYR", "Y"),
        ("VAL", "V"),
        # water spellings all collapse to the `water` argument (`:1285` passes 'O')
        ("HOH", "O"),
        ("H2O", "O"),
        ("SOL", "O"),
        ("WAT", "O"),
        ("TIP3", "O"),
        # no branch matches -> the `unknown` argument, which the caller turns
        # into "print the full resn" (`layer3/Seeker.cpp:1291-1303`)
        ("A", ""),
        ("DA", ""),
        ("ATP", ""),
        ("", ""),
    ],
)
def test_seeker_get_abbr(resn: str, expected: str) -> None:
    assert seqview.abbr(resn, "O", "") == expected


def test_sele_mode_keyword_table_is_the_c_table() -> None:
    # layer1/Scene.cpp:459-467
    assert seqview.SEL_MODE_KW == (
        "",
        "byresi",
        "bychain",
        "bysegi",
        "byobject",
        "bymol",
        "bca.",
    )


@pytest.mark.parametrize(
    "inc,start_over,expected",
    [
        (1, 0, "((byresi(?sel01)) or byresi(_seeker))"),
        (0, 0, "((byresi(?sel01)) and not byresi(_seeker))"),
        (1, 1, "byresi(_seeker)"),
    ],
)
def test_selection_algebra_strings(inc: int, start_over: int, expected: str) -> None:
    """``SeekerSelectionToggle`` (``layer3/Seeker.cpp:203-221``)."""
    assert seqview.select_expression("byresi", "sel01", inc, start_over) == expected


def test_selection_algebra_with_the_empty_keyword() -> None:
    """``mouse_selection_mode 0`` -> no keyword at all, not "byresi"."""
    assert seqview.select_expression("", "sele", 1, 0) == "(((?sele)) or (_seeker))"


def test_index_expression_is_one_based_like_the_index_keyword() -> None:
    assert seqview._index_expression("m", [3, 4, 5]) == "m and index 3+4+5"
    assert seqview._index_expression("m", []) == "none"


class _Atom(object):
    """Enough of ``seqview.Atom`` for the pure gap/colour tests."""

    def __init__(self, resv: int, chain: str = "A", polymer: bool = True) -> None:
        self.resv = resv
        self.chain = chain
        self.segi = ""
        self.flags = seqview.FLAG_POLYMER if polymer else 0

    @property
    def chain_key(self):
        return (self.chain, self.segi)

    @property
    def is_polymer(self) -> bool:
        return bool(self.flags & seqview.FLAG_POLYMER)


@pytest.mark.parametrize(
    "mode,gap,expected",
    [
        (seqview.GAP_MODE_NONE, 5, 0),
        (seqview.GAP_MODE_ALL, 5, 4),
        (seqview.GAP_MODE_SINGLE, 5, 1),
        (seqview.GAP_MODE_ALL, 1, 0),
        (seqview.GAP_MODE_SINGLE, 2, 1),
    ],
)
def test_gap_count(mode: int, gap: int, expected: int) -> None:
    """``layer3/Seeker.cpp:1236-1240``: ``resv - last_resv - 1``, SINGLE clamps."""
    assert seqview._gaps_needed(_Atom(1), _Atom(1 + gap), mode) == expected


def test_gaps_only_within_one_chain_and_only_between_polymers() -> None:
    assert seqview._gaps_needed(_Atom(1, "A"), _Atom(9, "B"), seqview.GAP_MODE_ALL) == 0
    assert (
        seqview._gaps_needed(_Atom(1), _Atom(9, polymer=False), seqview.GAP_MODE_ALL)
        == 0
    )


def test_more_than_nine_gaps_collapse() -> None:
    """``MAXCONSECUTIVEGAPS`` (``:983``) -> ``---...---`` (``:1275-1277``)."""
    cells: list = []
    seqview._push_gaps(cells, 10, "-", "---...---", 104)
    assert "".join(cell["text"] for cell in cells) == "---...---"
    assert all(cell["spacer"] for cell in cells)

    cells = []
    seqview._push_gaps(cells, 4, "-", "---...---", 104)
    assert "".join(cell["text"] for cell in cells) == "----"


def test_offsets_pack_abbreviations_and_space_the_rest() -> None:
    """Mode 0 packs one-letter codes; mode 1 puts a space after every column."""
    abbrs = [
        seqview._cell("A", 1, [1], is_abbr=True),
        seqview._cell("C", 1, [2], is_abbr=True),
        seqview._cell("D", 1, [3], is_abbr=True),
    ]
    assert seqview._lay_out(abbrs, 0) == 3
    assert [cell["offset"] for cell in abbrs] == [0, 1, 2]

    names = [
        seqview._cell("ALA", 1, [1]),
        seqview._cell("CYS", 1, [2]),
    ]
    assert seqview._lay_out(names, 1) == 8
    assert [cell["offset"] for cell in names] == [0, 4]


def test_dispatch_refuses_an_unknown_action() -> None:
    with pytest.raises(ValueError) as excinfo:
        seqview.dispatch(object(), "not_an_action")
    assert "unknown seqview action" in str(excinfo.value)


# =========================================================================== #
# Part 2 — the real bridge, the real engine
# =========================================================================== #


@pytest.fixture(scope="module")
def seq_ws(bridge) -> WSClient:
    """One socket with the panel bootstrapped and one structure loaded.

    Everything it creates is namespaced ``wp21_*`` and torn down at the end, so
    the session-scoped engine it shares with the other test modules is left the
    way it was found.
    """
    ws = WSClient(bridge.ws_url)
    # `cmd.do(line, log=0, echo=0)` — silent, so the console the other tests
    # assert on does not gain a "PyMOL>from tenmol_bridge..." line.
    ws.call("cmd.do", BOOTSTRAP, 0, 0)
    probe = ws.call("cmd.tenmol_seqview", "install")
    assert probe["installed"] is True

    ws.call("cmd.load", PDB_1TII, "wp21")
    ws.call("cmd.set", "seq_view", 1, "wp21")
    yield ws
    ws.call("cmd.delete", "wp21")
    ws.call("cmd.delete", "wp21b")
    ws.call("cmd.select", "sele", "none")
    ws.call("cmd.delete", "sele")
    ws.call("cmd.set", "seq_view_format", 0)
    ws.call("cmd.set", "seq_view_gap_mode", 1)
    ws.close()


def _rows(ws: WSClient, first: int = 0, count: int = 1200) -> dict:
    return ws.call("cmd.tenmol_seqview", "rows", -1, first, count)


def _row(ws: WSClient, name: str = "wp21", first: int = 0, count: int = 1200) -> dict:
    payload = _rows(ws, first, count)
    for row in payload["rows"]:
        if row["object"] == name:
            return row
    raise AssertionError(
        "no row for %r in %r" % (name, [r["object"] for r in payload["rows"]])
    )


def _all_cells(ws: WSClient, name: str = "wp21") -> list:
    """Page the whole row in, one 1200-column window at a time.

    The payload is a WINDOW on purpose (``seqview.DEFAULT_WINDOW``): ``codes==2``
    on 1tii is 6,058 columns and a JSON frame caps at 1 MiB.  A test that wants
    the whole row scrolls, exactly as the component does.
    """
    cells: list = []
    first = 0
    while True:
        row = _row(ws, name, first, 1200)
        cells.extend(row["cells"])
        first += len(row["cells"])
        if not row["cells"] or first >= row["nCols"]:
            return cells


def test_the_panel_is_reachable_without_a_policy_grant(seq_ws: WSClient) -> None:
    """The whole bootstrap, as the browser performs it."""
    payload = _rows(seq_ws)
    assert payload["visible"] is True
    assert payload["seleMode"] == "byresi"  # mouse_selection_mode default 1
    assert any(row["object"] == "wp21" for row in payload["rows"])


def test_seq_view_off_means_no_row(seq_ws: WSClient) -> None:
    """``layer3/Seeker.cpp:991-993`` — gated per object by the setting."""
    seq_ws.call("cmd.set", "seq_view", 0, "wp21")
    try:
        assert all(row["object"] != "wp21" for row in _rows(seq_ws)["rows"])
    finally:
        seq_ws.call("cmd.set", "seq_view", 1, "wp21")


def test_disabled_objects_are_not_rows(seq_ws: WSClient) -> None:
    seq_ws.call("cmd.disable", "wp21")
    try:
        assert all(row["object"] != "wp21" for row in _rows(seq_ws)["rows"])
    finally:
        seq_ws.call("cmd.enable", "wp21")


def test_one_letter_codes_agree_with_get_fastastr(seq_ws: WSClient) -> None:
    """The reconstruction, checked against PyMOL's own polymer export.

    ``cmd.get_fastastr`` is not a substitute for the viewer (no colours, no atom
    indices, no selection state, no gaps) but it IS an independent one-letter
    oracle for the polymer part of a chain, which is what this asserts.
    """
    seq_ws.call("cmd.set", "seq_view_format", 0)
    cells = _all_cells(seq_ws)

    fasta = seq_ws.call("cmd.get_fastastr", "wp21 and polymer and chain A")
    expected = "".join(
        line.strip() for line in fasta.splitlines() if not line.startswith(">")
    )

    got = "".join(
        cell["text"]
        for cell in cells
        if cell.get("isAbbr") and cell.get("chain") == "A" and not cell.get("spacer")
    )
    assert len(expected) > 100
    assert got == expected


def test_water_renders_as_O_and_ligands_as_their_resn(seq_ws: WSClient) -> None:
    """``SeekerGetAbbr(..., water='O', unknown=0)`` at ``layer3/Seeker.cpp:1285``."""
    cells = _all_cells(seq_ws)
    waters = [cell for cell in cells if cell.get("resn") == "HOH"]
    assert waters, "1tii has waters"
    assert {cell["text"] for cell in waters} == {"O"}
    assert all(cell.get("isAbbr") for cell in waters)


def test_three_letter_mode(seq_ws: WSClient) -> None:
    """``codes == 1`` (``:1329-1370``) — space-separated explicit resn."""
    seq_ws.call("cmd.set", "seq_view_format", 1)
    try:
        row = _row(seq_ws)
        texts = [cell["text"] for cell in row["cells"] if not cell.get("spacer")]
        assert "HOH" in texts
        assert all(len(text) <= 4 for text in texts[:50])
        # every column is followed by one space -> offsets step by len+1
        first, second = row["cells"][0], row["cells"][1]
        assert second["offset"] == first["offset"] + len(first["text"]) + 1
    finally:
        seq_ws.call("cmd.set", "seq_view_format", 0)


def test_atom_name_mode_is_one_column_per_atom(seq_ws: WSClient) -> None:
    """``codes == 2`` (``:1371-1395``)."""
    seq_ws.call("cmd.set", "seq_view_format", 2)
    try:
        row = _row(seq_ws)
        n_atoms = seq_ws.call("cmd.count_atoms", "wp21", quiet=1)
        assert row["nCols"] == n_atoms
        assert row["truncated"] is True  # 6,058 columns do not fit one frame
        assert all(len(cell["atoms"]) == 1 for cell in row["cells"])
        assert len(_all_cells(seq_ws)) == n_atoms
        # In atom-name mode the label is resn + ` + resi (`:1878-1887`).
        assert row["labels"]
        assert "`" in row["labels"][0]["text"]
    finally:
        seq_ws.call("cmd.set", "seq_view_format", 0)


def test_chain_mode_is_one_column_per_chain(seq_ws: WSClient) -> None:
    """``codes == 3`` (``:1396-1422``)."""
    seq_ws.call("cmd.set", "seq_view_format", 3)
    try:
        row = _row(seq_ws)
        chains = seq_ws.call("cmd.get_chains", "wp21")
        texts = [cell["text"] for cell in row["cells"]]
        # `AtomInfoSameChainP` compares chain AND segi, so a chain may recur;
        # the SET of chains must match what PyMOL reports.
        assert {("" if text == "''" else text) for text in texts} == set(chains)
    finally:
        seq_ws.call("cmd.set", "seq_view_format", 0)


def test_state_mode_enumerates_states_and_is_not_selectable(seq_ws: WSClient) -> None:
    """``codes == 4`` on a NON-discrete object (``:1448-1481``, guard at ``:427``)."""
    seq_ws.call("cmd.create", "wp21b", "wp21 and chain A and polymer", 1, 1)
    seq_ws.call("cmd.create", "wp21b", "wp21 and chain A and polymer", 1, 2)
    seq_ws.call("cmd.set", "seq_view", 1, "wp21b")
    seq_ws.call("cmd.set", "seq_view_format", 4, "wp21b")
    try:
        row = _row(seq_ws, "wp21b")
        assert row["codes"] == 4
        assert row["selectable"] is False
        assert len(row["cells"]) == seq_ws.call("cmd.count_states", "wp21b")
        assert [cell["state"] for cell in row["cells"]] == [1, 2]
    finally:
        seq_ws.call("cmd.delete", "wp21b")


def test_gap_modes(seq_ws: WSClient) -> None:
    """``seq_view_gap_mode`` NONE / ALL / SINGLE (``:1230-1258``)."""
    seq_ws.call("cmd.create", "wp21b", "wp21 and chain A and polymer and resi 1-10+21-30")

    def spacer_run() -> int:
        row = _row(seq_ws, "wp21b")
        return sum(1 for cell in row["cells"] if cell.get("spacer"))

    seq_ws.call("cmd.set", "seq_view", 1, "wp21b")
    try:
        seq_ws.call("cmd.set", "seq_view_gap_mode", 1)
        # 10 missing residues (11..20) is past MAXCONSECUTIVEGAPS -> "---...---"
        assert spacer_run() == len("---...---")

        seq_ws.call("cmd.set", "seq_view_gap_mode", 2)
        assert spacer_run() == 1

        seq_ws.call("cmd.set", "seq_view_gap_mode", 0)
        assert spacer_run() == 0
    finally:
        seq_ws.call("cmd.set", "seq_view_gap_mode", 1)
        seq_ws.call("cmd.delete", "wp21b")


def test_labels_follow_spacing_and_start(seq_ws: WSClient) -> None:
    """``seq_view_label_spacing`` / ``_start`` (``:1842-1862``)."""
    seq_ws.call("cmd.create", "wp21b", "wp21 and chain A and polymer and resi 1-40")
    seq_ws.call("cmd.set", "seq_view", 1, "wp21b")
    try:
        seq_ws.call("cmd.set", "seq_view_label_spacing", 5, "wp21b")
        seq_ws.call("cmd.set", "seq_view_label_start", 1, "wp21b")
        labels = {label["text"] for label in _row(seq_ws, "wp21b")["labels"]}
        assert {"1", "6", "11", "16", "21"} <= labels
        assert "7" not in labels

        seq_ws.call("cmd.set", "seq_view_label_spacing", 10, "wp21b")
        labels = {label["text"] for label in _row(seq_ws, "wp21b")["labels"]}
        assert {"1", "11", "21", "31"} <= labels
        assert "6" not in labels
    finally:
        seq_ws.call("cmd.delete", "wp21b")


def test_a_click_makes_a_real_pymol_selection(seq_ws: WSClient) -> None:
    """Left click on a cell -> ``SeekerSelectionToggle`` (``:169``), for real."""
    seq_ws.call("cmd.select", "sele", "none")
    seq_ws.call("cmd.delete", "sele")

    residues = [
        cell
        for cell in _all_cells(seq_ws)
        if not cell.get("spacer") and cell.get("chain") == "A"
    ]
    first, second = residues[0], residues[1]

    # start_over = the first click of a fresh drag
    result = seq_ws.call(
        "cmd.tenmol_seqview", "select", "wp21", first["atoms"], 1, 1
    )
    assert result["expression"] == "byresi(_seeker)"
    assert result["log"].startswith('cmd.select("')
    assert result["count"] == seq_ws.call("cmd.count_atoms", result["name"], quiet=1)
    assert result["count"] == len(first["atoms"])

    # include a second residue
    result = seq_ws.call(
        "cmd.tenmol_seqview", "select", "wp21", second["atoms"], 1, 0
    )
    assert result["expression"] == "((byresi(?%s)) or byresi(_seeker))" % result["name"]
    assert result["count"] == len(first["atoms"]) + len(second["atoms"])

    # the highlight comes back on the next poll (SeekerRefresh, `:475-525`)
    selected = [cell for cell in _all_cells(seq_ws) if cell.get("selected")]
    assert len(selected) == 2

    # exclude the first one again
    result = seq_ws.call(
        "cmd.tenmol_seqview", "select", "wp21", first["atoms"], 0, 0
    )
    assert (
        result["expression"]
        == "((byresi(?%s)) and not byresi(_seeker))" % result["name"]
    )
    assert result["count"] == len(second["atoms"])

    # the temp selection Seeker builds must not survive (`:154`)
    assert "_seeker" not in seq_ws.call("cmd.get_names", "selections", 0)


def test_selecting_a_range_is_one_call_not_n(seq_ws: WSClient) -> None:
    """``SeekerSelectionToggleRange`` builds ONE long atom list (``:97-113``)."""
    seq_ws.call("cmd.select", "sele", "none")
    cells = _all_cells(seq_ws)
    columns = [
        index
        for index, cell in enumerate(cells)
        if not cell.get("spacer") and cell.get("chain") == "A"
    ][:6]
    atoms = [index for cell in (cells[c] for c in columns) for index in cell["atoms"]]

    # The client sends two column indices, not 6,000 atom ids (`:92`).
    result = seq_ws.call(
        "cmd.tenmol_seqview", "select_range", "wp21", columns[0], columns[-1], 1, 1
    )
    assert result["columns"] == [columns[0], columns[-1]]
    assert result["count"] == len(atoms)
    highlighted = [cell for cell in _all_cells(seq_ws) if cell.get("selected")]
    assert len(highlighted) == 6


def test_mouse_selection_mode_changes_the_keyword(seq_ws: WSClient) -> None:
    """``mouse_selection_mode`` 2 -> ``bychain`` (``layer1/Scene.cpp:504``)."""
    seq_ws.call("cmd.select", "sele", "none")
    seq_ws.call("cmd.set", "mouse_selection_mode", 2)
    try:
        assert _rows(seq_ws)["seleMode"] == "bychain"
        residue = next(
            cell
            for cell in _all_cells(seq_ws)
            if not cell.get("spacer") and cell.get("chain") == "A"
        )
        result = seq_ws.call(
            "cmd.tenmol_seqview", "select", "wp21", residue["atoms"], 1, 1
        )
        assert result["expression"] == "bychain(_seeker)"
        # a whole chain, not a single residue
        assert result["count"] == seq_ws.call(
            "cmd.count_atoms", "wp21 and chain A", quiet=1
        )
    finally:
        seq_ws.call("cmd.set", "mouse_selection_mode", 1)
        seq_ws.call("cmd.select", "sele", "none")


def test_double_click_outside_clears_the_selection(seq_ws: WSClient) -> None:
    """``layer3/Seeker.cpp:328-341``."""
    row = _row(seq_ws)
    residue = next(cell for cell in row["cells"] if not cell.get("spacer"))
    seq_ws.call("cmd.tenmol_seqview", "select", "wp21", residue["atoms"], 1, 1)

    result = seq_ws.call("cmd.tenmol_seqview", "clear")
    assert result["log"].endswith('"none",enable=1)')
    assert seq_ws.call("cmd.count_atoms", result["name"], quiet=1) == 0
    assert not any(cell.get("selected") for cell in _all_cells(seq_ws))


def test_middle_click_centers_and_leaves_no_temp_selection(seq_ws: WSClient) -> None:
    """Browse mode (``:397-412``) — ``cmd.center`` on ``_seeker_center``."""
    # `animate=-1` means "use animation_duration"; with animation on, the origin
    # arrives over 0.75 s and `get_view` right afterwards still reads the old one.
    seq_ws.call("cmd.set", "animation", 0)
    try:
        before = seq_ws.call("cmd.get_view")
        cells = _all_cells(seq_ws)
        residue = [cell for cell in cells if not cell.get("spacer")][-1]

        result = seq_ws.call("cmd.tenmol_seqview", "center", "wp21", residue["atoms"], 0)
        assert result["log"].startswith("cmd.center(")
        assert "_seeker_center" not in seq_ws.call("cmd.get_names", "selections", 0)
        after = seq_ws.call("cmd.get_view")
        assert before[12:15] != after[12:15]  # the origin moved
    finally:
        seq_ws.call("cmd.set", "animation", 1)


def test_clicking_a_state_cell_sets_that_objects_state(seq_ws: WSClient) -> None:
    """``:463-466`` — a cell carrying a state writes the object's ``state``."""
    seq_ws.call("cmd.create", "wp21b", "wp21 and chain A and polymer", 1, 1)
    seq_ws.call("cmd.create", "wp21b", "wp21 and chain A and polymer", 1, 2)
    try:
        seq_ws.call("cmd.tenmol_seqview", "set_state", "wp21b", 2)
        assert seq_ws.call("cmd.get_setting_int", "state", "wp21b") == 2
    finally:
        seq_ws.call("cmd.delete", "wp21b")


def test_colours_come_back_as_rgb_for_every_index_used(seq_ws: WSClient) -> None:
    """Per-column colour needs ``SeekerFindColor``; the client needs RGB."""
    seq_ws.call("cmd.color", "red", "wp21 and chain A")
    payload = _rows(seq_ws)
    row = next(r for r in payload["rows"] if r["object"] == "wp21")
    used = {cell["color"] for cell in row["cells"] if cell["color"] >= 0}
    assert used <= set(int(key) for key in payload["colors"])
    red = seq_ws.call("cmd.get_color_index", "red")
    assert red in used
    assert payload["colors"][str(red)] == [1.0, 0.0, 0.0]


def test_the_fill_colour_marks_atoms_missing_from_the_state(seq_ws: WSClient) -> None:
    """``:1315`` — not in the current coordinate set -> ``seq_view_fill_color``."""
    payload = _rows(seq_ws)
    assert payload["fillColor"] == seq_ws.call(
        "cmd.get_setting_int", "seq_view_fill_color"
    )
    row = next(r for r in payload["rows"] if r["object"] == "wp21")
    # gaps always carry the fill colour
    gaps = [cell for cell in row["cells"] if cell.get("spacer")]
    assert all(cell["color"] == payload["fillColor"] for cell in gaps)


def test_discrete_state_names_are_coordset_titles_and_stay_selectable(
    seq_ws: WSClient,
) -> None:
    """``codes == 4`` on a DISCRETE object (``layer3/Seeker.cpp:1428-1447``).

    The guard at ``:427`` only locks out NON-discrete state rows; a discrete
    object's states are real, distinct atom sets, so the columns keep their
    atoms and stay clickable. The text is the CoordSet name (``cmd.get_title``),
    not the state number — an .sdf carries one per record.
    """
    sdf = os.path.join(REPO, "test", "dat", "ligs3d.sdf")
    seq_ws.call("cmd.load", sdf, "wp21c", 0, "", 0, 1)  # discrete=1
    seq_ws.call("cmd.set", "seq_view", 1, "wp21c")
    seq_ws.call("cmd.set", "seq_view_format", 4, "wp21c")
    try:
        row = _row(seq_ws, "wp21c")
        assert row["discrete"] is True
        assert row["selectable"] is True
        assert len(row["cells"]) == seq_ws.call("cmd.count_states", "wp21c")
        assert [cell["state"] for cell in row["cells"]] == list(
            range(1, len(row["cells"]) + 1)
        )
        titles = [
            seq_ws.call("cmd.get_title", "wp21c", n)
            for n in range(1, len(row["cells"]) + 1)
        ]
        assert [cell["text"] for cell in row["cells"]] == titles
        # Discrete state columns address real atoms, so they can be selected.
        assert all(cell["atoms"] for cell in row["cells"])
    finally:
        seq_ws.call("cmd.delete", "wp21c")


def test_a_window_past_the_end_is_empty_but_still_reports_the_true_width(
    seq_ws: WSClient,
) -> None:
    """The invariant the client's `clampFirst` depends on.

    A row shrinks under the viewer whenever `seq_view_format`, a load or a
    delete lands, and the client may still be asking for the window it was
    showing. That request has to come back EMPTY-BUT-HONEST — `cells` empty,
    `nCols` the real width — or the client has nothing to re-clamp against and
    the strip stays blank.
    """
    seq_ws.call("cmd.set", "seq_view_format", 0)
    whole = _row(seq_ws, "wp21", 0, 1200)
    assert whole["first"] == 0
    assert whole["nCols"] > 3

    past = _row(seq_ws, "wp21", whole["nCols"] + 500, 1200)
    assert past["cells"] == []
    assert past["nCols"] == whole["nCols"]

    # And a window that starts inside the row is rebased, not re-numbered.
    middle = _row(seq_ws, "wp21", 5, 4)
    assert middle["first"] == 5
    assert len(middle["cells"]) == 4
    assert middle["truncated"] is True
    assert [cell["text"] for cell in middle["cells"]] == [
        cell["text"] for cell in whole["cells"][5:9]
    ]
