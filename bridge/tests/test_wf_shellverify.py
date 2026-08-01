"""Wave-6 ADVERSARIAL re-verification of parity rows 53, 54 and 103.

``bridge/tests/test_wf_shell.py`` pins the arithmetic of the internal GUI
column and the two Qt facts that matter (setting 440 is ``session_file``;
``pymol.gui.ext_hide`` is a printed no-op).  Re-running it proved those.  This
file adds the four things it does NOT pin, each of which a claim about these
rows leans on:

1. **The three RPCs the React shell polls.**  ``AppShell``'s ``useWindowTitle``
   and ``useShellSettings`` call ``cmd.get('session_file')`` and
   ``cmd.get_setting_int('internal_gui'|'internal_gui_width')`` once a second.
   Nothing in the repo asserted those are permitted over ``{t:'call'}``; if a
   policy change dropped ``cmd.get`` the window title would silently stop
   tracking and only a browser probe would notice.

2. **``options.external_gui``.**  ``apps/web/src/shell/extGuiDock.ts`` says
   "MEASURED (``bridge/tests/test_wf_shell.py``): the bridge reports
   ``options.external_gui == 0``" — but that test reads ``win_x``, ``win_y`` and
   ``ext_y`` only.  It is measured HERE, together with the caveat that makes the
   number nearly worthless on its own: like ``no_gui``,
   ``pymol.invocation.options`` is a plain mutable process global that other
   tests in this suite write (``test_modeg_lines.py:40-44`` sets four of them),
   so the load-bearing evidence is the ``engine.py`` source that forces it
   BEFORE ``start()``, which is also asserted.

3. **``set internal_gui_width, 310`` typed at the PROMPT.**  The row-103 claim
   "typing it at the prompt moved the splitter" has a backend half — the parser
   path, not ``cmd.set`` — and that is what the React poll adopts.

4. **PyMOL binds nothing to CTRL-E.**  Row 54 swallows Ctrl+E in the browser's
   capture phase so ``features/keyboard`` cannot forward it.  That is only
   harmless while PyMOL has no CTRL-E binding; if upstream ever adds one, the
   shortcut becomes a silent conflict and this test says so.

SHARED-STATE WARNING.  ``internal_gui_width`` is a global in the one PyMOL
process the whole suite shares.  ``width_guard`` snapshots and restores it.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_wf_shellverify.py -q
"""

from __future__ import annotations

import os
import sys
import time
from typing import List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE_PY = os.path.join(REPO, "bridge", "tenmol_bridge", "engine.py")


def tagged(ws: WSClient, tag: str, line: str, timeout: float = 6.0) -> List[str]:
    """``cmd.do(line)`` and return the feedback lines carrying ``tag``.

    PyMOL echoes the command back BEFORE running it, and the echo contains the
    tag, so the echo is filtered out by hand.  This is the only way to read a
    plain ATTRIBUTE (``pymol.invocation.options.external_gui``): the dispatcher
    invokes callables only.
    """
    if not getattr(ws, "_wf_shellverify_subscribed", False):
        ws.subscribe("feedback")
        ws._wf_shellverify_subscribed = True  # type: ignore[attr-defined]
    start = len(ws.feedback)
    ws.do(line)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ws.pump_frames(0.15)
        hits = [t for t in ws.feedback[start:] if tag in t and line not in t]
        if hits:
            return hits
    raise AssertionError("no %r line in feedback for %r" % (tag, line))


@pytest.fixture
def width_guard(ws: WSClient):
    """Snapshot/restore ``internal_gui_width`` — a process-wide global."""
    saved = int(ws.call("cmd.get_setting_int", "internal_gui_width"))
    try:
        yield saved
    finally:
        ws.call("cmd.set", "internal_gui_width", saved)
        assert int(ws.call("cmd.get_setting_int", "internal_gui_width")) == saved


# ------------------------------------------------------------------ row 53


def test_the_three_rpcs_the_react_shell_polls_are_permitted(ws: WSClient) -> None:
    """``AppShell`` polls these at 1 Hz; a policy change must fail HERE.

    MEASURED end to end in a headless browser as well: after
    ``save /tmp/tenmol_verif_shell.pse`` at the prompt, ``document.title`` became
    ``PyMOL (tenmol_verif_shell.pse)`` within ~1.6 s.  That works only because
    all three of these answer.
    """
    reply = ws.call_reply("cmd.get", "session_file")
    assert reply["t"] == "ok", reply
    assert isinstance(reply["result"], str)

    for name in ("internal_gui", "internal_gui_width"):
        reply = ws.call_reply("cmd.get_setting_int", name)
        assert reply["t"] == "ok", (name, reply)
        assert isinstance(reply["result"], int), (name, reply)

    # `cmd.get` reads the setting the Qt title callback is registered on, and
    # `cmd.get_setting_tuple(440)` is the same value: one mechanism, two spellings.
    kind, values = ws.call("cmd.get_setting_tuple", 440)
    assert kind == 6
    assert values[0] == ws.call("cmd.get", "session_file")


