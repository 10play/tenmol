---
name: space
kind: command
category: coloring
subcategory: color space
summary: Selects the working color palette/space (rgb, cmyk, or pymol) to keep on-screen colors print/video-safe.
parity: unknown
---

## Purpose
`space` chooses the color space PyMOL restricts itself to, so that on-screen colors reproduce well in a target medium. `rgb` is the default display space; `cmyk` limits colors to those that convert cleanly to print; `pymol` avoids oversaturated colors that cause problems in video/YUV encoding.

## Syntax
`space(space='', gamma=1.0, quiet=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `space` | string | `''` | Palette: rgb, cmyk, or pymol (default: rgb) |
| `gamma` | float | `1.0` | Gamma transformation applied to the palette |
| `quiet` | int | `0` | Suppress feedback |

## Behaviour
An empty `space` string resolves to no palette file (i.e. default rgb). Non-RGB spaces load a palette-mapping file that remaps named/spectrum colors into the reproducible subset — `cmyk` for print (avoiding purplish blues and yellowish greens), `pymol` to tame oversaturation for video. `gamma` applies a floating-point gamma correction across the palette. Note `quiet` defaults to `0` (verbose), unlike most commands.

## Examples
```python
space rgb
space cmyk
space pymol
```

## Related
- [color](./color.md)
- [set_color](./set_color.md)

## Source
`packages/engine/modules/pymol/importing.py` (`def space`); signature in `docs/api-reference/commands.mdx:3847`. Parity: referenced in `packages/engine-ts/src/cmd/system.ts` — status unknown.
