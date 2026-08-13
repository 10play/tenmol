---
name: remove
kind: command
category: editing-building
subcategory: atom removal
summary: Deletes the atoms in a selection from their parent molecular objects.
parity: implemented
---

## Purpose
`remove` eliminates the atoms matched by a selection from their respective molecular objects. Reach for it when editing a structure to strip out solvent, ligands, alternate conformers, or any unwanted atoms while keeping the object itself alive.

## Syntax
`remove(selection, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | — | atoms to delete |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
The selection is preprocessed through the selector, wrapped in parentheses, and passed to the C layer, which physically removes those atoms from their objects. Unlike [delete](../commands/delete.md), which discards whole named objects, `remove` operates atom-wise and leaves the (now smaller) object in place. Representations touching the removed atoms must be regenerated. An empty object is not automatically deleted.

## Examples
```python
remove resi 124
remove solvent
remove (not polymer) and not resn ATP
```

## Related
- [delete](../commands/delete.md)
- [remove_picked](../commands/remove_picked.md)

## Source
`packages/engine/modules/pymol/editing.py:802`; signature in `docs/api-reference/commands.mdx:3202`. Parity: implemented in `packages/engine-ts/src/cmd/editing.ts:211`.
