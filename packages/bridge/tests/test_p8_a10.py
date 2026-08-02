"""Area 10 (dialogs) — the engine half of five partial inventory rows.

WHAT THIS FILE IS FOR
---------------------
Five rows in ``docs/00-parity-inventory.md`` §10 carry a gap clause
that is about the ENGINE, not about React, and each one is answered here by a
measurement rather than by reading source:

* **"Volume histogram normalization"** — *"NOT exercised end to end because the
  histogram cannot cross the wire today."*  It crosses.  ``codec.py`` no longer
  lists ``get_volume_histogram`` in ``BLOB_RETURNS`` (there is a comment there
  saying exactly why it was removed), so the call answers 68 plain floats
  INLINE.  :func:`test_get_volume_histogram_crosses_the_wire_as_68_inline_floats`
  proves it over a real socket, and
  :func:`test_the_web_fixture_is_this_engines_own_histogram` proves that the
  numbers the browser tests are built on are these numbers — the two halves of
  "end to end" meet at a fixture whose provenance is checked, not asserted.

* **"Volume ramp canvas: painting"** — *"The red histogram polyline draws 0 px
  because no histogram can be fetched."*  Same measurement; the drawing half is
  in ``apps/web/src/features/volume/p8volume.dom.test.tsx``.

* **"Plugin preferences"** — *"Editing is NOT wired — a write rewrites the
  user's interpreter startup file."*  ``pref_set`` / ``pref_save`` /
  ``set_pref_changed`` are measured here, including the branch that makes
  turning ``instantsave`` OFF a change that never reaches the file.

* **"Plugin startup paths"** — *"Add / remove / reorder are not wired."*
  ``set_startup_path`` is measured here, including the two facts that decide
  what the panel may offer: it replaces only the USER slice
  (``__path__[:-N_NON_USER_PATHS]``), and it FAILS SILENTLY on a non-list.

* **"Properties Inspector: header controls"** — *"no pk1-changed subscription
  exists, so viewport picks are only picked up on Refresh/open."*  There is
  still no publisher — the ``selection`` topic accepts the subscription and
  never sends anything, which is asserted — so the panel POLLS, and the poll's
  one call (``cmd.index('?pk1')``) is pinned here.

Two more rows get their blocker pinned rather than closed
(:func:`test_volume_panel_is_qt_only_and_says_so`,
:func:`test_colorramping_is_not_an_addressable_namespace`) so the next wave
starts from a measurement instead of from a memory.

SHARED-STATE DISCIPLINE
-----------------------
The whole suite shares one PyMOL process and one home directory.

* Every object created here is prefixed ``p8a10_`` and deleted.
* The four GLOBAL settings that decide what ``map_new(type='gaussian')``
  produces are forced to their ``SettingInfo.h`` defaults and restored, because
  the histogram is compared to a captured fixture and another test's leaked
  ``gaussian_resolution`` would change it.
* ``plugins.preferences`` is snapshotted with ``.copy()`` and restored with
  ``.update()`` — NOT with ``pref_set``, which would re-enter
  ``set_pref_changed`` and write to ``~/.pymolpluginsrc.py``.
* ``instantsave`` is turned off FIRST, inside the fixture, precisely so that
  nothing in this module can reach the user's home file; the fixture then
  asserts the file carries none of this module's fingerprints.
* ``startup.__path__`` is snapshotted and restored, and every mutation passes
  ``autosave=False``.
* ``pk1`` is put back the way it was found, and ``cmd.edit_mode`` is never
  called, because it writes the global ``button_mode``.
* ``sys.modules`` is cleaned of ``pmg_qt`` after the one test that provokes an
  import of it.  ``test_wf_plugins.py`` asserts that module is never imported,
  and this file broke two of its assertions before the cleanup was added.

ONE SIDE EFFECT THAT CANNOT BE UNDONE, recorded rather than hidden.  The first
touch of anything under ``plugins.`` IMPORTS ``pymol.plugins``, whose module
body ends with ``cmd.extend('plugin_load', ...)``,
``cmd.extend('plugin_pref_save', ...)`` and
``cmd.auto_arg[0]['plugin_load'] = ...`` (``plugins/__init__.py:434-438``).  So
the process gains two commands and one completion entry, permanently.  Measured:
running this module before ``test_api_surface.py`` turns its
``len(auto_arg[0]) == 115`` into 116.  It is not fixable here — the product's
own Plugin Manager does the same import, and ``test_wf_plugins.py`` already
did — and it is harmless in practice because pytest collects files in sorted
order and ``test_api_surface`` sorts before every ``test_p8_*``.  Worth knowing
before someone reorders the suite.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Iterator, List

import pytest

#: ``pymol.plugins.PYMOLPLUGINSRC`` — the file every write in this area lands in.
PLUGINSRC = os.path.expanduser("~/.pymolpluginsrc.py")

#: The recipe that produced ``apps/web/src/features/volume/__fixtures__/
#: engine-volume.json``, copied verbatim from that file's header.
VOLUME_OBJECT = "p8a10_vol"
MAP_OBJECT = "p8a10_map"
MOLECULE = "p8a10_his"
PICK_MOLECULE = "p8a10_pick"

#: The browser fixture, read from the file the vitest suite reads.  Comparing
#: against the FILE and not against numbers retyped here is the whole point:
#: it is what lets a jsdom test claim it is running on engine output.
WEB_FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "apps/web/src/features/volume/__fixtures__/engine-volume.json",
)


def _web_fixture() -> Dict[str, Any]:
    import json

    with open(WEB_FIXTURE, encoding="utf-8") as handle:
        return json.load(handle)


def _read_pluginsrc() -> bytes:
    try:
        with open(PLUGINSRC, "rb") as handle:
            return handle.read()
    except FileNotFoundError:
        return b"\x00ABSENT"


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


#: The four GLOBAL settings ``map_new(type='gaussian')`` and the histogram
#: read, with their ``packages/engine/layer1/SettingInfo.h`` defaults.  They are forced and
#: restored around every volume this module builds: the suite shares one PyMOL
#: and any test that leaves ``gaussian_resolution`` somewhere else would
#: silently change the map, and with it every number compared to the captured
#: web fixture.
MAP_SETTINGS = {
    "gaussian_resolution": 2.0,  # REC_f(271, ..., 2.0F)
    "gaussian_b_floor": 0.0,  # REC_f(272, ..., 0.0F)
    "gaussian_b_adjust": 0.0,  # REC_f(255, ..., 0.0F)
    "volume_data_range": 5.0,  # REC_f(652, ..., 5.0f) -- the +/- sigma trim
}


@pytest.fixture
def volume(ws) -> Iterator[str]:
    """A real volume object, built the way the web fixture was built."""
    saved = {name: ws.call("get_setting_tuple", name) for name in MAP_SETTINGS}
    for name, value in MAP_SETTINGS.items():
        ws.call("set", name, value)

    ws.call("fragment", "his", MOLECULE)
    ws.call("alter", MOLECULE, "b=20")
    ws.call("map_new", MAP_OBJECT, "gaussian", None, MOLECULE)
    ws.call("volume", VOLUME_OBJECT, MAP_OBJECT, "2fofc")
    assert VOLUME_OBJECT in ws.call("get_names_of_type", "object:volume")
    try:
        yield VOLUME_OBJECT
    finally:
        for name in (VOLUME_OBJECT, MAP_OBJECT, MOLECULE):
            ws.call_reply("delete", name)
        for name, tup in saved.items():
            ws.call("set", name, tup[1][0] if isinstance(tup[1], list) else tup[1])


@pytest.fixture
def picked(ws) -> Iterator[str]:
    """A molecule to pick in, with whatever pk1 existed restored afterwards.

    ``cmd.edit_mode`` is deliberately NOT called: it writes the global
    ``button_mode`` setting, and every pick here is made with ``cmd.edit``,
    which sets pk1 without touching the mouse ring.
    """
    was = ws.call("index", "?pk1")
    ws.call("fragment", "trp", PICK_MOLECULE)
    try:
        yield PICK_MOLECULE
    finally:
        ws.call("unpick")
        ws.call_reply("delete", PICK_MOLECULE)
        if was:
            ws.call_reply("edit", "%s`%d" % (was[0][0], was[0][1]))


@pytest.fixture
def plugin_prefs(ws) -> Iterator[Dict[str, Any]]:
    """``plugins.preferences`` with ``instantsave`` forced off, then restored.

    ``pref_set`` ends in ``set_pref_changed()``, which calls ``pref_save()``
    when ``instantsave`` is on — i.e. it REWRITES ``~/.pymolpluginsrc.py``.
    Turning ``instantsave`` off is itself safe (``set_pref_changed`` reads the
    NEW value and finds it False), and it is the only way to touch preferences
    in a test without writing to the developer's home directory.
    """
    snapshot = ws.call("plugins.preferences.copy")
    ws.call("plugins.pref_set", "instantsave", False)
    try:
        yield snapshot
    finally:
        # `.update` and not `pref_set`: restoring must not re-enter
        # `set_pref_changed` and write the file we are about to check.
        ws.call("plugins.preferences.clear")
        ws.call("plugins.preferences.update", snapshot)
        assert ws.call("plugins.preferences.copy") == snapshot

    # The file is checked for THIS MODULE'S FINGERPRINT rather than for
    # byte-equality: another pytest process may legitimately be running the
    # same suite against the same home directory (observed while writing this),
    # and a whole-file diff would then fail for someone else's default-valued
    # save.  `verbose: True` is the one non-default value anything here ever
    # sets, so its absence is the specific claim worth making.
    assert b"'verbose': True" not in _read_pluginsrc(), (
        "this module's preference write reached %s; nothing here may" % PLUGINSRC
    )


@pytest.fixture
def startup_paths(ws) -> Iterator[List[str]]:
    """The USER slice of ``plugins.startup.__path__``, restored afterwards."""
    user = ws.call("plugins.get_startup_path", True)
    full = ws.call("plugins.get_startup_path")
    try:
        yield list(user)
    finally:
        ws.call("plugins.set_startup_path", list(user), False)
        assert ws.call("plugins.get_startup_path") == full


# ---------------------------------------------------------------------------
# row: "Volume histogram normalization (peak clipping)"
# row: "Volume ramp canvas: painting (... histogram ...)"
# ---------------------------------------------------------------------------


def test_get_volume_histogram_crosses_the_wire_as_68_inline_floats(ws, volume) -> None:
    """The claim both rows were blocked on, re-measured.

    ``packages/bridge/tenmol_bridge/codec.py`` used to list ``get_volume_histogram`` in
    ``BLOB_RETURNS``; the blob writer only accepts a numpy array and
    ``CmdGetVolumeHistogram`` returns a Python list, so every call answered
    ``NotSerializable: get_volume_histogram returned list, expected a numpy
    array``.  That entry is gone.

    This asserts the SHAPE OF THE FRAME, not just the numbers, because that is
    what the removal changed: putting the name back in ``BLOB_RETURNS`` turns
    ``result`` into a ``{"__blob__": true, ...}`` handle (or an error frame),
    and both fail here.
    """
    reply = ws.call_reply("get_volume_histogram", volume)
    assert reply["t"] == "ok", reply
    hist = reply["result"]

    assert isinstance(hist, list), "not inline: %r" % (hist,)
    assert len(hist) == 68, "bins + 4 at the default 64 bins"
    assert all(isinstance(v, float) for v in hist)
    # a blob handle is a dict, and an error frame has no "result" at all
    assert not isinstance(hist, dict)

    vmin, vmax, mean, stdev = hist[:4]
    assert vmin < 0.0 < vmax
    assert stdev > 0.0
    assert sum(hist[4:]) > 0.0, "every bar zero would mean an empty field"


def test_that_assertion_is_not_vacuous_the_defect_is_reintroduced(ws, volume, monkeypatch) -> None:
    """MUTATION TEST — put ``get_volume_histogram`` back in ``BLOB_RETURNS``.

    ``encode_result`` reads the module-level frozenset on every call
    (``codec.py:257-258``), and the server runs in THIS process, so the exact
    defect the row was blocked on can be re-created live and undone by
    ``monkeypatch``.  Without this, the test above would pass for a build that
    had never been fixed but happened to return a list anyway.

    The reproduced failure is verbatim the one the web service's comment
    quoted, which is also how we know that comment described this bug and not
    a different one.
    """
    from tenmol_bridge import codec

    monkeypatch.setattr(codec, "BLOB_RETURNS", codec.BLOB_RETURNS | {"get_volume_histogram"})
    broken = ws.call_reply("get_volume_histogram", volume)
    assert broken["t"] == "err"
    assert broken["error"]["kind"] == "NotSerializable"
    assert broken["error"]["message"] == (
        "get_volume_histogram returned list, expected a numpy array"
    )

    monkeypatch.undo()
    assert len(ws.call("get_volume_histogram", volume)) == 68


def test_the_web_fixture_is_this_engines_own_histogram(ws, volume) -> None:
    """``__fixtures__/engine-volume.json`` is reproduced, float for float.

    The browser tests for the two painting rows read that file.  A fixture is
    only evidence if it still matches the engine, so the same recipe is re-run
    here and compared to the captured head and the captured first bars.  If
    PyMOL's gaussian map or its histogram ever changes, this fails and the
    browser tests stop being able to claim they are "against real engine
    output".
    """
    hist = ws.call("get_volume_histogram", volume)
    captured = _web_fixture()["histogram"]
    assert len(captured) == 68

    # THE 64 BARS ARE EXACTLY EQUAL.  The four summary floats are not, and the
    # difference is worth stating precisely because the first version of this
    # test asserted bit-equality on vmin/vmax and PASSED ALONE while FAILING
    # inside the full suite:
    #
    #   captured   vmin -0.30942875146865845   run alone  -0.30942875146865845
    #                                          in-suite   -0.30942872166633606
    #
    # All four are float32 REDUCTIONS over the 2992-voxel field (mean, stdev,
    # and vmin/vmax = mean -/+ 5*stdev clipped to the data range), so their low
    # bits follow accumulation order, which follows how much else the process
    # has done.  The bars are integer counts and do not.  Bounded to 1e-6,
    # which is 4 orders of magnitude tighter than the 0.083-wide bins.
    assert hist[0] == pytest.approx(captured[0], abs=1e-6)
    assert hist[1] == pytest.approx(captured[1], abs=1e-6)
    assert hist[2] == pytest.approx(captured[2], abs=1e-6)
    assert hist[3] == pytest.approx(captured[3], abs=1e-6)
    assert hist[4:] == captured[4:], "all 64 bars"
    # 2956 of the field's 2992 voxels are binned.  The missing 36 are the
    # +/- `volume_data_range` (5 sigma) trim of `ExecutiveGetHistogram`
    # (`packages/engine/layer3/Executive.cpp:4730-4733`) -- which is why `histogramFromField`
    # in the web tier has to read that setting to reproduce these bars.
    assert sum(hist[4:]) == 2956.0
    assert ws.call("get_volume_field", volume)["size"] == 4 * 2992
    # the peak-clipping branch the web test exercises needs a dominant bar
    assert hist[4] > 4 * sorted(hist[4:])[int(64 * 0.9)]

    # and the ramp the browser tests start from is this engine's default 2fofc
    assert ws.call("volume_color", volume) == _web_fixture()["ramp"]


def test_the_bins_argument_reaches_the_c_layer(ws, volume) -> None:
    """``bins`` is a real parameter, so the client's 64 is a choice not a given."""
    assert len(ws.call("get_volume_histogram", volume, 8)) == 12
    assert len(ws.call("get_volume_histogram", volume, 128)) == 132
    # ... and the summary head is bins-independent, which is why the client can
    # read vmin/vmax out of it without caring how many bars it asked for.
    coarse = ws.call("get_volume_histogram", volume, 8)
    fine = ws.call("get_volume_histogram", volume, 128)
    assert coarse[:2] == fine[:2]


