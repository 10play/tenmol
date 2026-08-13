---
name: ramp_update
kind: command
category: coloring
subcategory: color ramp
summary: Update the value range and/or colors of an existing color-ramp object.
parity: implemented
---

## Purpose
`ramp_update` re-ranges or re-colors a ramp created by `ramp_new` without
recreating it. Use it to tweak an electrostatic or distance ramp's endpoints or
palette while keeping representations bound to the same ramp.

## Syntax
`ramp_update(name, range=[], color=[], quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | | | name of the existing ramp object |
| `range` | list | `[]` | new value slots (empty = keep current) |
| `color` | list | `[]` | new colors (empty = keep current) |
| `quiet` | | `1` | suppress feedback |

## Behaviour
Implemented as a thin forward to `ramp_new(name, '', range, color, quiet=quiet)`
— it reuses the ramp-creation path with an empty `map_name`, which updates the
existing object rather than binding a new map. Only `range` and `color` can be
changed this way; other parameters keep their original values.

## Examples
```
ramp_new    e_pot_color, e_pot_map, [-10, 0, 10], [red, white, blue]
ramp_update e_pot_color, range=[-15, 0, 15]
ramp_update e_pot_color, color=[green, white, orange]
```

## Related
- [ramp_new](../commands/ramp_new.md)

## Source
`packages/engine/modules/pymol/creating.py:492` (`def ramp_update`). Parity:
implemented in `packages/engine-ts/src/cmd/ramps.ts:190`.
