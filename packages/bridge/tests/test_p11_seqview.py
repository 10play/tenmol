"""Wave 11 — row 341's alignment mode: tags, line-up, stagger and fill.

WHAT WAS OPEN
-------------
Wave 10 MEASURED the gap instead of closing it: with a real alignment object in
the session ``tenmol_seqview``'s rows came back 6 and 7 columns long, every
cell's ``tag`` ``null`` and no stagger at all — the rows were not lined up by
tag in any degree.  That is the whole of ``SeekerUpdate``'s second alignment
branch (``packages/engine/layer3/Seeker.cpp:1583-1793``) plus ``SeekerFindTag`` (``:928-966``)
plus ``CSeq::draw``'s fill/unaligned colouring (``packages/engine/layer1/Seq.cpp:322-449``,
``:488-504``) missing.

THE TAG SOURCE NEEDS NO NEW C.  ``ObjectAlignment.cpp:920-1000`` hands out one
tag per alignment COLUMN, strictly increasing, and stores them in ``id2tag``
which ``SelectorCreateFromTagDict`` (``:1035``) turns into what
``SelectorIsMember`` returns.  ``cmd.get_raw_alignment`` returns those same
columns in the same order, so the 1-based column ordinal is order-equivalent —
and ``min_tag`` (``Seeker.cpp:1725``) is the only thing the layout ever does
with a tag.

Part 1 is pure — ``find_tag`` and ``align_rows`` against hand-built rows, so a
regression names the exact rule it broke.  Part 2 is the live engine: two
``cmd.fab`` peptides of different length, a real ``cmd.align`` object, and the
resulting geometry cross-checked against ``cmd.get_raw_alignment`` itself.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p11_seqview.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import seqview  # noqa: E402

from conftest import WSClient  # noqa: E402

BOOTSTRAP = "from tenmol_bridge.panels import seqview; seqview.install()"

#: Two peptides whose alignment has a real two-residue insertion in the middle.
MOBILE_SEQ = "ACDFG"
TARGET_SEQ = "ACDKKFG"

MOBILE = "p11aln_mob"
TARGET = "p11aln_tgt"
ALIGN = "p11aln_obj"


# =========================================================================== #
# Part 1 — pure: SeekerFindTag and the second pass
# =========================================================================== #


class _FakeAtom(object):
    """Only the two attributes ``SeekerFindTag`` reads."""

    def __init__(self, index: int, guide: bool = False) -> None:
        self.index = index
        self.is_guide = guide


class TestFindTag:
    """``SeekerFindTag`` (``packages/engine/layer3/Seeker.cpp:928-966``)."""

    def test_a_guide_atom_with_a_tag_wins_outright(self) -> None:
        # N first (tag 7), then the guide CA (tag 9).  The C returns on the
        # guide, so the LATER tag wins even though 7 was seen first.
        group = [_FakeAtom(1), _FakeAtom(2, guide=True), _FakeAtom(3)]
        tags = {1: 7, 2: 9, 3: 11}
        assert seqview.find_tag(group, tags, 0) == 9

    def test_the_guide_wins_even_when_its_tag_is_the_SMALLER_one(self) -> None:
        """``return tag`` at ``:935`` is not the same as ``if(result < tag)``.

        Without the early return the running maximum would keep 20; the C
        returns the guide's 5.  This is the only case the two spellings differ
        in, which is why it is asserted on its own.
        """
        group = [_FakeAtom(1), _FakeAtom(2, guide=True)]
        assert seqview.find_tag(group, {1: 20, 2: 5}, 0) == 5
        # ...and for an atom column there is no guide rule at all.
        assert seqview.find_tag(group, {1: 20, 2: 5}, 2) == 20

    def test_without_a_guide_the_first_non_zero_tag_is_kept(self) -> None:
        group = [_FakeAtom(1), _FakeAtom(2), _FakeAtom(3)]
        assert seqview.find_tag(group, {2: 5, 3: 8}, 0) == 5

    def test_an_untagged_residue_is_zero(self) -> None:
        group = [_FakeAtom(1), _FakeAtom(2, guide=True)]
        assert seqview.find_tag(group, {99: 3}, 0) == 0

    def test_a_tagged_guide_is_ignored_for_atom_and_chain_columns(self) -> None:
        """``codes < 2`` gates BOTH guide branches (``:934``, ``:938``)."""
        group = [_FakeAtom(1), _FakeAtom(2, guide=True)]
        tags = {1: 7, 2: 9}
        assert seqview.find_tag(group, tags, 0) == 9   # residue codes
        assert seqview.find_tag(group, tags, 1) == 9   # residue names
        assert seqview.find_tag(group, tags, 2) == 7   # atom names
        assert seqview.find_tag(group, tags, 3) == 7   # chains


def _row(codes: int, spec) -> dict:
    """A row of ``(text, tag)`` pairs in the shape ``align_rows`` consumes.

    ``isAbbr``/``hintNoSpace`` are set the way ``_build_cells`` sets them for
    ``codes == 0`` — one-letter columns, and ``hint_no_space`` on every one that
    follows another (``packages/engine/layer3/Seeker.cpp:1289``) — because those two flags are
    exactly what the space arithmetic reads.
    """
    cells = []
    last_abbr = False
    for text, tag in spec:
        is_abbr = codes == 0 and len(text) == 1
        cell = seqview._cell(
            text, 0, tag=tag, is_abbr=is_abbr, hint_no_space=last_abbr
        )
        cells.append(cell)
        last_abbr = is_abbr
    return {"codes": codes, "cells": cells}


def _picture(rows, fill_char="-"):
    """Render the rows the way ``CSeq::draw`` would, cells plus fill runs."""
    out = []
    for row in rows:
        buf = {}
        for cell in row["cells"]:
            for i, char in enumerate(cell["text"]):
                buf[cell["offset"] + i] = char
        for run in row["fill"]:
            for i in range(run["width"]):
                buf.setdefault(run["offset"] + i, fill_char)
        width = max(buf) + 1 if buf else 0
        out.append("".join(buf.get(i, " ") for i in range(width)))
    return out


class TestAlignRows:
    """The SECOND PASS in alignment mode (``packages/engine/layer3/Seeker.cpp:1583-1793``)."""

    def test_equal_tags_land_in_the_same_character_column(self) -> None:
        rows = [
            _row(0, [("A", 1), ("C", 2), ("F", 5), ("G", 6)]),
            _row(0, [("A", 1), ("C", 2), ("K", 0), ("K", 0), ("F", 5), ("G", 6)]),
        ]
        seqview.align_rows(rows, 0)
        assert [c["offset"] for c in rows[0]["cells"]] == [0, 1, 4, 5]
        assert [c["offset"] for c in rows[1]["cells"]] == [0, 1, 2, 3, 4, 5]
        assert _picture(rows) == ["AC--FG", "ACKKFG"]

    def test_the_untagged_columns_are_the_unaligned_ones(self) -> None:
        rows = [
            _row(0, [("A", 1), ("F", 5)]),
            _row(0, [("A", 1), ("K", 0), ("F", 5)]),
        ]
        seqview.align_rows(rows, 0)
        assert [c["unaligned"] for c in rows[0]["cells"]] == [False, False]
        assert [c["unaligned"] for c in rows[1]["cells"]] == [False, True, False]

    def test_the_row_that_is_missing_a_column_gets_the_fill_run(self) -> None:
        rows = [
            _row(0, [("A", 1), ("F", 5)]),
            _row(0, [("A", 1), ("K", 0), ("K", 0), ("F", 5)]),
        ]
        seqview.align_rows(rows, 0)
        assert rows[0]["fill"] == [{"offset": 1, "width": 1}, {"offset": 2, "width": 1}]
        assert rows[1]["fill"] == []

    @pytest.mark.parametrize("mode", [0, 1, 2])
    def test_modes_0_1_2_pack_both_rows_into_one_column(self, mode: int) -> None:
        """``stagger == false`` (``:1590-1596``): one shared column, max width."""
        rows = [
            _row(0, [("A", 1), ("O", 0)]),
            _row(0, [("A", 1), ("O", 0)]),
        ]
        seqview.align_rows(rows, mode)
        assert rows[0]["cells"][1]["offset"] == 1
        assert rows[1]["cells"][1]["offset"] == 1
        # `if(stagger || r2->tag || r2->spacer)` (`:1662`) is false for two
        # untagged non-spacers, so neither row is infilled.
        assert rows[0]["fill"] == [] and rows[1]["fill"] == []

    @pytest.mark.parametrize("mode", [3, 4, 5])
    def test_modes_3_4_5_give_each_row_its_own_column(self, mode: int) -> None:
        rows = [
            _row(0, [("A", 1), ("O", 0)]),
            _row(0, [("A", 1), ("O", 0)]),
        ]
        seqview.align_rows(rows, mode)
        assert rows[0]["cells"][1]["offset"] == 1
        assert rows[1]["cells"][1]["offset"] == 2
        assert rows[0]["fill"] == [{"offset": 2, "width": 1}]
        assert rows[1]["fill"] == [{"offset": 1, "width": 1}]
        assert _picture(rows) == ["AO-", "A-O"]

    def test_a_row_that_has_run_out_is_still_filled_to_the_full_width(self) -> None:
        """The ``else`` arm of both infill loops (``:1668``, ``:1774``)."""
        rows = [_row(0, [("A", 1)]), _row(0, [("A", 1), ("C", 2), ("D", 3)])]
        seqview.align_rows(rows, 0)
        assert rows[0]["fill"] == [{"offset": 1, "width": 1}, {"offset": 2, "width": 1}]
        assert _picture(rows) == ["A--", "ACD"]

    def test_three_letter_columns_get_the_separating_space(self) -> None:
        """``codes`` truthy short-circuits every space test (``:1631``, ``:1741``)."""
        rows = [
            _row(1, [("ALA", 1), ("PHE", 5)]),
            _row(1, [("ALA", 1), ("LYS", 0), ("PHE", 5)]),
        ]
        seqview.align_rows(rows, 0)
        assert [c["offset"] for c in rows[0]["cells"]] == [1, 9]
        assert [c["offset"] for c in rows[1]["cells"]] == [1, 5, 9]
        assert _picture(rows) == [" ALA --- PHE", " ALA LYS PHE"]

    def test_one_letter_columns_are_packed_with_no_space(self) -> None:
        """``hint_no_space``/``hint_tagged_no_space`` keep abbreviations tight."""
        rows = [_row(0, [("A", 1), ("C", 2), ("D", 3)])]
        seqview.align_rows(rows, 0)
        assert [c["offset"] for c in rows[0]["cells"]] == [0, 1, 2]

    def test_no_rows_is_not_an_error(self) -> None:
        seqview.align_rows([], 0)


class TestFillAndUnalignedColour:
    """``CSeq::draw``'s two settings reads (``packages/engine/layer1/Seq.cpp:316-338``)."""

    class _Cmd(object):
        def __init__(self, **values):
            self.values = values

        def get_setting_text(self, name, obj=""):
            return self.values.get(name)

        def get_setting_int(self, name, obj=""):
            return self.values.get(name)

    def test_only_the_first_character_of_fill_char_is_used(self) -> None:
        assert seqview.fill_char(self._Cmd(seq_view_fill_char="~=")) == "~"

    def test_a_space_means_no_fill_at_all(self) -> None:
        """``if(fill_char == ' ') fill_char = 0;`` (``:342``)."""
        assert seqview.fill_char(self._Cmd(seq_view_fill_char=" ")) == ""
        assert seqview.fill_char(self._Cmd(seq_view_fill_char="")) == ""

    def test_the_default_unaligned_colour_is_the_fill_colour(self) -> None:
        cmd = self._Cmd(seq_view_unaligned_color=-1)
        assert seqview.unaligned_color(cmd, 0, 104) == 104
        assert seqview.unaligned_color(cmd, 5, 104) == 104

    def test_mode_3_leaves_the_column_its_own_colour(self) -> None:
        """``case 3: unaligned_color_index = -1;`` (``:325-327``)."""
        cmd = self._Cmd(seq_view_unaligned_color=-1)
        assert seqview.unaligned_color(cmd, 3, 104) == -1

    def test_an_explicit_unaligned_colour_survives_every_mode(self) -> None:
        cmd = self._Cmd(seq_view_unaligned_color=12)
        assert [seqview.unaligned_color(cmd, m, 104) for m in range(6)] == [12] * 6


