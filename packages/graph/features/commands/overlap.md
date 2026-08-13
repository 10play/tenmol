---
name: overlap
kind: command
category: measurement
subcategory: steric overlap
summary: Sums pairwise VDW-minus-distance overlap between two atom selections.
parity: implemented
---

## Purpose
`overlap` is an unsupported, quick-and-dirty steric-clash metric. For each pair
of atoms across two selections it sums `[(VDWi + VDWj) - distance_ij] / 2`,
giving a scalar that grows with interpenetration. Reach for it as a rough clash
score, not a rigorous volume-overlap measure.

## Syntax
```
overlap(selection1, selection2, state1=1, state2=1, adjust=0.0, quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection1` | str | | first atom selection |
| `selection2` | str | | second atom selection |
| `state1` | int | `1` | coordinate state of selection1 |
| `state2` | int | `1` | coordinate state of selection2 |
| `adjust` | float | `0.0` | value added to the per-pair overlap term |
| `quiet` | int | `1` | if 0, prints the summed overlap in Angstroms |

## Behaviour
Both selections are preprocessed and states converted to 0-based before calling
`_cmd.overlap`. The result is a sum, not a normalized quantity, so selections
with more atoms yield larger values — it does not compute true volume overlap.
`adjust` shifts each pair's contribution. This is explicitly documented upstream
as an unsupported command.

## Examples
```
overlap lig, protein
overlap lig, protein, quiet=0
```

## Related
- `distance`, `get_area` - other geometric measurements

## Source
`packages/engine/modules/pymol/querying.py:783`. Registered in the TS port at
`packages/engine-ts/src/cmd/extras.ts:394`.
