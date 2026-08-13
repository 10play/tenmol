---
name: volume_color
kind: command
category: maps-volumes
subcategory: volume transfer function
summary: Sets or gets the color/alpha transfer function (ramp) of a volume object.
parity: implemented
---

## Purpose
`volume_color` assigns the transfer function that maps density values to color and opacity for a `volume` object, or reads back the current one when no ramp is given. It is how you tune which density levels appear and in what color.

## Syntax
`volume_color(name, ramp='', state=-1, quiet=1, _guiupdate=True)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | volume object name |
| `ramp` | str/list | `''` | named ramp, or a flat list of `(value, color, alpha, …)` / `(value, r, g, b, alpha, …)`; empty → get current |
| `state` | int | `-1` | state of the volume to color (`-1` = current) |
| `quiet` | int | `1` | suppress feedback |
| `_guiupdate` | bool | `True` | push the new colors to any open volume panel |

## Behaviour
With an empty `ramp` it delegates to `get_volume_color` and returns the current ramp. Otherwise a named ramp is looked up in the registered `namedramps`, then the ramp is expanded to a flat list and set via `_cmd.set_volume_ramp(_COb, name, ramplist, state-1)`. Colors may be given as either `x color alpha` triples or `x r g b alpha` quintuples. When `_guiupdate` is set and a Tk or Qt volume panel is open for the object, its editor is refreshed to match.

## Examples
```python
fetch 1a00, map, type=2fofc
volume vol, map
volume_color vol, .8 cyan 0. 1. blue .3 2. yellow .3
```

## Related
- [volume](../commands/volume.md)
- [volume_ramp_new](../commands/volume_ramp_new.md)
- [volume_panel](../commands/volume_panel.md)

## Source
`packages/engine/modules/pymol/colorramping.py:123`. Parity: implemented in `packages/engine-ts/src/cmd/ramps.ts`.
