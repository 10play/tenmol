---
name: torsion
kind: command
category: editing-building
subcategory: bond rotation
summary: Rotates the torsion about the bond currently picked for editing.
parity: implemented
---

## Purpose
`torsion` rotates one side of the currently picked editing bond by a given angle,
letting you adjust a dihedral interactively while building or fixing geometry. It
operates on the bond selected with `edit` (or picked with the mouse).

## Syntax
`torsion(angle)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `angle` | float | — | Rotation angle in degrees. |

## Behaviour
The rotated fragment is the one on the side of the first picked atom (or the
nearer atom when the bond was picked with the mouse). A bond must be picked for
editing first; otherwise there is nothing to rotate. Positive and negative angles
rotate in opposite senses about the bond axis. The result modifies atomic
coordinates directly.

## Examples
```
edit (pk1), (pk2)
torsion 30
torsion -15
```

## Related
- [edit](../commands/edit.md)
- [unpick](../commands/unpick.md)
- [remove_picked](../commands/remove_picked.md)
- [cycle_valence](../commands/cycle_valence.md)

## Source
`packages/engine/modules/pymol/editing.py:1135`. Parity: implemented — registered
in `packages/engine-ts/src/cmd/editing.ts:314`.
