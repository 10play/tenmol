---
name: map_set_border
kind: command
category: maps-volumes
subcategory: map editing
summary: Sets the map value on all edge (border) grid points to a fixed level.
parity: implemented
---

## Purpose
`map_set_border` forces the outer shell of a map's grid to a constant value. It was added for the PDA (Protein Dipole Analysis) workflow to guarantee the map closes at its boundaries so isosurfaces do not leak out the sides. Unsupported / niche.

## Syntax
`map_set_border(name, level=0.0, state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of the map object |
| `level` | float | `0.0` | Value to write to all border grid points |
| `state` | int | `0` | Map state to modify |

## Behaviour
Every grid point on the six faces of the map's bounding box (`x`/`y`/`z` at index 0 or `dim-1`) is set to `level`; interior voxels are untouched. Setting the border to a value below the contour level ensures isosurfaces close cleanly at the map edges.

## Examples
```python
map_set_border my_map
map_set_border my_map, -1.0
```

## Related
- [map_new](./map_new.md)
- [map_trim](./map_trim.md)
- [load](../commands/load.md)

## Source
`packages/engine/modules/pymol/editing.py:2656`. Parity: implemented in `packages/engine-ts/src/cmd/maps.ts:283`.
