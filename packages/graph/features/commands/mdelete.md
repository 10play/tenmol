---
name: mdelete
kind: command
category: movies-scenes-states
subcategory: movie frame editing
summary: Removes frames (camera views and object motions) from the movie timeline.
parity: partial
---

## Purpose
`mdelete` deletes a run of movie frames, dropping their camera keyframes and object motions and shortening the timeline. Use it to cut a segment out of an animation.

## Syntax
`mdelete(count=-1, frame=0, freeze=0, object='', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `count` | int | `-1` | Number of frames to delete; `-1` = to the end |
| `frame` | int | `0` | First frame to delete; `0` = current frame (negative counts from end) |
| `freeze` | int | `0` | Suppress auto-reinterpolation when set |
| `object` | str | `''` | Restrict to a single object's motions; empty = camera/global |
| `quiet` | int | `1` | Suppress feedback when set |

## Behaviour
`frame=0` resolves to the current frame; negative `frame` indexes from the end (clamped so the deleted block fits); positive `frame` is converted to zero-based. A negative `count` is expanded to delete everything from `frame` to the end. Delegates to `_cmd.mmodify` with mode `-1` (delete).

## Examples
```python
# delete frames 81 to 90
mdelete 10, 81
# delete from the current frame to the end
mdelete
```

## Related
- [minsert](../commands/minsert.md)
- [mmove](../commands/mmove.md)
- [mcopy](./mcopy.md)

## Source
`packages/engine/modules/pymol/moving.py:591`. Parity: registered as a no-op stub in `packages/engine-ts/src/cmd/extras.ts:529`.
