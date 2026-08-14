---
name: spectrum
kind: command
category: coloring
subcategory: spectrum coloring
summary: Colors atoms with a spectrum of colors based on an atomic property such as count, B-factor, occupancy, or partial charge.
parity: implemented
---

## Purpose
`spectrum` applies a graduated color ramp across a selection, mapping a per-atom
numeric property onto a named palette. It is the standard way to color by
B-factor, by residue order (rainbow), by occupancy, or by partial charge.

## Syntax
`spectrum(expression='count', palette='rainbow', selection='(all)', minimum=None, maximum=None, byres=0, quiet=1, interpolation='rgb')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `expression` | string | `'count'` | Property to map: `count`, `b`, `q`, or `pc` (atom count, temperature factor, occupancy, partial charge). |
| `palette` | string | `'rainbow'` | Palette name or a space-separated list of colors. |
| `selection` | string | `'(all)'` | Atoms to color. |
| `minimum` | float | `None` | Low end of the value range; `None` = automatic (data minimum). |
| `maximum` | float | `None` | High end of the value range; `None` = automatic (data maximum). |
| `byres` | int | `0` | If set, coloring is applied per residue rather than per atom. |
| `quiet` | int | `1` | Suppress feedback when set. |
| `interpolation` | string | `'rgb'` | Color interpolation space. |

## Behaviour
When `expression='count'` the ramp follows atom order, giving the familiar
N-to-C rainbow. `minimum`/`maximum` clamp the value domain so colors are
comparable across objects; leaving them `None` autoscales to the data. A large
family of palettes is available (`blue_red`, `rainbow_rev`, `cbmr`, `gcbmry`,
`red_white_blue`, etc.); alternatively pass a space-separated color list as the
palette. `byres=1` averages the property per residue so an entire residue takes
one color. Internally, non-standard palettes route through the `spectrumany`
helper.

## Examples
```
spectrum b, blue_red, minimum=10, maximum=50
spectrum count, rainbow_rev, chain A, byres=1
spectrum q, red_white_blue
```

## Related
- [color](../commands/color.md)
- [set_color](../commands/set_color.md)

## Source
`packages/engine/modules/pymol/viewing.py:2065`. Parity: implemented — registered
in `packages/engine-ts/src/cmd/coloring.ts:387`.
