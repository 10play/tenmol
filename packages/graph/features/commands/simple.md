---
name: simple
kind: command
category: presets
subcategory: preset
summary: Preset that draws structures as color-by-chain ribbons with lines/sticks for cysteines and ligands.
parity: implemented
---

## Purpose
`simple` is a display preset (from the `preset` module) that gives a quick, clean overview of a structure: chains shown as color-by-chain ribbons, with disulfide cysteines and any ligands drawn as lines/sticks. Use it as a fast starting point rather than configuring representations by hand.

## Syntax
`simple(selection='(all)')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'(all)'` | Atoms to apply the preset to |

## Behaviour
Prepares a temporary selection, applies `util.cbc` (color by chain), then shows ribbon for the selection, lines on the CA/CB/SG atoms of bonded CYS/CYX pairs (disulfides), and sticks for covalent/nearby ligands (extending 1-2 bonds out). It colors visible lines/sticks by element (`util.cnc`), shows nonbonded and lines for ligand/solvent atoms, then deletes the temporary selection. It hides sticks on atoms that are merely one bond beyond a shown region to avoid clutter.

## Examples
```python
preset.simple('all')
preset.simple('polymer')
```

## Related
- [preset.pretty](./pretty.md)
- [util.cbc](./cbc.md)
- [show](./show.md)

## Source
`packages/engine/modules/pymol/preset.py` (`def simple`); signature in `docs/api-reference/commands.mdx:3800`. Parity: implemented in `packages/engine-ts/src/cmd/preset.ts`.
