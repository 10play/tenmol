"""Parity area 6 (File I/O) — the rows whose only citation was a `†` match.

Every test here was written because a mutation of the source the row stands on
left the whole suite GREEN.  Each one names the row it protects and the exact
edit that turns it red, so the next person can re-run the experiment instead of
trusting this docstring:

===== ======================================== =============================================
row   feature                                  mutation that must turn this file red
===== ======================================== =============================================
252   ``loadfunctions`` registry               rename the ``pml`` key (``importing.py:1624``)
                                               so the format falls through to the C loader
                                               -- do NOT swap ``py``/``pml`` instead: ``run``
                                               on a ``.pml`` SIGILLs this build, measured
254   ``cmd.load_traj``                        ``int(state) - 1`` -> ``int(state)``
                                               (``importing.py:454``)
262   ``set_session`` + security wizard        drop the ``finally:`` wizard activation
                                               (``importing.py:177-179``)
269   Export Map dialog                        ``names_of_type`` -> ``return []``
                                               (``panels/files.py``)
283   Log file resume                          drop ``log_open <file>,a``
                                               (``commanding.py:75-76``)
287   Get PDB dialog                           ``fetch_info``'s ``assembly`` -> ``""``
288   PDBe assembly/chain lookups              ``_get_assemblies``/``_get_chains`` -> ``[]``
300   ``cmd.loadall``                          ``filenames`` -> ``filenames[:1]``
                                               (``importing.py:1531``)
===== ======================================== =============================================

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p13_fileio.py -q
"""

from __future__ import annotations

import io
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import files as files_panel  # noqa: E402

from conftest import WSClient  # noqa: E402

NS = "cmd.tenmol_files"
BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"

REPO = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
DATA = os.path.join(REPO, "packages", "engine", "testing", "data")
DAT = os.path.join(REPO, "packages", "engine", "test", "dat")


@pytest.fixture(scope="module")
def installed(bridge):
    client = WSClient(bridge.ws_url)
    try:
        client.do(BOOTSTRAP)
        yield
    finally:
        client.close()


@pytest.fixture
def clean(ws: WSClient):
    ws.do("delete all")
    yield ws
    ws.do("delete all")


# =========================================================================== #
# Row 300 — `cmd.loadall` (glob load)
# =========================================================================== #


@pytest.mark.engine
def test_loadall_loads_EVERY_glob_match_not_just_the_first(clean, installed, tmp_path):
    """``importing.py:1531`` iterates the whole ``glob.glob`` result.

    The pre-existing suite loaded exactly one file per test, so
    ``for filename in filenames[:1]`` — a loader that silently drops every match
    after the first — passed 1851 tests.  Three files, three objects.
    """
    ws = clean
    body = open(os.path.join(DAT, "tiny.pdb")).read()
    for name in ("p13a", "p13b", "p13c"):
        (tmp_path / (name + ".pdb")).write_text(body)

    ws.call("cmd.loadall", str(tmp_path / "p13*.pdb"))
    assert sorted(ws.call("cmd.get_object_list")) == ["p13a", "p13b", "p13c"]


@pytest.mark.engine
def test_loadall_groups_the_objects_it_created(clean, installed, tmp_path):
    """``group`` gets ``filename_to_objectname`` for EVERY match (``:1538-1541``)."""
    ws = clean
    body = open(os.path.join(DAT, "tiny.pdb")).read()
    for name in ("p13g1", "p13g2"):
        (tmp_path / (name + ".pdb")).write_text(body)

    ws.call("cmd.loadall", str(tmp_path / "p13g*.pdb"), "p13grp")
    # The group holds both members, so a loader that dropped one is visible
    # here too rather than only in the object list.
    assert sorted(ws.call("cmd.get_object_list", "p13grp")) == ["p13g1", "p13g2"]


# =========================================================================== #
# Row 252 — the `loadfunctions` registry (python-handled formats)
# =========================================================================== #


