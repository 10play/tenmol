---
name: translate
kind: command
category: editing-building
subcategory: coordinate translation
summary: Translates the atomic coordinates of a selection, or modifies an object's display/TTT matrix.
parity: implemented
---

## Purpose
`translate` shifts atoms by a vector. In its default mode it edits atomic
coordinates; alternatively, when an `object` is named, it modifies that object's
display (TTT) matrix instead — the mode used for movie animation.

## Syntax
`translate(vector=[0.0, 0.0, 0.0], selection='all', state=-1, camera=1, object=None, object_mode=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `vector` | float[3] | `[0.0, 0.0, 0.0]` | Translation vector. |
| `selection` | string | `'all'` | Atoms to move (ignored when `object` is set). |
| `state` | int | `-1` | `>0` one state; `0` all states; `-1` current state. |
| `camera` | 0/1 | `1` | If 1, the vector is in camera coordinates; if 0, in model coordinates. |
| `object` | string | `None` | Object name — moves the object matrix instead of coordinates. |
| `object_mode` | int | `0` | With `object`: `0` updates the TTT display matrix; `1` updates TTT or coordinates per `matrix_mode`. |

## Behaviour
The vector is evaluated (accepting a string form) and, when `camera=1`, rotated
from camera space into model space using the current view matrix. If `object` is
`None`, a translation matrix is built and passed to `transform_selection` — all
representation geometry regenerates. If `object` is set, `selection` is ignored:
`object_mode=0` updates the transient TTT matrix (animation only), while
`object_mode=1` routes through `transform_object` and updates either TTT or
coordinates depending on `matrix_mode`.

## Examples
```
translate [1,0,0], name CA
translate [0,0,10], object=myObj
```

## Related
- [translate_atom](../commands/translate_atom.md)
- [transform_selection](../commands/transform_selection.md)
- [rotate](../commands/rotate.md)

## Source
`packages/engine/modules/pymol/editing.py:1896`. Parity: implemented — registered
in `packages/engine-ts/src/cmd/transforms.ts:230`.
