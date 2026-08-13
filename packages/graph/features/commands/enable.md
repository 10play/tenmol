---
name: enable
kind: command
category: objects-groups
subcategory: visibility toggle
summary: Turns on display of one or more objects and/or shows selection indicator dots.
parity: implemented
---

## Purpose
`enable` makes objects (or selection indicators) visible again in the 3D viewer. It is the inverse of `disable`. Note enabling an object is necessary but not sufficient to see it — at least one representation must also be shown.

## Syntax
`enable(name='all', parents=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | `'all'` | Name-pattern or selection expression to enable |
| `parents` | 0/1 | `0` | Also enable parent groups so the object is actually visible |

## Behaviour
If `name` matches a selection name, its selection indicator dots are shown; if `name` is a selection-expression, every object with atoms in that selection is enabled. Name patterns support wildcards (`1dn2.*`, `*lig`). With `parents=1`, ancestor groups are enabled too so a member inside a collapsed/disabled group actually appears. For content to render, the object must be enabled **and** have a shown representation.

## Examples
```python
enable target_protein
enable 1dn2.*      # everything starting with 1dn2.
enable *lig        # everything ending with lig
```

## Related
- [disable](./disable.md)
- [show](../commands/show.md)
- [hide](../commands/hide.md)

## Source
`packages/engine/modules/pymol/viewing.py:378`. Parity: implemented (object enable/disable visibility, feature-parity row 114).
