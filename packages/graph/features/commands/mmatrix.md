---
name: mmatrix
kind: command
category: movies-scenes-states
subcategory: movie camera
summary: Stores, recalls, or clears the camera matrix used for the movie's first frame.
parity: implemented
---

## Purpose
`mmatrix` fixes the camera view that the movie starts from, so playback always
begins from the same orientation. Reach for it in simple movies that are not
already driven by the `mview` keyframe system.

## Syntax
```
mmatrix(action)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `action` | str | | one of `clear`, `store`, or `recall` |

## Behaviour
`store` captures the current camera into the movie's initial matrix, `recall`
restores it, and `clear` removes it. Internally these map to `_cmd.mmatrix`
modes 1, 2 and 0 respectively. Do not combine `mmatrix` with `mview` camera
control - the two mechanisms for driving the movie camera are mutually
exclusive.

## Examples
```
mmatrix store
mmatrix recall
mmatrix clear
```

## Related
- [mview](mview.md) - keyframe-based camera interpolation (alternative)
- [mplay](mplay.md), [mset](mset.md) - movie playback and setup

## Source
`packages/engine/modules/pymol/moving.py:772`. Registered in the TS port at
`packages/engine-ts/src/cmd/movie2.ts:254`.
