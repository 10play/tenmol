---
name: bg_color
kind: command
category: viewing-camera
subcategory: background
summary: Sets the viewport background color.
parity: implemented
---

## Purpose
`bg_color` sets the background color of the viewport (and of ray-traced / drawn
images). Reach for it to switch between the default black and a lighter
background such as white or grey for figures.

## Syntax
`bg_color(color='black')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `color` | string | `'black'` | Color name or number. |

## Behaviour
The color argument is passed through `_interpret_color`, so any named color,
numeric color index, or hex value that PyMOL understands is accepted. The change
applies immediately to the OpenGL viewport and is honored by `ray` and `draw`.
For a transparent background in ray-traced images, `unset opaque_background`
before calling `ray` rather than trying to encode transparency here.

## Examples
```
bg_color grey30
bg_color white
bg_color
```

## Related
- [set_color](../commands/set_color.md)
- [color](../commands/color.md)

## Source
`packages/engine/modules/pymol/viewing.py:1488`. Ported to
`packages/engine-ts/src/cmd/render.ts` (`bgColor`); the `bg_colour` spelling is a
registered alias.
