"""Parity area 10 — the Properties Inspector, over the real socket.

Three rows: the 4-level tree, value editing with type coercion, and Delete-key
unset semantics (`modules/pmg_qt/properties_dialog.py:69-286`). The React side
of all three exists in `apps/web/src/features/properties/`; what did not exist
was any evidence that the calls it makes do what the dialog needs on a live
engine. That is what this file is.

Type COERCION is client-side and unit-tested in `model.test.ts` — this file
covers the half that talks to PyMOL: which keys are readable, what each write
actually changes, and what each unset restores.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_properties.py -q
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

from tenmol_bridge.panels.properties import ITERATE_ONLY  # noqa: E402

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test",
    "dat",
)

#: Object name no other test module uses — the PyMOL process is shared.
M = "pr_obj"

#: `packages/protocol/src/topics/dialogs.ts:133` — kept in step by hand, and
#: the test below is what notices if PyMOL stops answering for one of them.
IDENTIFIER_KEYS = (
    "model", "index", "segi", "chain", "resi", "resn",
    "oneletter", "name", "alt", "ID", "rank",
)

#: `dialogs.ts:152`. `stereo` is deliberately absent upstream ("avoid stereo
#: auto-assignment errors") and its absence is asserted, not assumed.
ATOM_BUILTIN_KEYS = (
    "elem", "q", "b", "type", "formal_charge", "partial_charge",
    "numeric_type", "text_type", "vdw", "ss", "color", "reps", "flags",
    "label", "cartoon", "protons", "geom", "valence", "elec_radius",
)

ASTATE_BUILTIN_KEYS = ("state", "x", "y", "z")


@pytest.fixture()
def obj(ws: WSClient):
    ws.call("cmd.load", os.path.join(DATA, "il2.pdb"), M)
    yield ws
    ws.call("cmd.delete", M)


PROPS_NS = "cmd.tenmol_props"
PROPS_BOOTSTRAP = "import tenmol_bridge.panels.properties as _tp; _tp.install()"


@pytest.fixture()
def props(obj: WSClient):
    """The bridge helper, bootstrapped the way the browser does it."""
    obj.do(PROPS_BOOTSTRAP)
    assert obj.call(PROPS_NS + ".hello")["ok"] is True
    return obj


def _atom_setting(ws: WSClient, name: str, index: int = 1):
    """Read one atom-level setting back.

    Goes through `alter` into a custom property, because that IS the only way
    a client can get an `iterate` value out — see
    `test_iterate_cannot_return_values_to_a_client`.
    """
    ws.do(PROPS_BOOTSTRAP)
    ws.call("cmd.alter", "%s and index %d" % (M, index), "p.__probe = s.%s" % name)
    value = ws.call(PROPS_NS + ".atom_extras", M, index, 1)["properties"]["__probe"]
    ws.call("cmd.alter", "%s and index %d" % (M, index), "p.__probe = None")
    return value


def _astate_setting(ws: WSClient, name: str, index: int = 1):
    """Read one atom-STATE setting back, via the same property-probe trick."""
    ws.do(PROPS_BOOTSTRAP)
    sel = "%s and index %d" % (M, index)
    ws.call("cmd.alter", sel, "p.__probe = 0.0")
    ws.call("cmd.alter_state", 1, sel, "p.__probe = s.%s" % name)
    value = ws.call(PROPS_NS + ".atom_extras", M, index, 1)["properties"]["__probe"]
    ws.call("cmd.alter", sel, "p.__probe = None")
    return value


def _chempy_atom(ws: WSClient, index: int = 1, state: int = 1):
    """How the panel reads an atom: one `get_model`, chempy fields.

    `iterate` cannot be used from a client — it returns None and mutates a
    `space` dict SERVER-side, so the dict the client passes is a copy that
    never comes back. That is precisely why `panels/properties.py` exists.
    """
    model = ws.call("get_model", "%s`%d" % (M, index), state)
    return model["atom"][0]


# =========================================================================== #
# Row: the 4-level tree
# =========================================================================== #


def test_iterate_cannot_return_values_to_a_client(obj):
    """The constraint the whole helper exists for, pinned.

    If `space` ever started round-tripping, `panels/properties.py` would be
    unnecessary — so this asserts that it does not, rather than leaving the
    justification as a comment.
    """
    out: dict = {}
    # `iterate` returns the ATOM COUNT, not the values.
    assert obj.call("cmd.iterate", "%s and index 1" % M, "out['b'] = b", space={"out": out}) == 1
    assert out == {}, "space came back populated; the helper may be redundant now"


def test_the_chempy_read_covers_thirteen_of_the_nineteen_builtins(obj):
    atom = _chempy_atom(obj)
    for field in ("q", "b", "vdw", "ss", "flags", "elec_radius",
                  "partial_charge", "formal_charge", "numeric_type",
                  "text_type", "hetatm", "symbol"):
        assert field in atom, field
    # And the ones it does NOT carry — the reason for the helper. `color` was
    # mapped by the panel as though chempy had it, and rendered from undefined.
    for field in ITERATE_ONLY:
        assert field not in atom, "%s is in chempy now; simplify the helper" % field


def test_the_helper_supplies_the_six_iterate_only_builtins(props):
    extras = props.call(PROPS_NS + ".atom_extras", M, 1, 1)
    assert extras["found"] is True, extras
    assert set(extras["builtins"]) == set(ITERATE_ONLY)
    # Real values, not placeholders: index 1 of il2.pdb is a backbone N.
    assert isinstance(extras["builtins"]["reps"], int)
    assert isinstance(extras["builtins"]["protons"], int)
    assert extras["builtins"]["protons"] > 0


def test_the_helper_returns_custom_properties_as_a_dict(props):
    props.call("cmd.alter", "%s and index 1" % M, "p.tag = 'x'; p.n = 3")
    extras = props.call(PROPS_NS + ".atom_extras", M, 1, 1)
    assert extras["properties"] == {"tag": "x", "n": 3}, extras["properties"]


def test_the_helper_reports_a_missing_atom_rather_than_raising(props):
    extras = props.call(PROPS_NS + ".atom_extras", M, 999999, 1)
    assert extras["found"] is False
    assert extras["builtins"] == {}


def test_the_atom_settings_branch_says_why_it_is_empty(props):
    """"Unavailable" with no reason is indistinguishable from broken."""
    support = props.call(PROPS_NS + ".atom_setting_support")
    assert support["available"] is False
    assert "effective" in support["reason"].lower()


def test_atom_settings_really_cannot_be_enumerated(obj):
    """The measurements behind that reason, so a future PyMOL bump surfaces it."""
    assert obj.call_reply("cmd.get_atom_settings", "%s and index 1" % M)["t"] == "err"
    assert obj.call_reply("cmd.iterate", "%s and index 1" % M, "x = s.all")["t"] == "err"


def test_every_atom_state_builtin_is_readable(obj):
    """x/y/z come from the chempy `coord` triple; state is the panel's own."""
    coord = _chempy_atom(obj)["coord"]
    assert len(coord) == 3 and all(isinstance(v, float) for v in coord)


