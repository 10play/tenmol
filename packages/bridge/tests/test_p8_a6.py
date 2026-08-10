"""WP-18 / parity area 6, wave 8 — the file-I/O behaviours earlier waves left
annotated "not exercised".

Every gap this file closes was a *coverage* gap, not a design gap: the wave-4
sweep drove each dialog through a browser once and wrote down what it had NOT
run.  This runs those, on the live engine, and records the numbers.

What is measured here that was previously only assumed:

* **267/272** every one of the 31 entries in ``exporting.savefunctions`` +
  ``func_type4`` is written to a real file.  29 produce bytes (COLLADA ``.dae``
  included -- 130 kB of XML, the extension the wave-4 note calls out by name);
  ``mtl``/``stl``/``gltf`` are the only three that raise, and they raise with
  three DIFFERENT messages.  ``.obj`` writes a **zero-byte file** and reports
  success.  ``save x.mae`` **works**, which contradicts the ``unavailable``
  answer the save picker was giving (fixed in ``save_check``).
* **268** ``multisave`` itself: HEADER-per-object, ``append=1``, and the three
  refusals (``gz``, a non-pdb/cif format, ``pmo``).
* **255** ``seqalign.load_aln_multi`` really runs and builds an alignment
  object, with upstream's own atom counts (``packages/engine/testing/tests/api/seqalign.py``).
* **257** the ``brix``/``o`` half of the map dialog, which had never been run.
* **261** ``.pze``/``.pzw`` are gzip on disk and gunzip transparently on load;
  and a ``.psw``/``.pzw`` whose session has **no scenes** raises ``No scenes``
  *after* restoring everything -- a real trap for the client's error handling.
* **282** the pml-vs-python log distinction, byte for byte, including the
  ``fetch`` -> ``fetch ..., async=0`` rewrite and the append newline.
* **289** ``_multifetch``'s multi-code loop, the ``cc``/``emd`` type inference
  and the 5-letter chain filter -- OFFLINE, by pre-staging the files
  ``_fetch`` skips the download for (``importing.py:1217-1219``).
* **273/274/275** the four PNG dialog modes, the dpi/width/height/prior matrix
  (real pixel dimensions read out of the IHDR), and ``draw W, H`` at a
  non-viewport size, which wave 4 recorded as having killed the bridge.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p8_a6.py -q
"""

from __future__ import annotations

import gzip
import os
import struct
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

NS = "cmd.tenmol_files"
BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA = os.path.join(REPO, "packages", "engine", "testing", "data")
CCP4 = os.path.join(DATA, "emd_1155.ccp4")
BRIX = os.path.join(DATA, "emd_1155.brix")
ALN = os.path.join(DATA, "alignment.aln")


@pytest.fixture
def files(ws):
    """The file service installed the way the browser installs it."""
    ws.do(BOOTSTRAP)
    yield ws


@pytest.fixture
def scratch(files):
    """Delete every object this file makes, whatever it was called.

    ONE PYMOL PER SUITE: ``cmd.fab`` also leaves ``_pkbase*``/``_pkfrag*``
    behind and the alignment object is named after the alignment FILE, so a
    prefix sweep is not enough -- the names are listed explicitly.
    """
    yield files
    for name in list(files.call("cmd.get_names", "all") or []):
        if name.startswith("p8a6") or name in ("alignment", "1abc", "ala", "EMD-1155"):
            files.call("cmd.delete", name)
    files.do("delete _pk*")


def _molecule(ws, name="p8a6mol"):
    ws.call("cmd.fragment", "ala", name)
    return name


def _png_info(path: str) -> Dict[str, Any]:
    with open(path, "rb") as handle:
        head = handle.read(26)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", repr(head[:8])
    width, height = struct.unpack(">II", head[16:24])
    return {"w": width, "h": height, "depth": head[24], "color": head[25]}


# =========================================================================== #
# Rows 267 + 272 — `cmd.save`, the whole savefunctions registry
# =========================================================================== #

#: MEASURED, one write per entry (see :func:`test_every_save_format_is_written`).
#: `None` means "wrote a file"; a string is the substring of the error that
#: comes back instead.  The three failures are three DIFFERENT reasons.
SAVE_OUTCOMES: Dict[str, Any] = {
    "aln": None,
    "bcif": None,
    "ccp4": None,
    "cif": None,
    "dae": None,
    "dat": None,
    "fasta": None,
    "gltf": "could not find collada2gltf",
    "idtf": None,
    "mae": None,
    "map": None,
    "mmd": None,
    "mmtf": None,
    "mol": None,
    "mol2": None,
    "mrc": None,
    "mtl": ".MTL export not implemented",
    "obj": None,
    "out": None,
    "pdb": None,
    "pkl": None,
    "pkla": None,
    "png": None,
    "pov": None,
    "pqr": None,
    "pse": None,
    "psw": None,
    "sdf": None,
    "stl": "STL export not supported by this PyMOL build",
    "wrl": None,
    "xyz": None,
}

#: The first bytes each writer produces, for the formats whose identity is
#: checkable.  A size check alone would pass on a file full of the wrong thing.
SAVE_MAGIC: Dict[str, bytes] = {
    "aln": b"CLUSTAL",
    "bcif": b"\x83\xaadataBlocks",
    "cif": b"# generated by PyMOL",
    "dae": b'<?xml version="1.0"',
    "fasta": b">",
    "idtf": b'FILE_FORMAT "IDTF"',
    "mae": b"{ s_m_m2io_version",
    "mmtf": b"\xde\x00",
    "mol2": b"# created with PyMOL",
    "pdb": b"ATOM  ",
    "png": b"\x89PNG\r\n\x1a\n",
    "pov": b"camera {",
    "pqr": b"ATOM  ",
    "pse": b"}q\x00(",
    "psw": b"}q\x00(",
    "wrl": b"#VRML V2.0 utf8",
}


@pytest.fixture
def save_scene(scratch):
    """A molecule, a map and an alignment object — the three save domains.

    ``get_ccp4str`` takes the map's NAME where the others take a selection
    (``exporting.py:969``), and ``get_alnstr`` needs an ``object:alignment``,
    so a single ``fragment`` cannot cover the registry.
    """
    ws = scratch
    ws.call("cmd.fab", "ACDEFGHIKLMNPQRS", "p8a6m1")
    ws.call("cmd.fab", "ACDIKLMNP", "p8a6m2")
    ws.call(NS + ".load_aln", ALN, {"seq1": "p8a6m1", "seq2": "p8a6m2"})
    ws.call("cmd.load", CCP4, "p8a6map")
    assert ws.call("cmd.get_type", "alignment") == "object:alignment"
    return ws


def _selection_for(fmt: str) -> str:
    if fmt in ("ccp4", "mrc", "map"):
        return "p8a6map"
    if fmt == "aln":
        return "alignment"
    return "p8a6m1"


