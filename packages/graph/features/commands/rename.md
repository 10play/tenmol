---
name: rename
kind: command
category: editing-building
subcategory: atom naming
summary: Generates atom names that are unique within each residue of a selection.
parity: planned
---

## Purpose
`rename` assigns new atom names so that every atom is uniquely named within its residue. Reach for it after building or merging structures where atoms may have shared or missing names, so downstream selections and identity-based operations behave correctly.

## Syntax
`rename(selection='all', force=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'all'` | atoms whose names are regenerated |
| `force` | int | `0` | rename all atoms, even those that already have unique names |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
By default only atoms whose names collide within a residue are renamed; with `force=1` all atoms in the selection get freshly generated names. Names follow element-plus-counter conventions to guarantee intra-residue uniqueness. This alters the `name` identifier that selection algebra keys on — it does not change coordinates or connectivity. Contrast with [alter](../commands/alter.md), which lets you set arbitrary atom properties directly.

## Examples
```python
rename all
rename (chain A), force=1
```

## Related
- [alter](../commands/alter.md)

## Source
`packages/engine/modules/pymol/editing.py:1610`; signature in `docs/api-reference/commands.mdx:3224`. Parity: no dedicated `rename` command registered in `packages/engine-ts/src`; planned.
