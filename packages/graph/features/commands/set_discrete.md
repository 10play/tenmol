---
name: set_discrete
kind: command
category: objects-groups
subcategory: multi-state objects
summary: Converts a molecular object between discrete and non-discrete (shared-topology) multi-state storage.
parity: implemented
---

## Purpose
`set_discrete` flips a multi-state object between "discrete" storage — where each state may have a different set of atoms and its own topology — and "non-discrete" storage, where all states share one atom/bond topology and differ only in coordinates. Reach for it when a trajectory-style object needs per-state atoms, or when you want to collapse a discrete object back to shared topology.

## Syntax
`set_discrete(name, discrete=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | object to convert |
| `discrete` | int | `1` | `1` = make discrete, `0` = make non-discrete |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
Discrete objects use more memory because atom records are not shared across states, but they permit each state to have distinct atoms — necessary for ensembles of different molecules loaded as states. Converting non-discrete → discrete is generally safe; the reverse only makes sense when the states already share a consistent topology.

## Examples
```python
load ensemble.pdb, ens
set_discrete ens, 1
```

## Related
- [split_states](split_states.md) — separate states into individual objects
- [create](create.md) — build multi-state objects

## Source
Upstream: `packages/engine/modules/pymol/editing.py:370` (delegates to `_cmd.set_discrete`). Parity: implemented at `packages/engine-ts/src/cmd/xform.ts:216`.