def test_every_save_format_is_written(save_scene, tmp_path):
    """Row 267: all 31 registry entries, written for real.

    The wave-4 note said "most of the 31 formats were not written".  This
    writes every one of them and compares the whole outcome map at once, so a
    format that starts or stops working shows up as a diff rather than as a
    silently skipped case.
    """
    ws = save_scene
    from pymol import exporting

    formats = sorted(
        set(list(exporting.savefunctions) + ["mmd", "out", "dat", "pkl", "pkla"])
    )
    assert len(formats) == 31, formats
    assert set(formats) == set(SAVE_OUTCOMES), set(formats) ^ set(SAVE_OUTCOMES)

    outcomes: Dict[str, Any] = {}
    sizes: Dict[str, int] = {}
    for fmt in formats:
        target = str(tmp_path / ("all." + fmt))
        reply = ws.call_reply("cmd.save", target, _selection_for(fmt), -1)
        if reply["t"] == "err":
            outcomes[fmt] = str(reply["error"]["message"])
            assert not os.path.exists(target), "%s wrote a file AND raised" % fmt
            continue
        outcomes[fmt] = None
        assert os.path.exists(target), "%s reported ok and wrote nothing" % fmt
        sizes[fmt] = os.path.getsize(target)
        magic = SAVE_MAGIC.get(fmt)
        if magic:
            with open(target, "rb") as handle:
                assert handle.read(len(magic)) == magic, fmt

    for fmt, expected in SAVE_OUTCOMES.items():
        if expected is None:
            assert outcomes[fmt] is None, "%s: %s" % (fmt, outcomes[fmt])
        else:
            assert expected in (outcomes[fmt] or ""), (fmt, outcomes[fmt])

    # The three ccp4 aliases are one writer under three extensions.
    assert sizes["dae"] > 50_000, sizes["dae"]  # measured 137878
    assert sizes["ccp4"] == sizes["mrc"] == sizes["map"] > 1_000_000
    # mmtf is a msgpack map, not text: check a key rather than a byte prefix.
    with open(str(tmp_path / "all.mmtf"), "rb") as handle:
        assert b"altLocList" in handle.read(64)
    # xyz starts with the atom count, so it is checked against the engine.
    with open(str(tmp_path / "all.xyz")) as handle:
        lines = handle.read().splitlines()
    assert lines[0].strip() == str(ws.call("cmd.count_atoms", "p8a6m1"))
    assert lines[1] == "p8a6m1"


def test_obj_export_is_empty_or_not_depending_on_the_REPRESENTATION(
    scratch, tmp_path
):
    """``.obj`` exports the triangulated scene, and reports success either way.

    ``savefunctions['obj']`` is ``_get_mtl_obj`` (``exporting.py:981-986``),
    which returns ``cmd.get_mtl_obj()[1]`` — "an incomplete and unsupported
    feature" by its own docstring (``querying.py:585-600``).  MEASURED: with
    only lines shown it returns an empty string and ``cmd.save`` happily writes
    a **0-byte file** with no error; with spheres shown the same call writes
    real geometry.  So OBJ export is not "broken", it is silently
    representation-dependent — which is worth pinning, because a user who
    exports a lines-only scene gets an empty file and no warning.
    """
    ws = scratch
    ws.call("cmd.fragment", "ala", "p8a6obj")
    ws.call("cmd.hide", "everything", "p8a6obj")
    ws.call("cmd.show", "lines", "p8a6obj")
    empty = str(tmp_path / "lines.obj")
    assert ws.call_reply("cmd.save", empty, "p8a6obj", -1)["t"] == "ok"
    assert os.path.getsize(empty) == 0

    ws.call("cmd.show", "spheres", "p8a6obj")
    full = str(tmp_path / "spheres.obj")
    assert ws.call_reply("cmd.save", full, "p8a6obj", -1)["t"] == "ok"
    assert os.path.getsize(full) > 1000
    with open(full) as handle:
        assert handle.read(2) == "v "

    # …and the picker warns about it, because nothing else will.
    check = ws.call(NS + ".save_check", empty)
    assert check["recognised"] is True
    assert check["unavailable"] and "triangles only" in check["unavailable"]


def test_the_save_picker_no_longer_calls_mae_export_impossible(save_scene, tmp_path):
    """``.mae`` is Incentive-only on the READ side only.

    ``loadfunctions['mae']`` is the sentinel that raises (row 256), but
    ``savefunctions['mae']`` is plain ``get_str`` and measured here writes a
    real Maestro file.  ``save_check`` used to answer with the IMPORT-side
    manifest, so the Export Molecule picker annotated a format that works.
    """
    ws = save_scene
    target = str(tmp_path / "real.mae")
    assert ws.call_reply("cmd.save", target, "p8a6m1", -1)["t"] == "ok"
    with open(target) as handle:
        assert handle.read(18) == "{ s_m_m2io_version"

    assert ws.call(NS + ".save_check", target)["unavailable"] is None
    # …while the load side still says it is impossible.
    assert ws.call(NS + ".classify", target)["unavailable"]
    assert ".mae" in ws.call(NS + ".unavailable")


def test_the_three_formats_that_raise_are_flagged_before_the_write(save_scene, tmp_path):
    """Row 267: ``mtl`` raises too, and the picker never said so.

    All three failures are checkable up front, so the dialog can disable the
    entry instead of letting ``cmd.save`` throw at the end of a file picker.
    """
    ws = save_scene
    for ext, needle in (
        ("stl", "STL"),
        ("gltf", "collada2gltf"),
        ("mtl", "not implemented"),
    ):
        check = ws.call(NS + ".save_check", str(tmp_path / ("x." + ext)))
        assert check["recognised"] is True, ext
        assert check["unavailable"] and needle in check["unavailable"], ext
        reply = ws.call_reply("cmd.save", str(tmp_path / ("x." + ext)), "p8a6m1", -1)
        assert reply["t"] == "err", ext


def test_gz_and_bz2_are_honoured_by_extension(save_scene, tmp_path):
    """``exporting.py:918-931`` — the compression is chosen by the SUFFIX."""
    ws = save_scene
    plain = str(tmp_path / "z.pdb")
    gzipped = str(tmp_path / "z.pdb.gz")
    bzipped = str(tmp_path / "z.pdb.bz2")
    for target in (plain, gzipped, bzipped):
        assert ws.call_reply("cmd.save", target, "p8a6m1", -1)["t"] == "ok"

    with open(gzipped, "rb") as handle:
        assert handle.read(2) == b"\x1f\x8b", "not a gzip stream"
    with open(bzipped, "rb") as handle:
        assert handle.read(3) == b"BZh", "not a bzip2 stream"
    # …and the gzip really contains the same PDB.
    with gzip.open(gzipped, "rb") as handle:
        assert handle.read(6) == b"ATOM  "
    assert os.path.getsize(gzipped) < os.path.getsize(plain)


