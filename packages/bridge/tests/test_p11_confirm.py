"""Inventory row 467 — the three process-starting routes, made consistent.

THE DEFECT, as `policy/grants/wp-25-apbs.py` measured and wrote down: the same
capability answered a confirmation prompt under one name and ran silently under
two others. `cmd.system("true")` was refused with "cmd.system needs a one-time
confirmation", while in the SAME session

    subproc.execute(["/bin/sh", "-c", "echo pwned > /tmp/x"])
    cmd.do("system echo pwned > /tmp/x")

both ran. A prompt that is trivially side-stepped teaches a user that prompts
mean nothing, which is worse than no prompt.

The product decision (2026-08-02) was "confirm once, consistently": an
authenticated localhost client may start local processes, and the routes that do
so behave the same way. These tests pin that, INCLUDING the part that is
deliberately not gated — `cmd.do` as a whole — because gating it would fire a
prompt during panel bootstrap, before the user had done anything.

Policy objects are cheap and independent of the engine, so these run against a
fresh `build_policy()` rather than over the socket; `test_wf_apbsverify.py`
covers the wire behaviour of `subproc.execute` itself.
"""

from __future__ import annotations

import pytest

from tenmol_bridge import errors
from tenmol_bridge.dispatch import _command_keywords
from tenmol_bridge.policy import build_policy


@pytest.fixture()
def policy():
    """A fresh policy per test: `confirm()` mutates session state."""
    return build_policy()


# -- the gate itself --------------------------------------------------------


def test_subproc_execute_now_needs_the_same_confirmation_as_system(policy) -> None:
    """The inconsistency the grant file measured, asserted as closed."""
    system = policy.check("cmd.system")
    execute = policy.check("subproc.execute")
    assert system.needs_confirmation, "cmd.system was always gated; that must not regress"
    assert execute.needs_confirmation, (
        "subproc.execute starts a local program exactly as cmd.system does"
    )
    for decision in (system, execute):
        with pytest.raises(errors.NotAllowed):
            decision.raise_if_denied()


def test_confirming_execute_lets_it_flow_and_does_not_confirm_system(policy) -> None:
    """One confirmation per session, per capability — not a blanket unlock."""
    policy.confirm("subproc.execute")
    assert not policy.check("subproc.execute").needs_confirmation
    policy.check("subproc.execute").raise_if_denied()
    # Confirming one process-starter must NOT silently confirm the other.
    assert policy.check("cmd.system").needs_confirmation


def test_execute_is_gated_by_the_DOTTED_key_not_the_leaf(policy) -> None:
    """`execute` is a common word; a leaf key would gate unrelated panels.

    Mutation-checked: keying the grant on `"execute"` instead of
    `"subproc.execute"` makes this assertion fail.
    """
    assert "subproc.execute" in policy.confirm_once
    assert "execute" not in policy.confirm_once
    # A hypothetical future `cmd.tenmol_thing.execute` is untouched by it.
    assert not policy.needs_confirmation("cmd.tenmol_thing.execute")


# -- the `cmd.do` bypass ----------------------------------------------------


def test_do_is_not_gated_as_a_whole(policy) -> None:
    """Gating `cmd.do` would prompt during bootstrap, before the user acted.

    Every panel installs itself with a `{t:'do'}` line and the console runs one
    per typed command, so this must stay ungated.
    """
    assert not policy.check("cmd.do").needs_confirmation
    policy.check("cmd.do").raise_if_denied()


@pytest.mark.parametrize(
    "line,expected",
    [
        ("system true", ("system",)),
        ("  SYSTEM true  ", ("system",)),
        ("zoom; system rm -rf /", ("zoom", "system")),
        ("zoom\nsystem true", ("zoom", "system")),
        ("system a; system b", ("system",)),  # deduplicated, order kept
        ("", ()),
        (";;\n\n", ()),
        ("/import subprocess", ()),  # the Python escape is not a keyword
        ("@script.pml", ()),  # nor is the script escape
    ],
)
def test_command_keywords_splits_the_way_pymol_does(line, expected) -> None:
    assert _command_keywords(line) == expected


def test_the_keyword_gate_is_what_refuses_do_system(policy) -> None:
    """`do("system true")` must be refused exactly as `cmd.system("true")` is.

    This is the bypass that made the old gate theatre. Asserted through the
    policy predicate the dispatcher calls, so it holds without an engine.
    """
    assert policy.needs_confirmation("cmd.system")
    assert any(
        policy.needs_confirmation("cmd.%s" % word)
        for word in _command_keywords("zoom; system true")
    ), "a confirm-once keyword anywhere on the line must be caught"

    policy.confirm("cmd.system")
    assert not any(
        policy.needs_confirmation("cmd.%s" % word)
        for word in _command_keywords("zoom; system true")
    ), "after one confirmation the same line must flow"


def test_an_unknown_first_word_is_not_turned_into_a_policy_denial(policy) -> None:
    """The gate asks a NARROW question, and this is why it uses `needs_confirmation`.

    Running the whole policy over every leading keyword would make PyMOL's own
    "unknown command" message unreachable, and would refuse a private-looking
    first word before the parser ever saw it.
    """
    for word in ("nosuchcommand", "_private", "__dunder__"):
        assert not policy.needs_confirmation("cmd.%s" % word)


def test_ordinary_command_lines_are_unaffected(policy) -> None:
    """The overwhelming case: nothing on the line is gated, nothing changes."""
    for line in ("zoom", "load foo.pdb", "set cartoon_ring_mode, 3", "hide everything"):
        assert not any(
            policy.needs_confirmation("cmd.%s" % word) for word in _command_keywords(line)
        ), line
