"""Wave 8 — closing the gap clauses of the areas 3 / 4 / 11 partial rows.

Every test here exists to answer ONE sentence in
``docs/feature-parity.md``. The sentence is quoted in the
docstring so a reader can check the test against the claim it retires.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p8_a34.py -q
"""

from __future__ import annotations

import ast
import json
import os
import sys
import time
from typing import Any, Dict, List

import pytest

from conftest import slow

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

#: The committed fixture the web test diffs `tableForMode()` against.
BUTMODE_FIXTURE = os.path.join(
    REPO, "packages", "viewport", "src", "input", "__fixtures__", "p8a34-butmode.json"
)


_TAG_SEQ = [0]


def value(ws: WSClient, bridge, tag: str, expression: str) -> Any:
    """Evaluate in PyMOL and parse the printed repr.

    Attributes are not fetchable — the dispatcher invokes CALLABLES only — and
    PyMOL echoes the command line before running it, so the echo has to be
    skipped.

    The tag is made UNIQUE per call. ``feedback_lines()`` is cumulative, so a
    repeated tag matches the PREVIOUS answer and the assertion silently checks
    a stale value — measured while writing this file: an `alter` that had
    really run read back as unchanged.
    """
    _TAG_SEQ[0] += 1
    tag = "%s_%d" % (tag, _TAG_SEQ[0])
    ws.do("print('%s', %s)" % (tag, expression))
    lines = bridge.wait_for_feedback(tag, timeout=10.0)
    for line in lines:
        if tag in line and "print(" not in line:
            return ast.literal_eval(line.split(tag, 1)[1].strip())
    raise AssertionError("no %s output in %r" % (tag, lines[-6:]))


# =====================================================================
# Area 4 — "`cmd.button` bit-packing" and "Mouse configuration rings"
#
#   NOT verified: the packed integer a `cmd.button` write actually sends.
#   NOT verified: that each ring's 80-slot table matches PyMOL's own for
#   that mode, slot by slot.
#
# Both are the same measurement: intercept `_cmd.button` — the C entry point
# `cmd.button` hands its arithmetic to — and record the `(but_code, act_code)`
# pairs PyMOL itself computes. The spy does NOT call through, so the shared
# process's real ButMode table is never written.
# =====================================================================

_CAPTURE_SRC = r"""
import json

_zz_log = []
_zz_orig = cmd._cmd.button


def _zz_spy(cob, but_code, act_code):
    _zz_log.append([int(but_code), int(act_code)])
    return 1  # is_ok(1) -- and the real ButMode table stays untouched


_zz_out = {'tables': {}, 'pairs': {}, 'writes': {}}
cmd._cmd.button = _zz_spy
try:
    for _zz_mode in sorted(cmd.controlling.mode_dict):
        _zz_log[:] = []
        for _zz_row in cmd.controlling.mode_dict[_zz_mode]:
            cmd.button(*_zz_row)
        _zz_table = [-1] * 80
        for _zz_slot, _zz_act in _zz_log:
            _zz_table[_zz_slot] = _zz_act
        _zz_out['tables'][_zz_mode] = _zz_table
        _zz_out['writes'][_zz_mode] = list(_zz_log)
    for _zz_b in cmd.controlling.button_code:
        for _zz_m in cmd.controlling.but_mod_code:
            _zz_log[:] = []
            cmd.button(_zz_b, _zz_m, 'rota')
            _zz_out['pairs']['%s/%s' % (_zz_b, _zz_m)] = _zz_log[0][0]
    # the abbreviation matcher: 'l'/'shf'/'pka' must pack like the full names
    _zz_log[:] = []
    cmd.button('left', 'shft', 'pkat')
    cmd.button('l', 'shf', 'pka')
    _zz_out['abbrev'] = list(_zz_log)
    # ... and refuse an AMBIGUOUS prefix rather than guessing
    _zz_out['ambiguous'] = ''
    try:
        cmd.button('left', 'shft', 'rot')
    except Exception as _zz_exc:
        _zz_out['ambiguous'] = type(_zz_exc).__name__
finally:
    cmd._cmd.button = _zz_orig

with open(__ZZ_PATH__, 'w') as _zz_fh:
    json.dump(_zz_out, _zz_fh, indent=1, sort_keys=True)
"""


@pytest.fixture(scope="module")
def butmode(bridge) -> Dict[str, Any]:
    """PyMOL's own packed `(but_code, act_code)` writes, captured once."""
    ws = WSClient(bridge.ws_url)
    try:
        path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "_p8a34_butmode.json"
        )
        if os.path.exists(path):
            os.unlink(path)
        source = _CAPTURE_SRC.replace("__ZZ_PATH__", repr(path))
        reply = ws.do("exec(%r)" % source)
        assert reply["t"] == "ok", reply
        deadline = time.monotonic() + 20.0
        while time.monotonic() < deadline and not os.path.exists(path):
            time.sleep(0.05)
        assert os.path.exists(path), "capture never wrote %s" % path
        with open(path) as handle:
            data = json.load(handle)
        os.unlink(path)
        return data
    finally:
        ws.close()


def test_the_spy_captured_every_mode(butmode) -> None:
    assert sorted(butmode["tables"]) == sorted(
        [
            "default",
            "one_button_viewing",
            "three_button_editing",
            "three_button_lights",
            "three_button_maestro",
            "three_button_motions",
            "three_button_viewing",
            "two_button_editing",
            "two_button_lights",
            "two_button_selecting",
            "two_button_viewing",
        ]
    ), sorted(butmode["tables"])


def test_the_packed_slot_of_every_button_modifier_pair(butmode) -> None:
    """The row's spec, arithmetic first: `button_num<3 -> b + 3*m` (m<4) else
    `b + 68 + 3*(m-4)`; wheel -> `12+m` / `64+m-4`; single/double ->
    `(16 + b-4) + m*6`. These are the integers PyMOL actually sent."""
    pairs = butmode["pairs"]
    assert len(pairs) == 80, len(pairs)  # 10 buttons x 8 modifiers

    # normal buttons, no ALT: left/middle/right x none/shft/ctrl/ctsh -> 0..11
    assert pairs["left/none"] == 0
    assert pairs["middle/none"] == 1
    assert pairs["right/none"] == 2
    assert pairs["left/shft"] == 3
    assert pairs["right/ctsh"] == 11
    # normal buttons WITH alt jump the wheel block entirely: 68..79
    assert pairs["left/alt"] == 68
    assert pairs["right/ctas"] == 79
    # wheel
    assert pairs["wheel/none"] == 12
    assert pairs["wheel/ctsh"] == 15
    assert pairs["wheel/alt"] == 64
    assert pairs["wheel/ctas"] == 67
    # single / double clicks
    assert pairs["double_left/none"] == 16
    assert pairs["single_right/none"] == 21
    assert pairs["double_left/shft"] == 22
    assert pairs["single_right/ctas"] == 63

    # and nothing collides: 80 distinct slots for 80 pairs, filling 0..79
    assert sorted(pairs.values()) == list(range(80)), sorted(pairs.values())