# =========================================================================== #
# Part 2 — the real bridge, the real engine
# =========================================================================== #


@pytest.fixture(scope="module")
def aln_ws(bridge) -> WSClient:
    """Two peptides and a real ``cmd.align`` object, torn down at the end.

    Everything is namespaced ``p11aln_*``.  The three globals this module moves
    (``seq_view_unaligned_mode``, ``seq_view_fill_char``, ``seq_view_alignment``)
    are put back, because the bridge suite shares ONE PyMOL process.
    """
    ws = WSClient(bridge.ws_url)
    ws.call("cmd.do", BOOTSTRAP, 0, 0)
    assert ws.call("cmd.tenmol_seqview", "install")["installed"] is True

    ws.call("cmd.fab", MOBILE_SEQ, MOBILE)
    ws.call("cmd.fab", TARGET_SEQ, TARGET)
    ws.call("cmd.align", MOBILE, TARGET, object=ALIGN, cycles=0)
    ws.call("cmd.set", "seq_view", 1, MOBILE)
    ws.call("cmd.set", "seq_view", 1, TARGET)
    yield ws
    ws.call("cmd.set", "seq_view_unaligned_mode", 0)
    ws.call("cmd.set", "seq_view_fill_char", "-")
    ws.call("cmd.set", "seq_view_alignment", "")
    ws.call("cmd.set", "seq_view_format", 0)
    ws.call("cmd.set", "seq_view_gap_mode", 1)
    ws.call("cmd.delete", ALIGN)
    ws.call("cmd.delete", MOBILE)
    ws.call("cmd.delete", TARGET)
    ws.close()


