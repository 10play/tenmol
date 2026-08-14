---
name: minimize
kind: command
category: sculpting-minimization
subcategory: energy minimization
summary: Placeholder/unsupported energy-minimization command wrapping the TINKER realtime backend.
parity: implemented
---

## Purpose
`minimize` (internally "fast_minimize") is described upstream as an unsupported,
nonfunctional command that may eventually drive energy minimization. It attempts
to hand a selection to the `chempy.tinker.realtime` backend for iterative
optimization.

## Syntax
```
minimize(sele='', iter=500, grad=0.01, interval=50, _setup=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sele` | str | `''` | atoms to minimize; defaults to the first object if empty |
| `iter` | int | `500` | number of minimization iterations |
| `grad` | float | `0.01` | gradient/convergence tolerance |
| `interval` | int | `50` | update interval (iterations between refreshes) |
| `_setup` | int | `1` | run realtime setup before minimizing |

## Behaviour
If `sele` is empty it falls back to the first object in the scene. It wraps the
selection in parentheses, then, unless `_setup` is falsy or `realtime.setup`
succeeds, runs `realtime.mini` asynchronously with the given iteration count,
gradient and interval. If setup parameters are missing it prints
`minimize: missing parameters, can't continue`. Upstream flags this as
nonfunctional; it depends on a TINKER backend that is generally unavailable.

## Examples
```
minimize myobj
minimize polymer, iter=1000, grad=0.005
```

## Related
- [morph](morph.md) - uses sculpting refinement between conformations

## Source
`packages/engine/modules/pymol/experimenting.py:108`. Registered in the TS port
at `packages/engine-ts/src/cmd/sculpt.ts:393`.