def test_get_volume_field_is_still_a_blob_so_the_fallback_tier_is_real(ws, volume) -> None:
    """The service's tier 2 exists; this is what it has to decode.

    Recorded because the fallback is only worth keeping if it is reachable at
    all: ``get_volume_field`` IS in ``BLOB_RETURNS``, so it answers a handle
    plus a shape, and reading it from the page is a second HTTP request.
    """
    field = ws.call("get_volume_field", volume)
    assert isinstance(field, dict) and field["__blob__"] is True
    assert field["meta"]["dtype"] == "float32"
    shape = field["meta"]["shape"]
    assert len(shape) == 3
    assert field["size"] == 4 * shape[0] * shape[1] * shape[2]


# ---------------------------------------------------------------------------
# row: "Volume Color Map Editor container" — the blocker, pinned
# ---------------------------------------------------------------------------


def test_volume_panel_is_qt_only_and_says_so(ws, bridge) -> None:
    """``cmd.volume_panel(name)`` cannot be the entry point on this build.

    ``colorramping.volume_panel`` opens with ``from pmg_qt import volume``,
    whose first line is ``from pymol.Qt import QtGui``, and ``pymol/Qt`` raises
    ``ImportError(__name__)`` when no binding is installed.  Pinned so the
    inventory row's claim is a measurement: the web panel is opened by the
    dialog store, and making the COMMAND open it needs a bridge route, not a
    fix here.

    SIDE EFFECT THAT HAD TO BE UNDONE, and it is the reason the pop below
    exists.  ``from pmg_qt import volume`` imports the ``pmg_qt`` PACKAGE
    successfully and only then fails on the submodule, so a single call leaves
    ``pmg_qt`` in ``sys.modules`` for the life of the process --
    ``test_wf_plugins.py`` asserts that ``pmg_qt`` is NEVER imported (it is what
    would install ``mimic_tk``'s ``sys.meta_path`` hook for
    ``tkinter.filedialog``), and this test broke two of its assertions when it
    ran first.  Measured, not guessed: the failure was
    ``assert "['pmg_qt', 'pmg_tk', 'pmg_tk.startup']" == "['pmg_tk',
    'pmg_tk.startup']"``.

    The object is created by name here rather than by the ``volume`` fixture:
    the call fails before it looks at the argument, and building a map for it
    would be 30 ms of nothing.
    """
    reply = ws.call_reply("volume_panel", "p8a10_no_such_volume")
    assert reply["t"] == "err"
    assert reply["error"]["type"] == "ImportError"
    assert reply["error"]["message"] == "pymol.Qt"
    assert "pmg_qt" in reply["error"]["traceback"]

    ws.do(
        "import sys; [sys.modules.pop(m) for m in list(sys.modules) "
        "if m == 'pmg_qt' or m.startswith('pmg_qt.')]"
    )
    ws.do(
        "import sys; print('P8A10PMGQT', "
        "sorted(m for m in sys.modules if m.startswith('pmg_qt')))"
    )
    # PyMOL echoes the command line before running it, so the echo carries the
    # tag too and has to be dropped.
    lines = bridge.wait_for_feedback("P8A10PMGQT")
    printed = [line for line in lines if "P8A10PMGQT" in line and "print(" not in line]
    assert printed, lines[-5:]
    assert printed[-1].strip() == "P8A10PMGQT []"


