"""WP-18 / parity area 6, wave 9 — the file-import gaps left after wave 8.

Wave 8 (``test_p8_a6.py``) ran the alignment dialog's OK button and the
``brix``/``o`` map branch for the first time.  What its own notes still left
unmeasured, and what this file measures on the live engine:

* **255** the OTHER half of ``load_aln_dialog``: the ``ValueError`` fallback.
  A one-record FASTA and a RAGGED FASTA both skip the mapping dialog and go to
  a plain ``cmd.load``, which for a sequence file means ``fab``-built extended
  structures — proven by atom counts and phi/psi geometry, not by "it loaded".
* **257** the brix/o branch driven by the DIALOG'S OWN generated script,
  verbatim and in one go, instead of a hand-written ``load`` + ``isomesh``:
  the ``set normalize_o_maps`` line, all three representation lines, and the
  ``, <sele>, <buffer>, carve=<buffer>`` suffix the CCP4 branch has never been
  run with either.
* **259** the CIF/CNS/HKL half of the row's NOT-COVERED clause. Measured
  first, then fixed: ``map_generate_run`` handed a reflection CIF used to walk
  into ``headering.MTZHeader``'s binary parser and come back with whatever
  ``struct``/``UnicodeDecodeError`` fell out of it; ``map_generate_info``
  already refused the same file with a sentence naming ``creating.py:234-236``.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p9_f1.py -q
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

NS = "cmd.tenmol_files"
BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA = os.path.join(REPO, "packages", "engine", "testing", "data")
BRIX = os.path.join(DATA, "emd_1155.brix")
CCP4 = os.path.join(DATA, "emd_1155.ccp4")
MTZ = os.path.join(DATA, "4rwb.mtz")
#: A reflection file in mmCIF form — the format the Pmw dialog offered and
#: ``cmd.map_generate`` cannot read.
CIF = os.path.join(DATA, "1bna.cif")


@pytest.fixture
def files(ws):
    """The file service, installed the way the browser installs it."""
    ws.do(BOOTSTRAP)
    yield ws


@pytest.fixture
def scratch(files):
    """Delete everything this file makes.

    ONE PYMOL PER SUITE. Names are swept by prefix and `fab` also leaves
    `_pk*` selections behind (`editor.py`), so both are cleaned.
    """
    yield files
    for name in list(files.call("cmd.get_names", "all") or []):
        if name.startswith("p9f1"):
            files.call("cmd.delete", name)
    files.do("delete _pk*")


@pytest.fixture
def normalize_settings(files):
    """Both map-normalisation settings are GLOBAL: save and restore."""
    before = {
        name: files.call("cmd.get", name)
        for name in ("normalize_o_maps", "normalize_ccp4_maps")
    }
    yield before
    for name, value in before.items():
        files.call("cmd.set", name, value)


def _run_script(ws, script: str) -> None:
    """Execute a generated dialog script the way `FilesPanel.runCommand` does.

    `cmd.do` per non-blank line, so the console echo and the log file see the
    same lines the preview box showed (`file_dialogs.py` builds ONE string and
    `parent.cmd.do(command)` runs it).
    """
    for line in script.split("\n"):
        if line.strip():
            ws.do(line)


# =========================================================================== #
# Row 255 — load_aln_dialog's ValueError fallback
# =========================================================================== #


RAGGED = ">a\nACDEFGHIKL\n>b\nACDEF\n"
SINGLE = ">p9f1only\nACDEFGHIKLMNPQRS\n"
ALIGNED = ">a\nACDEFGHIKLMNPQRS\n>b\nACD--GHIKLMNPQRS\n"


class TestFastaFallback:
    """``:214-222`` — "fasta files which don't contain alignments will be
    loaded as extended structures (fab command) instead"."""

    @pytest.mark.parametrize("body,why", [(RAGGED, "ragged"), (SINGLE, "single")])
    def test_the_dialog_is_skipped_and_the_reason_is_reported(
        self, files, tmp_path, body, why
    ):
        path = tmp_path / ("p9f1_%s.fasta" % why)
        path.write_text(body)
        info = files.call(NS + ".aln_dialog_info", str(path), "fasta")
        assert info["fallback"] is True, info
        assert info["ids"] == [] and info["mapping"] == {}
        # A REASON, not just a flag: the ragged file is `aln_magic_read`
        # raising, the single-record one is the dialog's own `len < 2` test.
        assert info["error"]

    def test_an_aligned_fasta_is_NOT_a_fallback(self, files, tmp_path):
        """The negative half — otherwise "fallback" could just be always true."""
        path = tmp_path / "p9f1_aligned.fasta"
        path.write_text(ALIGNED)
        info = files.call(NS + ".aln_dialog_info", str(path), "fasta")
        assert info["fallback"] is False, info
        assert info["ids"] == ["a", "b"]

    def test_the_fallback_load_really_builds_extended_structures(
        self, scratch, tmp_path
    ):
        """`cmd.load` on a sequence FASTA goes through `fab`, not a parser.

        MEASURED, and the object name is the surprise: `_processFASTA`
        (`importing.py:485-514`) IGNORES the `oname` argument and fabs one
        object per record, named after the record id — so the 16-residue
        record `>p9f1only` becomes the object `p9f1only`, not the name passed
        to `cmd.load`. The backbone is EXTENDED, `fab`'s `ss=0` default
        (`editor.py: build_peptide`): phi of residue 2 is 180 degrees, where a
        helix would be -57.
        """
        ws = scratch
        path = tmp_path / "p9f1_single.fasta"
        path.write_text(SINGLE)
        ws.call("cmd.load", str(path), "p9f1ignored")
        names = ws.call("cmd.get_names", "all") or []
        assert "p9f1only" in names and "p9f1ignored" not in names, names
        assert ws.call("cmd.get_type", "p9f1only") == "object:molecule"
        assert ws.call("cmd.count_atoms", "p9f1only and name CA") == 16
        phi = ws.call(
            "cmd.get_dihedral",
            "p9f1only and resi 1 and name C",
            "p9f1only and resi 2 and name N",
            "p9f1only and resi 2 and name CA",
            "p9f1only and resi 2 and name C",
        )
        assert abs(abs(phi) - 180.0) < 1e-2, phi

    def test_a_fasta_still_routes_to_the_alignment_dialog_first(self, files, tmp_path):
        """The fallback is decided INSIDE the dialog, not by the classifier.

        `load_dialog` (`:52`) sends every `aln`/`fasta` to `load_aln_dialog`;
        only the reader's `ValueError` turns it into a plain load. If the
        classifier short-circuited it, an ALIGNED fasta would never get its
        mapping table.
        """
        path = tmp_path / "p9f1_single.fasta"
        path.write_text(SINGLE)
        info = files.call(NS + ".classify", str(path))
        assert info["dialog"] == "aln" and info["alnFormat"] == "fasta"


