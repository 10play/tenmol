"""Wave 10 — naming the wall that keeps row 259 open, on the live engine.

Row 259 (the legacy Tk ``PyMOLMapLoad`` dialog) has been narrowed by three
waves to a single sentence: *no map can be synthesised at all until PyMOL is
built with MMLIBS*.  Everything else about that dialog is measured elsewhere
(``test_p9_f1.py`` for the CIF/CNS refusal and the column validation,
``test_f7_legacyfiles.py`` for the representation branches with the
compiled-out call substituted).

What was NEVER asserted anywhere is the IDENTITY of the failure — every test
so far stops at "created no object", which is equally consistent with a bad
column name, a corrupt file, or a bug in this panel.  This file pins it to the
one thing it actually is, so the row can be reported BLOCKED-on-a-C++-build
with evidence rather than with a citation:

    layer3/Executive.cpp:6929-6935

        #ifndef NO_MMLIBS
          ok = !(primex_pymol_driver2(...));
        #else
          PRINTFB(G, FB_Executive, FB_Errors)
          " Error: MTZ map loading not supported in this PyMOL build.\\n" ENDFB(G);
        #endif

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_p10_menus.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

NS = "cmd.tenmol_files"
BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MTZ = os.path.join(REPO, "testing", "data", "4rwb.mtz")

#: The columns `map_generate_info` guesses for this file — a VALID pair, so a
#: failure cannot be blamed on the dialog's own column validation
#: (`creating.py:247`, which raises ' Error: no dataset found' before the C
#: call and is pinned by test_p9_f1.py).
AMPLITUDES = "cryst_1/data_1/FC"
PHASES = "cryst_1/data_1/PHIC"


@pytest.fixture
def files(ws):
    ws.do(BOOTSTRAP)
    yield ws


class TestMapGenerateIsBlockedByTheBuild:
    """Row 259's remaining gap, identified rather than assumed."""

    def test_the_columns_are_the_ones_the_dialog_itself_would_pick(self, files):
        """Preflight: this file, and these column names, are the happy path.

        Without this the failure below could be a typo.  ``map_generate_info``
        is what fills the Pmw dialog's option menus (`PyMOLMapLoad.py:95-115`),
        so if it offers these two the dialog's OK button would send these two.
        """
        info = files.call(NS + ".map_generate_info", MTZ)
        assert info["headerClass"] == "MTZHeader", info
        assert info["error"] is None, info
        assert AMPLITUDES in info["amplitudes"], info["amplitudes"]
        assert PHASES in info["phases"], info["phases"]
        # MEASURED, and worth recording because it looks like a bug and is not:
        # `guessCols` matches on NAMES (`2FOFCWT`/`FWT`/`PH2FOFCWT`…) and this
        # file's columns are `FC`/`PHIC`, so neither guess fires and the Pmw
        # dialog would open with its option menus on the first entry
        # (`PyMOLMapLoad.py:71-100`).
        assert info["guessAmplitudes"] is None, info
        assert info["guessPhases"] is None, info

    def test_the_engine_prints_the_NO_MMLIBS_line_and_creates_nothing(
        self, files, bridge
    ):
        """The wall itself: the C++ ``#else`` branch, on the console.

        MEASURED on this tree.  The Python half runs to completion — the
        prefix is allocated from the MTZ's own DATASET element, so the call
        reached ``cmd.map_generate`` — and the only thing that failed is the
        compiled-out generator.
        """
        report = files.call(NS + ".map_generate_run", MTZ, AMPLITUDES, PHASES)

        assert report["ok"] is False
        assert report["created"] is False
        # `crystal/dataset/COL` -> the DATASET element (`PyMOLMapLoad.py:245-254`).
        assert report["prefix"].startswith("data_1"), report
        # `creating.py:289` returns the name even when the map does not exist,
        # which is why upstream's Tk dialog goes on to isomesh a missing map.
        assert report["returned"] == report["prefix"], report
        assert "created no object" in (report["error"] or ""), report
        # No representation was attempted on a map that is not there.
        assert report["reps"] == [], report

        lines = bridge.wait_for_feedback("MTZ map loading not supported")
        hits = [line for line in lines if "MTZ map loading not supported" in line]
        assert hits, lines[-12:]
        # The exact sentence of the `#else` branch (`Executive.cpp:6933`).
        assert hits[-1].strip() == (
            "Error: MTZ map loading not supported in this PyMOL build."
        )
        # …and `creating.py:279`'s own follow-up, so the whole chain is pinned.
        assert any("Map generation failed" in line for line in lines), lines[-12:]

    def test_the_probe_reports_the_build_after_the_attempt(self, files):
        """`supported` is None until something tries, then False forever.

        Nothing STATIC distinguishes an ``NO_MMLIBS`` build from a full one
        (``panels/files.py::map_generate_info``), so this is the only signal
        the dialog can disable itself from — and it must survive the run above.
        """
        info = files.call(NS + ".map_generate_info", MTZ)
        assert info["supported"] is False, info
        assert "NO_MMLIBS" in info["buildNote"]

    def test_nothing_named_data_1_is_in_the_session(self, files):
        """The failed run left no wreckage behind either."""
        names = files.call("cmd.get_names")
        assert [n for n in names if n.startswith("data_1")] == [], names
