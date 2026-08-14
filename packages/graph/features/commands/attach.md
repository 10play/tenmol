---
name: attach
kind: command
category: editing-building
subcategory: molecular building
summary: Adds a single new atom onto the currently picked atom with a given geometry and valence.
parity: implemented
---

## Purpose
`attach` grows a structure by adding one atom bonded to the picked atom (pk1), using a specified element, coordination geometry, and valence. It is a core interactive building verb in the editor/builder workflow.

## Syntax
`attach(element, geometry, valence, name='', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `element` | str | — | Element symbol of the new atom |
| `geometry` | int | — | Coordination geometry code (hybridisation) |
| `valence` | int | — | Valence of the new atom |
| `name` | str | `''` | Optional atom name |
| `quiet` | 0/1 | `1` | Suppress feedback |

## Behaviour
Under the API lock it calls `_cmd.attach(element, int(geometry), int(valence), name)`, adding the atom onto the current pick. The picked atom (pk1) supplies the attachment point; `geometry` and `valence` determine the placement and the number of implicit connections. Requires an active pick to attach to.

## Examples
```python
# after picking an atom (pk1) in the builder
attach C, 4, 4    # add an sp3 carbon
attach O, 2, 2, name=OXT
```

## Related
- [add_bond](./add_bond.md)
- [fuse](../commands/fuse.md)
- [replace](../commands/replace.md)

## Source
`packages/engine/modules/pymol/editing.py:921`. Parity: implemented in `packages/engine-ts/src/cmd/builder.ts`.