def test_the_abbreviation_matcher_packs_the_same_slot(butmode) -> None:
    """`cmd.button('l','shf','pka')` must land where the spelled-out call does —
    the row's reason for never packing in JS.

    And an ambiguous prefix is REFUSED, not guessed: measured, `'rot'` matches
    six actions (roto/rotf/rotl/rotv/rota/rotz) and raises.
    """
    assert butmode["abbrev"] == [[3, 13], [3, 13]], butmode["abbrev"]
    assert butmode["ambiguous"] == "QuietException", butmode["ambiguous"]


def test_the_action_codes_are_the_ButMode_h_constants(butmode) -> None:
    """A slot value is `cButMode*` from `packages/engine/layer1/ButMode.h`, not an index into
    the mode's own row list."""
    table = butmode["tables"]["three_button_viewing"]
    assert table[0] == 0, table[0]  # left/none  -> rota (cButModeRotXYZ)
    assert table[1] == 1, table[1]  # middle     -> move (cButModeTransXY)
    assert table[2] == 2, table[2]  # right      -> movz (cButModeTransZ)
    assert table[12] == 25, table[12]  # wheel   -> slab (cButModeScaleSlab)


def test_the_shipped_fixture_matches_pymols_own_tables_slot_by_slot(butmode) -> None:
    """The web half of this pair (`p8a34butmode.test.ts`) diffs
    `tableForMode()` against this file; this asserts the file is PyMOL."""
    assert os.path.exists(BUTMODE_FIXTURE), BUTMODE_FIXTURE
    with open(BUTMODE_FIXTURE) as handle:
        shipped = json.load(handle)
    assert shipped["tables"] == butmode["tables"], "fixture is stale"
    assert shipped["pairs"] == butmode["pairs"], "fixture is stale"


# =====================================================================
# Area 11 — "Command keyword table + parsing modes"
#
#   NOT verified: the individual parsing modes (STRICT / LITERAL1 /
#   LITERAL2 / SECURE) and their argument coercion.
#
# The mode is `keyword[kw][4]` and it changes what ONE typed line means, so it
# is checked by typing lines whose result differs per mode.
# =====================================================================

OBJ = "zz_p8p"
PSEUDO = "zz_p8ps"


@pytest.fixture(scope="module")
def parse_ws(bridge):
    ws = WSClient(bridge.ws_url)
    ws.call("cmd.delete", OBJ)
    ws.call("cmd.delete", PSEUDO)
    ws.call("cmd.fragment", "ala", OBJ)
    yield ws
    ws.call("cmd.delete", OBJ)
    ws.call("cmd.delete", PSEUDO)
    ws.close()


def _bq(ws: WSClient, bridge) -> List[float]:
    return value(
        ws,
        bridge,
        "ZP8BQ",
        "[round(a.b, 4) for a in cmd.get_model('%s').atom][:1] + "
        "[round(a.q, 4) for a in cmd.get_model('%s').atom][:1]" % (OBJ, OBJ),
    )


def test_LITERAL1_keeps_the_commas_inside_the_expression(parse_ws, bridge) -> None:
    """`alter` is `parsing.LITERAL1`: ONE regular argument, then the rest of
    the line verbatim. A comma-splitting parser would hand `alter` four
    positional arguments and raise."""
    parse_ws.call("cmd.alter", OBJ, "b, q = 0.0, 0.0")
    assert _bq(parse_ws, bridge) == [0.0, 0.0]
    reply = parse_ws.do("alter %s, (b, q) = (7.25, 0.5)" % OBJ)
    assert reply["t"] == "ok", reply
    assert _bq(parse_ws, bridge) == [7.25, 0.5]


def test_LITERAL1_does_not_split_on_the_SEMICOLON_either(parse_ws, bridge) -> None:
    """`layer.next = []` (`parser.py:277-278`) — the literal swallows the rest
    of the line, so a `;` inside it is Python, not a second command."""
    parse_ws.call("cmd.alter", OBJ, "b, q = 0.0, 0.0")
    reply = parse_ws.do("alter %s, b = 1.5; q = 0.75" % OBJ)
    assert reply["t"] == "ok", reply
    assert _bq(parse_ws, bridge) == [1.5, 0.75], (
        "the ';' split the line: only the first half ran"
    )


def test_a_STRICT_keyword_DOES_split_on_the_same_semicolon(parse_ws, bridge) -> None:
    """The counterfactual that makes the LITERAL1 test mean something."""
    parse_ws.call("cmd.delete", PSEUDO)
    reply = parse_ws.do("pseudoatom %s; pseudoatom %s" % (PSEUDO, PSEUDO))
    assert reply["t"] == "ok", reply
    assert parse_ws.call("cmd.count_atoms", PSEUDO) == 2
    parse_ws.call("cmd.delete", PSEUDO)


def test_LITERAL2_takes_TWO_regular_arguments_before_the_literal(parse_ws, bridge):
    """`alter_state` is `parsing.LITERAL2`: state, selection, then the rest."""
    reply = parse_ws.do("alter_state 1, %s, (x, y, z) = (1.5, 2.5, 3.5)" % OBJ)
    assert reply["t"] == "ok", reply
    coords = value(
        parse_ws,
        bridge,
        "ZP8XYZ",
        "[round(v, 4) for v in cmd.get_atom_coords('%s and index 1')]" % OBJ,
    )
    assert coords == [1.5, 2.5, 3.5], coords
    # and a ';' inside the third argument is Python here too
    reply = parse_ws.do("alter_state 1, %s, x = 9.0; y = 8.0" % OBJ)
    assert reply["t"] == "ok", reply
    coords = value(
        parse_ws,
        bridge,
        "ZP8XYZ2",
        "[round(v, 4) for v in cmd.get_atom_coords('%s and index 1')]" % OBJ,
    )
    assert coords == [9.0, 8.0, 3.5], coords


def test_STRICT_keeps_a_BRACKETED_argument_whole(parse_ws, bridge) -> None:
    """`arg_easy_nester_re` (`parsing.py:98`): `[1,2,3]` is ONE argument even
    though it contains the separator."""
    parse_ws.call("cmd.delete", PSEUDO)
    reply = parse_ws.do("pseudoatom %s, pos=[4,5,6]" % PSEUDO)
    assert reply["t"] == "ok", reply
    coords = value(
        parse_ws,
        bridge,
        "ZP8PS",
        "[round(v, 4) for v in cmd.get_atom_coords('%s')]" % PSEUDO,
    )
    assert coords == [4.0, 5.0, 6.0], coords
    parse_ws.call("cmd.delete", PSEUDO)


def test_STRICT_coerces_the_string_the_parser_produced(parse_ws) -> None:
    """Every parsed argument is a STRING; `prepare_call` binds it by the
    callee's own signature and the callee converts. `0.7` typed on the command
    line has to come back out of `get_setting_float` as a float."""
    parse_ws.do("set sphere_scale, 0.7, %s" % OBJ)
    got = parse_ws.call("cmd.get_setting_float", "sphere_scale", OBJ)
    assert abs(got - 0.7) < 1e-6, got
    parse_ws.call("cmd.unset", "sphere_scale", OBJ)


