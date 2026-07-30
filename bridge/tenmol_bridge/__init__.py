"""tenmol-bridge - the PyMOL side of the tenmol web client.

A single process that owns one PyMOL engine on one dedicated thread and exposes
it to exactly one local browser over a WebSocket (protocol v1, see
:mod:`tenmol_bridge.topics`).

Module map
----------
``topics``    protocol constants, frame builders, binary framing, subscriptions
``pump``      the PyMOL thread, the task queue, THE per-tick draw/refresh call
``feedback``  the single consume-once feedback drain and its fan-out
``dispatch``  ``fn`` -> callable resolution, allow-list policy, JSON coercion
``server``    FastAPI app + ``/ws`` endpoint
``__main__``  ``python -m tenmol_bridge``

Import order matters: ``server`` imports ``BridgeConfig`` from here, so this
module must not import ``server``.
"""

from __future__ import annotations

from dataclasses import dataclass

__version__ = "0.1.0"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


@dataclass
class BridgeConfig:
    """Everything the bridge can be told at startup."""

    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    #: pump tick rate; the engine's idle work and feedback drain run this often
    tick_hz: float = 60.0
    #: name from ``pump.TICK_STRATEGIES`` - see the TODO(spike-01) banner there
    tick_strategy: str = "idle"
    width: int = 640
    height: int = 480
    quiet: bool = False
    #: pmgui=1 (no_gui=0): console feedback works, viewport input does not.
    #: pmgui=0 (no_gui=1): viewport input works (with tick_strategy="draw"),
    #: console feedback is silent.  See the banner in pump.py - spike 01/02.
    pmgui: bool = True
    #: local desktop app: dangerous-by-nature commands (run/system/cd/quit/...)
    #: are permitted by default and marked.  See dispatch.py and README.md.
    allow_dangerous: bool = True
    log_level: str = "info"


__all__ = [
    "BridgeConfig",
    "DEFAULT_HOST",
    "DEFAULT_PORT",
    "__version__",
]
