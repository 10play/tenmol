---
name: spheroid
kind: command
category: movies-scenes-states
subcategory: trajectory averaging
summary: Averages trajectory frames to build an ellipsoid-like approximation of an atom's anisotropic motion.
parity: partial
---

## Purpose
`spheroid` collapses a series of trajectory states into ellipsoid-like
"spheroid" representations that approximate the anisotropic motion each atom
exhibits over the frames. It is an experimental analysis tool for visualising
mobility from a molecular dynamics trajectory.

## Syntax
`spheroid(object='', average=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | string | `''` | Object to process. |
| `average` | int | `0` | Number of states to average for each resulting spheroid state. |

## Behaviour
The command is flagged **experimental, incomplete, and unstable** upstream and
prints a warning to that effect before running. `average` controls how many
consecutive states are combined per output spheroid state; `0` uses the default
grouping. The heavy lifting is delegated to the C core (`_cmd.spheroid`).

## Examples
```
load traj.dcd, mol
spheroid mol, 5
```

## Related
- [split_states](../commands/split_states.md)
- [set](../commands/set.md)

## Source
`packages/engine/modules/pymol/experimenting.py:35`. Parity: partial — registered
as a no-op stub in `packages/engine-ts/src/cmd/extras.ts:539` (no observable
state produced).
