---
name: map_halve
kind: command
category: maps-volumes
subcategory: map resampling
summary: Resamples a map object at half its current resolution (coarser grid), optionally smoothing.
parity: implemented
---

## Purpose
`map_halve` downsamples a map onto a grid with double the spacing, cutting the sampling in half along each axis. Use it to shrink a large map's memory footprint or to coarsen a surface deliberately.

## Syntax
`map_halve(name, state=0, smooth=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of the map object to resample |
| `state` | int | `0` | Map state to operate on (`0` = current/all) |
| `smooth` | int | `1` | If set, apply smoothing while downsampling |

## Behaviour
The grid is coarsened by a factor of two in every dimension, so grid points and memory decrease roughly eight-fold. `state` is passed as `state-1` (zero-based). With `smooth=1` the resampling averages neighbouring voxels rather than plain decimation. This is the inverse operation of `map_double`.

## Examples
```python
map_halve big_map
map_halve big_map, 1, smooth=0
```

## Related
- [map_double](./map_double.md)
- [map_trim](./map_trim.md)
- [map_new](./map_new.md)

## Source
`packages/engine/modules/pymol/editing.py:2709`. Parity: implemented via `resampleUniform` in `packages/engine-ts/src/cmd/maps.ts:274`.
