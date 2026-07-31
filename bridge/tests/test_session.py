"""WP-02 — session identity, per-session addressing (D4) and tab completion (D5).

Run with the venv that has the PyMOL built from this tree::

    cd bridge && python -m pytest tests/test_session.py -q

Part 1 is pure: no PyMOL, no GL, no socket.  Parts 2 and 3 use the one real
bridge from ``conftest.py`` (real uvicorn, real WebSocket, real engine) because
both defects are only visible end to end:

D4  a Mode-G geometry pull was BROADCAST to every ``geometry`` subscriber.
    ``RenderService._geometry_call`` fans out to ``_geometry_sinks()``, and the
    dispatcher never told it who asked, so it could not do anything else.  With
    N clients attached, one client's pull cost all N the payload.  The proof
    below is two real sockets: A pulls, and B — subscribed to the same topic,
    on the same process — must receive nothing.

D5  Tab completion was dead: the console printed "the bridge policy refuses
    'cmd._parser.complete'".  ``_parser`` is a private INTERIOR segment and the
    policy now refuses those by default; the capability is opened by name in
    ``policy/grants/wp-11-console.py``, which is the grant model working as
    designed rather than a hole punched in the check.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge import errors  # noqa: E402
from tenmol_bridge.dispatch import Dispatcher, _accepts_session  # noqa: E402
from tenmol_bridge.policy import build_policy  # noqa: E402
from tenmol_bridge.session import ClientSession, decode_binary_frame  # noqa: E402

from conftest import WSClient  # noqa: E402


# =========================================================================== #
# Part 1 — pure: identity, counters, and the session argument itself
# =========================================================================== #


class FakeWS:
    """Just enough WebSocket for :class:`ClientSession`."""

    def __init__(self) -> None:
        self.json: List[Any] = []
        self.binary: List[bytes] = []

    async def send_json(self, frame: Any) -> None:
        self.json.append(frame)

    async def send_bytes(self, payload: bytes) -> None:
        self.binary.append(payload)


def test_sessions_have_distinct_stable_ids() -> None:
    """``id(session)`` is not an identity: CPython reuses addresses."""

    async def main() -> List[int]:
        ids = []
        for _ in range(3):
            ids.append(ClientSession(FakeWS()).id)
        return ids

    ids = asyncio.run(main())
    assert len(set(ids)) == 3, ids
    assert ids == sorted(ids), "session ids must be monotonic"


def test_binary_counters_separate_bulk_from_control() -> None:
    """The D4 evidence has to be countable on the SERVER side."""

    async def main() -> Dict[str, Any]:
        ws = FakeWS()
        session = ClientSession(ws)
        writer = asyncio.get_running_loop().create_task(session.writer())
        await session.send({"t": "ok", "id": 1, "result": None})
        await session.send(b"\x00" * 128)
        await session.send(b"\x00" * 32)
        await session.close()
        await asyncio.wait_for(writer, timeout=5)
        return session.stats()

    stats = asyncio.run(main())
    assert stats["sent"] == 3
    assert stats["binarySent"] == 2
    assert stats["binaryBytes"] == 160
    assert stats["id"] >= 1


@pytest.mark.parametrize(
    "route,expected",
    [
        (None, False),
        (lambda symbol, args, kwargs: None, False),
        (lambda symbol, args, kwargs, session: None, True),
        (lambda symbol, args=None, kwargs=None, session=None: None, True),
        (lambda *argv: None, True),
        (lambda symbol, args, kwargs, **kw: None, False),
    ],
)
def test_route_session_arity_is_introspected_not_guessed(route, expected) -> None:
    """A ``TypeError`` probe would swallow a real ``TypeError`` from a route."""
    assert _accepts_session(route) is expected


def test_dispatcher_threads_the_session_into_bridge_routes() -> None:
    seen: List[Any] = []
    dispatcher = Dispatcher(
        pump=None,  # type: ignore[arg-type] - never reached for a _bridge call
        bridge_routes=lambda symbol, args, kwargs, session: seen.append(
            (symbol, args, kwargs, session)
        )
        or {"ok": True},
    )
    sentinel = object()
    future = dispatcher.call("_bridge.render_stats", [], {}, session=sentinel)
    assert future.result(timeout=1)["result"] == {"ok": True}
    assert seen == [("_bridge.render_stats", [], {}, sentinel)]


def test_a_three_argument_route_table_still_works() -> None:
    """Back-compat: the render service's own ``route()`` takes three."""
    seen: List[Any] = []
    dispatcher = Dispatcher(
        pump=None,  # type: ignore[arg-type]
        bridge_routes=lambda symbol, args, kwargs: seen.append(symbol) or 7,
    )
    future = dispatcher.call("_bridge.render_stats", [], {}, session=object())
    assert future.result(timeout=1)["result"] == 7
    assert seen == ["_bridge.render_stats"]


