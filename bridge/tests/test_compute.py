"""Parity area 11 — the `pymol.util` compute helpers.

Two rows were open here:

* **`util.get_sasa_relative`** — the one helper whose return value the wire
  codec refuses (`NotSerializable: dict key of type tuple`).  It now goes
  through `tenmol_bridge.panels.compute`, which re-keys the 4-tuple.
* **"Remaining `util` helpers"** — `label_chains`, `label_segments`, `phipsi`,
  `b2vdw`, `interchain_distances`, `mass_align`, `ff_copy`,
  `enable_all_shaders`, recorded by B9 as "previously unnamed anywhere" and
  therefore never scheduled.

The second group is the reason this file runs them rather than asserting on a
table of names: three of them do NOT take the shared selection the panel had
been passing to everything, and two of them fail in ways their signatures do
not suggest.  Both were found by running them, not by reading them.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_compute.py -q
"""

from __future__ import annotations

import json
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import compute as compute_panel  # noqa: E402
from tenmol_bridge.policy import build_policy  # noqa: E402

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test",
    "dat",
)


# =========================================================================== #
# Pure — no socket, no PyMOL
# =========================================================================== #


def test_module_imports_without_a_running_pymol():
    """The bridge imports panels lazily; import must not touch PyMOL."""
    assert compute_panel.ATTR == "tenmol_compute"
    assert callable(compute_panel.install)


def test_the_namespace_is_addressable_and_a_private_one_would_not_be():
    """Why the attribute is `tenmol_compute` and not `_tenmol_compute`."""
    assert build_policy().check("cmd.tenmol_compute.sasa_relative").allowed
    assert not build_policy().check("cmd._tenmol_compute.sasa_relative").allowed


def test_resi_sorting_handles_insertion_codes_and_negatives():
    """`resi` is a STRING; sorting it lexically puts 10 before 9."""
    key = compute_panel._resi_sort_key
    assert sorted(["10", "9", "100", "2"], key=key) == ["2", "9", "10", "100"]
    # Insertion codes sort after the bare number they extend.
    assert key("52") < key("52A")
    # Negative residue numbers are real (expression tags), and are not text.
    assert key("-5") < key("1")


# =========================================================================== #
# The SASA shim, over the real socket.
#
# EVERYTHING in this file goes through the bridge, and that is a correction:
# an earlier draft started PyMOL in-process for these tests. PyMOL allows one
# instance, so the in-process fixture's `instance.stop()` tore down the very
# engine the `bridge` fixture owned, and the pump died with
# `AttributeError: 'SingletonPyMOL' object has no attribute '_COb'`, taking
# every socket test in the module with it. One process, one way in.
# =========================================================================== #

NS = "cmd.tenmol_compute"
BOOTSTRAP = "import tenmol_bridge.panels.compute as _tc; _tc.install()"


@pytest.fixture()
def installed(ws: "WSClient"):
    """Install the service exactly the way the browser does — one `{t:'do'}`.

    This is the claim the whole design rests on: no `server.py` edit, no policy
    grant, no frozen barrel. If PyMOL's parser ever stops running a bare Python
    line, or the policy stops addressing three-segment `cmd.*` paths, this
    fails here rather than in a browser.
    """
    ws.do(BOOTSTRAP)
    hello = ws.call(NS + ".hello")
    assert hello["ok"] is True and hello["attr"] == "tenmol_compute", hello
    return ws


@pytest.fixture()
def il2(installed: "WSClient"):
    """il2.pdb under a name no other test module uses.

    The PyMOL process is shared across the whole run, so this must not
    `delete all` and must not take a common name.
    """
    installed.call("cmd.load", os.path.join(DATA, "il2.pdb"), "cu_il2")
    yield installed
    installed.call("cmd.delete", "cu_il2")


def test_install_is_idempotent(installed):
    """The client bootstraps on every reconnect; that must not cost state."""
    first = installed.call(NS + ".hello")
    installed.do(BOOTSTRAP)
    assert installed.call(NS + ".hello") == first


def test_the_raw_helper_is_what_the_codec_refuses(il2):
    """The premise of the whole shim, asserted rather than assumed.

    Called directly, `util.get_sasa_relative` returns a dict keyed by a
    4-tuple. If this ever starts succeeding, the shim is dead weight.
    """
    reply = il2.call_reply("util.get_sasa_relative", "cu_il2 and polymer", quiet=1, vis=0)
    assert reply.get("t") == "err", "codec accepted a tuple-keyed dict"
    text = json.dumps(reply)
    assert "erializ" in text or "tuple" in text, text


def test_sasa_relative_re_keys_every_residue(il2):
    result = il2.call(NS + ".sasa_relative", "cu_il2 and polymer")
    assert result["ok"] is True
    records = result["records"]
    # il2.pdb is a 126-residue chain.
    assert len(records) == 126
    for r in records:
        assert set(r) == {
            "sele",
            "model",
            "segi",
            "chain",
            "resi",
            "resn",
            "value",
            "normalised",
        }
        # `resi` is a STRING on the wire: it may carry an insertion code.
        assert isinstance(r["resi"], str)


