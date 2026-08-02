"""tenmol-bridge — the PyMOL side of the tenmol web client.

One process.  One PyMOL engine.  One thread that owns a real offscreen OpenGL
context, the engine, every ``cmd`` call **and** a ``draw()``-driven pump.  One
local browser over one WebSocket.

::

    browser ──ws://127.0.0.1:8765/ws──▶ uvicorn / asyncio thread
                                            │ FIFO + futures
                                            ▼
                                    ENGINE THREAD  (60 Hz)
                                    CGL context + FBO
                                    pymol2.SingletonPyMOL
                                    p.idle(); p.draw()   ◀── mandatory
                                            ▲
                                    STATUS THREAD (10 Hz)
                                    get_progress / _get_feedback /
                                    get_setting_updates   (lock-ATTEMPTING only)

Module map
----------
``config``          :class:`BridgeConfig`, the token, and :func:`log` (stderr only)
``errors``          the wire error kinds
``glcontext``       offscreen GL, platform-dispatched (``cgl`` today)
``engine``          the §1.1 boot sequence and the per-tick draw
``pump``            the engine thread, the FIFO, the 10 Hz status thread
``codec``           the typed return table + copy-before-unlock
``policy``          capability grants (NOT a deny-list)
``incentive_only``  the ``IncentiveOnlyException`` manifest
``shims``           the five GUI seams PyMOL leaves for a front-end
``blobs``           out-of-band payloads behind ``GET /blob/{id}``
``session``         protocol v1 vocabulary + one connected client
``dispatch``        ``fn`` -> callable, policy, invalidation echo
``server``          FastAPI app: ``/healthz``, ``/ws``, ``/blob/{id}``
``panels``          FROZEN barrel: internal-GUI data feeds (WP-12/13/20/21)
``state``           FROZEN barrel: the polled state tick (WP-03)

The one rule everything else follows: **the bridge logs to stderr only.**  After
``pcatch._install()`` a ``print()`` in this process lands in the user's PyMOL
console (plan §1.1).  Use :func:`tenmol_bridge.config.log`.
"""

from __future__ import annotations

from .config import (
    DEFAULT_HEIGHT,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_WIDTH,
    BridgeConfig,
    log,
)
from .errors import (
    BridgeError,
    IncentiveOnly,
    NoOffscreenGL,
    NotAllowed,
    NotSerializable,
    PyMOLUnavailable,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "BridgeConfig",
    "DEFAULT_HOST",
    "DEFAULT_PORT",
    "DEFAULT_WIDTH",
    "DEFAULT_HEIGHT",
    "log",
    "BridgeError",
    "NotAllowed",
    "NotSerializable",
    "IncentiveOnly",
    "NoOffscreenGL",
    "PyMOLUnavailable",
]
