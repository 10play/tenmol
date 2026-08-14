---
name: add_bond
kind: command
category: editing-building
subcategory: bonding
summary: API-only function that adds a bond between two atoms specified by 1-based atom index.
parity: implemented
---

## Purpose
`add_bond` creates a bond between two atoms of an object identified by their 1-based atom indices (the same `index` value exposed by `cmd.iterate`). It is the index-driven counterpart to `bond`; use `bond` when you want to specify the atoms by selection expression instead.

## Syntax
`add_bond(oname, index1, index2, order=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `oname` | str | — | Object name |
| `index1` | int | — | First atom index (1-based) |
| `index2` | int | — | Second atom index (1-based) |
| `order` | int | `1` | Bond order |

## Behaviour
Under the API lock it calls `_cmd.add_bond`, converting each index to zero-based (`index - 1`) before passing to the core. It is API-only: there is no command-line parsing sugar, and both indices must belong to the object named by `oname`. Representations may need a `rebuild` to reflect the new bond.

## Examples
```python
cmd.add_bond("mol", 4, 7)          # single bond between atoms 4 and 7
cmd.add_bond("mol", 4, 7, order=2) # double bond
```

## Related
- [attach](./attach.md)
- [get_bonds](../commands/get_bonds.md)

## Source
`packages/engine/modules/pymol/editing.py:652`. Parity: implemented in `packages/engine-ts/src/cmd/builder.ts`.