_SECURE_SRC = r"""
import json

_zz = {}
_zz['exit_on_error'] = int(cmd._pymol.invocation.options.exit_on_error)


def _zz_probe(line):
    # Parser._parse CATCHES SecurityException and answers None; a QuietException
    # answers 0 and a clean run answers 1 (parser.py:466-480).
    if _zz['exit_on_error']:
        return 'REFUSED-TO-RUN'
    try:
        return repr(cmd._parser.parse(line, 1))
    except Exception as _zz_e:
        return type(_zz_e).__name__


_zz['secure'] = {
    'png': _zz_probe('png /tmp/zz_p8_never_written.png'),
    'save': _zz_probe('save /tmp/zz_p8_never_written.pdb, __ZZ_OBJ__'),
    'run': _zz_probe('run /tmp/zz_p8_no_such_script.py'),
    'spawn': _zz_probe('spawn /tmp/zz_p8_no_such_script.py'),
    'mpng': _zz_probe('mpng /tmp/zz_p8_never'),
    'alter': _zz_probe('alter __ZZ_OBJ__, b = 42.0'),
    'iterate': _zz_probe('iterate __ZZ_OBJ__, print(name)'),
    'python_slash': _zz_probe('/print(1)'),
    'color': _zz_probe('color red, __ZZ_OBJ__'),
}
_zz['open'] = {
    'alter': repr(cmd._parser.parse('alter __ZZ_OBJ__, b = 42.0', 0)),
    'color': repr(cmd._parser.parse('color blue, __ZZ_OBJ__', 0)),
}
_zz['b_after'] = round(cmd.get_model('__ZZ_OBJ__').atom[0].b, 4)
_zz['png_written'] = os.path.exists('/tmp/zz_p8_never_written.png')
_zz['pdb_written'] = os.path.exists('/tmp/zz_p8_never_written.pdb')
_zz['modes'] = {
    _zz_k: cmd.keyword[_zz_k][4]
    for _zz_k in ('alter', 'alter_state', 'iterate', 'label', 'set_key', 'alias',
                  'png', 'save', 'run', 'spawn', 'fork', 'mpng', 'color',
                  'system', 'mdo', 'mappend')
}
with open(__ZZ_PATH__, 'w') as _zz_fh:
    json.dump(_zz, _zz_fh, indent=1, sort_keys=True)
"""


@pytest.fixture(scope="module")
def secure(bridge, parse_ws) -> Dict[str, Any]:
    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "_p8a34_secure.json"
    )
    for stale in (path, "/tmp/zz_p8_never_written.png", "/tmp/zz_p8_never_written.pdb"):
        if os.path.exists(stale):
            os.unlink(stale)
    source = _SECURE_SRC.replace("__ZZ_PATH__", repr(path)).replace("__ZZ_OBJ__", OBJ)
    reply = parse_ws.do("exec(%r)" % source)
    assert reply["t"] == "ok", reply
    deadline = time.monotonic() + 30.0
    while time.monotonic() < deadline and not os.path.exists(path):
        time.sleep(0.05)
    assert os.path.exists(path), "the secure probe never wrote its result"
    with open(path) as handle:
        data = json.load(handle)
    os.unlink(path)
    return data


def test_the_secure_probe_could_not_have_killed_the_engine(secure) -> None:
    """`_parse` ends with `if not p_result and options.exit_on_error:
    self.cmd.quit(1)` — a refused command in a `+ea` session QUITS PyMOL, and
    this suite shares one. Measured: the bridge starts with it 0."""
    assert secure["exit_on_error"] == 0, secure["exit_on_error"]


def test_the_five_measured_modes_are_what_the_row_claims(secure) -> None:
    """STRICT 11, SECURE 12, LITERAL 20, LITERAL1 21, LITERAL2 22
    (`parsing.py:76-91`)."""
    assert secure["modes"] == {
        "alter": 21,
        "alter_state": 22,
        "iterate": 21,
        "label": 21,
        "set_key": 21,
        "alias": 21,
        "png": 12,
        "save": 12,
        "run": 12,
        "spawn": 12,
        "fork": 12,
        "mpng": 12,
        "color": 11,
        "system": 20,
        "mdo": 1,
        "mappend": 1,
    }, secure["modes"]


@pytest.mark.parametrize("keyword", ["png", "save", "run", "spawn", "mpng"])
def test_a_SECURE_keyword_is_REFUSED_in_a_secure_parse(secure, keyword) -> None:
    """`raise SecurityException('Command disallowed in this file')`, caught by
    `_parse` and reported as `None` (`parser.py:283-285, 471-473`)."""
    assert secure["secure"][keyword] == "None", (keyword, secure["secure"])


@pytest.mark.parametrize("keyword", ["alter", "iterate"])
def test_a_LITERAL_keyword_is_REFUSED_TOO_and_earlier(secure, keyword) -> None:
    """`>= parsing.LITERAL` raises 'Python expressions disallowed in this file'
    BEFORE the SECURE check — a literal argument is arbitrary Python."""
    assert secure["secure"][keyword] == "None", (keyword, secure["secure"])


def test_a_STRICT_keyword_still_RUNS_in_a_secure_parse(secure) -> None:
    """Secure mode is not a global mute: `color` is `parsing.STRICT` and runs."""
    assert secure["secure"]["color"] == "1", secure["secure"]
    assert secure["open"]["color"] == "1", secure["open"]


def test_leading_slash_python_is_refused_in_a_secure_parse(secure) -> None:
    assert secure["secure"]["python_slash"] == "None", secure["secure"]


def test_the_refusals_really_did_not_run(secure) -> None:
    """The strongest form of the claim: no file was written and `b` never
    became 42, while the SAME `alter` line at secure=0 did set it."""
    assert secure["png_written"] is False
    assert secure["pdb_written"] is False
    assert secure["open"]["alter"] == "1", secure["open"]
    assert secure["b_after"] == 42.0, secure["b_after"]


# =====================================================================
# Area 11 — "Legacy extension mechanisms (`extend` / `extendaa` / `alias`)"
#
#   NOT verified: `extend`, `extendaa`, and auto-arg registration for
#   extended keywords.
#
# All three write into PROCESS-GLOBAL tables (`cmd.keyword`, `cmd.kwhash`,
# `cmd.help_sc`, `cmd.auto_arg`) that the whole suite shares, so the fixture
# tears every entry back out again — `Shortcut.__delitem__` rebuilds the
# prefix table (`packages/engine/modules/pymol/shortcut.py:46-48,94`).
# =====================================================================

