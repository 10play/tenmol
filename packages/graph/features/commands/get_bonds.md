---
name: get_bonds
kind: command
category: querying
subcategory: bond query
summary: Returns a list of (atm1, atm2, order) tuples for bonds in the given state.
parity: implemented
---

## Purpose
`get_bonds` returns the bonds present in a selection as `(atm1, atm2, order)` tuples, using the same coordinate/state logic as `cmd.get_model()`. Reach for it to enumerate connectivity programmatically.

## Syntax
`get_bonds(selection='(all)', state=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | Atom selection |
| `state` | int | `-1` | Coordinate state; `-1` = current |

## Behaviour
**WARNING: `atm1`/`atm2` are 0-based indices** that enumerate the atoms *within the selection* — they do **not** correspond to the `index` atom property. To recover a mapping to real atom indices, collect them in parallel:

```python
stored.indices = []
cmd.iterate_state(state, selection, "stored.indices.append(index)")
```

Dispatches to `_cmd.get_bonds` with a zero-based `state-1`. `order` is the bond order (1 single, 2 double, etc.). Same selection/state semantics as `get_model().bond`.

## Examples
```python
bonds = cmd.get_bonds("resi 1-5")
for a1, a2, order in cmd.get_bonds("ligand"):
    print(a1, a2, order)
```

## Related
- [get_model](../commands/get_model.md)
- [get_bond](../commands/get_bond.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:1078`. Parity: implemented — registered as `ctx.command('get_bonds')` in `packages/engine-ts/src/cmd/misc.ts:270`.
