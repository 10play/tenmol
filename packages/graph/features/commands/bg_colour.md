---
name: bg_colour
kind: command
category: viewing-camera
subcategory: background
summary: British-spelling alias of bg_color; sets the viewport background color.
parity: implemented
---

## Purpose
`bg_colour` is the British-spelling alias of [bg_color](../commands/bg_color.md).
It sets the viewport background color and behaves identically in every respect.

## Syntax
`bg_colour(color='black')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `color` | string | `'black'` | Color name or number. |

## Behaviour
Identical to `bg_color`: the color is interpreted through `_interpret_color` and
applied to the OpenGL viewport and to ray-traced / drawn output. See
[bg_color](../commands/bg_color.md) for background transparency notes.

## Examples
```
bg_colour white
bg_colour grey30
```

## Related
- [bg_color](../commands/bg_color.md)
- [set_color](../commands/set_color.md)

## Source
`packages/engine/modules/pymol/viewing.py:1488` (shared definition). In the TS
port `bg_colour` is registered as a thin alias that calls `bg_color`
(`packages/engine-ts/src/cmd/render.ts:144`).