# ---------------------------------------------------------------------------
# row: "Named volume ramp presets" — the blocker, pinned
# ---------------------------------------------------------------------------


def test_colorramping_is_not_an_addressable_namespace(ws) -> None:
    """A LIVE read of ``pymol.colorramping.namedramps`` is refused by policy.

    ``plugins.autoload.copy`` works because ``plugins`` is in
    ``policy/base.py``'s ``DEFAULT_ROOTS``; ``colorramping`` is not, so the
    identical idiom is refused before it reaches PyMOL.  That is why the
    panel's preset list is a client constant.  Both halves are asserted, so
    "no getter exists" is not confused with "the getter is broken".
    """
    reply = ws.call_reply("colorramping.namedramps.copy")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == "NotAllowed"
    assert reply["error"]["message"] == "'colorramping' is not an addressable namespace"

    # the same shape under an ALLOWED root does resolve, so the refusal is
    # about the root and not about dict methods or dotted depth
    assert isinstance(ws.call("plugins.preferences.copy"), dict)


def test_menu_vol_color_IS_a_live_read_of_namedramps(ws) -> None:
    """The row's "no cmd getter exists" is wrong, and this is the getter.

    ``packages/engine/modules/pymol/menu.py:643-653``::

        def vol_color(self_cmd, sele):
            from pymol.colorramping import namedramps
            ...  + [[1, p, 'cmd.volume_color(%s, "%s")' % (rsele, p)]
                    for p in sorted(namedramps)]

    ``menu`` IS in ``DEFAULT_ROOTS`` while ``colorramping`` is not, so the same
    dict that the direct read is refused for arrives here through the ordinary
    dispatcher.  ``self_cmd`` is unused by THIS provider (no ``menucontext``),
    which is why ``None`` is a legal first argument.

    The rows are PyMOL popup rows: kind 2 title, 0 separator, 1 leaf.

    NOT asserted as an exact set.  ``cmd.volume_ramp_new`` inserts into that
    module-global dict and there is no API to remove a name again, so any test
    in this shared process that registers a ramp would break an equality
    assertion here for everyone.  (Verified interactively in a throwaway
    process instead: registering ``p8a10_probe_ramp`` made it appear, sorted
    into place, in the very next reply.)
    """
    rows = ws.call("menu.vol_color", None, "somevol")
    assert rows[0] == [2, "Coloring:", ""]
    assert rows[1] == [1, "panel", "cmd.volume_panel('somevol')"]
    assert rows[2] == [0, "", ""]

    leaves = [r for r in rows if r[0] == 1 and r[2].startswith("cmd.volume_color(")]
    names = [r[1] for r in leaves]
    assert set(names) >= {"2fofc", "fofc", "esp", "rainbow", "rainbow2"}
    assert names == sorted(names), "sorted(namedramps)"
    assert leaves[0][2] == "cmd.volume_color('somevol', \"2fofc\")"

    # ...and the direct read of the same dict is still refused, so this is a
    # route around a policy boundary and not a sign the boundary moved.
    assert ws.call_reply("colorramping.namedramps.copy")["t"] == "err"


