---
name: technical
kind: command
category: presets
subcategory: representation preset
summary: Applies the "technical" visual preset — chainbow ribbon, colored ligands, non-bonded atoms and hydrogen-bond dashes.
parity: implemented
---

## Purpose
`technical` is a one-shot representation preset that produces a detailed,
publication-style technical view: a chain-rainbow ribbon of the backbone,
colored ligands as sticks, nonbonded atoms shown, and polar (hydrogen-bond)
contacts drawn as dashes. Reach for it to quickly get an informative overview of
a structure and its binding sites.

## Syntax
`technical(selection='(all)')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'(all)'` | Atoms to apply the preset to. |

## Behaviour
The command prepares a scratch selection, then layers several representations:
`util.chainbow` colors the backbone as a rainbow; `util.cbc`/`util.cbac` color
ligands and non-carbon atoms; nonbonded atoms and lines are shown for the
protein, sticks for ligands, and a ribbon for the backbone. A distance object of
polar contacts (`dist ... mode=2`) is created for hydrogen bonds, styled with a
thin dash width and its labels hidden. Solvent/ligand nonbonded atoms are shown,
and the temporary selection is deleted at the end.

## Examples
```
technical
technical chain A
```

## Related
- [preset](../commands/preset.md)
- [dist](../commands/dist.md)

## Source
`packages/engine/modules/pymol/preset.py:283`. Parity: implemented — registered
among the preset aliases in `packages/engine-ts/src/cmd/preset.ts:408`.
