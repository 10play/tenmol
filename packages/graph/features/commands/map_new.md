---
name: map_new
kind: command
category: maps-volumes
subcategory: map generation
summary: Creates a map object with a built-in generator (Gaussian, VDW, Coulomb, etc.) over a selection.
parity: implemented
---

## Purpose
`map_new` builds a map object on the fly from atoms, using one of several density/potential generators. Reach for it to make low-resolution "blob" surfaces of a structure or to compute an electrostatic (Coulomb) field for coloring. Not yet fully supported upstream.

## Syntax
`map_new(name, type='gaussian', grid=None, selection='(all)', buffer=None, box=None, state=0, quiet=1, zoom=0, normalize=-1, clamp=[1.0, -1.0], resolution=0.0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of the map object to create/modify |
| `type` | str | `'gaussian'` | One of `vdw`, `gaussian`, `gaussian_max`, `coulomb`, `coulomb_neutral`, `coulomb_local` |
| `grid` | float | `None` | Grid spacing |
| `selection` | str | `'(all)'` | Atoms about which to generate the map |
| `buffer` | float | `None` | Cutoff / padding around the selection |
| `box` | — | `None` | Explicit bounding box |
| `state` | int | `0` | State handling (see Behaviour) |
| `quiet` | int | `1` | Suppress feedback when set |
| `zoom` | int | `0` | Zoom to the new map after creation |
| `normalize` | int | `-1` | Normalization flag |
| `clamp` | list | `[1.0, -1.0]` | Value clamp `[hi, lo]` (lo>hi disables) |
| `resolution` | float | `0.0` | Resolution for Gaussian-type maps |

## Behaviour
The `state` argument selects how multi-state objects are handled: `state>0` uses that state; `0` = all states independently with independent extents; `-1` = current global state; `-2` = effective object state(s); `-3` = all states in one map; `-4` = all states independent but with a unified extent. This command is commonly used to create low-resolution molecular surfaces.

## Examples
```python
map_new blob, gaussian, 1.0, polymer
map_new pot, coulomb, 0.5, (all)
```

## Related
- [map_set](./map_set.md)
- [map_generate](./map_generate.md)
- [map_double](./map_double.md)

## Source
`packages/engine/modules/pymol/creating.py:291`. Parity: implemented in `packages/engine-ts/src/cmd/maps.ts:76`.
