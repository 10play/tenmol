---
name: isosurface
kind: command
category: maps-volumes
subcategory: isosurface
summary: Create a solid triangulated surface object from a map object at a given contour level.
parity: implemented
---

## Purpose
Use `isosurface` to render a map as a solid, shaded surface (rather than the wireframe mesh of
[isomesh](isomesh.md) or the dots of [isodot](isodot.md)) — useful for opaque density blobs,
molecular envelopes, or EM maps.

## Syntax
`isosurface(name, map, level=1.0, selection='', buffer=0.0, state=1, carve=None, source_state=0, side=1, mode=3, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | name for the new surface object |
| `map` | string | — | map object to contour |
| `level` | float | `1.0` | contour level |
| `selection` | string | `''` | atoms about which to display the surface (plus `buffer`) |
| `buffer` | float | `0.0` | extra padding around `selection` |
| `state` | int | `1` | target state; `0` appends as a new state |
| `carve` | float | `None` | radius about each selected atom to include density |
| `source_state` | int | `0` | map state to read from |
| `side` | int | `1` | front/back face — triangle winding / normal direction |
| `mode` | int | `3` | surface geometry: 0 dots, 1 lines, 2 triangles (triangle-normals), 3 triangles (gradient-normals) |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Distinct from isomesh/isodot by its extra `side` and `mode` parameters, which are passed straight
to `_cmd.isosurface`. `carve=None` becomes `0.0`. If the object already exists the new surface is
appended as a new state unless `state` is given. The selection is preprocessed but (unlike isomesh)
not force-parenthesised. Default `mode=3` yields smooth gradient-normal shading.

## Examples
```python
isosurface surf, emd_map, 3.0
isosurface lig_surf, 2fofc, 1.0, (resn LIG), carve=2.0, mode=3
```

## Related
[isomesh](isomesh.md), [isodot](isodot.md), [isolevel](isolevel.md), [load](load.md)

## Source
`packages/engine/modules/pymol/creating.py:719`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/maps.ts:346`, via `buildIso('surface', …)`).
