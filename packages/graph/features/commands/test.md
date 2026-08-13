---
name: test
kind: command
category: internal
subcategory: development routine
summary: Unsupported internal development/test routine that dispatches to a C-core test entry point.
parity: internal
---

## Purpose
`test` is an unsupported, internal development hook. It exists as a generic entry
point for exercising in-progress C-core routines during PyMOL development and has
no stable user-facing behaviour.

## Syntax
`test(group=0, index=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `group` | int | `0` | Test group selector passed to the core. |
| `index` | int | `0` | Test index within the group. |

## Behaviour
The command simply forwards `group` and `index` to `_cmd.test`; what that does
depends entirely on whatever development code the C core currently exposes. The
docstring labels it (misleadingly, as `"dump"`) an unsupported internal command;
its output and side effects are not part of the public API and may change or do
nothing.

## Examples
```python
cmd.test(0, 0)   # invoke whatever core test entry 0/0 maps to
```

## Related
- [dump](../commands/dump.md)

## Source
`packages/engine/modules/pymol/experimenting.py:193`. Parity: internal — a
development-only routine; no faithful port exists in `packages/engine-ts/src`.
