---
name: dist
kind: command
category: measurement
subcategory: distance measurement
summary: Alias for `distance` — creates a distance-measurement object between two selections.
parity: implemented
---

## Purpose
`dist` is a direct alias of [`distance`](./distance.md) (defined as `dist = distance` in the engine). Use it as the terse form to create a measurement object, most commonly `dist` alone to measure between the picked atoms `(pk1)` and `(pk2)`.

## Syntax
`dist(name=None, selection1='(pk1)', selection2='(pk2)', cutoff=None, mode=None, zoom=0, width=None, length=None, gap=None, label=1, quiet=1, reset=0, state=0, state1=-3, state2=-3)`

The parameter table is identical to [`distance`](./distance.md) — see that page for `mode` semantics (0 = all interatomic distances … 8 = VDW-radii ratio), the argument-shift heuristic, and `state`/`state1`/`state2` cross-state measurement.

## Behaviour
Because `dist` is literally the same function object as `distance`, behaviour, defaults and edge cases are identical. `dist` alone shows distances between the `(pk1)`/`(pk2)` picks set via the PkAt mouse action (usually Ctrl-middle-click). The distance wizard is preferred for real-time interactive measuring.

## Examples
```python
dist                       # distance between picked atoms (pk1)-(pk2)
dist hb, all, all, 3.2, 2  # polar contacts within 3.2 A
```

## Related
- [distance](./distance.md)
- [dihedral](./dihedral.md)

## Source
`packages/engine/modules/pymol/querying.py:523` (`dist = distance`, defn at `:380`). Parity: implemented in `packages/engine-ts/src/cmd/topics.ts:140` (dispatches to `distance`).
