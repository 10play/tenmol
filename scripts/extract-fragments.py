#!/usr/bin/env python3
"""Extract the 20 standard amino-acid fragment coordinate sets into JSON.

Upstream PyMOL ships built-in fragments (used by `cmd.fragment(name)`) as
pickled chempy `Indexed`/`Molecule` objects under
`packages/engine/data/chempy/fragments/*.pkl`. Each pickle holds a list of
`Atom` objects (`name`, `symbol`, `coord` = [x, y, z]) and a list of `Bond`
objects (`index` = [i, j], 0-based).

This script unpickles the 20 standard amino-acid fragments and emits a single
committed JSON file the TS engine can import directly:

    packages/engine-ts/src/model/aa-fragments.json

mapping the uppercase 3-letter residue name (e.g. "ALA") to:

    { "atoms": [{ "name", "elem", "x", "y", "z" }, ...],
      "bonds": [[i, j], ...] }

Run from the repo root:

    python3 scripts/extract-fragments.py
    # or, if the pickles need the full numpy/PyMOL stack:
    packages/bridge/.venv/bin/python scripts/extract-fragments.py

The vendored chempy lives under `packages/engine/modules`, which we add to
`sys.path` so the pickles resolve their classes.
"""

from __future__ import annotations

import json
import os
import pickle
import sys

# Repo root = parent of this script's directory.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Make the vendored chempy importable so pickle can resolve chempy.* classes.
sys.path.insert(0, os.path.join(REPO_ROOT, "packages", "engine", "modules"))

FRAGMENTS_DIR = os.path.join(
    REPO_ROOT, "packages", "engine", "data", "chempy", "fragments"
)
OUT_PATH = os.path.join(
    REPO_ROOT, "packages", "engine-ts", "src", "model", "aa-fragments.json"
)

# The 20 standard amino acids (pkl basename -> loaded below).
STANDARD_AA = [
    "ala", "arg", "asn", "asp", "cys",
    "gln", "glu", "gly", "his", "ile",
    "leu", "lys", "met", "phe", "pro",
    "ser", "thr", "trp", "tyr", "val",
]


def _round(v: float) -> float:
    """Drop float32 promotion noise; -0.0 -> 0.0."""
    r = round(float(v), 6)
    return 0.0 if r == 0.0 else r


def extract_one(basename: str) -> tuple[str, dict]:
    path = os.path.join(FRAGMENTS_DIR, basename + ".pkl")
    with open(path, "rb") as fh:
        obj = pickle.load(fh)

    atoms = []
    resn = None
    for a in obj.atom:
        if resn is None and getattr(a, "resn", None):
            resn = a.resn
        x, y, z = a.coord
        atoms.append(
            {
                "name": a.name,
                "elem": a.symbol,
                "x": _round(x),
                "y": _round(y),
                "z": _round(z),
            }
        )

    bonds = [[int(b.index[0]), int(b.index[1])] for b in obj.bond]

    key = (resn or basename).upper()
    return key, {"atoms": atoms, "bonds": bonds}


def main() -> int:
    result: dict[str, dict] = {}
    for basename in STANDARD_AA:
        key, frag = extract_one(basename)
        result[key] = frag

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, sort_keys=True)
        fh.write("\n")

    print(f"Wrote {len(result)} residues to {OUT_PATH}")
    ala = result.get("ALA", {})
    print(
        f"ALA: {len(ala.get('atoms', []))} atoms, "
        f"{len(ala.get('bonds', []))} bonds"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
