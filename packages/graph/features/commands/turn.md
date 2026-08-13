---
name: turn
kind: command
category: viewing-camera
subcategory: camera rotation
summary: Rotates the camera about one of the three primary axes, centered at the origin.
parity: implemented
---

## Purpose
`turn` rotates the view about a camera axis by a given angle. It is the standard
verb for spinning the scene interactively or in movie scripts, complementing
`move`, `zoom`, and `clip`.

## Syntax
`turn(axis, angle)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `axis` | string | — | Rotation axis: `x`, `y`, or `z`. |
| `angle` | float | — | Rotation angle in degrees. |

## Behaviour
The rotation is applied to the camera about the named primary axis, centered at
the origin, so the object stays framed while the viewpoint turns. It changes only
the view matrix, not atomic coordinates (use [rotate](../commands/rotate.md) to
move coordinates). Successive `turn` calls compose.

## Examples
```
turn x, 90
turn y, 45
```

## Related
- [move](../commands/move.md)
- [rotate](../commands/rotate.md)
- [zoom](../commands/zoom.md)
- [center](../commands/center.md)
- [clip](../commands/clip.md)

## Source
`packages/engine/modules/pymol/viewing.py:1300`. Parity: implemented — the TS
view engine implements `turn(axis, angle)` in
`packages/engine-ts/src/view/view.ts:107`.
