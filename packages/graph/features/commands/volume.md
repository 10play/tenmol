---
name: volume
kind: command
category: maps-volumes
subcategory: volume rendering
summary: Creates a volume object (direct volumetric rendering) from a map object.
parity: partial
---

## Purpose
`volume` builds a volumetric rendering object from a density map, showing the field as a colored, semi-transparent cloud rather than an isosurface or mesh. Reach for it to visualise the full density distribution of a map, colored by a transfer-function ramp.

## Syntax
`volume(name, map, ramp='', selection='', buffer=0.0, state=1, carve=None, source_state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | name of the new (or overwritten) volume object |
| `map` | str | — | source map object |
| `ramp` | str | `''` | named color ramp to apply after creation |
| `selection` | selection | `''` | atoms about which to display density |
| `buffer` | float | `0.0` | extra margin (Å) around the selection |
| `state` | int | `1` | state to create |
| `carve` | float | `None` | radius (Å) around selected atoms to include; `None` → whole brick |
| `source_state` | int | `0` | state of the source map |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The selection is processed; `carve=None` becomes `0.0`. For legacy compatibility a numeric `ramp` is interpreted as a `level` and cleared, otherwise `level=0.0`. It calls `_cmd.volume(...)` with 0-based states. If the named object already exists it is overwritten. When a non-empty `ramp` name is given, `volume_color(name, ramp, state)` is applied afterward to set the transfer function.

## Examples
```python
fetch 1oky, async=0
fetch 1oky, type=2fofc, async=0
volume 1okyVol, 1oky_2fofc
```

## Related
- [map_new](../commands/map_new.md)
- [isosurface](../commands/isosurface.md)
- [isomesh](../commands/isomesh.md)
- [volume_color](../commands/volume_color.md)
- [volume_ramp_new](../commands/volume_ramp_new.md)

## Source
`packages/engine/modules/pymol/creating.py:577`. Parity: registered as a documented no-op in `packages/engine-ts/src/cmd/extras.ts` (needs a map object model).
