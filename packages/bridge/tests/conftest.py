"""Fixtures for the bridge tests.

ONE PyMOL PER PROCESS.  ``pymol2.SingletonPyMOL.start()`` raises
``RuntimeError: can only start SingletonPyMOL once`` (``packages/engine/modules/pymol2/__init__.py``),
so every engine-bound test in a pytest run shares a single session-scoped
server, started exactly the way the product starts it: a real uvicorn server on
a real loopback port, with the real WebSocket endpoint.

The GL-dependent tests are marked ``gl`` and skipped when no offscreen context
can be created — on macOS that means a session with no WindowServer
(a ``launchd`` daemon, ``ssh`` with no console), which is exactly how the ray
image-diff tests are gated (spike 04 §8 item 8).
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import urllib.request
from typing import Any, Dict, List, Optional

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.config import BridgeConfig  # noqa: E402
from tenmol_bridge.engine import EngineState  # noqa: E402

# IMPORT ORDER HAZARD, measured: ``import pymol`` is what sets PYMOL_PATH and
# PYMOL_DATA in os.environ (``packages/engine/modules/pymol/__init__.py:202-210``), and
# ``chempy`` reads them **at import time** to build its data path
# (``packages/engine/modules/chempy/__init__.py:267-274``).  If anything imports chempy first,
# ``chempy.path`` is '' for the life of the process and ``cmd.fragment('ala')``
# fails with ``FileNotFoundError: 'fragments/ala.pkl'`` -- observed exactly
# that while writing test_dispatch.py.  Importing pymol here, at conftest
# import time, pins the order for the whole session.
try:  # pragma: no cover - the degraded path has no pymol at all
    import pymol  # noqa: E402,F401
except ImportError:  # pragma: no cover
    pymol = None  # type: ignore[assignment]

TOKEN = "test-token-" + "0" * 40


def pytest_configure(config: Any) -> None:
    """Refuse to run with pytest's output capture on.

    ``pcatch._install()`` makes the ``pcatch`` module BE ``sys.stdout`` and
    ``sys.stderr``; pytest's global capture re-assigns ``sys.stdout`` around
    every test phase and silently un-installs it, at which point every
    Python-origin console line (``print``, tracebacks, ``count_atoms: N atoms``)
    disappears from ``cmd._get_feedback()`` and the acceptance test fails for a
    reason that has nothing to do with the bridge.  ``pyproject.toml`` puts
    ``-s`` in ``addopts``; this catches an override.
    """
    if config.getoption("capture") != "no":
        raise pytest.UsageError(
            "the bridge test suite must run with -s (capture=no): pytest's "
            "capture un-installs pcatch and the PyMOL console goes half-dark"
        )


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class RunningBridge:
    """A live bridge process-in-a-process: uvicorn + pump + engine."""

    def __init__(self, app: Any, host: str, port: int, token: str) -> None:
        self.app = app
        self.host = host
        self.port = port
        self.token = token
        self.server = app.state.server
        self.pump = app.state.pump

    @property
    def base_url(self) -> str:
        return "http://%s:%d" % (self.host, self.port)

    @property
    def ws_url(self) -> str:
        return "ws://%s:%d/ws?token=%s" % (self.host, self.port, self.token)

    def healthz(self) -> Dict[str, Any]:
        with urllib.request.urlopen(self.base_url + "/healthz", timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # -- the exclusive feedback drain (plan §1.2) --------------------------
    #
    # cmd._get_feedback() is destructive and the status thread owns it; a test
    # that called it directly would steal lines from the product code path.
    # This is that drain's output.
    def feedback_lines(self) -> List[str]:
        return self.pump.status_poller.lines()

    def wait_for_feedback(self, needle: str, timeout: float = 5.0) -> List[str]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            lines = self.feedback_lines()
            if any(needle in line for line in lines):
                return lines
            time.sleep(0.05)
        return self.feedback_lines()


@pytest.fixture(scope="session")
def bridge() -> RunningBridge:
    import uvicorn

    from tenmol_bridge.server import create_app

    port = _free_port()
    config = BridgeConfig(
        host="127.0.0.1",
        port=port,
        width=800,
        height=600,
        token=TOKEN,
        splash=False,
    )
    app = create_app(config)

    uvi_config = uvicorn.Config(
        app, host=config.host, port=port, log_level="warning", lifespan="on"
    )
    server = uvicorn.Server(uvi_config)
    thread = threading.Thread(target=server.run, name="uvicorn-test", daemon=True)
    thread.start()

    deadline = time.monotonic() + 120.0
    while time.monotonic() < deadline and not getattr(server, "started", False):
        time.sleep(0.05)
    assert getattr(server, "started", False), "uvicorn did not start"

    running = RunningBridge(app, config.host, port, TOKEN)
    yield running

    server.should_exit = True
    thread.join(timeout=30)


@pytest.fixture(scope="session")
def gl_bridge(bridge: RunningBridge) -> RunningBridge:
    """``bridge``, skipped unless the engine really has a GL context."""
    state = bridge.pump.state
    if state != EngineState.RUNNING:
        pytest.skip(
            "no offscreen GL context in this session (engine state=%s, gl=%r)"
            % (state, bridge.pump.engine.gl_info)
        )
    return bridge


# -- a tiny synchronous WebSocket client -----------------------------------


class WSClient:
    """Sync WebSocket helper: send an id'd frame, wait for its reply.

    Out-of-band frames (``feedback``, ``event``, ``hello``) are collected as
    they arrive so a test can assert on them afterwards.
    """

    def __init__(self, url: str) -> None:
        from websockets.sync.client import connect

        self._conn = connect(url, open_timeout=20)
        self._next_id = 1
        self.events: List[Dict[str, Any]] = []
        self.feedback: List[str] = []
        #: Replies seen but not yet asked for, keyed by frame id. See `_recv`.
        self._replies: Dict[int, Dict[str, Any]] = {}
        self.hello: Optional[Dict[str, Any]] = None
        self.hello = self._await_hello()

    # -- plumbing ----------------------------------------------------------

    def _recv(self, timeout: float) -> Optional[Dict[str, Any]]:
        try:
            raw = self._conn.recv(timeout=timeout)
        except TimeoutError:
            return None
        if isinstance(raw, bytes):
            return {"t": "binary", "size": len(raw)}
        frame = json.loads(raw)
        if frame.get("t") == "feedback":
            self.feedback.extend(frame.get("lines", []))
        elif frame.get("t") == "event":
            self.events.append(frame)
        elif frame.get("t") in ("ok", "err") and frame.get("id") is not None:
            # BUFFER IT. `wait_reply` used to drop any reply whose id it was not
            # currently waiting for, which is only safe if replies come back in
            # send order — and they do not have to: `server.py` answers each
            # call in its own asyncio task (`session.spawn(_reply(...))`), so
            # completion order is scheduling-dependent. Under load on a CI
            # runner a pipelined test lost a reply and then timed out on it
            # ("no reply to frame 5" from the 256-call palette test) while the
            # bridge had answered every one.
            self._replies[frame["id"]] = frame
        return frame

    def _await_hello(self, timeout: float = 20.0) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            frame = self._recv(1.0)
            if frame and frame.get("t") == "hello":
                return frame
        raise AssertionError("no hello frame")

    # -- api ---------------------------------------------------------------

    def send(self, **frame: Any) -> int:
        msg_id = self._next_id
        self._next_id += 1
        frame["id"] = msg_id
        self._conn.send(json.dumps(frame))
        return msg_id

    def wait_reply(self, msg_id: int, timeout: float = 60.0) -> Dict[str, Any]:
        # Scaled by TENMOL_TEST_SLOW: this is a ceiling on how long a HANG takes
        # to report, so stretching it costs nothing but patience.
        buffered = self._replies.pop(msg_id, None)
        if buffered is not None:
            return buffered
        deadline = time.monotonic() + timeout * slow_factor()
        while time.monotonic() < deadline:
            frame = self._recv(min(1.0, max(0.05, deadline - time.monotonic())))
            # Check the frame we were just handed as well as the buffer. A
            # SUBCLASS may override `_recv` without knowing about `_replies`
            # (`test_session.BinaryWSClient` does, to keep binary frames), and
            # reading only the buffer starved it. Buffering stays a pure
            # optimisation for out-of-order replies rather than the only path.
            if (
                frame is not None
                and frame.get("id") == msg_id
                and frame.get("t") in ("ok", "err")
            ):
                self._replies.pop(msg_id, None)
                return frame
            buffered = self._replies.pop(msg_id, None)
            if buffered is not None:
                return buffered
        raise AssertionError("no reply to frame %d" % msg_id)

    def request(self, timeout: float = 60.0, **frame: Any) -> Dict[str, Any]:
        return self.wait_reply(self.send(**frame), timeout=timeout)

    def call(self, fn: str, *args: Any, timeout: float = 60.0, **kwargs: Any) -> Any:
        reply = self.request(t="call", fn=fn, args=list(args), kwargs=kwargs,
                             timeout=timeout)
        if reply["t"] == "err":
            raise AssertionError("call %s failed: %r" % (fn, reply["error"]))
        return reply["result"]

    def call_reply(self, fn: str, *args: Any, **kwargs: Any) -> Dict[str, Any]:
        return self.request(t="call", fn=fn, args=list(args), kwargs=kwargs)

    def do(self, cmdline: str) -> Dict[str, Any]:
        return self.request(t="do", cmd=cmdline)

    def input(self, kind: str, **fields: Any) -> Dict[str, Any]:
        return self.request(t="input", kind=kind, **fields)

    def subscribe(self, topic: str) -> Dict[str, Any]:
        return self.request(t="sub", topic=topic)

    def pump_frames(self, seconds: float) -> None:
        """Read whatever arrives for ``seconds`` (feedback/events accumulate)."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self._recv(min(0.2, max(0.01, deadline - time.monotonic())))

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:  # noqa: BLE001
            pass


