---
name: mcopy
kind: command
category: movies-scenes-states
subcategory: movie frame editing
summary: Copies key frames and movie commands from one range of the movie to another.
parity: partial
---

## Purpose
`mcopy` duplicates a block of movie frames — their camera keyframes and generalized commands — to a new position, leaving the source intact. Use it to replicate a sequence of animation elsewhere in the timeline. Argument handling mirrors `mmove`.

## Syntax
`mcopy(target, source=0, count=-1, freeze=0, object='', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `target` | int | — | Destination frame (1-based; `0` = current, negative counts from end) |
| `source` | int | `0` | First source frame (`0` = current frame, negative from end) |
| `count` | int | `-1` | Number of frames to copy (`-1` = to end) |
| `freeze` | int | `0` | Suppress auto-reinterpolation when set |
| `object` | str | `''` | Restrict to a single object's motions; empty = camera/global |
| `quiet` | int | `1` | Suppress feedback when set |

## Behaviour
`source`/`target` of `0` resolve to the current frame; negative values index from the end and are clamped so `frame+count` stays within the movie length; positive values are converted to zero-based (`-1`). Delegates to `_cmd.mmodify` with mode `3` (copy).

## Examples
```python
mcopy 100, 1, 30
mcopy 200, -30, 30
```

## Related
- [mmove](../commands/mmove.md)
- [mdelete](./mdelete.md)
- [minsert](../commands/minsert.md)

## Source
`packages/engine/modules/pymol/moving.py:545`. Parity: registered as a no-op stub (movie frame-table edits need the engine movie store) in `packages/engine-ts/src/cmd/extras.ts:528`.
