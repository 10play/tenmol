"""Parity area 6 — `cmd.load` core (`modules/pymol/importing.py`).

The inventory row lists a lot of behaviour that is invisible from the outside:
object-name derivation, `format=` as a name or a loadable int or
`plugin:<name>`, a VMD molfile fallback, and magic-byte disambiguation of
`.trj` (AMBER vs GROMACS/NetCDF) and `.crd` (AMBER vs CHARMM).

Most of it is only observable INDIRECTLY — the two `.crd` flavours do not
announce which reader they picked, but they fail differently, and that
difference is the evidence that the branch ran. Where that is the assertion,
the test says so rather than implying it checked the reader directly.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_load_core.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")


@pytest.fixture()
def base(ws: WSClient):
    """One molecule under a private name, cleaned up after.

    The PyMOL process is shared across modules, so this must not `delete all`.
    """
    ws.call("cmd.load", IL2, "zz_base")
    yield ws
    for name in ws.call("cmd.get_names", "all"):
        if name.startswith("zz_"):
            ws.call("cmd.delete", name)


# --------------------------------------------------------------------- names


def test_the_object_name_comes_from_the_basename(base: WSClient, tmp_path) -> None:
    path = tmp_path / "zz_named.pdb"
    path.write_text(open(IL2).read())
    base.call("cmd.load", str(path))
    assert "zz_named" in base.call("cmd.get_names", "all")


def test_an_explicit_object_name_wins(base: WSClient, tmp_path) -> None:
    path = tmp_path / "zz_ignored.pdb"
    path.write_text(open(IL2).read())
    base.call("cmd.load", str(path), "zz_explicit")
    names = base.call("cmd.get_names", "all")
    assert "zz_explicit" in names and "zz_ignored" not in names


def test_a_trajectory_with_no_object_targets_the_LAST_object(base: WSClient, tmp_path):
    """`.dcd`/`.dtr` have no atoms of their own, so they need a host.

    Asserted by the error NOT being "must load object topology first": with
    `zz_base` present the load is accepted and appends to it.
    """
    dcd = tmp_path / "zz_traj.dcd"
    dcd.write_bytes(b"\x00" * 100)
    assert base.call_reply("cmd.load", str(dcd))["t"] == "ok"


# -------------------------------------------------------------------- format


def test_format_may_be_a_NAME_and_rescues_an_extensionless_file(base, tmp_path):
    path = tmp_path / "zz_noext"
    path.write_text(open(IL2).read())
    assert base.call_reply("cmd.load", str(path), "zz_byname", format="pdb")["t"] == "ok"
    assert base.call("cmd.count_atoms", "zz_byname") > 0


def test_format_may_be_a_LOADABLE_INT(base: WSClient, tmp_path) -> None:
    """`loadable.pdb` is 0, not 1 — the enum value works as well as the name.

    The number matters and is easy to get wrong: 1 is `mol`, 3 is `molstr`.
    Resolved with `loadable._reverse_lookup` rather than guessed, because an
    off-by-one here does not fail — see the next test.
    """
    path = tmp_path / "zz_noext2"
    path.write_text(open(IL2).read())
    assert base.call_reply("cmd.load", str(path), "zz_byint", format=0)["t"] == "ok"
    assert base.call("cmd.count_atoms", "zz_byint") > 0


def test_an_unknown_format_name_is_a_clean_error(base: WSClient, tmp_path) -> None:
    path = tmp_path / "zz_noext3"
    path.write_text(open(IL2).read())
    reply = base.call_reply("cmd.load", str(path), "zz_bad", format="nosuchformat")
    assert reply["t"] == "err"
    assert "unsupported file type: nosuchformat" in reply["error"]["message"]


@pytest.mark.parametrize(
    "fmt,why",
    [
        ("plugin:nosuch", "an unknown molfile plugin name"),
        (1, "loadable.mol — a valid format, wrong for this content"),
        (3, "loadable.molstr — a format that wants CONTENTS, not a path"),
    ],
)
def test_load_can_report_SUCCESS_having_loaded_nothing(base, tmp_path, fmt, why):
    """UPSTREAM GAP, and wider than it first looks.

    A bogus format NAME raises "unsupported file type" (the test above). These
    three do not: `cmd.load` returns None, creates no object, and reports no
    error, so a caller that trusts the return value believes it loaded.

    `plugin:` was the case found first. The integer cases turned up by getting
    `loadable.pdb` wrong — this test was originally written with `format=1`
    expecting PDB, and it PASSED the load and then failed on `count_atoms`,
    which is exactly the failure mode being described here.

    Not reachable from this client's UI (the open flow classifies the file and
    never passes `format=`), but reachable from the command line.
    """
    path = tmp_path / "zz_noext4"
    path.write_text(open(IL2).read())
    before = set(base.call("cmd.get_names", "all"))

    reply = base.call_reply("cmd.load", str(path), "zz_silent", format=fmt, quiet=0)

    assert reply["t"] == "ok", (why, reply)
    assert reply["result"] is None, why
    assert set(base.call("cmd.get_names", "all")) == before, ("an object appeared", why)


def test_the_molfile_plugin_lookup_is_not_client_reachable(ws: WSClient) -> None:
    """`_cmd.find_molfile_plugin` backs the VMD fallback and stays private."""
    reply = ws.call_reply("cmd._cmd.find_molfile_plugin", "xyz", 0)
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == "NotAllowed", reply


# ------------------------------------------------------- magic-byte branches


def test_a_charmm_crd_is_routed_to_the_CHARMM_reader(base: WSClient, bridge) -> None:
    """`.crd` is disambiguated by TWO leading `*` lines (CHARMM titles).

    HOW THIS IS OBSERVED, because the obvious way does not work. Neither `.crd`
    flavour is a valid structure here, and BOTH return ok once each is given a
    fresh host object — an earlier draft asserted that the AMBER one errored,
    which was true only because the CHARMM load had already changed the shared
    host's state count. Order-dependent evidence is not evidence.

    What is reliable is the engine's own feedback: the CHARMM branch hands the
    file to the `cor` reader, which says so by name.
    """
    import os as _os
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        charmm = _os.path.join(tmp, "zz_charmm.crd")
        with open(charmm, "w") as handle:
            handle.write("* title\n* more\n    2\n")

        base.call("cmd.load", IL2, "zz_crd_host")
        assert base.call_reply("cmd.load", charmm, "zz_crd_host")["t"] == "ok"

        lines = bridge.wait_for_feedback("cor", timeout=5.0)
        assert any("cor" in line for line in lines), lines


def test_a_netcdf_trj_is_accepted_by_the_magic_bytes(base: WSClient) -> None:
    """`.trj` is disambiguated by the NetCDF `CDF` magic bytes.

    Only the positive half is asserted. The AMBER half was originally asserted
    as an error message containing "trajectory", which — like the `.crd` case —
    turned out to depend on the host object's state rather than on the branch.
    """
    import os as _os
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        netcdf = _os.path.join(tmp, "zz_nc.trj")
        with open(netcdf, "wb") as handle:
            handle.write(b"CDF\x01" + b"\x00" * 40)

        base.call("cmd.load", IL2, "zz_trj_host")
        assert base.call_reply("cmd.load", netcdf, "zz_trj_host")["t"] == "ok"
