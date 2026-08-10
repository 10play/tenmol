"""``python -m tenmol_bridge`` — run the bridge.

Binds ``127.0.0.1`` and refuses anything else unless ``--allow-remote`` is
passed.  WP-28 owns the full ``pymol --web`` entry point and the invocation-flag
mapping table (§C6); this is the developer entry point.
"""

from __future__ import annotations

import argparse
import sys
import threading
from typing import Any, List, Optional

from .config import (
    DEFAULT_HEIGHT,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_WIDTH,
    BridgeConfig,
    coerce_origins,
    log,
    set_log_enabled,
    write_token_file,
)
from . import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m tenmol_bridge",
        description="PyMOL <-> tenmol web client bridge (protocol v1)",
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument(
        "--tick-hz",
        type=float,
        default=60.0,
        help="draw pump rate; must stay well under the 150 ms single-click "
        "floor (packages/engine/layer1/SceneMouse.cpp:1152)",
    )
    parser.add_argument("--status-hz", type=float, default=10.0)
    parser.add_argument(
        "--splash", action="store_true", help="keep PyMOL's splash banner"
    )
    parser.add_argument(
        "--pymol-quiet",
        action="store_true",
        help="invocation.options.quiet=1. NOTE: this is NOT -c; -c/-cq would "
        "set no_gui=1 and kill the feedback queue permanently (spike 02 §2a).",
    )
    parser.add_argument(
        "--quiet", action="store_true", help="silence the bridge's own stderr log"
    )
    parser.add_argument(
        "--origin",
        action="append",
        default=None,
        help="extra allowed Origin (repeatable)",
    )
    parser.add_argument(
        "--token", default=None, help="use this session token instead of minting one"
    )
    parser.add_argument(
        "--token-file", default=None, help="write the token here with mode 0600"
    )
    parser.add_argument(
        "--no-token",
        action="store_true",
        help="disable token checking (loopback only; development)",
    )
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="permit a non-loopback --host (you almost certainly do not want this)",
    )
    parser.add_argument(
        "--no-pymol",
        action="store_true",
        help="run without PyMOL so the front-end is developable",
    )
    parser.add_argument(
        "--no-gl",
        action="store_true",
        help=(
            "start with NO offscreen GL context, as if this box had no "
            "EGL/WGL/CGL at all. Mode P and backend picking are disabled; "
            "cmd.ray, the RPC surface and Mode G geometry extraction are not. "
            "This is the cross-platform thesis, made runnable."
        ),
    )
    parser.add_argument(
        "--idle-shutdown",
        type=float,
        default=None,
        metavar="SECONDS",
        help=(
            "quit SECONDS after the last browser disconnects. 0 means never, "
            "and that is the default ON PURPOSE: `pnpm dev` reloads the page "
            "constantly and the test suite shares one engine across long "
            "client-free stretches, so an armed watchdog would kill both. "
            "Overrides TENMOL_BRIDGE_IDLE_SHUTDOWN. This is `execapp`'s "
            "closeEvent -> cmd.quit() (pymol_qt_gui.py:1193) for a tab that "
            "can never call it."
        ),
    )
    parser.add_argument("--log-level", default="info")
    parser.add_argument(
        "--version", action="version", version="tenmol-bridge " + __version__
    )
    return parser