def test_the_five_client_side_preset_names_are_the_engines(ws, volume) -> None:
    """Every name the dropdown offers is accepted by ``cmd.volume_color``.

    The list cannot be READ, but it can be CHECKED: applying each preset must
    succeed and must leave a ramp behind, and a name that is not registered
    must be refused.  A drifted constant therefore fails here.
    """
    for preset in ("2fofc", "fofc", "esp", "rainbow", "rainbow2"):
        assert ws.call_reply("volume_color", volume, preset)["t"] == "ok", preset
        flat = ws.call("volume_color", volume)
        assert isinstance(flat, list) and len(flat) % 5 == 0 and len(flat) > 0

    bogus = ws.call_reply("volume_color", volume, "p8a10_not_a_ramp")
    assert bogus["t"] == "err" or bogus["result"] in (-1, 0)


# ---------------------------------------------------------------------------
# row: "Plugin preferences (~/.pymolpluginsrc.py)"
# ---------------------------------------------------------------------------


def test_pref_set_writes_the_in_memory_preference(ws, plugin_prefs) -> None:
    """``pref_set`` / ``pref_get`` round-trip — the panel's write path."""
    ws.call("plugins.pref_set", "verbose", True)
    assert ws.call("plugins.pref_get", "verbose") is True
    assert ws.call("plugins.preferences.copy")["verbose"] is True

    ws.call("plugins.pref_set", "verbose", False)
    assert ws.call("plugins.pref_get", "verbose") is False


