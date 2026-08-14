---
name: rms
kind: command
category: fitting-alignment
subcategory: rms superposition
summary: Computes the RMS fit between two atom selections without transforming the models.
parity: implemented
---

## Purpose
`rms` calculates the root-mean-square deviation of the optimal superposition between a mobile and a target selection, but — unlike [fit](../commands/fit.md) — does not actually move the coordinates. Use it to measure how well two selections would align, or to score conformational differences, without disturbing the scene.

## Syntax
`rms(mobile, target, mobile_state=0, target_state=0, quiet=1, matchmaker=0, cutoff=2.0, cycles=0, object=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | string | — | selection to be (virtually) fitted |
| `target` | string | — | reference selection |
| `mobile_state` | int | `0` | state of the mobile selection (0 = current) |
| `target_state` | int | `0` | state of the target selection (0 = current) |
| `quiet` | int | `1` | suppress console feedback |
| `matchmaker` | int | `0` | atom-pairing mode (0 = pair by matching identifiers) |
| `cutoff` | float | `2.0` | outlier rejection cutoff (Angstroms) when refining |
| `cycles` | int | `0` | refinement cycles rejecting outliers |
| `object` | string | `None` | optional name for a CGO object storing the alignment |

## Behaviour
With `matchmaker=0` the two selections are intersected atom-for-atom (`(mobile) in (target)` and vice versa) so only correspondingly identified atoms are compared. States are converted from 1-based to 0-based before the C `fit` call, which runs with the "fit" flag set to 1 (compute the optimal rotation) but the models are left untransformed. `cycles`>0 performs iterative outlier rejection using `cutoff`. Returns the RMS value; a negative return raises `CmdException`.

## Examples
```python
rms (mutant and name CA), (wildtype and name CA)
rms molA, molB, cycles=5, cutoff=2.0
```

## Related
- [fit](../commands/fit.md)
- [rms_cur](../commands/rms_cur.md)
- [intra_fit](../commands/intra_fit.md)
- [pair_fit](../commands/pair_fit.md)

## Source
`packages/engine/modules/pymol/fitting.py:686`; signature in `docs/api-reference/commands.mdx:3281`. Parity: implemented in `packages/engine-ts/src/cmd/align.ts:478`.
