---
name: volume_ramp_new
kind: command
category: maps-volumes
subcategory: volume transfer function
summary: Registers a named volume color ramp reusable as a preset when creating or coloring volumes.
parity: implemented
---

## Purpose
`volume_ramp_new` defines a named transfer function (a list of value/color/alpha control points) that can then be referenced by name in `volume` and `volume_color`. Use it to build a reusable preset; the name also appears in the internal menus at "A > volume" and "C".

## Syntax
`volume_ramp_new(name, ramp)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | name of the new ramp |
| `ramp` | str/list | — | space-delimited (or list) sequence of `value color alpha` control points |

## Behaviour
A string `ramp` is split on whitespace into a list; the result is stored in the module-level `namedramps[name]` registry. Each control point is a density value, a color (name or components), and an alpha. Once registered, the name is accepted anywhere a ramp is expected (`volume ... , <name>` or `volume_color obj, <name>`). Registration is purely a definition — it does not create or modify any volume object.

## Examples
```python
volume_ramp_new pink1sigma, \
   0.9 violet 0.0 \
   1.0 magenta 0.3 \
   1.5 pink 0.0
```

## Related
- [volume](../commands/volume.md)
- [volume_color](../commands/volume_color.md)

## Source
`packages/engine/modules/pymol/colorramping.py:56`. Parity: implemented in `packages/engine-ts/src/cmd/ramps.ts`.
