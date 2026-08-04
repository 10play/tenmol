"""Capability policy package: :mod:`base` plus the grant-file loader.

The anti-collision mechanism (plan §5.2): there is no shared allow-list file.
WP-02 owns ``base.py`` and this loader; every other work package that needs a
capability drops **its own** file at::

    packages/bridge/tenmol_bridge/policy/grants/wp-NN.py

exporting either ``GRANT`` (a :class:`~tenmol_bridge.policy.base.Grant`) or
``GRANTS`` (an iterable of them), or a callable ``grants()`` returning either.
The loader merges every file it finds, in sorted filename order, so the result
is deterministic.

Grant filenames contain a hyphen (``wp-13.py``) and are therefore not importable
as module names; they are loaded by path with ``importlib.util``.
"""

from __future__ import annotations

import importlib.util
import os
from typing import Iterable, List, Optional

from ..config import log
from .base import (
    CONFIRM_ONCE,
    DANGEROUS,
    DEFAULT_PRIVATE,
    DEFAULT_ROOTS,
    EXCLUSIVE_TO_BRIDGE,
    INVALIDATES,
    ROUTED,
    Decision,
    Grant,
    Policy,
)

__all__ = [
    "Decision",
    "Grant",
    "Policy",
    "DEFAULT_ROOTS",
    "DEFAULT_PRIVATE",
    "DANGEROUS",
    "CONFIRM_ONCE",
    "ROUTED",
    "INVALIDATES",
    "EXCLUSIVE_TO_BRIDGE",
    "grants_dir",
    "load_grants",
    "build_policy",
]


def grants_dir() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "grants")


def _load_grant_file(path: str) -> List[Grant]:
    name = "tenmol_bridge.policy._grant_" + os.path.basename(path).replace(
        "-", "_"
    ).replace(".py", "")
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        return []
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    found: List[Grant] = []
    candidate = getattr(module, "GRANT", None)
    if isinstance(candidate, Grant):
        found.append(candidate)
    for item in getattr(module, "GRANTS", ()) or ():
        if isinstance(item, Grant):
            found.append(item)
    factory = getattr(module, "grants", None)
    if callable(factory):
        produced = factory()
        if isinstance(produced, Grant):
            found.append(produced)
        else:
            found.extend(item for item in produced if isinstance(item, Grant))
    return found


def load_grants(directory: Optional[str] = None) -> List[Grant]:
    """Every grant on disk, deterministic order.  Missing dir = no grants."""
    directory = directory or grants_dir()
    if not os.path.isdir(directory):
        return []
    out: List[Grant] = []
    for filename in sorted(os.listdir(directory)):
        if not filename.endswith(".py") or filename.startswith("__"):
            continue
        path = os.path.join(directory, filename)
        try:
            out.extend(_load_grant_file(path))
        except Exception as exc:  # noqa: BLE001 - a bad grant must not kill boot
            log("policy grant %s failed to load: %r" % (filename, exc))
    return out


def build_policy(
    allow_dangerous: bool = True,
    require_confirmation: bool = True,
    extra_grants: Optional[Iterable[Grant]] = None,
    directory: Optional[str] = None,
) -> Policy:
    policy = Policy(
        allow_dangerous=allow_dangerous,
        require_confirmation=require_confirmation,
    )
    for grant in load_grants(directory):
        policy.add_grant(grant)
    for grant in extra_grants or ():
        policy.add_grant(grant)
    return policy
