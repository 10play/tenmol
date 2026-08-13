---
name: matrix_transfer
kind: command
category: fitting-alignment
subcategory: object matrix
summary: Legacy alias of matrix_copy — copies a transformation matrix from one object to another.
parity: unknown
---

## Purpose
`matrix_transfer` is a backward-compatibility alias for [matrix_copy](./matrix_copy.md); it exists so older scripts and menu entries keep working. Use `matrix_copy` in new code. It transfers an object's transformation matrix onto another object so they share a frame of reference (e.g. after an alignment).

## Syntax
`matrix_transfer(source_name='', target_name='', source_mode=-1, target_mode=-1, source_state=1, target_state=1, target_undo=1, log=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `source_name` | str | `''` | Object to copy the matrix from |
| `target_name` | str | `''` | Object to copy the matrix onto |
| `source_mode` | int | `-1` | Source matrix mode (`-1` = auto) |
| `target_mode` | int | `-1` | Target matrix mode (`-1` = auto) |
| `source_state` | int | `1` | Source state (1-based) |
| `target_state` | int | `1` | Target state (1-based) |
| `target_undo` | int | `1` | Push an undo entry for the target |
| `log` | int | `0` | Emit a log entry |
| `quiet` | int | `1` | Suppress feedback when set |

## Behaviour
Defined in the public API as `matrix_transfer = matrix_copy # legacy`; every argument and all behaviour are identical to `matrix_copy`, including the special case where an empty `target_name` applies the source matrix to the camera view. The context-menu "matrix" actions in `menu.py` invoke it under this name.

## Examples
```python
align mobile, reference
matrix_transfer mobile, ligand
```

## Related
- [matrix_copy](./matrix_copy.md)
- [matrix_reset](./matrix_reset.md)
- [align](../commands/align.md)

## Source
Alias defined at `packages/engine/modules/pymol/api.py:270` (`matrix_transfer = matrix_copy`); implementation `packages/engine/modules/pymol/editing.py:2396`. Parity: not present in `packages/engine-ts/src`.
