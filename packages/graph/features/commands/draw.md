---
name: draw
kind: command
category: rendering-export
subcategory: opengl image
summary: Renders an OpenGL (non-ray-traced) image of the current frame at an optional size.
parity: implemented
---

## Purpose
`draw` grabs an OpenGL snapshot of the current frame into an in-memory image buffer, optionally at a specified pixel size, without ray tracing. It is the fast alternative to `ray` when you want a quick offscreen image for `png`/`save`.

## Syntax
`draw(width=0, height=0, antialias=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `width` | int | `0` | Image width in pixels; 0 = current viewport width |
| `height` | int | `0` | Image height in pixels; 0 = current viewport height |
| `antialias` | int | `-1` | Antialiasing; -1 = use the `antialias` setting |
| `quiet` | 0/1 | `1` | Suppress feedback |

## Behaviour
If only one of `width`/`height` is given, the other is scaled to preserve the current aspect ratio. Before drawing it stops any playing movie (`mstop`) and turns off `sculpting`. Rendering runs inside an OpenGL context via `_call_with_opengl_context`, after a `refresh_now` to flush pending display events — so it does **not** work in command-line-only mode. On some hardware, `unset opaque_background` then `draw` yields a transparent background, though `ray` generally gives better results.

## Examples
```python
draw
draw 1600
draw 1920, 1080, antialias=2
```

## Related
- [ray](../commands/ray.md)
- [png](../commands/png.md)
- [save](../commands/save.md)

## Source
`packages/engine/modules/pymol/viewing.py:1601`. Parity: implemented in `packages/engine-ts/src/cmd/render.ts`.
