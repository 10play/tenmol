"""Manifest of symbols that raise ``IncentiveOnlyException`` in this tree (§B7).

Open-source PyMOL ships stubs for a set of Incentive-only features.  They are
real, importable, callable symbols that raise on entry
(``pymol.IncentiveOnlyException``, ``packages/engine/modules/pymol/__init__.py:482``, a subclass
of ``CmdException``).  The UI must **disable or annotate** the affected control
rather than letting the user hit a runtime error, so this manifest is a
first-class product artifact, not a curiosity:

* the bridge answers such calls with ``{kind:'IncentiveOnly'}`` (see
  :mod:`tenmol_bridge.errors`);
* WP-05's codegen emits the annotation onto the generated TS wrapper;
* WP-17 uses it to disable Builder ▸ Clean with a tooltip instead of shipping a
  button that throws.

Every row below was verified against the installed build (paths are relative to
``packages/engine/modules/``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

__all__ = [
    "IncentiveSymbol",
    "MANIFEST",
    "SYMBOLS",
    "is_incentive_only",
    "describe",
    "as_wire",
]


@dataclass(frozen=True)
class IncentiveSymbol:
    """One command that exists only in PyMOL's Incentive build and throws here.

    Records the leaf name the client addresses, the ``raise`` site in this tree,
    where the feature lived in the Qt front-end, and what the client should do
    about it (disable the control, annotate it, or hide the file-format filter).
    """

    #: dotted name as the client addresses it (``cmd.clean`` == ``clean``)
    symbol: str
    #: file:line of the ``raise`` in this tree
    site: str
    #: where the user can reach it in the Qt front-end we are replacing
    ui_reach: str
    #: what the client should do
    ui_action: str = "disable"


MANIFEST: Tuple[IncentiveSymbol, ...] = (
    IncentiveSymbol(
        "clean",
        "pymol/computing.py:29",
        "Builder ▸ Clean",
        "disable",
    ),
    IncentiveSymbol(
        "assign_stereo",
        "pymol/stereochemistry/__init__.py:29",
        'L-menu "stereochemistry" (pymol/menu.py:1536) — silently blank today',
        "disable",
    ),
    IncentiveSymbol(
        "morph",
        "pymol/morphing.py:53",
        "api symbol (movie morphing)",
        "annotate",
    ),
    IncentiveSymbol(
        "focal_blur",
        "pymol/experimenting.py:244",
        "api symbol",
        "annotate",
    ),
    IncentiveSymbol(
        "callout",
        "pymol/experimenting.py:266",
        "api symbol",
        "annotate",
    ),
    IncentiveSymbol(
        "desaturate",
        "pymol/experimenting.py:280",
        "api symbol",
        "annotate",
    ),
    IncentiveSymbol(
        "find_pi_interactions",
        "pymol/querying.py:545",
        "find ▸ pi interactions popup leaf — ALWAYS throws today",
        "disable",
    ),
    IncentiveSymbol(
        "help_setting",
        "pymol/helping.py:99",
        "intended consumer of packages/engine/data/setting_help.csv; v1 reads the CSV directly",
        "annotate",
    ),
    IncentiveSymbol(
        "read_stlstr",
        "pymol/lazyio.py:240",
        "File ▸ Open (import filter)",
        "hide-filter",
    ),
    IncentiveSymbol(
        "get_stlstr",
        "pymol/lazyio.py:230",
        "File ▸ Export (STL)",
        "hide-filter",
    ),
    IncentiveSymbol(
        "read_collada",
        "pymol/lazyio.py:250",
        "File ▸ Open (import filter)",
        "hide-filter",
    ),
    IncentiveSymbol(
        "load_mtz",
        "pymol/importing.py:1511",
        "File ▸ Open (.mtz)",
        "hide-filter",
    ),
    IncentiveSymbol(
        "incentive_format_not_available_func",
        "pymol/importing.py:32",
        "File ▸ Open — .mae and friends route here",
        "hide-filter",
    ),
)

#: Fast lookup by leaf name.
SYMBOLS: Dict[str, IncentiveSymbol] = {item.symbol: item for item in MANIFEST}

#: File-format extensions that fail at runtime in this build even though the
#: loader/exporter appears in the format lists.  Sources: the manifest above
#: plus spike 03 (``save .stl`` -> IncentiveOnlyException, ``save .gltf`` ->
#: ``CmdException: could not find collada2gltf``).
UNAVAILABLE_FORMATS: Dict[str, str] = {
    ".stl": "STL export/import not supported by this PyMOL build",
    ".mae": "'mae' format not supported by this PyMOL build",
    ".mtz": "load_mtz is Incentive-only in this build",
    ".gltf": "needs the external collada2gltf binary, which is not present",
    ".glb": "needs the external collada2gltf binary, which is not present",
}


def is_incentive_only(symbol: str) -> bool:
    """Whether ``symbol`` (dotted or bare) names a known Incentive-only command."""
    return symbol.rsplit(".", 1)[-1] in SYMBOLS


def describe(symbol: str) -> Optional[IncentiveSymbol]:
    """The :class:`IncentiveSymbol` for ``symbol``, or None if it is available here."""
    return SYMBOLS.get(symbol.rsplit(".", 1)[-1])


def as_wire() -> List[Dict[str, str]]:
    """The manifest as plain dicts, for ``hello`` and for WP-05's codegen."""
    return [
        {
            "symbol": item.symbol,
            "site": item.site,
            "uiReach": item.ui_reach,
            "uiAction": item.ui_action,
        }
        for item in MANIFEST
    ]
