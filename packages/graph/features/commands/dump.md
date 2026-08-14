---
name: dump
kind: command
category: rendering-export
subcategory: geometry export
summary: Writes the raw geometry of an isosurface/isomesh/isodot or map object to a plain-text vertex file.
parity: implemented
---

## Purpose
`dump` exports the underlying geometry of a surface, mesh, dot, or map object as a simple text file, one vertex (or grid point) per line. It is handy for feeding PyMOL-computed isosurfaces/maps into external tools.

## Syntax
`dump(fnam, obj, state=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fnam` | str | — | Output text file path |
| `obj` | str | — | Object name to dump |
| `state` | int | `1` | Object state (1-based; converted to zero-based internally) |
| `quiet` | 0/1 | `1` | Suppress feedback |

## Behaviour
Output format depends on object type: surface objects export XYZ plus normal, three lines per triangle (GL_TRIANGLES); mesh objects export XYZ only, as line strips (GL_LINE_STRIP) with a blank line starting each new strip; dot objects export XYZ; map objects export XYZ plus the scalar value at each grid point. The `state` argument is decremented before the `_cmd.dump` call.

## Examples
```python
fetch 1ubq, mymap, type=2fofc, async=0
dump gridmap.txt, mymap
isosurface mysurface, mymap
dump surfacegeometry.txt, mysurface
```

## Related
- [isosurface](../commands/isosurface.md)
- [isomesh](../commands/isomesh.md)
- [isodot](../commands/isodot.md)
- [save](../commands/save.md)

## Source
`packages/engine/modules/pymol/experimenting.py:131`. Parity: implemented in `packages/engine-ts/src/cmd/exporters.ts`.
