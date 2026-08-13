---
name: centerofmass
kind: command
category: querying
subcategory: center of mass
summary: Computes the mass- and occupancy-weighted center of mass of a selection.
parity: implemented
---

## Purpose
`centerofmass` returns the center of mass of a selection, weighted by atomic
mass and occupancy. Reach for it to find a coordinate for placing a
pseudoatom, an origin, or a measurement reference.

## Syntax
`centerofmass(selection='(all)', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'(all)'` | Atom selection. |
| `state` | integer | `-1` | `-1`=current state, `0`=all states, `>0`=specific state. |
| `quiet` | int | `1` | `0` prints the resulting coordinate. |

## Behaviour
For `state < 0` the current state of the selection is resolved; for `state == 0`
it iterates over every state (1..count_states) accumulating a combined center of
mass. Each atom contributes `mass * occupancy`, where an occupancy of 0.0 is
treated as 1.0 (assumes a file lacked occupancy data). If the total mass is zero
it raises `CmdException('mass is zero')`. Returns the center of mass as a
3-element list `[x, y, z]`; with `quiet=0` it also prints it.

## Examples
```
centerofmass
com = cmd.centerofmass("chain A")
centerofmass polymer, state=0
```

## Related
- [get_extent](../commands/get_extent.md)
- [pseudoatom](../commands/pseudoatom.md)

## Source
`packages/engine/modules/pymol/querying.py:1534`. Ported in
`packages/engine-ts/src/cmd/misc.ts` (`centerofmass`).
