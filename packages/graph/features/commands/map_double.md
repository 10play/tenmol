---
name: map_double
kind: command
category: maps-volumes
subcategory: map resampling
summary: Resamples a map object at twice its current resolution (finer grid).
parity: implemented
---

## Purpose
`map_double` interpolates a map onto a grid with half the spacing, doubling the sampling in each dimension. Use it to smooth the appearance of isosurfaces/meshes derived from a coarse map, at a steep memory cost.

## Syntax
`map_double(name, state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of the map object to resample |
| `state` | int | `0` | Map state to operate on (`0` = current/all) |

## Behaviour
The grid is refined by a factor of two along every axis, so the number of grid points (and the memory required) increases roughly eight-fold. `state` is passed to the engine as `state-1` (zero-based). Any dependent isomesh/isosurface objects should be regenerated to reflect the new sampling.

## Examples
```python
map_double 2fofc_map
map_double 2fofc_map, 1
```

## Related
- [map_halve](./map_halve.md)
- [map_new](./map_new.md)
- [map_trim](./map_trim.md)

## Source
`packages/engine/modules/pymol/editing.py:2685`. Parity: implemented via `resampleUniform` in `packages/engine-ts/src/cmd/maps.ts:265`.
