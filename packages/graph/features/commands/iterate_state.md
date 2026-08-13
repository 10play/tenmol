---
name: iterate_state
kind: command
category: querying
subcategory: atom iteration
summary: Evaluate a read-only Python expression per atom for a specific coordinate state, exposing x/y/z.
parity: implemented
---

## Purpose
Like [iterate](iterate.md) but scoped to one coordinate state, so per-atom coordinates (`x, y, z`)
are in scope. Use it to read or accumulate geometry from a particular state without altering it —
the read-only counterpart of `alter_state`.

## Syntax
`iterate_state(state, selection, expression, quiet=1, space=None, atomic=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `state` | int | — | coordinate state to iterate (1-based) |
| `selection` | string | — | atoms to iterate over |
| `expression` | string | — | Python expression run per atom |
| `quiet` | int | `1` | suppress feedback |
| `space` | dict | `None` | namespace for evaluation |
| `atomic` | int | `1` | expose atomic identifier symbols in addition to coordinates |

## Behaviour
In addition to the identifier symbols from `iterate`, `x`, `y`, `z` are available for the given
state. Assignments are discarded (read-only); the call goes through `_cmd.alter_state` with the
read-only flag and `state-1` (0-based conversion). Side effects on `space`/`stored` persist. The
selection is preprocessed before dispatch.

## Examples
```python
stored.sum_x = 0.0
iterate_state 1, all, stored.sum_x = stored.sum_x + x
print(stored.sum_x)
```

## Related
[iterate](iterate.md), alter_state, alter

## Source
`packages/engine/modules/pymol/editing.py:1864`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/analysis.ts:306`).
