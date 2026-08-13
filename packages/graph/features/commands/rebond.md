---
name: rebond
kind: command
category: editing-building
subcategory: bonding
summary: Discard all bonds in an object and recompute them by inter-atomic distance.
parity: implemented
---

## Purpose
`rebond` throws away an object's existing bonds and rebuilds connectivity from
scratch using distance-based bonding. Reach for it after loading coordinate-only
data, editing atom positions, or when connectivity is wrong or missing.

## Syntax
`rebond(oname, state=-1, pbc=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `oname` | str | | object name |
| `state` | int | `-1` | object state (-1 = current state) |
| `pbc` | 0/1 | `1` | use periodic boundary conditions (only if symmetry is defined) |

## Behaviour
Removes every bond in the named object, then infers new bonds from inter-atomic
distances in the chosen `state`. When the object has crystal symmetry defined and
`pbc=1`, bonds may form across periodic images. `pbc` is keyword-only in the
Python signature.

## Examples
```
rebond myprotein
rebond crystal, pbc=0
```

## Related
- [bond](../commands/bond.md)
- [unbond](../commands/unbond.md)

## Source
`packages/engine/modules/pymol/editing.py` (`def rebond`). Parity: implemented in
`packages/engine-ts/src/cmd/builder.ts:775`.