@pytest.mark.engine
def test_a_pml_goes_through_the_AT_handler_and_a_py_through_run(clean, installed, tmp_path):
    """``loadfunctions['pml']`` is ``@`` and ``['py']`` is ``run`` (``:1623-1624``).

    The two handlers are one line apart and swapping them is invisible to any
    test that only loads structures.  It is very visible here: PML syntax is a
    SyntaxError to Python's compiler, and a bare Python statement is not a PML
    command, so each file only works under its own handler.
    """
    ws = clean
    pml = tmp_path / "p13.pml"
    pml.write_text("set sphere_scale, 0.31\n")
    py = tmp_path / "p13.py"
    py.write_text("from pymol import cmd\ncmd.set('sphere_scale', 0.62)\n")

    ws.call("cmd.load", str(pml))
    assert round(float(ws.call("cmd.get", "sphere_scale")), 2) == 0.31

    ws.call("cmd.load", str(py))
    assert round(float(ws.call("cmd.get", "sphere_scale")), 2) == 0.62
    ws.do("set sphere_scale, 1.0")


@pytest.mark.engine
def test_the_registry_key_decides_the_handler_not_the_file_content(clean, installed, tmp_path):
    """Same bytes, two extensions: the dispatch is by FORMAT, nothing else.

    A ``.pml`` holding Python is a parse error and a ``.py`` holding PML is a
    ``NameError`` — which is what makes the swap detectable rather than merely
    unlucky.  ``cmd.load`` reports both through the console, so the assertion is
    that the two files behave DIFFERENTLY, which a swapped table cannot manage.
    """
    ws = clean
    both = "set sphere_scale, 0.47\n"
    (tmp_path / "p13same.pml").write_text(both)
    (tmp_path / "p13same.py").write_text(both)

    ws.do("set sphere_scale, 1.0")
    ws.call("cmd.load", str(tmp_path / "p13same.pml"))
    assert round(float(ws.call("cmd.get", "sphere_scale")), 2) == 0.47

    ws.do("set sphere_scale, 1.0")
    # `run` on a PML line raises inside PyMOL's own executor; the setting must
    # therefore NOT have moved.
    ws.call("cmd.load", str(tmp_path / "p13same.py"))
    assert round(float(ws.call("cmd.get", "sphere_scale")), 2) == 1.0


# =========================================================================== #
# Row 254 — `cmd.load_traj`
# =========================================================================== #


@pytest.mark.engine
def test_load_traj_appends_frames_starting_at_the_state_it_was_given(clean, installed):
    """``importing.py:454`` passes ``state - 1``: the API is 1-based, C is 0-based.

    With ``state=1`` the first trajectory frame must REPLACE state 1 (the
    topology's own coordinates), which is what the trajectory dialog's
    "0=append" default depends on.  Dropping the ``- 1`` shifts every frame by
    one state and leaves the topology coordinates visible as frame 1 — a silent
    off-by-one that no test in the suite could see.
    """
    ws = clean
    ws.call("cmd.load", os.path.join(DATA, "sampletrajectory.pdb"), "p13traj")
    assert ws.call("cmd.count_states", "p13traj") == 1
    before = ws.call("cmd.get_atom_coords", "p13traj and index 1", 1)

    ws.call("cmd.load_traj", os.path.join(DATA, "sampletrajectory.dcd"), "p13traj", 1)
    states = ws.call("cmd.count_states", "p13traj")
    assert states > 1, states
    after = ws.call("cmd.get_atom_coords", "p13traj and index 1", 1)
    # state 1 now holds the FIRST FRAME of the trajectory, not the topology.
    assert after != before, (before, after)


@pytest.mark.engine
def test_load_traj_guesses_the_object_from_the_last_one_loaded(clean, installed):
    """``oname = _guess_trajectory_object(noext, _self)`` (``importing.py:449``).

    The trajectory dialog preselects the last object for exactly this reason;
    the API does the same when ``object`` is left empty.
    """
    ws = clean
    ws.call("cmd.load", os.path.join(DATA, "sampletrajectory.pdb"), "p13guess")
    ws.call("cmd.load_traj", os.path.join(DATA, "sampletrajectory.dcd"))
    assert ws.call("cmd.get_object_list") == ["p13guess"]
    assert ws.call("cmd.count_states", "p13guess") > 1


@pytest.mark.engine
def test_load_traj_refuses_a_gzipped_trajectory(clean, installed, tmp_path):
    """``raise CmdException('zipped (%s) trajectories not supported')`` (``:432``)."""
    ws = clean
    ws.call("cmd.load", os.path.join(DATA, "sampletrajectory.pdb"), "p13gz")
    import gzip

    target = tmp_path / "sampletrajectory.dcd.gz"
    with open(os.path.join(DATA, "sampletrajectory.dcd"), "rb") as src:
        with gzip.open(target, "wb") as dst:
            dst.write(src.read())

    reply = ws.call_reply("cmd.load_traj", str(target), "p13gz")
    assert reply["t"] == "err", reply
    assert "zipped" in reply["error"]["message"]


