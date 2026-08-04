"""Parity area 4 — the 11 mouse-mode matrices and the mode ring.

`mode_dict` is the button x modifier -> action table for every mouse mode. The
client MIRRORS it (plan §A9) rather than fetching it, so the mirror needs
something to be checked against — that is what this file is.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_mouse_modes.py -q
"""

from __future__ import annotations

import ast
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

#: mode -> number of `(button, modifier, action)` entries. Measured.
MODE_SIZES = {
    "default": 11,
    "one_button_viewing": 41,
    "three_button_editing": 27,
    "three_button_lights": 26,
    "three_button_maestro": 27,
    "three_button_motions": 28,
    "three_button_viewing": 27,
    "two_button_editing": 26,
    "two_button_lights": 26,
    "two_button_selecting": 26,
    "two_button_viewing": 26,
}

#: `mode_name_dict` values — what the ButMode block shows. 10, not 11:
#: `default` has no display name.
DISPLAY_NAMES = [
    "1-Button Viewing",
    "2-Btn. Selecting",
    "2-Button Editing",
    "2-Button Lights",
    "2-Button Viewing",
    "3-Button Editing",
    "3-Button Lights",
    "3-Button Maestro",
    "3-Button Motions",
    "3-Button Viewing",
]


def value(ws: WSClient, bridge, tag: str, expression: str):
    """Evaluate in PyMOL and parse the printed repr.

    `mode_dict` is an ATTRIBUTE of a module, so `{t:'call'}` cannot fetch it —
    the dispatcher only invokes callables, and it answers
    "controlling.mode_dict is not callable". Printing is the way in.
    """
    ws.do("print('%s', %s)" % (tag, expression))
    lines = bridge.wait_for_feedback(tag, timeout=5.0)
    for line in lines:
        if tag in line and "print(" not in line:
            return ast.literal_eval(line.split(tag, 1)[1].strip())
    raise AssertionError("no %s output in %r" % (tag, lines[-4:]))


# --------------------------------------------------------------- the tables


def test_all_eleven_modes_exist(ws: WSClient, bridge) -> None:
    names = value(ws, bridge, "ZMM_NAMES", "sorted(cmd.controlling.mode_dict)")
    assert names == sorted(MODE_SIZES), names


def test_each_mode_has_the_measured_number_of_entries(ws: WSClient, bridge) -> None:
    """Sizes matter: a mirror missing rows fails silently as "that chord does
    nothing", which users report as the app ignoring them."""
    sizes = value(
        ws,
        bridge,
        "ZMM_SIZES",
        "{k: len(v) for k, v in sorted(cmd.controlling.mode_dict.items())}",
    )
    assert sizes == MODE_SIZES, sizes


def test_entries_are_button_modifier_action_triples(ws: WSClient, bridge) -> None:
    sample = value(
        ws,
        bridge,
        "ZMM_KEYS",
        "sorted(cmd.controlling.mode_dict['one_button_viewing'])[:3]",
    )
    for entry in sample:
        assert isinstance(entry, tuple) and len(entry) == 3, entry


def test_one_button_viewing_is_the_ONLY_mode_using_alsh_ctal_ctas(ws, bridge) -> None:
    """The row's distinguishing claim, checked as a SET DIFFERENCE.

    Measured: the entries unique to `one_button_viewing` are exactly the
    `alsh`/`ctal`/`ctas` rows plus a handful of one-button-specific chords. A
    mirror that skipped those three modifier names would silently drop the
    only mode that needs them.
    """
    unique = value(
        ws,
        bridge,
        "ZMM_ONLY",
        "sorted(set(cmd.controlling.mode_dict['one_button_viewing']) - "
        "set().union(*[set(v) for n, v in cmd.controlling.mode_dict.items() "
        "if n != 'one_button_viewing']))",
    )
    modifiers = {entry[1] for entry in unique}
    assert {"alsh", "ctal", "ctas"} <= modifiers, modifiers

    # And no OTHER mode uses them at all.
    others = value(
        ws,
        bridge,
        "ZMM_OTHERMODS",
        "sorted({e[1] for n, v in cmd.controlling.mode_dict.items() "
        "if n != 'one_button_viewing' for e in v})",
    )
    for modifier in ("alsh", "ctal", "ctas"):
        assert modifier not in others, (modifier, others)


# ------------------------------------------------------------ names + ring


def test_the_display_names_are_the_ten_the_block_shows(ws: WSClient, bridge) -> None:
    """Ten, not eleven — `default` has no display name.

    A cycler built from `mode_dict` keys would offer an eleventh, unnamed mode.
    """
    names = value(
        ws, bridge, "ZMM_DISP", "sorted(set(cmd.controlling.mode_name_dict.values()))"
    )
    assert names == DISPLAY_NAMES, names


def test_the_click_ring_holds_only_TWO_modes(ws: WSClient, bridge) -> None:
    """The finding that most changes what a client should build.

    Clicking the ButMode block does not cycle all 11 modes — `mouse_ring` is
    `['three_button_viewing', 'three_button_editing']`. Everything else is
    reachable only from the mouse_config menu. A cycler that walked all 11
    would take ten clicks to get back where it started.
    """
    ring = value(ws, bridge, "ZMM_RING", "cmd.controlling.mouse_ring")
    assert ring == ["three_button_viewing", "three_button_editing"], ring


def test_the_tables_cannot_be_FETCHED_by_a_client(ws: WSClient) -> None:
    """Which is why the client mirrors them (plan §A9) rather than polling.

    `controlling` IS an addressable root, but `mode_dict` is an attribute and
    the dispatcher only invokes callables.
    """
    reply = ws.call_reply("controlling.mode_dict")
    assert reply["t"] == "err"
    assert "not callable" in reply["error"]["message"], reply
