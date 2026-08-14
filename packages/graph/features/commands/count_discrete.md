---
name: count_discrete
kind: command
category: querying
subcategory: object count
summary: Counts the number of discrete objects spanned by a selection.
parity: implemented
---

## Purpose
`count_discrete` reports how many discrete objects (objects loaded/created with the `discrete` flag, where each state can have a different atom set) are represented within a selection. Use it when reasoning about discrete-vs-non-discrete object handling.

## Syntax
`count_discrete(selection, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | Atom selection to inspect |
| `quiet` | int | `1` | Suppress the "count_discrete: N" print when `1` |

## Behaviour
Locks the session, calls the C-layer `count_discrete`, and returns the integer count. With `quiet=0` it prints the value. A non-discrete object contributes 0 to the discrete count.

## Examples
```python
count_discrete all
count_discrete ligands, quiet=0
```

## Related
- [count_atoms](../commands/count_atoms.md)
- [create](../commands/create.md)

## Source
`packages/engine/modules/pymol/querying.py:1443` (`def count_discrete`). Ported: `packages/engine-ts/src/cmd/xform.ts:229` (`ctx.command('count_discrete', ...)`).