# =========================================================================== #
# Row 262 — `cmd.set_session` and the movie security wizard
# =========================================================================== #


@pytest.mark.engine
def test_a_session_carrying_movie_commands_arms_the_security_wizard(clean, installed, tmp_path):
    """``importing.py:177-179`` — the ``finally:`` block, which is the whole row.

    A ``.pse`` can carry arbitrary command strings in its movie
    (``mdo``/``mview``), so restoring one has to stop and ask.  ``set_session``
    activates the ``security`` wizard whenever ``get_movie_locked() > 0``, and
    deleting those three lines leaves the session loading silently with the
    embedded commands live — which is the exact hole
    ``wizard/security.py:15-43`` exists to close.
    """
    ws = clean
    ws.call("cmd.fragment", "ala", "p13sec")
    ws.do("mset 1 x4")
    ws.do("mdo 2: turn x, 5")
    target = str(tmp_path / "p13sec.pse")
    ws.do("save %s, format=pse" % target)

    ws.do("delete all")
    ws.call("cmd.wizard")  # dismiss anything the suite left behind
    try:
        ws.call("cmd.load", target)

        assert ws.call("cmd.get_movie_locked") > 0
        # `get_wizard_stack` holds wizard INSTANCES, and the bridge codec
        # refuses to serialise one — so the answer arrives either as the list
        # (if a codec entry ever lands) or as the codec's refusal, and BOTH
        # name the class.  An empty stack serialises fine as `[]`, which is
        # exactly what a missing `finally:` block would produce.
        reply = ws.call_reply("cmd.get_wizard_stack")
        blob = json.dumps(reply.get("error") if reply["t"] == "err" else reply["result"])
        assert "security" in blob.lower(), blob
    finally:
        ws.call("cmd.wizard")
        ws.do("mset")
        ws.do("delete all")


# =========================================================================== #
# Row 269 — Export Map: the object list the dialog is built from
# =========================================================================== #


@pytest.mark.engine
def test_names_of_type_object_map_returns_the_maps_that_exist(clean, installed):
    """``cmd.get_names_of_type('object:map')`` is Export Map's whole combo.

    The suite only ever asserted the EMPTY answer, so ``return []`` — a service
    that reports "No map objects loaded" for a session full of maps — was
    green.  This makes the populated answer the assertion.
    """
    ws = clean
    ws.call("cmd.load", os.path.join(DAT, "tiny.pdb"), "p13map_mol")
    ws.call("cmd.map_new", "p13map", "gaussian", None, "p13map_mol")
    assert "p13map" in ws.call("cmd.get_names_of_type", "object:map")
    assert ws.call(NS + ".names_of_type", "object:map") == ["p13map"]
    # …and the alignment combo is still independent of it.
    assert ws.call(NS + ".names_of_type", "object:alignment") == []


@pytest.mark.engine
def test_export_map_writes_a_ccp4_through_the_dialogs_command(clean, installed, tmp_path):
    """``cmd.save(fname, name, -1, quiet=0)`` — ``file_dialogs.py:845-847``."""
    ws = clean
    ws.call("cmd.load", os.path.join(DAT, "tiny.pdb"), "p13ccp4_mol")
    ws.call("cmd.map_new", "p13ccp4", "gaussian", None, "p13ccp4_mol")
    target = str(tmp_path / "out.ccp4")
    ws.do("save %s, p13ccp4, -1" % target)
    assert os.path.exists(target) and os.path.getsize(target) > 0


# =========================================================================== #
# Row 283 — Log file resume
# =========================================================================== #


@pytest.mark.engine
def test_resume_runs_the_file_AND_reopens_it_for_appending(clean, installed, tmp_path):
    """``commanding.py:70-76``: execute, then ``log_open <file>,a``.

    Two halves and the second one is the point — "resume" means the next
    command the user types lands at the END of the same file.  Dropping the
    re-open leaves the script executed and the log closed, which looks like
    success until the log turns out to be missing everything after the resume.
    """
    ws = clean
    target = tmp_path / "p13resume.pml"
    target.write_text("set sphere_scale, 0.29\n")

    ws.call("cmd.resume", str(target))
    try:
        assert round(float(ws.call("cmd.get", "sphere_scale")), 2) == 0.29
        assert ws.call(NS + ".log_status")["logging"] == 1
        ws.do("bg_color grey20")
    finally:
        ws.do("log_close")
        ws.do("set sphere_scale, 1.0")

    text = target.read_text()
    assert text.startswith("set sphere_scale, 0.29"), text
    assert "bg_color grey20" in text, text


