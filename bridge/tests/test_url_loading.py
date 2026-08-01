"""Parity area 6 — URL loading (`cmd.file_read`), and what the client may call.

`modules/pymol/internal.py:279-311` takes a filename, an http(s) URL (with a
`PyMOL/<version>` User-Agent) or an open handle, reads the bytes, and
transparently gunzips (`0x1f8b`) or bunzips (`BZ...1AY&SY`) by magic bytes.

The inventory row's point is the client-facing consequence: a URL can be handed
straight to `cmd.load`, making it the ONE load path that needs no filesystem
and no upload. That is what the window drop handler relies on for `text/uri-list`
payloads (`features/files/globalDrop.ts`).

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_url_loading.py -q
"""

from __future__ import annotations

import gzip
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

ATOM = "ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N\n"
URL = "https://files.rcsb.org/download/1RX1.pdb"


def test_file_read_returns_BYTES_and_so_is_not_a_client_call(ws: WSClient, tmp_path) -> None:
    """Worth pinning: the obvious call is the wrong one.

    `file_read` hands back raw bytes, which JSON cannot carry. It answers
    NotSerializable rather than hanging — see
    `test_session.py::test_a_bytes_return_errors_instead_of_hanging_the_connection`,
    which is the fix that made this a usable error at all. The client passes the
    URL to `cmd.load` instead and never sees the bytes.
    """
    path = tmp_path / "x.pdb"
    path.write_text(ATOM)
    reply = ws.call_reply("cmd.file_read", str(path))
    assert reply["t"] == "err", reply
    assert reply["error"]["kind"] == "NotSerializable", reply


def test_a_missing_file_raises_the_documented_CmdException(ws: WSClient) -> None:
    reply = ws.call_reply("cmd.file_read", "/no/such/file.pdb")
    assert reply["t"] == "err"
    assert 'failed to open file "/no/such/file.pdb"' in reply["error"]["message"]


def test_gzip_is_transparent_to_load(ws: WSClient, tmp_path) -> None:
    """The magic-byte gunzip, observed through the only door the client has.

    `file_read` itself cannot be called from here (bytes), so this asserts the
    behaviour where it actually matters: a `.gz` loads to the same atom count
    as the plain file.
    """
    plain = tmp_path / "plain.pdb"
    plain.write_text(ATOM * 3)
    zipped = tmp_path / "zipped.pdb.gz"
    zipped.write_bytes(gzip.compress(plain.read_bytes()))

    try:
        ws.call("cmd.load", str(plain), "ul_plain")
        ws.call("cmd.load", str(zipped), "ul_gz")
        assert ws.call("cmd.count_atoms", "ul_plain") == 3
        assert ws.call("cmd.count_atoms", "ul_gz") == 3
    finally:
        ws.call("cmd.delete", "ul_plain")
        ws.call("cmd.delete", "ul_gz")


def test_a_url_loads_with_no_filesystem_and_no_upload(ws: WSClient) -> None:
    """The claim the window drop handler is built on.

    NETWORK TEST, and marked as one: it is skipped rather than failed when the
    host cannot reach RCSB, because a red suite on a train is worse than an
    unasserted line. When it does run it is the real thing — no fixture, no
    local copy.
    """
    reply = ws.call_reply("cmd.load", URL, "ul_url")
    if reply["t"] != "ok":
        pytest.skip("no network to RCSB: %s" % reply["error"]["message"][:80])
    try:
        assert "ul_url" in ws.call("cmd.get_names", "all")
        assert ws.call("cmd.count_atoms", "ul_url") > 100
    finally:
        ws.call("cmd.delete", "ul_url")


def test_the_url_keeps_its_own_object_name_rules(ws: WSClient) -> None:
    """A URL drop shows a name before it loads, so the two must agree."""
    ws.do("import tenmol_bridge.panels.files as _tf; _tf.install()")
    info = ws.call("cmd.tenmol_files.classify", URL)
    assert info["isUrl"] is True
    assert info["format"] == "pdb"
    assert info["objectName"] == "1RX1", info
    # And it is NOT routed to a modal, so the drop handler loads it directly.
    assert info["dialog"] == "plain"
