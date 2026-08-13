---
name: get_color_index
kind: command
category: coloring
subcategory: color table
summary: Resolves a color name to its internal color-table index.
parity: implemented
---

## Purpose
`get_color_index` maps a color name (e.g. `red`) to the integer index it occupies in PyMOL's color table. Reach for it when you need the numeric color id that other APIs expect.

## Syntax
`get_color_index(color)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `color` | str | — | Color name |

## Behaviour
Acquires the lock and calls `_cmd.get_color(color, 3)` — the mode-3 form of the color-table lookup — returning the integer index (or a negative/sentinel for unknown colors). A companion helper, `get_color_index_from_string_or_list`, additionally accepts a `[r,g,b]` list/tuple or a bracketed string, converting it to a `0xRRGGBB` name before resolving. It is the inverse of [get_color_tuple](../commands/get_color_tuple.md).

## Examples
```python
idx = cmd.get_color_index("red")
idx = cmd.get_color_index("skyblue")
```

## Related
- [get_color_tuple](../commands/get_color_tuple.md)
- [get_color_indices](../commands/get_color_indices.md)
- [set_color](../commands/set_color.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:858`. Parity: implemented — named color table lives in `packages/engine-ts/src/exec/color.ts` (`get_color_index`).
