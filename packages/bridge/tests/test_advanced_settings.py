"""Parity area 10 — the Advanced Settings dialog, engine side.

`advanced_settings_gui.py:13-99` is a two-column table of every PyMOL setting.
The React version is `apps/web/src/features/dialogs/AdvancedSettings.tsx`.

What is pinned here is the introspection surface it depends on, because all of
it is untyped on the wire: `get_setting_tuple` returns `[typeCode, [values]]`
and the dialog decides how to RENDER a row from that integer. If the codes ever
shifted, every checkbox would become a text box and nothing would fail loudly.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_advanced_settings.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

#: `cSetting_*` (`packages/engine/layer1/Setting.h`), as they arrive in `get_setting_tuple`.
TYPE_BOOLEAN = 1
TYPE_INT = 2
TYPE_FLOAT = 3
TYPE_FLOAT3 = 4
TYPE_COLOR = 5


def test_the_dialog_is_a_table_of_every_setting(ws: WSClient) -> None:
    """779 rows on this build — the row count is the dialog's design constraint."""
    names = ws.call("setting.get_name_list")
    assert isinstance(names, list)
    assert len(names) > 700, len(names)
    assert "sphere_scale" in names and "orthoscopic" in names


def test_the_private_index_helper_stays_refused(ws: WSClient) -> None:
    """`setting._get_index` is a private leaf and the dialog does not need it.

    `get_setting_tuple`, `get` and `set` all accept a NAME, so the policy
    refusal costs nothing — asserted so nobody "fixes" it with a grant.
    """
    reply = ws.call_reply("setting._get_index", "sphere_scale")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == "NotAllowed", reply


@pytest.mark.parametrize(
    "name,type_code",
    [
        ("orthoscopic", TYPE_BOOLEAN),   # -> checkbox
        ("seq_view", TYPE_BOOLEAN),
        ("label_font_id", TYPE_INT),     # -> text
        ("ray_trace_mode", TYPE_INT),
        ("sphere_scale", TYPE_FLOAT),    # -> text
        ("label_position", TYPE_FLOAT3), # -> text
        ("bg_rgb", TYPE_COLOR),          # -> text
    ],
)
def test_the_type_code_that_decides_how_a_row_renders(
    ws: WSClient, name: str, type_code: int
) -> None:
    tuple_ = ws.call("get_setting_tuple", name)
    assert tuple_[0] == type_code, (name, tuple_)


def test_get_returns_a_FORMATTED_string_not_the_raw_value(ws: WSClient) -> None:
    """The dialog shows `cmd.get`, which is display text, not the tuple value.

    A boolean reads "off", a colour reads "0x000000", a float3 reads a bracketed
    list. The table must not try to parse these back into numbers.
    """
    ws.call("set", "orthoscopic", 0, log=1, quiet=0)
    assert ws.call("get", "orthoscopic") == "off"
    assert ws.call("get", "bg_rgb").startswith("0x")
    assert ws.call("get", "label_position").startswith("[")
    assert "." in ws.call("get", "sphere_scale")


def test_editing_writes_through_with_the_dialogs_own_kwargs(ws: WSClient) -> None:
    """`cmd.set(name, value, log=1, quiet=0)` — `advanced_settings_gui.py:93`."""
    try:
        assert ws.call_reply("set", "sphere_scale", "0.6", log=1, quiet=0)["t"] == "ok"
        assert float(ws.call("get", "sphere_scale")) == pytest.approx(0.6)
        # A checkbox sends a real boolean-ish int, not the display string.
        assert ws.call_reply("set", "orthoscopic", 1, log=1, quiet=0)["t"] == "ok"
        assert ws.call("get", "orthoscopic") == "on"
    finally:
        ws.call("set", "sphere_scale", 1.0)
        ws.call("set", "orthoscopic", 0)


def test_a_rejected_value_raises_rather_than_silently_doing_nothing(ws: WSClient) -> None:
    """Upstream has NO error handling here (the inventory row says so).

    PyMOL itself does raise, with a message worth showing — so the React dialog
    surfaces it instead of dropping it, and this is the evidence there is
    something to surface.
    """
    reply = ws.call_reply("set", "sphere_scale", "notanumber", log=1, quiet=0)
    assert reply["t"] == "err", reply
    assert "could not convert string to float" in reply["error"]["message"]
    # And the old value survived the failed write.
    assert float(ws.call("get", "sphere_scale")) == pytest.approx(1.0)