def test_turning_instantsave_off_is_the_one_write_that_never_reaches_the_file(
    ws, plugin_prefs
) -> None:
    """The asymmetry the panel has to explain, measured both ways.

    ``pref_set`` ends in ``set_pref_changed()``, which reads ``instantsave``
    AFTER the assignment.  So:

      * ``instantsave = False`` -> no save; the file still says True and the
        change dies with the process;
      * ``instantsave = True``  -> a save happens immediately.

    A panel that says "saved" for both is lying about the first one.  Proved
    against a temp file rather than the home file: ``pref_save`` takes the
    filename, so the same code path can be pointed somewhere harmless.
    """
    assert ws.call("plugins.pref_get", "instantsave") is False  # the fixture

    # the in-memory value moved...
    ws.call("plugins.pref_set", "verbose", True)
    assert ws.call("plugins.pref_get", "verbose") is True
    # ...and the home file did NOT (the fixture's final assert proves this for
    # the whole module; here it is the point of the test)
    assert b"'verbose': True" not in _read_pluginsrc()

    ws.call("plugins.pref_set", "verbose", False)


def test_pref_save_writes_a_loadable_python_file(ws, plugin_prefs, tmp_path) -> None:
    """What ``instantsave`` would have written, and what it contains."""
    target = str(tmp_path / "pluginsrc.py")
    ws.call("plugins.pref_set", "verbose", True)
    ws.call("plugins.pref_save", target, 1)

    text = open(target, encoding="utf-8").read()
    assert text.startswith("# AUTOGENERATED FILE")
    assert "import pymol.plugins" in text
    assert "'verbose': True" in text
    assert "pymol.plugins.autoload =" in text
    # the third thing it persists, and the reason row 462 and row 461 share a
    # confirmation flow: ONE file carries prefs, autoload AND the startup paths
    assert "pymol.plugins.set_startup_path(" in text

    ws.call("plugins.pref_set", "verbose", False)


