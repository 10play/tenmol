---
name: matrix_copy
kind: command
category: fitting-alignment
subcategory: object matrix
summary: Copies an object's transformation matrix onto another object (or into the camera view).
parity: partial
---

## Purpose
`matrix_copy` transfers the representation transformation from one object to another so they share a frame of reference. It is typically run after aligning object A to a reference to bring related objects (B, C, …) into the same superposition without re-running the alignment.

## Syntax
`matrix_copy(source_name='', target_name='', source_mode=-1, target_mode=-1, source_state=1, target_state=1, target_undo=1, log=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `source_name` | str | `''` | Object to copy the matrix from |
| `target_name` | str | `''` | Object to copy the matrix onto |
| `source_mode` | int | `-1` | Source matrix mode (`-1` = auto/`matrix_mode`) |
| `target_mode` | int | `-1` | Target matrix mode (`-1` = auto) |
| `source_state` | int | `1` | Source state (1-based) |
| `target_state` | int | `1` | Target state (1-based) |
| `target_undo` | int | `1` | Push an undo entry for the target |
| `log` | int | `0` | Emit a log entry |
| `quiet` | int | `1` | Suppress feedback when set |

## Behaviour
If `target_name` is empty but `source_name` is given, the source object's matrix is composed with the current camera and applied via `set_view` (i.e. the view adopts the object's frame). Otherwise `_cmd.matrix_copy` copies the matrix object-to-object, converting states to zero-based. `matrix_transfer` is a legacy alias for this command.

## Examples
```python
align mobile, reference
matrix_copy mobile, ligand
matrix_copy mobile, waters
```

## Related
- [matrix_reset](./matrix_reset.md)
- [matrix_transfer](./matrix_transfer.md)
- [align](../commands/align.md)
- [fit](../commands/fit.md)

## Source
`packages/engine/modules/pymol/editing.py:2396`. Parity: registered as a no-op stub in `packages/engine-ts/src/cmd/extras.ts:553`.
