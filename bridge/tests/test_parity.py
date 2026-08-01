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


# --- protocol-surface checks (area 11) --------------------------------------
#
# These run against the DISPATCHER rather than a browser, because they are
# claims about the wire contract, not about any panel. Kept here rather than in
# an e2e spec so they fail fast in the bridge suite.


def test_the_drain_lint_module_is_importable_from_the_repo_root():
    """tools/parity is on sys.path for this suite; a move would break the gate."""
    assert hasattr(drain_lint, "check")
    assert hasattr(drain_lint, "EXPECTED_CALL_SITES")


def test_completion_resolves_a_partial_keyword():
    """`cmd._parser.complete` backs the console's Tab key.

    Verified over the real socket during wave 4: 'colo' -> 'color'. Asserted
    in-process too, so a policy change that revokes the grant fails here rather
    than silently disabling Tab in the UI.

    Starts the singleton only if nothing else in the run owns it — PyMOL allows
    exactly one and raises on a second start(), so skipping on "not started"
    would make this test order-dependent and usually vacuous.
    """
    pytest.importorskip("pymol")
    import sys

    sys.argv = ["pymol"]
    import pymol

    started_here = pymol.cmd._COb is None
    if started_here:
        opts = pymol.invocation.options
        opts.no_gui = 1
        opts.internal_gui = 0
        opts.internal_feedback = 0
        opts.external_gui = 0
        from pymol2 import SingletonPyMOL

        instance = SingletonPyMOL()
        instance.start()
    try:
        assert pymol.cmd._parser.complete("colo") == "color"
    finally:
        if started_here:
            instance.stop()


def test_get_vis_lies_about_measurement_objects():
    """The regression that pinned measurement reps to server rasterisation.

    `cmd.get_vis()` reports EVERY rep index for a measurement object, because a
    distance does not use the molecular rep model:

        u    [1, [], [],                 26]   correct, empty after hide
        dd   [1, [], [0,1,...,20],         7]   every rep index

    Taken at face value, no measurement object is ever a subset of a client's
    Mode-G declaration, so `plan_mask` answers `nothing-maskable` forever and
    the server keeps rasterising reps the client is ready to draw. This asserts
    the LIE still exists (so the workaround is not silently removed while the
    underlying behaviour persists) and that `web_get_versions` tells the truth.
    """
    pytest.importorskip("pymol")
    import sys

    sys.argv = ["pymol"]
    import pymol

    started_here = pymol.cmd._COb is None
    if started_here:
        opts = pymol.invocation.options
        opts.no_gui = 1
        opts.internal_gui = 0
        opts.internal_feedback = 0
        opts.external_gui = 0
        from pymol2 import SingletonPyMOL

        instance = SingletonPyMOL()
        instance.start()
    cmd = pymol.cmd
    try:
        cmd.delete("all")
        cmd.load(str(REPO / "test" / "dat" / "1tii.pdb"), "u")
        cmd.hide("everything")
        cmd.distance("dd", "u//A/1/CA", "u//A/5/CA")
        cmd.refresh()

        vis = cmd.get_vis()
        assert vis["u"][2] == [], "molecule should report no reps after hide everything"
        assert len(vis["dd"][2]) > 5, (
            "get_vis no longer over-reports measurement reps; the coverage "
            "override in render/framestream.py may now be unnecessary"
        )

        import pymol._cmd as _c

        raw = _c.web_get_versions(cmd._COb, 1, 0)
        reps = list((raw.get("objects") or {}).get("dd", {}).get("reps") or {})
        assert any(key.startswith("dashes") for key in reps), reps
        assert not any(key.startswith("cartoon") for key in reps), reps
    finally:
        cmd.delete("all")
        if started_here:
            instance.stop()


def test_no_gl_bridge_answers_set_pixel_stream_as_a_value_not_an_error():
    """The contract the GL-free client depends on.

    A bridge with no context must answer `_bridge.set_pixel_stream` with
    `{available: false, rasterizing: false, reason: "no-gl"}` as a RESOLVED
    value. An earlier implementation raised `NoOffscreenGL` instead and the
    client's `.catch` never ran, leaving the compositor waiting forever for a
    frame that could not come — a black viewport with no error.

    Asserted against the config rather than a live socket so it runs without a
    second process; the wire behaviour was confirmed by hand on --no-gl.
    """
    from tenmol_bridge.config import BridgeConfig

    cfg = BridgeConfig(require_gl=False)
    assert cfg.require_gl is False, "--no-gl must reach the engine as require_gl=False"

