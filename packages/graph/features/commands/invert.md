---
name: invert
kind: command
category: editing-building
subcategory: stereochemistry
summary: Inverts the stereochemistry at the picked atom, holding two attached atoms fixed.
parity: implemented
---

## Purpose
`invert` flips the stereochemistry of the atom picked for editing (`pk1`), keeping two of its attached atoms (`pk2`, `pk3`) immobile as the pivot. Use it in interactive editing mode to switch a chiral center to the opposite configuration.

## Syntax
`invert(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | 0/1 | `1` | Suppress feedback when `1` |

## Behaviour
Operates on the current edit picks rather than a selection argument: `pk1` is the center being inverted; `pk2` and `pk3` (two neighbors) are held fixed while the remaining substituents swap sides. Locks the C layer and calls `_cmd.invert`. In interactive Editing Mode it is usually bound to CTRL-E.

## Examples
```python
edit pk1
invert
```

## Related
- [edit](../commands/edit.md)
- [torsion](../commands/torsion.md)

## Source
`packages/engine/modules/pymol/editing.py:739`. Parity: implemented in `packages/engine-ts/src/cmd/builder.ts`.
