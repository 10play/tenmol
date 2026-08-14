---
name: fix_chemistry
kind: command
category: editing-building
subcategory: chemistry repair
summary: Unsupported feature intended to reconcile bond orders and chemistry between two selections.
parity: partial
---

## Purpose
`fix_chemistry` is documented upstream simply as "an unsupported feature." It is meant to reconcile/repair perceived chemistry (bond orders, valence) across the given selections, but PyMOL provides no guarantees about its behaviour.

## Syntax
`fix_chemistry(selection1='all', selection2='all', invalidate=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection1` | str | `'all'` | first atom selection |
| `selection2` | str | `'all'` | second atom selection |
| `invalidate` | int | `1` | invalidate affected representations afterward |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Because it is unsupported, results are not guaranteed and it may be a no-op on some builds. The TypeScript port currently registers it as a stub that returns 0 without modifying the model, so treat its parity as partial.

## Examples
```python
fix_chemistry sele1, sele2
fix_chemistry all, all, invalidate=0
```

## Related
- [fast_minimize](fast_minimize.md) - another unsupported placeholder

## Source
`packages/engine/modules/pymol/editing.py` (`def fix_chemistry`). Parity: partial - stub returning 0 in `packages/engine-ts/src/cmd/builder.ts:795`.