def _payload(ws: WSClient, first: int = 0, count: int = 1200) -> dict:
    return ws.call("cmd.tenmol_seqview", "rows", -1, first, count)


def _rows(payload: dict) -> dict:
    return {row["object"]: row for row in payload["rows"]}


def _text(row: dict) -> str:
    """The row as one string, cells and fill runs together — what a user sees."""
    buf = {}
    for cell in row["cells"]:
        for i, char in enumerate(cell["text"]):
            buf[cell["offset"] + i] = char
    for run in row["fill"]:
        for i in range(run["width"]):
            buf.setdefault(run["offset"] + i, "-")
    width = max(buf) + 1 if buf else 0
    return "".join(buf.get(i, " ") for i in range(width))


class TestTheAlignmentIsFound:
    def test_the_first_enabled_alignment_object_becomes_the_active_one(
        self, aln_ws: WSClient
    ) -> None:
        """``ExecutiveGetActiveAlignment`` case 2 (``Executive.cpp:3410-3419``)."""
        assert _payload(aln_ws)["alignment"] == ALIGN

    def test_seq_view_alignment_names_it_explicitly(self, aln_ws: WSClient) -> None:
        """Case 1 (``:3406``) — the setting wins over the enabled-object scan."""
        aln_ws.call("cmd.set", "seq_view_alignment", ALIGN)
        try:
            assert _payload(aln_ws)["alignment"] == ALIGN
        finally:
            aln_ws.call("cmd.set", "seq_view_alignment", "")

    def test_a_stale_setting_turns_alignment_mode_OFF(self, aln_ws: WSClient) -> None:
        """``SelectorIndexByName`` returns -1 and the C takes the plain branch."""
        aln_ws.call("cmd.set", "seq_view_alignment", "p11aln_does_not_exist")
        try:
            payload = _payload(aln_ws)
            assert payload["alignment"] == ""
            assert all(
                "tag" not in cell
                for row in payload["rows"]
                for cell in row["cells"]
            )
        finally:
            aln_ws.call("cmd.set", "seq_view_alignment", "")

    def test_disabling_the_alignment_object_turns_the_mode_off(
        self, aln_ws: WSClient
    ) -> None:
        aln_ws.call("cmd.disable", ALIGN)
        try:
            payload = _payload(aln_ws)
            assert payload["alignment"] == ""
            rows = _rows(payload)
            # Back to the wave-10 measurement exactly: 5 and 7 plain columns.
            assert rows[MOBILE]["nCols"] == len(MOBILE_SEQ)
            assert rows[TARGET]["nCols"] == len(TARGET_SEQ)
            assert [c["offset"] for c in rows[MOBILE]["cells"]] == [0, 1, 2, 3, 4]
        finally:
            aln_ws.call("cmd.enable", ALIGN)


