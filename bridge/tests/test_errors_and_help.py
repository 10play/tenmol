"""Parity area 11 — the error contract, and the usage/help endpoints.

Both rows describe shapes the React client has to rely on: how a failure
arrives, and how `?` and `help` reach the user. Neither is guessable from the
Python source alone, because the bridge re-shapes exceptions on the way out and
because most of this output is PRINTED rather than returned.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_errors_and_help.py -q
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


# ------------------------------------------------------------------ errors


def test_a_CmdException_arrives_with_its_label_in_the_message(ws: WSClient) -> None:
    """`__str__` is ` <label>: <message>`, and the label rides along.

    The leading SPACE is PyMOL's, not a formatting accident here — every
    `CmdException` string starts with one, and a client that strips it will
    also strip it from the messages that do not have it.
    """
    reply = ws.call_reply("cmd.count_atoms", "nosuch!!!")
    assert reply["t"] == "err"
    error = reply["error"]
    assert error["kind"] == "CmdException"
    assert error["type"] == "CmdException"
    assert error["message"].startswith(" Error: "), repr(error["message"][:40])
    assert "Invalid selection name" in error["message"]


def test_the_label_is_not_always_Error(ws: WSClient, tmp_path) -> None:
    """`IncentiveOnlyException` subclasses it and carries its own label.

    So a client cannot parse the message by splitting on a literal "Error:".
    """
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", os.path.join(DATA, "il2.pdb"), "ze_obj")
    try:
        reply = ws.call_reply("cmd.save", str(tmp_path / "x.stl"))
        assert reply["t"] == "err"
        assert reply["error"]["type"] == "IncentiveOnlyException"
        assert reply["error"]["message"].startswith(" Incentive-Only-Error: "), (
            reply["error"]["message"][:40]
        )
    finally:
        ws.call("cmd.delete", "ze_obj")


def test_an_engine_error_carries_a_traceback_and_a_policy_refusal_does_not(ws):
    """The two failure CLASSES are distinguishable without parsing strings.

    A refusal happens before PyMOL is ever called, so there is no stack to
    show; an engine error has one. A client that wants to offer "report this"
    needs to tell them apart, and `kind` plus an empty traceback is how.
    """
    engine = ws.call_reply("cmd.load", "/no/such/file.pdb")
    assert engine["error"]["kind"] == "CmdException"
    assert len(engine["error"]["traceback"]) > 100

    refused = ws.call_reply("cmd.get_stlstr")
    assert refused["error"]["kind"] == "NotAllowed"
    assert refused["error"]["traceback"] == ""


def test_the_parser_PRINTS_a_bad_command_instead_of_failing_the_frame(ws, bridge):
    """`{t:'do'}` is not `{t:'call'}`.

    `parser.parse` catches CmdException, QuietException and SecurityException
    and prints them. So a typo at the command line produces console output and
    an OK frame — a client that surfaced errors only from `err` frames would
    show the user nothing at all.
    """
    reply = ws.do("nosuchcommand foo")
    assert reply["t"] == "ok", reply
    lines = bridge.wait_for_feedback("nosuchcommand", timeout=5.0)
    assert any("nosuchcommand" in line for line in lines), lines[-5:]


# -------------------------------------------------------------- usage/help


def test_the_question_mark_path_prints_the_usage_line(ws: WSClient, bridge) -> None:
    """`dump_arg` output, exactly as the row quotes it — `_self` removed."""
    ws.do("color ?")
    lines = bridge.wait_for_feedback("Usage", timeout=5.0)
    usage = [line for line in lines if "Usage:" in line]
    assert usage, lines[-5:]
    assert "color color [, selection [, quiet [, flags ]]]" in usage[-1], usage[-1]
    assert "_self" not in usage[-1]


def test_help_resolves_a_keyword_and_prints_its_docstring(ws: WSClient, bridge):
    """`cmd.help` RETURNS None and prints — the value is on the feedback topic.

    Worth pinning: a client that awaited the return value would render an empty
    help panel and look broken.
    """
    assert ws.call("cmd.help", "color") is None
    lines = bridge.wait_for_feedback("DESCRIPTION", timeout=5.0)
    assert any("DESCRIPTION" in line for line in lines), lines[-5:]


def test_write_html_ref_dumps_every_keyword_in_bulk(ws: WSClient, tmp_path) -> None:
    """The bulk form of the same data, and the basis for a generated API doc."""
    path = tmp_path / "ref.html"
    assert ws.call_reply("cmd.write_html_ref", str(path))["t"] == "ok"
    assert path.exists() and path.stat().st_size > 10_000
    body = path.read_text(errors="replace")
    for keyword in ("color", "load", "fetch", "orient"):
        assert keyword in body, keyword
