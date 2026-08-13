---
name: intra_rms_cur
kind: command
category: fitting-alignment
subcategory: multi-state fit
summary: Computes RMS values of all states against one state with no fitting applied.
parity: implemented
---

## Purpose
`intra_rms_cur` reports the RMS of each state relative to a reference state using the atoms as they currently sit — no superposition is performed. Use it to measure how much states differ in their current frame (e.g. after your own alignment).

## Syntax
`intra_rms_cur(selection, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | — | Atoms to compare |
| `state` | int | `0` | Reference state |
| `quiet` | 0/1 | `1` | Suppress per-state RMS printout |

## Behaviour
Selection is processed, then delegates to `_cmd.intrafit` with mode `0` (measure only, no fit) and zero-based `state-1`. Returns a Python list of per-state RMS values; negative entries flag states that could not be measured. This is the "current coordinates" analogue of `rms_cur`: unlike `intra_rms` it does not optimally superpose before measuring.

## Examples
```python
rms = cmd.intra_rms_cur("(name CA)", 1)
```

## Related
- [intra_rms](./intra_rms.md)
- [intra_fit](./intra_fit.md)
- [rms_cur](../commands/rms_cur.md)

## Source
`packages/engine/modules/pymol/fitting.py:566`. Parity: implemented in `packages/engine-ts/src/cmd/extras.ts`.