def test_a_client_cannot_name_another_clients_session() -> None:
    """``session`` is the connection, never a field of the client's kwargs."""
    seen: List[Any] = []
    dispatcher = Dispatcher(
        pump=None,  # type: ignore[arg-type]
        bridge_routes=lambda symbol, args, kwargs, session: seen.append(
            (kwargs, session)
        ),
    )
    mine = object()
    dispatcher.call(
        "_bridge.pull_geometry", [], {"session": "victim"}, session=mine
    ).result(timeout=1)
    kwargs, session = seen[0]
    assert session is mine
    # The forged key is still in kwargs (the dispatcher does not rewrite client
    # data) but the ROUTE reads the separate argument, and `server.py`'s
    # `_geometry_route` addresses `session`, not `kwargs['session']`.
    assert kwargs == {"session": "victim"}


# =========================================================================== #
# Part 2 — D5: tab completion, end to end over the real socket
# =========================================================================== #


def test_the_policy_grants_the_completion_path_and_nothing_wider() -> None:
    policy = build_policy()
    assert policy.check("cmd._parser.complete").allowed, (
        "policy/grants/wp-11-console.py did not load"
    )
    for refused in ("cmd._parser.parse", "cmd._parser.nest", "cmd._foo.bar"):
        decision = policy.check(refused)
        assert not decision.allowed, refused
        assert "interior segment" in decision.reason, decision.reason
    # And the old spelling the console used stays refused: `_parser` is not a
    # namespace, it is an attribute of `cmd`.
    assert not policy.check("_parser.complete").allowed


COMPLETE_FN = "cmd._parser.complete"


@pytest.mark.engine
def test_tab_completion_completes_command_names(ws: WSClient) -> None:
    """``modules/pymol/parser.py:531`` — the no-space branch, ``cmd.kwhash``."""
    assert ws.call(COMPLETE_FN, "frag") == "fragment "
    assert ws.call(COMPLETE_FN, "orie") == "orient "
    # Ambiguous: PyMOL completes to the common prefix and PRINTS the candidates.
    assert ws.call(COMPLETE_FN, "colo") == "color"
    # No match at all: None, plus a printed complaint.
    assert ws.call(COMPLETE_FN, "colour") is None


@pytest.mark.engine
def test_tab_completion_reaches_names_settings_and_the_filesystem(
    ws: WSClient,
) -> None:
    """The four things that make completion impossible in the browser."""
    ws.call("delete", "tsobj")
    ws.call("fragment", "ala", object="tsobj")
    ws.call("select", "tssele", "tsobj and name CA")

    # object names / selection names (completing.py: aa_obj_*, aa_sel_*)
    assert ws.call(COMPLETE_FN, "delete tsob") == "delete tsobj "
    assert ws.call(COMPLETE_FN, "zoom tsse") == "zoom tssele"
    # colour names, i.e. an auto_arg table that is not a name list
    assert ws.call(COMPLETE_FN, "color ye") == "color yellow"
    # setting names (cmd.setting.setting_sc)
    assert ws.call(COMPLETE_FN, "set cartoon_transp") == "set cartoon_transparency, "
    # SERVER file paths — glob.glob(exp_path(...)), parser.py:566
    assert ws.call(COMPLETE_FN, "load /etc/host") == "load /etc/hosts"

    ws.call("delete", "tsobj")
    ws.call("delete", "tssele")


