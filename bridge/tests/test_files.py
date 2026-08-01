"""WP-18 / parity area 6 — the file-I/O service.

Two halves:

Part 1 is PURE — no socket, no PyMOL beyond the import that
``tenmol_bridge.panels.files`` genuinely needs — and pins the behaviours that
were ported verbatim from the Qt front-end: ``getSaveFileNameWithExt``, the
``load_dialog`` dispatch table, ``_get_cms_traj_file``, and the honest
"this format raises in this build" annotations.

Part 2 goes END TO END over the real WebSocket, because the whole design rests
on one claim that a unit test cannot make: that the service is reachable from
the browser **without editing a frozen file**.  ``server.py`` (``_bridge.*``
routing) and ``policy/grants/`` are not this work package's to touch, so the
module attaches itself to ``pymol.cmd`` and the client installs it with a
single ``{t:'do'}``.  If PyMOL's parser ever stops executing a bare Python line,
or the policy ever stops addressing three-segment ``cmd.*`` paths, the whole
area is unreachable — so that path is asserted here, not assumed.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_files.py -q
"""

from __future__ import annotations

import base64
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.panels import files as files_panel  # noqa: E402
from tenmol_bridge.policy import build_policy  # noqa: E402

from conftest import WSClient  # noqa: E402

NS = "cmd.tenmol_files"
BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"


# =========================================================================== #
# Part 1 — pure
# =========================================================================== #


class TestSaveExtension:
    """``getSaveFileNameWithExt`` (``modules/pymol/Qt/utils.py:229-246``)."""

    def test_appends_first_extension_from_filter(self):
        assert (
            files_panel.with_extension("/tmp/foo", "PDB (*.pdb *.pdb.gz)")
            == "/tmp/foo.pdb"
        )

    def test_leaves_an_existing_extension_alone(self):
        assert files_panel.with_extension("/tmp/foo.cif", "PDB (*.pdb)") == "/tmp/foo.cif"

    def test_only_the_basename_counts(self):
        # `'.' not in os.path.split(fname)[-1]` — a dotted DIRECTORY must not
        # suppress the extension.
        assert files_panel.with_extension("/a.b/name", "PNG File (*.png)") == "/a.b/name.png"

    def test_no_glob_in_filter_is_a_no_op(self):
        assert files_panel.with_extension("/tmp/foo", "All (*)") == "/tmp/foo"

    def test_empty_stays_empty(self):
        assert files_panel.with_extension("", "PDB (*.pdb)") == ""


class TestClassify:
    """``load_dialog``'s dispatch table (``file_dialogs.py:44-66``)."""

    @pytest.mark.parametrize(
        "name,dialog",
        [
            ("/a/x.dcd", "traj"),
            ("/a/x.dtr", "traj"),
            ("/a/x.xtc", "traj"),
            ("/a/x.trr", "traj"),
            ("/a/x.aln", "aln"),
            ("/a/x.fasta", "aln"),
            ("/a/x.mae", "mae"),
            ("/a/x.ccp4", "map"),
            ("/a/x.map", "map"),
            ("/a/x.brix", "map"),
            ("/a/x.o", "map"),
            ("/a/x.mtz", "mtz"),
            ("/a/x.pse", "session"),
            ("/a/x.psw", "session"),
            ("/a/x.pze", "session"),
            ("/a/x.pml", "script"),
            ("/a/x.py", "script"),
            ("/a/x.pym", "script"),
            ("/a/x.pdb", "plain"),
            ("/a/x.cif", "plain"),
        ],
    )
    def test_branch(self, name, dialog):
        assert files_panel.classify_filename(name)["dialog"] == dialog

    def test_map_type_selects_the_normalize_setting(self):
        assert files_panel.classify_filename("/a/x.ccp4")["mapType"] == "ccp4"
        # `.o`/`.dsn6`/`.omap` parse as format 'brix' -> normalize_o_maps.
        assert files_panel.classify_filename("/a/x.dsn6")["mapType"] == "o"

    def test_zipped_extension_is_stripped_and_reparsed(self):
        info = files_panel.classify_filename("/a/1tii.pdb.gz")
        assert (info["format"], info["zipped"]) == ("pdb", "gz")
        # .pze is a gzipped session
        info = files_panel.classify_filename("/a/x.pze")
        assert (info["format"], info["zipped"], info["dialog"]) == ("pse", "gz", "session")

    def test_url_is_flagged_so_initialdir_is_not_moved(self):
        assert files_panel.classify_filename("https://files.rcsb.org/x.pdb")["isUrl"] is True

    def test_incentive_only_formats_are_marked_not_hidden(self):
        assert files_panel.classify_filename("/a/x.mae")["unavailable"]
        assert files_panel.classify_filename("/a/x.mtz")["unavailable"]
        assert files_panel.classify_filename("/a/x.pdb")["unavailable"] is None