def test_every_sele_is_a_selection_pymol_actually_accepts(il2):
    """The point of the chosen spelling: the panel can click a row.

    A stringified tuple would have been just as JSON-safe and useless.
    """
    records = il2.call(NS + ".sasa_relative", "cu_il2 and polymer")["records"]
    for r in records[:12]:
        assert il2.call("cmd.count_atoms", r["sele"]) > 0, r["sele"]


def test_values_are_exposure_fractions(il2):
    records = il2.call(NS + ".sasa_relative", "cu_il2 and polymer")["records"]
    values = [r["value"] for r in records]
    assert all(0.0 <= v <= 1.0 for v in values)
    # A real protein has both buried and exposed residues; all-zeros or
    # all-ones would pass a bounds check and mean nothing.
    assert min(values) < 0.1 < 0.5 < max(values)


def test_an_isolated_residue_is_fully_exposed(installed):
    """The one case with an answer known independently of any structure."""
    installed.call("cmd.fragment", "ala", "cu_lone_ala")
    try:
        result = installed.call(NS + ".sasa_relative", "cu_lone_ala")
        assert len(result["records"]) == 1
        assert result["records"][0]["value"] == pytest.approx(1.0, abs=1e-6)
        assert result["records"][0]["resn"] == "ALA"
    finally:
        installed.call("cmd.delete", "cu_lone_ala")


def test_records_are_ordered_by_chain_then_residue_number(il2):
    records = il2.call(NS + ".sasa_relative", "cu_il2 and polymer")["records"]
    resis = [int(r["resi"]) for r in records]
    assert resis == sorted(resis), "lexical sort would put 10 before 9"


def test_it_writes_the_value_onto_the_atoms_as_upstream_does(il2):
    """`var` is `alter`ed onto every atom (`util.py:1163`) — hence the warning."""
    il2.call("cmd.alter", "cu_il2", "b = -1.0")
    il2.call(NS + ".sasa_relative", "cu_il2 and polymer", var="b")
    lo = il2.call("cmd.get_extent", "cu_il2")  # forces the alter to settle
    assert lo is not None
    negatives = il2.call("cmd.count_atoms", "cu_il2 and polymer and b < -0.5")
    assert negatives == 0, "b was not overwritten"


# =========================================================================== #
# The eight helpers B9 recorded as unbuilt — over the real socket.
#
# Over the socket, not in-process, and that is not a style choice. Run
# in-process against the singleton the bridge already owns, these tests abort
# the interpreter: `libc++abi: std::length_error: vector` thrown inside
# `PyMOL_Draw` (`engine.py:238 tick` -> `pymol2/__init__.py:44 draw`) while the
# draw pump renders a scene a test had mutated underneath it. The pump is a
# real thread with a real GL context; reaching around it is what breaks.
#
# Going through `{t:'call'}` is also the path the panel actually uses, so a
# helper that cannot survive the round trip fails here rather than in a browser.
# =========================================================================== #

DATA_IL2 = os.path.join(DATA, "il2.pdb")
DATA_1TII = os.path.join(DATA, "1tii.pdb")


@pytest.fixture()
def loaded(ws: "WSClient"):
    """Two molecules under names no other module uses.

    The PyMOL process is shared by every test module in the run, so this must
    not `delete all` and must not take a common name.
    """
    ws.call("cmd.load", DATA_IL2, "cu_il2")
    ws.call("cmd.load", DATA_1TII, "cu_tii")
    yield ws
    for name in ("cu_il2", "cu_tii", "cu_copy", "cu_ic", "aln_all_to_cu_il2"):
        ws.call("cmd.delete", name)


def test_the_selection_only_helpers_run(loaded):
    for fn in ("util.label_chains", "util.label_segments", "util.b2vdw"):
        reply = loaded.call_reply(fn, "cu_il2")
        assert reply.get("t") == "ok", (fn, reply)


def test_enable_all_shaders_takes_no_arguments(loaded):
    assert loaded.call_reply("util.enable_all_shaders").get("t") == "ok"
    assert loaded.call("cmd.get_setting_int", "use_shaders") == 1


def test_phipsi_returns_two_angles(loaded):
    phi, psi = loaded.call("util.phipsi", "cu_il2 and resi 10")
    assert -180.0 <= phi <= 180.0 and -180.0 <= psi <= 180.0


def test_phipsi_returns_null_where_there_is_no_neighbour(loaded):
    """A chain terminus has no preceding residue, so phi is None.

    This is why the panel renders `n/a` instead of formatting a number — and
    why the wire value to expect is JSON null, not 0.
    """
    phi, _psi = loaded.call("util.phipsi", "cu_il2 and resi 4")
    assert phi is None


#: The cutoff the panel sends. NEVER None — see the next two tests.
CUTOFF = 3.5


