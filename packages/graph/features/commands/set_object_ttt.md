---
name: set_object_ttt
kind: command
category: viewing-camera
subcategory: object matrix
summary: API-only command that sets an object's TTT (view-transformation) matrix.
parity: planned
---

## Purpose
`set_object_ttt` sets the TTT matrix — the per-object view transformation used to position and orient an object independently of the camera. It is an API-only function, typically used when scripting object animations or applying a precomputed placement.

## Syntax
`set_object_ttt(object, ttt, state=0, quiet=1, homogenous=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | object name |
| `ttt` | list[16 floats] | — | the TTT matrix |
| `state` | int | `0` | UNUSED — TTT matrices are not state-specific |
| `quiet` | int | `1` | suppress console feedback |
| `homogenous` | 0/1 | `0` | if `1`, transpose the input and set the last column to `[0,0,0,1]` |

## Behaviour
Unlike a homogeneous matrix (whose last row is always `[0,0,0,1]`), a TTT matrix may carry a pre-translation vector in its last row. When a movie is defined and the object has object-motion key frames, those key frames take priority and overwrite the TTT matrix during playback. The `homogenous` flag is flagged upstream as misleadingly named and possibly incorrect: it transposes the matrix and rewrites the post-translation column. `ttt` may be passed as a list or as a string that parses to one.

## Examples
```python
cmd.set_object_ttt("obj", [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,0,0,1])
```

## Related
- [transform_object](transform_object.md)
- [matrix_reset](matrix_reset.md)

## Source
Upstream: `packages/engine/modules/pymol/editing.py:2219`. Parity: intentionally **not** ported to the TS engine — the viewport has no per-object TTT support, so an honest `NotPorted` is preferred over a no-op (`packages/engine-ts/src/cmd/xform.ts:6`). Planned.
