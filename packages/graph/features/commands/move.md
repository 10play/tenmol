---
name: move
kind: command
category: viewing-camera
subcategory: camera translation
summary: Translates the camera along one of the three primary axes.
parity: implemented
---

## Purpose
`move` slides the camera along the x, y or z axis by a given distance. Use it for
fine framing adjustments or to dolly toward/away from the scene along z.

## Syntax
```
move(axis, distance)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `axis` | str | | primary axis: `x`, `y`, or `z` |
| `distance` | float | | translation distance in model units |

## Behaviour
Locks the C layer and calls `_cmd.move(axis, distance)`, translating the camera
(not the objects) about the named axis. Positive/negative distances move in
opposite directions. `axis` and `distance` are keyword-or-positional; `_self` is
keyword-only. Contrast with `translate`, which moves atoms, and `turn`/`rotate`,
which change orientation.

## Examples
```
move x, 3
move y, -1
move z, 10
```

## Related
- [turn](turn.md), `rotate`, `translate`, `zoom`, `center`, `clip` - camera/scene motion

## Source
`packages/engine/modules/pymol/viewing.py:352`. Registered in the TS port at
`packages/engine-ts/src/cmd/transforms.ts:201`.