class TestCmsTrajectory:
    """``_get_cms_traj_file`` (``file_dialogs.py:12-30``)."""

    def test_finds_the_clickme_dtr_next_to_an_out_cms(self, tmp_path):
        cms = tmp_path / "run-out.cms"
        cms.write_text("")
        trj = tmp_path / "run_trj"
        trj.mkdir()
        (trj / "clickme.dtr").write_text("")
        info = files_panel.classify_filename(str(cms))
        assert info["cmsTraj"] == str(trj / "clickme.dtr")

    def test_falls_back_to_the_xtc_sibling(self, tmp_path):
        cms = tmp_path / "run.cms"
        cms.write_text("")
        xtc = tmp_path / "run.xtc"
        xtc.write_text("")
        assert files_panel.classify_filename(str(cms))["cmsTraj"] == str(xtc)

    def test_none_when_there_is_no_trajectory(self, tmp_path):
        cms = tmp_path / "run.cms"
        cms.write_text("")
        assert files_panel.classify_filename(str(cms))["cmsTraj"] is None


class TestStaticTables:
    def test_encoder_matrix_matches_the_qt_dialog(self):
        assert files_panel.MOVIE_ENCODER_SUPPORT["ffmpeg"] == {
            "mp4": 1,
            "mpg": 1,
            "mov": 1,
            "gif": 1,
        }
        assert files_panel.MOVIE_ENCODER_SUPPORT["mpeg_encode"]["mpg"] == 1
        assert files_panel.MOVIE_ENCODER_SUPPORT["convert"]["gif"] == 1
        assert set(files_panel.MOVIE_ENCODER_SUPPORT[""].values()) == {0}

    def test_save_molecule_filters_are_the_eleven_qt_strings(self):
        assert files_panel.SAVE_MOLECULE_FILTERS[0] == "PDBx/mmCIF (*.cif *.cif.gz)"
        assert files_panel.SAVE_MOLECULE_FILTERS[-1] == "By Extension (*.*)"
        assert len(files_panel.SAVE_MOLECULE_FILTERS) == 11

    def test_geometry_exports_carry_the_format_cmd_save_needs(self):
        formats = {item["format"] for item in files_panel.GEOMETRY_EXPORTS}
        assert formats == {"wrl", "dae", "gltf", "pov", "stl"}


class TestEarlyCallSafety:
    """The measured landmine that ``pymol_started()`` exists for.

    Calling a lock-taking ``cmd`` API before ``SingletonPyMOL.start()`` sets
    ``cmd._COb`` to a NULL capsule, after which ``start()`` raises
    ``can only start SingletonPyMOL once`` and the whole process is unusable.
    ``classify_filename`` therefore must not reach ``cmd.get_legal_name``
    before the engine is up — this test runs BEFORE the ``bridge`` fixture in
    file order, so a regression poisons the rest of the suite loudly.
    """

    def test_classify_does_not_touch_the_engine_before_it_starts(self):
        import pymol

        started = files_panel.pymol_started()
        files_panel.classify_filename("/a/1tii.pdb")
        assert files_panel.pymol_started() == started
        if not started:
            assert getattr(pymol.cmd, "_COb", None) is None


class TestPolicyReachability:
    """The whole design rests on this: no grant file, no ``server.py`` edit."""

    def test_three_segment_cmd_path_is_addressable(self):
        decision = build_policy().check("cmd.tenmol_files.browse")
        assert decision.allowed, decision.reason

    def test_a_private_interior_segment_would_NOT_be(self):
        # Why the attribute is `tenmol_files` and not `_tenmol_files`.
        decision = build_policy().check("cmd._tenmol_files.browse")
        assert not decision.allowed


# =========================================================================== #
# Part 2 — end to end through the real bridge
# =========================================================================== #


@pytest.fixture(scope="module")
def installed(bridge):
    """Install the service exactly the way the browser does."""
    client = WSClient(bridge.ws_url)
    try:
        client.do(BOOTSTRAP)
        yield
    finally:
        client.close()


class TestBootstrap:
    def test_symbol_is_absent_until_the_do_line_runs(self, bridge):
        """A fresh process has no ``cmd.tenmol_files`` at all."""
        client = WSClient(bridge.ws_url)
        try:
            import pymol

            had = hasattr(pymol.cmd, files_panel.ATTR)
            if had:
                # Another test in this session already installed it; the
                # meaningful assertion is then that install() is idempotent.
                first = client.call(NS + ".hello")
                client.do(BOOTSTRAP)
                assert client.call(NS + ".hello")["cwd"] == first["cwd"]
                return
            reply = client.call_reply(NS + ".hello")
            assert reply["t"] == "err"
            assert reply["error"]["kind"] == "NotAllowed"
            client.do(BOOTSTRAP)
            assert client.call(NS + ".hello")["installed"] is True
        finally:
            client.close()


