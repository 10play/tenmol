"""Parity area 11 — the generated TypeScript client stays in sync.

`tools/gen-api/extract.py` runs inside PyMOL and writes facts;
`tools/gen-api/emit.mjs` turns them into `packages/protocol/src/generated/`.

A generator whose output nobody checks is worse than no generator: the
committed file looks authoritative while quietly describing an older PyMOL.
This re-runs both and fails on any difference.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_gen_api.py -q
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOOLS = os.path.join(REPO, "tools", "gen-api")
SCHEMA = os.path.join(TOOLS, "api-schema.json")
GENERATED = os.path.join(REPO, "packages", "protocol", "src", "generated", "api.ts")


def run_extract(tmp_path) -> dict:
    """A SUBPROCESS, always.

    `extract.py` starts its own PyMOL singleton, and PyMOL allows exactly one
    per process — importing it here would collide with the bridge fixture and
    take the whole suite down.
    """
    out = tmp_path / "schema.json"
    with open(out, "w", encoding="utf-8") as handle:
        result = subprocess.run(
            [sys.executable, os.path.join(TOOLS, "extract.py")],
            stdout=handle,
            stderr=subprocess.PIPE,
            cwd=REPO,
            timeout=180,
        )
    assert result.returncode == 0, result.stderr.decode()[-800:]
    return json.load(open(out, encoding="utf-8"))


def test_the_committed_schema_matches_this_pymol(tmp_path) -> None:
    fresh = run_extract(tmp_path)
    committed = json.load(open(SCHEMA, encoding="utf-8"))

    missing = sorted(set(committed["commands"]) - set(fresh["commands"]))
    added = sorted(set(fresh["commands"]) - set(committed["commands"]))
    assert not missing and not added, {"missing": missing[:10], "added": added[:10]}

    # Signatures, not just names: a parameter gaining a default changes what
    # the emitter puts in the options bag.
    for name, spec in fresh["commands"].items():
        assert spec["params"] == committed["commands"][name]["params"], name


def test_the_generated_typescript_is_up_to_date(tmp_path) -> None:
    """Re-emit from the COMMITTED schema and diff.

    Split from the test above on purpose: this one fails when the EMITTER
    changed and nobody regenerated, which is a different repair from PyMOL
    having moved underneath it.
    """
    out = tmp_path / "api.ts"
    result = subprocess.run(
        ["node", os.path.join(TOOLS, "emit.mjs"), SCHEMA, str(out)],
        capture_output=True,
        cwd=REPO,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr.decode()[-800:]

    expected = out.read_text(encoding="utf-8")
    actual = open(GENERATED, encoding="utf-8").read()
    assert actual == expected, (
        "packages/protocol/src/generated/api.ts is stale; re-run "
        "`node tools/gen-api/emit.mjs tools/gen-api/api-schema.json "
        "packages/protocol/src/generated/api.ts`"
    )


def test_the_schema_drops_self_and_keeps_the_shape_the_emitter_needs() -> None:
    """Pure, so it runs without PyMOL and fails fast on a malformed schema."""
    schema = json.load(open(SCHEMA, encoding="utf-8"))

    assert len(schema["commands"]) > 400, len(schema["commands"])
    for name, spec in schema["commands"].items():
        for param in spec["params"]:
            assert param["name"] != "_self", name
            assert param["kind"], name
            assert "hasDefault" in param, name

    # `color` is the worked example in the row.
    color = schema["commands"]["color"]
    assert [p["name"] for p in color["params"]] == ["color", "selection", "quiet", "flags"]
    assert color["params"][0]["hasDefault"] is False
    assert color["params"][1]["default"] == "'(all)'"


def test_the_domains_are_populated() -> None:
    schema = json.load(open(SCHEMA, encoding="utf-8"))
    domains = schema["domains"]
    assert len(domains["settings"]) > 700
    assert len(domains["colors"]) > 100
    assert [len(t) for t in domains["autoArgTypes"]] == [115, 70, 25, 7]


def test_unsafe_commands_are_not_in_the_ordinary_interface() -> None:
    """`do`/`run`/`quit` must not sit in the same autocomplete list as `color`."""
    generated = open(GENERATED, encoding="utf-8").read()
    safe, _, unsafe = generated.partition("export interface PymolUnsafeApi")
    assert "PymolApi" in safe

    def declares(section: str, name: str) -> bool:
        """A METHOD declaration, not the substring.

        `do(` occurs inside JSDoc prose (".. op(" and worse), so a plain
        substring test reports every command as unsafe.
        """
        return any(
            line.startswith("  %s(" % name) for line in section.splitlines()
        )

    for name in ("do", "run", "quit"):
        assert not declares(safe, name), name
        assert declares(unsafe, name), name
    assert declares(safe, "color")
