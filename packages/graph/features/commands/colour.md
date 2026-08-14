---
name: colour
kind: command
category: coloring
subcategory: atom/object color
summary: British-spelling alias of color; changes the color of objects or atoms.
parity: implemented
---

## Purpose
`colour` is the British-spelling alias of [color](../commands/color.md). It
changes the color of atoms or objects and behaves identically.

## Syntax
`colour(color, selection='(all)', quiet=1, flags=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `color` | string | — | Color name or number. |
| `selection` | string | `'(all)'` | Atoms or objects to color. |
| `quiet` | int | `1` | Suppress feedback when set. |
| `flags` | int | `0` | Coloring flags passed through to the engine. |

## Behaviour
Identical to `color`: the selection is processed and the color resolved through
`_interpret_color` before `_cmd.color` is invoked. Color ramps may be used as a
color. See [color](../commands/color.md) for full details and the deeper
[color_deep](../commands/color_deep.md) variant.

## Examples
```
colour cyan
colour yellow, chain A
```

## Related
- [color](../commands/color.md)
- [color_deep](../commands/color_deep.md)
- [set_color](../commands/set_color.md)

## Source
`packages/engine/modules/pymol/viewing.py:1904` (shared `color` definition).
Registered as an alias alongside `color` in the TS engine.