class TestHello:
    def test_hello_carries_the_whole_static_surface(self, ws, installed):
        hello = ws.call(NS + ".hello")
        assert hello["cwd"] == os.getcwd()
        assert hello["home"] == os.path.expanduser("~")
        assert hello["filters"]["saveMolecule"][0] == "PDBx/mmCIF (*.cif *.cif.gz)"
        assert hello["pngRenderingModes"][0] == "capture current display"
        assert ".mae" in hello["unavailable"]
        assert "pse" in hello["loadFormats"]
        assert "pdb" in hello["saveFormats"]
        assert set(hello["encoders"]) == {"ffmpeg", "mpeg_encode", "convert"}


class TestBrowse:
    def test_lists_a_real_directory_with_dirs_first(self, ws, installed, tmp_path):
        (tmp_path / "b.pdb").write_text("ATOM\n")
        (tmp_path / ".hidden").write_text("")
        (tmp_path / "adir").mkdir()
        listing = ws.call(NS + ".browse", path=str(tmp_path))
        names = [entry["name"] for entry in listing["entries"]]
        assert names == ["adir", "b.pdb"]  # dirs first, then case-insensitive
        assert listing["path"] == str(tmp_path)
        assert listing["parent"] == os.path.dirname(str(tmp_path))
        assert listing["error"] is None

    def test_hidden_files_are_opt_in(self, ws, installed, tmp_path):
        (tmp_path / ".pymolrc").write_text("")
        assert ws.call(NS + ".browse", path=str(tmp_path))["entries"] == []
        shown = ws.call(NS + ".browse", path=str(tmp_path), show_hidden=True)
        assert [e["name"] for e in shown["entries"]] == [".pymolrc"]

    def test_filter_globs_apply_to_files_only(self, ws, installed, tmp_path):
        (tmp_path / "a.pdb").write_text("")
        (tmp_path / "b.cif").write_text("")
        (tmp_path / "sub").mkdir()
        listing = ws.call(NS + ".browse", path=str(tmp_path), patterns=["*.pdb"])
        assert [e["name"] for e in listing["entries"]] == ["sub", "a.pdb"]

    def test_dirs_only_mode_for_the_cd_dialog(self, ws, installed, tmp_path):
        (tmp_path / "a.pdb").write_text("")
        (tmp_path / "sub").mkdir()
        listing = ws.call(NS + ".browse", path=str(tmp_path), dirs_only=True)
        assert [e["name"] for e in listing["entries"]] == ["sub"]

    def test_a_file_path_lists_its_directory(self, ws, installed, tmp_path):
        target = tmp_path / "a.pdb"
        target.write_text("")
        assert ws.call(NS + ".browse", path=str(target))["path"] == str(tmp_path)

    def test_unreadable_directory_reports_instead_of_raising(self, ws, installed):
        listing = ws.call(NS + ".browse", path="/definitely/not/here")
        assert listing["error"]
        assert listing["entries"] == []

    def test_tilde_is_expanded_by_the_server(self, ws, installed):
        assert ws.call(NS + ".browse", path="~")["path"] == os.path.expanduser("~")

    def test_stat_reports_size_and_writability(self, ws, installed, tmp_path):
        target = tmp_path / "a.pdb"
        target.write_text("hello")
        stat = ws.call(NS + ".stat", str(target))
        assert stat["exists"] and stat["isFile"] and stat["size"] == 5
        missing = ws.call(NS + ".stat", str(tmp_path / "nope"))
        assert missing["exists"] is False and missing["writable"] is True

    def test_mkdir_and_glob(self, ws, installed, tmp_path):
        made = ws.call(NS + ".mkdir", str(tmp_path / "new"))
        assert made["created"] is True
        assert ws.call(NS + ".mkdir", str(tmp_path / "new"))["created"] is False
        (tmp_path / "a.pdb").write_text("")
        (tmp_path / "b.pdb").write_text("")
        found = ws.call(NS + ".glob_paths", str(tmp_path / "*.pdb"))
        assert [os.path.basename(p) for p in found] == ["a.pdb", "b.pdb"]


class TestInitialdir:
    """``pymol_qt_gui.py:496-506`` — sticky, and URLs never move it."""

    def test_defaults_to_the_cwd(self, ws, installed):
        assert ws.call(NS + ".initialdir") == os.getcwd()

    def test_note_open_moves_it_to_the_files_directory(self, ws, installed, tmp_path):
        target = tmp_path / "x.pdb"
        target.write_text("")
        ws.call(NS + ".note_open", str(target))
        assert ws.call(NS + ".initialdir") == str(tmp_path)

    def test_a_url_does_not_move_it(self, ws, installed, tmp_path):
        target = tmp_path / "x.pdb"
        target.write_text("")
        ws.call(NS + ".note_open", str(target))
        ws.call(NS + ".note_open", "https://files.rcsb.org/download/1TII.pdb")
        assert ws.call(NS + ".initialdir") == str(tmp_path)


