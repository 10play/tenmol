---
name: intra_rms
kind: command
category: fitting-alignment
subcategory: multi-state fit
summary: Computes best-fit RMS values of all states against one state, leaving coordinates unchanged.
parity: implemented
---

## Purpose
`intra_rms` reports, for each state of an object, the RMS after a best-fit superposition onto a reference state — but without moving any atoms. Use it to measure ensemble spread while keeping the coordinates intact.

## Syntax
`intra_rms(selection, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | — | Atoms to compare |
| `state` | int | `0` | Reference state |
| `quiet` | 0/1 | `1` | Suppress per-state RMS printout |

## Behaviour
Selection is processed, then delegates to `_cmd.intrafit` with mode `1` (fit-and-measure, discard the fit) and zero-based `state-1`. Returns a Python list of RMS values, one per state; negative entries mark states that could not be compared. Differs from `intra_fit` in that coordinates are left unchanged, and from `intra_rms_cur` in that it does apply an optimal fit before measuring.

## Examples
```python
rms = cmd.intra_rms("(name CA)", 1)
print(rms)
```

## Related
- [intra_fit](./intra_fit.md)
- [intra_rms_cur](./intra_rms_cur.md)
- [rms](../commands/rms.md)

## Source
`packages/engine/modules/pymol/fitting.py:522`. Parity: implemented in `packages/engine-ts/src/cmd/align.ts`.
