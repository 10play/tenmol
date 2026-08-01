"""WP-27 gates that run in the bridge suite.

Currently the drain lint: the three destructive single-consumer PyMOL APIs may
only be called by their designated owner. A second consumer does not fail — it
silently steals data, and the symptom appears elsewhere as "the UI stopped
updating", which is exactly the kind of bug a test should catch instead of a
person.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
BRIDGE_PKG = REPO / "bridge" / "tenmol_bridge"
sys.path.insert(0, str(REPO / "tools" / "parity"))

import drain_lint  # noqa: E402


def test_the_bridge_has_no_unowned_drains():
    violations = drain_lint.check([str(BRIDGE_PKG)])
    assert violations == [], "\n" + "\n".join(v.format() for v in violations)


def test_call_sites_are_exactly_the_expected_ones():
    """The real invariant: exactly one live consumer per drain.

    An exact-set assertion so BOTH directions fail loudly — a new module
    starting to drain, and an expected owner quietly losing its call site.
    A permit list would only catch the first.
    """
    actual: dict[str, set[str]] = {s: set() for s in drain_lint.DRAINS}
    for path in BRIDGE_PKG.rglob("*.py"):
        if "__pycache__" in str(path):
            continue
        for v in drain_lint.scan_source(path.read_text(), str(path)):
            actual[v.symbol].add(Path(v.path).name)
    assert actual == drain_lint.EXPECTED_CALL_SITES


def test_every_expected_owner_file_still_exists():
    """A stale entry silently widens the lint to a file that is gone.

    This is how the lint discovered that the plan's `status.py` was never built.
    """
    names = {p.name for p in BRIDGE_PKG.rglob("*.py")}
    for symbol, owners in drain_lint.EXPECTED_CALL_SITES.items():
        for owner in owners:
            assert owner in names, f"{symbol}: expected owner {owner} does not exist"


def test_a_new_module_draining_is_caught():
    src = "def go(cmd):\n    return cmd._get_feedback()\n"
    found = drain_lint.scan_source(src, "panels/invented.py")
    assert [v.symbol for v in found] == ["_get_feedback"]
    assert found[0].line == 2


def test_docstrings_and_string_literals_are_not_calls():
    """The reason this is an AST lint and not a grep."""
    src = (
        '"""Explains cmd.get_setting_updates() and _get_feedback()."""\n'
        'RESERVED = ["_get_feedback", "get_setting_updates", "getRedisplay"]\n'
        "# getRedisplay() in a comment\n"
    )
    assert drain_lint.scan_source(src, "policy/base.py") == []


def test_a_non_resetting_peek_is_allowed_anywhere():
    """getRedisplay(0) does not consume, so gating it would be noise."""
    assert drain_lint.scan_source("p.getRedisplay(0)\n", "x.py") == []
    assert drain_lint.scan_source("p.getRedisplay(reset=False)\n", "x.py") == []
    # ...but the destructive forms are caught, including the implicit default.
    assert len(drain_lint.scan_source("p.getRedisplay()\n", "x.py")) == 1
    assert len(drain_lint.scan_source("p.getRedisplay(1)\n", "x.py")) == 1


def test_an_unknown_reset_argument_is_assumed_destructive():
    """Better a false positive than a missed double-drain."""
    assert len(drain_lint.scan_source("p.getRedisplay(flag)\n", "x.py")) == 1


@pytest.mark.parametrize("symbol", sorted(drain_lint.DRAINS))
def test_every_drain_has_at_least_one_owner(symbol):
    assert drain_lint.EXPECTED_CALL_SITES.get(
        symbol
    ), f"{symbol} has no owner; the lint would ban it outright"
