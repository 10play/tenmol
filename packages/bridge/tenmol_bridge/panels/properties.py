"""What the Properties Inspector cannot read through `get_model`.

`apps/web/src/features/properties/service.ts` builds its atom rows from
`cmd.get_model`, because a chempy `Indexed` is a shape the wire codec already
carries (`codec.ATOM_FIELDS`). That covers thirteen of the nineteen built-in
atom properties the Qt dialog shows (`properties_dialog.py:103-110`).

The other seven are not chempy `Atom` attributes at all:

    reps  label  cartoon  protons  geom  valence  color

`color` is the one worth calling out: the panel MAPPED it (`atom.color`) as
though chempy carried it, so the row rendered from `undefined` rather than
being marked unavailable — a blank cell that looked like a colour of nothing.
Measured, a chempy atom has: alt, b, chain, coord, elec_radius, flags,
formal_charge, hetatm, id, index, name, numeric_type, partial_charge, q, resi,
resi_number, resn, segi, ss, stereo, symbol, text_type. No color.

They exist only inside `cmd.iterate`'s namespace, and `iterate` returns None —
it mutates a `space` dict server-side. Over a socket that is useless: the dict
the client passes is serialised, so the values are written into a copy the
client never sees. The panel rendered those six rows as "unavailable", which
was honest but wrong; this module is the bridge helper the code comment there
anticipated.

The same round trip picks up custom atom PROPERTIES via `p.all`, which returns
the whole per-atom dict in one read. Upstream marks the atom-level Properties
branch "Incentive only" and hides it in open-source builds; measured, `p.all`
works fine here, so the branch is offered rather than greyed out.

WHAT IS STILL NOT AVAILABLE, and why it is not an oversight: atom-level
SETTINGS cannot be enumerated. `s.<name>` inside `iterate` returns the
EFFECTIVE value — it falls back to the object and global levels — so reading
every atom-level setting name would report hundreds of defaults and give no
way to tell which were actually set on the atom. There is no
`get_atom_settings` (measured: the symbol does not exist), and `s.all` raises
`LookupError: unknown setting`. That branch stays marked unavailable with this
reason rather than being filled with a list that would be mostly fiction.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

ATTR = "tenmol_props"

#: The `properties_dialog.py:103-110` built-ins that `get_model` cannot reach.
#: Kept short deliberately: everything chempy already carries is read from the
#: chempy model, in one call, client-side.
ITERATE_ONLY: tuple = (
    "reps", "label", "cartoon", "protons", "geom", "valence", "color",
)


class PropsAPI:
    def __init__(self, cmd: Any) -> None:
        self._cmd = cmd

    def hello(self) -> Dict[str, Any]:
        return {"ok": True, "attr": ATTR, "iterateOnly": list(ITERATE_ONLY)}

    def atom_extras(
        self, model: str = "", index: int = 0, state: int = 1
    ) -> Dict[str, Any]:
        """The iterate-only builtins plus `p.all`, for one atom.

        ``model`` + ``index`` rather than a selection string: that is the
        identity the panel already holds (it tracks `pk1`), and it cannot be
        ambiguous the way a user-typed selection can.
        """
        cmd = self._cmd
        if not model or not int(index):
            return {"ok": False, "found": False, "builtins": {}, "properties": {}}

        # The backtick form is PyMOL's own index addressing: `model`index`.
        sel = "%s`%d" % (model, int(index))
        out: Dict[str, Any] = {}
        expr = "; ".join("out[%r] = %s" % (key, key) for key in ITERATE_ONLY)
        expr += "; out['__p'] = dict(p.all)"
        cmd.iterate(sel, expr, space={"out": out})

        if not out:
            return {"ok": True, "found": False, "builtins": {}, "properties": {}}

        properties = out.pop("__p", {}) or {}
        return {
            "ok": True,
            "found": True,
            "model": model,
            "index": int(index),
            "state": int(state),
            "builtins": {k: _wire(v) for k, v in out.items()},
            # Custom properties: upstream hides this branch outside Incentive
            # builds; `p.all` works here, so it is offered.
            "properties": {str(k): _wire(v) for k, v in properties.items()},
        }

    def atom_setting_support(self) -> Dict[str, Any]:
        """Why the atom-settings branch shows no rows.

        A UI that says "unavailable" without saying why is indistinguishable
        from one that is broken, so the reason is data, not a hard-coded
        string in the panel.
        """
        return {
            "available": False,
            "reason": (
                "atom-level settings cannot be enumerated: `s.<name>` in "
                "iterate returns the EFFECTIVE value (falling back to object "
                "and global), there is no get_atom_settings, and `s.all` "
                "raises LookupError. Set one with alter `s.<name> = ...`; "
                "reading back which are set is not exposed by PyMOL."
            ),
        }


def _wire(value: Any) -> Any:
    """Anything `iterate` can yield, as something JSON can carry."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_wire(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _wire(v) for k, v in value.items()}
    return str(value)


def install(cmd: Optional[Any] = None) -> Dict[str, Any]:
    """Attach to ``pymol.cmd``; idempotent, so reconnects are free."""
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    existing = getattr(cmd, ATTR, None)
    if isinstance(existing, PropsAPI):
        return existing.hello()
    api = PropsAPI(cmd)
    setattr(cmd, ATTR, api)
    return api.hello()


def uninstall(cmd: Optional[Any] = None) -> bool:
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    if getattr(cmd, ATTR, None) is None:
        return False
    delattr(cmd, ATTR)
    return True


def installed(cmd: Optional[Any] = None) -> bool:
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    return isinstance(getattr(cmd, ATTR, None), PropsAPI)