def test_the_object_level_reads_the_panel_makes(obj):
    assert obj.call("cmd.get_title", M, 1) is not None
    # None when the object has no settings of its own; a list of
    # [id, type, value] once one is set. The panel must render both.
    assert obj.call("cmd.get_object_settings", M) is None
    obj.call("cmd.set", "sphere_scale", 0.5, M)
    assert obj.call("cmd.get_object_settings", M) == [[155, 3, pytest.approx(0.5)]]
    # No TTT until one is set — the panel must render an absent matrix, not 0s.
    obj.call("cmd.matrix_reset", M, mode=1)
    assert obj.call("cmd.get_object_ttt", M) is None


def test_stereo_stays_out_of_the_builtin_list():
    """Upstream omits it on purpose; chempy carries it, so only a rule keeps it out."""
    assert "stereo" not in ATOM_BUILTIN_KEYS
    assert "stereo" not in ITERATE_ONLY


# =========================================================================== #
# Row: value editing
# =========================================================================== #


def test_object_ttt_round_trips(obj):
    """`set_object_ttt` evals a STRING argument itself (`editing.py:2249`)."""
    obj.call("set_object_ttt", M, "[1,0,0,0, 0,1,0,0, 0,0,1,0, 5,0,0,1]")
    ttt = obj.call("cmd.get_object_ttt", M)
    assert ttt is not None and len(ttt) == 16
    assert ttt[12] == pytest.approx(5.0), ttt


def test_a_bare_symbol_resolves_the_way_the_service_calls_it(obj):
    """`service.ts` calls `set_object_ttt`, not `cmd.set_object_ttt`.

    The dispatcher's default rule resolves an unlisted root to `pymol.<root>`;
    if that ever changed, every edit in this panel would fail at once.
    """
    assert obj.call_reply("set_object_ttt", M, "[1,0,0,0, 0,1,0,0, 0,0,1,0, 1,2,3,1]")[
        "t"
    ] == "ok"
    assert obj.call("cmd.get_object_ttt", M)[13] == pytest.approx(2.0)


def test_title_is_per_state(obj):
    obj.call("cmd.set_title", M, 1, "hello")
    assert obj.call("cmd.get_title", M, 1) == "hello"


