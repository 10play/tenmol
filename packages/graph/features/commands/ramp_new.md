---
name: ramp_new
kind: command
category: coloring
subcategory: color ramp
summary: Create a color-ramp gadget object that colors atoms by map potential or by proximity to a molecular object.
parity: implemented
---

## Purpose
`ramp_new` creates a `object:ramp` gadget that maps a scalar (map potential value
at each point, or distance to a target object) onto a color gradient. You then
color representations "by" the ramp, so their color tracks the underlying field
or proximity. This is the standard mechanism for electrostatic-potential and
distance-based coloring.

## Syntax
`ramp_new(name, map_name, range=[-1.0, 0.0, 1.0], color=['red', [1.0, 1.0, 1.0], 'blue'], state=1, selection='', beyond=2.0, within=6.0, sigma=2.0, zero=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | | name of the ramp object |
| `map_name` | string | | map object (for potential) or molecular object (for proximity) |
| `range` | list | `[-1.0, 0.0, 1.0]` | values corresponding to ramp slots |
| `color` | list | `['red', [1.0,1.0,1.0], 'blue']` | colors corresponding to ramp slots (or a named spectrum) |
| `state` | integer | `1` | state identifier |
| `selection` | selection | `''` | selection used for automatic ranging |
| `beyond` | number | `2.0` | auto-range: exclude values beyond this distance from the selection |
| `within` | number | `6.0` | auto-range: only include values within this distance |
| `sigma` | number | `2.0` | auto-range: how many standard deviations from the mean to span |
| `zero` | integer | `1` | auto-range: force the central value to zero |
| `quiet` | | `1` | suppress feedback |

## Behaviour
`range` and `color` lists must be the same length; each color may be a color
name, an RGB list, or (as a single string) a named ramp spectrum from
`ramp_spectrum_dict` (traditional, sludge, ocean, hot, grayable, rainbow, afmhot,
grayscale, object). Colors are resolved with `get_color_tuple(a, 4)`, so negative
"special" RGB colors survive. The ramp registers as a color extension with index
`-10 - slot`. When `selection` is given, `beyond`/`within`/`sigma`/`zero` drive
automatic ranging around that selection. Ramp targets for proximity mode must be
real objects, not selections, so you may need `create` first. Ramps can nest —
one ramp's output color can feed another.

## Examples
```
ramp_new e_pot_color, e_pot_map, [-10, 0, 10], [red, white, blue]
ramp_new prox, target_obj, [3, 6], selection=polymer
```

## Related
- [ramp_update](../commands/ramp_update.md)
- [color](../commands/color.md)
- [gradient](../commands/gradient.md)

## Source
`packages/engine/modules/pymol/creating.py:374` (`def ramp_new`). Parity:
implemented in `packages/engine-ts/src/cmd/ramps.ts:178`; see docs/feature-parity.md
"Color ramps" [x].