# ------------------------------------------------------------------ row 54


def test_external_gui_is_forced_off_before_start_and_reads_0(ws: WSClient) -> None:
    """The claim ``extGuiDock.ts`` cites but ``test_wf_shell.py`` never measured.

    Two pieces of evidence, and they are not equally good:

    * the runtime read — WEAK.  ``pymol.invocation.options`` is a mutable
      process global; ``bridge/tests/test_modeg_lines.py:40-44`` writes four of
      its fields from a module fixture, and PyMOL snapshotted the real values
      into ``CPyMOLOptions`` at ``_cmd._new`` long before that
      (``layer1/P.cpp:1800-1830``).  So a 0 here does NOT prove the engine
      booted with 0.
    * the source — STRONG.  ``engine.py`` assigns it before ``start()``, which
      is the only assignment that can matter.

    Both are asserted so that a change to either is visible.  This is why the
    React dock does NOT read ``options.external_gui`` as "start hidden": the
    value is the bridge's, not the user's, and the dock is client state.
    """
    line = tagged(
        ws,
        "WFSHV_EXT",
        "print('WFSHV_EXT', [pymol.invocation.options.external_gui,"
        " pymol.invocation.options.internal_gui, pymol.invocation.options.ext_y])",
    )[0]
    payload = line.split("WFSHV_EXT", 1)[1]
    external_gui, internal_gui, ext_y = [
        int(n) for n in payload.replace("[", " ").replace("]", " ").replace(",", " ").split()
    ]
    assert (external_gui, internal_gui, ext_y) == (0, 0, 168)

    source = open(ENGINE_PY).read()
    for forced in (
        "options.external_gui = 0",
        "options.internal_gui = 0",
        "options.internal_feedback = 0",
    ):
        assert forced in source, "engine.py no longer forces %r" % forced
    # ...and that it happens before start(), which is the whole point.
    assert source.index("options.external_gui = 0") < source.index("self.p.start(")


def test_pymol_binds_nothing_to_CTRL_E_so_the_browser_may_swallow_it(ws: WSClient) -> None:
    """Row 54's Ctrl+E is only safe to consume while PyMOL wants nothing with it.

    The shell listens for Ctrl+E on ``window`` in the CAPTURE phase and calls
    ``preventDefault()``; ``features/keyboard/KeyboardService.tsx:64`` returns
    early on ``defaultPrevented``, so the keystroke never becomes a
    ``{t:'input',kind:'button'}`` frame.  Qt's window-level ``QShortcut``
    consumes it the same way (``pymol_qt_gui.py:379-380``).

    Asserted against ``pymol.keyboard.get_default_keys()`` rather than the live
    ``cmd.key_mappings``, because ``bridge/tests/test_key_bindings.py`` clears
    and rebuilds that dict mid-suite.  MEASURED live anyway, in a browser:
    ``cmd.key_mappings.get('CTRL-E')`` answered ``None``.
    """
    line = tagged(
        ws,
        "WFSHV_KEY",
        "/import pymol.keyboard; print('WFSHV_KEY',"
        " 'CTRL-E' in pymol.keyboard.get_default_keys(),"
        " 'CTRL-F' in pymol.keyboard.get_default_keys())",
    )[0]
    payload = line.split("WFSHV_KEY", 1)[1].split()
    # CTRL-E unbound, CTRL-F bound (`wizard find`) — the second half is the
    # control that proves the lookup works at all.
    assert payload[:2] == ["False", "True"], line


# ----------------------------------------------------------------- row 103


def test_set_internal_gui_width_typed_at_the_prompt_moves_the_setting(
    ws: WSClient, width_guard
) -> None:
    """The backend half of "typing it at the prompt moved the splitter".

    The React poll adopts every CHANGE to ``internal_gui_width``
    (``orthoPanel.ts: adoptShellSettings``), so this parser path is what makes a
    typed ``set`` reach the DOM.  MEASURED in a browser: the column went to
    310 px and ``cmd.get_viewport()`` to (966, 644) in a 1280x900 window.

    The PARSER path is deliberately exercised, not ``cmd.set`` — they are
    different code (``modules/pymol/parser.py`` -> ``cmd.set``) and only this
    one is what a user types.
    """
    ws.do("set internal_gui_width, 310")
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if int(ws.call("cmd.get_setting_int", "internal_gui_width")) == 310:
            break
        ws.pump_frames(0.1)
    assert int(ws.call("cmd.get_setting_int", "internal_gui_width")) == 310

    # And the collapse value the gutter writes survives the same path.
    ws.do("set internal_gui_width, 5")
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if int(ws.call("cmd.get_setting_int", "internal_gui_width")) == 5:
            break
        ws.pump_frames(0.1)
    assert int(ws.call("cmd.get_setting_int", "internal_gui_width")) == 5
