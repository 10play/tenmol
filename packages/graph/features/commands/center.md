---
name: center
kind: command
category: viewing-camera
subcategory: camera
summary: Translates the view, clipping slab, and origin to the center of a selection.
parity: implemented
---

## Purpose
`center` moves the camera and rotation origin so the given selection sits in the
middle of the view. Unlike `zoom`, it does not change the zoom level — only the
translation and (optionally) the origin.

## Syntax
`center(selection='all', state=0, origin=1, animate=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'all'` | Selection-expression or name pattern to center on. |
| `state` | int | `0` | `0`=all states, `-1`=current state, `>0`=specific state. |
| `origin` | int | `1` | `1`=also move the rotation origin, `0`=leave it unchanged. |
| `animate` | float | `0` | Animation duration in seconds; `0` for instant. |

## Behaviour
The selection is processed with `selector.process`, then `_cmd.center` is called
with `state - 1` (so the public `state=0` "all states" maps to the internal
convention). It translates the window, the clipping slab, and — when `origin=1`
— the center of rotation to the selection centroid. A positive `animate`
smoothly interpolates the camera to the new position.

## Examples
```
center chain B
center 145/
center resi 50, animate=1
```

## Related
- [origin](../commands/origin.md)
- [orient](../commands/orient.md)
- [zoom](../commands/zoom.md)

## Source
`packages/engine/modules/pymol/viewing.py:134`. Ported via
`packages/engine-ts/src/cmd/transforms.ts` / model centering.
