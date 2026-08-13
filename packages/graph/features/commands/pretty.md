---
name: pretty
kind: command
category: presets
subcategory: display preset
summary: Applies a clean cartoon-plus-ligand-sticks display preset to a selection.
parity: implemented
---

## Purpose
`pretty` is a one-shot preset that produces an attractive default view of a
structure: cartoon for the protein spectrum-colored by residue count, sticks for
ligands colored by chain/atom, and assigned secondary structure. Reach for it to
instantly get a presentable scene without hand-configuring representations.

## Syntax
```
pretty(selection='(all)', *, solv=False)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms the preset is applied to |
| `solv` | bool | `False` | if True, also show waters/solvent as licorice |

## Behaviour
Runs `dss` (preserving existing assignment), sets `cartoon auto`, and shows
cartoon. Ligands are shown as sticks (or licorice with waters when `solv=True`),
colored by chain (`util.cbc`) with non-carbon atoms recolored (`util.cbac`), and
polymer carbons are spectrum-colored by count. It then tweaks cartoon settings:
disables highlight color, fancy helices, smooth loops and side-chain helper, and
enables flat sheets. `pretty_no_solv` is an alias. `publication` builds on top of
this preset.

## Examples
```
pretty
pretty polymer, solv=True
```

## Related
- [publication](publication.md) - the richer publication-quality variant
- `dss`, `cartoon`, `spectrum` - the operations it orchestrates

## Source
`packages/engine/modules/pymol/preset.py:305`. Registered in the TS port at
`packages/engine-ts/src/cmd/preset.ts:409`.
