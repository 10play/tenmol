---
name: copy_to
kind: command
category: objects-groups
subcategory: object merge
summary: Copies a selection into an object (all states), renaming chain/segi/ID to avoid conflicts.
parity: implemented
---

## Purpose
`copy_to` merges an atom selection into a target object across all states, by default renaming chain, segi and ID identifiers so the incoming atoms do not collide with what is already there. Use it to accumulate atoms from several sources into one object without identifier clashes.

## Syntax
`copy_to(name, selection, rename='chain segi ID', zoom=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Object name to modify (created if absent) |
| `selection` | str | — | Atoms to copy into `name` |
| `rename` | str | `'chain segi ID'` | Space-separated list of identifiers to uniquify |
| `zoom` | int | `-1` | Zoom behaviour on the result (`-1` = `auto_zoom`) |
| `quiet` | int | `1` | Suppress the "Copied N atoms" report when `1` |

## Behaviour
Implemented in Python on top of primitives: it `create`s a temporary object from `selection`, disables the source objects, then for each token in `rename` either sets `ID = -1` (for `ID`) or uniquifies that property against the existing target. It then `create`s `name` from the union of the existing target and the temp object, unpicks, and deletes the temp. If `quiet` is off it prints the number of atoms copied. Renaming only touches the listed identifiers; omit tokens from `rename` to preserve them.

## Examples
```python
copy_to merged, chain A
copy_to combined, 1ubq, rename=chain
```

## Related
- [create](../commands/create.md)
- [fuse](../commands/fuse.md)

## Source
`packages/engine/modules/pymol/editing.py:3122` (`def copy_to`). Ported: `packages/engine-ts/src/cmd/extras.ts:351` (`ctx.command('copy_to', ...)`).
