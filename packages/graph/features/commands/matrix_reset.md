---
name: matrix_reset
kind: command
category: fitting-alignment
subcategory: object matrix
summary: Resets an object's transformation matrix (representation, TTT/movie, or state matrix).
parity: unknown
---

## Purpose
`matrix_reset` removes a transformation that has been applied to an object, returning it to an untransformed frame of reference. Use it to undo a `matrix_copy`, an alignment-induced transform, or a movie TTT matrix.

## Syntax
`matrix_reset(name, state=1, mode=-1, log=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Object name |
| `state` | int | `1` | Object state (1-based) |
| `mode` | int | `-1` | Which matrix to reset (see below); `-1` = `matrix_mode` or 0 |
| `log` | int | `0` | Emit a log entry |
| `quiet` | int | `1` | Suppress feedback when set |

## Behaviour
`mode` selects the target: `0` = transformation that was applied to coordinates, `1` = TTT matrix (movie transformation), `2` = state matrix. With `mode=-1` the choice defaults to the `matrix_mode` setting (or 0). Calls `_cmd.reset_matrix` with a zero-based `state-1`.

## Examples
```python
matrix_reset mobile
matrix_reset mobile, mode=1
```

## Related
- [matrix_copy](./matrix_copy.md)
- [align](../commands/align.md)
- [super](../commands/super.md)
- [fit](../commands/fit.md)

## Source
`packages/engine/modules/pymol/editing.py:2464`. Parity: not present in `packages/engine-ts/src`.
