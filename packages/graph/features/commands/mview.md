---
name: mview
kind: command
category: movies-scenes-states
subcategory: movie keyframes
summary: Stores camera and object matrices as keyframes for movie interpolation.
parity: implemented
---

## Purpose
`mview` records the current camera view (or an object's matrix) at a movie frame
so PyMOL can interpolate smooth motion between keyframes. It is the workhorse
behind camera fly-throughs, object animations and scene transitions in a movie.

## Syntax
```
mview(action='store', first=0, last=0, power=0.0, bias=-1.0, simple=-1,
      linear=0.0, object='', wrap=-1, hand=0, window=5, cycles=1,
      scene='', cut=0.5, quiet=1, auto=-1, state=0, freeze=0)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `action` | str | `'store'` | one of store, clear, reset, purge, interpolate, uninterpolate, reinterpolate, toggle, toggle_interp, smooth |
| `first` | int | `0` | frame number, or 0 for current frame |
| `last` | int | `0` | last frame of a range (0 = same as first) |
| `power` | float | `0.0` | ease at keyframe (0.0) or move linearly through it (1.0) |
| `bias` | float | `-1.0` | timing bias of the interpolation |
| `simple` | int | `-1` | simple (linear-angle) vs smooth camera interpolation |
| `linear` | float | `0.0` | linear vs curved path blending |
| `object` | str | `''` | object name for object keyframes; empty = global (camera) keyframes |
| `wrap` | int | `-1` | wrap the interpolated path back to the start |
| `hand` | int | `0` | handedness of the rotational interpolation |
| `window` | int | `5` | smoothing window for the `smooth` action |
| `cycles` | int | `1` | number of smoothing cycles |
| `scene` | str | `''` | name of a scene to attach to the keyframe |
| `cut` | float | `0.5` | scene-switch moment within a transition (0.0 start, 1.0 end) |
| `quiet` | int | `1` | suppress feedback |
| `auto` | int | `-1` | if freeze=0, auto reinterpolate after store/clear/toggle (-1 = use `movie_auto_interpolate`) |
| `state` | int | `0` | if > 0, store an object state with the keyframe |
| `freeze` | 0/1 | `0` | never auto reinterpolate |

## Behaviour
Negative `first`/`last` count back from the end (`count_frames() + n + 1`). The
`action` string is resolved through a shortcut dictionary, so abbreviations are
accepted. If `scene` is `'auto'` or `None`, the current scene name is used; a
non-empty scene is recalled (without animation) before storing. After storing,
`auto`/`freeze` and the `movie_auto_interpolate` setting decide whether the
interpolation is regenerated immediately. Frame arguments are converted to
0-based internally.

## Examples
```
mview store, 1
mview store, 30, object=lig, state=15
mview interpolate
```

## Related
- [mset](mset.md), `mplay`, `mdo`, `mclear`, `mmatrix` - movie control

## Source
`packages/engine/modules/pymol/moving.py:160`. Registered in the TS port at
`packages/engine-ts/src/cmd/movie2.ts:201`.
