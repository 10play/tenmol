"""The colour service — the whole 5388-slot table in one engine-thread pass.

OWNER: WP-22.  Consumed by ``apps/web/src/features/colors``.

WHY THIS MODULE EXISTS
----------------------
There is no bulk colour accessor anywhere in PyMOL.  ``CmdGetColor``
(``packages/engine/layer4/Cmd.cpp:1321-1391``) has four modes and the only one that returns RGB
returns it for **one** colour::

    mode 0  name/index -> (r,g,b)                 one colour
    mode 1  -> [(name,index), ...]                the 178 digit-free names
    mode 2  -> [(name,index), ...]                all 5388 slots, NO rgb
    mode 3  name -> index
    mode 4  name/index -> (r,g,b) with a NEGATIVE r for the specials

So "the palette" is 1 call for the names plus 5388 calls for the values.  On
the engine thread that whole loop is **3.1 ms** (measured on this tree,
``SingletonPyMOL``, no GL work); the point of doing it here rather than in the
browser is not that it is impossible over the wire — 5388 pipelined WebSocket
calls measured 184 ms against the real bridge — but that it is one round trip
instead of 5388, and that ``cmd.space()`` invalidates the entire cache, so the
refetch happens more than once per session.

REACHABILITY (read this before assuming a client can call it)
-------------------------------------------------------------
``Dispatcher.resolve`` maps a wire ``fn`` root to ``pymol.<root>``
(``packages/bridge/tenmol_bridge/dispatch.py:_ROOT_MODULES``) and ``policy/base.py``
gates the root against ``DEFAULT_ROOTS``.  Neither knows about
``tenmol_bridge.panels``, and ``panels/__init__.py`` is a **frozen barrel**
whose ``PANELS`` table lists only ``objects/movie/seqview/menus``.  Wiring this
module up therefore needs two edits in files WP-22 does not own — a
``_bridge.colors.*`` branch in ``BridgeServer.bridge_route``
(``server.py:169-190``) or a ``PANELS`` entry plus a grant.  Until then the web
client fetches the table with the plain ``cmd.*`` calls this module wraps, and
every function here is exercised against a live PyMOL by
``packages/bridge/tests/test_colors.py``.

Everything in this module must run ON THE ENGINE THREAD (it calls ``cmd``), and
nothing in it draws.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

__all__ = [
    "COLOR_TABLE_SIZE",
    "NAMED_COLOR_COUNT",
    "SPECIAL_KEYWORDS",
    "COLOR_LANDMARKS",
    "palette",
    "named_colors",
    "tuples",
    "specials",
    "ramps",
    "volume_ramp_names",
    "define",
    "spectrum",
    "spectrum_any",
    "space",
    "menu_tree",
    "snapshot",
]

#: ``ColorReset`` registers 188 explicit + 5200 generated slots
#: (``packages/engine/layer1/Color.cpp:825-1322``).  Asserted, not trusted.
COLOR_TABLE_SIZE = 5388

#: ``ColorGetStatus`` == 1 only for names with no digits
#: (``packages/engine/layer1/Color.cpp:784-807``); that is what mode 1 returns.
NAMED_COLOR_COUNT = 178

#: The seven words ``ColorGetIndex`` matches exactly (``Color.cpp:715-729``).
SPECIAL_KEYWORDS: Tuple[str, ...] = (
    "default",
    "auto",
    "current",
    "atomic",
    "object",
    "front",
    "back",
)

#: Indices the Qt menus hardcode (``_gui.py:456-461,632``; ``Color.cpp:35-75``).
#: A shifted table would silently mis-colour everything, so we check.
COLOR_LANDMARKS: Dict[str, int] = {
    "white": 0,
    "black": 1,
    "grey50": 104,
    "grey80": 134,
    "lightmagenta": 154,
    "gray80": 4236,
    "deepteal": 5262,
    "darksalmon": 5280,
}


# --------------------------------------------------------------------------- #
# the table
# --------------------------------------------------------------------------- #


def named_colors(cmd: Any) -> List[Tuple[str, int]]:
    """``cmd.get_color_indices()`` — the 178 digit-free names."""
    return [(str(n), int(i)) for (n, i) in cmd.get_color_indices()]


def palette(cmd: Any, all: bool = True) -> List[Dict[str, Any]]:
    """``[{index, name, rgb}]`` for every registered slot.

    ``all=False`` restricts to the 178 digit-free names, which is what the Qt
    colour editor's ``list_colors`` shows (``pymol_qt_gui.py:547-611``).

    The RGB comes from ``get_color_tuple`` and NOT from any client-side
    reconstruction of the generated bands, because ``cmd.space()`` rewrites
    ``ColorRec::LutColor`` (``packages/engine/layer1/Color.cpp:1680``) and ``get_color_tuple``
    returns the LUT-mapped value.  A formula would be right until the first
    ``space cmyk`` and then silently wrong.
    """
    pairs = cmd.get_color_indices(all=1) if all else cmd.get_color_indices()
    out: List[Dict[str, Any]] = []
    for name, index in pairs:
        rgb = cmd.get_color_tuple(int(index))
        out.append(
            {
                "index": int(index),
                "name": str(name),
                "rgb": [float(rgb[0]), float(rgb[1]), float(rgb[2])] if rgb else None,
            }
        )
    return out


def tuples(cmd: Any, indices: Iterable[Any], mode: int = 0) -> List[Optional[List[float]]]:
    """``get_color_tuple`` for many names/indices in one round trip.

    ``mode=4`` is ``ColorGetSpecial`` (``Color.cpp:1789``), which flags a
    special colour with a NEGATIVE red component instead of failing.
    """
    out: List[Optional[List[float]]] = []
    for item in indices:
        rgb = cmd.get_color_tuple(item, mode)
        out.append([float(rgb[0]), float(rgb[1]), float(rgb[2])] if rgb else None)
    return out


def specials(cmd: Any) -> List[Dict[str, Any]]:
    """The seven keywords, resolved live.

    ``auto`` and ``current`` are NOT constants: ``ColorGetIndex`` runs
    ``ColorGetNext``/``ColorGetCurrent`` (``Color.cpp:140,156``) and hands back
    a real table index that moves as objects are created.  Callers that assume
    -2/-3 are wrong; this is why the resolution happens per request.
    """
    out: List[Dict[str, Any]] = []
    for word in SPECIAL_KEYWORDS:
        index = int(cmd.get_color_index(word))
        rgb = cmd.get_color_tuple(index, 4)
        out.append(
            {
                "keyword": word,
                "index": index,
                "rgb": [float(rgb[0]), float(rgb[1]), float(rgb[2])] if rgb else None,
            }
        )
    return out


# --------------------------------------------------------------------------- #
# ramps
# --------------------------------------------------------------------------- #


def ramps(cmd: Any) -> List[Dict[str, Any]]:
    """Live ``object:ramp`` objects and their negative colour index.

    Same query ``pymol.menu``'s ``menucontext`` uses (``menu.py:33-36``): there
    is no ``cmd.get_ramps()``.  ``index`` is the ``-10 - ext_slot`` colour a
    ramp can be used AS (``packages/engine/layer1/Color.h:46``).
    """
    out: List[Dict[str, Any]] = []
    for name in cmd.get_names("objects"):
        if cmd.get_type(name) != "object:ramp":
            continue
        try:
            index = int(cmd.get_color_index(name))
        except Exception:  # noqa: BLE001 - a ramp with no ext slot is still a ramp
            index = 0
        out.append({"name": str(name), "object": str(name), "index": index})
    return out


def volume_ramp_names() -> List[str]:
    """``pymol.colorramping.namedramps`` — the volume presets (``colorramping.py:17-54``)."""
    from pymol.colorramping import namedramps

    return sorted(namedramps)


# --------------------------------------------------------------------------- #
# writes
# --------------------------------------------------------------------------- #


def define(
    cmd: Any,
    name: str,
    rgb: Sequence[float],
    recolor: bool = True,
) -> Dict[str, Any]:
    """``set_color`` + ``recolor``, always in 0..1 floats.

    ``cmd.set_color`` auto-detects the range with ``if any component > 1.0:
    divide by 255`` (``viewing.py:2205-2207``), which means ``[1, 1, 1]`` is
    white and ``[1, 1, 2]`` is nearly black.  Sending floats removes the trap.
    ``recolor`` is required or existing objects keep the old RGB
    (``viewing.py:1868``, and the Qt editor issues it too —
    ``pymol_qt_gui.py:604``).
    """
    values = [float(c) for c in rgb]
    if len(values) != 3:
        raise ValueError("rgb must be 3 floats in 0..1")
    values = [min(1.0, max(0.0, c)) for c in values]
    cmd.set_color(str(name), values)
    if recolor:
        cmd.recolor()
    index = int(cmd.get_color_index(str(name)))
    tup = cmd.get_color_tuple(index)
    return {
        "name": str(name),
        "index": index,
        "rgb": [float(tup[0]), float(tup[1]), float(tup[2])] if tup else values,
    }


def spectrum(
    cmd: Any,
    expression: str = "count",
    palette_name: str = "rainbow",
    selection: str = "(all)",
    minimum: Optional[float] = None,
    maximum: Optional[float] = None,
    byres: int = 0,
    quiet: int = 1,
    interpolation: str = "rgb",
) -> Dict[str, Any]:
    """``cmd.spectrum`` (``viewing.py:2065-2151``); returns ``(min, max)``.

    ``minimum``/``maximum`` are left as ``None`` for auto-ranging — the C call
    signals that with ``minimum=0, maximum=-1`` (``viewing.py:2143-2145``) and
    the Python wrapper does that translation itself.

    NOTE the fallback: a non-alphabetic expression or an unknown palette makes
    ``cmd.spectrum`` delegate to ``spectrumany`` (``viewing.py:2137-2140``), so
    the palette argument is not validated here — PyMOL's own resolution order
    is the contract.
    """
    result = cmd.spectrum(
        expression,
        palette_name,
        selection,
        minimum,
        maximum,
        byres=int(byres),
        quiet=int(quiet),
        interpolation=interpolation,
    )
    return _range_result(result)


def spectrum_any(
    cmd: Any,
    expression: str,
    colors: str,
    selection: str = "(all)",
    minimum: Optional[float] = None,
    maximum: Optional[float] = None,
    quiet: int = 1,
    interpolation: str = "rgb",
) -> Dict[str, Any]:
    """``spectrumany`` (``viewing.py:1978-2063``) — arbitrary colour lists.

    MEASURED CORRECTION to the inventory's "``cmd.spectrumany``": there is no
    such attribute.  ``spectrumany`` is a module-level function in
    ``viewing.py`` that is never bound onto ``cmd`` (grep: it appears at
    ``viewing.py:1978`` and at ``viewing.py:2134`` and nowhere else), so
    ``cmd.spectrumany(...)`` raises ``AttributeError`` — verified against this
    tree.  The ONLY way in is ``cmd.spectrum`` with a palette argument that
    ``palette_sc`` cannot resolve: ``viewing.py:2130-2135`` then delegates the
    whole call.  A space-separated colour list is exactly that.

    ``colors`` is a space-separated list of colour names.  Interpolation is
    ``rgb`` (default), ``hls`` or ``hsv``
    (``_spectrumany_interpolations``, ``viewing.py:1968-1973``).

    Note that ``byres`` is deliberately absent: the fallback at
    ``viewing.py:2134`` does not forward it, so offering it would be a lie.
    """
    result = cmd.spectrum(
        expression,
        colors,
        selection,
        minimum,
        maximum,
        quiet=int(quiet),
        interpolation=interpolation,
    )
    return _range_result(result)


def _range_result(result: Any) -> Dict[str, Any]:
    if isinstance(result, (list, tuple)) and len(result) == 2:
        return {"minimum": float(result[0]), "maximum": float(result[1])}
    return {"minimum": None, "maximum": None}


def space(cmd: Any, space_name: str = "rgb", gamma: float = 1.0) -> Dict[str, Any]:
    """``cmd.space`` (``importing.py:227-288``) + the palette it invalidates.

    ``ColorRec::LutColor`` (``packages/engine/layer1/Color.h:58-59``) means every colour's RGB
    can change, so the answer carries the fresh table rather than leaving the
    client to guess that it must refetch.
    """
    cmd.space(space_name, gamma)
    return {"space": space_name, "gamma": float(gamma), "colors": palette(cmd, all=True)}


# --------------------------------------------------------------------------- #
# the "C" menu
# --------------------------------------------------------------------------- #

#: ``pymol.menu`` providers that produce a colour tree, by the popup name the
#: internal GUI uses (``packages/engine/modules/pymol/menu.py:643-712``).
_MENU_PROVIDERS = (
    "mol_color",
    "measurement_color",
    "general_color",
    "slice_color",
    "vol_color",
)


def menu_tree(cmd: Any, sele: str = "(all)", kind: str = "mol_color") -> List[Any]:
    """PyMOL's OWN colour menu, normalised to JSON.

    ``pymol.menu.mol_color(self_cmd, sele)`` (``menu.py:672-686``) takes the
    cmd instance as its first positional argument, so a client cannot call it
    over the wire — this is the wrapper that supplies it.

    Items are ``[type, label, action]`` with type 1 = item/submenu, 2 = title,
    0 = separator (``packages/engine/layer4/PopUp.cpp``), and ``action`` is either a command
    STRING or a nested list.  Both shapes survive here unchanged; labels keep
    their ``\\RGB`` inline colour escapes.
    """
    if kind not in _MENU_PROVIDERS:
        raise ValueError(
            "unknown colour menu %r; known: %s" % (kind, ", ".join(_MENU_PROVIDERS))
        )
    import pymol.menu as pymol_menu

    provider = getattr(pymol_menu, kind)
    return _normalise(provider(cmd, sele))


def _normalise(items: Any) -> Any:
    """Menu lists are tuples/lists of mixed types; make them JSON-safe."""
    if isinstance(items, (list, tuple)):
        return [_normalise(item) for item in items]
    if isinstance(items, (str, int, float, bool)) or items is None:
        return items
    return str(items)


# --------------------------------------------------------------------------- #
# the topic payload
# --------------------------------------------------------------------------- #


def snapshot(cmd: Any, all: bool = True) -> Dict[str, Any]:
    """A ``ColorsPayload`` (``packages/protocol/src/topics/colors.ts``)."""
    return {
        "colors": palette(cmd, all=all),
        "ramps": [{"name": r["name"], "object": r["object"]} for r in ramps(cmd)],
        "full": bool(all),
    }
