---
name: set_colour
kind: command
category: coloring
subcategory: color definition
summary: British-spelling alias of set_color; defines a named color from RGB components.
parity: implemented
---

## Purpose
`set_colour` is an exact alias of [set_color](set_color.md), provided for users who prefer British spelling. It defines a new named color (or redefines an existing one) from red/green/blue components.

## Syntax
`set_colour(name, rgb, mode=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | name for the new or existing color |
| `rgb` | list[number] | — | `[red, green, blue]`, each in `(0.0, 1.0)` or `(0, 255)` |
| `mode` | int | `0` | color definition mode |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
Identical to `set_color`: the range is auto-inferred (values above `1.0` are divided by 255), exactly three components are required, and existing objects need a `recolor` to pick up a redefinition. See [set_color](set_color.md) for the full behaviour.

## Examples
```python
set_colour skyblue, [ 0.2, 0.6, 1.0 ]
```

## Related
- [set_color](set_color.md) — the canonical spelling
- [recolor](recolor.md)

## Source
Upstream alias: `packages/engine/modules/pymol/viewing.py:2213` (`set_colour = set_color`), also registered in `keywords.py:348`. Parity: implemented at `packages/engine-ts/src/cmd/topics.ts:146`, which forwards to `set_color`.
