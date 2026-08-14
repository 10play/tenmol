---
name: ray
kind: command
category: rendering-export
subcategory: ray tracing
summary: Render a ray-traced image of the current frame, optionally at a fixed size and for stereo pairs.
parity: implemented
---

## Purpose
`ray` produces a high-quality ray-traced image of the current view using PyMOL's
built-in ray tracer (or PovRay). Reach for it before saving a publication figure;
follow it with `png` (with `prior=1`) to write the rendered pixels to disk. It can
take seconds to minutes depending on scene complexity.

## Syntax
`ray(width=0, height=0, antialias=-1, angle=0.0, shift=0.0, renderer=-1, quiet=1, async_=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `width` | integer | `0` | image width in px (0 = current viewport) |
| `height` | integer | `0` | image height in px (0 = current viewport) |
| `antialias` | integer | `-1` | -1 uses the `antialias` setting |
| `angle` | float | `0.0` | y-axis rotation for stereo image generation |
| `shift` | float | `0.0` | x-axis translation for stereo image generation |
| `renderer` | integer | `-1` | -1 default, 0 built-in, 1 PovRay, 2 dry-run |
| `quiet` | | `1` | suppress feedback |
| `async_` | | `0` | 1 renders in a background thread |

## Behaviour
If only one of `width`/`height` is given, the other is scaled to preserve the
current aspect ratio. `angle` and `shift` generate matched stereo pairs.
`renderer=1` (PovRay) is Unix-only, needs `povray` on the PATH, and uses temp
files `tmp_pymol.pov`/`tmp_pymol.png`; `renderer=2` is a dry run. Before rendering,
`ray` stops any playing movie, turns off `sculpting`, and stops rocking so the
scene is static. With `async_=1` it returns immediately while a daemon thread
renders. Note the trailing-underscore parameter name `async_`; the legacy
keyword `async` is still accepted.

## Examples
```
ray
ray 1024, 768
ray renderer=2
```

## Related
- [draw](../commands/draw.md)
- [png](../commands/png.md)
- [save](../commands/save.md)

## Source
`packages/engine/modules/pymol/viewing.py:1662` (`def ray`). Parity: implemented
via the headless CPU ray tracer in `packages/engine-ts/src/cmd/render.ts:133`
(see commit "headless CPU ray tracer for cmd.ray/draw/png").
