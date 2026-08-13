---
name: transform_selection
kind: command
category: editing-building
subcategory: matrix transform
summary: Applies a 4x4 transformation matrix to the atomic coordinates of a selection.
parity: implemented
---

## Purpose
`transform_selection` transforms the coordinates of the atoms in a selection by a
supplied 4×4 matrix. Unlike `transform_object`, it always moves atomic
coordinates (not a display matrix), making it the low-level primitive behind
`translate`, `rotate`, and alignment fixups.

## Syntax
`transform_selection(selection, matrix, state=-1, log=0, homogenous=0, transpose=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | — | Atoms whose coordinates are transformed. |
| `matrix` | list of 16 floats | — | The 4×4 transformation matrix. |
| `state` | int | `-1` | Object state (1-based at API; `-1` = current). |
| `log` | 0/1 | `0` | Write the action to the log file. |
| `homogenous` | 0/1 | `0` | If 0, the matrix is PyMOL's non-standard form (see below). |
| `transpose` | 0/1 | `0` | Matrix layout: 0 = row-major, 1 = column-major. |

## Behaviour
When `homogenous=0` the matrix is **not** a standard homogeneous 4×4: the upper-left
3×3 is the rotation, the bottom row `matrix[12:15]` is a translation applied
*before* rotation, and the right column `matrix[3,7,11]` is a translation applied
*after* rotation. Concretely `y_i = Σ_j m_ij·(x_j + m[12+j]) + m[i*4+3]`. With
`transpose=1` the matrix is transposed to row-major first. The selection is
preprocessed and state is decremented internally.

## Examples
```python
# pure +5 Å shift in X (pre-rotation translation, homogenous=0)
m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,0,0,1]
cmd.transform_selection("chain A", m)
```

## Related
- [transform_object](../commands/transform_object.md)
- [translate](../commands/translate.md)
- [rotate](../commands/rotate.md)

## Source
`packages/engine/modules/pymol/editing.py:2284`. Parity: implemented — registered
in `packages/engine-ts/src/cmd/xform.ts:116`.