# =========================================================================== #
# Row 257 — the brix/o branch, run as the DIALOG'S OWN script
# =========================================================================== #


#: The script `load_map_dialog.get_command` (`file_dialogs.py:344-380`) renders
#: into its preview box for the brix branch, normalize ticked, object name
#: typed, level 1.0, all three representation boxes ticked.
#:
#: A LITERAL ON PURPOSE, and it is checked against the generator rather than
#: standing in for it: the client's `mapCommand`
#: (`apps/web/src/features/files/commands.ts`) is asserted to produce these
#: exact bytes in
#: `apps/web/src/features/files/p9f1LoadDialogs.dom.test.tsx`, and this file
#: feeds the same bytes to the engine. Re-deriving the string here would only
#: test that two copies of our own code agree.
BRIX_SCRIPT = (
    "set normalize_o_maps, 1\n"
    "load %s, \\\n"
    "    %s\n"
    "volume %s_volume, %s, 1.0 blue .5 2.0 yellow 0\n"
    "isomesh %s_isomesh, %s, 1.0\n"
    "isosurface %s_isosurface, %s, 1.0"
)


def brix_script(name: str) -> str:
    return BRIX_SCRIPT % (BRIX, name, name, name, name, name, name, name)


class TestBrixDialogScript:
    def test_the_generated_script_builds_the_map_and_all_three_reps(
        self, scratch, normalize_settings
    ):
        """One script, four objects, and the o-setting written by line 1.

        Wave 8 ran `load` and `isomesh` as two hand-written lines; this is what
        the dialog actually emits, including the `volume`'s two-stop ramp.

        IT ALSO SETTLES THE LINE-CONTINUATION QUESTION. Both the Qt dialog and
        `FilesPanel.runCommand` execute the script LINE BY LINE, and the load
        line ends in a bare `\\`. MEASURED here, PyMOL's parser keeps the
        continuation across two separate `cmd.do` calls — the console shows
        `PyMOL>load …, \\` then `PyMOL>    p9f1brix`, and the engine answers
        `CmdLoad: … loaded as "p9f1brix"`, i.e. the typed name is honoured
        rather than lost with the second line.
        """
        ws = scratch
        ws.do("set normalize_o_maps, 0")
        assert ws.call("cmd.get", "normalize_o_maps") == "off"

        _run_script(ws, brix_script("p9f1brix"))

        assert ws.call("cmd.get", "normalize_o_maps") == "on"
        assert ws.call("cmd.get_type", "p9f1brix") == "object:map"
        assert ws.call("cmd.get_type", "p9f1brix_volume") == "object:volume"
        assert ws.call("cmd.get_type", "p9f1brix_isomesh") == "object:mesh"
        assert ws.call("cmd.get_type", "p9f1brix_isosurface") == "object:surface"
        # …and the CCP4 setting was NOT touched: the branch is the difference.
        assert ws.call("cmd.get", "normalize_ccp4_maps") == normalize_settings[
            "normalize_ccp4_maps"
        ]

    def test_the_selection_buffer_and_carve_suffix_parses_and_carves(
        self, scratch, normalize_settings
    ):
        """`, <sele>, <buffer>, carve=<buffer>` — never run before, either branch.

        The suffix is appended to EVERY representation line (`:366-380`), so a
        malformed one would be a `CmdException` on each. Carving also has an
        observable effect: the mesh is built only within `buffer` A of the
        selection, so `count_atoms`-style emptiness is not the test — the
        object existing with the extra positional arguments accepted is.
        """
        ws = scratch
        # A selection to carve around, placed at the map's own centre so the
        # carve has something to keep.
        ws.do("set normalize_o_maps, 1")
        ws.do("load %s, p9f1carvemap" % BRIX)
        extent = ws.call("cmd.get_extent", "p9f1carvemap")
        middle = [(extent[0][i] + extent[1][i]) / 2.0 for i in range(3)]
        ws.call("cmd.pseudoatom", "p9f1sele", pos=middle)

        script = (
            "isomesh p9f1carve_isomesh, p9f1carvemap, 1.0, p9f1sele, 2.0, carve=2.0"
        )
        _run_script(ws, script)
        assert ws.call("cmd.get_type", "p9f1carve_isomesh") == "object:mesh"

    def test_o_and_ccp4_write_different_settings_from_the_same_bytes(
        self, scratch, normalize_settings
    ):
        """`emd_1155` ships in both encodings; only the setting line differs."""
        ws = scratch
        assert (
            ws.call(NS + ".map_dialog_info", BRIX, "o")["normalizeSetting"]
            == "normalize_o_maps"
        )
        assert (
            ws.call(NS + ".map_dialog_info", CCP4, "ccp4")["normalizeSetting"]
            == "normalize_ccp4_maps"
        )
        # And the dialog reads the CURRENT value for its checkbox, both ways.
        ws.do("set normalize_o_maps, 0")
        assert ws.call(NS + ".map_dialog_info", BRIX, "o")["normalize"] is False
        ws.do("set normalize_o_maps, 1")
        assert ws.call(NS + ".map_dialog_info", BRIX, "o")["normalize"] is True