_EXTEND_SETUP = r"""
import json

# SNAPSHOT FIRST.  There is no unregister API, and the obvious way to undo a
# registration -- `del cmd.kwhash[name]` -- calls `Shortcut.__delitem__`, which
# calls `self.rebuild()` with NO argument, and `rebuild(None)` sets
# `self.keywords = []` (`packages/engine/modules/pymol/shortcut.py:46-48, 94-101`).  It wipes
# the whole 314-keyword completion table.  Measured: after one `del`,
# `cmd._parser.complete('colo')` answers None and three other test files fail.
zz_p8_kwhash_snapshot = list(cmd.kwhash.keywords)
zz_p8_helpsc_snapshot = list(cmd.help_sc.keywords)


def zz_p8_ext(moo=2):
    cmd.set_title('__ZZ_OBJ__', 1, 'ext:%s|%s' % (moo, type(moo).__name__))


cmd.extend('zz_p8_ext', zz_p8_ext)


@cmd.extendaa(cmd.auto_arg[0]['zoom'])
def zz_p8_aa(selection='*'):
    cmd.set_title('__ZZ_OBJ__', 1, 'aa:%s' % (selection,))


cmd.alias('zz_p8_ali', "set_title __ZZ_OBJ__, 1, aliased")

_zz = {
    'modes': {n: cmd.keyword[n][4] for n in ('zz_p8_ext', 'zz_p8_aa', 'zz_p8_ali')},
    'rows': {n: cmd.keyword[n][1:4] for n in ('zz_p8_ext', 'zz_p8_aa', 'zz_p8_ali')},
    'kwhash': {p: cmd.kwhash.interpret(p) for p in ('zz_p8_e', 'zz_p8_aa', 'zz_p8_al')},
    'in_help_sc': {n: (n in cmd.help_sc) for n in ('zz_p8_ext', 'zz_p8_aa', 'zz_p8_ali')},
    'auto_arg0': sorted(k for k in cmd.auto_arg[0] if k.startswith('zz_p8')),
    'aa_is_zooms': cmd.auto_arg[0].get('zz_p8_aa') is cmd.auto_arg[0]['zoom'],
    'complete_aa': repr(cmd._parser.complete('zz_p8_aa __ZZ_OBJ_PREFIX__')),
    'complete_ext': repr(cmd._parser.complete('zz_p8_ext __ZZ_OBJ_PREFIX__')),
    'complete_kw': repr(cmd._parser.complete('zz_p8_e')),
}
with open(__ZZ_PATH__, 'w') as _zz_fh:
    json.dump(_zz, _zz_fh, indent=1, sort_keys=True)
"""

_EXTEND_TEARDOWN = r"""
for _zz_n in ('zz_p8_ext', 'zz_p8_aa', 'zz_p8_ali'):
    cmd.keyword.pop(_zz_n, None)
    for _zz_d in cmd.auto_arg:
        _zz_d.pop(_zz_n, None)
# Rebuild FROM THE SNAPSHOT, never `del`: see the note in the setup block.
cmd.kwhash.rebuild(zz_p8_kwhash_snapshot)
cmd.help_sc.rebuild(zz_p8_helpsc_snapshot)
print(
    'ZZP8_TORNDOWN',
    sorted(k for k in cmd.keyword if k.startswith('zz_p8')),
    sorted(k for k in cmd.kwhash.keywords if k.startswith('zz_p8')),
    len(cmd.kwhash.keywords),
    repr(cmd._parser.complete('colo')),
)
"""


@pytest.fixture(scope="module")
def extended(bridge, parse_ws) -> Dict[str, Any]:
    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "_p8a34_extend.json"
    )
    if os.path.exists(path):
        os.unlink(path)
    source = (
        _EXTEND_SETUP.replace("__ZZ_PATH__", repr(path))
        .replace("__ZZ_OBJ_PREFIX__", OBJ[:5])
        .replace("__ZZ_OBJ__", OBJ)
    )
    try:
        reply = parse_ws.do("exec(%r)" % source)
        assert reply["t"] == "ok", reply
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline and not os.path.exists(path):
            time.sleep(0.05)
        assert os.path.exists(path), "the extend probe never wrote its result"
        with open(path) as handle:
            data = json.load(handle)
        os.unlink(path)
        yield data
    finally:
        parse_ws.do("exec(%r)" % _EXTEND_TEARDOWN.replace("__ZZ_OBJ__", OBJ))

        # The marker alone is not enough to wait on: `cmd.do` echoes the
        # exec() source, which CONTAINS the marker, so the bare needle matches
        # the echo and returns before the print itself has landed -- and the
        # filter below then drops that echo and finds nothing. Wait for the
        # same line the filter keeps.
        def printed(line: str) -> bool:
            return "ZZP8_TORNDOWN" in line and "exec(" not in line

        lines = bridge.wait_for_feedback(
            "ZZP8_TORNDOWN", timeout=slow(20.0), where=printed
        )
        leftovers = [x for x in lines if printed(x)]
        assert leftovers, lines[-4:]
        report = leftovers[-1]
        assert "[] []" in report, (
            "the shared process still carries the test keywords: %r" % report
        )
        assert "'color'" in report, (
            "the keyword completion table did not survive teardown: %r" % report
        )


def test_extend_registers_a_STRICT_keyword(extended) -> None:
    """`keyword[name] = [function, 0, 0, ',', parsing.STRICT]`
    (`commanding.py:825`)."""
    assert extended["modes"]["zz_p8_ext"] == 11, extended["modes"]
    assert extended["rows"]["zz_p8_ext"] == [0, 0, ","], extended["rows"]


def test_extend_makes_the_name_ABBREVIABLE_like_a_builtin(extended) -> None:
    """`kwhash.append(name)` — without it the keyword exists but only in full."""
    assert extended["kwhash"]["zz_p8_e"] == "zz_p8_ext", extended["kwhash"]
    assert extended["complete_kw"] == "'zz_p8_ext '", extended["complete_kw"]


def test_an_extended_keyword_really_RUNS_over_the_wire(parse_ws) -> None:
    """The point of the row: a plugin-declared command reaches the parser."""
    parse_ws.call("cmd.set_title", OBJ, 1, "")
    reply = parse_ws.do("zz_p8_ext 7")
    assert reply["t"] == "ok", reply
    # STRICT hands the callee a STRING; the callee owns the conversion.
    assert parse_ws.call("cmd.get_title", OBJ, 1) == "ext:7|str"


def test_an_extended_keyword_binds_by_NAME_and_by_ABBREVIATION(parse_ws) -> None:
    parse_ws.call("cmd.set_title", OBJ, 1, "")
    assert parse_ws.do("zz_p8_ext moo=9")["t"] == "ok"
    assert parse_ws.call("cmd.get_title", OBJ, 1) == "ext:9|str"
    parse_ws.call("cmd.set_title", OBJ, 1, "")
    assert parse_ws.do("zz_p8_e 4")["t"] == "ok"
    assert parse_ws.call("cmd.get_title", OBJ, 1) == "ext:4|str"
    # and the default applies when the argument is omitted (an int, this time)
    parse_ws.call("cmd.set_title", OBJ, 1, "")
    assert parse_ws.do("zz_p8_ext")["t"] == "ok"
    assert parse_ws.call("cmd.get_title", OBJ, 1) == "ext:2|int"


