---
name: desaturate
kind: command
category: coloring
subcategory: color adjustment
summary: Desaturates (blends toward grey) the colors of a selection by a given factor.
parity: implemented
---

## Purpose
`desaturate` reduces the saturation of the colors on a selection, blending them toward grey by a factor `a`. Reach for it to mute the coloring of context atoms so a highlighted region stands out.

## Syntax
`desaturate(selection='all', a=0.5, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | Atom selection to desaturate |
| `a` | float [0..1] | `0.5` | Desaturation factor; higher blends further toward grey |
| `quiet` | int | `1` | Suppress status output when `1` |

## Behaviour
Adjusts per-atom colors toward grey by the factor `a` (0 = no change, 1 = fully grey). Note: in upstream open-source PyMOL this is an incentive-only feature (`desaturate` raises `IncentiveOnlyException`); the tenmol TypeScript engine provides a working implementation that blends colors toward grey.

## Examples
```python
desaturate
desaturate not chain A, a=0.7
```

## Related
- [color](../commands/color.md)
- [set_color](../commands/set_color.md)

## Source
`packages/engine/modules/pymol/experimenting.py:268` (`def desaturate`; upstream raises `IncentiveOnlyException`). Ported: `packages/engine-ts/src/cmd/display.ts:184` (`ctx.command('desaturate', ...)`, blend-toward-grey).