# =========================================================================== #
# Row 287 — the Get PDB dialog's `assembly` seed
# =========================================================================== #


@pytest.mark.engine
def test_fetch_info_seeds_the_assembly_combo_from_the_setting(clean, installed):
    """``file_dialogs.py:461-466`` seeds the combo from ``cmd.get('assembly')``.

    The generated command is ``set assembly, "<a>"`` + ``fetch ...``, so a
    dialog that reported a constant would quietly fetch the wrong biological
    unit.  Round-tripped rather than asserted against a constant, because the
    default is empty on a fresh process.
    """
    ws = clean
    before = ws.call(NS + ".fetch_info")["assembly"]
    try:
        ws.do("set assembly, 1")
        assert ws.call(NS + ".fetch_info")["assembly"] == "1"
        ws.do("set assembly, 2")
        assert ws.call(NS + ".fetch_info")["assembly"] == "2"
    finally:
        ws.do('set assembly, "%s"' % (before or ""))


# =========================================================================== #
# Row 288 — the two PDBe lookups (pure, no network)
# =========================================================================== #


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def _stub_urlopen(monkeypatch, payloads):
    """Answer `urllib.request.urlopen` from a dict, and record the URLs asked."""
    import urllib.request

    seen = []

    def fake(url, timeout=None):
        seen.append(url)
        for prefix, body in payloads.items():
            if prefix in url:
                return _FakeResponse(json.dumps(body).encode("utf-8"))
        raise AssertionError("unexpected URL " + url)

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return seen


def test_get_assemblies_reads_the_pdbe_summary_endpoint(monkeypatch):
    """``file_dialogs.py:409-423`` — same URL, same ``assemblies[].assembly_id``."""
    seen = _stub_urlopen(
        monkeypatch,
        {
            "summary": {
                "1tii": [{"assemblies": [{"assembly_id": "1"}, {"assembly_id": "2"}]}]
            }
        },
    )
    assert files_panel._get_assemblies("1TII") == ["1", "2"]
    assert seen == ["https://www.ebi.ac.uk/pdbe/api/pdb/entry/summary/1tii"]


def test_get_chains_flattens_molecules_then_chains(monkeypatch):
    """``file_dialogs.py:426-441`` — the nested comprehension, in order."""
    seen = _stub_urlopen(
        monkeypatch,
        {
            "polymer_coverage": {
                "1tii": {
                    "molecules": [
                        {"chains": [{"chain_id": "A"}, {"chain_id": "B"}]},
                        {"chains": [{"chain_id": "C"}]},
                    ]
                }
            }
        },
    )
    assert files_panel._get_chains("1tii") == ["A", "B", "C"]
    assert seen == ["https://www.ebi.ac.uk/pdbe/api/pdb/entry/polymer_coverage/1tii"]


def test_the_pdbe_worker_publishes_both_lists_under_the_code(monkeypatch):
    """``pdbe_start`` -> worker -> ``pdbe_result``, without a socket or a network.

    The endpoint pair is what the dialog polls; the suite only ever asserted
    that it did not block, so a worker that threw both answers away was green.
    """
    _stub_urlopen(
        monkeypatch,
        {
            "summary": {"2xyz": [{"assemblies": [{"assembly_id": "3"}]}]},
            "polymer_coverage": {"2xyz": {"molecules": [{"chains": [{"chain_id": "Z"}]}]}},
        },
    )
    api = files_panel.FilesAPI.__new__(files_panel.FilesAPI)
    api._pdbe = {}
    import threading

    api._pdbe_lock = threading.Lock()
    files_panel.FilesAPI._pdbe_worker(api, "2xyz")

    result = files_panel.FilesAPI.pdbe_result(api, "2xyz")
    assert result["assemblies"] == ["3"]
    assert result["chains"] == ["Z"]
    assert result["error"] is None and result["pending"] is False