def test_pref_save_reports_an_unwritable_target_without_raising(ws, plugin_prefs) -> None:
    """The failure mode a client must not read as success.

    ``pref_save`` catches ``IOError``, PRINTS ``Plugin-Error: Cannot write
    Plugins resource file to ...`` and returns None — the same None it returns
    on success.  So the reply frame cannot distinguish them and the panel has
    to watch the feedback topic (or re-read) instead of trusting ``t: ok``.
    """
    reply = ws.call_reply("plugins.pref_save", "/p8a10-no-such-dir/x.py", 0)
    assert reply["t"] == "ok"
    assert reply["result"] is None


# ---------------------------------------------------------------------------
# row: "Plugin startup paths"
# ---------------------------------------------------------------------------


def test_set_startup_path_replaces_only_the_user_slice(ws, startup_paths, tmp_path) -> None:
    """``__path__[:-N_NON_USER_PATHS] = p`` — the installation tail is fixed.

    This is what decides the panel's shape.  ``get_startup_path()`` here
    returns TWO directories and ``get_startup_path(True)`` returns ZERO: both
    of the visible entries are installation paths that ``set_startup_path`` can
    never touch, so an "add/remove/reorder" UI over the full list would be
    lying about two of its rows.
    """
    installation = ws.call("plugins.get_startup_path")[len(startup_paths) :]
    assert len(installation) == 2, installation

    a = str(tmp_path / "a")
    b = str(tmp_path / "b")
    os.makedirs(a, exist_ok=True)
    os.makedirs(b, exist_ok=True)

    ws.call("plugins.set_startup_path", [a, b], False)
    assert ws.call("plugins.get_startup_path", True) == [a, b]
    assert ws.call("plugins.get_startup_path") == [a, b] + installation

    # reorder
    ws.call("plugins.set_startup_path", [b, a], False)
    assert ws.call("plugins.get_startup_path", True) == [b, a]
    # remove
    ws.call("plugins.set_startup_path", [b], False)
    assert ws.call("plugins.get_startup_path", True) == [b]
    assert ws.call("plugins.get_startup_path") == [b] + installation


