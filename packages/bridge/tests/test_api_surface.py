"""Parity area 11 — the shape of the `cmd` API, and how commands get typed.

Three rows about the same surface from three angles: how big it is, how a
modern command declares its argument types, and where the completion tables
live.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_api_surface.py -q
"""

from __future__ import annotations

import ast
import collections
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient, slow  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
API_PY = os.path.join(REPO, "packages", "engine", "modules", "pymol", "api.py")


def api_imports():
    """`(names, per_module)` for every `from X import a, b` in `api.py`."""
    tree = ast.parse(open(API_PY, encoding="utf-8").read())
    names: list = []
    per_module: collections.Counter = collections.Counter()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                names.append(alias.asname or alias.name)
                per_module[node.module] += 1
    return names, per_module


# ------------------------------------------------------------ the surface


def test_the_api_is_a_pure_reexport_manifest_of_404_symbols() -> None:
    """405 import entries, 404 unique — `mpng` is listed twice.

    Measured by AST rather than by `dir(cmd)`, which would also pick up
    attributes, private helpers and anything a plugin has attached. The
    duplicate is real and harmless, and it is asserted so the count stays
    honest: someone re-counting with `len(set(...))` and someone counting
    entries will otherwise disagree by one and each think the other is wrong.
    """
    names, per_module = api_imports()

    assert len(names) == 405, len(names)
    assert len(set(names)) == 404, len(set(names))
    duplicates = [n for n, c in collections.Counter(names).items() if c > 1]
    assert duplicates == ["mpng"], duplicates

    # The biggest contributors, which is where a port's effort actually goes.
    assert per_module["editing"] == 76
    assert per_module["querying"] == 63
    assert per_module["viewing"] == 58


def test_api_py_contains_no_function_bodies(ws: WSClient) -> None:
    """It is a manifest. Nothing to port here — the code is in the modules."""
    tree = ast.parse(open(API_PY, encoding="utf-8").read())
    defs = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    assert defs == [], [d.name for d in defs]


# ------------------------------------------------------- new_command typing


def test_new_command_COERCES_string_arguments_via_annotations(ws, bridge) -> None:
    """The exception to "the parser does no coercion".

    Everything from the command line arrives as a string (see
    `test_command_path.py`). `cmd.new_command` is the one path that converts:
    it resolves PEP-563 annotations with `get_type_hints` and pushes each
    string through `_into_types`.

    Measured: `zz_demo 5, hello` reaches the function with `count` as an INT
    (5 * 2 == 10) and `label` as a str, and calling it bare uses the declared
    defaults.
    """
    ws.do(
        "exec(\"def zz_api_demo(count: int = 3, label: str = 'x'):\\n"
        "    print('ZAPI', count * 2, repr(label), type(count).__name__)\\n\")"
    )
    ws.do("cmd.new_command('zz_api_demo', zz_api_demo)")

    ws.do("zz_api_demo 5, hello")

    # NOT the bare marker. `cmd.do` echoes the source that DEFINED the
    # command, and that source contains 'ZAPI', so waiting on the marker alone
    # can return on the echo before the command's own output has landed --
    # leaving the filter below with an empty list. Wait for what the filter
    # keeps. Same shape at every wait_for_feedback call that post-filters.
    def printed(line: str) -> bool:
        return "ZAPI" in line and "print(" not in line and "exec(" not in line

    lines = bridge.wait_for_feedback("ZAPI", timeout=slow(5.0), where=printed)
    typed = [x for x in lines if printed(x)]
    assert typed, lines[-5:]
    assert typed[-1].strip() == "ZAPI 10 'hello' int", typed[-1]


def test_new_command_falls_back_to_the_declared_defaults(ws, bridge) -> None:
    ws.do(
        "exec(\"def zz_api_def(count: int = 3, label: str = 'x'):\\n"
        "    print('ZAPD', count * 2, repr(label))\\n\")"
    )
    ws.do("cmd.new_command('zz_api_def', zz_api_def)")
    ws.do("zz_api_def")

    def printed(line: str) -> bool:
        return "ZAPD" in line and "print(" not in line and "exec(" not in line

    lines = bridge.wait_for_feedback("ZAPD", timeout=slow(5.0), where=printed)
    got = [x for x in lines if printed(x)]
    assert got and got[-1].strip() == "ZAPD 6 'x'", got[-1:]


# ------------------------------------------------------- completion tables


def test_auto_arg_is_four_tables_one_per_argument_POSITION(ws, bridge) -> None:
    """`[115, 70, 25, 7]` entries — measured, and each value is a triple.

    A value is `[shortcut_or_lambda, type_name, postfix]`; `align` in position
    1 carries type `selection` and postfix `", "`, which is what makes Tab
    insert a comma after completing.
    """
    ws.do(
        "print('ZAAG', len(cmd.auto_arg), [len(d) for d in cmd.auto_arg], "
        "cmd.auto_arg[0]['align'][1:])"
    )
    def printed(line: str) -> bool:
        return "ZAAG" in line and "print(" not in line

    lines = bridge.wait_for_feedback("ZAAG", timeout=slow(5.0), where=printed)
    got = [x for x in lines if printed(x)]
    assert got, lines[-5:]
    assert "4 [115, 70, 25, 7]" in got[-1], got[-1]
    assert "'selection'" in got[-1], got[-1]


def test_the_tables_are_NOT_readable_by_a_client(ws: WSClient) -> None:
    """Which is why completion is a server-side call, not a client-side table.

    `cmd.auto_arg` is an ATTRIBUTE, and the dispatcher only invokes callables;
    `get_auto_arg_list` is not on `cmd` at all, and `completing` is not an
    addressable namespace. So the browser cannot download the tables and
    complete locally — it calls `cmd._parser.complete` (granted by
    `policy/grants/wp-11-console.py`) and lets PyMOL do it.

    That is also the right answer: half the entries are LAMBDAS re-evaluated
    per completion (object names, fragments, wizards), so a downloaded copy
    would be stale the moment anything loaded.
    """
    assert ws.call_reply("cmd.get_auto_arg_list")["t"] == "err"
    assert ws.call_reply("completing.get_auto_arg_list")["t"] == "err"
    assert ws.call_reply("cmd.auto_arg")["t"] == "err"
    # And the path that DOES work.
    assert ws.call("cmd._parser.complete", "colo") == "color"
