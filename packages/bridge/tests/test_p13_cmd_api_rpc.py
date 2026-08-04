"""Parity area 11 — three rows whose citations were circumstantial.

Written for wave 13, after mutation-testing the whole of section 11.  Each of
these rows carried a `†` citation that survived breaking the thing the row
describes:

* **`util` scalar metrics** (row 501) cited a React DOM test whose only
  connection is the string `' cmd.get_area: 123.4 square Angstroms.'` in a
  fixture.  Renaming `util.get_area` to anything at all left it green.  What
  the row actually claims is a BRIDGE claim: the dispatcher resolves an
  unlisted root to `pymol.<root>`, so `util.get_area` reaches
  `pymol.util.get_area` with no panel, and every one of the five returns a
  plain float/int the codec can put on the wire.
* **`util.find_surface_residues` / `find_surface_atoms`** (row 502) cited a
  client-side catalogue test that asserts a `quiet: false` FLAG.  The flag is
  a workaround; nothing checked the thing being worked around.
* **`cmd.async_`** (row 483) cited a test that asserts only
  `call_reply(...)['t'] == 'ok'` for both halves.  `async_` returning
  immediately having done nothing at all would pass that.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p13_cmd_api_rpc.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

DATA = os.path.join(
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ),
    "packages",
    "engine",
    "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")

#: One object name for this module.  The PyMOL process is shared by the whole
#: run, so this must not `delete all` and must not take a common name.
OBJ = "zp13_il2"


@pytest.fixture()
def loaded(ws: WSClient):
    ws.call("cmd.load", IL2, OBJ)
    yield ws
    for name in (OBJ, "zp13_surf_res", "zp13_surf_atoms"):
        ws.call("cmd.delete", name)


def feedback_line(bridge, tag: str) -> str:
    lines = bridge.wait_for_feedback(tag, timeout=8.0)
    for line in lines:
        if tag in line and "print(" not in line and "def " not in line:
            return line
    raise AssertionError("no %s line in %r" % (tag, lines[-6:]))


# =========================================================================== #
# Row 501 — `util` scalar metrics
# =========================================================================== #


#: `(dotted call, python type of the answer)` — the five the row names.
SCALARS = [
    ("util.get_area", float),
    ("util.get_sasa", float),
    ("util.compute_mass", float),
    ("util.sum_formal_charges", int),
    ("util.sum_partial_charges", float),
]


@pytest.mark.parametrize("fn,pytype", SCALARS)
def test_each_scalar_metric_answers_with_a_plain_number(loaded, fn, pytype) -> None:
    """No panel, no shim: `util.<name>` resolves straight to `pymol.util`.

    The row's backend contract is exactly this sentence — "the dispatcher
    resolves an unlisted root to `pymol.<root>`, so `util.get_area` is
    `pymol.util.get_area`. All return plain float/int".  `util` is not in
    `_ROOT_MODULES`; it is in `DEFAULT_ROOTS`, and the fallback
    `"pymol.%s" % root` is what makes the call land.

    Asserting the TYPE and not just "it did not error" matters: the codec has
    a table, and a helper that started returning a chempy object or a tuple
    would answer `NotSerializable` — which is what `get_sasa_relative` does
    (row 504) and why that one needs a shim and these five do not.
    """
    value = loaded.call(fn, OBJ)
    assert isinstance(value, (int, float)) and not isinstance(value, bool), (fn, value)
    # int is a legal wire form for a float-typed answer (`compute_mass` of an
    # empty selection is 0), so widen rather than demand exactness.
    if pytype is int:
        assert isinstance(value, int), (fn, type(value).__name__)
    assert value == value, (fn, value)  # not NaN -- the codec nulls those


def test_the_numbers_are_real_measurements_not_zero(loaded) -> None:
    """A stub returning 0.0 would satisfy a type check and mean nothing.

    il2.pdb is a 126-residue protein: it has thousands of square Angstroms of
    surface and a mass in the tens of kDa.
    """
    assert loaded.call("util.get_area", OBJ) > 1000.0
    assert loaded.call("util.get_sasa", OBJ) > 1000.0
    assert 10_000.0 < loaded.call("util.compute_mass", OBJ) < 100_000.0


def test_a_scalar_metric_PRINTS_when_quiet_is_off(loaded, bridge) -> None:
    """"run against a selection and print a number to the console".

    `quiet=1` is the default and the panel's default; with it off the helper
    puts its own line on the feedback topic, which is the console parity the
    row describes.
    """
    loaded.call("util.sum_partial_charges", OBJ, quiet=0)
    assert "util.sum_partial_charges: sum =" in feedback_line(
        bridge, "util.sum_partial_charges"
    )


# =========================================================================== #
# Row 502 — the two surface finders
# =========================================================================== #


def test_find_surface_residues_returns_the_NAME_of_a_real_selection(loaded) -> None:
    """`util.find_surface_residues(sele, name)` -> the selection name.

    Both halves: the return value is the name (not a count, not a list), and
    the named selection exists afterwards with fewer atoms than the object —
    a finder that selected everything would be indistinguishable from one that
    worked, if only the name were checked.
    """
    name = loaded.call("util.find_surface_residues", OBJ, "zp13_surf_res")
    assert name == "zp13_surf_res", name

    exposed = loaded.call("cmd.count_atoms", "zp13_surf_res")
    total = loaded.call("cmd.count_atoms", OBJ)
    assert 0 < exposed < total, (exposed, total)


def test_neither_finder_accepts_quiet(loaded) -> None:
    """The constraint the client catalogue's `quiet: false` flag exists for.

    `find_surface_residues(sele, name='', _self=cmd)` and
    `find_surface_atoms(sele, name='', cutoff=-1, _self=cmd)` have no `quiet`
    parameter, so a dispatcher that helpfully appended a universal `quiet=1`
    would break exactly these two and nothing else.  The error is a plain
    Python `TypeError`, so it reaches the client as `PythonError` rather than
    as a `CmdException`.
    """
    for fn in ("util.find_surface_residues", "util.find_surface_atoms"):
        reply = loaded.call_reply(fn, OBJ, "zp13_quiet_probe", quiet=1)
        assert reply["t"] == "err", (fn, reply)
        assert reply["error"]["kind"] == "PythonError", (fn, reply["error"])
        assert "unexpected keyword argument 'quiet'" in reply["error"]["message"], (
            fn,
            reply["error"]["message"],
        )


def test_find_surface_atoms_takes_a_CUTOFF_that_changes_the_answer(loaded) -> None:
    """The third positional the residue finder does not have.

    A cutoff of 0 A**2 accepts any atom with any exposure at all; a large one
    accepts almost none.  Asserting the two differ is what proves the argument
    is bound to the parameter rather than swallowed by `name`.
    """
    loaded.call("util.find_surface_atoms", OBJ, "zp13_surf_atoms", 0)
    permissive = loaded.call("cmd.count_atoms", "zp13_surf_atoms")
    loaded.call("util.find_surface_atoms", OBJ, "zp13_surf_atoms", 40)
    strict = loaded.call("cmd.count_atoms", "zp13_surf_atoms")
    assert permissive > strict, (permissive, strict)


# =========================================================================== #
# Row 483 — `cmd.async_` / `cmd.sync`
# =========================================================================== #


def test_async_really_runs_on_ANOTHER_thread_and_sync_joins_it(ws, bridge) -> None:
    """The row's three claims, measured instead of assumed.

    1. the callable runs on a DIFFERENT thread from the caller (a daemon
       `threading.Thread`, `commanding.py:934`);
    2. while it is alive it is tracked in `commanding.async_threads`
       (`commanding.py:916`) — a module global, NOT a `cmd` attribute, which
       is itself worth pinning: a client cannot ask "is anything running?"
       through the dispatcher, because the dispatcher only invokes callables;
    3. `cmd.sync()` joins every one of them before returning
       (`commanding.py:398-399`), so `async_threads` is empty and the work is
       finished by the time it comes back.

    The whole thing runs through `{t:'do'}` so it executes on the engine
    thread, which is the thread the client's own calls run on: that is the
    thread `async_` has to NOT be.
    """
    ws.do(
        "exec(\"import threading, time\\n"
        "from pymol import commanding as zp13_cmg\\n"
        "zp13_async = {}\\n"
        "def zp13_slow():\\n"
        "    zp13_async['worker'] = threading.get_ident()\\n"
        "    time.sleep(0.4)\\n"
        "    zp13_async['done'] = True\\n\")"
    )
    if True:
        # Caller identity + the thread count before anything is spawned.
        ws.do(
            "import threading; zp13_async['caller'] = threading.get_ident(); "
            "print('ZP13A_BEFORE', len(zp13_cmg.async_threads))"
        )
        assert "ZP13A_BEFORE 0" in feedback_line(bridge, "ZP13A_BEFORE")

        # Spawn, and look at the tracking list while the worker is still in
        # its sleep.  `do` returns as soon as `async_` has started the thread.
        ws.do(
            "cmd.async_(zp13_slow); "
            "print('ZP13A_LIVE', len(zp13_cmg.async_threads))"
        )
        assert "ZP13A_LIVE 1" in feedback_line(bridge, "ZP13A_LIVE")
        assert ws.call_reply("cmd.sync")["t"] == "ok"

        ws.do(
            "print('ZP13A_AFTER', len(zp13_cmg.async_threads), "
            "zp13_async.get('done'), "
            "zp13_async['worker'] != zp13_async['caller'])"
        )
        line = feedback_line(bridge, "ZP13A_AFTER")
        assert line.strip() == "ZP13A_AFTER 0 True True", line
