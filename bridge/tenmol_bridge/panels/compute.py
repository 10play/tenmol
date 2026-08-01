"""The one `pymol.util` helper the wire codec cannot carry.

`util.get_sasa_relative` (`modules/pymol/util.py:1064`) returns a
`collections.defaultdict` keyed by a **4-tuple** `(model, segi, chain, resi)`
(built at `util.py:1143` by ``resarea[model,segi,chain,resi] += b``).  JSON has
no tuple keys, and the bridge codec refuses rather than inventing a spelling:

    NotSerializable: dict key of type tuple

That refusal is correct — a codec that silently stringified tuple keys would
pick a spelling nobody agreed on.  So the re-keying happens HERE, once, in
Python, next to the code that knows what the four parts mean, and it picks the
spelling PyMOL itself uses: ``/model/segi/chain/`resi`` is a real selection
expression (`util.py:1147` builds exactly that to make its tripeptide), so the
`sele` field of every record can be fed straight back to `cmd.select`,
`cmd.zoom` or `cmd.iterate` by the React panel.

TWO UPSTREAM BEHAVIOURS THE PANEL HAS TO KNOW ABOUT, both preserved rather than
"fixed" here, because this is a parity clone:

1.  **Values are not always in 0..1.**  The docstring promises "between 0.0
    (fully buried) and 1.0 (fully exposed)", but the normalisation loop does
    ``if resarea_exposed[0] == 0.0: continue`` (`util.py:1155-1156`), which
    leaves that residue's ABSOLUTE area in the dict, undivided — typically a
    number in the tens or hundreds.  Such records are flagged `normalised:
    False` here so the panel can show them differently instead of drawing a
    2700 % bar.

    The flag is a RANGE TEST (`0 <= value <= 1`), not a replay of the skip
    condition, which would mean rebuilding every tripeptide a second time.  It
    is therefore one-sided: an undivided value above 1 is always caught, but an
    undivided value that happens to be 0.0 is reported as normalised, and 0.0
    reads as "fully buried", which is the right thing to show anyway.

    HONESTY ABOUT THIS ONE: the branch is read from the source, not observed.
    It did not fire on any structure tried here — `il2.pdb` polymer (126
    residues), `il2.pdb` with `subsele=sidechain`, or `1tii.pdb` (927 residues,
    8 chains) — all reported `unnormalised: 0`.  The flag is carried because
    the `continue` is unambiguously there in `util.py`, not because a panel bug
    was traced to it.

2.  **It writes to the structure.**  `var` (default `b`) is `alter`ed onto every
    atom in the selection (`util.py:1163`), and with `vis` on it also labels and
    spectrums.  `vis` defaults to `not quiet` upstream; this shim defaults it
    OFF and takes it as an explicit argument, because a metrics readout that
    silently recolours the scene is a surprise.

`resn` is NOT in the key, but a residue readout without it is hard to read, so
it is collected in a second pass over guide atoms — the same atoms upstream's
own printout iterates (`util.py:1175`).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

#: Attribute this service attaches to `pymol.cmd` as.  Not underscored: the
#: policy refuses a private interior segment, so `cmd._tenmol_compute.x` would
#: be unreachable from the browser (`policy/base.py`, and the same reasoning as
#: `panels/files.py`'s `tenmol_files`).
ATTR = "tenmol_compute"


def _resi_sort_key(resi: str) -> tuple:
    """`resi` is a STRING and may carry an insertion code ("52A")."""
    digits = ""
    for ch in resi:
        if ch.isdigit() or (ch == "-" and not digits):
            digits += ch
        else:
            break
    try:
        return (0, int(digits), resi)
    except ValueError:
        return (1, 0, resi)


class ComputeAPI:
    def __init__(self, cmd: Any) -> None:
        self._cmd = cmd

    # ------------------------------------------------------------------ #

    def hello(self) -> Dict[str, Any]:
        return {"ok": True, "attr": ATTR, "methods": ["sasa_relative"]}

    def sasa_relative(
        self,
        selection: str = "all",
        state: int = 1,
        var: str = "b",
        subsele: str = "all",
        vis: int = 0,
    ) -> Dict[str, Any]:
        """`util.get_sasa_relative`, re-keyed for the wire.

        Returns ``{"ok", "records": [...], "var", "unnormalised"}`` where each
        record is ``{sele, model, segi, chain, resi, resn, value, normalised}``.
        """
        cmd = self._cmd
        from pymol import util

        raw = util.get_sasa_relative(
            selection,
            state=int(state),
            vis=int(vis),
            var=var,
            quiet=1,
            subsele=subsele,
            _self=cmd,
        )

        # `resn` per residue key, from the guide atom — one iterate for the
        # whole selection rather than one per residue.
        names: Dict[tuple, str] = {}
        cmd.iterate(
            "(%s) & guide" % selection,
            "names[(model, segi, chain, resi)] = resn",
            space={"names": names},
        )

        records: List[Dict[str, Any]] = []
        for key, value in raw.items():
            model, segi, chain, resi = key
            value = float(value)
            records.append(
                {
                    # PyMOL's own spelling — a usable selection expression.
                    "sele": "/%s/%s/%s/`%s" % (model, segi, chain, resi),
                    "model": model,
                    "segi": segi,
                    "chain": chain,
                    "resi": resi,
                    "resn": names.get(key, ""),
                    "value": value,
                    # See behaviour (1) in the module docstring.
                    "normalised": 0.0 <= value <= 1.0,
                }
            )

        records.sort(
            key=lambda r: (r["model"], r["chain"], _resi_sort_key(r["resi"]))
        )
        return {
            "ok": True,
            "var": var,
            "records": records,
            "unnormalised": sum(0 if r["normalised"] else 1 for r in records),
        }


# ---------------------------------------------------------------------- #
# install / uninstall — the `panels/files.py` bootstrap pattern, so nothing
# in the frozen barrel or in `server.py` has to change to reach this.
# ---------------------------------------------------------------------- #


def install(cmd: Optional[Any] = None) -> Dict[str, Any]:
    """Attach to ``pymol.cmd``; idempotent, so reconnects are free."""
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    existing = getattr(cmd, ATTR, None)
    if isinstance(existing, ComputeAPI):
        return existing.hello()
    api = ComputeAPI(cmd)
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
    return isinstance(getattr(cmd, ATTR, None), ComputeAPI)