class TestTagsAndLineUp:
    def test_every_aligned_cell_carries_a_tag(self, aln_ws: WSClient) -> None:
        """The wave-10 gap: every cell's tag was null.  Now none of them is."""
        rows = _rows(_payload(aln_ws))
        assert [c.get("tag") for c in rows[MOBILE]["cells"]] == [
            c.get("tag") for c in rows[MOBILE]["cells"]
        ]
        assert all(c.get("tag") for c in rows[MOBILE]["cells"])
        target_tags = [c.get("tag") for c in rows[TARGET]["cells"]]
        # The two inserted lysines have no counterpart in the 5-mer.
        assert target_tags[3] is None and target_tags[4] is None
        assert len([t for t in target_tags if t]) == 5

    def test_the_tag_is_the_guide_atoms_raw_alignment_column(
        self, aln_ws: WSClient
    ) -> None:
        """Cross-checked against ``cmd.get_raw_alignment`` itself, not asserted."""
        raw = aln_ws.call("cmd.get_raw_alignment", ALIGN)
        column_of = {}
        for ordinal, column in enumerate(raw, start=1):
            for obj, index in column:
                column_of[(obj, int(index))] = ordinal

        rows = _rows(_payload(aln_ws))
        guides = aln_ws.call(
            "cmd.index", "(%s or %s) and name CA" % (MOBILE, TARGET)
        )
        guide_index = {}
        for obj, index in guides:
            guide_index.setdefault(obj, []).append(int(index))

        for name in (MOBILE, TARGET):
            residues = [c for c in rows[name]["cells"] if c["atoms"]]
            for cell, ca in zip(residues, sorted(guide_index[name])):
                assert cell.get("tag", 0) == column_of.get((name, ca), 0), (
                    name,
                    cell["resi"],
                )

    def test_the_rows_line_up_by_tag(self, aln_ws: WSClient) -> None:
        rows = _rows(_payload(aln_ws))
        by_tag = {}
        for name in (MOBILE, TARGET):
            for cell in rows[name]["cells"]:
                if cell.get("tag"):
                    by_tag.setdefault(cell["tag"], []).append(cell["offset"])
        assert by_tag, "no tagged cells at all"
        assert len(by_tag) == 5
        for tag, offsets in by_tag.items():
            assert len(offsets) == 2, tag
            assert offsets[0] == offsets[1], (tag, offsets)

    def test_the_strip_reads_as_a_pairwise_alignment(self, aln_ws: WSClient) -> None:
        """The whole point, as one string per row."""
        rows = _rows(_payload(aln_ws))
        assert _text(rows[MOBILE]) == "ACD--FG"
        assert _text(rows[TARGET]) == "ACDKKFG"

    def test_the_insertion_is_flagged_unaligned_and_nothing_else_is(
        self, aln_ws: WSClient
    ) -> None:
        rows = _rows(_payload(aln_ws))
        assert [c.get("unaligned", False) for c in rows[MOBILE]["cells"]] == [
            False
        ] * 5
        assert [c.get("unaligned", False) for c in rows[TARGET]["cells"]] == [
            False,
            False,
            False,
            True,
            True,
            False,
            False,
        ]

    def test_the_shorter_row_carries_the_fill_runs(self, aln_ws: WSClient) -> None:
        rows = _rows(_payload(aln_ws))
        assert rows[MOBILE]["fill"] == [
            {"offset": 3, "width": 1},
            {"offset": 4, "width": 1},
        ]
        assert rows[TARGET]["fill"] == []

    def test_three_letter_mode_lines_up_the_same_way(self, aln_ws: WSClient) -> None:
        aln_ws.call("cmd.set", "seq_view_format", 1)
        try:
            rows = _rows(_payload(aln_ws))
            assert _text(rows[MOBILE]) == " ALA CYS ASP --- --- PHE GLY"
            assert _text(rows[TARGET]) == " ALA CYS ASP LYS LYS PHE GLY"
        finally:
            aln_ws.call("cmd.set", "seq_view_format", 0)

    def test_the_residue_number_labels_follow_the_new_offsets(
        self, aln_ws: WSClient
    ) -> None:
        """The C redoes its THIRD pass after the second (``:1817-1914``).

        ``next_open = offset + len(text) + 1`` suppresses a label that would
        collide with the one before it, so asking for one per residue on a
        one-letter row gives 1, 3, 4 — and residue 4 lands at CHARACTER 5, which
        is only true because the alignment pass moved it there (it is at 3
        without the alignment, asserted below).
        """
        aln_ws.call("cmd.set", "seq_view_label_spacing", 1)
        try:
            labels = {
                lab["text"]: lab["offset"]
                for lab in _rows(_payload(aln_ws))[MOBILE]["labels"]
            }
            assert labels == {"1": 0, "3": 2, "4": 5}

            aln_ws.call("cmd.disable", ALIGN)
            plain = {
                lab["text"]: lab["offset"]
                for lab in _rows(_payload(aln_ws))[MOBILE]["labels"]
            }
            assert plain == {"1": 0, "3": 2, "5": 4}
        finally:
            aln_ws.call("cmd.enable", ALIGN)
            aln_ws.call("cmd.set", "seq_view_label_spacing", 5)


