---
name: isodot
kind: command
category: maps-volumes
subcategory: isosurface
summary: Create a dot isosurface object from a map object at a given contour level.
parity: implemented
---

## Purpose
Reach for `isodot` to visualise a volumetric map (electron density, potential, etc.) as a cloud
of dots at a chosen contour level. It is the dot-rendered sibling of [isomesh](isomesh.md) and
[isosurface](isosurface.md).

## Syntax
`isodot(name, map, level=1.0, selection='', buffer=0.0, state=0, carve=None, source_state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | name for the new dot object |
| `map` | string | — | map object to contour |
| `level` | float | `1.0` | contour level |
| `selection` | string | `''` | atoms about which to display the dots (plus `buffer`) |
| `buffer` | float | `0.0` | extra padding around `selection` |
| `state` | int | `0` | target state; `0` appends as a new state |
| `carve` | float | `None` | radius about each selected atom to include density (None = whole brick) |
| `source_state` | int | `0` | map state to read from |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Internally implemented via the same `_cmd.isomesh` call as [isomesh](isomesh.md) but with the
dot mode flag set. If the target object already exists the new dots are appended as a new state
(unless a specific `state` is given). `carve=None` is normalised to `0.0` before the C call. The
selection is preprocessed through the selector engine. State conventions: `state>0` specific,
`state=0` all/append, `state=-1` current; `source_state=-2` means the last map state.

## Examples
```python
isodot dots, 2fofc, 1.0
isodot near_lig, 2fofc, 1.5, (resn LIG), buffer=2.0, carve=1.6
```

## Related
[isomesh](isomesh.md), [isosurface](isosurface.md), [isolevel](isolevel.md), [load](load.md)

## Source
`packages/engine/modules/pymol/creating.py:779`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/maps.ts:347`, via the shared `buildIso('dot', …)` path).
