"""Area 10 — ``cmd.volume_panel`` as a real entry point, and ``volume_ramp_changed``.

WHAT THIS FILE CLOSES
---------------------
Two inventory rows carried the same blocker for three waves:

* **"Volume Color Map Editor container"** — *"NOT done: ``cmd.volume_panel(name)``
  as the entry point (fails with ``ImportError: pymol.Qt``) and the
  ``volume_ramp_changed`` event."*
* **"Named volume ramp presets"** — *"the 'panel' menu entry is not wired"*,
  because the leaf ``menu.vol_color`` returns is ``cmd.volume_panel(<sele>)``
  and that command crashed.

``packages/bridge/tenmol_bridge/panels/volume.py`` is the answer to both: it rebinds
``cmd.volume_panel`` and ``cmd.volume_color`` (and the two matching entries in
``cmd.keyword``, so the typed command language reaches the shims too), records
open requests and ramp changes in a cursor-addressed log, and never imports Qt
or Tk.  Everything below is measured over a real socket.

SHARED-STATE DISCIPLINE
-----------------------
The suite shares one PyMOL process and this module patches TWO GLOBAL
CALLABLES, so the fixture is not optional:

* :func:`volume_api` installs before and ``uninstall()``s after every test, and
  asserts the restored callables are ``pymol.colorramping``'s own again.  Note
  the file name: ``test_p10_volume`` sorts BEFORE ``test_p8_a10``, whose
  :func:`test_volume_panel_is_qt_only_and_says_so` still expects the crashing
  original — leaving the shim installed would turn that test red.
* Every object is prefixed ``p10vol_`` and deleted.
* ``colorramping.namedramps`` has no removal API, so the one test that
  registers a ramp deletes the key straight out of the dict again; an
  ``assert ... >=`` in ``test_p8_a10`` would survive the leak, but the exact-set
  assertion here would not survive anyone else's.
* Nothing here calls the ORIGINAL ``cmd.volume_panel``.  That is deliberate:
  it leaves ``pmg_qt`` in ``sys.modules`` for the life of the process (see
  ``test_wf_plugins.py``), and this module proves the restoration by comparing
  ``__module__`` instead of by triggering the crash a second time.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Iterator, List

import pytest

BOOTSTRAP = "/import tenmol_bridge.panels.volume as _tv;_tv.install()"
NS = "cmd.tenmol_volume"

MOLECULE = "p10vol_mol"
MAP_OBJECT = "p10vol_map"
VOLUME_OBJECT = "p10vol_vol"

#: The globals ``map_new(type='gaussian')`` reads.  Forced and restored for the
#: same reason ``test_p8_a10.py`` does it: another test's leaked
#: ``gaussian_resolution`` would change the map under us.
MAP_SETTINGS = {
    "gaussian_resolution": 2.0,
    "gaussian_b_floor": 0.0,
    "gaussian_b_adjust": 0.0,
    "volume_data_range": 5.0,
}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def probe(ws, bridge, tag: str, expr: str) -> str:
    """Read a non-callable expression.

    The dispatcher invokes CALLABLES only, so an attribute is unreachable by
    ``{t:'call'}``.  ``print`` through ``{t:'do'}`` is the way, and PyMOL echoes
    the command line before running it — so the echo carries the tag too and is
    dropped by the ``print(`` filter.

    The match is on ``<tag> `` and not on ``tag in line``, which cost a
    debugging round: the poller's ring buffer keeps every line the whole
    session, so ``P10VOLA`` matched a line an earlier test had printed under
    ``P10VOLA2`` and the value came back with a stray leading space.
    """
    ws.do("print(%r, %s)" % (tag, expr))
    bridge.wait_for_feedback(tag + " ")
    printed = [
        line
        for line in bridge.feedback_lines()
        if line.strip().startswith(tag + " ") and "print(" not in line
    ]
    assert printed, bridge.feedback_lines()[-6:]
    return printed[-1].strip()[len(tag) + 1 :]


def drain(ws, cursor: int = 0) -> Dict[str, Any]:
    return ws.call(NS + ".drain", cursor)


def events_of(reply: Dict[str, Any], kind: str, name: str) -> List[Dict[str, Any]]:
    return [e for e in reply["events"] if e["kind"] == kind and e["name"] == name]


def wait_for_event(ws, cursor: int, kind: str, name: str, timeout: float = 5.0):
    """Poll ``drain`` until the event shows up.

    ``volume_color`` returns before the event is necessarily visible to another
    socket frame, and "read it back in the same millisecond as the write" is
    exactly the failure mode this suite has been bitten by.
    """
    deadline = time.monotonic() + timeout
    last: Dict[str, Any] = {}
    while time.monotonic() < deadline:
        last = drain(ws, cursor)
        hits = events_of(last, kind, name)
        if hits:
            return hits, last
        time.sleep(0.05)
    return [], last


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def volume_api(ws, bridge) -> Iterator[Dict[str, Any]]:
    """Install the panel module; uninstall and PROVE the restore afterwards."""
    ws.do(BOOTSTRAP)
    hello = ws.call(NS + ".hello")
    assert hello["ok"] is True
    try:
        yield hello
    finally:
        ws.do("/import tenmol_bridge.panels.volume as _tv;_tv.uninstall()")
        # The identity check, without calling the crashing original.
        assert (
            probe(ws, bridge, "P10VOLRESTORE_PANEL", "cmd.volume_panel.__module__")
            == "pymol.colorramping"
        )
        assert (
            probe(ws, bridge, "P10VOLRESTORE_KEYWORD", "cmd.keyword['volume_color'][0].__module__")
            == "pymol.colorramping"
        )


@pytest.fixture
def volume(ws) -> Iterator[str]:
    """A real volume object, built the way ``test_p8_a10.py`` builds one."""
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


# ---------------------------------------------------------------------------
# row 431 — cmd.volume_panel IS the entry point now
# ---------------------------------------------------------------------------


def test_volume_panel_no_longer_raises_and_records_the_request(volume_api, ws, volume):
    """The exact call ``test_p8_a10`` pinned as ``ImportError: pymol.Qt``.

    It answers ``ok`` with ``None`` — upstream's Qt branch returns ``None`` too,
    after handing the panel to the event loop — and the request is in the log
    with the volume's name on it.
    """
    before = drain(ws)["cursor"]

    reply = ws.call_reply("volume_panel", volume)
    assert reply["t"] == "ok", reply
    assert reply["result"] is None

    hits, after = wait_for_event(ws, before, "panel", volume)
    assert len(hits) == 1, after
    assert hits[0]["seq"] == before + 1
    assert hits[0]["stops"] == 0
    assert after["cursor"] == before + 1


def test_open_reports_whether_the_volume_exists(volume_api, ws, volume):
    """``cmd.tenmol_volume.open`` is the form with an answer.

    ``volume_panel`` keeps upstream's ``None``; a client that wants to know
    whether the name is real calls this instead.  Upstream never checks, and a
    panel titled after a non-existent object is exactly the kind of silent
    nothing this reports instead.
    """
    real = ws.call(NS + ".open", volume)
    assert real["ok"] is True and real["name"] == volume and real["exists"] is True

    ghost = ws.call(NS + ".open", "p10vol_no_such_volume")
    assert ghost["exists"] is False
    assert ghost["seq"] == real["seq"] + 1


def test_the_typed_command_reaches_the_shim_too(volume_api, ws, bridge, volume):
    """``PyMOL>volume_panel p10vol_vol`` — the command LANGUAGE, not the API.

    ``cmd.keyword`` holds function objects captured when ``pymol.cmd`` was
    initialised (``keywords.py:300-301``), so rebinding the module attribute
    alone leaves the prompt on the crashing original.  This is the test that
    fails if ``install()`` stops patching the table: without the patch the line
    below raises ``ImportError: pymol.Qt`` into the console AND drags ``pmg_qt``
    into ``sys.modules``.
    """
    before = drain(ws)["cursor"]
    # The poller's ring buffer is session-wide, so the console check below has
    # to be scoped to the lines THIS command produced.  Scanning all of it once
    # matched a `pymol.Qt` line another module had printed long before.
    mark = len(bridge.feedback_lines())
    ws.do("volume_panel %s" % volume)

    hits, after = wait_for_event(ws, before, "panel", volume)
    assert len(hits) == 1, after

    # ...and the crash really is absent from the console, not merely unasserted.
    time.sleep(0.3)
    assert not [line for line in bridge.feedback_lines()[mark:] if "pymol.Qt" in line]


def test_nothing_here_imports_qt_or_tk(volume_api, ws, bridge, volume):
    """The hazard ``test_p8_a10`` had to clean up by hand is gone.

    Order-independent on purpose: the assertion is that this module ADDS no
    ``pmg_qt`` and no ``tkinter``, not that ``sys.modules`` is globally clean —
    another test may legitimately have imported ``pmg_tk.startup`` before us.
    """
    expr = "sorted(m for m in __import__('sys').modules if m.split('.')[0] in ('pmg_qt','tkinter'))"
    before = probe(ws, bridge, "P10VOLMODS1", expr)

    ws.call_reply("volume_panel", volume)
    ws.do("volume_panel %s" % volume)
    ws.call(NS + ".open", volume)
    ws.call(NS + ".watch", volume)
    ws.call("volume_color", volume, "rainbow")
    ws.call(NS + ".unwatch", volume)

    after = probe(ws, bridge, "P10VOLMODS2", expr)
    assert after == before == "[]"


# ---------------------------------------------------------------------------
# row 431 — the volume_ramp_changed event
# ---------------------------------------------------------------------------


def test_ramp_change_fires_only_for_a_watched_name(volume_api, ws, volume):
    """``colorramping.py:170-179`` — ``name in _volume_windows_qt``, as an event.

    Three halves in one test because they are one behaviour: an unwatched
    volume is silent, a watched one reports the NEW STOP COUNT, and unwatching
    goes silent again.  ``rainbow2`` is six ``peak()`` triples = 18 stops
    (``colorramping.py:47-53``); ``rainbow`` is six = 6.
    """
    assert ws.call(NS + ".watching") == []

    # 1. not watched -> nothing
    before = drain(ws)["cursor"]
    ws.call("volume_color", volume, "rainbow")
    time.sleep(0.4)
    assert events_of(drain(ws, before), "ramp", volume) == []

    # 2. watched -> one event carrying the stop count
    assert ws.call(NS + ".watch", volume)["watching"] == [volume]
    before = drain(ws)["cursor"]
    ws.call("volume_color", volume, "rainbow2")
    hits, after = wait_for_event(ws, before, "ramp", volume)
    assert len(hits) == 1, after
    assert hits[0]["stops"] == 18
    assert len(ws.call("volume_color", volume)) == 18 * 5

    before = drain(ws)["cursor"]
    ws.call("volume_color", volume, "rainbow")
    hits, after = wait_for_event(ws, before, "ramp", volume)
    assert len(hits) == 1 and hits[0]["stops"] == 6, after

    # 3. unwatched -> silent again
    assert ws.call(NS + ".unwatch", volume)["watching"] == []
    before = drain(ws)["cursor"]
    ws.call("volume_color", volume, "rainbow2")
    time.sleep(0.4)
    assert events_of(drain(ws, before), "ramp", volume) == []


def test_the_panels_own_pushes_do_not_bounce_back(volume_api, ws, volume):
    """``_guiupdate=0`` is why the editor does not fight itself.

    ``features/volume/service.ts`` sends ``{_guiupdate: 0}`` on every push, as
    ``pmg_qt/volume.py`` does, so a drag that writes 60 ramps a second produces
    ZERO events while the same write from a script produces one.  Both halves
    are measured here with the panel WATCHED, which is the only state in which
    the difference is observable.
    """
    ws.call(NS + ".watch", volume)
    try:
        flat = ws.call("volume_color", volume)
        assert isinstance(flat, list) and flat

        before = drain(ws)["cursor"]
        for _ in range(5):
            ws.call("volume_color", volume, flat, _guiupdate=0)
        time.sleep(0.4)
        assert events_of(drain(ws, before), "ramp", volume) == []

        before = drain(ws)["cursor"]
        ws.call("volume_color", volume, flat)
        hits, after = wait_for_event(ws, before, "ramp", volume)
        assert len(hits) == 1, after
        assert hits[0]["stops"] == len(flat) // 5
    finally:
        ws.call(NS + ".unwatch", volume)


def test_the_typed_volume_color_still_parses_and_fires(volume_api, ws, volume):
    """The shim keeps upstream's SIGNATURE, and this is why that matters.

    ``parsing.STRICT`` introspects the function to turn ``vol, rainbow2`` into
    a call (``keywords.py:300``), so a ``*args, **kwargs`` wrapper would leave
    the Python API working and silently break the prompt.  Both the parse and
    the event are asserted, plus the ramp the engine ended up holding.
    """
    ws.call(NS + ".watch", volume)
    try:
        before = drain(ws)["cursor"]
        ws.do("volume_color %s, rainbow2" % volume)
        hits, after = wait_for_event(ws, before, "ramp", volume)
        assert len(hits) == 1, after
        assert hits[0]["stops"] == 18
        assert len(ws.call("volume_color", volume)) == 90
    finally:
        ws.call(NS + ".unwatch", volume)


def test_the_getter_form_never_fires(volume_api, ws, volume):
    """``if not ramp: return get_volume_color(...)`` (``colorramping.py:147``).

    The panel calls the getter on every reload; an event there would be an
    infinite reload loop.
    """
    ws.call(NS + ".watch", volume)
    try:
        before = drain(ws)["cursor"]
        for _ in range(3):
            assert isinstance(ws.call("volume_color", volume), list)
        # an EMPTY list is a get too, by upstream's own truthiness test
        assert ws.call("volume_color", volume, []) is not None
        time.sleep(0.4)
        assert events_of(drain(ws, before), "ramp", volume) == []
    finally:
        ws.call(NS + ".unwatch", volume)


def test_drain_is_cursor_addressed_and_non_destructive(volume_api, ws, volume):
    """Two consumers, no theft — the settings tap's contract.

    The menu bridge and an open panel both read this log.  A destructive drain
    (``cmd.get_setting_updates``-shaped) would mean whichever polled first ate
    the other's events; plan §1.2 measured exactly that split on the feedback
    queue.
    """
    start = drain(ws)["cursor"]
    ws.call(NS + ".open", volume)
    ws.call(NS + ".open", volume)

    a = drain(ws, start)
    b = drain(ws, start)
    assert [e["seq"] for e in a["events"]] == [start + 1, start + 2]
    assert [e["seq"] for e in b["events"]] == [start + 1, start + 2]
    assert a["lost"] is False

    # ...and a cursor already at the head sees nothing new.
    assert drain(ws, a["cursor"])["events"] == []


def test_echo_puts_one_tagged_line_on_the_feedback_topic(volume_api, ws, bridge, volume):
    """``install(echo=1)`` — the zero-latency push, over the ordinary console.

    OFF by default: a machine tag in the user's PyMOL console is a real cost.
    On, it is one line per event and it reaches the browser through the
    ``feedback`` topic with no new protocol topic anywhere.
    """
    ws.do("/import tenmol_bridge.panels.volume as _tv;_tv.install(echo=1)")
    try:
        assert ws.call(NS + ".status")["echo"] is True
        ws.call(NS + ".open", volume)
        lines = bridge.wait_for_feedback("TENMOL_VOLUME panel %s" % volume)
        marker = [line for line in lines if "TENMOL_VOLUME panel" in line]
        assert marker[-1].strip() == "TENMOL_VOLUME panel %s 0" % volume
    finally:
        ws.do("/import tenmol_bridge.panels.volume as _tv;_tv.install(echo=0)")
        assert ws.call(NS + ".status")["echo"] is False


# ---------------------------------------------------------------------------
# row 446 — the preset list, read directly
# ---------------------------------------------------------------------------


def test_ramps_is_a_direct_live_read_of_namedramps(volume_api, ws):
    """"Preset list from ``pymol.colorramping.namedramps``" — literally.

    ``test_p8_a10`` proved the direct read is REFUSED by policy
    (``'colorramping' is not an addressable namespace``) and that
    ``menu.vol_color`` is a legal way round it.  This is the other way round:
    a callable on ``cmd`` that reads the dict server-side.  It is asserted as
    an EXACT set, which ``menu.vol_color`` cannot be — hence the registration
    below is deleted straight out of the dict again.
    """
    reply = ws.call(NS + ".ramps")
    assert reply["names"] == ["2fofc", "esp", "fofc", "rainbow", "rainbow2"]
    assert reply["builtin"] == reply["names"]
    assert reply["extra"] == []

    ws.call("volume_ramp_new", "p10vol_probe", [1.0, "blue", 0.0, 2.0, "red", 0.3])
    try:
        live = ws.call(NS + ".ramps")
        assert "p10vol_probe" in live["names"]
        assert live["extra"] == ["p10vol_probe"]
        # sorted(namedramps): 'p' sorts between 'fofc' and 'rainbow', so it lands
        # in place rather than at the end
        assert live["names"].index("p10vol_probe") == 3
    finally:
        ws.do(
            "/from pymol import colorramping;"
            "colorramping.namedramps.pop('p10vol_probe', None)"
        )
    assert ws.call(NS + ".ramps")["names"] == ["2fofc", "esp", "fofc", "rainbow", "rainbow2"]


def test_the_panel_leaf_menu_vol_color_returns_is_now_live(volume_api, ws, volume):
    """The leaf from ``menu.py:648`` runs, end to end.

    ``menu.vol_color`` builds ``cmd.volume_panel('<sele>')`` as its first leaf.
    Row 446's gap was that this string could not be executed; here it is taken
    from the engine's own reply and sent back as a ``{t:'do'}`` frame — which
    is exactly what a menu click does — and the open request lands.
    """
    rows = ws.call("menu.vol_color", None, volume)
    leaf = rows[1]
    assert leaf[0] == 1 and leaf[1] == "panel"
    assert leaf[2] == "cmd.volume_panel('%s')" % volume

    before = drain(ws)["cursor"]
    ws.do(leaf[2])
    hits, after = wait_for_event(ws, before, "panel", volume)
    assert len(hits) == 1, after


def test_every_preset_leaf_applies_and_reports_its_stop_count(volume_api, ws, volume):
    """The other leaves of the same menu, with the event as the witness.

    One assertion per built-in ramp, from the engine's own command string, with
    the panel watched — so this is simultaneously "the preset applies" and "the
    open editor is told about it".
    """
    ws.call(NS + ".watch", volume)
    try:
        rows = ws.call("menu.vol_color", None, volume)
        leaves = [r for r in rows if r[0] == 1 and r[2].startswith("cmd.volume_color(")]
        assert [r[1] for r in leaves][:5] == [
            "2fofc",
            "esp",
            "fofc",
            "rainbow",
            "rainbow2",
        ]
        expected = {"2fofc": 3, "esp": 6, "fofc": 6, "rainbow": 6, "rainbow2": 18}
        for code, label, command in leaves:
            if label not in expected:
                continue
            before = drain(ws)["cursor"]
            ws.do(command)
            hits, after = wait_for_event(ws, before, "ramp", volume)
            assert len(hits) == 1, (label, after)
            assert hits[0]["stops"] == expected[label], label
            assert len(ws.call("volume_color", volume)) == expected[label] * 5
    finally:
        ws.call(NS + ".unwatch", volume)


# ---------------------------------------------------------------------------
# install / uninstall discipline
# ---------------------------------------------------------------------------


def test_install_is_idempotent_and_does_not_double_wrap(volume_api, ws, bridge, volume):
    """Reconnects are free, and a second install must not stack a wrapper.

    A stacked wrapper would emit TWO events per set, which is the observable
    form of the bug.
    """
    ws.do(BOOTSTRAP)
    ws.do(BOOTSTRAP)
    assert (
        probe(ws, bridge, "P10VOLIDEM", "cmd.volume_color.__module__")
        == "tenmol_bridge.panels.volume"
    )

    ws.call(NS + ".watch", volume)
    try:
        before = drain(ws)["cursor"]
        ws.call("volume_color", volume, "rainbow")
        hits, after = wait_for_event(ws, before, "ramp", volume)
        assert len(hits) == 1, after
    finally:
        ws.call(NS + ".unwatch", volume)


def test_status_reports_what_is_installed(volume_api, ws, volume):
    status = ws.call(NS + ".status")
    assert status["attr"] == "tenmol_volume"
    assert status["tag"] == "TENMOL_VOLUME"
    assert status["watching"] == []
    ws.call(NS + ".watch", volume)
    try:
        assert ws.call(NS + ".status")["watching"] == [volume]
        # watching twice is not two entries
        ws.call(NS + ".watch", volume)
        assert ws.call(NS + ".status")["watching"] == [volume]
    finally:
        ws.call(NS + ".unwatch", volume)
    assert ws.call(NS + ".status")["watching"] == []
