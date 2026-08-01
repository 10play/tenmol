"""Parity area 11 — what the C core tells you, and what it does not.

The whole client architecture rests on one fact: **there is no event bus in
PyMOL's C++ core**. Every "notification" is a PULL, and most of them are
DESTRUCTIVE pulls with exactly one legitimate consumer.

If that ever stopped being true, large parts of the bridge (the poll loops, the
drain ownership rules, the `tools/parity` lint) would be unnecessary
complexity. So the premise is asserted here rather than assumed from a
paragraph written once.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_notifications.py -q
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(REPO, "test", "dat")
LAYERS = ["layer0", "layer1", "layer2", "layer3", "layer4", "layer5"]


# ------------------------------------------------- what does NOT exist


def test_there_is_NO_event_bus_anywhere_in_the_core() -> None:
    """`grep -r Notify layer0..layer5` returns nothing.

    This is the premise the whole design rests on. Asserted as a test so it
    stays true across upstream merges: if a real notification API ever lands,
    this fails and a large amount of polling can be deleted.
    """
    present = [path for path in LAYERS if os.path.isdir(os.path.join(REPO, path))]
    assert present, "source layers are missing; this assertion would be vacuous"

    result = subprocess.run(
        ["grep", "-rl", "Notify"] + present,
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert result.stdout.strip() == "", result.stdout


def test_an_object_appearing_is_only_visible_by_RE_READING(ws: WSClient) -> None:
    """No push for create/delete/rename — the client polls `get_names`.

    The assertion is deliberately mundane, because the POINT is mundane: the
    only way to learn the object list changed is to ask again.
    """
    ws.call("cmd.delete", "all")
    before = ws.call("cmd.get_names", "all")
    ws.call("cmd.load", os.path.join(DATA, "il2.pdb"), "zn_new")
    try:
        after = ws.call("cmd.get_names", "all")
        assert "zn_new" in after and "zn_new" not in before
    finally:
        ws.call("cmd.delete", "zn_new")


# ------------------------------------------------------ what DOES exist


def test_progress_is_a_plain_readable_pull(ws: WSClient) -> None:
    """The one mechanism on the list that a client may read freely.

    It is non-destructive: reading it does not consume anything, so there is no
    ownership rule and no lint entry for it.
    """
    assert ws.call("cmd.get_progress") == ws.call("cmd.get_progress")
    assert ws.call("cmd.get_progress") < 0


@pytest.mark.parametrize(
    "symbol,why",
    [
        ("cmd.get_setting_updates", "destructive drain"),
        ("cmd._getRedisplay", "private symbol"),
    ],
)
def test_the_destructive_pulls_are_refused_to_clients(ws, symbol, why) -> None:
    """These are push-QUALITY signals and single-consumer.

    `get_setting_updates` clears the flags it reports and `getRedisplay(reset)`
    clears the dirty bit — a second reader does not get a copy, it makes the
    first reader miss the change. The bridge owns both and republishes them on
    topics, so the client must never call them directly, and the policy is what
    enforces that rather than a comment.
    """
    reply = ws.call_reply(symbol)
    assert reply["t"] == "err", (symbol, why)
    assert reply["error"]["kind"] == "NotAllowed", reply


def test_every_destructive_drain_has_a_declared_owner() -> None:
    """The lint that keeps a second consumer from appearing by accident."""
    sys.path.insert(0, os.path.join(REPO, "tools", "parity"))
    import drain_lint

    assert set(drain_lint.EXPECTED_CALL_SITES) == {
        "_get_feedback",
        "get_setting_updates",
        "getRedisplay",
    }
    for symbol, owners in drain_lint.EXPECTED_CALL_SITES.items():
        assert owners, symbol


def test_the_lint_actually_passes_on_this_tree() -> None:
    """A lint nobody runs is documentation. This runs it."""
    sys.path.insert(0, os.path.join(REPO, "tools", "parity"))
    import drain_lint

    # A LIST: `check` takes an iterable of paths, so a bare string iterates as
    # characters and scans directories named "/", "U", "s", ...
    problems = drain_lint.check([os.path.join(REPO, "bridge", "tenmol_bridge")])
    assert problems == [], problems