def test_set_startup_path_fails_silently_on_a_non_list(ws, startup_paths, tmp_path) -> None:
    """``else: print(' Error: set_startup_path failed')`` — no exception.

    A client that sends a string (the obvious mistake when the UI edits one
    row) gets ``t: ok`` and an unchanged path list.  The panel therefore has to
    send a list and RE-READ, which is what it does.
    """
    a = str(tmp_path / "a")
    os.makedirs(a, exist_ok=True)
    ws.call("plugins.set_startup_path", [a], False)

    reply = ws.call_reply("plugins.set_startup_path", a, False)
    assert reply["t"] == "ok" and reply["result"] is None
    assert ws.call("plugins.get_startup_path", True) == [a], "a string must not apply"


def test_a_new_startup_path_is_scanned_by_findplugins(ws, startup_paths, tmp_path) -> None:
    """Adding a path CHANGES WHAT IS DISCOVERED, which is the point of the tab."""
    extra = tmp_path / "extra"
    extra.mkdir()
    (extra / "p8a10_fake_plugin.py").write_text("# not imported by findPlugins\n")

    paths = ws.call("plugins.get_startup_path")
    assert "p8a10_fake_plugin" not in ws.call("plugins.findPlugins", paths)

    ws.call("plugins.set_startup_path", [str(extra)], False)
    paths = ws.call("plugins.get_startup_path")
    found = ws.call("plugins.findPlugins", paths)
    assert found["p8a10_fake_plugin"] == str(extra / "p8a10_fake_plugin.py")
    # the installation plugins are still there: the tail was not replaced
    assert "apbs_gui" in found


