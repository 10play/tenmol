"""Wave 10 — the bridge server, session, pump, engine and policy.

Eight inventory rows were left partial in earlier waves with some form of
"needs the bridge server, which is on the do-not-edit list".  This file is the
evidence for the ones that were genuinely blocked on those files:

  ``00:58``   quick buttons + progress bar  (the progress payload SHAPE)
  ``00:77``   application startup seams     (a heartbeat that notices a gone tab)
  ``00:208``  change notification feed      (the ``settings`` push)
  ``00:209``  setting side effects          (the same push; the layout latency)
  ``00:295``  plugin file dialogs           (``_bridge.answer_dialog`` + push)
  ``00:337``  camera commands               (``cmd.viewport`` was a silent no-op)

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_p10_infra.py -q
"""

from __future__ import annotations

import os
import sys
import threading
import time
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

SETTINGS_BOOTSTRAP = "/import tenmol_bridge.panels.settings as _s;_s.install()"
FILES_BOOTSTRAP = "/import tenmol_bridge.panels.files as _f;_f.install()"


def _events(ws: WSClient, topic: str) -> List[Dict[str, Any]]:
    return [f for f in ws.events if f.get("topic") == topic]


def _drain(ws: WSClient, seconds: float = 0.4) -> None:
    ws.pump_frames(seconds)


def _index_of(ws: WSClient, name: str) -> int:
    """A setting's index, through the catalogue (``setting._get_index`` is not
    an addressable symbol — it is private and ungranted, correctly)."""
    catalogue = ws.call("setting.tenmol_settings_catalogue")
    for row in catalogue["settings"]:
        if row["name"] == name:
            return int(row["index"])
    raise AssertionError("no setting called %r" % name)


# ==========================================================================
# 00:58 — the progress payload agrees with the type that declares it
# ==========================================================================


def test_progress_payload_is_the_shape_progress_ts_declares(ws: WSClient) -> None:
    """The known defect, closed.

    ``server.py`` emitted ``{"value": <float>}`` while
    ``packages/protocol/src/topics/progress.ts`` declared
    ``{fraction, busy, label, abortable}`` — ZERO overlapping field names, so a
    consumer reading ``payload.fraction`` got ``undefined``.  It only ever
    worked because ``apps/web/src/app/session.ts`` read both names and left a
    comment saying so.

    ``label`` was deleted from the interface rather than faked: the busy text
    is ``I->BusyMessage`` and there is no accessor (``cmd.get_busy`` does not
    exist; ``pymol._cmd.get_busy`` is a flag).
    """
    ws.subscribe("progress")
    _drain(ws, 0.6)
    payloads = [f["payload"] for f in _events(ws, "progress")]
    assert payloads, ws.events[-3:]
    for payload in payloads:
        assert set(payload) == {"fraction", "busy", "abortable"}, payload
        assert isinstance(payload["fraction"], float)
        assert isinstance(payload["busy"], bool)
        assert isinstance(payload["abortable"], bool)
        assert payload["busy"] is (payload["fraction"] >= 0.0)
        assert payload["abortable"] is payload["busy"]

    # Idle is EXACTLY -1.0 on this build, which is what makes `busy` and Qt's
    # `int(get_progress()*100) >= 0` the same predicate.
    assert payloads[-1]["fraction"] == -1.0, payloads[-1]
    assert payloads[-1]["busy"] is False


def test_progress_payload_helper_is_the_single_definition() -> None:
    """A unit-level pin so the shape cannot drift back one field at a time."""
    from tenmol_bridge.session import progress_payload

    assert progress_payload(-1.0) == {
        "fraction": -1.0,
        "busy": False,
        "abortable": False,
    }
    assert progress_payload(0.3526) == {
        "fraction": 0.3526,
        "busy": True,
        "abortable": True,
    }
    assert progress_payload(0.0)["busy"] is True


# ==========================================================================
# 00:337 — cmd.viewport is no longer a silent no-op
# ==========================================================================