class TestStagger:
    """``seq_view_unaligned_mode`` 0-5 (``packages/engine/layer3/Seeker.cpp:1590-1596``)."""

    @pytest.mark.parametrize("mode", [0, 1, 2, 3, 4, 5])
    def test_the_mode_is_reported(self, aln_ws: WSClient, mode: int) -> None:
        aln_ws.call("cmd.set", "seq_view_unaligned_mode", mode)
        try:
            assert _payload(aln_ws)["unalignedMode"] == mode
        finally:
            aln_ws.call("cmd.set", "seq_view_unaligned_mode", 0)

    @pytest.mark.parametrize(
        "mode,expected", [(0, 104), (1, 104), (2, 104), (3, -1), (4, 104), (5, 104)]
    )
    def test_the_unaligned_colour_resolves_per_mode(
        self, aln_ws: WSClient, mode: int, expected: int
    ) -> None:
        aln_ws.call("cmd.set", "seq_view_unaligned_mode", mode)
        try:
            assert _payload(aln_ws)["unalignedColor"] == expected
        finally:
            aln_ws.call("cmd.set", "seq_view_unaligned_mode", 0)

    def test_a_shared_unaligned_column_packs_or_staggers(
        self, aln_ws: WSClient
    ) -> None:
        """Both rows untagged at the SAME column is the only case that differs.

        A water is never in an alignment, so one on each object gives both rows
        an untagged column at the same position — which is what ``stagger``
        decides the fate of.
        """
        for name in (MOBILE, TARGET):
            aln_ws.call(
                "cmd.pseudoatom",
                name,
                name="O",
                resn="HOH",
                resi="900",
                chain="",
                segi="",
                elem="O",
                pos=[9.0, 9.0, 9.0],
            )
        try:
            aln_ws.call("cmd.set", "seq_view_unaligned_mode", 0)
            rows = _rows(_payload(aln_ws))
            assert _text(rows[MOBILE]) == "ACD--FGO"
            assert _text(rows[TARGET]) == "ACDKKFGO"
            assert rows[MOBILE]["cells"][-1]["offset"] == 7
            assert rows[TARGET]["cells"][-1]["offset"] == 7

            aln_ws.call("cmd.set", "seq_view_unaligned_mode", 3)
            rows = _rows(_payload(aln_ws))
            assert rows[MOBILE]["cells"][-1]["offset"] == 7
            assert rows[TARGET]["cells"][-1]["offset"] == 8
            assert _text(rows[MOBILE]) == "ACD--FGO-"
            assert _text(rows[TARGET]) == "ACDKKFG-O"
        finally:
            aln_ws.call("cmd.set", "seq_view_unaligned_mode", 0)
            aln_ws.call("cmd.remove", "(%s or %s) and resn HOH" % (MOBILE, TARGET))


