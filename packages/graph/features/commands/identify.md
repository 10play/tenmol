---
name: identify
kind: command
category: querying
subcategory: atom identifiers
summary: Returns a list of source IDs for the atoms in a selection.
parity: implemented
---

## Purpose
`identify` returns the source IDs (ID codes) of all atoms in a selection. Use it to collect stable, add/delete-resilient identifiers for a set of atoms.

## Syntax
`identify(selection='(all)', mode=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'(all)'` | Atoms to identify |
| `mode` | int | `0` | `0` = list of ids; `1` = list of `(object, id)` tuples |
| `quiet` | 0/1 | `1` | If `0`, prints each id |

## Behaviour
Selection is run through `selector.process` and wrapped in parentheses, then delegates to `_cmd.identify`. `mode=0` returns a flat list of integer ids; `mode=1` returns `(object_name, id)` tuples so ids from multiple objects stay distinguishable. With `quiet=0` each entry is printed.

## Examples
```python
ids = cmd.identify("chain A and name CA")
cmd.identify("all", mode=1)
```

## Related
- [id_atom](./id_atom.md)
- [index](./index.md)

## Source
`packages/engine/modules/pymol/querying.py:1276`. Parity: implemented in `packages/engine-ts/src/cmd/analysis.ts`.
