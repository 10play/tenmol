"""Parity area 4 — Qt -> PyMOL key codes, cross-checked against upstream.

`packages/viewport/src/input/keys.ts` mirrors `modules/pmg_qt/keymapping.py`.
A mirror is only worth having if something checks it, and the two use different
key NAMES — Qt's `Key_Left` versus the DOM's `ArrowLeft` — so the check has to
be on the VALUES.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_key_translation.py -q
"""

from __future__ import annotations

import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KEYMAPPING = os.path.join(REPO, "modules", "pmg_qt", "keymapping.py")
KEYS_TS = os.path.join(REPO, "packages", "viewport", "src", "input", "keys.ts")


def upstream_map(name: str) -> dict:
    """`{Qt key name without the Key_ prefix: code}` from `keymapping.py`."""
    source = open(KEYMAPPING, encoding="utf-8").read()
    start = source.index("%s = {" % name)
    end = source.index("}", start)
    out = {}
    for line in source[start:end].splitlines()[1:]:
        match = re.match(r"\s*Qt\.Key\.Key_(\w+)\s*:\s*(\d+)\s*,", line)
        if match:
            out[match.group(1)] = int(match.group(2))
    return out


def client_map(name: str) -> dict:
    source = open(KEYS_TS, encoding="utf-8").read()
    start = source.index("export const %s" % name)
    body = source[source.index("{", start) + 1 : source.index("};", start)]
    out = {}
    for line in body.splitlines():
        match = re.match(r"\s*(\w+)\s*:\s*(\d+)\s*,", line)
        if match:
            out[match.group(1)] = int(match.group(2))
    return out


def test_the_plain_key_codes_agree() -> None:
    """Escape 27, Tab 9, Backspace 8, Return/Enter 13, Delete 127."""
    upstream = upstream_map("keyMap")
    client = client_map("KEY_MAP")

    assert upstream == {
        "Escape": 27, "Tab": 9, "Backspace": 8,
        "Return": 13, "Enter": 13, "Delete": 127,
    }, upstream
    # The client uses DOM names, so compare the code SETS and the shared names.
    for name, code in upstream.items():
        assert client.get(name, code) == code, (name, code, client.get(name))
    assert sorted(set(client.values())) == sorted(set(upstream.values()))


def test_the_special_key_codes_agree_exactly() -> None:
    """Arrows 100-103, PageUp/Down 104/105, Home 106, End 107, Insert 108, F1-12.

    Compared by VALUE SET plus the F-key mapping, because the names differ:
    upstream says `Left`, the DOM says `ArrowLeft`.
    """
    upstream = upstream_map("specialMap")
    client = client_map("SPECIAL_MAP")

    assert sorted(upstream.values()) == sorted(client.values()), {
        "upstream": sorted(upstream.values()),
        "client": sorted(client.values()),
    }
    for n in range(1, 13):
        assert upstream["F%d" % n] == n
        assert client["F%d" % n] == n

    # The four arrows, mapped across the naming difference.
    for qt_name, dom_name in (
        ("Left", "ArrowLeft"), ("Up", "ArrowUp"),
        ("Right", "ArrowRight"), ("Down", "ArrowDown"),
    ):
        assert upstream[qt_name] == client[dom_name], (qt_name, dom_name)


def test_the_client_carries_no_key_upstream_does_not() -> None:
    """A mirror that gained an entry would send a code PyMOL never expects."""
    extra = set(client_map("SPECIAL_MAP").values()) - set(
        upstream_map("specialMap").values()
    )
    assert extra == set(), extra