def test_the_selection_topic_publishes_nothing_when_pk1_moves(ws, picked) -> None:
    """Why the Properties Inspector POLLS pk1 instead of subscribing.

    Inventory row 447's React plan asks for "a pk1-changed event so the panel
    follows viewport picks".  The ``selection`` topic exists and ACCEPTS the
    subscription, which is the trap: a client can wire itself up, see
    ``subscribed: true``, and wait forever.  Nothing publishes to it —
    ``grep -rn TOPIC_SELECTION packages/bridge/tenmol_bridge`` finds only the two
    registry entries — so the pick below produces no frame at all.

    This is deliberately NOT phrased as "no event may ever arrive": the day
    someone wires the publisher up, this test should be deleted, not defended.
    What it pins is that the mechanism the row asked for is absent TODAY, which
    is the whole justification for the poll.
    """
    assert ws.subscribe("selection")["result"]["subscribed"] is True
    before = len(ws.events)

    ws.call("edit", "%s`3" % PICK_MOLECULE)
    assert ws.call("index", "?pk1") == [[PICK_MOLECULE, 3]]
    ws.pump_frames(1.5)

    selection_frames = [e for e in ws.events[before:] if e.get("topic") == "selection"]
    assert selection_frames == []


def test_index_qmark_pk1_is_the_whole_poll_in_one_call(ws, picked) -> None:
    """``cmd.index('?pk1')`` -> ``[[model, index]]`` or ``[]``.

    The panel's existing ``readPk1`` needs THREE round trips
    (``get_names('selections')``, ``get_model('pk1')``,
    ``get_object_list('pk1')``), which is too much to repeat on a timer.  This
    is the same information in one, and the ``?`` prefix is load-bearing:
    without it an absent pick is a CmdException, not an empty list, so every
    poll of an unpicked session would be an error frame.
    """
    ws.call("unpick")
    assert ws.call("index", "?pk1") == []
    bare = ws.call_reply("index", "pk1")
    assert bare["t"] == "err"
    assert bare["error"]["message"] == " Error: invalid selection"

    ws.call("edit", "%s`3" % PICK_MOLECULE)
    assert ws.call("index", "?pk1") == [[PICK_MOLECULE, 3]]
    # and it MOVES, which is what the poll is watching for
    ws.call("edit", "%s`7" % PICK_MOLECULE)
    assert ws.call("index", "?pk1") == [[PICK_MOLECULE, 7]]


def test_set_startup_path_autosave_is_the_flag_that_writes_the_home_file(
    ws, plugin_prefs, startup_paths, tmp_path
) -> None:
    """``autosave=True`` routes through ``set_pref_changed`` — hence the confirm.

    With ``instantsave`` off (the fixture) neither value writes, which is the
    safe combination this module runs in.  What is asserted is the CALL SHAPE:
    ``set_startup_path`` takes the flag, so the panel can offer "apply for this
    session" and "apply and save" as two different buttons rather than one
    button with a surprise.
    """
    a = str(tmp_path / "a")
    os.makedirs(a, exist_ok=True)
    assert ws.call_reply("plugins.set_startup_path", [a], True)["t"] == "ok"
    assert ws.call("plugins.get_startup_path", True) == [a]
    assert b"'instantsave': False" not in _read_pluginsrc()
