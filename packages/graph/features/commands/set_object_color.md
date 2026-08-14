---
name: set_object_color
kind: command
category: coloring
subcategory: object color
summary: Sets an object's whole-object color attribute (distinct from per-atom colors).
parity: implemented
---

## Purpose
`set_object_color` assigns a single color to an object as an object-level attribute. This differs from `color`, which paints per-atom colors — the object color is used where PyMOL needs one color for the whole object (e.g. certain non-atom object types and defaults).

## Syntax
`set_object_color(name, color, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | object name |
| `color` | str | — | color name or index |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
The color may be any named color or a color index. Because it sets an object attribute rather than per-atom colors, it does not override colors already applied to individual atoms via `color`; it establishes the object's own color slot. Returns a status code.

## Examples
```python
set_object_color myobj, marine
```

## Related
- [color](color.md) — per-atom coloring
- [set_color](set_color.md) — define a new named color

## Source
Upstream: `packages/engine/modules/pymol/editing.py:2866` (delegates to `_cmd.set_object_color`). Parity: implemented at `packages/engine-ts/src/cmd/display.ts:110`.