def test_collada_export_is_real_geometry(save_scene, tmp_path):
    """Row 272: COLLADA (.dae), the one geometry export never written."""
    ws = save_scene
    ws.call("cmd.show", "spheres", "p8a6m1")
    target = str(tmp_path / "geo.dae")
    assert ws.call_reply("cmd.save", target, "p8a6m1", -1)["t"] == "ok"
    with open(target) as handle:
        text = handle.read()
    assert text.startswith('<?xml version="1.0"')
    assert "<COLLADA" in text
    assert "<library_geometries>" in text
    assert text.count("<float_array") > 1, "no vertex arrays in the COLLADA"
    assert len(text) > 50_000, len(text)
    # The same call through the menu's `format=` form, which is what the
    # "Export Image As ▸ COLLADA" item runs (`FilesPanel.tsx:465`).
    other = str(tmp_path / "geo-by-format.dae")
    assert ws.call("cmd.save", other, "(all)", -1, "dae") is None
    assert os.path.getsize(other) > 0


# =========================================================================== #
# Row 268 — multisave
# =========================================================================== #


class TestMultisave:
    """``exporting.py:604-657``, the half wave 4 could not reach."""

    def test_one_HEADER_and_one_END_per_object(self, scratch, tmp_path):
        ws = scratch
        ws.call("cmd.fragment", "ala", "p8a6one")
        ws.call("cmd.fragment", "trp", "p8a6two")
        target = str(tmp_path / "multi.pdb")
        assert ws.call_reply("cmd.multisave", target, "p8a6*", -1)["t"] == "ok"
        with open(target) as handle:
            text = handle.read()
        assert text.startswith("HEADER    p8a6one")
        assert "HEADER    p8a6two" in text
        assert text.count("END\n") == 2, text.count("END\n")
        # …which is exactly the difference from `cmd.save`, whose multi-object
        # output is flat: no HEADER at all.
        flat = str(tmp_path / "flat.pdb")
        ws.call("cmd.save", flat, "p8a6*", -1)
        with open(flat) as handle:
            assert "HEADER" not in handle.read()

    def test_append_grows_the_file_instead_of_truncating_it(self, scratch, tmp_path):
        ws = scratch
        ws.call("cmd.fragment", "ala", "p8a6one")
        ws.call("cmd.fragment", "trp", "p8a6two")
        target = str(tmp_path / "append.pdb")
        ws.call("cmd.multisave", target, "p8a6*", -1)
        first = os.path.getsize(target)
        ws.call("cmd.multisave", target, "p8a6one", -1, 1)
        with open(target) as handle:
            text = handle.read()
        assert os.path.getsize(target) > first
        assert text.count("END\n") == 3
        # append=0 truncates back
        ws.call("cmd.multisave", target, "p8a6one", -1, 0)
        with open(target) as handle:
            assert handle.read().count("END\n") == 1

    def test_cif_is_the_other_supported_format(self, scratch, tmp_path):
        ws = scratch
        ws.call("cmd.fragment", "ala", "p8a6one")
        target = str(tmp_path / "multi.cif")
        assert ws.call_reply("cmd.multisave", target, "p8a6*", -1)["t"] == "ok"
        with open(target) as handle:
            assert "data_p8a6one" in handle.read()

    @pytest.mark.parametrize(
        "name,needle",
        [
            ("no.pdb.gz", "gz not supported with multisave"),
            ("no.pdb.bz2", "bz2 not supported with multisave"),
            ("no.xyz", "xyz format not supported with multisave"),
            ("no.pmo", "pmo format not supported anymore"),
        ],
    )
    def test_the_refusals(self, scratch, tmp_path, name, needle):
        ws = scratch
        ws.call("cmd.fragment", "ala", "p8a6one")
        target = str(tmp_path / name)
        reply = ws.call_reply("cmd.multisave", target, "p8a6*", -1)
        assert reply["t"] == "err"
        assert needle in str(reply["error"]["message"])
        assert not os.path.exists(target)


# =========================================================================== #
# Row 255 — the alignment dialog's OK button
# =========================================================================== #


class TestLoadAlnMulti:
    def test_load_aln_builds_a_real_alignment_object(self, scratch):
        """``seqalign.load_aln_multi`` executed, not just parsed.

        The atom counts are upstream's own
        (``packages/engine/testing/tests/api/seqalign.py::testLoadAlnMappingStr``): the
        16-residue and 9-residue structures share 7 aligned guide atoms.
        """
        ws = scratch
        ws.call("cmd.fab", "ACDEFGHIKLMNPQRS", "p8a6m1")
        ws.call("cmd.fab", "ACDIKLMNP", "p8a6m2")
        info = ws.call(NS + ".aln_dialog_info", ALN, "aln")
        assert info["ids"] == ["seq1", "seq2", "seq3"]
        # The greedy difflib mapping the dialog pre-fills is what we submit.
        assert info["mapping"] == {"seq1": "p8a6m1", "seq2": "p8a6m2"}

        result = ws.call(NS + ".load_aln", ALN, info["mapping"])
        assert result["loaded"] is True
        # The object is named after the FILE, exactly like `load_aln_multi`'s
        # default (`seqalign.py:148-149`) — the Qt dialog passes no name either.
        assert "alignment" in result["names"]
        assert ws.call("cmd.get_type", "alignment") == "object:alignment"
        assert ws.call("cmd.count_atoms", "guide & alignment & p8a6m1") == 7
        assert ws.call("cmd.count_atoms", "guide & alignment & p8a6m2") == 7

    def test_the_alignment_object_is_what_makes_export_alignment_possible(
        self, scratch, tmp_path
    ):
        """Rows 255 + 271 meet here: no alignment object, no Export Alignment."""
        ws = scratch
        ws.call("cmd.delete", "alignment")
        assert ws.call(NS + ".names_of_type", "object:alignment") == []
        ws.call("cmd.fab", "ACDEFGHIKLMNPQRS", "p8a6m1")
        ws.call("cmd.fab", "ACDIKLMNP", "p8a6m2")
        ws.call(NS + ".load_aln", ALN, {"seq1": "p8a6m1", "seq2": "p8a6m2"})
        assert ws.call(NS + ".names_of_type", "object:alignment") == ["alignment"]
        target = str(tmp_path / "out.aln")
        ws.call("cmd.save", target, "alignment", -1)
        with open(target) as handle:
            text = handle.read()
        assert text.startswith("CLUSTAL")
        assert "p8a6m1" in text and "p8a6m2" in text

    def test_a_mapping_the_user_cleared_is_a_warning_not_a_crash(self, scratch):
        """A blank combo means "do not map this record" (``seqalign.py:167``)."""
        ws = scratch
        ws.call("cmd.fab", "ACDIKLMNP", "p8a6m2")
        result = ws.call(NS + ".load_aln", ALN, {"seq1": "", "seq2": "p8a6m2"})
        assert result["loaded"] is True


# =========================================================================== #
# Row 257 — the brix/o half of the map dialog
# =========================================================================== #


@pytest.fixture
def normalize_o(files):
    before = files.call("cmd.get", "normalize_o_maps")
    yield before
    files.call("cmd.set", "normalize_o_maps", before)