def test_extendaa_extends_AND_registers_the_auto_arg(extended) -> None:
    """`extendaa` = `extend` + `auto_arg[i][name] = aa` (`commanding.py:846-854`)."""
    assert extended["modes"]["zz_p8_aa"] == 11, extended["modes"]
    assert extended["auto_arg0"] == ["zz_p8_aa"], extended["auto_arg0"]
    assert extended["aa_is_zooms"] is True


def test_the_auto_arg_actually_COMPLETES_an_argument(extended) -> None:
    """The discriminator. With the auto_arg entry, `zz_p8_aa zz_p8` completes
    to the object name through `zoom`'s selection Shortcut. WITHOUT it —
    `zz_p8_ext`, extended the plain way — the parser falls through to FILENAME
    completion and finds nothing (`parser.py:541-560`)."""
    assert extended["complete_aa"] == repr("zz_p8_aa " + OBJ), extended["complete_aa"]
    assert extended["complete_ext"] == "None", extended["complete_ext"]


def test_an_extendaa_keyword_runs_too(parse_ws) -> None:
    parse_ws.call("cmd.set_title", OBJ, 1, "")
    assert parse_ws.do("zz_p8_aa polymer")["t"] == "ok"
    assert parse_ws.call("cmd.get_title", OBJ, 1) == "aa:polymer"


def test_alias_registers_a_keyword_but_NOT_a_help_entry(extended) -> None:
    """Measured difference between the two mechanisms: `extend` appends to
    `help_sc` (`commanding.py:827`), `alias` does not (`:889-891`)."""
    assert extended["in_help_sc"]["zz_p8_ext"] is True
    assert extended["in_help_sc"]["zz_p8_aa"] is True
    assert extended["in_help_sc"]["zz_p8_ali"] is False


def test_an_alias_runs_its_literal_command_line(parse_ws) -> None:
    parse_ws.call("cmd.set_title", OBJ, 1, "")
    assert parse_ws.do("zz_p8_ali")["t"] == "ok"
    assert parse_ws.call("cmd.get_title", OBJ, 1) == "aliased"


# =====================================================================
# Area 11 — "Feedback level control (`fb_action` / `fb_module` / `fb_mask`)"
#
#   NOT verified: that the mask actually silences the feedback STREAM the
#   client subscribes to — that needs a subscriber assertion, not just a
#   return code.
#
# So every assertion below is on `WSClient.feedback`, the lines that arrived
# as `{t:'feedback'}` frames on the socket, not on a return value and not on
# the bridge-side drain.
# =====================================================================

FB_EXECUTIVE = 70  # constants.py:314
FB_ACTIONS = 0x08  # constants.py:335


def _stream(ws: WSClient, seconds: float = 0.6) -> List[str]:
    """Whatever the SUBSCRIBER received, then reset."""
    ws.pump_frames(seconds)
    lines = list(ws.feedback)
    del ws.feedback[:]
    return lines


@pytest.fixture
def feedback_ws(bridge, parse_ws):
    """A socket of its own, and feedback restored no matter what fails.

    A leaked `disable` would silence the module for the whole shared suite.
    """
    ws = WSClient(bridge.ws_url)
    # server.py:151 -- a feedback frame is only sent to sockets that asked.
    assert ws.subscribe("feedback")["t"] == "ok"
    try:
        yield ws
    finally:
        ws.call("cmd.feedback", "enable", "executive", "actions")
        ws.close()


def test_the_module_and_mask_indices_are_the_documented_ones(feedback_ws, bridge):
    got = value(
        feedback_ws,
        bridge,
        "ZP8FB",
        "[cmd.fb_module.executive, cmd.fb_mask.actions, cmd.fb_module.parser, "
        "cmd.fb_module.cmd, cmd.fb_mask.everything]",
    )
    assert got == [FB_EXECUTIVE, FB_ACTIONS, -1, -2, 0xFF], got


def test_disabling_a_module_SILENCES_the_subscribers_stream(feedback_ws) -> None:
    """The row's open question, answered on the socket."""
    feedback_ws.do("color red, %s" % OBJ)
    before = _stream(feedback_ws)
    assert any("Executive: Colored" in line for line in before), before

    feedback_ws.call("cmd.feedback", "disable", "executive", "actions")
    _stream(feedback_ws)
    feedback_ws.do("color blue, %s" % OBJ)
    during = _stream(feedback_ws)
    assert not any("Executive: Colored" in line for line in during), during
    # ... and the stream is still LIVE: the command echo still arrives, so the
    # absence above is the mask, not a dead socket.
    assert any("color blue" in line for line in during), during

    feedback_ws.call("cmd.feedback", "enable", "executive", "actions")
    _stream(feedback_ws)
    feedback_ws.do("color green, %s" % OBJ)
    after = _stream(feedback_ws)
    assert any("Executive: Colored" in line for line in after), after


def test_the_query_agrees_with_what_the_stream_did(feedback_ws, bridge) -> None:
    """`cmd._feedback(module, mask)` -> int, the readback the settings panel
    would bind a checkbox to."""
    assert value(feedback_ws, bridge, "ZP8FBQ1",
                 "cmd._feedback(%d, %d)" % (FB_EXECUTIVE, FB_ACTIONS)) == 1
    feedback_ws.call("cmd.feedback", "disable", "executive", "actions")
    assert value(feedback_ws, bridge, "ZP8FBQ2",
                 "cmd._feedback(%d, %d)" % (FB_EXECUTIVE, FB_ACTIONS)) == 0
    feedback_ws.call("cmd.feedback", "enable", "executive", "actions")
    assert value(feedback_ws, bridge, "ZP8FBQ3",
                 "cmd._feedback(%d, %d)" % (FB_EXECUTIVE, FB_ACTIONS)) == 1


def test_the_mask_is_PER_CATEGORY_not_per_module(feedback_ws) -> None:
    """`actions` off must not take `errors` with it — otherwise a client that
    turned down chatter would also lose its error reporting."""
    feedback_ws.call("cmd.feedback", "disable", "executive", "actions")
    _stream(feedback_ws)
    feedback_ws.do("color no_such_color_zz, %s" % OBJ)
    lines = _stream(feedback_ws)
    assert not any("Executive: Colored" in line for line in lines), lines
    assert any("Unknown color" in line or "Error" in line for line in lines), lines


# =====================================================================
# Area 4 — "Default keyboard shortcut table (100+ bindings)"
#
#   NOT verified: the other ~100 bindings, F-keys, and the ctrl/alt chord
#   fallbacks.
#
# `test_key_bindings.py` covers the GLUT special-key codes and the scene/view
# fallback. What was missing is the TABLE (every row, against
# `packages/engine/modules/pymol/shortcut_dict.py`), the F-key rows, and the three chord entry
# points. The table half is dumped here and diffed in `p8a34keys.test.ts`.
# =====================================================================

SHORTCUT_FIXTURE = os.path.join(
    REPO, "packages", "viewport", "src", "input", "__fixtures__", "p8a34-keys.json"
)

