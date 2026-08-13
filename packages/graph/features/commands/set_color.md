---
name: set_color
kind: command
category: coloring
subcategory: color definition
summary: Defines a new named color (or redefines an existing one) from RGB components.
parity: implemented
---

## Purpose
`set_color` registers a named color from red/green/blue components so it can be used anywhere a color name is accepted. Use it to add custom colors to the palette or to override a built-in color's RGB definition.

## Syntax
`set_color(name, rgb, mode=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | name for the new or existing color |
| `rgb` | list[number] | — | `[red, green, blue]`, each in `(0.0, 1.0)` or `(0, 255)` |
| `mode` | int | `0` | color definition mode |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
PyMOL infers the value range automatically: if any component exceeds `1.0`, all three are divided by 255. The `rgb` argument may be a real list or a string that parses to one; it must have exactly three numbers or an error is raised. Redefining an existing color does not automatically repaint objects already using it — issue `recolor` to force existing objects to pick up the new definition. `set_colour` is a British-spelling alias.

## Examples
```python
set_color red, [ 1.0, 0.0, 0.0 ]
set_color myyellow, [ 255, 255, 0 ]
recolor
```

## Related
- [set_colour](set_colour.md) — spelling alias
- [color](color.md) — apply a color to atoms
- [recolor](recolor.md) — refresh objects after redefinition

## Source
Upstream: `packages/engine/modules/pymol/viewing.py:2153`. Parity: implemented at `packages/engine-ts/src/cmd/coloring.ts:285`.
