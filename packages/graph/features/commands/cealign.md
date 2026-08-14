---
name: cealign
kind: command
category: fitting-alignment
subcategory: structure alignment
summary: Aligns two proteins using the sequence-independent CE algorithm.
parity: implemented
---

## Purpose
`cealign` performs a sequence-independent structural alignment of two proteins
using the Combinatorial Extension (CE) algorithm. Reach for it when the two
structures have low sequence identity, where residue-name-based alignment
(`align`/`super`) would struggle.

## Syntax
`cealign(target, mobile, target_state=1, mobile_state=1, quiet=1, guide=1, d0=3.0, d1=4.0, window=8, gap_max=30, transform=1, object=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `target` | str | — | Fixed reference selection. |
| `mobile` | str | — | Selection to be moved onto the target. |
| `target_state` | int | `1` | State of the target. |
| `mobile_state` | int | `1` | State of the mobile object. |
| `quiet` | int | `1` | `0` prints RMSD; `-1` also prints the rotation matrix. |
| `guide` | int | `1` | If set, align using only alpha carbons; else all atoms. |
| `d0` | float | `3.0` | CE distance parameter. |
| `d1` | float | `4.0` | CE distance parameter. |
| `window` | int | `8` | CE fragment window size (must be > 2). |
| `gap_max` | int | `30` | Maximum gap size (must be >= 0). |
| `transform` | int | `1` | If set, apply the transform to the mobile object. |
| `object` | str/None | `None` | If given, create an alignment object of this name. |

## Behaviour
When `guide` is set (default) the selections are restricted to `and guide`
(alpha carbons). Coordinates and atom ids are gathered with `get_model`; each
selection must contain at least `2 * window` atoms or an error is raised. The C
routine `_cmd.cealign` returns alignment length, RMSD, a TTT rotation matrix,
and index correspondences. If `transform` is set the matrix is applied to every
object in the mobile selection via `transform_object`. If `object` is given (and
each side spans a single object) an alignment object is created. `quiet=-1`
pretty-prints the rotation matrix; `quiet=0` prints the RMSD and residue count.

## Examples
```
cealign protA////CA, protB////CA
fetch 1rlw 1rsy, async=0
cealign 1rlw, 1rsy
```

## Related
- [align](../commands/align.md)
- [super](../commands/super.md)
- [pair_fit](../commands/pair_fit.md)

## Source
`packages/engine/modules/pymol/fitting.py:27`. Ported in
`packages/engine-ts/src/cmd/extras.ts` (`cealign`).