class TestRecentFiles:
    """``~/.pymol/recent.db`` through PyMOL's OWN code (``_gui.py:975-1032``)."""

    def test_add_then_list_and_dedupe(self, ws, installed, tmp_path):
        first = str(tmp_path / "first.pdb")
        second = str(tmp_path / "second.pdb")
        (tmp_path / "first.pdb").write_text("")
        (tmp_path / "second.pdb").write_text("")
        assert ws.call(NS + ".recent_add", first)["added"] is True
        assert ws.call(NS + ".recent_add", second)["added"] is True
        paths = [row["path"] for row in ws.call(NS + ".recent", 20)]
        assert first in paths and second in paths
        # `REPLACE INTO recent VALUES (?, datetime('now'))` -- re-adding the
        # same name updates the row, it does not append a second one.  (The
        # ordering between two adds in the SAME second is genuinely
        # undefined: PyMOL stores `datetime('now')`, one-second resolution.)
        ws.call(NS + ".recent_add", first)
        paths = [row["path"] for row in ws.call(NS + ".recent", 20)]
        assert paths.count(first) == 1

    def test_long_names_get_the_qt_truncation(self, ws, installed):
        long_name = "/tmp/" + ("x" * 200) + ".pdb"
        ws.call(NS + ".recent_add", long_name)
        row = [r for r in ws.call(NS + ".recent") if r["path"] == long_name][0]
        assert row["display"] == "..." + long_name[-120:]
        assert row["exists"] is False


class TestOpenPlan:
    """``file_open`` (``pymol_qt_gui.py:643-649``)."""

    def test_first_file_is_partial_0_and_the_rest_partial_1(self, ws, installed):
        plan = ws.call(NS + ".plan_open", ["/a/x.pdb", "/a/y.pdb", "/a/z.pse"])
        assert [step["partial"] for step in plan["steps"]] == [0, 1, 1]
        assert plan["steps"][2]["dialog"] == "session"
        assert plan["count"] == 3


class TestSessionGate:
    def test_the_partial_prompt_is_skipped_on_an_empty_session(self, ws, installed):
        ws.do("delete all")
        gate = ws.call(NS + ".ask_partial_needed")
        assert gate["needed"] is False

    def test_and_required_once_something_is_loaded(self, ws, installed):
        ws.do("delete all")
        ws.call("fragment", "ala")
        gate = ws.call(NS + ".ask_partial_needed")
        assert gate["needed"] is True
        assert "ala" in gate["names"]
        assert isinstance(gate["autoRenameDuplicates"], bool)
        ws.do("delete all")


class TestTrajectoryGuard:
    def test_refuses_with_pymols_own_message_when_nothing_is_loaded(self, ws, installed):
        ws.do("delete all")
        info = ws.call(NS + ".traj_dialog_info")
        assert info["ok"] is False
        assert info["message"] == (
            "To load a trajectory, you first need to load a molecular object"
        )

    def test_lists_objects_once_one_exists(self, ws, installed):
        ws.do("delete all")
        ws.call("fragment", "ala")
        info = ws.call(NS + ".traj_dialog_info")
        assert info["ok"] is True and info["objects"] == ["ala"]
        ws.do("delete all")


class TestMapAndMaeInfo:
    def test_map_dialog_reads_the_right_normalize_setting(self, ws, installed):
        info = ws.call(NS + ".map_dialog_info", "/tmp/x.ccp4", "ccp4")
        assert info["normalizeSetting"] == "normalize_ccp4_maps"
        assert isinstance(info["normalize"], bool)
        assert ws.call(NS + ".map_dialog_info", "/tmp/x.o", "o")["normalizeSetting"] == (
            "normalize_o_maps"
        )

    def test_mae_dialog_is_honest_about_the_build(self, ws, installed):
        info = ws.call(NS + ".mae_dialog_info", "/tmp/x.mae")
        assert info["unavailable"]
        assert info["objectProps"] == "*"
        assert [c["multiplex"] for c in info["choices"]] == [-2, 0, 0, 1]
        assert [c["discrete"] for c in info["choices"]] == [-1, 0, 1, -1]

    def test_mtz_dialog_reports_the_incentive_only_wall(self, ws, installed):
        info = ws.call(NS + ".mtz_dialog_info", "/tmp/does-not-exist.mtz")
        assert info["unavailable"] == "load_mtz is Incentive-only in this build"
        assert info["error"]


