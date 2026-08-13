---
name: pbc_wrap
kind: command
category: symmetry
subcategory: periodic boundaries
summary: Wraps molecules back into the periodic-boundary (PBC) box.
parity: partial
---

## Purpose
`pbc_wrap` folds atoms that have drifted outside the periodic unit cell back into
the primary box, optionally recentering the box on a chosen point. Use it to
produce a compact, box-centered view of a solvated MD system.

## Syntax
```
pbc_wrap(oname, center=None)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `oname` | str | | object name to wrap |
| `center` | list/None | `None` | `[x,y,z]` box center in model space; None = average of the first coordinate state |

## Behaviour
If `center` is a string it is parsed with `safe_list_eval`; if `None` the
average position of the first coordinate state is used as the box center. The C
layer (`_cmd.pbc_wrap`) then translates each molecule by whole box vectors so its
representative point lies inside the cell. Requires valid unit-cell/symmetry
metadata on the object. Inverse of [pbc_unwrap](pbc_unwrap.md).

## Examples
```
pbc_wrap trajectory
pbc_wrap trajectory, center=[0, 0, 0]
```

## Related
- [pbc_unwrap](pbc_unwrap.md) - undo boundary jumps in a trajectory

## Source
`packages/engine/modules/pymol/editing.py:328`. Present as a no-op stub in the TS
port (`packages/engine-ts/src/cmd/extras.ts:558`), so parity is partial.