@pytest.fixture
def viewport_ws(bridge):
    """A client that puts the shared engine's window size back afterwards."""
    client = WSClient(bridge.ws_url)
    before = list(client.call("cmd.get_viewport"))
    try:
        yield client
    finally:
        client.request(
            t="input", kind="reshape", width=before[0], height=before[1]
        )
        time.sleep(0.3)
        client.close()


def test_cmd_viewport_now_resizes_the_scene_and_the_offscreen_buffer(
    viewport_ws: WSClient, bridge
) -> None:
    """DEFECT CLOSED.  ``viewport 640,480`` used to do nothing at all.

    ``CmdViewport`` ends at ``PyMOL_NeedReshape(..., mode 2, ...)``
    (``layer4/Cmd.cpp:4968``), which with ``G->HaveGUI`` true only raises
    ``I->ReshapeFlag`` for the host to collect with ``PyMOL_GetReshapeInfo``.
    That accessor is NOT wrapped in Python anywhere (``layer5/PyMOL.h:294,300``
    vs ``modules/pymol2/__init__.py``), so "drain the flag in the pump" — what
    waves 7-9 reported as the fix — is not reachable without a C++ change.
    ``execapp`` does not drain it either: it REPLACES the command
    (``pymol_qt_gui.py:1229-1231``).  The bridge now installs the same seam.
    """
    ws = viewport_ws
    engine = bridge.pump.engine
    before = list(ws.call("cmd.get_viewport"))
    assert [engine.width, engine.height] == before

    assert ws.call_reply("cmd.viewport", 640, 480)["t"] == "ok"
    time.sleep(0.3)
    assert list(ws.call("cmd.get_viewport")) == [640, 480]
    assert [engine.width, engine.height] == [640, 480]

    # And the command LANGUAGE, not just the API: `keywords.py:298` captured
    # the original function object when PyMOL started, so `cmd.extend` is the
    # half that makes a typed `viewport` line work.
    ws.do("viewport 700, 500")
    time.sleep(0.4)
    assert list(ws.call("cmd.get_viewport")) == [700, 500]


def test_cmd_viewport_keeps_the_aspect_when_one_dimension_is_omitted(
    viewport_ws: WSClient,
) -> None:
    """``pymolviewport`` (``pymol_qt_gui.py:66-73``), transcribed and measured.

    ``h < 1`` -> ``h = w * ch / cw``; ``w < 1`` -> ``w = h * cw / ch``.
    """
    ws = viewport_ws
    ws.call("cmd.viewport", 800, 600)
    time.sleep(0.3)
    assert list(ws.call("cmd.get_viewport")) == [800, 600]

    ws.call("cmd.viewport", 400)  # height defaults to -1
    time.sleep(0.3)
    assert list(ws.call("cmd.get_viewport")) == [400, 300], "4:3 not preserved"

    ws.call("cmd.viewport", -1, 600)
    time.sleep(0.3)
    assert list(ws.call("cmd.get_viewport")) == [800, 600]


