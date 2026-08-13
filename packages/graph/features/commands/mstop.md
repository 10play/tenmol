---
name: mstop
kind: command
category: movies-scenes-states
subcategory: movie playback
summary: Stops movie playback.
parity: implemented
---

## Purpose
`mstop` halts the currently playing movie, leaving the playhead on the current
frame. It is the stop button paired with [mplay](mplay.md).

## Syntax
```
mstop()
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| _(none)_ | | | |

## Behaviour
Locks the C layer and calls the underlying movie-play routine with a stop signal
(`_cmd.mplay(..., 0)`). No effect if no movie is playing. Use
[mtoggle](mtoggle.md) to flip between play and stop with a single command.

## Examples
```
mplay
mstop
```

## Related
- [mplay](mplay.md), [mtoggle](mtoggle.md), [mset](mset.md), [mmatrix](mmatrix.md)

## Source
`packages/engine/modules/pymol/moving.py:121`. Registered in the TS port at
`packages/engine-ts/src/cmd/system.ts:199`.
