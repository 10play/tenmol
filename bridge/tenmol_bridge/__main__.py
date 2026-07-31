"""``python -m tenmol_bridge`` — run the bridge.

Binds ``127.0.0.1`` and refuses anything else unless ``--allow-remote`` is
passed.  WP-28 owns the full ``pymol --web`` entry point and the invocation-flag
mapping table (§C6); this is the developer entry point.
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

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
        "floor (layer1/SceneMouse.cpp:1152)",
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
    parser.add_argument("--log-level", default="info")
    parser.add_argument(
        "--version", action="version", version="tenmol-bridge " + __version__
    )
    return parser


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
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        log_level=config.log_level,
        # one process, one engine: never fork, never reload
        workers=1,
        reload=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