def test_the_bare_viewport_command_forces_the_reshape_layout_settings_need(
    viewport_ws: WSClient, bridge
) -> None:
    """00:209's remaining latency, measured before and after.

    Seven settings' ONLY side effect is ``OrthoCommandIn(G, "viewport")``
    (``layer1/Setting.cpp:2824-2833``).  Wave 7 measured what that used to
    mean: ``set internal_feedback, 3`` left ``cmd.get_viewport()`` answering
    800x600 and it became 800x558 only after the browser happened to resize —
    so the scene rectangle silently stopped agreeing with the canvas by 42 px,
    taking every forwarded mouse coordinate with it.

    Qt's answer to the bare command is ``pw.pymol.reshape(w, h, True)`` at the
    CURRENT window size (``pymol_qt_gui.py:67-70``): the window keeps its size
    and the scene absorbs the band.  That is what happens now.
    """
    ws = viewport_ws
    ws.call("cmd.set", "internal_feedback", 0)
    ws.request(t="input", kind="reshape", width=800, height=600)
    time.sleep(0.3)
    assert list(ws.call("cmd.get_viewport")) == [800, 600]
    engine = bridge.pump.engine
    window_before = (engine.width, engine.height)

    try:
        ws.call("cmd.set", "internal_feedback", 3)
        time.sleep(0.4)
        # (3-1)*cOrthoLineHeight + cOrthoBottomSceneMargin = 2*12 + 18 = 42
        assert list(ws.call("cmd.get_viewport")) == [800, 558]
        assert (engine.width, engine.height) == window_before, (
            "the WINDOW moved; Qt resizes the scene here, not the window"
        )
    finally:
        ws.call("cmd.set", "internal_feedback", 0)
        time.sleep(0.4)
    assert list(ws.call("cmd.get_viewport")) == [800, 600]

    # A second of the seven, on the WIDTH axis rather than the height, so the
    # claim is about the shared `OrthoCommandIn(G, "viewport")` mechanism and
    # not about one setting's arithmetic.
    try:
        ws.call("cmd.set", "internal_gui_width", 220)
        ws.call("cmd.set", "internal_gui", 1)
        time.sleep(0.4)
        after = list(ws.call("cmd.get_viewport"))
        assert after[1] == 600, after
        assert after[0] < 800, "internal_gui did not take the column on the write"
        assert (engine.width, engine.height) == window_before
    finally:
        ws.call("cmd.set", "internal_gui", 0)
        time.sleep(0.4)
    assert list(ws.call("cmd.get_viewport")) == [800, 600]


# ==========================================================================
# 00:208 / 00:209 — the settings push
# ==========================================================================


@pytest.fixture
def settings_ws(bridge):
    client = WSClient(bridge.ws_url)
    client.do(SETTINGS_BOOTSTRAP)
    saved = client.call("cmd.get", "cartoon_ring_mode")
    try:
        yield client
    finally:
        client.call("cmd.set", "cartoon_ring_mode", saved)
        client.close()


def test_a_setting_write_is_pushed_on_the_settings_topic(
    settings_ws: WSClient,
) -> None:
    """00:208's own gap: "NOT done: the push ``settings.changed`` topic".

    ``TOPIC_SETTINGS`` accepted a subscription and NOTHING anywhere published
    to it — waves 4, 7, 8 and 9 all recorded that, and all four named the same
    unreachable line, ``BridgeServer._on_status``.

    The payload is ``SettingsPayload`` (``topics/settings.ts:235-246``):
    ``changed`` keyed by the index as a decimal string, each entry a
    ``SettingChange`` with index/name/kind/value/text.
    """
    ws = settings_ws
    ws.subscribe("settings")
    _drain(ws, 0.5)
    ws.events.clear()

    ws.call("cmd.set", "cartoon_ring_mode", 3)
    deadline = time.monotonic() + 5.0
    events: List[Dict[str, Any]] = []
    while time.monotonic() < deadline and not events:
        _drain(ws, 0.2)
        events = [e for e in _events(ws, "settings") if e["payload"].get("changed")]
    assert events, ws.events[-3:]

    payload = events[-1]["payload"]
    index = _index_of(ws, "cartoon_ring_mode")
    entry = payload["changed"][str(index)]
    assert entry["index"] == index
    assert entry["name"] == "cartoon_ring_mode"
    assert entry["kind"] == "int"
    assert entry["value"] == 3
    assert entry["text"] == "3"
    assert payload["full"] is False
    assert index in payload["indices"]


def test_the_push_beats_the_5_hz_tap_poll_the_client_used_instead(
    settings_ws: WSClient,
) -> None:
    """The 200 ms this row exists to remove, measured.

    Wave 4 shipped a cursor-addressed poll of ``tenmol_settings_drain`` at
    5 Hz and called it "lossless, but +200 ms".  The push comes off the same
    10 Hz status thread that drains ``get_setting_updates``, so the ceiling is
    one status interval plus the socket.
    """
    ws = settings_ws
    ws.subscribe("settings")
    _drain(ws, 0.5)
    ws.events.clear()

    t0 = time.monotonic()
    ws.call("cmd.set", "cartoon_ring_mode", 2)
    latency = None
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and latency is None:
        _drain(ws, 0.05)
        for event in _events(ws, "settings"):
            if event["payload"].get("changed"):
                latency = time.monotonic() - t0
                break
    assert latency is not None, "no push at all"
    # MEASURED, three runs: 0.1074 / 0.1084 / 0.1068 s — one 10 Hz status
    # interval plus the socket. The bound is 2.5 intervals, which is still
    # below the 0.2 s the 5 Hz poll costs at its worst.
    assert latency < 0.25, "push took %.4f s; the 5 Hz poll it replaces is 0.2 s" % latency