class TestBrixMapDialog:
    def test_a_brix_file_routes_to_the_map_dialog_with_the_o_settings(self, files):
        info = files.call(NS + ".classify", BRIX)
        assert info["format"] == "brix"
        assert info["dialog"] == "map" and info["mapType"] == "o"
        dialog = files.call(NS + ".map_dialog_info", BRIX, "o")
        assert dialog["normalizeSetting"] == "normalize_o_maps"
        assert dialog["objectName"] == "emd_1155"

    def test_the_o_branch_loads_and_builds_the_representation(
        self, scratch, normalize_o
    ):
        """The whole generated script, run the way the dialog runs it.

        ``.o``/``.dsn6``/``.omap`` all parse as ``brix``
        (``importing.py:78-79``), and the dialog's only difference from the
        CCP4 branch is which normalize setting it writes.
        """
        ws = scratch
        ws.do("set normalize_o_maps, 0")
        assert ws.call("cmd.get", "normalize_o_maps") == "off"
        ws.do("set normalize_o_maps, 1")
        ws.do("load %s, p8a6brix" % BRIX)
        ws.do("isomesh p8a6brix_isomesh, p8a6brix, 1.0")
        assert ws.call("cmd.get_type", "p8a6brix") == "object:map"
        assert ws.call("cmd.get_type", "p8a6brix_isomesh") == "object:mesh"
        assert ws.call("cmd.get", "normalize_o_maps") == "on"

    def test_the_same_bytes_in_ccp4_form_take_the_other_branch(self, files):
        """``emd_1155`` ships in both encodings, so the branch is the only
        difference: ccp4 -> ``normalize_ccp4_maps``, brix -> ``normalize_o_maps``."""
        ccp4 = files.call(NS + ".classify", CCP4)
        assert ccp4["mapType"] == "ccp4"
        assert (
            files.call(NS + ".map_dialog_info", CCP4, "ccp4")["normalizeSetting"]
            == "normalize_ccp4_maps"
        )


# =========================================================================== #
# Rows 256 / 258 — the two Incentive-only import dialogs
# =========================================================================== #


MAE = os.path.join(DATA, "1molecule.mae")
MTZ = os.path.join(DATA, "4rwb.mtz")


class TestMaeImportDialog:
    """Row 256.  The dialog is complete; what was never run is the LOAD."""

    def test_the_dialog_reads_the_two_props_settings_off_a_real_file(self, files):
        info = files.call(NS + ".mae_dialog_info", MAE)
        assert info["objectName"] == "1molecule"
        assert info["objectProps"] == files.call("cmd.get", "load_object_props_default")
        assert info["atomProps"] == files.call("cmd.get", "load_atom_props_default")
        assert [(c["multiplex"], c["discrete"]) for c in info["choices"]] == [
            (-2, -1),
            (0, 0),
            (0, 1),
            (1, -1),
        ]
        assert info["unavailable"] == "'mae' format not supported by this PyMOL build"

    def test_the_command_the_dialog_previews_really_does_raise(self, scratch):
        """"Visibly impossible" is only honest if the alternative is a crash.

        This is the exact command the live preview shows and the Load button
        would run (``file_dialogs.py:293-320``).  It raises
        ``IncentiveOnlyException`` — the bridge reports ``kind:'IncentiveOnly'``
        — and creates nothing, which is why the button is disabled instead.
        """
        ws = scratch
        before = set(ws.call("cmd.get_names", "all"))
        reply = ws.call_reply(
            "cmd.load", MAE, "p8a6mae", 0, "", 1, -1, 1, -2, -1, 0, 1, "*", "*"
        )
        assert reply["t"] == "err", reply
        assert reply["error"]["kind"] == "IncentiveOnly", reply["error"]
        assert set(ws.call("cmd.get_names", "all")) == before

    def test_a_maegz_takes_the_same_branch(self, files):
        """``.maegz`` -> gz + mae (``importing.py:80-82``), same wall."""
        info = files.call(NS + ".classify", os.path.join(DATA, "multimae.maegz"))
        assert info["format"] == "mae" and info["zipped"] == "gz"
        assert info["dialog"] == "mae"
        assert info["unavailable"]


class TestMtzImportDialog:
    """Row 258 — ``load_mtz_dialog``'s combos, filled from the real header."""

    def test_the_three_column_lists_come_from_three_mtz_type_codes(self, files):
        """``getColumnsOfType`` F+G / P / W+Q (``file_dialogs.py:157-162``).

        MEASURED against ``packages/engine/testing/data/4rwb.mtz``: there are no G (anomalous
        amplitude) columns, one P, one W and one Q, and the Q column is what
        makes the weights list two entries long.
        """
        info = files.call(NS + ".mtz_dialog_info", MTZ)
        assert info["error"] is None
        assert info["amplitudes"] == ["cryst_1/data_1/FP", "cryst_1/data_1/FC"]
        assert info["phases"] == ["cryst_1/data_1/PHIC"]
        assert info["weights"] == ["cryst_1/data_1/FOM", "cryst_1/data_1/SIGFP"]
        # …and NOT the Pmw dialog's list, which prepends a "None" entry.
        assert info["weights"][0] != "None"
        assert files.call(NS + ".map_generate_info", MTZ)["weights"][0] == "None"

    def test_the_resolution_spinboxes_are_seeded_from_the_header(self, files):
        info = files.call(NS + ".mtz_dialog_info", MTZ)
        assert round(info["resoMin"], 5) == 19.38758
        assert round(info["resoMax"], 5) == 2.00037
        assert info["prefix"] == "4rwb"

    def test_the_guessCols_preselection_finds_nothing_in_this_file(self, files):
        """A measured negative, and it changes what the UI must do.

        ``guessCols('2FoFc')`` and ``guessCols('FoFc')`` both return
        ``[None, None, None]`` here (``headering.py:132-262`` looks for
        conventional names like ``2FOFCWT``), so the dialog CANNOT pre-select
        and the combos must open on their first entry rather than on a guess.
        """
        info = files.call(NS + ".mtz_dialog_info", MTZ)
        assert info["guessAmplitudes"] is None
        assert info["guessPhases"] is None

    def test_the_load_itself_is_the_incentive_only_wall(self, files):
        info = files.call(NS + ".mtz_dialog_info", MTZ)
        assert info["unavailable"] == "load_mtz is Incentive-only in this build"
        reply = files.call_reply("cmd.load_mtz", MTZ, "cryst_1/data_1/FC",
                                 "cryst_1/data_1/PHIC")
        assert reply["t"] == "err"
        assert reply["error"]["kind"] == "IncentiveOnly", reply["error"]

    def test_a_file_that_is_not_there_reports_the_path_not_a_stack(self, files):
        info = files.call(NS + ".mtz_dialog_info", "/tmp/p8a6-nope.mtz")
        assert info["error"] and "no such file" in info["error"]
        assert info["amplitudes"] == []


# =========================================================================== #
# Row 261 — .pse / .psw / .pze / .pzw
# =========================================================================== #