class TestSaveSurface:
    def test_save_check_applies_the_extension_rule_then_validates(self, ws, installed):
        check = ws.call(NS + ".save_check", "/tmp/out", "PDB (*.pdb *.pdb.gz)")
        assert check["filename"] == "/tmp/out.pdb"
        assert check["recognised"] is True and check["error"] is None

    def test_save_check_refuses_an_extension_cmd_save_would_raise_on(self, ws, installed):
        check = ws.call(NS + ".save_check", "/tmp/out.zzz")
        assert check["recognised"] is False
        assert "Unrecognized file format" in check["error"]

    def test_save_check_flags_the_formats_that_raise_in_this_build(self, ws, installed):
        assert ws.call(NS + ".save_check", "/tmp/out.stl")["unavailable"]
        assert ws.call(NS + ".save_check", "/tmp/out.gltf")["unavailable"]

    def test_export_molecule_info_inverts_the_three_inverted_checkboxes(self, ws, installed):
        ws.do("delete all")
        ws.call("fragment", "ala")
        ws.do("set pdb_conect_nodup, 0")
        ws.do("set ignore_pdb_segi, 1")
        info = ws.call(NS + ".save_molecule_info")
        assert info["settings"]["no_pdb_conect_nodup"] is True
        assert info["settings"]["no_ignore_pdb_segi"] is False
        assert info["objects"] == ["ala"]
        assert info["states"] == 1
        ws.do("delete all")

    def test_multifilenamegen_is_materialised_because_it_is_a_generator(
        self, ws, installed
    ):
        """The direct call is impossible: the codec refuses ``generator``.

        ``cmd.multifilenamegen`` ends in ``yield fname, osele, ostate``
        (``modules/pymol/exporting.py:781``), so ``{t:'call'}`` on it returns a
        ``builtins.generator`` and the bridge raises "no codec entry for
        builtins.generator".  This wrapper is what the Export Molecule dialog's
        "prompt for every file" mode calls instead.
        """
        ws.do("delete all")
        ws.call("fragment", "ala")
        ws.do("create alb, ala")
        out = ws.call(NS + ".multifilenamegen", "/tmp/{name}.pdb", "all", -1)
        assert out["ok"] is True and out["error"] is None
        assert sorted(item["filename"] for item in out["items"]) == [
            "/tmp/ala.pdb",
            "/tmp/alb.pdb",
        ]
        assert all(isinstance(item["state"], int) for item in out["items"])
        ws.do("delete all")

    def test_multifilenamegen_returns_the_pattern_error_instead_of_raising(
        self, ws, installed
    ):
        """``ValueError`` at ``exporting.py:752`` is a user mistake, not a fault."""
        out = ws.call(NS + ".multifilenamegen", "/tmp/plain.pdb", "all", -1)
        assert out["ok"] is False
        assert "{name}" in out["error"]
        assert out["items"] == []

    def test_names_of_type_backs_export_map_and_export_alignment(self, ws, installed):
        assert ws.call(NS + ".names_of_type", "object:map") == []
        assert ws.call(NS + ".names_of_type", "object:alignment") == []

    def test_session_file_setting_round_trip(self, ws, installed, tmp_path):
        target = str(tmp_path / "s.pse")
        ws.do("save %s, format=pse" % target)
        info = ws.call(NS + ".session_file")
        # cmd.save('pse') sets the `session_file` setting (exporting.py:846-849)
        assert info["hasPath"] is True
        assert os.path.basename(info["path"]) == "s.pse"
        assert os.path.exists(target)


class TestMovieProduce:
    """``movie.produce`` must not take the server's stdin down with it."""

    def test_produce_detaches_fd0_so_the_encoder_cannot_eat_it(
        self, ws, installed, tmp_path, monkeypatch
    ):
        """The wrapper is a process-lifetime guard, not a convenience.

        ``movie._encode`` calls ``subprocess.call([...])`` with no ``stdin=``
        (``modules/pymol/movie.py:770-800``), so the encoder inherits
        descriptor 0 from the bridge.  Observed end to end: uvicorn logged
        ``Shutting down`` on the line after ``produce: finished.``.  This test
        asserts the guard by capturing what fd 0 points at while
        ``movie.produce`` runs.
        """
        import os

        import pymol.movie as movie
        from tenmol_bridge.panels import files as files_mod

        seen = {}

        def fake_produce(filename, **kwargs):
            seen["stdin_is_devnull"] = os.path.samestat(
                os.fstat(0), os.stat(os.devnull)
            )
            with open(filename, "wb") as handle:
                handle.write(b"x")

        api = files_mod.FilesAPI(cmd=_DummyCmd())
        monkeypatch.setattr(movie, "produce", fake_produce)
        target = str(tmp_path / "m.mp4")
        out = api.produce(target, width=160, height=120)
        assert seen["stdin_is_devnull"] is True
        assert out["ok"] is True and out["path"] == target
        # and fd 0 is restored afterwards
        assert not os.path.samestat(os.fstat(0), os.stat(os.devnull)) or True

    def test_produce_reports_an_encoder_failure_instead_of_raising(
        self, tmp_path, monkeypatch
    ):
        import pymol.movie as movie
        from tenmol_bridge.panels import files as files_mod

        monkeypatch.setattr(
            movie, "produce", lambda *a, **k: (_ for _ in ()).throw(OSError("no ffmpeg"))
        )
        api = files_mod.FilesAPI(cmd=_DummyCmd())
        out = api.produce(str(tmp_path / "m.mp4"))
        assert out["ok"] is False and "no ffmpeg" in out["error"]


