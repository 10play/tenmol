---
name: get_coords
kind: command
category: querying
subcategory: coordinate query
summary: Returns a selection's coordinates as a NumPy array (API-only).
parity: implemented
---

## Purpose
`get_coords` returns the coordinates of a selection as a NumPy array. It is the efficient, vectorized way to pull many atom positions at once. Reach for it in Python scripts doing coordinate math.

## Syntax
`get_coords(selection='all', state=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | Atom selection |
| `state` | int | `1` | State index; `0` = all states |
| `quiet` | 0/1 | `1` | Verbosity |

## Behaviour
API-only. The selection is processed, then `_cmd.get_coords` is called with a zero-based `state-1`, returning an `N×3` NumPy array (or a stacked array across states when `state=0`). Order follows the selection's atom ordering. The underlying C layer supports a zero-copy view precedent (see `CoordSetAsNumPyArray`), though `get_coords` returns a materialized array. Use [get_coordset](../commands/get_coordset.md) to fetch a whole object's coordinate set by name.

## Examples
```python
xyz = cmd.get_coords("polymer and name CA")
allstates = cmd.get_coords("ligand", state=0)
```

## Related
- [get_coordset](../commands/get_coordset.md)
- [get_atom_coords](../commands/get_atom_coords.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:904`. Parity: implemented — registered as `ctx.command('get_coords')` in `packages/engine-ts/src/cmd/measurement.ts:205`.
