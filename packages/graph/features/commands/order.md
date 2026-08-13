---
name: order
kind: command
category: objects-groups
subcategory: name ordering
summary: Reorders (or sorts) object and selection names in the control panel.
parity: implemented
---

## Purpose
`order` controls the vertical ordering of names shown in the object/selection
control panel. Use it to group related objects, put a key object at the top or
bottom, or alphabetically sort the whole list. It also reorders members within a
group.

## Syntax
```
order(names, sort=0, location='current')
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `names` | string | | space-separated list of names to reorder |
| `sort` | yes/no | `0` | alphabetically sort the listed names |
| `location` | str | `'current'` | where to place them: `top`, `current`, or `bottom` |

## Behaviour
`location` is resolved through a shortcut dictionary (`top`/`current`/`bottom`),
and a string `sort` is coerced via the boolean shortcut. Wildcards in `names`
expand to matching names, so `order 1dn2_*, yes` sorts everything with that
prefix. With `location=top`/`bottom` the named objects are moved as a block to
the top or bottom of the panel. When the names belong to a group, `order`
reorders them within that group rather than at top level.

## Examples
```
order 1dn2 1fgh 1rnd
order *, yes
order 1frg, location=top
```

## Related
- `set_name`, [group](group.md) - renaming and grouping

## Source
`packages/engine/modules/pymol/controlling.py:559`. Behaviour asserted in
`docs/feature-parity.md:115` (drag-to-reorder emits `cmd.order`).
