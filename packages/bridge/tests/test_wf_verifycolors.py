"""Row 72 — the Colours editor dialog, second pass (adversarial re-verification).

``packages/bridge/tests/test_wf_colors.py`` pins the nine ``connect()`` calls of
``edit_colors_dialog`` against the live engine.  Everything it measures was
re-measured here from a clean process and reproduced exactly (178 digit-free
names of 5388 slots, ``get_color_index`` on 26 strings, ``get_color_tuple``
None for the negative keywords, ``cmd.do`` with an embedded newline running
both commands).  This file adds the four facts that pass did NOT pin and that
the ported dialog leans on:

  * ``set_color`` on an existing name is CASE-INSENSITIVE and edits that slot —
    it does not append a second one, and it does not rewrite the stored
    spelling.  ``ColorEditor``'s "overwrites index N" / "creates a new colour"
    hint is a case-insensitive lookup (``findByName``) precisely because of
    this; a case-sensitive hint would promise a new colour and then silently
    overwrite a built-in.
  * ``#RRGGBB`` is NOT a colour name — only ``0x``.  The hex field is therefore
    client-side (``cssToRgb``) and only its 0..1 result reaches the engine.
  * exactly which negative indices answer None, since the port's guard was
    widened from ``== -1`` to ``< 0`` on the strength of it.
  * ``%.2f`` and ``toFixed(2)`` DO disagree (0.125 -> '0.12' vs '0.13'), so the
    357-value agreement in the other file is a property of the dialog's DOMAIN,
    not of the two functions.  The editor's quantisation is what keeps every
    value it writes inside that domain.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_wf_verifycolors.py -q
"""

from __future__ import annotations

import json
import shutil
import subprocess
from typing import Any, Dict

import pytest

COLOR_TABLE_SIZE = 5388
MINE = "tenmol_wfv"


def table(ws: Any) -> Dict[str, int]:
    return {name: index for name, index in ws.call("get_color_indices", all=1)}


def test_set_color_matches_an_existing_name_without_regard_to_case(ws: Any) -> None:
    """The fact behind the editor's Apply hint.

    Measured in a clean process first, on a built-in: ``set_color RED,
    [0.9, 0.8, 0.7]`` left the table at 5388 slots, put nothing called ``RED``
    in it, and changed ``get_color_tuple(4)`` to (0.9, 0.8, 0.7).  Reproduced
    here on names this file owns, so the shared session keeps its red.
    """
    ws.call("set_color", MINE + "_Case", [0.10, 0.20, 0.30])
    first = table(ws)
    slot = first[MINE + "_Case"]
    assert slot >= COLOR_TABLE_SIZE

    before = len(first)
    ws.call("set_color", (MINE + "_Case").upper(), [0.40, 0.50, 0.60])
    after = table(ws)

    assert len(after) == before, "a differently-cased name must not add a slot"
    assert (MINE + "_CASE").upper() not in after, "and must not be stored either"
    assert after[MINE + "_Case"] == slot, "the original spelling keeps the slot"
    assert ws.call("get_color_tuple", slot) == pytest.approx([0.40, 0.50, 0.60], abs=1e-6)

    # ...and the lookup the hint actually performs agrees with all of that.
    assert ws.call("get_color_index", (MINE + "_Case").upper()) == slot
    assert ws.call("get_color_index", (MINE + "_Case").lower()) == slot


def test_only_0x_is_an_inline_colour_name_not_css_hash(ws: Any) -> None:
    """Why the hex box never sends its text to ``get_color_index``.

    ``ColorGetIndex`` parses ``0x``/``0X`` (``packages/engine/layer1/Color.cpp:704-712``) and
    nothing else, so a CSS ``#rrggbb`` typed into the NAME box is simply a miss.
    """
    assert ws.call("get_color_index", "0xff8800") == 0x40FF8800
    assert ws.call("get_color_index", "0xFF8800") == 0x40FF8800
    assert ws.call("get_color_index", "#ff8800") == -1
    assert ws.call("get_color_index", "ff8800") == -1

    rgb = ws.call("get_color_tuple", 0x40FF8800)
    assert rgb[0] == pytest.approx(1.0)
    assert rgb[1] == pytest.approx(0x88 / 255, abs=1e-6)
    assert rgb[2] == pytest.approx(0.0)


def test_exactly_which_negative_indices_have_no_tuple(ws: Any) -> None:
    """The port guards ``index < 0``; this is the ground truth under it.

    -1 and -4..-7 answer None (mode 0 of ``CmdGetColor`` builds a result only
    ``if(index >= 0)``, ``packages/engine/layer4/Cmd.cpp:1336``).  -2 and -3 are the two the
    switch answers before that test, and they come back as a real 3-tuple —
    measured (0.0, 1.0, 1.0) — which is why "negative means None" would be the
    wrong rule to hard-code on the client.
    """
    for index in (-1, -4, -5, -6, -7):
        reply = ws.call_reply("get_color_tuple", index)
        assert reply["t"] == "ok" and reply["result"] is None, (index, reply)

    for index in (-2, -3):
        value = ws.call("get_color_tuple", index)
        assert isinstance(value, list) and len(value) == 3, (index, value)

    # And no keyword in this build resolves to -2/-3: `auto` and `current` run
    # ColorGetNext/ColorGetCurrent and answer a real slot (26 on a fresh
    # session), so the None set is the whole of what `load_color` can meet.
    for keyword in ("auto", "current"):
        assert ws.call("get_color_index", keyword) >= 0


def test_percent_2f_and_toFixed_agree_only_because_of_the_grid() -> None:
    """The 357-value diff is about the DOMAIN, not about the two functions.

    Python rounds the binary value half-to-even; JS `toFixed` rounds the decimal
    expansion half-away-from-zero.  0.125 is exactly representable and they
    disagree on it.  It is not reachable from this dialog: every value the
    editor writes has been through `quantiseChannels`, i.e. it is k/100.
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("no node on PATH")

    def js(values: list) -> list:
        out = subprocess.run(
            [node, "-e",
             "const v=JSON.parse(process.argv[1]);"
             "process.stdout.write(JSON.stringify(v.map(x=>x.toFixed(2))));",
             json.dumps(values)],
            capture_output=True, text=True, check=True, timeout=60,
        )
        return json.loads(out.stdout)

    assert ["%.2f" % v for v in (0.125, 0.135, 2.675)] == ["0.12", "0.14", "2.67"]
    assert js([0.125, 0.135, 2.675]) == ["0.13", "0.14", "2.67"], (
        "if these ever agree, the domain argument below is no longer needed"
    )

    grid = [k / 100 for k in range(101)]
    assert js(grid) == ["%.2f" % v for v in grid]
    # quantiseChannels' rule, in Python: nothing off the grid survives it.
    quantised = [round(min(1.0, max(0.0, k / 255)) * 100) / 100 for k in range(256)]
    assert js(quantised) == ["%.2f" % v for v in quantised]
    assert all(abs(v * 100 - round(v * 100)) < 1e-9 for v in quantised)