# =========================================================================== #
# Row 259 — the CIF/CNS/HKL half
# =========================================================================== #


class TestNonMtzReflectionFiles:
    def test_the_info_call_names_the_upstream_line_that_refuses(self, files):
        info = files.call(NS + ".map_generate_info", CIF)
        assert info["headerClass"] == "CIFHeader"
        assert "MTZ only" in (info["error"] or ""), info
        assert info["amplitudes"] == [] and info["phases"] == []

    def test_run_refuses_the_same_file_instead_of_entering_the_binary_parser(
        self, files
    ):
        """MEASURED BEFORE THE FIX: `map_generate_run` had no header check, so
        a `.cif` reached `headering.MTZHeader`, whose `parseFile` seeks to a
        header offset unpacked from bytes 4-8 of a TEXT file
        (`headering.py:261-302`) and fails with whatever `struct`/`unicode`
        error that produces — a stack-flavoured string in the dialog's error
        box. It now refuses with the same sentence `map_generate_info` uses.
        """
        report = files.call(NS + ".map_generate_run", CIF, "FWT", "PHWT")
        assert report["ok"] is False
        assert report["created"] is False
        assert "MTZ only" in (report["error"] or ""), report
        assert "creating.py:234-236" in report["error"]
        # Nothing was even attempted, so the build verdict is not touched.
        assert report["returned"] is None

    def test_the_mtz_path_is_still_reached(self, files):
        """The guard must not swallow the format it exists to serve.

        This build compiles the generator out (``NO_MMLIBS``), so the call
        comes back created=False — but it comes back from the ENGINE, with the
        prefix it allocated, not from the guard above.
        """
        report = files.call(
            NS + ".map_generate_run", MTZ,
            "cryst_1/data_1/FC", "cryst_1/data_1/PHIC",
        )
        assert report["ok"] is False
        # `crystal/dataset/COL` -> the DATASET element (`PyMOLMapLoad.py:245-254`).
        assert report["prefix"].startswith("data_1")
        assert "MTZ only" not in (report["error"] or "")
        assert "created no object" in report["error"]

    def test_a_column_that_is_not_in_the_file_is_still_the_engine_talking(
        self, files
    ):
        """`creating.py:247` raises before the C call, and that is the dialog's
        column validation. Unchanged by the new guard."""
        report = files.call(
            NS + ".map_generate_run", MTZ, "cryst_1/data_1/NOPE", "cryst_1/data_1/PHIC"
        )
        assert report["ok"] is False
        assert "no dataset found" in (report["error"] or "")