def test_the_push_does_not_open_a_second_drain(settings_ws: WSClient) -> None:
    """The invariant this row exists to protect, re-asserted with the push on.

    ``cmd.get_setting_updates()`` clears the flags as it reads them, so a
    second consumer silently splits the stream.  The push is a fan-out of what
    the status thread already received; the tap the client polls is a fan-out
    of the same call.  BOTH must still see the write.
    """
    ws = settings_ws
    ws.subscribe("settings")
    cursor = int(ws.call("setting.tenmol_settings_drain", 0)["cursor"])
    ws.events.clear()

    index = _index_of(ws, "cartoon_ring_mode")
    ws.call("cmd.set", "cartoon_ring_mode", 1)
    time.sleep(0.6)
    _drain(ws, 0.3)

    pushed = [
        e["payload"] for e in _events(ws, "settings") if e["payload"].get("changed")
    ]
    assert pushed, "the push lost the write"
    assert str(index) in pushed[-1]["changed"]

    tapped = ws.call("setting.tenmol_settings_drain", cursor)
    assert index in tapped["indices"], "the tap lost the write to the push"

    # And the client still cannot drain it itself.
    refused = ws.call_reply("cmd.get_setting_updates")
    assert refused["t"] == "err" and refused["error"]["kind"] == "NotAllowed"


def test_a_full_resync_ships_no_values(bridge) -> None:
    """798 enriched rows per client per session load is the wrong answer.

    ``SettingsPayload.full`` exists to say "refetch"; the payload therefore
    carries the indices and an empty ``changed``.  Asserted at the unit level
    because provoking a real 780-index drain means ``reinitialize``, which
    would take the shared engine's whole session with it.
    """
    from tenmol_bridge.server import _enrich_settings

    payload = _enrich_settings(bridge.pump.engine, list(range(700)), True)
    assert payload["full"] is True
    assert payload["changed"] == {}
    assert len(payload["indices"]) == 700


# ==========================================================================
# 00:295 — the plugin dialog push and _bridge.answer_dialog
# ==========================================================================


@pytest.fixture
def dialog_ws(bridge):
    client = WSClient(bridge.ws_url)
    client.do(FILES_BOOTSTRAP)
    # BEFORE the install: `install_tk_filedialog` seeds `sys.modules
    # ['tkFileDialog']` itself (`files.py:910`), so snapshotting afterwards
    # would treat the shim's own entry as pre-existing and never remove it.
    installed_before = client.call("cmd.tenmol_files.tk_dialogs_status")["installed"]
    tk_before = {
        m for m in sys.modules if m.split(".")[0] == "tkinter" or m == "tkFileDialog"
    }
    client.call("cmd.tenmol_files.install_tk_dialogs")
    # The broker is cached on the ENGINE thread by a tick hook that runs once a
    # second; give it one.
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and not bridge.healthz()["push"]["dialogBroker"]:
        time.sleep(0.1)
    assert bridge.healthz()["push"]["dialogBroker"], "broker never attached"
    try:
        yield client
    finally:
        # A dialog left parked would block a plugin thread AND would be the
        # oldest entry every later test sees. The shared-process rule applies
        # to `DialogBroker` as much as to any PyMOL global.
        for request in client.call("cmd.tenmol_files.dialog_pending"):
            client.call("cmd.tenmol_files.dialog_cancel", request["dialogId"])
        if not installed_before:
            client.call("cmd.tenmol_files.uninstall_tk_dialogs")
        client.close()
        # `sys.modules` is process-global and this process is shared. Leaving
        # `tkFileDialog` behind made `test_p9_f3.py::TestPluginDialogGivesUp`
        # ERROR in its OWN teardown — the same class of failure
        # `test_wf_files.py:73-82` records having cost a full-suite run.
        for name in list(sys.modules):
            if name not in tk_before and (
                name.split(".")[0] == "tkinter" or name == "tkFileDialog"
            ):
                del sys.modules[name]


