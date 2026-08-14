---
name: hide
kind: command
category: representations-display
subcategory: representation visibility
summary: Turns off atom and bond representations for a selection.
parity: implemented
---

## Purpose
`hide` switches off a named representation (or everything) for a selection. It is the counterpart to `show` and the primary way to declutter a scene.

## Syntax
`hide(representation='everything', selection='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `representation` | string | `'everything'` | `lines, spheres, mesh, ribbon, cartoon, sticks, dots, surface, labels, extent, nonbonded, nb_spheres, slice, dashes, angles, dihedrals, cgo, cell, callback`, or `everything` |
| `selection` | string | `''` | Selection-expression or name-pattern; `''` = all |

## Behaviour
Delegates to the shared `_showhide` helper with the "off" flag (`0`). With an empty `selection` it applies to everything currently loaded. `representation='everything'` hides all representations for the matched atoms/objects. Note `selection` can also be an object name-pattern.

## Examples
```python
hide lines, all
hide ribbon
hide everything, solvent
```

## Related
- [show](../commands/show.md)
- [enable](../commands/enable.md)
- [disable](../commands/disable.md)

## Source
`packages/engine/modules/pymol/viewing.py:597`. Parity: implemented in the engine-ts command layer (used throughout `packages/engine-ts/src/cmd/`).
