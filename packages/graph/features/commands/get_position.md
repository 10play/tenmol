---
name: get_position
kind: command
category: viewing-camera
subcategory: camera query
summary: Return the 3D coordinates of the center of the viewer window (camera origin of rotation).
parity: implemented
---

## Purpose
`get_position` returns the world-space 3D coordinates at the center of the viewer
window — the point the camera looks at and rotates about. Use it to read the
current view center, e.g. to place objects or restore a focus point.

## Syntax
`get_position(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | int | `1` | If `0`, prints the `[x, y, z]` coordinates to the console |

## Behaviour
Locks the API and reads the camera's center of rotation from the C layer,
returning a 3-element `[x, y, z]` list. When `quiet=0` it prints the coordinates
formatted to three decimals.

## Examples
```python
xyz = cmd.get_position()
cmd.get_position(quiet=0)
```

## Related
- [get_view](get_view.md), [get_extent](get_extent.md), [center](center.md)

## Source
`packages/engine/modules/pymol/querying.py:943`. Parity: implemented — registered
at `packages/engine-ts/src/cmd/measurement.ts:262`.