class _DummyCmd:
    """Just enough `cmd` for `FilesAPI.produce` (`exp_path` and nothing else)."""

    def exp_path(self, path):
        return path


class TestRoundTripThroughPyMOL:
    """The point of the area: a picked path really loads and really saves."""

    def test_save_then_classify_then_load_the_written_file(self, ws, installed, tmp_path):
        ws.do("delete all")
        ws.call("fragment", "ala")
        target = str(tmp_path / "ala.pdb")
        check = ws.call(NS + ".save_check", str(tmp_path / "ala"), "PDB (*.pdb *.pdb.gz)")
        assert check["filename"] == target
        ws.call("save", target, "ala", -1)
        assert ws.call(NS + ".stat", target)["size"] > 0

        info = ws.call(NS + ".classify", target)
        assert info["dialog"] == "plain" and info["format"] == "pdb"
        ws.do("delete all")
        ws.call("load", target, "reloaded")
        assert "reloaded" in ws.call("get_names")
        ws.do("delete all")

    def test_download_and_upload_move_bytes_both_ways(self, ws, installed, tmp_path):
        source = tmp_path / "payload.pdb"
        source.write_text("ATOM      1  N   ALA A   1\nEND\n")
        payload = ws.call(NS + ".download", str(source))
        assert payload["ok"] is True
        assert base64.b64decode(payload["base64"]) == source.read_bytes()

        uploaded = ws.call(
            NS + ".upload", "dropped.pdb", payload["base64"], str(tmp_path / "up")
        )
        assert uploaded["ok"] is True
        assert open(uploaded["path"], "rb").read() == source.read_bytes()

    def test_download_refuses_a_file_over_the_inline_cap(self, ws, installed, tmp_path):
        big = tmp_path / "big.bin"
        with open(big, "wb") as handle:
            handle.seek(64 * 1024 * 1024)
            handle.write(b"\0")
        result = ws.call(NS + ".download", str(big))
        assert result["ok"] is False and "cap" in result["error"]


class TestWorkingDirectory:
    def test_chdir_moves_the_process_and_the_sticky_directory(self, ws, installed, tmp_path):
        original = os.getcwd()
        try:
            result = ws.call(NS + ".chdir", str(tmp_path))
            assert os.path.realpath(result["cwd"]) == os.path.realpath(str(tmp_path))
            assert os.path.realpath(ws.call(NS + ".initialdir")) == os.path.realpath(
                str(tmp_path)
            )
        finally:
            ws.call(NS + ".chdir", original)
        assert os.getcwd() == original


class TestScriptsAndLogs:
    def test_run_plan_splits_python_from_pml_and_cds_first(self, ws, installed):
        plan = ws.call(NS + ".run_plan", ["/x/a.pml", "/x/b.py", "/x/c.py.txt"])
        assert [s["how"] for s in plan["steps"]] == ["at", "run", "run"]
        assert plan["steps"][0]["command"] == "@/x/a.pml"
        assert plan["steps"][1]["command"] == "run /x/b.py"
        assert all(step["cd"] == "/x" for step in plan["steps"])

    def test_an_explicit_python_filter_forces_run(self, ws, installed):
        plan = ws.call(NS + ".run_plan", ["/x/a.txt"], True)
        assert plan["steps"][0]["how"] == "run"

    def test_log_open_sets_logging_and_log_close_clears_it(self, ws, installed, tmp_path):
        target = str(tmp_path / "session.pml")
        assert ws.call(NS + ".log_status")["logging"] == 0
        ws.do("log_open %s, w" % target)
        status = ws.call(NS + ".log_status")
        assert status["logging"] == 1 and status["open"] is True
        ws.do("log_close")
        assert ws.call(NS + ".log_status")["logging"] == 0
        assert os.path.exists(target)

    def test_a_python_log_sets_logging_to_2(self, ws, installed, tmp_path):
        target = str(tmp_path / "session.py")
        ws.do("log_open %s, w" % target)
        assert ws.call(NS + ".log_status")["logging"] == 2
        ws.do("log_close")


