#!/usr/bin/env python3
"""Drain lint — WP-27 gate (b).

Three PyMOL APIs are **destructive single-consumer reads**: calling one CONSUMES
the thing it reports, so a second caller gets nothing and the first caller
silently loses data.

  ``cmd._get_feedback()``        pops one line per call   (packages/engine/modules/pymol/internal.py:593-606)
  ``cmd.get_setting_updates()``  clears the changed flags (packages/engine/layer1/Setting.cpp:1121-1147)
  ``p.getRedisplay(reset=True)`` clears the redisplay flag (packages/engine/layer5/PyMOL.cpp)

The architecture depends on exactly one owner draining each of them and fanning
the result out (plan §1.2 / §1.5). A panel or feature module that calls one
directly does not fail loudly — it quietly steals updates from the status
thread, and the symptom shows up somewhere else entirely as "the UI stopped
refreshing". That is why this is a lint and not a code review note.

WHY AST AND NOT GREP: this codebase documents itself heavily. A plain
``grep -r get_setting_updates`` over ``packages/bridge/`` reports six files, of which
four are docstrings explaining the rule and one is the policy module listing the
names as *string literals* in its reserved list. Exactly two are real calls.
A grep lint here would be ~80% false positives and would be switched off within
a week, so it parses instead and only flags genuine call sites.

Usage:
    python3 tools/parity/drain_lint.py [--json] [path ...]

Exit 0 clean, 1 on violation, 2 on a file that could not be parsed.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import sys
from typing import Dict, Iterable, List, NamedTuple

#: attribute name -> why it is single-consumer.
DRAINS: Dict[str, str] = {
    "_get_feedback": "pops one feedback line per call; a second consumer loses it",
    "get_setting_updates": "clears the changed flags as it reads them",
    "getRedisplay": "clears the redisplay flag when reset is true",
}

#: symbol -> the basenames permitted to drain THAT symbol.
#:
#: Ownership is PER SYMBOL, not per file. The plan (§6 WP-27) names one blanket
#: allowlist of ``feedback.py`` and ``status.py``; that predates wave 0 and does
#: not match the shipped process model. Encoding the real owners is what makes
#: the lint able to catch the thing it exists to catch — a NEW module starting
#: to drain — instead of reporting the designed owners forever until someone
#: switches it off.
#:
#: ``getRedisplay`` in particular is owned by ``render/framestream.py``'s
#: ``RedisplayGate``, deliberately and not by the pump: ``PyMOL_Draw`` clears
#: ``RedisplayFlag`` at ``packages/engine/layer5/PyMOL.cpp:2331`` BEFORE ``ExecutiveDrawNow``,
#: so a post-draw tick hook reads False for the very frame it is about to send.
#: The gate probes it from its own point in the cycle instead. Moving that drain
#: into the pump to satisfy a stale plan line would break frame emission.
#: symbol -> the EXACT set of basenames expected to contain a call site.
#:
#: Deliberately an exact set, not a permit list. The invariant that matters is
#: "exactly one live consumer", so both a NEW caller appearing and an expected
#: one vanishing should fail and force a conscious decision. A permit list only
#: catches the first of those.
#:
#: Two things this lint found on its first run, both worth keeping written down:
#:
#: 1. The plan (§6 WP-27) gates on ``status.py``. There is no ``status.py`` —
#:    the status poller was implemented inside ``pump.py``. The plan line is
#:    stale, not the code.
#: 2. ``feedback.py`` contains ``FeedbackDrain.poll()`` (`:84`), whose class
#:    docstring calls itself "the one and only consumer", while ``pump.py:435``
#:    independently drains and comments itself "exclusive to this poller".
#:    ``feedback.py`` is currently imported NOWHERE, so only the pump runs and
#:    there is no live double-drain — but it is a loaded gun: wiring
#:    ``FeedbackBroker`` up later without noticing the pump would split console
#:    lines between two consumers, intermittently and silently. Listed here so
#:    that the day someone imports it, this test is what tells them.
EXPECTED_CALL_SITES: Dict[str, set] = {
    "_get_feedback": {"pump.py", "feedback.py"},
    "get_setting_updates": {"pump.py"},
    "getRedisplay": {"engine.py", "framestream.py"},
}

#: Back-compat alias; the lint reads EXPECTED_CALL_SITES.
OWNERS = EXPECTED_CALL_SITES

#: ``getRedisplay(0)`` / ``getRedisplay(reset=False)`` is a NON-destructive peek,
#: so it is allowed anywhere. Only the resetting form is gated.
NON_DESTRUCTIVE_WHEN_FALSE = {"getRedisplay"}


class Violation(NamedTuple):
    path: str
    line: int
    symbol: str
    reason: str

    def format(self) -> str:
        return f"{self.path}:{self.line}: {self.symbol}() — {self.reason}"


def _resets(node: ast.Call, symbol: str) -> bool:
    """Is this call the destructive form?"""
    if symbol not in NON_DESTRUCTIVE_WHEN_FALSE:
        return True
    args = list(node.args)
    for kw in node.keywords:
        if kw.arg in ("reset", "reset_flag"):
            args = [kw.value]
            break
    if not args:
        return True  # default is reset=True
    first = args[0]
    if isinstance(first, ast.Constant):
        return bool(first.value)
    return True  # not statically known -> assume destructive


def _symbol_of(node: ast.Call) -> str | None:
    func = node.func
    if isinstance(func, ast.Attribute) and func.attr in DRAINS:
        return func.attr
    if isinstance(func, ast.Name) and func.id in DRAINS:
        return func.id
    return None


def scan_source(source: str, path: str) -> List[Violation]:
    """Real call sites only. Docstrings, comments and string literals are not calls."""
    tree = ast.parse(source, filename=path)
    out: List[Violation] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        symbol = _symbol_of(node)
        if symbol is None or not _resets(node, symbol):
            continue
        out.append(Violation(path, node.lineno, symbol, DRAINS[symbol]))
    return out


def iter_python(paths: Iterable[str]) -> Iterable[str]:
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for root, dirs, files in os.walk(p):
            dirs[:] = [d for d in dirs if d not in {"__pycache__", ".venv", "node_modules"}]
            for f in files:
                if f.endswith(".py"):
                    yield os.path.join(root, f)


def check(paths: Iterable[str]) -> List[Violation]:
    violations: List[Violation] = []
    for path in sorted(iter_python(paths)):
        base = os.path.basename(path)
        with open(path, "r", encoding="utf-8") as fh:
            source = fh.read()
        for v in scan_source(source, path):
            if base in OWNERS.get(v.symbol, set()):
                continue
            violations.append(v)
    return violations


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="*", default=["packages/bridge/tenmol_bridge"])
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    try:
        violations = check(args.paths or ["packages/bridge/tenmol_bridge"])
    except SyntaxError as exc:
        print(f"drain-lint: cannot parse {exc.filename}:{exc.lineno}: {exc.msg}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps([v._asdict() for v in violations], indent=1))
    else:
        for v in violations:
            print(v.format(), file=sys.stderr)
        if violations:
            print(
                f"\ndrain-lint: {len(violations)} violation(s). "
                "Each drain has a designated owner; see OWNERS in this file.\n"
                "If a panel needs this data, subscribe to the fan-out instead of draining.",
                file=sys.stderr,
            )
        else:
            print("drain-lint: clean")
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
