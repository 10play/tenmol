---
name: transform_object
kind: command
category: editing-building
subcategory: matrix transform
summary: API-only function that applies a 4x4 transformation matrix to an object (or its TTT matrix).
parity: implemented
---

## Purpose
`transform_object` applies an arbitrary 4×4 transformation matrix to an object.
It is an API-only building block used for animation and programmatic placement;
depending on `matrix_mode` and whether a selection is given, it can transform
coordinates or the object's transient (TTT/movie) matrix.

## Syntax
`transform_object(name, matrix, state=-1, log=0, selection='', homogenous=0, transpose=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Object name. |
| `matrix` | list of 16 floats | — | The 4×4 transformation matrix. |
| `state` | int | `-1` | Object state (1-based at API; `-1` = current). |
| `log` | 0/1 | `0` | Write the action to the log file (molecular objects only). |
| `selection` | str | `''` | Atom selection (molecular objects); empty transforms the whole object state. |
| `homogenous` | 0/1 | `0` | If 0, `matrix[12:15]` may hold a pre-translation; if 1 those must be zeros. |
| `transpose` | 0/1 | `0` | Matrix layout: 0 = row-major, 1 = column-major. |

## Behaviour
When `matrix_mode > 0` and `selection` is empty, the function operates on the TTT
(movie) matrix instead of coordinates. With `transpose=1` the matrix is transposed
into row-major order before dispatch. With `homogenous=0` the matrix is the
PyMOL-specific form where the bottom row is a pre-rotation translation (see
[transform_selection](../commands/transform_selection.md)); with `homogenous=1` a
standard homogeneous matrix is expected. State is decremented internally.

## Examples
```python
m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,0,0,1]  # +5 pre-translation in X
cmd.transform_object("mol", m, homogenous=0)
```

## Related
- [transform_selection](../commands/transform_selection.md)
- [set_object_ttt](../commands/set_object_ttt.md)
- [matrix_reset](../commands/matrix_reset.md)

## Source
`packages/engine/modules/pymol/editing.py:2344`. Parity: implemented — registered
in `packages/engine-ts/src/cmd/xform.ts:91`.
