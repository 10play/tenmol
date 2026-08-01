"""The typed return codec (plan §B8).

Anything a ``cmd.*`` call returns has to become a wire value.  There is an
explicit table; anything not in it is a
:class:`~tenmol_bridge.errors.NotSerializable` error, **never** a silent
``repr()``.

============================================  =================================
return                                        wire form
============================================  =================================
``cmd.get_model()`` -> ``chempy.models.Indexed``  ``{atom:[...], bond:[...]}``,
                                              fields whitelisted
``cmd.get_session()``                         never inline: blob id + path
``cmd.get_coords`` / ``get_coordset`` (numpy) ``{__ndarray__, shape, dtype,
                                              data}`` (msgpack ``bin``)
``cmd.get_volume_field`` (numpy)              blob id + header, never inline
``cmd.get_raw_alignment``                     list of tuples -> array of arrays
everything else                               JSON/msgpack scalars, lists, dicts
============================================  =================================

THE COPY-BEFORE-UNLOCK RULE
---------------------------
``cmd.get_coordset(..., copy=0)`` returns a **live view onto C++ memory**
(``layer2/CoordSet.cpp:326-361``) — measured as a ``(4779,3)`` float32 view.  A
view that outlives the API lock is a use-after-free waiting to happen, and the
lock is released the instant the ``cmd`` call returns.  Therefore:

    :func:`encode` runs on the ENGINE THREAD, synchronously, in the same task
    that made the call (see :mod:`tenmol_bridge.dispatch`), and every array it
    touches is copied — :func:`_encode_ndarray` never hands on a view.

That is also why encoding is not deferred to the asyncio thread, where the
engine could already have mutated or freed the buffer.
"""

from __future__ import annotations

import base64

import math
from typing import Any, Callable, Dict, List, Optional, Tuple

from .errors import NotSerializable

__all__ = [
    "encode",
    "encode_result",
    "ATOM_FIELDS",
    "BOND_FIELDS",
    "BLOB_RETURNS",
    "MAX_INLINE_ELEMENTS",
]

#: chempy ``Atom`` fields we put on the wire (``modules/chempy/__init__.py``).
#: Whitelisted rather than ``__dict__``-dumped so a future chempy field cannot
#: silently start leaking objects the client cannot decode.
ATOM_FIELDS: Tuple[str, ...] = (
    "index",
    "id",
    "rank",
    "name",
    "symbol",
    "elem",
    "resn",
    "resi",
    "resi_number",
    "resv",
    "chain",
    "segi",
    "alt",
    "ss",
    "b",
    "q",
    "vdw",
    "elec_radius",
    "partial_charge",
    "formal_charge",
    "numeric_type",
    "text_type",
    "coord",
    "color",
    "hetatm",
    "flags",
    "visible",
    "stereo",
)

#: chempy ``Bond`` fields.
BOND_FIELDS: Tuple[str, ...] = ("index", "order", "stereo", "id")

#: Symbols whose return value must never be inlined; the dispatcher writes them
#: to a blob and returns a handle instead (plan §B8).
BLOB_RETURNS: frozenset = frozenset(
    {
        "get_session",
        "get_volume_field",
        "get_volume_histogram",
        "get_vrml",
        "get_idtf",
        "get_collada",
        "get_gltf",
    }
)

#: A numpy array bigger than this many elements is a blob, not an inline value.
#: 3 x 10^6 float32 = 12 MB, which is already past what a JSON/msgpack frame
#: should carry; the geometry path (WP-26) has its own binary frames.
MAX_INLINE_ELEMENTS = 3_000_000


def _is_ndarray(value: Any) -> bool:
    return (
        type(value).__module__ == "numpy"
        and type(value).__name__ == "ndarray"
    )


