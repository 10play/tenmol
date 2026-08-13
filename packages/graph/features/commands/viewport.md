---
name: viewport
kind: command
category: viewing-camera
subcategory: display size
summary: Changes the pixel size of the graphics display area.
parity: implemented
---

## Purpose
`viewport` resizes the OpenGL drawing area to an explicit width and height in pixels. Use it to fix a deterministic render size before `ray`/`draw`/`png`, or to script a specific window aspect ratio.

## Syntax
`viewport(width=-1, height=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `width` | int | `-1` | new width in pixels (`-1` = leave unchanged) |
| `height` | int | `-1` | new height in pixels (`-1` = leave unchanged) |

## Behaviour
If called with a string `width` and default `height`, the value is safe-evaluated; a tuple form (parentheses) is accepted but deprecated with a warning. Off the GUI thread it re-dispatches itself as a `viewport w,h` command; on the GUI thread it calls `_cmd.viewport(_COb, width, height)`. In the Qt app `cmd.viewport` is overloaded to a thread-safe signal that resizes the window so the GL area matches the requested pixel size, and it maintains aspect ratio when only one dimension is supplied.

## Examples
```python
viewport 640, 480
viewport 1200, 900
```

## Related
- [get_viewport](../commands/get_viewport.md)
- [window](../commands/window.md)
- [full_screen](../commands/full_screen.md)

## Source
`packages/engine/modules/pymol/viewing.py:1459`. Parity: implemented in `packages/engine-ts/src/cmd/settings2.ts`.