_KEYS_SRC = r"""
import json
from pymol import shortcut_dict

_zz = {
    'ref': {k: [v[0], v[1]] for k, v in shortcut_dict.shortcut_dict_ref.items()},
    'defaults': cmd.keyboard.get_default_keys(),
    'live': sorted(cmd.key_mappings),
    'live_strings': {k: v for k, v in cmd.key_mappings.items() if isinstance(v, str)},
    'live_callables': sorted(
        k for k, v in cmd.key_mappings.items() if not isinstance(v, str)
    ),
    'special_key_codes': {
        str(k): v for k, v in cmd.internal.special_key_codes.items()
    },
    'modifier_keys': list(cmd.internal.modifier_keys),
}
with open(__ZZ_PATH__, 'w') as _zz_fh:
    json.dump(_zz, _zz_fh, indent=1, sort_keys=True)
"""


@pytest.fixture(scope="module")
def keytable(bridge) -> Dict[str, Any]:
    ws = WSClient(bridge.ws_url)
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_p8a34_keys.json")
        if os.path.exists(path):
            os.unlink(path)
        reply = ws.do("exec(%r)" % _KEYS_SRC.replace("__ZZ_PATH__", repr(path)))
        assert reply["t"] == "ok", reply
        deadline = time.monotonic() + 20.0
        while time.monotonic() < deadline and not os.path.exists(path):
            time.sleep(0.05)
        assert os.path.exists(path), "the key-table probe never wrote its result"
        with open(path) as handle:
            data = json.load(handle)
        os.unlink(path)
        return data
    finally:
        ws.close()


def test_the_default_table_has_the_measured_number_of_rows(keytable) -> None:
    """125 rows in the STATIC reference table.

    NOT in `cmd.key_mappings`: that is process-global and every `cmd.set_key`
    anywhere in this shared suite mutates it. Measured while writing this file
    -- running with `test_shortcuts.py` first it holds 128, and with more of
    the suite 130. `keyboard.get_default_keys()` recomputes the defaults from
    `shortcut_dict_ref` and is the order-independent question.
    """
    assert len(keytable["ref"]) == 125, len(keytable["ref"])
    assert len(keytable["defaults"]) == 125, len(keytable["defaults"])


def test_every_default_row_is_LIVE_in_key_mappings(keytable) -> None:
    """`shortcut_dict_ref` is the reference table; `cmd.key_mappings` is what
    `_invoke_key` actually consults. They must not diverge, or the editor shows
    a binding the runtime does not have.

    Checked against `keyboard.get_default_keys()` -- the function that BUILDS
    the runtime table (`keyboard.py:87-93`) -- key for key and command for
    command, and then only for PRESENCE against the live table, which the
    shared suite legitimately adds to.
    """
    defaults = keytable["defaults"]
    assert sorted(defaults) == sorted(keytable["ref"]), (
        set(defaults) ^ set(keytable["ref"])
    )
    drift = {
        key: (value[0], defaults[key])
        for key, value in keytable["ref"].items()
        if value[0] != defaults[key]
    }
    assert drift == {}, drift

    # The LIVE table is only checked for the rows this run has not disturbed.
    # `test_shortcuts.py:320` does `cmd.key_mappings.pop('CTRL-Y', None)` and
    # never puts the default back, so a strict superset assertion here would
    # fail on another file's leak rather than on anything this row is about.
    missing = sorted(set(keytable["ref"]) - set(keytable["live"]))
    assert len(missing) <= 2, missing
    assert isinstance(keytable["live"], list) and len(keytable["live"]) >= 120, len(
        keytable["live"]
    )


def test_the_F_KEY_rows_are_exactly_CTRL_and_CTSH_store(keytable) -> None:
    """`CTRL-Fn` = `scene Fn, store`, `CTSH-Fn` = `scene SHFT-Fn, store`, for
    n = 1..12 — and BARE `Fn` is unbound, which is what lets it fall through
    to the scene/view name lookup."""
    ref = keytable["ref"]
    for n in range(1, 13):
        assert ref["CTRL-F%d" % n][0] == "scene F%d, store" % n, n
        assert ref["CTSH-F%d" % n][0] == "scene SHFT-F%d, store" % n, n
        assert "F%d" % n not in ref, "bare F%d must stay unbound" % n
        assert "SHFT-F%d" % n not in ref, "bare SHFT-F%d must stay unbound" % n
        assert "F%d" % n not in keytable["defaults"], n


def test_the_chord_entry_points_build_the_names_the_table_uses(keytable) -> None:
    """`_ctrl('A')` -> `CTRL-A`, `_alt(k)` -> `ALT-` + k.UPPER(), `_ctsh('A')`
    -> `CTSH-A` (`internal.py:487-511`). The ALT branch is the odd one and the
    table agrees with it: every ALT letter row is upper-case."""
    alt_letters = [
        k for k in keytable["ref"] if k.startswith("ALT-") and len(k) == 5 and k[4].isalpha()
    ]
    assert alt_letters, keytable["ref"].keys()
    assert all(k == k.upper() for k in alt_letters), alt_letters
    assert keytable["modifier_keys"] == ["", "SHFT", "CTRL", "CTSH", "ALT"], (
        keytable["modifier_keys"]
    )


def test_the_shipped_shortcut_fixture_is_pymols_own_table(keytable) -> None:
    """`p8a34keys.test.ts` diffs `DEFAULT_SHORTCUTS` against this file."""
    assert os.path.exists(SHORTCUT_FIXTURE), SHORTCUT_FIXTURE
    with open(SHORTCUT_FIXTURE) as handle:
        shipped = json.load(handle)
    assert shipped["ref"] == keytable["ref"], "fixture is stale"
    assert shipped["special_key_codes"] == keytable["special_key_codes"]
    assert shipped["modifier_keys"] == keytable["modifier_keys"]


@pytest.fixture
def chord_ws(bridge):
    """Three scratch chords, removed however the test ends."""
    ws = WSClient(bridge.ws_url)
    names = ("CTRL-Q", "ALT-Q", "CTSH-Q")
    try:
        for name in names:
            ws.call("cmd.set_key", name, "print('ZP8CHORD %s')" % name)
        yield ws
    finally:
        ws.do(
            "[cmd.key_mappings.pop(k, None) for k in %r]" % (list(names),)
        )
        ws.close()


@pytest.mark.parametrize(
    "entry,arg,expected",
    [
        ("cmd._ctrl", "Q", "CTRL-Q"),
        ("cmd._alt", "q", "ALT-Q"),  # _alt upper-cases its argument
        ("cmd._alt", "Q", "ALT-Q"),
        ("cmd._ctsh", "Q", "CTSH-Q"),
    ],
)
def test_a_chord_entry_point_fires_the_binding_it_names(
    chord_ws, bridge, entry, arg, expected
) -> None:
    assert chord_ws.call_reply(entry, arg)["t"] == "ok"
    lines = bridge.wait_for_feedback("ZP8CHORD %s" % expected, timeout=5.0)
    assert any("ZP8CHORD %s" % expected in line for line in lines), lines[-4:]


