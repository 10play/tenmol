---
name: minsert
kind: command
category: movies-scenes-states
subcategory: movie editing
summary: Inserts blank frames into the movie's camera view and object motions.
parity: planned
---

## Purpose
`minsert` adds a run of frames into an existing movie, shifting later camera
views and object motions to make room. Use it when extending or re-timing a
defined movie without rebuilding the whole `mset` specification.

## Syntax
```
minsert(count, frame=0, freeze=0, object='', quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `count` | int | | number of frames to insert |
| `frame` | int | `0` | insert before this frame if `> 0`, else before the current frame |
| `freeze` | int | `0` | freeze/lock interpolation while editing |
| `object` | str | `''` | restrict edit to a specific object's motions |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
When `frame` is 0 it targets the current frame (`get_frame() - 1`); otherwise it
converts the 1-based `frame` to 0-based. It then calls `_cmd.mmodify` with mode
`1` (insert), passing `count`, the target frame, `object`, `freeze` and `quiet`.
Frames after the insertion point are pushed back accordingly.

## Examples
```
minsert 30
minsert 15, frame=45
```

## Related
- [mmove](mmove.md) - move key frames and movie commands
- [mset](mset.md) - define the movie
- `mdelete`, `madd` - remove/append frames

## Source
`packages/engine/modules/pymol/moving.py:640`. Not registered in the TS port.