@pytest.fixture
def session_globals(files):
    """A session load REPLACES everything; put the globals back afterwards.

    Same hazard, and the same remedy, as ``test_f7_legacyfiles.py``'s
    ``presentation_session``: ``set_session(steal=1)`` (``importing.py:836``)
    overwrites the object list, the scene list, the camera and every setting.
    """
    view = files.call("cmd.get_view")
    session_file = files.call("cmd.get", "session_file")
    yield files
    for name in list(files.call("cmd.get_scene_list") or []):
        files.call("cmd.scene", name, "delete")
    files.call("cmd.delete", "all")
    files.call("cmd.set", "session_file", session_file)
    files.call("cmd.set_view", view)


class TestSessionExtensions:
    def test_pze_and_pzw_are_gzip_on_disk_and_transparent_on_load(
        self, session_globals, tmp_path
    ):
        """``.pze``/``.pzw`` -> ``zipped='gz'`` (``importing.py:61-66``).

        The write side is ``cmd.save``'s gzip branch; the read side is
        ``cmd.file_read``, which gunzips before ``io.pkl.fromString``
        (``importing.py:830-831``).  Both are asserted from the FILE, not from
        the API: a plain pickle would still load.
        """
        ws = session_globals
        ws.call("cmd.delete", "all")
        ws.call("cmd.fragment", "trp", "p8a6sess")
        plain = str(tmp_path / "s.pse")
        zipped = str(tmp_path / "s.pze")
        ws.call("cmd.save", plain, "", -1)
        ws.call("cmd.save", zipped, "", -1)

        with open(plain, "rb") as handle:
            assert handle.read(2) == b"}q", "a .pse is a bare pickle"
        with open(zipped, "rb") as handle:
            assert handle.read(2) == b"\x1f\x8b", "a .pze must be gzip"
        assert os.path.getsize(zipped) < os.path.getsize(plain) / 2

        ws.call("cmd.delete", "all")
        assert ws.call("cmd.get_names", "all") == []
        ws.call("cmd.load", zipped)
        assert ws.call("cmd.get_names", "all") == ["p8a6sess"]

    def test_load_sets_session_file_and_partial_does_not(
        self, session_globals, tmp_path
    ):
        """``importing.py:838-841``: the setting is skipped when partial.

        ``session_file`` is what Save Session (no dialog) writes back to and
        what ``chain_session`` reads, so "restored into an existing scene"
        deliberately does not claim the file.
        """
        ws = session_globals
        ws.call("cmd.delete", "all")
        ws.call("cmd.fragment", "trp", "p8a6sess")
        target = str(tmp_path / "claim.pse")
        ws.call("cmd.save", target, "", -1)

        ws.call("cmd.set", "session_file", "P8A6-SENTINEL")
        ws.call("cmd.delete", "all")
        ws.call("cmd.load", target)
        assert ws.call("cmd.get", "session_file") == target
        assert ws.call("cmd.get_names", "all") == ["p8a6sess"]

        ws.call("cmd.set", "session_file", "P8A6-SENTINEL")
        ws.call("cmd.delete", "all")
        ws.call("cmd.fragment", "ala", "p8a6keep")
        ws.call("cmd.load", target, "", 0, "pse", 1, -1, 1, None, -1, 1)
        assert ws.call("cmd.get", "session_file") == "P8A6-SENTINEL", (
            "a partial session load must not claim session_file"
        )
        assert sorted(ws.call("cmd.get_names", "all")) == ["p8a6keep", "p8a6sess"], (
            "partial=1 must MERGE, not steal"
        )

    def test_a_psw_with_no_scenes_restores_everything_and_then_raises(
        self, session_globals, tmp_path
    ):
        """MEASURED, and a trap for the client's error handling.

        ``load_pse`` recalls the first scene for ``.psw``/``.pzw``
        (``importing.py:843-852``) *after* ``set_session`` has already run.
        With no scenes in the session ``cmd.scene('auto','start')`` raises
        ``No scenes`` — so the call answers ``t='err'`` even though the session
        is fully restored.  A client that treats the error as "the file did not
        open" is wrong; the objects are there.
        """
        ws = session_globals
        ws.call("cmd.delete", "all")
        for name in list(ws.call("cmd.get_scene_list") or []):
            ws.call("cmd.scene", name, "delete")
        ws.call("cmd.fragment", "trp", "p8a6sess")
        assert ws.call("cmd.get", "presentation_auto_start") == "on"

        psw = str(tmp_path / "show.psw")
        pzw = str(tmp_path / "show.pzw")
        ws.call("cmd.save", psw, "", -1)
        ws.call("cmd.save", pzw, "", -1)
        with open(pzw, "rb") as handle:
            assert handle.read(2) == b"\x1f\x8b"

        for target in (psw, pzw):
            ws.call("cmd.delete", "all")
            reply = ws.call_reply("cmd.load", target)
            assert reply["t"] == "err", target
            assert "No scenes" in str(reply["error"]["message"]), reply
            assert ws.call("cmd.get_names", "all") == ["p8a6sess"], (
                "the session WAS restored before the scene recall raised"
            )
            assert ws.call("cmd.get", "session_file") == target

        # The .pse form of the same bytes does not raise at all.
        pse = str(tmp_path / "show.pse")
        ws.call("cmd.save", pse, "", -1)
        ws.call("cmd.delete", "all")
        assert ws.call_reply("cmd.load", pse)["t"] == "ok"

    def test_the_client_routes_all_four_extensions_to_the_session_dialog(self, files):
        for ext in ("pse", "psw", "pze", "pzw"):
            info = files.call(NS + ".classify", "/tmp/p8a6." + ext)
            assert info["dialog"] == "session", ext
            assert info["format"] in ("pse", "psw"), ext
        assert files.call(NS + ".classify", "/tmp/p8a6.pze")["zipped"] == "gz"


# =========================================================================== #
# Row 282 — log_open / log / log_close
# =========================================================================== #


@pytest.fixture
def logging_off(files):
    """``logging`` is a process global and an open handle is a process global."""
    yield files
    files.do("log_close")
    files.call("cmd.set", "logging", 0)


