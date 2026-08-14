---
name: isomesh
kind: command
category: maps-volumes
subcategory: isosurface
summary: Create a mesh (wireframe) isosurface object from a map object at a given contour level.
parity: implemented
---

## Purpose
The workhorse for displaying crystallographic and other volumetric maps as a contoured wireframe
mesh. Use it to show electron density around a region of interest, optionally carved to a
selection.

## Syntax
`isomesh(name, map, level=1.0, selection='', buffer=0.0, state=1, carve=None, source_state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | name for the new mesh object |
| `map` | string | — | map object to contour |
| `level` | float | `1.0` | contour level |
| `selection` | string | `''` | atoms about which to display the mesh (plus `buffer`) |
| `buffer` | float | `0.0` | extra padding around `selection` |
| `state` | int | `1` | target state; `0` appends as a new state |
| `carve` | float | `None` | radius about each selected atom to include density (None = whole brick) |
| `source_state` | int | `0` | map state to read from |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
When a `selection` is given (and is not `center`/`origin`) it is wrapped in parentheses to force
a molecular selection, so that `all` or name patterns cannot accidentally expand to include the
map object itself. `carve=None` becomes `0.0`. If the mesh object already exists, a new mesh is
appended as a new state unless `state` is specified. State semantics: `state>0` specific, `state=0`
all states, `state=-1` current; `source_state=-2` = last map state. Note the default `state=1`
differs from isodot's default of `0`.

## Examples
```python
isomesh msh, 2fofc, 1.0
isomesh lig_density, 2fofc, 1.0, (resn LIG), carve=1.8
```

## Related
[isodot](isodot.md), [isosurface](isosurface.md), [isolevel](isolevel.md), [load](load.md)

## Source
`packages/engine/modules/pymol/creating.py:514`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/maps.ts:345`, via `buildIso('mesh', …)`).
