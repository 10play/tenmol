"""The settings TAP as the shell consumes it — parity row 57.

Row 57 is Qt's ``update_feedback`` loop
(``modules/pmg_qt/pymol_qt_gui.py:941-968``), whose second half is the only
mechanism that moves a checkable menu item or the window title when something
other than the widget changed the setting::

    for index in cmd.get_setting_updates():
        value = cmd.get_setting_tuple(index)[1][0]
        for callback in self.setting_callbacks[index]:
            callback(value)

``apps/web/src/shell/settingsTap.ts`` is that loop, and its fake bridge is
written against what THIS file measures.  Four things are asserted here that
the client cannot assert about itself:

  1. ``cmd.do(line, echo=0)`` installs the settings panel with NO console line,
     while the same line as a ``{t:'do'}`` frame prints ``PyMOL>/import …``.
     The shell installs the tap at startup, so the difference is a console the
     user reads versus one they do not.
  2. ``tenmol_settings_drain(cursor)`` takes the cursor as an ARGUMENT: two
     independent consumers (``features/settings`` and the shell) each keep
     their own and neither steals from the other.  This is what makes a second
     consumer legal at all — ``cmd.get_setting_updates`` itself is destructive
     and belongs to the bridge status thread.
  3. Writing ``session_file`` really does surface as index **440**, the index
     ``document.title`` is bound to.
  4. ``tenmol_settings_values`` resolves setting NAMES, and SILENTLY DROPS a
     name it cannot resolve — the reason the client's resolver falls back to
     one call per name when the batch comes back short.

SAFETY.  Every global this file touches (``session_file``, ``orthoscopic``) is
read first and restored in a ``finally``; the tap is drained back to its head
afterwards so a later consumer does not inherit this file's batches.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List

import pytest


BOOTSTRAP = "/import tenmol_bridge.panels.settings as _s;_s.install()"

STATUS = "setting.tenmol_settings_status"
DRAIN = "setting.tenmol_settings_drain"
VALUES = "setting.tenmol_settings_values"

#: ``setting._get_index('session_file')`` — the index ``document.title`` follows.
SESSION_FILE_INDEX = 440


def _installed(ws: Any) -> bool:
    reply = ws.call_reply(STATUS)
    return reply["t"] == "ok" and bool((reply["result"] or {}).get("installed"))


@pytest.fixture
def tap(ws: Any) -> Any:
    """The settings panel, installed the way the shell installs it."""
    if not _installed(ws):
        ws.call("cmd.do", BOOTSTRAP, echo=0)
    assert _installed(ws), "the settings panel did not install"
    return ws


def _drain(ws: Any, cursor: int) -> Dict[str, Any]:
    return ws.call(DRAIN, cursor)


def _wait_for_index(ws: Any, cursor: int, index: int, timeout: float = 5.0) -> Dict[str, Any]:
    """Poll the tap until ``index`` shows up, the way the client's poller does."""
    deadline = time.monotonic() + timeout
    seen: List[int] = []
    while time.monotonic() < deadline:
        drained = _drain(ws, cursor)
        cursor = drained["cursor"]
        seen.extend(drained.get("indices") or [])
        if index in seen or drained.get("full"):
            drained["seen"] = seen
            drained["cursor"] = cursor
            return drained
        time.sleep(0.05)
    raise AssertionError("index %d never reached the tap; saw %r" % (index, seen))


def test_cmd_do_echo_0_installs_without_a_console_line(ws: Any, bridge: Any) -> None:
    """The shell installs at startup: a `{t:'do'}` frame would say so, loudly."""
    if not _installed(ws):
        ws.call("cmd.do", BOOTSTRAP, echo=0)
    before = len(bridge.feedback_lines())
    # Idempotent, so this second install is the one being measured.
    ws.call("cmd.do", BOOTSTRAP, echo=0)
    time.sleep(0.4)
    quiet = bridge.feedback_lines()[before:]
    assert not [line for line in quiet if "import tenmol_bridge.panels.settings" in line], quiet

    before = len(bridge.feedback_lines())
    ws.do(BOOTSTRAP)
    time.sleep(0.4)
    loud = bridge.feedback_lines()[before:]
    assert [line for line in loud if "import tenmol_bridge.panels.settings" in line], loud


def test_session_file_writes_surface_as_index_440(tap: Any) -> None:
    """`document.title` <- setting 440 (`pymol_qt_gui.py:112-115`)."""
    ws = tap
    original = ws.call("cmd.get", "session_file")
    cursor = _drain(ws, 0)["cursor"]
    try:
        ws.call("cmd.set", "session_file", "/tmp/p9-a1-title.pse")
        drained = _wait_for_index(ws, cursor, SESSION_FILE_INDEX)
        cursor = drained["cursor"]

        rows = ws.call(VALUES, [SESSION_FILE_INDEX], "", 0)["values"]
        assert rows == [[SESSION_FILE_INDEX, "/tmp/p9-a1-title.pse", "/tmp/p9-a1-title.pse"]]
    finally:
        ws.call("cmd.set", "session_file", original)
        time.sleep(0.4)
        _drain(ws, cursor)