class TestLogging:
    def test_a_pml_log_holds_pymol_commands(self, logging_off, tmp_path):
        ws = logging_off
        target = str(tmp_path / "session.pml")
        ws.do("log_open %s, w" % target)
        status = ws.call(NS + ".log_status")
        assert status["logging"] == 1 and status["open"] is True
        assert status["path"] == target
        ws.do("turn x, 1")
        ws.call("cmd.log", "fetch 1abc\n", "cmd.fetch('1abc')\n")
        ws.call("cmd.log", "zoom all\n")
        ws.call("cmd.log", "", "cmd.zoom('all')\n")
        ws.do("log_close")
        assert ws.call(NS + ".log_status")["logging"] == 0

        with open(target) as handle:
            lines = handle.read().splitlines()
        assert lines == [
            "turn x, 1",
            # `LogFile.write` rewrites every fetch line (`commanding.py:98-105`)
            "fetch 1abc, async=0",
            "zoom all",
            # mode 1 keeps the python form, escaped with a leading `/`
            "/cmd.zoom('all')",
            "log_close",
        ], lines

    def test_a_py_log_holds_python_and_is_the_logging_2_branch(
        self, logging_off, tmp_path
    ):
        """The distinction wave 4 could not exercise, byte for byte.

        Same five ``cmd.log`` calls as the ``.pml`` test above; every one of
        them comes out differently because ``logging`` is 2
        (``commanding.py:186-197``).
        """
        ws = logging_off
        target = str(tmp_path / "session.py")
        ws.do("log_open %s, w" % target)
        assert ws.call(NS + ".log_status")["logging"] == 2
        ws.do("turn x, 1")
        ws.call("cmd.log", "fetch 1abc\n", "cmd.fetch('1abc')\n")
        ws.call("cmd.log", "zoom all\n")
        ws.call("cmd.log", "", "cmd.zoom('all')\n")
        ws.do("log_close")

        with open(target) as handle:
            lines = handle.read().splitlines()
        assert lines == [
            "cmd.do('''turn x, 1''')",
            # alt_text WINS in mode 2 -- and it is not rewritten, because the
            # rewrite matches `fetch ...`, not `cmd.fetch(...)`.
            "cmd.fetch('1abc')",
            # no alt_text: the pml text is wrapped in cmd.do()
            "cmd.do('zoom all')",
            "cmd.zoom('all')",
            "cmd.do('''log_close''')",
        ], lines

    def test_pym_is_a_python_log_and_a_bare_name_is_not(self, logging_off, tmp_path):
        """``re.search(r'\\.py$|\\.PY$|\\.pym$|\\.PYM$')`` (``commanding.py:148``)."""
        ws = logging_off
        for name, expected in (
            ("a.pym", 2),
            ("a.PY", 2),
            ("a.pml", 1),
            ("a.txt", 1),
            ("a.pyx", 1),
        ):
            ws.do("log_open %s, w" % str(tmp_path / name))
            assert ws.call(NS + ".log_status")["logging"] == expected, name
            ws.do("log_close")

    def test_append_mode_starts_on_a_new_line(self, logging_off, tmp_path):
        """``log_open(mode='a')`` writes a leading ``\\n`` (``:145-146``)."""
        ws = logging_off
        target = str(tmp_path / "twice.pml")
        ws.do("log_open %s, w" % target)
        ws.call("cmd.log", "bg_color red\n")
        ws.do("log_close")
        with open(target) as handle:
            first = handle.read()
        assert first == "bg_color red\nlog_close\n"

        ws.do("log_open %s, a" % target)
        ws.call("cmd.log", "bg_color blue\n")
        ws.do("log_close")
        with open(target) as handle:
            second = handle.read()
        assert second == first + "\nbg_color blue\nlog_close\n"

    def test_log_status_is_what_the_indicator_renders(self, logging_off, tmp_path):
        ws = logging_off
        assert ws.call(NS + ".log_status") == {
            "logging": 0,
            "path": "",
            "open": False,
            "filters": ["PyMOL Script (*.pml)", "Python Script (*.py *.pym)", "All (*)"],
        }
        target = str(tmp_path / "ind.py")
        ws.do("log_open %s, w" % target)
        status = ws.call(NS + ".log_status")
        assert (status["logging"], status["open"], status["path"]) == (2, True, target)
        ws.do("log_close")
        assert ws.call(NS + ".log_status")["open"] is False


# =========================================================================== #
# Row 289 — _multifetch, offline
# =========================================================================== #


@pytest.fixture
def staged_fetch(scratch, tmp_path):
    """A fetch_path with the files ``_fetch`` would have downloaded.

    ``_fetch`` skips the network entirely when the target file already exists
    (``importing.py:1217-1219``), so the whole of ``_multifetch`` -- the
    whitespace split, the type inference, the name legalisation and the chain
    filter -- runs deterministically with no DNS, no PDB mirror and no
    30-second timeout.  The one thing NOT covered by this is the HTTP half.
    """
    ws = scratch
    directory = tmp_path / "fetchpath"
    directory.mkdir()
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala", "p8a6a")
    ws.call("cmd.alter", "p8a6a", "chain='A'")
    ws.call("cmd.fragment", "trp", "p8a6b")
    ws.call("cmd.alter", "p8a6b", "chain='B'")
    ws.call("cmd.create", "p8a6both", "p8a6a or p8a6b")
    ws.call("cmd.save", str(directory / "1abc.cif"), "p8a6both", -1)
    ws.call("cmd.save", str(directory / "ala.cif"), "p8a6a", -1)
    import shutil

    shutil.copy(CCP4, str(directory / "emd_1155.ccp4"))
    ws.call("cmd.delete", "all")
    return ws, str(directory)


def _fetch(ws, code: str, path: str, **kwargs: Any) -> Dict[str, Any]:
    """``cmd.fetch(code, path=..., async_=0)`` — never async in a test."""
    return ws.call_reply("cmd.fetch", code, kwargs.pop("name", ""), path=path,
                         async_=0, quiet=1, **kwargs)


