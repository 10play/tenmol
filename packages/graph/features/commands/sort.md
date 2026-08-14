---
name: sort
kind: command
category: editing-building
subcategory: atom ordering
summary: Reorders atoms within objects into canonical order, typically after alter has changed naming properties.
parity: implemented
---

## Purpose
`sort` re-sorts atoms in a structure into PyMOL's canonical ordering. It is mainly needed after an `alter` command that changed atom-naming properties, so that bonding and display stay consistent. With no argument it re-sorts every object.

## Syntax
`sort(object='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | string | `''` | Object to re-sort; empty re-sorts all objects |

## Behaviour
Lock-guarded pass-through to `_cmd.sort`. An empty `object` name means "all objects". Because `alter` can change atom identities (names, residue numbers) without moving them in the internal atom list, running `sort` afterwards restores a consistent order and fixes downstream operations that assume canonical ordering.

## Examples
```python
alter polymer, resi = str(int(resi) + 100)
sort
sort myObject
```

## Related
- [alter](./alter.md)
- [rebuild](./rebuild.md)

## Source
`packages/engine/modules/pymol/editing.py:1541`; signature in `docs/api-reference/commands.mdx:3837`. Parity: implemented in the TypeScript port (`packages/engine-ts/src/cmd`).
