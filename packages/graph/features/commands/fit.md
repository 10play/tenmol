---
name: fit
kind: command
category: fitting-alignment
subcategory: superposition
summary: Superimposes one selection onto another using only atoms that match by identifier, with optional outlier-rejection refinement.
parity: implemented
---

## Purpose
`fit` superimposes the mobile selection onto the target selection, using only atoms that appear in both. Because it matches atoms by their full identifiers, it is meant for comparing very similar structures where atom naming is consistent.

## Syntax
`fit(mobile, target, mobile_state=0, target_state=0, quiet=1, matchmaker=0, cutoff=2.0, cycles=0, object=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | str | | atom selection to move |
| `target` | str | | reference atom selection |
| `mobile_state` | int | `0` | mobile object state (0 = all states) |
| `target_state` | int | `0` | target object state (0 = all states) |
| `quiet` | int | `1` | suppress feedback |
| `matchmaker` | int | `0` | how to match atom pairs (see below) |
| `cutoff` | float | `2.0` | outlier rejection cutoff (only if cycles>0) |
| `cycles` | int | `0` | number of outlier-rejection refinement cycles |
| `object` | str | `None` | name of alignment object to create |

## Behaviour
`matchmaker` selects the pairing strategy: `-1` assume identical atom order; `0/1` match on all identifiers (segi, chain, resn, resi, name, alt); `2` match by ID; `3` match by rank; `4` match by index. With `cycles>0`, iterative outlier rejection removes pairs beyond `cutoff` (Angstrom) before refitting. Because pairing uses full identifiers (including segi and chain), `fit` only works between very similar structures; for sequence-level differences use `align` or `super`. Returns the RMS over the fitted atoms.

## Examples
```python
fit protA, protB
fit mob and name CA, ref and name CA, cycles=5
fit molA, molB, object=fitaln
```

## Related
- [align](align.md), [super](super.md) - sequence/structure-tolerant superposition
- [pair_fit](pair_fit.md), [rms](rms.md), [rms_cur](rms_cur.md), [intra_fit](intra_fit.md)

## Source
`packages/engine/modules/pymol/fitting.py` (`def fit`). Parity: implemented in `packages/engine-ts/src/cmd/align.ts:487`.
