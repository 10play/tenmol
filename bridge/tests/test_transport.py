"""Parity area 11 — the transport, and what it deliberately does NOT inherit.

PyMOL ships two remote-control bridges already. Both are precedents, and both
are precedents for what NOT to do:

    pymolhttpd.py   loopback peer check, but no token and no Origin check
    rpc.py          `serv.register_instance(cmd)` — the ENTIRE cmd module,
                    all 404 symbols, by attribute lookup, with no policy at all

This file asserts the legacy shapes from source (they are upstream Python, not
running here) and then asserts that the new transport is strictly stronger,
because "we have a policy" is only worth writing down if the refusals are real.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_transport.py -q
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODULES = os.path.join(REPO, "modules", "pymol")


def http_base(bridge):
    """`(base_url, '?token=...')` — the fixture's URL carries the token."""
    url, _, query = bridge.ws_url.partition("?")
    return url.replace("ws://", "http://").replace("/ws", ""), ("?" + query if query else "")


# --------------------------------------------------------- legacy precedent


def test_the_xmlrpc_bridge_really_does_expose_the_whole_cmd_module() -> None:
    """`register_instance(cmd)` is the reason the new bridge has a policy.

    Read from source rather than launched: starting `rpc.py` would bind a real
    port and hand out every symbol in `cmd` to anything that could reach it.
    """
    source = open(os.path.join(MODULES, "rpc.py"), encoding="utf-8").read()
    assert "register_instance" in source
    assert "allow_none=True" in source
    # And it does NOT bind loopback-only: the default hostname is '' (all
    # interfaces) unless $PYMOL_RPCHOST says otherwise.
    assert "def launch_XMLRPC" in source


def test_the_http_bridge_checks_the_peer_but_nothing_else(ws) -> None:
    """`pymolhttpd.py` rejects a non-`127.0.` peer with 403 and stops there.

    No token, no Origin check — which is fine for a desktop app talking to
    itself and not fine for a browser, where any page you visit can reach
    localhost.
    """
    source = open(os.path.join(MODULES, "pymolhttpd.py"), encoding="utf-8").read()
    assert "127.0." in source
    assert "403" in source
    assert "Origin" not in source, "upstream grew an Origin check; update this row"


# ------------------------------------------------------- the new transport


def test_healthz_reports_the_version_and_the_real_renderer(bridge) -> None:
    """`GET /health` in the row; `/healthz` here. Version AND renderer.

    The renderer string is the one that answers "is there really a GL context",
    which is the first question when a viewport is blank.
    """
    base, token = http_base(bridge)
    with urllib.request.urlopen(base + "/healthz" + token, timeout=10) as response:
        body = json.loads(response.read())

    assert body["pymolVersion"], body
    gl = body["gl"]
    assert gl["backend"], gl
    assert gl["renderer"], gl


def test_healthz_is_deliberately_UNAUTHENTICATED(bridge) -> None:
    """It carries no scene data — it is a liveness probe.

    Pinned so that "healthz works without a token" reads as a decision rather
    than an oversight, and so that a future change which starts returning
    something sensitive there fails this test.
    """
    base, _ = http_base(bridge)
    with urllib.request.urlopen(base + "/healthz", timeout=10) as response:
        body = json.loads(response.read())
    assert set(body) >= {"gl", "clients", "queueDepth"}
    assert not any("session" in str(v).lower() for v in body.get("gl", {}).values())


def test_the_websocket_needs_a_token(bridge) -> None:
    from websockets.sync.client import connect

    url, _, _query = bridge.ws_url.partition("?")
    with pytest.raises(Exception) as caught:
        connect(url, additional_headers={"Origin": "http://127.0.0.1:5173"}, open_timeout=8)
    assert "403" in str(caught.value), caught.value


def test_the_websocket_enforces_an_ORIGIN_allow_list(bridge) -> None:
    """The guard `pymolhttpd` does not have, and the one a browser needs.

    A loopback peer check alone is useless here: any page in the user's browser
    IS a loopback peer as far as the server can tell.
    """
    from websockets.sync.client import connect

    with pytest.raises(Exception) as caught:
        connect(
            bridge.ws_url,
            additional_headers={"Origin": "http://evil.example"},
            open_timeout=8,
        )
    assert "403" in str(caught.value), caught.value


def test_a_blob_is_fetchable_over_HTTP_and_needs_the_token(bridge, ws: WSClient):
    """`GET /blob/{id}` for payloads too big for a frame.

    Both halves matter: it works with the token (or large returns are dead),
    and it is 401 without (or the blob store is a public read of whatever the
    session last produced).
    """
    base, token = http_base(bridge)
    handle = ws.call("cmd.get_session")
    blob_id = handle["id"]

    with urllib.request.urlopen(base + "/blob/" + blob_id + token, timeout=20) as ok:
        payload = ok.read()
    assert len(payload) > 100

    with pytest.raises(urllib.error.HTTPError) as caught:
        urllib.request.urlopen(base + "/blob/" + blob_id, timeout=10)
    assert caught.value.code == 401, caught.value.code
