---
name: mmove
kind: command
category: movies-scenes-states
subcategory: movie editing
summary: Moves key frames and movie commands from one frame position to another.
parity: planned
---

## Purpose
`mmove` relocates a block of key frames (and their attached movie commands) from
a source frame to a target frame. Use it to re-time sections of a defined movie
without deleting and re-adding frames.

## Syntax
```
mmove(target, source=0, count=-1, freeze=0, object='', quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `target` | int | | frame to move to |
| `source` | int | `0` | frame to move from; 0 = current frame |
| `count` | int | `-1` | number of frames to move |
| `freeze` | int | `0` | freeze/lock interpolation while editing |
| `object` | str | `''` | restrict to a specific object's motions |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Both `source` and `target` accept 0 (use current frame), positive 1-based frame
numbers, or negatives that count back from the movie end (clamped so
`source + count` stays within the movie length). It then calls `_cmd.mmodify`
with mode `2` (move). Contrast with `mcopy`, which duplicates rather than moves.

## Examples
```
mmove 10, source=40, count=15
mmove 1
```

## Related
- [minsert](minsert.md) - insert blank frames
- `mcopy` - copy key frames; `mdelete` - delete frames

## Source
`packages/engine/modules/pymol/moving.py:493`. Not registered in the TS port.
