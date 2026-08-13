---
name: png
kind: command
category: rendering-export
subcategory: image export
summary: Saves the current display as a PNG (or PPM) image file.
parity: implemented
---

## Purpose
`png` writes the current viewport to an image file — the primary way to export a
figure from PyMOL. It can capture the fast OpenGL view or trigger a ray-traced
render first, and supports precise pixel or physical (inch/cm) sizing at a chosen
DPI.

## Syntax
```
png(filename, width=0, height=0, dpi=-1.0, ray=0, quiet=1, prior=0, format=0)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | string | | output file path (`.png` appended if absent) |
| `width` | int/str | `0` | width in pixels, or `in`/`cm` with a unit suffix; 0 = current |
| `height` | int/str | `0` | height (same rules as width); 0 = current, preserves aspect |
| `dpi` | float | `-1.0` | dots-per-inch; required when using inch/cm sizes; -1 = unspecified |
| `ray` | 0/1 | `0` | ray-trace before saving |
| `quiet` | int | `1` | suppress feedback |
| `prior` | int | `0` | use a prior ray-traced image: -1 try, 0 no, 1 yes |
| `format` | int/str | `0` | image format: 0/`png` = PNG, 1 = PPM, -1 = guess from extension |

## Behaviour
If only one of `width`/`height` is given, the viewport aspect ratio is preserved.
Unit-suffixed sizes (`10cm`) require `dpi`. `format=-1` (guess) picks PPM for a
`.ppm` filename, otherwise PNG, and PNG output auto-appends `.png` when missing.
`prior` must be one of -1/0/1 and `format` one of the accepted codes (asserted).
PNG is the only fully supported format. With `ray=1` a fresh ray trace is
rendered before the pixels are written.

## Examples
```
png image.png
png image.png, dpi=300
png image.png, 10cm, dpi=300, ray=1
```

## Related
- `mpng`, `save`, `ray`, `draw` - image and scene export

## Source
`packages/engine/modules/pymol/exporting.py:499`. Registered in the TS port at
`packages/engine-ts/src/cmd/render.ts:153`.