@pytest.mark.engine
def test_the_candidate_list_arrives_on_the_feedback_topic(
    bridge, ws: WSClient
) -> None:
    """Parity: PyMOL PRINTS the candidates; the completed line is the return.

    ``complete_sc`` (``parser.py:63-67``) uses ``colorprinting.suggest``, which
    is ``print``, which ``pcatch`` puts in PyMOL's own line buffer.  So the web
    console shows the same list the Qt console shows, for free.
    """
    ws.subscribe("feedback")
    assert ws.call(COMPLETE_FN, "colo") == "color"
    lines = bridge.wait_for_feedback("parser: matching commands", timeout=10.0)
    matching = [line for line in lines if "parser: matching commands" in line]
    assert matching, "candidate list never reached the feedback drain: %r" % (
        lines[-10:],
    )
    print("candidate list on the wire:", matching[-1])


@pytest.mark.engine
def test_completion_is_read_only_and_unmarked(ws: WSClient) -> None:
    reply = ws.call_reply(COMPLETE_FN, "frag")
    assert reply["t"] == "ok"
    assert not reply.get("dangerous")
    assert not reply.get("invalidates")


@pytest.mark.engine
def test_the_rest_of_the_parser_is_still_refused(ws: WSClient) -> None:
    reply = ws.call_reply("cmd._parser.parse", "fragment ala")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == errors.KIND_NOT_ALLOWED, reply["error"]


# =========================================================================== #
# Part 3 — D4: a geometry pull goes to the client that asked, and to no other
# =========================================================================== #


class BinaryWSClient(WSClient):
    """:class:`conftest.WSClient` that KEEPS the binary frames.

    The base client turns a binary frame into ``{'t':'binary','size':N}`` and
    ``wait_reply`` then drops it on the floor while it hunts for its ``id`` —
    and the geometry frame is queued BEFORE the ``ok`` frame (the engine thread
    sends it from inside the pump body; the ``ok`` is sent by ``_reply`` after
    the future resolves).  A test that used the base client would therefore
    "prove" that nobody got the payload, including the requester.
    """

    def __init__(self, url: str) -> None:
        self.binaries: List[bytes] = []
        super().__init__(url)

    def _recv(self, timeout: float) -> Optional[Dict[str, Any]]:
        try:
            raw = self._conn.recv(timeout=timeout)
        except TimeoutError:
            return None
        if isinstance(raw, (bytes, bytearray)):
            self.binaries.append(bytes(raw))
            return {"t": "binary", "size": len(raw)}
        frame = json.loads(raw)
        if frame.get("t") == "feedback":
            self.feedback.extend(frame.get("lines", []))
        elif frame.get("t") == "event":
            self.events.append(frame)
        return frame


def drain(client: BinaryWSClient, seconds: float) -> List[bytes]:
    """Read for ``seconds``; return every binary frame seen so far."""
    client.pump_frames(seconds)
    return client.binaries


def session_stats(bridge, session_id: int) -> Optional[Dict[str, Any]]:
    for entry in bridge.healthz().get("sessions", []):
        if entry.get("id") == session_id:
            return entry
    return None


def pull(client: WSClient, obj: str, rep: str, state: int = -1) -> Dict[str, Any]:
    reply = client.request(
        t="call", fn="_bridge.pull_geometry", args=[obj, rep, state], kwargs={}
    )
    assert reply["t"] == "ok", reply
    return reply["result"]


@pytest.mark.gl
@pytest.mark.engine
def test_a_geometry_pull_is_addressed_to_the_client_that_asked(gl_bridge) -> None:
    """D4, the whole point: N clients must not pay for one client's 360 KB."""
    render = gl_bridge.server.render
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")

    asker = BinaryWSClient(gl_bridge.ws_url)
    other = BinaryWSClient(gl_bridge.ws_url)
    try:
        asker.subscribe("geometry")
        other.subscribe("geometry")

        asker.call("delete", "d4obj")
        asker.call("fragment", "trp", object="d4obj")
        asker.call("show", "sticks", "d4obj")

        # Both sockets are quiet before the pull.
        assert drain(asker, 0.5) == []
        assert drain(other, 0.5) == []

        result = pull(asker, "d4obj", "sticks")
        print(
            "pull result:", {k: result[k] for k in ("status", "bytes", "hash")}
        )
        if result["status"] != "ok":
            pytest.skip("sticks did not produce geometry: %r" % (result,))

        mine = drain(asker, 2.0)
        theirs = drain(other, 2.0)
        print(
            "frames: requester=%d (%d bytes)  bystander=%d"
            % (len(mine), sum(len(f) for f in mine), len(theirs))
        )

        assert len(mine) == 1, "the requesting client got %d frames" % len(mine)
        header, payload = decode_binary_frame(mine[0])
        assert header["object"] == "d4obj"
        assert header["payloadBytes"] == len(payload)
        # `bytes` in the ok frame is the WHOLE frame (header + payload).
        assert len(mine[0]) == result["bytes"]
        assert theirs == [], (
            "D4: a client that did not ask received %d geometry frames "
            "(%d bytes)" % (len(theirs), sum(len(f) for f in theirs))
        )
    finally:
        asker.close()
        other.close()


