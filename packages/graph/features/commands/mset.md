---
name: mset
kind: command
category: movies-scenes-states
subcategory: movie definition
summary: Defines the mapping between molecular states and movie frames.
parity: implemented
---

## Purpose
`mset` establishes which molecular state is shown in each movie frame - the core
command for building a movie. Its compact specification language lets you hold,
sweep, and repeat states across frames.

## Syntax
```
mset(specification='', frame=1, freeze=0)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `specification` | str | `''` | frame->state mapping expression |
| `frame` | int | `1` | frame at which to start applying the spec |
| `freeze` | int | `0` | freeze/lock interpolation while editing |

## Behaviour
The specification maps states onto frames: `1` means one state to one frame;
`1 x10` repeats state 1 across ten frames; ranges like `1 -15` sweep through
states 1..15 across frames, and terms combine (e.g. `1 x30 1 -15 15 x30 15 -1`).
`mset` replaces the existing movie definition; `madd` extends it using the same
syntax. In the TS port `mset` takes the frame specification and (per its own
notes) ignores `frame`/`freeze`, replacing the movie.

## Examples
```
mset 1
mset 1 x10
mset 1 x30 1 -15 15 x30 15 -1
```

## Related
- `madd` - append using the same syntax
- [mplay](mplay.md), [mstop](mstop.md), `mdo`, `mclear` - playback/control

## Source
`packages/engine/modules/pymol/moving.py:691`. Registered in the TS port at
`packages/engine-ts/src/cmd/system.ts:169`.
