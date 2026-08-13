---
name: rms_cur
kind: command
category: fitting-alignment
subcategory: rms measurement
summary: Computes the RMS difference between two atom selections as-is, with no fitting.
parity: implemented
---

## Purpose
`rms_cur` measures the raw root-mean-square difference between two atom selections in their current positions, performing no superposition. Use it to quantify how far apart two already-aligned (or same-frame) structures are, for example to track drift across states or after an operation.

## Syntax
`rms_cur(mobile, target, mobile_state=0, target_state=0, quiet=1, matchmaker=0, cutoff=2.0, cycles=0, object=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | string | — | first selection |
| `target` | string | — | second selection |
| `mobile_state` | int | `0` | state of the mobile selection (0 = current) |
| `target_state` | int | `0` | state of the target selection (0 = current) |
| `quiet` | int | `1` | suppress console feedback |
| `matchmaker` | int | `0` | atom-pairing mode (0 = pair by matching identifiers) |
| `cutoff` | float | `2.0` | outlier rejection cutoff (Angstroms) |
| `cycles` | int | `0` | outlier-rejection cycles |
| `object` | string | `None` | optional name for a CGO alignment object |

## Behaviour
Identical selection handling and matchmaker logic to [rms](../commands/rms.md), but the underlying C `fit` call is invoked with the fit flag set to 0 — no optimal rotation is computed and no coordinates move. The returned value is therefore the deviation between the selections exactly where they sit. A negative return raises `CmdException`.

## Examples
```python
rms_cur (state1 and name CA), (state2 and name CA)
rms_cur molA, molB
```

## Related
- [rms](../commands/rms.md)
- [fit](../commands/fit.md)
- [intra_rms_cur](../commands/intra_rms_cur.md)
- [pair_fit](../commands/pair_fit.md)

## Source
`packages/engine/modules/pymol/fitting.py:732`; signature in `docs/api-reference/commands.mdx:3299`. Parity: implemented in `packages/engine-ts/src/cmd/align.ts:475`.
