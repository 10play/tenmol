---
name: get_object_matrix
kind: command
category: querying
subcategory: object transformation
summary: Query the transformation matrix (object + optional TTT) associated with an object for a given state.
parity: unknown
---

## Purpose
`get_object_matrix` returns the transformation matrix associated with an object,
optionally folding in the object's TTT (transient) matrix. It is an "unsupported"
introspection helper used to read out how an object has been moved/rotated in
world space. Reach for it when a script needs the raw 4x4 matrix rather than the
view.

## Syntax
`get_object_matrix(object, state=1, incl_ttt=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | Object name whose matrix is queried |
| `state` | int | `1` | 1-based state index (passed to engine as `state-1`) |
| `incl_ttt` | int | `1` | If true, include the object's TTT matrix in the result |

## Behaviour
The command locks the API and calls the C layer `get_object_matrix` with
`state-1` and the `incl_ttt` flag. The returned value is the object's state
matrix, optionally composed with its TTT matrix. Officially documented as an
"unsupported command that may have something to do with querying the
transformation matrices associated with an object" — the signature and defaults
are authoritative but behaviour is not guaranteed stable across versions.

## Examples
```python
cmd.get_object_matrix("myprot")
cmd.get_object_matrix("myprot", state=2, incl_ttt=0)
```

## Related
- [get_object_ttt](get_object_ttt.md), [get_object_state](get_object_state.md)

## Source
`packages/engine/modules/pymol/querying.py:89`. Parity: unknown — not registered
as a command in `packages/engine-ts/src`.
