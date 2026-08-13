---
name: count_frames
kind: command
category: movies-scenes-states
subcategory: movie frames
summary: Returns the number of frames defined for the PyMOL movie.
parity: partial
---

## Purpose
`count_frames` returns the number of frames in the current movie (the movie timeline, as distinct from molecular states). Use it when scripting movie playback, scrubbing, or export to know the timeline length.

## Syntax
`count_frames(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | int | `1` | Suppress the "count_frames: N frames" print when `1` |

## Behaviour
Locks the session and returns the movie frame count from the C layer. Movie frames come from an `mset` mapping; without a movie defined the count reflects the implicit frames. Distinct from `count_states` (per-object coordinate sets) and from `get_movie_length` (frames explicitly defined, excluding molecular states).

## Examples
```python
count_frames
count_frames quiet=0
```

## Related
- [frame](../commands/frame.md)
- [count_states](../commands/count_states.md)

## Source
`packages/engine/modules/pymol/querying.py:759` (`def count_frames`). Partial port: consumed via `ctx.call('count_frames')` in `packages/engine-ts/src/cmd/movie3.ts:92`; noted as a FIXED stub in `packages/engine-ts/src/cmd/system.ts:9`.
