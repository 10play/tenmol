---
name: align
kind: command
category: fitting-alignment
subcategory: sequence + structure superposition
summary: Sequence-aligns then structurally superposes a mobile selection onto a target, with iterative outlier rejection.
parity: implemented
---

## Purpose
`align` performs a sequence alignment followed by a structural superposition, then runs zero or more refinement cycles that reject structural outliers. It works well for proteins with decent sequence similarity (identity > 30%); for lower identity prefer `super` or `cealign`.

## Syntax
`align(mobile, target, cutoff=2.0, cycles=5, gap=-10.0, extend=-0.5, max_gap=50, object=None, matrix='BLOSUM62', mobile_state=0, target_state=0, quiet=1, max_skip=0, transform=1, reset=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | selection | — | Atom selection of the mobile object |
| `target` | selection | — | Atom selection of the target object |
| `cutoff` | float | `2.0` | Outlier rejection cutoff in Angstroms |
| `cycles` | int | `5` | Max number of outlier-rejection cycles |
| `gap` | float | `-10.0` | Sequence-alignment gap-open penalty |
| `extend` | float | `-0.5` | Sequence-alignment gap-extend penalty |
| `max_gap` | int | `50` | Max gap length in the alignment |
| `object` | str | `None` | Name of alignment object to create |
| `matrix` | str | `'BLOSUM62'` | Substitution matrix file for sequence alignment |
| `mobile_state` | int | `0` | Mobile object state (0 = all states) |
| `target_state` | int | `0` | Target object state (0 = all states) |
| `quiet` | 0/1 | `1` | Suppress feedback |
| `max_skip` | int | `0` | Max residues to skip |
| `transform` | 0/1 | `1` | Apply the superposition transform |
| `reset` | 0/1 | `0` | Reset/replace an existing alignment object |

## Behaviour
Both selections are run through `selector.process`. The `matrix` argument is resolved as a literal (`none`/empty → no matrix), an existing file path, or a name looked up under `$PYMOL_DATA/pymol/matrices/`. If `object` is given, an alignment object is created that pairs atoms and drives the sequence viewer. The reported RMSD is over the *surviving* atoms after outlier rejection; set `cycles=0` to get the all-atom RMSD with no rejection. States are converted to zero-based before the `_cmd.align` call. Returns the fit result (RMSD and atom count).

## Examples
```python
align protA////CA, protB////CA, object=alnAB
align mobile and cycles=0, target   # all-atom RMSD, no rejection
```

## Related
- [super](../commands/super.md)
- [cealign](../commands/cealign.md)
- [alignto](./alignto.md)
- [fit](../commands/fit.md)

## Source
`packages/engine/modules/pymol/fitting.py:372`. Parity: implemented in `packages/engine-ts/src/cmd/align.ts` (Cα sequence-alignment superposition via SVD-based Kabsch fit).
