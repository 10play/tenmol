---
name: mplay
kind: command
category: movies-scenes-states
subcategory: movie playback
summary: Starts playing the currently defined movie.
parity: implemented
---

## Purpose
`mplay` begins animation playback of the defined movie, stepping through frames
in real time. It is the play button for the movie system.

## Syntax
```
mplay()
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| _(none)_ | | | |

## Behaviour
Locks the C layer and calls `_cmd.mplay(..., 1)` (start). Requires a movie to be
defined via [mset](mset.md). Playback continues until [mstop](mstop.md), or
toggle with [mtoggle](mtoggle.md). Frame rate and rendering (e.g. ray-traced
frames) are governed by movie/rendering settings.

## Examples
```
mset 1 x60
mplay
```

## Related
- [mstop](mstop.md), [mtoggle](mtoggle.md), [mset](mset.md), [mmatrix](mmatrix.md)

## Source
`packages/engine/modules/pymol/moving.py:247`. Registered in the TS port at
`packages/engine-ts/src/cmd/system.ts:195`.