def test_CTRL_is_case_SENSITIVE_where_ALT_is_not(chord_ws, bridge) -> None:
    """Measured asymmetry, and a real client trap: `_ctrl` looks the key up
    verbatim, so a lower-case `q` misses the `CTRL-Q` row and reports no
    mapping, while `_alt` upper-cases first."""
    assert chord_ws.call_reply("cmd._ctrl", "q")["t"] == "ok"
    lines = bridge.wait_for_feedback("No key mapping for 'CTRL-q'", timeout=5.0)
    assert any("No key mapping for 'CTRL-q'" in line for line in lines), lines[-4:]


def test_a_REAL_default_chord_runs_without_anyone_binding_it(bridge, keytable):
    """One of the ~100 rows, end to end: `CTRL-A` is `select sele, all, 1`.

    The row is RESTORED to its default first and put back afterwards. Not
    paranoia: `test_shortcuts.py` rebinds `CTRL-A` to `delete zz_key_probe` and
    does not undo it, so in a run that reaches this file second the chord fires
    a delete and no selection appears -- measured exactly that.
    """
    ws = WSClient(bridge.ws_url)
    saved_default = keytable["ref"]["CTRL-A"][0]
    try:
        ws.do("zz_p8_saved_ctrl_a = cmd.key_mappings.get('CTRL-A')")
        ws.call("cmd.set_key", "CTRL-A", saved_default)
        ws.call("cmd.delete", "sele")
        ws.call("cmd.delete", "zz_p8key")
        ws.call("cmd.fragment", "ala", "zz_p8key")
        assert ws.call_reply("cmd._ctrl", "A")["t"] == "ok"
        deadline = time.monotonic() + 5.0
        count = 0
        while time.monotonic() < deadline:
            count = ws.call("cmd.count_atoms", "sele")
            if count:
                break
            time.sleep(0.05)
        assert count >= 10, count
    finally:
        ws.do(
            "cmd.key_mappings['CTRL-A'] = zz_p8_saved_ctrl_a "
            "if zz_p8_saved_ctrl_a is not None "
            "else cmd.key_mappings.pop('CTRL-A', None)"
        )
        ws.call("cmd.delete", "sele")
        ws.call("cmd.delete", "zz_p8key")
        ws.close()


# =====================================================================
# Area 3 — "Remaining CGO-backed reps (... dash, angle, dihedral)"
#
#   REMAINING: `dashes`/`angles`/`dihedrals` still fall back to Mode P ...
#   the bridge never drops them from the pixel-frame rep mask, so composition
#   stays `{drawing: [], suppressed: [10,17], rasterizing: true}`.
#   ROOT CAUSE FOUND AND FIXED (see `render/framestream.py` `_exact_reps`).
#
# Wave 4 fixed it and measured `dd` and `aa` BY HAND, in a browser. Nothing in
# the suite held the fix down, and `dihedrals` (18) was never checked at all.
# This is the regression test, on the product pump, for all three.
# =====================================================================

MEAS_PDB = os.path.join(REPO, "packages", "engine", "testing", "data", "1rx1.pdb")
MEAS = {"zz_p8dd": 10, "zz_p8aa": 17, "zz_p8hh": 18}


@pytest.fixture(scope="module")
def measurements(bridge):
    """A distance, an angle and a dihedral, added WITHOUT clearing the scene.

    `cmd.delete('all')` here would take the rest of the shared suite's objects
    with it, so these are namespaced and removed individually.
    """
    sel = [
        "first (zz_p8mol and resi %d and name CA)" % resi for resi in (10, 20, 30, 40)
    ]

    def setup(engine):
        cmd = engine.cmd
        for name in list(MEAS) + ["zz_p8mol"]:
            cmd.delete(name)
        cmd.load(MEAS_PDB, "zz_p8mol")
        cmd.distance("zz_p8dd", sel[0], sel[1])
        cmd.angle("zz_p8aa", sel[0], sel[1], sel[2])
        cmd.dihedral("zz_p8hh", sel[0], sel[1], sel[2], sel[3])
        cmd.refresh()
        return {n: cmd.get_type(n) for n in MEAS}

    types = bridge.pump.call(setup, timeout=300)
    assert set(types.values()) == {"object:measurement"}, types
    yield bridge

    def teardown(engine):
        for name in list(MEAS) + ["zz_p8mol"]:
            engine.cmd.delete(name)

    bridge.pump.call(teardown, timeout=300)


def test_get_vis_CANNOT_tell_a_measurement_from_a_molecule(measurements) -> None:
    """The trap the coverage probe used to fall into, re-measured here.

    `CoverageProbe._VIS_REPS` is index 2 of a `cmd.get_vis` record. Measured on
    this build with a freshly loaded 1RX1 (lines only) plus a distance:

        zz_p8mol -> [1, [], [0,1,2,3,4,5,6,7,8,9,10,11,13,14,16,17,18,19,20], 26]
        zz_p8dd  -> [1, [], [0,1,2,3,4,5,6,7,8,9,10,11,13,14,16,17,18,19,20],  7]

    -- 19 entries, IDENTICAL for both. Index 2 is not a per-object visible-rep
    list at all, so taken at face value NOTHING is ever a subset of a client's
    declaration and `plan_mask` answers `nothing-maskable` for ever. That is
    the bug; `_exact_reps` is the fix.
    """
    vis = measurements.pump.call(lambda engine: engine.cmd.get_vis(), timeout=120)
    molecule = vis["zz_p8mol"][2]  # CoverageProbe._VIS_REPS
    assert len(molecule) > 5, molecule
    for name in MEAS:
        assert vis[name][2] == molecule, (name, vis[name][2], molecule)


def test_the_coverage_probe_reports_the_ONE_rep_each_object_really_draws(
    measurements,
) -> None:
    """`_exact_reps` overrides `get_vis` from `_cmd.web_get_versions`."""
    from tenmol_bridge.render.framestream import CoverageProbe

    probe = CoverageProbe()
    coverage = measurements.pump.call(lambda engine: probe.probe(engine), timeout=300)
    assert coverage.exact, coverage
    for name, rep in MEAS.items():
        assert coverage.objects.get(name) == frozenset({rep}), (
            name,
            coverage.objects.get(name),
        )


def test_a_client_declaring_10_17_18_STOPS_the_server_rasterising(measurements):
    """The consequence, on the real coverage: with only the three measurement
    objects in view, a client that declares dashes/angles/dihedrals covers the
    whole scene and `plan_mask` turns rasterisation OFF.

    `SceneCoverage` is narrowed to the three objects here because the shared
    suite leaves other objects loaded; the rep sets in it are the probe's own,
    not invented.
    """
    from tenmol_bridge.render.framestream import CoverageProbe, SceneCoverage, plan_mask

    probe = CoverageProbe()
    coverage = measurements.pump.call(lambda engine: probe.probe(engine), timeout=300)
    narrowed = SceneCoverage(
        objects={n: coverage.objects[n] for n in MEAS},
        exact=True,
        source=coverage.source,
    )

    plan = plan_mask(narrowed, [10, 17, 18]).to_json()
    assert plan["rasterizing"] is False, plan
    assert plan["reason"] == "fully-covered", plan
    assert sorted(plan["maskedObjects"]) == sorted(MEAS), plan
    assert sorted(plan["visibleReps"]) == [10, 17, 18], plan

    # The counterfactual: BEFORE the fix the probe reported every rep index for
    # these objects, so nothing was ever a subset of the declaration.
    everything = SceneCoverage(
        objects={n: frozenset(range(21)) for n in MEAS}, exact=True, source="get_vis"
    )
    stale = plan_mask(everything, [10, 17, 18]).to_json()
    assert stale["rasterizing"] is True, stale
    assert stale["reason"] == "nothing-maskable", stale