def test_an_object_setting_writes_and_reads_back(obj):
    obj.call("cmd.set", "sphere_scale", 0.7, M)
    assert float(obj.call("cmd.get", "sphere_scale", M)) == pytest.approx(0.7)


def test_an_atom_level_setting_writes_through_alter(obj):
    """The `s.` prefix in `alter` is the ATOM-level setting namespace."""
    obj.call("cmd.alter", "%s and index 1" % M, "s.sphere_scale = 3.0")
    assert _atom_setting(obj, "sphere_scale") == pytest.approx(3.0)


def test_an_atom_state_setting_writes_through_alter_state(obj):
    """`s.` in `alter_state` accepts ONLY atom-state level settings.

    Measured: `s.sphere_scale` (atom level) raises `TypeError: only atom-state
    level settings can be set in alter_state function`, and a name that is no
    setting at all raises `LookupError: unknown setting`. There are 17 such
    settings (`layer1/SettingInfo.h`, level `astate`), all label geometry.
    """
    sel = "%s and index 1" % M
    obj.call("cmd.alter_state", 1, sel, "s.label_connector_width = 3.0")
    assert _astate_setting(obj, "label_connector_width") == pytest.approx(3.0)

    assert obj.call_reply("cmd.alter_state", 1, sel, "s.sphere_scale = 1.0")["t"] == "err"
    assert obj.call_reply("cmd.alter_state", 1, sel, "s.nonesuch = 1.0")["t"] == "err"


def test_a_custom_atom_property_writes_through_alter(obj):
    obj.do(PROPS_BOOTSTRAP)
    obj.call("cmd.alter", "%s and index 1" % M, "p.tag = 'x'")
    assert obj.call(PROPS_NS + ".atom_extras", M, 1, 1)["properties"]["tag"] == "x"


# =========================================================================== #
# Row: Delete-key unset semantics
#
# Every branch of `unset_item` (`properties_dialog.py:229-286`). "Unset" means
# a different call per branch and, importantly, a different OUTCOME: some
# restore a default value, some restore None. The panel renders those
# differently, so each is asserted rather than lumped together.
# =========================================================================== #


def test_unset_ttt_is_matrix_reset_mode_1(obj):
    obj.call("set_object_ttt", M, "[1,0,0,0, 0,1,0,0, 0,0,1,0, 5,0,0,1]")
    assert obj.call("cmd.get_object_ttt", M) is not None
    obj.call("cmd.matrix_reset", M, mode=1)
    assert obj.call("cmd.get_object_ttt", M) is None


def test_unset_title_is_an_empty_set_title(obj):
    obj.call("cmd.set_title", M, 1, "hello")
    obj.call("cmd.set_title", M, 1, "")
    assert obj.call("cmd.get_title", M, 1) == ""


def test_unset_an_object_setting_restores_the_global_default(obj):
    """NOT None: `cmd.get` falls back, so the row shows 1.0 again."""
    obj.call("cmd.set", "sphere_scale", 0.7, M)
    obj.call("cmd.unset", "sphere_scale", M, quiet=0)
    assert float(obj.call("cmd.get", "sphere_scale", M)) == pytest.approx(1.0)


def test_unset_an_atom_setting_restores_the_default(obj):
    sel = "%s and index 1" % M
    obj.call("cmd.alter", sel, "s.sphere_scale = 3.0")
    obj.call("cmd.alter", sel, "s.sphere_scale = None")
    assert _atom_setting(obj, "sphere_scale") == pytest.approx(1.0)


def test_unset_an_atom_state_setting_restores_the_default(obj):
    sel = "%s and index 1" % M
    obj.call("cmd.alter_state", 1, sel, "s.label_connector_width = 3.0")
    obj.call("cmd.alter_state", 1, sel, "s.label_connector_width = None")
    # `layer1/SettingInfo.h:830` REC_f(723, label_connector_width, astate, 2.f)
    assert _astate_setting(obj, "label_connector_width") == pytest.approx(2.0)


def test_unset_a_custom_property_really_is_none(obj):
    """Unlike a setting, a custom property has no default to fall back to."""
    sel = "%s and index 1" % M
    obj.do(PROPS_BOOTSTRAP)
    obj.call("cmd.alter", sel, "p.tag = 'x'")
    obj.call("cmd.alter", sel, "p.tag = None")
    assert obj.call(PROPS_NS + ".atom_extras", M, 1, 1)["properties"] == {}


def test_unset_an_object_property_is_set_property_none(obj):
    obj.call("cmd.set_property", "foo", 7, M)
    assert obj.call("cmd.get_property", "foo", M) == 7
    obj.call("cmd.set_property", "foo", None, M)
    assert obj.call("cmd.get_property", "foo", M) is None
