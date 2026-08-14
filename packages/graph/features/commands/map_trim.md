---
name: map_trim
kind: command
category: maps-volumes
subcategory: map editing
summary: Reduces a map's extent to just cover a selection of atoms (plus a buffer).
parity: implemented
---

## Purpose
`map_trim` crops a map so its grid only spans the neighbourhood of a chosen atom selection, discarding voxels far from the atoms of interest. Use it to shrink a large map to a binding site and cut memory/render cost. Unsupported upstream.

## Syntax
`map_trim(name, selection, buffer=0.0, map_state=0, sele_state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of the map object to trim |
| `selection` | str | — | Atoms whose extent defines the kept region |
| `buffer` | float | `0.0` | Padding (Å) added around the selection extent |
| `map_state` | int | `0` | Map state to trim |
| `sele_state` | int | `0` | State from which selection coordinates are read |
| `quiet` | int | `1` | Suppress feedback when set |

## Behaviour
The selection is processed through `selector.process`; its coordinate bounding box (expanded by `buffer` on all sides) is converted to a grid index window clamped to the existing grid, and the map is rewritten with the smaller dimensions and shifted origin. If the selection matches no atoms the map is returned unchanged. States are passed to the engine as `state-1`.

## Examples
```python
map_trim my_map, chain A and resi 50-60
map_trim my_map, ligand, buffer=6.0
```

## Related
- [map_halve](./map_halve.md)
- [map_set_border](./map_set_border.md)
- [map_new](./map_new.md)

## Source
`packages/engine/modules/pymol/editing.py:2739`. Parity: implemented in `packages/engine-ts/src/cmd/maps.ts:213`.
