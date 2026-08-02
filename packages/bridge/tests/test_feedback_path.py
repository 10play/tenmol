"""Parity area 11 — how console text gets from PyMOL to the browser.

Four rows about one pipeline, and the pipeline has a landmine at each end:

    print / sys.stderr  ->  pcatch (a C module installed as stdout+stderr)
                        ->  OrthoAddOutput
                        ->  OrthoFeedbackIn   <-- GATED on G->Option->pmgui
                        ->  cmd._get_feedback <-- destructive, ONE line per call
                        ->  the bridge's `feedback` topic

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_feedback_path.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402


def printed(ws: WSClient, bridge, tag: str, statement: str) -> list:
    ws.do(statement)
    lines = bridge.wait_for_feedback(tag, timeout=5.0)
    return [line for line in lines if tag in line and "print(" not in line]


# ------------------------------------------------------------------ pcatch


def test_stdout_is_the_pcatch_MODULE_not_a_file(ws: WSClient, bridge) -> None:
    """`pcatch._install()` does `sys.stderr = sys.stdout = pcatch`.

    So `sys.stdout` is a MODULE, not a stream object, and `isatty()` is False
    on purpose — `pip.main` checks it. Anything in the client stack that
    duck-types stdout as a file will be surprised.
    """
    out = printed(
        ws,
        bridge,
        "ZFP_TTY",
        "import sys; print('ZFP_TTY', type(sys.stdout).__name__, sys.stdout.isatty())",
    )
    assert out, "no output"
    assert "module" in out[-1], out[-1]
    assert "False" in out[-1], out[-1]


def test_stderr_is_captured_too_not_just_stdout(ws: WSClient, bridge) -> None:
    """A traceback written to stderr has to reach the web console.

    If only stdout were hijacked, every uncaught error would vanish into the
    server's terminal and the user would see a command do nothing.
    """
    out = printed(
        ws,
        bridge,
        "ZFP_ERR",
        "import sys; sys.stderr.write('ZFP_ERR from stderr\\n')",
    )
    assert out, "stderr did not reach the feedback topic"


# ------------------------------------------------------------- the pmgui gate


def test_the_engine_keeps_the_pmgui_gate_OPEN(ws: WSClient, bridge) -> None:
    """`OrthoFeedbackIn` queues nothing unless `G->Option->pmgui`.

    `pmgui = !no_gui`, and options are snapshotted at `_cmd._new` — setting
    them after `start()` does nothing at all. So `engine.py` sets
    `no_gui = 0` BEFORE starting, and never uses `-c`/`-cq`.

    This is the regression guard for that: if someone "tidies up" the launch
    by passing -cq, the feedback queue is dead for the life of the process and
    the web console silently stays empty forever. That failure has no error
    message anywhere, which is why it is worth an assertion.
    """
    # Read by PRINTING it: the dispatcher only invokes callables, so a plain
    # attribute like `options.no_gui` is not fetchable with `{t:'call'}` at all
    # ("invocation.options.no_gui is not callable").
    out = printed(
        ws,
        bridge,
        "ZFP_GUI",
        "from pymol import invocation; print('ZFP_GUI', invocation.options.no_gui)",
    )
    assert out, "no output"
    assert out[-1].strip() == "ZFP_GUI 0", out[-1]


def test_feedback_actually_flows_end_to_end(ws: WSClient, bridge) -> None:
    """The observable consequence of the gate being open."""
    assert printed(ws, bridge, "ZFP_FLOW", "print('ZFP_FLOW ok')")


# ------------------------------------------------------------- severity loss


def test_error_and_warning_arrive_with_NO_severity_marker(ws, bridge) -> None:
    """`colorprinting.error/warning/suggest/parrot` are literally `print`.

    By the time text reaches the Ortho queue it is one undifferentiated stream.
    Measured: `colorprinting.error('...')` and `.warning('...')` produce lines
    indistinguishable from a plain print — no prefix, no level, nothing.

    So a console that wants to colour errors red CANNOT do it from this stream;
    the severity has to come from somewhere else (the `err` frame of a
    `{t:'call'}`, or a client-side classifier) and that is a design constraint,
    not an oversight to fix later.
    """
    ws.do(
        "from pymol import colorprinting; "
        "colorprinting.error('ZFP_SEV boom'); "
        "colorprinting.warning('ZFP_SEV careful')"
    )
    lines = bridge.wait_for_feedback("ZFP_SEV", timeout=5.0)
    got = [line for line in lines if "ZFP_SEV" in line and "colorprinting" not in line]
    assert len(got) >= 2, got

    for line in got:
        stripped = line.strip()
        assert stripped.startswith("ZFP_SEV"), (
            "a severity prefix appeared; the row may be out of date",
            line,
        )


# ------------------------------------------------- the single-consumer drain


def test_the_feedback_drain_has_exactly_two_owners() -> None:
    """`cmd._get_feedback()` pops ONE line per call and is destructive.

    A second consumer does not duplicate the line, it STEALS it — the first
    reader wins and the other never sees it. The lint in `tools/parity` is what
    keeps that from happening by accident; this asserts the owner set has not
    quietly grown.
    """
    sys.path.insert(
        0,
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
            "tools",
            "parity",
        ),
    )
    import drain_lint

    assert drain_lint.EXPECTED_CALL_SITES["_get_feedback"] == {"pump.py", "feedback.py"}