def _park_dialog(entry: str = "askopenfilename", **options: Any) -> List[Any]:
    """Block a WORKER thread in the tkinter shim, exactly as a plugin would."""
    out: List[Any] = []

    def body() -> None:
        # `tkFileDialog`, NOT `tkinter.filedialog`: the flat Python-2 name every
        # legacy plugin uses has no real parent package, so the shim's
        # `sys.meta_path` finder answers it without dragging the genuine
        # `tkinter` into this shared process. `test_wf_plugins.py` asserts,
        # correctly, that no toolkit module is ever reachable here, and
        # `test_wf_files.py:75-80` records the full-suite run it cost to find.
        import tkFileDialog as fd  # type: ignore[import-not-found]

        out.append(getattr(fd, entry)(**options))

    thread = threading.Thread(target=body, name="p10-plugin", daemon=True)
    thread.start()
    return [thread, out]


def test_a_blocked_plugin_dialog_is_PUSHED_not_polled(dialog_ws: WSClient) -> None:
    """00:295's last gap: "STILL OPEN and needs a FROZEN file: push delivery".

    The shim inverted the protocol because ``_bridge.answer_dialog`` had no
    route and nothing published to ``TOPIC_DIALOG``, so the client polls
    ``dialog_pending`` every 700 ms.  Both halves exist now.

    ``tkinter`` NEVER enters ``sys.modules`` for real here: the shim's
    ``sys.meta_path`` finder answers the import, and reaching the genuine
    ``tkinter.filedialog`` from inside PyMOL aborts the whole process
    (``NSWindow should only be instantiated on the main thread``).
    """
    ws = dialog_ws
    ws.subscribe("dialog")
    _drain(ws, 0.3)
    ws.events.clear()

    thread, answer = _park_dialog(
        "askopenfilename",
        title="Open a structure",
        initialdir="/tmp",
        filetypes=[("PDB", ".pdb"), ("All", ".*")],
    )
    try:
        t0 = time.monotonic()
        opened = None
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and opened is None:
            _drain(ws, 0.05)
            for event in _events(ws, "dialog"):
                if event["payload"].get("event") == "opened":
                    opened = event["payload"]
                    break
        assert opened is not None, ws.events[-3:]
        latency = time.monotonic() - t0
        # MEASURED, three runs: 0.1045 / 0.1068 / 0.1061 s — one 10 Hz
        # status interval. `PluginDialogHost` polls at 700 ms.
        assert latency < 0.25, "push took %.4f s (the poll it replaces is 0.7 s)" % latency

        assert opened["kind"] == "open-file"
        assert opened["entry"] == "askopenfilename"
        assert opened["title"] == "Open a structure"
        assert opened["directory"] == "/tmp"
        # `mimic_tk._getfilter` turned the tkinter tuples into Qt filter
        # strings; the topic splits them back into the declared pairs.
        assert opened["filters"] == [["PDB", "*.pdb"], ["All", "*.*"]]
        assert opened["options"]["filter"] == "PDB (*.pdb);;All (*.*)"
        dialog_id = opened["dialogId"]

        # The answer route `topics/dialog.ts:37` declares, which did not exist.
        reply = ws.call_reply(
            "_bridge.answer_dialog", {"dialogId": dialog_id, "value": "/data/ala.pdb"}
        )
        assert reply["t"] == "ok", reply
        assert reply["result"] == {"answered": True, "error": None}

        thread.join(timeout=5.0)
        assert not thread.is_alive()
        assert answer == ["/data/ala.pdb"]

        _drain(ws, 0.3)
        closed = [
            e["payload"] for e in _events(ws, "dialog")
            if e["payload"].get("event") == "closed"
        ]
        assert closed and closed[-1]["dialogId"] == dialog_id
    finally:
        for request in ws.call("cmd.tenmol_files.dialog_pending"):
            ws.call("cmd.tenmol_files.dialog_cancel", request["dialogId"])
        thread.join(timeout=2.0)