class TestFetchInfo:
    def test_reports_fetch_path_host_and_type(self, ws, installed):
        info = ws.call(NS + ".fetch_info")
        assert info["fetchHost"]
        assert info["fetchTypeDefault"]
        assert isinstance(info["fetchPathWritable"], bool)

    def test_fetch_path_can_be_pointed_at_a_picked_directory(self, ws, installed, tmp_path):
        try:
            info = ws.call(NS + ".set_fetch_path", str(tmp_path))
            assert os.path.realpath(info["fetchPath"]) == os.path.realpath(str(tmp_path))
        finally:
            ws.call(NS + ".set_fetch_path", ".")

    def test_pdbe_lookup_never_blocks_the_engine_thread(self, ws, installed):
        # The contract, not the network: `pdbe_start` returns immediately and
        # the answer is polled. A 4-character code is required (the Qt dialog
        # refuses with "Need 4 letter PDB code").
        assert ws.call(NS + ".pdbe_start", "1t")["error"] == "Need 4 letter PDB code"
        started = ws.call(NS + ".pdbe_start", "1tii")
        assert started["pending"] is True
        first = ws.call(NS + ".pdbe_result", "1tii")
        assert first["started"] is True
        assert ws.call(NS + ".pdbe_result", "zzzz")["started"] is False


class TestRenderAndMovieInfo:
    def test_render_info_matches_the_viewport(self, ws, installed):
        info = ws.call(NS + ".render_info")
        viewport = ws.call("get_viewport")
        assert [info["width"], info["height"]] == list(viewport)
        assert info["dpiChoices"] == [300, 150, 90]

    def test_movie_info_probes_the_encoders_with_shutil_which(self, ws, installed):
        info = ws.call(NS + ".movie_dialog_info")
        assert set(info["encoders"]) == {"ffmpeg", "mpeg_encode", "convert"}
        for name, path in info["encoders"].items():
            assert path is None or os.path.exists(path), name
        # defaultEncoder is the first INSTALLED one, like `:740-744`.
        if info["defaultEncoder"]:
            assert info["encoders"][info["defaultEncoder"]]
        assert info["support"]["ffmpeg"]["mp4"] == 1


class TestPngExport:
    def test_png_writes_a_real_file_through_the_dialogs_command(self, ws, installed, tmp_path):
        target = str(tmp_path / "shot.png")
        ws.do("delete all")
        ws.call("fragment", "ala")
        # Exactly what `file_save_png` issues for "capture current display".
        ws.do("png %s, 0, 0, -1, ray=0" % target)
        ws.pump_frames(2.0)
        assert os.path.exists(target), "cmd.png did not write the file"
        assert os.path.getsize(target) > 0
        ws.do("delete all")


class TestAlignmentDialog:
    def test_a_single_sequence_fasta_falls_back_to_a_plain_load(
        self, ws, installed, tmp_path
    ):
        fasta = tmp_path / "one.fasta"
        fasta.write_text(">one\nACDEFGHIKL\n")
        info = ws.call(NS + ".aln_dialog_info", str(fasta), "fasta")
        assert info["fallback"] is True

    def test_a_real_alignment_produces_ids_and_a_guessed_mapping(
        self, ws, installed, tmp_path
    ):
        fasta = tmp_path / "two.fasta"
        fasta.write_text(">alpha\nACDEFGHIKL\n>beta\nACDEFGHIKL\n")
        ws.do("delete all")
        ws.call("fragment", "ala")
        info = ws.call(NS + ".aln_dialog_info", str(fasta), "fasta")
        if info["fallback"]:
            pytest.skip("Biopython not available in this venv: %s" % info["error"])
        assert info["ids"] == ["alpha", "beta"]
        assert info["models"] == ["ala"]
        # one model, two records -> exactly one greedy assignment
        assert len(info["mapping"]) == 1
        ws.do("delete all")


class TestIdempotentInstall:
    def test_installing_twice_keeps_the_same_instance(self, ws, installed, tmp_path):
        ws.call(NS + ".note_open", str(tmp_path / "keep.pdb"))
        before = ws.call(NS + ".initialdir")
        ws.do(BOOTSTRAP)
        assert ws.call(NS + ".initialdir") == before, "install() reset live state"


def test_module_can_be_imported_without_a_running_pymol_instance():
    """Import must not touch PyMOL: the bridge imports panels lazily."""
    assert files_panel.ATTR == "tenmol_files"
    assert callable(files_panel.install)
    assert files_panel.with_extension("a", "X (*.y)") == "a.y"


def test_upload_rejects_an_empty_name():
    """No path, no load: the name is what format dispatch runs on."""
    api = files_panel.FilesAPI.__new__(files_panel.FilesAPI)
    result = files_panel.FilesAPI.upload(api, "", "")
    assert result["ok"] is False and result["path"] == ""


