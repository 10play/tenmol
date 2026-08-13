---
name: load_coords
kind: command
category: editing-building
subcategory: coordinate injection
summary: API-only loader that writes an Nx3 coordinate array into a selection's atoms in atom-sorted order.
parity: implemented
---

## Purpose
`load_coords` overwrites the coordinates of the atoms in a selection for a given
state from an in-memory Nx3 float array. Use it when you have computed new
positions (e.g. from an external minimiser or analysis) and want to push them back
into an existing object without reparsing a file.

## Syntax
`load_coords(coords, selection, state=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `coords` | list | — | Nx3 float array, one row per selected atom |
| `selection` | str | — | atom selection to receive the coordinates |
| `state` | int | 1 | 1-based object state to write |
| `quiet` | int | 1 | suppress chatter |

## Behaviour
Coordinates are applied in **atom-sorted order** — the same order used by
`cmd.iterate` — so `coords[i]` goes to the i-th atom of the sorted selection. This
differs from [load_coordset](load_coordset.md), which uses the original
file/atom order. The array length must match the number of selected atoms. As of
PyMOL 1.7.3 this function took over the `load_coords` name; the old order-preserving
behaviour moved to `load_coordset`. API only — there is no command-line form.

## Examples
```python
xyz = cmd.get_coords("polymer", 1)   # Nx3
xyz[:, 2] += 5.0                      # shift along z
cmd.load_coords(xyz.tolist(), "polymer", state=1)
```

## Related
- [load_coordset](load_coordset.md) — same idea in original (unsorted) atom order
- [load_traj](load_traj.md) — append many coordinate frames as states

## Source
`packages/engine/modules/pymol/importing.py:1428` (`def load_coords`). Implemented
in the TS port at `packages/engine-ts/src/cmd/fileio.ts:343`.
