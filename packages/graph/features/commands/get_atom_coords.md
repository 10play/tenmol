---
name: get_atom_coords
kind: command
category: querying
subcategory: coordinate query
summary: Returns the 3D coordinates of a single atom.
parity: implemented
---

## Purpose
`get_atom_coords` returns the `(x, y, z)` position of a single atom in a given state. Reach for it when you need the coordinates of one specific atom, e.g. a picked atom, without pulling a whole coordinate array.

## Syntax
`get_atom_coords(selection, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | — | Single-atom selection |
| `state` | int | `0` | Coordinate state (`0` = current) |
| `quiet` | 0/1 | `1` | If `0`, prints the coordinate triple |

## Behaviour
This is a low-performance path for retrieving one atom's coordinates — the selection is processed via `selector.process` and must resolve to exactly one atom. Dispatches to `_cmd.get_atom_coords` with a zero-based `state-1`. Returns a 3-element sequence of floats. With `quiet=0` it prints ` cmd.get_atom_coords: [x, y, z]`. For many atoms use [get_coords](../commands/get_coords.md) instead.

## Examples
```python
get_atom_coords pk1
xyz = cmd.get_atom_coords("1/CA")
```

## Related
- [get_coords](../commands/get_coords.md)
- [get_extent](../commands/get_extent.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:888`. Parity: implemented — registered as `ctx.command('get_atom_coords')` in `packages/engine-ts/src/cmd/measurement.ts:199`.
