---
name: capture
kind: command
category: rendering-export
subcategory: image capture
summary: Captures the current frame as an antialiased OpenGL image.
parity: partial
---

## Purpose
`capture` grabs the current viewport frame as an image. It is a thin convenience
wrapper over `draw` used to snapshot the current display without invoking the
ray tracer.

## Syntax
`capture(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | int | `1` | Suppress feedback when set. |

## Behaviour
`capture` simply calls `draw(antialias=-2, quiet=quiet)`. The `antialias=-2`
value selects the capture-specific antialiasing path in `draw`; no width or
height are passed, so the current viewport dimensions are used. The image is an
OpenGL render of the current frame, not a ray-traced image.

## Examples
```
capture
capture quiet=0
```

## Related
- [draw](../commands/draw.md)
- [ray](../commands/ray.md)
- [png](../commands/png.md)

## Source
`packages/engine/modules/pymol/viewing.py:1598`. In the TS port `capture` is a
registered no-op accepted for compatibility
(`packages/engine-ts/src/cmd/extras.ts`).
