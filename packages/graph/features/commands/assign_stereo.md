---
name: assign_stereo
kind: command
category: editing-building
subcategory: stereochemistry
summary: Assigns the R/S "stereo" atom property using Schrodinger or RDKit (incentive-only).
parity: planned
---

## Purpose
`assign_stereo` computes and assigns the R/S stereochemistry to the `stereo` atom property for a selection. It relies on an external chemistry toolkit — a Schrodinger Suite installation (via the `SCHRODINGER` environment variable) or RDKit (the `rdkit` Python module).

## Syntax
`assign_stereo(selection='all', state=-1, method='', quiet=1, prop='stereo')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | Atom selection |
| `state` | int | `-1` | Object state (`-1` = current) |
| `method` | str | `''` | `schrodinger` or `rdkit`; empty = try both |
| `quiet` | 0/1 | `1` | Suppress feedback |
| `prop` | str | `'stereo'` | Target atom property to write |

## Behaviour
In this open-source engine the function body raises `pymol.IncentiveOnlyException()` — the actual stereo assignment is part of Incentive PyMOL and/or requires the external toolkits noted above. When available, it writes the computed R/S descriptor into the named property (default `stereo`) for atoms in the selection at the given state.

## Examples
```python
assign_stereo all
assign_stereo ligand, method=rdkit
```

## Related
- [alter](./alter.md)

## Source
`packages/engine/modules/pymol/stereochemistry/__init__.py:7`. Parity: planned/incentive-only — raises `IncentiveOnlyException`; no `assign_stereo` command registered in `packages/engine-ts/src`.
