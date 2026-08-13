---
name: color
kind: command
category: coloring
subcategory: atom/object color
summary: Changes the color of objects or atoms.
parity: implemented
---

## Purpose
`color` sets the color of atoms or whole objects. It is the primary coloring
command — assign a named color, a numeric color index, or a color ramp to a
selection.

## Syntax
`color(color, selection='(all)', quiet=1, flags=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `color` | string | — | Color name or number. |
| `selection` | string | `'(all)'` | Atoms or objects to color. |
| `quiet` | int | `1` | Suppress feedback when set. |
| `flags` | int | `0` | Coloring flags passed through to the engine. |

## Behaviour
The selection is processed with `selector.process` and the color is resolved via
`_interpret_color` (accepting names, indices, and hex), then `_cmd.color` is
called with the `flags` and `quiet` values. When a color ramp object exists, the
ramp name can be used as a color so atoms are colored by the ramped property.
Coloring sets an atom-level (or object-level) color setting; use
[color_deep](../commands/color_deep.md) to also clear per-representation color
overrides first.

## Examples
```
color cyan
color yellow, chain A
color red, resi 100-120
```

## Related
- [color_deep](../commands/color_deep.md)
- [set_color](../commands/set_color.md)
- [recolor](../commands/recolor.md)

## Source
`packages/engine/modules/pymol/viewing.py:1904`. Registered directly on the TS
Engine (`packages/engine-ts/src/index.ts`; see `packages/engine-ts/src/cmd/topics.ts`).
