---
name: get_object_ttt
kind: command
category: querying
subcategory: object transformation
summary: Query an object's TTT (transient transformation) matrix, optionally printing it.
parity: unknown
---

## Purpose
`get_object_ttt` returns the object's TTT (transient) 4x4 transformation matrix —
the matrix applied by camera/mouse manipulation before the object matrix. It is
an "unsupported" helper for reading how an object is currently transformed in the
scene.

## Syntax
`get_object_ttt(object, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | Object name whose TTT matrix is queried |
| `quiet` | int | `1` | If `0`, pretty-prints the 4x4 matrix (with a translation column) to the console |

## Behaviour
Locks the API and calls the C-layer `get_object_ttt` (state `-1`). Returns the
TTT matrix or `None` if none is set. When `quiet=0` it prints the matrix in a 4x4
grid, separating the 3x3 rotation block from the translation column. Documented as
an "unsupported command".

## Examples
```python
cmd.get_object_ttt("myprot")
cmd.get_object_ttt("myprot", quiet=0)
```

## Related
- [get_object_matrix](get_object_matrix.md)

## Source
`packages/engine/modules/pymol/querying.py:102`. Parity: unknown — not registered
in `packages/engine-ts/src`.
