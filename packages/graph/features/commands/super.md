---
name: super
kind: command
category: fitting-alignment
subcategory: structural superposition
summary: Performs a residue-based, sequence-independent structural superposition with iterative outlier refinement.
parity: implemented
---

## Purpose
`super` aligns two structures by structure rather than sequence, then superposes
and refines by rejecting outliers. It is the tool of choice when sequence
identity is too low for `align` to work well — it uses main-chain path,
secondary/tertiary structure and coordinates to build the initial correspondence.

## Syntax
`super(mobile, target, cutoff=2.0, cycles=5, gap=-1.5, extend=-0.7, max_gap=50, object=None, matrix='BLOSUM62', mobile_state=0, target_state=0, quiet=1, max_skip=0, transform=1, reset=0, seq=0.0, radius=12.0, scale=17.0, base=0.65, coord=0.0, expect=6.0, window=3, ante=-1.0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | string | — | Mobile atom selection (moved onto target). |
| `target` | string | — | Target atom selection (held fixed). |
| `cutoff` | float | `2.0` | RMS outlier-rejection cutoff (Å) during refinement. |
| `cycles` | int | `5` | Refinement cycles. |
| `gap` | float | `-1.5` | Gap-opening penalty. |
| `extend` | float | `-0.7` | Gap-extension penalty. |
| `max_gap` | int | `50` | Maximum gap length. |
| `object` | string | `None` | Name of an alignment object to create. |
| `matrix` | string | `'BLOSUM62'` | Substitution matrix file, or `none`/`''` to disable sequence weighting. |
| `mobile_state` | int | `0` | Mobile state (0 = current). |
| `target_state` | int | `0` | Target state (0 = current). |
| `quiet` | int | `1` | Suppress feedback when set. |
| `max_skip` | int | `0` | Max residues skipped in the dynamic-programming path. |
| `transform` | int | `1` | If 0, compute but do not move the mobile object. |
| `reset` | int | `0` | Reset an existing alignment object. |
| `seq`, `radius`, `scale`, `base`, `coord`, `expect`, `window`, `ante` | float/int | see signature | Weights controlling the balance of sequence, main-chain path, structure and coordinate terms in the initial alignment. |

## Behaviour
`super` shares the C `align` engine with [align](../commands/align.md) but exposes
the structure-weighting knobs (`seq`, `radius`, `scale`, `base`, `coord`, `expect`,
`window`, `ante`) and uses different default gap penalties. The `matrix` string is
resolved to a file under `$PYMOL_DATA/pymol/matrices/`; `none`/empty disables the
sequence term. State arguments are 1-based at the API and decremented internally.
It returns the alignment result (RMS and atom counts). For very low sequence
identity, `cealign` may still perform better.

## Examples
```
super protA////CA, protB////CA, object=supeAB
super mobile, target, transform=0
```

## Related
- [align](../commands/align.md)
- [pair_fit](../commands/pair_fit.md)
- [fit](../commands/fit.md)
- [rms_cur](../commands/rms_cur.md)

## Source
`packages/engine/modules/pymol/fitting.py:308`. Parity: implemented — a
structure-based superposition is registered in
`packages/engine-ts/src/cmd/align.ts:539` (simplified guide-atom pairing).
