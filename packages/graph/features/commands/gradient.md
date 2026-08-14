---
name: gradient
kind: command
category: maps-volumes
subcategory: map objects
summary: Creates a gradient object (field of arrows) from a map object.
parity: implemented
---

## Purpose
`gradient` builds a gradient object from an existing map object, visualizing the map's spatial derivative as a field. Reach for it when you want to see the direction and steepness of change in a density/potential map rather than a contoured isomesh.

## Syntax
`gradient(name, map, minimum=1.0, maximum=-1.0, selection='', buffer=0.0, state=0, carve=None, source_state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | Name of the gradient object to create |
| `map` | string | — | Name of the source map object |
| `minimum` | float | `1.0` | Minimum level (see below) |
| `maximum` | float | `-1.0` | Maximum level; default `< minimum` means full map range |
| `selection` | selection | `''` | Atoms about which to display the field |
| `buffer` | float | `0.0` | Extra padding around `selection` |
| `state` | int | `0` | Object state (0 = all) |
| `carve` | float | `None` | Carve radius around `selection`; `None` becomes `0.0` |
| `source_state` | int | `0` | Map state to read from |
| `quiet` | 0/1 | `1` | Suppress feedback when `1` |

## Behaviour
`selection` is passed through `selector.process`, then the call delegates to `_cmd.isomesh` (gradient shares the isomesh code path) with mesh-mode `3`. States are converted to zero-based (`state-1`, `source_state-1`). When `maximum < minimum` (the default `1.0`/`-1.0`) the full map range is used. A `None` `carve` is coerced to `0.0`.

## Examples
```python
load map.ccp4, emap
gradient grad, emap, selection=(polymer), buffer=3.0
```

## Related
- [isomesh](../commands/isomesh.md)
- [load](../commands/load.md)

## Source
`packages/engine/modules/pymol/creating.py:843`. Parity: implemented in `packages/engine-ts/src/cmd/ramps.ts`.