class TestTheFillRunsAreWindowedByOFFSET:
    """A fill run has no column index, so ``_window`` cannot slice it.

    It is filtered against the CHARACTER span the windowed cells of all rows
    cover, which is the only span the client can draw into.
    """

    def test_a_window_before_the_gap_carries_no_fill(self, aln_ws: WSClient) -> None:
        rows = _rows(_payload(aln_ws, 0, 3))
        assert [c["offset"] for c in rows[MOBILE]["cells"]] == [0, 1, 2]
        assert rows[MOBILE]["fill"] == []

    def test_a_window_over_the_gap_carries_it(self, aln_ws: WSClient) -> None:
        # mobile columns 3..4 are F and G at characters 5 and 6, but the TARGET
        # is showing characters 3..6, so the dashes have to come along.
        rows = _rows(_payload(aln_ws, 3, 4))
        assert [c["offset"] for c in rows[MOBILE]["cells"]] == [5, 6]
        assert [c["offset"] for c in rows[TARGET]["cells"]] == [3, 4, 5, 6]
        assert rows[MOBILE]["fill"] == [
            {"offset": 3, "width": 1},
            {"offset": 4, "width": 1},
        ]

    def test_a_window_past_the_gap_drops_it_again(self, aln_ws: WSClient) -> None:
        rows = _rows(_payload(aln_ws, 5, 5))
        assert rows[MOBILE]["cells"] == []
        assert rows[MOBILE]["fill"] == []
        assert [c["offset"] for c in rows[TARGET]["cells"]] == [5, 6]


