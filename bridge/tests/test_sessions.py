"""Parity area 6 — session save/restore, and one hazard the web port inherits.

Covers `cmd.get_session` / PSE serialisation, `cmd.set_session` and the movie
security wizard, and `cmd.chain_session`.

NOTHING HERE TRIGGERS THE QUIT PATH described at the bottom. It asserts the
preconditions instead, deliberately: the whole point of that test is that
taking the branch would end the process this suite is talking to.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_sessions.py -q
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
def scene(ws: WSClient):
    ws.call("cmd.load", IL2, "zs_obj")
    ws.call("cmd.show", "cartoon", "zs_obj")
    yield ws
    for name in ws.call("cmd.get_names", "all"):
        if name.startswith("zs_"):
            ws.call("cmd.delete", name)


# ------------------------------------------------------- get_session / PSE


def test_get_session_is_a_BLOB_and_never_inlined(scene: WSClient) -> None:
    """A session dict is megabytes; the codec routes it to a blob handle.

    `codec.BLOB_RETURNS` exists for exactly this. Asserting the handle SHAPE
    rather than the size, because a build with a small scene would pass a
    size check while still inlining.
    """
    result = scene.call("cmd.get_session")
    assert isinstance(result, dict)
    assert result.get("__blob__") is True, result
    assert result.get("id"), result
    assert result.get("mime", "").startswith("application/"), result


def test_a_session_round_trips_through_a_real_pse(scene: WSClient, tmp_path) -> None:
    path = tmp_path / "zs.pse"
    scene.call("cmd.save", str(path))
    assert path.exists() and path.stat().st_size > 1000

    before = scene.call("cmd.count_atoms", "zs_obj")
    scene.call("cmd.delete", "zs_obj")
    assert "zs_obj" not in scene.call("cmd.get_names", "all")

    scene.call("cmd.load", str(path))
    assert "zs_obj" in scene.call("cmd.get_names", "all")
    assert scene.call("cmd.count_atoms", "zs_obj") == before


def test_loading_a_session_sets_session_file(scene: WSClient, tmp_path) -> None:
    """`session_file` is what `chain_session` reads to find the next one."""
    path = tmp_path / "zs_named.pse"
    scene.call("cmd.save", str(path))
    scene.call("cmd.load", str(path))
    assert scene.call("cmd.get", "session_file") == str(path)


@pytest.mark.parametrize(
    "setting", ["pse_export_version", "pse_binary_dump", "session_cache_optimize"]
)
def test_the_export_knobs_the_row_names_exist(scene: WSClient, setting: str) -> None:
    """Each changes HOW the PSE is written; a missing one would be silent."""
    assert scene.call("cmd.get", setting) is not None


def test_a_backported_pse_still_reloads(scene: WSClient, tmp_path) -> None:
    """`pse_export_version` backports settings and object layouts.

    Asserted by round trip rather than by inspecting the file: the point of
    the setting is that an older PyMOL can read the result, and the nearest
    thing available here is that THIS PyMOL still can.
    """
    original = scene.call("cmd.get", "pse_export_version")
    path = tmp_path / "zs_legacy.pse"
    try:
        scene.call("cmd.set", "pse_export_version", 1.7)
        scene.call("cmd.save", str(path))
        assert path.exists()
        scene.call("cmd.delete", "zs_obj")
        scene.call("cmd.load", str(path))
        assert scene.call("cmd.count_atoms", "zs_obj") > 0
    finally:
        scene.call("cmd.set", "pse_export_version", original)


# --------------------------------------------- set_session / security wizard


def test_a_plain_session_does_not_arm_the_security_wizard(scene: WSClient, tmp_path):
    """`set_session` arms it only when `get_movie_locked() > 0`.

    A session with no embedded movie commands must NOT interrupt the user, so
    the zero case is the one worth pinning — the non-zero case needs a session
    carrying movie python, which nothing here produces.
    """
    path = tmp_path / "zs_plain.pse"
    scene.call("cmd.save", str(path))
    scene.call("cmd.load", str(path))
    assert scene.call("cmd.get_movie_locked") == 0
    assert scene.call("cmd.get_wizard") is None


# ------------------------------------------------------------ chain_session


def test_chain_session_is_NOT_part_of_the_cmd_api(ws: WSClient) -> None:
    """Measured: it is a module-level helper in `viewing.py`, never exported.

    So a React presentation mode cannot call it directly, and the row's
    "React presentation mode triggers it" has to mean triggering it the way
    PyMOL does — through `cmd.scene(..., 'next')`.
    """
    reply = ws.call_reply("cmd.chain_session")
    assert reply["t"] == "err"
    assert "no such symbol" in reply["error"]["message"], reply


def test_the_presentation_quit_path_is_DORMANT_by_default(ws: WSClient) -> None:
    """A HAZARD THE WEB PORT INHERITS, pinned by its preconditions.

    `viewing.py:1107-1114`: a `scene` action of `next`/`previous` calls
    `chain_session`, and if there is no next session file it calls
    `_self.quit()`. On the desktop that closes the app the user is looking at.
    Here it ends the BRIDGE PROCESS — for every connected client — and it does
    so from inside PyMOL, which means it bypasses the graceful shutdown the
    bridge installs for a client-issued `cmd.quit` (`server.py:139`).

    Four things must all hold, and this asserts the two that are settings:

        presentation                 OFF by default  <- the safety
        presentation_auto_quit       ON  by default  <- no safety here
        scene_current_name == ''     ran off the end of the scene list
        _scene_quit_on_action == action  the SECOND consecutive next/previous

    Both settings are editable from the Advanced Settings table, so this is
    dormant rather than impossible.

    NOT TRIGGERED ON PURPOSE: taking the branch would kill the engine this
    suite is talking to, and a test that has to be deleted after it passes
    once is not a test.
    """
    assert ws.call("cmd.get", "presentation") == "off"
    assert ws.call("cmd.get", "presentation_auto_quit") == "on"
    # And the client's own scene actions never turn presentation on.
    assert ws.call("cmd.get_setting_boolean", "presentation") == 0
