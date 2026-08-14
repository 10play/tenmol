---
name: pair_fit
kind: command
category: fitting-alignment
subcategory: paired-atom superposition
summary: Superimposes objects using explicitly matched pairs of atom selections.
parity: implemented
---

## Purpose
`pair_fit` least-squares superimposes one structure onto another using pairs of
matched atom selections you supply. Unlike `align`, which finds correspondences
by sequence, `pair_fit` lets you dictate exactly which atoms map to which — ideal
for fitting fragments, ligands, or residues in a non-sequential correspondence.

## Syntax
```
pair_fit(*arg, quiet=0)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `*arg` | str... | | an even number of selections: mobile1, target1, mobile2, target2, ... |
| `quiet` | int | `0` | suppress feedback |

## Behaviour
Requires at least two selections and an even count (raises `CmdException`
otherwise). Each selection is preprocessed, then `_cmd.fit_pairs` performs the
fit and returns the RMSD (values below -0.5 raise an error). If atoms are stored
in the same internal order in both objects, just two whole-selection arguments
suffice; otherwise list atoms pair-by-pair. Selections must yield the same atom
count on each side of a pair. Script files are recommended because the argument
list gets long.

## Examples
```
pair_fit protA/10-25+33-46/CA, protB/22-37+41-54/CA
pair_fit ligA////C1, ligB////C8, ligA////C2, ligB////C4
```

## Related
- `fit`, `rms`, `rms_cur`, `intra_fit`, `intra_rms`, `intra_rms_cur` - fitting family

## Source
`packages/engine/modules/pymol/fitting.py:776`. Registered in the TS port at
`packages/engine-ts/src/cmd/align.ts:612`.
