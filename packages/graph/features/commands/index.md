---
name: index
kind: command
category: querying
subcategory: atom identifiers
summary: Returns (object, index) tuples for the atoms in a selection.
parity: implemented
---

## Purpose
`index` returns a list of `(object_name, index)` tuples for every atom in a selection. Use it when you need the per-object atom index, e.g. for low-level APIs — but prefer source IDs (`identify`) for anything long-lived.

## Syntax
`index(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'(all)'` | Atoms to index |
| `quiet` | 0/1 | `1` | If `0`, prints each `object\`index` |

## Behaviour
Selection is processed via `selector.process`, wrapped in parentheses, and passed to `_cmd.index`. Returns a list of `(object, index)` tuples. The docstring warns that atom indices are fragile: they shift whenever atoms are added or deleted, so use integral atom identifiers (`identify`/`id_atom`) instead whenever possible. With `quiet=0`, entries print as `cmd.index: (obj\`n)`.

## Examples
```python
idx = cmd.index("chain A and resi 10")
index name CA, quiet=0
```

## Related
- [identify](./identify.md)
- [id_atom](./id_atom.md)

## Source
`packages/engine/modules/pymol/querying.py:1309`. Parity: implemented in `packages/engine-ts/src/cmd/misc.ts`.