def test_answer_dialog_refuses_an_unknown_id_and_needs_a_dialogId(
    dialog_ws: WSClient,
) -> None:
    ws = dialog_ws
    answered = ws.call("_bridge.answer_dialog", {"dialogId": 99999, "value": None})
    assert answered == {"answered": False, "error": "no open dialog 99999"}

    bad = ws.call_reply("_bridge.answer_dialog", {"value": "x"})
    assert bad["t"] == "err" and bad["error"]["kind"] == "BadMessage"


def test_the_dialog_answer_is_not_routed_through_the_engine_thread(
    dialog_ws: WSClient,
) -> None:
    """Why the route answers on the socket thread.

    A plugin dialog raised while the engine is inside a long call is the case
    that matters, and putting the ANSWER behind the pump would mean the user
    cannot dismiss the picker until the long call finishes.  Measured: the
    answer round trip completes while a 1.2 s engine task is still running.
    """
    ws = dialog_ws
    thread, answer = _park_dialog("asksaveasfilename", initialfile="out.png")
    try:
        deadline = time.monotonic() + 5.0
        dialog_id = None
        while time.monotonic() < deadline and dialog_id is None:
            pending = ws.call("cmd.tenmol_files.dialog_pending")
            if pending:
                dialog_id = pending[0]["dialogId"]
            else:
                time.sleep(0.05)
        assert dialog_id is not None

        blocker = ws.send(t="call", fn="cmd.do", args=["import time;time.sleep(1.2)"],
                          kwargs={})
        time.sleep(0.15)
        t0 = time.monotonic()
        reply = ws.call_reply(
            "_bridge.answer_dialog", {"dialogId": dialog_id, "value": "/tmp/out.png"}
        )
        elapsed = time.monotonic() - t0
        assert reply["t"] == "ok", reply
        # MEASURED, three runs: 0.0005 / 0.0005 / 0.0004 s, while a 1.2 s
        # engine task was still running. Routed through the pump it could
        # not have come back in under a second.
        assert elapsed < 0.1, "the answer waited for the engine (%.4f s)" % elapsed
        ws.wait_reply(blocker)
        thread.join(timeout=5.0)
        assert answer == ["/tmp/out.png"]
    finally:
        for request in ws.call("cmd.tenmol_files.dialog_pending"):
            ws.call("cmd.tenmol_files.dialog_cancel", request["dialogId"])
        thread.join(timeout=2.0)


def test_no_real_tkinter_ever_entered_sys_modules(dialog_ws: WSClient) -> None:
    """The landmine this suite must never trip (``test_wf_files.py:73-82``).

    Reaching the REAL ``tkinter.filedialog`` from inside PyMOL aborts the whole
    process — ``NSInternalInconsistencyException ... NSWindow should only be
    instantiated on the main thread``, ``libc++abi terminating``, pytest exit
    134 — which wave 6 reproduced by deleting the shim's finder.  Everything in
    this file goes through the flat ``tkFileDialog`` name for that reason.
    """
    leaked = sorted(m for m in sys.modules if m.split(".")[0] == "tkinter")
    assert leaked == [], leaked

    # ...and the flat name really does resolve to the shim rather than to
    # anything of tkinter's, which is what makes that safe.
    import tkFileDialog  # type: ignore[import-not-found]  # noqa: WPS433

    assert type(tkFileDialog).__name__ == "BridgeFileDialog"
    assert sorted(m for m in sys.modules if m.split(".")[0] == "tkinter") == []


# ==========================================================================
# 00:77 — a heartbeat that notices the client is gone
# ==========================================================================


def test_healthz_reports_client_liveness(bridge) -> None:
    """The observable the row asked for: "is anybody there?"."""
    health = bridge.healthz()
    liveness = health["liveness"]
    assert set(liveness) == {
        "clients",
        "clientsEver",
        "idleSeconds",
        "idleShutdownSeconds",
        "armed",
    }
    assert liveness["clientsEver"] >= 1, "the suite has connected clients"
    assert liveness["armed"] is True


