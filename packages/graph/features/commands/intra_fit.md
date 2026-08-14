---
name: intra_fit
kind: command
category: fitting-alignment
subcategory: multi-state fit
summary: Superimposes all states of an object onto one target state over an atom selection.
parity: implemented
---

## Purpose
`intra_fit` fits every state of a multi-state object onto a chosen target state, using a common atom selection. Reach for it to remove global drift/tumbling from an NMR ensemble or MD trajectory before analysis. It returns the per-state RMS values as a Python array and moves the coordinates.

## Syntax
`intra_fit(selection, state=1, quiet=1, mix=0, pbc=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | — | Atoms to fit (must match across states) |
| `state` | int | `1` | Target state to fit all others onto |
| `quiet` | 0/1 | `1` | Suppress per-state RMS printout |
| `mix` | int | `0` | If set, fit against a mixed/running target rather than one fixed state |
| `pbc` | 0/1 | `1` | Consider periodic boundary conditions |

## Behaviour
Selection is processed, then delegates to `_cmd.intrafit` with mode `2` (fit) and zero-based `state-1`. Returns a list of RMS values, one per state (negative entries flag states that could not be fit). With `quiet=0` each state's RMS is printed, worded "vs mixed target" when `mix` is set, else "vs state N". Unlike `intra_rms`, coordinates are modified in place.

## Examples
```python
intra_fit name CA
rms = cmd.intra_fit("(name CA)", 1)
```

## Related
- [intra_rms](./intra_rms.md)
- [intra_rms_cur](./intra_rms_cur.md)
- [fit](../commands/fit.md)
- [pair_fit](../commands/pair_fit.md)

## Source
`packages/engine/modules/pymol/fitting.py:462`. Parity: implemented in `packages/engine-ts/src/cmd/align.ts`.
