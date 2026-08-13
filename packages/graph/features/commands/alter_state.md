---
name: alter_state
kind: command
category: editing-building
subcategory: coordinate editing
summary: Changes per-atom coordinates and flags in a given state by evaluating an expression per atom.
parity: implemented
---

## Purpose
`alter_state` edits atom coordinates (and coordinate-associated flags) for a specific state and selection, running a Python expression in a temporary namespace for each atomic coordinate. It is the coordinate-editing sibling of `alter` — use it to translate, distort, or recompute positions programmatically.

## Syntax
`alter_state(state, selection, expression, quiet=1, space=None, atomic=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `state` | int | — | State to modify (1-based; converted to 0-based internally) |
| `selection` | selection | — | Atoms whose coordinates are altered |
| `expression` | str | — | Python statement evaluated per atomic coordinate |
| `quiet` | 0/1 | `1` | Suppress feedback |
| `space` | dict | `None` | Namespace made available to the expression |
| `atomic` | 0/1 | `1` | Expose atomic property symbols (read-only) in the expression |

## Behaviour
The expression can read/write `x, y, z` and, with `atomic=1`, most of the `alter` symbols on a read-only basis. The selection is preprocessed with `selector.process` and the state is decremented to zero-based before the `_cmd.alter_state` call (run under the API lock). Coordinate changes usually require a `rebuild` before representations reflect them.

## Examples
```python
alter_state 1, all, x=x+5
rebuild
```

## Related
- [alter](./alter.md)
- [iterate_state](../commands/iterate_state.md)
- [translate](../commands/translate.md)

## Source
`packages/engine/modules/pymol/editing.py:1821`. Parity: implemented in `packages/engine-ts/src/cmd/editing.ts` (expression compiled to a JS per-atom function).
