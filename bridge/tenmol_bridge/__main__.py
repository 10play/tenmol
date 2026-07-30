"""``python -m tenmol_bridge`` - run the bridge.

Binds 127.0.0.1 by default and refuses anything else unless
``--allow-remote`` is passed, matching PyMOL's own HTTP bridge, which hard-
rejects non-loopback peers (``modules/pymol/pymolhttpd.py:61-68``).
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from . import DEFAULT_HOST, DEFAULT_PORT, BridgeConfig, __version__


def build_parser() -> argparse.ArgumentParser:
    from .pump import TICK_STRATEGIES

    p = argparse.ArgumentParser(
        prog="python -m tenmol_bridge",
        description="PyMOL <-> web client bridge (protocol v1)",
    )
    p.add_argument("--host", default=DEFAULT_HOST)
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--tick-hz", type=float, default=60.0)
    p.add_argument(
        "--tick",
        default="idle",
        choices=sorted(TICK_STRATEGIES),
        help="per-tick draw/refresh strategy; see the TODO(spike-01) banner in "
        "pump.py. 'idle' is safe but leaves viewport input queued.",
    )
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--quiet", action="store_true")
    p.add_argument(
        "--no-pmgui",
        action="store_true",
        help="start PyMOL with no_gui=1. Makes p.draw() safe and viewport "
        "input work (--tick draw), but silences console feedback "
        "(layer1/Ortho.cpp:493). See the banner in pump.py.",
    )
    p.add_argument(
        "--no-dangerous",
        action="store_true",
        help="refuse run/system/cd/quit/alter/... instead of marking them "
        "(breaks File>Run Script and most menu leaves - see README Security)",
    )
    p.add_argument(
        "--allow-remote",
        action="store_true",
        help="permit a non-loopback --host (you almost certainly do not want this)",
    )
    p.add_argument("--log-level", default="info")
    p.add_argument("--version", action="version", version="tenmol-bridge " + __version__)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    if not args.allow_remote and args.host not in ("127.0.0.1", "localhost", "::1"):
        sys.stderr.write(
            "refusing to bind %r: this bridge gives the browser full local "
            "filesystem and shell reach through PyMOL. Pass --allow-remote if "
            "you really mean it.\n" % args.host
        )
        return 2

    config = BridgeConfig(
        host=args.host,
        port=args.port,
        tick_hz=args.tick_hz,
        tick_strategy=args.tick,
        width=args.width,
        height=args.height,
        quiet=args.quiet,
        pmgui=not args.no_pmgui,
        allow_dangerous=not args.no_dangerous,
        log_level=args.log_level,
    )

    import uvicorn

    from .server import create_app, log

    log(
        "starting on ws://%s:%d/ws (tick=%s @%.0fHz, pmgui=%d, dangerous=%s)"
        % (config.host, config.port, config.tick_strategy, config.tick_hz,
           1 if config.pmgui else 0,
           "allowed" if config.allow_dangerous else "refused")
    )
    try:
        app = create_app(config)
    except ValueError as exc:
        sys.stderr.write("%s\n" % exc)
        return 2
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