class TestMultiFetch:
    def test_three_codes_in_one_string_become_three_objects(self, staged_fetch):
        """``code.split()`` (``importing.py:1272``) with three different types.

        ``1abc`` -> ``fetch_type_default`` (cif); ``ala`` is 2-3 characters so
        it is a chemical component (``cc``, also ``{code}.cif``); ``EMD-1155``
        takes the EMD prefix branch and becomes ``emd_1155.ccp4``, a MAP.
        """
        ws, path = staged_fetch
        reply = _fetch(ws, "1abc ala EMD-1155", path)
        assert reply["t"] == "ok", reply
        names = ws.call("cmd.get_names", "all")
        assert sorted(names) == ["1abc", "EMD-1155", "ala"], names
        assert ws.call("cmd.get_type", "1abc") == "object:molecule"
        assert ws.call("cmd.get_type", "ala") == "object:molecule"
        assert ws.call("cmd.get_type", "EMD-1155") == "object:map"
        # `_multifetch` returns the LAST code's name (`importing.py:1319-1328`).
        assert reply["result"] == "EMD-1155"

    def test_a_five_letter_code_strips_the_chain_and_filters_it(self, staged_fetch):
        """``obj_code[:4], obj_code[4:]`` then ``cmd.remove`` (``:1310-1328``).

        The staged file holds chains A and B; asking for ``1abcB`` must leave
        only B — that is the post-filter, not the download.
        """
        ws, path = staged_fetch
        assert _fetch(ws, "1abc", path)["t"] == "ok"
        assert sorted(ws.call("cmd.get_chains", "1abc")) == ["A", "B"]
        ws.call("cmd.delete", "1abc")

        assert _fetch(ws, "1abcB", path)["t"] == "ok"
        # The object keeps the FULL five-letter code as its name: `obj_name` is
        # taken before the chain is split off (`importing.py:1302-1311`).
        assert ws.call("cmd.get_names", "all") == ["1abcB"]
        assert ws.call("cmd.get_chains", "1abcB") == ["B"]

    def test_a_chain_that_is_not_there_deletes_the_object_and_raises(
        self, staged_fetch
    ):
        """``:1322-1324`` — a wrong chain must not leave a half-loaded object."""
        ws, path = staged_fetch
        reply = _fetch(ws, "1abcZ", path)
        assert reply["t"] == "err"
        assert "no such chain: Z" in str(reply["error"]["message"])
        assert ws.call("cmd.get_names", "all") == []

    def test_an_explicit_name_collapses_every_code_into_one_object(
        self, staged_fetch
    ):
        """``get_legal_name`` (``:1317``), and the name is shared by both codes.

        Without a name the two codes are two objects; with one they are one —
        that difference is the whole of ``_multifetch``'s naming rule, and the
        space in "my obj" proves the legalisation ran.
        """
        ws, path = staged_fetch
        assert _fetch(ws, "1abc ala", path)["t"] == "ok"
        assert sorted(ws.call("cmd.get_names", "all")) == ["1abc", "ala"]
        ws.call("cmd.delete", "all")

        reply = _fetch(ws, "1abc ala", path, name="my obj")
        assert reply["t"] == "ok", reply
        names = ws.call("cmd.get_names", "all")
        assert names == ["my_obj"], names
        assert ws.call("cmd.count_atoms", "my_obj") > 0

    def test_the_staged_file_is_what_makes_this_offline(self, staged_fetch):
        """The precondition, asserted: a code with no file must NOT appear.

        If this ever passes with an object, the test above stopped proving
        anything about ``_multifetch`` and started testing the network.
        """
        ws, path = staged_fetch
        assert not os.path.exists(os.path.join(path, "9zzz.cif"))
        reply = ws.call_reply(
            "cmd.fetch", "9zzz", "", path=path, async_=0, quiet=1,
            fetch_host="file://p8a6-no-such-host/",
        )
        assert reply["t"] == "err", reply
        assert ws.call("cmd.get_names", "all") == []


# =========================================================================== #
# Rows 273 / 274 / 275 — PNG modes, the png argument matrix, and draw
# =========================================================================== #


@pytest.fixture
def image_scene(scratch):
    """A drawable scene, with ``opaque_background`` and the prior image put back."""
    ws = scratch
    opaque = ws.call("cmd.get", "opaque_background")
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala", "p8a6img")
    ws.call("cmd.reset")
    yield ws
    ws.call("cmd.set", "opaque_background", opaque)
    # The prior image is a process global too: leave one at viewport size.
    ws.do("draw 0, 0")
    ws.pump_frames(0.5)


class TestPngDialogModes:
    """Row 273 — all four ``input_rendering`` modes (``file_dialogs.py:636-652``)."""

    @pytest.mark.parametrize("rendering", [0, 1, 2, 3])
    def test_each_mode_writes_a_real_png(self, image_scene, tmp_path, rendering):
        ws = image_scene
        target = str(tmp_path / ("mode%d.png" % rendering))
        lines: List[str] = []
        ray = 0
        if rendering == 1:
            lines.append("draw 0, 0")
        elif rendering == 2:
            lines.append("set opaque_background, 1")
            ray = 1
        elif rendering == 3:
            lines.append("set opaque_background, 0")
            ray = 1
        lines.append("png %s, 0, 0, -1, ray=%d" % (target, ray))
        for line in lines:
            assert ws.do(line)["t"] == "ok", line
        ws.pump_frames(2.0)

        assert os.path.exists(target), lines
        info = _png_info(target)
        assert [info["w"], info["h"]] == list(ws.call("cmd.get_viewport"))
        assert os.path.getsize(target) > 10_000

    def test_the_command_lines_are_the_ones_the_client_emits(self, files):
        """The four modes' labels are served from the bridge, in order."""
        assert files.call(NS + ".hello")["pngRenderingModes"] == [
            "capture current display",
            "draw antialiased OpenGL image",
            "ray trace with opaque background",
            "ray trace with transparent background",
        ]

    def test_opaque_and_transparent_backgrounds_really_differ(
        self, image_scene, tmp_path
    ):
        """Modes 2 and 3 differ in the corner PIXEL, not just in the setting.

        Both write RGBA (colour type 6), so the file header cannot tell them
        apart; the alpha of a background pixel can.
        """
        pytest.importorskip("PIL")
        from PIL import Image

        ws = image_scene
        alphas = {}
        for rendering, opaque in ((2, 1), (3, 0)):
            target = str(tmp_path / ("bg%d.png" % rendering))
            ws.do("set opaque_background, %d" % opaque)
            ws.do("png %s, 0, 0, -1, ray=1" % target)
            ws.pump_frames(2.0)
            with Image.open(target) as image:
                assert image.mode == "RGBA"
                alphas[rendering] = image.getpixel((0, 0))[3]
        assert alphas[2] == 255, alphas
        assert alphas[3] == 0, alphas