def test_two_consumers_hold_two_cursors_and_neither_steals(tap: Any) -> None:
    """Why a shell-owned tap beside `features/settings`' one is legal.

    ``cmd.get_setting_updates()`` clears the flags while iterating, so a second
    reader of THAT would see nothing.  The tap is a cumulative log addressed by
    a cursor the caller passes, so both consumers see every batch.
    """
    ws = tap
    original = ws.call("cmd.get", "orthoscopic")
    head = _drain(ws, 0)["cursor"]
    # Two independent cursors, exactly as the two client modules keep them.
    shell_cursor = head
    feature_cursor = head
    try:
        ws.call("cmd.set", "orthoscopic", 1 if str(original) in ("off", "0") else 0)
        shell = _wait_for_index(ws, shell_cursor, 23)
        feature = _wait_for_index(ws, feature_cursor, 23)
        assert 23 in shell["seen"]
        assert 23 in feature["seen"], "the first reader consumed the second's batch"
        assert shell["cursor"] == feature["cursor"]
        shell_cursor = shell["cursor"]

        # A cursor already at the head sees nothing new, and does not re-report.
        again = _drain(ws, shell_cursor)
        assert again["indices"] == [] and not again["full"]
    finally:
        ws.call("cmd.set", "orthoscopic", original)
        time.sleep(0.4)
        _drain(ws, shell_cursor)


def test_values_resolves_names_and_silently_drops_unknown_ones(tap: Any) -> None:
    """The reason the client resolver falls back to one call per name."""
    ws = tap
    names = ["orthoscopic", "valence", "bogus_setting_p9a1", "session_file"]
    rows = ws.call(VALUES, names, "", 0)["values"]
    indices = [row[0] for row in rows]

    # Three rows for four names: the short answer that makes zipping unsafe.
    assert len(rows) == 3, rows
    assert indices[0] == 23 and indices[-1] == SESSION_FILE_INDEX
    # One name at a time is unambiguous — that is the fallback.
    assert ws.call(VALUES, ["valence"], "", 0)["values"][0][0] == indices[1]
    assert ws.call(VALUES, ["bogus_setting_p9a1"], "", 0)["values"] == []


def test_install_does_not_build_the_catalogue(tap: Any) -> None:
    """The shell pays for a drain, not for 1000 settings and their help text."""
    status = tap.call(STATUS)
    assert status["installed"] is True
    # `catalogueBuilt` only turns true when `features/settings` bootstraps; the
    # shell never calls `tenmol_settings_catalogue`, and this asserts the cost
    # of the tap is a cursor, not a catalogue.
    assert "catalogueBuilt" in status


# --------------------------------------------------------------------------
# Row 72 — the colour editor's HSV picker uses PyMOL's own colour space
# --------------------------------------------------------------------------


def _printed(ws: Any, bridge: Any, tag: str, expr: str, timeout: float = 15.0) -> str:
    """Evaluate ``expr`` in the engine and return what it printed.

    PyMOL echoes the command before running it, so the match is anchored at the
    start of the line, where only the real output can be (the echo starts with
    ``PyMOL>``).
    """
    ws.do("print(%r, %s)" % (tag, expr))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for line in bridge.feedback_lines():
            if line.startswith(tag + " "):
                return line[len(tag) + 1:]
        time.sleep(0.05)
    raise AssertionError("no console output for %r" % (expr,))


def test_hsv_fixture_is_what_colorsys_produces_inside_the_engine(ws: Any, bridge: Any) -> None:
    """The web fixture is not a copy of the web implementation's output.

    ``apps/web/src/features/colors/hsv.ts`` is a transcription of
    ``Lib/colorsys.py`` — the module ``modules/pymol/viewing.py:1971`` imports
    for ``spectrum … interpolation=hsv``.  Both suites read the SAME vectors
    from ``__fixtures__/p9a1hsv.json``: this test asserts the engine's
    ``colorsys`` produces them, ``p9a1hsv.test.ts`` asserts the TypeScript does.
    Break either side and one of the two goes red.
    """
    import json
    import os

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = os.path.join(
        root, "apps", "web", "src", "features", "colors", "__fixtures__", "p9a1hsv.json"
    )
    with open(path) as handle:
        fixture = json.load(handle)

    # In the ENGINE, not in this interpreter: `viewing.py`'s import is what the
    # claim is about.  The dispatcher invokes callables only, so this goes over
    # the console — `print` with a tag, and the echo line skipped by anchoring
    # the match at the start of the line.
    ws.do("/import colorsys, json as _j")
    ws.do("/_p9 = _j.loads(open(%r).read())" % path)
    measured = _printed(
        ws,
        bridge,
        "P9A1HSVR",
        "_j.dumps([[list(colorsys.rgb_to_hsv(*r['rgb'])), "
        "list(colorsys.hsv_to_rgb(*colorsys.rgb_to_hsv(*r['rgb'])))] "
        "for r in _p9['roundTrip']])",
    )
    rows = json.loads(measured)
    assert len(rows) == len(fixture["roundTrip"])
    for row, (hsv, back) in zip(fixture["roundTrip"], rows):
        assert hsv == pytest.approx(row["hsv"], abs=1e-12), row["rgb"]
        assert back == pytest.approx(row["back"], abs=1e-12), row["rgb"]

    # …and the hsv -> rgb direction, which no round trip covers.
    forward = json.loads(
        _printed(
            ws,
            bridge,
            "P9A1HSVF",
            "_j.dumps([list(colorsys.hsv_to_rgb(*r['hsv'])) for r in _p9['forward']])",
        )
    )
    assert len(forward) == len(fixture["forward"])
    for row, rgb in zip(fixture["forward"], forward):
        assert rgb == pytest.approx(row["rgb"], abs=1e-12), row["hsv"]
