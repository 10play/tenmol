---
name: morph
kind: command
category: movies-scenes-states
subcategory: trajectory interpolation
summary: Builds a multi-state interpolated trajectory between two (or more) conformations.
parity: partial
---

## Purpose
`morph` creates an interpolated trajectory object connecting two conformations,
matching them by sequence alignment when the inputs differ. It is the standard
way to visualize a conformational change between, e.g., open and closed states.

## Syntax
```
morph(name, sele1, sele2=None, state1=-1, state2=-1, refinement=3,
      steps=30, method='rigimol', match='align', quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | | name of the object to create |
| `sele1` | str | | atom selection of the first conformation |
| `sele2` | str | `None` | second conformation; defaults to `sele1` |
| `state1` | int | `-1` | `sele1` state (default 1); `state1=0` morphs across all N states |
| `state2` | int | `-1` | `sele2` state (default 2 if `sele1==sele2`, else 1) |
| `refinement` | int | `3` | sculpting refinement cycles to clean distorted intermediates |
| `steps` | int | `30` | number of interpolated states to generate |
| `method` | str | `'rigimol'` | `rigimol` or `linear` |
| `match` | str | `'align'` | how to correspond atoms between selections |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Two methods exist. **RigiMOL** is an incentive-only feature available to
official PyMOL sponsors - in this open engine `morph` raises
`IncentiveOnlyException` for that path. **Linear** morphing is quick and robust
but produces distorted intermediates, cleaned up by `refinement` sculpting
cycles. If `sele1` has N states and `state1=0`, morphs are chained across all
consecutive states (and back to state 1), producing up to N*`steps` states.

## Examples
```
fetch 1akeA 4akeA, async=0
align 1akeA, 4akeA
morph mout, 1akeA, 4akeA
morph mout, 1akeA, 4akeA, method=linear
```

## Related
- [minimize](minimize.md) - shares the sculpting refinement machinery
- [mset](mset.md), [mplay](mplay.md) - play the resulting trajectory

## Source
`packages/engine/modules/pymol/morphing.py:12` (raises `IncentiveOnlyException`
for rigimol). The TS port implements a linear-interpolation morph at
`packages/engine-ts/src/cmd/movie2.ts:374`, without sequence-alignment matching
or sculpting refinement.
