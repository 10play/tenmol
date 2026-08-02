"""FROZEN BARREL — the polled state tick.  Written once in wave 0.

Change detection in v1 is **polling**, not C++ change counters (plan §1.5).  A
30 Hz tick (4 Hz when the tab is hidden) snapshots
``names/enabled/groups/view/frame/state/scenes/vis/movie/wizard`` and drains the
global + per-object setting channels.  Measured on a 52,569-atom, 11-object
scene: median **67.7 µs** per tick, p95 97.3 µs, **0.25 % of one core**
including the status thread, and **zero** false positives over 300 idle ticks.

Two rules the snapshot must honour, both from measurements:

* ``cmd.count_atoms()`` is **banned from the hot tick** — 5,902 µs for a
  selection at 500k atoms, 18 % of a 30 Hz budget, and the only call in the set
  that scales with atom count.  Selection counts are a debounced client
  request.
* Polling **cannot** see per-atom state.  ``cmd.get_vis()`` is object-level
  only: ``show spheres, m and name CA`` leaves it byte-identical while 574
  atoms carry the rep.  Per-atom colour is equally invisible.  Those come from
  the command-echo invalidation channel (:mod:`tenmol_bridge.dispatch`), never
  from a poll.

===================  ======  ===============================================
module               owner   contents
===================  ======  ===============================================
``state.snapshot``   WP-03   the measured field set, one cheap read each
``state.diff``       WP-03   snapshot -> changed-key set -> topic payloads
===================  ======  ===============================================
"""

from __future__ import annotations

import importlib
from typing import Any, Dict, List

__all__ = [
    "MODULES",
    "SNAPSHOT_FIELDS",
    "BANNED_FROM_TICK",
    "get_module",
    "available",
    "snapshot",
    "diff",
]

#: module -> owning work package.  Frozen.
MODULES: Dict[str, str] = {
    "snapshot": "WP-03",
    "diff": "WP-03",
}

#: The measured field set (spike 05 §3), with the per-call medians that justify
#: it.  Sum of the whole set = 437 µs against a 33,333 µs budget at 30 Hz.
SNAPSHOT_FIELDS: Dict[str, str] = {
    "names": "cmd.get_names() - 1.3 us",
    "enabled": "cmd.get_names('public_objects', enabled_only=1)",
    "groups": "cmd.get_names('group')",
    "view": "cmd.get_view() - 2.0 us",
    "frame": "cmd.get_frame() - 0.2 us",
    "state": "cmd.get_state()",
    "scenes": "cmd.get_scene_list() - 0.7 us",
    "vis": "cmd.get_vis() - 3.1 us (object-level ONLY)",
    "movie": "cmd.get_movie_length() / movie playing flags",
    "wizard": "cmd.get_wizard() - 0.9 us",
    "settings": "cmd.get_setting_updates() - 1.0 us (status thread owns it)",
}

#: Calls that must never appear in the 30 Hz tick, with why.
BANNED_FROM_TICK: Dict[str, str] = {
    "count_atoms": "5,902 us for a selection at 500k atoms; debounce it client-side",
    "get_model": "materialises every atom",
    "get_coords": "copies the whole coordinate set",
    "ray": "seconds",
}


def get_module(name: str) -> Any:
    if name not in MODULES:
        raise AttributeError(
            "%r is not a state module; the frozen barrel lists %s"
            % (name, ", ".join(sorted(MODULES)))
        )
    try:
        return importlib.import_module("%s.%s" % (__name__, name))
    except ImportError as exc:
        raise AttributeError(
            "state module %r (owner %s) has not landed yet: %s"
            % (name, MODULES[name], exc)
        ) from exc


def available() -> List[str]:
    out: List[str] = []
    for name in sorted(MODULES):
        try:
            get_module(name)
        except AttributeError:
            continue
        out.append(name)
    return out


def __getattr__(name: str) -> Any:  # PEP 562
    return get_module(name)


def __dir__() -> List[str]:
    return sorted(set(__all__) | set(MODULES))
