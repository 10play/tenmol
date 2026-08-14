---
name: slice_new
kind: command
category: maps-volumes
subcategory: map slices
summary: Creates a 2D slice object that samples a map object as a colored plane.
parity: unknown
---

## Purpose
`slice_new` builds a slice object from a map — a planar cross-section that displays map density as a color-mapped image you can drag through the volume. Use it to inspect electron density or other volumetric data in a single plane instead of a mesh/surface.

## Syntax
`slice_new(name, map, state=1, source_state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | Name for the new slice object |
| `map` | string | — | Name of the map object to slice |
| `state` | int | `1` | State the object is loaded into (0 = append as new state) |
| `source_state` | int | `0` | State of the map to read from |

## Behaviour
Lock-guarded; both `state` and `source_state` are decremented to 0-based before dispatch to `_cmd.slice_new`. Setting `state=0` appends the slice as a new state rather than replacing state 1. The docstring notes additional `opacity` (default 1) and `resolution` (pixels per sample, default 5) concepts that are governed by slice-related settings on the resulting object.

## Examples
```python
load density.ccp4, dmap
slice_new mySlice, dmap
```

## Related
- [isomesh](./isomesh.md)
- [isodot](./isodot.md)
- [load](./load.md)

## Source
`packages/engine/modules/pymol/creating.py` (`def slice_new`); signature in `docs/api-reference/commands.mdx:3806`. Parity: referenced in `packages/engine-ts/src/cmd/extras.ts` — status unknown.
