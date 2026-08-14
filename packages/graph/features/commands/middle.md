---
name: middle
kind: command
category: movies-scenes-states
subcategory: movie playback
summary: Jumps the movie playhead to the middle frame.
parity: implemented
---

## Purpose
`middle` moves the current movie frame to the midpoint of the movie. Use it as a
quick navigation shortcut alongside rewind/forward when scrubbing a defined
movie.

## Syntax
```
middle()
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| _(none)_ | | | |

## Behaviour
Locks the C layer and calls `_cmd.set_frame(..., 3, 0)`, where mode `3` is the
"go to middle" seek. Requires a movie to be defined (see [mset](mset.md));
otherwise there is nothing to seek within.

## Examples
```
mset 1 x60
middle
```

## Related
- [mplay](mplay.md), [mstop](mstop.md) - playback control
- [mset](mset.md) - define the movie

## Source
`packages/engine/modules/pymol/moving.py:934`. Registered in the TS port at
`packages/engine-ts/src/cmd/extras.ts:449`.
