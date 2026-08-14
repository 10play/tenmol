---
name: mtoggle
kind: command
category: movies-scenes-states
subcategory: movie playback
summary: Toggles movie playback on or off.
parity: implemented
---

## Purpose
`mtoggle` flips the movie between playing and stopped with a single command,
convenient for a play/pause keyboard binding.

## Syntax
```
mtoggle()
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| _(none)_ | | | |

## Behaviour
Locks the C layer and calls `_cmd.mplay(..., -1)`, where mode `-1` toggles the
current play state (start if stopped, stop if playing). Requires a defined movie.

## Examples
```
mtoggle
```

## Related
- [mplay](mplay.md), [mstop](mstop.md), [mset](mset.md)

## Source
`packages/engine/modules/pymol/moving.py:104`. Registered in the TS port at
`packages/engine-ts/src/cmd/system.ts:203`.
