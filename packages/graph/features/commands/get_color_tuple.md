---
name: get_color_tuple
kind: command
category: coloring
subcategory: color table
summary: Returns the RGB tuple (0.0–1.0) for a color name or index.
parity: implemented
---

## Purpose
`get_color_tuple` returns the RGB triple (each component 0.0–1.0) for a color, addressed by name or by index. Reach for it to obtain the actual float RGB values behind a named color — the inverse of [get_color_index](../commands/get_color_index.md).

## Syntax
`get_color_tuple(name, mode=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str/int | — | Color name or index |
| `mode` | int | `0` | Don't use; `mode=4` returns negative R for special colors |

## Behaviour
Acquires the lock and calls `_cmd.get_color(name, mode)`. Normal usage keeps `mode=0`; other modes are legacy and warn: `mode` `1`/`2` tells you to use [get_color_indices](../commands/get_color_indices.md) instead, and `mode=3` tells you to use [get_color_index](../commands/get_color_index.md). If the name is unknown the result is `None` and (with error feedback enabled) it prints `cmd-Error: Unknown color '<name>'.`.

## Examples
```python
rgb = cmd.get_color_tuple("red")        # (1.0, 0.0, 0.0)
rgb = cmd.get_color_tuple(4)            # by index
```

## Related
- [get_color_index](../commands/get_color_index.md)
- [get_color_indices](../commands/get_color_indices.md)
- [set_color](../commands/set_color.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:825`. Parity: implemented — named color table lives in `packages/engine-ts/src/exec/color.ts` (`get_color_tuple`).