def test_a_closed_tab_arms_the_watchdog_and_a_new_one_disarms_it(bridge) -> None:
    """``execapp``'s shutdown is ``closeEvent -> cmd.quit()``; a tab has none.

    Before this, ``shutdown_requested`` was set by exactly one thing, the
    routed ``cmd.quit``, so a closed tab left the engine ticking at 60 Hz for
    ever.  The disconnect itself is the heartbeat's input — a tab that is
    CLOSED sends a WebSocket close, and a machine that is SUSPENDED is closed
    by the WebSocket keep-alive ping instead; both arrive here as "no
    sessions".
    """
    server = bridge.server
    assert server.shutdown_requested is False

    client = WSClient(bridge.ws_url)
    client.call("cmd.get_viewport")
    assert bridge.healthz()["liveness"]["idleSeconds"] is None
    client.close()

    deadline = time.monotonic() + 5.0
    idle = None
    while time.monotonic() < deadline:
        idle = bridge.healthz()["liveness"]["idleSeconds"]
        if idle is not None:
            break
        time.sleep(0.1)
    assert idle is not None, "the watchdog never noticed the socket close"
    assert bridge.healthz()["shutdownRequested"] is False, "0 s means disabled"

    again = WSClient(bridge.ws_url)
    try:
        again.call("cmd.get_viewport")
        time.sleep(0.3)
        assert bridge.healthz()["liveness"]["idleSeconds"] is None, "not disarmed"
    finally:
        again.close()


def test_the_watchdog_requests_shutdown_when_the_grace_expires(bridge) -> None:
    """Waited out, not read out of the source, with the grace turned down.

    ``idle_shutdown_seconds`` defaults to 0 (off) and the reason is written at
    ``BridgeServer._check_client_liveness``: ``pnpm dev`` reloads the page
    constantly and this whole suite shares one engine across client-free
    stretches.  Turned on here for 0.4 s, then put back.
    """
    server = bridge.server
    saved = server.idle_shutdown_seconds
    # Leave no live client: the fixture's `ws` clients are per-test.
    assert not server.sessions, "another client is still attached"
    try:
        server.idle_shutdown_seconds = 0.4
        server._empty_since = None  # noqa: SLF001 - restart the clock cleanly
        deadline = time.monotonic() + 6.0
        while time.monotonic() < deadline and not server.shutdown_requested:
            time.sleep(0.1)
        assert server.shutdown_requested is True, "the grace never expired"
        assert "no client for" in (server.shutdown_reason or "")
        assert "cannot call cmd.quit" in (server.shutdown_reason or "")
        health = bridge.healthz()
        assert health["shutdownRequested"] is True
        assert health["shutdownReason"] == server.shutdown_reason
    finally:
        server.idle_shutdown_seconds = saved
        server.shutdown_requested = False
        server.shutdown_reason = None
        server._empty_since = None  # noqa: SLF001


def test_the_watchdog_never_arms_before_a_client_has_ever_connected() -> None:
    """A bridge nobody has opened yet must not decide the browser is gone."""
    from tenmol_bridge.server import BridgeServer

    server = BridgeServer.__new__(BridgeServer)
    server.sessions = []
    server.shutdown_requested = False
    server.shutdown_reason = None
    server._clients_ever = 0
    server._empty_since = None
    server.idle_shutdown_seconds = 0.001

    for _ in range(5):
        server._check_client_liveness()
        time.sleep(0.01)
    assert server.shutdown_requested is False
    assert server._empty_since is None

    server._clients_ever = 1
    server._check_client_liveness()
    assert server._empty_since is not None
    time.sleep(0.05)
    server._check_client_liveness()
    assert server.shutdown_requested is True


# ==========================================================================
# 00:467 — the policy defect any confirmation gate would have to work around
# ==========================================================================


