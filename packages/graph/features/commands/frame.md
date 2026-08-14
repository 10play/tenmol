---
name: frame
kind: command
category: movies-scenes-states
subcategory: playback
summary: Sets the viewer to a specific movie frame by number.
parity: implemented
---

## Purpose
`frame` jumps the movie playhead to a given frame number. Use it to position the viewer at a known point in a defined movie, e.g. before rendering a specific still.

## Syntax
`frame(frame, trigger=-1, scene=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `frame` | int | | frame number to display (1-based) |
| `trigger` | int | `-1` | whether to fire frame triggers (-1 = default) |
| `scene` | int | `0` | whether to apply an associated scene |

## Behaviour
Frame numbers are 1-based. Setting the frame updates the displayed state/camera according to the movie definition. The `trigger` and `scene` arguments control whether frame-associated triggers and scenes fire on the jump.

## Examples
```python
frame 10
frame 1
```

## Related
- [forward](forward.md), [backward](backward.md), [rewind](rewind.md)
- [count_states](count_states.md), [mset](mset.md)

## Source
`packages/engine/modules/pymol/moving.py` (`def frame`). Parity: implemented in `packages/engine-ts/src/cmd/system.ts:141`.