@pytest.mark.gl
@pytest.mark.engine
def test_the_server_side_counters_agree_that_only_one_client_paid(
    gl_bridge,
) -> None:
    """The client-side count could be a client bug; ask the server."""
    render = gl_bridge.server.render
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")

    asker = BinaryWSClient(gl_bridge.ws_url)
    other = BinaryWSClient(gl_bridge.ws_url)
    try:
        asker.subscribe("geometry")
        other.subscribe("geometry")
        asker.call("delete", "d4obj2")
        asker.call("fragment", "his", object="d4obj2")
        asker.call("show", "spheres", "d4obj2")

        sessions = gl_bridge.healthz()["sessions"]
        assert len(sessions) >= 2, sessions
        ids = sorted(entry["id"] for entry in sessions)[-2:]
        asker_id, other_id = ids[0], ids[1]
        before = {
            i: session_stats(gl_bridge, i)["binaryBytes"]
            for i in (asker_id, other_id)
        }

        result = pull(asker, "d4obj2", "spheres")
        if result["status"] != "ok":
            pytest.skip("no geometry: %r" % (result,))
        drain(asker, 1.5)
        drain(other, 1.5)

        after = {
            i: session_stats(gl_bridge, i)["binaryBytes"]
            for i in (asker_id, other_id)
        }
        delta = {i: after[i] - before[i] for i in after}
        print("binaryBytes delta per session:", delta)
        assert delta[asker_id] > 0, "the requester was sent nothing"
        assert delta[other_id] == 0, (
            "D4: session %d was charged %d bytes it never asked for"
            % (other_id, delta[other_id])
        )
    finally:
        asker.close()
        other.close()


@pytest.mark.gl
@pytest.mark.engine
def test_two_clients_pulling_get_one_frame_each(gl_bridge) -> None:
    """Addressing must not have turned a fan-out into a drop."""
    render = gl_bridge.server.render
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("this PyMOL build has no _cmd.web_get_rep_geometry")

    a = BinaryWSClient(gl_bridge.ws_url)
    b = BinaryWSClient(gl_bridge.ws_url)
    try:
        a.subscribe("geometry")
        b.subscribe("geometry")
        a.call("delete", "d4obj3")
        a.call("fragment", "ala", object="d4obj3")
        a.call("show", "sticks", "d4obj3")

        if pull(a, "d4obj3", "sticks")["status"] != "ok":
            pytest.skip("no geometry")
        # `have=None`, so B gets its own copy rather than `unchanged`.
        if pull(b, "d4obj3", "sticks")["status"] != "ok":
            pytest.skip("no geometry")
        drain(a, 2.0)
        drain(b, 2.0)
        print("A frames=%d  B frames=%d" % (len(a.binaries), len(b.binaries)))
        assert len(a.binaries) == 1
        assert len(b.binaries) == 1
    finally:
        a.close()
        b.close()


@pytest.mark.engine
def test_broadcast_topics_are_still_broadcast(bridge) -> None:
    """D4 must not have turned shared state into a private channel."""
    a = BinaryWSClient(bridge.ws_url)
    b = BinaryWSClient(bridge.ws_url)
    try:
        a.subscribe("feedback")
        b.subscribe("feedback")
        a.do("print('tenmol-d4-broadcast-probe')")
        for name, client in (("asker", a), ("bystander", b)):
            deadline = time.monotonic() + 10.0
            while time.monotonic() < deadline:
                client.pump_frames(0.2)
                if any("tenmol-d4-broadcast-probe" in line for line in client.feedback):
                    break
            assert any(
                "tenmol-d4-broadcast-probe" in line for line in client.feedback
            ), "feedback stopped being a broadcast for the %s" % name
        print("both clients saw the broadcast line")
    finally:
        a.close()
        b.close()