class ShutdownWatcher:
    """Turn ``BridgeServer.shutdown_requested`` into uvicorn's ``should_exit``.

    THE MISSING WIRE.  ``cmd.quit`` is routed to
    :meth:`BridgeServer.request_shutdown` (``policy/base.py:166`` — never the C
    ``exit()``), and the idle watchdog on the 10 Hz status thread calls the same
    method when the browser has been gone for
    ``idle_shutdown_seconds``.  Both of them set one boolean, and until this
    class existed NOTHING READ IT: ``uvicorn.run()`` blocked forever, so File ▸
    Quit and a closed tab were equally decorative.

    A thread rather than an asyncio task because the flag is set from three
    different threads (the socket thread through the dispatcher, the status
    thread, and any plugin) and none of them holds the event loop.  uvicorn's
    own ``Server.main_loop`` re-reads ``should_exit`` every 0.1 s and then runs
    the ordinary graceful shutdown — lifespan shutdown, ``server.stop()``, pump
    stopped, shims uninstalled — which is exactly what a bare ``os._exit``
    would have skipped.
    """

    def __init__(
        self,
        bridge: Any,
        uvicorn_server: Any,
        interval: float = 0.1,
    ) -> None:
        self.bridge = bridge
        self.uvicorn_server = uvicorn_server
        self.interval = max(0.01, float(interval))
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run, name="tenmol-shutdown", daemon=True
        )
        #: Set once the flag was seen, so a caller can tell "uvicorn stopped
        #: because we asked" from "uvicorn stopped for its own reasons".
        self.fired = False

    def start(self) -> "ShutdownWatcher":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()

    def join(self, timeout: Optional[float] = None) -> None:
        self._thread.join(timeout)

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            if getattr(self.uvicorn_server, "should_exit", False):
                return  # uvicorn is already going down; nothing to ask for
            if not getattr(self.bridge, "shutdown_requested", False):
                continue
            self.fired = True
            reason = getattr(self.bridge, "shutdown_reason", None) or "cmd.quit"
            log("stopping the server: %s" % reason)
            self.uvicorn_server.should_exit = True
            return


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    if not args.allow_remote and args.host not in ("127.0.0.1", "localhost", "::1"):
        sys.stderr.write(
            "refusing to bind %r: this bridge gives the browser full local "
            "filesystem and shell reach through PyMOL, by design. Pass "
            "--allow-remote if you really mean it.\n" % args.host
        )
        return 2

    if args.quiet:
        set_log_enabled(False)

    config = BridgeConfig(
        host=args.host,
        port=args.port,
        width=args.width,
        height=args.height,
        tick_hz=args.tick_hz,
        status_hz=args.status_hz,
        splash=args.splash,
        quiet=args.pymol_quiet,
        origins=coerce_origins(args.origin),
        token=None if args.no_token else (args.token or ""),
        token_path=args.token_file,
        force_no_pymol=args.no_pymol,
        require_gl=not args.no_gl,
        require_loopback_peer=not args.allow_remote,
        log_level=args.log_level,
    )

    if config.token and config.token_path:
        write_token_file(config.token_path, config.token)
        log("token written to %s (mode 0600)" % config.token_path)
    elif config.token:
        log("session token: %s" % config.token)
    else:
        log("TOKEN CHECKING DISABLED (--no-token)")

    import uvicorn

    from .server import create_app

    log(
        "starting on ws://%s:%d/ws (%dx%d, tick %.0f Hz, status %.0f Hz)"
        % (
            config.host,
            config.port,
            config.width,
            config.height,
            config.tick_hz,
            config.status_hz,
        )
    )
    app = create_app(config)
    bridge = getattr(app.state, "server", None)

    # The launcher line row 00:77 was missing. `BridgeServer` reads
    # TENMOL_BRIDGE_IDLE_SHUTDOWN itself and defaults to 0 (off); this makes it
    # settable without an environment variable, and STILL DEFAULTS TO OFF —
    # `pnpm dev` (scripts/dev-bridge.sh) and the e2e harness pass no flag, so
    # neither a page reload nor a client-free test run can trip it.
    if bridge is not None and args.idle_shutdown is not None:
        bridge.idle_shutdown_seconds = max(0.0, float(args.idle_shutdown))
    if bridge is not None:
        seconds = getattr(bridge, "idle_shutdown_seconds", 0.0)
        log(
            "idle shutdown: %s"
            % (
                "%.1fs after the last client disconnects" % seconds
                if seconds > 0
                else "off (the bridge outlives every browser)"
            )
        )

    # `uvicorn.run()` blocks and reads nothing back, which is why `cmd.quit`
    # and the idle watchdog both stopped one step short of stopping the
    # process. Drive the Server object directly so a thread can ask it to exit.
    uvicorn_server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=config.host,
            port=config.port,
            log_level=config.log_level,
            # one process, one engine: never fork, never reload
            workers=1,
            reload=False,
        )
    )
    watcher = ShutdownWatcher(bridge, uvicorn_server).start()
    try:
        uvicorn_server.run()
    finally:
        watcher.stop()
    if bridge is not None and getattr(bridge, "shutdown_requested", False):
        log("stopped (%s)" % (bridge.shutdown_reason or "cmd.quit"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
