---
name: h_fix
kind: command
category: editing-building
subcategory: hydrogens
summary: Unsupported command that repositions hydrogen atoms on a selection.
parity: implemented
---

## Purpose
`h_fix` is an unsupported utility that appears to reposition existing hydrogen atoms on a selection. The upstream docstring explicitly marks it unsupported, so treat its behaviour as best-effort.

## Syntax
`h_fix(selection='', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `''` | Atoms whose hydrogens to fix |
| `quiet` | 0/1 | `1` | Suppress feedback when `1` |

## Behaviour
Selection is passed through `selector.process`, then delegates to `_cmd.h_fix`. Documented upstream only as "may have something to do with repositioning hydrogen atoms" — undocumented and unsupported. Prefer `h_add`/`h_fill` for well-defined hydrogen operations.

## Examples
```python
h_fix resn LIG
```

## Related
- [h_add](./h_add.md)
- [h_fill](./h_fill.md)

## Source
`packages/engine/modules/pymol/editing.py:1197`. Parity: implemented in `packages/engine-ts/src/cmd/extras.ts`.
