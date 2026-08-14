---
name: alter_list
kind: command
category: editing-building
subcategory: atom properties
summary: Unsupported bulk variant of alter that applies a list of per-atom expressions to an object.
parity: internal
---

## Purpose
`alter_list` applies a list of `[index, expression]` pairs to the atoms of a single object in one call. It is documented as an unsupported feature — a lower-level batch form of `alter` used internally; prefer `alter` for normal work.

## Syntax
`alter_list(object, expr_list, quiet=1, space=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | Object whose atoms are altered |
| `expr_list` | list | — | List of per-atom expression entries |
| `quiet` | 0/1 | `1` | Suppress feedback |
| `space` | dict | `None` | Namespace for the expressions (defaults to the pymol namespace) |

## Behaviour
If `space` is `None` it falls back to `_self._pymol.__dict__`. Under the API lock it calls `_cmd.alter_list(object, list(expr_list), quiet, dict(space))`. It exposes the same per-atom property symbols as `alter`, but because it is flagged unsupported it carries no usage/example documentation upstream and its interface may change.

## Examples
```python
# unsupported; shape of expr_list is index-plus-expression entries
cmd.alter_list("mol", [[1, "b=10.0"], [2, "b=20.0"]])
```

## Related
- [alter](./alter.md)
- [alter_state](./alter_state.md)

## Source
`packages/engine/modules/pymol/editing.py:1759`. Parity: internal/unsupported — no `alter_list` command registered in `packages/engine-ts/src`.