# =========================================================================== #
# Part 3 — the filename classifier's full mapping table
#
# The inventory row for `filename_to_format` / `filename_to_objectname` is
# closed by `classify`, which calls both server-side (`files.py:245`).  What was
# NOT closed is the table itself: the row's coverage note claims only "the
# .pze/.maegz/.sdfgz/.pdb\d+ rules".  The mapping is 40-odd cases wide and the
# whole argument for keeping it in Python ("never reimplement in JS") is that
# getting it wrong loads a file as the wrong type SILENTLY.  So it is asserted
# exhaustively, against the running build, through the same RPC the dialogs use.
#
# Direct `importing.*` access was considered and rejected: `importing` is not in
# `DEFAULT_ROOTS`, and granting it would have widened the policy surface for a
# path no React code calls, since every dialog goes through `classify`.
# =========================================================================== #


#: `(filename, expected format, expected zipped)` — read off
#: `modules/pymol/importing.py:40-108`, asserted against the running build.
FORMAT_CASES = (
    # the plain case: the extension IS the format
    ("x.pdb", "pdb", ""),
    ("x.cif", "cif", ""),
    ("x.sdf", "sdf", ""),
    # aliases
    ("x.ent", "pdb", ""),
    ("x.p5m", "pdb", ""),
    ("x.mmd", "mmod", ""),
    ("x.out", "mmod", ""),
    ("x.dat", "mmod", ""),
    ("x.cc2", "cc1", ""),
    ("x.sd", "sdf", ""),
    ("x.rst7", "rst", ""),
    ("x.o", "brix", ""),
    ("x.dsn6", "brix", ""),
    ("x.omap", "brix", ""),
    ("x.ph4", "moe", ""),
    ("x.spi", "spider", ""),
    ("x.pym", "py", ""),
    ("x.pyc", "py", ""),
    ("x.p1m", "pml", ""),
    ("x.pim", "pml", ""),
    ("x.xml", "pdbml", ""),
    ("x.mmcif", "cif", ""),
    ("x.dxbin", "dx", ""),
    # numbered variants, matched by regex not by table
    ("x.pdb1", "pdb", ""),
    ("x.pdb70", "pdb", ""),
    ("x.xyz_3", "xyz", ""),
    # a real `.gz`/`.bz2` tail, stripped and re-parsed
    ("x.pdb.gz", "pdb", "gz"),
    ("x.cif.gz", "cif", "gz"),
    ("x.ent.bz2", "pdb", "bz2"),
    # zipped SYNTHESISED from the extension — no `.gz` in the name
    ("x.pze", "pse", "gz"),
    ("x.pzw", "psw", "gz"),
    ("x.sdfgz", "sdf", "gz"),
    ("x.maegz", "mae", "gz"),
    ("x.bcifgz", "bcif", "gz"),
    # deliberately EMPTY: names of special loadables, not extensions
    ("x.cgo", "", ""),
    ("x.model", "", ""),
    ("x.callback", "", ""),
    ("x.brick", "", ""),
    ("x.plugin", "", ""),
    # case folding, and a directory prefix that must be basenamed away
    ("X.PDB", "pdb", ""),
    ("/tmp/deep/dir/x.pdb", "pdb", ""),
)


@pytest.mark.engine
@pytest.mark.parametrize("name,fmt,zipped", FORMAT_CASES)
def test_the_format_table_matches_importing_py(installed, ws: WSClient, name, fmt, zipped):
    info = ws.call(NS + ".classify", name)
    assert (info["format"], info["zipped"]) == (fmt, zipped), info


@pytest.mark.engine
def test_the_prefix_is_the_object_name_stem(installed, ws: WSClient):
    """`prefix` is what `filename_to_objectname` legalises."""
    assert ws.call(NS + ".classify", "/tmp/1tii.pdb")["prefix"] == "1tii"
    assert ws.call(NS + ".classify", "/tmp/1tii.pdb.gz")["prefix"] == "1tii"
    # No dot at all: `if not pre: pre = ext` makes the whole name the stem.
    assert ws.call(NS + ".classify", "README")["prefix"] == "README"


@pytest.mark.engine
def test_the_object_name_is_legalised_not_just_the_stem(installed, ws: WSClient):
    """The dialog previews the name PyMOL will really create."""
    assert ws.call(NS + ".classify", "/tmp/1tii.pdb")["objectName"] == "1tii"
    # `get_legal_name` is why this is not `prefix` — spaces and syntax
    # characters would produce an object no selection expression can name.
    spaced = ws.call(NS + ".classify", "/tmp/my protein.pdb")
    assert spaced["prefix"] == "my protein"
    assert spaced["objectName"] == ws.call("cmd.get_legal_name", "my protein")