def test_interchain_distances_takes_the_object_name_first(loaded):
    """`interchain_distances(name, selection, ...)` — name BEFORE selection.

    Before this row was built the panel passed the shared selection first to
    every helper, which here would have created a distance object named after
    the selection and measured nothing.
    """
    reply = loaded.call_reply(
        "util.interchain_distances", "cu_ic", "cu_tii and polymer", CUTOFF, 0, 0, 1
    )
    assert reply.get("t") == "ok", reply
    assert "cu_ic" in loaded.call("cmd.get_names", "all")
    assert loaded.call("cmd.get_type", "cu_ic") == "object:measurement"


def test_the_draw_pump_survives_a_distance_object(loaded):
    """The Compute panel creates one of these on a button press.

    A measurement object the renderer cannot draw takes the engine down some
    frames LATER, not at the call — so the assertion is that the bridge is
    still answering after it has had time to draw several times.
    """
    loaded.call("util.interchain_distances", "cu_ic", "cu_tii and polymer", CUTOFF, 0)
    time.sleep(1.5)
    assert loaded.call("cmd.count_atoms", "cu_tii") > 0, "engine stopped answering"


def test_why_the_panel_never_sends_a_null_cutoff(loaded):
    """The measurement behind `metrics.ts`'s required cutoff field.

    `interchain_distances(..., cutoff=None)` forwards None to `cmd.distance`,
    which converts it to `-1.0` — "no cutoff" — at `querying.py:492-493`. Every
    atom pair between every pair of chains is then measured. On 1tii.pdb the
    polymer chains are 1479, 290 and five of 740, which is

        12,450,210 pairs

    and the renderer aborts building geometry for them::

        libc++abi: terminating due to uncaught exception of type
            std::length_error: vector
        Fatal Python error: Segmentation fault
          File "pymol2/__init__.py", line 44 in draw
          File "tenmol_bridge/engine.py", line 238 in tick

    The whole bridge process dies, so this is NOT an error the panel could
    catch and report — which is why the fix is a required field rather than a
    try/except.

    This test does NOT reproduce the crash (it would kill the run). It pins the
    arithmetic that makes the default dangerous, so a future structure fixture
    or an upstream change to the default surfaces here.
    """
    counts = [
        loaded.call("cmd.count_atoms", 'cu_tii and polymer and chain "%s"' % c)
        for c in loaded.call("cmd.get_chains", "cu_tii and polymer")
    ]
    pairs = sum(
        counts[i] * counts[j]
        for i in range(len(counts))
        for j in range(i + 1, len(counts))
    )
    assert pairs > 1_000_000, (
        "1tii no longer explodes without a cutoff (%d pairs); re-check whether "
        "metrics.ts still needs a required cutoff field" % pairs
    )
    # And the same call WITH a cutoff is fine — that is the whole fix.
    reply = loaded.call_reply(
        "util.interchain_distances", "cu_ic", "cu_tii and polymer", CUTOFF, 0, 0, 1
    )
    assert reply.get("t") == "ok", reply


def test_ff_copy_needs_matching_atom_names(loaded):
    """Recorded as a note in the panel, because the error names an ATOM.

    Copying between unlike residues raises `KeyError: 'CG'`, which reads like
    an internal fault rather than "these two residues are different".
    """
    sers = []
    loaded.call("cmd.iterate", "cu_il2 and resn SER and name CA", "print('SER=', resi)")
    # Two serines: same residue type, so identical atom names.
    ok = loaded.call_reply("util.ff_copy", "cu_il2 and resi 4", "cu_il2 and resi 5")
    assert ok.get("t") == "ok", ok

    bad = loaded.call_reply("util.ff_copy", "cu_il2 and resi 4", "cu_il2 and resi 10")
    assert bad.get("t") == "err", "unlike residues should have failed"
    assert sers == []


def test_mass_align_works_on_a_scene_of_only_molecules(loaded):
    loaded.call("cmd.delete", "cu_ic")
    loaded.call("cmd.create", "cu_copy", "cu_il2")
    reply = loaded.call_reply("util.mass_align", "cu_il2", 0, 50)
    assert reply.get("t") == "ok", reply
    assert "aln_all_to_cu_il2" in loaded.call("cmd.get_names", "all")


def test_mass_align_is_broken_by_any_non_molecule_object(loaded):
    """UPSTREAM DEFECT, pinned so a future PyMOL bump surfaces it.

    `modules/pymol/util.py:256` is::

        [x for x in list if cmd.get_type(x)!="object:molecule"]

    a list comprehension whose result is DISCARDED — there is no assignment.
    The filter meant to drop non-molecules does nothing, so the alignment loop
    evaluates `(target) and (name)` against every object including maps,
    alignments and distances, and dies on the first one.

    NOT patched: the backend is PyMOL's, and a clone that quietly diverges from
    it is worse than one that reports the divergence. The panel carries a note
    (`metrics.ts`, `mass_align`); this test is what tells us if upstream ever
    fixes it.
    """
    loaded.call("util.interchain_distances", "cu_ic", "cu_tii and polymer", CUTOFF, 0)
    reply = loaded.call_reply("util.mass_align", "cu_il2", 0, 50)
    assert reply.get("t") == "err", "upstream defect appears to be fixed"
    assert "Invalid selection name" in json.dumps(reply), reply