class TestFillChar:
    def test_the_default_fill_char_is_a_dash(self, aln_ws: WSClient) -> None:
        assert _payload(aln_ws)["fillChar"] == "-"

    def test_a_space_switches_the_fill_off(self, aln_ws: WSClient) -> None:
        aln_ws.call("cmd.set", "seq_view_fill_char", " ")
        try:
            payload = _payload(aln_ws)
            assert payload["fillChar"] == ""
            # The RUNS are still there — the C keeps `row->fill` and only skips
            # the drawing (`packages/engine/layer1/Seq.cpp:488`), which is where the client
            # skips it too.
            assert _rows(payload)[MOBILE]["fill"] != []
        finally:
            aln_ws.call("cmd.set", "seq_view_fill_char", "-")

    def test_the_fill_colour_has_an_rgb_in_the_payload(self, aln_ws: WSClient) -> None:
        payload = _payload(aln_ws)
        rgb = payload["colors"][str(payload["fillColor"])]
        assert len(rgb) == 3 and all(0.0 <= c <= 1.0 for c in rgb)

    def test_the_background_comes_back_for_the_dim_blend(
        self, aln_ws: WSClient
    ) -> None:
        """Modes 1/4 average with `bg_rgb` (``packages/engine/layer1/Seq.cpp:424-431``)."""
        assert _payload(aln_ws)["bgColor"] == [0.0, 0.0, 0.0]
        aln_ws.call("cmd.set", "bg_rgb", "white")
        try:
            assert _payload(aln_ws)["bgColor"] == [1.0, 1.0, 1.0]
        finally:
            aln_ws.call("cmd.set", "bg_rgb", "black")