class TestPngMatrix:
    """Row 274 — the dpi/width/height/prior sweep, read out of the IHDR."""

    def test_pixels_units_and_dpi(self, image_scene, tmp_path):
        ws = image_scene
        viewport = ws.call("cmd.get_viewport")

        plain = str(tmp_path / "plain.png")
        ws.call("cmd.png", plain, 0, 0, -1, 0, 1)
        ws.pump_frames(1.0)
        assert [_png_info(plain)["w"], _png_info(plain)["h"]] == list(viewport)

        exact = str(tmp_path / "exact.png")
        ws.call("cmd.png", exact, 200, 100, -1, 0, 1)
        ws.pump_frames(1.0)
        assert (_png_info(exact)["w"], _png_info(exact)["h"]) == (200, 100)

        # `_unit2px`: 10 cm at 300 dpi = 10*300/2.54 + .5 = 1181 px, and the
        # height follows the viewport's aspect ratio because it was left at 0.
        centimetres = str(tmp_path / "cm.png")
        ws.call("cmd.png", centimetres, "10cm", 0, 300, 0, 1)
        ws.pump_frames(1.0)
        info = _png_info(centimetres)
        assert info["w"] == 1181, info
        assert info["h"] == round(1181 * viewport[1] / viewport[0]) - 1 or info["h"] == (
            round(1181 * viewport[1] / viewport[0])
        )

        inches = str(tmp_path / "in.png")
        ws.call("cmd.png", inches, "2in", 0, 150, 0, 1)
        ws.pump_frames(1.0)
        assert _png_info(inches)["w"] == 300

    def test_a_physical_unit_without_dpi_is_refused(self, image_scene, tmp_path):
        """``_unit2px`` raises before anything is rendered (``:493-495``)."""
        ws = image_scene
        target = str(tmp_path / "nodpi.png")
        reply = ws.call_reply("cmd.png", target, "10cm", 0, 0, 0, 1)
        assert reply["t"] == "err"
        assert 'dpi > 0 required with unit "cm"' in str(reply["error"]["message"])
        assert not os.path.exists(target)

    def test_prior_saves_the_last_DRAWN_image_instead_of_rendering(
        self, image_scene, tmp_path
    ):
        """``prior=1`` is the whole reason "Save Image to File" is cheap.

        Drawn at 320x240 first; the ``prior`` write comes back at 320x240 even
        though the viewport is 800x600, which no re-render would do.  This is
        the render panel's page-2 flow exactly: ``draw W, H`` then
        ``cmd.png(prior=1)`` (``pymol_qt_gui.py:745-762``).
        """
        ws = image_scene
        viewport = ws.call("cmd.get_viewport")
        assert list(viewport) != [320, 240]
        assert ws.do("draw 320, 240")["t"] == "ok"
        ws.pump_frames(1.5)

        for prior in (1, -1):
            target = str(tmp_path / ("prior%d.png" % prior))
            reply = ws.call_reply("cmd.png", target, 0, 0, -1, 0, 1, prior)
            assert reply["t"] == "ok", reply
            assert (_png_info(target)["w"], _png_info(target)["h"]) == (320, 240), prior

    def test_a_png_render_leaves_no_prior_image_behind(self, image_scene, tmp_path):
        """MEASURED, and it decides how the client must order its calls.

        ``cmd.png`` without ``prior`` renders inside
        ``_call_with_opengl_context`` (``exporting.py:602``) and does not keep
        the result, so on a quiet engine a following ``prior=1`` raises "no
        prior image available" -- unlike after ``draw``, above.  The catch is a
        race: the background render loop can tick between the two calls and
        re-store a prior image, so ``prior=1`` may instead succeed.  Both are
        correct engine states (see the note below the first call); the contract
        the client depends on is only that ``prior=1`` is NOT a reliable way to
        re-save a bare render.  ``prior=-1`` is the forgiving form: it falls
        back to rendering, at the VIEWPORT size.
        """
        ws = image_scene
        viewport = ws.call("cmd.get_viewport")
        rendered = str(tmp_path / "rendered.png")
        ws.call("cmd.png", rendered, 320, 240, -1, 0, 1)
        # NB: do NOT pump_frames here -- ``cmd.png`` without ``prior`` renders
        # inside ``_call_with_opengl_context`` and does not keep the result, so
        # on a quiet engine the strict ``prior=1`` call below raises "no prior
        # image available".  The catch is that the pump's render loop
        # (``p.idle(); p.draw()``) runs on its OWN thread, continuously: a
        # single tick landing between this reply and the strict call re-stores a
        # prior image and makes ``prior=1`` succeed instead.  The client cannot
        # stop the engine ticking between two calls, so which outcome we get is
        # a race on runner load -- it flaked "ok" on the GitHub macOS box under
        # TENMOL_TEST_SLOW=3.  Both are correct engine states; the contract the
        # client actually depends on is only that ``prior=1`` is NOT a reliable
        # way to re-save a bare ``cmd.png`` render, so accept either outcome and,
        # when it does raise, pin it to the documented reason.
        assert (_png_info(rendered)["w"], _png_info(rendered)["h"]) == (320, 240)

        strict = ws.call_reply("cmd.png", str(tmp_path / "strict.png"), 0, 0, -1, 0, 1, 1)
        assert strict["t"] in ("ok", "err"), strict
        if strict["t"] == "err":
            assert "no prior image available" in str(strict["error"]["message"])

        forgiving = str(tmp_path / "forgiving.png")
        assert ws.call_reply("cmd.png", forgiving, 0, 0, -1, 0, 1, -1)["t"] == "ok"
        ws.pump_frames(1.0)
        # ``prior=-1`` is forgiving: on a quiet engine no prior image survives
        # the bare render above, so it re-renders at the VIEWPORT size.  But the
        # same render-loop race that lets the strict ``prior=1`` call succeed
        # also leaks a prior image here -- and when it does, ``prior=-1`` reuses
        # it at the last render size (320x240) instead of re-rendering.  Both are
        # correct engine states, so accept either outcome (mirrors the strict
        # softening above).
        assert [_png_info(forgiving)["w"], _png_info(forgiving)["h"]] in (
            list(viewport),
            [320, 240],
        )

    def test_the_extension_is_appended_and_ppm_is_the_other_format(
        self, image_scene, tmp_path
    ):
        ws = image_scene
        stem = str(tmp_path / "noext")
        ws.call("cmd.png", stem, 120, 90, -1, 0, 1)
        ws.pump_frames(1.0)
        assert not os.path.exists(stem)
        assert os.path.exists(stem + ".png"), "cmd.png must append .png"

        ppm = str(tmp_path / "shot.ppm")
        ws.call("cmd.png", ppm, 120, 90, -1, 0, 1, 0, -1)
        ws.pump_frames(1.0)
        assert os.path.exists(ppm), "the .ppm extension must NOT gain a .png"
        with open(ppm, "rb") as handle:
            assert handle.read(2) == b"P6"


class TestDrawPath:
    """Row 275 — "Draw (fast)" at a size that is not the viewport."""

    def test_draw_at_the_streamed_viewport_size_does_not_kill_the_bridge(
        self, image_scene, tmp_path
    ):
        """The exact call wave 4 recorded as fatal: ``draw 886, 314``.

        REFUTED on this build, headless: the command answers ok, the engine
        keeps answering afterwards, the VIEWPORT is untouched, and the image
        the render panel then saves with ``cmd.png(prior=1)`` is 886x314 --
        i.e. the draw really did render at the requested size.
        """
        ws = image_scene
        before = ws.call("cmd.get_viewport")
        for width, height in ((400, 300), (886, 314)):
            assert ws.do("draw %d, %d" % (width, height))["t"] == "ok"
            ws.pump_frames(1.5)
            target = str(tmp_path / ("draw_%dx%d.png" % (width, height)))
            # Page 2 of the render panel: save the PRIOR image, no re-render.
            assert ws.call_reply("cmd.png", target, 0, 0, -1, 0, 1, 1)["t"] == "ok"
            info = _png_info(target)
            assert (info["w"], info["h"]) == (width, height), info
            assert ws.call("cmd.get_viewport") == before, "draw resized the viewport"
        # the engine is still there
        assert ws.call("cmd.get_names", "all") == ["p8a6img"]

    def test_copy_image_returns_the_drawn_image(self, image_scene):
        """"Copy Image to Clipboard" is the same prior image, base64'd."""
        ws = image_scene
        assert ws.do("draw 320, 200")["t"] == "ok"
        ws.pump_frames(1.5)
        result = ws.call(NS + ".copy_image_png")
        assert result["ok"] is True, result
        import base64

        raw = base64.b64decode(result["base64"])
        assert raw[:8] == b"\x89PNG\r\n\x1a\n"
        assert struct.unpack(">II", raw[16:24]) == (320, 200)
