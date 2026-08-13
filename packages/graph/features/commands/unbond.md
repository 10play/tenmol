---
name: unbond
kind: command
category: editing-building
subcategory: bond editing
summary: Removes all bonds between two atom selections.
parity: implemented
---

## Purpose
`unbond` deletes every bond that joins an atom in the first selection to an atom in the second. Reach for it in molecular editing when you need to break connectivity — before re-bonding at a different order, splitting a fragment, or cleaning up spurious distance-based bonds.

## Syntax
`unbond(atom1='(pk1)', atom2='(pk2)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `atom1` | selection | `'(pk1)'` | one endpoint set; defaults to the first picked atom |
| `atom2` | selection | `'(pk2)'` | other endpoint set; defaults to the second picked atom |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Both selections are run through `selector.process`, then the same C entry point as `bond` is invoked (`_cmd.bond`) with bond order `0` and mode `0`, which signals removal rather than creation. With no arguments it operates on the picked pair `(pk1)`/`(pk2)` from an active edit. All matching bonds between the two selections are removed in one call.

## Examples
```python
# break the bond between two picked atoms
unbond

# remove all bonds linking a ligand to the protein
unbond polymer, resn LIG
```

## Related
- [bond](../commands/bond.md)
- [valence](../commands/valence.md)
- [fuse](../commands/fuse.md)
- [remove_picked](../commands/remove_picked.md)

## Source
`packages/engine/modules/pymol/editing.py:763`. Parity: implemented in `packages/engine-ts/src/cmd/editing.ts`.