def test_a_dotted_grant_key_can_now_fire_at_all() -> None:
    """DEFECT CLOSED.  ``Policy.check`` resolved danger with ``get(leaf)`` only.

    Wave 6 measured this and could not fix it (``policy/base.py`` was another
    agent's file for four waves): a work package writing the obvious thing,
    ``Grant(dangerous={"subproc.execute": "..."})`` — the same spelling
    ``Grant.symbols`` uses, and the one every grant file's prose uses — got a
    rule that could NEVER fire, silently.  ``policy/grants/wp-25-apbs.py`` still
    carries the ten-line comment explaining the work-around it had to use.

    Leaf keying is unchanged and still the default, because ``DANGEROUS`` is
    deliberately leaf-keyed: ``cmd.load`` and a panel's ``load`` are one
    capability under two names.  The dotted rule is the narrower one and wins.
    """
    from tenmol_bridge.policy.base import Grant, Policy

    policy = Policy(roots={"cmd", "subproc", "util"})
    policy.add_grant(
        Grant(
            "probe",
            roots={"subproc"},
            dangerous={"subproc.execute": "starts a local program"},
            invalidates={"subproc.execute": ("resync",)},
        )
    )
    decision = policy.check("subproc.execute")
    assert decision.dangerous is True
    assert decision.danger_reason == "starts a local program"
    assert decision.invalidates == ("resync",)
    assert policy.invalidation_for("subproc.execute") == ("resync",)

    # The leaf `execute` on ANOTHER root is untouched: this is a narrower rule,
    # not a wider one. (`cmd.execute` does not exist; the point is the lookup.)
    assert policy.check("cmd.execute").dangerous is False

    # A leaf-keyed rule still applies to every path that ends in it.
    assert policy.check("cmd.load").dangerous is True
    assert policy.check("util.load").dangerous is True


def test_a_work_package_can_now_gate_its_own_symbol() -> None:
    """``Grant.confirm_once`` — the field row 00:467 said did not exist.

    ``CONFIRM_ONCE`` was a module-level frozenset with no grant path into it, so
    "this work package wants its symbol confirmed" was inexpressible and the
    WP-25 grant had to argue about it in prose instead.  The default is
    unchanged: nothing in the tree uses the field today.
    """
    from tenmol_bridge.policy import build_policy
    from tenmol_bridge.policy.base import CONFIRM_ONCE, Grant, Policy

    assert CONFIRM_ONCE == frozenset({"system"})
    assert build_policy().check("subproc.execute").needs_confirmation is False

    policy = Policy(roots={"cmd", "subproc"}).add_grant(
        Grant("probe", roots={"subproc"}, confirm_once={"subproc.execute"})
    )
    assert policy.check("subproc.execute").needs_confirmation is True
    assert policy.check("subproc.which").needs_confirmation is False
    assert policy.check("cmd.system").needs_confirmation is True

    # `Dispatcher.confirm` records the LEAF (`dispatch.py:240`), so that is the
    # spelling a confirmation frame arrives as; the dotted rule must clear.
    policy.confirm("execute")
    assert policy.check("subproc.execute").needs_confirmation is False

    # `require_confirmation=False` (a deployment switch) still bypasses it.
    open_policy = Policy(roots={"subproc"}, require_confirmation=False).add_grant(
        Grant("probe", roots={"subproc"}, confirm_once={"subproc.execute"})
    )
    assert open_policy.check("subproc.execute").needs_confirmation is False


# ==========================================================================
# The drain invariant, as a test rather than only as a lint run
# ==========================================================================


def test_drain_lint_is_clean_with_the_push_in_place() -> None:
    """``tools/parity/drain_lint.py`` — the owner of every destructive drain.

    The settings push is a FAN-OUT of ``updates`` the status thread already
    received.  If it had been written as "call ``get_setting_updates`` in the
    server", this is what would have caught it.
    """
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.path.insert(0, os.path.join(repo, "tools", "parity"))
    import drain_lint  # noqa: WPS433

    violations = drain_lint.check([os.path.join(repo, "bridge", "tenmol_bridge")])
    assert violations == [], [v.format() for v in violations]
    assert drain_lint.EXPECTED_CALL_SITES["get_setting_updates"] == {"pump.py"}