@pytest.fixture
def ws(bridge: RunningBridge):
    client = WSClient(bridge.ws_url)
    yield client
    client.close()


# ---------------------------------------------------------------------------
# Wall-clock tolerance
# ---------------------------------------------------------------------------

#: Multiplier for every deadline, rate and budget asserted in this suite.
#:
#: The numbers throughout these tests were measured on an M4 Max with a
#: hardware GL context and an otherwise idle machine. A GitHub macOS runner is
#: neither: the same suite takes 21m43s there against ~9m here, its GL is a
#: software rasteriser, and its CPU is shared. Eleven tests failed on the first
#: full run and every one of them was a clock, not a defect:
#:
#:   status thread: 8 polls, expected >= 13
#:   a wedged child killed at 22.0s, asserted < 10.0
#:   pipeline stage 267.67 ms, asserted <= 6.0
#:   animated camera sampled mid-flight; "no reply to frame 8"
#:
#: An absolute bound measures the hardware. Scaling it keeps the assertion
#: meaningful — a REGRESSION still blows past 3x — while letting a slow box
#: pass. CI sets TENMOL_TEST_SLOW; local runs are unaffected.
def slow_factor() -> float:
    """Read TENMOL_TEST_SLOW, defaulting to 1.0."""
    import os

    try:
        return max(1.0, float(os.environ.get("TENMOL_TEST_SLOW", "1")))
    except ValueError:
        return 1.0


def slow(seconds: float) -> float:
    """A deadline in seconds, scaled for the host."""
    return seconds * slow_factor()


def slow_rate(count: float) -> float:
    """A minimum event/poll COUNT, scaled DOWN for a slower host."""
    return count / slow_factor()