def _encode_ndarray(value: Any) -> Dict[str, Any]:
    """Copy first, always (see the module docstring)."""
    if value.size > MAX_INLINE_ELEMENTS:
        raise NotSerializable(
            "array of %d elements is too large to inline; use a blob"
            % value.size,
            shape=list(value.shape),
            dtype=str(value.dtype),
        )
    contiguous = value
    if not value.flags["C_CONTIGUOUS"]:
        contiguous = value.copy(order="C")
    # tobytes() copies unconditionally, which is exactly the guarantee we need
    # before the API lock goes away.
    #
    # BASE64, NOT RAW BYTES, and this was a real outage rather than a
    # preference. This function was written against msgpack, which has a `bin`
    # type; RPC replies actually go out through `ws.send_json`, which cannot
    # encode `bytes` at all. So `cmd.get_coords` and `cmd.get_coordset` — the
    # zero-copy coordinate path, and the most obvious source of geometry for a
    # GL-free client — failed for EVERY caller since they were written. The
    # unit test above passed throughout, because it asserted the dict and never
    # put it on a wire.
    #
    # `encoding` is explicit so a future binary transport can send `bin` again
    # and the client can tell the two apart instead of guessing from the type.
    return {
        "__ndarray__": True,
        "shape": list(value.shape),
        "dtype": str(value.dtype),
        "encoding": "base64",
        "data": base64.b64encode(contiguous.tobytes()).decode("ascii"),
    }


def _encode_chempy_model(value: Any) -> Dict[str, Any]:
    atoms: List[Dict[str, Any]] = []
    for atom in getattr(value, "atom", ()) or ():
        record: Dict[str, Any] = {}
        for field in ATOM_FIELDS:
            if hasattr(atom, field):
                record[field] = encode(getattr(atom, field))
        atoms.append(record)
    bonds: List[Dict[str, Any]] = []
    for bond in getattr(value, "bond", ()) or ():
        record = {}
        for field in BOND_FIELDS:
            if hasattr(bond, field):
                record[field] = encode(getattr(bond, field))
        bonds.append(record)
    out: Dict[str, Any] = {"__model__": type(value).__name__, "atom": atoms, "bond": bonds}
    molecule = getattr(value, "molecule", None)
    if molecule is not None:
        out["molecule"] = {
            key: encode(getattr(molecule, key))
            for key in ("title", "comments")
            if hasattr(molecule, key)
        }
    return out


def _encode_float(value: float) -> Any:
    # JSON has no NaN/Infinity.  Emit null rather than producing a frame the
    # browser's JSON.parse rejects.
    if math.isnan(value) or math.isinf(value):
        return None
    return float(value)


def encode(value: Any, _depth: int = 0) -> Any:
    """Convert one PyMOL return value into a wire value.

    Raises :class:`NotSerializable` for anything outside the table.
    """
    if _depth > 32:
        raise NotSerializable("value nests deeper than 32 levels")

    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return _encode_float(value)
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)

    if _is_ndarray(value):
        return _encode_ndarray(value)

    # numpy scalars
    if type(value).__module__ == "numpy":
        item = getattr(value, "item", None)
        if callable(item):
            return encode(item(), _depth + 1)

    if isinstance(value, (list, tuple, set, frozenset)):
        return [encode(item, _depth + 1) for item in value]

    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, (str, int, float, bool)) and key is not None:
                raise NotSerializable(
                    "dict key of type %s is not serialisable" % type(key).__name__
                )
            out[str(key)] = encode(item, _depth + 1)
        return out

    module = type(value).__module__ or ""
    name = type(value).__name__
    if module.startswith("chempy") and name in ("Indexed", "Molecule", "Connected"):
        return _encode_chempy_model(value)

    raise NotSerializable(
        "no codec entry for %s.%s; add it to bridge/tenmol_bridge/codec.py "
        "(plan §B8) rather than repr()-ing it" % (module, name),
        type=name,
        module=module,
    )


def encode_result(
    symbol: str,
    value: Any,
    blob_writer: Optional[Callable[[str, Any], Any]] = None,
) -> Any:
    """Encode the result of ``symbol``, routing blob-only returns aside.

    ``blob_writer(symbol, value) -> wire value`` is supplied by
    :mod:`tenmol_bridge.blobs`; if it is absent the call fails loudly rather
    than inlining a 100 MB session.
    """
    leaf = symbol.rsplit(".", 1)[-1]
    if leaf in BLOB_RETURNS:
        if blob_writer is None:
            raise NotSerializable(
                "%s must be delivered as a blob, and no blob store is "
                "configured" % symbol,
                symbol=symbol,
            )
        return blob_writer(symbol, value)
    return encode(value)