def test_all_three_measurement_reps_are_advertised_as_mode_G_capable(measurements):
    """A rep missing from this tuple is a rep the bridge rasterises for ever,
    however well the accessor serves it."""
    from tenmol_bridge.render.modeg import MODE_G_CAPABLE_REPS

    assert set(MEAS.values()) <= set(MODE_G_CAPABLE_REPS), MODE_G_CAPABLE_REPS


# =====================================================================
# Area 4 — "Deferred/ordered input queue"
#
#   Transport must be strictly ordered and lossless — a single WebSocket for
#   input, never parallel channels.
#
# The previous note established that by READING `dispatch.py`. This measures
# it: a burst of frames sent without waiting for replies has to arrive at the
# engine thread complete and in order. The spy does NOT call through, so no
# scene event is generated and the shared camera is untouched.
# =====================================================================

BURST = 64


@pytest.fixture
def button_spy(bridge):
    """Shadow ``Engine.button`` with a recorder, on the engine thread."""
    seen: List[Any] = []
    engine = bridge.pump.engine

    def install(_engine):
        engine.button = lambda button, state, x, y, modifiers: seen.append(
            (int(button), int(state), int(x), int(y), int(modifiers))
        )
        return True

    def remove(_engine):
        try:
            del engine.button
        except AttributeError:  # pragma: no cover - already the class method
            pass
        return "button" not in engine.__dict__

    assert bridge.pump.call(install, timeout=60) is True
    try:
        yield seen
    finally:
        assert bridge.pump.call(remove, timeout=60) is True, (
            "the button spy leaked into the shared engine"
        )


def test_a_BURST_of_inputs_arrives_complete_and_in_order(bridge, button_spy) -> None:
    """Sent back-to-back with no round trip in between — the case a per-frame
    ack would hide."""
    ws = WSClient(bridge.ws_url)
    try:
        last = 0
        for i in range(BURST):
            last = ws.send(t="input", kind="button", button=0, state=0, x=i, y=i, mod=0)
        assert ws.wait_reply(last, timeout=60)["t"] == "ok"
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline and len(button_spy) < BURST:
            time.sleep(0.02)
    finally:
        ws.close()

    assert len(button_spy) == BURST, "lost %d of %d" % (
        BURST - len(button_spy),
        BURST,
    )
    assert [entry[2] for entry in button_spy] == list(range(BURST)), [
        entry[2] for entry in button_spy
    ]


def test_two_SOCKETS_are_two_channels_which_is_why_input_uses_one(
    bridge, button_spy
) -> None:
    """The row's rule, stated as its counterexample.

    Interleaving a burst across two sockets is accepted — nothing refuses it —
    but the arrival order is then the servers', not the client's. Measured
    here rather than asserted: the run is only reported as ordered if it
    really came out ordered, and the test asserts the WEAKER guarantee (every
    frame arrives) that is all two channels can promise.
    """
    a = WSClient(bridge.ws_url)
    b = WSClient(bridge.ws_url)
    try:
        last = 0
        for i in range(BURST):
            last = (a if i % 2 == 0 else b).send(
                t="input", kind="button", button=0, state=0, x=i, y=i, mod=0
            )
        assert (b if (BURST - 1) % 2 else a).wait_reply(last, timeout=60)["t"] == "ok"
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline and len(button_spy) < BURST:
            time.sleep(0.02)
    finally:
        a.close()
        b.close()

    xs = [entry[2] for entry in button_spy]
    assert sorted(xs) == list(range(BURST)), xs
    print("ZP8 two-socket arrival order: %r" % (xs,))


# =====================================================================
# Area 11 — "`util.protein_vacuum_esp` — destructive"
#
#   PARTIAL: the confirm step is built and VERIFIED to interpose ... The run
#   itself has not been executed end-to-end, and diagnostics currently reach
#   the console only.
#
# The run half, on a scratch object, with the destruction measured rather than
# described.
# =====================================================================

ESP = "zz_p8esp"


def test_protein_vacuum_esp_runs_and_says_what_it_destroyed(bridge) -> None:
    ws = WSClient(bridge.ws_url)
    assert ws.subscribe("feedback")["t"] == "ok"
    try:
        for name in (ESP, ESP + "_e_chg", ESP + "_e_map", ESP + "_e_pot"):
            ws.call("cmd.delete", name)
        ws.call("cmd.fragment", "gly", ESP)
        before = ws.call("cmd.count_atoms", ESP)
        _stream(ws, 0.2)

        reply = ws.call_reply("util.protein_vacuum_esp", ESP, 2, 10.0, 0)
        if reply["t"] == "err":
            pytest.skip("protein_vacuum_esp unavailable here: %r" % reply["error"])
        # WAIT for the three objects rather than assuming a fixed window was
        # enough. `protein_vacuum_esp` does an h_add, a charge assignment and a
        # Coulomb map; a runner needed longer than the 1.5 s this used to sleep,
        # and the failure looked like "it made nothing" rather than "it is still
        # working".
        want = [ESP + "_e_chg", ESP + "_e_map", ESP + "_e_pot"]
        lines: list = []
        deadline = time.monotonic() + slow(20.0)
        while time.monotonic() < deadline:
            lines += _stream(ws, 0.5)
            names = ws.call("cmd.get_names", "all")
            # BOTH conditions. Breaking on the objects alone was my own earlier
            # fix and it made this worse: the three objects can exist before the
            # diagnostics have been streamed, so the run failed later at
            # `assert "Util:" in text` with an EMPTY line list.
            if all(n in names for n in want) and any("Util:" in ln for ln in lines):
                break
        names = ws.call("cmd.get_names", "all")
        made = [n for n in want if n in names]
        assert made == want, (made, names)

        # It MUTATES first: h_add grows the model, and the source object is
        # disabled behind the user's back.
        after = ws.call("cmd.count_atoms", ESP + "_e_chg")
        assert after != before, (before, after)
        enabled = ws.call("cmd.get_names", "objects", 1)
        assert ESP not in enabled, enabled

        # ... and the diagnostics DO reach a subscribed client, not just stdout.
        text = "\n".join(lines)
        assert "Util:" in text, lines[-8:]
        assert "charges" in text.lower(), lines[-8:]
    finally:
        for name in (ESP, ESP + "_e_chg", ESP + "_e_map", ESP + "_e_pot"):
            ws.call("cmd.delete", name)
        ws.close()
