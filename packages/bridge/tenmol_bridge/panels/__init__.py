"""FROZEN BARREL — the internal-GUI data feeds.  Written once in wave 0.

Rule 2 of the anti-collision mechanism (plan §5.1): a barrel is written once,
complete, and then never edited.  If a work package needs an entry that is not
here, that is a plan change and it goes through the plan owner — it is not an
edit another agent makes.

Why these modules have to exist at all: the object panel, wizard panel, scene
bin and internal command line have **no Python data feed today**.  They are C++
``Block::draw`` surfaces (``struct CExecutive : public Block``,
``packages/engine/layer3/ExecutiveDef.h:54,99``) redrawn from the live ``Spec`` list at up to
50 Hz.  In the web client each becomes a real endpoint built from
``get_names`` / ``get_type`` / ``get_vis`` / group queries.

======================  ======  ==================================================
module                  owner   surface
======================  ======  ==================================================
``panels.objects``      WP-12   object tree: A/S/H/L/C/M, groups, enable, reorder
``panels.movie``        WP-20   movie panel + frame/scene bin
``panels.seqview``      WP-21   sequence viewer (v1 hit-testing overlay on Mode P)
``panels.menus``        WP-13   ``pymol.menu.*`` popup resolution
======================  ======  ==================================================

Access is lazy (PEP 562) so this barrel imports on a tree where the feature
modules have not landed yet, and an un-landed module produces a clear error
rather than an ``ImportError`` from six frames away.
"""

from __future__ import annotations

import importlib
from typing import Any, Dict, List

__all__ = ["PANELS", "available", "get_panel", "objects", "movie", "seqview", "menus"]

#: name -> owning work package.  The complete, frozen list.
PANELS: Dict[str, str] = {
    "objects": "WP-12",
    "movie": "WP-20",
    "seqview": "WP-21",
    "menus": "WP-13",
}


def get_panel(name: str) -> Any:
    """Import a panel module, or explain precisely why it is not there yet."""
    if name not in PANELS:
        raise AttributeError(
            "%r is not a panel; the frozen barrel lists %s"
            % (name, ", ".join(sorted(PANELS)))
        )
    try:
        return importlib.import_module("%s.%s" % (__name__, name))
    except ImportError as exc:
        raise AttributeError(
            "panel %r (owner %s) has not landed yet: %s" % (name, PANELS[name], exc)
        ) from exc


def available() -> List[str]:
    """Panels whose module actually exists right now."""
    out: List[str] = []
    for name in sorted(PANELS):
        try:
            get_panel(name)
        except AttributeError:
            continue
        out.append(name)
    return out


def __getattr__(name: str) -> Any:  # PEP 562
    return get_panel(name)


def __dir__() -> List[str]:
    return sorted(set(__all__) | set(PANELS))
