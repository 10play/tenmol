---
name: isolevel
kind: command
category: maps-volumes
subcategory: isosurface
summary: Change (or query) the contour level of an existing isodot, isomesh, or isosurface object.
parity: implemented
---

## Purpose
Adjust the threshold of an already-created contour object without rebuilding it from scratch — the
fast way to explore a map at different sigma levels. Can also be used to read back the current
level.

## Syntax
`isolevel(name, level=1.0, state=0, query=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | the isodot/isomesh/isosurface object to modify |
| `level` | float | `1.0` | new contour level |
| `state` | int | `0` | object state to affect |
| `query` | int | `0` | if nonzero, return the current level instead of setting it |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Calls `_cmd.isolevel` with `state-1` (converting to 0-based). When `query` is falsy it sets the
level and raises `pymol.CmdException` on a negative (error) return code; when `query` is truthy it
returns the queried value and does not raise. Uses explicit `lock`/`unlock` rather than the
`lockcm` context manager.

## Examples
```python
isolevel msh, 1.5
level = cmd.isolevel('msh', query=1)
```

## Related
[isomesh](isomesh.md), [isodot](isodot.md), [isosurface](isosurface.md)

## Source
`packages/engine/modules/pymol/creating.py:822`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/maps.ts:198`).