class TestGapsAreSuppressed:
    """``&& align_sele < 0`` (``packages/engine/layer3/Seeker.cpp:1235``)."""

    def test_a_sequence_gap_draws_no_dashes_under_an_alignment(
        self, aln_ws: WSClient
    ) -> None:
        # Delete residue 3 of the target so its numbering jumps 2 -> 4.
        aln_ws.call("cmd.create", "p11aln_gap", "%s and not resi 3" % TARGET)
        aln_ws.call("cmd.set", "seq_view", 1, "p11aln_gap")
        try:
            with_alignment = _rows(_payload(aln_ws))["p11aln_gap"]
            assert [c["text"] for c in with_alignment["cells"]] == list("ACKKFG")
            assert not any(c.get("spacer") for c in with_alignment["cells"])

            aln_ws.call("cmd.disable", ALIGN)
            without = _rows(_payload(aln_ws))["p11aln_gap"]
            assert [c["text"] for c in without["cells"]] == list("AC-KKFG")
            assert without["cells"][2]["spacer"] is True
        finally:
            aln_ws.call("cmd.enable", ALIGN)
            aln_ws.call("cmd.delete", "p11aln_gap")

    def test_select_range_addresses_the_same_columns_the_payload_showed(
        self, aln_ws: WSClient
    ) -> None:
        """``select_range`` rebuilds the row, so it must see the same context."""
        rows = _rows(_payload(aln_ws))
        cells = rows[TARGET]["cells"]
        assert [c["text"] for c in cells] == list("ACDKKFG")
        result = aln_ws.call(
            "cmd.tenmol_seqview", "select_range", TARGET, 3, 4, 1, 1
        )
        try:
            assert result["columns"] == [3, 4]
            expected = sum(len(c["atoms"]) for c in cells[3:5])
            assert expected == 44
            assert aln_ws.call("cmd.count_atoms", result["name"]) == expected
            # Columns 3 and 4 are the two inserted lysines, and nothing else.
            assert (
                aln_ws.call("cmd.count_atoms", "%s and resn LYS" % result["name"])
                == expected
            )
        finally:
            aln_ws.call("cmd.select", result["name"], "none")
            aln_ws.call("cmd.delete", result["name"])


class TestNothingChangesWithoutAnAlignment:
    """The 1,742-test tree has to keep passing: the plain path is untouched."""

    def test_a_lone_object_has_no_tags_no_fill_and_no_unaligned(
        self, aln_ws: WSClient
    ) -> None:
        aln_ws.call("cmd.disable", ALIGN)
        try:
            payload = _payload(aln_ws)
            assert payload["alignment"] == ""
            for row in payload["rows"]:
                assert row["fill"] == []
                assert all("tag" not in c for c in row["cells"])
                assert all("unaligned" not in c for c in row["cells"])
        finally:
            aln_ws.call("cmd.enable", ALIGN)
