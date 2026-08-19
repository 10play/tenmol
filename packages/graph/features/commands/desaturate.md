---
name: desaturate
kind: command
category: coloring
subcategory: color adjustment
summary: Desaturates a selection's colours toward grey — incentive-only; raises IncentiveOnlyException (matched by the TS engine).
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
Conceptually adjusts per-atom colors toward grey by the factor `a` (0 = no change, 1 = fully grey). This is an **incentive-only** feature: upstream open-source PyMOL's `desaturate` raises `IncentiveOnlyException` rather than recolouring, and the tenmol TypeScript engine matches that by raising the identical error (verified against the real-PyMOL oracle).

## Examples
```python
desaturate
desaturate not chain A, a=0.7
```

## Related
- [color](../commands/color.md)
- [set_color](../commands/set_color.md)

## Source
`packages/engine/modules/pymol/experimenting.py:280` (`def desaturate` — raises `IncentiveOnlyException`). Ported: `packages/engine-ts/src/cmd/display.ts` (`ctx.command('desaturate', ...)` raises the same incentive-only error to match Open-Source PyMOL).
