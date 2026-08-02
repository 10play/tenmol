"""Parity area 3 — what a PSE does and does not carry.

Two rows, and the first is the load-bearing one for the whole Mode G design:
a session stores rep FLAGS, never rep GEOMETRY. If that were false, a session
would be a ready-made geometry source and the client could just read it.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_session_geometry.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")


def session_size(ws: WSClient, rep: str, path: str) -> int:
    """A PSE of il2.pdb showing exactly one rep, built from a fresh scene."""
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "zg_sess")
    ws.call("cmd.hide", "everything")
    ws.call("cmd.show", rep, "zg_sess")
    ws.call("cmd.rebuild")
    ws.call("cmd.save", path)
    return os.path.getsize(path)


def test_a_session_carries_NO_rep_geometry(ws: WSClient, tmp_path) -> None:
    """Measured by SIZE, which is the observation the claim actually predicts.

    `CoordSetAsPyList` writes coordinates, indices, settings and symmetry, and
    no `Rep[]` anywhere. If that is true, then switching between reps whose
    geometry differs enormously must barely move the file size at all.

    Measured on il2.pdb (2,084 atoms):

        lines     586,417 bytes
        surface   586,432
        spheres   586,432
        cartoon   586,432

    A 15-byte spread. For comparison, the same reps exported as actual geometry
    (`test_geometry_exports.py`) differ by two orders of magnitude — surface is
    108 KB of OBJ where sticks is 0, and 267 KB of POV-Ray where sticks is 9.7
    KB. So the surface really is absent from the session, not merely compressed.

    This is why the client cannot shortcut Mode G by reading a PSE.
    """
    sizes = {
        rep: session_size(ws, rep, str(tmp_path / ("s_%s.pse" % rep)))
        for rep in ("lines", "surface", "spheres", "cartoon")
    }
    spread = max(sizes.values()) - min(sizes.values())
    assert spread < 1024, sizes
    # And the file is not trivially small — the coordinates ARE in there.
    assert min(sizes.values()) > 100_000, sizes


def test_the_reps_still_come_back_because_the_FLAGS_are_stored(ws, tmp_path):
    """The flip side, so the row above cannot be misread as "sessions lose reps".

    The geometry is absent and rebuilt on load; what persists is which reps
    were enabled.
    """
    path = str(tmp_path / "flags.pse")
    session_size(ws, "surface", path)
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", path)

    vis = ws.call("cmd.get_vis")["zg_sess"]
    # `get_vis` is [enabled, ?, [enabled rep indices], ?] — NOT a list of
    # booleans, which is what an earlier version of this assertion assumed.
    # `cRepSurface` is index 2 (`packages/engine/layer1/Rep.h`); its presence means the FLAG
    # rode along in the session even though its triangles did not.
    assert 2 in vis[2], vis


def test_a_CGO_object_DOES_survive_a_session(ws: WSClient, tmp_path) -> None:
    """`CGOAsPyList` / `CGONewFromPyList`, exercised the only way a client can.

    There is no `cmd.get_cgo` — measured, the symbol does not exist — so the
    round trip is not directly callable. It is reachable through a session,
    because ObjectCGO is one of the two object types that carry a CGO into a
    PSE, and that is what this asserts: the object comes back with its type.

    Note the contrast with the test above. A CGO's geometry IS its content, so
    it persists; a molecular rep's geometry is derived, so it does not.
    """
    ws.call("cmd.delete", "all")
    ws.do(
        "from pymol.cgo import *; cmd.load_cgo("
        "[BEGIN, LINES, COLOR,1,0,0, VERTEX,0,0,0, VERTEX,1,1,1, END], 'zg_cgo')"
    )
    assert ws.call("cmd.get_type", "zg_cgo") == "object:cgo"

    path = str(tmp_path / "cgo.pse")
    ws.call("cmd.save", path)
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", path)

    assert "zg_cgo" in ws.call("cmd.get_names", "all")
    assert ws.call("cmd.get_type", "zg_cgo") == "object:cgo"


def test_there_is_no_cmd_get_cgo(ws: WSClient) -> None:
    """Pinned, because the row's name suggests a callable API and there is none."""
    assert ws.call_reply("cmd.get_cgo")["t"] == "err"


# =========================================================================== #
# Two hooks that exist and are NOT reachable from a browser.
#
# Both rows ask the same research question — "is this a usable pixel/glyph
# source for the web client" — and the answer for both is no, for different
# reasons. Recorded as tests so the answer is dated and re-checkable rather
# than a paragraph someone has to trust.
# =========================================================================== #


def test_raw_image_callback_exists_but_cannot_be_SET_from_a_client(ws: WSClient):
    """The per-frame RGBA hook is in-process only.

    The attribute resolves — the dispatcher's complaint is that it is "not
    callable", i.e. it holds the documented default of None rather than being
    absent. But arming it means ASSIGNING A PYTHON CALLABLE, and a callable
    cannot cross a WebSocket. It is not a setting either (`cmd.set` answers
    "unknown Setting"), so there is no value-shaped way in.

    That does not make it useless: the BRIDGE runs in-process and could arm it.
    It is simply not something the browser can reach, and the pixel path today
    uses `glReadPixels` instead (`render/framestream.py`), which needs no
    numpy and no callback.
    """
    reply = ws.call_reply("cmd.raw_image_callback")
    assert reply["t"] == "err"
    assert "not callable" in reply["error"]["message"], reply

    setting = ws.call_reply("cmd.set", "raw_image_callback", 1)
    assert setting["t"] == "err"
    assert "unknown Setting" in setting["error"]["message"], setting


@pytest.mark.parametrize(
    "symbol",
    ["cmd.get_character_pixmap", "cmd.character_get_pixmap", "cmd.get_glyph"],
)
def test_label_glyph_bitmaps_are_not_exposed_to_python_at_all(ws, symbol: str):
    """`CharacterGetPixmapBuffer` and the metrics are C-level only.

    No `cmd.*` symbol reaches them under any of the obvious spellings, so a
    client cannot obtain glyph bitmaps or advance widths — label geometry
    cannot be reproduced client-side from this build without new C bindings.
    """
    reply = ws.call_reply(symbol)
    assert reply["t"] == "err"
    assert "no such symbol" in reply["error"]["message"], reply
